import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async function openReadyLegacyReference(page: Page): Promise<void> {
  await page.goto("/tests/browser/terrainLegacyReference.html");
  await expect.poll(() => page.evaluate(() => {
    const state = window.__terrainLegacyReference?.snapshot();
    return state?.failure ?? state?.ready ?? false;
  }), { timeout: 60_000 }).toBe(true);
}

test("ordered legacy reference verifies explicit per-pass GPU states and discriminating pixels", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openReadyLegacyReference(page);
  const result = await page.evaluate(() => window.__terrainLegacyReference!.snapshot());
  const evidence = resolve(process.env.TERRAIN_REFERENCE_EVIDENCE ?? "artifacts/native-parity/research/terrain-uv-reference-20261106", testInfo.project.name);
  await mkdir(evidence, { recursive: true });
  await writeFile(resolve(evidence, "ordered-reference.json"), JSON.stringify({ ...result, errors }, null, 2) + "\n");
  await page.screenshot({ path: resolve(evidence, "ordered-reference-desktop.png"), fullPage: true });
  expect(result.failure).toBeNull(); expect(errors).toEqual([]);
  expect(result.cases).toHaveLength(44);
  const uvCases = result.cases.filter(item => item.uvCase !== null);
  expect(uvCases).toHaveLength(24);
  for (const item of uvCases) {
    const coordinate = item.uvCase!;
    expect(coordinate.coordinate).toBe(coordinate.expectedCoordinate);
    expect(item.receipt.perPass[1]!.mask.uvRows[1]).toEqual([0, 0, coordinate.expectedCoordinate]);
    expect(item.receipt.perPass[1]!.mask.height).toBe(coordinate.maskHeight);
    expect(item.receipt.perPass[1]!.mask.filter).toBe(coordinate.filter);
    const alternate = uvCases.find(other => other.uvCase!.gridY === coordinate.gridY &&
      other.uvCase!.maskHeight === coordinate.maskHeight && other.uvCase!.filter === coordinate.filter &&
      other.uvCase!.branch !== coordinate.branch);
    expect(alternate).toBeDefined();
    if (coordinate.gridY === 240) expect(item.receipt.pixels).toEqual(alternate!.receipt.pixels);
    else expect(Math.abs(item.actualRgba[1]! - alternate!.actualRgba[1]!)).toBeGreaterThan(2);
  }
  for (const item of result.cases) {
    expect(item.maximumByteError, `${item.id}: actual ${item.actualRgba} expected ${item.expectedRgba}`).toBeLessThanOrEqual(1);
    expect(item.receipt.resources.texturesAfter, item.id).toBe(item.receipt.resources.texturesBefore);
    expect(item.receipt.resources.targetDisposed).toBe(true);
    expect(item.receipt.target).toMatchObject({ format: "RGBA8", samples: 1, componentBits: [8, 8, 8, 8] });
    expect(item.receipt.engine.webGLVersion).toBe(2);
    expect(item.receipt.perPass.length).toBeGreaterThan(1);
    for (const [index, pass] of item.receipt.perPass.entries()) {
      expect(pass.firstPass).toBe(index === 0);
      expect(pass.state.blendEnabled).toBe(index !== 0);
      expect(pass.state.depthTest).toBe(false); expect(pass.state.stencilTest).toBe(false);
      if (index > 0) {
        expect(pass.state).toMatchObject({ srcRgb: 770, dstRgb: 771, dstAlpha: 771, equationRgb: 32774, equationAlpha: 32774 });
        expect(pass.state.srcAlpha).toBe(item.receipt.alphaAssumption === "shared-factors" ? 770 : 1);
      }
    }
  }
  await page.getByLabel("Show only native UV branch cases").check();
  await page.screenshot({ path: resolve(evidence, "uv-reference-desktop.png"), fullPage: true });
  const phoneContext = await browser.newContext({ viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true });
  try {
    const phone = await phoneContext.newPage();
    await openReadyLegacyReference(phone);
    await phone.getByLabel("Show only native UV branch cases").check();
    await phone.screenshot({ path: resolve(evidence, "ordered-reference-mobile.png"), fullPage: true });
  } finally { await phoneContext.close(); }
});
