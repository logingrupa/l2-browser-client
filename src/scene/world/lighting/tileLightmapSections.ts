import type { NativeBspNodeRange, NativeBspSection } from "../nativeBspResources";
import { bspCompressedLightmapGate } from "../../../environment/model/bspLightmapSelection";
import { sunAffected, sunAffectUnresolved } from "./decodeHourlyLightingInputs";
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
  | { readonly kind: "lightmapped"; readonly chunkId: string; readonly primitive: number; readonly lightmapTexture: number; readonly nativeRenderSection: number;
    readonly sunAffectedNodes: readonly number[]; readonly lightmapCoordinates: Float32Array }
  | { readonly kind: "gap"; readonly chunkId: string; readonly primitive: number; readonly reason: string };

const coordinateComponents = 2;
export const sectionSunAffectUnresolvedReason = "bsp-section-sun-affect-unresolved";
export const sortedSectionMixedSunAffectReason = "bsp-sorted-section-mixed-sun-affect";

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

function compressedPagesGap(model: TileLightingModel, texture: number): string | null {
  const staged = model.hourly.pageRevisions;
  if (staged.status === "unstaged") return staged.reason;
  for (let page = model.texturePageStart[texture]!; page < model.texturePageStart[texture + 1]!; page += 1) {
    const gate = bspCompressedLightmapGate(staged.value.revision[page]!, staged.value.compressedRevision[page]!);
    if (gate.status === "unresolved") return gate.reason;
  }
  return null;
}

function planSection(chunk: LightmapSectionChunk, primitive: number, rangeIndexByNode: ReadonlyMap<string, number>, model: TileLightingModel): LightmapSectionPlan {
  const section = chunk.sections[primitive]!, chunkId = chunk.chunkId;
  if (section.unlit) return { kind: "unlit", chunkId, primitive, reason: "section-unlit" };
  if (section.lightmap === null || section.lightmap === lightmapTextureNone) return { kind: "unlit", chunkId, primitive, reason: "section-without-lightmap" };
  if (section.lightmap >= model.textureCount) return { kind: "gap", chunkId, primitive, reason: `lighting-section-texture-invalid:${section.lightmap}` };
  const nodeRangeSunAffect = model.hourly.nodeRangeSunAffect;
  if (nodeRangeSunAffect.status === "unstaged") return { kind: "gap", chunkId, primitive, reason: nodeRangeSunAffect.reason };
  const pagesGap = compressedPagesGap(model, section.lightmap);
  if (pagesGap !== null) return { kind: "gap", chunkId, primitive, reason: pagesGap };
  const vertexCount = chunk.primitiveVertexCount(primitive), indices = chunk.primitiveIndices(primitive);
  const coordinates = new Float32Array(vertexCount * coordinateComponents), sunAffectedNodes: number[] = [];
  let nodeRangeCount = 0;
  for (const glbRange of chunk.nodeRanges.filter(range => range.primitive === primitive)) {
    const rangeIndex = rangeIndexByNode.get(rangeKey(chunk.chunkOrdinal, glbRange.node));
    if (rangeIndex === undefined) return { kind: "gap", chunkId, primitive, reason: `lighting-node-range-unlisted:${glbRange.node}` };
    const range = model.nodeRanges[rangeIndex]!, sunAffect = nodeRangeSunAffect.value[rangeIndex]!;
    if (range.primitive !== primitive || range.firstIndex !== glbRange.firstIndex || range.indexCount !== glbRange.indexCount) {
      return { kind: "gap", chunkId, primitive, reason: `lighting-node-range-unmapped:${glbRange.node}` };
    }
    if (range.texture !== section.lightmap) return { kind: "gap", chunkId, primitive, reason: `lighting-node-texture-mismatch:${glbRange.node}` };
    if (sunAffect === sunAffectUnresolved) return { kind: "gap", chunkId, primitive, reason: sectionSunAffectUnresolvedReason };
    const placed = placeRangeCoordinates(range, indices, coordinates, vertexCount);
    if (placed !== null) return { kind: "gap", chunkId, primitive, reason: placed };
    if (sunAffect === sunAffected) sunAffectedNodes.push(range.node);
    nodeRangeCount += 1;
  }
  if (section.translucent && sunAffectedNodes.length > 0 && sunAffectedNodes.length < nodeRangeCount) {
    return { kind: "gap", chunkId, primitive, reason: sortedSectionMixedSunAffectReason };
  }
  return { kind: "lightmapped", chunkId, primitive, lightmapTexture: section.lightmap, nativeRenderSection: section.nativeRenderSection,
    sunAffectedNodes, lightmapCoordinates: coordinates };
}

export function planLightmapSections(model: TileLightingModel, chunks: readonly LightmapSectionChunk[]): LightmapSectionPlan[] {
  const rangeIndexByNode = new Map(model.nodeRanges.map((range, rangeIndex) => [rangeKey(range.chunk, range.node), rangeIndex]));
  return chunks.flatMap(chunk => chunk.sections.map((_, primitive) => planSection(chunk, primitive, rangeIndexByNode, model)));
}
