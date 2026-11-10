import type { Vector3 } from "../../../../shared/math/vector3";
import { solidTreeOverlapsBox, tileSolidCollisionTree, traceSolidTree } from "./bspCollisionTrace";
import type { CollisionCell } from "./collisionCell";
import type { CollisionHitSource, CollisionPrimitive, CollisionSurroundings, CollisionSweep, PrimitiveSweepHit } from "./collisionTrace";
import type { CollisionWorld } from "./collisionWorld";
import { cylinderOverlapsBox, traceCylinder } from "./cylinderTrace";
import type { CollisionBackoffRule, MovementNativeRules } from "./movementRules";
import { staticMeshOverlapsBox, traceStaticMesh } from "./staticMeshTrace";
import { terrainContactUnderBox, traceTerrain } from "./terrainTrace";
import { traceVolume, volumeOverlapsBox } from "./volumeTrace";

export interface LocatedSweepHit extends PrimitiveSweepHit {
  readonly primitive: CollisionPrimitive;
}

export interface ResidentPrimitive {
  readonly source: CollisionHitSource;
  readonly rayBackoff: CollisionBackoffRule;
  readonly boxBackoff: CollisionBackoffRule;
  trace(sweep: CollisionSweep): LocatedSweepHit | null;
  overlappedBy(centre: Vector3, extent: Vector3): CollisionPrimitive | null;
}

const locate = (hit: PrimitiveSweepHit | null, primitive: CollisionPrimitive): LocatedSweepHit | null => hit === null ? null : { ...hit, primitive };

function cellPrimitives(cell: CollisionCell, surroundings: CollisionSurroundings, rules: MovementNativeRules): ResidentPrimitive[] {
  const { cellId } = cell, bspBackoff = { rayBackoff: rules.backoff.bspRay, boxBackoff: rules.backoff.bspBox };
  const meshBackoff = { rayBackoff: rules.backoff.staticMesh, boxBackoff: rules.backoff.staticMesh };
  const volumes = cell.volumes.flatMap((volume, volumeIndex): ResidentPrimitive[] => {
    if (volume.decision !== "blocking" || volume.nodes.length === 0) return [];
    const primitive: CollisionPrimitive = { kind: "volume", cellId, volumeIndex, exportIndex: volume.exportIndex }, owner = `cell ${cellId} volume ${volumeIndex}`;
    return [{
      source: "blocking-volume", ...bspBackoff,
      trace: sweep => locate(traceVolume(volume, owner, sweep, rules), primitive),
      overlappedBy: (centre, extent) => volumeOverlapsBox(volume, owner, centre, extent, rules) ? primitive : null,
    }];
  });
  const placements = cell.placements.flatMap((placement, placementIndex): ResidentPrimitive[] => {
    if (placement.decision !== "slots" || placement.staticMeshIndex === null) return [];
    const mesh = cell.staticMeshes[placement.staticMeshIndex]!;
    const primitive: CollisionPrimitive = { kind: "static-mesh", cellId, placementIndex, exportIndex: placement.exportIndex };
    return [{
      source: "static-mesh-slots", ...meshBackoff,
      trace: sweep => locate(traceStaticMesh(mesh, placement.matrix, sweep, rules), primitive),
      overlappedBy: (centre, extent) => staticMeshOverlapsBox(mesh, placement.matrix, centre, extent) ? primitive : null,
    }];
  });
  const movers = cell.movers.map((mover, moverIndex): ResidentPrimitive => {
    const mesh = cell.staticMeshes[mover.staticMeshIndex]!;
    const matrix = surroundings.moverStates?.get(mover.exportIndex) === "open" ? mover.openMatrix : mover.closedMatrix;
    const primitive: CollisionPrimitive = { kind: "mover", cellId, moverIndex, exportIndex: mover.exportIndex };
    return {
      source: mover.collisionSource, ...meshBackoff,
      trace: sweep => locate(traceStaticMesh(mesh, matrix, sweep, rules), primitive),
      overlappedBy: (centre, extent) => staticMeshOverlapsBox(mesh, matrix, centre, extent) ? primitive : null,
    };
  });
  const terrain = cell.terrain;
  const terrains: ResidentPrimitive[] = terrain === null ? [] : [{
    source: "terrain-heightmap", rayBackoff: rules.backoff.terrain, boxBackoff: rules.backoff.terrain,
    trace: sweep => {
      const hit = traceTerrain(terrain, sweep, rules);
      return hit === null ? null : { time: hit.time, normal: hit.normal, primitive: { kind: "terrain", cellId, quadIndex: hit.quadIndex } };
    },
    overlappedBy: (centre, extent) => {
      const contact = terrainContactUnderBox(terrain, centre, extent, rules);
      return contact === null ? null : { kind: "terrain", cellId, quadIndex: contact.quadIndex };
    },
  }];
  return [...volumes, ...placements, ...movers, ...terrains];
}

export function residentPrimitives(world: CollisionWorld, surroundings: CollisionSurroundings, rules: MovementNativeRules): ResidentPrimitive[] {
  const cells = world.residentCells();
  const trees = [...new Set(cells.map(cell => cell.tileId))].flatMap((tileId): ResidentPrimitive[] => {
    const tree = world.tileBspTree(tileId);
    if (tree === null) return [];
    const solidTree = tileSolidCollisionTree(tileId, tree, rules), primitive: CollisionPrimitive = { kind: "bsp-tree", tileId };
    return [{
      source: "bsp-collision-tree", rayBackoff: rules.backoff.bspRay, boxBackoff: rules.backoff.bspBox,
      trace: sweep => locate(traceSolidTree(solidTree, sweep, rules), primitive),
      overlappedBy: (centre, extent) => solidTreeOverlapsBox(solidTree, centre, extent, rules) ? primitive : null,
    }];
  });
  const pawns = (surroundings.pawns ?? []).map((pawn, pawnIndex): ResidentPrimitive => {
    const primitive: CollisionPrimitive = { kind: "pawn", pawnIndex };
    return {
      source: "pawn-cylinder", rayBackoff: rules.backoff.pawnCylinder, boxBackoff: rules.backoff.pawnCylinder,
      trace: sweep => locate(traceCylinder(pawn, sweep, rules), primitive),
      overlappedBy: (centre, extent) => cylinderOverlapsBox(pawn, centre, extent) ? primitive : null,
    };
  });
  return [...trees, ...cells.flatMap(cell => cellPrimitives(cell, surroundings, rules)), ...pawns];
}
