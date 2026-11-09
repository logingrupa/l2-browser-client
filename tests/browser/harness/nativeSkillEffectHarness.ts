import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { buildNativeCatalogIndex, describeNativeCatalogLookup, skillCatalogKey } from "../../../src/assets/native/nativeCatalogIndex";
import { readNativeCatalog } from "../../../src/assets/native/readNativeCatalog";
import { selectedCastSkill } from "../../../src/effects/castSkillIndex";
import { createNativeEffectComponentPreview, type NativeEffectComponentPreview } from "../../../src/effects/nativeEffectComponentPreview";
import { loadNativeEffectComponents, simulatedEffectEmitterClasses } from "../../../src/effects/nativeEffectComponents";
import { createWebGPUEngine } from "../../../src/engine/createWebGPUEngine";

export type NativeSkillEffectHarnessState =
  | { readonly state: "running" }
  | { readonly state: "done"; readonly key: string; readonly lookupStatus: string; readonly note: string;
      readonly preview: ReturnType<NativeEffectComponentPreview["snapshot"]> | null }
  | { readonly state: "failed"; readonly reason: string };

declare global {
  interface Window { __nativeSkillEffectHarness?: NativeSkillEffectHarnessState }
}

const lifetime = new AbortController();
const previewSettleMilliseconds = 60_000;

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

async function showSelectedSkill(): Promise<NativeSkillEffectHarnessState> {
  const selected = selectedCastSkill(location);
  if (selected === null) throw new Error("the native skill effect harness needs ?skill=<id>:<level>");
  const key = skillCatalogKey(selected.skillId, selected.level);
  const index = await buildNativeCatalogIndex(await readNativeCatalog(lifetime.signal), lifetime.signal);
  const lookup = index.lookup(key), note = describeNativeCatalogLookup(lookup);
  const noteElement = requiredElement("native-skill-effect-note", HTMLParagraphElement);
  noteElement.dataset.lookupStatus = lookup.status;
  noteElement.textContent = note;
  if (lookup.status !== "converted") return { state: "done", key, lookupStatus: lookup.status, note, preview: null };
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
  return { state: "done", key, lookupStatus: lookup.status, note, preview: preview.snapshot() };
}

window.__nativeSkillEffectHarness = { state: "running" };
void showSelectedSkill().then(
  state => { window.__nativeSkillEffectHarness = state; },
  error => { window.__nativeSkillEffectHarness = { state: "failed", reason: error instanceof Error ? error.message : String(error) }; });
