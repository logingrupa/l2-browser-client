import type { Page } from "@playwright/test";

export const referenceWorldManifestRoute = "**/assets/world/manifest.json";
const viteIndexHtmlFallbackForMissingFile = "<!doctype html><html></html>";

export async function routeReferenceWorldAsNotStaged(page: Page): Promise<void> {
  await page.route(referenceWorldManifestRoute, route => route.fulfill({ contentType: "text/html", body: viteIndexHtmlFallbackForMissingFile }));
}
