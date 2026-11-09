import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";

const laneName = "actors";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const evidenceDirectory = resolve("artifacts/npc-evidence");
const gremlinNpcId = 20001;
const gremlinEntityId = `npc-${gremlinNpcId}-1`;
const worldReadyTimeout = 240_000;
const modelLoadTimeout = 90_000;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors");
test.skip(!existsSync(laneCatalogPath), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --batch npcs first");
test.use({ viewport: desktopViewport });

const entities = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native slice is not ready.");
  return window.__nativeSlice.snapshot().entities;
});

test("the sandbox spawns the converted lane NPC npc:20001 by id with its converted model", async ({ page }) => {
  test.setTimeout(worldReadyTimeout + modelLoadTimeout + 60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-sandbox").click();
  await page.getByTestId("sandbox-spawn-npc-npcId").fill(String(gremlinNpcId));
  await page.getByTestId("sandbox-spawn-npc-submit").click();
  await expect(page.getByTestId("sandbox-spawn-npc-note")).toHaveText(`npc:${gremlinNpcId} converted`);
  await expect(page.getByTestId("sandbox-spawn-npc-note")).toHaveAttribute("data-tone", "info");
  await expect.poll(async () => (await entities(page)).find(entity => entity.id === gremlinEntityId)?.modelId ?? null, { timeout: modelLoadTimeout })
    .not.toBeNull();
  const gremlin = (await entities(page)).find(entity => entity.id === gremlinEntityId);
  expect(gremlin).toMatchObject({ hasNativeModel: true, missingAssetDiagnostic: null });
  expect(gremlin?.meshCount).toBeGreaterThan(0);
  expect(gremlin?.skeletons.length).toBeGreaterThan(0);
  await expect(page.locator(`.entity-label[data-entity-id="${gremlinEntityId}"] .entity-diagnostic`)).toBeHidden();
  mkdirSync(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDirectory, "sandbox-npc-20001-spawn-1440x900.png") });
  expect(pageErrors).toEqual([]);
});
