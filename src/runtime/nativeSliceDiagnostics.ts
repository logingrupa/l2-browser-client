import type { Scene } from "@babylonjs/core/scene";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { NativePlayerProfile } from "../assets/native/loadNativePlayerProfiles";
import type { NativeNpcProfile } from "../assets/native/loadNativeNpcProfiles";
import type { NativeSliceAdapter, NativeSliceSpeedProfile } from "../world/NativeSliceAdapter";
import type { EntityRegistry } from "../entities/EntityRegistry";
import type { WorldInterface } from "../ui/WorldInterface";
import type { NativeSection } from "../scene/world/loadNativeSection";
import { inspectNativeGroundContact } from "../scene/world/nativeGroundContact";
import type { WorldGroundContact } from "../world/WorldNavigation";
import { worldPositionToSource, type SourcePosition } from "../world/sourceFrame";
import type { createNativeDoorInteractions } from "../scene/world/nativeDoorInteractions";
import type { createNativeMaterialOverrides } from "../assets/native/nativeMaterialOverrides";
import type { NativeFlamePresentation } from "../scene/world/nativeFlamePresentation";
import type { NativeFlameReplayTime } from "../scene/world/nativeFlameMaterials";
import type { NativeSkyPresentation } from "../scene/world/nativeSkyPresentation";
import type { WorldAudioMixer } from "../audio/WorldAudioMixer";
import type { createNativeActionCuePreview } from "../audio/nativeActionCuePreview";
import type { createNativeFootstepPreview } from "../audio/nativeFootstepPreview";
import type { createFootstepGroundSampler } from "../audio/footstepSurfaceGround";
import type { WorldAmbience } from "../audio/worldAmbience";
import type { WorldMusic } from "../audio/worldMusic";
import type { NativeCombatAudio, NativeCombatInspection } from "../audio/nativeCombatAudio";
import type { NativeEffectShotPreview } from "../effects/nativeEffectShotPreview";
import type { NativePowerStrikePreview } from "../effects/nativePowerStrikePreview";
import type { NativeEffectComponentPreview } from "../effects/nativeEffectComponentPreview";
import type { NativeEffectInitPreview } from "../effects/nativeEffectInitPreview";
import type { resolveNativeHumanHandAnchor } from "../assets/native/nativeHumanHandAnchor";
import type { resolveNativeLocomotionClips } from "../assets/native/nativeLocomotion";
import type { createWorldPerformanceProbe } from "../engine/worldPerformanceProbe";
import type { NativeFlameReplayClock, NativeSliceWorld } from "./loadNativeSliceWorld";
import type { NativeSliceAudio } from "./loadNativeSliceAudio";
import type { NativeSliceEffects } from "./createNativeSliceEffects";
import type { WorldMovement, WorldMovementCollisionCells, WorldMovementInspection } from "./worldMovementWiring";
import type { WorldEnvironment, WorldEnvironmentInspection } from "./worldEnvironmentWiring";
import type { NativeSliceCameraPose } from "./nativeSliceCameraPose";

export interface NativeSliceDiagnosticInputs {
  scene: Scene;
  camera: ArcRotateCamera;
  registry: EntityRegistry;
  adapter: NativeSliceAdapter;
  ui: WorldInterface;
  playerProfile: NativePlayerProfile;
  musveren: NativeNpcProfile;
  handAnchor: ReturnType<typeof resolveNativeHumanHandAnchor>;
  specialAttackPreview: { clip: string | null; reason: string | null };
  locomotionClips: ReturnType<typeof resolveNativeLocomotionClips>;
  world: NativeSliceWorld;
  audio: NativeSliceAudio;
  footsteps: ReturnType<typeof createNativeFootstepPreview>;
  footstepGround: ReturnType<typeof createFootstepGroundSampler>;
  localSurfaceContact: () => WorldGroundContact | null;
  combatAudio: NativeCombatAudio | null;
  combatFailure: string | null;
  effects: NativeSliceEffects;
  doors: ReturnType<typeof createNativeDoorInteractions> | undefined;
  movement: WorldMovement;
  environment: WorldEnvironment;
  materialOverrides: ReturnType<typeof createNativeMaterialOverrides>;
  frameFlame: (placementId: string) => void;
  setCameraPose: (pose: NativeSliceCameraPose) => void;
  failFlames: (error: unknown) => void;
  isDisposed: () => boolean;
  addRelease: (release: () => void) => void;
}

const sourcePositionComponents = (position: SourcePosition) => [position.x, position.y, position.z];

function nativeSliceSnapshot(inputs: NativeSliceDiagnosticInputs) {
  const { scene, camera, registry, adapter, playerProfile, world, audio, effects, doors } = inputs;
  const { section, flames, origin } = world;
  const worldAudio = audio.worldAudio;
  return { entities: registry.snapshot(), playerProfile,
    handAnchor: { ...inputs.handAnchor, policy: "converted-source-rig" as const, nativeCompositionVerified: false as const },
    specialAttackPreview: { ...inputs.specialAttackPreview, policy: "source-animation-preview" as const, nativeSkillVerified: false as const },
    effectComponents: effects.effectComponents?.snapshot() ?? null, effectComponentFailure: effects.effectComponentFailure,
    nativeInitEffect: effects.initEffect?.snapshot() ?? null,
    locomotion: { mode: adapter.locomotionMode, ...inputs.locomotionClips, speed: adapter.speedProfile, clipRate: 1, nativeSpeedVerified: false as const },
    collisionCells: inputs.movement.inspection().collisionCells, movement: inputs.movement.inspection(), environment: inputs.environment.inspection(),
    groundContact: inspectNativeGroundContact(scene, inputs.localSurfaceContact(), section),
    doors: doors ? { manifestSha256: world.movers!.manifestSha256, ...doors.inspection() } : null,
    skinMeshes: scene.meshes.filter(mesh => mesh.metadata?.l2NativeSkinWeights).map(mesh => ({ name: mesh.name, ...mesh.metadata.l2NativeSkinWeights })),
    nativeAttackReference: "unverified", nativeNpcProfile: inputs.musveren ?? null,
    materialOverride: inputs.materialOverrides.snapshot(),
    nativeFlames: flames.presentation?.inspect() ?? null, flameFailure: flames.failure ?? null,
    nativeSky: world.sky?.inspection() ?? null, skyFailure: world.skyFailure,
    nativeAudio: { ...audio.mixer.inspection(), cues: audio.actionCues.inspection(), footsteps: inputs.footsteps.inspection(),
      footstepBundle: { manifests: audio.footstepBundle.manifests, retainedConditionalEvents: audio.footstepBundle.retainedConditionalEvents },
      footstepFailure: audio.footstepFailure, nativeParity: "unverified",
      stepSounds: { manifest: audio.stepSounds.manifest, failure: audio.stepSoundFailure, ground: inputs.footstepGround.inspection(),
        decoGrass: { manifest: audio.decoGrass.manifest, failure: audio.decoGrassFailure } },
      worldAudio: { failure: worldAudio.failure, loading: worldAudio.loading, ambience: worldAudio.ambience?.inspection() ?? null, music: worldAudio.music?.inspection() ?? null },
      combat: inputs.combatAudio?.inspection() ?? null, combatFailure: inputs.combatFailure },
    powerStrike: { reason: effects.powerStrikeReason, action: effects.powerStrike?.snapshot() ?? null, shot: effects.shotEffect?.snapshot() ?? null },
    devSheet: inputs.ui.sheet.inspect(),
    flameReplay: flames.clock ? { ...flames.clock.inspect(), billboardTarget: "browser camera position proxy; native viewport actor equality unverified" } : null,
    nativeTerrain: section ? "source-section-loaded" : "not-loaded-in-actor-scene", phase2Networking: false,
    worldFailure: world.worldFailure ?? null,
    fog: { enabled: scene.fogEnabled, mode: scene.fogMode, start: scene.fogStart, end: scene.fogEnd },
    world: section ? { manifestSha256: section.manifestSha256, ...section.inspection(),
      sourceSpawn: sourcePositionComponents(worldPositionToSource(origin)), nativeLocationMatch: "unverified",
      collision: "MOVE-01 collision world over native-tile-collision cells; native server geodata unverified" } : null,
    fps: scene.getEngine().getFps(), camera: { target: camera.target.asArray(), alpha: camera.alpha, beta: camera.beta, radius: camera.radius,
      lowerRadiusLimit: camera.lowerRadiusLimit, upperRadiusLimit: camera.upperRadiusLimit, lowerBetaLimit: camera.lowerBetaLimit, upperBetaLimit: camera.upperBetaLimit } };
}

export function attachNativeSliceDiagnostics(inputs: NativeSliceDiagnosticInputs): () => void {
  const { scene, adapter, audio, world, doors } = inputs;
  const { flames } = world;
  let onDemandPerformanceProbe: ReturnType<typeof createWorldPerformanceProbe> | undefined;
  const diagnostics = { snapshot: () => nativeSliceSnapshot(inputs),
    dispatch: adapter.dispatch.bind(adapter),
    async performance() {
      if (inputs.isDisposed()) throw new Error("The native world is disposed.");
      const module = await import("../engine/worldPerformanceProbe");
      if (inputs.isDisposed()) throw new Error("The native world was disposed while loading diagnostics.");
      return onDemandPerformanceProbe ??= module.createWorldPerformanceProbe(scene);
    },
    captureAudio: () => audio.mixer.captureStream(),
    setWorldAudioEnabled(enabled: boolean) {
      if (!enabled) audio.mixer.detachGestureUnlock(); else inputs.addRelease(audio.mixer.attachGestureUnlock(window));
      audio.worldAudio.music?.setEnabled(enabled); audio.worldAudio.ambience?.setEnabled(enabled);
    },
    frameFlame: inputs.frameFlame,
    setCameraPose: inputs.setCameraPose,
    collisionSurfaceHeightsAt: (x: number, z: number) => inputs.movement.collisionSurfaceHeightsAt(x, z),
    interactDoor(id: string) {
      if (!doors) throw new Error("Native doors are unavailable.");
      doors.activate(id);
    },
    setFlameReplay(time: NativeFlameReplayTime) {
      if (!flames.presentation || !flames.clock) throw new Error("Native flame preview is unavailable.");
      flames.presentation.validateReplayTime(time);
      flames.clock.seek(time);
      try { flames.update(time); }
      catch (error) { inputs.failFlames(error); throw error; }
    } };
  window.__nativeSlice = diagnostics;
  return () => {
    if (window.__nativeSlice === diagnostics) delete window.__nativeSlice;
    onDemandPerformanceProbe?.dispose();
  };
}

declare global { interface Window { __nativeSlice?: { snapshot(): { entities: ReturnType<EntityRegistry["snapshot"]>; skinMeshes: unknown[];
  playerProfile?: NativePlayerProfile;
  handAnchor?: ReturnType<typeof resolveNativeHumanHandAnchor> & { policy: "converted-source-rig"; nativeCompositionVerified: false };
  specialAttackPreview?: { clip: string | null; reason: string | null; policy: "source-animation-preview"; nativeSkillVerified: false };
  effectComponents?: ReturnType<NativeEffectComponentPreview["snapshot"]> | null; effectComponentFailure?: string | null;
  nativeInitEffect?: ReturnType<NativeEffectInitPreview["snapshot"]> | null;
  locomotion?: { mode: "walk" | "run"; walkClip: string | null; runClip: string; reason: string | null; speed: NativeSliceSpeedProfile;
    clipRate: number; nativeSpeedVerified: false };
  collisionCells?: WorldMovementCollisionCells; movement?: WorldMovementInspection; environment?: WorldEnvironmentInspection;
  groundContact?: ReturnType<typeof inspectNativeGroundContact>;
  doors?: (ReturnType<ReturnType<typeof createNativeDoorInteractions>["inspection"]> & { manifestSha256: string }) | null;
  nativeAttackReference: string; nativeNpcProfile: NativeNpcProfile | null; nativeTerrain: string; phase2Networking: boolean; worldFailure: string | null;
  materialOverride?: ReturnType<ReturnType<typeof createNativeMaterialOverrides>["snapshot"]>;
  nativeFlames?: ReturnType<NativeFlamePresentation["inspect"]> | null; flameFailure?: string | null;
  nativeSky?: ReturnType<NativeSkyPresentation["inspection"]> | null; skyFailure?: string | null;
  nativeAudio?: ReturnType<WorldAudioMixer["inspection"]> & { cues: ReturnType<Awaited<ReturnType<typeof createNativeActionCuePreview>>["inspection"]>;
    footsteps: ReturnType<ReturnType<typeof createNativeFootstepPreview>["inspection"]>;
    footstepBundle: { manifests: string[]; retainedConditionalEvents: number }; footstepFailure: string | null; nativeParity: string;
    stepSounds?: { manifest: string | null; failure: string | null; ground: ReturnType<ReturnType<typeof createFootstepGroundSampler>["inspection"]>;
      decoGrass: { manifest: string | null; failure: string | null } };
    worldAudio?: { failure: string | null; loading?: boolean; ambience: ReturnType<WorldAmbience["inspection"]> | null; music: ReturnType<WorldMusic["inspection"]> | null };
    combat?: NativeCombatInspection | null; combatFailure?: string | null };
  powerStrike?: { reason: string | null; action: ReturnType<NativePowerStrikePreview["snapshot"]> | null; shot: ReturnType<NativeEffectShotPreview["snapshot"]> | null };
  devSheet?: ReturnType<WorldInterface["sheet"]["inspect"]>;
  flameReplay?: (ReturnType<NativeFlameReplayClock["inspect"]> & { billboardTarget: string }) | null;
  fog?: { enabled: boolean; mode: number; start: number; end: number };
  world?: (ReturnType<NativeSection["inspection"]> & { manifestSha256: string; sourceSpawn: number[]; nativeLocationMatch: string; collision: string }) | null;
  fps?: number; camera?: { target: number[]; alpha: number; beta: number; radius: number;
    lowerRadiusLimit: number | null; upperRadiusLimit: number | null; lowerBetaLimit: number | null; upperBetaLimit: number | null } }; dispatch: NativeSliceAdapter["dispatch"]; performance(): Promise<ReturnType<typeof createWorldPerformanceProbe>>; captureAudio?(): MediaStream | null; setWorldAudioEnabled?(enabled: boolean): void; setFlameReplay?(time: NativeFlameReplayTime): void; frameFlame?(placementId: string): void; setCameraPose?(pose: NativeSliceCameraPose): void; collisionSurfaceHeightsAt?(x: number, z: number): number[]; interactDoor?(id: string): void } } }
