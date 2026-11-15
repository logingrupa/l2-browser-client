import type { TerrainReferenceCase } from "./terrainLegacyReferenceCases";
import type { TerrainLegacyTexture } from "./terrainLegacyReferenceRenderer";

export type TerrainReferenceUvBranch = "ordinary" | "corrected";

/** Test-only native vertex-producer arithmetic for the reviewed 256x256 map.
 * Callers explicitly choose a conditional branch; this never infers live state.
 * Engine GenerateTriangles 0x1072d250 writes integer-grid results as float32.
 * See continuation-20261106-ongoing/{native/UV_PRODUCER,COORDINATE_BINDING_ADDENDUM}.md.
 * These binary-fraction inputs are exact; general native x87 precision is unknown.
 */
export function nativeTerrainReferenceUv(grid: number, heightmapDimension: number, branch: TerrainReferenceUvBranch): number {
  if (!Number.isInteger(grid) || grid < 0 || grid > 255 || heightmapDimension !== 256) {
    throw new Error("Terrain UV reference covers integer grid 0..255 and heightmap dimension 256 only.");
  }
  if (branch !== "ordinary" && branch !== "corrected") throw new Error("Terrain UV reference requires an explicit ordinary or corrected branch.");
  const ordinary = (grid + .5) / heightmapDimension;
  return Math.fround(branch === "ordinary" ? ordinary : ordinary - Math.max(grid - 240, 0) / 4096);
}

interface SamplerOracle {
  readonly texelCenter: number;
  readonly nearest: number;
  readonly bilinear: number;
}
interface CoordinateOracle {
  readonly grid: number;
  readonly branch: TerrainReferenceUvBranch;
  readonly uv: number;
  readonly mask512: SamplerOracle;
  readonly mask1024: SamplerOracle;
}

/** Independent fixed expectations recorded before any GPU execution. The source
 * coordinate is t = UV*maskHeight - 0.5. Synthetic row alpha is (row % 8)*32.
 * For example, 512/g241/corrected has t=482.375: rows 482/483 are 64/96,
 * giving 76 bilinearly, while nearest selects row482=64. The ordinary t=482.5
 * gives 80 bilinearly and row483=96 with nearest. Neither is a native sample claim.
 */
export const terrainUvCoordinateOracles: readonly CoordinateOracle[] = [
  { grid: 240, branch: "ordinary", uv: .939453125,
    mask512: { texelCenter: 480.5, nearest: 32, bilinear: 16 },
    mask1024: { texelCenter: 961.5, nearest: 64, bilinear: 48 } },
  { grid: 240, branch: "corrected", uv: .939453125,
    mask512: { texelCenter: 480.5, nearest: 32, bilinear: 16 },
    mask1024: { texelCenter: 961.5, nearest: 64, bilinear: 48 } },
  { grid: 241, branch: "ordinary", uv: .943359375,
    mask512: { texelCenter: 482.5, nearest: 96, bilinear: 80 },
    mask1024: { texelCenter: 965.5, nearest: 192, bilinear: 176 } },
  { grid: 241, branch: "corrected", uv: .943115234375,
    mask512: { texelCenter: 482.375, nearest: 64, bilinear: 76 },
    mask1024: { texelCenter: 965.25, nearest: 160, bilinear: 168 } },
  { grid: 255, branch: "ordinary", uv: .998046875,
    mask512: { texelCenter: 510.5, nearest: 224, bilinear: 208 },
    mask1024: { texelCenter: 1021.5, nearest: 192, bilinear: 176 } },
  { grid: 255, branch: "corrected", uv: .994384765625,
    mask512: { texelCenter: 508.625, nearest: 160, bilinear: 148 },
    mask1024: { texelCenter: 1017.75, nearest: 64, bilinear: 56 } },
];

export interface TerrainUvCaseMetadata {
    classification: "synthetic-conditional-uv-sampler";
    gridY: number;
    heightmapDimension: 256;
    maskWidth: 1;
    maskHeight: 512 | 1024;
    branch: TerrainReferenceUvBranch;
    filter: TerrainLegacyTexture["filter"];
    coordinate: number;
    expectedCoordinate: number;
    expectedTexelCenter: number;
    expectedAlphaByte: number;
    maskPattern: string;
    nativeApplicability: "unverified";
}

export interface TerrainUvReferenceCase extends TerrainReferenceCase {
  uvCase: TerrainUvCaseMetadata;
}

function pixel(rgba: readonly number[]): TerrainLegacyTexture {
  return { width: 1, height: 1, rgba, filter: "nearest", address: "clamp", precision: "rgba8", uvRows: [[0, 0, .5], [0, 0, .5]] };
}

function samplerCase(oracle: CoordinateOracle, maskHeight: 512 | 1024, filter: TerrainLegacyTexture["filter"]): TerrainUvReferenceCase {
  const expected = maskHeight === 512 ? oracle.mask512 : oracle.mask1024;
  const coordinate = nativeTerrainReferenceUv(oracle.grid, 256, oracle.branch);
  const bytes = new Uint8Array(maskHeight * 4);
  for (let row = 0; row < maskHeight; row++) {
    // Unequal RGB deliberately rejects red/luminance substitution for alpha.
    bytes.set([255, 17, 63, (row % 8) * 32], row * 4);
  }
  const alpha = expected[filter];
  return {
    description: `Synthetic ${maskHeight}-row mask, grid Y${oracle.grid}, ${oracle.branch} UV, ${filter}; native branch selection remains unverified`,
    fixture: {
      id: `uv-${maskHeight}-y${oracle.grid}-${oracle.branch}-${filter}`,
      width: 8, height: 8, clearRgba: [0, 0, 255, 255], alphaAssumption: "separate-source-over",
      passes: [
        { id: "explicit-retained-first", isTransparent: false, diffuse: pixel([255, 0, 0, 255]), mask: pixel([255, 255, 255, 255]) },
        { id: "explicit-retained-overlay", isTransparent: false, diffuse: pixel([0, 255, 0, 255]),
          mask: { width: 1, height: maskHeight, rgba: bytes, filter, address: "clamp", precision: "rgba8", uvRows: [[0, 0, .5], [0, 0, coordinate]] } },
      ],
    },
    expectedRgba: [255 - alpha, alpha, 0, 255],
    uvCase: {
      classification: "synthetic-conditional-uv-sampler", gridY: oracle.grid, heightmapDimension: 256,
      maskWidth: 1, maskHeight, branch: oracle.branch, filter, coordinate, expectedCoordinate: oracle.uv,
      expectedTexelCenter: expected.texelCenter, expectedAlphaByte: alpha,
      maskPattern: "RGBA8 rows [255,17,63,(row % 8)*32]; one column, no native P8/BC1 decoding or mip generation",
      nativeApplicability: "unverified",
    },
  };
}

/** 3 grid locations × 2 branches × 2 mask dimensions × 2 filters = 24 cases. */
export const terrainUvReferenceCases: readonly TerrainUvReferenceCase[] = terrainUvCoordinateOracles.flatMap(oracle =>
  ([512, 1024] as const).flatMap(size => (["nearest", "bilinear"] as const).map(filter => samplerCase(oracle, size, filter))));
