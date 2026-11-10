import type { RandomStream } from "../../../shared/random";
import type { MeshEmitterRecord, Rotator } from "./emitterRecords";
import { createParticleEmitterSimulation, type ParticleEmitterSimulation } from "./particleEmitter";
import { IDENTITY_ROTATOR } from "./particleRotation";
import { readSlotVector } from "./particleState";

export type MeshMaterialRoute =
  | { readonly kind: "mesh-materials"; readonly renderTwoSided: boolean; readonly ignoresParticleColor: true }
  | { readonly kind: "particle-draw-style"; readonly drawStyle: number; readonly renderTwoSided: boolean };

export interface MeshEmitterSimulation extends ParticleEmitterSimulation {
  readonly kind: "mesh";
  readonly record: MeshEmitterRecord;
  readonly staticMesh: string | null;
  readonly materialRoute: MeshMaterialRoute;
  meshRotator(slot: number): Rotator;
}

export function meshMaterialRoute(record: MeshEmitterRecord): MeshMaterialRoute {
  return record.UseMeshBlendMode
    ? { kind: "mesh-materials", renderTwoSided: record.RenderTwoSided, ignoresParticleColor: true }
    : { kind: "particle-draw-style", drawStyle: record.DrawStyle, renderTwoSided: record.RenderTwoSided };
}

export function createMeshEmitterSimulation(record: MeshEmitterRecord, stream: RandomStream): MeshEmitterSimulation {
  const simulation = createParticleEmitterSimulation(record, stream, record.UniformSize);
  return Object.assign(simulation as ParticleEmitterSimulation & { readonly record: MeshEmitterRecord }, {
    kind: "mesh" as const,
    staticMesh: record.StaticMesh,
    materialRoute: meshMaterialRoute(record),
    meshRotator(slot: number) {
      const { columns } = simulation;
      if (!record.SpinParticles) return IDENTITY_ROTATOR;
      const startSpin = readSlotVector(columns.startSpin, slot), spinRate = readSlotVector(columns.spinRate, slot), time = columns.time[slot]!;
      return {
        yaw: Math.trunc(startSpin.x + time * spinRate.x),
        pitch: Math.trunc(startSpin.y + time * spinRate.y),
        roll: Math.trunc(startSpin.z + time * spinRate.z),
      };
    },
  });
}
