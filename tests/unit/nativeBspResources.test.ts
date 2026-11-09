import { describe, expect, it } from "vitest";
import { parseNativeBspSectionExtras, parseNativeTileBspResource } from "../../src/scene/world/nativeBspResources";
import { parseNativeTileChunkManifest } from "../../src/scene/world/nativeTileChunkManifest";
import { decodeJsonDocument, readFixtureTileFiles } from "../support/nativeTileFixtureStore";

type Document = Record<string, unknown>;

const sha256 = "c".repeat(64);
const resource = `/l2/maps/${sha256}/native-tile-chunk-bsp/bsp.glb`;

function section(primitive: number, overrides: Document = {}): Document {
  return { primitive, material: "Fixture_T.Floor", unlit: false, lightmap: -1, outdoor: true, translucent: false, ...overrides };
}

function extras(overrides: Document = {}): Document {
  return {
    nativeBspChunk: "chunk-0-0",
    nativeBspSections: [section(0), section(1, { unlit: true, lightmap: null })],
    nativeBspNodeRanges: [
      { node: 4, primitive: 0, firstIndex: 0, indexCount: 6 }, { node: 9, primitive: 0, firstIndex: 6, indexCount: 3 },
      { node: 2, primitive: 1, firstIndex: 0, indexCount: 6 }],
    ...overrides,
  };
}

describe("native tile BSP resource", () => {
  it("accepts exactly a resource under its own hash folder and its SHA-256", () => {
    expect(parseNativeTileBspResource({ resource, sha256 })).toEqual({ resource, sha256 });
  });

  it.each<[string, unknown]>([
    ["a non-hash SHA-256", { resource, sha256: "C".repeat(64) }],
    ["an extra key", { resource, sha256, bytes: 10 }],
    ["a missing key", { resource }],
    ["a path outside /l2/", { resource: `/assets/maps/${sha256}/native-tile-chunk-bsp/bsp.glb`, sha256 }],
    ["a path whose hash differs from its pin", { resource: `/l2/maps/${"d".repeat(64)}/native-tile-chunk-bsp/bsp.glb`, sha256 }],
    ["a resource that is not an object", "bsp.glb"],
  ])("refuses %s", (_, input) => {
    expect(() => parseNativeTileBspResource(input)).toThrow(/Native tile BSP resource/);
  });

  it("is accepted by the chunk manifest parser in place of the bsp gap row", () => {
    const chunk = decodeJsonDocument(readFixtureTileFiles().chunk.bytes);
    chunk.bsp = { resource, sha256 };
    chunk.gaps = (chunk.gaps as Document[]).filter(row => row.step !== "bsp");
    expect(parseNativeTileChunkManifest(chunk).bsp).toEqual({ resource, sha256 });
  });
});

describe("native BSP section extras", () => {
  it("reads sections and contiguous node ranges", () => {
    const parsed = parseNativeBspSectionExtras(extras());
    expect(parsed.sections.map(entry => [entry.primitive, entry.unlit, entry.lightmap])).toEqual([[0, false, -1], [1, true, null]]);
    expect(parsed.nodeRanges.map(entry => entry.node)).toEqual([4, 9, 2]);
  });

  it.each<[string, Document]>([
    ["missing sections", { nativeBspSections: undefined }],
    ["no sections", { nativeBspSections: [] }],
    ["a section whose primitive differs from its position", { nativeBspSections: [section(1)] }],
    ["a section with an unknown field", { nativeBspSections: [{ ...section(0), extra: 1 }, section(1)] }],
    ["a range that points at a missing section", { nativeBspNodeRanges: [{ node: 1, primitive: 5, firstIndex: 0, indexCount: 3 }] }],
    ["a range that is not whole triangles", { nativeBspNodeRanges: [{ node: 1, primitive: 0, firstIndex: 0, indexCount: 4 }] }],
    ["a gap between node ranges", { nativeBspNodeRanges: [{ node: 1, primitive: 0, firstIndex: 0, indexCount: 3 }, { node: 2, primitive: 0, firstIndex: 6, indexCount: 3 }] }],
    ["a node split across two ranges", { nativeBspNodeRanges: [{ node: 1, primitive: 0, firstIndex: 0, indexCount: 3 }, { node: 1, primitive: 1, firstIndex: 0, indexCount: 3 }] }],
  ])("refuses %s", (_, overrides) => {
    expect(() => parseNativeBspSectionExtras(extras(overrides))).toThrow(/Native BSP/);
  });
});
