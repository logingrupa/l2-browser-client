import { expect, test, type Page } from "@playwright/test";

const inspectorRequestMarkers = ["@babylonjs_inspector", "@babylonjs/inspector"];
const inspectorRootSelector = "#babylon-inspector-container";

interface RecordedTraffic {
  requestUrls: string[];
  webSocketUrls: string[];
}

function recordTraffic(page: Page): RecordedTraffic {
  const traffic: RecordedTraffic = { requestUrls: [], webSocketUrls: [] };
  page.on("request", request => traffic.requestUrls.push(request.url()));
  page.on("websocket", webSocket => traffic.webSocketUrls.push(webSocket.url()));
  return traffic;
}

function isInspectorRequest(url: string): boolean {
  return inspectorRequestMarkers.some(marker => url.includes(marker));
}

function hostsOtherThanLoopback(traffic: RecordedTraffic): string[] {
  return [...traffic.requestUrls, ...traffic.webSocketUrls]
    .map(url => new URL(url))
    .filter(url => ["http:", "https:", "ws:", "wss:"].includes(url.protocol))
    .map(url => url.hostname)
    .filter(hostname => hostname !== "127.0.0.1");
}

test.use({ viewport: { width: 1440, height: 900 } });

async function openWorldAndWaitForReady(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: 90_000 });
}

test("inspect=1 lazy-loads Babylon Inspector from the local dev server and shows it over the revealed sandbox", async ({ page }) => {
  test.setTimeout(150_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const traffic = recordTraffic(page);
  await openWorldAndWaitForReady(page, "/?inspect=1");
  const inspectorRoot = page.locator(inspectorRootSelector);
  await expect(inspectorRoot).toBeVisible({ timeout: 30_000 });
  await expect(inspectorRoot.getByText("Scene Explorer", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/inspector-sandbox-1440x900.png" });
  expect(traffic.requestUrls.filter(isInspectorRequest)).not.toEqual([]);
  expect(hostsOtherThanLoopback(traffic)).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("the sandbox route without inspect requests no Inspector code and shows no Inspector", async ({ page }) => {
  test.setTimeout(120_000);
  const traffic = recordTraffic(page);
  await openWorldAndWaitForReady(page, "/");
  await expect(page.locator(inspectorRootSelector)).toHaveCount(0);
  expect(traffic.requestUrls.filter(isInspectorRequest)).toEqual([]);
  expect(hostsOtherThanLoopback(traffic)).toEqual([]);
});
