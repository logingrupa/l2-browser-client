import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { comboboxRowByIdentifier } from "./support/devSheetComboboxDriver";

const staged = existsSync(resolve("public/l2/catalog.json"));
const screenshotDirectory = resolve("test-results/dev-sheet-combobox");
const worldReadyTimeout = 240_000;
const tileKeys = "sandbox-tile-keys";
const harnessCombobox = "harness-combobox";
const harnessPath = "/tests/browser/harness/dev-sheet-combobox.html";
const tileKeyPattern = /^tile:\d{2}_\d{2}$/;
const sectionTilePattern = /^map-(\d{2})-(\d{2})-section$/;
const minimumTouchRowHeight = 44;

interface ServedTileSources {
  readonly tiles?: readonly { readonly tile?: unknown }[];
  readonly sections?: readonly { readonly id?: unknown }[];
}

function collectPageErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  return pageErrors;
}

async function servedTileIds(request: APIRequestContext): Promise<ReadonlySet<string>> {
  const catalogResponse = await request.get("/l2/catalog.json");
  expect(catalogResponse.ok()).toBe(true);
  const catalog = await catalogResponse.json() as ServedTileSources;
  const tileIds = new Set<string>();
  for (const record of catalog.tiles ?? []) if (typeof record.tile === "string") tileIds.add(record.tile);
  for (const section of catalog.sections ?? []) {
    const match = typeof section.id === "string" ? sectionTilePattern.exec(section.id) : null;
    if (match) tileIds.add(`${match[1]}_${match[2]}`);
  }
  const coverageResponse = await request.get("/l2/coverage.json");
  if (coverageResponse.ok() && (coverageResponse.headers()["content-type"] ?? "").includes("application/json")) {
    const coverage = await coverageResponse.json() as { readonly rows?: readonly { readonly key?: unknown }[] };
    for (const row of coverage.rows ?? []) if (typeof row.key === "string" && tileKeyPattern.test(row.key)) tileIds.add(row.key.slice("tile:".length));
  }
  return tileIds;
}

function tileIdOutsideServedStore(servedIds: ReadonlySet<string>): string {
  for (let first = 0; first < 100; first += 1) {
    for (let second = 0; second < 100; second += 1) {
      const tileId = `${String(first).padStart(2, "0")}_${String(second).padStart(2, "0")}`;
      if (!servedIds.has(tileId)) return tileId;
    }
  }
  throw new Error("The served store holds every XX_YY tile id.");
}

async function openSandboxSection(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-sandbox").click();
}

async function expectTypedTileNotInCatalog(page: Page, absentTileId: string): Promise<void> {
  const input = page.getByTestId(`${tileKeys}-input`);
  await input.click();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  const identifiers = await page.getByTestId(`${tileKeys}-list`).locator(".dev-combobox-option-identifier").allTextContents();
  expect(identifiers.length).toBeGreaterThan(0);
  for (const identifier of identifiers) expect(identifier).toMatch(tileKeyPattern);
  await input.fill(absentTileId);
  const typedRow = comboboxRowByIdentifier(page, tileKeys, `tile:${absentTileId}`);
  await expect(page.getByTestId(`${tileKeys}-list`).locator(".dev-combobox-option")).toHaveCount(1);
  await expect(typedRow.locator(".dev-combobox-option-status")).toHaveText(/^not in catalog/);
  await expect(page.getByTestId(`${tileKeys}-pick`)).toBeDisabled();
}

async function expectEscapeClosesOnlyTheTileList(page: Page): Promise<void> {
  const input = page.getByTestId(`${tileKeys}-input`);
  await input.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId(`${tileKeys}-list`)).toBeHidden();
  await expect(page.locator('.dev-sheet[data-state="open"]')).toHaveCount(1);
}

async function activeHarnessRowIdentifier(page: Page): Promise<string> {
  const activeRowId = await page.getByTestId(`${harnessCombobox}-input`).getAttribute("aria-activedescendant");
  if (activeRowId === null) throw new Error("The harness combobox has no active row.");
  return (await page.locator(`[id="${activeRowId}"] .dev-combobox-option-identifier`).textContent()) ?? "";
}

async function expectKeyboardStepsThroughHarnessRows(page: Page): Promise<void> {
  await page.goto(harnessPath);
  await expect(page.locator('#dev-sheet-combobox-harness[data-status="ready"]')).toHaveCount(1);
  const input = page.getByTestId(`${harnessCombobox}-input`);
  await input.focus();
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId(`${harnessCombobox}-list`).locator(".dev-combobox-option")).toHaveCount(5);
  expect(await activeHarnessRowIdentifier(page)).toBe("harness:1");
  await input.press("ArrowDown");
  expect(await activeHarnessRowIdentifier(page)).toBe("harness:3");
  await input.press("ArrowDown");
  expect(await activeHarnessRowIdentifier(page)).toBe("harness:4");
  await input.press("End");
  expect(await activeHarnessRowIdentifier(page)).toBe("harness:5");
  await input.press("ArrowUp");
  expect(await activeHarnessRowIdentifier(page)).toBe("harness:4");
  await input.press("Home");
  expect(await activeHarnessRowIdentifier(page)).toBe("harness:1");
  await input.press("ArrowUp");
  expect(await activeHarnessRowIdentifier(page)).toBe("harness:5");
  await input.press("Enter");
  await expect(page.locator("#dev-sheet-combobox-harness")).toHaveAttribute("data-picked", "harness:5");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await input.press("ArrowDown");
  expect(await activeHarnessRowIdentifier(page)).toBe("harness:5");
  await input.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('.dev-sheet[data-state="open"]')).toHaveCount(1);
}

test.describe("developer sheet combobox harness", () => {
  test("steps Down, Up, Home and End past a disabled row, picks with Enter and reopens on the pick at 1440 x 900", async ({ page }) => {
    await page.setViewportSize(desktopViewport);
    const pageErrors = collectPageErrors(page);
    await expectKeyboardStepsThroughHarnessRows(page);
    expect(pageErrors).toEqual([]);
  });

  test.describe("landscape phone", () => {
    test.use(landscapePhone);

    test("steps through the rows and keeps every row at least 44 px tall on a 932 x 430 touch phone", async ({ page }) => {
      const pageErrors = collectPageErrors(page);
      await expectKeyboardStepsThroughHarnessRows(page);
      await page.getByTestId(`${harnessCombobox}-input`).fill("");
      const rowHeights = await page.getByTestId(`${harnessCombobox}-list`).locator(".dev-combobox-option")
        .evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
      expect(rowHeights).toHaveLength(5);
      for (const rowHeight of rowHeights) expect(rowHeight).toBeGreaterThanOrEqual(minimumTouchRowHeight);
      expect(pageErrors).toEqual([]);
    });
  });
});

test.describe("developer sheet tile combobox on the native route", () => {
  test.skip(!staged, "The native store must be staged at public/l2/catalog.json.");

  test.describe("desktop", () => {
    test.use({ viewport: desktopViewport });

    test("lists only tile keys, offers one not-in-catalog row for a tile the served store lacks and closes only the list on Escape at 1440 x 900",
      async ({ page, request }) => {
        test.setTimeout(worldReadyTimeout + 120_000);
        const pageErrors = collectPageErrors(page);
        const absentTileId = tileIdOutsideServedStore(await servedTileIds(request));
        await openSandboxSection(page);
        await expectTypedTileNotInCatalog(page, absentTileId);
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({ path: resolve(screenshotDirectory, "dev-sheet-combobox-1440x900.png") });
        await expectEscapeClosesOnlyTheTileList(page);
        expect(pageErrors).toEqual([]);
      });
  });

  test.describe("landscape phone", () => {
    test.use(landscapePhone);

    test("lists only tile keys, offers one not-in-catalog row for a tile the served store lacks and closes only the list on Escape on a 932 x 430 touch phone",
      async ({ page, request }) => {
        test.setTimeout(worldReadyTimeout + 120_000);
        const pageErrors = collectPageErrors(page);
        const absentTileId = tileIdOutsideServedStore(await servedTileIds(request));
        await openSandboxSection(page);
        await expectTypedTileNotInCatalog(page, absentTileId);
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({ path: resolve(screenshotDirectory, "dev-sheet-combobox-932x430.png") });
        await expectEscapeClosesOnlyTheTileList(page);
        await expectNoHorizontalScrollOnPortraitPhone(page);
        expect(pageErrors).toEqual([]);
      });
  });
});
