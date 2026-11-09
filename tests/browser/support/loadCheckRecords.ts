import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { readLaneOwnership } from "../../../scripts/check-lane-ownership.mjs";
import { formatRigaTimestamp } from "../../../scripts/check-machine-schedule.mjs";
import type { LoadCheckHarnessState } from "../harness/loadCheckHarness";
import { servedLaneCatalogSha256, readLoadCheckRecords, writeLoadCheckRecord, type LoadCheckRecord } from "./loadCheckRecordFile";

export const LOAD_CHECK_KINDS = ["tiles", "npcs", "items", "skills", "windows"] as const;
export type LoadCheckKind = (typeof LOAD_CHECK_KINDS)[number];
export type AssetManifestSchemaVersion = Exclude<LoadCheckRecord["assetManifestSchemaVersion"], null>;
export type LoadCheckOutcome = Omit<LoadCheckRecord, "key" | "atRiga">;

export const loadCheckKeyTimeoutMilliseconds = 90_000;
export const loadCheckTileLoadTimeoutMilliseconds = 180_000;
const loadCheckSliceSetupMilliseconds = 120_000;
const loadCheckHarnessPath = "/tests/browser/harness/load-check.html";
const laneOwnershipFilePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.planning/lanes.json");
const plainDecimalPattern = /^[1-9]\d*$/;

const loadCheckKeyPrefixes: Readonly<Record<LoadCheckKind, string>> = {
  tiles: "tile:", npcs: "npc:", items: "item:", skills: "skill:", windows: "window:",
};

export interface LoadCheckSliceSettings {
  readonly laneName: string;
  readonly kind: LoadCheckKind;
  readonly limit: number;
}

export interface LoadCheckSliceActions {
  servedLaneCatalogSha256(): Promise<string>;
  readRecordedKeys(catalogSha256: string): Promise<ReadonlySet<string>>;
  listConvertedKeys(prefix: string): Promise<readonly string[]>;
  checkKey(key: string): Promise<LoadCheckOutcome>;
  writeRecord(catalogSha256: string, record: LoadCheckRecord): Promise<void>;
  nowAtRiga(): string;
}

export interface LoadCheckSliceSummary {
  readonly catalogSha256: string;
  readonly checkedKeys: readonly string[];
  readonly skippedAsRecorded: number;
}

export function loadCheckKindKeyPrefix(kind: LoadCheckKind): string {
  return loadCheckKeyPrefixes[kind];
}

export function loadCheckLaneNames(): readonly string[] {
  return Object.keys(readLaneOwnership(laneOwnershipFilePath).lanes).sort();
}

function isLoadCheckKind(value: string): value is LoadCheckKind {
  return (LOAD_CHECK_KINDS as readonly string[]).includes(value);
}

export function readLoadCheckSliceSettings(environment: Readonly<Record<string, string | undefined>>, laneNames: readonly string[]): LoadCheckSliceSettings | null {
  const { NATIVE_STORE_ROOT: laneName, LOAD_CHECK_KIND: kind, LOAD_CHECK_LIMIT: limitText } = environment;
  if (!laneName || !kind || !limitText) return null;
  if (!laneNames.includes(laneName)) throw new Error(`NATIVE_STORE_ROOT ${JSON.stringify(laneName)} is not a lane; use one of ${laneNames.join(", ")}`);
  if (!isLoadCheckKind(kind)) throw new Error(`LOAD_CHECK_KIND ${JSON.stringify(kind)} is not one of ${LOAD_CHECK_KINDS.join(", ")}`);
  const limit = Number(limitText);
  if (!plainDecimalPattern.test(limitText) || !Number.isSafeInteger(limit)) {
    throw new Error(`LOAD_CHECK_LIMIT ${JSON.stringify(limitText)} is not a positive safe integer in plain decimal digits`);
  }
  return { laneName, kind, limit };
}

export function pendingLoadCheckKeys(convertedKeys: readonly string[], recordedKeys: ReadonlySet<string>, limit: number): readonly string[] {
  return convertedKeys.filter(key => !recordedKeys.has(key)).slice(0, limit);
}

export function keysNotRecordedExactlyOnce(checkedKeys: readonly string[], recordedKeys: readonly string[]): readonly string[] {
  return checkedKeys.filter(key => recordedKeys.filter(recordedKey => recordedKey === key).length !== 1);
}

export function lowestAssetManifestSchemaVersion(versions: readonly AssetManifestSchemaVersion[]): AssetManifestSchemaVersion | null {
  return versions.reduce<AssetManifestSchemaVersion | null>((lowest, version) => lowest === null || version < lowest ? version : lowest, null);
}

export function loadCheckSpecTitle(kind: LoadCheckKind): string {
  return `load sweep ${kind} slice`;
}

export function loadCheckSkipReason(kind: LoadCheckKind): string {
  return `a load sweep runs only as a slice: NATIVE_STORE_ROOT=<lane> LOAD_CHECK_KIND=${kind} LOAD_CHECK_LIMIT=<n> `
    + `pnpm test:e2e tests/browser/load-sweep-${kind}.spec.ts, started only while nothing listens on port 5173; `
    + "it writes one record per key to artifacts/lane-store/<lane>/load-checks/<catalogSha256>.json";
}

export function loadCheckSliceTimeoutMilliseconds(settings: LoadCheckSliceSettings, perKeyMilliseconds: number): number {
  return settings.limit * perKeyMilliseconds + loadCheckSliceSetupMilliseconds;
}

export function firstMessageLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine !== "") return firstLine;
  return error instanceof Error ? `${error.name} without a message` : "check rejected without a message";
}

async function checkedOutcome(actions: LoadCheckSliceActions, key: string): Promise<LoadCheckOutcome> {
  try {
    const outcome = await actions.checkKey(key);
    if (outcome.status === "pass") return { status: "pass", reason: null, assetManifestSchemaVersion: outcome.assetManifestSchemaVersion };
    return { status: "failed", reason: firstMessageLine(outcome.reason ?? ""), assetManifestSchemaVersion: outcome.assetManifestSchemaVersion };
  } catch (error) {
    return { status: "failed", reason: firstMessageLine(error), assetManifestSchemaVersion: null };
  }
}

export async function runLoadCheckSlice(settings: LoadCheckSliceSettings, actions: LoadCheckSliceActions): Promise<LoadCheckSliceSummary> {
  const prefix = loadCheckKindKeyPrefix(settings.kind);
  const catalogSha256 = await actions.servedLaneCatalogSha256();
  const recordedKeys = await actions.readRecordedKeys(catalogSha256);
  const convertedKeys = await actions.listConvertedKeys(prefix);
  const foreignKey = convertedKeys.find(key => !key.startsWith(prefix));
  if (foreignKey !== undefined) throw new Error(`converted key list for ${prefix} holds ${foreignKey}`);
  const checkedKeys: string[] = [];
  for (const key of pendingLoadCheckKeys(convertedKeys, recordedKeys, settings.limit)) {
    const outcome = await checkedOutcome(actions, key);
    await actions.writeRecord(catalogSha256, { key, ...outcome, atRiga: actions.nowAtRiga() });
    checkedKeys.push(key);
  }
  return { catalogSha256, checkedKeys, skippedAsRecorded: convertedKeys.filter(key => recordedKeys.has(key)).length };
}

type SettledLoadCheckHarnessState = Exclude<LoadCheckHarnessState, { readonly state: "running" }>;

async function settledHarnessState(page: Page, url: string, timeoutMilliseconds: number): Promise<SettledLoadCheckHarnessState> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__loadCheckHarness !== undefined && window.__loadCheckHarness.state !== "running", undefined,
    { timeout: timeoutMilliseconds });
  if (pageErrors.length > 0) throw new Error(`page error: ${firstMessageLine(pageErrors[0])}`);
  const state = await page.evaluate(() => window.__loadCheckHarness);
  if (state === undefined || state.state === "running") throw new Error("the load-check harness did not settle");
  return state;
}

async function listHarnessConvertedKeys(page: Page, prefix: string): Promise<readonly string[]> {
  const state = await settledHarnessState(page, `${loadCheckHarnessPath}?list=${encodeURIComponent(prefix)}`, loadCheckKeyTimeoutMilliseconds);
  if (state.state === "failed") throw new Error(`load-check harness list ${prefix} failed: ${state.reason}`);
  if (!("convertedKeys" in state)) throw new Error(`load-check harness list ${prefix} returned no key list`);
  return state.convertedKeys;
}

export async function checkHarnessLoadKey(page: Page, key: string): Promise<LoadCheckOutcome> {
  const keyPage = await page.context().newPage();
  try {
    const state = await settledHarnessState(keyPage, `${loadCheckHarnessPath}?key=${encodeURIComponent(key)}`, loadCheckKeyTimeoutMilliseconds);
    if (state.state === "failed") return { status: "failed", reason: firstMessageLine(state.reason), assetManifestSchemaVersion: null };
    if (!("result" in state)) throw new Error(`load-check harness returned no result for ${key}`);
    return { status: "pass", reason: null, assetManifestSchemaVersion: lowestAssetManifestSchemaVersion(state.result.assetManifestSchemaVersions) };
  } finally {
    await keyPage.close();
  }
}

export function playwrightLoadCheckActions(page: Page, baseUrl: string, settings: LoadCheckSliceSettings,
  checkKey: (key: string) => Promise<LoadCheckOutcome>): LoadCheckSliceActions {
  return {
    servedLaneCatalogSha256: () => servedLaneCatalogSha256(baseUrl),
    readRecordedKeys: async catalogSha256 => new Set(readLoadCheckRecords(settings.laneName, catalogSha256).map(record => record.key)),
    listConvertedKeys: prefix => listHarnessConvertedKeys(page, prefix),
    checkKey,
    writeRecord: async (catalogSha256, record) => { writeLoadCheckRecord(settings.laneName, catalogSha256, record); },
    nowAtRiga: () => formatRigaTimestamp(new Date()),
  };
}
