import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { normalizeVector, type Vector3 as SourceVector } from "../../../shared/math/vector3";
import { worldPositionToSource } from "../../../world/sourceFrame";
import type { NativeBspNodeRange, NativeBspSection } from "../nativeBspResources";
import type { BspVisibilityModel } from "./core/decodeBspVisibility";
import type { ViewPose } from "./core/viewFrustum";
import type { IndexBlock, TileViewSource, TileVisibilityTargets, TranslucentSectionTarget } from "./bindTileVisibility";

export interface TileVisibilityBspChunk {
  readonly chunkOrdinal: number;
  readonly sections: readonly NativeBspSection[];
  readonly nodeRanges: readonly NativeBspNodeRange[];
  readonly meshes: readonly AbstractMesh[];
}

export type TileVisibilityTargetsResult =
  | { readonly kind: "bound"; readonly targets: TileVisibilityTargets; readonly translucentSections: readonly number[] }
  | { readonly kind: "gap"; readonly reason: string };

export const sectionUnmappedReason = "bsp-visibility-section-unmapped";

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

function sectionMeshes(model: BspVisibilityModel, chunks: readonly TileVisibilityBspChunk[]): { meshes: AbstractMesh[]; translucent: boolean[] } | string {
  const chunkByOrdinal = new Map(chunks.map(chunk => [chunk.chunkOrdinal, chunk]));
  const glbRangeKeys = new Map(chunks.map(chunk => [chunk.chunkOrdinal,
    new Set(chunk.nodeRanges.map(range => rangeKey(range.node, range.primitive, range.firstIndex, range.indexCount)))]));
  const sectionIndexCount = new Float64Array(model.sections.count);
  const { ranges } = model;
  for (let range = 0; range < ranges.count; range++) {
    const key = rangeKey(ranges.node[range]!, ranges.primitive[range]!, ranges.firstIndex[range]!, ranges.indexCount[range]!);
    if (!glbRangeKeys.get(ranges.chunk[range]!)?.has(key)) return `range of node ${ranges.node[range]} is not in the chunk BSP of chunk ${ranges.chunk[range]}`;
    const section = ranges.section[range]!;
    sectionIndexCount[section] = sectionIndexCount[section]! + ranges.indexCount[range]!;
  }
  const meshes: AbstractMesh[] = [], translucent: boolean[] = [];
  for (let section = 0; section < model.sections.count; section++) {
    const chunk = chunkByOrdinal.get(model.sections.chunk[section]!), primitive = model.sections.primitive[section]!;
    const mesh = chunk?.meshes[primitive], description = chunk?.sections[primitive];
    if (mesh === undefined || description === undefined) return `section ${section} names chunk ${model.sections.chunk[section]} primitive ${primitive}, which has no BSP mesh`;
    if (mesh.getTotalIndices() !== sectionIndexCount[section]) return `section ${section} ranges hold ${sectionIndexCount[section]} indices for a mesh of ${mesh.getTotalIndices()}`;
    meshes.push(mesh);
    translucent.push(description.translucent);
  }
  return { meshes, translucent };
}

export function tileVisibilityTargets(model: BspVisibilityModel, chunks: readonly TileVisibilityBspChunk[]): TileVisibilityTargetsResult {
  const mapped = sectionMeshes(model, chunks);
  if (typeof mapped === "string") return { kind: "gap", reason: `${sectionUnmappedReason}: ${mapped}` };
  const translucentSections = new Map<number, TranslucentSectionTarget>(), translucentOrderErrors: string[] = [];
  mapped.meshes.forEach((mesh, section) => {
    if (!mapped.translucent[section]) return;
    const target = translucentMeshTarget(mesh);
    if (typeof target === "string") translucentOrderErrors.push(`section ${section}: ${target}; file order kept`);
    else translucentSections.set(section, target);
  });
  return { kind: "bound", targets: { translucentSections, translucentOrderErrors }, translucentSections: [...translucentSections.keys()] };
}
