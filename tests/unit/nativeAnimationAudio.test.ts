import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeAnimationAudio } from "../../src/assets/native/loadNativeAnimationAudio";
import { readAssetPackage, sha256, type AssetPackage } from "../../src/assets/package/readAssetPackage";
import { assetFixture, fixtureWav } from "../fixtures/assetPackageFixture";

const encoder = new TextEncoder(), packageHash = "b".repeat(64);
const catalogId = "human-male-fighter:0", otherId = "human-female-fighter:0";
type Document = Record<string, any>;
const duration = 13 / 15;
const references = ["StepSound.Grass.step_01", "StepSound.Grass.step_02"];

async function fixture() {
  const payloads = [fixtureWav(), fixtureWav(), fixtureWav()];
  payloads[1]![45] = 23; payloads[2]![45] = 42;
  const sounds = await Promise.all(payloads.map(async (bytes, i) => {
    const hash = await sha256(bytes);
    return { dependencyId: `fixture:${packageHash}:${i + 1}`, file: `audio/${hash}.wav`, bytes: bytes.length,
      sha256: hash, mime: "audio/wav", source: { packageSha256: packageHash, exportIndex: i + 1,
        object: i < 2 ? references[i]!.toLowerCase() : "StepSound.Other.other_01" } };
  }));
  const arrays: Record<string, string[]> = {};
  for (const surface of ["Default", "DefaultActor", "Grass", "Water"]) for (const gait of ["Walk", "Run"]) {
    arrays[`${surface}${gait}Sound`] = [references[0]!, references[1]!, references[1]!];
  }
  const step = (ordinal: number, normalizedTime: number) => ({ animationSet: "Fixture.Actor_anim", clip: "Run_Fixture",
    object: `Fixture.AnimNotify_Sound${ordinal}`, type: "AnimNotify_Sound", function: "None",
    sourceFrames: 13, sourceRate: 15, normalizedTime, timeSeconds: normalizedTime * duration,
    sound: null, properties: { Volume: 250, Radius: 30, ...structuredClone(arrays) } });
  const events = [
    { clip: "Idle_Fixture", object: "Fixture.UnselectedNotify", timeSeconds: 0 },
    step(1, 0.1538461595773697),
    { ...step(2, 0.1538461595773697), sound: "ChrSound.Fighter.breath_01",
      properties: { Sound: "ChrSound.Fighter.breath_01", Random: 5, Volume: 250, Radius: 30 } },
    step(3, 0.6153846383094788),
  ];
  const source = { edition: "interlude" as const, package: "Fixture", object: "Fixture.Actor", sha256: "a".repeat(64),
    assembly: ["Fixture.Actor", "Fixture.Hair"] };
  const input = await assetFixture("model", { source, animationEvents: structuredClone(events) });
  const asset = await readAssetPackage(input.bytes), archiveHash = await sha256(input.bytes);
  const rowArrays = Object.entries(arrays).map(([property, slots]) => ({ property,
    slots: slots.map((reference, index) => ({ index, reference, dependencyId: sounds[index === 0 ? 0 : 1]!.dependencyId })) }));
  const actor = { catalogId, assetId: asset.manifest.id, archiveSha256: archiveHash, source: structuredClone(source),
    clips: [{ name: "Run_Fixture", gait: "run", frames: 13, rate: 15, durationSeconds: duration }],
    events: events.slice(1).map((event, i) => ({ ordinal: i + 1, manifestPointer: `/animationEvents/${i + 1}`,
      event: structuredClone(event), arrays: i === 1 ? [] : structuredClone(rowArrays) })) };
  const other = structuredClone(actor);
  other.catalogId = otherId; other.assetId = "not-loaded"; other.archiveSha256 = "c".repeat(64);
  other.source.object = "Fixture.OtherActor";
  for (const row of other.events) for (const array of row.arrays) for (const slot of array.slots) {
    slot.reference = "StepSound.Other.other_01"; slot.dependencyId = sounds[2]!.dependencyId;
  }
  const manifest: Document = { schemaVersion: 1, kind: "native-animation-audio-dependencies", actors: [actor, other], sounds };
  const assets = new Map<string, AssetPackage>([[catalogId, asset]]), archiveHashes = new Map([[catalogId, archiveHash]]);
  async function publish() {
    const bytes = encoder.encode(JSON.stringify(manifest)), hash = await sha256(bytes), prefix = `/l2/animation-audio/${hash}/`;
    return { record: { id: "human-fighter-footsteps", manifest: prefix + "manifest.json", manifestSha256: hash, manifestBytes: bytes.length },
      files: new Map([[prefix + "manifest.json", bytes], ...sounds.map((sound, i) => [prefix + sound.file, payloads[i]!] as [string, Uint8Array])]) };
  }
  return { manifest, asset, assets, archiveHashes, sounds, payloads, publish };
}

function serve(files: Map<string, Uint8Array>, hook?: (url: string, signal: AbortSignal) => void) {
  const fetcher = vi.fn(async (url: string, options: { signal: AbortSignal }) => {
    hook?.(url, options.signal); options.signal.throwIfAborted();
    const bytes = files.get(url);
    return new Response(bytes ? new Uint8Array(bytes).buffer : "missing", { status: bytes ? 200 : 404 });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("native animation audio source and payload contract", () => {
  it("preserves source ordinals, exact times, ordered arrays and duplicate slots without mutating actors", async () => {
    const input = await fixture(), staged = await input.publish(), before = structuredClone(input.asset.manifest);
    const fetcher = serve(staged.files);
    const result = await loadNativeAnimationAudio([staged.record], input.assets, input.archiveHashes, new AbortController().signal);
    expect(result.definitions).toHaveLength(1);
    const definition = result.definitions[0]!;
    expect(definition.asset).toBe(input.asset); expect(definition.durationSeconds).toBe(duration); expect(definition.gait).toBe("run");
    expect(definition.events.map(event => event.ordinal)).toEqual([1, 3]);
    expect(definition.events.map(event => event.timeSeconds)).toEqual(input.manifest.actors[0].events.filter((row: Document) => row.event.sound === null).map((row: Document) => row.event.timeSeconds));
    expect(Object.keys(definition.events[0]!.arrays)).toHaveLength(8);
    expect(definition.events[0]!.arrays.GrassRunSound?.map(slot => slot.reference)).toEqual([references[0], references[1], references[1]]);
    expect(definition.events[0]!.arrays.GrassRunSound?.[1]).toEqual(definition.events[0]!.arrays.GrassRunSound?.[2]);
    expect(result.sounds).toHaveLength(2); expect(result.sounds[0]!.bytes).toEqual(input.payloads[0]);
    expect(result.retainedConditionalEvents).toBe(1); // Random5 breath stays retained, never admitted as a step.
    expect(result.manifests).toEqual([staged.record.manifestSha256]);
    expect(fetcher.mock.calls.some(([url]) => url.includes(input.sounds[2]!.sha256))).toBe(false);
    expect(input.asset.manifest).toEqual(before);
  });

  it("loads no sounds or definitions for unselected actors", async () => {
    const input = await fixture(), staged = await input.publish(), fetcher = serve(staged.files);
    const result = await loadNativeAnimationAudio([staged.record], new Map(), new Map(), new AbortController().signal);
    expect(result.definitions).toEqual([]); expect(result.sounds).toEqual([]); expect(result.retainedConditionalEvents).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("accepts empty optional records without network work", async () => {
    const fetcher = serve(new Map());
    expect(await loadNativeAnimationAudio(undefined, new Map(), new Map(), new AbortController().signal)).toEqual({
      definitions: [], sounds: [], manifests: [], retainedConditionalEvents: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["https:", "file:"])("uses the bounded resource route in %s", async protocol => {
    vi.stubGlobal("location", { protocol });
    const input = await fixture(), staged = await input.publish();
    const files = new Map([...staged.files].map(([path, bytes]) => [protocol === "file:" ? path.slice(1) : path, bytes]));
    const fetcher = serve(files), signal = new AbortController().signal;
    expect((await loadNativeAnimationAudio([staged.record], input.assets, input.archiveHashes, signal)).sounds).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledWith(protocol === "file:" ? staged.record.manifest.slice(1) : staged.record.manifest, { signal });
  });

  it.each(["assetId", "archiveSha256", "source", "sourceAssembly"])("rejects mismatched actor %s before fetching payloads", async field => {
    const input = await fixture(), actor = input.manifest.actors[0];
    if (field === "source") actor.source.sha256 = "f".repeat(64);
    else if (field === "sourceAssembly") actor.source.assembly.reverse();
    else actor[field] = field === "archiveSha256" ? "f".repeat(64) : "different";
    const staged = await input.publish(), fetcher = serve(staged.files);
    await expect(loadNativeAnimationAudio([staged.record], input.assets, input.archiveHashes, new AbortController().signal)).rejects.toThrow("source/archive mismatch");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("requires an actual archive pin even if both sidecar and archive map omit it", async () => {
    const input = await fixture(); delete input.manifest.actors[0].archiveSha256; input.archiveHashes.delete(catalogId);
    const staged = await input.publish(); serve(staged.files);
    const outcome = await loadNativeAnimationAudio([staged.record], input.assets, input.archiveHashes, new AbortController().signal)
      .then(() => "accepted", error => error instanceof Error ? "rejected" : "unexpected-error");
    expect(outcome).toBe("rejected");
  });

  it.each(["ordinal", "pointer", "raw-time", "array-reference", "array-order", "missing-array", "missing-event", "duplicate-event", "leaf-alias"])("rejects %s instead of silently adapting source data", async change => {
    const input = await fixture(), actor = input.manifest.actors[0], row = actor.events[0];
    if (change === "ordinal") row.ordinal = 0;
    if (change === "pointer") row.manifestPointer = "/animationEvents/3";
    if (change === "raw-time") row.event.timeSeconds += .001;
    if (change === "array-reference") row.arrays[0].slots[0].reference = "StepSound.Else.step_01";
    if (change === "array-order") row.arrays[0].slots.reverse();
    if (change === "missing-array") row.arrays.pop();
    if (change === "missing-event") actor.events.splice(1, 1); // Losing conditional breath is also forbidden.
    if (change === "duplicate-event") actor.events.push(structuredClone(row));
    if (change === "leaf-alias") input.manifest.sounds[0].source.object = "StepSound.step_01";
    const staged = await input.publish(), fetcher = serve(staged.files);
    await expect(loadNativeAnimationAudio([staged.record], input.assets, input.archiveHashes, new AbortController().signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["hash", "length", "path", "hash-shape", "oversize"])("rejects manifest %s corruption", async field => {
    const input = await fixture(), staged = await input.publish(), record = { ...staged.record };
    if (field === "hash") { const bytes = staged.files.get(record.manifest)!; bytes[10] = bytes[10]! ^ 1; }
    if (field === "length") record.manifestBytes++;
    if (field === "path") record.manifest = "/l2/animation-audio/../manifest.json";
    if (field === "hash-shape") record.manifestSha256 = "g".repeat(64);
    if (field === "oversize") record.manifestBytes = 8_000_001;
    const fetcher = serve(staged.files);
    await expect(loadNativeAnimationAudio([record], input.assets, input.archiveHashes, new AbortController().signal)).rejects.toThrow();
    if (["path", "hash-shape", "oversize"].includes(field)) expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["bytes", "hash", "path", "missing", "descriptor-size", "duplicate-dependency"])("rejects payload %s and never returns partial definitions", async field => {
    const input = await fixture();
    if (field === "path") input.manifest.sounds[0].file = "../private.wav";
    if (field === "descriptor-size") input.manifest.sounds[0].bytes = 8_000_001;
    if (field === "duplicate-dependency") input.manifest.sounds.push(structuredClone(input.manifest.sounds[0]));
    const staged = await input.publish(), path = [...staged.files.keys()].find(path => path.endsWith(input.sounds[1]!.file))!;
    if (field === "bytes") staged.files.set(path, new Uint8Array([1]));
    if (field === "hash") { const bytes = staged.files.get(path)!; bytes[45] = bytes[45]! ^ 1; }
    if (field === "missing") staged.files.delete(path);
    serve(staged.files); let returned: unknown;
    await expect(loadNativeAnimationAudio([staged.record], input.assets, input.archiveHashes, new AbortController().signal).then(value => { returned = value; })).rejects.toThrow();
    expect(returned).toBeUndefined();
  });

  it.each(["before", "manifest", "payload"])("propagates cancellation %s without returning partial data", async when => {
    const input = await fixture(), staged = await input.publish(), controller = new AbortController();
    if (when === "before") controller.abort();
    serve(staged.files, url => { if (when === "manifest" && url.endsWith("manifest.json") || when === "payload" && url.endsWith(".wav")) controller.abort(); });
    await expect(loadNativeAnimationAudio([staged.record], input.assets, input.archiveHashes, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects duplicated selected actors and bundle identities", async () => {
    const input = await fixture(); input.manifest.actors.push(structuredClone(input.manifest.actors[0]));
    let staged = await input.publish(); serve(staged.files);
    await expect(loadNativeAnimationAudio([staged.record], input.assets, input.archiveHashes, new AbortController().signal)).rejects.toThrow("actor is duplicated");
    input.manifest.actors.pop(); staged = await input.publish(); serve(staged.files);
    await expect(loadNativeAnimationAudio([staged.record, staged.record], input.assets, input.archiveHashes, new AbortController().signal)).rejects.toThrow("catalog entry");
  });
});
