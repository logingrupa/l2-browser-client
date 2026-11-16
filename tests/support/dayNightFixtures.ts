import { readFileSync } from "node:fs";
import {
  blackStartColourSections, hsvLightSections, scaleSections, skyLayerColourSections,
  type NativeEnvironmentTables, type NativeEnvironmentTypeTables,
} from "../../src/environment/model/nativeEnvironmentTypeTables";
import type { NativeTimeColourRow, NativeTimeHsvRow, NativeTimeScaleRow } from "../../src/environment/model/sampleNativeTimeTables";

export interface DayNightFixtureRow {
  readonly hour: number;
  readonly environmentType: number;
  readonly consumer: string;
  readonly value: number | readonly number[];
  readonly format: string;
  readonly nativeFunction: string;
  readonly status: string;
}

interface LoadedTableRecord {
  readonly environmentType: number;
  readonly section: string;
  readonly num: number;
  readonly keys: readonly string[];
  readonly packedHex: string;
}

const fixtureDirectory = new URL("../fixtures/environment/", import.meta.url);
const colourRowBytes = 8;
const hsvRowBytes = 12;
const scaleRowBytes = 8;

function readFixtureJson<Document>(fileName: string): Document {
  return JSON.parse(readFileSync(new URL(fileName, fixtureDirectory), "utf8")) as Document;
}

export function readDayNightFixtureRows(): readonly DayNightFixtureRow[] {
  return readFixtureJson<{ readonly fixtures: readonly DayNightFixtureRow[] }>("day-night-db4-fixtures.json").fixtures;
}

function packedRows<Row>(packedHex: string, rowBytes: number, decodeRow: (view: DataView, offset: number) => Row): Row[] {
  const bytes = Buffer.from(packedHex, "hex");
  if (bytes.length % rowBytes !== 0) throw new RangeError(`Packed table length ${bytes.length} is not a multiple of ${rowBytes}.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / rowBytes }, (_, index) => decodeRow(view, index * rowBytes));
}

const decodeColourRow = (view: DataView, offset: number): NativeTimeColourRow =>
  ({ time: view.getFloat32(offset, true), red: view.getUint8(offset + 4), green: view.getUint8(offset + 5), blue: view.getUint8(offset + 6) });
const decodeHsvRow = (view: DataView, offset: number): NativeTimeHsvRow =>
  ({ time: view.getFloat32(offset, true), hue: view.getUint8(offset + 4), saturation: view.getUint8(offset + 5), brightness: view.getFloat32(offset + 8, true) });
const decodeScaleRow = (view: DataView, offset: number): NativeTimeScaleRow =>
  ({ time: view.getFloat32(offset, true), scale: view.getFloat32(offset + 4, true) });

function sectionRecord<Section extends string, Row>(records: readonly LoadedTableRecord[], sections: readonly Section[], rowBytes: number,
  decodeRow: (view: DataView, offset: number) => Row): Record<Section, Row[]> {
  return Object.fromEntries(sections.map(section => {
    const record = records.find(candidate => candidate.section === section);
    if (record === undefined) throw new RangeError(`The loaded tables miss section ${section}.`);
    return [section, packedRows(record.packedHex, rowBytes, decodeRow)];
  })) as Record<Section, Row[]>;
}

export function readDayNightLoadedTables(): NativeEnvironmentTables {
  const records = readFixtureJson<{ readonly tables: readonly LoadedTableRecord[] }>("day-night-db4-loaded-tables.json").tables;
  const environmentTypes = [...new Set(records.map(record => record.environmentType))];
  return new Map(environmentTypes.map((environmentType): [number, NativeEnvironmentTypeTables] => {
    const typeRecords = records.filter(record => record.environmentType === environmentType);
    return [environmentType, {
      colour: sectionRecord(typeRecords, [...blackStartColourSections, ...skyLayerColourSections], colourRowBytes, decodeColourRow),
      hsv: sectionRecord(typeRecords, hsvLightSections, hsvRowBytes, decodeHsvRow),
      scale: sectionRecord(typeRecords, scaleSections, scaleRowBytes, decodeScaleRow),
    }];
  }));
}
