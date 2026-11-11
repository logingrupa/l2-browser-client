import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { createCollisionWorld, type CollisionWorld } from "../../../src/scene/world/movement/core/collisionWorld";
import { decodeNativeTileBspTree, decodeNativeTileCollisionCell } from "../../../src/scene/world/movement/core/decodeNativeTileCollision";
import { parseMovementNativeRules, type MovementNativeRules } from "../../../src/scene/world/movement/core/movementRules";
import { compareFloat32ByUlp, readGoldenTrace, writeGoldenTrace, type GoldenTrace } from "../../support/goldenTrace";
import {
  boxFacePolygon, boxHalfExtent, boxPlanes, collisionChunkFixtureArrays, float32Words, readCollisionFixturePayload,
} from "../../support/nativeTileCollisionFixture";
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

export interface BoxVolumeDeclaration {
  readonly kindCode: number;
  readonly decisionCode: number;
  readonly location: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly drawScale3D: readonly [number, number, number];
}

export const blockingBoxVolume: BoxVolumeDeclaration = { kindCode: 0, decisionCode: 1, location: [1600, -2400, 300], rotation: [0, 0, 0], drawScale3D: [1, 1, 2] };
export const waterPhysicsVolume: BoxVolumeDeclaration = { kindCode: 1, decisionCode: 0, location: [-1000, 0, 0], rotation: [0, 8192, 0], drawScale3D: [4, 4, 2] };
export const placementTranslation = [1500, -2500, 40] as const;
export const moverClosedTranslation = [3000, -2500, 40] as const;
export const moverOpenTranslation = [3000, -2500, 176] as const;
export const moverExportIndex = 733;
export const flatTerrainZ = -100;
export const raisedTerrainZ = 412;
export const hiddenQuadIndex = 3;
export const turnedQuadIndex = 5;
const terrainHeightOrigin = 32767;
const translatedRows = ([x, y, z]: readonly [number, number, number]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

export function volumeArrays(volumes: readonly BoxVolumeDeclaration[]): TypedPayloadFixtureArray[] {
  const nodeCount = boxPlanes.length;
  return [
    { name: "VOLS.exportIndex", type: "uint32", values: volumes.map((_, volumeIndex) => 900 + volumeIndex) },
    { name: "VOLS.kind", type: "uint8", values: volumes.map(volume => volume.kindCode) },
    { name: "VOLS.decision", type: "uint8", values: volumes.map(volume => volume.decisionCode) },
    { name: "VOLS.location", type: "float32", values: volumes.flatMap(volume => [...volume.location]) },
    { name: "VOLS.rotation", type: "int32", values: volumes.flatMap(volume => [...volume.rotation]) },
    { name: "VOLS.drawScale", type: "float32", values: volumes.map(() => 1) },
    { name: "VOLS.drawScale3D", type: "float32", values: volumes.flatMap(volume => [...volume.drawScale3D]) },
    { name: "VOLS.prePivot", type: "float32", values: volumes.flatMap(() => [0, 0, 0]) },
    { name: "VOLS.transformProvenance", type: "uint8", values: volumes.flatMap(() => [0, 0, 0, 0, 0]) },
    { name: "VOLS.rootOutside", type: "uint8", values: volumes.map(() => 1) },
    { name: "VOLS.nodeStart", type: "uint32", values: volumes.map((_, volumeIndex) => volumeIndex * nodeCount) },
    { name: "VOLS.nodeCount", type: "uint32", values: volumes.map(() => nodeCount) },
    { name: "VOLS.planes", type: "float32", values: volumes.flatMap(() => boxPlanes.flatMap(normal => [...normal, boxHalfExtent])) },
    { name: "VOLS.front", type: "int32", values: volumes.flatMap(() => boxPlanes.map(() => -1)) },
    { name: "VOLS.back", type: "int32", values: volumes.flatMap(() => boxPlanes.map((_, node) => node + 1 < nodeCount ? node + 1 : -1)) },
    { name: "VOLS.nodeFlags", type: "uint8", values: volumes.flatMap(() => boxPlanes.map(() => 0)) },
    { name: "VOLS.vertexStart", type: "uint32", values: volumes.flatMap((_, volumeIndex) => boxPlanes.map((__, node) => (volumeIndex * nodeCount + node) * 4)) },
    { name: "VOLS.vertexCount", type: "uint32", values: volumes.flatMap(() => boxPlanes.map(() => 4)) },
    { name: "VOLS.vertices", type: "float32", values: volumes.flatMap(() => boxPlanes.flatMap(boxFacePolygon)) },
  ];
}

function terrainHeights(): number[] {
  const heights = Array.from({ length: 16 }, () => terrainHeightOrigin + flatTerrainZ);
  heights[1 * 4 + 3] = terrainHeightOrigin + raisedTerrainZ;
  return heights;
}

export interface MixedChunkOptions {
  readonly turnedQuad: boolean;
}

export function mixedChunkArrays(options: MixedChunkOptions = { turnedQuad: false }): TypedPayloadFixtureArray[] {
  const quadVisibility = Array.from({ length: 9 }, (_, quadIndex) => quadIndex === hiddenQuadIndex ? 0 : 1);
  const edgeTurn = Array.from({ length: 9 }, (_, quadIndex) => quadIndex === turnedQuadIndex && options.turnedQuad ? 1 : 0);
  return [
    ...volumeArrays([blockingBoxVolume, waterPhysicsVolume]),
    { name: "SMSH.vertexStart", type: "uint32", values: [0] },
    { name: "SMSH.vertexCount", type: "uint32", values: [4] },
    { name: "SMSH.indexStart", type: "uint32", values: [0] },
    { name: "SMSH.indexCount", type: "uint32", values: [6] },
    { name: "SMSH.positions", type: "float32", values: [0, 0, 0, 256, 0, 0, 256, 256, 0, 0, 256, 0] },
    { name: "SMSH.indices", type: "uint32", values: [0, 2, 1, 0, 3, 2] },
    { name: "PLAC.exportIndex", type: "uint32", values: [512, 513] },
    { name: "PLAC.decision", type: "uint8", values: [1, 0] },
    { name: "PLAC.mesh", type: "int32", values: [0, -1] },
    { name: "PLAC.matrix", type: "float32", values: [...translatedRows(placementTranslation), ...translatedRows([0, 0, 0])] },
    { name: "MOVR.exportIndex", type: "uint32", values: [moverExportIndex] },
    { name: "MOVR.slot", type: "uint32", values: [0] },
    { name: "MOVR.collisionSource", type: "uint8", values: [0] },
    { name: "MOVR.mesh", type: "int32", values: [0] },
    { name: "MOVR.closedMatrix", type: "float32", values: translatedRows(moverClosedTranslation) },
    { name: "MOVR.openMatrix", type: "float32", values: translatedRows(moverOpenTranslation) },
    { name: "TERR.location", type: "float32", values: [2048, -2048, 0] },
    { name: "TERR.terrainScale", type: "float32", values: [512, 512, 256] },
    { name: "TERR.heightmapSize", type: "uint32", values: [4, 4] },
    { name: "TERR.vertexRectangle", type: "uint32", values: [0, 0, 4, 4] },
    { name: "TERR.heights", type: "uint32", values: terrainHeights() },
    { name: "TERR.quadVisibility", type: "uint8", values: quadVisibility },
    { name: "TERR.edgeTurn", type: "uint8", values: edgeTurn },
  ];
}

export function terrainWorldPoint(column: number, row: number): { x: number; y: number } {
  return { x: 1024 + column * 512, y: -3072 + row * 512 };
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
