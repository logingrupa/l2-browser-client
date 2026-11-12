import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { normalizeVector, type Vector3 as SourceVector } from "../../../shared/math/vector3";
import { worldPositionToSource } from "../../../world/sourceFrame";
import type { NativeBspNodeRange, NativeBspSection } from "../nativeBspResources";
import type { NativeModelInstance } from "../nativeModelPlacements";
import type { NativeTileChunkPlacement } from "../nativeTileChunkManifest";
import { memberKindStaticMesh, type BspVisibilityModel } from "./core/decodeBspVisibility";
import type { ViewPose } from "./core/viewFrustum";
import type { ChunkVisibilityTargets, IndexBlock, TileViewSource, TranslucentSectionTarget, VisibilityTarget } from "./bindTileVisibility";

export interface TileVisibilityBspMeshes {
  readonly sections: readonly NativeBspSection[];
  readonly nodeRanges: readonly NativeBspNodeRange[];
  readonly meshes: readonly AbstractMesh[];
}

export interface TileVisibilityChunk {
  readonly chunkOrdinal: number;
  readonly bspChunk: TileVisibilityBspMeshes | null;
  readonly placements: readonly NativeModelInstance<NativeTileChunkPlacement>[];
  readonly terrainMeshes: readonly AbstractMesh[];
}

export type ChunkVisibilityTargetsResult =
  | { readonly kind: "bound"; readonly targets: ChunkVisibilityTargets }
  | { readonly kind: "gap"; readonly reason: string };

const sectionUnmappedReason = "bsp-visibility-section-unmapped";

function sourceVector(world: Vector3): SourceVector {
  return worldPositionToSource({ x: world.x, y: world.y, z: world.z });
}

function sourceDistance(worldDistance: number): number {
  return worldPositionToSource({ x: worldDistance, y: 0, z: 0 }).x;
}

export function sceneTileViewSource(scene: Scene): TileViewSource {
  return {
    onFrame(step) {
      const observer = scene.onBeforeRenderObservable.add(step);
      return () => { scene.onBeforeRenderObservable.remove(observer); };
    },
    pose(): ViewPose | null {
      const camera = scene.activeCamera;
      if (camera === null || camera.mode !== Camera.PERSPECTIVE_CAMERA) return null;
      const aspectRatio = scene.getEngine().getAspectRatio(camera);
      const verticalFieldOfView = camera.fovMode === Camera.FOVMODE_VERTICAL_FIXED ? camera.fov : 2 * Math.atan(Math.tan(camera.fov / 2) / aspectRatio);
      return { position: sourceVector(camera.globalPosition),
        forward: normalizeVector(sourceVector(camera.getDirection(Vector3.Forward(scene.useRightHandedSystem)))),
        up: normalizeVector(sourceVector(camera.getDirection(Vector3.Up()))), verticalFieldOfView, aspectRatio,
        near: sourceDistance(camera.minZ), far: camera.maxZ === 0 ? Infinity : sourceDistance(camera.maxZ) };
    },
  };
}

function translucentMeshTarget(mesh: AbstractMesh): TranslucentSectionTarget | string {
  if (!(mesh instanceof Mesh)) return `${mesh.name} is not a Mesh, so its index buffer cannot be rewritten`;
  if (mesh.geometry === null || mesh.geometry.meshes.length !== 1) return `${mesh.name} shares its geometry`;
  const fileOrder = mesh.getIndices();
  if (fileOrder === null) return `${mesh.name} has no indices`;
  const fileIndices = Uint32Array.from(fileOrder);
  return {
    reorderIndexBlocks(blocks: readonly IndexBlock[]) {
      const ordered = new Uint32Array(fileIndices.length);
      let offset = 0;
      for (const block of blocks) {
        ordered.set(fileIndices.subarray(block.firstIndex, block.firstIndex + block.indexCount), offset);
        offset += block.indexCount;
      }
      mesh.updateIndices(ordered);
    },
  };
}

function rangeKey(node: number, primitive: number, firstIndex: number, indexCount: number): string {
  return `${node}:${primitive}:${firstIndex}:${indexCount}`;
}

interface ChunkSectionMeshes {
  readonly meshes: ReadonlyMap<number, AbstractMesh>;
  readonly translucentSections: readonly number[];
}

function chunkSectionMeshes(model: BspVisibilityModel, chunk: TileVisibilityChunk): ChunkSectionMeshes | string {
  const { chunkOrdinal, bspChunk } = chunk;
  const glbRangeKeys = new Set((bspChunk?.nodeRanges ?? []).map(range => rangeKey(range.node, range.primitive, range.firstIndex, range.indexCount)));
  const sectionIndexCount = new Map<number, number>();
  const { ranges } = model;
  for (let range = 0; range < ranges.count; range++) {
    if (ranges.chunk[range] !== chunkOrdinal) continue;
    const key = rangeKey(ranges.node[range]!, ranges.primitive[range]!, ranges.firstIndex[range]!, ranges.indexCount[range]!);
    if (!glbRangeKeys.has(key)) return `range of node ${ranges.node[range]} is not in the chunk BSP of chunk ${chunkOrdinal}`;
    const section = ranges.section[range]!;
    sectionIndexCount.set(section, (sectionIndexCount.get(section) ?? 0) + ranges.indexCount[range]!);
  }
  const meshes = new Map<number, AbstractMesh>(), translucentSections: number[] = [];
  for (let section = 0; section < model.sections.count; section++) {
    if (model.sections.chunk[section] !== chunkOrdinal) continue;
    const primitive = model.sections.primitive[section]!, mesh = bspChunk?.meshes[primitive], description = bspChunk?.sections[primitive];
    if (mesh === undefined || description === undefined) return `section ${section} names chunk ${chunkOrdinal} primitive ${primitive}, which has no BSP mesh`;
    const indexCount = sectionIndexCount.get(section) ?? 0;
    if (mesh.getTotalIndices() !== indexCount) return `section ${section} ranges hold ${indexCount} indices for a mesh of ${mesh.getTotalIndices()}`;
    meshes.set(section, mesh);
    if (description.translucent) translucentSections.push(section);
  }
  return { meshes, translucentSections };
}

function meshVisibilityTarget(meshes: readonly AbstractMesh[]): VisibilityTarget {
  return { setVisible(visible) { for (const mesh of meshes) mesh.isVisible = visible; } };
}

function placementTargets(model: BspVisibilityModel, placements: readonly NativeModelInstance<NativeTileChunkPlacement>[]): Map<number, VisibilityTarget> {
  const placementByExportIndex = new Map(placements.map(placement => [placement.source.exportIndex, placement]));
  const targets = new Map<number, VisibilityTarget>();
  model.members.kind.forEach((kind, member) => {
    const placement = kind === memberKindStaticMesh ? placementByExportIndex.get(model.members.exportIndex[member]!) : undefined;
    if (placement) targets.set(member, meshVisibilityTarget(placement.root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0)));
  });
  return targets;
}

export function chunkVisibilityTargets(model: BspVisibilityModel, chunk: TileVisibilityChunk): ChunkVisibilityTargetsResult {
  const mapped = chunkSectionMeshes(model, chunk);
  if (typeof mapped === "string") return { kind: "gap", reason: `${sectionUnmappedReason}: ${mapped}` };
  const translucentSections = new Map<number, TranslucentSectionTarget>(), translucentOrderErrors: string[] = [];
  for (const section of mapped.translucentSections) {
    const target = translucentMeshTarget(mapped.meshes.get(section)!);
    if (typeof target === "string") translucentOrderErrors.push(`section ${section}: ${target}; file order kept`);
    else translucentSections.set(section, target);
  }
  const sections = new Map([...mapped.meshes].map(([section, mesh]) => [section, meshVisibilityTarget([mesh])]));
  return { kind: "bound", targets: { sections, members: placementTargets(model, chunk.placements), terrain: meshVisibilityTarget(chunk.terrainMeshes),
    translucentSections, translucentOrderErrors } };
}
