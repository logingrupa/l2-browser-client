import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport } from "./browserViewports";

interface TileCatalogRecord { readonly id: string; readonly manifestSha256: string }

interface StreamingBaselineRecord {
  readonly measuredAtRiga: string;
  readonly loadReadyMilliseconds: number;
  readonly l2RequestCount: number;
  readonly l2ResponseBytes: number;
  readonly chunkCount: number;
  readonly loadedChunkCount: number;
  readonly meshCount: number;
  readonly vertexCount: number;
  readonly collisionCellCount: number;
  readonly collisionCells: { readonly status: string; readonly requiredCellCount: number; readonly residentCellCount: number; readonly missingCellIds: readonly string[] };
}

type StreamingBaselineRecordKey = "beforeResidency" | "withResidency";

interface StreamingBaselineFile {
  readonly schemaVersion: 1;
  readonly mode: "headless-swiftshader";
  readonly fpsMeasured: false;
  readonly catalogSha256: string;
  readonly tileId: string;
  readonly records: Partial<Record<StreamingBaselineRecordKey, StreamingBaselineRecord>>;
}

const laneName = "world";
const tileId = "20_21";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const laneCatalogBytes = existsSync(laneCatalogPath) ? readFileSync(laneCatalogPath) : null;
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = laneCatalogBytes ? JSON.parse(laneCatalogBytes.toString("utf8")) : null;
const tileRecord = laneCatalog?.tiles?.find(record => record.id === tileId) ?? null;
const catalogSha256 = laneCatalogBytes ? createHash("sha256").update(laneCatalogBytes).digest("hex") : "";
const measurementPath = resolve("artifacts/lane-store", laneName, "measurements", `streaming-baseline-${catalogSha256}.json`);
const tileLoadTimeout = 240_000;
const collisionSettleTimeout = 120_000;
const countFields = ["loadReadyMilliseconds", "l2RequestCount", "l2ResponseBytes", "chunkCount", "loadedChunkCount", "meshCount", "vertexCount", "collisionCellCount"] as const;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(tileRecord === null, "20_21 not converted in the world lane store");
test.use({ viewport: desktopViewport });

function existingBaselineFile(): StreamingBaselineFile | null {
  if (!existsSync(measurementPath)) return null;
  const existing = JSON.parse(readFileSync(measurementPath, "utf8")) as StreamingBaselineFile;
  if (existing.schemaVersion !== 1 || existing.catalogSha256 !== catalogSha256 || existing.tileId !== tileId) {
    throw new Error(`${measurementPath} belongs to another catalog, tile or schema.`);
  }
  return existing;
}

function writeBaselineRecord(key: StreamingBaselineRecordKey, record: StreamingBaselineRecord): void {
  const existing = existingBaselineFile();
  const file: StreamingBaselineFile = { schemaVersion: 1, mode: "headless-swiftshader", fpsMeasured: false, catalogSha256, tileId,
    records: { ...existing?.records, [key]: record } };
  mkdirSync(dirname(measurementPath), { recursive: true });
  const temporaryPath = `${measurementPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(temporaryPath, measurementPath);
}

test("records the headless streaming baseline of tile 20_21 without a frame rate", async ({ page }) => {
  test.setTimeout(tileLoadTimeout + collisionSettleTimeout + 60_000);
  const l2ResponseBodySizes: Promise<number>[] = [];
  let counting = true;
  page.on("requestfinished", request => {
    if (counting && new URL(request.url()).pathname.startsWith("/l2/")) l2ResponseBodySizes.push(request.sizes().then(sizes => sizes.responseBodySize));
  });
  const began = performance.now();
  await page.goto(`/?map=${tileId}`);
  await page.waitForFunction(() => document.body.dataset.worldState === "ready" && window.__nativeSlice !== undefined, null, { timeout: tileLoadTimeout });
  const loadReadyMilliseconds = Math.round(performance.now() - began);
  counting = false;
  const l2ResponseBytes = (await Promise.all(l2ResponseBodySizes)).reduce((sum, length) => sum + length, 0);
  const collisionStatus = () => page.evaluate(() => window.__nativeSlice!.snapshot().collisionCells?.status ?? "absent");
  await expect.poll(collisionStatus, { timeout: collisionSettleTimeout, intervals: [1_000] }).not.toBe("loading");
  const { world, collisionCells } = await page.evaluate(() => {
    const snapshot = window.__nativeSlice!.snapshot();
    return { world: snapshot.world ?? null, collisionCells: snapshot.collisionCells ?? null };
  });
  if (world === null || collisionCells === null) throw new Error("the tile route reported no world section or no collision cells");
  expect(world.manifestSha256).toBe(tileRecord!.manifestSha256);
  expect(world.tileId).toBe(tileId);
  const record: StreamingBaselineRecord = {
    measuredAtRiga: formatRigaTimestamp(new Date()), loadReadyMilliseconds, l2RequestCount: l2ResponseBodySizes.length, l2ResponseBytes,
    chunkCount: world.chunkCount!, loadedChunkCount: world.loadedChunkCount!, meshCount: world.meshCount!, vertexCount: world.vertexCount!,
    collisionCellCount: collisionCells.residentCellCount,
    collisionCells: { status: collisionCells.status, requiredCellCount: collisionCells.requiredCellCount,
      residentCellCount: collisionCells.residentCellCount, missingCellIds: collisionCells.missingCellIds },
  };
  expect(Object.keys(record).filter(key => /fps|frame/i.test(key))).toEqual([]);
  for (const field of countFields) {
    expect(Number.isSafeInteger(record[field]) && record[field] >= 0, `${field} is a non-negative safe integer`).toBe(true);
  }
  writeBaselineRecord("residency" in world ? "withResidency" : "beforeResidency", record);
});
