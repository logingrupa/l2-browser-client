import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { ArcRotateCameraPointersInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput";
import type { Scene } from "@babylonjs/core/scene";

/** Authored framing and limits are retained. Only input behavior is attached here. */
export function attachWorldCamera(scene: Scene, canvas: HTMLCanvasElement): () => void {
  const camera = scene.getCameraByName("World camera");
  if (!(camera instanceof ArcRotateCamera)) throw new Error("Authored orbit camera is missing.");
  scene.activeCamera = camera;
  camera.attachControl(true, false, 1);
  camera.movement.input.setInteraction("pointer", { button: 2 }, "rotate");
  const pointers = camera.inputs.attached.pointers;
  if (pointers instanceof ArcRotateCameraPointersInput) {
    pointers.buttons = [2];
    pointers.panningSensibility = 0;
    pointers.pinchDeltaPercentage = 0.01;
    pointers.multiTouchPanAndZoom = false;
    // With panning disabled, gradual pinches must not enter the pan/zoom gesture arbitration.
    pointers.multiTouchPanning = false;
  }
  const choosePointerButtons = (event: PointerEvent): void => {
    if (pointers instanceof ArcRotateCameraPointersInput) pointers.buttons = event.pointerType === "touch" ? [0, 2] : [2];
  };
  canvas.addEventListener("pointerdown", choosePointerButtons, true);
  camera.wheelDeltaPercentage = 0.015;
  camera.angularSensibilityX = 650;
  camera.angularSensibilityY = 650;
  const preventContextMenu = (event: MouseEvent): void => event.preventDefault();
  canvas.addEventListener("contextmenu", preventContextMenu);
  return () => {
    canvas.removeEventListener("contextmenu", preventContextMenu);
    canvas.removeEventListener("pointerdown", choosePointerButtons, true);
    camera.detachControl();
  };
}
