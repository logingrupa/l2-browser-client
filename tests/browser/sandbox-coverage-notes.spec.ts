import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";

const laneName = "actors";
const laneStorePath = resolve("artifacts/lane-store", laneName, "l2");
const worldReadyTimeout = 240_000;
const missingNpcId = 999999;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors");
test.skip(!existsSync(resolve(laneStorePath, "catalog.json")), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --batch npcs first");
test.skip(!existsSync(resolve(laneStorePath, "coverage.json")), "the actors lane store has no coverage report; run pnpm report:coverage --store-root artifacts/lane-store/actors/l2 --lane actors first");

interface ServedCoverageRow { readonly key: string; readonly status: string; readonly reason: string | null }

async function servedCoverageRows(request: APIRequestContext): Promise<ReadonlyMap<string, ServedCoverageRow>> {
  const response = await request.get("/l2/coverage.json");
  expect(response.ok()).toBe(true);
  const coverage = await response.json() as { readonly rows: readonly ServedCoverageRow[] };
  return new Map(coverage.rows.map(row => [row.key, row]));
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

async function expectNote(page: Page, testId: string, text: string, tone: "info" | "warning"): Promise<void> {
  await expect(page.getByTestId(`${testId}-note`)).toHaveText(text);
  await expect(page.getByTestId(`${testId}-note`)).toHaveAttribute("data-tone", tone);
}

test.use({ viewport: desktopViewport });

test("spawning by id notes npc:20001 converted, npc:20002 gap with its coverage reason and npc:999999 not in catalog", async ({ page, request }) => {
  test.setTimeout(worldReadyTimeout + 120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const coverageRows = await servedCoverageRows(request);
  const rabbitRow = coverageRows.get("npc:20002");
  expect(rabbitRow?.status).toBe("gap");
  expect(rabbitRow?.reason).toBeTruthy();
  expect(coverageRows.has(`npc:${missingNpcId}`)).toBe(false);
  await openSandboxSheet(page);

  await submitIdEntry(page, "sandbox-spawn-npc", { npcId: "20001" });
  await expectNote(page, "sandbox-spawn-npc", "npc:20001 converted", "info");
  await submitIdEntry(page, "sandbox-spawn-npc", { npcId: "20002" });
  await expectNote(page, "sandbox-spawn-npc", `npc:20002 gap: ${rabbitRow!.reason}`, "warning");
  await expect(page.locator('.entity-label[data-entity-id="npc-20002-2"] .entity-diagnostic')).toHaveText(`npc:20002 gap: ${rabbitRow!.reason}`);
  await submitIdEntry(page, "sandbox-spawn-npc", { npcId: String(missingNpcId) });
  await expectNote(page, "sandbox-spawn-npc", `npc:${missingNpcId} not in catalog`, "warning");
  const entities = await page.evaluate(() => window.__nativeSlice!.snapshot().entities);
  expect(entities.find(entity => entity.id === "npc-20002-2")).toMatchObject({ hasNativeModel: false, meshCount: 0, modelId: null });
  expect(entities.find(entity => entity.id === `npc-${missingNpcId}-3`)).toMatchObject({ hasNativeModel: false, meshCount: 0, modelId: null });
  expect(pageErrors).toEqual([]);
});
