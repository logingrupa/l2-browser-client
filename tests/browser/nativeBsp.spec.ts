import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { actor940ContactPin, actor940ContactExpectation, readActor940ContactOracle } from "../fixtures/native940Contact";
const catalogPath = resolve("public/l2/catalog.json");
const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, "utf8")) : null;
const record = catalog?.sections?.find((item: { id: string }) => item.id === "map-20-20-section");
const manifest = record ? JSON.parse(readFileSync(resolve("public", record.manifest.slice(1)), "utf8")) : null;
const staged = Boolean(manifest?.bsp?.length);
const player = (page: Page) => page.evaluate(() => window.__nativeSlice!.snapshot().entities.find(entity => entity.id === "local-player")!);
async function move(page: Page, x: number, y: number, z: number) {
  await page.evaluate(position => window.__nativeSlice!.dispatch({ type: "move-local", position }), { x, y, z });
  await expect.poll(async () => (await player(page)).animation, { timeout: 90_000 }).toBe("idle");
  return (await player(page)).authoritativePosition;
}
for (const authored of [false, true]) test(`qualified BSP floor supports stairs and blocks building walls on ${authored ? "authored" : "source"} route`, async ({ page }, testInfo) => {
  test.skip(!staged, "Scoped BSP source bundle must be staged."); test.setTimeout(240_000);
  const contactOracle = readActor940ContactOracle(resolve(actor940ContactPin.path));
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`/${authored ? "?authored=1" : ""}`);
  await expect(page.locator("#loading")).toHaveCount(0, { timeout: 120_000 });
  const initial = await player(page);
  const profile = await page.evaluate(() => window.__nativeSlice!.snapshot().playerProfile);
  if (!profile) throw new Error("The selected native player profile is unavailable.");
  const oracleManifest = JSON.parse(readFileSync(resolve("public/l2/maps", contactOracle.manifest.sha256, "map-section-runtime/manifest.json"), "utf8"));
  expect({ ...manifest, bsp: oracleManifest.bsp }, "Only later qualified BSP additions may differ from the oracle manifest").toEqual(oracleManifest);
  expect(manifest.bsp.find((item: { id: string }) => item.id === "interlude:20_20.Model798.Brush397"), "The Actor940 slab stays identical").toEqual(oracleManifest.bsp[0]);
  expect(initial.authoritativePosition.x).toBeGreaterThan(103.8);
  const entered = await move(page, 98, -34.26, 950.15);
  expect(entered.x).toBeCloseTo(98, 5); expect(entered.z).toBeCloseTo(950.15, 5);
  expect(entered.y).toBeCloseTo(-34.26, 5); expect((await player(page)).hasNativeModel).toBe(true);
  const blocked = await move(page, 98, -34.55, 942);
  expect(blocked.z).toBeGreaterThan(944.5); expect(blocked.z).toBeLessThan(950);
  const contact = actor940ContactExpectation(contactOracle, blocked, profile.collisionRadius / profile.sourceUnitsPerMetre, authored);
  expect(blocked.y).toBeCloseTo(contact.expectedY, 5);
  const back = await move(page, 98, -34.26, 950.15);
  expect(back.z).toBeCloseTo(950.15, 5);
  const exited = await move(page, initial.authoritativePosition.x, initial.authoritativePosition.y, initial.authoritativePosition.z);
  expect(exited.x).toBeCloseTo(initial.authoritativePosition.x, 5);
  expect(exited.y).toBeCloseTo(initial.authoritativePosition.y, 5);
  const world = await page.evaluate(() => window.__nativeSlice!.snapshot().world);
  const bspTriangles = manifest.bsp.reduce((sum: number, item: { source: { file: string } }) => {
    const source = JSON.parse(readFileSync(resolve("public", record.manifest.slice(1), "../../map-section-bsp", item.source.file), "utf8"));
    return sum + source.indices.length / 3;
  }, 0);
  expect(world).toMatchObject({ bspMeshes: manifest.bsp.length, bspTriangles, collisionVerified: false });
  expect(errors).toEqual([]);
  await testInfo.attach("floor-traversal.json", { body: JSON.stringify({ initial: initial.authoritativePosition, entered, blocked, contact, exited, world: { manifest: world!.manifestSha256, navigation: world!.navigation }, errors }, null, 2), contentType: "application/json" });
});
test("missing BSP geometry prevents revealing an incomplete source world", async ({ page }) => {
  test.skip(!staged, "Scoped BSP source bundle must be staged."); test.setTimeout(180_000);
  await page.route("**/map-section-bsp/bsp-floor.glb", route => route.fulfill({ status: 404, body: "missing required source slab" }));
  await page.goto("/");
  await expect(page.locator("#loading")).toContainText("404", { timeout: 120_000 });
  await expect(page.locator(".world-interface")).toBeHidden();
  expect(await page.evaluate(() => window.__nativeSlice === undefined)).toBe(true);
});
