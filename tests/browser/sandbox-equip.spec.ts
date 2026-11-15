import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, landscapePhone } from "./browserViewports";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";
import { checkHarnessLoadKey } from "./support/loadCheckRecords";
import { defaultNativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";
import type { BodyPartEquipmentSlot } from "../../src/world/worldTypes";

interface EquippableItem {
  readonly itemId: number;
  readonly slot: BodyPartEquipmentSlot;
  readonly bodyPart: number;
}

const laneName = "actors";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const evidenceDirectory = resolve("artifacts/item-evidence");
const worldReadyTimeout = 240_000;
const itemLoadTimeout = 90_000;
const weaponItemId = 1;
const itemModelRecordIdPattern = /^interlude:item:(\d+):body-part:(\d+):(weapon|armor:\d+)$/;
const portraitPhone = { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const profileUpperItemIds = new Set(defaultNativePlayerProfile.upperItems.map(item => item.itemId));

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors DEV_PORT=5175");
test.skip(!existsSync(laneCatalogPath), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --item 1 first");

function laneItemModels(kind: "weapon" | "armor"): readonly EquippableItem[] {
  const models = (JSON.parse(readFileSync(laneCatalogPath, "utf8")) as { models: { id: string }[] }).models;
  return models.flatMap((model): EquippableItem[] => {
    const match = itemModelRecordIdPattern.exec(model.id);
    if (!match || !match[3]!.startsWith(kind)) return [];
    const bodyPart = Number(match[2]);
    return [{ itemId: Number(match[1]), slot: `body-part:${bodyPart}`, bodyPart }];
  });
}

function weaponItem(itemId: number): EquippableItem {
  const matches = laneItemModels("weapon").filter(item => item.itemId === itemId);
  if (matches.length !== 1) throw new Error(`the actors lane catalog holds ${matches.length} weapon records for item ${itemId}`);
  return matches[0]!;
}

function firstBodyPartArmorItem(): EquippableItem {
  const armor = laneItemModels("armor").filter(item => !profileUpperItemIds.has(item.itemId)).sort((left, right) => left.itemId - right.itemId)[0];
  if (!armor) throw new Error("the actors lane catalog holds no converted armor record outside the player profile upper items; run the items batch slice");
  return armor;
}

const entities = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native slice is not ready.");
  return window.__nativeSlice.snapshot().entities;
});

async function entity(page: Page, entityId: string) {
  const found = (await entities(page)).find(candidate => candidate.id === entityId);
  if (!found) throw new Error(`${entityId} is not in the snapshot`);
  return found;
}

async function openNativeRoute(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  return pageErrors;
}

async function equip(page: Page, item: EquippableItem, entityId = "local-player"): Promise<void> {
  await page.evaluate(command => window.__nativeSlice!.dispatch(command), { type: "equip-item", slot: item.slot, itemId: item.itemId, entityId } as const);
}

async function expectWeaponUnderHandAnchor(page: Page, weapon: EquippableItem): Promise<void> {
  await expect.poll(async () => {
    const attachment = (await entity(page, "local-player")).attachments.find(candidate => candidate.id === weapon.slot);
    return attachment ? { status: attachment.status, boneName: attachment.boneName, meshes: attachment.attachedMeshNames.length > 0 } : null;
  }, { timeout: itemLoadTimeout }).toEqual({ status: "ready", boneName: "Weapon_R_Bone", meshes: true });
}

async function equipWeaponAndArmorOnTheLocalPlayer(page: Page): Promise<EquippableItem> {
  const weapon = weaponItem(weaponItemId), armor = firstBodyPartArmorItem();
  await equip(page, weapon);
  await expectWeaponUnderHandAnchor(page, weapon);
  await equip(page, armor);
  await expect.poll(async () => (await entity(page, "local-player")).missingAssetDiagnostic, { timeout: itemLoadTimeout })
    .toBe(`item:${armor.itemId} gap: equipment-slot-meaning-undecoded:${armor.bodyPart}`);
  return armor;
}

test.describe("equip by item id on the native route at 1440 x 900", () => {
  test.use({ viewport: desktopViewport });

  test("equips item 1 on the local player and shows its weapon mesh under the hand anchor", async ({ page, baseURL }) => {
    test.setTimeout(worldReadyTimeout + itemLoadTimeout * 2);
    if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
    const pageErrors = await openNativeRoute(page);
    const weapon = weaponItem(weaponItemId);
    await equip(page, weapon);
    await expectWeaponUnderHandAnchor(page, weapon);
    expect((await entity(page, "local-player")).missingAssetDiagnostic).toBeNull();
    expect(pageErrors).toEqual([]);
    const outcome = await checkHarnessLoadKey(page, `item:${weaponItemId}`);
    expect(outcome.status).toBe("pass");
    writeLoadCheckRecord(laneName, await servedLaneCatalogSha256(baseURL), { key: `item:${weaponItemId}`, ...outcome, atRiga: formatRigaTimestamp(new Date()) });
  });

  test("shows converted armor as its equipment slot meaning gap and keeps a generated character marker at its character gap", async ({ page }) => {
    test.setTimeout(worldReadyTimeout + itemLoadTimeout * 4);
    const pageErrors = await openNativeRoute(page);
    const armor = await equipWeaponAndArmorOnTheLocalPlayer(page);
    await page.evaluate(() => window.__nativeSlice!.dispatch({ type: "spawn-character", characterTemplateIndex: 0 }));
    await expect.poll(async () => (await entities(page)).find(candidate => candidate.id.startsWith("character-0-"))?.missingAssetDiagnostic ?? null,
      { timeout: itemLoadTimeout }).toMatch(/^character:0 gap: /);
    const character = (await entities(page)).find(candidate => candidate.id.startsWith("character-0-"))!;
    await equip(page, armor, character.id);
    expect((await entity(page, character.id)).missingAssetDiagnostic).toBe(character.missingAssetDiagnostic);
    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, "equip-weapon-armor-1440x900.png") });
    expect(pageErrors).toEqual([]);
  });
});

test.describe("equip by item id on the native route at 932 x 430 on a landscape touch phone", () => {
  test.use(landscapePhone);

  test("shows the weapon at the hand anchor and the armor gap", async ({ page }) => {
    test.setTimeout(worldReadyTimeout + itemLoadTimeout * 3);
    const pageErrors = await openNativeRoute(page);
    await equipWeaponAndArmorOnTheLocalPlayer(page);
    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, "equip-weapon-armor-932x430.png") });
    expect(pageErrors).toEqual([]);
  });
});

test.describe("equip by item id on the native route at 430 x 932 portrait", () => {
  test.use(portraitPhone);

  test("has no horizontal scroll with a weapon and armor equipped", async ({ page }) => {
    test.setTimeout(worldReadyTimeout + itemLoadTimeout * 3);
    await openNativeRoute(page);
    await equipWeaponAndArmorOnTheLocalPlayer(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
