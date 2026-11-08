import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const staged = existsSync(resolve("public/l2/catalog.json"));

const entities = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native slice is not ready.");
  return window.__nativeSlice.snapshot().entities;
});

async function submitIdEntry(page: Page, testId: string, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) await page.getByTestId(`${testId}-${name}`).fill(value);
  await page.getByTestId(`${testId}-submit`).click();
}

async function zoomCameraOut(page: Page) {
  const canvas = await page.locator("canvas").first().boundingBox();
  if (!canvas) throw new Error("The world canvas is not laid out.");
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  for (let wheelStep = 0; wheelStep < 6; wheelStep++) await page.mouse.wheel(0, 400);
}

test.use({ viewport: { width: 1440, height: 900 } });

test("sandbox sheet spawns, equips and opens by ID and marks missing assets without a stand-in", async ({ page }) => {
  test.skip(!staged, "The native store must be staged at public/l2/catalog.json.");
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: 240_000 });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-sandbox").click();
  const startingCount = (await entities(page)).length;

  await submitIdEntry(page, "sandbox-spawn-npc", { npcId: "12345" });
  await expect(page.getByTestId("sandbox-spawn-npc-note")).toHaveText("npc:12345 not in catalog");
  await expect(page.getByTestId("sandbox-spawn-npc-note")).toHaveAttribute("data-tone", "warning");
  await zoomCameraOut(page);
  const marker = page.locator('.entity-label[data-entity-id="npc-12345-1"]');
  await expect(marker).toBeVisible();
  await expect(marker.locator(".entity-diagnostic")).toHaveText("npc:12345 not in catalog");
  const afterMissing = await entities(page);
  expect(afterMissing).toHaveLength(startingCount + 1);
  expect(afterMissing.find(entity => entity.id === "npc-12345-1")).toMatchObject({
    missingAssetDiagnostic: "npc:12345 not in catalog", meshCount: 0, skeletons: [], modelId: null, hasNativeModel: false });
  await page.screenshot({ path: resolve("test-results/sandbox-missing-asset.png") });

  await submitIdEntry(page, "sandbox-spawn-npc", { npcId: "21622" });
  await expect(page.getByTestId("sandbox-spawn-npc-note")).toHaveText("npc:21622 converted, model musveren:0");
  await expect.poll(async () => (await entities(page)).find(entity => entity.id === "npc-21622-2")?.modelId ?? null, { timeout: 60_000 }).not.toBeNull();
  const converted = (await entities(page)).find(entity => entity.id === "npc-21622-2");
  expect(converted?.missingAssetDiagnostic).toBeNull();
  expect(converted?.skeletons.length).toBeGreaterThan(0);
  await expect(page.locator('.entity-label[data-entity-id="npc-21622-2"] .entity-diagnostic')).toBeHidden();

  await submitIdEntry(page, "sandbox-equip-item", { itemId: "22" });
  await expect(page.getByTestId("sandbox-equip-item-note")).toHaveText("item:22 converted");
  await expect(page.getByTestId("sandbox-equip-item-note")).toHaveAttribute("data-tone", "info");
  await submitIdEntry(page, "sandbox-equip-item", { itemId: "999999" });
  await expect(page.getByTestId("sandbox-equip-item-note")).toHaveText("item:999999 not in catalog");
  await submitIdEntry(page, "sandbox-open-window", { name: "StatusWnd" });
  await expect(page.getByTestId("sandbox-open-window-note")).toHaveText("window:StatusWnd not in catalog: interface windows are not converted yet (UI-01)");

  const countBeforeRejectedInput = (await entities(page)).length;
  await submitIdEntry(page, "sandbox-spawn-npc", { npcId: "abc" });
  await expect(page.getByTestId("sandbox-spawn-npc-message")).toHaveText("NPC ID must be a whole number of at most 9 digits.");
  expect(await entities(page)).toHaveLength(countBeforeRejectedInput);
  expect(errors).toEqual([]);
});
