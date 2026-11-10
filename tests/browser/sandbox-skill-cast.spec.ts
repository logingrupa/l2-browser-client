import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, landscapePhone } from "./browserViewports";
import type { NativeSkillEffectHarnessState } from "./harness/nativeSkillEffectHarness";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";
import { checkHarnessLoadKey } from "./support/loadCheckRecords";

const laneName = "actors";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const evidenceDirectory = resolve("artifacts/skill-evidence");
const tracerSkill = "1011:1";
const tracerKey = "skill:1011:1";
const tracerRootBundleId = "interlude:skill-root:skill.wh.1011";
const dispatchRequiredSkill = "3:2";
const dispatchRequiredKey = "skill:3:2";
const harnessLoadTimeout = 120_000;
const portraitPhone = { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const powerStrikeSkill = "3:1";
const powerStrikeActors = [{ actorObject: "lineageeffect.s_u002_a", dispatchStages: ["init"] }, { actorObject: "lineageeffect.p_u004_a", dispatchStages: ["shot"] }];
type DoneState = Extract<NativeSkillEffectHarnessState, { state: "done" }>;


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

async function screenshotWhileCasting(page: Page, screenshotName: string) {
  await page.goto(`/tests/browser/harness/native-skill-effect.html?skill=${powerStrikeSkill}`);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__nativeSkillEffectHarness;
    return state?.state === "casting" ? state.liveParticles : state?.state ?? "missing";
  }), { timeout: harnessLoadTimeout }).toBeGreaterThan(0);
  mkdirSync(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDirectory, screenshotName) });
}

test.describe("Power Strike from the shared native store", () => {
  test.skip(process.env.NATIVE_STORE_ROOT !== undefined, "run without NATIVE_STORE_ROOT so /l2 serves the shared store that holds skill 3 level 1");

  test("plays both Power Strike emitter actors of ?skill=3:1 through the particle simulator", async ({ page }) => {
    test.setTimeout(harnessLoadTimeout * 2);
    const state = await openSkill(page, powerStrikeSkill);
    expect({ key: state.key, lookupStatus: state.lookupStatus }).toEqual({ key: "skill:3:1", lookupStatus: "converted" });
    expect({ status: state.preview?.status, error: state.preview?.error, policy: state.preview?.policy }).toEqual({ status: "ready", error: null, policy: "simulated-source-component" });
    expect(state.preview?.draws).toBeGreaterThan(0);
    expect(state.cast.map(actor => ({ actorObject: actor.actorObject, dispatchStages: actor.dispatchStages, status: actor.status }))).toEqual(
      expect.arrayContaining(powerStrikeActors.map(actor => ({ ...actor, status: "destroyed" }))));
    for (const actor of state.cast) {
      expect(actor.peakLiveParticles, actor.actorObject).toBeGreaterThan(0);
      expect(actor.simulationSteps, actor.actorObject).toBeGreaterThan(0);
      expect(actor.drawnFrames, actor.actorObject).toBeGreaterThan(0);
    }
  });

  for (const [label, contextOptions, screenshotName] of [
    ["1440 x 900", { viewport: desktopViewport }, "skill-3-1-cast-1440x900.png"],
    ["932 x 430 on a landscape touch phone", landscapePhone, "skill-3-1-cast-932x430.png"],
  ] as const) {
    test(`shows simulated Power Strike particles at ${label}`, async ({ browser }) => {
      test.setTimeout(harnessLoadTimeout * 2);
      const context = await browser.newContext(contextOptions);
      try { await screenshotWhileCasting(await context.newPage(), screenshotName); } finally { await context.close(); }
    });
  }

  test("has no horizontal scroll at 430 x 932 portrait while casting Power Strike", async ({ browser }) => {
    test.setTimeout(harnessLoadTimeout * 2);
    await withSkillPage(browser, portraitPhone, powerStrikeSkill, async page => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
});

test.describe("actors lane store", () => {
  test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors DEV_PORT=5175");
  test.skip(!existsSync(laneCatalogPath), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --skill 1011 --level 1 first");

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
    const outcome = await checkHarnessLoadKey(page, tracerKey);
    writeLoadCheckRecord(laneName, await servedLaneCatalogSha256(baseURL), { key: tracerKey, ...outcome, atRiga: formatRigaTimestamp(new Date()) });
  });

  test("shows the native-skill-dispatch-required gap of skill 3 level 2 from the lane coverage with no effect component loaded", async ({ page }) => {
    test.setTimeout(harnessLoadTimeout * 2);
    const state = await openSkill(page, dispatchRequiredSkill);
    expect(state).toMatchObject({ key: dispatchRequiredKey, lookupStatus: "gap", note: `${dispatchRequiredKey} gap: native-skill-dispatch-required`, preview: null });
    await expect(page.locator("#native-skill-effect-note")).toHaveText(`${dispatchRequiredKey} gap: native-skill-dispatch-required`);
    await expect(page.locator("[data-effect-component]")).toHaveCount(0);
    await page.setViewportSize(desktopViewport);
    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, "skill-3-2-gap-1440x900.png") });
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
});
