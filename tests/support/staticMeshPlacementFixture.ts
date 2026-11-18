import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { StaticMeshPlacementSurfaces } from "../../src/scene/world/lighting/bindStaticMeshLibraryMaterials";
import { staticMeshVertexStreamsUnstagedReason, type NativeTileChunkPlacement } from "../../src/scene/world/nativeTileChunkManifest";

const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function chunkPlacementFixture(sourceActor: string, exportIndex: number, fields: Partial<NativeTileChunkPlacement> = {}): NativeTileChunkPlacement {
  return { id: `placement-${exportIndex}`, modelId: "interlude:Fixture_S.Mesh", sourceActor, exportIndex, sourceMesh: "Fixture_S.Mesh", matrix: identityMatrix,
    materialOverrides: [], collision: {}, vertexStreams: { status: "gap", reason: staticMeshVertexStreamsUnstagedReason }, ...fields };
}

export function staticMeshPlacementSurfacesFixture(sourceActor: string, exportIndex: number, meshes: readonly AbstractMesh[] = [],
  fields: Partial<NativeTileChunkPlacement> = {}): StaticMeshPlacementSurfaces {
  return { placement: chunkPlacementFixture(sourceActor, exportIndex, fields), meshes };
}
