import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { NativeEffectComponentPreview } from "./nativeEffectComponentPreview";

/** Temporary inspection framing. It never normalizes source geometry or saves
 * camera changes; leaving inspection restores the borrowed camera settings. */
export function createEffectInspectionCamera(camera: ArcRotateCamera, preview: Pick<NativeEffectComponentPreview, "bounds">,
  onFocusChange: (active: boolean) => void) {
  let saved: { target: Vector3; radius: number; alpha: number; beta: number;
    minZ: number; lowerRadiusLimit: number | null } | null = null;
  const release = (restoreView = true) => {
    if (!saved) return;
    const previous = saved; saved = null;
    camera.minZ = previous.minZ; camera.lowerRadiusLimit = previous.lowerRadiusLimit;
    if (restoreView) {
      camera.setTarget(previous.target, false, false, true); camera.radius = previous.radius;
      camera.alpha = previous.alpha; camera.beta = previous.beta;
    }
    onFocusChange(false);
  };
  const update = () => {
    if (!saved) return;
    const bounds = preview.bounds();
    if (!bounds) { release(); return; }
    camera.setTarget(bounds.minimum.add(bounds.maximum).scale(.5), false, false, true);
  };
  return {
    focus() {
      const bounds = preview.bounds(); if (!bounds) return;
      if (!saved) {
        saved = { target: camera.target.clone(), radius: camera.radius, alpha: camera.alpha, beta: camera.beta,
          minZ: camera.minZ, lowerRadiusLimit: camera.lowerRadiusLimit };
        onFocusChange(true);
      }
      const extent = bounds.maximum.subtract(bounds.minimum).length();
      camera.lowerRadiusLimit = .02; camera.minZ = .002;
      camera.radius = Math.max(.12, extent * 1.8); update();
    },
    update,
    release,
    dispose: release,
  };
}
