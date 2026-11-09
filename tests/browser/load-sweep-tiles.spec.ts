import { expect, test, type Page } from "@playwright/test";
import { readTileCatalogRecord } from "../../src/assets/native/nativeCatalogRecords";
import { readLoadCheckRecords } from "./support/loadCheckRecordFile";
import {
  firstMessageLine, keysNotRecordedExactlyOnce, loadCheckKindKeyPrefix, loadCheckLaneNames, loadCheckSkipReason, loadCheckSliceTimeoutMilliseconds,
  loadCheckSpecTitle, loadCheckTileLoadTimeoutMilliseconds, playwrightLoadCheckActions, readLoadCheckSliceSettings, runLoadCheckSlice,
  type LoadCheckOutcome,
} from "./support/loadCheckRecords";

const kind = "tiles";
const settings = readLoadCheckSliceSettings(process.env, loadCheckLaneNames());

test.skip(settings === null || settings.kind !== kind, loadCheckSkipReason(kind));

async function servedTileManifestSha256(page: Page, baseUrl: string, tileId: string): Promise<string> {
  const catalogUrl = new URL("/l2/catalog.json", baseUrl).href;
  const answer = await page.request.get(catalogUrl);
  if (!answer.ok()) throw new Error(`served catalog ${catalogUrl} answered ${answer.status()}`);
  const catalog: unknown = await answer.json();
  const tileRecords: unknown = typeof catalog === "object" && catalog !== null && "tiles" in catalog ? catalog.tiles : undefined;
  if (!Array.isArray(tileRecords)) throw new Error(`served catalog ${catalogUrl} has no tiles list`);
  const tileRecord = tileRecords.map(readTileCatalogRecord).find(record => record.tile === tileId);
  if (tileRecord === undefined) throw new Error(`served catalog ${catalogUrl} has no tiles record ${tileId}`);
  return tileRecord.manifestSha256;
}

async function settledNativeRouteState(keyPage: Page): Promise<string> {
  const settled = await keyPage.waitForFunction(() => {
    const loading = document.querySelector<HTMLElement>("#loading");
    if (!loading) return window.__nativeSlice ? "ready" : false;
    return loading.dataset.state === "error" ? `world failure: ${(loading.textContent ?? "").replace(/\s+/g, " ").trim()}` : false;
  }, undefined, { timeout: loadCheckTileLoadTimeoutMilliseconds, polling: 1_000 });
  const routeState = await settled.jsonValue();
  if (routeState === false) throw new Error("the native route settled without a state");
  return routeState;
}

async function checkTileLoadKey(page: Page, baseUrl: string, key: string): Promise<LoadCheckOutcome> {
  const tileId = key.slice(loadCheckKindKeyPrefix(kind).length);
  const expectedManifestSha256 = await servedTileManifestSha256(page, baseUrl, tileId);
  const keyPage = await page.context().newPage();
  const pageErrors: string[] = [];
  keyPage.on("pageerror", error => pageErrors.push(error.message));
  try {
    await keyPage.goto(`/?map=${encodeURIComponent(tileId)}`);
    const routeState = await settledNativeRouteState(keyPage);
    if (pageErrors.length > 0) return { status: "failed", reason: `${key} page error: ${firstMessageLine(pageErrors[0])}`, assetManifestSchemaVersion: null };
    if (routeState !== "ready") return { status: "failed", reason: `${key} ${routeState}`, assetManifestSchemaVersion: null };
    const snapshot = await keyPage.evaluate(() => {
      const nativeSnapshot = window.__nativeSlice?.snapshot();
      return { worldFailure: nativeSnapshot?.worldFailure ?? null, manifestSha256: nativeSnapshot?.world?.manifestSha256 ?? null };
    });
    if (snapshot.worldFailure !== null) return { status: "failed", reason: `${key} world failure: ${snapshot.worldFailure}`, assetManifestSchemaVersion: null };
    if (snapshot.manifestSha256 !== expectedManifestSha256) {
      return { status: "failed", reason: `${key} loaded manifest ${snapshot.manifestSha256 ?? "none"}, served tiles record ${expectedManifestSha256}`,
        assetManifestSchemaVersion: null };
    }
    return { status: "pass", reason: null, assetManifestSchemaVersion: null };
  } finally {
    await keyPage.close();
  }
}

test(loadCheckSpecTitle(kind), async ({ page, baseURL }) => {
  if (settings === null || baseURL === undefined) throw new Error("the tiles slice needs its settings and the Playwright baseURL");
  test.setTimeout(loadCheckSliceTimeoutMilliseconds(settings, loadCheckTileLoadTimeoutMilliseconds));
  const summary = await runLoadCheckSlice(settings, playwrightLoadCheckActions(page, baseURL, settings, key => checkTileLoadKey(page, baseURL, key)));
  console.log(`load sweep ${kind}: ${JSON.stringify(summary)}`);
  const recordedKeys = readLoadCheckRecords(settings.laneName, summary.catalogSha256).map(record => record.key);
  expect(keysNotRecordedExactlyOnce(summary.checkedKeys, recordedKeys)).toEqual([]);
});
