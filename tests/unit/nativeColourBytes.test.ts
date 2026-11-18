import { describe, expect, it } from "vitest";
import { fColorFromPlane, saturatingAddBgra } from "../../src/environment/model/nativeColourBytes";
import { floorToInt32, lowByte, truncateToInt32, truncateToInt64LowDword } from "../../src/environment/model/x87IntegerConversion";

describe("x87 integer conversion (FISTP under chop, _ftol2, appFloor)", () => {
  it("truncates toward zero inside the int32 range", () => {
    expect([2.9, -2.9, 0.5, -0.5].map(truncateToInt32)).toEqual([2, -2, 0, -0]);
    expect(floorToInt32(-0.5)).toBe(-1);
  });

  it("gives the integer indefinite 0x80000000 for NaN and values past int32", () => {
    expect([Number.NaN, 2 ** 31, -(2 ** 31) - 1, Number.POSITIVE_INFINITY].map(truncateToInt32)).toEqual(Array(4).fill(-0x80000000));
    expect(truncateToInt32(-(2 ** 31))).toBe(-0x80000000);
  });

  it("keeps the low byte the way mov al stores it", () => {
    expect([-16, 256 + 7, 255].map(lowByte)).toEqual([240, 7, 255]);
  });

  it("keeps the unsigned low dword of a chopped fistp qword", () => {
    expect([2.9, -2.9, -1, 2 ** 32 + 5, -(2 ** 32) - 1].map(truncateToInt64LowDword)).toEqual([2, 0xfffffffe, 0xffffffff, 5, 0xffffffff]);
  });

  it("gives the int64 indefinite low dword 0 for NaN and values past int64", () => {
    expect([Number.NaN, 2 ** 63, -(2 ** 64), Number.NEGATIVE_INFINITY].map(truncateToInt64LowDword)).toEqual([0, 0, 0, 0]);
  });
});

describe("FColor(FPlane) 0x10373aa0 and FColor += 0x103316e0", () => {
  it("writes B from Z, G from Y, R from X and A from W with floor(float32(channel * 255))", () => {
    expect(fColorFromPlane([0.1, 0.2, 0.3, 0.4])).toEqual([Math.floor(Math.fround(0.3 * 255)), Math.floor(Math.fround(0.2 * 255)),
      Math.floor(Math.fround(0.1 * 255)), Math.floor(Math.fround(0.4 * 255))]);
    expect(fColorFromPlane([0.5, 0, 0, 0])).toEqual([0, 0, 127, 0]);
  });

  it("clamps to 0..255, so negative, NaN and overflowing channels give 0 and large ones 255", () => {
    expect(fColorFromPlane([-0.01, 1.5, Number.NaN, 1e20])).toEqual([0, 255, 0, 0]);
  });

  it("saturates every byte, alpha included, at 255", () => {
    expect(saturatingAddBgra([200, 10, 255, 255], [100, 20, 1, 255])).toEqual([255, 30, 255, 255]);
  });
});
