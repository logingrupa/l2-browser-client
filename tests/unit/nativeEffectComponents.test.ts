import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { effectFrames, loadNativeEffectComponents, parseEffectManifest, type EffectManifest, type EffectResource } from "../../src/effects/nativeEffectComponents";

const retainedSourceDerivedStageDirectory = resolve("artifacts/native-parity/research/native-power-strike-components-20261107/staging/output/82e36ae7305abade2520dba335839c7422d878e6c07caa95323b47f7626f0afd");
const retainedManifestPath = resolve(retainedSourceDerivedStageDirectory, "manifest.json");
const retainedResearchOutputPresent = existsSync(retainedManifestPath);
const retainedResearchOutputAbsentReason = `needs the gitignored retained Power Strike research output at ${retainedManifestPath}`;
let retainedBytes: Uint8Array;
let retained: EffectManifest;
beforeAll(async () => {
  if (!retainedResearchOutputPresent) return;
  retainedBytes = new Uint8Array(await readFile(retainedManifestPath));
  retained = JSON.parse(new TextDecoder().decode(retainedBytes)) as EffectManifest;
});
beforeEach(context => { context.skip(!retainedResearchOutputPresent, retainedResearchOutputAbsentReason); });
const targetId = "interlude:skill:3:level:1:raw-source-dispatch";
const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const encodeJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const copyRetainedManifest = () => structuredClone(retained);
const liveSignal = () => new AbortController().signal;

function retainedCatalogEntry(bytes: Uint8Array = retainedBytes) {
  const manifestSha256 = sha256Hex(bytes);
  return { id: targetId, manifestSha256, manifest: `/l2/effects/${manifestSha256}/manifest.json` };
}
function serveFetchedFiles(files: Map<string, Uint8Array>) {
  const fetcher = vi.fn(async (url: string, _options?: RequestInit) => {
    const bytes = files.get(url);
    if (!bytes) throw Error(`Unexpected request: ${url}`);
    return new Response(bytes.slice().buffer);
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function loadServedEffectComponents(options: { protocol?: string; bytes?: Uint8Array; catalog?: Record<string, unknown> } = {}) {
  vi.stubGlobal("location", { protocol: options.protocol ?? "https:" });
  const bytes = options.bytes ?? retainedBytes, entry = retainedCatalogEntry(bytes), prefix = options.protocol === "file:" ? "" : "/";
  const files = new Map<string, Uint8Array>([
    [`${prefix}l2/catalog.json`, encodeJson(options.catalog ?? { schemaVersion: 1, models: [], effectComponents: [entry] })],
    [`${prefix}${entry.manifest.slice(1)}`, bytes],
  ]);
  const fetcher = serveFetchedFiles(files), bundle = await loadNativeEffectComponents(liveSignal());
  return { entry, files, fetcher, bundle, prefix };
}
const chargeMeshComponent = (manifest: EffectManifest) => manifest.components.find(component => component.bindings.mesh?.object.endsWith("skill_charge01"))!;
const primitiveTexture = (manifest: EffectManifest) => manifest.resources[chargeMeshComponent(manifest).bindings.primitiveMaterials[0]!.textureResourceKey]!;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("effect manifest source identity and primitive routing", () => {
  it("accepts the exact retained six components without changing source order or properties", () => {
    const raw = copyRetainedManifest(), before = structuredClone(raw), parsed = parseEffectManifest(raw);
    expect(raw).toEqual(before); expect(parsed.components).toHaveLength(6); expect(Object.keys(parsed.resources)).toHaveLength(13);
    expect(parsed.actors.map(actor => actor.dispatchStages)).toEqual([["shot"], ["init"]]);
    expect(parsed.components.map(component => [component.actor, component.emitterOrdinal])).toEqual([
      ["lineageeffect.p_u004_a", 0], ["lineageeffect.p_u004_a", 1], ["lineageeffect.p_u004_a", 2],
      ["lineageeffect.s_u002_a", 0], ["lineageeffect.s_u002_a", 1], ["lineageeffect.s_u002_a", 2],
    ]);
    expect(parsed.components.every(component => /^\/effects\/\d+\/children\/\d+$/.test(component.sourcePointer))).toBe(true);
  });
  it("uses the mesh primitive's exact texture identity and retains inherited Engine.S_Emitter only as source data", () => {
    const manifest = parseEffectManifest(copyRetainedManifest()), component = chargeMeshComponent(manifest), texture = primitiveTexture(manifest);
    expect(component.effectiveProperties.Texture).toEqual({ class: "Texture", object: "Engine.S_Emitter" });
    expect(component.bindings.texture).toBeNull(); expect(texture.object).toBe("LineageEffectsTextures.Spark.fx_m_t0042");
    expect(component.bindings.primitiveMaterials[0]).toMatchObject({ meshIndex: 0, primitiveIndex: 0, materialIndex: 0,
      nativeSourceReference: texture.object, textureResourceKey: texture.assetId });
  });
  it.each(["../escape.png", "https://example.invalid/image.png", "resources\\image.png", "resources/../image.png"])("rejects malformed resource path %s", file => {
    const raw = copyRetainedManifest(); Object.values(raw.resources)[0]!.file = file;
    expect(() => parseEffectManifest(raw)).toThrow(/content-addressed resource/);
  });
  it("rejects a component binding that uses a different resource hash", () => {
    const raw = copyRetainedManifest(); raw.components[0]!.bindings.texture!.sha256 = "0".repeat(64);
    expect(() => parseEffectManifest(raw)).toThrow(/mismatched bound resource/);
  });
  it("rejects ambiguous component IDs, ordinals and duplicate primitive coordinates", () => {
    const duplicate = copyRetainedManifest(); duplicate.components.push(structuredClone(duplicate.components[0]!));
    expect(() => parseEffectManifest(duplicate)).toThrow(/component identity/);
    const ordinal = copyRetainedManifest(); ordinal.components[1]!.emitterOrdinal = ordinal.components[0]!.emitterOrdinal;
    expect(() => parseEffectManifest(ordinal)).toThrow(/duplicate emitter ordinal/);
    const primitive = copyRetainedManifest(); primitive.components[1]!.bindings.primitiveMaterials.push(structuredClone(primitive.components[1]!.bindings.primitiveMaterials[0]!));
    expect(() => parseEffectManifest(primitive)).toThrow(/duplicate primitive binding/);
  });
  it("rejects a primitive texture reference to another source object", () => {
    const raw = copyRetainedManifest(); raw.components[1]!.bindings.primitiveMaterials[0]!.nativeSourceReference = "Invented.OtherTexture";
    expect(() => parseEffectManifest(raw)).toThrow(/primitive texture identity differs/);
  });
});

describe("optional effect metadata and lazy resource loading", () => {
  it.each([undefined, [], [{ id: "another-effect", manifest: "/l2/unused/manifest.json" }]])("keeps an absent selected optional bundle absent without requesting payloads", async entries => {
    const { bundle, fetcher } = await loadServedEffectComponents({ catalog: { schemaVersion: 1, models: [], effectComponents: entries } });
    expect(bundle).toBeNull(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects duplicate selected catalog IDs before fetching either manifest", async () => {
    const entry = retainedCatalogEntry(), fetcher = serveFetchedFiles(new Map([["/l2/catalog.json", encodeJson({ schemaVersion: 1, models: [], effectComponents: [entry, entry] })]]));
    await expect(loadNativeEffectComponents(liveSignal())).rejects.toThrow(/ambiguous selected effect/);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(["/l2/effects/wrong/manifest.json", "https://example.invalid/manifest.json", "/l2/effects/../manifest.json"])("rejects selected manifest path %s before a payload request", async path => {
    const entry = { ...retainedCatalogEntry(), manifest: path }, fetcher = serveFetchedFiles(new Map([["/l2/catalog.json", encodeJson({ schemaVersion: 1, models: [], effectComponents: [entry] })]]));
    await expect(loadNativeEffectComponents(liveSignal())).rejects.toThrow(/invalid manifest path/);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(["https:", "file:"])("loads only metadata until a verified resource is requested under %s", async protocol => {
    const { bundle, fetcher, files, entry, prefix } = await loadServedEffectComponents({ protocol }); expect(bundle).not.toBeNull();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${prefix}l2/catalog.json`, `${prefix}${entry.manifest.slice(1)}`]);
    const resource = Object.values(bundle!.manifest.resources).find(row => row.file.endsWith(".png"))!;
    const bytes = new Uint8Array(await readFile(resolve(retainedSourceDerivedStageDirectory, resource.file)));
    const request = `${prefix}l2/effects/${bundle!.manifestSha256}/${resource.file}`; files.set(request, bytes);
    expect(await bundle!.readResource(resource, liveSignal())).toEqual(bytes);
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(request);
  });
  it("rejects changed manifest bytes and an independently hashed wrong bundle ID", async () => {
    const entry = retainedCatalogEntry(), corrupt = retainedBytes.slice(); corrupt[corrupt.length - 2] = corrupt[corrupt.length - 2]! ^ 1;
    serveFetchedFiles(new Map([["/l2/catalog.json", encodeJson({ schemaVersion: 1, models: [], effectComponents: [entry] })], [entry.manifest, corrupt]]));
    await expect(loadNativeEffectComponents(liveSignal())).rejects.toThrow(/content differs/);
    const wrong = copyRetainedManifest(); wrong.id = "different-source-effect";
    await expect(loadServedEffectComponents({ bytes: encodeJson(wrong) })).rejects.toThrow(/bundle identity differs/);
  });
  it("rejects a corrupted requested payload even when its byte length matches", async () => {
    const { bundle, files } = await loadServedEffectComponents(), resource = Object.values(bundle!.manifest.resources).find(row => row.file.endsWith(".png"))!;
    files.set(`/l2/effects/${bundle!.manifestSha256}/${resource.file}`, new Uint8Array(resource.bytes));
    await expect(bundle!.readResource(resource, liveSignal())).rejects.toThrow(/content differs/);
  });
  it("rejects a forged source-object descriptor before fetching bytes, even if the payload hash/path are owned", async () => {
    const { bundle, files, fetcher } = await loadServedEffectComponents(), canonical = Object.values(bundle!.manifest.resources).find(row => row.file.endsWith(".png"))!;
    files.set(`/l2/effects/${bundle!.manifestSha256}/${canonical.file}`, new Uint8Array(await readFile(resolve(retainedSourceDerivedStageDirectory, canonical.file))));
    const forged: EffectResource = { ...canonical, object: "Invented.SubstitutedSource" };
    const before = fetcher.mock.calls.length;
    await expect(Promise.resolve().then(() => bundle!.readResource(forged, liveSignal())).then(() => "unexpected accepted source identity"))
      .rejects.toThrow(/owned|identity|resource/);
    expect(fetcher).toHaveBeenCalledTimes(before);
  });
  it("does not fetch an already-aborted request", async () => {
    const fetcher = serveFetchedFiles(new Map()), controller = new AbortController(), reason = Error("stale selection"); controller.abort(reason);
    await expect(loadNativeEffectComponents(controller.signal)).rejects.toBe(reason); expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a stale aborted catalog body even when the optional bundle is absent", async () => {
    const controller = new AbortController(), reason = Error("replaced scene");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => {
      controller.abort(reason); return new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, models: [] })).buffer;
    } })));
    await expect(loadNativeEffectComponents(controller.signal)).rejects.toBe(reason);
  });
  it("rejects a resource body that completes after cancellation without publishing stale bytes", async () => {
    const { bundle } = await loadServedEffectComponents(), resource = Object.values(bundle!.manifest.resources).find(row => row.file.endsWith(".png"))!;
    const bytes = new Uint8Array(await readFile(resolve(retainedSourceDerivedStageDirectory, resource.file))), controller = new AbortController(), reason = Error("component disposed");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => { controller.abort(reason); return bytes.buffer; } })));
    await expect(bundle!.readResource(resource, controller.signal)).rejects.toBe(reason);
  });
});

describe("manual source frames and explicitly labeled atlas inspection", () => {
  it("selects only atlas tiles 2 and 3 with explicit row-major UVs", () => {
    const manifest = parseEffectManifest(copyRetainedManifest()), component = manifest.components[0]!, before = structuredClone(component.effectiveProperties);
    const frames = effectFrames(manifest, component, component.bindings.texture!);
    expect(frames.map(frame => ({ tile: frame.sourceTile, scale: frame.uvScale, offset: frame.uvOffset }))).toEqual([
      { tile: 2, scale: [0.5, 0.5], offset: [0, 0.5] }, { tile: 3, scale: [0.5, 0.5], offset: [0.5, 0.5] },
    ]);
    expect(component.effectiveProperties).toEqual(before);
  });
  it("retains the exact four-frame charge chain and stops without inferring a loop or playback clock", () => {
    const manifest = parseEffectManifest(copyRetainedManifest()), component = chargeMeshComponent(manifest), before = structuredClone(manifest.textureGraph);
    const frames = effectFrames(manifest, component, primitiveTexture(manifest));
    expect(frames.map(frame => frame.texture.object)).toEqual([42, 43, 44, 45].map(number => `LineageEffectsTextures.Spark.fx_m_t00${number}`));
    expect(frames.every(frame => frame.sourceTile === null && frame.uvScale.join() === "1,1" && frame.uvOffset.join() === "0,0")).toBe(true);
    expect(manifest.textureGraph).toEqual(before);
  });
  it("rejects explicit cyclic, missing and malformed AnimNext links", () => {
    for (const value of [{ object: "LineageEffectsTextures.Spark.fx_m_t0042" }, { object: "Missing.Frame" }, "bad-reference"]) {
      const raw = copyRetainedManifest(), last = raw.textureGraph.find(row => row.object.endsWith("fx_m_t0045"))!; last.animationProperties.AnimNext = value;
      const manifest = parseEffectManifest(raw);
      expect(() => effectFrames(manifest, chargeMeshComponent(manifest), primitiveTexture(manifest))).toThrow(/cyclic|missing|invalid AnimNext/);
    }
  });
  it("rejects duplicate full source-object frame identities rather than choosing one", () => {
    const raw = copyRetainedManifest(), original = Object.values(raw.resources).find(row => row.object.endsWith("fx_m_t0043"))!;
    raw.resources["interlude:ambiguous-frame"] = { ...original, assetId: "interlude:ambiguous-frame" };
    const manifest = parseEffectManifest(raw);
    expect(() => effectFrames(manifest, chargeMeshComponent(manifest), primitiveTexture(manifest))).toThrow(/ambiguous AnimNext/);
  });
  it.each([{ TextureUSubdivisions: 0 }, { TextureVSubdivisions: 0.5 }, { TextureUSubdivisions: 65 }, { SubdivisionStart: -1 }, { SubdivisionEnd: 4 }, { SubdivisionEnd: 1 }])("rejects unsupported atlas values %j", patch => {
    const manifest = parseEffectManifest(copyRetainedManifest()), component = manifest.components[0]!;
    Object.assign(component.effectiveProperties, patch);
    expect(() => effectFrames(manifest, component, component.bindings.texture!)).toThrow(/atlas/);
  });
  it("rejects combined atlas and texture-chain selection instead of guessing which takes precedence", () => {
    const manifest = parseEffectManifest(copyRetainedManifest()), component = chargeMeshComponent(manifest); component.effectiveProperties.TextureUSubdivisions = 2;
    expect(() => effectFrames(manifest, component, primitiveTexture(manifest))).toThrow(/combined atlas and texture animation/);
  });
});
