import { describe, expect, it } from "vitest";
import {
  sourceHeadingToWorldYaw,
  sourcePositionToWorld,
  worldPositionToSource,
  worldYawToSourceHeading,
} from "../../src/world/sourceFrame";
import { headingOfDirection } from "../../src/scene/world/movement/core/pawnRotation";

const visualRootForward = { x: 0, y: 0, z: 1 };

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
});

describe("source frame headings", () => {
  it("points heading 0 along world +X", () => {
    const facing = babylonYawRotation(sourceHeadingToWorldYaw(0), visualRootForward);
    expect(facing.x).toBeCloseTo(1, 12);
    expect(facing.z).toBeCloseTo(0, 12);
  });

  it("points heading 16384 along the world axis that source +Y maps to", () => {
    const sourcePlusY = sourcePositionToWorld({ x: 0, y: 100, z: 0 });
    const facing = babylonYawRotation(sourceHeadingToWorldYaw(16384), visualRootForward);
    expect(facing.x).toBeCloseTo(sourcePlusY.x, 12);
    expect(facing.y).toBeCloseTo(sourcePlusY.y, 12);
    expect(facing.z).toBeCloseTo(sourcePlusY.z, 12);
  });

  it("faces the visual root forward along every source movement direction the pawn heading is taken from", () => {
    for (const [sourceX, sourceY] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-3, 2]]) {
      const facing = babylonYawRotation(sourceHeadingToWorldYaw(headingOfDirection({ x: sourceX!, y: sourceY!, z: 0 })), visualRootForward);
      const movement = sourcePositionToWorld({ x: sourceX!, y: sourceY!, z: 0 }), movementLength = Math.hypot(movement.x, movement.z);
      expect(facing.x).toBeCloseTo(movement.x / movementLength, 4);
      expect(facing.z).toBeCloseTo(movement.z / movementLength, 4);
    }
  });

  it("inverts every heading modulo 65536", () => {
    for (let heading = -65536; heading < 131072; heading += 7) {
      expect(worldYawToSourceHeading(sourceHeadingToWorldYaw(heading))).toBe(((heading % 65536) + 65536) % 65536);
    }
    expect(worldYawToSourceHeading(sourceHeadingToWorldYaw(65535))).toBe(65535);
  });
});
