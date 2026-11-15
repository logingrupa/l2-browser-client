import { createWebGPUEngine } from "../../src/engine/createWebGPUEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { loadNativeSection, type NativeSection } from "../../src/scene/world/loadNativeSection";

function element<T extends HTMLElement>(id: string, kind: { new(): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof kind)) throw new Error(`Missing ${id}.`);
  return value;
}
const canvas = element("section-canvas", HTMLCanvasElement), status = element("section-status", HTMLParagraphElement);
const fps = element("fps", HTMLOutputElement), frame = element("frame-section", HTMLButtonElement), unload = element("dispose-section", HTMLButtonElement);
const engine = await createWebGPUEngine(canvas);
const gpuErrors: string[] = [];
engine._device.addEventListener("uncapturederror", event => gpuErrors.push(event.error.message));
engine.setHardwareScalingLevel(1);
const scene = new Scene(engine);
// PBR owns a scene-wide BRDF lookup independent of the section's lifetime.
// Include that shared resource in the baseline, as the actor fixtures do.
GetEnvironmentBRDFTexture(scene);
scene.useRightHandedSystem = true;
scene.clearColor = new Color4(.21, .27, .3, 1);
const camera = new ArcRotateCamera("Native section inspection camera", -Math.PI*.62, .82, 32, Vector3.Zero(), scene);
camera.minZ = .05; camera.maxZ = 500; camera.lowerRadiusLimit = 1; camera.upperRadiusLimit = 150;
camera.wheelPrecision = 12; camera.panningSensibility = 90;
camera.attachControl(canvas, true);
const fill = new HemisphericLight("Inspection ambient", Vector3.Up(), scene);
fill.intensity = 1.1; fill.groundColor = new Color3(.3, .31, .26);
const sun = new DirectionalLight("Inspection directional", new Vector3(-.4, -1, -.6), scene);
sun.intensity = 1.7;
let section: NativeSection | null = null, ready = false, failure: string | null = null, loadMilliseconds = 0;
let lastOverlay = 0, renders = 0;
const abort = new AbortController();
const counts = () => ({ meshes: scene.meshes.length, transformNodes: scene.transformNodes.length, materials: scene.materials.length, textures: scene.textures.length });
const before = counts();
function frameSection() {
  if (!section) return;
  camera.target.copyFrom(section.minimum.add(section.maximum).scale(.5));
  const diagonal = section.maximum.subtract(section.minimum).length();
  camera.radius = Math.max(12, diagonal*.95);
  camera.alpha = -Math.PI*.62; camera.beta = .82;
}
frame.addEventListener("click", frameSection);
unload.addEventListener("click", () => {
  section?.dispose(); ready = false; frame.disabled = true; unload.disabled = true;
  status.textContent = "Native section unloaded.";
});
window.addEventListener("resize", () => engine.resize());
window.addEventListener("pagehide", () => { abort.abort(); scene.dispose(); engine.dispose(); }, { once: true });
engine.runRenderLoop(() => {
  scene.render(); renders++;
  const now = performance.now();
  if (now-lastOverlay > 500) {
    const measured = engine.getFps();
    fps.textContent = `${Number.isFinite(measured) ? Math.round(measured) : "—"} FPS · live diagnostic`; lastOverlay = now;
  }
});
function snapshot() {
  camera.getViewMatrix(true);
  const position = camera.position.asArray(), target = camera.target.asArray();
  const nativeCoordinates = (value: readonly number[]) => [value[0]! * 100, value[2]! * 100, value[1]! * 100];
  return { ready, failure, loadMilliseconds, renders, rightHanded: scene.useRightHandedSystem,
    graphics: { engine: engine.name, isWebGPU: engine.isWebGPU, context: Boolean(canvas.getContext("webgpu")), errors: [...gpuErrors] },
    manifestSha256: section?.manifestSha256 ?? null, section: section?.inspection() ?? null,
    bounds: section ? { minimum: section.minimum.asArray(), maximum: section.maximum.asArray() } : null,
    camera: { position, target, radius: camera.radius, alpha: camera.alpha, beta: camera.beta,
      fov: camera.fov, fovMode: camera.fovMode, minZ: camera.minZ, maxZ: camera.maxZ,
      sourcePosition: nativeCoordinates(position), sourceTarget: nativeCoordinates(target),
      sourceCoordinateRule: "native XYZ = 100 * glTF XZY; no additional placement transform" },
    viewport: { width: engine.getRenderWidth(), height: engine.getRenderHeight(), devicePixelRatio: window.devicePixelRatio,
      hardwareScalingLevel: engine.getHardwareScalingLevel() },
    lighting: { ambientIntensity: fill.intensity, ambientDirection: fill.direction.asArray(), groundColor: fill.groundColor.asArray(),
      directionalIntensity: sun.intensity, directionalDirection: sun.direction.asArray(), clearColor: scene.clearColor.asArray(),
      nativeMatch: "unverified" }, before, current: counts(),
    fps: engine.getFps(), diagnosticOnly: true, visualAcceptance: "unverified", collisionVerified: false };
}
async function settleGraphics() {
  await engine._device.queue.onSubmittedWorkDone();
  // Uncaptured validation errors are dispatched after queue submission.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  return snapshot().graphics;
}
declare global { interface Window { __nativeSection?: { snapshot: typeof snapshot; settleGraphics: typeof settleGraphics }; } }
window.__nativeSection = { snapshot, settleGraphics };
export type NativeSectionSnapshot = ReturnType<typeof snapshot>;
void (async () => {
  const start = performance.now();
  section = await loadNativeSection(scene, abort.signal);
  if (!section) { status.textContent = "No native section staged. Run pnpm assets:migrate --stage-runtime."; return; }
  await scene.whenReadyAsync();
  frameSection(); loadMilliseconds = performance.now()-start; ready = true;
  frame.disabled = false; unload.disabled = false;
  status.textContent = `${section.manifest.models.length} source models · ${section.manifest.placements.length} placements · ${section.inspection().terrainTriangles} terrain triangles · native materials require visual review`;
})().catch(error => { failure = String(error); status.textContent = failure; console.error(error); });
