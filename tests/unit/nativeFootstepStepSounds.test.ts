import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { loadNativeStepSounds, NATIVE_STEPSOUND_PACKAGE_KIND } from "../../src/assets/native/loadNativeStepSounds";
import { loadNativeAnimationAudio } from "../../src/assets/native/loadNativeAnimationAudio";
import { FOOTSTEP_SURFACES, FOOTSTEP_WATER_SURFACES, surfaceVariationCount } from "../../src/audio/footstepSurfaces";

const packageSha = "e".repeat(64);
const encoder = new TextEncoder();
type Json = Record<string, unknown>;

async function fixture(mutate: (manifest: Json & { sounds: Json[]; surfaces: Json[] }) => void = () => {}) {
  const files = new Map<string, Uint8Array>(), sounds: Json[] = [], surfaces: Json[] = [];
  let exportIndex = 1;
  const sound = async (group: string, name: string, classification: Json) => {
    const bytes = encoder.encode(`RIFF${group}.${name}WAVE`), sha = await sha256(bytes), id = `HOST:${packageSha}:${++exportIndex}`;
    sounds.push({ dependencyId: id, file: `audio/${sha}.wav`, bytes: bytes.length, sha256: sha, mime: "audio/wav", object: `stepsound.${group}.${name}`,
      group, name, durationSeconds: .4, classification, source: { object: `stepsound.${group}.${name}`, packageSha256: packageSha, exportIndex } });
    files.set(`audio/${sha}.wav`, bytes); return id;
  };
  for (const id of FOOTSTEP_SURFACES) {
    const count = id === "Stone" ? 2 : 3;
    if (FOOTSTEP_WATER_SURFACES.has(id)) {
      const clips = [];
      for (let i = 1; i <= count; i++) clips.push(await sound("water", `${id}_0${i}`, { class: "surface", id, gait: null, variation: i }));
      surfaces.push({ id, label: id, group: "water", gaitSplit: false, clips });
    } else {
      const entry: Json = { id, label: id, group: id, gaitSplit: true };
      for (const gait of ["walk", "run"]) {
        const clips = [];
        for (let i = 1; i <= count; i++) clips.push(await sound(id, `${id.toLowerCase()}_${gait}_0${i}`, { class: "surface", id, gait, variation: i }));
        entry[gait] = clips;
      }
      surfaces.push(entry);
    }
  }
  const events = [{ id: "Water_In", group: "water", dependencyId: await sound("water", "Water_In", { class: "event", id: "Water_In", gait: null, variation: null }) },
    { id: "Water_Out", group: "water", dependencyId: await sound("water", "Water_Out", { class: "event", id: "Water_Out", gait: null, variation: null }) }];
  const boots = [];
  for (let i = 1; i <= 3; i++) boots.push(await sound("noise_boots", `noise_0${i}`, { class: "layer", id: "noise_boots", gait: null, variation: i }));
  const wood = surfaces.find(row => row.id === "Wood")!.walk as string[];
  const manifest = { schemaVersion: 1, kind: NATIVE_STEPSOUND_PACKAGE_KIND, package: { object: "stepsound", sha256: packageSha, soundCount: sounds.length },
    surfaces, events, layers: [{ id: "noise_boots", group: "noise_boots", clips: boots }], sounds,
    placements: { section: { manifest: { sha256: "c".repeat(64) } }, declared: [{ placementId: "interlude:20_20.StaticMeshActor930", sourceMesh: "Fort.Stair",
      slots: ["StepSound_1", "StepSound_2", "StepSound_3"].map((property, slot) => ({ property, slot, status: "source-declared",
        reference: (sounds.find(row => row.dependencyId === wood[slot])!.object as string).replace("stepsound", "StepSound"), dependencyId: wood[slot] })) }] } };
  mutate(manifest);
  const bytes = encoder.encode(JSON.stringify(manifest)), hash = await sha256(bytes), prefix = `/l2/step-sounds/${hash}/`;
  const records = [{ id: "human-fighter-footsteps", manifest: "/l2/animation-audio/x/manifest.json", manifestSha256: "f".repeat(64) },
    { id: "stepsound-surfaces", kind: NATIVE_STEPSOUND_PACKAGE_KIND, manifest: `${prefix}manifest.json`, manifestBytes: bytes.length, manifestSha256: hash }];
  const bytesAtPath = (path: string) => {
    if (path === `${prefix}manifest.json`) return bytes;
    const file = files.get(path.slice(prefix.length)); if (!file) throw new Error(`missing ${path}`); return file;
  };
  return { records, bytesAtPath, count: sounds.length };
}
const signal = new AbortController().signal;
function serveResourceBytes(bytesAtPath: (path: string) => Uint8Array | Promise<Uint8Array>): void {
  vi.stubGlobal("fetch", async (path: string) => new Response((await bytesAtPath(path)).slice()));
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("package-keyed stepsound loader", () => {
  it("verifies all package sounds, classifies each exactly once and keeps exact names and placement declarations", async () => {
    const { records, bytesAtPath, count } = await fixture();
    expect(count).toBe(93);
    serveResourceBytes(bytesAtPath);
    const bundle = await loadNativeStepSounds(records, signal);
    const library = bundle.library!;
    expect(bundle.sounds).toHaveLength(93); expect(library.soundCount).toBe(93);
    expect([...library.surfaces.keys()]).toEqual([...FOOTSTEP_SURFACES]);
    expect(surfaceVariationCount(library, "Stone")).toBe(2); expect(surfaceVariationCount(library, "Wood")).toBe(3);
    expect(library.surfaces.get("Water_Deep")!.run).toBe(library.surfaces.get("Water_Deep")!.walk);
    expect(library.events.Water_In.object).toBe("stepsound.water.Water_In");
    expect(library.boots.map(row => row.object)).toEqual(["stepsound.noise_boots.noise_01", "stepsound.noise_boots.noise_02", "stepsound.noise_boots.noise_03"]);
    expect(library.placements.get("interlude:20_20.StaticMeshActor930")).toMatchObject({ surface: "Wood", references: [
      "StepSound.Wood.wood_walk_01", "StepSound.Wood.wood_walk_02", "StepSound.Wood.wood_walk_03"] });
    expect(library.placements.get("interlude:20_20.StaticMeshActor930")!.slots.map(slot => [slot.property, slot.reference]))
      .toEqual([["StepSound_1", "StepSound.Wood.wood_walk_01"], ["StepSound_2", "StepSound.Wood.wood_walk_02"], ["StepSound_3", "StepSound.Wood.wood_walk_03"]]);
    expect(bundle.sounds.every(row => row.key.startsWith("native-stepsound:"))).toBe(true);
  });

  it("returns no library when unstaged and the actor-array loader ignores the package entry", async () => {
    expect(await loadNativeStepSounds([], signal)).toEqual({ library: null, sounds: [], manifest: null });
    const { records } = await fixture();
    await expect(loadNativeAnimationAudio([records[1]], new Map(), new Map(), signal)).resolves.toMatchObject({ definitions: [], manifests: [] });
  });

  it.each([
    ["a missing surface", (m: Json & { surfaces: Json[] }) => { m.surfaces = m.surfaces.filter(row => row.id !== "Marsh"); }, "surface set differs|unclassified"],
    ["a reclassified sound", (m: Json & { sounds: Json[] }) => { (m.sounds[0]!.classification as Json).id = "Grass"; }, "classification differs"],
    ["a sound used twice", (m: Json & { surfaces: Json[] }) => { const walk = m.surfaces[0]!.walk as string[]; walk[1] = walk[0]!; }, "classification differs"],
    ["a count that differs", (m: Json) => { (m.package as Json).soundCount = 94; }, "sound count differs"],
    ["a placement slot name differing from its Sound", (m: Json) => {
      ((((m.placements as Json).declared as Json[])[0]!.slots as Json[])[0]!).reference = "StepSound.Wood.Other"; }, "placement slot differs"],
    ["a duplicated StepSound slot property", (m: Json) => {
      ((((m.placements as Json).declared as Json[])[0]!.slots as Json[])[2]!).property = "StepSound_1"; }, "slot property"],
  ])("fails loudly on %s", async (_label, mutate, message) => {
    const { records, bytesAtPath } = await fixture(mutate as never);
    serveResourceBytes(bytesAtPath);
    await expect(loadNativeStepSounds(records, signal)).rejects.toThrow(new RegExp(message as string));
  });

  it("rejects altered WAV bytes and duplicate catalog entries", async () => {
    const { records, bytesAtPath } = await fixture();
    serveResourceBytes(path => path.endsWith(".wav") ? encoder.encode("RIFFxWAVE") : bytesAtPath(path));
    await expect(loadNativeStepSounds(records, signal)).rejects.toThrow("hash/length mismatch");
    serveResourceBytes(bytesAtPath);
    await expect(loadNativeStepSounds([records[1], { ...records[1], id: "again" }], signal)).rejects.toThrow("multiple package entries");
  });
});

const root = join(__dirname, "../..");
const catalogPath = join(root, "public/l2/catalog.json");
const staged = existsSync(catalogPath) && (JSON.parse(readFileSync(catalogPath, "utf8")).animationAudio ?? [])
  .some((row: Json) => row.kind === NATIVE_STEPSOUND_PACKAGE_KIND);
describe.skipIf(!staged)("actually staged stepsound.uax package", () => {
  it("loads all 93 original Sounds with Stone's two variants, water/boots separate and eight Wood placement declarations", async () => {
    const records = JSON.parse(readFileSync(catalogPath, "utf8")).animationAudio;
    serveResourceBytes(path => new Uint8Array(readFileSync(join(root, "public", path))));
    const bundle = await loadNativeStepSounds(records, signal);
    const library = bundle.library!;
    expect(library.soundCount).toBe(93); expect(bundle.sounds).toHaveLength(93);
    expect(library.packageSha256).toBe("e4243b4bbcb4cd1dde927e4f4dec45caba5796385ad655855e87bd8572d57f05");
    expect(library.surfaces.get("Stone")!.walk.map(row => row.object)).toEqual(["stepsound.Stone.stone_walk_01", "stepsound.Stone.stone_walk_02"]);
    expect(library.surfaces.get("Grass")!.run.map(row => row.object)).toEqual(["stepsound.Grass.grass_run_01", "stepsound.Grass.grass_run_02", "stepsound.Grass.Grass_Run_03"]);
    expect(library.surfaces.get("Water_Shalow")!.walk.map(row => row.object)).toEqual(["stepsound.water.water_shalow_01", "stepsound.water.water_shalow_02", "stepsound.water.Water_Shalow_03"]);
    expect(library.surfaces.get("Metal")!.walk.at(-1)!.object).toBe("stepsound.Metal.Metal_walk_03");
    expect(library.events.Water_Out.object).toBe("stepsound.water.Water_Out");
    expect(library.boots).toHaveLength(3);
    expect(library.placements.size).toBe(8);
    expect([...library.placements.values()].every(row => row.surface === "Wood" && row.clips.length === 3)).toBe(true);
    expect([...library.placements.keys()].map(id => Number(id.split("StaticMeshActor")[1])).sort((a, b) => a - b))
      .toEqual([918, 921, 924, 927, 930, 1910, 1911, 1912]);
    for (const placement of library.placements.values()) {
      expect(placement.slots.map(slot => [slot.property, slot.clip.object])).toEqual([["StepSound_1", "stepsound.Wood.wood_walk_01"],
        ["StepSound_2", "stepsound.Wood.wood_walk_02"], ["StepSound_3", "stepsound.Wood.Wood_Walk_03"]]);
    }
    expect(library.sectionManifestSha256).toBe("2e73654e644bfe983021fbe5fdce01a907ac94c288702b4b7df77b4f74ee8d8a");
  });
});
