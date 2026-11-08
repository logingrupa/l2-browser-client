import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface GoldenTrace {
  readonly seed: number;
  readonly stepSeconds: number;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly number[])[];
}

export interface Float32UlpComparison {
  readonly largestUlpDistance: number;
  readonly firstIndexPastLimit: number | null;
}

const float32Bits = new Float32Array(1);
const float32BitsAsInteger = new Int32Array(float32Bits.buffer);
const signBit = 0x80000000;

function requireTraceShape(trace: GoldenTrace, label: string): void {
  if (!Number.isSafeInteger(trace.seed) || trace.seed < 0) throw new Error(`${label}: seed must be a non-negative integer.`);
  if (!Number.isFinite(trace.stepSeconds) || trace.stepSeconds <= 0) throw new Error(`${label}: stepSeconds must be positive.`);
  if (!Array.isArray(trace.columns) || trace.columns.length === 0 || !trace.columns.every(column => typeof column === "string")) {
    throw new Error(`${label}: columns must be a non-empty list of names.`);
  }
  if (!Array.isArray(trace.rows)) throw new Error(`${label}: rows must be a list.`);
  trace.rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== trace.columns.length || !row.every(Number.isFinite)) {
      throw new Error(`${label}: row ${rowIndex} must hold ${trace.columns.length} finite numbers.`);
    }
  });
}

export function writeGoldenTrace(filePath: string, trace: GoldenTrace): void {
  requireTraceShape(trace, `Golden trace ${filePath}`);
  const float32Trace: GoldenTrace = { ...trace, rows: trace.rows.map(row => row.map(value => Math.fround(value))) };
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(float32Trace, null, 2)}\n`);
}

export function readGoldenTrace(filePath: string): GoldenTrace {
  const trace = JSON.parse(readFileSync(filePath, "utf8")) as GoldenTrace;
  requireTraceShape(trace, `Golden trace ${filePath}`);
  return trace;
}

function orderedFloat32Integer(value: number): number {
  if (Number.isNaN(value)) throw new RangeError("A float32 ulp comparison cannot measure NaN.");
  float32Bits[0] = value;
  const bits = float32BitsAsInteger[0]!;
  return bits < 0 ? -(bits ^ signBit) : bits;
}

export function compareFloat32ByUlp(expected: ArrayLike<number>, actual: ArrayLike<number>, limitUlps: number): Float32UlpComparison {
  if (expected.length !== actual.length) throw new RangeError(`Expected ${expected.length} float32 values, received ${actual.length}.`);
  let largestUlpDistance = 0;
  let firstIndexPastLimit: number | null = null;
  for (let index = 0; index < expected.length; index += 1) {
    const ulpDistance = Math.abs(orderedFloat32Integer(expected[index]!) - orderedFloat32Integer(actual[index]!));
    largestUlpDistance = Math.max(largestUlpDistance, ulpDistance);
    if (firstIndexPastLimit === null && ulpDistance > limitUlps) firstIndexPastLimit = index;
  }
  return { largestUlpDistance, firstIndexPastLimit };
}
