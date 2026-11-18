import { attenuateShadowIntensities } from "../../../environment/model/lightmapRebuild/lightAttenuation";
import { addLightColourTableToPixels } from "../../../environment/model/lightmapRebuild/lightColourTable";
import type { LightingTables } from "../../../environment/model/lightmapRebuild/lightingTables";
import { resolvedResult, type LightmapRebuildResult } from "../../../environment/model/lightmapRebuild/lightmapRebuildTypes";
import { filterPackedShadowMask } from "../../../environment/model/lightmapRebuild/shadowMaskFilter";
import type { BgraBytes } from "../../../environment/model/nativeColourBytes";
import type { LightmapRebuildRecord, LightmapRebuildShadow } from "./decodeLightmapRebuildInputs";
import type { RebuildFieldResult } from "./rebuildFieldReaders";
import type { ShadowLight } from "./rebuildShadowLights";

export interface RebuiltLightmapSources {
  readonly zoneAmbient: (zone: number) => RebuildFieldResult<BgraBytes>;
  readonly shadowLight: (light: number) => RebuildFieldResult<ShadowLight>;
  readonly tables: LightingTables;
}

export const rebuiltLightmapNotes = {
  tableControlWord: "bsp-rebuild-table-control-word-unverified",
  sunFirstTick: "bsp-rebuild-sun-first-tick-unverified",
  sunLocalSublights: "bsp-rebuild-sun-local-sublights-unverified",
  sunFreezeFlag: "bsp-rebuild-sun-freeze-flag-unverified",
  lightType7TimeSeconds: "bsp-rebuild-light-type7-time-seconds-unverified",
  uncoveredTexels: "bsp-rebuild-uncovered-texels",
} as const;

export type RebuiltLightmapNote = typeof rebuiltLightmapNotes[keyof typeof rebuiltLightmapNotes];

export interface RebuiltLightmapImage {
  readonly edge: number;
  readonly rgba: Uint8Array;
  readonly uncoveredTexels: number;
  readonly notes: readonly RebuiltLightmapNote[];
}

export type RebuiltLightmapResult = LightmapRebuildResult<RebuiltLightmapImage, string>;

interface ComposedRecord {
  readonly pixels: Uint8Array;
  readonly notes: readonly RebuiltLightmapNote[];
}

export const sunRecordPartialReason = "bsp-rebuild-sun-record-partial";
const bytesPerTexel = 4;
const blueByte = 0;
const greenByte = 1;
const redByte = 2;
const alphaByte = 3;

function ambientFilledPixels(width: number, height: number, ambient: BgraBytes): Uint8Array {
  const pixels = new Uint8Array(width * height * bytesPerTexel);
  for (let texel = 0; texel < width * height; texel++) pixels.set(ambient, texel * bytesPerTexel);
  return pixels;
}

function coversWholeLightmap(shadow: LightmapRebuildShadow, record: LightmapRebuildRecord): boolean {
  return shadow.minimumX === 0 && shadow.minimumY === 0 && shadow.maximumX === record.projection.width - 1 && shadow.maximumY === record.projection.height - 1;
}

function composeRecord(record: LightmapRebuildRecord, sources: RebuiltLightmapSources): RebuildFieldResult<ComposedRecord> {
  const ambient = sources.zoneAmbient(record.zone);
  if (ambient.status !== "resolved") return ambient;
  const { width, height } = record.projection, pixels = ambientFilledPixels(width, height, ambient.value);
  const notes: RebuiltLightmapNote[] = [];
  for (const shadow of record.shadows) {
    const light = sources.shadowLight(shadow.light);
    if (light.status !== "resolved") return light;
    if (!light.value.applied) continue;
    const { attenuation, colourTable } = light.value;
    if (attenuation.branch === "sun-direction") {
      if (!coversWholeLightmap(shadow, record)) return { status: "unresolved", reason: sunRecordPartialReason };
      notes.push(rebuiltLightmapNotes.sunFirstTick, rebuiltLightmapNotes.sunLocalSublights);
    }
    notes.push(...light.value.notes);
    const filteredMask = filterPackedShadowMask(shadow, sources.tables.shadowPatterns);
    const intensities = attenuateShadowIntensities({ filteredMask, record: shadow, surface: record.surface, lightmap: record.projection, tables: sources.tables },
      attenuation);
    addLightColourTableToPixels(pixels, width, shadow, intensities, colourTable);
  }
  return resolvedResult({ pixels, notes });
}

function placeRecordPixels(rgba: Uint8Array, covered: Uint8Array, edge: number, record: LightmapRebuildRecord, pixels: Uint8Array): void {
  const { width, height } = record.projection;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const source = (row * width + column) * bytesPerTexel, atlasTexel = (record.atlasY + row) * edge + record.atlasX + column;
      const target = atlasTexel * bytesPerTexel;
      rgba[target] = pixels[source + redByte]!;
      rgba[target + 1] = pixels[source + greenByte]!;
      rgba[target + 2] = pixels[source + blueByte]!;
      rgba[target + 3] = pixels[source + alphaByte]!;
      covered[atlasTexel] = 1;
    }
  }
}

export function composeRebuiltLightmap(edge: number, records: readonly LightmapRebuildRecord[], sources: RebuiltLightmapSources): RebuiltLightmapResult {
  const rgba = new Uint8Array(edge * edge * bytesPerTexel), covered = new Uint8Array(edge * edge);
  const presentNotes = new Set<RebuiltLightmapNote>([rebuiltLightmapNotes.tableControlWord]);
  for (const record of records) {
    const composed = composeRecord(record, sources);
    if (composed.status !== "resolved") return composed;
    placeRecordPixels(rgba, covered, edge, record, composed.value.pixels);
    for (const note of composed.value.notes) presentNotes.add(note);
  }
  const uncoveredTexels = covered.reduce((count, texel) => count + (texel === 0 ? 1 : 0), 0);
  if (uncoveredTexels > 0) presentNotes.add(rebuiltLightmapNotes.uncoveredTexels);
  const notes = Object.values(rebuiltLightmapNotes).filter(note => presentNotes.has(note));
  return resolvedResult({ edge, rgba, uncoveredTexels, notes });
}
