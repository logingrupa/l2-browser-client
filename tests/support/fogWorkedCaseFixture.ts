import { readFileSync } from "node:fs";
import type { TileVisibilityFrame } from "../../src/scene/world/bspVisibility/core/tileVisibilityFrame";
import { zoneSetOf } from "../../src/scene/world/bspVisibility/core/zoneSet";
import { decodeTileLightingRecords, type TileLightingRecords } from "../../src/scene/world/lighting/tileLightingRecords";

export type FogWorkedCaseTile = "15_22" | "20_21";

interface FogWorkedCaseZoneRecord {
  readonly zoneIndex: number;
  readonly actor: string | null;
  distanceFog: { field: string; provenance: string; value: unknown }[];
}

interface FogWorkedCaseTileRecords {
  readonly fogInfos: { readonly exportIndex: number; readonly object: string }[];
  readonly zones: FogWorkedCaseZoneRecord[];
}

const fixturePath = new URL("../fixtures/fog/fog-worked-cases.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { readonly tiles: Record<FogWorkedCaseTile, FogWorkedCaseTileRecords> };

export function fogWorkedCaseTileRecords(tile: FogWorkedCaseTile): FogWorkedCaseTileRecords {
  return structuredClone(fixture.tiles[tile]);
}

export function decodedFogWorkedCaseRecords(tileRecords: FogWorkedCaseTileRecords): TileLightingRecords {
  const document = { schemaVersion: 1, kind: "native-tile-lighting-records", fogInfos: tileRecords.fogInfos, zones: tileRecords.zones, waterVolumes: [] };
  return decodeTileLightingRecords(new TextEncoder().encode(JSON.stringify(document)));
}

export function zoneIndexOfActor(tileRecords: FogWorkedCaseTileRecords, actor: string): number {
  const zone = tileRecords.zones.find(record => record.actor === actor);
  if (zone === undefined) throw new Error(`The worked-case fixture has no zone of ${actor}.`);
  return zone.zoneIndex;
}

export function frameInZone(cameraZone: number, skyZones: readonly number[] = []): TileVisibilityFrame {
  return { culling: false, cameraLeaf: 0, cameraZone, outdoorView: false, visibleZones: zoneSetOf(cameraZone < 0 ? 0 : cameraZone), visibleZoneCount: 1, openedPortalCount: 0,
    skyZones, sectionVisible: new Uint8Array(0), rangeVisible: new Uint8Array(0), memberVisible: new Uint8Array(0), terrainVisible: true, translucentOrder: new Map() };
}
