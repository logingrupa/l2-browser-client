import type { AssetPackage } from "../assets/package/readAssetPackage";
import { WorldAudioMixer } from "../audio/WorldAudioMixer";
import { createNativeActionCuePreview, type NativeActionCuePreview } from "../audio/nativeActionCuePreview";
import { loadNativeAnimationAudio, type NativeAnimationAudioBundle } from "../assets/native/loadNativeAnimationAudio";
import { loadNativeStepSounds, type NativeStepSoundBundle } from "../assets/native/loadNativeStepSounds";
import { loadNativeStepDecoGrass, type NativeStepDecoGrassBundle } from "../assets/native/loadNativeStepDecoGrass";
import { loadNativeWorldAudio, readNativeWorldAudioRecords } from "../assets/native/loadNativeWorldAudio";
import { createWorldAmbience, type WorldAmbience } from "../audio/worldAmbience";
import { createWorldMusic, type WorldMusic } from "../audio/worldMusic";
import { loadNativeCombatAudio, type NativeCombatAudioBundle } from "../audio/loadNativeCombatAudio";
import { createNativeCombatAudio, type NativeCombatActor, type NativeCombatAudio, type NativeCombatWorld } from "../audio/nativeCombatAudio";
import { failureText, settle, type Settled } from "./nativeSliceSheet";

export interface NativeSliceAudioLoads {
  stepSounds: Promise<Settled<NativeStepSoundBundle>>;
  decoGrass: Promise<Settled<NativeStepDecoGrassBundle>>;
  combat: Promise<Settled<NativeCombatAudioBundle | null>>;
  worldAudio: Promise<Settled<Awaited<ReturnType<typeof loadNativeWorldAudio>>>>;
}

export function beginNativeSliceAudioLoads(animationAudio: unknown, signal: AbortSignal): NativeSliceAudioLoads {
  return {
    stepSounds: settle(loadNativeStepSounds(animationAudio, signal)),
    decoGrass: settle(loadNativeStepDecoGrass(animationAudio, signal)),
    combat: settle(loadNativeCombatAudio(signal)),
    worldAudio: settle(readNativeWorldAudioRecords(signal).then(records => loadNativeWorldAudio(records, signal))),
  };
}

export interface NativeSliceWorldAudioState {
  ambience: WorldAmbience | null;
  music: WorldMusic | null;
  failure: string | null;
  loading: boolean;
  onChange: (() => void) | null;
}

export interface NativeSliceAudio {
  mixer: WorldAudioMixer;
  actionCues: NativeActionCuePreview;
  footstepBundle: NativeAnimationAudioBundle;
  footstepFailure: string | null;
  stepSounds: NativeStepSoundBundle;
  stepSoundFailure: string | null;
  decoGrass: NativeStepDecoGrassBundle;
  decoGrassFailure: string | null;
  worldAudio: NativeSliceWorldAudioState;
  combatBundle: NativeCombatAudioBundle | null;
  combatBundleFailure: string | null;
  listenerFollowsLocalPawn: () => boolean;
}

export interface NativeSliceAudioInputs {
  assets: ReadonlyMap<string, AssetPackage>;
  animationAudio: unknown;
  archiveHashes: ReadonlyMap<string, string>;
  activeCatalogIds: string[];
  hasWorldSection: boolean;
  signal: AbortSignal;
  validateLifetime: () => void;
  isRuntimeStopped: () => boolean;
  addRelease: (release: () => void) => void;
}

const emptyFootstepBundle = (): NativeAnimationAudioBundle => ({ definitions: [], sounds: [], manifests: [], retainedConditionalEvents: 0 });

function watchWorldAudio(load: NativeSliceAudioLoads["worldAudio"], mixer: WorldAudioMixer, state: NativeSliceWorldAudioState, inputs: NativeSliceAudioInputs): void {
  void load.then(result => {
    if (inputs.isRuntimeStopped()) return;
    state.loading = false;
    if (result.ok) {
      try {
        const { ambience: ambienceBundle, music: musicBundle } = result.value;
        if (ambienceBundle) { const created = createWorldAmbience(ambienceBundle, mixer); state.ambience = created; inputs.addRelease(() => created.dispose()); }
        if (musicBundle) { const created = createWorldMusic(musicBundle, mixer); state.music = created; inputs.addRelease(() => created.dispose()); }
      } catch (error) { state.failure = failureText(error, "Map music and ambience could not be prepared."); }
    } else state.failure = failureText(result.error, "Map music and ambience could not be verified.");
    state.onChange?.();
  });
}

export async function loadNativeSliceAudio(loads: NativeSliceAudioLoads, inputs: NativeSliceAudioInputs): Promise<NativeSliceAudio> {
  const mixer = new WorldAudioMixer();
  inputs.addRelease(() => mixer.dispose());
  inputs.addRelease(mixer.attachGestureUnlock(window));
  const actionCues = await createNativeActionCuePreview(inputs.assets, mixer, {
    activeCatalogIds: inputs.activeCatalogIds, includeHumanSpecialAttackCues: true,
  });
  inputs.addRelease(() => actionCues.dispose());
  let footstepFailure: string | null = null, footstepBundle = emptyFootstepBundle();
  try {
    footstepBundle = await loadNativeAnimationAudio(inputs.animationAudio, inputs.assets, inputs.archiveHashes, inputs.signal);
    inputs.validateLifetime();
    for (const sound of footstepBundle.sounds) mixer.register(sound.key, sound.bytes);
  } catch (error) {
    inputs.validateLifetime();
    footstepFailure = failureText(error, "Original footstep dependencies failed to load.");
    footstepBundle = emptyFootstepBundle();
  }
  let stepSounds: NativeStepSoundBundle = { library: null, sounds: [], manifest: null }, stepSoundFailure: string | null = null;
  const stepSoundResult = await loads.stepSounds;
  inputs.validateLifetime();
  if (stepSoundResult.ok) {
    stepSounds = stepSoundResult.value;
    for (const sound of stepSounds.sounds) mixer.register(sound.key, sound.bytes);
  } else stepSoundFailure = failureText(stepSoundResult.error, "Original stepsound package failed to load.");
  const decoGrassResult = await loads.decoGrass;
  inputs.validateLifetime();
  const decoGrass: NativeStepDecoGrassBundle = decoGrassResult.ok ? decoGrassResult.value : { field: null, manifest: null };
  const decoGrassFailure = decoGrassResult.ok ? null : failureText(decoGrassResult.error, "Deco-grass footstep data failed to load.");
  const worldAudio: NativeSliceWorldAudioState = { ambience: null, music: null, failure: null, loading: inputs.hasWorldSection, onChange: null };
  if (inputs.hasWorldSection) watchWorldAudio(loads.worldAudio, mixer, worldAudio, inputs);
  const combatResult = await loads.combat;
  inputs.validateLifetime();
  return { mixer, actionCues, footstepBundle, footstepFailure, stepSounds, stepSoundFailure, decoGrass, decoGrassFailure, worldAudio,
    combatBundle: combatResult.ok ? combatResult.value : null,
    combatBundleFailure: combatResult.ok ? null : failureText(combatResult.error, "Original combat sounds failed to load."),
    listenerFollowsLocalPawn: () => worldAudio.ambience !== null || worldAudio.music !== null };
}

export function createNativeSliceCombatAudio(audio: NativeSliceAudio, world: NativeCombatWorld, actors: readonly NativeCombatActor[],
  addRelease: (release: () => void) => void): { combatAudio: NativeCombatAudio | null; combatFailure: string | null } {
  try {
    const combatAudio = createNativeCombatAudio(audio.combatBundle, audio.mixer, world, actors);
    addRelease(() => combatAudio.dispose());
    return { combatAudio, combatFailure: audio.combatBundleFailure };
  } catch (error) {
    return { combatAudio: null, combatFailure: audio.combatBundleFailure ?? failureText(error, "Combat hit sounds could not be prepared.") };
  }
}
