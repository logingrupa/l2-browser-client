import { readFileSync } from "node:fs";

export type HourlyLightingSurface = "terrain" | "BSP" | "staticMesh" | "actor";

export interface HourlyLightingFixtureRow {
  readonly index: number;
  readonly hour: number;
  readonly surfaceType: HourlyLightingSurface;
  readonly status?: string;
  readonly controlWord?: string;
  readonly environmentType?: number;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: Readonly<Record<string, unknown>>;
}

export interface HourlyLightingFixtureContext {
  readonly tIntMapTimes: readonly number[];
  readonly tIntMapSample134x129: readonly number[];
  readonly terrainLightMaskBit23: readonly (readonly number[])[];
  readonly staticHourlyVertex0Bits: readonly number[];
  readonly atlasChildCounts: readonly number[];
}

export interface HourlyLightingFixtureDocument {
  readonly source: {
    readonly composition: { readonly sha256: string };
    readonly replayResult: { readonly sha256: string; readonly checked: number; readonly matched: number };
  };
  readonly context: HourlyLightingFixtureContext;
  readonly fixtures: readonly HourlyLightingFixtureRow[];
}

const fixtureFile = new URL("../fixtures/environment/hourly-lighting-db7-fixtures.json", import.meta.url);

export function readHourlyLightingFixtures(): HourlyLightingFixtureDocument {
  return JSON.parse(readFileSync(fixtureFile, "utf8")) as HourlyLightingFixtureDocument;
}

export function fixtureNumber(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new TypeError(`Fixture field ${key} is not a number: ${JSON.stringify(value)}.`);
  return value;
}

export function fixtureNumbers(record: Readonly<Record<string, unknown>>, key: string): number[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every(item => typeof item === "number")) throw new TypeError(`Fixture field ${key} is not a number list: ${JSON.stringify(value)}.`);
  return value as number[];
}

export function fixtureBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new TypeError(`Fixture field ${key} is not a boolean: ${JSON.stringify(value)}.`);
  return value;
}
