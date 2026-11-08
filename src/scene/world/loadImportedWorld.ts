import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer, InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { applyTerrainSurfaces, type SurfaceInspection, type SurfaceManifest } from "./terrainSurfaces";
import { setupGrassStream, type GrassModel, type GrassStream } from "./grassInstances";
import { fnRepairFoliageCutouts } from "./foliageCutout";
import { fnDisabledSourceCollider } from "./sourceColliderPolicy";
import { worldModelRadius, worldVisibilityInRange } from "./worldVisibility";
import { loadWorldModel, verifiedWorldJson, WORLD_PINS, WORLD_SOURCE } from "./worldAssets";
import { WorldPlacementIndex } from "./worldPlacementIndex";

type Point = { x: number; y: number; z: number };
type Triple = [number, number, number];
interface Placement { id: string; position: Triple; rotationQuaternion: [number, number, number, number]; scale: Triple; mirrored?: boolean; }
interface WorldModel {
  id: string; file: string; sha256: string; category: string; sourceFbxSha256?: string; materialGuids?: string[];
  bounds: { minimum: Triple; maximum: Triple }; instances: Placement[]; instanceCount?: number;
}
interface Entry {
  model: WorldModel; radius: number; state: "idle" | "loading" | "ready" | "error";
  placementRadii: number[]; disabledColliderComponents: (string | null)[];
  roots: TransformNode[]; copies: InstantiatedEntries[]; container?: AssetContainer; pending?: Promise<void>; error?: Error;
}
interface StagedWorld {
  schemaVersion: number; sourceRoute: string; sourceVersion: string;
  terrain: { url: string; sha256: string };
  bundles: Record<"world-models" | "surfaces" | "locations", { manifestUrl: string; manifestSha256: string }>;
}
interface WorldManifest { sourceVersion: string; sourceRoute: string; models: WorldModel[]; limitations: string[]; }
interface Locations { sourceVersion: string; locations: { label: string; kind: string; position: Triple }[]; }

export interface ImportedWorld {
  terrainMeshes: AbstractMesh[];
  supportMeshes: AbstractMesh[];
  terrainSha256: string;
  spawnPoint: Vector3;
  minimum: Vector3;
  maximum: Vector3;
  update(target: Vector3, cameraRadius: number): void;
  prepareAt(position: Point, radius?: number): Promise<void>;
  isReadyAt(position: Point, radius?: number): boolean;
  inspection(): ImportedWorldInspection;
  dispose(): void;
}
export interface ImportedWorldInspection {
  mode: "talking-island"; sourceVersion: string; cameraRelative: boolean;
  sourcePlacements: number; modelVariants: number; loadedVariants: number; visiblePlacements: number;
  activeLoads: number; errors: { model: string; reason: string }[];
  correctedFoliageMaterials: number; disabledColliderPlacements: number;
  surface: SurfaceInspection; grass: ReturnType<GrassStream["inspection"]> | null;
  visibilityTransitions: number; limitations: string[];
}

const boundedLoadWorkerCount = 3;

const finite = (input: unknown, length: number): input is number[] => Array.isArray(input) && input.length === length && input.every(Number.isFinite);

const isViteIndexHtmlFallback = (content: string): boolean => /^\s*<!doctype html/i.test(content) || /^\s*<html/i.test(content);

export async function readStagedWorld(): Promise<StagedWorld | null> {
  const response = await fetch("/assets/world/manifest.json");
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`World staging manifest returned HTTP ${response.status}.`);
  const content = await response.text();
  if (isViteIndexHtmlFallback(content)) return null;
  const staged = JSON.parse(content) as StagedWorld;
  if (staged.schemaVersion !== 1 || staged.sourceRoute !== "unity-reference" || staged.sourceVersion !== WORLD_SOURCE ||
      staged.terrain?.sha256 !== WORLD_PINS.terrain || staged.bundles?.["world-models"]?.manifestSha256 !== WORLD_PINS.models ||
      staged.bundles?.surfaces?.manifestSha256 !== WORLD_PINS.surfaces || staged.bundles?.locations?.manifestSha256 !== WORLD_PINS.locations) {
    throw new Error("World staging receipt does not match the audited terrain/scenery/surface bundles. Run pnpm world:stage.");
  }
  return staged;
}

export async function loadImportedWorld(scene: Scene): Promise<ImportedWorld | null> {
  const staged = await readStagedWorld();
  if (!staged) return null;
  if (!scene.useRightHandedSystem) throw new Error("Imported world requires its original right-handed coordinate frame.");
  if (!scene.floatingOriginMode) throw new Error("Imported world requires Babylon camera-relative rendering.");
  const [manifest, locations, surfaceManifest] = await Promise.all([
    verifiedWorldJson<WorldManifest>(staged.bundles["world-models"].manifestUrl, WORLD_PINS.models),
    verifiedWorldJson<Locations>(staged.bundles.locations.manifestUrl, WORLD_PINS.locations),
    verifiedWorldJson<SurfaceManifest>(staged.bundles.surfaces.manifestUrl, WORLD_PINS.surfaces),
  ]);
  if (manifest.sourceVersion !== WORLD_SOURCE || manifest.sourceRoute !== "unity-reference" || !Array.isArray(manifest.models) ||
      locations.sourceVersion !== WORLD_SOURCE || !Array.isArray(locations.locations)) throw new Error("World source catalogs are incompatible.");
  const town = locations.locations.find(location => location.label === "TalkingIsland" && location.kind === "source-music-region");
  if (!town || !finite(town.position, 3)) throw new Error("The retained town location anchor is missing.");
  const spawnPoint = Vector3.FromArray(town.position);
  const terrainContainer = await loadWorldModel(scene, staged.terrain.url, WORLD_PINS.terrain);
  const terrainMeshes = terrainContainer.meshes.filter(mesh => mesh.getTotalVertices() > 0);
  const supportMeshes: AbstractMesh[] = [];
  const entries: Entry[] = [];
  const collisionPlacements = new WorldPlacementIndex<Entry>();
  let grass: GrassStream | undefined;
  let surface: SurfaceInspection | undefined;
  let disposeSurfaces: (() => void) | undefined;
  let disposed = false, active = 0, foliageRepairs = 0, disabledColliders = 0, visibilityTransitions = 0;
  let lastUpdate = -Infinity;
  let target = spawnPoint.clone(), reach = 160;
  const failures: { model: string; reason: string }[] = [];
  const minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity);
  const observer = scene.onDisposeObservable.addOnce(() => dispose());

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scene.onDisposeObservable.remove(observer);
    grass?.dispose();
    for (const entry of entries) {
      entry.copies.forEach(copy => copy.dispose()); entry.roots.forEach(root => root.dispose()); entry.container?.dispose();
    }
    disposeSurfaces?.();
    terrainContainer.dispose();
    supportMeshes.length = 0;
  }
  function separation(placement: Placement, radius: number, point: Point): number {
    return Math.hypot(placement.position[0] - point.x, placement.position[1] - point.y, placement.position[2] - point.z)
      - radius;
  }
  function nearby(position: Point, radius: number): Entry[] {
    return collisionPlacements.nearby(position, radius);
  }
  async function load(entry: Entry): Promise<void> {
    if (entry.pending) return entry.pending;
    if (disposed) throw new Error("World is disposed.");
    entry.state = "loading"; active++;
    entry.pending = (async () => {
      try {
        const container = await loadWorldModel(scene, `/assets/world/world-models/${entry.model.file}`, entry.model.sha256);
        if (disposed) { container.dispose(); throw new Error("World was disposed during scenery loading."); }
        entry.container = container;
        foliageRepairs += fnRepairFoliageCutouts(container, entry.model.id, entry.model.sha256);
        for (const [index, placement] of entry.model.instances.entries()) {
          const root = new TransformNode(`world:${placement.id}`, scene);
          entry.roots.push(root);
          root.position.copyFromFloats(...placement.position);
          root.rotationQuaternion = Quaternion.FromArray(placement.rotationQuaternion);
          root.scaling.copyFromFloats(...placement.scale);
          const copy = container.instantiateModelsToScene(name => `${placement.id}:${name}`, false, { doNotInstantiate: placement.mirrored === true });
          entry.copies.push(copy);
          for (const node of copy.rootNodes) node.parent = root;
          root.computeWorldMatrix(true); root.freezeWorldMatrix();
          const disabled = entry.disabledColliderComponents[index];
          if (disabled) disabledColliders++;
          for (const mesh of root.getChildMeshes()) {
            const collision = !disabled && entry.model.category !== "effect";
            const walking = collision && entry.model.category !== "tree";
            mesh.metadata = { ...mesh.metadata, worldCollision: collision, worldSupportsWalking: walking, worldPlacement: placement.id, worldModel: entry.model.id };
            mesh.isPickable = collision;
            mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix();
            if (collision && mesh.getTotalVertices() > 0) supportMeshes.push(mesh);
          }
          root.setEnabled(false);
        }
        entry.state = "ready";
      } catch (error) {
        entry.error = error instanceof Error ? error : new Error(String(error));
        entry.state = "error";
        failures.push({ model: entry.model.id, reason: entry.error.message });
        throw entry.error;
      } finally { active--; }
    })();
    return entry.pending;
  }
  function refresh(): void {
    if (disposed) return;
    grass?.refresh();
    const pending: { entry: Entry; distance: number }[] = [];
    for (const entry of entries) {
      let nearest = Infinity;
      entry.model.instances.forEach((placement, index) => {
        const distance = separation(placement, entry.placementRadii[index]!, target);
        nearest = Math.min(nearest, distance);
        const root = entry.roots[index];
        if (root) {
          const visible = worldVisibilityInRange(distance, reach, root.isEnabled());
          if (visible !== root.isEnabled()) { root.setEnabled(visible); visibilityTransitions++; }
        }
      });
      if (nearest < reach && entry.state === "idle") pending.push({ entry, distance: nearest });
    }
    pending.sort((a, b) => a.distance - b.distance);
    for (const { entry } of pending) {
      if (active >= boundedLoadWorkerCount) break;
      void load(entry).then(refresh, refresh);
    }
  }
  async function prepareAt(position: Point, radius = 24): Promise<void> {
    const pending = nearby(position, radius);
    let cursor = 0;
    await Promise.all(Array.from({ length: boundedLoadWorkerCount }, async () => {
      while (cursor < pending.length) { const entry = pending[cursor++]; if (entry) await load(entry); }
    }));
  }
  try {
    if (terrainMeshes.length !== 4) throw new Error("The staged terrain must contain exactly four tile meshes.");
    terrainContainer.addAllToScene();
    for (const mesh of terrainMeshes) {
      mesh.metadata = { ...mesh.metadata, worldCollision: true, worldSupportsWalking: true, worldTerrain: true };
      mesh.isPickable = true;
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      minimum.minimizeInPlace(bounds.minimumWorld); maximum.maximizeInPlace(bounds.maximumWorld);
    }
    surface = await applyTerrainSurfaces(scene, terrainMeshes, surfaceManifest, cleanup => { disposeSurfaces = cleanup; });
    const grassModels: GrassModel[] = [];
    for (const model of manifest.models) {
      if (!/^[A-Za-z0-9._-]+\.glb$/.test(model.file) || !/^[a-f0-9]{64}$/.test(model.sha256) || !Array.isArray(model.instances) ||
          !finite(model.bounds?.minimum, 3) || !finite(model.bounds?.maximum, 3)) throw new Error("Invalid world model descriptor.");
      if (model.category === "grass") { grassModels.push(model as unknown as GrassModel); continue; }
      for (const placement of model.instances) {
        if (!finite(placement.position, 3) || !finite(placement.scale, 3) || !finite(placement.rotationQuaternion, 4) ||
            Math.abs(Math.hypot(...placement.rotationQuaternion) - 1) > 0.001 || placement.scale.some(value => value === 0) ||
            (placement.mirrored === true) !== (placement.scale[0] * placement.scale[1] * placement.scale[2] < 0)) {
          throw new Error(`Invalid source placement transform: ${placement.id}`);
        }
      }
      const radius = worldModelRadius(model.bounds.minimum, model.bounds.maximum);
      const entry: Entry = {
        model, radius, state: "idle", roots: [], copies: [],
        placementRadii: model.instances.map(placement => radius * Math.max(...placement.scale.map(Math.abs))),
        disabledColliderComponents: model.instances.map(placement => fnDisabledSourceCollider(model, placement)),
      };
      entries.push(entry);
      model.instances.forEach((placement, index) => {
        if (model.category === "effect" || entry.disabledColliderComponents[index]) return;
        collisionPlacements.add(entry, { x: placement.position[0], y: placement.position[1], z: placement.position[2] }, entry.placementRadii[index]!);
      });
    }
    await prepareAt(spawnPoint, reach);
    grass = await setupGrassStream(scene, { getTarget: () => target }, grassModels, () => !disposed);
    refresh();
    const verifiedSurface = surface;
    return {
      terrainMeshes, supportMeshes, spawnPoint, minimum, maximum, terrainSha256: WORLD_PINS.terrain,
      update: (point, cameraRadius) => {
        target.copyFrom(point); reach = Math.max(160, Math.min(cameraRadius * 0.4, 1600));
        if (performance.now() - lastUpdate > 400) { lastUpdate = performance.now(); refresh(); }
      },
      prepareAt,
      isReadyAt: (position, radius = 1) => {
        let ready = !disposed;
        for (const entry of nearby(position, radius)) {
          if (entry.state !== "ready") ready = false;
          if (entry.state === "idle") void load(entry).then(refresh, refresh);
        }
        return ready;
      },
      inspection: () => ({
        mode: "talking-island", sourceVersion: WORLD_SOURCE, cameraRelative: scene.floatingOriginMode,
        sourcePlacements: manifest.models.reduce((count, model) => count + (model.instanceCount ?? model.instances.length), 0),
        modelVariants: manifest.models.length, loadedVariants: entries.filter(entry => entry.state === "ready").length,
        visiblePlacements: entries.reduce((count, entry) => count + entry.roots.filter(root => root.isEnabled()).length, 0),
        activeLoads: active, errors: [...failures], correctedFoliageMaterials: foliageRepairs, disabledColliderPlacements: disabledColliders,
        surface: verifiedSurface, grass: grass?.inspection() ?? null, visibilityTransitions, limitations: manifest.limitations,
      }),
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
