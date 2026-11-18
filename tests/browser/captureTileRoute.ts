import { expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface TileCatalogRecord { readonly id: string; readonly manifestSha256: string }

export const captureStoreName = "integration";
export const captureTileId = "20_20";
const captureCatalogPath = resolve("artifacts/lane-store", captureStoreName, "l2/catalog.json");
const captureCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(captureCatalogPath) ? JSON.parse(readFileSync(captureCatalogPath, "utf8")) : null;
export const captureStoreTileRecord = (tileId: string): TileCatalogRecord | null => captureCatalog?.tiles?.find(record => record.id === tileId) ?? null;
export const captureTileRecord = captureStoreTileRecord(captureTileId);
export const captureStoreRequirement = "run with NATIVE_STORE_ROOT=integration, the store sandbox halves are captured on";
export const captureStoreTileRequirement = (tileId: string) => `the integration union catalog has no tiles record ${tileId}`;
export const captureTileRequirement = captureStoreTileRequirement(captureTileId);
const captureTileLoadTimeout = 240_000;

export async function openCaptureStoreTile(page: Page, tileId: string): Promise<void> {
  const record = captureStoreTileRecord(tileId);
  if (!record) throw new Error(captureStoreTileRequirement(tileId));
  await page.goto(`/?map=${tileId}`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__nativeSlice?.snapshot().world)), { timeout: captureTileLoadTimeout, intervals: [1_000] }).toBe(true);
  expect(await page.evaluate(() => window.__nativeSlice!.snapshot().world!.manifestSha256)).toBe(record.manifestSha256);
}

export async function openCaptureTile(page: Page): Promise<void> {
  await openCaptureStoreTile(page, captureTileId);
}
