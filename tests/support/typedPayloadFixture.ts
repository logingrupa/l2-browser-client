export type TypedPayloadFixtureArrayType = "float32" | "int32" | "uint32" | "uint8";

export interface TypedPayloadFixtureArray {
  readonly name: string;
  readonly type: TypedPayloadFixtureArrayType;
  readonly values: readonly number[];
}

export interface TypedPayloadFixtureMetadata {
  readonly sourceSha256: string;
  readonly converterVersion: string;
}

export interface TypedPayloadFixtureArrayRecord {
  name: string;
  type: TypedPayloadFixtureArrayType;
  count: number;
  byteOffset: number;
  byteLength: number;
}

export interface TypedPayloadFixtureAssetRecord {
  units: string;
  axes: string;
  sourceSha256: string;
  converterVersion: string;
  arrays: TypedPayloadFixtureArrayRecord[];
}

export interface TypedPayloadFixture {
  readonly assetRecord: TypedPayloadFixtureAssetRecord;
  readonly assetJsonText: string;
  readonly payloadBytes: Uint8Array;
}

const bytesPerElementByType: Record<TypedPayloadFixtureArrayType, number> = { float32: 4, int32: 4, uint32: 4, uint8: 1 };

export const goldenTypedPayloadMetadata: TypedPayloadFixtureMetadata = {
  sourceSha256: "0123456789abcdef".repeat(4),
  converterVersion: "typed-payload-fixture-1",
};

export const goldenTypedPayloadArrays: readonly TypedPayloadFixtureArray[] = [
  { name: "TEST.positions", type: "float32", values: [1.5, -2.25, 0.1, 3.4028234663852886e38, -0] },
  { name: "TEST.indices", type: "int32", values: [-1, 0, 2147483647, -2147483648] },
  { name: "TEST.flags", type: "uint32", values: [0, 1, 4294967295] },
  { name: "TEST.bytes", type: "uint8", values: [1, 2, 255] },
];

const alignToFourBytes = (byteCount: number) => Math.ceil(byteCount / 4) * 4;

export function writeTypedPayloadFixture(arrays: readonly TypedPayloadFixtureArray[], metadata: TypedPayloadFixtureMetadata): TypedPayloadFixture {
  const arrayRecords: TypedPayloadFixtureArrayRecord[] = [];
  let nextByteOffset = 0;
  for (const array of arrays) {
    const byteLength = array.values.length * bytesPerElementByType[array.type];
    arrayRecords.push({ name: array.name, type: array.type, count: array.values.length, byteOffset: nextByteOffset, byteLength });
    nextByteOffset = alignToFourBytes(nextByteOffset + byteLength);
  }
  const payloadBytes = new Uint8Array(nextByteOffset);
  const payloadView = new DataView(payloadBytes.buffer);
  arrays.forEach((array, arrayIndex) => {
    const { byteOffset } = arrayRecords[arrayIndex]!;
    array.values.forEach((value, valueIndex) => {
      const elementOffset = byteOffset + valueIndex * bytesPerElementByType[array.type];
      if (array.type === "float32") payloadView.setFloat32(elementOffset, value, true);
      else if (array.type === "int32") payloadView.setInt32(elementOffset, value, true);
      else if (array.type === "uint32") payloadView.setUint32(elementOffset, value, true);
      else payloadView.setUint8(elementOffset, value);
    });
  });
  const assetRecord: TypedPayloadFixtureAssetRecord = {
    units: "source",
    axes: "ue2-z-up",
    sourceSha256: metadata.sourceSha256,
    converterVersion: metadata.converterVersion,
    arrays: arrayRecords,
  };
  return { assetRecord, assetJsonText: `${JSON.stringify(assetRecord, null, 2)}\n`, payloadBytes };
}
