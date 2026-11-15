import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareFloat32ByUlp, readGoldenTrace, writeGoldenTrace } from "../support/goldenTrace";

const temporaryDirectories: string[] = [];

function temporaryTracePath() {
  const directory = mkdtempSync(path.join(tmpdir(), "golden-trace-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "nested", "trace.json");
}

function nextFloat32Up(value: number, steps: number) {
  const bits = new Float32Array([value]);
  const integerView = new Int32Array(bits.buffer);
  integerView[0] = integerView[0]! + steps;
  return bits[0]!;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("golden trace files", () => {
  it("writes a trace at its declared seed and step with float32 values and reads it back", () => {
    const tracePath = temporaryTracePath();
    writeGoldenTrace(tracePath, { seed: 1667376744, stepSeconds: 1 / 60, columns: ["x", "y"], rows: [[0.1, -2], [1 / 3, 1e10]] });
    const trace = readGoldenTrace(tracePath);
    expect(trace.seed).toBe(1667376744);
    expect(trace.stepSeconds).toBe(1 / 60);
    expect(trace.columns).toEqual(["x", "y"]);
    expect(trace.rows).toEqual([[Math.fround(0.1), -2], [Math.fround(1 / 3), Math.fround(1e10)]]);
    expect(readFileSync(tracePath, "utf8").endsWith("}\n")).toBe(true);
  });

  it("refuses a trace without a declared seed, a positive step or rows matching its columns", () => {
    const tracePath = temporaryTracePath();
    expect(() => writeGoldenTrace(tracePath, { seed: -1, stepSeconds: 1 / 60, columns: ["x"], rows: [] })).toThrow(/seed/);
    expect(() => writeGoldenTrace(tracePath, { seed: 1, stepSeconds: 0, columns: ["x"], rows: [] })).toThrow(/stepSeconds/);
    expect(() => writeGoldenTrace(tracePath, { seed: 1, stepSeconds: 1, columns: ["x", "y"], rows: [[1]] })).toThrow(/row 0/);
    expect(() => writeGoldenTrace(tracePath, { seed: 1, stepSeconds: 1, columns: ["x"], rows: [[Number.NaN]] })).toThrow(/row 0/);
  });
});

describe("float32 ulp comparison", () => {
  it("reports the largest ulp distance and the first index past the limit", () => {
    const expected = [1, -2.5, 0, 1000, 3];
    const actual = [nextFloat32Up(1, 1), nextFloat32Up(-2.5, 4), 0, nextFloat32Up(1000, 3), nextFloat32Up(3, 7)];
    expect(compareFloat32ByUlp(expected, actual, 3)).toEqual({ largestUlpDistance: 7, firstIndexPastLimit: 1 });
    expect(compareFloat32ByUlp(expected, actual, 7)).toEqual({ largestUlpDistance: 7, firstIndexPastLimit: null });
  });

  it("counts across zero and treats signed zeros as equal", () => {
    const smallestPositive = nextFloat32Up(0, 1);
    expect(compareFloat32ByUlp([-0], [0], 0)).toEqual({ largestUlpDistance: 0, firstIndexPastLimit: null });
    expect(compareFloat32ByUlp([-smallestPositive], [smallestPositive], 1)).toEqual({ largestUlpDistance: 2, firstIndexPastLimit: 0 });
  });

  it("compares float32 rounding, not float64 bits", () => {
    expect(compareFloat32ByUlp(new Float32Array([0.1]), [0.1], 0).largestUlpDistance).toBe(0);
  });

  it("refuses different lengths and NaN", () => {
    expect(() => compareFloat32ByUlp([1, 2], [1], 0)).toThrow(RangeError);
    expect(() => compareFloat32ByUlp([Number.NaN], [1], 0)).toThrow(RangeError);
  });
});
