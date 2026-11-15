import { expect, test } from "@playwright/test";
import { readLoadCheckRecords } from "./support/loadCheckRecordFile";
import {
  checkHarnessLoadKey, keysNotRecordedExactlyOnce, loadCheckKeyTimeoutMilliseconds, loadCheckLaneNames, loadCheckSkipReason,
  loadCheckSliceTimeoutMilliseconds, loadCheckSpecTitle, playwrightLoadCheckActions, readLoadCheckSliceSettings, runLoadCheckSlice,
} from "./support/loadCheckRecords";

const kind = "npcs";
const settings = readLoadCheckSliceSettings(process.env, loadCheckLaneNames());

test.skip(settings === null || settings.kind !== kind, loadCheckSkipReason(kind));

test(loadCheckSpecTitle(kind), async ({ page, baseURL }) => {
  if (settings === null || baseURL === undefined) throw new Error("the npcs slice needs its settings and the Playwright baseURL");
  test.setTimeout(loadCheckSliceTimeoutMilliseconds(settings, loadCheckKeyTimeoutMilliseconds));
  const summary = await runLoadCheckSlice(settings, playwrightLoadCheckActions(page, baseURL, settings, key => checkHarnessLoadKey(page, key)));
  console.log(`load sweep ${kind}: ${JSON.stringify(summary)}`);
  const recordedKeys = readLoadCheckRecords(settings.laneName, summary.catalogSha256).map(record => record.key);
  expect(keysNotRecordedExactlyOnce(summary.checkedKeys, recordedKeys)).toEqual([]);
});
