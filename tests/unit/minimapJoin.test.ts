import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NativeTileMinimapError, loadNativeTileMinimap, minimapTexturePosition, parseNativeTileMinimapManifest, type NativeTileMinimap,
} from "../../src/scene/world/minimapJoin";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";

const archiveSha256 = "a".repeat(64);
const packageSha256 = "b".repeat(64);
const tableSha256 = "c".repeat(64);

function minimapManifest(overrides: Record<string, unknown> = {}) {
  return {
    kind: "native-tile-minimap", schemaVersion: 1, tileId: "20_21",
    sourceInputs: [{ path: "systextures/L2_RadarMap.utx", sha256: packageSha256 }, { path: "system/zonename-e.dat", sha256: tableSha256 }],
    radarTexture: { archive: `/l2/${archiveSha256}/asset.l2asset`, archiveSha256, archiveBytes: 4096, sourceObject: "Radar.Maps.20_21", rule: "tile-id" },
    townMapTextures: [{ object: "town_map.Town.20_21_map", rule: "tile-id-map", citation: "Elbera tools/maps/build_minimap.py at 12c9656",
      source: { path: "systextures/town_map.utx", sha256: packageSha256, exportIndex: 3 } }],
    zoneNameTextures: [{ object: "l2zonename.20_21", rule: "tile-id", source: { path: "systextures/l2zonename.utx", sha256: packageSha256, exportIndex: 93 } }],
    zones: [{ id: 7, name: "Gludio Territory", map: "", rule: "zonename-grid",
      source: { table: "zonename", path: "system/zonename-e.dat", sha256: tableSha256, rowIndex: 7, field: "MapX,MapY" } }],
    huntingZones: [{ id: 4, name: "Cruma Marshlands", rule: "huntingzone-start-in-frame", startLocation: [5106, 126916, -3664],
      source: { table: "huntingzone", path: "system/huntingzone-e.dat", sha256: tableSha256, rowIndex: 3, field: "loc" } }],
    projection: { rule: "tile-frame-extent", status: "unverified", frameMinimumNative: [-12800, 0], frameMaximumNative: [12800, 25600],
      textureWidth: 256, textureHeight: 256 },
    gaps: [],
    labels: { schemaFieldMeaning: "schema field name, meaning unverified on IMPORTA" },
    ...overrides,
  };
}

const gapManifest = () => minimapManifest({ radarTexture: null, projection: null, townMapTextures: [],
  gaps: [{ reason: "minimap-join-unresolved:zone-grid", evidence: "21 zonename rows hold MapX or MapY outside the locked tile grid" },
    { reason: "minimap-join-unresolved:radar-texture", evidence: "no radar export equals the tile id" }] });

describe("parseNativeTileMinimapManifest", () => {
  it("accepts the fixture manifest and keeps every joined item with its rule and source", () => {
    const minimap = parseNativeTileMinimapManifest(minimapManifest(), "20_21");
    expect(minimap.radarTexture?.rule).toBe("tile-id");
    expect(minimap.townMapTextures[0]?.citation).toMatch(/12c9656/);
    expect(minimap.zoneNameTextures[0]?.citation).toBeNull();
    expect(minimap.huntingZones[0]?.startLocation).toEqual([5106, 126916, -3664]);
    expect(minimap.labels.schemaFieldMeaning).toBe("schema field name, meaning unverified on IMPORTA");
  });

  it("keeps gaps as data when the radar texture and projection are gaps", () => {
    const minimap = parseNativeTileMinimapManifest(gapManifest(), "20_21");
    expect(minimap.radarTexture).toBeNull();
    expect(minimap.gaps.map(gap => gap.reason)).toEqual(["minimap-join-unresolved:zone-grid", "minimap-join-unresolved:radar-texture"]);
  });

  it("refuses a wrong kind, schema version, tile id, hash, archive path or a missing explaining gap", () => {
    const refusals: readonly [Record<string, unknown>, RegExp][] = [
      [{ kind: "native-tile-sky" }, /kind or schema version/],
      [{ schemaVersion: 2 }, /kind or schema version/],
      [{ tileId: "20_20" }, /names another tile/],
      [{ sourceInputs: [{ path: "systextures/L2_RadarMap.utx", sha256: "A".repeat(64) }] }, /source input/],
      [{ radarTexture: { ...minimapManifest().radarTexture, archiveSha256: "d".repeat(64) } }, /asset\.l2asset/],
      [{ radarTexture: { ...minimapManifest().radarTexture, archive: `/l2/../${archiveSha256}/asset.l2asset` } }, /asset\.l2asset/],
      [{ projection: null }, /must list the gap/],
      [{ zoneNameTextures: [{ object: "l2zonename.20_21", rule: "prefix", source: { path: "systextures/l2zonename.utx", sha256: packageSha256, exportIndex: 1 } }] },
        /exact join rule/],
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
    expect(minimapTexturePosition(minimap, { x: -128, z: 0 })).toEqual({ position: { u: 0, v: 0, status: "unverified" }, reason: null });
    expect(minimapTexturePosition(minimap, { x: 128, z: 256 })).toEqual({ position: { u: 1, v: 1, status: "unverified" }, reason: null });
  });

  it("returns null with the reason outside the frame or when the projection is a gap", () => {
    expect(minimapTexturePosition(minimap, { x: 128.5, z: 100 })).toEqual({ position: null, reason: "outside-tile-frame" });
    expect(minimapTexturePosition(parseNativeTileMinimapManifest(gapManifest(), "20_21"), { x: 0, z: 0 }))
      .toEqual({ position: null, reason: "minimap-join-unresolved:zone-grid" });
    const projectionGap = parseNativeTileMinimapManifest(minimapManifest({ projection: null,
      gaps: [{ reason: "texture-licensee-unsupported:118/0", evidence: "radar" }, { reason: "minimap-join-unresolved:projection", evidence: "frame" }] }), "20_21");
    expect(minimapTexturePosition(projectionGap, { x: 0, z: 0 })).toEqual({ position: null, reason: "minimap-join-unresolved:projection" });
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
