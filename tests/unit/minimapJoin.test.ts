import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeTileMinimapError, loadNativeTileMinimap, parseNativeTileMinimapManifest } from "../../src/scene/world/minimapJoin";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";

const zoneKeyArchiveSha256 = "d".repeat(64);
const packageSha256 = "b".repeat(64);
const tableSha256 = "c".repeat(64);
const routeSha256 = "e".repeat(64);
const zoneTitleReason = "minimap-join-unresolved:zone-title-source";
const radarAnchorReason = "minimap-join-unresolved:radar-anchor";

function minimapManifest(overrides: Record<string, unknown> = {}) {
  return {
    kind: "native-tile-minimap", schemaVersion: 3, tileId: "20_21",
    sourceInputs: [{ path: "systextures/l2zonename.utx", sha256: packageSha256 }, { path: "system/zonename-e.dat", sha256: tableSha256 }],
    route: { manifest: `/l2/maps/${routeSha256}/native-minimap-route/manifest.json`, manifestSha256: routeSha256, manifestBytes: 60000 },
    zoneKeyTexture: { archive: `/l2/${zoneKeyArchiveSha256}/asset.l2asset`, archiveSha256: zoneKeyArchiveSha256, archiveBytes: 2048,
      sourceObject: "l2zonename.20_21", rule: "zone-sampler-tile", source: { path: "systextures/l2zonename.utx", sha256: packageSha256, exportIndex: 93 } },
    huntingZones: [{ id: 4, name: "Cruma Marshlands", rule: "huntingzone-start-in-frame", startLocation: [5106, 126916, -3664],
      source: { table: "huntingzone", path: "system/huntingzone-e.dat", sha256: tableSha256, rowIndex: 3, field: "loc" } }],
    gaps: [{ reason: zoneTitleReason, evidence: "the ShowZoneTitle caller chain is not derived" }, { reason: radarAnchorReason, evidence: "anchor" }],
    labels: { schemaFieldMeaning: "schema field name, meaning unverified on IMPORTA" },
    ...overrides,
  };
}

describe("parseNativeTileMinimapManifest", () => {
  it("accepts schema 3 with its route pin, zone key texture, hunting zones and route gaps", () => {
    const minimap = parseNativeTileMinimapManifest(minimapManifest(), "20_21");
    expect(minimap.schemaVersion).toBe(3);
    expect(minimap.route.manifestSha256).toBe(routeSha256);
    expect(minimap.zoneKeyTexture?.rule).toBe("zone-sampler-tile");
    expect(minimap.zoneKeyTexture?.source.exportIndex).toBe(93);
    expect(minimap.huntingZones[0]?.startLocation).toEqual([5106, 126916, -3664]);
    expect(minimap.gaps.map(gap => gap.reason)).toEqual([zoneTitleReason, radarAnchorReason]);
    expect(minimap.labels.schemaFieldMeaning).toBe("schema field name, meaning unverified on IMPORTA");
    expect(Object.keys(minimap).sort()).toEqual(["gaps", "huntingZones", "kind", "labels", "route", "schemaVersion", "sourceInputs", "tileId",
      "zoneKeyTexture"]);
  });

  it("keeps a tile without a zone key texture or gaps as data", () => {
    expect(parseNativeTileMinimapManifest(minimapManifest({ zoneKeyTexture: null }), "20_21").zoneKeyTexture).toBeNull();
    expect(parseNativeTileMinimapManifest(minimapManifest({ gaps: [] }), "20_21").gaps).toEqual([]);
  });

  it("refuses schema 2, any field outside schema 3 and the other invalid fields", () => {
    const zoneKeyTexture = minimapManifest().zoneKeyTexture;
    const refusals: readonly [Record<string, unknown>, RegExp][] = [
      [{ kind: "native-tile-sky" }, /kind or schema version/],
      [{ schemaVersion: 2 }, /kind or schema version/],
      [{ unlistedField: null }, /kind or schema version/],
      [{ tileId: "20_20" }, /names another tile/],
      [{ sourceInputs: [{ path: "systextures/l2zonename.utx", sha256: "A".repeat(64) }] }, /source input/],
      [{ route: { ...minimapManifest().route, manifestSha256: "9".repeat(64) } }, /native-minimap-route\/manifest\.json/],
      [{ route: { ...minimapManifest().route, manifest: `/l2/maps/${routeSha256}/native-tile-minimap/manifest.json` } }, /native-minimap-route/],
      [{ zoneKeyTexture: { ...zoneKeyTexture, rule: "tile-id" } }, /zone key texture rule must be zone-sampler-tile/],
      [{ zoneKeyTexture: { ...zoneKeyTexture, source: { ...zoneKeyTexture.source, exportIndex: 0 } } }, /texture source/],
      [{ zoneKeyTexture: { ...zoneKeyTexture, archiveSha256: "f".repeat(64) } }, /asset\.l2asset/],
      [{ zoneKeyTexture: { ...zoneKeyTexture, archive: `/l2/../${zoneKeyArchiveSha256}/asset.l2asset` } }, /asset\.l2asset/],
      [{ gaps: [{ reason: "", evidence: "anchor" }] }, /gap must hold a reason/],
    ];
    for (const [override, message] of refusals) {
      expect(() => parseNativeTileMinimapManifest(minimapManifest(override), "20_21")).toThrow(NativeTileMinimapError);
      expect(() => parseNativeTileMinimapManifest(minimapManifest(override), "20_21")).toThrow(message);
    }
  });
});

describe("loadNativeTileMinimap", () => {
  afterEach(() => vi.unstubAllGlobals());

  function tileManifestWithMinimap(bytes: Uint8Array) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return parseNativeTileManifest({
      kind: "native-tile-runtime", schemaVersion: 1, tileId: "20_21", sourceMap: "maps/20_21.unr", sourceSha256: "e".repeat(64),
      frame: { terrainInfo: "20_21.TerrainInfo0", location: [0, 0, 0], terrainScale: [1, 1, 1] },
      anchor: { playerStart: "20_21.PlayerStart0", location: [0, 0, 0] },
      chunks: [{ chunkId: "chunk-0-0", manifest: `/l2/maps/${"1".repeat(64)}/native-tile-chunk-runtime/manifest.json`, manifestSha256: "1".repeat(64),
        manifestBytes: 100 }],
      resources: [{ kind: "minimap", manifest: `/l2/maps/${sha256}/native-tile-minimap/manifest.json`, manifestSha256: sha256, manifestBytes: bytes.byteLength }],
      gaps: [],
    });
  }

  it("fetches the minimap resource, verifies its SHA-256 and parses it", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(minimapManifest()));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
    const minimap = await loadNativeTileMinimap(tileManifestWithMinimap(bytes), new AbortController().signal);
    expect(minimap?.gaps).toHaveLength(2);
  });

  it("refuses bytes that differ from the pinned SHA-256", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(minimapManifest()));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new TextEncoder().encode(JSON.stringify(minimapManifest({ gaps: [] }))))));
    await expect(loadNativeTileMinimap(tileManifestWithMinimap(bytes), new AbortController().signal)).rejects.toThrow(/hash\/length mismatch/);
  });
});
