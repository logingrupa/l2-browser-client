import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer, InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
import { sha256 } from "../../assets/package/readAssetPackage";
import { nativeResourceUrl } from "../../assets/native/nativeResourceUrl";
import { applyNativeTerrainPreview, type NativeTerrainPreview } from "./nativeTerrainPreview";
import { attachNativeBspSupport } from "./nativeBspSupport";
import { nativeBspResources } from "./nativeBspResources";
import { parseNativeTerrainPatches, validateSourceTerrainPatch, type NativeTerrainPatch } from "./nativeTerrainPatch";

interface Resource { file: string; sha256: string; bytes: number; }
interface Model { id: string; sourceObject: string; model: Resource; archive: Resource; }
interface Placement { id: string; modelId: string; sourceMesh: string; matrix: number[]; materialOverrides: unknown[]; }
export interface NativeBspResource {
  id: string; sourceModel: string; sourceBrush: string; sourceMapSha256: string;
  model: Resource; source: Resource; supportPlacementIds: string[];
}
interface UnsupportedRuntimeMaterial {
  modelId: string; sourceObject: string; runtimeStatus: string; graphManifest: string;
  runtimeGaps: string[]; placementIds: string[];
}
interface SurfaceSpawnCandidate {
  sourcePosition: [number, number, number]; gltfGroundPosition: [number, number, number];
  nativeSpawnVerified: false; collisionVerified: false;
}
export interface NativeSectionManifest {
  schemaVersion: 1; kind: "native-map-section-runtime";
  resourceRoots: { terrain: "../map-section"; models: "../map-section-models" };
  terrain: Resource & { materialStatus: string }; models: Model[]; placements: Placement[];
  support: "section-products-ready-for-runtime-validation"; errors: []; gaps: string[];
  surfaceSpawnCandidate?: SurfaceSpawnCandidate;
  unsupportedRuntimeMaterials?: UnsupportedRuntimeMaterial[];
  /** Final ULevel.Model polygons, separately qualified from static models. */
  bsp?: NativeBspResource[];
  /** Additive source-qualified geometry; the original terrain stays unchanged. */
  terrainPatches?: NativeTerrainPatch[];
}
interface SectionRecord { id: string; manifest: string; manifestSha256: string; }
interface Instance { source: Placement; root: TransformNode; copy: InstantiatedEntries; }
export interface NativeSection {
  readonly manifest: NativeSectionManifest;
  readonly manifestSha256: string;
  readonly terrainMeshes: readonly AbstractMesh[];
  readonly supportMeshes?: readonly AbstractMesh[];
  readonly minimum: Vector3;
  readonly maximum: Vector3;
  readonly spawnCandidate: Vector3 | null;
  inspection(): ReturnType<typeof inspect>;
  setTerrainPreview(enabled: boolean): void;
  dispose(): void;
}

const HASH = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finiteArray = (value: unknown, length: number): value is number[] => Array.isArray(value) && value.length === length && value.every(item => typeof item === "number" && Number.isFinite(item));
function resource(value: unknown, expression: RegExp): value is Resource {
  return object(value) && typeof value.file === "string" && expression.test(value.file) &&
    typeof value.sha256 === "string" && HASH.test(value.sha256) && typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= 128 * 1024 * 1024;
}

/** Reject unsupported relationships instead of silently dropping source data. */
export function parseNativeSection(input: unknown): NativeSectionManifest {
  if (!object(input) || input.schemaVersion !== 1 || input.kind !== "native-map-section-runtime" ||
    input.support !== "section-products-ready-for-runtime-validation" || !Array.isArray(input.errors) || input.errors.length ||
    !object(input.resourceRoots) || input.resourceRoots.terrain !== "../map-section" || input.resourceRoots.models !== "../map-section-models" ||
    !resource(input.terrain, /^terrain\.glb$/) || !("materialStatus" in input.terrain) || typeof input.terrain.materialStatus !== "string" ||
    !Array.isArray(input.models) || input.models.length < 1 || input.models.length > 128 ||
    !Array.isArray(input.placements) || input.placements.length < 1 || input.placements.length > 4096 ||
    !Array.isArray(input.gaps) || !input.gaps.every(item => typeof item === "string")) throw new Error("Native section manifest is invalid or incomplete.");
  const models = new Set<string>(), placements = new Set<string>();
  parseNativeTerrainPatches(input.terrainPatches);
  for (const model of input.models as unknown[]) {
    if (!object(model) || typeof model.id !== "string" || typeof model.sourceObject !== "string" || !model.sourceObject ||
      model.id !== `interlude:${model.sourceObject}` || models.has(model.id) ||
      !resource(model.model, /^[a-f0-9]{64}\/model\.glb$/) || !resource(model.archive, /^[a-f0-9]{64}\/asset\.l2asset$/) ||
      model.archive.file !== `${model.archive.sha256}/asset.l2asset` || model.model.file !== `${model.archive.sha256}/model.glb`) {
      throw new Error("Native section model identity/path is invalid.");
    }
    models.add(model.id);
  }
  for (const placement of input.placements as unknown[]) {
    if (!object(placement) || typeof placement.id !== "string" || !placement.id || placements.has(placement.id) ||
      typeof placement.modelId !== "string" || !models.has(placement.modelId) || typeof placement.sourceMesh !== "string" || !placement.sourceMesh ||
      !finiteArray(placement.matrix, 16) || placement.matrix[3] !== 0 || placement.matrix[7] !== 0 || placement.matrix[11] !== 0 || placement.matrix[15] !== 1 ||
      Math.abs(Matrix.FromArray(placement.matrix).determinant()) < 1e-12 ||
      !Array.isArray(placement.materialOverrides) || placement.materialOverrides.length) throw new Error("Native section placement is invalid or has unsupported material overrides.");
    placements.add(placement.id);
  }
  if (models.size !== new Set(input.placements.map((item: Placement) => item.modelId)).size) throw new Error("Native section contains unplaced models.");
  if (input.bsp !== undefined) {
    if (!Array.isArray(input.bsp) || !input.bsp.length || input.bsp.length > 4) throw new Error("Native BSP scope is unsupported.");
    const ids = new Set<string>();
    for (const bsp of input.bsp) {
      const qualified = object(bsp) && typeof bsp.id === "string" && Object.hasOwn(nativeBspResources, bsp.id) ? nativeBspResources[bsp.id] : undefined;
      // This is deliberately a qualified scope, not a claim that arbitrary BSP
      // polygons, flags, lightmaps or collision branches have been implemented.
      if (!object(bsp) || !qualified || typeof bsp.id !== "string" || ids.has(bsp.id) || bsp.sourceModel !== "20_20.Model798" ||
        bsp.sourceBrush !== qualified.brush || bsp.sourceMapSha256 !== "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4" ||
        !resource(bsp.model, /^bsp-(?:floor|command-(?:walls|floor|ceiling))\.glb$/) || bsp.model.file !== `${qualified.stem}.glb` ||
        !resource(bsp.source, /^bsp-(?:floor|command-(?:walls|floor|ceiling))\.json$/) || bsp.source.file !== `${qualified.stem}.json` ||
        !Array.isArray(bsp.supportPlacementIds) || bsp.supportPlacementIds.length !== 1 ||
        bsp.supportPlacementIds[0] !== qualified.placement || !placements.has(bsp.supportPlacementIds[0])) {
        throw new Error("Native BSP identity, resources or support scope is invalid.");
      }
      ids.add(bsp.id);
    }
  }
  if (input.surfaceSpawnCandidate !== undefined) {
    const candidate = input.surfaceSpawnCandidate;
    if (!object(candidate) || !finiteArray(candidate.sourcePosition, 3) || !finiteArray(candidate.gltfGroundPosition, 3) ||
      candidate.nativeSpawnVerified !== false || candidate.collisionVerified !== false) {
      throw new Error("Native section surface candidate has invalid coordinates or unsupported verification claims.");
    }
    const source = candidate.sourcePosition, converted = candidate.gltfGroundPosition;
    if ([0, 2, 1].some((axis, index) => Math.abs(source[axis]! * .01 - converted[index]!) > .00001)) {
      throw new Error("Native section surface candidate has invalid coordinates or unsupported verification claims.");
    }
  }
  if (input.unsupportedRuntimeMaterials !== undefined) {
    if (!Array.isArray(input.unsupportedRuntimeMaterials)) throw new Error("Native material gap coverage is invalid.");
    const sourcePlacements = input.placements as Placement[];
    const reported = new Set<string>();
    for (const gap of input.unsupportedRuntimeMaterials as unknown[]) {
      if (!object(gap) || typeof gap.modelId !== "string" || !models.has(gap.modelId) || reported.has(gap.modelId) ||
        gap.modelId !== `interlude:${gap.sourceObject}` || typeof gap.runtimeStatus !== "string" ||
        gap.graphManifest !== "native-materials/graph.json" || !Array.isArray(gap.runtimeGaps) ||
        !gap.runtimeGaps.every(value => typeof value === "string") || !Array.isArray(gap.placementIds) ||
        gap.placementIds.length !== new Set(gap.placementIds).size ||
        gap.placementIds.length !== sourcePlacements.filter(p => p.modelId === gap.modelId).length ||
        !gap.placementIds.every(id => sourcePlacements.some(p => p.id === id && p.modelId === gap.modelId))) {
        throw new Error("Native material gap coverage differs from source placements.");
      }
      reported.add(gap.modelId);
    }
  }
  return input as unknown as NativeSectionManifest;
}

async function stagedSection(signal: AbortSignal, identity: string): Promise<{ record: SectionRecord; catalog: Record<string, unknown> } | null> {
  const response = await fetch(nativeResourceUrl("/l2/catalog.json"), { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Native catalog returned HTTP ${response.status}.`);
  const content = await response.text();
  if (/^\s*(?:<!doctype html|<html)/i.test(content)) return null;
  const catalog: unknown = JSON.parse(content);
  if (!object(catalog) || catalog.schemaVersion !== 1 || !Array.isArray(catalog.sections)) throw new Error("Native section catalog is invalid. Run pnpm assets:migrate --stage-runtime.");
  const ids = new Set<string>();
  let found: SectionRecord | null = null;
  for (const record of catalog.sections as unknown[]) {
    if (!object(record) || typeof record.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(record.id) || ids.has(record.id) ||
      typeof record.manifestSha256 !== "string" || !HASH.test(record.manifestSha256) ||
      record.manifest !== `/l2/maps/${record.manifestSha256}/map-section-runtime/manifest.json`) throw new Error("Native section catalog identity/hash/path is invalid.");
    ids.add(record.id);
    if (record.id === identity) found = record as unknown as SectionRecord;
  }
  return found ? { record: found, catalog } : null;
}

async function verifiedBytes(url: string, hash: string, signal: AbortSignal, length?: number): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(nativeResourceUrl(url), { signal });
  if (!response.ok) throw new Error(`Native section resource returned HTTP ${response.status}: ${url}`);
  const buffer = await response.arrayBuffer();
  signal.throwIfAborted();
  const bytes = new Uint8Array(buffer);
  if (length !== undefined && bytes.byteLength !== length || await sha256(bytes) !== hash) throw new Error(`Native section resource hash/length mismatch: ${url}`);
  return bytes;
}

/** Staged GLBs embed their dependencies; reject an unpinned external fetch. */
export function validateSectionGlb(bytes: Uint8Array<ArrayBuffer>): Record<string, unknown> {
  if (bytes.byteLength < 20) throw new Error("Native section resource is not a GLB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a || jsonLength > bytes.byteLength - 20) throw new Error("Native section GLB header is invalid.");
  const document: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  if (!object(document)) throw new Error("Native section GLB document is invalid.");
  for (const key of ["buffers", "images"] as const) {
    const entries = document[key];
    if (entries !== undefined && (!Array.isArray(entries) || entries.some(entry => !object(entry) || "uri" in entry))) throw new Error("Native section GLB has an unpinned external dependency.");
  }
  return document;
}

function bounds(meshes: readonly AbstractMesh[]) {
  const minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    minimum.minimizeInPlace(box.minimumWorld); maximum.maximizeInPlace(box.maximumWorld);
  }
  if (![...minimum.asArray(), ...maximum.asArray()].every(Number.isFinite)) throw new Error("Native section has no finite geometry bounds.");
  return { minimum, maximum };
}
function inspect(terrain: readonly AbstractMesh[], instances: readonly Instance[], modelCount: number, disposed: boolean,
  preview: NativeTerrainPreview | null, previewEnabled: boolean, materialFailure: string | null, unsupported: readonly UnsupportedRuntimeMaterial[], bsp: readonly AbstractMesh[] = []) {
  const meshes = [...terrain, ...bsp, ...instances.flatMap(instance => instance.root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0))];
  const textures = new Set(meshes.flatMap(mesh => mesh.material?.getActiveTextures() ?? []));
  return {
    disposed, modelCount, placementCount: instances.length, terrainTriangles: terrain.reduce((sum, mesh) => sum + mesh.getTotalIndices()/3, 0),
    terrainBounds: disposed ? null : (() => { const value = bounds(terrain); return { minimum: value.minimum.asArray(), maximum: value.maximum.asArray() }; })(),
    placements: instances.map(instance => ({ id: instance.source.id, sourceMesh: instance.source.sourceMesh, modelId: instance.source.modelId,
      sourceMatrix: [...instance.source.matrix], worldMatrix: [...instance.root.getWorldMatrix().asArray()],
      meshes: instance.root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0).map(mesh => ({ name: mesh.name, material: mesh.material?.name ?? null })) })),
    finiteBounds: disposed ? false : meshes.every(mesh => { const value = bounds([mesh]); return [...value.minimum.asArray(), ...value.maximum.asArray()].every(Number.isFinite); }),
    textureCount: textures.size, texturesReady: [...textures].every(texture => texture.isReady()),
    collisionVerified: false, terrainMaterial: preview && previewEnabled ? preview.status : "neutral-inspection", visualParity: "unverified",
    materialFailure, materialPreviewDetails: preview?.details ?? [],
    unsupportedRuntimeMaterials: unsupported,
    bspMeshes: bsp.length, bspTriangles: bsp.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0),
  };
}

/** Exact, bounded source placements. This importer supplies no terrain shader or collision policy. */
export async function loadNativeSection(scene: Scene, signal: AbortSignal, identity = "map-20-20-section"): Promise<NativeSection | null> {
  signal.throwIfAborted();
  if (scene.isDisposed || !scene.useRightHandedSystem) throw new Error("Native section requires a live right-handed scene.");
  const lifetime = new AbortController(), containers: AssetContainer[] = [], instances: Instance[] = [];
  let preview: NativeTerrainPreview | null = null, previewEnabled = true, materialFailure: string | null = null;
  let disposed = false;
  let support: ReturnType<typeof attachNativeBspSupport> | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); signal.removeEventListener("abort", dispose);
    scene.onDisposeObservable.remove(observer);
    support?.dispose();
    preview?.dispose();
    for (const instance of instances) { instance.copy.dispose(); instance.root.dispose(); }
    for (const container of containers) container.dispose();
  };
  const observer = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  async function load(url: string, descriptor: Resource) {
    const bytes = await verifiedBytes(url, descriptor.sha256, lifetime.signal, descriptor.bytes);
    const document = validateSectionGlb(bytes);
    const container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: ".glb", rootUrl: url.slice(0, url.lastIndexOf("/")+1),
      name: url.split("/").at(-1) ?? "section.glb", pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } } });
    if (disposed || scene.isDisposed) { container.dispose(); throw new Error("Native section was disposed during loading."); }
    // Babylon's optional extras extension is not enabled by every Editor host.
    // Bind retained mesh extras by the loader's exact glTF primitive pointer.
    const sourceMeshes: unknown[] = Array.isArray(document.meshes) ? document.meshes : [];
    for (const mesh of container.meshes) {
      const pointers: unknown = mesh._internalMetadata?.gltf?.pointers;
      if (!Array.isArray(pointers)) continue;
      const pointer = pointers.find((value: unknown) => typeof value === "string" && /^\/meshes\/\d+\/primitives\//.test(value));
      if (typeof pointer !== "string") continue;
      const source = sourceMeshes[Number(pointer.split("/")[2])];
      if (object(source) && object(source.extras)) mesh.metadata = { ...mesh.metadata,
        gltf: { ...mesh.metadata?.gltf, extras: { ...mesh.metadata?.gltf?.extras, ...source.extras } } };
    }
    containers.push(container); return container;
  }
  try {
    const staged = await stagedSection(lifetime.signal, identity);
    if (!staged) { dispose(); return null; }
    const { record, catalog } = staged;
    const manifest = parseNativeSection(JSON.parse(new TextDecoder().decode(await verifiedBytes(record.manifest, record.manifestSha256, lifetime.signal))));
    const base = `/l2/maps/${record.manifestSha256}/`;
    const terrain = await load(`${base}map-section/${manifest.terrain.file}`, manifest.terrain);
    const terrainContainers = [terrain];
    const terrainMeshes = terrain.meshes.filter(mesh => mesh.getTotalVertices() > 0);
    for (const patch of manifest.terrainPatches ?? []) {
      const container = await load(`${base}map-section/${patch.model.file}`, patch.model);
      if (container.skeletons.length || container.animationGroups.length) throw Error("Terrain patch cannot contain skeletons or animations.");
      const mesh = validateSourceTerrainPatch(container.meshes.filter(mesh => mesh.getTotalVertices() > 0), patch);
      mesh.metadata = { ...mesh.metadata, nativeTerrainPatch: structuredClone(patch) };
      terrainMeshes.push(mesh); terrainContainers.push(container);
    }
    for (const mesh of terrainMeshes) {
      mesh.metadata = { ...mesh.metadata, worldTerrain: true, worldSupportsWalking: true };
      mesh.isPickable = true;
    }
    try {
      if (Array.isArray(catalog.textures) && catalog.textures.length) {
        preview = await applyNativeTerrainPreview(scene, terrainMeshes, catalog, lifetime.signal);
      }
    } catch (error) {
      lifetime.signal.throwIfAborted();
      materialFailure = error instanceof Error ? error.message : "Native texture preview failed; neutral terrain retained.";
    }
    const templates = new Map<string, AssetContainer>();
    for (const model of manifest.models) templates.set(model.id, await load(`${base}map-section-models/${model.model.file}`, model.model));
    for (const placement of manifest.placements) {
      const template = templates.get(placement.modelId)!;
      const root = new TransformNode(placement.id, scene);
      const previous = new Set([...scene.meshes, ...scene.transformNodes, ...scene.skeletons, ...scene.animationGroups]);
      let copy: InstantiatedEntries;
      try { copy = template.instantiateModelsToScene(name => name, false, { doNotInstantiate: true }); }
      catch (error) {
        // Cloning is synchronous: a thrown clone can leave nodes in the scene
        // before Babylon returns its ownership handle. Roll back just those nodes.
        for (const created of [...scene.meshes, ...scene.transformNodes, ...scene.skeletons, ...scene.animationGroups]) {
          if (!previous.has(created)) created.dispose();
        }
        root.dispose(); throw error;
      }
      instances.push({ source: placement, root, copy });
      root.metadata = { nativePlacement: placement };
      root.setPreTransformMatrix(Matrix.FromArray(placement.matrix));
      for (const node of copy.rootNodes) node.parent = root;
      root.computeWorldMatrix(true); root.freezeWorldMatrix();
    }
    const bspMeshes: AbstractMesh[] = [];
    for (const record of manifest.bsp ?? []) {
      const container = await load(`${base}map-section-bsp/${record.model.file}`, record.model);
      const previousCount = bspMeshes.length;
      for (const mesh of container.meshes.filter(mesh => mesh.getTotalVertices() > 0)) {
        mesh.metadata = { ...mesh.metadata, nativeBsp: record }; bspMeshes.push(mesh);
      }
      if (bspMeshes.length === previousCount) throw new Error("Native BSP resource has no geometry.");
      container.addAllToScene();
    }
    for (const container of terrainContainers) container.addAllToScene();
    support = attachNativeBspSupport(manifest, new Map(instances.map(instance => [instance.source.id, instance.root])), bspMeshes);
    const all = [...terrainMeshes, ...bspMeshes, ...instances.flatMap(instance => instance.root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0))];
    const extent = bounds(all);
    lifetime.signal.throwIfAborted();
    return { manifest, manifestSha256: record.manifestSha256, terrainMeshes, supportMeshes: support.meshes, ...extent,
      spawnCandidate: manifest.surfaceSpawnCandidate ? Vector3.FromArray(manifest.surfaceSpawnCandidate.gltfGroundPosition) : null,
      inspection: () => inspect(terrainMeshes, instances, templates.size, disposed, preview, previewEnabled, materialFailure, manifest.unsupportedRuntimeMaterials ?? [], bspMeshes),
      setTerrainPreview(enabled) { previewEnabled = enabled; preview?.setEnabled(enabled); }, dispose };
  } catch (error) { dispose(); throw error; }
}
