import { expect, test, type Request } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const readyBudgetMilliseconds = 240_000;
const nativeSandboxRoute = { name: "native-sandbox", path: "/?world=interlude" };

interface CompletedRequest { resourceType: string; completedAtMilliseconds: number; responseBodyBytes: number }

function longestCompletionGapMilliseconds(completions: readonly number[]): number {
  const ordered = [...completions].sort((first, second) => first - second);
  return ordered.slice(1).reduce((longest, completion, index) => Math.max(longest, completion - ordered[index]!), 0);
}

test(`dev cold start of the ${nativeSandboxRoute.name} route requests no Editor tools`, async ({ page }, testInfo) => {
  test.setTimeout(readyBudgetMilliseconds + 60_000);
  const requestedAt = new Map<Request, number>();
  const completedRequests: Promise<CompletedRequest>[] = [];
  const failedRequests: string[] = [];
  page.on("request", request => requestedAt.set(request, Date.now()));
  page.on("requestfailed", request => failedRequests.push(request.url()));
  page.on("requestfinished", request => {
    const completedAtMilliseconds = Date.now();
    completedRequests.push(request.sizes().then(sizes => ({ resourceType: request.resourceType(), completedAtMilliseconds,
      responseBodyBytes: sizes.responseBodySize })));
  });
  const navigationStartedAtMilliseconds = Date.now();
  await page.goto(nativeSandboxRoute.path, { waitUntil: "domcontentloaded" });
  const readyAtMilliseconds = await page.locator('body[data-world-state="ready"]').waitFor({ timeout: readyBudgetMilliseconds })
    .then(() => Date.now(), () => null);
  const completed = await Promise.all(completedRequests);
  const requestedUrls = [...requestedAt.keys()].map(request => request.url());
  const scripts = completed.filter(request => request.resourceType === "script");
  const firstRuntimeModuleRequest = [...requestedAt.entries()]
    .filter(([request]) => new URL(request.url()).pathname.startsWith("/src/runtime/"))
    .map(([, requestedAtMilliseconds]) => requestedAtMilliseconds)
    .sort((first, second) => first - second)[0];
  const measurement = {
    route: nativeSandboxRoute.path,
    scriptRequestCount: scripts.length,
    completedScriptBytes: scripts.reduce((total, request) => total + request.responseBodyBytes, 0),
    completedRequestCount: completed.length,
    completedBytes: completed.reduce((total, request) => total + request.responseBodyBytes, 0),
    millisecondsToFirstRuntimeModuleRequest: firstRuntimeModuleRequest === undefined ? null : firstRuntimeModuleRequest - navigationStartedAtMilliseconds,
    longestCompletionGapMilliseconds: longestCompletionGapMilliseconds(completed.map(request => request.completedAtMilliseconds)),
    millisecondsToReady: readyAtMilliseconds === null ? null : readyAtMilliseconds - navigationStartedAtMilliseconds,
    readyBudgetMilliseconds,
    editorToolsRequestCount: requestedUrls.filter(url => url.includes("babylonjs-editor-tools")).length,
    failedRequests,
  };
  const measurementPath = testInfo.outputPath(`dev-startup-${nativeSandboxRoute.name}.json`);
  await writeFile(measurementPath, JSON.stringify(measurement, null, 2));
  await testInfo.attach(`dev-startup-${nativeSandboxRoute.name}`, { path: measurementPath, contentType: "application/json" });
  expect(measurement.editorToolsRequestCount).toBe(0);
});
