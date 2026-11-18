import { FOG_RANGE_SLOT_COUNT, type EnvironmentFogRanges } from "../materials/ue2/model/fog";
import type { NativeEnvironmentSetup } from "./model/nativeEnvironmentManager";
import {
  blackStartColourSections, hsvLightSections, scaleSections, skyLayerColourSections,
  type NativeEnvironmentTables, type NativeEnvironmentTypeTables, type NativeTimeColourSection, type SkyLayerColourSection,
} from "./model/nativeEnvironmentTypeTables";
import type { NativeTimeColourRow, NativeTimeHsvRow, NativeTimeScaleRow } from "./model/sampleNativeTimeTables";

export type SkyEnvironmentSection = "SkyBoxColor" | SkyLayerColourSection;

export interface SkyEnvironmentBinding {
  readonly setupKey: string;
  readonly objectName: string;
  readonly section: SkyEnvironmentSection;
}

export interface NativeTimeTablesExport {
  readonly setup: NativeEnvironmentSetup;
  readonly tables: NativeEnvironmentTables;
  readonly skyBindings: readonly SkyEnvironmentBinding[];
  readonly fogRanges: EnvironmentFogRanges;
}

export type NativeTimeTablesParse =
  | { readonly status: "complete"; readonly timeTables: NativeTimeTablesExport }
  | { readonly status: "incomplete"; readonly unresolved: readonly string[] };

export class NativeTimeTablesFormatError extends Error {
  override readonly name = "NativeTimeTablesFormatError";
}

type JsonRecord = Readonly<Record<string, unknown>>;

const timeTablesKind = "native-environment-time-tables";
const timeTablesSchemaVersion = 2;
const colourSections: readonly NativeTimeColourSection[] = [...blackStartColourSections, ...skyLayerColourSections];
const sectionKinds: ReadonlyMap<string, "rgb" | "hsv" | "scale"> = new Map([
  ...colourSections.map(section => [section, "rgb"] as const),
  ...hsvLightSections.map(section => [section, "hsv"] as const),
  ...scaleSections.map(section => [section, "scale"] as const),
]);
const cloudSectionByIndex: ReadonlyMap<number, SkyLayerColourSection> = new Map([[1, "CloudColor1"], [2, "CloudColor2"], [3, "CloudColor3"]]);

function requireTimeTables(condition: unknown, message: string): asserts condition {
  if (!condition) throw new NativeTimeTablesFormatError(`Native time tables: ${message}`);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): JsonRecord {
  requireTimeTables(isJsonRecord(value), `${label} is not an object.`);
  return value;
}

function requireList(value: unknown, label: string): readonly unknown[] {
  requireTimeTables(Array.isArray(value), `${label} is not a list.`);
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  requireTimeTables(typeof value === "number" && Number.isFinite(value), `${label} is not a finite number.`);
  return value;
}

function requireByte(value: unknown, label: string): number {
  requireTimeTables(Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255, `${label} is not a byte.`);
  return value as number;
}

function requireSafeInteger(value: unknown, label: string): number {
  requireTimeTables(Number.isSafeInteger(value), `${label} is not an integer.`);
  return value as number;
}

function settingValue(setting: unknown, label: string): unknown {
  return requireRecord(setting, label).value;
}

function readSetup(setup: JsonRecord): NativeEnvironmentSetup {
  const values = requireRecord(setup.values, "setup values");
  const isClock = settingValue(values.IsClock, "setup IsClock");
  requireTimeTables(typeof isClock === "boolean", "setup IsClock is not a boolean.");
  return { isClock, timeRatio: requireSafeInteger(settingValue(values.TimeRatio, "setup TimeRatio"), "setup TimeRatio"),
    startTimeHours: requireFiniteNumber(settingValue(values.StartTime, "setup StartTime"), "setup StartTime"),
    shadowTickHours: requireFiniteNumber(settingValue(values.ShadowTick, "setup ShadowTick"), "setup ShadowTick"),
    slopeSunAngleDegrees: requireFiniteNumber(settingValue(values.SlopeSunAngle, "setup SlopeSunAngle"), "setup SlopeSunAngle") };
}

function bindingObjectName(setting: unknown, label: string): string {
  const objectName = settingValue(setting, label);
  requireTimeTables(typeof objectName === "string" && objectName.length > 0, `${label} names no material object.`);
  return objectName;
}

function readSkyBindings(setup: JsonRecord): SkyEnvironmentBinding[] {
  const bindings = requireRecord(setup.bindings, "setup bindings");
  const cloudCount = requireSafeInteger(settingValue(bindings.NumCloudColor, "setup NumCloudColor"), "setup NumCloudColor");
  const clouds = requireList(bindings.CLOUD, "setup CLOUD bindings");
  requireTimeTables(clouds.length === cloudCount, `setup lists ${clouds.length} CLOUD bindings for NumCloudColor ${cloudCount}.`);
  return [
    { setupKey: "SKYBOX", objectName: bindingObjectName(bindings.SKYBOX, "setup SKYBOX"), section: "SkyBoxColor" },
    { setupKey: "HAZERING", objectName: bindingObjectName(bindings.HAZERING, "setup HAZERING"), section: "HazeringColor" },
    ...clouds.map((cloud, position) => {
      const index = requireRecord(cloud, `setup CLOUD binding ${position}`).index;
      const section = cloudSectionByIndex.get(index as number);
      requireTimeTables(section !== undefined, `setup CLOUD binding ${String(index)} has no CloudColor table.`);
      return { setupKey: `CLOUD${String(index)}`, objectName: bindingObjectName(cloud, `setup CLOUD${String(index)}`), section };
    }),
  ];
}

function readFogRangeValues(settings: unknown, label: string): number[] {
  const list = requireList(settings, label);
  requireTimeTables(list.length === FOG_RANGE_SLOT_COUNT, `${label} lists ${list.length} ranges instead of ${FOG_RANGE_SLOT_COUNT}.`);
  return list.map((setting, position) => requireFiniteNumber(settingValue(setting, `${label} ${position + 1}`), `${label} ${position + 1}`));
}

function readFogRanges(setup: JsonRecord): EnvironmentFogRanges {
  const fog = requireRecord(setup.fog, "setup fog");
  return { startRanges: readFogRangeValues(fog.startRanges, "setup fog StartRange"), endRanges: readFogRangeValues(fog.endRanges, "setup fog EndRange") };
}

function rowValues(row: unknown, label: string): JsonRecord {
  return requireRecord(requireRecord(row, label).values, `${label} values`);
}

function colourRow(row: unknown, label: string): NativeTimeColourRow {
  const values = rowValues(row, label);
  return { time: requireFiniteNumber(values.T, `${label} T`), red: requireByte(values.R, `${label} R`), green: requireByte(values.G, `${label} G`),
    blue: requireByte(values.B, `${label} B`) };
}

function hsvRow(row: unknown, label: string): NativeTimeHsvRow {
  const values = rowValues(row, label);
  return { time: requireFiniteNumber(values.T, `${label} T`), hue: requireByte(values.Hue, `${label} Hue`),
    saturation: requireByte(values.Sat, `${label} Sat`), brightness: requireFiniteNumber(values.Bri, `${label} Bri`) };
}

function scaleRow(row: unknown, label: string): NativeTimeScaleRow {
  const values = rowValues(row, label);
  return { time: requireFiniteNumber(values.T, `${label} T`), scale: requireFiniteNumber(values.S, `${label} S`) };
}

function readTypeTables(entry: JsonRecord, label: string): NativeEnvironmentTypeTables {
  const rowsBySection = new Map<string, readonly unknown[]>();
  for (const candidate of requireList(entry.tables, `${label} tables`)) {
    const table = requireRecord(candidate, `${label} table`);
    const section = table.section;
    requireTimeTables(typeof section === "string" && sectionKinds.has(section), `${label} lists an unknown section ${String(section)}.`);
    requireTimeTables(table.kind === sectionKinds.get(section), `${label} ${section} is not a ${sectionKinds.get(section)} table.`);
    requireTimeTables(!rowsBySection.has(section), `${label} lists section ${section} twice.`);
    rowsBySection.set(section, requireList(table.rows, `${label} ${section} rows`));
  }
  const rowsOf = <Row>(section: string, readRow: (row: unknown, rowLabel: string) => Row): Row[] => {
    const rows = rowsBySection.get(section);
    requireTimeTables(rows !== undefined, `${label} misses section ${section}.`);
    return rows.map((row, index) => readRow(row, `${label} ${section} row ${index}`));
  };
  const sectionRecord = <Section extends string, Row>(sections: readonly Section[], readRow: (row: unknown, rowLabel: string) => Row) =>
    Object.fromEntries(sections.map(section => [section, rowsOf(section, readRow)])) as Record<Section, Row[]>;
  return { colour: sectionRecord(colourSections, colourRow), hsv: sectionRecord(hsvLightSections, hsvRow), scale: sectionRecord(scaleSections, scaleRow) };
}

function readEnvironmentTables(entries: readonly unknown[]): NativeEnvironmentTables {
  const tables = new Map<number, NativeEnvironmentTypeTables>();
  for (const candidate of entries) {
    const entry = requireRecord(candidate, "environment type entry");
    const label = `environment type file ${String(entry.file)}`;
    const environmentType = requireSafeInteger(entry.environmentType, `${label} EnvType`);
    requireTimeTables(!tables.has(environmentType), `EnvType ${environmentType} is declared twice.`);
    tables.set(environmentType, readTypeTables(entry, label));
  }
  return tables;
}

export function parseNativeTimeTables(document: unknown): NativeTimeTablesParse {
  const root = requireRecord(document, "the document");
  requireTimeTables(root.kind === timeTablesKind && root.schemaVersion === timeTablesSchemaVersion,
    `the document is not ${timeTablesKind} schema ${timeTablesSchemaVersion}.`);
  const unresolved = requireList(root.unresolved, "unresolved");
  requireTimeTables(unresolved.every(reason => typeof reason === "string"), "unresolved lists a reason that is not text.");
  requireTimeTables(root.typedComplete === (unresolved.length === 0), "typedComplete disagrees with the unresolved list.");
  if (unresolved.length > 0) return { status: "incomplete", unresolved: unresolved as string[] };
  const setup = requireRecord(root.setup, "setup");
  return { status: "complete", timeTables: { setup: readSetup(setup), tables: readEnvironmentTables(requireList(root.environmentTypes, "environmentTypes")),
    skyBindings: readSkyBindings(setup), fogRanges: readFogRanges(setup) } };
}
