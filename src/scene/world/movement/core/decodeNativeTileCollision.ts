import type { TypedPayload } from "../../../../shared/typedPayload";
import type {
  CollisionBspTree, CollisionCell, CollisionMover, CollisionMoverSource, CollisionPhysicsFieldProvenance, CollisionPlacement, CollisionPlacementDecision,
  CollisionSourceVector, CollisionStaticMesh, CollisionTerrain, CollisionTransformProvenance, CollisionVolume, CollisionVolumeDecision, CollisionVolumeKind,
  CollisionVolumeNode, CollisionVolumePhysicsFieldProvenance,
} from "./collisionCell";
import { CollisionWorldError } from "./collisionWorld";

export interface CollisionCellIdentity {
  readonly cellId: string;
  readonly tileId: string;
}

type TypedArrayView = Float32Array | Int32Array | Uint32Array | Uint8Array;

const volumeKindByCode: readonly CollisionVolumeKind[] = ["blocking", "physics"];
const volumeDecisionByCode: readonly CollisionVolumeDecision[] = ["declared-none", "blocking", "gap"];
const placementDecisionByCode: readonly CollisionPlacementDecision[] = ["declared-none", "slots", "gap"];
const transformProvenanceByCode: readonly CollisionTransformProvenance[] = ["authored", "class-default", "ue-zero"];
const physicsFieldProvenanceByCode: readonly CollisionPhysicsFieldProvenance[] = ["authored", "class-default", "ue-zero", "unresolved"];
const volumePhysicsFieldCount = 4;
const moverSourceByCode: readonly CollisionMoverSource[] = ["static-slot-enable-collision"];
const volumeTransformFieldCount = 5;
const matrixElementCount = 16;
const noIndex = -1;
const leafHullBoxWordCount = 6;

export function leafHullBoxFloats(leafHulls: Int32Array, boxStart: number): Float32Array {
  return new Float32Array(Int32Array.from(leafHulls.subarray(boxStart, boxStart + leafHullBoxWordCount)).buffer);
}

function requireCollision(condition: boolean, owner: string, field: string, message: string): asserts condition {
  if (!condition) throw new CollisionWorldError(`${owner} ${field} ${message}`);
}

function requireCount(owner: string, field: string, view: TypedArrayView, expectedCount: number): void {
  requireCollision(view.length === expectedCount, owner, field, `holds ${view.length} values; ${expectedCount} are declared.`);
}

function requireIndexRange(owner: string, field: string, view: Int32Array, lowestIndex: number, indexLimit: number): void {
  const index = view.findIndex(value => value < lowestIndex || value >= indexLimit);
  requireCollision(index < 0, owner, `${field}[${index}]`, `= ${view[index]} is outside ${lowestIndex} to ${indexLimit - 1}.`);
}

function requireContiguousRanges(owner: string, startField: string, starts: Uint32Array, counts: Uint32Array, total: number): void {
  let expectedStart = 0;
  starts.forEach((start, index) => {
    requireCollision(start === expectedStart, owner, `${startField}[${index}]`, `= ${start}; the packed layout puts it at ${expectedStart}.`);
    expectedStart += counts[index]!;
  });
  requireCollision(expectedStart === total, owner, startField, `ranges cover ${expectedStart} entries of ${total}.`);
}

function decodeCode<Name>(owner: string, field: string, names: readonly Name[], code: number, index: number): Name {
  const name = names[code];
  requireCollision(name !== undefined, owner, `${field}[${index}]`, `holds the unknown code ${code}.`);
  return name;
}

function decodeBoolean(owner: string, field: string, value: number, index: number): boolean {
  requireCollision(value === 0 || value === 1, owner, `${field}[${index}]`, `must be 0 or 1, not ${value}.`);
  return value === 1;
}

const sourceVector = (view: Float32Array | Int32Array, index: number): CollisionSourceVector =>
  [view[index * 3]!, view[index * 3 + 1]!, view[index * 3 + 2]!];

function requireTraceableVolume(volumeOwner: string, drawScale: number, drawScale3D: CollisionSourceVector, nodes: readonly CollisionVolumeNode[]): void {
  requireCollision(drawScale !== 0 && drawScale3D.every(scale => scale !== 0), volumeOwner, "VOLS.drawScale",
    `${drawScale} by VOLS.drawScale3D ${drawScale3D.join(",")} is singular for a volume with ${nodes.length} nodes.`);
  requireCollision(nodes.some(node => node.polygon.length > 0), volumeOwner, "VOLS.vertexCount",
    `is 0 for all ${nodes.length} nodes, so the volume has no hull box.`);
}

type VolumePhysicsFields = Pick<CollisionVolume, "water" | "priority" | "gravity" | "terminalVelocity" | "physicsFieldProvenance">;

function volumePhysicsFieldReader(payload: TypedPayload, owner: string, volumeCount: number): (volumeIndex: number) => VolumePhysicsFields {
  const water = payload.uint8("VOLS.water"), priority = payload.int32("VOLS.priority"), gravity = payload.float32("VOLS.gravity");
  const terminalVelocity = payload.float32("VOLS.terminalVelocity"), provenance = payload.uint8("VOLS.physicsFieldProvenance");
  for (const [field, view] of [["VOLS.water", water], ["VOLS.priority", priority], ["VOLS.terminalVelocity", terminalVelocity]] as const) {
    requireCount(owner, field, view, volumeCount);
  }
  requireCount(owner, "VOLS.gravity", gravity, volumeCount * 3);
  requireCount(owner, "VOLS.physicsFieldProvenance", provenance, volumeCount * volumePhysicsFieldCount);
  for (const [field, view] of [["VOLS.gravity", gravity], ["VOLS.terminalVelocity", terminalVelocity]] as const) {
    const index = view.findIndex(value => !Number.isFinite(value));
    requireCollision(index < 0, owner, `${field}[${index}]`, `= ${view[index]} is not finite.`);
  }
  return volumeIndex => {
    const fieldProvenance = (fieldIndex: number) => {
      const index = volumeIndex * volumePhysicsFieldCount + fieldIndex;
      return decodeCode(owner, "VOLS.physicsFieldProvenance", physicsFieldProvenanceByCode, provenance[index]!, index);
    };
    const physicsFieldProvenance: CollisionVolumePhysicsFieldProvenance = {
      water: fieldProvenance(0), priority: fieldProvenance(1), gravity: fieldProvenance(2), terminalVelocity: fieldProvenance(3),
    };
    const waterFlag = decodeBoolean(owner, "VOLS.water", water[volumeIndex]!, volumeIndex);
    return {
      water: physicsFieldProvenance.water === "unresolved" ? null : waterFlag,
      priority: physicsFieldProvenance.priority === "unresolved" ? null : priority[volumeIndex]!,
      gravity: physicsFieldProvenance.gravity === "unresolved" ? null : sourceVector(gravity, volumeIndex),
      terminalVelocity: physicsFieldProvenance.terminalVelocity === "unresolved" ? null : terminalVelocity[volumeIndex]!,
      physicsFieldProvenance,
    };
  };
}

function decodeVolumes(payload: TypedPayload, owner: string): CollisionVolume[] {
  const exportIndex = payload.uint32("VOLS.exportIndex"), volumeCount = exportIndex.length;
  const kind = payload.uint8("VOLS.kind"), decision = payload.uint8("VOLS.decision"), location = payload.float32("VOLS.location");
  const rotation = payload.int32("VOLS.rotation"), drawScale = payload.float32("VOLS.drawScale"), drawScale3D = payload.float32("VOLS.drawScale3D");
  const prePivot = payload.float32("VOLS.prePivot"), transformProvenance = payload.uint8("VOLS.transformProvenance");
  const rootOutside = payload.uint8("VOLS.rootOutside"), nodeStart = payload.uint32("VOLS.nodeStart"), nodeCount = payload.uint32("VOLS.nodeCount");
  for (const [field, view] of [["VOLS.kind", kind], ["VOLS.decision", decision], ["VOLS.drawScale", drawScale], ["VOLS.rootOutside", rootOutside],
    ["VOLS.nodeStart", nodeStart], ["VOLS.nodeCount", nodeCount]] as const) requireCount(owner, field, view, volumeCount);
  for (const [field, view] of [["VOLS.location", location], ["VOLS.rotation", rotation], ["VOLS.drawScale3D", drawScale3D],
    ["VOLS.prePivot", prePivot]] as const) requireCount(owner, field, view, volumeCount * 3);
  requireCount(owner, "VOLS.transformProvenance", transformProvenance, volumeCount * volumeTransformFieldCount);
  const physicsFields = volumePhysicsFieldReader(payload, owner, volumeCount);
  const planes = payload.float32("VOLS.planes"), front = payload.int32("VOLS.front"), back = payload.int32("VOLS.back");
  const nodeFlags = payload.uint8("VOLS.nodeFlags"), vertexStart = payload.uint32("VOLS.vertexStart"), vertexCount = payload.uint32("VOLS.vertexCount");
  const vertices = payload.float32("VOLS.vertices"), totalNodeCount = front.length;
  requireCount(owner, "VOLS.planes", planes, totalNodeCount * 4);
  for (const [field, view] of [["VOLS.back", back], ["VOLS.nodeFlags", nodeFlags], ["VOLS.vertexStart", vertexStart],
    ["VOLS.vertexCount", vertexCount]] as const) requireCount(owner, field, view, totalNodeCount);
  requireCollision(vertices.length % 3 === 0, owner, "VOLS.vertices", `holds ${vertices.length} values, not whole points.`);
  requireContiguousRanges(owner, "VOLS.nodeStart", nodeStart, nodeCount, totalNodeCount);
  requireContiguousRanges(owner, "VOLS.vertexStart", vertexStart, vertexCount, vertices.length / 3);
  const provenance = (volumeIndex: number, fieldIndex: number) =>
    decodeCode(owner, "VOLS.transformProvenance", transformProvenanceByCode, transformProvenance[volumeIndex * volumeTransformFieldCount + fieldIndex]!,
      volumeIndex * volumeTransformFieldCount + fieldIndex);
  return Array.from(exportIndex, (volumeExportIndex, volumeIndex): CollisionVolume => {
    const firstNode = nodeStart[volumeIndex]!, volumeNodeCount = nodeCount[volumeIndex]!;
    const volumeOwner = `${owner} volume ${volumeIndex}`;
    requireIndexRange(volumeOwner, "VOLS.front", front.subarray(firstNode, firstNode + volumeNodeCount), noIndex, volumeNodeCount);
    requireIndexRange(volumeOwner, "VOLS.back", back.subarray(firstNode, firstNode + volumeNodeCount), noIndex, volumeNodeCount);
    const nodes = Array.from({ length: volumeNodeCount }, (_, offset): CollisionVolumeNode => {
      const node = firstNode + offset, firstVertex = vertexStart[node]!;
      return {
        plane: [planes[node * 4]!, planes[node * 4 + 1]!, planes[node * 4 + 2]!, planes[node * 4 + 3]!],
        front: front[node]!, back: back[node]!, nodeFlags: nodeFlags[node]!,
        polygon: vertices.subarray(firstVertex * 3, (firstVertex + vertexCount[node]!) * 3),
      };
    });
    if (volumeNodeCount > 0) requireTraceableVolume(volumeOwner, drawScale[volumeIndex]!, sourceVector(drawScale3D, volumeIndex), nodes);
    return {
      exportIndex: volumeExportIndex,
      kind: decodeCode(owner, "VOLS.kind", volumeKindByCode, kind[volumeIndex]!, volumeIndex),
      decision: decodeCode(owner, "VOLS.decision", volumeDecisionByCode, decision[volumeIndex]!, volumeIndex),
      location: sourceVector(location, volumeIndex), rotation: sourceVector(rotation, volumeIndex), drawScale: drawScale[volumeIndex]!,
      drawScale3D: sourceVector(drawScale3D, volumeIndex), prePivot: sourceVector(prePivot, volumeIndex),
      transformProvenance: {
        location: provenance(volumeIndex, 0), rotation: provenance(volumeIndex, 1), drawScale: provenance(volumeIndex, 2),
        drawScale3D: provenance(volumeIndex, 3), prePivot: provenance(volumeIndex, 4),
      },
      ...physicsFields(volumeIndex),
      rootOutside: decodeBoolean(owner, "VOLS.rootOutside", rootOutside[volumeIndex]!, volumeIndex),
      nodes,
    };
  });
}

function decodeStaticMeshes(payload: TypedPayload, owner: string): CollisionStaticMesh[] {
  const vertexStart = payload.uint32("SMSH.vertexStart"), vertexCount = payload.uint32("SMSH.vertexCount");
  const indexStart = payload.uint32("SMSH.indexStart"), indexCount = payload.uint32("SMSH.indexCount");
  const positions = payload.float32("SMSH.positions"), indices = payload.uint32("SMSH.indices"), meshCount = vertexStart.length;
  for (const [field, view] of [["SMSH.vertexCount", vertexCount], ["SMSH.indexStart", indexStart], ["SMSH.indexCount", indexCount]] as const) {
    requireCount(owner, field, view, meshCount);
  }
  requireCollision(positions.length % 3 === 0, owner, "SMSH.positions", `holds ${positions.length} values, not whole points.`);
  requireContiguousRanges(owner, "SMSH.vertexStart", vertexStart, vertexCount, positions.length / 3);
  requireContiguousRanges(owner, "SMSH.indexStart", indexStart, indexCount, indices.length);
  return Array.from(vertexStart, (firstVertex, meshIndex): CollisionStaticMesh => {
    const meshVertexCount = vertexCount[meshIndex]!, firstIndex = indexStart[meshIndex]!, meshIndexCount = indexCount[meshIndex]!;
    requireCollision(meshIndexCount % 3 === 0, owner, `SMSH.indexCount[${meshIndex}]`, `= ${meshIndexCount} is not whole triangles.`);
    const meshIndices = indices.subarray(firstIndex, firstIndex + meshIndexCount);
    const outsideIndex = meshIndices.findIndex(index => index >= meshVertexCount);
    requireCollision(outsideIndex < 0, owner, `SMSH.indices[${firstIndex + outsideIndex}]`,
      `= ${meshIndices[outsideIndex]} is outside the ${meshVertexCount} vertices of mesh ${meshIndex}.`);
    return { positions: positions.subarray(firstVertex * 3, (firstVertex + meshVertexCount) * 3), indices: meshIndices };
  });
}

function decodePlacements(payload: TypedPayload, owner: string, staticMeshCount: number): CollisionPlacement[] {
  const exportIndex = payload.uint32("PLAC.exportIndex"), decision = payload.uint8("PLAC.decision");
  const mesh = payload.int32("PLAC.mesh"), matrix = payload.float32("PLAC.matrix"), placementCount = exportIndex.length;
  requireCount(owner, "PLAC.decision", decision, placementCount);
  requireCount(owner, "PLAC.mesh", mesh, placementCount);
  requireCount(owner, "PLAC.matrix", matrix, placementCount * matrixElementCount);
  requireIndexRange(owner, "PLAC.mesh", mesh, noIndex, staticMeshCount);
  return Array.from(exportIndex, (placementExportIndex, placementIndex): CollisionPlacement => ({
    exportIndex: placementExportIndex,
    decision: decodeCode(owner, "PLAC.decision", placementDecisionByCode, decision[placementIndex]!, placementIndex),
    staticMeshIndex: mesh[placementIndex] === noIndex ? null : mesh[placementIndex]!,
    matrix: matrix.subarray(placementIndex * matrixElementCount, (placementIndex + 1) * matrixElementCount),
  }));
}

function decodeMovers(payload: TypedPayload, owner: string, staticMeshCount: number): CollisionMover[] {
  const exportIndex = payload.uint32("MOVR.exportIndex"), slot = payload.uint32("MOVR.slot"), collisionSource = payload.uint8("MOVR.collisionSource");
  const mesh = payload.int32("MOVR.mesh"), closedMatrix = payload.float32("MOVR.closedMatrix"), openMatrix = payload.float32("MOVR.openMatrix");
  const moverCount = exportIndex.length;
  for (const [field, view] of [["MOVR.slot", slot], ["MOVR.collisionSource", collisionSource], ["MOVR.mesh", mesh]] as const) {
    requireCount(owner, field, view, moverCount);
  }
  requireCount(owner, "MOVR.closedMatrix", closedMatrix, moverCount * matrixElementCount);
  requireCount(owner, "MOVR.openMatrix", openMatrix, moverCount * matrixElementCount);
  requireIndexRange(owner, "MOVR.mesh", mesh, 0, staticMeshCount);
  return Array.from(exportIndex, (moverExportIndex, moverIndex): CollisionMover => ({
    exportIndex: moverExportIndex, slot: slot[moverIndex]!,
    collisionSource: decodeCode(owner, "MOVR.collisionSource", moverSourceByCode, collisionSource[moverIndex]!, moverIndex),
    staticMeshIndex: mesh[moverIndex]!,
    closedMatrix: closedMatrix.subarray(moverIndex * matrixElementCount, (moverIndex + 1) * matrixElementCount),
    openMatrix: openMatrix.subarray(moverIndex * matrixElementCount, (moverIndex + 1) * matrixElementCount),
  }));
}

function decodeTerrain(payload: TypedPayload, owner: string): CollisionTerrain | null {
  const location = payload.float32("TERR.location"), terrainScale = payload.float32("TERR.terrainScale");
  const heightmapSize = payload.uint32("TERR.heightmapSize"), vertexRectangle = payload.uint32("TERR.vertexRectangle");
  const heights = payload.uint32("TERR.heights"), quadVisibility = payload.uint8("TERR.quadVisibility"), edgeTurn = payload.uint8("TERR.edgeTurn");
  const views = [location, terrainScale, heightmapSize, vertexRectangle, heights, quadVisibility, edgeTurn];
  if (views.every(view => view.length === 0)) return null;
  requireCount(owner, "TERR.location", location, 3);
  requireCount(owner, "TERR.terrainScale", terrainScale, 3);
  requireCount(owner, "TERR.heightmapSize", heightmapSize, 2);
  requireCount(owner, "TERR.vertexRectangle", vertexRectangle, 4);
  requireCollision(terrainScale.every(scale => scale > 0), owner, "TERR.terrainScale", `= ${terrainScale.join(",")} is not positive on every axis.`);
  const heightmapWidth = heightmapSize[0]!, heightmapHeight = heightmapSize[1]!;
  const firstColumn = vertexRectangle[0]!, firstRow = vertexRectangle[1]!, columns = vertexRectangle[2]!, rows = vertexRectangle[3]!;
  requireCollision(firstColumn + columns <= heightmapWidth && firstRow + rows <= heightmapHeight, owner, "TERR.vertexRectangle",
    `${firstColumn},${firstRow} ${columns}x${rows} leaves the ${heightmapWidth}x${heightmapHeight} heightmap.`);
  requireCount(owner, "TERR.heights", heights, columns * rows);
  const quadCount = Math.max(columns - 1, 0) * Math.max(rows - 1, 0);
  requireCount(owner, "TERR.quadVisibility", quadVisibility, quadCount);
  requireCount(owner, "TERR.edgeTurn", edgeTurn, quadCount);
  quadVisibility.forEach((bit, quadIndex) => decodeBoolean(owner, "TERR.quadVisibility", bit, quadIndex));
  edgeTurn.forEach((bit, quadIndex) => decodeBoolean(owner, "TERR.edgeTurn", bit, quadIndex));
  return {
    location: sourceVector(location, 0), terrainScale: sourceVector(terrainScale, 0), heightmapWidth, heightmapHeight,
    firstColumn, firstRow, columns, rows, heights, quadVisibility, edgeTurn,
  };
}

export function decodeNativeTileCollisionCell(payload: TypedPayload, identity: CollisionCellIdentity): CollisionCell {
  const owner = `cell ${identity.cellId}`;
  const staticMeshes = decodeStaticMeshes(payload, owner);
  return {
    cellId: identity.cellId,
    tileId: identity.tileId,
    volumes: decodeVolumes(payload, owner),
    staticMeshes,
    placements: decodePlacements(payload, owner, staticMeshes.length),
    terrain: decodeTerrain(payload, owner),
    movers: decodeMovers(payload, owner, staticMeshes.length),
  };
}

function requireLeafHullRun(owner: string, leafHulls: Int32Array, runStart: number): void {
  const field = `BSPT.leafHulls run at ${runStart}`;
  let terminatorIndex = runStart;
  while (terminatorIndex < leafHulls.length && leafHulls[terminatorIndex]! >= 0) terminatorIndex += 1;
  requireCollision(terminatorIndex < leafHulls.length, owner, field, "has no terminator.");
  const boxStart = terminatorIndex + 1;
  requireCollision(boxStart + leafHullBoxWordCount <= leafHulls.length, owner, field, "has no hull box.");
  requireCollision(leafHullBoxFloats(leafHulls, boxStart).every(Number.isFinite), owner, field, "holds a non-finite hull box.");
}

export function decodeNativeTileBspTree(payload: TypedPayload, tileId: string): CollisionBspTree {
  const owner = `tile ${tileId}`;
  const front = payload.int32("BSPT.front"), nodeCount = front.length;
  const planes = payload.float32("BSPT.planes"), back = payload.int32("BSPT.back"), coplanar = payload.int32("BSPT.coplanar");
  const nodeFlags = payload.uint8("BSPT.nodeFlags"), numVertices = payload.uint8("BSPT.numVertices");
  const collisionBound = payload.int32("BSPT.collisionBound"), vertexPool = payload.int32("BSPT.vertexPool");
  const vertexPoints = payload.int32("BSPT.vertexPoints"), points = payload.float32("BSPT.points"), leafHulls = payload.int32("BSPT.leafHulls");
  const rootOutside = payload.uint8("BSPT.rootOutside"), surfaceFlags = payload.uint32("BSPT.surfaceFlags");
  requireCount(owner, "BSPT.planes", planes, nodeCount * 4);
  for (const [field, view] of [["BSPT.back", back], ["BSPT.coplanar", coplanar], ["BSPT.nodeFlags", nodeFlags], ["BSPT.numVertices", numVertices],
    ["BSPT.collisionBound", collisionBound], ["BSPT.vertexPool", vertexPool], ["BSPT.surfaceFlags", surfaceFlags]] as const) {
    requireCount(owner, field, view, nodeCount);
  }
  requireCount(owner, "BSPT.rootOutside", rootOutside, 1);
  requireCollision(points.length % 3 === 0, owner, "BSPT.points", `holds ${points.length} values, not whole points.`);
  requireIndexRange(owner, "BSPT.front", front, noIndex, nodeCount);
  requireIndexRange(owner, "BSPT.back", back, noIndex, nodeCount);
  requireIndexRange(owner, "BSPT.coplanar", coplanar, noIndex, nodeCount);
  requireIndexRange(owner, "BSPT.collisionBound", collisionBound, noIndex, leafHulls.length);
  for (const runStart of new Set(collisionBound)) if (runStart !== noIndex) requireLeafHullRun(owner, leafHulls, runStart);
  const pointCount = points.length / 3;
  numVertices.forEach((nodeVertexCount, node) => {
    if (nodeVertexCount === 0) return;
    const firstVertex = vertexPool[node]!;
    requireCollision(firstVertex >= 0 && firstVertex + nodeVertexCount <= vertexPoints.length, owner, `BSPT.vertexPool[${node}]`,
      `= ${firstVertex} with ${nodeVertexCount} vertices leaves the ${vertexPoints.length} vertex points.`);
    for (let vertex = firstVertex; vertex < firstVertex + nodeVertexCount; vertex += 1) {
      const point = vertexPoints[vertex]!;
      requireCollision(point >= 0 && point < pointCount, owner, `BSPT.vertexPoints[${vertex}]`, `= ${point} is outside 0 to ${pointCount - 1}.`);
    }
  });
  return {
    nodeCount, planes, front, back, coplanar, nodeFlags, numVertices, collisionBound, vertexPool, vertexPoints, points, leafHulls,
    rootOutside: decodeBoolean(owner, "BSPT.rootOutside", rootOutside[0]!, 0), surfaceFlags,
  };
}
