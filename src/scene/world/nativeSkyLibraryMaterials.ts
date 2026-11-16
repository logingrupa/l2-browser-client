import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { createNativeMaterial, type LoadedNativeMaterial, type NativeMaterial } from "../../materials/ue2/babylon/material";
import { decodeNativeJsonResource } from "./loadNativeSection";
import { hasExactKeys, isPlainRecord } from "./nativeManifestRecordGuards";
import { readNativeSourceReference } from "./nativeSourceReference";
import type { NativeSkyBundleFile } from "./nativeTileSkySource";
import { parseListedProgramPin } from "./staticMeshLibraryMaterials";

export interface NativeSkyMaterialEntry {
  readonly root: string;
  readonly programMaterialId: string | null;
  readonly gapReasons: readonly string[];
}

export type NativeSkyMaterialsListing = ReadonlyMap<string, NativeSkyMaterialEntry>;

export type NativeSkySurfaceJoin =
  | { readonly kind: "program"; readonly programMaterialId: string }
  | { readonly kind: "gap"; readonly reasons: readonly string[] };

export type NativeSkySurfaceStatus = "library-compiled" | "library-diagnostic" | "program-gap" | "program-unconverted";

export interface NativeSkySurface {
  readonly mesh: AbstractMesh;
  readonly sourceReference: string | null;
  readonly status: NativeSkySurfaceStatus;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
  readonly library: NativeMaterial | null;
}

export interface NativeSkyLibrarySettings {
  readonly scene: Scene;
  readonly meshes: readonly AbstractMesh[];
  readonly listing: NativeSkyMaterialsListing | null;
  readonly sessionSeed: number;
  readonly loadProgram: (materialId: string, signal: AbortSignal) => Promise<LoadedNativeMaterial>;
  readonly signal: AbortSignal;
}

export const skyMaterialsListingAbsentReason = "sky-materials-listing-absent";
export const skySurfaceSourceReferenceNoneReason = "sky-surface-source-reference-none";
export const skySurfaceMaterialUnlistedReason = "sky-surface-material-unlisted";
export const skySurfaceProgramAbsentReason = "sky-surface-program-absent";
const skySnapshotKind = "native-sky-source-snapshot";
const skySnapshotSchemaVersion = 1;
const skyMaterialFields = ["mapReference", "root", "program", "gapReasons"];
const maximumListedSkyMaterials = 64;

const rootKey = (root: string) => root.toLowerCase();

function parseSkyMaterialEntry(value: unknown, label: string): NativeSkyMaterialEntry {
  if (!hasExactKeys(value, skyMaterialFields) || typeof value.root !== "string" || !value.root.trim()) {
    throw new Error(`${label} materials must hold exactly ${skyMaterialFields.join(", ")} with a root name.`);
  }
  const entryLabel = `${label} material ${value.root}`;
  if (!Array.isArray(value.gapReasons) || !value.gapReasons.every(reason => typeof reason === "string" && reason)) {
    throw new Error(`${entryLabel} gapReasons must be a list of reasons.`);
  }
  return { root: value.root, programMaterialId: parseListedProgramPin(value.program, entryLabel), gapReasons: [...value.gapReasons as string[]] };
}

export function parseNativeSkyMaterialsListing(input: unknown, tileId: string): NativeSkyMaterialsListing {
  const label = `Native tile ${tileId} sky snapshot`;
  if (!isPlainRecord(input) || input.kind !== skySnapshotKind || input.schemaVersion !== skySnapshotSchemaVersion || input.tileId !== tileId) {
    throw new Error(`${label} must be a ${skySnapshotKind} schema ${skySnapshotSchemaVersion} record of tile ${tileId}.`);
  }
  if (!Array.isArray(input.materials) || input.materials.length > maximumListedSkyMaterials) {
    throw new Error(`${label} materials must be a list of at most ${maximumListedSkyMaterials} entries.`);
  }
  const listing = new Map<string, NativeSkyMaterialEntry>();
  for (const value of input.materials) {
    const entry = parseSkyMaterialEntry(value, label);
    if (listing.has(rootKey(entry.root))) throw new Error(`${label} lists material ${entry.root} twice.`);
    listing.set(rootKey(entry.root), entry);
  }
  return listing;
}

export async function loadNativeSkyMaterialsListing(snapshot: NativeSkyBundleFile, tileId: string, signal: AbortSignal): Promise<NativeSkyMaterialsListing> {
  const bytes = await fetchVerifiedNativeResource(snapshot.resource, snapshot.sha256, signal, snapshot.bytes);
  return parseNativeSkyMaterialsListing(decodeNativeJsonResource(bytes, `Native tile ${tileId} sky snapshot`), tileId);
}

export function joinNativeSkySurface(listing: NativeSkyMaterialsListing, sourceReference: string | null): NativeSkySurfaceJoin {
  if (sourceReference === null) return { kind: "gap", reasons: [skySurfaceSourceReferenceNoneReason] };
  const entry = listing.get(rootKey(sourceReference));
  if (entry === undefined) return { kind: "gap", reasons: [skySurfaceMaterialUnlistedReason] };
  if (entry.programMaterialId === null) return { kind: "gap", reasons: entry.gapReasons.length ? entry.gapReasons : [skySurfaceProgramAbsentReason] };
  return { kind: "program", programMaterialId: entry.programMaterialId };
}

async function librarySkySurface(settings: NativeSkyLibrarySettings, mesh: AbstractMesh): Promise<NativeSkySurface> {
  const sourceReference = readNativeSourceReference(mesh.material);
  const unbound = (status: NativeSkySurfaceStatus, programMaterialId: string | null, reasons: readonly string[]): NativeSkySurface =>
    ({ mesh, sourceReference, status, programMaterialId, reasons, library: null });
  if (settings.listing === null) return unbound("program-unconverted", null, [skyMaterialsListingAbsentReason]);
  const join = joinNativeSkySurface(settings.listing, sourceReference);
  if (join.kind === "gap") return unbound("program-gap", null, join.reasons);
  const loaded = await settings.loadProgram(join.programMaterialId, settings.signal);
  settings.signal.throwIfAborted();
  const library = createNativeMaterial(settings.scene, loaded, { sessionSeed: settings.sessionSeed, lighting: "unlit" });
  const inspected = library.inspect();
  if (inspected.status !== "compiled") { library.dispose(); return unbound("library-diagnostic", join.programMaterialId, inspected.reasons); }
  return { mesh, sourceReference, status: "library-compiled", programMaterialId: join.programMaterialId, reasons: [], library };
}

export async function bindNativeSkyLibraryMaterials(settings: NativeSkyLibrarySettings): Promise<NativeSkySurface[]> {
  const surfaces: NativeSkySurface[] = [];
  try {
    for (const mesh of settings.meshes) surfaces.push(await librarySkySurface(settings, mesh));
    settings.signal.throwIfAborted();
  } catch (error) {
    for (const surface of surfaces) surface.library?.dispose();
    throw error;
  }
  for (const surface of surfaces) if (surface.library !== null) surface.mesh.material = surface.library.material;
  return surfaces;
}
