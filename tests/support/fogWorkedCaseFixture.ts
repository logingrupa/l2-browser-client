import { readFileSync } from "node:fs";
import { parseNativeTimeTables } from "../../src/environment/parseNativeTimeTables";
import type { EnvironmentFogRanges } from "../../src/materials/ue2/model/fog";
import type { TileVisibilityFrame } from "../../src/scene/world/bspVisibility/core/tileVisibilityFrame";
import { zoneSetOf } from "../../src/scene/world/bspVisibility/core/zoneSet";
import { decodeTileLightingRecords, readTileLightingRecordsDocument, type TileLightingRecords } from "../../src/scene/world/lighting/tileLightingRecords";
import { timeTablesDocument } from "./worldTimeOfDayFixture";

export type FogWorkedCaseTile = "15_22" | "20_21";

interface FogWorkedCaseZoneRecord {
  readonly zoneIndex: number;
  readonly actor: string | null;
  distanceFog: { field: string; provenance: string; value: unknown }[];
}

interface FogWorkedCaseTileRecords {
  readonly fogInfos: { readonly exportIndex: number; readonly object: string; readonly fields: readonly { readonly field: string; readonly value: unknown }[] }[];
  readonly zones: FogWorkedCaseZoneRecord[];
}

const fixturePath = new URL("../fixtures/fog/fog-worked-cases.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { readonly environmentFog: { readonly setup: unknown };
  readonly tiles: Record<FogWorkedCaseTile, FogWorkedCaseTileRecords> };

export function fogWorkedCaseTileRecords(tile: FogWorkedCaseTile): FogWorkedCaseTileRecords {
  return structuredClone(fixture.tiles[tile]);
}

export function fogWorkedCaseFogInfoField(tile: FogWorkedCaseTile, exportIndex: number, fieldName: string): unknown {
  const field = fixture.tiles[tile].fogInfos.find(fogInfo => fogInfo.exportIndex === exportIndex)?.fields.find(entry => entry.field === fieldName);
  if (field === undefined) throw new Error(`The worked-case fixture has no ${tile} fog info ${exportIndex} field ${fieldName}.`);
  return structuredClone(field.value);
}

export function convertedEnvironmentFogRanges(): EnvironmentFogRanges {
  const document = timeTablesDocument();
  const parsed = parseNativeTimeTables({ ...document, setup: { ...document.setup, fog: fixture.environmentFog.setup } });
  if (parsed.status !== "complete") throw new Error(`The converted Env.int fog setup is incomplete: ${parsed.unresolved.join(", ")}.`);
  return parsed.timeTables.fogRanges;
}

export function decodedFogWorkedCaseRecords(tileRecords: FogWorkedCaseTileRecords): TileLightingRecords {
  const document = { schemaVersion: 1, kind: "native-tile-lighting-records", fogInfos: tileRecords.fogInfos, zones: tileRecords.zones, waterVolumes: [] };
  return decodeTileLightingRecords(readTileLightingRecordsDocument(new TextEncoder().encode(JSON.stringify(document))));
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
