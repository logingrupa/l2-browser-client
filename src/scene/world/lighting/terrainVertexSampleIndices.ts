export type TerrainVertexSampleIndices =
  | { readonly status: "keyed"; readonly sampleIndices: Int32Array }
  | { readonly status: "gap"; readonly reason: string };

export const terrainSampleKeysUnstagedReason = "terrain-sample-keys-unstaged";
const terrainSampleKeysInvalidPrefix = "terrain-sample-keys-invalid:";
const terrainSampleOutsideMapPrefix = "terrain-sample-outside-intensity-map:";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isCountPair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(isCount);

function gltfExtrasOf(metadata: unknown): Record<string, unknown> | null {
  if (!isRecord(metadata) || !isRecord(metadata.gltf) || !isRecord(metadata.gltf.extras)) return null;
  return metadata.gltf.extras;
}

function sampleGridKeys(grid: unknown): (readonly [number, number])[] | null {
  if (!isRecord(grid) || !isCountPair(grid.offset) || !isCountPair(grid.quads)) return null;
  const [originColumn, originRow] = grid.offset, [quadColumns, quadRows] = grid.quads;
  const keys: [number, number][] = [];
  for (let row = originRow; row <= originRow + quadRows; row += 1) for (let column = originColumn; column <= originColumn + quadColumns; column += 1) keys.push([column, row]);
  return keys;
}

export function terrainVertexSampleIndices(meshName: string, metadata: unknown, vertexCount: number, mapWidth: number, mapHeight: number): TerrainVertexSampleIndices {
  const extras = gltfExtrasOf(metadata);
  if (extras === null || !("nativeSampleGrid" in extras) || !("seamSampleKeys" in extras)) return { status: "gap", reason: terrainSampleKeysUnstagedReason };
  const gridKeys = sampleGridKeys(extras.nativeSampleGrid), seamKeys = extras.seamSampleKeys;
  if (gridKeys === null || !Array.isArray(seamKeys) || !seamKeys.every(isCountPair) || gridKeys.length + seamKeys.length !== vertexCount) {
    return { status: "gap", reason: `${terrainSampleKeysInvalidPrefix}${meshName}` };
  }
  const sampleIndices = new Int32Array(vertexCount);
  for (const [vertex, [column, row]] of [...gridKeys, ...(seamKeys as [number, number][])].entries()) {
    if (column >= mapWidth || row >= mapHeight) return { status: "gap", reason: `${terrainSampleOutsideMapPrefix}${meshName}:${column},${row}` };
    sampleIndices[vertex] = row * mapWidth + column;
  }
  return { status: "keyed", sampleIndices };
}
