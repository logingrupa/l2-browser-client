import type { NativeBspNodeRange, NativeBspSection } from "../nativeBspResources";
import { lightmapTextureNone, type TileLightingModel, type TileLightmapNodeRange } from "./decodeTileLighting";

export interface LightmapSectionChunk {
  readonly chunkId: string;
  readonly chunkOrdinal: number;
  readonly sections: readonly NativeBspSection[];
  readonly nodeRanges: readonly NativeBspNodeRange[];
  readonly primitiveVertexCount: (primitive: number) => number;
  readonly primitiveIndices: (primitive: number) => ArrayLike<number>;
}

export type LightmapSectionPlan =
  | { readonly kind: "unlit"; readonly chunkId: string; readonly primitive: number; readonly reason: "section-unlit" | "section-without-lightmap" }
  | { readonly kind: "lightmapped"; readonly chunkId: string; readonly primitive: number; readonly lightmapTexture: number; readonly outdoor: boolean;
    readonly lightmapCoordinates: Float32Array }
  | { readonly kind: "gap"; readonly chunkId: string; readonly primitive: number; readonly reason: string };

const coordinateComponents = 2;

function rangeKey(chunkOrdinal: number, node: number): string {
  return `${chunkOrdinal}:${node}`;
}

function placeRangeCoordinates(range: TileLightmapNodeRange, indices: ArrayLike<number>, coordinates: Float32Array, vertexCount: number): string | null {
  let lowest = Infinity, highest = -Infinity;
  for (let index = range.firstIndex; index < range.firstIndex + range.indexCount; index++) {
    const vertex = indices[index];
    if (vertex === undefined) return `lighting-node-range-outside-indices:${range.node}`;
    lowest = Math.min(lowest, vertex); highest = Math.max(highest, vertex);
  }
  const coordinateCount = range.lightmapCoordinates.length / coordinateComponents;
  if (highest - lowest + 1 > coordinateCount || lowest + coordinateCount > vertexCount) return `lighting-node-coordinate-count-mismatch:${range.node}`;
  coordinates.set(range.lightmapCoordinates, lowest * coordinateComponents);
  return null;
}

function planSection(chunk: LightmapSectionChunk, primitive: number, rangesByNode: ReadonlyMap<string, TileLightmapNodeRange>, model: TileLightingModel): LightmapSectionPlan {
  const section = chunk.sections[primitive]!, chunkId = chunk.chunkId;
  if (section.unlit) return { kind: "unlit", chunkId, primitive, reason: "section-unlit" };
  if (section.lightmap === null || section.lightmap === lightmapTextureNone) return { kind: "unlit", chunkId, primitive, reason: "section-without-lightmap" };
  if (section.lightmap >= model.textureCount) return { kind: "gap", chunkId, primitive, reason: `lighting-section-texture-invalid:${section.lightmap}` };
  const vertexCount = chunk.primitiveVertexCount(primitive), indices = chunk.primitiveIndices(primitive);
  const coordinates = new Float32Array(vertexCount * coordinateComponents);
  for (const glbRange of chunk.nodeRanges.filter(range => range.primitive === primitive)) {
    const range = rangesByNode.get(rangeKey(chunk.chunkOrdinal, glbRange.node));
    if (range === undefined) return { kind: "gap", chunkId, primitive, reason: `lighting-node-range-unlisted:${glbRange.node}` };
    if (range.primitive !== primitive || range.firstIndex !== glbRange.firstIndex || range.indexCount !== glbRange.indexCount) {
      return { kind: "gap", chunkId, primitive, reason: `lighting-node-range-unmapped:${glbRange.node}` };
    }
    if (range.texture !== section.lightmap) return { kind: "gap", chunkId, primitive, reason: `lighting-node-texture-mismatch:${glbRange.node}` };
    const placed = placeRangeCoordinates(range, indices, coordinates, vertexCount);
    if (placed !== null) return { kind: "gap", chunkId, primitive, reason: placed };
  }
  return { kind: "lightmapped", chunkId, primitive, lightmapTexture: section.lightmap, outdoor: section.outdoor, lightmapCoordinates: coordinates };
}

export function planLightmapSections(model: TileLightingModel, chunks: readonly LightmapSectionChunk[]): LightmapSectionPlan[] {
  const rangesByNode = new Map(model.nodeRanges.map(range => [rangeKey(range.chunk, range.node), range]));
  return chunks.flatMap(chunk => chunk.sections.map((_, primitive) => planSection(chunk, primitive, rangesByNode, model)));
}
