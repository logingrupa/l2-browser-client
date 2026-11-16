import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { decodeNativeJsonResource } from "./loadNativeSection";
import { hasExactKeys, isPlainRecord, nativeTileSha256Pattern } from "./nativeManifestRecordGuards";
import type { NativeTileManifest } from "./nativeTileManifest";

export interface StaticMeshMaterialEntry {
  readonly sourceObject: string;
  readonly programMaterialId: string | null;
  readonly rootPorted: boolean;
  readonly gapReasons: readonly string[];
}

export interface StaticMeshMaterialsListing {
  readonly tileId: string;
  readonly materialsBySourceObject: ReadonlyMap<string, StaticMeshMaterialEntry>;
}

export type StaticMeshSlotJoin =
  | { readonly kind: "program"; readonly sourceObject: string; readonly programMaterialId: string }
  | { readonly kind: "gap"; readonly sourceObject: string | null; readonly reasons: readonly string[] };

export type StaticMeshMaterialsLoad =
  | { readonly listing: StaticMeshMaterialsListing; readonly gap: null }
  | { readonly listing: null; readonly gap: string };

export const staticMeshMaterialsResourceKind = "static-mesh-materials";
export const staticMeshMaterialsResourceAbsentReason = "static-mesh-materials-resource-absent";
export const staticMeshSlotMaterialNoneReason = "static-mesh-slot-material-none";
export const staticMeshSlotMaterialUnlistedReason = "static-mesh-slot-material-unlisted";
const listingInvalidReasonPrefix = "static-mesh-materials-invalid:";
const listingKind = "native-tile-static-mesh-materials";
const listingSchemaVersion = 1;
const listingFields = ["kind", "schemaVersion", "tileId", "materials", "files"];
const materialFields = ["sourceObject", "program", "rootPorted", "gapReasons"];
const programPinFields = ["directory", "programSha256"];
const maximumListedMaterials = 16_384;

const sourceObjectKey = (sourceObject: string) => sourceObject.toLowerCase();

function listingError(label: string, problem: string): never {
  throw new Error(`${label} ${problem}`);
}

export function parseListedProgramPin(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (!hasExactKeys(value, programPinFields) || typeof value.programSha256 !== "string" || !nativeTileSha256Pattern.test(value.programSha256) ||
    value.directory !== `native-materials/${value.programSha256}`) {
    listingError(label, "has a program that is no native-materials program pin.");
  }
  return value.programSha256;
}

function parseMaterialEntry(value: unknown, label: string): StaticMeshMaterialEntry {
  if (!hasExactKeys(value, materialFields) || typeof value.sourceObject !== "string" || !value.sourceObject.trim()) {
    listingError(label, `materials must hold exactly ${materialFields.join(", ")} with a source object name.`);
  }
  const entryLabel = `${label} material ${value.sourceObject}`;
  if (typeof value.rootPorted !== "boolean") listingError(entryLabel, "rootPorted must be a boolean.");
  if (!Array.isArray(value.gapReasons) || !value.gapReasons.every(reason => typeof reason === "string" && reason)) {
    listingError(entryLabel, "gapReasons must be a list of reasons.");
  }
  const programMaterialId = parseListedProgramPin(value.program, entryLabel);
  if (value.rootPorted && programMaterialId === null) listingError(entryLabel, "names a ported root without a program.");
  if (!value.rootPorted && value.gapReasons.length === 0) listingError(entryLabel, "names an unported root without a gap reason.");
  return { sourceObject: value.sourceObject, programMaterialId, rootPorted: value.rootPorted, gapReasons: [...value.gapReasons as string[]] };
}

export function parseStaticMeshMaterialsListing(input: unknown, expectedTileId: string): StaticMeshMaterialsListing {
  const label = `Native tile ${expectedTileId} static mesh materials`;
  if (!hasExactKeys(input, listingFields) || input.kind !== listingKind || input.schemaVersion !== listingSchemaVersion) {
    listingError(label, `must be a ${listingKind} schema ${listingSchemaVersion} listing holding exactly ${listingFields.join(", ")}.`);
  }
  if (input.tileId !== expectedTileId) listingError(label, `names tile ${JSON.stringify(input.tileId)}.`);
  if (!isPlainRecord(input.files)) listingError(label, "files must be an object.");
  if (!Array.isArray(input.materials) || input.materials.length > maximumListedMaterials) {
    listingError(label, `materials must be a list of at most ${maximumListedMaterials} entries.`);
  }
  const materialsBySourceObject = new Map<string, StaticMeshMaterialEntry>();
  for (const value of input.materials) {
    const entry = parseMaterialEntry(value, label);
    if (materialsBySourceObject.has(sourceObjectKey(entry.sourceObject))) listingError(label, `lists material ${entry.sourceObject} twice.`);
    materialsBySourceObject.set(sourceObjectKey(entry.sourceObject), entry);
  }
  return { tileId: expectedTileId, materialsBySourceObject };
}

export function joinStaticMeshSlot(listing: StaticMeshMaterialsListing, sourceObject: string | null): StaticMeshSlotJoin {
  if (sourceObject === null) return { kind: "gap", sourceObject, reasons: [staticMeshSlotMaterialNoneReason] };
  const entry = listing.materialsBySourceObject.get(sourceObjectKey(sourceObject));
  if (entry === undefined) return { kind: "gap", sourceObject, reasons: [staticMeshSlotMaterialUnlistedReason] };
  if (entry.programMaterialId === null || !entry.rootPorted) return { kind: "gap", sourceObject: entry.sourceObject, reasons: entry.gapReasons };
  return { kind: "program", sourceObject: entry.sourceObject, programMaterialId: entry.programMaterialId };
}

export async function loadStaticMeshMaterialsListing(manifest: NativeTileManifest, signal: AbortSignal): Promise<StaticMeshMaterialsLoad> {
  const resource = manifest.resources.find(entry => entry.kind === staticMeshMaterialsResourceKind);
  if (resource === undefined) return { listing: null, gap: staticMeshMaterialsResourceAbsentReason };
  try {
    const bytes = await fetchVerifiedNativeResource(resource.manifest, resource.manifestSha256, signal, resource.manifestBytes);
    const label = `Native tile ${manifest.tileId} static mesh materials`;
    return { listing: parseStaticMeshMaterialsListing(decodeNativeJsonResource(bytes, label), manifest.tileId), gap: null };
  } catch (error) {
    signal.throwIfAborted();
    return { listing: null, gap: `${listingInvalidReasonPrefix}${error instanceof Error ? error.message : String(error)}` };
  }
}
