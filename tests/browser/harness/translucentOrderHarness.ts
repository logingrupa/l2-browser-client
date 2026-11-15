import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";
import { loadNativeEffectComponents, simulatedEffectEmitterClasses } from "../../../src/effects/nativeEffectComponents";
import { loadEmitterActorPlayback, type EmitterActorPlayback } from "../../../src/effects/particles/render/emitterActorPlayback";
import { createWebGPUEngine } from "../../../src/engine/createWebGPUEngine";
import { installTransparentRenderingOrder } from "../../../src/runtime/transparentRenderingOrder";

export interface SheetPlacementPixels {
  readonly sheetPlacement: "in-front" | "behind";
  readonly brightestRed: number;
  readonly redPixelCount: number;
}

export type TranslucentOrderHarnessState =
  | { readonly state: "running" }
  | { readonly state: "done"; readonly actorObject: string; readonly liveParticles: number; readonly placements: readonly SheetPlacementPixels[] }
  | { readonly state: "failed"; readonly reason: string };

declare global {
  interface Window { __translucentOrderHarness?: TranslucentOrderHarnessState }
}

const lifetime = new AbortController();
const playbackStepSeconds = 1 / 60;
const playbackStepLimit = 600;
const effectColourOverride = [1, 0, 0, 1] as const;
const waterSheetAlpha = .5;
const visibleRedLevel = 24;
const settleFrameCount = 4;

function requiredCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById("translucent-order-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Translucent order harness page is missing its canvas.");
  return canvas;
}

async function livePowerStrike(scene: Scene): Promise<{ playback: EmitterActorPlayback; actorObject: string }> {
  const bundle = await loadNativeEffectComponents(lifetime.signal);
  if (bundle === null) throw new Error("the Power Strike effect bundle is not staged");
  const actor = bundle.manifest.actors.find(row => bundle.manifest.components.filter(component => component.actor === row.object)
    .every(component => simulatedEffectEmitterClasses.has(component.class)));
  if (actor === undefined) throw new Error("no Power Strike actor has only simulated emitters");
  const playback = await loadEmitterActorPlayback(scene, bundle, { actorObject: actor.object, emitterObjects: null, sessionSeed: 1 }, lifetime.signal);
  playback.setPins({ pinnedFrame: null, colourOverride: effectColourOverride });
  playback.start();
  for (let step = 0; step < playbackStepLimit && playback.liveParticles() === 0; step += 1) playback.advance(playbackStepSeconds);
  for (let step = 0; step < 6; step += 1) playback.advance(playbackStepSeconds);
  if (playback.liveParticles() === 0) throw new Error(`${actor.object} emitted no particle in ${playbackStepLimit} steps`);
  return { playback, actorObject: actor.object };
}

async function measureRed(scene: Scene, sheetPlacement: SheetPlacementPixels["sheetPlacement"]): Promise<SheetPlacementPixels> {
  const canvas = requiredCanvas(), copy = document.createElement("canvas");
  copy.width = canvas.width; copy.height = canvas.height;
  const context = copy.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("the harness cannot read its canvas back");
  const engine = scene.getEngine();
  await new Promise<void>(resolve => {
    let endedFrames = 0;
    const observer = engine.onEndFrameObservable.add(() => {
      endedFrames += 1;
      if (endedFrames < settleFrameCount) return;
      context.drawImage(canvas, 0, 0);
      engine.onEndFrameObservable.remove(observer);
      resolve();
    });
  });
  const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
  let brightestRed = 0, redPixelCount = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset]!, blue = pixels[offset + 2]!;
    if (red > brightestRed) brightestRed = red;
    if (red >= visibleRedLevel && red > blue) redPixelCount += 1;
  }
  return { sheetPlacement, brightestRed, redPixelCount };
}

async function drawPowerStrikeAroundWaterSheet(): Promise<TranslucentOrderHarnessState> {
  const engine = await createWebGPUEngine(requiredCanvas());
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0, 0, 0, 1);
  installTransparentRenderingOrder(scene);
  const { playback, actorObject } = await livePowerStrike(scene);
  const bounds = playback.bounds();
  if (bounds === null) throw new Error(`${actorObject} has no particle bounds`);
  const centre = bounds.minimum.add(bounds.maximum).scale(.5), extent = Math.max(bounds.maximum.subtract(bounds.minimum).length(), .5);
  const viewDistance = extent * 3;
  const camera = new FreeCamera("translucent-order-camera", centre.add(new Vector3(0, 0, viewDistance)), scene);
  camera.setTarget(centre);
  engine.runRenderLoop(() => scene.render());
  const waterMaterial = new StandardMaterial("water sheet stand-in", scene);
  waterMaterial.disableLighting = true;
  waterMaterial.emissiveColor = new Color3(0, 0, 1);
  waterMaterial.alpha = waterSheetAlpha;
  waterMaterial.backFaceCulling = false;
  const waterSheet = MeshBuilder.CreatePlane("water sheet stand-in", { size: extent * 8 }, scene);
  waterSheet.material = waterMaterial;
  waterSheet.position.copyFrom(centre.add(new Vector3(0, 0, viewDistance / 2)));
  const inFront = await measureRed(scene, "in-front");
  waterSheet.position.copyFrom(centre.add(new Vector3(0, 0, -extent * 2)));
  const behind = await measureRed(scene, "behind");
  return { state: "done", actorObject, liveParticles: playback.liveParticles(), placements: [inFront, behind] };
}

window.__translucentOrderHarness = { state: "running" };
void drawPowerStrikeAroundWaterSheet().then(
  state => { window.__translucentOrderHarness = state; },
  error => { window.__translucentOrderHarness = { state: "failed", reason: error instanceof Error ? error.message : String(error) }; });
