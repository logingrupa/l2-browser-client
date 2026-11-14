import { describe, expect, it } from "vitest";
import { radarTextureMapBinding, zoneKeyHelper } from "../../src/ui/nativeWindows/minimapRadarRouteRecipe";
import { chooseNewRadarTexture } from "../../src/ui/nativeWindows/newRadarTextureChoice";
import {
  sampleRadarZoneName, zoneKeyByte, zoneKeyMipFromTexturePackage, zoneNameKey, zoneNameRow, zoneSamplerTile, type ZoneKeyMip,
} from "../../src/ui/nativeWindows/radarZoneName";
import { syntheticRoute } from "./support/tileMinimapFixtures";
import { syntheticZoneKeyRows, syntheticZoneKeyMip } from "./support/radarZoneFixtures";

const route = syntheticRoute({ zoneKeyRows: syntheticZoneKeyRows });
const sampler = route.zoneSampler;
const encoder = new TextEncoder();

function mipFiles(width: number, height: number, mipBytes: Uint8Array | null): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>([["native-texture-source.json", encoder.encode(JSON.stringify({ kind: "native-texture-source",
    mips: [{ level: 0, file: "native/mip00.bin", width, height }] }))]]);
  if (mipBytes !== null) files.set("native/mip00.bin", mipBytes);
  return files;
}

describe("zone sampler tile", () => {
  it("takes the tile from the position with T((x + 360448) / 32768 + 9) and T((y + 294912) / 32768 + 9)", () => {
    expect(zoneSamplerTile(sampler, { x: 0, y: 98304, z: 0 })).toEqual({ tileX: 20, tileY: 21, tileId: "20_21" });
    expect(zoneSamplerTile(sampler, { x: 32767.5, y: 131071.5, z: 0 })).toEqual({ tileX: 20, tileY: 21, tileId: "20_21" });
    expect(zoneSamplerTile(sampler, { x: 32768, y: 131072, z: 0 })).toEqual({ tileX: 21, tileY: 22, tileId: "21_22" });
    expect(zoneSamplerTile(sampler, { x: -0.5, y: -294912.5, z: 0 })).toEqual({ tileX: 19, tileY: 8, tileId: "19_08" });
    expect(zoneSamplerTile(sampler, { x: -135200, y: 91163, z: 0 })).toEqual({ tileX: 15, tileY: 20, tileId: "15_20" });
  });
});

describe("zone key byte", () => {
  const mip: ZoneKeyMip = syntheticZoneKeyMip;
  const tile = zoneSamplerTile(sampler, { x: 0, y: 98304, z: 0 });

  it("reads mip 0 at py * width + px with px = T(i32((x - originX) * width) / 32768)", () => {
    expect(zoneKeyByte(sampler, tile, { x: 8192, y: 98304 + 16384, z: 0 }, mip)).toEqual({ status: "sampled", byte: mip.bytes[2 * 4 + 1] });
    expect(zoneKeyByte(sampler, tile, { x: 0, y: 98304, z: 0 }, mip)).toEqual({ status: "sampled", byte: mip.bytes[0] });
    expect(zoneKeyByte(sampler, tile, { x: 32767.9, y: 131071.9, z: 0 }, mip)).toEqual({ status: "sampled", byte: mip.bytes[15] });
    expect(zoneKeyByte(sampler, tile, { x: 8191.9, y: 98304, z: 0 }, mip)).toEqual({ status: "sampled", byte: mip.bytes[0] });
  });

  it("uses key 0 when the tile has no zone key texture", () => {
    expect(zoneKeyByte(sampler, tile, { x: 8192, y: 98304, z: 0 }, null)).toEqual({ status: "sampled", byte: 0 });
  });

  it("names the gap instead of reading outside the mip, since the sampler does not clamp", () => {
    expect(zoneKeyByte(sampler, tile, { x: -1, y: 98304, z: 0 }, mip)).toEqual({ status: "sampled", byte: mip.bytes[0] });
    expect(zoneKeyByte(sampler, tile, { x: -8193, y: 98304, z: 0 }, mip)).toEqual({ status: "gap", reason: "zone-sampler-pixel-outside-mip" });
  });

  it("reads the mip 0 bytes from the native texture source of the converted zone key texture", () => {
    expect(zoneKeyMipFromTexturePackage(mipFiles(2, 2, new Uint8Array([1, 2, 3, 4])))).toEqual({ status: "loaded",
      mip: { width: 2, height: 2, bytes: new Uint8Array([1, 2, 3, 4]) } });
    expect(zoneKeyMipFromTexturePackage(mipFiles(2, 2, null))).toEqual({ status: "gap", reason: "minimap-join-unresolved:zone-key-bytes" });
    expect(zoneKeyMipFromTexturePackage(mipFiles(2, 2, new Uint8Array([1, 2, 3])))).toEqual({ status: "gap", reason: "minimap-join-unresolved:zone-key-bytes" });
    expect(zoneKeyMipFromTexturePackage(new Map())).toEqual({ status: "gap", reason: "minimap-join-unresolved:zone-key-bytes" });
  });
});

describe("zone key helper", () => {
  it("reads the global colour limit of the recipe", () => {
    expect(zoneKeyHelper).toEqual({ globalBelowColor: 200 });
  });

  it("keys Color below 200 as Color << 8 and the rest as ((((MapY << 8) | MapX) << 8) | Color) << 8", () => {
    expect(zoneNameKey(199, 20, 21)).toBe(199 << 8);
    expect(zoneNameKey(200, 20, 21)).toBe(((((21 << 8) | 20) << 8) | 200) << 8);
    expect(zoneNameKey(255, 20, 14)).toBe(236257024);
    expect(zoneNameKey(0, 20, 21)).toBe(0);
  });
});

describe("zone name row", () => {
  const giranKey = zoneNameKey(255, 20, 21);
  const overlapKey = zoneNameKey(200, 20, 21);

  it("picks the row of the key whose Bottom < Z < Top", () => {
    expect(zoneNameRow(route.zoneKeyRows, giranKey, 0)).toMatchObject({ status: "named", zoneName: "Giran Castle Town" });
    expect(zoneNameRow(route.zoneKeyRows, overlapKey, -4000)).toMatchObject({ status: "named", zoneName: "Synthetic lower zone" });
  });

  it("excludes both range ends", () => {
    expect(zoneNameRow(route.zoneKeyRows, giranKey, 10000)).toEqual({ status: "gap", reason: "zone-name-row-absent" });
    expect(zoneNameRow(route.zoneKeyRows, giranKey, -10000)).toEqual({ status: "gap", reason: "zone-name-row-absent" });
  });

  it("returns the zone-key-run gap where overlapping ranges of one key run both hold Z", () => {
    expect(zoneNameRow(route.zoneKeyRows, overlapKey, 1000)).toEqual({ status: "gap", reason: "minimap-join-unresolved:zone-key-run" });
  });

  it("samples the zone name from the position, the mip and the key run", () => {
    expect(sampleRadarZoneName({ route, sourcePosition: { x: 8192, y: 98304 + 16384, z: 0 }, zoneKeyMip: syntheticZoneKeyMip }))
      .toMatchObject({ status: "named", zoneName: "Giran Castle Town" });
    expect(sampleRadarZoneName({ route, sourcePosition: { x: 8192, y: 98304 + 16384, z: 0 }, zoneKeyMip: null }))
      .toMatchObject({ status: "named", zoneName: "Synthetic waterways" });
  });
});

describe("NewRadarWnd texture choice", () => {
  it("binds the texture map control that NewRadarWnd.OnLoad gets by handle", () => {
    expect(radarTextureMapBinding).toEqual({ windowId: "NewRadarWnd", controlName: "texMap" });
  });

  it("matches the whole zone name case-insensitively like appStricmp", () => {
    expect(chooseNewRadarTexture(route.radar, "giran castle town")).toMatchObject({ matchedZoneName: "Giran Castle Town", isGlobal: false,
      texture: { object: "L2_RadarMap.RadarMaps.giran_castle_town" } });
    expect(chooseNewRadarTexture(route.radar, "TOWN  OF GODDARD")).toMatchObject({ matchedZoneName: "Town  of Goddard",
      texture: { object: "L2_RadarMap.RadarMaps.godard_castle_town" } });
  });

  it("falls back to RadarMaps.Global for any other name, including Town of Goddard with one space", () => {
    expect(chooseNewRadarTexture(route.radar, "Town of Goddard")).toMatchObject({ matchedZoneName: null, isGlobal: true,
      texture: { object: "L2_RadarMap.RadarMaps.Global" } });
    expect(chooseNewRadarTexture(route.radar, "Giran Castle Town ")).toMatchObject({ matchedZoneName: null, isGlobal: true });
    expect(chooseNewRadarTexture(route.radar, "Cruma Tower - Third floor").texture?.object).toBe("L2_RadarMap.RadarMaps.Global");
  });
});
