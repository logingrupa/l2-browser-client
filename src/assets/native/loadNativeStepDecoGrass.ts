import { fetchVerifiedNativeResource } from "./fetchVerifiedNativeResource";

export const NATIVE_STEPSOUND_DECO_GRASS_KIND = "native-stepsound-deco-grass";
export const DECO_GRASS_APPROXIMATION_LABEL = "approximation of native deco instance count - browser does not render decorations";
const SAMPLE_POINTS_PER_AXIS = 16;

export interface FootstepDecoGrassReading {
  readonly status: "sampled" | "outside-terrain";
  readonly expected: number;
  readonly threshold: number;
  readonly grass: boolean;
  readonly sector: number | null;
  readonly quad: readonly [number, number] | null;
}
export interface FootstepDecoGrassField {
  readonly manifestSha256: string;
  readonly ruleId: string;
  readonly label: string;
  readonly terrain: string;
  readonly radius: number;
  readonly threshold: number;
  readonly quads: readonly [number, number];
  read(nativeX: number, nativeY: number): FootstepDecoGrassReading;
}
export interface NativeStepDecoGrassBundle { field: FootstepDecoGrassField | null; manifest: string | null }
export interface FootstepDecoGrassGeometry {
  readonly terrain: string;
  readonly quads: readonly [number, number];
  readonly quadSize: readonly [number, number];
  readonly origin: readonly [number, number];
  readonly sectors: readonly (readonly [number, number, number, number])[];
  readonly perQuad: ArrayLike<number>;
  readonly radius: number;
  readonly threshold: number;
}

const hash = /^[a-f0-9]{64}$/;
function requireMatch(value: unknown, message: string): asserts value { if (!value) throw Error(`Deco-grass footstep field: ${message}`); }
const record = (value: unknown, label: string): Record<string, unknown> => {
  requireMatch(value && typeof value === "object" && !Array.isArray(value), `invalid ${label}`);
  return value as Record<string, unknown>;
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value);

export function createFootstepDecoGrassField(geometry: FootstepDecoGrassGeometry, identity: { manifestSha256: string; ruleId: string }): FootstepDecoGrassField {
  const [quadsX, quadsY] = geometry.quads, [sizeX, sizeY] = geometry.quadSize, [originX, originY] = geometry.origin;
  requireMatch(integer(quadsX) && integer(quadsY) && quadsX > 0 && quadsY > 0 && geometry.perQuad.length === quadsX * quadsY &&
    finite(sizeX) && finite(sizeY) && sizeX > 0 && sizeY > 0 && finite(originX) && finite(originY) &&
    finite(geometry.radius) && geometry.radius > 0 && finite(geometry.threshold) && geometry.threshold > 0 && geometry.sectors.length > 0,
  "invalid geometry");
  const rects = geometry.sectors.map(([ox, oy, qx, qy]) => {
    requireMatch([ox, oy, qx, qy].every(integer) && ox >= 0 && oy >= 0 && qx > 0 && qy > 0 && ox + qx <= quadsX && oy + qy <= quadsY, "sector outside the grid");
    return { ox, oy, qx, qy, x0: originX + ox * sizeX, y0: originY + oy * sizeY, x1: originX + (ox + qx) * sizeX, y1: originY + (oy + qy) * sizeY };
  });
  const cell = 2 * geometry.radius / SAMPLE_POINTS_PER_AXIS, weight = cell * cell / (sizeX * sizeY);
  return {
    manifestSha256: identity.manifestSha256, ruleId: identity.ruleId, label: DECO_GRASS_APPROXIMATION_LABEL, terrain: geometry.terrain,
    radius: geometry.radius, threshold: geometry.threshold, quads: [quadsX, quadsY],
    read(x, y) {
      const qx = Math.floor((x - originX) / sizeX), qy = Math.floor((y - originY) / sizeY);
      if (!finite(x) || !finite(y) || qx < 0 || qy < 0 || qx >= quadsX || qy >= quadsY) {
        return { status: "outside-terrain", expected: 0, threshold: geometry.threshold, grass: false, sector: null, quad: null };
      }
      let sector = 0, best = Infinity;
      for (const [index, rect] of rects.entries()) {
        const dx = Math.max(rect.x0 - x, 0, x - rect.x1), dy = Math.max(rect.y0 - y, 0, y - rect.y1), distance = dx * dx + dy * dy;
        if (distance < best) { best = distance; sector = index; if (distance === 0) break; }
      }
      const rect = rects[sector]!, r = geometry.radius;
      let expected = 0;
      for (let row = 0; row < SAMPLE_POINTS_PER_AXIS; row++) {
        const offsetY = -r + (row + .5) * cell;
        for (let column = 0; column < SAMPLE_POINTS_PER_AXIS; column++) {
          const offsetX = -r + (column + .5) * cell;
          if (offsetX * offsetX + offsetY * offsetY > r * r) continue;
          const sx = Math.floor((x + offsetX - originX) / sizeX), sy = Math.floor((y + offsetY - originY) / sizeY);
          if (sx < rect.ox || sy < rect.oy || sx >= rect.ox + rect.qx || sy >= rect.oy + rect.qy) continue;
          expected += geometry.perQuad[sy * quadsX + sx]! * weight;
        }
      }
      return { status: "sampled", expected, threshold: geometry.threshold, grass: expected >= geometry.threshold, sector, quad: [qx, qy] };
    },
  };
}

async function pinned(path: string, expected: string, size: number, signal: AbortSignal): Promise<Uint8Array> {
  requireMatch(hash.test(expected) && integer(size) && size > 0 && size <= 8_000_000, "invalid resource pin");
  return fetchVerifiedNativeResource(path, expected, signal, size);
}

export async function loadNativeStepDecoGrass(records: unknown, signal: AbortSignal): Promise<NativeStepDecoGrassBundle> {
  requireMatch(Array.isArray(records ?? []) && (records as unknown[] ?? []).length <= 16, "invalid catalog list");
  const entries = ((records ?? []) as unknown[]).map(value => record(value, "catalog entry")).filter(entry => entry.kind === NATIVE_STEPSOUND_DECO_GRASS_KIND);
  requireMatch(entries.length <= 1, "multiple deco-grass entries");
  const entry = entries[0];
  if (!entry) return { field: null, manifest: null };
  const manifestHash = String(entry.manifestSha256), prefix = `/l2/step-sounds/${manifestHash}/`;
  requireMatch(hash.test(manifestHash) && entry.manifest === `${prefix}manifest.json`, "invalid catalog entry");
  const bytes = await pinned(`${prefix}manifest.json`, manifestHash, Number(entry.manifestBytes), signal);
  const manifest = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), "manifest");
  requireMatch(manifest.schemaVersion === 1 && manifest.kind === NATIVE_STEPSOUND_DECO_GRASS_KIND, "unsupported manifest");
  const terrain = record(manifest.terrain, "terrain"), grid = record(manifest.grid, "grid"), rule = record(manifest.rule, "rule");
  const quads = terrain.quads, quadSize = terrain.quadSize, origin = terrain.origin, sectors = terrain.sectors;
  requireMatch(Array.isArray(quads) && quads.length === 2 && quads.every(integer) && Array.isArray(quadSize) && quadSize.length === 2 &&
    quadSize.every(finite) && Array.isArray(origin) && origin.length === 2 && origin.every(finite) &&
    Array.isArray(sectors) && sectors.length > 0 && sectors.length <= 4096 && typeof terrain.object === "string", "invalid terrain");
  const [quadsX, quadsY] = quads as [number, number], gridSha = String(grid.sha256), scale = Number(grid.scale);
  requireMatch(hash.test(gridSha) && grid.file === `grid/${gridSha}.bin` && grid.bytes === quadsX * quadsY * 2 && finite(scale) && scale > 0,
    "invalid grid descriptor");
  requireMatch(rule.countRadius === 64 && rule.grassMinimumCount === 2 && rule.status === "approximation" && typeof rule.id === "string",
    "rule differs from the native 64-unit, count > 1 gate");
  const payload = await pinned(`${prefix}${grid.file}`, gridSha, Number(grid.bytes), signal);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength), perQuad = new Float32Array(quadsX * quadsY);
  for (let index = 0; index < perQuad.length; index++) perQuad[index] = view.getUint16(index * 2, true) / scale;
  const field = createFootstepDecoGrassField({ terrain: terrain.object as string, quads: [quadsX, quadsY], quadSize: quadSize as [number, number],
    origin: origin as [number, number], perQuad, radius: 64, threshold: 2,
    sectors: (sectors as unknown[]).map(row => { requireMatch(Array.isArray(row) && row.length === 4, "invalid sector"); return row as [number, number, number, number]; }) },
  { manifestSha256: manifestHash, ruleId: rule.id as string });
  return { field, manifest: manifestHash };
}
