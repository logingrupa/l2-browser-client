import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { generatedActorSoundBundlePrefix } from "../../src/audio/combatAudioRoleRouting";
import type { ActorAudioHarnessState, ActorAudioReportRow } from "./harness/actorAudioHarness";
import { servedLaneCatalogSha256 } from "./support/loadCheckRecordFile";

const laneName = "actors";
const laneFolder = resolve("artifacts/lane-store", laneName);
const laneCatalogPath = resolve(laneFolder, "l2/catalog.json");
const actorSoundGapRowsPath = resolve(laneFolder, "work/actor-sounds/actor-sound-gap-rows.json");
const audioReportDirectory = resolve(laneFolder, "audio-reports");
const tracerBundleKey = "npc:20001";
const harnessTimeout = 120_000;
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
