import type { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { MockWorldAdapter } from "../world/MockWorldAdapter";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import { attachWorldCamera } from "../camera/WorldCamera";
import { EntityRegistry } from "../entities/EntityRegistry";
import { attachTargeting } from "../entities/attachTargeting";
import { WorldInterface } from "../ui/WorldInterface";
import type { WorldPosition } from "../world/worldTypes";
import { projectPosition } from "../scene/projectPosition";

/** This is the only composition point that chooses the synthetic adapter. */
export function createWorldRuntime(scene: Scene, adapter: GameWorldAdapter = new MockWorldAdapter()): () => void {
  const canvas = scene.getEngine().getRenderingCanvas();
  if (!canvas) throw new Error("The world needs a rendering canvas.");
  if (!(scene.getCameraByName("World camera") instanceof ArcRotateCamera)) throw new Error("The authored World camera must be an ArcRotateCamera.");
  let isDisposed = false;
  let registry: EntityRegistry;
  const interfaceView = new WorldInterface(adapter, () => registry, canvas);
  registry = new EntityRegistry(scene, adapter, interfaceView.labels, (message) => interfaceView.showStatus(message));
  const detachCamera = attachWorldCamera(scene, canvas);
  const detachTargeting = attachTargeting(scene, registry, adapter);
  const observer = scene.onBeforeRenderObservable.add(() => {
    const deltaTimeSeconds = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1);
    adapter.advance(deltaTimeSeconds);
    registry.update(deltaTimeSeconds);
    interfaceView.update(deltaTimeSeconds, scene.getEngine().getFps());
    const camera = scene.activeCamera;
    if (camera instanceof ArcRotateCamera) {
      canvas.dataset.cameraAlpha = String(camera.alpha);
      canvas.dataset.cameraBeta = String(camera.beta);
      canvas.dataset.cameraRadius = String(camera.radius);
    }
  });
  const diagnostics = {
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
        environment: { groundWidth: bounds ? bounds.maximumWorld.x - bounds.minimumWorld.x : 0, lightIntensity: scene.getLightByName("Sunlight")?.intensity ?? 0 },
      };
    },
  };
  // Read-only observability, deliberately without command/mutation hooks.
  window.__worldDiagnostics = diagnostics;
  interfaceView.showStatus("World ready");
  return () => {
    if (isDisposed) return;
    isDisposed = true;
    scene.onBeforeRenderObservable.remove(observer);
    detachTargeting(); detachCamera(); registry.dispose(); interfaceView.dispose(); adapter.dispose();
    if (window.__worldDiagnostics === diagnostics) delete window.__worldDiagnostics;
  };
}

export type WorldDiagnostics = { projectPosition: (position: WorldPosition) => { x: number; y: number }; snapshot: () => {
  entities: ReturnType<EntityRegistry["snapshot"]>;
  selectedEntityId: string | null; sceneMeshCount: number; isDisposed: boolean;
  camera: { alpha: number; beta: number; radius: number } | null;
  environment: { groundWidth: number; lightIntensity: number };
} };

declare global { interface Window { __worldDiagnostics?: WorldDiagnostics } }
