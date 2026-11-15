import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { decodeNativeJsonResource } from "./loadNativeSection";
import type { NativeTileManifest } from "./nativeTileManifest";

export interface MapEmitterPlacementInspection {
  readonly placementId: string;
  readonly exportIndex: number;
  readonly emitterCount: number;
  readonly memberVisible: boolean;
  readonly playing: false;
  readonly reasons: readonly string[];
}

export interface TileMapEmitterPlacements {
  readonly gap: string | null;
  inspection(memberVisible: (exportIndex: number) => boolean): readonly MapEmitterPlacementInspection[];
}

export interface ParsedMapEmitterPlacement {
  readonly placementId: string;
  readonly exportIndex: number;
  readonly emitterCount: number;
  readonly reasons: readonly string[];
}

const mapEmittersResourceKind = "map-emitters";
const resourceUnlistedReason = "map-emitters-resource-unlisted";
const resourceInvalidReasonPrefix = "map-emitters-invalid:";
const classDefaultsUnmergedReason = "map-emitter-class-defaults-unmerged";
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function emitterReasons(emitter: unknown, label: string): string[] {
  if (!isRecord(emitter) || typeof emitter.object !== "string" || !isRecord(emitter.properties)) throw new Error(`${label} is not an emitter record with object and properties.`);
  const object = emitter.object;
  return Object.entries(emitter.properties).flatMap(([property, value]) => {
    if (isRecord(value) && typeof value.unparsedHex === "string") return [`map-emitter-struct-unparsed:${object}.${property}`];
    if (isRecord(value) && typeof value.object === "string") return [`map-emitter-resource-unconverted:${value.object}`];
    return [];
  });
}

function parsePlacement(value: unknown, position: number): ParsedMapEmitterPlacement {
  const label = `Tile map emitter placement ${position}`;
  if (!isRecord(value) || typeof value.id !== "string" || !Number.isSafeInteger(value.exportIndex) || !isRecord(value.bundle) || !Array.isArray(value.bundle.emitters)) {
    throw new Error(`${label} needs id, exportIndex and bundle emitters.`);
  }
  const emitters = value.bundle.emitters;
  const reasons = [classDefaultsUnmergedReason, ...new Set(emitters.flatMap((emitter, index) => emitterReasons(emitter, `${label} emitter ${index}`)))];
  return { placementId: value.id, exportIndex: value.exportIndex as number, emitterCount: emitters.length, reasons };
}

export function parseTileMapEmitterPlacements(document: unknown, tileId: string): ParsedMapEmitterPlacement[] {
  if (!isRecord(document) || document.tileId !== tileId || !Array.isArray(document.placements)) {
    throw new Error(`Tile map emitters must list the placements of tile ${tileId}.`);
  }
  return document.placements.map(parsePlacement);
}

export async function loadTileMapEmitterPlacements(manifest: NativeTileManifest, signal: AbortSignal): Promise<TileMapEmitterPlacements> {
  const resource = manifest.resources.find(entry => entry.kind === mapEmittersResourceKind);
  if (resource === undefined) return { gap: resourceUnlistedReason, inspection: () => [] };
  let placements: ParsedMapEmitterPlacement[];
  try {
    placements = parseTileMapEmitterPlacements(decodeNativeJsonResource(
      await fetchVerifiedNativeResource(resource.manifest, resource.manifestSha256, signal, resource.manifestBytes), "Tile map emitters"), manifest.tileId);
  } catch (error) {
    signal.throwIfAborted();
    return { gap: `${resourceInvalidReasonPrefix}${error instanceof Error ? error.message : String(error)}`, inspection: () => [] };
  }
  return { gap: null, inspection: memberVisible => placements.map(placement => ({ ...placement, memberVisible: memberVisible(placement.exportIndex), playing: false })) };
}
