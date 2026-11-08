import { expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const nativeSandboxStaged = existsSync(resolve("public/l2/catalog.json")) && existsSync(resolve("public/scene/native-parity.babylon"));
export const nativeSandboxStagingRequirement = "Requires the locally staged native catalog and packed native-parity scene.";

export async function openNativeSandbox(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#loading")).toHaveCount(0, { timeout: 150_000 });
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.getByTestId("entity-count")).toHaveText("2", { timeout: 60_000 });
}
