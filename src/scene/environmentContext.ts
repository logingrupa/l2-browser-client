import type { Scene } from "@babylonjs/core/scene";
import type { ImportedWorld } from "./world/loadImportedWorld";

const environments = new WeakMap<Scene, ImportedWorld>();

export function setImportedEnvironment(scene: Scene, world: ImportedWorld): void {
  environments.set(scene, world);
  scene.onDisposeObservable.addOnce(() => {
    environments.delete(scene);
    world.dispose();
  });
}

export function getImportedEnvironment(scene: Scene): ImportedWorld | undefined {
  return environments.get(scene);
}
