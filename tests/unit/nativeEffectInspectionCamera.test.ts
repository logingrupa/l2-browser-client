import { expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createEffectInspectionCamera } from "../../src/effects/nativeEffectInspectionCamera";
import type { NativeEffectComponentPreview } from "../../src/effects/nativeEffectComponentPreview";

it("temporarily follows the actual component bounds and restores camera settings when it disappears", () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const camera = new ArcRotateCamera("borrowed-camera", .8, 1.2, 7, new Vector3(1, 2, 3), scene);
    camera.minZ = .03; camera.lowerRadiusLimit = 2;
    let bounds: { minimum: Vector3; maximum: Vector3 } | null = { minimum: new Vector3(4, 5, 6), maximum: new Vector3(4.1, 5.1, 6.1) };
    const changes = vi.fn(), preview = { bounds: () => bounds } as unknown as NativeEffectComponentPreview;
    const control = createEffectInspectionCamera(camera, preview, changes);
    control.focus(); expect(camera.target.asArray()).toEqual([4.05, 5.05, 6.05]); expect(camera.radius).toBeLessThan(2);
    bounds = { minimum: new Vector3(5, 6, 7), maximum: new Vector3(5.1, 6.1, 7.1) };
    control.update(); expect(camera.target.asArray()).toEqual([5.05, 6.05, 7.05]);
    bounds = null; control.update();
    expect(camera.target.asArray()).toEqual([1, 2, 3]); expect(camera.radius).toBe(7);
    expect(camera.minZ).toBe(.03); expect(camera.lowerRadiusLimit).toBe(2);
    expect(changes.mock.calls).toEqual([[true], [false]]); control.dispose(); expect(changes).toHaveBeenCalledTimes(2);
  } finally { scene.dispose(); engine.dispose(); }
});
