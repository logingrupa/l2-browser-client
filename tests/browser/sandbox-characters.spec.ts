import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, landscapePhone } from "./browserViewports";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";

interface CharacterCensusRow {
  readonly chargrpIndex: number;
  readonly key: string | null;
  readonly padding: boolean;
  readonly model: string | null;
  readonly hair: { readonly status: string } | null;
  readonly gaps: readonly { readonly field: string; readonly reason: string }[];
}

const laneName = "actors";
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const censusPath = resolve("docs/parts/player-characters/character-census.json");
const evidenceDirectory = resolve("artifacts/character-evidence");
const worldReadyTimeout = 240_000;
const modelLoadTimeout = 90_000;
const portraitPhone = { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const unboundSourceSlotPattern = /^UNBOUND_SOURCE_SLOT_\d+$/;
const humanRecipeNames = ["mfighter", "mmagic", "fmagic", "ffighter"];

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=actors");
test.skip(!existsSync(laneCatalogPath), "the actors lane store has no catalog; run scripts/actors/convert_actors.py --batch characters first");
test.skip(!existsSync(censusPath), "the character census is missing; run scripts/actors/convert_actors.py --batch characters first");

const censusRows = (): readonly CharacterCensusRow[] => (JSON.parse(readFileSync(censusPath, "utf8")) as { rows: CharacterCensusRow[] }).rows;
const characterRows = () => censusRows().filter(row => !row.padding && row.key !== null);
const expectedGapReason = (row: CharacterCensusRow) =>
  (row.gaps.find(gap => gap.field === (row.model === "gap" ? "model" : "profile")) ?? row.gaps[0])?.reason ?? null;
const oldHairOverrideTextures = (): ReadonlySet<string> => new Set(humanRecipeNames.flatMap(name => {
  const parts = (JSON.parse(readFileSync(resolve(`recipes/native-${name}.json`), "utf8")) as { parts: { unresolved?: { materials?: { previousValue: string[] } } }[] }[])[0]!.parts;
  return parts.flatMap(part => (part.unresolved?.materials?.previousValue ?? []).map(entry => entry.split("=", 2)[1]!));
}));

const entities = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native slice is not ready.");
  return window.__nativeSlice.snapshot().entities;
});

async function openNativeRoute(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  return pageErrors;
}

async function spawnCharacter(page: Page, chargrpIndex: number) {
  const entityIdPrefix = `character-${chargrpIndex}-`;
  const spawnedOfIndex = async () => (await entities(page)).filter(entity => entity.id.startsWith(entityIdPrefix));
  expect(await spawnedOfIndex()).toEqual([]);
  await page.evaluate(index => window.__nativeSlice!.dispatch({ type: "spawn-character", characterTemplateIndex: index }), chargrpIndex);
  await expect.poll(async () => {
    const [character] = await spawnedOfIndex();
    return character === undefined ? null : character.modelId !== null || character.missingAssetDiagnostic !== null;
  }, { timeout: modelLoadTimeout }).toBe(true);
  return (await spawnedOfIndex())[0]!;
}

async function screenshotFirstCharacter(browser: Browser, options: BrowserContextOptions, fileName: string): Promise<void> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  try {
    const pageErrors = await openNativeRoute(page);
    const first = characterRows()[0]!;
    await spawnCharacter(page, first.chargrpIndex);
    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, fileName) });
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

test.describe("chargrp characters on the native route", () => {
  test("every census character key spawns as its visual or as the missing marker with its census gap reason", async ({ browser, baseURL }) => {
    test.setTimeout(worldReadyTimeout + modelLoadTimeout * characterRows().length + 60_000);
    const context = await browser.newContext({ viewport: desktopViewport });
    const page = await context.newPage();
    const pageErrors = await openNativeRoute(page);
    if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
    const catalogSha256 = await servedLaneCatalogSha256(baseURL);
    const forbiddenHairTextures = oldHairOverrideTextures();
    expect(forbiddenHairTextures.size).toBe(8);
    for (const row of characterRows()) {
      const character = await spawnCharacter(page, row.chargrpIndex);
      const loaded = character.modelId !== null && character.missingAssetDiagnostic === null;
      if (loaded) {
        if (row.hair?.status === "gap") {
          for (const part of character.parts) {
            const material = part.material ?? "";
            const unboundDiagnosticOrNotTheOldHairChoice = unboundSourceSlotPattern.test(material) || !forbiddenHairTextures.has(material);
            expect(unboundDiagnosticOrNotTheOldHairChoice, `${row.key} ${part.name} ${material}`).toBe(true);
          }
        }
      } else {
        expect(character.missingAssetDiagnostic).toBe(`${row.key} gap: ${expectedGapReason(row)}`);
      }
      writeLoadCheckRecord(laneName, catalogSha256, {
        key: row.key!, status: loaded ? "pass" : "failed", reason: loaded ? null : character.missingAssetDiagnostic,
        atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: loaded ? 2 : null,
      });
    }
    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, "characters-sweep-1440x900.png") });
    expect(pageErrors).toEqual([]);
    await context.close();
  });

  test("the first character shows at 1440 x 900 and on the landscape phone", async ({ browser }) => {
    test.setTimeout((worldReadyTimeout + modelLoadTimeout) * 2);
    await screenshotFirstCharacter(browser, { viewport: desktopViewport }, "character-first-1440x900.png");
    await screenshotFirstCharacter(browser, landscapePhone, "character-first-932x430.png");
  });

  test("the portrait phone has no horizontal scroll with a character spawned", async ({ browser }) => {
    test.setTimeout(worldReadyTimeout + modelLoadTimeout);
    const context = await browser.newContext(portraitPhone);
    const page = await context.newPage();
    const pageErrors = await openNativeRoute(page);
    await spawnCharacter(page, characterRows()[0]!.chargrpIndex);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
    await context.close();
  });
});
