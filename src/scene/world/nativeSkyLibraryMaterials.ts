import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import {
  createNativeMaterial, type LoadedNativeMaterial, type NativeMaterial, type NativeMaterialUniforms,
} from "../../materials/ue2/babylon/material";
import { decodeNativeJsonResource } from "./loadNativeSection";
import { hasExactKeys, isPlainRecord } from "./nativeManifestRecordGuards";
import { readNativeSourceReference } from "./nativeSourceReference";
import { sharedSkyRecordId, type NativeSkyBundleFile } from "./nativeSharedSkySource";
import {
  bindSkyEnvironmentColours, type SkyEnvironmentColourInspection, type SkyEnvironmentColourSources, type SkyEnvironmentColourWriter,
} from "./skyEnvironmentColours";
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

export type NativeSkySurfaceStatus = "library-compiled" | "library-diagnostic" | "program-gap";

export interface NativeSkySurface {
  readonly mesh: AbstractMesh;
  readonly sourceReference: string | null;
  readonly status: NativeSkySurfaceStatus;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
  readonly library: NativeMaterial | null;
  readonly colorModifierNodes: readonly string[];
}

export interface NativeSkySurfaceInspection {
  readonly mesh: string;
  readonly sourceReference: string | null;
  readonly programMaterialId: string | null;
  readonly status: NativeSkySurfaceStatus;
  readonly reasons: readonly string[];
}

export interface NativeSkyLibrarySettings {
  readonly scene: Scene;
  readonly meshes: readonly AbstractMesh[];
  readonly listing: NativeSkyMaterialsListing;
  readonly sessionSeed: number;
  readonly materialUniforms: (() => NativeMaterialUniforms) | null;
  readonly environmentColours: SkyEnvironmentColourSources | null;
  readonly loadProgram: (materialId: string, signal: AbortSignal) => Promise<LoadedNativeMaterial>;
  readonly signal: AbortSignal;
}

export interface NativeSkyLibraryBinding {
  readonly surfaces: readonly NativeSkySurfaceInspection[];
  environmentColours(): readonly SkyEnvironmentColourInspection[];
  dispose(): void;
}

interface CompiledNativeSkySurface extends NativeSkySurface {
  readonly library: NativeMaterial;
  readonly snapshotMaterial: Material | null;
}

export const skySurfaceSourceReferenceNoneReason = "sky-surface-source-reference-none";
export const skySurfaceMaterialUnlistedReason = "sky-surface-material-unlisted";
export const skySurfaceProgramAbsentReason = "sky-surface-program-absent";
const skySnapshotKind = "native-shared-sky-snapshot";
const skySnapshotLabel = "Native shared sky snapshot";
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

export function parseNativeSkyMaterialsListing(input: unknown): NativeSkyMaterialsListing {
  const label = skySnapshotLabel;
  if (!isPlainRecord(input) || input.kind !== skySnapshotKind || input.schemaVersion !== skySnapshotSchemaVersion || input.map !== sharedSkyRecordId) {
    throw new Error(`${label} must be a ${skySnapshotKind} schema ${skySnapshotSchemaVersion} record of map ${sharedSkyRecordId}.`);
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

export async function loadNativeSkyMaterialsListing(snapshot: NativeSkyBundleFile, signal: AbortSignal): Promise<NativeSkyMaterialsListing> {
  const bytes = await fetchVerifiedNativeResource(snapshot.resource, snapshot.sha256, signal, snapshot.bytes);
  return parseNativeSkyMaterialsListing(decodeNativeJsonResource(bytes, skySnapshotLabel));
}

export function joinNativeSkySurface(listing: NativeSkyMaterialsListing, sourceReference: string | null): NativeSkySurfaceJoin {
  if (sourceReference === null) return { kind: "gap", reasons: [skySurfaceSourceReferenceNoneReason] };
  const entry = listing.get(rootKey(sourceReference));
  if (entry === undefined) return { kind: "gap", reasons: [skySurfaceMaterialUnlistedReason] };
  if (entry.programMaterialId === null) return { kind: "gap", reasons: entry.gapReasons.length ? entry.gapReasons : [skySurfaceProgramAbsentReason] };
  return { kind: "program", programMaterialId: entry.programMaterialId };
}

function colorModifierNodesOf(loaded: LoadedNativeMaterial): readonly string[] {
  return loaded.plan.status === "diagnostic" ? [] : loaded.plan.colourSources.filter(source => source.kind === "color-modifier").map(source => source.node);
}

async function librarySkySurface(settings: NativeSkyLibrarySettings, mesh: AbstractMesh): Promise<NativeSkySurface> {
  const sourceReference = readNativeSourceReference(mesh.material);
  const unbound = (status: NativeSkySurfaceStatus, programMaterialId: string | null, reasons: readonly string[]): NativeSkySurface =>
    ({ mesh, sourceReference, status, programMaterialId, reasons, library: null, colorModifierNodes: [] });
  const join = joinNativeSkySurface(settings.listing, sourceReference);
  if (join.kind === "gap") return unbound("program-gap", null, join.reasons);
  const loaded = await settings.loadProgram(join.programMaterialId, settings.signal);
  settings.signal.throwIfAborted();
  const library = createNativeMaterial(settings.scene, loaded, { sessionSeed: settings.sessionSeed, lighting: "unlit" });
  const inspected = library.inspect();
  if (inspected.status !== "compiled") { library.dispose(); return unbound("library-diagnostic", join.programMaterialId, inspected.reasons); }
  library.material.disableDepthWrite = true;
  library.material.forceDepthWrite = false;
  return { mesh, sourceReference, status: "library-compiled", programMaterialId: join.programMaterialId, reasons: [], library,
    colorModifierNodes: colorModifierNodesOf(loaded) };
}

function inspectSkySurface(surface: NativeSkySurface): NativeSkySurfaceInspection {
  return { mesh: surface.mesh.name, sourceReference: surface.sourceReference, programMaterialId: surface.programMaterialId, status: surface.status,
    reasons: surface.reasons };
}

export async function bindNativeSkyLibraryMaterials(settings: NativeSkyLibrarySettings): Promise<NativeSkyLibraryBinding> {
  const { scene, materialUniforms } = settings;
  const surfaces: NativeSkySurface[] = [];
  const compiled: CompiledNativeSkySurface[] = [];
  let environmentColours: SkyEnvironmentColourWriter | null = null;
  try {
    for (const mesh of settings.meshes) {
      const surface = await librarySkySurface(settings, mesh);
      surfaces.push(surface);
      if (surface.library !== null) compiled.push({ ...surface, library: surface.library, snapshotMaterial: mesh.material });
    }
    settings.signal.throwIfAborted();
    if (materialUniforms !== null && settings.environmentColours !== null) {
      environmentColours = bindSkyEnvironmentColours(compiled.map(surface => ({ nativeMaterial: surface.library, colorModifierNodes: surface.colorModifierNodes })),
        settings.environmentColours);
    }
  } catch (error) {
    for (const surface of compiled) surface.library.dispose();
    throw error;
  }
  const writeFrame = (uniforms: () => NativeMaterialUniforms) => {
    environmentColours?.write();
    const frameUniforms = uniforms();
    for (const surface of compiled) surface.library.update(frameUniforms);
  };
  if (materialUniforms !== null) writeFrame(materialUniforms);
  for (const surface of compiled) surface.mesh.material = surface.library.material;
  const observer = materialUniforms === null || compiled.length === 0 ? null : scene.onBeforeRenderObservable.add(() => writeFrame(materialUniforms));
  let disposed = false;
  return {
    surfaces: surfaces.map(inspectSkySurface),
    environmentColours: () => environmentColours?.inspection() ?? [],
    dispose() {
      if (disposed) return;
      disposed = true;
      if (observer) scene.onBeforeRenderObservable.remove(observer);
      for (const surface of compiled) {
        if (!surface.mesh.isDisposed() && surface.mesh.material === surface.library.material) surface.mesh.material = surface.snapshotMaterial;
        surface.library.dispose();
      }
    },
  };
}
