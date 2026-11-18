import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLightingTables } from "../../src/environment/model/lightmapRebuild/lightingTables";
import type { FilteredShadowMask, PackedShadowRecord } from "../../src/environment/model/lightmapRebuild/lightmapRebuildTypes";
import { filterPackedShadowMask } from "../../src/environment/model/lightmapRebuild/shadowMaskFilter";

interface FilterFixture {
  readonly label: string;
  readonly input: { readonly maskHex: string; readonly width: number; readonly height: number };
  readonly outputRows: readonly (readonly number[])[];
}

const document = JSON.parse(readFileSync(new URL("../fixtures/db16/shadow-native.json", import.meta.url), "utf8")) as { readonly filterFixtures: readonly FilterFixture[] };
const { shadowPatterns } = buildLightingTables();

function multiRowRecord(rowsOfMaskBytes: readonly (readonly number[])[], width: number): PackedShadowRecord {
  const rowBytes = rowsOfMaskBytes[0]!.length;
  return {
    minimumX: 0, minimumY: 0, maximumX: width - 1, maximumY: rowsOfMaskBytes.length - 1,
    height: rowsOfMaskBytes.length, rowBytes, bits: Uint8Array.from(rowsOfMaskBytes.flat()),
  };
}

function rowsOf({ bytes, rowStride }: FilteredShadowMask): number[][] {
  return Array.from({ length: bytes.length / rowStride }, (_, row) => Array.from(bytes.subarray(row * rowStride, (row + 1) * rowStride)));
}

describe("packed shadow mask filter 0x10671600 against native Unicorn runs", () => {
  it.each(document.filterFixtures.map(fixture => [fixture.label, fixture] as const))("matches the %s fixture", (_label, fixture) => {
    const maskRows = fixture.input.maskHex.match(/../g)!.map(byte => [Number.parseInt(byte, 16)]);
    const filtered = filterPackedShadowMask(multiRowRecord(maskRows, fixture.input.width), shadowPatterns);
    expect(filtered.rowStride).toBe(8);
    expect(rowsOf(filtered)).toEqual(fixture.outputRows);
  });
});

describe("packed shadow mask filter 0x10671600 listing-derived edges", () => {
  it("fills a single-row record with 255 over its width, whatever the mask holds", () => {
    const singleRow: PackedShadowRecord = { minimumX: 3, minimumY: 5, maximumX: 12, maximumY: 5, height: 1, rowBytes: 2, bits: Uint8Array.from([0, 0]) };
    expect(rowsOf(filterPackedShadowMask(singleRow, shadowPatterns))).toEqual([new Array(10).fill(255)]);
  });

  it("copies bit 7 of the last mask byte past the right edge and keeps padding bits as stored", () => {
    const record = multiRowRecord([[0x00, 0x80], [0x00, 0x80], [0x00, 0x80]], 10);
    const expectedRow = [...new Array(14).fill(0), 69, 184];
    expect(rowsOf(filterPackedShadowMask(record, shadowPatterns))).toEqual([expectedRow, expectedRow, expectedRow]);
  });

  it("carries the window across mask bytes so a lit pixel 7 spreads into pixel 8", () => {
    const record = multiRowRecord([[0x80, 0x00], [0x80, 0x00], [0x80, 0x00]], 16);
    const expectedRow = [0, 0, 0, 0, 0, 0, 69, 113, 69, 0, 0, 0, 0, 0, 0, 0];
    expect(rowsOf(filterPackedShadowMask(record, shadowPatterns))).toEqual([expectedRow, expectedRow, expectedRow]);
  });

  it("clamps the vertical kernel to the first and last rows of a two-row mask", () => {
    const filtered = filterPackedShadowMask(multiRowRecord([[0xff], [0x00]], 8), shadowPatterns);
    const litRowEdgeAndCentre = 70 + 114;
    const litRowEdgeOnly = 70;
    expect(rowsOf(filtered)).toEqual([new Array(8).fill(litRowEdgeAndCentre), new Array(8).fill(litRowEdgeOnly)]);
  });

  it("refuses a multi-row rectangle whose mask has a single row", () => {
    const record: PackedShadowRecord = { minimumX: 0, minimumY: 0, maximumX: 7, maximumY: 1, height: 1, rowBytes: 1, bits: Uint8Array.from([0xff]) };
    expect(() => filterPackedShadowMask(record, shadowPatterns)).toThrow(RangeError);
  });
});
