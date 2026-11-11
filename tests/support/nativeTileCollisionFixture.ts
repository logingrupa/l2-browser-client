import { readTypedPayload, type TypedPayload } from "../../src/shared/typedPayload";
import { writeTypedPayloadFixture, type TypedPayloadFixture, type TypedPayloadFixtureArray } from "./typedPayloadFixture";

export const collisionFixtureMetadata = { sourceSha256: "ab".repeat(32), converterVersion: "collision-fixture-1" } as const;

export const boxHalfExtent = 64;
export const boxPlanes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

export function boxFacePolygon(normal: readonly [number, number, number]): number[] {
  const axis = normal.findIndex(component => component !== 0), sign = normal[axis]!;
  const tangentAxes = [0, 1, 2].filter(otherAxis => otherAxis !== axis) as [number, number];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  return corners.flatMap(([first, second]) => {
    const point = [0, 0, 0];
    point[axis] = sign * boxHalfExtent;
    point[tangentAxes[0]] = first! * boxHalfExtent;
    point[tangentAxes[1]] = second! * boxHalfExtent;
    return point;
  });
}

export function float32Words(values: readonly number[]): number[] {
  return Array.from(new Int32Array(Float32Array.from(values).buffer));
}

const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translatedMatrix = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

export function collisionChunkFixtureArrays(): TypedPayloadFixtureArray[] {
  const boxNodeCount = boxPlanes.length;
  return [
    { name: "VOLS.exportIndex", type: "uint32", values: [417] },
    { name: "VOLS.kind", type: "uint8", values: [0] },
    { name: "VOLS.decision", type: "uint8", values: [1] },
    { name: "VOLS.location", type: "float32", values: [1024, -2048, 96] },
    { name: "VOLS.rotation", type: "int32", values: [0, 16384, 0] },
    { name: "VOLS.drawScale", type: "float32", values: [1] },
    { name: "VOLS.drawScale3D", type: "float32", values: [1, 2, 1] },
    { name: "VOLS.prePivot", type: "float32", values: [0, 0, 0] },
    { name: "VOLS.transformProvenance", type: "uint8", values: [0, 0, 1, 1, 2] },
    { name: "VOLS.water", type: "uint8", values: [0] },
    { name: "VOLS.priority", type: "int32", values: [0] },
    { name: "VOLS.gravity", type: "float32", values: [0, 0, 0] },
    { name: "VOLS.terminalVelocity", type: "float32", values: [0] },
    { name: "VOLS.physicsFieldProvenance", type: "uint8", values: [3, 3, 3, 3] },
    { name: "VOLS.rootOutside", type: "uint8", values: [1] },
    { name: "VOLS.nodeStart", type: "uint32", values: [0] },
    { name: "VOLS.nodeCount", type: "uint32", values: [boxNodeCount] },
    { name: "VOLS.planes", type: "float32", values: boxPlanes.flatMap(normal => [...normal, boxHalfExtent]) },
    { name: "VOLS.front", type: "int32", values: boxPlanes.map(() => -1) },
    { name: "VOLS.back", type: "int32", values: boxPlanes.map((_, node) => node + 1 < boxNodeCount ? node + 1 : -1) },
    { name: "VOLS.nodeFlags", type: "uint8", values: boxPlanes.map(() => 0) },
    { name: "VOLS.vertexStart", type: "uint32", values: boxPlanes.map((_, node) => node * 4) },
    { name: "VOLS.vertexCount", type: "uint32", values: boxPlanes.map(() => 4) },
    { name: "VOLS.vertices", type: "float32", values: boxPlanes.flatMap(boxFacePolygon) },
    { name: "SMSH.vertexStart", type: "uint32", values: [0] },
    { name: "SMSH.vertexCount", type: "uint32", values: [4] },
    { name: "SMSH.indexStart", type: "uint32", values: [0] },
    { name: "SMSH.indexCount", type: "uint32", values: [6] },
    { name: "SMSH.positions", type: "float32", values: [0, 0, 0, 256, 0, 0, 256, 256, 0, 0, 256, 0] },
    { name: "SMSH.indices", type: "uint32", values: [0, 2, 1, 0, 3, 2] },
    { name: "PLAC.exportIndex", type: "uint32", values: [512] },
    { name: "PLAC.decision", type: "uint8", values: [1] },
    { name: "PLAC.mesh", type: "int32", values: [0] },
    { name: "PLAC.matrix", type: "float32", values: translatedMatrix(1500, -2500, 40) },
    { name: "MOVR.exportIndex", type: "uint32", values: [733] },
    { name: "MOVR.slot", type: "uint32", values: [0] },
    { name: "MOVR.collisionSource", type: "uint8", values: [0] },
    { name: "MOVR.mesh", type: "int32", values: [0] },
    { name: "MOVR.closedMatrix", type: "float32", values: identityMatrix },
    { name: "MOVR.openMatrix", type: "float32", values: translatedMatrix(0, 0, 136) },
    { name: "TERR.location", type: "float32", values: [-4096, -8192, 512] },
    { name: "TERR.terrainScale", type: "float32", values: [128, 128, 64] },
    { name: "TERR.heightmapSize", type: "uint32", values: [4, 4] },
    { name: "TERR.vertexRectangle", type: "uint32", values: [1, 1, 2, 2] },
    { name: "TERR.heights", type: "uint32", values: [32768, 32800, 32832, 32864] },
    { name: "TERR.quadVisibility", type: "uint8", values: [1] },
    { name: "TERR.edgeTurn", type: "uint8", values: [0] },
  ];
}

export function collisionBspTreeFixtureArrays(): TypedPayloadFixtureArray[] {
  return [
    { name: "BSPT.planes", type: "float32", values: [0, 0, 1, 0, 1, 0, 0, 512, 0, 1, 0, -512] },
    { name: "BSPT.front", type: "int32", values: [1, -1, -1] },
    { name: "BSPT.back", type: "int32", values: [2, -1, -1] },
    { name: "BSPT.coplanar", type: "int32", values: [-1, -1, -1] },
    { name: "BSPT.nodeFlags", type: "uint8", values: [0, 1, 32] },
    { name: "BSPT.numVertices", type: "uint8", values: [3, 0, 4] },
    { name: "BSPT.collisionBound", type: "int32", values: [0, -1, 8] },
    { name: "BSPT.vertexPool", type: "int32", values: [0, -1, 3] },
    { name: "BSPT.vertexPoints", type: "int32", values: [0, 1, 2, 0, 1, 2, 3] },
    { name: "BSPT.points", type: "float32", values: [0, 0, 0, 512, 0, 0, 512, 512, 0, 0, 512, 0] },
    { name: "BSPT.leafHulls", type: "int32", values: [0, -1, ...float32Words([0, 0, -1, 512, 512, 0]), 2, -1, ...float32Words([0, 0, 0, 512, 512, 1])] },
    { name: "BSPT.rootOutside", type: "uint8", values: [1] },
    { name: "BSPT.surfaceFlags", type: "uint32", values: [0, 32, 2147483648] },
  ];
}

export function replaceFixtureArray(arrays: readonly TypedPayloadFixtureArray[], name: string, values: readonly number[]): TypedPayloadFixtureArray[] {
  if (!arrays.some(array => array.name === name)) throw new Error(`Fixture has no array ${name}.`);
  return arrays.map(array => array.name === name ? { ...array, values } : array);
}

export function writeCollisionFixture(arrays: readonly TypedPayloadFixtureArray[]): TypedPayloadFixture {
  return writeTypedPayloadFixture(arrays, collisionFixtureMetadata);
}

export function readCollisionFixturePayload(arrays: readonly TypedPayloadFixtureArray[]): TypedPayload {
  const fixture = writeCollisionFixture(arrays);
  return readTypedPayload(JSON.parse(fixture.assetJsonText), fixture.payloadBytes);
}
