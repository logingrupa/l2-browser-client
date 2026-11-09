import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { CharacterAnimator, type CharacterAnimationDriver } from "../animation/CharacterAnimator";
import type { CharacterBounds, CharacterVisual, CharacterVisualFactory } from "../assets/CharacterVisual";
import { describeNativeCatalogLookup, npcCatalogKey, type NativeCatalogIndex, type NativeNpcCatalogRecord } from "../assets/native/nativeCatalogIndex";
import type { WorldEntity } from "../world/worldTypes";

export type SandboxNpcAppearance = { readonly appearanceId: string } | { readonly unavailableReason: string };

export type SandboxAppearanceOfNpc = (record: NativeNpcCatalogRecord) => SandboxNpcAppearance;

export type SandboxNpcPresentation =
  | { readonly appearanceId: string }
  | { readonly missingAssetDiagnostic: string };

const missingAssetMarkerPresentationBounds: CharacterBounds = Object.freeze({
  minimum: new Vector3(-.4, 0, -.4), maximum: new Vector3(.4, 1.8, .4),
  labelHeight: 2.25, selectionRadius: .825,
});

const motionlessAnimationDriver: CharacterAnimationDriver = { setState() {}, update() {}, dispose() {} };

export function resolveSandboxNpcPresentation(index: NativeCatalogIndex, npcId: number, appearanceOfNpc: SandboxAppearanceOfNpc): SandboxNpcPresentation {
  const lookup = index.lookup(npcCatalogKey(npcId));
  if (lookup.status !== "converted") return { missingAssetDiagnostic: describeNativeCatalogLookup(lookup) };
  if (!("modelCatalogId" in lookup.record)) throw new Error(`${lookup.key} does not hold an NPC catalog record.`);
  const appearance = appearanceOfNpc(lookup.record);
  if ("unavailableReason" in appearance) return { missingAssetDiagnostic: `${lookup.key} converted but ${appearance.unavailableReason}` };
  return { appearanceId: appearance.appearanceId };
}

export function createMissingAssetMarkerVisual(scene: Scene, entity: WorldEntity, missingAssetDiagnostic: string): CharacterVisual {
  const root = new TransformNode(`entity:${entity.id}`, scene);
  const animation = new CharacterAnimator(motionlessAnimationDriver);
  animation.setState(entity.animation);
  return {
    root, animation, hasNativeModel: false, bounds: missingAssetMarkerPresentationBounds, modelId: null, missingAssetDiagnostic,
    ready: Promise.resolve(), groundClearance: 0, forwardDirection: null,
    attachmentSnapshot: () => [], attachmentAnchor: () => null, sourceClock: () => null, setEntity() {},
    dispose() { animation.dispose(); root.dispose(); },
  };
}

export function sandboxNpcVisualFactory(index: NativeCatalogIndex, nativeFactory: CharacterVisualFactory,
  appearanceOfNpc: SandboxAppearanceOfNpc): CharacterVisualFactory {
  return (scene, entity, onAssetStatus) => {
    if (entity.npcId === undefined) return nativeFactory(scene, entity, onAssetStatus);
    const presentation = resolveSandboxNpcPresentation(index, entity.npcId, appearanceOfNpc);
    if ("missingAssetDiagnostic" in presentation) return createMissingAssetMarkerVisual(scene, entity, presentation.missingAssetDiagnostic);
    return nativeFactory(scene, { ...entity, appearanceId: presentation.appearanceId }, onAssetStatus);
  };
}
