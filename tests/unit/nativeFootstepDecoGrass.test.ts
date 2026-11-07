import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import {
  createFootstepDecoGrassField, loadNativeStepDecoGrass, DECO_GRASS_APPROXIMATION_LABEL, NATIVE_STEPSOUND_DECO_GRASS_KIND,
  type FootstepDecoGrassGeometry,
} from "../../src/assets/native/loadNativeStepDecoGrass";
import { loadNativeAnimationAudio } from "../../src/assets/native/loadNativeAnimationAudio";

type Json = Record<string, unknown>;
const signal = new AbortController().signal;
const identity = { manifestSha256: "a".repeat(64), ruleId: "rule" };
const geometry = (patch: Partial<FootstepDecoGrassGeometry> = {}): FootstepDecoGrassGeometry => ({ terrain: "20_20.TerrainInfo0", quads: [4, 4],
  quadSize: [128, 128], origin: [0, 65536], sectors: [[0, 0, 4, 4]], perQuad: new Float32Array(16).fill(4), radius: 64, threshold: 2, ...patch });
/** Area of the 64-unit circle in quads, as the 16 × 16 sample grid integrates it. */
const circleQuads = (() => { let inside = 0; for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
  const x = -64 + (i + .5) * 8, y = -64 + (j + .5) * 8; if (x * x + y * y <= 64 * 64) inside++; } return inside * 64 / (128 * 128); })();

describe("expected deco-instance field (approximation of native deco instance count)", () => {
  it("integrates per-quad density over the 64-unit XY circle and gates GRASS at an expectation of 2", () => {
    expect(circleQuads).toBeCloseTo(Math.PI / 4, 1);
    const field = createFootstepDecoGrassField(geometry(), identity);
    expect(field).toMatchObject({ radius: 64, threshold: 2, label: DECO_GRASS_APPROXIMATION_LABEL, quads: [4, 4] });
    const centre = field.read(256, 65536 + 256);
    expect(centre).toMatchObject({ status: "sampled", sector: 0, quad: [2, 2], grass: true });
    expect(centre.expected).toBeCloseTo(4 * circleQuads, 9);
    const sparse = createFootstepDecoGrassField(geometry({ perQuad: new Float32Array(16).fill(2) }), identity).read(256, 65536 + 256);
    expect(sparse.expected).toBeCloseTo(2 * circleQuads, 9); expect(sparse.grass).toBe(false);
  });

  it("counts only the nearest sector, like GetDecoLayerAlpha, and reads outside the terrain as no instances", () => {
    const field = createFootstepDecoGrassField(geometry({ sectors: [[0, 0, 2, 4], [2, 0, 2, 4]] }), identity);
    const edge = field.read(255.999, 65536 + 256);
    expect(edge.sector).toBe(0); expect(edge.expected).toBeCloseTo(4 * circleQuads / 2, 1);
    expect(field.read(256.001, 65536 + 256).sector).toBe(1);
    for (const [x, y] of [[-1, 65600], [600, 65600], [10, 65535], [Number.NaN, 65600]] as const) {
      expect(field.read(x, y)).toEqual({ status: "outside-terrain", expected: 0, threshold: 2, grass: false, sector: null, quad: null });
    }
  });

  it("rejects malformed geometry", () => {
    for (const patch of [{ quads: [0, 4] }, { perQuad: new Float32Array(3) }, { quadSize: [0, 128] }, { sectors: [[0, 0, 5, 4]] }, { sectors: [] }]) {
      expect(() => createFootstepDecoGrassField(geometry(patch as Partial<FootstepDecoGrassGeometry>), identity)).toThrow("Deco-grass footstep field");
    }
  });
});

async function bundle(mutate: (manifest: Json) => void = () => {}) {
  const values = new Uint16Array(16).fill(4 * 256), grid = new Uint8Array(values.buffer), gridSha = await sha256(grid);
  const manifest: Json = { schemaVersion: 1, kind: NATIVE_STEPSOUND_DECO_GRASS_KIND,
    terrain: { object: "20_20.TerrainInfo0", quads: [4, 4], quadSize: [128, 128], origin: [0, 65536], sectors: [[0, 0, 4, 4]] },
    grid: { file: `grid/${gridSha}.bin`, bytes: grid.length, sha256: gridSha, scale: 256 },
    rule: { id: "expected-deco-instances-20261107", status: "approximation", countRadius: 64, grassMinimumCount: 2 } };
  mutate(manifest);
  const bytes = new TextEncoder().encode(JSON.stringify(manifest)), hash = await sha256(bytes), prefix = `/l2/step-sounds/${hash}/`;
  const records = [{ id: "stepsound-deco-grass-20-20", kind: NATIVE_STEPSOUND_DECO_GRASS_KIND, manifest: `${prefix}manifest.json`, manifestBytes: bytes.length, manifestSha256: hash }];
  const fetchBytes = async (path: string) => path === `${prefix}manifest.json` ? bytes : path === `${prefix}grid/${gridSha}.bin` ? grid : (() => { throw new Error(`missing ${path}`); })();
  return { records, fetchBytes, hash };
}

describe("deco-grass bundle loader", () => {
  it("verifies the pinned manifest and grid and decodes expected instances per quad", async () => {
    const { records, fetchBytes, hash } = await bundle();
    const loaded = await loadNativeStepDecoGrass(records, signal, { fetchBytes });
    expect(loaded.manifest).toBe(hash);
    expect(loaded.field!.read(256, 65536 + 256).expected).toBeCloseTo(4 * circleQuads, 9);
    expect(loaded.field!.ruleId).toBe("expected-deco-instances-20261107");
  });

  it("returns no field when unstaged, and the animation-audio loader ignores the entry", async () => {
    expect(await loadNativeStepDecoGrass(undefined, signal)).toEqual({ field: null, manifest: null });
    const { records } = await bundle();
    await expect(loadNativeAnimationAudio(records, new Map(), new Map(), signal)).resolves.toMatchObject({ definitions: [], manifests: [] });
  });

  it.each([
    ["a rule other than the native 64-unit, count > 1 gate", (m: Json) => { (m.rule as Json).countRadius = 128; }, "rule differs"],
    ["an approximation not labelled as such", (m: Json) => { (m.rule as Json).status = "native"; }, "rule differs"],
    ["a grid size differing from the quads", (m: Json) => { (m.grid as Json).bytes = 30; }, "grid descriptor"],
  ])("fails loudly on %s", async (_label, mutate, message) => {
    const { records, fetchBytes } = await bundle(mutate);
    await expect(loadNativeStepDecoGrass(records, signal, { fetchBytes })).rejects.toThrow(message);
  });

  it("rejects altered grid bytes and duplicate entries", async () => {
    const { records, fetchBytes } = await bundle();
    await expect(loadNativeStepDecoGrass(records, signal, { fetchBytes: async path => path.endsWith(".bin") ? new Uint8Array(32) : fetchBytes(path) }))
      .rejects.toThrow("hash/length mismatch");
    await expect(loadNativeStepDecoGrass([records[0], { ...records[0], id: "again" }], signal, { fetchBytes })).rejects.toThrow("multiple");
  });
});

const root = join(__dirname, "../..");
const catalogPath = join(root, "public/l2/catalog.json");
const staged = existsSync(catalogPath) && (JSON.parse(readFileSync(catalogPath, "utf8")).animationAudio ?? [])
  .some((row: Json) => row.kind === NATIVE_STEPSOUND_DECO_GRASS_KIND);
describe.skipIf(!staged)("actually staged 20_20 deco-grass bundle", () => {
  it("loads the full 255 × 255 quad grid and splits the live PlayerStart10 section into GRASS and LAND", async () => {
    const records = JSON.parse(readFileSync(catalogPath, "utf8")).animationAudio;
    const { field } = await loadNativeStepDecoGrass(records, signal, { fetchBytes: async path => new Uint8Array(readFileSync(join(root, "public", path))) });
    expect(field).toMatchObject({ terrain: "20_20.TerrainInfo0", quads: [255, 255], radius: 64, threshold: 2 });
    // PlayerStart10 itself has no expected grass.
    expect(field!.read(10536, 95034)).toMatchObject({ status: "sampled", grass: false, expected: 0 });
    let grass = 0, total = 0;
    for (let x = 8192; x <= 14336; x += 256) for (let y = 92160; y <= 98176; y += 256) { total++; if (field!.read(x, y).grass) grass++; }
    expect(grass / total).toBeGreaterThan(.15); expect(grass / total).toBeLessThan(.6);
  });
});
