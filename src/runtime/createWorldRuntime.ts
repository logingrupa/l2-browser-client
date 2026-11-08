import type { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MockWorldAdapter } from "../world/MockWorldAdapter";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import { attachWorldCamera } from "../camera/WorldCamera";
import { EntityRegistry } from "../entities/EntityRegistry";
import { attachTargeting } from "../entities/attachTargeting";
import { WorldInterface } from "../ui/WorldInterface";
import type { WorldPosition } from "../world/worldTypes";
import { projectPosition } from "../scene/projectPosition";
import { getImportedEnvironment } from "../scene/environmentContext";
import { createWorldNavigation } from "../world/meshNavigation";
import type { ImportedWorldInspection } from "../scene/world/loadImportedWorld";
import { attachAssetImport } from "../ui/AssetImportPanel";
import { isSceneSuspended, setSceneSuspended } from "../engine/renderSuspension";
import { loadNativeAppearanceSet, nativeOrProceduralCharacterFactory } from "../assets/native/nativeOrProceduralCharacter";
import { getWorldCanvas } from "../scene/getWorldCanvas";

export function createWorldRuntime(scene: Scene, suppliedAdapter?: GameWorldAdapter): () => void {
  const canvas = getWorldCanvas(scene.getEngine());
  if (!canvas) throw new Error("The world needs a rendering canvas.");
  if (!(scene.getCameraByName("World camera") instanceof ArcRotateCamera)) throw new Error("The authored World camera must be an ArcRotateCamera.");
  const world = getImportedEnvironment(scene);
  const navigation = world ? createWorldNavigation({
    terrainMeshes: world.terrainMeshes, obstacleMeshes: () => world.supportMeshes, origin: world.spawnPoint,
    isReady: (from, to) => world.isReadyAt(from, 1) && world.isReadyAt(to, 1),
  }) : undefined;
  const adapter = suppliedAdapter ?? new MockWorldAdapter(navigation);
  const standOnNavigationSupportOrCourtyardPlane = navigation
    ? (position: WorldPosition) => navigation.ground(position)
    : (position: WorldPosition) => position;
  let isDisposed = false;
  let registry: EntityRegistry;
  const interfaceView = new WorldInterface(adapter, () => registry, canvas, world ? { location: "Talking Island", coordinateUnit: "" } : undefined);
  const nativeLoads = new AbortController();
  const createNativeHumanOrProceduralVisual = nativeOrProceduralCharacterFactory(loadNativeAppearanceSet(nativeLoads.signal));
  registry = new EntityRegistry(scene, adapter, interfaceView.labels, (message) => interfaceView.showStatus(message), {
    createVisual: createNativeHumanOrProceduralVisual,
    ground: standOnNavigationSupportOrCourtyardPlane,
  });
  const detachCamera = attachWorldCamera(scene, canvas);
  const detachTargeting = attachTargeting(scene, registry, adapter, navigation);
  const importHost = interfaceView.root.querySelector<HTMLElement>(".secondary-actions");
  const detachAssetImport = attachAssetImport(scene, canvas, {
    ...(importHost ? { host: importHost } : {}), onOpenChange: open => setSceneSuspended(scene, open),
  });
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (isSceneSuspended(scene)) return;
    const deltaTimeSeconds = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1);
    adapter.advance(deltaTimeSeconds);
    registry.update(deltaTimeSeconds);
    interfaceView.update(deltaTimeSeconds, scene.getEngine().getFps());
    const camera = scene.activeCamera;
    if (camera instanceof ArcRotateCamera) {
      const playerPosition = registry.localPlayerPosition;
      if (world && playerPosition) {
        camera.setTarget(playerPosition.add(new Vector3(0, 0.5, 0)));
        world.update(camera.target, camera.radius);
      }
      canvas.dataset.cameraAlpha = String(camera.alpha);
      canvas.dataset.cameraBeta = String(camera.beta);
      canvas.dataset.cameraRadius = String(camera.radius);
    }
  });
  const readOnlyDiagnostics = {
    projectPosition: (position: WorldPosition) => {
      const projected = projectPosition(scene, position);
      return { x: projected.x, y: projected.y };
    },
    snapshot: () => {
      const camera = scene.activeCamera;
      const ground = scene.getMeshByName("Courtyard ground");
      const bounds = ground?.getBoundingInfo().boundingBox;
      return {
        entities: registry.snapshot(), selectedEntityId: registry.selectedEntityId,
        sceneMeshCount: scene.meshes.length, isDisposed,
        camera: camera instanceof ArcRotateCamera ? { alpha: camera.alpha, beta: camera.beta, radius: camera.radius } : null,
        environment: {
          mode: world ? "island" as const : "courtyard" as const,
          groundWidth: world ? world.maximum.x - world.minimum.x : bounds ? bounds.maximumWorld.x - bounds.minimumWorld.x : 0,
          lightIntensity: scene.getLightByName("Sunlight")?.intensity ?? 0,
          cameraRelative: scene.floatingOriginMode,
          world: world?.inspection() ?? null,
        },
      };
    },
  };
  window.__worldDiagnostics = readOnlyDiagnostics;
  if (world && registry.localPlayerPosition && scene.activeCamera instanceof ArcRotateCamera) {
    scene.activeCamera.setTarget(registry.localPlayerPosition.add(new Vector3(0, 0.5, 0)));
  }
  interfaceView.showStatus(world ? "Talking Island ready" : "World ready");
  return () => {
    if (isDisposed) return;
    isDisposed = true;
    nativeLoads.abort();
    scene.onBeforeRenderObservable.remove(observer);
    detachAssetImport(); setSceneSuspended(scene, false);
    detachTargeting(); detachCamera(); registry.dispose(); interfaceView.dispose(); adapter.dispose();
    if (window.__worldDiagnostics === readOnlyDiagnostics) delete window.__worldDiagnostics;
  };
}

export type WorldDiagnostics = { projectPosition: (position: WorldPosition) => { x: number; y: number }; snapshot: () => {
  entities: ReturnType<EntityRegistry["snapshot"]>;
  selectedEntityId: string | null; sceneMeshCount: number; isDisposed: boolean;
  camera: { alpha: number; beta: number; radius: number } | null;
  environment: { mode: "island" | "courtyard"; groundWidth: number; lightIntensity: number; cameraRelative: boolean; world: ImportedWorldInspection | null };
} };

declare global { interface Window { __worldDiagnostics?: WorldDiagnostics } }
