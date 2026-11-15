import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { parseSkillEffectComponentId } from "../../src/effects/castSkillIndex";
import { desktopViewport, landscapePhone } from "./browserViewports";
import type { NativeSkillEffectHarnessState } from "./harness/nativeSkillEffectHarness";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";
import { checkHarnessLoadKey } from "./support/loadCheckRecords";

const laneName = "actors";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const laneCoveragePath = resolve("artifacts/lane-store", laneName, "l2/coverage.json");
const emitterClassGapPrefix = "emitter-class-unported:";
const worldReadyTimeout = 240_000;
const evidenceDirectory = resolve("artifacts/skill-evidence");
const tracerSkill = "1011:1";
const tracerKey = "skill:1011:1";
const tracerRootBundleId = "interlude:skill-root:skill.wh.1011";
const dispatchCandidateSkill = "3:2";
const dispatchCandidateKey = "skill:3:2";
const lowestUnresolvedDispatchSkill = "42:1";
const lowestUnresolvedDispatchKey = "skill:42:1";
const harnessLoadTimeout = 120_000;
const portraitPhone = { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const powerStrikeSkill = "3:1";
const powerStrikeKey = "skill:3:1";
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

  test("shows the dispatch candidate gap of skill 3 level 2 from the lane coverage with no effect component loaded", async ({ page }) => {
    test.setTimeout(harnessLoadTimeout * 2);
    const state = await openSkill(page, dispatchCandidateSkill);
    const note = `${dispatchCandidateKey} gap: skill-dispatch-candidate-runtime-unresolved`;
    expect(state).toMatchObject({ key: dispatchCandidateKey, lookupStatus: "gap", note, preview: null });
    await expect(page.locator("#native-skill-effect-note")).toHaveText(note);
    await expect(page.locator("[data-effect-component]")).toHaveCount(0);
    await page.setViewportSize(desktopViewport);
    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, "skill-3-2-gap-1440x900.png") });
  });

  test("shows the native-skill-dispatch-required gap of the lowest unresolved row, skill 42 level 1, with no effect component loaded", async ({ page }) => {
    test.setTimeout(harnessLoadTimeout * 2);
    const state = await openSkill(page, lowestUnresolvedDispatchSkill);
    const note = `${lowestUnresolvedDispatchKey} gap: native-skill-dispatch-required`;
    expect(state).toMatchObject({ key: lowestUnresolvedDispatchKey, lookupStatus: "gap", note, preview: null });
    await expect(page.locator("#native-skill-effect-note")).toHaveText(note);
    await expect(page.locator("[data-effect-component]")).toHaveCount(0);
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

interface LaneSkillChoice { readonly skillId: number; readonly level: number; readonly key: string; readonly reason: string | null }

function laneSkillChoices(): { readonly converted: LaneSkillChoice; readonly emitterClassGap: LaneSkillChoice } {
  const catalog = JSON.parse(readFileSync(laneCatalogPath, "utf-8")) as { effectComponents?: { id: string }[] };
  const coverage = JSON.parse(readFileSync(laneCoveragePath, "utf-8")) as { rows: { key: string; converted: boolean; reason: string | null }[] };
  const rowByKey = new Map(coverage.rows.map(row => [row.key, row]));
  const convertedChoices = (catalog.effectComponents ?? []).flatMap(record => {
    const identity = parseSkillEffectComponentId(record.id);
    if (identity === null) return [];
    const key = `skill:${identity.skillId}:${identity.level}`, row = rowByKey.get(key);
    return row?.converted ? [{ ...identity, key, reason: row.reason }] : [];
  }).sort((first, second) => first.skillId - second.skillId || first.level - second.level);
  const converted = convertedChoices.find(choice => choice.key !== powerStrikeKey);
  const emitterClassGap = convertedChoices.find(choice => choice.reason?.startsWith(emitterClassGapPrefix));
  if (!converted || !emitterClassGap) throw new Error("the actors lane store holds no converted skill other than 3:1 or no emitter class gap");
  return { converted, emitterClassGap };
}

async function openSandboxTab(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-sandbox").click();
  return pageErrors;
}

async function castFromPicker(page: Page, choice: LaneSkillChoice): Promise<string> {
  await page.getByTestId("sandbox-cast-skill-skillId").fill(String(choice.skillId));
  await page.getByTestId("sandbox-cast-skill-level").fill(String(choice.level));
  await page.getByTestId("sandbox-cast-skill-submit").click();
  const castNote = page.getByTestId("sandbox-skill-cast-note");
  await expect(castNote).toHaveText(new RegExp(`^${choice.key} `), { timeout: harnessLoadTimeout });
  await castNote.scrollIntoViewIfNeeded();
  const noteText = (await castNote.textContent()) ?? "";
  test.info().annotations.push({ type: "sandbox-skill-cast-note", description: noteText });
  console.log(`sandbox-skill-cast-note: ${noteText}`);
  return noteText;
}

function emitterActorCount(noteText: string): number {
  const match = /\| emitter actors (\d+) \|/.exec(noteText);
  if (!match) throw new Error(`the cast note names no emitter actor count: ${noteText}`);
  return Number(match[1]);
}

test.describe("sandbox cast picker on the actors lane store", () => {
  test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors");
  test.skip(!existsSync(laneCatalogPath) || !existsSync(laneCoveragePath), "the actors lane store has no catalog or coverage");

  for (const [label, contextOptions, viewportName] of [
    ["1440 x 900", { viewport: desktopViewport }, "1440x900"],
    ["932 x 430 on a landscape touch phone", landscapePhone, "932x430"],
  ] as const) {
    test(`casts the lowest converted skill other than 3:1 and the lowest emitter class gap through the cast picker at ${label}`, async ({ browser }) => {
      test.setTimeout(worldReadyTimeout + harnessLoadTimeout * 3);
      const { converted, emitterClassGap } = laneSkillChoices();
      const context = await browser.newContext(contextOptions);
      try {
        const page = await context.newPage();
        const pageErrors = await openSandboxTab(page);
        mkdirSync(evidenceDirectory, { recursive: true });
        const convertedNote = await castFromPicker(page, converted);
        expect(emitterActorCount(convertedNote), convertedNote).toBeGreaterThan(0);
        await page.screenshot({ path: resolve(evidenceDirectory, `sandbox-cast-${converted.key.replace(/:/g, "-")}-${viewportName}.png`) });
        const gapNote = await castFromPicker(page, emitterClassGap);
        expect(gapNote).toContain(`named gaps: ${emitterClassGap.reason}`);
        await page.screenshot({ path: resolve(evidenceDirectory, `sandbox-cast-${emitterClassGap.key.replace(/:/g, "-")}-${viewportName}.png`) });
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("has no horizontal scroll at 430 x 932 portrait with the cast note shown", async ({ browser }) => {
    test.setTimeout(worldReadyTimeout + harnessLoadTimeout * 2);
    const context = await browser.newContext(portraitPhone);
    try {
      const page = await context.newPage();
      await openSandboxTab(page);
      await castFromPicker(page, laneSkillChoices().converted);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await context.close();
    }
  });
});
