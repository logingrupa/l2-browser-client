import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

interface Resource { file: string; sha256: string; bytes: number; }
export interface NativeTerrainPatch {
  id: string;
  sourceTerrain: string;
  sourceSector: string;
  sourceMapSha256: string;
  gridBounds: [number, number, number, number];
  model: Resource;
  source: Resource;
}

const hash = /^[a-f0-9]{64}$/;
const sector = "20_20.TerrainInfo0.TerrainSector247";
const mapHash = "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4";
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
interface TerrainLayerBinding { index: number; texture: string; alphaMap: string; worldToTextureRowMajor: number[][]; }

/** Compare everything consumed by the current terrain preview while keeping
 * each mesh's separate source/qualification provenance intact. */
export function terrainMaterialBindingKey(layers: readonly TerrainLayerBinding[]): string {
  return JSON.stringify(layers.map(layer => [layer.index, layer.texture, layer.alphaMap, layer.worldToTextureRowMajor]));
}
function resource(value: unknown, file: string): value is Resource {
  return object(value) && value.file === file && typeof value.sha256 === "string" && hash.test(value.sha256) &&
    typeof value.bytes === "number" && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= 32 * 1024 * 1024;
}

/** A bounded manifest relationship. This does not generate or qualify UVs. */
export function parseNativeTerrainPatches(input: unknown): NativeTerrainPatch[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length !== 1) throw Error("Native terrain patch scope is unsupported.");
  const patch: unknown = input[0];
  if (!object(patch) || patch.id !== `interlude:${sector}` || patch.sourceTerrain !== "20_20.TerrainInfo0" ||
    patch.sourceSector !== sector || patch.sourceMapSha256 !== mapHash || !equal(patch.gridBounds, [112, 240, 128, 255]) ||
    !resource(patch.model, "terrain247.glb") || !resource(patch.source, "terrain247.json")) {
    throw Error("Native terrain patch identity, source or resource is invalid.");
  }
  return input as NativeTerrainPatch[];
}

function patchKey(patch: NativeTerrainPatch) {
  return [patch.id, patch.sourceTerrain, patch.sourceSector, patch.sourceMapSha256, patch.gridBounds,
    patch.model.file, patch.model.sha256, patch.model.bytes, patch.source.file, patch.source.sha256, patch.source.bytes];
}

/** Source imports must retain the explicit qualification and actual grid.
 * Author-authored changes are handled separately and never reset to these data. */
export function validateSourceTerrainPatch(meshes: readonly AbstractMesh[], patch: NativeTerrainPatch): AbstractMesh {
  parseNativeTerrainPatches([patch]);
  if (meshes.length !== 1) throw Error("Native terrain patch must contain one source mesh.");
  const mesh = meshes[0]!;
  const metadata: unknown = mesh.metadata;
  const extras = object(metadata) && object(metadata.gltf) ? metadata.gltf.extras : undefined;
  const qualification = object(extras) ? extras.nativeTerrainCoordinateEvidence : undefined;
  if (!object(extras) || extras.nativeObject !== patch.sourceSector || !equal(extras.nativeGridOffset, [112, 240]) ||
    !equal(extras.nativeGridQuads, [16, 15]) || extras.maskUvSet !== 0 || extras.baseLayerUvSet !== 1 ||
    Object.hasOwn(extras, "offlineTerrainComparison") || !object(qualification) ||
    qualification.nativeSubmittedCoordinatesQualified !== true || qualification.nativeVisiblePixelsQualified !== false ||
    qualification.manifestSha256 !== "47fb702008f6a0f1312e690fc411d3e084980edf1608266bd3cf9b94130a5a49" ||
    qualification.sourceXYZSha256 !== "daacf96c3166e646c1afa299469c9dad05aaf66c35c4aa7d22f5e6597d7bf270") {
    throw Error("Native terrain patch lacks its bounded source-coordinate evidence.");
  }
  if (mesh.getTotalVertices() !== 272 || mesh.getTotalIndices() !== 1440 || mesh.skeleton) {
    throw Error("Native terrain patch geometry differs from its source scope.");
  }
  const positions = mesh.getVerticesData("position"), normals = mesh.getVerticesData("normal");
  const uv = mesh.getVerticesData("uv"), uv2 = mesh.getVerticesData("uv2"), indices = mesh.getIndices();
  if (!positions || !normals || !uv || !uv2 || !indices || normals.length !== 816 || uv.length !== 544 || uv2.length !== 544 ||
    [positions, normals, uv, uv2].some(values => Array.from(values).some(value => !Number.isFinite(value))) ||
    Array.from(indices).some(value => !Number.isInteger(value) || value < 0 || value >= 272)) {
    throw Error("Native terrain patch channels or index bounds are invalid.");
  }
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (!mesh.computeWorldMatrix(true).asArray().every((value, i) => value === identity[i])) {
    throw Error("Native terrain patch must retain absolute source coordinates.");
  }
  for (let i = 0; i < 272; i++) {
    const x = 112 + i % 17, y = 240 + Math.floor(i / 17);
    if (positions[i * 3] !== Math.fround(x * 128 * .01) || positions[i * 3 + 2] !== Math.fround((65536 + y * 128) * .01)) {
      throw Error("Native terrain patch positions differ from their source grid.");
    }
    if (uv[i * 2] !== Math.fround((x + .5) / 256) ||
      uv[i * 2 + 1] !== Math.fround((y + .5) / 256 - Math.max(y - 240, 0) / 4096)) {
      throw Error("Native terrain patch mask coordinates differ from the qualified submitted values.");
    }
  }
  return mesh;
}

/** Validate saved identities without overriding authored geometry/materials/TRS. */
export function validateAuthoredTerrainPatches(meshes: readonly AbstractMesh[], input: unknown): void {
  const patches = parseNativeTerrainPatches(input);
  const marked = meshes.filter(mesh => object(mesh.metadata) && Object.hasOwn(mesh.metadata, "nativeTerrainPatch"));
  if (marked.length !== patches.length) throw Error("Authored terrain patch is missing or undeclared.");
  for (const patch of patches) {
    const matches = marked.filter(mesh => mesh.metadata.nativeTerrainPatch?.id === patch.id);
    if (matches.length !== 1 || matches[0]!.metadata?.worldTerrain !== true) throw Error("Authored terrain patch identity is missing or duplicated.");
    const saved = parseNativeTerrainPatches([matches[0]!.metadata.nativeTerrainPatch])[0]!;
    if (!equal(patchKey(saved), patchKey(patch))) throw Error("Authored terrain patch differs from its source manifest.");
  }
}
