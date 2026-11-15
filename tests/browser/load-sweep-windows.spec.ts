import { expect, test, type Page } from "@playwright/test";
import type { NativeWindowHarnessResult } from "./harness/nativeWindowHarness";
import { readLoadCheckRecords } from "./support/loadCheckRecordFile";
import {
  firstMessageLine, keysNotRecordedExactlyOnce, loadCheckKeyTimeoutMilliseconds, loadCheckKindKeyPrefix, loadCheckLaneNames, loadCheckSkipReason,
  loadCheckSliceTimeoutMilliseconds, loadCheckSpecTitle, playwrightLoadCheckActions, readLoadCheckSliceSettings, runLoadCheckSlice,
  type LoadCheckOutcome,
} from "./support/loadCheckRecords";

const kind = "windows";
const settings = readLoadCheckSliceSettings(process.env, loadCheckLaneNames());

test.skip(settings === null || settings.kind !== kind, loadCheckSkipReason(kind));

async function openedWindowResult(keyPage: Page, windowId: string): Promise<NativeWindowHarnessResult> {
  const pageErrors: string[] = [];
  keyPage.on("pageerror", error => pageErrors.push(error.message));
  await keyPage.goto(`/tests/browser/harness/native-window.html?window=${encodeURIComponent(windowId)}`);
  await keyPage.waitForFunction(() => window.__nativeWindowHarness !== undefined && window.__nativeWindowHarness.result.status !== "loading", undefined,
    { timeout: loadCheckKeyTimeoutMilliseconds });
  if (pageErrors.length > 0) throw new Error(`page error: ${firstMessageLine(pageErrors[0])}`);
  const result = await keyPage.evaluate(() => window.__nativeWindowHarness?.result);
  if (result === undefined) throw new Error("the native window harness left no result");
  return result;
}

async function checkWindowLoadKey(page: Page, key: string): Promise<LoadCheckOutcome> {
  const windowId = key.slice(loadCheckKindKeyPrefix(kind).length);
  const keyPage = await page.context().newPage();
  try {
    const result = await openedWindowResult(keyPage, windowId);
    if (result.status !== "opened") return { status: "failed", reason: `${key} ${result.status}: ${result.reason ?? "no reason given"}`, assetManifestSchemaVersion: null };
    const attachedRoots = await keyPage.locator(`[data-native-window=${JSON.stringify(windowId)}]`).count();
    if (attachedRoots !== 1) return { status: "failed", reason: `${key} opened with ${attachedRoots} attached data-native-window roots`, assetManifestSchemaVersion: null };
    return { status: "pass", reason: null, assetManifestSchemaVersion: null };
  } finally {
    await keyPage.close();
  }
}

test(loadCheckSpecTitle(kind), async ({ page, baseURL }) => {
  if (settings === null || baseURL === undefined) throw new Error("the windows slice needs its settings and the Playwright baseURL");
  test.setTimeout(loadCheckSliceTimeoutMilliseconds(settings, loadCheckKeyTimeoutMilliseconds));
  const summary = await runLoadCheckSlice(settings, playwrightLoadCheckActions(page, baseURL, settings, key => checkWindowLoadKey(page, key)));
  console.log(`load sweep ${kind}: ${JSON.stringify(summary)}`);
  const recordedKeys = readLoadCheckRecords(settings.laneName, summary.catalogSha256).map(record => record.key);
  expect(keysNotRecordedExactlyOnce(summary.checkedKeys, recordedKeys)).toEqual([]);
});
