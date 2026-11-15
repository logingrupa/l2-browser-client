import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeAnimationAudio } from "../../src/assets/native/loadNativeAnimationAudio";
import { resolveNativeLocomotionClips } from "../../src/assets/native/nativeLocomotion";
import { readAssetPackage } from "../../src/assets/package/readAssetPackage";

const root = join(__dirname, "../..");
const catalogPath = join(root, "public/l2/catalog.json");
type CatalogRow = { id: string; archive: string; archiveSha256: string };
const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, "utf8")) as
  { animationAudio?: { id: string }[]; models: CatalogRow[] } : null;
const mysticFootstepBundleStaged = Boolean(catalog?.animationAudio?.some(row => row.id === "human-mystic-footsteps"));

afterEach(() => { vi.unstubAllGlobals(); });

describe.skipIf(!mysticFootstepBundleStaged)("staged mystic footstep notifies", () => {
  it.each([
    ["human-male-mystic:0", "MMagic", [.10666667222976685, .47333331108093263], [.15833333134651184, .5416666467984518]],
    ["human-female-mystic:0", "FMagic", [.09060605987906456, .4390909016132355], [.16666666915019354, .5416666467984518]],
  ])("%s walks and runs with its own original step times and the shared StepSound arrays", async (catalogId, cls, walkTimes, runTimes) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = join(root, "public", url);
      return existsSync(path) ? new Response(new Uint8Array(readFileSync(path)).buffer) : new Response("missing", { status: 404 });
    }));
    const row = catalog!.models.find(model => model.id === catalogId)!;
    const asset = await readAssetPackage(new Uint8Array(readFileSync(join(root, "public", row.archive))));
    const result = await loadNativeAnimationAudio(catalog!.animationAudio, new Map([[catalogId, asset]]),
      new Map([[catalogId, row.archiveSha256]]), new AbortController().signal);
    expect(result.definitions.map(definition => [definition.clip, definition.gait])).toEqual([[`Walk_Hand_${cls}`, "walk"], [`Run_Hand_${cls}`, "run"]]);
    const [walk, run] = result.definitions;
    expect(walk!.events.map(event => event.timeSeconds)).toEqual(walkTimes);
    expect(run!.events.map(event => event.timeSeconds)).toEqual(runTimes);
    expect(Object.keys(run!.events[0]!.arrays).sort()).toEqual(["DefaultActorRunSound", "DefaultActorWalkSound", "DefaultRunSound",
      "DefaultWalkSound", "GrassRunSound", "GrassWalkSound", "WaterRunSound", "WaterWalkSound"]);
    expect(run!.events[0]!.arrays.DefaultRunSound!.map(slot => slot.reference))
      .toEqual(["StepSound.Default.default_run_01", "StepSound.Default.default_run_02", "StepSound.Default.Default_Run_03"]);
    const runClipBreathNotifyKeptAsDirectCue = 1;
    expect(result.retainedConditionalEvents).toBe(runClipBreathNotifyKeptAsDirectCue);
    expect(result.sounds).toHaveLength(20);
    expect(resolveNativeLocomotionClips(asset, `Run_Hand_${cls}`, result.definitions, `Walk_Hand_${cls}`))
      .toMatchObject({ walkClip: `Walk_Hand_${cls}`, walkSource: "footstep-pair", reason: null });
  });
});
