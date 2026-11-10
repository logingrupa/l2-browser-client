import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport } from "./browserViewports";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";

const laneName = "actors";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const worldReadyTimeout = 240_000;
const modelLoadTimeout = 90_000;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors");
test.skip(!existsSync(laneCatalogPath), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --character 0 first");
test.use({ viewport: desktopViewport });

const entities = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native slice is not ready.");
  return window.__nativeSlice.snapshot().entities;
});

test("spawn-character 0 shows the character visual or the missing marker naming character:0 and its gap reason", async ({ page, baseURL }) => {
  test.setTimeout(worldReadyTimeout + modelLoadTimeout + 60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  await page.evaluate(() => window.__nativeSlice!.dispatch({ type: "spawn-character", characterTemplateIndex: 0 }));
  await expect.poll(async () => {
    const character = (await entities(page)).find(entity => entity.id === "character-0-1");
    return character === undefined ? null : character.modelId !== null || character.missingAssetDiagnostic !== null;
  }, { timeout: modelLoadTimeout }).toBe(true);
  const character = (await entities(page)).find(entity => entity.id === "character-0-1")!;
  const loaded = character.modelId !== null && character.missingAssetDiagnostic === null;
  if (!loaded) expect(character.missingAssetDiagnostic).toMatch(/^character:0 (gap|not in catalog): \S+/);
  if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
  writeLoadCheckRecord(laneName, await servedLaneCatalogSha256(baseURL), {
    key: "character:0", status: loaded ? "pass" : "failed", reason: loaded ? null : character.missingAssetDiagnostic,
    atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: loaded ? 2 : null,
  });
  expect(pageErrors).toEqual([]);
});
