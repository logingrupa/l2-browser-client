export interface WorldResidencySettings {
  readonly visualRadiusMetres: number;
  readonly collisionRadiusMetres: number;
  readonly retainRadiusMetres: number;
  readonly lodCullDistanceMetres: number;
}

export interface WorldResidencyFootprint {
  readonly minimumX: number;
  readonly minimumZ: number;
  readonly maximumX: number;
  readonly maximumZ: number;
}

export interface WorldResidencyPoint {
  readonly x: number;
  readonly z: number;
}

export interface WorldResidencyChunk {
  readonly cellId: string;
  readonly footprint: WorldResidencyFootprint;
}

export interface WorldResidencyPlan {
  readonly visibleCellIds: readonly string[];
  readonly requiredCellIds: readonly string[];
  readonly retainedCellIds: readonly string[];
  readonly loadOrder: readonly string[];
}

export class WorldResidencyError extends Error {
  constructor(message: string) {
    super(`World residency: ${message}`);
    this.name = "WorldResidencyError";
  }
}

const visualRadiusChunkEdges = 1;
const collisionRadiusChunkEdges = 2;
const retainRadiusChunkEdges = 3;
const lodCullDistanceChunkEdges = 1;
const tileIdPattern = /^(\d{2})_(\d{2})$/;
const lastTileGridIndex = 99;

const compareCellIds = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export function validateWorldResidencySettings(settings: WorldResidencySettings): WorldResidencySettings {
  const { visualRadiusMetres, collisionRadiusMetres, retainRadiusMetres, lodCullDistanceMetres } = settings;
  if (![visualRadiusMetres, collisionRadiusMetres, retainRadiusMetres, lodCullDistanceMetres].every(Number.isFinite)) {
    throw new WorldResidencyError("every radius and the culling distance must be finite metres.");
  }
  if (!(visualRadiusMetres > 0 && visualRadiusMetres < collisionRadiusMetres && collisionRadiusMetres <= retainRadiusMetres)) {
    throw new WorldResidencyError(`rings must satisfy 0 < visual ${visualRadiusMetres} < collision ${collisionRadiusMetres} <= retain ${retainRadiusMetres}.`);
  }
  if (!(lodCullDistanceMetres > 0)) throw new WorldResidencyError(`the culling distance ${lodCullDistanceMetres} must be above zero.`);
  return settings;
}

export function worldResidencySettingsForChunkEdge(chunkEdgeMetres: number): WorldResidencySettings {
  if (!Number.isFinite(chunkEdgeMetres) || chunkEdgeMetres <= 0) throw new WorldResidencyError(`the chunk edge ${chunkEdgeMetres} must be finite metres above zero.`);
  return validateWorldResidencySettings({
    visualRadiusMetres: visualRadiusChunkEdges * chunkEdgeMetres, collisionRadiusMetres: collisionRadiusChunkEdges * chunkEdgeMetres,
    retainRadiusMetres: retainRadiusChunkEdges * chunkEdgeMetres, lodCullDistanceMetres: lodCullDistanceChunkEdges * chunkEdgeMetres,
  });
}

export function footprintDistanceMetres(point: WorldResidencyPoint, footprint: WorldResidencyFootprint): number {
  const outsideX = Math.max(footprint.minimumX - point.x, 0, point.x - footprint.maximumX);
  const outsideZ = Math.max(footprint.minimumZ - point.z, 0, point.z - footprint.maximumZ);
  return Math.hypot(outsideX, outsideZ);
}

export function planWorldResidency(chunks: readonly WorldResidencyChunk[], focus: WorldResidencyPoint, settings: WorldResidencySettings): WorldResidencyPlan {
  const measured = chunks.map(chunk => ({ cellId: chunk.cellId, distance: footprintDistanceMetres(focus, chunk.footprint) }))
    .sort((left, right) => left.distance - right.distance || compareCellIds(left.cellId, right.cellId));
  const cellIdsWithin = (radius: number) => measured.filter(entry => entry.distance <= radius).map(entry => entry.cellId);
  const sortedCellIdsWithin = (radius: number) => cellIdsWithin(radius).sort(compareCellIds);
  return {
    visibleCellIds: sortedCellIdsWithin(settings.visualRadiusMetres),
    requiredCellIds: sortedCellIdsWithin(settings.collisionRadiusMetres),
    retainedCellIds: sortedCellIdsWithin(settings.retainRadiusMetres),
    loadOrder: cellIdsWithin(settings.collisionRadiusMetres),
  };
}

const tileGridPart = (index: number) => String(index).padStart(2, "0");

export function neighbouringTileIds(tileId: string): readonly string[] {
  const match = tileIdPattern.exec(tileId);
  if (match === null) throw new WorldResidencyError(`tile id ${JSON.stringify(tileId)} is not XX_YY.`);
  const column = Number(match[1]), row = Number(match[2]);
  const neighbours: string[] = [];
  for (const columnStep of [-1, 0, 1]) {
    for (const rowStep of [-1, 0, 1]) {
      const neighbourColumn = column + columnStep, neighbourRow = row + rowStep;
      if ((columnStep === 0 && rowStep === 0) || neighbourColumn < 0 || neighbourRow < 0 || neighbourColumn > lastTileGridIndex || neighbourRow > lastTileGridIndex) continue;
      neighbours.push(`${tileGridPart(neighbourColumn)}_${tileGridPart(neighbourRow)}`);
    }
  }
  return neighbours.sort(compareCellIds);
}
