import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { parseNativeTerrainPatches, terrainMaterialBindingKey, validateAuthoredTerrainPatches, validateSourceTerrainPatch, type NativeTerrainPatch } from "../../src/scene/world/nativeTerrainPatch";

const scenes: Scene[] = [];
afterEach(() => { for (const scene of scenes.splice(0)) { const engine = scene.getEngine(); scene.dispose(); engine.dispose(); } });
function descriptor(): NativeTerrainPatch {
  return { id: "interlude:20_20.TerrainInfo0.TerrainSector247", sourceTerrain: "20_20.TerrainInfo0",
    sourceSector: "20_20.TerrainInfo0.TerrainSector247",
    sourceMapSha256: "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4",
    gridBounds: [112, 240, 128, 255], model: { file: "terrain247.glb", sha256: "a".repeat(64), bytes: 100 },
    source: { file: "terrain247.json", sha256: "b".repeat(64), bytes: 200 } };
}
function fixture() {
  const scene = new Scene(new NullEngine()); scenes.push(scene); scene.useRightHandedSystem = true;
  const mesh = new Mesh("source patch", scene), positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let y = 240; y <= 255; y++) for (let x = 112; x <= 128; x++) {
    positions.push(Math.fround(x * 1.28), -20, Math.fround((y + 512) * 1.28));
    uv.push((x + .5) / 256, (y + .5) / 256 - Math.max(y - 240, 0) / 4096);
  }
  for (let y = 0; y < 15; y++) for (let x = 0; x < 16; x++) {
    const a = y * 17 + x; indices.push(a, a + 17, a + 1, a + 1, a + 17, a + 18);
  }
  mesh.setVerticesData("position", positions); mesh.setVerticesData("normal", new Float32Array(816));
  mesh.setVerticesData("uv", uv); mesh.setVerticesData("uv2", new Float32Array(544)); mesh.setIndices(indices);
  mesh.metadata = { gltf: { extras: { nativeObject: descriptor().sourceSector, nativeGridOffset: [112, 240], nativeGridQuads: [16, 15],
    maskUvSet: 0, baseLayerUvSet: 1, nativeTerrainCoordinateEvidence: {
      nativeSubmittedCoordinatesQualified: true, nativeVisiblePixelsQualified: false,
      manifestSha256: "47fb702008f6a0f1312e690fc411d3e084980edf1608266bd3cf9b94130a5a49",
      sourceXYZSha256: "daacf96c3166e646c1afa299469c9dad05aaf66c35c4aa7d22f5e6597d7bf270" } } } };
  return { mesh, scene, patch: descriptor() };
}

describe("bounded adjacent terrain relationships", () => {
  it("shares only identical consumed layer bindings without rewriting separate provenance", () => {
    const original = [{ index: 0, texture: "source.diffuse", alphaMap: "source.mask", worldToTextureRowMajor: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], provenance: "original section" }];
    const adjacent = structuredClone(original); adjacent[0]!.provenance = "additional qualified coordinates";
    expect(terrainMaterialBindingKey(adjacent)).toBe(terrainMaterialBindingKey(original));
    expect(adjacent[0]!.provenance).toBe("additional qualified coordinates");
    adjacent[0]!.worldToTextureRowMajor[3]![0] = 1;
    expect(terrainMaterialBindingKey(adjacent)).not.toBe(terrainMaterialBindingKey(original));
  });
  it("keeps historical manifests valid and rejects wider, duplicate or escaping patch resources", () => {
    expect(parseNativeTerrainPatches(undefined)).toEqual([]);
    const patch = descriptor(); expect(parseNativeTerrainPatches([patch])).toEqual([patch]);
    expect(() => parseNativeTerrainPatches([patch, patch])).toThrow(/scope/);
    expect(() => parseNativeTerrainPatches([{ ...patch, gridBounds: [112, 240, 129, 255] }])).toThrow(/identity/);
    expect(() => parseNativeTerrainPatches([{ ...patch, model: { ...patch.model, file: "../terrain247.glb" } }])).toThrow(/resource/);
    expect(() => parseNativeTerrainPatches([{ ...patch, sourceMapSha256: "c".repeat(64) }])).toThrow(/source/);
  });
  it("accepts supplied mask values without changing either UV channel", () => {
    const { mesh, patch } = fixture();
    const uv = [...mesh.getVerticesData("uv")!], uv2 = [...mesh.getVerticesData("uv2")!];
    expect(validateSourceTerrainPatch([mesh], patch)).toBe(mesh);
    expect([...mesh.getVerticesData("uv")!]).toEqual(uv); expect([...mesh.getVerticesData("uv2")!]).toEqual(uv2);
    expect(uv[37]).toBe(0.943115234375); expect(uv[543]).toBe(0.994384765625);
  });
  it("rejects ordinary or twice-corrected values rather than repairing at runtime", () => {
    const { mesh, patch } = fixture(), uv = [...mesh.getVerticesData("uv")!];
    uv[37] = 0.943359375; mesh.setVerticesData("uv", uv);
    expect(() => validateSourceTerrainPatch([mesh], patch)).toThrow(/mask coordinates/);
    uv[37] = 0.94287109375; mesh.setVerticesData("uv", uv);
    expect(() => validateSourceTerrainPatch([mesh], patch)).toThrow(/mask coordinates/);
  });
  it("refuses unqualified candidates, absent UV2 and rebased source geometry", () => {
    const { mesh, patch } = fixture(); mesh.metadata.gltf.extras.offlineTerrainComparison = {};
    expect(() => validateSourceTerrainPatch([mesh], patch)).toThrow(/evidence/);
    delete mesh.metadata.gltf.extras.offlineTerrainComparison;
    mesh.position.x = 1; expect(() => validateSourceTerrainPatch([mesh], patch)).toThrow(/absolute/);
    mesh.position.x = 0; mesh.removeVerticesData("uv2");
    expect(() => validateSourceTerrainPatch([mesh], patch)).toThrow(/channels/);
  });
  it("checks saved patch membership while preserving author geometry, transform and material edits", () => {
    const { mesh, patch } = fixture();
    mesh.metadata.nativeTerrainPatch = patch; mesh.metadata.worldTerrain = true;
    mesh.position.set(3, 2, 1); mesh.scaling.set(2, 3, 4); const original = mesh.metadata;
    expect(() => validateAuthoredTerrainPatches([mesh], [patch])).not.toThrow();
    expect(mesh.position.asArray()).toEqual([3, 2, 1]); expect(mesh.scaling.asArray()).toEqual([2, 3, 4]);
    expect(mesh.metadata).toBe(original);
    expect(() => validateAuthoredTerrainPatches([], [patch])).toThrow(/missing/);
    expect(() => validateAuthoredTerrainPatches([mesh], undefined)).toThrow(/undeclared/);
    mesh.metadata.nativeTerrainPatch = { ...patch, model: { ...patch.model, sha256: "d".repeat(64) } };
    expect(() => validateAuthoredTerrainPatches([mesh], [patch])).toThrow(/manifest/);
  });
});
