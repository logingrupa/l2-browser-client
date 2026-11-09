import type { RandomStream } from "../../../shared/random";
import { DIRECTION_USAGE_NONE, PARTICLE_CONSTANTS } from "./emitterConstants";
import type { SpriteEmitterRecord } from "./emitterRecords";
import { relativeParticleAge } from "./particleCurves";
import { createParticleEmitterSimulation, type ParticleEmitterSimulation } from "./particleEmitter";
import { readSlotVector } from "./particleState";

export interface SpriteAtlasCell {
  readonly cell: number;
  readonly column: number;
  readonly row: number;
  readonly nextCell: number;
  readonly blendWeight: number;
}

export interface SpriteEmitterSimulation extends ParticleEmitterSimulation {
  readonly kind: "sprite";
  readonly record: SpriteEmitterRecord;
  spriteRoll(slot: number): number;
  atlasCell(slot: number): SpriteAtlasCell;
}

const colorByteScale = PARTICLE_CONSTANTS.colorCurveByteScale.runtimeDefault;

function subdivisionBlendByte(atlasPosition: number): number {
  return Math.trunc(Math.fround(atlasPosition - Math.floor(atlasPosition)) * colorByteScale);
}

export function createSpriteEmitterSimulation(record: SpriteEmitterRecord, stream: RandomStream): SpriteEmitterSimulation {
  const simulation = createParticleEmitterSimulation(record, stream, record.UniformSize || record.UseDirectionAs === DIRECTION_USAGE_NONE);
  const { columns } = simulation;
  const columnCount = Math.max(1, record.TextureUSubdivisions), rowCount = Math.max(1, record.TextureVSubdivisions);
  const lastCell = columnCount * rowCount - 1;
  const atlasCellAt = (cell: number, nextCell: number, blendWeight: number): SpriteAtlasCell =>
    ({ cell, column: Math.floor(cell / rowCount), row: cell % rowCount, nextCell, blendWeight });
  return {
    ...simulation,
    kind: "sprite",
    record,
    spriteRoll(slot) {
      if (!record.SpinParticles) return 0;
      return readSlotVector(columns.startSpin, slot).z + columns.time[slot]! * readSlotVector(columns.spinRate, slot).z;
    },
    atlasCell(slot) {
      const randomCell = columns.subdivision[slot]!;
      if (randomCell >= 0) return atlasCellAt(Math.min(randomCell, lastCell), Math.min(randomCell, lastCell), 0);
      const rangeSet = record.SubdivisionEnd !== 0;
      const cellCount = rangeSet ? Math.max(1, record.SubdivisionEnd - record.SubdivisionStart) : lastCell + 1;
      const firstCell = rangeSet ? record.SubdivisionStart : 0;
      const position = Math.fround(Math.fround(relativeParticleAge(columns.time[slot]!, columns.maxLifetime[slot]!)) * cellCount);
      const cell = Math.min(Math.max(Math.floor(position) + firstCell, 0), lastCell);
      const nextCell = cell + 1 === cellCount ? cell : cell + 1;
      return atlasCellAt(cell, nextCell, record.BlendBetweenSubdivisions ? subdivisionBlendByte(position) / colorByteScale : 0);
    },
  };
}
