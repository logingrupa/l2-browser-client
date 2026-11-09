import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";

const laneName = "actors";
const laneStorePath = resolve("artifacts/lane-store", laneName, "l2");
const screenshotDirectory = resolve("test-results/sandbox-coverage-notes");
const worldReadyTimeout = 240_000;
const missingNpcId = 999999;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors");
test.skip(!existsSync(resolve(laneStorePath, "catalog.json")), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --batch npcs first");
test.skip(!existsSync(resolve(laneStorePath, "coverage.json")), "the actors lane store has no coverage report; run pnpm report:coverage --store-root artifacts/lane-store/actors/l2 --lane actors first");

interface ServedCoverageRow { readonly key: string; readonly status: string; readonly reason: string | null }
interface ExpectedNote { readonly text: string; readonly tone: "info" | "warning" }
interface ServedStore { readonly coverageRows: ReadonlyMap<string, ServedCoverageRow>; readonly catalogHoldsWindows: boolean }

async function readServedStore(request: APIRequestContext): Promise<ServedStore> {
  const coverageResponse = await request.get("/l2/coverage.json");
  expect(coverageResponse.ok()).toBe(true);
  const coverage = await coverageResponse.json() as { readonly rows: readonly ServedCoverageRow[] };
  const catalogResponse = await request.get("/l2/catalog.json");
  expect(catalogResponse.ok()).toBe(true);
  const catalog = await catalogResponse.json() as { readonly windows?: readonly unknown[] };
  return { coverageRows: new Map(coverage.rows.map(row => [row.key, row])), catalogHoldsWindows: (catalog.windows?.length ?? 0) > 0 };
}

function expectedNoteFromServedStore(store: ServedStore, key: string): ExpectedNote {
  const row = store.coverageRows.get(key);
  if (row && row.status !== "pass") return { text: `${key} gap: ${row.reason}`, tone: "warning" };
  if (row) return { text: `${key} converted`, tone: "info" };
  return { text: `${key} not in catalog`, tone: "warning" };
}

function expectedWindowOpenNoteWithoutWindowRecords(windowId: string): ExpectedNote {
  const key = `window:${windowId}`;
  return { text: `${key} not in catalog: ${key} has no windows record in the served catalog`, tone: "warning" };
}

async function openSandboxSheet(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-sandbox").click();
}

async function submitIdEntry(page: Page, testId: string, values: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, value] of Object.entries(values)) await page.getByTestId(`${testId}-${name}`).fill(value);
  await page.getByTestId(`${testId}-submit`).click();
}

async function expectNote(page: Page, noteTestId: string, expected: ExpectedNote): Promise<void> {
  await expect(page.getByTestId(noteTestId)).toHaveText(expected.text);
  await expect(page.getByTestId(noteTestId)).toHaveAttribute("data-tone", expected.tone);
}

async function spawnLaneNpcs(page: Page, store: ServedStore): Promise<void> {
  await submitIdEntry(page, "sandbox-spawn-npc", { npcId: "20001" });
  await expectNote(page, "sandbox-spawn-note", { text: "npc:20001 converted", tone: "info" });
  await submitIdEntry(page, "sandbox-spawn-npc", { npcId: "20002" });
  await expectNote(page, "sandbox-spawn-note", { text: `npc:20002 gap: ${store.coverageRows.get("npc:20002")!.reason}`, tone: "warning" });
  await submitIdEntry(page, "sandbox-spawn-npc", { npcId: String(missingNpcId) });
  await expectNote(page, "sandbox-spawn-note", { text: `npc:${missingNpcId} not in catalog`, tone: "warning" });
}

async function equipCastAndOpenWindow(page: Page, store: ServedStore): Promise<void> {
  await submitIdEntry(page, "sandbox-equip-item", { itemId: "999999" });
  await expectNote(page, "sandbox-equip-note", expectedNoteFromServedStore(store, "item:999999"));
  await submitIdEntry(page, "sandbox-cast-skill", { skillId: "7", level: "1" });
  await expectNote(page, "sandbox-cast-note", expectedNoteFromServedStore(store, "skill:7:1"));
  expect(store.catalogHoldsWindows).toBe(false);
  await submitIdEntry(page, "sandbox-window", { window: "StatusWnd" });
  await expectNote(page, "sandbox-window-note", expectedWindowOpenNoteWithoutWindowRecords("StatusWnd"));
}

test.use({ viewport: desktopViewport });

test("every by-ID action notes its key as converted, gap or not in catalog with the reason from the served catalog and coverage", async ({ page, request }) => {
  test.setTimeout(worldReadyTimeout + 120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const store = await readServedStore(request);
  const rabbitRow = store.coverageRows.get("npc:20002");
  expect(rabbitRow?.status).toBe("gap");
  expect(rabbitRow?.reason).toBeTruthy();
  expect(store.coverageRows.has(`npc:${missingNpcId}`)).toBe(false);
  await openSandboxSheet(page);

  await spawnLaneNpcs(page, store);
  await expect(page.locator('.entity-label[data-entity-id="npc-20002-2"] .entity-diagnostic')).toHaveText(`npc:20002 gap: ${rabbitRow!.reason}`);
  const entities = await page.evaluate(() => window.__nativeSlice!.snapshot().entities);
  expect(entities.find(entity => entity.id === "npc-20002-2")).toMatchObject({ hasNativeModel: false, meshCount: 0, modelId: null });
  expect(entities.find(entity => entity.id === `npc-${missingNpcId}-3`)).toMatchObject({ hasNativeModel: false, meshCount: 0, modelId: null });

  await equipCastAndOpenWindow(page, store);
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: resolve(screenshotDirectory, "sandbox-coverage-notes-desktop.png") });
  await expectNoHorizontalScrollOnPortraitPhone(page);
  expect(pageErrors).toEqual([]);
});

test("the spawn notes show on a 932 x 430 landscape touch phone", async ({ browser, request }) => {
  test.setTimeout(worldReadyTimeout + 120_000);
  const store = await readServedStore(request);
  const context = await browser.newContext(landscapePhone);
  try {
    const page = await context.newPage();
    await openSandboxSheet(page);
    await spawnLaneNpcs(page, store);
    await page.getByTestId("sandbox-spawn-note").scrollIntoViewIfNeeded();
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: resolve(screenshotDirectory, "sandbox-coverage-notes-phone.png") });
  } finally {
    await context.close();
  }
});
