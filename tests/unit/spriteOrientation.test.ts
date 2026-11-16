import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIRECTION_USAGE } from "../../src/effects/particles/sim/emitterConstants";
import {
  cameraFacingHalfExtents, orientedSpriteHalfAxes, realProjectionNormal, spriteFacesCamera, type SpriteHalfAxes,
} from "../../src/effects/particles/sim/spriteOrientation";
import { addVectors, scaleVector, subtractVectors, type Vector3 } from "../../src/shared/math/vector3";
import { PARTICLE_FIXTURE_FOLDER } from "./support/particleFixtures";

type FixtureVector = readonly [number, number, number];
interface SpriteOrientationCase {
  readonly case: string;
  readonly directionUsage: number;
  readonly location: FixtureVector;
  readonly oldLocation: FixtureVector;
  readonly camera: FixtureVector;
  readonly cameraUp: FixtureVector;
  readonly cameraRight: FixtureVector;
  readonly realProjectionNormal: FixtureVector;
  readonly workingProjectionNormal: FixtureVector;
  readonly size: FixtureVector;
  readonly vertices: readonly FixtureVector[];
}

const fixture = JSON.parse(readFileSync(`${PARTICLE_FIXTURE_FOLDER}/sprite-orientation-rm8.json`, "utf8")) as { readonly cases: readonly SpriteOrientationCase[] };
const float32MantissaBits = 23;
const vectorOf = ([x, y, z]: FixtureVector): Vector3 => ({ x, y, z });

function float32SpacingAt(magnitude: number): number {
  return 2 ** (Math.floor(Math.log2(magnitude)) - float32MantissaBits);
}

function halfAxesOf(row: SpriteOrientationCase): SpriteHalfAxes {
  const size = vectorOf(row.size);
  if (spriteFacesCamera(row.directionUsage)) {
    const extents = cameraFacingHalfExtents(row.directionUsage, size);
    return { up: scaleVector(vectorOf(row.cameraUp), extents.up), right: scaleVector(vectorOf(row.cameraRight), extents.right) };
  }
  return orientedSpriteHalfAxes({
    directionUsage: row.directionUsage, location: vectorOf(row.location), oldLocation: vectorOf(row.oldLocation), size,
    cameraLocation: vectorOf(row.camera), realProjectionNormal: vectorOf(row.realProjectionNormal), workingProjectionNormal: vectorOf(row.workingProjectionNormal),
  });
}

function nativeCornerOrder(location: Vector3, { up, right }: SpriteHalfAxes): Vector3[] {
  const below = subtractVectors(location, up), above = addVectors(location, up);
  return [subtractVectors(below, right), addVectors(below, right), subtractVectors(above, right), addVectors(above, right)];
}

describe("sprite orientation against the Engine.dll FillVertexBuffer fixtures", () => {
  it("covers all eight direction usages over nine cases", () => {
    expect(fixture.cases).toHaveLength(72);
    expect(new Set(fixture.cases.map(row => row.directionUsage))).toEqual(new Set(Object.values(DIRECTION_USAGE)));
  });

  it.each(fixture.cases.map(row => [row.case, row.directionUsage, row] as const))("%s, UseDirectionAs %s, lands on the emulated corners", (_name, _usage, row) => {
    const corners = nativeCornerOrder(vectorOf(row.location), halfAxesOf(row));
    const largestCoordinate = Math.max(...row.vertices.flat().map(Math.abs));
    const oneFloat32StepAtTheCase = largestCoordinate === 0 ? 0 : float32SpacingAt(largestCoordinate);
    corners.forEach((corner, cornerIndex) => {
      const [x, y, z] = row.vertices[cornerIndex]!;
      expect(Math.abs(corner.x - x)).toBeLessThanOrEqual(oneFloat32StepAtTheCase);
      expect(Math.abs(corner.y - y)).toBeLessThanOrEqual(oneFloat32StepAtTheCase);
      expect(Math.abs(corner.z - z)).toBeLessThanOrEqual(oneFloat32StepAtTheCase);
    });
  });
});

describe("sprite orientation edge rules", () => {
  const stillParticle = { location: { x: 1, y: 2, z: 3 }, oldLocation: { x: 1, y: 2, z: 3 }, size: { x: 2, y: 5, z: 9 }, cameraLocation: { x: 0, y: 0, z: 10 } };
  const normals = { realProjectionNormal: { x: 0, y: 0, z: 1 }, workingProjectionNormal: { x: 0, y: 0, z: 1 } };

  it("collapses a particle that did not move to a zero-area quad instead of facing the camera", () => {
    for (const directionUsage of [DIRECTION_USAGE.up, DIRECTION_USAGE.right, DIRECTION_USAGE.upAndNormal, DIRECTION_USAGE.rightAndNormal]) {
      const { up, right } = orientedSpriteHalfAxes({ directionUsage, ...stillParticle, ...normals });
      expect([up, right].some(axis => axis.x === 0 && axis.y === 0 && axis.z === 0)).toBe(true);
    }
  });

  it("gives zero axes past the last direction usage and refuses the camera-facing ones", () => {
    expect(orientedSpriteHalfAxes({ directionUsage: 8, ...stillParticle, ...normals })).toEqual({ up: { x: 0, y: 0, z: 0 }, right: { x: 0, y: 0, z: 0 } });
    expect(() => orientedSpriteHalfAxes({ directionUsage: DIRECTION_USAGE.none, ...stillParticle, ...normals })).toThrow("camera-facing");
    expect(() => orientedSpriteHalfAxes({ directionUsage: DIRECTION_USAGE.scale, ...stillParticle, ...normals })).toThrow("camera-facing");
  });

  it("sizes PTDU_None by Size.X on both axes and PTDU_Scale by Size.Y up and Size.X right", () => {
    expect(cameraFacingHalfExtents(DIRECTION_USAGE.none, { x: 2, y: 5, z: 9 })).toEqual({ up: 2, right: 2 });
    expect(cameraFacingHalfExtents(DIRECTION_USAGE.scale, { x: 2, y: 5, z: 9 })).toEqual({ up: 5, right: 2 });
  });

  it("safe-normalizes the authored ProjectionNormal and keeps a zero normal at zero", () => {
    const normal = realProjectionNormal({ x: 0, y: 3, z: 4 });
    expect(normal.x).toBe(0); expect(normal.y).toBeCloseTo(0.6, 15); expect(normal.z).toBeCloseTo(0.8, 15);
    expect(realProjectionNormal({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});
