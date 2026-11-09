import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { hashServedLaneCatalog, writeLoadCheckRecord } from "./support/loadCheckRecordFile";
import type { NativeNpcHarnessEntry } from "./harness/nativeNpcHarness";

const laneName = "actors";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const gremlinKey = "npc:20001";
const modelCatalogIdPattern = /^npc-model:[a-f0-9]{64}$/;
const harnessLoadTimeout = 90_000;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors");
test.skip(!existsSync(laneCatalogPath), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --npc 20001 first");

async function openHarness(page: Page, npcIds: readonly number[]): Promise<readonly NativeNpcHarnessEntry[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/tests/browser/harness/native-npc.html?${npcIds.map(npcId => `npc=${npcId}`).join("&")}`);
  await expect(page.locator("#native-npc-harness")).toHaveAttribute("data-status", /^(ready|failed)$/, { timeout: harnessLoadTimeout });
  expect(await page.locator("#native-npc-harness").getAttribute("data-failure")).toBeNull();
  expect(pageErrors).toEqual([]);
  return page.evaluate(() => window.__nativeNpcHarness!.snapshot());
}

function entryFor(entries: readonly NativeNpcHarnessEntry[], key: string): NativeNpcHarnessEntry {
  const entry = entries.find(candidate => candidate.key === key);
  if (!entry) throw new Error(`${key} is not on the harness page`);
  return entry;
}

test("spawns npc:20001 by id from the actors lane store with meshes, a skeleton and native clips", async ({ page, baseURL }) => {
  test.setTimeout(harnessLoadTimeout * 2);
  const gremlin = entryFor(await openHarness(page, [20001]), gremlinKey);
  expect(gremlin.reason).toBeNull();
  expect(gremlin.status).toBe("converted");
  expect(gremlin.modelCatalogId).toMatch(modelCatalogIdPattern);
  expect(gremlin.preview?.meshes).toBeGreaterThan(0);
  expect(gremlin.preview?.skeletons).toBeGreaterThanOrEqual(1);
  expect(gremlin.clips.length).toBeGreaterThan(0);
  for (const clip of gremlin.clips) {
    expect(clip.nativeTiming).toBe(true);
    expect(clip.durationSeconds).toBeGreaterThan(0);
  }
  await page.evaluate(key => window.__nativeNpcHarness!.play(key, 0), gremlinKey);
  await expect.poll(() => page.evaluate(key => window.__nativeNpcHarness!.snapshot().find(entry => entry.key === key)?.preview?.nativePlayback?.durationSeconds ?? null, gremlinKey))
    .toBe(gremlin.clips[0]!.durationSeconds);
  if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
  writeLoadCheckRecord(laneName, await hashServedLaneCatalog(baseURL), {
    key: gremlinKey, status: "pass", reason: null, atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: 2,
  });
});
