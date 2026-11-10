export type CollisionSourceVector = readonly [number, number, number];
export type CollisionSourcePlane = readonly [number, number, number, number];

export type CollisionVolumeKind = "Engine.BlockingVolume" | "Engine.PhysicsVolume";
export type CollisionVolumeDecision = "declared-none" | "blocking" | "gap";
export type CollisionPlacementDecision = "declared-none" | "slots" | "gap";
export type CollisionTransformProvenance = "authored" | "class-default" | "ue-zero";
export type CollisionMoverSource = "static-slot-enable-collision";

export interface CollisionVolumeTransformProvenance {
  readonly location: CollisionTransformProvenance;
  readonly rotation: CollisionTransformProvenance;
  readonly drawScale: CollisionTransformProvenance;
  readonly drawScale3D: CollisionTransformProvenance;
  readonly prePivot: CollisionTransformProvenance;
}

export interface CollisionVolumeNode {
  readonly plane: CollisionSourcePlane;
  readonly front: number;
  readonly back: number;
  readonly nodeFlags: number;
  readonly polygon: Float32Array;
}

export interface CollisionVolume {
  readonly exportIndex: number;
  readonly kind: CollisionVolumeKind;
  readonly decision: CollisionVolumeDecision;
  readonly location: CollisionSourceVector;
  readonly rotation: CollisionSourceVector;
  readonly drawScale: number;
  readonly drawScale3D: CollisionSourceVector;
  readonly prePivot: CollisionSourceVector;
  readonly transformProvenance: CollisionVolumeTransformProvenance;
  readonly rootOutside: boolean;
  readonly nodes: readonly CollisionVolumeNode[];
}

export interface CollisionStaticMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export interface CollisionPlacement {
  readonly exportIndex: number;
  readonly decision: CollisionPlacementDecision;
  readonly staticMeshIndex: number | null;
  readonly matrix: Float32Array;
}

export interface CollisionMover {
  readonly exportIndex: number;
  readonly slot: number;
  readonly collisionSource: CollisionMoverSource;
  readonly staticMeshIndex: number;
  readonly closedMatrix: Float32Array;
  readonly openMatrix: Float32Array;
}

export interface CollisionTerrain {
  readonly location: CollisionSourceVector;
  readonly terrainScale: CollisionSourceVector;
  readonly heightmapWidth: number;
  readonly heightmapHeight: number;
  readonly firstColumn: number;
  readonly firstRow: number;
  readonly columns: number;
  readonly rows: number;
  readonly heights: Uint32Array;
  readonly quadVisibility: Uint8Array;
  readonly edgeTurn: Uint8Array;
}

export interface CollisionCell {
  readonly cellId: string;
  readonly tileId: string;
  readonly volumes: readonly CollisionVolume[];
  readonly staticMeshes: readonly CollisionStaticMesh[];
  readonly placements: readonly CollisionPlacement[];
  readonly terrain: CollisionTerrain | null;
  readonly movers: readonly CollisionMover[];
}

export interface CollisionBspTree {
  readonly nodeCount: number;
  readonly planes: Float32Array;
  readonly front: Int32Array;
  readonly back: Int32Array;
  readonly coplanar: Int32Array;
  readonly nodeFlags: Uint8Array;
  readonly numVertices: Uint8Array;
  readonly collisionBound: Int32Array;
  readonly vertexPool: Int32Array;
  readonly vertexPoints: Int32Array;
  readonly points: Float32Array;
  readonly leafHulls: Int32Array;
  readonly rootOutside: boolean;
  readonly surfaceFlags: Uint32Array;
}
