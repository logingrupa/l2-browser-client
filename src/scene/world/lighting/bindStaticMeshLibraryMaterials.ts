import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { RgbaBytes } from "../../../environment/model/nativeColourBytes";
import { staticMeshDrawnComposition } from "../../../environment/model/nativeDrawLightingStates";
import type { NativeLocalToWorld } from "../../../environment/model/staticMeshLocalToWorld";
import {
  createNativeMaterial, type LoadedNativeMaterial, type MaterialLighting, type NativeMaterial, type NativeMaterialUniforms,
} from "../../../materials/ue2/babylon/material";
import { readNativeSourceReference } from "../nativeSourceReference";
import type { NativeTileChunkPlacement } from "../nativeTileChunkManifest";
import { joinStaticMeshSlot, type StaticMeshMaterialsLoad } from "../staticMeshLibraryMaterials";
import type { StaticMeshLightList } from "./decodeHourlyLightingInputs";
import type { StagedLightingInput } from "./stagedLightingInput";
import type { StaticMeshVertexStreams } from "./loadStaticMeshVertexStreams";
import type { RebuildLightEnvironment } from "./rebuildShadowLights";
import { createStaticMeshInstanceColourGeometry, type StaticMeshInstanceColourGeometry } from "./staticMeshInstanceColourGeometry";
import { resolveStaticMeshOrdinaryTerm, type StaticMeshOrdinaryLightRecords } from "./staticMeshOrdinaryLights";
import {
  staticMeshLightingReasons, staticMeshPlacementInstanceColours, staticMeshPlacementLightingJoin, staticMeshVertexStreamsReason,
  type StaticMeshPlacementOrdinaryTerm, type StaticMeshSunFrame,
} from "./staticMeshPlacementLighting";

export type StaticMeshSlotStatus = "library-compiled" | "library-diagnostic" | "program-gap";

export interface StaticMeshSlotInspection {
  readonly sourceObject: string | null;
  readonly status: StaticMeshSlotStatus;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
  readonly meshes: number;
}

export interface StaticMeshPlacementLightingInspection {
  readonly litPlacements: number;
  readonly litMeshes: number;
  readonly unlitPlacementReasons: Readonly<Record<string, number>>;
  readonly rebuildCount: number;
  readonly lastRebuildHour: number | null;
  readonly heldReason: string | null;
  readonly ambient: RgbaBytes | null;
  readonly rebuildTrigger: { readonly status: "unresolved"; readonly reason: typeof staticMeshRebuildTriggerUnresolvedReason };
  readonly composition: typeof staticMeshDrawnComposition;
  readonly probes: readonly StaticMeshLitPlacementProbe[];
}

export interface StaticMeshLitPlacementProbe {
  readonly sourceActor: string;
  readonly exportIndex: number;
  readonly vertexZeroRgb: readonly [number, number, number];
}

export interface StaticMeshLibraryInspection {
  readonly gap: string | null;
  readonly lighting: StaticMeshPlacementLightingInspection;
  readonly meshCount: number;
  readonly statusCounts: Readonly<Record<StaticMeshSlotStatus, number>>;
  readonly slots: readonly StaticMeshSlotInspection[];
}

export interface StaticMeshPlacementSurfaces {
  readonly placement: NativeTileChunkPlacement;
  readonly meshes: readonly AbstractMesh[];
}

export type StaticMeshHourlyLightingFrame =
  | { readonly status: "resolved"; readonly sun: StaticMeshSunFrame; readonly ambient: RgbaBytes; readonly lightEnvironment: RebuildLightEnvironment }
  | { readonly status: "unresolved"; readonly reason: string };

export interface StaticMeshLibrarySettings {
  readonly scene: Scene;
  readonly load: StaticMeshMaterialsLoad;
  readonly sessionSeed: number;
  readonly uniforms: () => NativeMaterialUniforms;
  readonly loadProgram: (materialId: string, signal: AbortSignal) => Promise<LoadedNativeMaterial>;
  readonly lightLists: StagedLightingInput<ReadonlyMap<number, StaticMeshLightList>>;
  readonly ordinaryLightRecords: StaticMeshOrdinaryLightRecords;
  readonly hourlyLighting: () => StaticMeshHourlyLightingFrame;
  readonly loadVertexStreams: (resource: string, sha256: string, bytes: number, signal: AbortSignal) => Promise<StaticMeshVertexStreams>;
}

export interface StaticMeshLibraryBinding {
  addChunk(chunkId: string, placements: readonly StaticMeshPlacementSurfaces[]): Promise<void>;
  removeChunk(chunkId: string): void;
  update(lightingDirty: boolean): void;
  inspection(): StaticMeshLibraryInspection;
  dispose(): void;
}

interface BoundStaticMeshSlot {
  readonly mesh: AbstractMesh;
  readonly sourceObject: string | null;
  readonly status: StaticMeshSlotStatus;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
}

interface LitStaticMeshPlacement {
  readonly placement: NativeTileChunkPlacement;
  readonly list: StaticMeshLightList;
  readonly streams: StaticMeshVertexStreams;
  readonly localToWorld: NativeLocalToWorld;
  readonly ordinary: StaticMeshPlacementOrdinaryTerm;
  readonly geometries: readonly StaticMeshInstanceColourGeometry[];
  vertexZeroRgb: readonly [number, number, number];
}

interface BoundStaticMeshChunk {
  readonly slots: readonly BoundStaticMeshSlot[];
  readonly litPlacements: readonly LitStaticMeshPlacement[];
  readonly unlitPlacementReasons: readonly string[];
}

const staticMeshRebuildTriggerUnresolvedReason = "static-mesh-hourly-rebuild-trigger-unresolved";

const gltfPrimitivePointerPattern = /^\/meshes\/(\d+)\/primitives\/(\d+)$/;
const byteMaximum = 255;

const compareSourceObjects = (left: string | null, right: string | null) =>
  left === right ? 0 : left === null ? -1 : right === null ? 1 : left.toLowerCase() < right.toLowerCase() ? -1 : 1;

function slotInspections(slots: readonly BoundStaticMeshSlot[]): StaticMeshSlotInspection[] {
  const bySourceObject = new Map<string, StaticMeshSlotInspection>();
  for (const slot of slots) {
    const key = slot.sourceObject?.toLowerCase() ?? "";
    const listed = bySourceObject.get(key);
    bySourceObject.set(key, listed ? { ...listed, meshes: listed.meshes + 1 }
      : { sourceObject: slot.sourceObject, status: slot.status, programMaterialId: slot.programMaterialId, reasons: slot.reasons, meshes: 1 });
  }
  return [...bySourceObject.values()].sort((left, right) => compareSourceObjects(left.sourceObject, right.sourceObject));
}

function gltfPrimitiveOf(mesh: AbstractMesh): { readonly mesh: number; readonly primitive: number } | null {
  const pointers: unknown = mesh._internalMetadata?.gltf?.pointers;
  const matches = (Array.isArray(pointers) ? pointers : []).flatMap(pointer => {
    const match = typeof pointer === "string" ? gltfPrimitivePointerPattern.exec(pointer) : null;
    return match ? [{ mesh: Number(match[1]), primitive: Number(match[2]) }] : [];
  });
  return matches.length === 1 ? matches[0]! : null;
}

function primitiveVerticesOf(mesh: AbstractMesh, streams: StaticMeshVertexStreams): Uint32Array | null {
  const primitive = gltfPrimitiveOf(mesh);
  if (primitive === null || !(mesh instanceof Mesh)) return null;
  const joined = streams.primitives.find(entry => entry.mesh === primitive.mesh && entry.primitive === primitive.primitive);
  return joined !== undefined && joined.nativeVertices.length === mesh.getTotalVertices() ? joined.nativeVertices : null;
}

function countReasons(reasons: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}

export function bindStaticMeshLibraryMaterials(settings: StaticMeshLibrarySettings): StaticMeshLibraryBinding {
  const { scene, load } = settings;
  const lifetime = new AbortController();
  const pendingMaterials = new Map<string, Promise<NativeMaterial>>(), readyMaterials = new Map<string, NativeMaterial>();
  const litMaterials = new Set<NativeMaterial>();
  const pendingStreams = new Map<string, Promise<StaticMeshVertexStreams>>();
  const chunks = new Map<string, BoundStaticMeshChunk>();
  const pendingChunkTokens = new Map<string, object>();
  const sourceObjectByMesh = new WeakMap<AbstractMesh, string | null>();
  let latchedFrame: StaticMeshHourlyLightingFrame | null = null, rebuildCount = 0, heldReason: string | null = null;
  const createdMaterial = async (programMaterialId: string, lighting: MaterialLighting) => {
    const nativeMaterial = createNativeMaterial(scene, await settings.loadProgram(programMaterialId, lifetime.signal), { sessionSeed: settings.sessionSeed, lighting });
    if (lifetime.signal.aborted) { nativeMaterial.dispose(); lifetime.signal.throwIfAborted(); }
    readyMaterials.set(`${programMaterialId}:${lighting}`, nativeMaterial);
    if (lighting !== "unlit") litMaterials.add(nativeMaterial);
    return nativeMaterial;
  };
  const nativeMaterialFor = (programMaterialId: string, lighting: MaterialLighting) => {
    const key = `${programMaterialId}:${lighting}`;
    const ready = readyMaterials.get(key);
    if (ready) return Promise.resolve(ready);
    let pending = pendingMaterials.get(key);
    if (!pending) {
      pending = createdMaterial(programMaterialId, lighting);
      pendingMaterials.set(key, pending);
      const settled = () => { if (pendingMaterials.get(key) === pending) pendingMaterials.delete(key); };
      pending.then(settled, settled);
    }
    return pending;
  };
  const vertexStreamsFor = (resource: string, sha256: string, bytes: number) => {
    let pending = pendingStreams.get(sha256);
    if (!pending) {
      pending = settings.loadVertexStreams(resource, sha256, bytes, lifetime.signal);
      pendingStreams.set(sha256, pending);
      pending.catch(() => { if (pendingStreams.get(sha256) === pending) pendingStreams.delete(sha256); });
    }
    return pending;
  };
  const slotSourceObject = (mesh: AbstractMesh) => {
    if (!sourceObjectByMesh.has(mesh)) sourceObjectByMesh.set(mesh, readNativeSourceReference(mesh.material));
    return sourceObjectByMesh.get(mesh)!;
  };
  const boundSlot = async (mesh: AbstractMesh): Promise<BoundStaticMeshSlot & { readonly libraryMaterial: Material | null }> => {
    const sourceObject = slotSourceObject(mesh);
    const gap = (reasons: readonly string[]) => ({ mesh, sourceObject, status: "program-gap" as const, programMaterialId: null, reasons, libraryMaterial: null });
    if (load.listing === null) return gap([load.gap]);
    const join = joinStaticMeshSlot(load.listing, sourceObject);
    if (join.kind === "gap") return { ...gap(join.reasons), sourceObject: join.sourceObject };
    const nativeMaterial = await nativeMaterialFor(join.programMaterialId, "unlit");
    const inspected = nativeMaterial.inspect();
    const compiled = inspected.status === "compiled";
    return { mesh, sourceObject: join.sourceObject, status: compiled ? "library-compiled" : "library-diagnostic", programMaterialId: join.programMaterialId,
      reasons: compiled ? [] : inspected.reasons, libraryMaterial: compiled ? nativeMaterial.material : null };
  };
  const latchFrame = () => {
    const frame = settings.hourlyLighting();
    if (frame.status === "unresolved") { heldReason = frame.reason; return; }
    latchedFrame = frame;
    heldReason = null;
    rebuildCount += 1;
  };
  const colourPlacement = (lit: LitStaticMeshPlacement) => {
    if (latchedFrame?.status !== "resolved") return;
    const colours = staticMeshPlacementInstanceColours(lit.list, lit.streams, lit.localToWorld, lit.ordinary, latchedFrame.sun);
    lit.vertexZeroRgb = [colours[0]!, colours[1]!, colours[2]!];
    for (const geometry of lit.geometries) geometry.writeColours(colours);
  };
  const placementLighting = async (surfaces: StaticMeshPlacementSurfaces, slots: ReadonlyMap<AbstractMesh, BoundStaticMeshSlot>):
    Promise<{ readonly reason: string } | Omit<LitStaticMeshPlacement, "geometries" | "vertexZeroRgb"> & { readonly meshVertices: ReadonlyMap<Mesh, Uint32Array> }> => {
    const join = staticMeshPlacementLightingJoin(settings.lightLists, surfaces.placement);
    if (join.status === "unlit") return { reason: join.reason };
    if (latchedFrame?.status !== "resolved") return { reason: heldReason ?? staticMeshRebuildTriggerUnresolvedReason };
    const ordinaryLights = resolveStaticMeshOrdinaryTerm(join.list, settings.ordinaryLightRecords, latchedFrame.lightEnvironment);
    if (ordinaryLights.status !== "resolved") return { reason: ordinaryLights.reason };
    const pin = surfaces.placement.vertexStreams;
    if (pin.status !== "pinned") return { reason: pin.reason };
    const streams = await vertexStreamsFor(pin.resource, pin.sha256, pin.bytes);
    const streamsReason = staticMeshVertexStreamsReason(join.list, streams);
    if (streamsReason !== null) return { reason: streamsReason };
    const meshVertices = new Map<Mesh, Uint32Array>();
    for (const mesh of surfaces.meshes) {
      const slot = slots.get(mesh)!;
      if (slot.status !== "library-compiled") return { reason: slot.reasons[0] ?? slot.status };
      const vertices = primitiveVerticesOf(mesh, streams);
      if (vertices === null) return { reason: staticMeshLightingReasons.primitiveUnjoined };
      meshVertices.set(mesh as Mesh, vertices);
    }
    return { placement: surfaces.placement, list: join.list, streams, localToWorld: join.localToWorld,
      ordinary: { gain: join.gain, lights: ordinaryLights.value }, meshVertices };
  };
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (readyMaterials.size === 0) return;
    const uniforms = settings.uniforms();
    for (const nativeMaterial of readyMaterials.values()) nativeMaterial.update(uniforms);
    const frame = settings.hourlyLighting();
    if (frame.status !== "resolved") return;
    const ambient: readonly [number, number, number] = [frame.ambient[0] / byteMaximum, frame.ambient[1] / byteMaximum, frame.ambient[2] / byteMaximum];
    for (const nativeMaterial of litMaterials) nativeMaterial.setStaticMeshAmbient(ambient);
  });
  return {
    async addChunk(chunkId, placements) {
      if (lifetime.signal.aborted || chunks.has(chunkId)) return;
      const chunkToken = {};
      pendingChunkTokens.set(chunkId, chunkToken);
      if (latchedFrame === null) latchFrame();
      const slots = new Map<AbstractMesh, BoundStaticMeshSlot & { readonly libraryMaterial: Material | null }>();
      for (const mesh of placements.flatMap(surfaces => surfaces.meshes)) slots.set(mesh, await boundSlot(mesh));
      const litPlacements: LitStaticMeshPlacement[] = [], unlitPlacementReasons: string[] = [];
      const litMeshMaterials = new Map<Mesh, Material>();
      for (const surfaces of placements) {
        const lighting = await placementLighting(surfaces, slots);
        if ("reason" in lighting) { unlitPlacementReasons.push(lighting.reason); continue; }
        const geometries: StaticMeshInstanceColourGeometry[] = [];
        for (const [mesh, vertices] of lighting.meshVertices) {
          litMeshMaterials.set(mesh, (await nativeMaterialFor(slots.get(mesh)!.programMaterialId!, "vertex-modulate2x")).material);
          geometries.push(createStaticMeshInstanceColourGeometry(mesh, vertices));
        }
        const lit: LitStaticMeshPlacement = { placement: lighting.placement, list: lighting.list, streams: lighting.streams, localToWorld: lighting.localToWorld,
          ordinary: lighting.ordinary, geometries, vertexZeroRgb: [0, 0, 0] };
        colourPlacement(lit);
        litPlacements.push(lit);
      }
      lifetime.signal.throwIfAborted();
      if (pendingChunkTokens.get(chunkId) !== chunkToken) return;
      pendingChunkTokens.delete(chunkId);
      for (const slot of slots.values()) {
        const material = slot.mesh instanceof Mesh ? litMeshMaterials.get(slot.mesh) ?? slot.libraryMaterial : slot.libraryMaterial;
        if (material !== null) slot.mesh.material = material;
      }
      chunks.set(chunkId, { slots: [...slots.values()], litPlacements, unlitPlacementReasons });
    },
    removeChunk(chunkId) {
      pendingChunkTokens.delete(chunkId);
      chunks.delete(chunkId);
    },
    update(lightingDirty) {
      if (!lightingDirty && latchedFrame !== null) return;
      latchFrame();
      for (const chunk of chunks.values()) for (const lit of chunk.litPlacements) colourPlacement(lit);
    },
    inspection() {
      const boundChunks = [...chunks.values()];
      const slots = boundChunks.flatMap(chunk => chunk.slots);
      const litPlacements = boundChunks.flatMap(chunk => chunk.litPlacements);
      const statusCounts = { "library-compiled": 0, "library-diagnostic": 0, "program-gap": 0 };
      for (const slot of slots) statusCounts[slot.status] += 1;
      const lighting: StaticMeshPlacementLightingInspection = { litPlacements: litPlacements.length,
        litMeshes: litPlacements.reduce((sum, lit) => sum + lit.geometries.length, 0),
        unlitPlacementReasons: countReasons(boundChunks.flatMap(chunk => chunk.unlitPlacementReasons)), rebuildCount,
        lastRebuildHour: latchedFrame?.status === "resolved" ? latchedFrame.sun.hour : null, heldReason,
        ambient: latchedFrame?.status === "resolved" ? latchedFrame.ambient : null,
        rebuildTrigger: { status: "unresolved", reason: staticMeshRebuildTriggerUnresolvedReason }, composition: staticMeshDrawnComposition,
        probes: litPlacements.map(lit => ({ sourceActor: lit.placement.sourceActor, exportIndex: lit.placement.exportIndex, vertexZeroRgb: lit.vertexZeroRgb }))
          .sort((left, right) => left.exportIndex - right.exportIndex) };
      return { gap: load.gap, lighting, meshCount: slots.length, statusCounts, slots: slotInspections(slots) };
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      scene.onBeforeRenderObservable.remove(observer);
      chunks.clear();
      pendingChunkTokens.clear();
      for (const nativeMaterial of readyMaterials.values()) nativeMaterial.dispose();
      readyMaterials.clear();
      litMaterials.clear();
    },
  };
}
