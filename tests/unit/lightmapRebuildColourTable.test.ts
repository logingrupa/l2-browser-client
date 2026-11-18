import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addLightColourTableToPixels, buildLightColourTable, ceilLogTwo } from "../../src/environment/model/lightmapRebuild/lightColourTable";

interface ColourTableFixture {
  readonly label: string;
  readonly controlWord: string;
  readonly colourRGB: readonly [red: number, green: number, blue: number];
  readonly inputMaskBytesHex: string;
  readonly outputBgraBytesHex: string;
}

interface CeilLogFixture {
  readonly input: number;
  readonly returnByte: number;
}

interface ColourAddFixture {
  readonly inputBytes: readonly number[];
  readonly addBytes: readonly number[];
  readonly resultBytes: readonly number[];
}

const fixtureDirectory = new URL("../fixtures/db16/", import.meta.url);
const readFixtures = <Fixture>(fileName: string) =>
  (JSON.parse(readFileSync(new URL(fileName, fixtureDirectory), "utf8")) as { readonly fixtures: readonly Fixture[] }).fixtures;
const colourTableFixtures = readFixtures<ColourTableFixture>("colour-lut-native.json");
const ceilLogFixtures = readFixtures<CeilLogFixture>("ceil-log-native.json");
const colourAddFixtures = readFixtures<ColourAddFixture>("colour-add-native.json");
const fullRow = { minimumX: 0, minimumY: 0, maximumX: 255, maximumY: 0 };

describe("appCeilLogTwo 0x1014f800 against native runs", () => {
  it.each(ceilLogFixtures.map(fixture => [fixture.input, fixture.returnByte] as const))("returns AL %s -> %s", (input, returnByte) => {
    expect(ceilLogTwo(input)).toBe(returnByte);
  });

  it("refuses an argument that is not a uint32", () => {
    expect(() => ceilLogTwo(2 ** 32)).toThrow(RangeError);
    expect(() => ceilLogTwo(-1)).toThrow(RangeError);
  });
});

describe("light colour table 0x106712c0 accumulated over a zero lightmap against native CW 0x027f runs", () => {
  it("covers the zero, s = 31 signed shift, s = 32 masked shift and bright edges", () => {
    expect(colourTableFixtures.map(fixture => fixture.label)).toEqual(["zero", "normal", "s31", "s32", "mixed-edges", "bright", "nonpower"]);
  });

  it.each(colourTableFixtures.map(fixture => [fixture.label, fixture] as const))("writes all 1024 BGRA bytes of the %s fixture", (_label, fixture) => {
    const [red, green, blue] = fixture.colourRGB.map(channel => Math.fround(channel));
    const pixels = new Uint8Array(256 * 4);
    const intensities = Uint8Array.from(Buffer.from(fixture.inputMaskBytesHex, "hex"));
    addLightColourTableToPixels(pixels, 256, fullRow, intensities, buildLightColourTable([red!, green!, blue!, 1]));
    expect(Buffer.from(pixels).toString("hex")).toBe(fixture.outputBgraBytesHex);
  });
});

describe("saturating BGRA add 0x103316e0 through the colour table application", () => {
  it.each(colourAddFixtures.map(fixture => [fixture.inputBytes.join(","), fixture] as const))("adds %s with alpha included like the native run", (_input, fixture) => {
    const pixels = Uint8Array.from(fixture.inputBytes);
    const colourTable = new Uint8Array(256 * 4);
    colourTable.set(fixture.addBytes, 7 * 4);
    addLightColourTableToPixels(pixels, 1, { minimumX: 0, minimumY: 0, maximumX: 0, maximumY: 0 }, Uint8Array.from([7]), colourTable);
    expect(Array.from(pixels)).toEqual(fixture.resultBytes);
  });

  it("adds the rectangle with the record stride into the lightmap stride and leaves other texels alone", () => {
    const lightmapWidth = 4;
    const pixels = new Uint8Array(lightmapWidth * 3 * 4).fill(10);
    addLightColourTableToPixels(pixels, lightmapWidth, { minimumX: 1, minimumY: 1, maximumX: 2, maximumY: 2 }, Uint8Array.from([1, 2, 3, 250]), buildLightColourTable([1, 1, 1, 0]));
    const texel = (x: number, y: number) => Array.from(pixels.subarray((y * lightmapWidth + x) * 4, (y * lightmapWidth + x) * 4 + 4));
    expect(texel(0, 0)).toEqual([10, 10, 10, 10]);
    expect(texel(1, 1)).toEqual([11, 11, 11, 255]);
    expect(texel(2, 1)).toEqual([12, 12, 12, 255]);
    expect(texel(1, 2)).toEqual([13, 13, 13, 255]);
    expect(texel(2, 2)).toEqual([255, 255, 255, 255]);
    expect(texel(3, 2)).toEqual([10, 10, 10, 10]);
  });
});
