import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { parseActorClipEvents } from "../../src/assets/native/actorClipEvents";
import { readAssetPackage } from "../../src/assets/package/readAssetPackage";
import { generatedActorSoundBundlePrefix } from "../../src/audio/combatAudioRoleRouting";
import { groupLessReferenceAgreesWithAdmittedExport } from "../../src/audio/loadNativeCombatAudio";
import type { ActorAudioHarnessState, ActorAudioReportRow } from "./harness/actorAudioHarness";
import { servedLaneCatalogSha256 } from "./support/loadCheckRecordFile";
import { desktopViewport } from "./browserViewports";

const laneName = "actors";
const laneFolder = resolve("artifacts/lane-store", laneName);
const laneCatalogPath = resolve(laneFolder, "l2/catalog.json");
const actorSoundGapRowsPath = resolve(laneFolder, "work/actor-sounds/actor-sound-gap-rows.json");
const audioReportDirectory = resolve(laneFolder, "audio-reports");
const tracerBundleKey = "npc:20001";
const harnessTimeout = 120_000;
const worldReadyTimeout = 240_000;
const reportListeningStatus = "audible labelled, owner listening pending";
type DoneState = Extract<ActorAudioHarnessState, { state: "done" }>;
interface ReportBundle {
  readonly bundle: string;
  readonly manifestSha256: string | null;
  readonly rows: readonly ActorAudioReportRow[];
  readonly problems: readonly string[];
  readonly unboundRoleReasons: readonly string[];
}

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors DEV_PORT=5175");
test.skip(!existsSync(laneCatalogPath), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --actor-sounds npc:20001 first");

function laneActorSoundBundleIds(): string[] {
  const catalog = JSON.parse(readFileSync(laneCatalogPath, "utf-8")) as { combatAudio?: { id: string }[] };
  return (catalog.combatAudio ?? []).map(record => record.id).filter(id => id.startsWith(generatedActorSoundBundlePrefix)).sort();
}

function unboundRoleReasons(bundleKey: string): string[] {
  if (!existsSync(actorSoundGapRowsPath)) return [];
  const document = JSON.parse(readFileSync(actorSoundGapRowsPath, "utf-8")) as { rows: { key: string; reason: string }[] };
  return document.rows.filter(row => row.key === bundleKey && row.reason.startsWith("combat-role-route-unresolved:")).map(row => row.reason);
}

async function auditionBundle(page: Page, bundleId: string): Promise<DoneState> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/tests/browser/harness/actor-audio.html?bundle=${encodeURIComponent(bundleId)}`);
  await expect.poll(() => page.evaluate(() => window.__actorAudioHarness?.state ?? "missing"), { timeout: harnessTimeout }).toMatch(/^(ready|absent|failed)$/);
  const opened = await page.evaluate(() => window.__actorAudioHarness!);
  if (opened.state !== "ready") throw new Error(`the actor audio harness did not open ${bundleId}: ${JSON.stringify(opened)}`);
  await page.getByRole("button", { name: "Play every admitted sound" }).click();
  await expect.poll(() => page.evaluate(() => window.__actorAudioHarness?.state ?? "missing"), { timeout: harnessTimeout }).toMatch(/^(done|failed)$/);
  const state = await page.evaluate(() => window.__actorAudioHarness!);
  if (state.state !== "done") throw new Error(`the actor audio harness failed on ${bundleId}: ${JSON.stringify(state)}`);
  expect(pageErrors).toEqual([]);
  return state;
}

test("plays every admitted sound of the Gremlin and the sliced actor sound bundles into a labelled report", async ({ page, baseURL }) => {
  if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
  const bundleIds = laneActorSoundBundleIds();
  test.setTimeout(harnessTimeout * Math.max(2, bundleIds.length + 1));
  const catalogSha256 = await servedLaneCatalogSha256(baseURL);
  const tracerBundleId = generatedActorSoundBundlePrefix + tracerBundleKey;
  const bundles: ReportBundle[] = [];
  if (!bundleIds.includes(tracerBundleId)) {
    bundles.push({ bundle: tracerBundleId, manifestSha256: null, rows: [], problems: [], unboundRoleReasons: unboundRoleReasons(tracerBundleKey) });
  }
  for (const bundleId of [tracerBundleId, ...bundleIds.filter(id => id !== tracerBundleId)].filter(id => bundleIds.includes(id))) {
    const state = await auditionBundle(page, bundleId);
    for (const row of state.rows) {
      expect(row.played, `${bundleId} ${row.key} played`).toBe(true);
      expect(Number.isFinite(row.peak), `${bundleId} ${row.key} peak`).toBe(true);
    }
    bundles.push({ bundle: bundleId, manifestSha256: state.manifestSha256, rows: state.rows, problems: state.problems,
      unboundRoleReasons: unboundRoleReasons(bundleId.slice(generatedActorSoundBundlePrefix.length)) });
  }
  mkdirSync(audioReportDirectory, { recursive: true });
  writeFileSync(resolve(audioReportDirectory, `${catalogSha256}.json`), `${JSON.stringify({ schemaVersion: 1, lane: laneName,
    catalogSha256, atRiga: formatRigaTimestamp(new Date()), listening: reportListeningStatus, verdict: null, bundles }, null, 2)}\n`);
  expect(bundles.length).toBeGreaterThan(0);
});

interface LaneCatalogSlices {
  readonly combatAudio: readonly { id: string; manifest: string }[];
  readonly npcProfiles: readonly { manifest: string }[];
  readonly models: readonly { id: string; archive?: string }[];
}

const laneFile = (servedPath: string) => resolve(laneFolder, servedPath.replace(/^\//, ""));

function laneActorSoundNpcIds(): number[] {
  return laneActorSoundBundleIds().map(id => id.slice(generatedActorSoundBundlePrefix.length))
    .filter(key => key.startsWith("npc:")).map(key => Number(key.slice("npc:".length))).sort((first, second) => first - second);
}

async function npcNotifiesBoundToItsBundle(catalog: LaneCatalogSlices, modelCatalogIdByNpc: ReadonlyMap<number, string>, npcId: number): Promise<number> {
  const archive = catalog.models.find(model => model.id === modelCatalogIdByNpc.get(npcId))?.archive;
  const record = catalog.combatAudio.find(entry => entry.id === `${generatedActorSoundBundlePrefix}npc:${npcId}`);
  if (!archive || !record || !existsSync(laneFile(archive))) return 0;
  const asset = await readAssetPackage(new Uint8Array(readFileSync(laneFile(archive))));
  const bundle = JSON.parse(readFileSync(laneFile(record.manifest), "utf-8")) as { sounds: { source: { object: string } }[] };
  return parseActorClipEvents(asset.manifest.animationEvents).filter(event => event.sound !== null &&
    bundle.sounds.filter(sound => groupLessReferenceAgreesWithAdmittedExport(event.sound!, sound.source.object)).length === 1).length;
}

async function lowestNpcIdWhoseBundleBindsANotify(): Promise<number> {
  const catalog = JSON.parse(readFileSync(laneCatalogPath, "utf-8")) as LaneCatalogSlices;
  const modelCatalogIdByNpc = new Map<number, string>();
  for (const pack of catalog.npcProfiles) {
    const profiles = (JSON.parse(readFileSync(laneFile(pack.manifest), "utf-8")) as
      { profiles: { npcId: number; modelCatalogId?: string; prePivot?: number[] }[] }).profiles;
    for (const profile of profiles) {
      const sandboxAppliesPivot = !(profile.prePivot?.some(value => value !== 0) ?? false);
      if (profile.modelCatalogId && sandboxAppliesPivot) modelCatalogIdByNpc.set(profile.npcId, profile.modelCatalogId);
    }
  }
  for (const npcId of laneActorSoundNpcIds()) if (await npcNotifiesBoundToItsBundle(catalog, modelCatalogIdByNpc, npcId) > 0) return npcId;
  throw new Error("no actors lane npc has a clip notify that binds to its actor-sounds bundle");
}

function boundCueClips(noteText: string): string[] {
  const match = / bound (\d+) notify cues(?: in ([^,]+(?:, [^,]+)*?))?, \d+ unbound/.exec(noteText);
  if (!match) throw new Error(`the actor sounds note names no binding: ${noteText}`);
  return Number(match[1]) > 0 && match[2] ? match[2].split(", ") : [];
}

async function spawnNpcAndReadActorSounds(page: Page, npcId: number) {
  await page.getByTestId("sandbox-spawn-npc-npcId").fill(String(npcId));
  await page.getByTestId("sandbox-spawn-npc-submit").click();
  const note = page.getByTestId("sandbox-actor-sounds-note").filter({ hasText: new RegExp(`^npc-${npcId}-\\d+: `) });
  await expect(note).toHaveText(new RegExp(`^npc-${npcId}-\\d+: ${generatedActorSoundBundlePrefix}npc:${npcId} bound `), { timeout: harnessTimeout });
  const text = (await note.textContent()) ?? "";
  console.log(`sandbox-actor-sounds-note: ${text}`);
  return { note, text, entityId: text.slice(0, text.indexOf(":")) };
}

test.describe("spawned npc actor sounds on the native route", () => {
  test.use({ viewport: desktopViewport });

  test("binds the lowest npc actor-sounds bundle at spawn and plays a notify-bound cue of the lowest npc whose bundle binds one", async ({ page }) => {
    test.setTimeout(worldReadyTimeout + harnessTimeout * 4);
    const lowestNpcId = laneActorSoundNpcIds()[0], boundNpcId = await lowestNpcIdWhoseBundleBindsANotify();
    if (lowestNpcId === undefined) throw new Error("the actors lane store holds no actor-sounds:npc record");
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto("/");
    await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
    await page.getByTestId("dev-sheet-toggle").click();
    await page.getByTestId("dev-tab-sandbox").click();
    await spawnNpcAndReadActorSounds(page, lowestNpcId);
    const bound = await spawnNpcAndReadActorSounds(page, boundNpcId);
    const clips = boundCueClips(bound.text);
    expect(clips.length, "bound notify cue clips").toBeGreaterThan(0);
    await page.getByTestId("sandbox-clips-reread").click();
    await page.getByTestId("sandbox-clips-actor").locator("select").selectOption(bound.entityId);
    await page.locator('[data-testid^="sandbox-clips-clip-"]').filter({ hasText: new RegExp(`^${clips[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first().click();
    await expect(bound.note).toHaveText(/; played [1-9]\d*, dropped \d+, last /, { timeout: harnessTimeout });
    await bound.note.scrollIntoViewIfNeeded();
    console.log(`sandbox-actor-sounds-note after the clip: ${await bound.note.textContent()}`);
    mkdirSync(audioReportDirectory, { recursive: true });
    await page.screenshot({ path: resolve(audioReportDirectory, `sandbox-actor-sounds-npc-${boundNpcId}-1440x900.png`) });
    expect(pageErrors).toEqual([]);
  });
});
