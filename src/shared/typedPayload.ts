export type TypedPayloadArrayType = "float32" | "int32" | "uint32" | "uint8";

export class TypedPayloadError extends Error {
  constructor(message: string) {
    super(`Typed payload: ${message}`);
    this.name = "TypedPayloadError";
  }
}

export interface TypedPayload {
  readonly units: "source";
  readonly axes: "ue2-z-up";
  readonly sourceSha256: string;
  readonly converterVersion: string;
  names(): string[];
  float32(name: string): Float32Array;
  int32(name: string): Int32Array;
  uint32(name: string): Uint32Array;
  uint8(name: string): Uint8Array;
}

interface TypedPayloadArrayRecord {
  readonly name: string;
  readonly type: TypedPayloadArrayType;
  readonly count: number;
  readonly byteOffset: number;
  readonly byteLength: number;
}

type TypedPayloadView = Float32Array | Int32Array | Uint32Array | Uint8Array;

const bytesPerElementByType: Readonly<Record<TypedPayloadArrayType, number>> = { float32: 4, int32: 4, uint32: 4, uint8: 1 };
const arrayNamePattern = /^[A-Z]{4}\.[a-z][A-Za-z0-9]*$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const payloadAlignment = 4;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isArrayType = (value: unknown): value is TypedPayloadArrayType => typeof value === "string" && Object.hasOwn(bytesPerElementByType, value);
const isNonNegativeSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const alignToPayload = (byteCount: number) => Math.ceil(byteCount / payloadAlignment) * payloadAlignment;
const hostIsLittleEndian = new DataView(new Uint16Array([1]).buffer).getUint8(0) === 1;

function requirePayload(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TypedPayloadError(message);
}

function readArrayRecord(value: unknown, arrayIndex: number): TypedPayloadArrayRecord {
  requirePayload(isRecord(value), `asset.json arrays[${arrayIndex}] is not an object.`);
  const { name, type, count, byteOffset, byteLength } = value;
  requirePayload(typeof name === "string" && arrayNamePattern.test(name),
    `asset.json arrays[${arrayIndex}] name ${JSON.stringify(name)} does not match <GROUP>.<field> with a four-letter group.`);
  requirePayload(isArrayType(type), `array ${name} has unknown type ${JSON.stringify(type)}.`);
  requirePayload(isNonNegativeSafeInteger(count), `array ${name} count must be a non-negative integer.`);
  requirePayload(isNonNegativeSafeInteger(byteOffset), `array ${name} byteOffset must be a non-negative integer.`);
  requirePayload(isNonNegativeSafeInteger(byteLength), `array ${name} byteLength must be a non-negative integer.`);
  requirePayload(byteOffset % payloadAlignment === 0, `array ${name} byteOffset ${byteOffset} is not ${payloadAlignment}-byte aligned.`);
  requirePayload(count * bytesPerElementByType[type] === byteLength,
    `array ${name} count ${count} disagrees with byteLength ${byteLength} for type ${type}.`);
  return { name, type, count, byteOffset, byteLength };
}

function readArrayRecords(arrays: unknown, payloadBytes: Uint8Array): TypedPayloadArrayRecord[] {
  requirePayload(Array.isArray(arrays), "asset.json arrays must be a list.");
  const records = arrays.map(readArrayRecord);
  const seenNames = new Set<string>();
  let expectedByteOffset = 0;
  for (const record of records) {
    requirePayload(!seenNames.has(record.name), `array ${record.name} is listed more than once.`);
    seenNames.add(record.name);
    requirePayload(record.byteOffset === expectedByteOffset,
      `array ${record.name} starts at byte ${record.byteOffset}; the container layout puts it at ${expectedByteOffset}.`);
    const arrayEnd = record.byteOffset + record.byteLength;
    requirePayload(arrayEnd <= payloadBytes.byteLength,
      `array ${record.name} ends at byte ${arrayEnd}, past the ${payloadBytes.byteLength}-byte payload.`);
    expectedByteOffset = alignToPayload(arrayEnd);
    requirePayload(expectedByteOffset <= payloadBytes.byteLength && payloadBytes.subarray(arrayEnd, expectedByteOffset).every(byte => byte === 0),
      `array ${record.name} is not followed by zero padding to the next ${payloadAlignment}-byte boundary.`);
  }
  requirePayload(expectedByteOffset === payloadBytes.byteLength,
    `payload holds ${payloadBytes.byteLength} bytes but its arrays end at byte ${expectedByteOffset}.`);
  return records;
}

function createView(record: TypedPayloadArrayRecord, payloadBytes: Uint8Array): TypedPayloadView {
  const absoluteByteOffset = payloadBytes.byteOffset + record.byteOffset;
  if (record.type === "float32") return new Float32Array(payloadBytes.buffer, absoluteByteOffset, record.count);
  if (record.type === "int32") return new Int32Array(payloadBytes.buffer, absoluteByteOffset, record.count);
  if (record.type === "uint32") return new Uint32Array(payloadBytes.buffer, absoluteByteOffset, record.count);
  return new Uint8Array(payloadBytes.buffer, absoluteByteOffset, record.count);
}

export function readTypedPayload(assetJson: unknown, payloadBytes: Uint8Array): TypedPayload {
  requirePayload(hostIsLittleEndian, "this host is big-endian; the payload is little-endian.");
  requirePayload(isRecord(assetJson), "asset.json must be an object.");
  const { units, axes, sourceSha256, converterVersion, arrays } = assetJson;
  requirePayload(units === "source", `asset.json units must be "source", not ${JSON.stringify(units)}.`);
  requirePayload(axes === "ue2-z-up", `asset.json axes must be "ue2-z-up", not ${JSON.stringify(axes)}.`);
  requirePayload(typeof sourceSha256 === "string" && sha256Pattern.test(sourceSha256), "asset.json sourceSha256 must be 64 lowercase hex digits.");
  requirePayload(typeof converterVersion === "string" && converterVersion.length > 0, "asset.json converterVersion must be a non-empty string.");
  requirePayload(payloadBytes.byteOffset % payloadAlignment === 0, `payload must start on a ${payloadAlignment}-byte boundary of its buffer.`);
  const records = readArrayRecords(arrays, payloadBytes);
  const viewsByName = new Map(records.map(record => [record.name, { type: record.type, view: createView(record, payloadBytes) }]));
  const viewOfType = (name: string, type: TypedPayloadArrayType): TypedPayloadView => {
    const entry = viewsByName.get(name);
    requirePayload(entry !== undefined, `array ${name} is not in the payload.`);
    requirePayload(entry.type === type, `array ${name} is ${entry.type}, not ${type}.`);
    return entry.view;
  };
  return {
    units, axes, sourceSha256, converterVersion,
    names: () => records.map(record => record.name),
    float32: name => viewOfType(name, "float32") as Float32Array,
    int32: name => viewOfType(name, "int32") as Int32Array,
    uint32: name => viewOfType(name, "uint32") as Uint32Array,
    uint8: name => viewOfType(name, "uint8") as Uint8Array,
  };
}
