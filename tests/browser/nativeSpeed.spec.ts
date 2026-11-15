import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { desktopViewport, landscapePhone } from "./browserViewports";

const staged = existsSync(resolve("public/l2/catalog.json"));
const speedEvidence = resolve("artifacts/native-speed");

async function openMovementTab(page: Page, characterId: string) {
  await page.goto(`/?character=${characterId}`);
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: 240_000 });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-movement").click();
}

async function dispatchLocalMoveAndReadDestination(page: Page) {
  return page.evaluate(() => {
    const nativeSlice = window.__nativeSlice!;
    const player = nativeSlice.snapshot().entities.find(entity => entity.id === "local-player")!;
    nativeSlice.dispatch({ type: "move-local", position: { x: player.position.x + .35, y: player.position.y, z: player.position.z + .15 } });
    return nativeSlice.snapshot().movement?.lastLocalDestination ?? null;
  });
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

test.describe("sourced fighter speed", () => {
  test.use({ viewport: desktopViewport });
  test("human-male-fighter shows the aCis speed readout and sends a move record", async ({ page }) => {
    test.skip(!staged, "The native store must be staged at public/l2/catalog.json.");
    test.setTimeout(300_000);
    const errors = collectPageErrors(page);
    await openMovementTab(page, "human-male-fighter");
    await expect(page.getByTestId("native-locomotion-speed")).toHaveText("1.15 m/s (walk speed for the first 0.4 s)");
    await expect(page.getByTestId("native-speed-unresolved")).toHaveCount(0);
    expect(await dispatchLocalMoveAndReadDestination(page)).not.toBeNull();
    expect(errors).toEqual([]);
  });
});

for (const { name, use } of [{ name: "desktop", use: { viewport: desktopViewport } }, { name: "mobile", use: landscapePhone }]) {
  test.describe(`unresolved mystic speed on ${name}`, () => {
    test.use(use);
    test(`human-male-mystic shows speed-unresolved, no gait card, and move-local sends no move record on ${name}`, async ({ page }) => {
      test.skip(!staged, "The native store must be staged at public/l2/catalog.json.");
      test.setTimeout(300_000);
      const errors = collectPageErrors(page);
      await openMovementTab(page, "human-male-mystic");
      const unresolvedNote = page.getByTestId("native-speed-unresolved");
      await expect(unresolvedNote).toHaveText("speed-unresolved: speed unresolved for human-male-mystic: no sourced server speed is recorded for this class");
      await expect(page.getByTestId("native-locomotion-controls")).toHaveCount(0);
      expect(await page.evaluate(() => window.__nativeSlice!.snapshot().locomotion?.speed)).toEqual({ isSourced: false, playerProfileId: "human-male-mystic",
        source: "speed unresolved for human-male-mystic: no sourced server speed is recorded for this class" });
      expect(await dispatchLocalMoveAndReadDestination(page)).toBeNull();
      await unresolvedNote.scrollIntoViewIfNeeded();
      await mkdir(speedEvidence, { recursive: true });
      await page.screenshot({ path: resolve(speedEvidence, `mystic-speed-unresolved-${name}.png`) });
      expect(errors).toEqual([]);
    });
  });
}
