import { describe, expect, it } from "vitest";
import { readServedTileManifests, servedTileManifestSha256 } from "../browser/support/servedTileCatalog";

const catalogUrl = "http://127.0.0.1:5173/l2/catalog.json";
const firstManifestSha256 = "1".repeat(64);
const secondManifestSha256 = "2".repeat(64);

function tileRecord(id: string, manifestSha256: string): Record<string, unknown> {
  return { id, manifest: `/l2/tiles/${manifestSha256}/tile.json`, manifestBytes: 8706, manifestSha256 };
}

describe("served tile manifests read once per load sweep slice", () => {
  it("maps every served tile id to its manifest SHA-256", () => {
    const servedTileManifests = readServedTileManifests({ tiles: [tileRecord("15_20", firstManifestSha256), tileRecord("20_20", secondManifestSha256)] }, catalogUrl);
    expect(servedTileManifestSha256(servedTileManifests, "15_20")).toBe(firstManifestSha256);
    expect(servedTileManifestSha256(servedTileManifests, "20_20")).toBe(secondManifestSha256);
  });

  it("refuses a served catalog without a tiles list", () => {
    expect(() => readServedTileManifests({ windows: [] }, catalogUrl)).toThrow(`served catalog ${catalogUrl} has no tiles list`);
    expect(() => readServedTileManifests(null, catalogUrl)).toThrow("has no tiles list");
  });

  it("refuses a tiles record that is not a pinned manifest record", () => {
    expect(() => readServedTileManifests({ tiles: [{ id: "15_20" }] }, catalogUrl)).toThrow();
  });

  it("refuses a tile the served catalog does not list", () => {
    const servedTileManifests = readServedTileManifests({ tiles: [tileRecord("15_20", firstManifestSha256)] }, catalogUrl);
    expect(() => servedTileManifestSha256(servedTileManifests, "16_10")).toThrow(`served catalog ${catalogUrl} has no tiles record 16_10`);
  });
});
