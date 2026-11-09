import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport, landscapePhone } from "./browserViewports";

const windowLaneName = "data-ui";
const worldLaneName = "world";
const windowLaneCatalogPath = resolve("artifacts/lane-store", windowLaneName, "l2/catalog.json");
const worldLaneCatalogPath = resolve("artifacts/lane-store", worldLaneName, "l2/catalog.json");
const evidenceDirectory = resolve("artifacts/sandbox-evidence");
const statusWindowId = "StatusWnd";
const currentTileId = "20_21";
const missingClipName = "NoSuchClipInThisPackage";
const worldReadyTimeout = 240_000;
const portraitPhoneViewport = { width: 430, height: 932 };

function laneCatalogHolds(catalogPath: string, recordList: "windows" | "tiles", recordId: string): boolean {
  if (!existsSync(catalogPath)) return false;
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Partial<Record<typeof recordList, readonly { readonly id: string }[]>>;
  return catalog[recordList]?.some(record => record.id === recordId) ?? false;
}

const entities = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native slice is not ready.");
  return window.__nativeSlice.snapshot().entities;
});

const audioMixer = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native slice is not ready.");
  const mixer = window.__nativeSlice.snapshot().nativeAudio;
  if (!mixer) throw new Error("The native slice reports no audio mixer.");
  return { muted: mixer.muted, volume: mixer.volume };
});

async function openSandboxSection(page: Page, search = ""): Promise<void> {
  await page.goto(`/${search}`);
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-sandbox").click();
}

async function pickWindow(page: Page, windowId: string): Promise<void> {
  await page.getByTestId("sandbox-window-keys").locator("select").selectOption(`window:${windowId}`);
  await page.getByTestId("sandbox-window-keys-pick").click();
}

async function openStatusWindowOnce(page: Page): Promise<void> {
  await pickWindow(page, statusWindowId);
  await expect(page.getByTestId("sandbox-window-note")).toHaveText(/^window:StatusWnd opened/);
  await expect(page.locator(`[data-native-window="${statusWindowId}"]`)).toHaveCount(1);
}

function collectPageErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  return pageErrors;
}

test.describe("window picker on the native route", () => {
  test.skip(process.env.NATIVE_STORE_ROOT !== windowLaneName, "run with NATIVE_STORE_ROOT=data-ui");
  test.skip(!laneCatalogHolds(windowLaneCatalogPath, "windows", statusWindowId), "window:StatusWnd is not in the data-ui lane catalog");

  test.describe("desktop", () => {
    test.use({ viewport: desktopViewport });

    test("opens StatusWnd once in the native window layer and brings the same instance forward on a second pick", async ({ page }) => {
      test.setTimeout(worldReadyTimeout + 120_000);
      const pageErrors = collectPageErrors(page);
      await openSandboxSection(page);
      await openStatusWindowOnce(page);
      await pickWindow(page, statusWindowId);
      await expect(page.getByTestId("sandbox-window-note")).toHaveText(/^window:StatusWnd opened/);
      await expect(page.locator(`[data-native-window="${statusWindowId}"]`)).toHaveCount(1);
      mkdirSync(evidenceDirectory, { recursive: true });
      await page.screenshot({ path: resolve(evidenceDirectory, "sandbox-pickers-1440x900.png") });
      expect(pageErrors).toEqual([]);
    });
  });

  test.describe("landscape phone", () => {
    test.use(landscapePhone);

    test("opens StatusWnd from the window picker on a 932 x 430 touch phone", async ({ page }) => {
      test.setTimeout(worldReadyTimeout + 120_000);
      const pageErrors = collectPageErrors(page);
      await openSandboxSection(page);
      await openStatusWindowOnce(page);
      mkdirSync(evidenceDirectory, { recursive: true });
      await page.screenshot({ path: resolve(evidenceDirectory, "sandbox-pickers-932x430.png") });
      expect(pageErrors).toEqual([]);
    });
  });

  test.describe("portrait phone", () => {
    test.use({ viewport: portraitPhoneViewport, isMobile: true, hasTouch: true });

    test("keeps the page free of horizontal scroll at 430 x 932 with the Sandbox section and StatusWnd open", async ({ page }) => {
      test.setTimeout(worldReadyTimeout + 120_000);
      await openSandboxSection(page);
      await openStatusWindowOnce(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
});

test.describe("character spawn, play-clip and audio on the native route", () => {
  test.skip(process.env.NATIVE_STORE_ROOT === worldLaneName, "the world lane run covers only the tile case");
  test.use({ viewport: desktopViewport });

  test("spawns character 0 as its catalog says, plays a listed clip by name, refuses an unknown one and drives the mixer", async ({ page }) => {
    test.setTimeout(worldReadyTimeout + 180_000);
    const pageErrors = collectPageErrors(page);
    await openSandboxSection(page);

    await page.getByTestId("sandbox-spawn-character-characterTemplateIndex").fill("0");
    await page.getByTestId("sandbox-spawn-character-submit").click();
    const spawnNote = (await page.getByTestId("sandbox-spawn-note").textContent()) ?? "";
    expect(spawnNote).toMatch(/^character:0 /);
    await expect.poll(async () => (await entities(page)).some(entity => entity.id === "character-0-1")).toBe(true);
    if (spawnNote.startsWith("character:0 converted")) {
      await expect.poll(async () => {
        const character = (await entities(page)).find(entity => entity.id === "character-0-1");
        return character?.modelId !== null || character?.missingAssetDiagnostic === "character:0 converted but its player profile is not loaded in this sandbox";
      }, { timeout: 90_000 }).toBe(true);
    } else {
      const marker = (await entities(page)).find(entity => entity.id === "character-0-1");
      expect(marker).toMatchObject({ missingAssetDiagnostic: spawnNote.split("; unbounded because ")[0], meshCount: 0, hasNativeModel: false, modelId: null });
    }

    const localPlayer = (await entities(page)).find(entity => entity.id === "local-player");
    const listedClipName = localPlayer?.clipNames[0];
    if (listedClipName === undefined) throw new Error("The local player lists no clips.");
    expect(localPlayer?.clipNames).not.toContain(missingClipName);
    await page.evaluate(() => window.__nativeSlice!.dispatch({ type: "set-paused", isPaused: true }));
    await page.evaluate(clipName => window.__nativeSlice!.dispatch({ type: "play-clip", entityId: "local-player", clipName }), listedClipName);
    await expect.poll(async () => {
      const player = (await entities(page)).find(entity => entity.id === "local-player");
      if (player === undefined) throw new Error("The local player left the registry.");
      return { activeClip: player.playback?.activeClip ?? null, clipDiagnostic: player.clipDiagnostic };
    }).toEqual({ activeClip: listedClipName, clipDiagnostic: null });
    await page.evaluate(clipName => window.__nativeSlice!.dispatch({ type: "play-clip", entityId: "local-player", clipName }), missingClipName);
    await expect.poll(async () => (await entities(page)).find(entity => entity.id === "local-player")?.clipDiagnostic)
      .toBe(`clip ${missingClipName} not in local-player clip list`);
    await expect(page.locator('.entity-label[data-entity-id="local-player"] .entity-diagnostic')).toHaveText(`clip ${missingClipName} not in local-player clip list`);
    await page.evaluate(() => window.__nativeSlice!.dispatch({ type: "set-paused", isPaused: false }));

    await page.getByTestId("dev-tab-audio").click();
    const mixerBefore = await audioMixer(page);
    await page.getByTestId("mute-world-audio").click();
    await expect.poll(async () => (await audioMixer(page)).muted).toBe(!mixerBefore.muted);
    await page.getByTestId("world-audio-volume-master-input").fill("40");
    await expect.poll(async () => (await audioMixer(page)).volume).toBeCloseTo(.4, 5);
    expect(pageErrors).toEqual([]);
  });
});

test.describe("tile picker on a loaded tile", () => {
  test.skip(process.env.NATIVE_STORE_ROOT !== worldLaneName, "run with NATIVE_STORE_ROOT=world");
  test.skip(!laneCatalogHolds(worldLaneCatalogPath, "tiles", currentTileId), "tile:20_21 is not in the world lane catalog");
  test.use({ viewport: desktopViewport });

  test("answers already loaded for the current tile and leaves the URL unchanged", async ({ page }) => {
    test.setTimeout(worldReadyTimeout + 120_000);
    const pageErrors = collectPageErrors(page);
    await openSandboxSection(page, `?map=${currentTileId}`);
    const urlBefore = page.url();
    await page.getByTestId("sandbox-tile-tile").fill(currentTileId);
    await page.getByTestId("sandbox-tile-submit").click();
    await expect(page.getByTestId("sandbox-tile-note")).toHaveText(`tile ${currentTileId} already loaded`);
    expect(page.url()).toBe(urlBefore);
    expect(pageErrors).toEqual([]);
  });
});
