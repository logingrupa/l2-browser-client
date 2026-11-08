import type { Scene } from "@babylonjs/core/scene";
import type { AssetPackage } from "../assets/package/readAssetPackage";
import type { NativeNpcProfile } from "../assets/native/loadNativeNpcProfiles";
import type { EntityRegistry } from "../entities/EntityRegistry";
import type { NativeSliceAdapter } from "../world/NativeSliceAdapter";
import { loadNativeEffectComponents } from "../effects/nativeEffectComponents";
import { createNativeEffectComponentPreview, type NativeEffectComponentPreview } from "../effects/nativeEffectComponentPreview";
import { createNativeEffectInitPreview, type NativeEffectInitPreview } from "../effects/nativeEffectInitPreview";
import { createNativeEffectShotPreview, type NativeEffectShotPreview } from "../effects/nativeEffectShotPreview";
import { createNativePowerStrikePreview, type NativePowerStrikePreview } from "../effects/nativePowerStrikePreview";
import { resolveNativePowerStrikeShotSource, resolveNativePowerStrikeShotTarget } from "../effects/nativePowerStrikeSource";
import { failureText } from "./settledTasks";

export interface NativeSliceEffects {
  effectComponents: NativeEffectComponentPreview | null;
  effectComponentFailure: string | null;
  initEffect: NativeEffectInitPreview | null;
  shotEffect: NativeEffectShotPreview | null;
  powerStrike: NativePowerStrikePreview | null;
  powerStrikeReason: string | null;
}

export interface NativeSliceEffectInputs {
  scene: Scene;
  registry: EntityRegistry;
  adapter: NativeSliceAdapter;
  fighter: AssetPackage;
  musveren: NativeNpcProfile;
  specialAttackPreview: { clip: string | null; reason: string | null };
  signal: AbortSignal;
  validateLifetime: () => void;
  addRelease: (release: () => void) => void;
}

const localPlayerAlive = (registry: EntityRegistry) => () => (registry.localPlayer?.health ?? 0) > 0;

export async function createNativeSliceEffects(inputs: NativeSliceEffectInputs): Promise<NativeSliceEffects> {
  const { scene, registry, adapter, specialAttackPreview, signal, addRelease } = inputs;
  const effects: NativeSliceEffects = { effectComponents: null, effectComponentFailure: null, initEffect: null, shotEffect: null,
    powerStrike: null, powerStrikeReason: "Original skill effect components are not staged." };
  try {
    const effectBundle = await loadNativeEffectComponents(signal);
    inputs.validateLifetime();
    if (!effectBundle) return effects;
    const effectComponents = createNativeEffectComponentPreview(scene, effectBundle,
      () => registry.attachmentAnchor("local-player", "right-hand"), localPlayerAlive(registry), signal);
    effects.effectComponents = effectComponents;
    addRelease(() => effectComponents.dispose());
    if (specialAttackPreview.clip) {
      const initEffect = createNativeEffectInitPreview(scene, effectBundle, specialAttackPreview.clip, () => {
        const player = registry.localPlayer;
        return { anchor: registry.attachmentAnchor("local-player", "right-hand"), clock: registry.sourceClock("local-player"),
          sequence: player?.animationSequence ?? 0, action: player?.actionPreview ?? null,
          animation: player?.animation ?? "idle", alive: (player?.health ?? 0) > 0 };
      }, signal);
      effects.initEffect = initEffect;
      addRelease(() => initEffect.dispose());
      addRelease(effectComponents.subscribe(() => {
        if (effectComponents.snapshot().selection.component !== null) void initEffect.setEnabled(false);
      }));
    }
    const shotSource = resolveNativePowerStrikeShotSource(inputs.fighter, specialAttackPreview.clip);
    const shotTarget = resolveNativePowerStrikeShotTarget(inputs.musveren);
    const init = effects.initEffect;
    effects.powerStrikeReason = !init ? specialAttackPreview.reason ?? "The original special-attack clip is unavailable." : shotSource.reason ?? shotTarget.reason;
    if (!init || !shotSource.source || !shotTarget.target) return effects;
    const musverenShotTarget = shotTarget.target;
    const shot = createNativeEffectShotPreview(scene, effectBundle, shotSource.source, () => {
      const player = registry.localPlayer, targetId = player?.actionTargetId ?? null;
      const entity = targetId ? registry.entity(targetId) : null, pivot = targetId ? registry.actorPivot(targetId) : null;
      return { caster: registry.actorPivot("local-player"), targetId,
        target: entity && pivot && targetId === "native-musveren" ? { pivot, collisionRadius: musverenShotTarget.collisionRadius, profileId: musverenShotTarget.profileId, alive: entity.health > 0 } : null,
        clock: registry.sourceClock("local-player"), sequence: player?.animationSequence ?? 0,
        action: player?.actionPreview ?? null, animation: player?.animation ?? "idle", alive: (player?.health ?? 0) > 0 };
    }, signal);
    effects.shotEffect = shot;
    addRelease(() => shot.dispose());
    const powerStrike = createNativePowerStrikePreview(init, shot, () => {
      const selectedOrOnlyNpcId = registry.selectedEntityId ?? "native-musveren";
      const entity = selectedOrOnlyNpcId === "native-musveren" ? registry.entity(selectedOrOnlyNpcId) : null;
      const pivot = entity ? registry.actorPivot(selectedOrOnlyNpcId) : null;
      return entity && pivot ? { id: selectedOrOnlyNpcId, name: entity.displayName, rootUniqueId: pivot.root.uniqueId,
        isValid: () => pivot.isValid() && (registry.entity(selectedOrOnlyNpcId)?.health ?? 0) > 0 } : null;
    }, localPlayerAlive(registry), async () => { await effectComponents.select(null); },
    targetId => adapter.dispatch({ type: "preview-action", action: "special-attack", targetId }),
    listener => adapter.subscribeCommands(listener));
    effects.powerStrike = powerStrike;
    addRelease(() => powerStrike.dispose());
  } catch (error) {
    inputs.validateLifetime();
    effects.effectComponentFailure = failureText(error, "Original skill components could not be prepared.");
  }
  return effects;
}
