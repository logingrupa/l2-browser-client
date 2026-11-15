import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { combineAlpha, combineColour, combinerMaskValue } from "../../src/materials/ue2/model/combiner";
import { COMBINER_CONSTANTS } from "../../src/materials/ue2/model/constants/combinerConstants";
import type { ColourUnits } from "../../src/materials/ue2/model/materialFieldValues";
import { combinerSwatchInputRgba, materialSwatchFixtureFiles, swatchTextureRgba, type CombinerSwatchCase } from "../support/materialProgramFixture";

const evidenceDirectory = resolve("artifacts/02-60/material-swatch");
const combinerEvidenceDirectory = resolve("artifacts/02-92/combiner-swatch");
const fixture = materialSwatchFixtureFiles();
const pixelTolerance = 2;
const byteMaximum = 255;
const readbackQuantisationSteps = 1;

function unitColour(rgba: readonly number[]): ColourUnits {
  return [rgba[0]! / byteMaximum, rgba[1]! / byteMaximum, rgba[2]! / byteMaximum, rgba[3]! / byteMaximum];
}

function expectedCombinerPixel(swatchCase: CombinerSwatchCase): number[] {
  const material1 = unitColour(combinerSwatchInputRgba.material1);
  const material2 = unitColour(combinerSwatchInputRgba.material2);
  const mask = unitColour(combinerSwatchInputRgba.mask);
  const maskValue = combinerMaskValue(mask, false);
  const colour = combineColour(swatchCase.colourOperation, material1, material2, maskValue, mask, swatchCase.modulate2X ? 2 : 1);
  return [...colour, combineAlpha(swatchCase.alphaOperation, material1, material2, maskValue)].map(channel => channel * byteMaximum);
}

function expectPixelWithinReadbackQuantisation(actual: readonly number[] | null, expected: readonly number[]): void {
  expect(actual).not.toBeNull();
  expected.forEach((channel, index) => expect(Math.abs(actual![index]! - channel), `channel ${index}`).toBeLessThanOrEqual(readbackQuantisationSteps));
}

test.skip(process.env.NATIVE_STORE_ROOT !== "fixture", "run with NATIVE_STORE_ROOT=fixture DEV_PORT=5175");

function swatchUrl(materialId: string): string {
  return `/tests/browser/harness/material-swatch.html?material=${materialId}&levelSeconds=0.25&hour=12&environment=0`;
}

async function renderedSwatch(page: Page, materialId: string) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(swatchUrl(materialId));
  await expect(page.locator("#material-swatch")).toHaveAttribute("data-status", /^(rendered|failed)$/, { timeout: 60_000 });
  const state = await page.evaluate(() => window.__materialSwatch);
  expect(state?.failure ?? null).toBeNull();
  expect(errors).toEqual([]);
  return state!;
}

function expectPixelNear(actual: readonly number[] | null, expected: readonly number[]): void {
  expect(actual).not.toBeNull();
  expected.slice(0, 3).forEach((channel, index) => expect(Math.abs(actual![index]! - channel)).toBeLessThanOrEqual(pixelTolerance));
}

test.describe("material swatch harness", () => {
  test.beforeAll(async () => mkdir(evidenceDirectory, { recursive: true }));

  test("renders a served FinalBlend over a Shader with a Diffuse texture through the one factory at desktop and landscape phone", async ({ browser }) => {
    test.setTimeout(150_000);
    for (const [name, options] of [["desktop", { viewport: desktopViewport }], ["landscape-phone", landscapePhone]] as const) {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      const state = await renderedSwatch(page, fixture.swatchMaterialId);
      expect(state.material).toMatchObject({ status: "compiled", root: "SyntheticSwatch.SwatchFinalBlend",
        blend: { source: "final-blend", modeName: "FB_Overwrite", pair: { source: "one", destination: "zero" }, babylonAlphaMode: "ALPHA_DISABLE" } });
      expect(state.parameters).toEqual({ materialId: fixture.swatchMaterialId, levelSeconds: 0.25, hour: 12, environmentType: 0 });
      expectPixelNear(state.centrePixel, swatchTextureRgba);
      await page.screenshot({ path: resolve(evidenceDirectory, `swatch-${name}.png`) });
      if (name === "landscape-phone") await expectNoHorizontalScrollOnPortraitPhone(page);
      await context.close();
    }
  });

  test("renders an unported class as the magenta diagnostic named in a data attribute", async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: desktopViewport });
    const page = await context.newPage();
    const state = await renderedSwatch(page, fixture.unportedMaterialId);
    await expect(page.locator("#material-swatch")).toHaveAttribute("data-unported-class", "Engine.TexOscillatorTriggered");
    expect(state.material?.status).toBe("diagnostic");
    expectPixelNear(state.centrePixel, [255, 0, 255]);
    await page.screenshot({ path: resolve(evidenceDirectory, "unported-desktop.png") });
    await context.close();
  });

  test("renders every combiner colour and alpha operation equal to the CPU combiner within one 8-bit step", async ({ browser }) => {
    test.setTimeout(240_000);
    await mkdir(combinerEvidenceDirectory, { recursive: true });
    const [resultMinimum, resultMaximum] = COMBINER_CONSTANTS.resultClamp.runtimeDefault;
    const clampedChannels: number[] = [];
    const context = await browser.newContext({ viewport: desktopViewport });
    for (const { swatchCase, materialId } of fixture.combinerSwatches) {
      const page = await context.newPage();
      const state = await renderedSwatch(page, materialId);
      expect(state.material?.status).toBe("compiled");
      const expected = expectedCombinerPixel(swatchCase);
      clampedChannels.push(...expected.filter(channel => channel === resultMinimum * byteMaximum || channel === resultMaximum * byteMaximum));
      expectPixelWithinReadbackQuantisation(state.centrePixel, expected);
      await page.screenshot({ path: resolve(combinerEvidenceDirectory, `colour-${swatchCase.colourOperation}-alpha-${swatchCase.alphaOperation}.png`) });
      await page.close();
    }
    expect(clampedChannels).toContain(resultMinimum * byteMaximum);
    expect(clampedChannels).toContain(resultMaximum * byteMaximum);
    await context.close();
  });

  test("refuses a material id that is not a program SHA-256", async ({ page }) => {
    await page.goto("/tests/browser/harness/material-swatch.html?material=..%2Fcatalog&levelSeconds=0&hour=12&environment=0");
    await expect(page.locator("#material-swatch")).toHaveAttribute("data-status", "failed", { timeout: 30_000 });
    expect(await page.evaluate(() => window.__materialSwatch?.failure)).toMatch(/is not a material program SHA-256/);
  });
});
