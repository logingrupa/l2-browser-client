import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readAssetPackage, sha256, type AssetPackage } from "../../src/assets/package/readAssetPackage";
import { prepareNativeFlameGraph } from "../../src/scene/world/nativeMaterialGraph";

const archiveHash = "2bcf55b30efff7acfd0ea351549f94cc40f7f404d5f86d0f97ac86831f1376ed";
const archivePath = resolve("public/l2/maps/062218e6dc1c887e5018489f69b1faaed571b519d937cc0d7c7c9b8c1474e2c2/map-section-models", archiveHash, "asset.l2asset");
const graphPath = "native-materials/graph.json", prefix = "FX_E_T.Flameset.";
const dxt5ArchiveHash = "3cb81f693ad730cc4496da88f0ca8bc6e6998f214b0237240f5bca0fddd8f10b";
const dxt5ArchivePaths = [
  resolve("artifacts/native-parity/research/flame-runtime/texture-dxt5/archives", dxt5ArchiveHash, "asset.l2asset"),
  resolve("artifacts/native-parity/migration-dxt5/sections/map-20-20-section/map-section-models", dxt5ArchiveHash, "asset.l2asset"),
];
interface FixtureNode {
  source: { object: string; sourceOffset: number };
  properties: Record<string, unknown> & { Color1?: { unparsedHex: string } };
  propertyTags: { name: string; value?: unknown; payloadHex: string; payloadOffset: number }[];
  rawExport: { file: string; sha256: string };
  image?: { file: string; sha256: string };
  nativeTextureSource?: { manifest: string };
}
interface FixtureGraph {
  sourceMesh: string; roots: { object: string; slot: number }[];
  nodes: FixtureNode[]; edges: unknown[]; classDefinitions: string[];
}
interface FixtureClass { properties: Record<string, unknown>; effectiveProperties: Record<string, unknown>; }
interface FixtureTextureSource { mips: { width: number }[]; }

it("rejects unrelated asset identities without resources or side effects", async () => {
  const asset = { manifest: { id: "interlude:Other.Mesh", kind: "model", source: { object: "Other.Mesh" } }, files: new Map() } as unknown as AssetPackage;
  await expect(prepareNativeFlameGraph(asset)).rejects.toThrow("model source identity");
  expect(asset.files.size).toBe(0);
});

describe.skipIf(!dxt5ArchivePaths.some(existsSync))("preserved DXT5 flame archive", () => {
  it("accepts both isolated and migration 250-entry products and checks 16-byte BC3 blocks against source bytes", async () => {
    for (const path of dxt5ArchivePaths.filter(existsSync)) {
      const bytes = new Uint8Array(readFileSync(path)); expect(await sha256(bytes)).toBe(dxt5ArchiveHash);
      const asset = await readAssetPackage(bytes), plan = await prepareNativeFlameGraph(asset);
      expect(plan.resources.size).toBe(249); expect(plan.glow.mips).toHaveLength(7);
      expect(plan.glow.dds?.sha256).toBe("4552b21ffb4332984ee48e48cf4f924ba7e60ec0c3fcfea4d3bca9f18e39a547");
      expect(plan.glow.mips.reduce((sum, mip) => sum + mip.bytes, 0)).toBe(10944);
      expect(plan.glow.rawExport.sha256).toBe("461b829f8c02a25a467d7cdca18791b55e9a8273534ea58b783dca685f118c98");
      for (const mip of plan.glow.mips) expect(mip.bytes).toBe(Math.max(1, Math.ceil(mip.width / 4)) * Math.max(1, Math.ceil(mip.height / 4)) * 16);
      for (const frame of plan.animation.frames) for (const mip of frame.mips) expect(mip.bytes).toBe(Math.max(1, Math.ceil(mip.width / 4)) * Math.max(1, Math.ceil(mip.height / 4)) * 8);
    }
  });
});

// The local archive is deliberately not copied into tracked tests. It is small,
// hash-pinned source evidence, and these integration cases skip when unstaged.
describe.skipIf(!existsSync(archivePath))("verified retained flame graph", () => {
  let baseline: AssetPackage;
  beforeAll(async () => {
    const bytes = new Uint8Array(readFileSync(archivePath));
    expect(await sha256(bytes)).toBe(archiveHash);
    baseline = await readAssetPackage(bytes);
  });
  const fixture = () => structuredClone(baseline);
  const decode = <T = FixtureGraph>(asset: AssetPackage, path = graphPath): T => JSON.parse(new TextDecoder().decode(asset.files.get(path)!)) as T;
  async function replace(asset: AssetPackage, path: string, bytes: Uint8Array) {
    (asset.files as Map<string, Uint8Array>).set(path, bytes);
    const file = asset.manifest.files.find(file => file.path === path)!;
    file.bytes = bytes.length; file.sha256 = await sha256(bytes);
  }
  const encode = async (asset: AssetPackage, value: object, path = graphPath) => replace(asset, path, new TextEncoder().encode(JSON.stringify(value)));
  const find = (graph: FixtureGraph, name: string): FixtureNode => graph.nodes.find(node => node.source.object === `${prefix}${name}`)!;

  it("preserves source rates, colors, inherited zeros, graph provenance and resources", async () => {
    const plan = await prepareNativeFlameGraph(baseline);
    expect(plan.graph.sha256).toBe("1702733599017c419303bf55b1ae39d4c3d486b2d5cf7a0aed4788f0f9fa4deb");
    expect(plan.billboard).toBe(true);
    expect(plan.shaders.map(shader => [shader.slot, shader.outputBlending, shader.twoSided, shader.zWrite, shader.alphaTest, shader.alphaRef]))
      .toEqual([[0, 5, true, false, false, 0], [1, 3, false, false, false, 0]]);
    expect(plan.animation).toMatchObject({ minFrameRate: 25, maxFrameRate: 30, totalFrameNum: 16 });
    expect(plan.animation.frames.map(frame => frame.object)).toEqual(Array.from({ length: 16 }, (_, index) => `${prefix}de_fire_${String(index).padStart(4, "0")}`));
    for (const frame of plan.animation.frames) {
      expect(frame).toMatchObject({ width: 64, height: 128, format: 3, uClampMode: 0, vClampMode: 0 });
      expect(frame.mips).toHaveLength(7); expect(frame.dds).not.toBeNull();
      expect(plan.resources.get(frame.image.path)?.length).toBe(frame.image.bytes);
    }
    expect(plan.fade).toMatchObject({ color1: { bgraHex: "151b3100", rgbaBytes: [49, 27, 21, 0] }, color2: { bgraHex: "2e437c00", rgbaBytes: [124, 67, 46, 0] }, colorFadeType: 1, fadePeriod: 0.4000000059604645, fadePhase: 1 });
    expect(plan.combiner).toMatchObject({ combineOperation: 2, alphaOperation: 0, mask: null, modulate2X: true, modulate4X: false, invertMask: false });
    expect(plan.glow).toMatchObject({ width: 64, height: 128, format: 8, dds: null, mips: [] });
    expect(plan.provenance.classes.size).toBe(9); expect(plan.provenance.nodes.size).toBe(23);
    expect(plan.provenance.graph).toMatchObject({ runtimeImplemented: false, runtimeStatus: "unsupported-diagnostic" });
    expect(plan.provenance.classes.get("Engine.Shader")?.effectiveProperties).toEqual({ DefaultMaterial: { class: "Texture", object: "Engine.DefaultTexture" }, DetailScale: 8 });
    expect(plan.resources.size).toBe(239);
    expect(decode(baseline)).toEqual(plan.provenance.graph);
  });

  it.each(["source", "root", "duplicate", "edge", "class"])("rejects %s identity/dependency mismatches", async target => {
    const asset = fixture(), graph = decode(asset);
    if (target === "source") graph.sourceMesh = "FX_E_S.Other";
    if (target === "root") graph.roots[0]!.object = graph.roots[1]!.object;
    if (target === "duplicate") graph.nodes.push(structuredClone(graph.nodes[0]!));
    if (target === "edge") graph.edges.pop();
    if (target === "class") graph.classDefinitions.pop();
    await encode(asset, graph);
    await expect(prepareNativeFlameGraph(asset)).rejects.toThrow(/identity|root slots|node source|edges differ|class definitions/);
  });

  it("rejects changed class scripts even after the package inventory is refreshed", async () => {
    const asset = fixture(), path = "native-materials/source/classes/Engine.FadeColor.uc";
    await replace(asset, path, new TextEncoder().encode("unreviewed class declaration"));
    await expect(prepareNativeFlameGraph(asset)).rejects.toThrow("resource dependency differs");
  });

  it("checks class defaults against pinned declarations and inheritance", async () => {
    for (const target of ["properties", "effectiveProperties"] as const) {
      const asset = fixture(), path = "native-materials/source/classes/Engine.Shader.json", data = decode<FixtureClass>(asset, path);
      data[target].DetailScale = 0;
      await encode(asset, data, path);
      await expect(prepareNativeFlameGraph(asset)).rejects.toThrow(/class authored defaults|class default inheritance/);
    }
  });

  it("rejects missing bytes, stale inventory hashes and graph resource hashes", async () => {
    for (const kind of ["missing", "corrupt", "descriptor"]) {
      const asset = fixture(), graph = decode(asset), texture = find(graph, "de_fire_0000"), path = texture.image!.file;
      if (kind === "missing") (asset.files as Map<string, Uint8Array>).delete(path);
      if (kind === "corrupt") asset.files.get(path)![0] = 0;
      if (kind === "descriptor") { texture.image!.sha256 = "0".repeat(64); await encode(asset, graph); }
      await expect(prepareNativeFlameGraph(asset)).rejects.toThrow(/inventory differs|hash\/length differs|dependency differs/);
    }
  });

  it("does not accept decoded properties that contradict retained native payloads", async () => {
    const asset = fixture(), graph = decode(asset), texture = find(graph, "de_fire_0000");
    texture.properties.TotalFrameNum = 15;
    texture.propertyTags.find(tag => tag.name === "TotalFrameNum")!.value = 15;
    await encode(asset, graph);
    await expect(prepareNativeFlameGraph(asset)).rejects.toThrow("property value differs");
  });

  it("rejects raw color mismatches and never replaces a source zero alpha", async () => {
    const asset = fixture(), graph = decode(asset), fade = find(graph, "FadeColor0");
    fade.properties.Color1!.unparsedHex = "151b31ff";
    await encode(asset, graph);
    await expect(prepareNativeFlameGraph(asset)).rejects.toThrow("property color differs");
  });

  it("rejects missing AnimNext nodes and changed native mip dependencies", async () => {
    const missing = fixture(), graph = decode(missing);
    graph.nodes = graph.nodes.filter(node => node.source.object !== `${prefix}de_fire_0008`);
    await encode(missing, graph);
    await expect(prepareNativeFlameGraph(missing)).rejects.toThrow("missing source dependency");
    const asset = fixture(), current = decode(asset), texture = find(current, "de_fire_0000"), path = texture.nativeTextureSource!.manifest, metadata = decode<FixtureTextureSource>(asset, path);
    metadata.mips[0]!.width = 32;
    await encode(asset, metadata, path);
    await expect(prepareNativeFlameGraph(asset)).rejects.toThrow("native mip dimensions/order");
  });

  it("rejects an unsupported operation after verifying its native numeric payload", async () => {
    const asset = fixture(), graph = decode(asset), shader = find(graph, "Default_Flame_Final"), tag = shader.propertyTags.find(tag => tag.name === "OutputBlending")!;
    shader.properties.OutputBlending = 6; tag.value = 6; tag.payloadHex = "06";
    const raw = asset.files.get(shader.rawExport.file)!.slice(); raw[tag.payloadOffset - shader.source.sourceOffset] = 6;
    await replace(asset, shader.rawExport.file, raw);
    shader.rawExport.sha256 = await sha256(raw);
    await encode(asset, graph);
    await expect(prepareNativeFlameGraph(asset)).rejects.toThrow("unsupported shader blending operation");
  });

  it("preserves explicit zero phase and explicit false flags without truthy defaults", async () => {
    const asset = fixture(), graph = decode(asset), fade = find(graph, "FadeColor0"), tag = fade.propertyTags.find(tag => tag.name === "FadePhase")!;
    fade.properties.FadePhase = 0; tag.value = 0; tag.payloadHex = "00000000";
    const raw = asset.files.get(fade.rawExport.file)!.slice(); raw.fill(0, tag.payloadOffset - fade.source.sourceOffset, tag.payloadOffset - fade.source.sourceOffset + 4);
    await replace(asset, fade.rawExport.file, raw); fade.rawExport.sha256 = await sha256(raw); await encode(asset, graph);
    const plan = await prepareNativeFlameGraph(asset);
    expect(plan.fade.fadePhase).toBe(0); expect(plan.shaders[1].twoSided).toBe(false);
    expect(plan.combiner.alphaOperation).toBe(0);
  });
});
