import type { AssetPackage } from "../package/readAssetPackage";
import { hasExactKeys, isPlainRecord, nativeTileSha256Pattern } from "../../scene/world/nativeManifestRecordGuards";
import { fetchVerifiedNativeResource } from "./fetchVerifiedNativeResource";
import { readMaterialProgramCatalogRecord, ue2ObjectPathPattern, type NativeMaterialProgramCatalogRecord } from "./nativeCatalogRecords";
import type { NativeCatalog } from "./readNativeCatalog";

export interface ActorMaterialProgramListing {
  readonly sourceObject: string;
  readonly programMaterialId: string | null;
  readonly rootPorted: boolean;
  readonly gapReasons: readonly string[];
}

export type ActorSlotProgramJoin =
  | { readonly kind: "program"; readonly sourceObject: string; readonly programMaterialId: string }
  | { readonly kind: "gap"; readonly sourceObject: string | null; readonly reasons: readonly string[] };

export interface ActorMaterialPrograms {
  joinSlot(sourceObject: string | null, signal: AbortSignal): Promise<ActorSlotProgramJoin>;
}

export type ActorModelSlotSourceObjects = { readonly kind: "slots"; readonly sourceObjects: readonly (string | null)[] } | { readonly kind: "absent" };

export const actorSlotMaterialNoneReason = "actor-slot-material-none";
export const actorSlotMaterialUnlistedReason = "actor-slot-material-unlisted";
export const actorSlotProvenanceAbsentReason = "actor-slot-provenance-absent";
const listingInvalidReasonPrefix = "actor-material-program-invalid:";
const listingKind = "native-actor-material-program";
const listingSchemaVersion = 1;
const listingFields = ["kind", "schemaVersion", "sourceObject", "program", "rootPorted", "gapReasons", "files"];
const programPinFields = ["directory", "programSha256"];
const provenanceFileName = "provenance.json";

const sourceObjectKey = (sourceObject: string) => sourceObject.toLowerCase();

function listingError(label: string, problem: string): never {
  throw new Error(`${label} ${problem}`);
}

function parseProgramPin(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (!hasExactKeys(value, programPinFields) || typeof value.programSha256 !== "string" || !nativeTileSha256Pattern.test(value.programSha256) ||
    value.directory !== `native-materials/${value.programSha256}`) {
    listingError(label, "has a program that is no native-materials program pin.");
  }
  return value.programSha256;
}

export function parseActorMaterialProgramListing(input: unknown, expectedSourceObject: string): ActorMaterialProgramListing {
  const label = `Native actor material program ${expectedSourceObject}`;
  if (!hasExactKeys(input, listingFields) || input.kind !== listingKind || input.schemaVersion !== listingSchemaVersion) {
    listingError(label, `must be a ${listingKind} schema ${listingSchemaVersion} listing holding exactly ${listingFields.join(", ")}.`);
  }
  if (input.sourceObject !== expectedSourceObject) listingError(label, `names source object ${JSON.stringify(input.sourceObject)}.`);
  if (!isPlainRecord(input.files)) listingError(label, "files must be an object.");
  if (typeof input.rootPorted !== "boolean") listingError(label, "rootPorted must be a boolean.");
  if (!Array.isArray(input.gapReasons) || !input.gapReasons.every(reason => typeof reason === "string" && reason)) {
    listingError(label, "gapReasons must be a list of reasons.");
  }
  const programMaterialId = parseProgramPin(input.program, label);
  if (input.rootPorted && programMaterialId === null) listingError(label, "names a ported root without a program.");
  if (!input.rootPorted && input.gapReasons.length === 0) listingError(label, "names an unported root without a gap reason.");
  return { sourceObject: expectedSourceObject, programMaterialId, rootPorted: input.rootPorted, gapReasons: [...input.gapReasons as string[]] };
}

function joinOfListing(listing: ActorMaterialProgramListing): ActorSlotProgramJoin {
  if (listing.programMaterialId === null || !listing.rootPorted) return { kind: "gap", sourceObject: listing.sourceObject, reasons: listing.gapReasons };
  return { kind: "program", sourceObject: listing.sourceObject, programMaterialId: listing.programMaterialId };
}

async function loadListingJoin(record: NativeMaterialProgramCatalogRecord, signal: AbortSignal): Promise<ActorSlotProgramJoin> {
  try {
    const bytes = await fetchVerifiedNativeResource(record.manifest, record.manifestSha256, signal, record.manifestBytes);
    const listing: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return joinOfListing(parseActorMaterialProgramListing(listing, record.sourceObject));
  } catch (error) {
    signal.throwIfAborted();
    return { kind: "gap", sourceObject: record.sourceObject, reasons: [`${listingInvalidReasonPrefix}${error instanceof Error ? error.message : String(error)}`] };
  }
}

export function actorMaterialProgramsOfCatalog(catalog: Pick<NativeCatalog, "materialPrograms">): ActorMaterialPrograms {
  const recordsBySourceObject = new Map<string, NativeMaterialProgramCatalogRecord>();
  for (const value of catalog.materialPrograms) {
    const record = readMaterialProgramCatalogRecord(value);
    if (recordsBySourceObject.has(sourceObjectKey(record.sourceObject))) throw new Error(`Native catalog materialPrograms lists ${record.sourceObject} twice.`);
    recordsBySourceObject.set(sourceObjectKey(record.sourceObject), record);
  }
  const loadedJoins = new Map<string, ActorSlotProgramJoin>();
  return {
    async joinSlot(sourceObject, signal) {
      if (sourceObject === null) return { kind: "gap", sourceObject, reasons: [actorSlotMaterialNoneReason] };
      const record = recordsBySourceObject.get(sourceObjectKey(sourceObject));
      if (record === undefined) return { kind: "gap", sourceObject, reasons: [actorSlotMaterialUnlistedReason] };
      const loaded = loadedJoins.get(sourceObjectKey(sourceObject)) ?? await loadListingJoin(record, signal);
      loadedJoins.set(sourceObjectKey(sourceObject), loaded);
      return loaded;
    },
  };
}

function slotListOfProvenance(metadata: Record<string, unknown>): readonly unknown[] | null {
  if (Array.isArray(metadata.materialSlots)) return metadata.materialSlots;
  if (!Array.isArray(metadata.parts)) return null;
  return metadata.parts.flatMap(part => isPlainRecord(part) && Array.isArray(part.materialSlots) ? part.materialSlots as unknown[] : []);
}

function resolvedSlotMaterialObject(slot: unknown): unknown {
  if (!isPlainRecord(slot)) return undefined;
  if (isPlainRecord(slot.unsupportedMaterialAdapter)) return slot.unsupportedMaterialAdapter.object;
  if (Array.isArray(slot.nativeMaterialGraph) && slot.nativeMaterialGraph.length > 0) {
    const root: unknown = slot.nativeMaterialGraph[0];
    return isPlainRecord(root) ? root.object : undefined;
  }
  return slot.texture;
}

export function readActorModelSlotSourceObjects(asset: AssetPackage): ActorModelSlotSourceObjects {
  const bytes = asset.files.get(provenanceFileName);
  if (bytes === undefined) return { kind: "absent" };
  const provenance: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const metadata = isPlainRecord(provenance) && isPlainRecord(provenance.metadata) ? provenance.metadata : null;
  const slots = metadata === null ? null : slotListOfProvenance(metadata);
  if (slots === null || slots.length === 0) return { kind: "absent" };
  return {
    kind: "slots",
    sourceObjects: slots.map((slot, index) => {
      const materialObject = resolvedSlotMaterialObject(slot);
      if (materialObject === undefined || materialObject === null) return null;
      if (typeof materialObject !== "string" || !ue2ObjectPathPattern.test(materialObject)) {
        throw new Error(`Native actor ${asset.manifest.id} material slot ${index} names ${JSON.stringify(materialObject)}, which is no qualified object name.`);
      }
      return materialObject;
    }),
  };
}
