import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  sourceHeadingToWorldYaw,
  sourcePositionToWorld,
  sourceRotationToWorld,
  worldPositionToSource,
  worldYawToSourceHeading,
  type RotationMatrix,
} from "../../src/world/sourceFrame";

interface DebugLocationRecipe { referenceActor: string; staticActorOriginZ: [number, number]; description: string }

const debugLocationRecipe = JSON.parse(readFileSync(new URL("../../recipes/native-map-debug-location.json", import.meta.url), "utf8")) as DebugLocationRecipe;
const playerStart10SectionMatch = /Native XY\[(-?\d+),(-?\d+)\]\.\.\[(-?\d+),(-?\d+)\]/.exec(debugLocationRecipe.description)!;
const playerStart10Corners = [
  { x: Number(playerStart10SectionMatch[1]), y: Number(playerStart10SectionMatch[2]) },
  { x: Number(playerStart10SectionMatch[3]), y: Number(playerStart10SectionMatch[4]) },
];

function rotateVector(matrix: RotationMatrix, vector: { x: number; y: number; z: number }) {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
    y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
    z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z,
  };
}

function babylonYawRotation(yaw: number, vector: { x: number; y: number; z: number }) {
  return { x: Math.cos(yaw) * vector.x + Math.sin(yaw) * vector.z, y: vector.y, z: -Math.sin(yaw) * vector.x + Math.cos(yaw) * vector.z };
}

describe("source frame positions", () => {
  it("maps source (X, Y, Z) to world (x, z, y) * 0.01", () => {
    expect(sourcePositionToWorld({ x: 100, y: 200, z: 300 })).toEqual({ x: 1, y: 3, z: 2 });
  });

  it("maps world (x, y, z) to source (x, z, y) * 100", () => {
    expect(worldPositionToSource({ x: 1, y: 3, z: 2 })).toEqual({ x: 100, y: 200, z: 300 });
    expect(worldPositionToSource({ x: 212, y: -30, z: 794 })).toEqual({ x: 21200, y: 79400, z: -3000 });
  });

  it("keeps every float32 source value through a round trip", () => {
    const sourceValues = [0, -0, 1, -1, 0.1, 12345.678, -3999.99, 98176, 3.4028234663852886e38, 1.401298464324817e-45, 1.1754943508222875e-38]
      .map(value => Math.fround(value));
    for (const value of sourceValues) {
      const roundTrip = worldPositionToSource(sourcePositionToWorld({ x: value, y: -value, z: value }));
      expect([Math.fround(roundTrip.x), Math.fround(roundTrip.y), Math.fround(roundTrip.z)]).toEqual([value, -value, value]);
    }
  });

  it("round-trips the PlayerStart10 section corners and Z window pinned in recipes/native-map-debug-location.json", () => {
    expect(debugLocationRecipe.referenceActor).toBe("20_20.PlayerStart10");
    expect(playerStart10Corners).toEqual([{ x: 8192, y: 92160 }, { x: 14336, y: 98176 }]);
    for (const [corner, z] of playerStart10Corners.flatMap(corner => debugLocationRecipe.staticActorOriginZ.map(z => [corner, z] as const))) {
      const sourcePosition = { x: corner.x, y: corner.y, z };
      const roundTrip = worldPositionToSource(sourcePositionToWorld(sourcePosition));
      expect({ x: Math.fround(roundTrip.x), y: Math.fround(roundTrip.y), z: Math.fround(roundTrip.z) }).toEqual(sourcePosition);
    }
  });
});

describe("source frame rotations", () => {
  const quarterTurnAboutSourceZ: RotationMatrix = [0, -1, 0, 1, 0, 0, 0, 0, 1];

  it("conjugates a rotation by the same axis reflection", () => {
    const worldRotation = sourceRotationToWorld(quarterTurnAboutSourceZ);
    for (const sourceVector of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0.3, y: -2, z: 5 }]) {
      const throughSource = sourcePositionToWorld(rotateVector(quarterTurnAboutSourceZ, sourceVector));
      const throughWorld = rotateVector(worldRotation, sourcePositionToWorld(sourceVector));
      expect(throughWorld.x).toBeCloseTo(throughSource.x, 12);
      expect(throughWorld.y).toBeCloseTo(throughSource.y, 12);
      expect(throughWorld.z).toBeCloseTo(throughSource.z, 12);
    }
  });

  it("is its own inverse when applied twice", () => {
    const rotation: RotationMatrix = [0.36, 0.48, -0.8, -0.8, 0.6, 0, 0.48, 0.64, 0.6];
    expect(sourceRotationToWorld(sourceRotationToWorld(rotation))).toEqual(rotation);
  });
});

describe("source frame headings", () => {
  it("points heading 0 along world +X", () => {
    const facing = babylonYawRotation(sourceHeadingToWorldYaw(0), { x: 1, y: 0, z: 0 });
    expect(facing.x).toBeCloseTo(1, 12);
    expect(facing.z).toBeCloseTo(0, 12);
  });

  it("points heading 16384 along the world axis that source +Y maps to", () => {
    const sourcePlusY = sourcePositionToWorld({ x: 0, y: 100, z: 0 });
    const facing = babylonYawRotation(sourceHeadingToWorldYaw(16384), { x: 1, y: 0, z: 0 });
    expect(facing.x).toBeCloseTo(sourcePlusY.x, 12);
    expect(facing.y).toBeCloseTo(sourcePlusY.y, 12);
    expect(facing.z).toBeCloseTo(sourcePlusY.z, 12);
  });

  it("inverts every heading modulo 65536", () => {
    for (let heading = -65536; heading < 131072; heading += 7) {
      expect(worldYawToSourceHeading(sourceHeadingToWorldYaw(heading))).toBe(((heading % 65536) + 65536) % 65536);
    }
    expect(worldYawToSourceHeading(sourceHeadingToWorldYaw(65535))).toBe(65535);
  });
});
