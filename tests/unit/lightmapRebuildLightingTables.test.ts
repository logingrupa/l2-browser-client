import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLightingTables, inverseSquareRootLookup, type LightingTables } from "../../src/environment/model/lightmapRebuild/lightingTables";

interface TableFixture {
  readonly controlWord: string;
  readonly attenuationFirst8: readonly number[];
  readonly shadowTable127: readonly number[];
}

interface DumpRange {
  readonly table: "powMinusHalfExponent" | "powMinusHalfMantissa" | "attenuation" | "shadowFilter";
  readonly entries: number;
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly sha256: string;
}

const fixtureDirectory = new URL("../fixtures/db16/", import.meta.url);
const readFixture = <Document>(fileName: string) => JSON.parse(readFileSync(new URL(fileName, fixtureDirectory), "utf8")) as Document;
const shadowDocument = readFixture<{ readonly tableFixtures: readonly TableFixture[] }>("shadow-native.json");
const dumpDocument = readFixture<{ readonly controlWord: string; readonly ranges: readonly DumpRange[] }>("lighting-tables-cw027f.json");
const tables = buildLightingTables();

function generatedTable(generated: LightingTables, table: DumpRange["table"]): Float32Array | Uint32Array {
  switch (table) {
    case "powMinusHalfExponent": return generated.inverseSquareRootExponent;
    case "powMinusHalfMantissa": return generated.inverseSquareRootMantissa;
    case "attenuation": return generated.attenuation;
    case "shadowFilter": return generated.shadowPatterns;
  }
}

function littleEndianBytes(values: Float32Array | Uint32Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => values instanceof Float32Array ? view.setFloat32(index * 4, value, true) : view.setUint32(index * 4, value, true));
  return bytes;
}

describe("lighting tables 0x10670de0 against the native CW 0x027f dump", () => {
  it("covers the four tables the rebuild reads", () => {
    expect(dumpDocument.controlWord).toBe("0x027f");
    expect(dumpDocument.ranges.map(range => range.table)).toEqual(["powMinusHalfExponent", "powMinusHalfMantissa", "attenuation", "shadowFilter"]);
  });

  it.each(dumpDocument.ranges.map(range => [range.table, range] as const))("generates %s bytes that hash to the dumped range", (_table, range) => {
    const bytes = littleEndianBytes(generatedTable(tables, range.table));
    expect(bytes.length).toBe(range.byteEnd - range.byteStart);
    expect(bytes.length).toBe(range.entries * 4);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(range.sha256);
  });

  it.each(shadowDocument.tableFixtures.map(fixture => [fixture.controlWord, fixture] as const))(
    "reproduces the DB-16 native first eight attenuation entries and shadow pattern 127 at control word %s", (_controlWord, fixture) => {
      expect(Array.from(tables.attenuation.subarray(0, 8))).toEqual(fixture.attenuationFirst8);
      expect(Array.from(tables.shadowPatterns.subarray(127 * 4, 128 * 4))).toEqual(fixture.shadowTable127);
    });
});

describe("inverse square root lookup 0x10670250 over the hash-checked power tables", () => {
  it("multiplies the mantissa entry by the exponent entry and stores the product as float32", () => {
    const value = Math.fround(1.5 + 1 / 2048);
    const product = Math.fround(tables.inverseSquareRootMantissa[512]! * tables.inverseSquareRootExponent[127]!);
    expect(inverseSquareRootLookup(tables, value)).toBe(product);
  });

  it("returns exact reciprocal roots for even powers of two", () => {
    expect(inverseSquareRootLookup(tables, 1)).toBe(1);
    expect(inverseSquareRootLookup(tables, 4)).toBe(0.5);
    expect(inverseSquareRootLookup(tables, 0.25)).toBe(2);
  });
});
