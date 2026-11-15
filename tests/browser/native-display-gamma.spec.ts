import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { DISPLAY_GAMMA_CONSTANTS } from "../../src/materials/ue2/model/constants/displayGammaConstants";

const staged = existsSync(resolve("public/l2/catalog.json"));
const evidenceDirectory = resolve("artifacts/02-92/display-gamma");
const worldReadyTimeout = 180_000;
const displayGammaRows = [DISPLAY_GAMMA_CONSTANTS.ramp, DISPLAY_GAMMA_CONSTANTS.gamma, DISPLAY_GAMMA_CONSTANTS.brightnessAndContrast];

function observePageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

async function openWorldSheet(page: Page, press: "click" | "tap"): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#loading")).toHaveCount(0, { timeout: worldReadyTimeout });
  await expect(page.locator("#canvas")).toBeVisible();
  await page.getByTestId("dev-sheet-toggle")[press]();
  await page.getByTestId("dev-tab-world")[press]();
}

async function expectDisplayGammaNote(page: Page): Promise<void> {
  const note = page.getByTestId("sandbox-display-gamma-note");
  await expect(note).toBeVisible();
  for (const row of displayGammaRows) await expect(note).toContainText(row.id);
  for (const row of displayGammaRows) await expect(note).toContainText(`(${row.status})`);
  await expect(note).toContainText(`gamma.setting ${DISPLAY_GAMMA_CONSTANTS.gamma.runtimeDefault}`);
}

test.describe("display gamma post-process on the native route", () => {
  test.skip(!staged, "Run pnpm assets:migrate --stage-runtime first.");

  test("lists the UpdateGamma ramp rows in the world sheet at desktop", async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ viewport: desktopViewport });
    const page = await context.newPage();
    const errors = observePageErrors(page);
    await openWorldSheet(page, "click");
    await expectDisplayGammaNote(page);
    await mkdir(evidenceDirectory, { recursive: true });
    await page.getByTestId("sandbox-display-gamma-note").scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(evidenceDirectory, "display-gamma-desktop.png") });
    expect(errors).toEqual([]);
    await context.close();
  });

  test("lists the UpdateGamma ramp rows in the world sheet on the landscape phone", async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext(landscapePhone);
    const page = await context.newPage();
    const errors = observePageErrors(page);
    await openWorldSheet(page, "tap");
    await expectDisplayGammaNote(page);
    await mkdir(evidenceDirectory, { recursive: true });
    await page.getByTestId("sandbox-display-gamma-note").scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(evidenceDirectory, "display-gamma-landscape-phone.png") });
    await expectNoHorizontalScrollOnPortraitPhone(page);
    expect(errors).toEqual([]);
    await context.close();
  });
});
