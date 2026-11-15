import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { comboboxRowByIdentifier } from "./support/devSheetComboboxDriver";

const staged = existsSync(resolve("public/l2/catalog.json"));
const screenshotDirectory = resolve("test-results/dev-sheet-combobox");
const worldReadyTimeout = 240_000;
const tileKeys = "sandbox-tile-keys";
const typedTileId = "20_21";
const tileKeyPattern = /^tile:\d{2}_\d{2}$/;
const minimumTouchRowHeight = 44;

test.skip(!staged, "The native store must be staged at public/l2/catalog.json.");

function collectPageErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  return pageErrors;
}

async function openSandboxSection(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-sandbox").click();
}

async function expectOpenTileCombobox(page: Page): Promise<void> {
  const input = page.getByTestId(`${tileKeys}-input`);
  await input.click();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  const identifiers = await page.getByTestId(`${tileKeys}-list`).locator(".dev-combobox-option-identifier").allTextContents();
  expect(identifiers.length).toBeGreaterThan(0);
  for (const identifier of identifiers) expect(identifier).toMatch(tileKeyPattern);
  await input.fill(typedTileId);
  await expect(comboboxRowByIdentifier(page, tileKeys, `tile:${typedTileId}`)).toHaveCount(1);
  await expect(page.getByTestId(`${tileKeys}-pick`)).toBeDisabled();
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", /option-0$/);
}

async function expectEscapeClosesOnlyTheList(page: Page): Promise<void> {
  const input = page.getByTestId(`${tileKeys}-input`);
  await input.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId(`${tileKeys}-list`)).toBeHidden();
  await expect(page.locator('.dev-sheet[data-state="open"]')).toHaveCount(1);
}

test.describe("developer sheet combobox", () => {
  test.describe("desktop", () => {
    test.use({ viewport: desktopViewport });

    test("opens the tile combobox, offers a typed tile and closes only the list on Escape at 1440 x 900", async ({ page }) => {
      test.setTimeout(worldReadyTimeout + 120_000);
      const pageErrors = collectPageErrors(page);
      await openSandboxSection(page);
      await expectOpenTileCombobox(page);
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({ path: resolve(screenshotDirectory, "dev-sheet-combobox-1440x900.png") });
      await expectEscapeClosesOnlyTheList(page);
      expect(pageErrors).toEqual([]);
    });
  });

  test.describe("landscape phone", () => {
    test.use(landscapePhone);

    test("opens the tile combobox with 44 px touch rows on a 932 x 430 phone", async ({ page }) => {
      test.setTimeout(worldReadyTimeout + 120_000);
      const pageErrors = collectPageErrors(page);
      await openSandboxSection(page);
      await expectOpenTileCombobox(page);
      const rowBox = await comboboxRowByIdentifier(page, tileKeys, `tile:${typedTileId}`).boundingBox();
      expect(rowBox?.height ?? 0).toBeGreaterThanOrEqual(minimumTouchRowHeight);
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({ path: resolve(screenshotDirectory, "dev-sheet-combobox-932x430.png") });
      await expectEscapeClosesOnlyTheList(page);
      await expectNoHorizontalScrollOnPortraitPhone(page);
      expect(pageErrors).toEqual([]);
    });
  });
});
