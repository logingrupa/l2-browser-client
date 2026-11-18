import type { Scene } from "@babylonjs/core/scene";
import type { NativeEnvironmentSetup } from "../../src/environment/model/nativeEnvironmentManager";
import type { NativeEnvironmentTables, NativeEnvironmentTypeTables } from "../../src/environment/model/nativeEnvironmentTypeTables";
import type { ReadRealSeconds } from "../../src/environment/model/nativeTimeClock";
import type { EnvironmentFogRanges } from "../../src/materials/ue2/model/fog";
import type { NativeTimeTablesExport, SkyEnvironmentBinding } from "../../src/environment/parseNativeTimeTables";
import { provideWorldTimeOfDay, startWorldTimeOfDay, type RunningWorldTimeOfDay } from "../../src/scene/world/worldTimeOfDay";
import { readDayNightLoadedTables } from "./dayNightFixtures";

export const shippedEnvironmentSetup: NativeEnvironmentSetup = { isClock: true, timeRatio: 6, startTimeHours: 12, shadowTickHours: Math.fround(0.1) };

export const shippedSkyBindings: readonly SkyEnvironmentBinding[] = [
  { setupKey: "SKYBOX", objectName: "SkybackgroundColor", section: "SkyBoxColor" },
  { setupKey: "HAZERING", objectName: "HazeRing_Final", section: "HazeringColor" },
  { setupKey: "CLOUD1", objectName: "Cloud_Final", section: "CloudColor1" },
  { setupKey: "CLOUD2", objectName: "StarField_Final01", section: "CloudColor2" },
  { setupKey: "CLOUD3", objectName: "StarField_Final02", section: "CloudColor3" },
];

export const shippedEnvironmentFogRanges: EnvironmentFogRanges = { startRanges: [1, 1.5, 2, 2.5, 4], endRanges: [4, 5, 6, 7, 10] };

export function dayNightTimeTables(setup: NativeEnvironmentSetup = shippedEnvironmentSetup): NativeTimeTablesExport {
  return { setup, tables: readDayNightLoadedTables(), skyBindings: shippedSkyBindings, fogRanges: shippedEnvironmentFogRanges };
}

export function provideDayNightTimeOfDay(scene: Scene, readRealSeconds: ReadRealSeconds = () => 0,
  setup: NativeEnvironmentSetup = shippedEnvironmentSetup): RunningWorldTimeOfDay {
  const timeOfDay = startWorldTimeOfDay(scene, dayNightTimeTables(setup), readRealSeconds);
  provideWorldTimeOfDay(scene, timeOfDay);
  return timeOfDay;
}

function setting(key: string, value: unknown) {
  return { key, value, source: "file", recordIndex: 0, valueSourceOffset: 0, raw: String(value), unresolved: null };
}

function tableDocument(section: string, kind: "rgb" | "hsv" | "scale", values: readonly Record<string, number>[]) {
  return { section, kind, sectionPresent: true, num: values.length, numRecordIndex: 0, numSourceOffset: 0, unresolved: [],
    rows: values.map((rowValues, index) => ({ key: `Row${index + 1}`, keyNumber: index + 1, recordIndex: index, line: index + 1, sourceOffset: index,
      valueSourceOffset: index, raw: "", values: rowValues, defaultedFields: [], unresolved: [] })) };
}

function typeTablesDocument(typeTables: NativeEnvironmentTypeTables) {
  return [
    ...Object.entries(typeTables.colour).map(([section, rows]) => tableDocument(section, "rgb", rows.map(row => ({ T: row.time, R: row.red, G: row.green, B: row.blue })))),
    ...Object.entries(typeTables.hsv).map(([section, rows]) => tableDocument(section, "hsv",
      rows.map(row => ({ T: row.time, Hue: row.hue, Sat: row.saturation, Bri: row.brightness })))),
    ...Object.entries(typeTables.scale).map(([section, rows]) => tableDocument(section, "scale", rows.map(row => ({ T: row.time, S: row.scale })))),
  ];
}

export function timeTablesDocument(tables: NativeEnvironmentTables = readDayNightLoadedTables()) {
  const setup = shippedEnvironmentSetup;
  const environmentTypes = [...tables].map(([environmentType, typeTables]) => ({ file: `timeenv${environmentType}.int`, originalSha256: "a".repeat(64),
    decodedSha256: "b".repeat(64), environmentType, environmentTypeSource: "file", environmentTypeRecordIndex: 0, mergedDuplicateSections: [],
    tables: typeTablesDocument(typeTables), unresolved: [] }));
  const tableCount = environmentTypes.reduce((count, entry) => count + entry.tables.length, 0);
  const rowCount = environmentTypes.reduce((count, entry) => count + entry.tables.reduce((rows, table) => rows + table.rows.length, 0), 0);
  return {
    schemaVersion: 2, kind: "native-environment-time-tables", rules: { path: "recipes/world/environment-native-rules.json", canonicalSha256: "c".repeat(64) },
    setup: { file: "Env.int", section: "EnvSetup",
      values: { IsClock: setting("IsClock", setup.isClock), TimeRatio: setting("TimeRatio", setup.timeRatio), StartTime: setting("StartTime", setup.startTimeHours),
        ShadowTick: setting("ShadowTick", setup.shadowTickHours), SlopeSunAngle: setting("SlopeSunAngle", 30), TimeEnvFileNum: setting("TimeEnvFileNum", tables.size) },
      bindings: { SKYBOX: setting("SKYBOX", "SkybackgroundColor"), HAZERING: setting("HAZERING", "HazeRing_Final"), NumCloudColor: setting("NumCloudColor", 3),
        CLOUD: ["Cloud_Final", "StarField_Final01", "StarField_Final02"].map((objectName, index) => ({ index: index + 1, ...setting(`CLOUD${index + 1}`, objectName) })) },
      timeEnvironmentFiles: [...tables.keys()].map((environmentType, index) => ({ index, ...setting(`TimeEnvFileName${index}`, `timeenv${environmentType}.int`) })),
      fog: { section: "FOG", startRanges: shippedEnvironmentFogRanges.startRanges.map((value, index) => ({ index: index + 1, ...setting(`StartRange${index + 1}`, value) })),
        endRanges: shippedEnvironmentFogRanges.endRanges.map((value, index) => ({ index: index + 1, ...setting(`EndRange${index + 1}`, value) })),
        FogSpeed: setting("FogSpeed", 1) } },
    environmentTypes, tableCount, rowCount, unresolved: [] as string[], typedComplete: true,
  };
}
