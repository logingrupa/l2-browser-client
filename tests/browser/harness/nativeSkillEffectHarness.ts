import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { buildNativeCatalogIndex, describeNativeCatalogLookup, skillCatalogKey } from "../../../src/assets/native/nativeCatalogIndex";
import { readNativeCatalog } from "../../../src/assets/native/readNativeCatalog";
import { selectedCastSkill } from "../../../src/effects/castSkillIndex";
import { createNativeEffectComponentPreview, type NativeEffectComponentPreview } from "../../../src/effects/nativeEffectComponentPreview";
import { loadNativeEffectComponents, simulatedEffectEmitterClasses, type EffectBundle } from "../../../src/effects/nativeEffectComponents";
import { loadEmitterActorPlayback } from "../../../src/effects/particles/render/emitterActorPlayback";
import { createWebGPUEngine } from "../../../src/engine/createWebGPUEngine";

export interface SimulatedCastActor {
  readonly actorObject: string;
  readonly dispatchStages: readonly string[];
  readonly status: "destroyed" | "running" | "refused";
  readonly reason: string | null;
  readonly simulationSteps: number;
  readonly peakLiveParticles: number;
  readonly drawnFrames: number;
}

export type NativeSkillEffectHarnessState =
  | { readonly state: "running" }
  | { readonly state: "casting"; readonly key: string; readonly actorObject: string; readonly liveParticles: number }
  | { readonly state: "done"; readonly key: string; readonly lookupStatus: string; readonly note: string;
      readonly preview: ReturnType<NativeEffectComponentPreview["snapshot"]> | null; readonly cast: readonly SimulatedCastActor[] }
  | { readonly state: "failed"; readonly reason: string };

declare global {
  interface Window { __nativeSkillEffectHarness?: NativeSkillEffectHarnessState }
}

const lifetime = new AbortController();
const previewSettleMilliseconds = 60_000;
const castStepSeconds = 1 / 60;
const castFrameLimit = 600;
const castSessionSeed = 1;

function requiredElement<ElementType extends HTMLElement>(id: string, elementType: { new(): ElementType }): ElementType {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) throw new Error(`Native skill effect harness page is missing #${id}.`);
  return element;
}

function listComponents(preview: NativeEffectComponentPreview): void {
  const list = requiredElement("native-skill-effect-components", HTMLOListElement);
  for (const component of preview.components) {
    const item = document.createElement("li");
    const simulated = simulatedEffectEmitterClasses.has(component.class);
    item.dataset.effectComponent = component.object;
    item.textContent = `${component.object} ${component.class}${simulated ? "" : " (record only, not simulated)"}`;
    list.append(item);
  }
}

async function firstReadyPreview(preview: NativeEffectComponentPreview): Promise<void> {
  for (const component of preview.components.filter(row => simulatedEffectEmitterClasses.has(row.class))) {
    await preview.select(component.object);
    if (preview.snapshot().status !== "ready") continue;
    const deadline = performance.now() + previewSettleMilliseconds;
    while (preview.snapshot().draws === 0 && performance.now() < deadline) await new Promise(resolve => requestAnimationFrame(resolve));
    return;
  }
}

async function playCastActor(scene: Scene, bundle: EffectBundle, key: string, actorObject: string, dispatchStages: readonly string[]): Promise<SimulatedCastActor> {
  const actor = bundle.manifest.actors.find(row => row.object === actorObject)!;
  const unsimulated = bundle.manifest.components.filter(row => row.actor === actorObject && !simulatedEffectEmitterClasses.has(row.class));
  if (unsimulated.length > 0) {
    return { actorObject, dispatchStages, status: "refused", reason: `emitter-class-unported:${unsimulated[0]!.class}`, simulationSteps: 0, peakLiveParticles: 0, drawnFrames: 0 };
  }
  const playback = await loadEmitterActorPlayback(scene, bundle, { actorObject: actor.object, emitterObjects: null, sessionSeed: castSessionSeed }, lifetime.signal);
  let drawnFrames = 0;
  const meshes = playback.components.flatMap(component => component.meshes);
  for (const mesh of meshes) mesh.onBeforeRenderObservable.add(() => { drawnFrames += 1; });
  try {
    playback.start();
    for (let frame = 0; frame < castFrameLimit && playback.playing; frame += 1) {
      playback.advance(castStepSeconds);
      window.__nativeSkillEffectHarness = { state: "casting", key, actorObject, liveParticles: playback.liveParticles() };
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const inspection = playback.inspect();
    return { actorObject, dispatchStages, status: inspection.destroyed ? "destroyed" : "running", reason: null,
      simulationSteps: inspection.simulationSteps, peakLiveParticles: inspection.peakLiveParticles, drawnFrames };
  } finally { playback.dispose(); }
}

async function playSimulatedCast(scene: Scene, bundle: EffectBundle, key: string): Promise<SimulatedCastActor[]> {
  const cast: SimulatedCastActor[] = [];
  for (const actor of bundle.manifest.actors) cast.push(await playCastActor(scene, bundle, key, actor.object, actor.dispatchStages ?? []));
  return cast;
}

async function showSelectedSkill(): Promise<NativeSkillEffectHarnessState> {
  const selected = selectedCastSkill(location);
  if (selected === null) throw new Error("the native skill effect harness needs ?skill=<id>:<level>");
  const key = skillCatalogKey(selected.skillId, selected.level);
  const index = await buildNativeCatalogIndex(await readNativeCatalog(lifetime.signal), lifetime.signal);
  const lookup = index.lookup(key), note = describeNativeCatalogLookup(lookup);
  const noteElement = requiredElement("native-skill-effect-note", HTMLParagraphElement);
  noteElement.dataset.lookupStatus = lookup.status;
  noteElement.textContent = note;
  if (lookup.status !== "converted") return { state: "done", key, lookupStatus: lookup.status, note, preview: null, cast: [] };
  const bundle = await loadNativeEffectComponents(lifetime.signal);
  if (bundle === null) throw new Error(`${key} is converted in the catalog index but its effect bundle did not load`);
  const engine = await createWebGPUEngine(requiredElement("native-skill-effect-canvas", HTMLCanvasElement));
  const scene = new Scene(engine);
  new FreeCamera("native-skill-effect-camera", new Vector3(0, 2, -8), scene).setTarget(Vector3.Zero());
  const anchor = new TransformNode("native-skill-effect-anchor", scene);
  const preview = createNativeEffectComponentPreview(scene, bundle, () => ({ root: anchor, isValid: () => !anchor.isDisposed() }), () => true,
    lifetime.signal);
  listComponents(preview);
  engine.runRenderLoop(() => { preview.update(); scene.render(); });
  await firstReadyPreview(preview);
  const previewSnapshot = preview.snapshot();
  await preview.select(null);
  const cast = await playSimulatedCast(scene, bundle, key);
  return { state: "done", key, lookupStatus: lookup.status, note, preview: previewSnapshot, cast };
}

window.__nativeSkillEffectHarness = { state: "running" };
void showSelectedSkill().then(
  state => { window.__nativeSkillEffectHarness = state; },
  error => { window.__nativeSkillEffectHarness = { state: "failed", reason: error instanceof Error ? error.message : String(error) }; });
