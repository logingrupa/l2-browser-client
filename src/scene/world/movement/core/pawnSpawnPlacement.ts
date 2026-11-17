import { float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import { singleLineCheck } from "./lineCheck";
import { pawnExtent, type PawnBody, type PawnPhysicsContext } from "./pawnBody";

export function placeSpawnedPawn(context: PawnPhysicsContext, body: PawnBody, incomingPosition: Vector3): Vector3 {
  const { floorProbe, floorBand, spawnTrace } = context.rules.pawn;
  const start = float32Vector({ x: incomingPosition.x, y: incomingPosition.y, z: incomingPosition.z + body.collisionHeight + spawnTrace.raise });
  const end = float32Vector({ x: incomingPosition.x, y: incomingPosition.y, z: incomingPosition.z - spawnTrace.drop });
  const hit = singleLineCheck(context.world, { start, end, extent: pawnExtent(body), ...context.surroundings }, context.rules);
  if (hit === null || hit.location.z === 0) return incomingPosition;
  const reportedGap = Math.fround(floorProbe * hit.time);
  if (reportedGap >= floorBand.minimum) return hit.location;
  return { ...hit.location, z: Math.fround(hit.location.z + Math.fround(floorBand.target - reportedGap)) };
}
