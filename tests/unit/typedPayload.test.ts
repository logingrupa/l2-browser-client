import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readTypedPayload, TypedPayloadError } from "../../src/shared/typedPayload";
import { goldenTypedPayloadArrays, goldenTypedPayloadMetadata, writeTypedPayloadFixture, type TypedPayloadFixtureAssetRecord } from "../support/typedPayloadFixture";

const goldenDirectory = new URL("../fixtures/typed-payload/", import.meta.url);
const committedAssetRecord = JSON.parse(readFileSync(new URL("asset.json", goldenDirectory), "utf8")) as TypedPayloadFixtureAssetRecord;
const committedPayloadBytes = new Uint8Array(readFileSync(new URL("payload.bin", goldenDirectory)));

function goldenFixture() {
  return writeTypedPayloadFixture(goldenTypedPayloadArrays, goldenTypedPayloadMetadata);
}

function assetRecordWith(change: (record: TypedPayloadFixtureAssetRecord) => void): TypedPayloadFixtureAssetRecord {
  const record = structuredClone(goldenFixture().assetRecord);
  change(record);
  return record;
}

function refusalMessage(assetRecord: unknown, payloadBytes: Uint8Array = goldenFixture().payloadBytes): string {
  try {
    readTypedPayload(assetRecord, payloadBytes);
  } catch (error) {
    expect(error).toBeInstanceOf(TypedPayloadError);
    return (error as TypedPayloadError).message;
  }
  throw new Error("readTypedPayload accepted a malformed payload");
}

describe("typed payload golden", () => {
  it("is exactly what the fixture writer produces", () => {
    const fixture = goldenFixture();
    expect(committedAssetRecord).toEqual(fixture.assetRecord);
    expect([...committedPayloadBytes]).toEqual([...fixture.payloadBytes]);
  });

  it("reads back every array value for value", () => {
    const payload = readTypedPayload(committedAssetRecord, committedPayloadBytes);
    expect(payload.units).toBe("source");
    expect(payload.axes).toBe("ue2-z-up");
    expect(payload.sourceSha256).toBe(goldenTypedPayloadMetadata.sourceSha256);
    expect(payload.converterVersion).toBe(goldenTypedPayloadMetadata.converterVersion);
    expect(payload.names()).toEqual(["TEST.positions", "TEST.indices", "TEST.flags", "TEST.bytes"]);
    expect([...payload.float32("TEST.positions")]).toEqual([1.5, -2.25, Math.fround(0.1), 3.4028234663852886e38, -0]);
    expect(Object.is(payload.float32("TEST.positions")[4], -0)).toBe(true);
    expect([...payload.int32("TEST.indices")]).toEqual([-1, 0, 2147483647, -2147483648]);
    expect([...payload.uint32("TEST.flags")]).toEqual([0, 1, 4294967295]);
    expect([...payload.uint8("TEST.bytes")]).toEqual([1, 2, 255]);
  });

  it("returns views over the given bytes without copying them", () => {
    const payloadBytes = goldenFixture().payloadBytes;
    const flags = readTypedPayload(goldenFixture().assetRecord, payloadBytes).uint32("TEST.flags");
    expect(flags.buffer).toBe(payloadBytes.buffer);
  });

  it("reads a payload that sits at an aligned offset inside a larger buffer", () => {
    const fixture = goldenFixture();
    const largerBuffer = new Uint8Array(fixture.payloadBytes.byteLength + 8);
    largerBuffer.set(fixture.payloadBytes, 4);
    const payload = readTypedPayload(fixture.assetRecord, largerBuffer.subarray(4, 4 + fixture.payloadBytes.byteLength));
    expect([...payload.int32("TEST.indices")]).toEqual([-1, 0, 2147483647, -2147483648]);
  });
});

describe("typed payload refusals", () => {
  it("refuses units other than source", () => {
    expect(refusalMessage(assetRecordWith(record => { record.units = "metres"; }))).toContain("units");
  });

  it("refuses axes other than ue2-z-up", () => {
    expect(refusalMessage(assetRecordWith(record => { record.axes = "babylon-y-up"; }))).toContain("axes");
  });

  it("refuses a source SHA-256 that is not 64 lowercase hex digits", () => {
    expect(refusalMessage(assetRecordWith(record => { record.sourceSha256 = "ABC"; }))).toContain("sourceSha256");
  });

  it("refuses an empty converter version", () => {
    expect(refusalMessage(assetRecordWith(record => { record.converterVersion = ""; }))).toContain("converterVersion");
  });

  it("refuses a record that is not an object", () => {
    expect(refusalMessage(null)).toContain("asset.json");
  });

  it("refuses a misaligned offset and names the array", () => {
    const message = refusalMessage(assetRecordWith(record => { record.arrays[1]!.byteOffset = 22; }));
    expect(message).toContain("TEST.indices");
    expect(message).toContain("aligned");
  });

  it("refuses an array that runs past the payload and names it", () => {
    const fixture = goldenFixture();
    const message = refusalMessage(fixture.assetRecord, fixture.payloadBytes.subarray(0, 40));
    expect(message).toContain("TEST.flags");
  });

  it("refuses a count that disagrees with byteLength and names the array", () => {
    const message = refusalMessage(assetRecordWith(record => { record.arrays[0]!.count = 4; }));
    expect(message).toContain("TEST.positions");
    expect(message).toContain("count");
  });

  it("refuses an unknown type and names the array", () => {
    const message = refusalMessage(assetRecordWith(record => { (record.arrays[2] as { type: string }).type = "float64"; }));
    expect(message).toContain("TEST.flags");
    expect(message).toContain("float64");
  });

  it("refuses a repeated name", () => {
    expect(refusalMessage(assetRecordWith(record => { record.arrays[1]!.name = "TEST.positions"; }))).toContain("TEST.positions");
  });

  it("refuses a name outside the four-letter group pattern", () => {
    expect(refusalMessage(assetRecordWith(record => { record.arrays[3]!.name = "bytes"; }))).toContain("bytes");
  });

  it("refuses a gap between arrays", () => {
    const message = refusalMessage(assetRecordWith(record => { record.arrays[3]!.byteOffset = 52; }), new Uint8Array(56));
    expect(message).toContain("TEST.bytes");
  });

  it("refuses trailing bytes after the last array", () => {
    const fixture = goldenFixture();
    expect(refusalMessage(fixture.assetRecord, new Uint8Array(fixture.payloadBytes.byteLength + 4))).toContain("payload");
  });

  it("refuses non-zero padding after an unaligned array", () => {
    const payloadBytes = goldenFixture().payloadBytes.slice();
    payloadBytes[51] = 7;
    expect(refusalMessage(goldenFixture().assetRecord, payloadBytes)).toContain("TEST.bytes");
  });

  it("refuses a payload whose start is not four-byte aligned", () => {
    const fixture = goldenFixture();
    const shiftedBuffer = new Uint8Array(fixture.payloadBytes.byteLength + 1);
    shiftedBuffer.set(fixture.payloadBytes, 1);
    expect(refusalMessage(fixture.assetRecord, shiftedBuffer.subarray(1))).toContain("payload");
  });

  it("refuses to read an array as the wrong type or under a missing name", () => {
    const payload = readTypedPayload(committedAssetRecord, committedPayloadBytes);
    expect(() => payload.float32("TEST.indices")).toThrow(TypedPayloadError);
    expect(() => payload.uint8("TEST.missing")).toThrow(/TEST\.missing/);
  });
});
