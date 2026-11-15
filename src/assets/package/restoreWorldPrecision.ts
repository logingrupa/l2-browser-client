import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import { OverrideMatrixFunctions } from "@babylonjs/core/Materials/floatingOriginMatrixOverrides";

/** Babylon 9.27 resets shared matrix overrides when one engine loses its last
 * scene. An isolated inspector may close while a different world engine lives. */
export function restoreWorldPrecision(): void {
  if (EngineStore.Instances.some(engine => engine.scenes.some(scene => !scene.isDisposed && scene.floatingOriginMode))) OverrideMatrixFunctions();
}
