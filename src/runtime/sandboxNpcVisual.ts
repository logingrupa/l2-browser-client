import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { CharacterAnimator, type CharacterAnimationDriver } from "../animation/CharacterAnimator";
import type { CharacterBounds } from "../assets/characterBounds";
import type { CharacterVisual, CharacterVisualFactory } from "../assets/CharacterVisual";
import { describeNativeCatalogLookup, npcCatalogKey, type NativeCatalogIndex } from "../assets/native/nativeCatalogIndex";
import type { WorldEntity } from "../world/worldTypes";

export type SandboxAppearanceOfModel = (modelCatalogId: string) => string | null;

export type SandboxNpcPresentation =
  | { readonly key: string; readonly appearanceId: string; readonly modelCatalogId: string }
  | { readonly key: string; readonly missingAssetDiagnostic: string };

const missingAssetMarkerPresentationBounds: CharacterBounds = Object.freeze({
  minimum: new Vector3(-.4, 0, -.4), maximum: new Vector3(.4, 1.8, .4),
  labelHeight: 2.25, selectionRadius: .825, pickingHeight: 1,
});

const motionlessAnimationDriver: CharacterAnimationDriver = { setState() {}, update() {}, dispose() {} };

export function resolveSandboxNpcPresentation(index: NativeCatalogIndex, npcId: number, appearanceOfModel: SandboxAppearanceOfModel): SandboxNpcPresentation {
  const lookup = index.lookup(npcCatalogKey(npcId));
  if (lookup.status === "not-in-catalog") return { key: lookup.key, missingAssetDiagnostic: describeNativeCatalogLookup(lookup) };
  if (!("modelCatalogId" in lookup.record)) throw new Error(`${lookup.key} does not hold an NPC catalog record.`);
  const { modelCatalogId } = lookup.record;
  const appearanceId = appearanceOfModel(modelCatalogId);
  if (appearanceId === null) {
    return { key: lookup.key, missingAssetDiagnostic: `${lookup.key} converted but model ${modelCatalogId} is not loaded in this sandbox` };
  }
  return { key: lookup.key, appearanceId, modelCatalogId };
}

export function createMissingAssetMarkerVisual(scene: Scene, entity: WorldEntity, missingAssetDiagnostic: string): CharacterVisual {
  const root = new TransformNode(`entity:${entity.id}`, scene);
  const animation = new CharacterAnimator(motionlessAnimationDriver);
  animation.setState(entity.animation);
  return {
    root, animation, isFallback: false, bounds: missingAssetMarkerPresentationBounds, modelId: null, missingAssetDiagnostic,
    dispose() { animation.dispose(); root.dispose(); },
  };
}

export function sandboxNpcVisualFactory(index: NativeCatalogIndex, nativeFactory: CharacterVisualFactory,
  appearanceOfModel: SandboxAppearanceOfModel): CharacterVisualFactory {
  return (scene, entity, onAssetStatus) => {
    if (entity.npcId === undefined) return nativeFactory(scene, entity, onAssetStatus);
    const presentation = resolveSandboxNpcPresentation(index, entity.npcId, appearanceOfModel);
    if ("missingAssetDiagnostic" in presentation) return createMissingAssetMarkerVisual(scene, entity, presentation.missingAssetDiagnostic);
    return nativeFactory(scene, { ...entity, appearanceId: presentation.appearanceId }, onAssetStatus);
  };
}
