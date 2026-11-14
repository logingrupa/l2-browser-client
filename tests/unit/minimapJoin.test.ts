import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NativeTileMinimapError, loadNativeTileMinimap, minimapTexturePosition, parseNativeTileMinimapManifest, type NativeTileMinimap,
} from "../../src/scene/world/minimapJoin";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";

const archiveSha256 = "a".repeat(64);
const zoneKeyArchiveSha256 = "d".repeat(64);
const packageSha256 = "b".repeat(64);
const tableSha256 = "c".repeat(64);
const routeSha256 = "e".repeat(64);
const zoneTitleReason = "minimap-join-unresolved:zone-title-source";
const radarAnchorReason = "minimap-join-unresolved:radar-anchor";

function minimapManifest(overrides: Record<string, unknown> = {}) {
  return {
    kind: "native-tile-minimap", schemaVersion: 2, tileId: "20_21",
    sourceInputs: [{ path: "systextures/l2zonename.utx", sha256: packageSha256 }, { path: "system/zonename-e.dat", sha256: tableSha256 }],
    route: { manifest: `/l2/maps/${routeSha256}/native-minimap-route/manifest.json`, manifestSha256: routeSha256, manifestBytes: 60000 },
    zoneKeyTexture: { archive: `/l2/${zoneKeyArchiveSha256}/asset.l2asset`, archiveSha256: zoneKeyArchiveSha256, archiveBytes: 2048,
      sourceObject: "l2zonename.20_21", rule: "zone-sampler-tile", source: { path: "systextures/l2zonename.utx", sha256: packageSha256, exportIndex: 93 } },
    radarTexture: { archive: `/l2/${archiveSha256}/asset.l2asset`, archiveSha256, archiveBytes: 4096, sourceObject: "Radar.Maps.20_21", rule: "radar-case" },
    huntingZones: [{ id: 4, name: "Cruma Marshlands", rule: "huntingzone-start-in-frame", startLocation: [5106, 126916, -3664],
      source: { table: "huntingzone", path: "system/huntingzone-e.dat", sha256: tableSha256, rowIndex: 3, field: "loc" } }],
    projection: { rule: "tile-frame-extent", status: "unverified", frameMinimumNative: [-12800, 0], frameMaximumNative: [12800, 25600],
      textureWidth: 256, textureHeight: 256 },
    gaps: [],
    labels: { schemaFieldMeaning: "schema field name, meaning unverified on IMPORTA" },
    ...overrides,
  };
}

const gapManifest = () => minimapManifest({ radarTexture: null, projection: null,
  gaps: [{ reason: zoneTitleReason, evidence: "the ShowZoneTitle caller chain is not derived" }, { reason: radarAnchorReason, evidence: "anchor" }] });

describe("parseNativeTileMinimapManifest", () => {
  it("accepts schema 2 with its route pin, zone key texture and hunting zones", () => {
    const minimap = parseNativeTileMinimapManifest(minimapManifest(), "20_21");
    expect(minimap.route.manifestSha256).toBe(routeSha256);
    expect(minimap.zoneKeyTexture?.rule).toBe("zone-sampler-tile");
    expect(minimap.zoneKeyTexture?.source.exportIndex).toBe(93);
    expect(minimap.huntingZones[0]?.startLocation).toEqual([5106, 126916, -3664]);
    expect(minimap.labels.schemaFieldMeaning).toBe("schema field name, meaning unverified on IMPORTA");
  });

  it("keeps the route gaps as data when the radar texture and projection are null", () => {
    const minimap = parseNativeTileMinimapManifest(gapManifest(), "20_21");
    expect(minimap.radarTexture).toBeNull();
    expect(minimap.gaps.map(gap => gap.reason)).toEqual([zoneTitleReason, radarAnchorReason]);
    expect(parseNativeTileMinimapManifest(minimapManifest({ zoneKeyTexture: null }), "20_21").zoneKeyTexture).toBeNull();
  });

  it("refuses schema 1, a route pin that does not name its SHA-256, another zone key rule and the other invalid fields", () => {
    const zoneKeyTexture = minimapManifest().zoneKeyTexture;
    const refusals: readonly [Record<string, unknown>, RegExp][] = [
      [{ kind: "native-tile-sky" }, /kind or schema version/],
      [{ schemaVersion: 1 }, /kind or schema version/],
      [{ tileId: "20_20" }, /names another tile/],
      [{ sourceInputs: [{ path: "systextures/l2zonename.utx", sha256: "A".repeat(64) }] }, /source input/],
      [{ route: { ...minimapManifest().route, manifestSha256: "9".repeat(64) } }, /native-minimap-route\/manifest\.json/],
      [{ route: { ...minimapManifest().route, manifest: `/l2/maps/${routeSha256}/native-tile-minimap/manifest.json` } }, /native-minimap-route/],
      [{ zoneKeyTexture: { ...zoneKeyTexture, rule: "tile-id" } }, /zone key texture rule must be zone-sampler-tile/],
      [{ zoneKeyTexture: { ...zoneKeyTexture, source: { ...zoneKeyTexture.source, exportIndex: 0 } } }, /texture source/],
      [{ radarTexture: { ...minimapManifest().radarTexture, archiveSha256: "d".repeat(64) } }, /asset\.l2asset/],
      [{ radarTexture: { ...minimapManifest().radarTexture, archive: `/l2/../${archiveSha256}/asset.l2asset` } }, /asset\.l2asset/],
      [{ projection: null }, /must list the gap/],
      [{ projection: { ...minimapManifest().projection, textureHeight: 128 } }, /square texture/],
    ];
    for (const [override, message] of refusals) {
      expect(() => parseNativeTileMinimapManifest(minimapManifest(override), "20_21")).toThrow(NativeTileMinimapError);
      expect(() => parseNativeTileMinimapManifest(minimapManifest(override), "20_21")).toThrow(message);
    }
  });
});

describe("minimapTexturePosition", () => {
  const minimap: NativeTileMinimap = parseNativeTileMinimapManifest(minimapManifest(), "20_21");

  it("maps the frame minimum to (0, 0) and the frame maximum to (1, 1), labelled unverified", () => {
    expect(minimapTexturePosition(minimap, { x: -128, y: 0, z: 0 })).toEqual({ position: { u: 0, v: 0, status: "unverified" }, reason: null });
    expect(minimapTexturePosition(minimap, { x: 128, y: 0, z: 256 })).toEqual({ position: { u: 1, v: 1, status: "unverified" }, reason: null });
  });

  it("returns null with the reason outside the frame or the first gap reason when the projection is null", () => {
    expect(minimapTexturePosition(minimap, { x: 128.5, y: 0, z: 100 })).toEqual({ position: null, reason: "outside-tile-frame" });
    expect(minimapTexturePosition(parseNativeTileMinimapManifest(gapManifest(), "20_21"), { x: 0, y: 0, z: 0 }))
      .toEqual({ position: null, reason: zoneTitleReason });
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
    const bytes = new TextEncoder().encode(JSON.stringify(gapManifest()));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
    const minimap = await loadNativeTileMinimap(tileManifestWithMinimap(bytes), new AbortController().signal);
    expect(minimap?.gaps).toHaveLength(2);
  });

  it("refuses bytes that differ from the pinned SHA-256", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(gapManifest()));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new TextEncoder().encode(JSON.stringify(minimapManifest())))));
    await expect(loadNativeTileMinimap(tileManifestWithMinimap(bytes), new AbortController().signal)).rejects.toThrow(/hash\/length mismatch/);
  });
});
