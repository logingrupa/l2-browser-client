import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, landscapePhone } from "./browserViewports";
import type { NativeSkillEffectHarnessState } from "./harness/nativeSkillEffectHarness";
import { hashServedLaneCatalog, writeLoadCheckRecord } from "./support/loadCheckRecordFile";

const laneName = "actors";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const evidenceDirectory = resolve("artifacts/skill-evidence");
const tracerSkill = "1011:1";
const tracerKey = "skill:1011:1";
const tracerRootBundleId = "interlude:skill-root:skill.wh.1011";
const harnessLoadTimeout = 120_000;
const portraitPhone = { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
type DoneState = Extract<NativeSkillEffectHarnessState, { state: "done" }>;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors DEV_PORT=5175");
test.skip(!existsSync(laneCatalogPath), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --skill 1011 --level 1 first");

async function openSkill(page: Page, skill: string): Promise<DoneState> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/tests/browser/harness/native-skill-effect.html?skill=${skill}`);
  await expect.poll(() => page.evaluate(() => window.__nativeSkillEffectHarness?.state ?? "missing"), { timeout: harnessLoadTimeout })
    .toMatch(/^(done|failed)$/);
  const state = await page.evaluate(() => window.__nativeSkillEffectHarness!);
  if (state.state === "failed") throw new Error(`the skill effect harness failed: ${state.reason}`);
  expect(pageErrors).toEqual([]);
  return state as DoneState;
}

async function withSkillPage(browser: Browser, contextOptions: BrowserContextOptions, skill: string, check: (page: Page, state: DoneState) => Promise<void>) {
  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    await check(page, await openSkill(page, skill));
  } finally {
    await context.close();
  }
}

test("loads the converted components of skill 1011 level 1 selected by ?skill= from the actors lane store", async ({ page, baseURL }) => {
  test.setTimeout(harnessLoadTimeout * 2);
  const state = await openSkill(page, tracerSkill);
  expect(state.key).toBe(tracerKey);
  expect(state.lookupStatus).toBe("converted");
  expect(state.preview?.manifestId).toBe(tracerRootBundleId);
  expect(state.preview?.components.map(component => component.class)).toEqual(expect.arrayContaining(["Engine.MeshEmitter", "Engine.SpriteEmitter"]));
  expect({ status: state.preview?.status, error: state.preview?.error }).toEqual({ status: "ready", error: null });
  expect(state.preview?.draws).toBeGreaterThan(0);
  await expect(page.locator("[data-effect-component]")).toHaveCount(state.preview!.components.length);
  if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
  writeLoadCheckRecord(laneName, await hashServedLaneCatalog(baseURL), {
    key: tracerKey, status: "pass", reason: null, atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: null,
  });
});

for (const [label, contextOptions, screenshotName] of [
  ["1440 x 900", { viewport: desktopViewport }, "skill-1011-1-1440x900.png"],
  ["932 x 430 on a landscape touch phone", landscapePhone, "skill-1011-1-932x430.png"],
] as const) {
  test(`shows the skill 1011 level 1 component list at ${label}`, async ({ browser }) => {
    test.setTimeout(harnessLoadTimeout * 2);
    await withSkillPage(browser, contextOptions, tracerSkill, async (page, state) => {
      expect(state.preview?.components.length).toBeGreaterThan(0);
      mkdirSync(evidenceDirectory, { recursive: true });
      await page.screenshot({ path: resolve(evidenceDirectory, screenshotName) });
    });
  });
}

test("has no horizontal scroll at 430 x 932 portrait", async ({ browser }) => {
  test.setTimeout(harnessLoadTimeout * 2);
  await withSkillPage(browser, portraitPhone, tracerSkill, async page => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
