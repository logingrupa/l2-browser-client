import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

test("native DDS textures upload original complete and partial mip chains and render", async ({ page }) => {
  test.skip(!existsSync(resolve("artifacts/native-parity/migration/coverage.json")), "Run pnpm assets:migrate first.");
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/tests/browser/nativeTexture.html");
  const snapshot = () => page.evaluate(() => {
    if (!window.__nativeTexture) throw new Error("Native texture inspector is missing.");
    return window.__nativeTexture.snapshot();
  });
  await expect.poll(async () => (await snapshot()).ready, { timeout: 90_000 }).toBe(true);
  await expect.poll(async () => (await snapshot()).renders).toBeGreaterThan(10);
  const samples = await page.evaluate(() => {
    if (!window.__nativeTexture) throw new Error("Native texture inspector is missing.");
    return window.__nativeTexture.framebufferSamples();
  });
  const result = await snapshot();
  expect(result.failure).toBeNull(); expect(result.capabilities.s3tc).toBe(true);
  expect(result.glErrors).toEqual([]); expect(errors).toEqual([]);
  expect(result.textures).toHaveLength(2);
  expect(result.textures.map(texture => texture.completeTo1x1)).toEqual([true, false]);
  for (const texture of result.textures) {
    expect(texture.ready).toBe(true);
    const uploaded = result.uploads.filter(upload => upload.url === `data:${texture.id}.dds`).sort((a, b) => a.level - b.level);
    expect(uploaded).toHaveLength(texture.expectedMips.length);
    for (const [index, mip] of texture.expectedMips.entries()) {
      expect(uploaded[index]).toMatchObject({ format: 33777, width: mip.width, height: mip.height,
        face: 0, level: mip.level, bytes: mip.bytes, sha256: mip.sourceSha256 });
    }
  }
  expect(samples).toHaveLength(2);
  for (const sample of samples) expect(sample.distinctRGB).toBeGreaterThan(1);
  const evidence = resolve("artifacts/native-parity/research/compressed-textures");
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "browser-desktop.png") });
  await writeFile(resolve(evidence, "browser-result.json"), JSON.stringify({ ...result, framebufferSamples: samples, errors }, null, 2));
});
