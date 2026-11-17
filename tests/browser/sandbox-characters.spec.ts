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
  readonly hair: CensusHair | null;
  readonly gaps: readonly { readonly field: string; readonly reason: string }[];
}

interface CensusHairHalf {
  readonly half: "back" | "front";
  readonly status: string;
  readonly mesh?: string;
  readonly material?: string;
  readonly route?: "ordinary" | "dynamic";
}

interface CensusHair {
  readonly status: string;
  readonly halves: readonly CensusHairHalf[];
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
  readonly parts: readonly { readonly name: string; readonly enabled: boolean; readonly material?: string }[];
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
const hairPartsRecipePath = resolve("recipes/actors/character-hair-parts.json");
const framingRadiusPerBoundsHeight = 2.5;
const sliceMonsterEntityId = "native-musveren";
const obliqueViewRadians = Math.PI / 4;
const sideViewRadians = Math.PI / 2;
const rigidBackHairKeys = [0, 10];
const dynamicBackHairKeys = [3, 7];
const dynamicBackHairGap = { field: "hair", reason: "dynamic-hair-simulation-unported:back" };

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=integration");
test.skip(!existsSync(resolve(storeRoot, "catalog.json")), "the integration union has no catalog; rebuild the union first");
test.skip(!existsSync(censusPath), "the character census is missing; run scripts/actors/convert_actors.py --batch characters first");

const censusRows = (): readonly CharacterCensusRow[] => (JSON.parse(readFileSync(censusPath, "utf8")) as { rows: CharacterCensusRow[] }).rows;
const characterRows = () => censusRows().filter(row => !row.padding && row.key !== null);
const writtenRows = () => characterRows().filter(row => row.profile === "written");
const expectedGapReason = (row: CharacterCensusRow) =>
  (row.gaps.find(gap => gap.field === (row.model === "gap" ? "model" : "profile")) ?? row.gaps[0])?.reason ?? null;
const hairHalfMeshSuffixes = (): Readonly<Record<string, string>> => {
  const formats = (JSON.parse(readFileSync(hairPartsRecipePath, "utf8")) as { formats: { mesh: Record<"back" | "front", { format: string }> } }).formats.mesh;
  return { back: formats.back.format.slice(formats.back.format.lastIndexOf("_")), front: formats.front.format.slice(formats.front.format.lastIndexOf("_")) };
};
const meshLeafName = (objectPath: string) => objectPath.slice(objectPath.lastIndexOf(".") + 1).toLowerCase();

function expectCensusHairParts(row: CharacterCensusRow, character: SpawnedCharacter, meshSuffixes: Readonly<Record<string, string>>): void {
  for (const half of row.hair!.halves) {
    const partsOfHalf = character.parts.filter(part => half.mesh === undefined
      ? part.name.toLowerCase().includes(meshSuffixes[half.half]!.toLowerCase()) : part.name.toLowerCase().includes(meshLeafName(half.mesh)));
    if (half.status === "resolved" && half.route !== "dynamic") {
      expect(partsOfHalf.length, `${row.key} ${half.half} ${half.mesh}`).toBeGreaterThan(0);
      expect(partsOfHalf.every(part => part.enabled), `${row.key} ${half.half} enabled`).toBe(true);
    } else {
      expect(partsOfHalf, `${row.key} ${half.half} ${half.status}`).toEqual([]);
    }
  }
}

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

async function despawnEntity(page: Page, entityId: string): Promise<void> {
  await page.evaluate(id => window.__nativeSlice!.dispatch({ type: "despawn", entityId: id }), entityId);
  await expect.poll(async () => (await entities(page)).some(entity => entity.id === entityId)).toBe(false);
}

async function despawnSliceMonsterAtTheSpawnPoint(page: Page): Promise<void> {
  await despawnEntity(page, sliceMonsterEntityId);
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
    const meshSuffixes = hairHalfMeshSuffixes();
    await withPage(browser, { viewport: desktopViewport }, async page => {
      const catalogSha256 = await servedLaneCatalogSha256(baseURL);
      for (const row of characterRows()) {
        const character = await spawnCharacter(page, row.chargrpIndex);
        const loaded = character.modelId !== null && character.missingAssetDiagnostic === null;
        if (row.profile === "written") {
          expect(loaded, `${row.key} ${character.missingAssetDiagnostic}`).toBe(true);
          await expectActiveClip(page, character.id, profiles.get(row.chargrpIndex)!.clips.idle!);
          if (row.hair?.status === "bound") expectCensusHairParts(row, await spawnedCharacter(page, character.id), meshSuffixes);
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

  test("character 0 draws its front and back hair halves with library materials, from the front and the side on desktop and the landscape phone", async ({ browser }) => {
    test.setTimeout((worldReadyTimeout + modelLoadTimeout * 2) * 2);
    const row = characterRows().find(candidate => candidate.chargrpIndex === 0);
    if (row?.hair?.status !== "bound") throw new Error(`character:0 hair is ${row?.hair?.status ?? "missing"} in the census`);
    const hairMaterials = row.hair.halves.flatMap(half => half.material === undefined ? [] : [half.material]);
    expect(row.hair.halves.map(half => half.status)).toEqual(["resolved", "resolved"]);
    mkdirSync(evidenceDirectory, { recursive: true });
    for (const [device, options] of [["desktop", { viewport: desktopViewport }], ["phone", landscapePhone]] as const) {
      await withPage(browser, options, async page => {
        await despawnSliceMonsterAtTheSpawnPoint(page);
        const character = await spawnCharacter(page, 0);
        await expectActiveClip(page, character.id, servedCharacterProfiles().get(0)!.clips.idle!);
        expectCensusHairParts(row, await spawnedCharacter(page, character.id), hairHalfMeshSuffixes());
        const diagnosticRoots = await page.evaluate(() => (window.__nativeSlice!.snapshot().diagnosticMaterials ?? []).map(record => record.root));
        expect(diagnosticRoots.filter(root => hairMaterials.some(material => material.toLowerCase() === root.toLowerCase()))).toEqual([]);
        for (const [view, alphaFromFront] of [["front", 0], ["side", sideViewRadians]] as const) {
          await frameCharacter(page, await spawnedCharacter(page, character.id), alphaFromFront);
          await page.screenshot({ path: resolve(evidenceDirectory, `03-39-character-0-hair-${view}-${device}.png`) });
        }
      });
    }
  });

  test("keys 0 and 10 idle with rigid back hair and keys 3 and 7 carry the dynamic back hair gap, on desktop and the landscape phone", async ({ browser }) => {
    const keys = [...rigidBackHairKeys, ...dynamicBackHairKeys].sort((left, right) => left - right);
    test.setTimeout((worldReadyTimeout + modelLoadTimeout * 2 * keys.length) * 2);
    const rows = new Map(characterRows().map(row => [row.chargrpIndex, row]));
    for (const key of rigidBackHairKeys) {
      expect(rows.get(key)?.hair?.halves.find(half => half.half === "back"), `character:${key} back hair`).toMatchObject({ status: "resolved", route: "ordinary" });
    }
    for (const key of dynamicBackHairKeys) {
      expect(rows.get(key)?.gaps, `character:${key} gaps`).toContainEqual(dynamicBackHairGap);
      expect(rows.get(key)?.hair?.halves.find(half => half.half === "back")?.route, `character:${key} back route`).toBe("dynamic");
    }
    const profiles = servedCharacterProfiles();
    mkdirSync(evidenceDirectory, { recursive: true });
    for (const [device, options] of [["desktop", { viewport: desktopViewport }], ["phone", landscapePhone]] as const) {
      await withPage(browser, options, async page => {
        await despawnSliceMonsterAtTheSpawnPoint(page);
        for (const key of keys) {
          const row = rows.get(key)!;
          const character = await spawnCharacter(page, key);
          await expectActiveClip(page, character.id, profiles.get(key)!.clips.idle!);
          expectCensusHairParts(row, await spawnedCharacter(page, character.id), hairHalfMeshSuffixes());
          await frameCharacter(page, await spawnedCharacter(page, character.id), obliqueViewRadians);
          await page.screenshot({ path: resolve(evidenceDirectory, `rm14-character-${key}-wait-${device}.png`) });
          await despawnEntity(page, character.id);
        }
      });
    }
  });

  test("the portrait phone has no horizontal scroll with a character spawned", async ({ browser }) => {
    test.setTimeout(worldReadyTimeout + modelLoadTimeout);
    await withPage(browser, portraitPhone, async page => {
      await spawnCharacter(page, characterRows()[0]!.chargrpIndex);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
});
