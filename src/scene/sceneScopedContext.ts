import type { Scene } from "@babylonjs/core/scene";

export interface SceneScopedContext<Context> {
  provide(scene: Scene, context: Context): () => void;
  contextFor(scene: Scene): Context | null;
}

export function createSceneScopedContext<Context>(contextName: string): SceneScopedContext<Context> {
  const contextsByScene = new WeakMap<Scene, Context>();
  return {
    provide(scene, context) {
      if (contextsByScene.has(scene)) throw new Error(`This scene already has a ${contextName} provider.`);
      contextsByScene.set(scene, context);
      let withdrawn = false;
      const withdraw = () => {
        if (withdrawn) return;
        withdrawn = true;
        scene.onDisposeObservable.remove(disposeObserver);
        if (contextsByScene.get(scene) === context) contextsByScene.delete(scene);
      };
      const disposeObserver = scene.onDisposeObservable.add(withdraw);
      return withdraw;
    },
    contextFor: scene => contextsByScene.get(scene) ?? null,
  };
}
