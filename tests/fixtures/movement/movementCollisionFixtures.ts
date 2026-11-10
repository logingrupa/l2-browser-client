import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { createCollisionWorld, type CollisionWorld } from "../../../src/scene/world/movement/core/collisionWorld";
import { decodeNativeTileBspTree, decodeNativeTileCollisionCell } from "../../../src/scene/world/movement/core/decodeNativeTileCollision";
import { parseMovementNativeRules, type MovementNativeRules } from "../../../src/scene/world/movement/core/movementRules";
import { compareFloat32ByUlp, readGoldenTrace, writeGoldenTrace, type GoldenTrace } from "../../support/goldenTrace";
import { collisionChunkFixtureArrays, readCollisionFixturePayload } from "../../support/nativeTileCollisionFixture";
import type { TypedPayloadFixtureArray } from "../../support/typedPayloadFixture";

export const fixtureTileId = "90_90";
export const fixtureCellId = "90_90/chunk-0-0";
const fixtureFootprint = { minimumX: -4096, minimumY: -4096, maximumX: 4096, maximumY: 4096 };
const movementRulesPath = fileURLToPath(new URL("../../../recipes/world/movement-native-rules.json", import.meta.url));

export function readCommittedMovementRulesDocument(): unknown {
  return JSON.parse(readFileSync(movementRulesPath, "utf8"));
}

export function committedMovementRules(): MovementNativeRules {
  return parseMovementNativeRules(readCommittedMovementRulesDocument());
}

export function float32Words(values: readonly number[]): number[] {
  return Array.from(new Int32Array(Float32Array.from(values).buffer));
}

const wallNearX = 256, wallFarX = 320, wallHalfSpan = 1024;

function wallFacePoints(x: number): number[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([y, z]) => [x, y! * wallHalfSpan, z! * wallHalfSpan]);
}

export function wallTreeArrays(): TypedPayloadFixtureArray[] {
  return [
    { name: "BSPT.planes", type: "float32", values: [-1, 0, 0, -wallNearX, 1, 0, 0, wallFarX] },
    { name: "BSPT.front", type: "int32", values: [-1, -1] },
    { name: "BSPT.back", type: "int32", values: [1, -1] },
    { name: "BSPT.coplanar", type: "int32", values: [-1, -1] },
    { name: "BSPT.nodeFlags", type: "uint8", values: [0, 0] },
    { name: "BSPT.numVertices", type: "uint8", values: [4, 4] },
    { name: "BSPT.collisionBound", type: "int32", values: [-1, 0] },
    { name: "BSPT.vertexPool", type: "int32", values: [0, 4] },
    { name: "BSPT.vertexPoints", type: "int32", values: [0, 1, 2, 3, 4, 5, 6, 7] },
    { name: "BSPT.points", type: "float32", values: [...wallFacePoints(wallNearX), ...wallFacePoints(wallFarX)] },
    { name: "BSPT.leafHulls", type: "int32", values: [0, 1, -1, ...float32Words([wallNearX, -wallHalfSpan, -wallHalfSpan, wallFarX, wallHalfSpan, wallHalfSpan])] },
    { name: "BSPT.rootOutside", type: "uint8", values: [1] },
    { name: "BSPT.surfaceFlags", type: "uint32", values: [0, 0] },
  ];
}

export function emptyChunkArrays(): TypedPayloadFixtureArray[] {
  return collisionChunkFixtureArrays().map(array => ({ ...array, values: [] }));
}

export function collisionWorldFromFixtures(chunkArrays: readonly TypedPayloadFixtureArray[], treeArrays: readonly TypedPayloadFixtureArray[] | null): CollisionWorld {
  const world = createCollisionWorld();
  world.requireCell(fixtureCellId, fixtureFootprint);
  world.addCell(fixtureCellId, decodeNativeTileCollisionCell(readCollisionFixturePayload(chunkArrays), { cellId: fixtureCellId, tileId: fixtureTileId }));
  if (treeArrays !== null) world.setTileBspTree(fixtureTileId, decodeNativeTileBspTree(readCollisionFixturePayload(treeArrays), fixtureTileId));
  return world;
}

const goldenFolder = fileURLToPath(new URL("./", import.meta.url));

export function expectMovementGoldenTrace(traceFileName: string, trace: GoldenTrace): void {
  const tracePath = `${goldenFolder}${traceFileName}`;
  if (process.env.MOVEMENT_GOLDEN_WRITE === "1") writeGoldenTrace(tracePath, trace);
  const golden = readGoldenTrace(tracePath);
  expect({ seed: trace.seed, stepSeconds: trace.stepSeconds, columns: trace.columns }).toEqual({ seed: golden.seed, stepSeconds: golden.stepSeconds, columns: golden.columns });
  expect(trace.rows.length).toBe(golden.rows.length);
  expect(compareFloat32ByUlp(golden.rows.flat(), trace.rows.flat(), 0)).toEqual({ largestUlpDistance: 0, firstIndexPastLimit: null });
}
