import { describe, expect, it } from "vitest";
import { fGetHsv } from "../../src/environment/model/fGetHsv";
import {
  sampleTimeColour, sampleTimeHsv, sampleTimeScale, shadowMapIndexAtHour, terrainIntensityMapBlend, type NativeTimeColourRow,
} from "../../src/environment/model/sampleNativeTimeTables";

const reaBoundaryTable: readonly NativeTimeColourRow[] = [{ time: 0, red: 10, green: 20, blue: 30 }, { time: 24, red: 110, green: 120, blue: 130 }];

describe("GetColor 0x10514e70", () => {
  it.each([[0, [10, 20, 30]], [12, [60, 70, 80]]])("reproduces the REA boundary fixture at hour %s", (hour, expected) => {
    expect(sampleTimeColour(reaBoundaryTable, hour)).toEqual(expected);
  });

  it.each([24, -1, Number.NaN])("leaves the output unchanged at hour %s instead of wrapping or clamping", hour => {
    expect(sampleTimeColour(reaBoundaryTable, hour)).toBeNull();
  });

  it("leaves the output unchanged for a one-row table", () => {
    expect(sampleTimeColour([{ time: 0, red: 255, green: 5, blue: 5 }], 0)).toBeNull();
  });

  it("takes the first bracket and truncates the float32 weighted byte", () => {
    const rows: readonly NativeTimeColourRow[] = [{ time: 0, red: 0, green: 255, blue: 7 }, { time: 3, red: 100, green: 0, blue: 8 },
      { time: 3, red: 1, green: 1, blue: 1 }, { time: 6, red: 2, green: 2, blue: 2 }];
    const weight = Math.fround(1 / 3);
    expect(sampleTimeColour(rows, 1)).toEqual([Math.trunc(100 * weight), Math.trunc(255 - 255 * weight), Math.trunc(7 + weight)]);
    expect(sampleTimeColour(rows, 3)).toEqual([1, 1, 1]);
  });
});

describe("GetColorPlane 0x105151c0 with FGetHSV 0x1073e690", () => {
  it("returns white light scaled by brightness for saturation 255 and keeps W = Bri / 255", () => {
    const plane = sampleTimeHsv([{ time: 0, hue: 0, saturation: 255, brightness: 160 }, { time: 24, hue: 85, saturation: 255, brightness: 160 }], 12);
    const brightness = fGetHsv(0, 255, 255)[0];
    const scale = Math.fround(160 / 255);
    expect(plane).toEqual([Math.fround(brightness * scale), Math.fround(brightness * scale), Math.fround(brightness * scale), scale]);
  });

  it("leaves the plane unchanged outside the table", () => {
    expect(sampleTimeHsv([{ time: 6, hue: 0, saturation: 0, brightness: 1 }, { time: 7, hue: 0, saturation: 0, brightness: 1 }], 5)).toBeNull();
  });

  it("splits hue into three 85-wide segments with the last divided by 84", () => {
    const brightness = fGetHsv(0, 255, 255)[0];
    expect(fGetHsv(0, 0, 255)).toEqual([brightness, 0, 0, 1]);
    expect(fGetHsv(85, 0, 255)).toEqual([0, brightness, 0, 1]);
    expect(fGetHsv(170, 0, 255)).toEqual([0, 0, brightness, 1]);
    expect(fGetHsv(255, 0, 255)).toEqual([brightness, 0, 0, 1]);
  });

  it("clamps the brightness curve at 1 and gives 0 for value 0", () => {
    expect(fGetHsv(0, 255, 0)).toEqual([0, 0, 0, 1]);
    expect(fGetHsv(0, 255, 255)[0]).toBeLessThan(1);
  });
});

describe("GetScale 0x10515590", () => {
  const moonScale = [{ time: 0, scale: 4.5 }, { time: 3, scale: 3 }, { time: 6, scale: 1.5 }];

  it("interpolates inside the table with a float32 weight", () => {
    expect(sampleTimeScale(moonScale, 1)).toEqual({ status: "sampled", value: Math.fround((3 - 4.5) * Math.fround(1 / 3) + 4.5) });
  });

  it("reports a read past the last row as unresolved instead of clamping", () => {
    expect(sampleTimeScale(moonScale, 6)).toEqual({ status: "unresolved", reason: "time-scale-read-past-table" });
    expect(sampleTimeScale(moonScale, 18)).toEqual({ status: "unresolved", reason: "time-scale-read-past-table" });
  });

  it("leaves the output unwritten before the first row", () => {
    expect(sampleTimeScale([{ time: 6, scale: 2 }, { time: 24, scale: 1 }], 0)).toEqual({ status: "unwritten" });
  });
});

describe("terrain intensity maps (GetShadowMapIndex 0x1071de70, UpdateShadow 0x107303f0)", () => {
  it("normalises the hour into [0, 24) and falls back to the last map", () => {
    expect(shadowMapIndexAtHour([0, 6, 12, 18], -1)).toBe(3);
    expect(shadowMapIndexAtHour([0, 6, 12, 18], 25)).toBe(0);
    expect(shadowMapIndexAtHour([0, 6, 12, 18], 30)).toBe(1);
    expect(shadowMapIndexAtHour([6, 18], 1)).toBe(1);
  });

  it("unwraps the next map and the hour by 24 before weighing", () => {
    expect(terrainIntensityMapBlend([0, 6, 12, 18], 21)).toEqual({ index: 3, nextIndex: 0, weight: 0.5 });
    expect(terrainIntensityMapBlend([6, 18], 1)).toEqual({ index: 1, nextIndex: 0, weight: Math.fround(7 / 12) });
  });

  it("rejects an empty map list", () => {
    expect(() => terrainIntensityMapBlend([], 1)).toThrow(RangeError);
  });
});
