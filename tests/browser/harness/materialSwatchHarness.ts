import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { createWebGPUEngine } from "../../../src/engine/createWebGPUEngine";
import { createNativeMaterial, type NativeMaterialInspection } from "../../../src/materials/ue2/babylon/material";
import { loadNativeMaterial } from "../../../src/materials/ue2/babylon/loadNativeMaterial";
import { FOG_DISABLED } from "../../../src/materials/ue2/model/fog";
import { readMaterialSwatchParameters, type MaterialSwatchParameters } from "./materialSwatchParameters";

export interface MaterialSwatchState {
  status: "loading" | "rendered" | "failed";
  parameters: MaterialSwatchParameters | null;
  material: NativeMaterialInspection | null;
  centrePixel: readonly number[] | null;
  canvasFormat: string | null;
  failure: string | null;
}

declare global {
  interface Window { __materialSwatch?: MaterialSwatchState }
}

const swatchFramesBeforeReadback = 4;
const swatchSessionSeed = 0;
const swatchState: MaterialSwatchState = { status: "loading", parameters: null, material: null, centrePixel: null, canvasFormat: null, failure: null };
window.__materialSwatch = swatchState;

function requireElement<ElementType extends HTMLElement>(id: string, kind: new () => ElementType): ElementType {
  const element = document.getElementById(id);
  if (!(element instanceof kind)) throw new Error(`Material swatch page is missing #${id}.`);
  return element;
}

const swatchRoot = requireElement("material-swatch", HTMLElement);
const swatchCanvas = requireElement("material-swatch-canvas", HTMLCanvasElement);
const swatchReport = requireElement("material-swatch-report", HTMLPreElement);

function publish(): void {
  swatchRoot.dataset.status = swatchState.status;
  swatchRoot.dataset.materialStatus = swatchState.material?.status ?? "";
  swatchRoot.dataset.unportedClass = swatchState.material?.unportedClass ?? "";
  swatchReport.textContent = JSON.stringify(swatchState, null, 2);
}

async function renderSwatch(): Promise<void> {
  const parameters = readMaterialSwatchParameters(location.search);
  swatchState.parameters = parameters;
  const engine = await createWebGPUEngine(swatchCanvas);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 1);
  scene.fogEnabled = false;
  const camera = new FreeCamera("material-swatch-camera", new Vector3(0, 0, -2), scene);
  camera.setTarget(Vector3.Zero());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -1;
  camera.orthoRight = 1;
  camera.orthoTop = 1;
  camera.orthoBottom = -1;
  const quad = MeshBuilder.CreatePlane("material-swatch-quad", { size: 2 }, scene);
  const controller = new AbortController();
  const nativeMaterial = createNativeMaterial(scene, await loadNativeMaterial(parameters.materialId, controller.signal), { sessionSeed: swatchSessionSeed });
  nativeMaterial.update({ levelSeconds: parameters.levelSeconds, hour: parameters.hour, environmentType: parameters.environmentType, fog: FOG_DISABLED });
  quad.material = nativeMaterial.material;
  swatchState.material = nativeMaterial.inspect();
  await scene.whenReadyAsync();
  for (let frame = 0; frame < swatchFramesBeforeReadback; frame += 1) scene.render();
  const pixel = await engine.readPixels(Math.floor(engine.getRenderWidth() / 2), Math.floor(engine.getRenderHeight() / 2), 1, 1);
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  const readback = Array.from(new Uint8Array(pixel.buffer, pixel.byteOffset, 4));
  swatchState.canvasFormat = canvasFormat;
  swatchState.centrePixel = canvasFormat === "bgra8unorm" ? [readback[2]!, readback[1]!, readback[0]!, readback[3]!] : readback;
  swatchState.status = "rendered";
  engine.runRenderLoop(() => scene.render());
}

renderSwatch().catch((error: unknown) => {
  swatchState.status = "failed";
  swatchState.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}).finally(publish);
