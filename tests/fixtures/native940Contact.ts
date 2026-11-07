/** Independent retained source geometry for the bounded Actor940 wall control.
 * This is test evidence, never a runtime collision implementation or policy.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const actor940ContactPin = {
  path: "artifacts/native-parity/research/native-stair-traversal-20261107/ACTOR940_CONTACT_ORACLE.json",
  sha256: "0ab63899804c5a2f270cc8ecc1fbc1bdc833169381e0497655f11253cd919986",
} as const;

type Point = readonly [number, number, number];
type Triangle = readonly [Point, Point, Point];
export interface Actor940ContactOracle {
  readonly manifest: { readonly sha256: string };
  readonly placement: { readonly id: string };
  readonly glb: { readonly sha256: string };
  readonly triangle: { readonly sourceWorldPositions: Triangle; readonly nativeSectionIndex: number; readonly triangleIndex: number };
  readonly authored: { readonly savedMatrixWorldPositions: Triangle };
  readonly floor: { readonly triangle: { readonly positions: Triangle }; readonly planeY: number };
  readonly allowedContactRegion: { readonly wallPathX: number; readonly historicalWallRangeZ: readonly [number, number] };
  readonly footprint: { readonly skin: number; readonly offsets: readonly (readonly [number, number])[];
    readonly maleRadius: number; readonly femaleRadius: number; readonly existingComparisonTolerance: number };
}

export function readActor940ContactOracle(path: string): Actor940ContactOracle {
  const bytes = readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex") !== actor940ContactPin.sha256) throw new Error("Actor940 test source oracle hash differs.");
  return JSON.parse(bytes.toString("utf8")) as Actor940ContactOracle;
}

function triangleHeight(vertices: Triangle, x: number, z: number): number | null {
  const [a, b, c] = vertices;
  const abX = b[0] - a[0], abZ = b[2] - a[2], acX = c[0] - a[0], acZ = c[2] - a[2];
  const determinant = abX * acZ - abZ * acX;
  if (Math.abs(determinant) < 1e-14) throw new Error("Actor940 oracle contains a degenerate XZ triangle.");
  const u = ((x - a[0]) * acZ - (z - a[2]) * acX) / determinant;
  const v = (abX * (z - a[2]) - abZ * (x - a[0])) / determinant;
  // Inclusion is essential: the small furnishing's plane is never extended
  // across the surrounding BSP slab.
  if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) return null;
  return a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
}

export function actor940ContactExpectation(oracle: Actor940ContactOracle, position: { x: number; z: number }, radius: number, authored = false) {
  const { wallPathX, historicalWallRangeZ } = oracle.allowedContactRegion;
  if (![position.x, position.z, radius].every(Number.isFinite) || Math.abs(position.x - wallPathX) > 1e-5 ||
      position.z <= historicalWallRangeZ[0] || position.z >= historicalWallRangeZ[1] ||
      ![oracle.footprint.maleRadius, oracle.footprint.femaleRadius].includes(radius)) {
    throw new Error("Actor940 contact is outside the retained wall-path/capsule scope.");
  }
  const triangle = authored ? oracle.authored.savedMatrixWorldPositions : oracle.triangle.sourceWorldPositions;
  const samples = oracle.footprint.offsets.map(([dx, dz], index) => {
    const x = position.x + dx * (radius + oracle.footprint.skin), z = position.z + dz * (radius + oracle.footprint.skin);
    const floor = triangleHeight(oracle.floor.triangle.positions, x, z);
    if (floor === null) throw new Error("Actor940 footprint is outside the retained source BSP triangle.");
    const furnishing = triangleHeight(triangle, x, z);
    return { index, x, z, floor, furnishing, expectedY: Math.max(floor, furnishing ?? -Infinity) };
  });
  return { oracleSha256: actor940ContactPin.sha256, authored, radius, skin: oracle.footprint.skin,
    sourcePlacement: oracle.placement.id, glbSha256: oracle.glb.sha256,
    nativeSectionIndex: oracle.triangle.nativeSectionIndex, triangleIndex: oracle.triangle.triangleIndex,
    expectedY: Math.max(...samples.map(sample => sample.expectedY)), samples };
}
