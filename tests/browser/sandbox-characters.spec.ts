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
  readonly profile: string | null;
  readonly hair: { readonly status: string } | null;
  readonly gaps: readonly { readonly field: string; readonly reason: string }[];
}

interface SpawnedCharacter {
  readonly id: string;
  readonly modelId: string | null;
  readonly missingAssetDiagnostic: string | null;
  readonly animation: string;
  readonly playback?: { readonly activeClip: string };
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly forwardDirection: readonly number[] | null;
  readonly bounds: { readonly minimum: readonly number[]; readonly maximum: readonly number[] };
  readonly parts: readonly { readonly name: string; readonly material?: string }[];
}

interface ServedPlayerProfile {
  readonly id: string;
  readonly chargrpIndex?: number;
  readonly clips: Readonly<Record<string, string>>;
}

const laneName = "integration";
const storeRoot = resolve("artifacts/lane-store", laneName, "l2");
const censusPath = resolve("docs/parts/player-characters/character-census.json");
const evidenceDirectory = resolve("artifacts/ui-evidence");
const worldReadyTimeout = 240_000;
const modelLoadTimeout = 120_000;
const portraitPhone = { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const unboundSourceSlotPattern = /^UNBOUND_SOURCE_SLOT_\d+$/;
const humanRecipeNames = ["mfighter", "mmagic", "fmagic", "ffighter"];
const framingRadiusPerBoundsHeight = 2.5;
const sliceMonsterEntityId = "native-musveren";
const obliqueViewRadians = Math.PI / 4;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=integration");
test.skip(!existsSync(resolve(storeRoot, "catalog.json")), "the integration union has no catalog; rebuild the union first");
test.skip(!existsSync(censusPath), "the character census is missing; run scripts/actors/convert_actors.py --batch characters first");

const censusRows = (): readonly CharacterCensusRow[] => (JSON.parse(readFileSync(censusPath, "utf8")) as { rows: CharacterCensusRow[] }).rows;
const characterRows = () => censusRows().filter(row => !row.padding && row.key !== null);
const writtenRows = () => characterRows().filter(row => row.profile === "written");
const expectedGapReason = (row: CharacterCensusRow) =>
  (row.gaps.find(gap => gap.field === (row.model === "gap" ? "model" : "profile")) ?? row.gaps[0])?.reason ?? null;
const oldHairOverrideTextures = (): ReadonlySet<string> => new Set(humanRecipeNames.flatMap(name => {
  const parts = (JSON.parse(readFileSync(resolve(`recipes/native-${name}.json`), "utf8")) as { parts: { unresolved?: { materials?: { previousValue: string[] } } }[] }[])[0]!.parts;
  return parts.flatMap(part => (part.unresolved?.materials?.previousValue ?? []).map(entry => entry.split("=", 2)[1]!));
}));

function servedCharacterProfiles(): ReadonlyMap<number, ServedPlayerProfile> {
  const catalog = JSON.parse(readFileSync(resolve(storeRoot, "catalog.json"), "utf8")) as { playerProfiles?: { manifest: string }[] };
  const profiles = (catalog.playerProfiles ?? []).flatMap(record =>
    (JSON.parse(readFileSync(resolve(storeRoot, record.manifest.slice("/l2/".length)), "utf8")) as { profiles: ServedPlayerProfile[] }).profiles);
  return new Map(profiles.filter(profile => profile.chargrpIndex !== undefined).map(profile => [profile.chargrpIndex!, profile]));
}

const entities = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native slice is not ready.");
  return window.__nativeSlice.snapshot().entities as unknown as SpawnedCharacter[];
});

async function openNativeRoute(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.locator('body[data-world-state="ready"]')).toHaveCount(1, { timeout: worldReadyTimeout });
  return pageErrors;
}

async function spawnedCharacter(page: Page, entityId: string): Promise<SpawnedCharacter> {
  const character = (await entities(page)).find(entity => entity.id === entityId);
  if (!character) throw new Error(`${entityId} is not in the snapshot`);
  return character;
}

async function spawnCharacter(page: Page, chargrpIndex: number): Promise<SpawnedCharacter> {
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

async function expectActiveClip(page: Page, entityId: string, clip: string): Promise<void> {
  await expect.poll(async () => (await spawnedCharacter(page, entityId)).playback?.activeClip ?? null, { timeout: modelLoadTimeout }).toBe(clip);
}

async function despawnSliceMonsterAtTheSpawnPoint(page: Page): Promise<void> {
  await page.evaluate(entityId => window.__nativeSlice!.dispatch({ type: "despawn", entityId }), sliceMonsterEntityId);
  await expect.poll(async () => (await entities(page)).some(entity => entity.id === sliceMonsterEntityId)).toBe(false);
}

async function withPage<T>(browser: Browser, options: BrowserContextOptions, use: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  try {
    const pageErrors = await openNativeRoute(page);
    const result = await use(page);
    expect(pageErrors).toEqual([]);
    return result;
  } finally {
    await context.close();
  }
}

async function frameCharacter(page: Page, character: SpawnedCharacter, alphaFromFrontRadians: number): Promise<void> {
  const forward = character.forwardDirection;
  if (forward === null) throw new Error(`${character.id} has no forward direction`);
  const { minimum, maximum } = character.bounds;
  const target = [0, 1, 2].map(axis => [character.position.x, character.position.y, character.position.z][axis]! + (minimum[axis]! + maximum[axis]!) / 2);
  const alpha = Math.atan2(forward[2]!, forward[0]!) + alphaFromFrontRadians;
  const radius = (maximum[1]! - minimum[1]!) * framingRadiusPerBoundsHeight;
  await page.evaluate(({ target, alpha, radius }) => {
    const slice = window.__nativeSlice!;
    const limits = slice.snapshot().camera;
    if (!limits) throw new Error("The native slice snapshot has no camera.");
    const beta = Math.min(Math.PI / 2, limits.upperBetaLimit ?? Math.PI / 2);
    const clampedRadius = Math.min(Math.max(radius, limits.lowerRadiusLimit ?? radius), limits.upperRadiusLimit ?? radius);
    slice.setCameraPose!({ target, alpha, beta, radius: clampedRadius });
  }, { target, alpha, radius });
}

test.describe("chargrp characters on the integration store", () => {
  test("every census character key spawns its model and idles when its profile is written, or shows its census gap reason", async ({ browser, baseURL }) => {
    test.setTimeout(worldReadyTimeout + modelLoadTimeout * characterRows().length + 60_000);
    if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
    const profiles = servedCharacterProfiles();
    const forbiddenHairTextures = oldHairOverrideTextures();
    expect(forbiddenHairTextures.size).toBe(8);
    await withPage(browser, { viewport: desktopViewport }, async page => {
      const catalogSha256 = await servedLaneCatalogSha256(baseURL);
      for (const row of characterRows()) {
        const character = await spawnCharacter(page, row.chargrpIndex);
        const loaded = character.modelId !== null && character.missingAssetDiagnostic === null;
        if (row.profile === "written") {
          expect(loaded, `${row.key} ${character.missingAssetDiagnostic}`).toBe(true);
          await expectActiveClip(page, character.id, profiles.get(row.chargrpIndex)!.clips.idle!);
          if (row.hair?.status === "gap") {
            for (const part of character.parts) {
              const material = part.material ?? "";
              expect(unboundSourceSlotPattern.test(material) || !forbiddenHairTextures.has(material), `${row.key} ${part.name} ${material}`).toBe(true);
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
      await page.screenshot({ path: resolve(evidenceDirectory, "03-37-characters-sweep-desktop.png") });
    });
  });

  test("character 0 idles on desktop and the landscape phone, runs through set-animation, and is framed from the front", async ({ browser }) => {
    test.setTimeout((worldReadyTimeout + modelLoadTimeout * 3) * 2);
    const [first] = writtenRows();
    if (first === undefined) throw new Error("no census character has a written profile");
    const clips = servedCharacterProfiles().get(first.chargrpIndex)!.clips;
    mkdirSync(evidenceDirectory, { recursive: true });
    await withPage(browser, { viewport: desktopViewport }, async page => {
      await despawnSliceMonsterAtTheSpawnPoint(page);
      const character = await spawnCharacter(page, first.chargrpIndex);
      await expectActiveClip(page, character.id, clips.idle!);
      await frameCharacter(page, await spawnedCharacter(page, character.id), obliqueViewRadians);
      await page.screenshot({ path: resolve(evidenceDirectory, `03-37-character-${first.chargrpIndex}-idle-desktop.png`) });
      await frameCharacter(page, await spawnedCharacter(page, character.id), 0);
      await page.screenshot({ path: resolve(evidenceDirectory, `03-37-character-${first.chargrpIndex}-facing-desktop.png`) });
      await page.evaluate(entityId => window.__nativeSlice!.dispatch({ type: "set-animation", animation: "run", entityId }), character.id);
      await expect.poll(async () => (await spawnedCharacter(page, character.id)).animation).toBe("run");
      await expectActiveClip(page, character.id, clips.run!);
      await page.screenshot({ path: resolve(evidenceDirectory, `03-37-character-${first.chargrpIndex}-run-desktop.png`) });
    });
    await withPage(browser, landscapePhone, async page => {
      await despawnSliceMonsterAtTheSpawnPoint(page);
      const character = await spawnCharacter(page, first.chargrpIndex);
      await expectActiveClip(page, character.id, clips.idle!);
      await frameCharacter(page, await spawnedCharacter(page, character.id), obliqueViewRadians);
      await page.screenshot({ path: resolve(evidenceDirectory, `03-37-character-${first.chargrpIndex}-idle-phone.png`) });
    });
  });

  test("the portrait phone has no horizontal scroll with a character spawned", async ({ browser }) => {
    test.setTimeout(worldReadyTimeout + modelLoadTimeout);
    await withPage(browser, portraitPhone, async page => {
      await spawnCharacter(page, characterRows()[0]!.chargrpIndex);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
});
