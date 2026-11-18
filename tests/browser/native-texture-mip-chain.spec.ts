import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";
import { TEXTURE_COMPRESSION_BC_UNAVAILABLE_REASON } from "../../src/materials/ue2/model/textureMipChain";
import { swatchTextureRgba } from "../support/materialProgramFixture";
import { mipChainSwatch, type MipChainSwatch } from "../support/nativeMipChainFixture";

const evidenceDirectory = resolve("artifacts/sky-shared-skylevel/native-texture-mip-chain");
const swatchColourDistance = 8;

async function routeSwatchFiles(page: Page, swatch: MipChainSwatch): Promise<void> {
  await page.route(url => swatch.servedFiles.has(url.pathname), async route => {
    const bytes = swatch.servedFiles.get(new URL(route.request().url()).pathname)!;
    await route.fulfill({ status: 200, body: Buffer.from(bytes), contentType: "application/octet-stream" });
  });
}

function differsFromTheSwatchPng(pixel: readonly number[]): boolean {
  return swatchTextureRgba.slice(0, 3).some((channel, index) => Math.abs(pixel[index]! - channel) > swatchColourDistance);
}

test.describe("native texture mip chain upload on WebGPU", () => {
  test.beforeAll(async () => mkdir(evidenceDirectory, { recursive: true }));

  for (const object of ["l2_skies.FlareSet.Sun01", "l2_skies.Textures.mongebg"]) {
    test(`draws ${object} from its original levels without a WebGPU error`, async ({ browser }) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({ viewport: desktopViewport });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      const gpuWarnings: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      page.on("console", message => { if (/uncaptured|validation/i.test(message.text())) gpuWarnings.push(message.text()); });
      const swatch = mipChainSwatch(object);
      await routeSwatchFiles(page, swatch);
      await page.goto(`/tests/browser/harness/material-swatch.html?material=${swatch.materialId}&levelSeconds=0&hour=12&environment=0`);
      await expect(page.locator("#material-swatch")).toHaveAttribute("data-status", /^(rendered|failed)$/, { timeout: 60_000 });
      const state = await page.evaluate(() => window.__materialSwatch);
      expect(state?.failure ?? null).toBeNull();
      expect(pageErrors).toEqual([]);
      expect(gpuWarnings).toEqual([]);
      const usedTheChain = !(state!.material!.reasons as readonly string[]).includes(TEXTURE_COMPRESSION_BC_UNAVAILABLE_REASON);
      expect(differsFromTheSwatchPng(state!.centrePixel!)).toBe(usedTheChain);
      await page.screenshot({ path: resolve(evidenceDirectory, `${object}-desktop.png`) });
      await context.close();
    });
  }
});
