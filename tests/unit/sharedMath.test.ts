import { describe, expect, it } from "vitest";
import {
  IDENTITY_AFFINE_MATRIX,
  invertAffineMatrix,
  inverseTransposeLinear,
  multiplyAffineMatrices,
  multiplyMatrix3Vector,
  transformDirection,
  transformPoint,
  type AffineMatrix,
} from "../../src/shared/math/affineMatrix";
import { planeDistance, planeFromNormalAndPoint, transformPlane } from "../../src/shared/math/plane";
import {
  ROTATOR_CONSTANTS,
  ROTATOR_RULE_BY_USE,
  rotatorSineExact,
  rotatorSineFromTable,
  rotatorUnitsToRadians,
} from "../../src/shared/math/rotator";
import { addVectors, crossProduct, dotProduct, normalizeVector, scaleVector, subtractVectors, vectorLength, type Vector3 } from "../../src/shared/math/vector3";

const float64Tolerance = 1e-12;
const shearedPlacement: AffineMatrix = {
  linear: [2, 0.5, 0, -0.25, 1.5, 0.75, 0.1, 0, 3],
  translation: { x: 120, y: -45, z: 7.5 },
};

function expectVectorClose(actual: Vector3, expected: Vector3, tolerance = float64Tolerance) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(tolerance);
  expect(Math.abs(actual.z - expected.z)).toBeLessThan(tolerance);
}

describe("vector math", () => {
  it("adds, subtracts, scales, dots and crosses plain vectors", () => {
    const left = { x: 1, y: 2, z: 3 }, right = { x: -4, y: 0.5, z: 2 };
    expect(addVectors(left, right)).toEqual({ x: -3, y: 2.5, z: 5 });
    expect(subtractVectors(left, right)).toEqual({ x: 5, y: 1.5, z: 1 });
    expect(scaleVector(left, -2)).toEqual({ x: -2, y: -4, z: -6 });
    expect(dotProduct(left, right)).toBe(3);
    expect(crossProduct({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("measures and normalizes, refusing a zero vector", () => {
    expect(vectorLength({ x: 3, y: 4, z: 12 })).toBe(13);
    expect(normalizeVector({ x: 0, y: 0, z: -5 })).toEqual({ x: 0, y: 0, z: -1 });
    expect(() => normalizeVector({ x: 0, y: 0, z: 0 })).toThrow(RangeError);
  });
});

describe("affine matrix math", () => {
  it("gives identity when the inverse multiplies the matrix, within float64 tolerance 1e-12", () => {
    for (const product of [multiplyAffineMatrices(invertAffineMatrix(shearedPlacement), shearedPlacement),
      multiplyAffineMatrices(shearedPlacement, invertAffineMatrix(shearedPlacement))]) {
      product.linear.forEach((value, index) => expect(Math.abs(value - IDENTITY_AFFINE_MATRIX.linear[index]!)).toBeLessThan(float64Tolerance));
      expectVectorClose(product.translation, IDENTITY_AFFINE_MATRIX.translation);
    }
  });

  it("transforms points with translation and directions without it", () => {
    expectVectorClose(transformPoint(shearedPlacement, { x: 1, y: 0, z: 0 }), { x: 122, y: -45.25, z: 7.6 });
    expect(transformDirection(shearedPlacement, { x: 1, y: 0, z: 0 })).toEqual({ x: 2, y: -0.25, z: 0.1 });
    expectVectorClose(transformPoint(invertAffineMatrix(shearedPlacement), transformPoint(shearedPlacement, { x: -3, y: 8, z: 0.5 })), { x: -3, y: 8, z: 0.5 });
  });

  it("refuses to invert a singular matrix", () => {
    expect(() => invertAffineMatrix({ linear: [1, 2, 3, 2, 4, 6, 0, 0, 1], translation: { x: 0, y: 0, z: 0 } })).toThrow(RangeError);
  });

  it("maps a plane normal with the inverse-transpose so it stays perpendicular to transformed in-plane vectors", () => {
    const normal = normalizeVector({ x: 1, y: 2, z: -1 });
    const inPlaneVectors = [{ x: 2, y: -1, z: 0 }, { x: 1, y: 0, z: 1 }];
    inPlaneVectors.forEach(vector => expect(Math.abs(dotProduct(vector, normal))).toBeLessThan(float64Tolerance));
    const transformedNormal = multiplyMatrix3Vector(inverseTransposeLinear(shearedPlacement), normal);
    for (const vector of inPlaneVectors) expect(Math.abs(dotProduct(transformDirection(shearedPlacement, vector), transformedNormal))).toBeLessThan(float64Tolerance);
    expect(Math.abs(dotProduct(transformDirection(shearedPlacement, normal), transformedNormal))).toBeGreaterThan(0.1);
  });
});

describe("plane math", () => {
  it("measures distance as N.P - W", () => {
    const plane = { normal: { x: 0, y: 0, z: 1 }, w: 250 };
    expect(planeDistance(plane, { x: 9, y: -9, z: 300 })).toBe(50);
    expect(planeDistance(plane, { x: 0, y: 0, z: 250 })).toBe(0);
    expect(planeDistance(planeFromNormalAndPoint({ x: 1, y: 0, z: 0 }, { x: -20, y: 5, z: 5 }), { x: -25, y: 0, z: 0 })).toBe(-5);
  });

  it("keeps transformed points on the transformed plane", () => {
    const plane = planeFromNormalAndPoint(normalizeVector({ x: 1, y: 2, z: -1 }), { x: 4, y: 1, z: 6 });
    const transformedPlane = transformPlane(plane, shearedPlacement);
    expect(vectorLength(transformedPlane.normal)).toBeCloseTo(1, 12);
    for (const point of [{ x: 4, y: 1, z: 6 }, { x: 6, y: 0, z: 6 }, { x: 5, y: 1, z: 7 }]) {
      expect(Math.abs(planeDistance(plane, point))).toBeLessThan(float64Tolerance);
      expect(Math.abs(planeDistance(transformedPlane, transformPoint(shearedPlacement, point)))).toBeLessThan(1e-9);
    }
    const frontPoint = addVectors({ x: 4, y: 1, z: 6 }, plane.normal);
    expect(planeDistance(transformedPlane, transformPoint(shearedPlacement, frontPoint))).toBeGreaterThan(0);
  });
});

describe("rotator rules", () => {
  it("counts 65536 units per turn with the exact rule units * pi / 32768", () => {
    expect(ROTATOR_CONSTANTS.unitsPerTurn.runtimeDefault).toBe(65536);
    expect(rotatorUnitsToRadians(32768)).toBe(Math.PI);
    expect(rotatorUnitsToRadians(65536)).toBe(2 * Math.PI);
    expect(rotatorUnitsToRadians(-16384)).toBe(-Math.PI / 2);
    expect(rotatorSineExact(16384)).toBe(1);
  });

  it("reads a 16384-entry float32 table indexed by floor(units / 4) mod 16384", () => {
    expect(ROTATOR_CONSTANTS.sineTableLength.runtimeDefault).toBe(16384);
    expect(rotatorSineFromTable(16384)).toBe(1);
    expect(rotatorSineFromTable(32768)).toBe(1.2246063538223773e-16);
    expect(rotatorSineFromTable(4097)).toBe(Math.fround(Math.sin(1024 * 2 * Math.PI / 16384)));
    expect(rotatorSineFromTable(3)).toBe(0);
    expect(rotatorSineFromTable(-1)).toBe(rotatorSineFromTable(65535));
    expect(rotatorSineFromTable(65536 + 100)).toBe(rotatorSineFromTable(100));
    for (let units = 0; units < 65536; units += 997) expect(Math.fround(rotatorSineFromTable(units))).toBe(rotatorSineFromTable(units));
  });

  it("matches the placement converter's table everywhere except the half-turn entry", () => {
    const placementConverterSine = (units: number) => Math.fround(Math.sin(((units >> 2) & 16383) * 2 * Math.PI / 16384));
    const differingUnits: number[] = [];
    for (let units = 0; units < 65536; units += 1) if (rotatorSineFromTable(units) !== placementConverterSine(units)) differingUnits.push(units);
    expect(differingUnits).toEqual([32768, 32769, 32770, 32771]);
    expect(ROTATOR_CONSTANTS.sineTableHalfTurnEntry.runtimeDefault).toBe(1.2246063538223773e-16);
    expect(Math.abs(rotatorSineFromTable(32768) - placementConverterSine(32768))).toBeLessThan(4.1e-21);
  });

  it("pins the largest table-to-exact difference over all 65536 inputs", () => {
    let largestDifference = 0, largestDifferenceUnits = -1;
    for (let units = 0; units < 65536; units += 1) {
      const difference = Math.abs(rotatorSineFromTable(units) - rotatorSineExact(units));
      if (difference > largestDifference) { largestDifference = difference; largestDifferenceUnits = units; }
    }
    expect(largestDifference).toBe(0.0002876213937629265);
    expect(largestDifferenceUnits).toBe(3);
  });

  it("names one rule per use, each an unconfirmed constants row with provenance", () => {
    expect(Object.fromEntries(Object.entries(ROTATOR_RULE_BY_USE).map(([use, row]) => [use, row.runtimeDefault]))).toEqual({
      "particle-revolution": "sine-table",
      "camera-direction": "sine-table",
      "texture-rotator": "exact",
      placement: "sine-table",
    });
    for (const row of [...Object.values(ROTATOR_RULE_BY_USE), ...Object.values(ROTATOR_CONSTANTS)]) {
      expect(row.status).toBe("unconfirmed");
      expect(row.provenance.length).toBeGreaterThan(0);
      expect(row.interludeEvidence).toBeNull();
      expect(row.runtimeDefault).toBe(row.value);
    }
  });
});
