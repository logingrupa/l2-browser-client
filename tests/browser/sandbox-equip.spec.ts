import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport } from "./browserViewports";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";
import { checkHarnessLoadKey } from "./support/loadCheckRecords";
import type { BodyPartEquipmentSlot } from "../../src/world/worldTypes";

const laneName = "actors";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const worldReadyTimeout = 240_000;
const itemLoadTimeout = 90_000;
const weaponItemId = 1;
const weaponRecordIdPattern = /^interlude:item:(\d+):body-part:(\d+):weapon$/;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors DEV_PORT=5175");
test.skip(!existsSync(laneCatalogPath), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --item 1 first");

function laneModelRecordIds(): readonly string[] {
  return (JSON.parse(readFileSync(laneCatalogPath, "utf8")) as { models: { id: string }[] }).models.map(model => model.id);
}

function weaponSlotOfItem(itemId: number): BodyPartEquipmentSlot {
  const matches = laneModelRecordIds().flatMap((id): BodyPartEquipmentSlot[] => {
    const match = weaponRecordIdPattern.exec(id);
    return match && Number(match[1]) === itemId ? [`body-part:${Number(match[2])}`] : [];
  });
  if (matches.length !== 1) throw new Error(`the actors lane catalog holds ${matches.length} weapon records for item ${itemId}`);
  return matches[0]!;
}

const localPlayer = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native slice is not ready.");
  const entity = window.__nativeSlice.snapshot().entities.find(candidate => candidate.id === "local-player");
  if (!entity) throw new Error("the local player is not in the snapshot");
  return entity;
});

async function openNativeRoute(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  return pageErrors;
}

test.describe("equip by item id on the native route at 1440 x 900", () => {
  test.use({ viewport: desktopViewport });

  test("equips item 1 on the local player and shows its weapon mesh under the hand anchor", async ({ page, baseURL }) => {
    test.setTimeout(worldReadyTimeout + itemLoadTimeout * 2);
    if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
    const slot = weaponSlotOfItem(weaponItemId);
    const pageErrors = await openNativeRoute(page);
    await page.evaluate(command => window.__nativeSlice!.dispatch(command), { type: "equip-item", slot, itemId: weaponItemId } as const);
    await expect.poll(async () => {
      const attachment = (await localPlayer(page)).attachments.find(candidate => candidate.id === slot);
      return attachment ? { status: attachment.status, boneName: attachment.boneName, meshes: attachment.attachedMeshNames.length > 0 } : null;
    }, { timeout: itemLoadTimeout }).toEqual({ status: "ready", boneName: "Weapon_R_Bone", meshes: true });
    expect((await localPlayer(page)).missingAssetDiagnostic).toBeNull();
    expect(pageErrors).toEqual([]);
    const outcome = await checkHarnessLoadKey(page, `item:${weaponItemId}`);
    expect(outcome.status).toBe("pass");
    writeLoadCheckRecord(laneName, await servedLaneCatalogSha256(baseURL), { key: `item:${weaponItemId}`, ...outcome, atRiga: formatRigaTimestamp(new Date()) });
  });
});
