import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const staged = existsSync(resolve("public/l2/catalog.json"));

async function openMovementTab(page: Page, characterId: string) {
  await page.goto(`/?character=${characterId}`);
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: 240_000 });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-movement").click();
}

test.use({ viewport: { width: 1440, height: 900 } });

for (const { characterId, expectedReadout } of [
  { characterId: "human-male-fighter", expectedReadout: "1.15 m/s (walk speed for the first 0.4 s)" },
  { characterId: "human-male-mystic", expectedReadout: "0.70 m/s (walk speed for the first 0 s), speed unresolved" },
]) {
  test(`movement readout for ${characterId} shows only a sourced speed as resolved`, async ({ page }) => {
    test.skip(!staged, "The native store must be staged at public/l2/catalog.json.");
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openMovementTab(page, characterId);
    await expect(page.getByTestId("native-locomotion-speed")).toHaveText(expectedReadout);
    expect(errors).toEqual([]);
  });
}
