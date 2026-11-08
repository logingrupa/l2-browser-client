import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { loadNativeActorCatalog } from "../assets/native/loadNativeCatalog";
import { defaultNativePlayerProfile, type NativePlayerProfile } from "../assets/native/loadNativePlayerProfiles";
import type { NativeNpcProfile } from "../assets/native/loadNativeNpcProfiles";
import type { AssetPackage } from "../assets/package/readAssetPackage";
import { nativeCharacterFactory, type NativeCharacterProfile } from "../assets/native/NativeCharacterVisual";
import { createNativeClipPreviewHub } from "../assets/native/nativeClipPreview";
import { nativeAliasCoverage, nativeAliasCoverageText } from "../assets/native/nativeAnimationAliases";
import { attachNativeAnimationAliasTable } from "../ui/nativeAnimationAliasTable";
import { NativeSliceAdapter, nativeSliceSpeedProfile, type NativeSliceSpeedProfile } from "../world/NativeSliceAdapter";
import { EntityRegistry } from "../entities/EntityRegistry";
import { WorldInterface } from "../ui/WorldInterface";
import { attachTargeting } from "../entities/attachTargeting";
import { attachWorldCamera } from "../camera/WorldCamera";
import { loadNativeSection, type NativeSection } from "../scene/world/loadNativeSection";
import { attachAuthoredNativeSection } from "../scene/world/loadAuthoredNativeSection";
import { inspectNativeGroundContact } from "../scene/world/nativeGroundContact";
import { loadNativeMovers, type NativeMovers } from "../scene/world/loadNativeMovers";
import { createNativeDoorInteractions } from "../scene/world/nativeDoorInteractions";
import { createWorldNavigation } from "../world/meshNavigation";
import type { WorldNavigation } from "../world/WorldNavigation";
import { getWorldCanvas } from "../scene/getWorldCanvas";
import { createNativeMaterialOverrides } from "../assets/native/nativeMaterialOverrides";
import { restoreEditorAuthoredMaterials } from "../editor/restoreEditorAuthoredMaterials";
import { createNativeFlamePresentation, type NativeFlamePresentation } from "../scene/world/nativeFlamePresentation";
import { nativeFlameBrowserToNative } from "../scene/world/nativeFlameBillboards";
import { createNativeFlameReplayClock } from "../scene/world/nativeFlameReplayClock";
import type { NativeFlameReplayTime } from "../scene/world/nativeFlameMaterials";
import type { SceneStartupProgress } from "../scene/guardSceneStartup";
import { createNativeSkyPresentation, type NativeSkyPresentation } from "../scene/world/nativeSkyPresentation";
import { WorldAudioMixer } from "../audio/WorldAudioMixer";
import { createNativeActionCuePreview } from "../audio/nativeActionCuePreview";
import { attachWorldAudioControls } from "../audio/worldAudioControls";
import { loadNativeAnimationAudio } from "../assets/native/loadNativeAnimationAudio";
import { createNativeFootstepPreview, NATIVE_FOOTSTEP_WORLD_DEFAULT } from "../audio/nativeFootstepPreview";
import { attachNativeFootstepControls } from "../audio/nativeFootstepControls";
import { loadNativeStepSounds, type NativeStepSoundBundle } from "../assets/native/loadNativeStepSounds";
import { loadNativeStepDecoGrass, type NativeStepDecoGrassBundle } from "../assets/native/loadNativeStepDecoGrass";
import { createFootstepGroundSampler } from "../audio/footstepSurfaceGround";
import { loadNativeWorldAudio, readNativeWorldAudioRecords } from "../assets/native/loadNativeWorldAudio";
import { createWorldAmbience, type WorldAmbience } from "../audio/worldAmbience";
import { createWorldMusic, type WorldMusic } from "../audio/worldMusic";
import { loadNativeCombatAudio } from "../audio/loadNativeCombatAudio";
import { createNativeCombatAudio, type NativeCombatAudio, type NativeCombatInspection } from "../audio/nativeCombatAudio";
import { attachNativeCombatAudioControls } from "../audio/nativeCombatAudioControls";
import { createNativeEffectShotPreview, type NativeEffectShotPreview } from "../effects/nativeEffectShotPreview";
import { createNativePowerStrikePreview, type NativePowerStrikePreview } from "../effects/nativePowerStrikePreview";
import { resolveNativePowerStrikeShotSource, resolveNativePowerStrikeShotTarget } from "../effects/nativePowerStrikeSource";
import { attachNativePowerStrikeControls } from "../ui/nativePowerStrikeControls";
import type { DevGroup } from "../ui/devSheet/DevSheet";
import type { VariableInfo } from "../ui/devSheet/types";
import { PRESENTATION_CHOICE, SheetDescriber, failureText, pickRows, settle, worldAudioVariables } from "./nativeSliceSheet";
import { attachNativeSliceDebugSection } from "./nativeSliceDebug";
import { resolveNativeLocomotionClips } from "../assets/native/nativeLocomotion";
import { resolveNativeSpecialAttackPreview } from "../assets/native/nativeSpecialAttackPreview";
import { resolveNativeHumanHandAnchor } from "../assets/native/nativeHumanHandAnchor";
import { loadNativeEffectComponents } from "../effects/nativeEffectComponents";
import { createNativeEffectComponentPreview, type NativeEffectComponentPreview } from "../effects/nativeEffectComponentPreview";
import { createEffectInspectionCamera } from "../effects/nativeEffectInspectionCamera";
import { attachNativeEffectComponentControls } from "../ui/nativeEffectComponentControls";
import { createNativeEffectInitPreview, type NativeEffectInitPreview } from "../effects/nativeEffectInitPreview";
import { attachNativeEffectInitControls } from "../ui/nativeEffectInitControls";
import { attachNativeLocomotionControls } from "../ui/nativeLocomotionControls";
import { attachNativeSkyEnvironmentControls } from "../scene/world/nativeSkyEnvironmentControls";
import type { createWorldPerformanceProbe } from "../engine/worldPerformanceProbe";
import { attachAssetImport } from "../ui/AssetImportPanel";
import { isSceneSuspended, setSceneSuspended } from "../engine/renderSuspension";

export interface NativeSliceSettings {
  playerProfileId?: string;
  origin: Vector3;
  leatherShirt: boolean;
  fighterIdle: string;
  fighterRun: string;
  fighterAttack: string;
  fighterDeath: string;
  materialOverrideEnabled?: boolean;
  materialEntityId?: string;
  materialSource?: string;
  materialTint?: Vector3;
  materialRoughness?: number;
  flamePreviewEnabled?: boolean;
  flameTextureSeconds?: number;
  flameFadeSeconds?: number;
  flameTextureRate?: number;
  flameFadeRate?: number;
}

export async function createNativeSliceRuntime(scene: Scene, settings: NativeSliceSettings, signal: AbortSignal,
  options: { requireWorld?: boolean; onProgress?: (progress: SceneStartupProgress) => void } = {}): Promise<() => void> {
  const validateLifetime = () => {
    signal.throwIfAborted();
    if (scene.isDisposed) throw new Error("The native scene was disposed during startup.");
    if (!(scene.getCameraByName("World camera") instanceof ArcRotateCamera)) throw new Error("Authored orbit camera is missing.");
  };
  validateLifetime();
  const canvas = getWorldCanvas(scene.getEngine());
  if (!canvas) throw new Error("The native scene requires a rendering canvas.");
  options.onProgress?.({ stage: "assets", detail: "Loading native character and equipment packages…" });
  const selectedId = new URLSearchParams(window.location?.search ?? "").get("character") ?? settings.playerProfileId ?? defaultNativePlayerProfile.id;
  const catalog = await loadNativeActorCatalog(signal, selectedId);
  const playerProfile = catalog.playerProfile ?? defaultNativePlayerProfile;
  const playerChoices = catalog.playerProfiles ?? new Map([[playerProfile.id, playerProfile]]);
  const usesDefaultPlayerProfile = playerProfile.id === defaultNativePlayerProfile.id;
  const appearanceId = usesDefaultPlayerProfile ? "native-human-fighter" : `native-player:${playerProfile.id}`;
  const playerClipsWithSavedFighterEdits = () => usesDefaultPlayerProfile
    ? { idle: settings.fighterIdle, run: settings.fighterRun, attack: settings.fighterAttack, death: settings.fighterDeath }
    : playerProfile.clips;
  const assets: ReadonlyMap<string, AssetPackage> = catalog.models, musveren = catalog.npcProfiles.get("npc:21622");
  validateLifetime();
  if (![playerProfile.catalogId, "musveren:0", ...playerProfile.upperItems.map(item => item.catalogId)].every(id => assets.has(id))) {
    throw new Error("The selected native character, Musveren or equipment package is unavailable. Stage its verified player assets.");
  }
  if (!musveren || musveren.mesh !== assets.get("musveren:0")!.manifest.source.object ||
    musveren.prePivot?.some(value => value !== 0)) {
    throw new Error("The native slice needs its verified NPC 21622 profile and a supported actor pivot.");
  }
  const fighter = assets.get(playerProfile.catalogId)!, monster = assets.get("musveren:0")!;
  const profiles = new Map<string, NativeCharacterProfile>([
    [appearanceId, { asset: fighter,
      clips: playerClipsWithSavedFighterEdits(),
      upperItems: new Map(playerProfile.upperItems.map(item => [item.itemId, assets.get(item.catalogId)!])),
      forwardAxis: Vector3.FromArray(playerProfile.forwardAxis), actorScale: Vector3.FromArray(playerProfile.actorScale) }],
    ["native-musveren", { asset: monster, collisionHalfHeight: musveren!.collisionHeight / musveren!.sourceUnitsPerMetre,
      actorScale: new Vector3(musveren!.drawScale3D[0], musveren!.drawScale3D[2], musveren!.drawScale3D[1]).scale(musveren!.drawScale),
      clips: { idle: "Wait", run: "run", attack: "atk01", death: "death" } }],
  ]);
  const boundaryReleases: (() => void)[] = [];
  let disposed = false;
  const stop = () => {
    if (disposed) return;
    disposed = true;
    for (const release of boundaryReleases.reverse()) release();
    boundaryReleases.length = 0;
  };
  const settledStepSoundLoad = settle(loadNativeStepSounds(catalog.animationAudio, signal));
  const settledDecoGrassLoad = settle(loadNativeStepDecoGrass(catalog.animationAudio, signal));
  const settledCombatAudioLoad = settle(loadNativeCombatAudio(signal));
  const settledWorldAudioLoad = settle(readNativeWorldAudioRecords(signal).then(records => loadNativeWorldAudio(records, signal)));
  try {
    const authoredMeshes = scene.meshes.map(mesh => ({ mesh, enabled: mesh.isEnabled(false) }));
    let section: NativeSection | null = null, navigation: WorldNavigation | undefined, worldFailure: string | undefined;
    let movers: NativeMovers | null = null;
    let flames: NativeFlamePresentation | undefined, flameFailure: string | undefined;
    let flameClock: ReturnType<typeof createNativeFlameReplayClock> | undefined;
    const disposeFlames = () => { flames?.dispose(); flames = undefined; };
    const worldLifetime = new AbortController(), flameLifetime = new AbortController();
    const abortFlamesBeforeWorld = () => { flameLifetime.abort(); disposeFlames(); worldLifetime.abort(); };
    signal.addEventListener("abort", abortFlamesBeforeWorld, { once: true });
    const worldDisposeObserver = scene.onDisposeObservable.addOnce(abortFlamesBeforeWorld);
    boundaryReleases.push(() => {
      signal.removeEventListener("abort", abortFlamesBeforeWorld); scene.onDisposeObservable.remove(worldDisposeObserver); abortFlamesBeforeWorld();
    });
    const cameraPositionAsFlameBillboardTarget = () => {
      const camera = scene.getCameraByName("World camera") as ArcRotateCamera;
      camera.getViewMatrix(true);
      return nativeFlameBrowserToNative([camera.globalPosition.x, camera.globalPosition.y, camera.globalPosition.z]);
    };
    const updateFlames = (time: NativeFlameReplayTime) => {
      if (!flames) return;
      flames.update(time, cameraPositionAsFlameBillboardTarget());
      const state = flames.inspect();
      if (state.status === "failed" || state.status === "aborted") throw new Error(state.failure ?? "Native flame preview ended unexpectedly.");
    };
    const playerCapsuleFromSourceCollision = () => ({ radius: playerProfile.collisionRadius / playerProfile.sourceUnitsPerMetre,
      height: 2 * playerProfile.collisionHeight / playerProfile.sourceUnitsPerMetre });
    let restoreAuthoredCamera: (() => void) | undefined;
    let restoreEditorMaterials: (() => void) | undefined;
    let origin = settings.origin, followFighter = true;
    try {
      options.onProgress?.({ stage: "assets", detail: "Preparing native terrain and scenery…" });
      restoreEditorMaterials = restoreEditorAuthoredMaterials(scene, signal);
      boundaryReleases.push(() => restoreEditorMaterials?.());
      const authoredSection = attachAuthoredNativeSection(scene, worldLifetime.signal);
      section = authoredSection ?? await loadNativeSection(scene, worldLifetime.signal);
      if (!section && options.requireWorld) throw new Error("The native world section is unavailable. Reload to try again.");
      if (section) {
        boundaryReleases.push(() => section?.dispose());
        validateLifetime();
        movers = await loadNativeMovers(scene, section.manifest.terrain.sha256, worldLifetime.signal);
        if (movers) boundaryReleases.push(() => movers?.dispose());
        validateLifetime();
        if (options.requireWorld && section.inspection().materialFailure) throw new Error(`Native terrain materials failed: ${section.inspection().materialFailure}`);
        if (authoredSection?.removedZReflection) {
          const camera = scene.getCameraByName("World camera") as ArcRotateCamera;
          const authoredLeftHandedAlpha = camera.alpha, authoredLeftHandedTarget = camera.target.clone();
          camera.alpha = -authoredLeftHandedAlpha;
          camera.setTarget(new Vector3(authoredLeftHandedTarget.x, authoredLeftHandedTarget.y, -authoredLeftHandedTarget.z), false, false, true);
          restoreAuthoredCamera = () => {
            restoreAuthoredCamera = undefined;
            camera.alpha = authoredLeftHandedAlpha; camera.setTarget(authoredLeftHandedTarget, false, false, true);
          };
          boundaryReleases.push(() => restoreAuthoredCamera?.());
        }
        if (!section.spawnCandidate) throw new Error("The staged native section has no source-derived surface candidate.");
        const surfaceCandidateWithAuthoredOffset = section.spawnCandidate.add(settings.origin);
        navigation = createWorldNavigation({ terrainMeshes: section.terrainMeshes, obstacleMeshes: () => section?.supportMeshes ?? [],
          origin: surfaceCandidateWithAuthoredOffset, dynamicObstacleMeshes: () => movers?.collisionMeshes ?? [],
          capsule: playerCapsuleFromSourceCollision() });
        const previewTriangleSupportedSpawn = navigation.spawn();
        if (!previewTriangleSupportedSpawn) throw new Error("The staged native surface does not support the requested actor origin.");
        origin = new Vector3(previewTriangleSupportedSpawn.x, previewTriangleSupportedSpawn.y, previewTriangleSupportedSpawn.z);
        if (!authoredSection) {
          for (const { mesh } of authoredMeshes) mesh.setEnabled(false);
          boundaryReleases.push(() => { for (const { mesh, enabled } of authoredMeshes) if (!mesh.isDisposed()) mesh.setEnabled(enabled); });
        }
        if (settings.flamePreviewEnabled !== false) {
          try {
            flameClock = createNativeFlameReplayClock({ textureSeconds: settings.flameTextureSeconds ?? 0,
              fadeSeconds: settings.flameFadeSeconds ?? 0, textureRate: settings.flameTextureRate ?? 1, fadeRate: settings.flameFadeRate ?? 1 });
            flames = await createNativeFlamePresentation(scene, section, flameLifetime.signal);
            boundaryReleases.push(disposeFlames);
            validateLifetime();
            const prepared = flames.inspect();
            if (prepared.status === "failed" || prepared.status === "aborted") throw new Error(prepared.failure ?? "Native flame preview failed to prepare.");
            if (prepared.status === "not-present") { disposeFlames(); flameClock = undefined; }
            else updateFlames(flameClock.advance(0, false));
          } catch (error) {
            disposeFlames();
            validateLifetime();
            if (options.requireWorld) throw error;
            flameFailure = error instanceof Error ? error.message : "Native flame preview could not be verified.";
          }
        }
      }
    } catch (error) {
      flameLifetime.abort();
      disposeFlames();
      movers?.dispose(); movers = null;
      section?.dispose(); section = null; navigation = undefined; origin = settings.origin;
      restoreEditorMaterials?.(); restoreEditorMaterials = undefined;
      restoreAuthoredCamera?.();
      validateLifetime();
      if (options.requireWorld) throw error;
      worldFailure = error instanceof Error ? error.message : "Native world could not be verified.";
    }
    validateLifetime();
    let sky: NativeSkyPresentation | null = null, skyFailure: string | null = null;
    if (section) {
      try {
        options.onProgress?.({ stage: "assets", detail: "Preparing original sky geometry and textures…" });
        sky = await createNativeSkyPresentation(scene, worldLifetime.signal);
        if (sky) boundaryReleases.push(() => sky?.dispose());
      } catch (error) {
        validateLifetime();
        skyFailure = error instanceof Error ? error.message : "Original sky preview failed.";
      }
    }
    const audio = new WorldAudioMixer();
    boundaryReleases.push(() => audio.dispose());
    boundaryReleases.push(audio.attachGestureUnlock(window));
    const actionCues = await createNativeActionCuePreview(assets, audio, {
      activeCatalogIds: [playerProfile.catalogId, "musveren:0"], includeHumanSpecialAttackCues: true,
    });
    boundaryReleases.push(() => actionCues.dispose());
    let footstepFailure: string | null = null;
    let footstepBundle: Awaited<ReturnType<typeof loadNativeAnimationAudio>> = { definitions: [], sounds: [], manifests: [], retainedConditionalEvents: 0 };
    try {
      footstepBundle = await loadNativeAnimationAudio(catalog.animationAudio, assets, catalog.archiveHashes ?? new Map(), signal);
      validateLifetime();
      for (const sound of footstepBundle.sounds) audio.register(sound.key, sound.bytes);
    } catch (error) {
      validateLifetime();
      footstepFailure = error instanceof Error ? error.message : "Original footstep dependencies failed to load.";
      footstepBundle = { definitions: [], sounds: [], manifests: [], retainedConditionalEvents: 0 };
    }
    let stepSounds: NativeStepSoundBundle = { library: null, sounds: [], manifest: null }, stepSoundFailure: string | null = null;
    const stepSoundResult = await settledStepSoundLoad;
    validateLifetime();
    if (stepSoundResult.ok) {
      stepSounds = stepSoundResult.value;
      for (const sound of stepSounds.sounds) audio.register(sound.key, sound.bytes);
    } else stepSoundFailure = failureText(stepSoundResult.error, "Original stepsound package failed to load.");
    const decoGrassResult = await settledDecoGrassLoad;
    validateLifetime();
    const decoGrass: NativeStepDecoGrassBundle = decoGrassResult.ok ? decoGrassResult.value : { field: null, manifest: null };
    const decoGrassFailure = decoGrassResult.ok ? null : failureText(decoGrassResult.error, "Deco-grass footstep data failed to load.");
    let ambience: WorldAmbience | null = null, music: WorldMusic | null = null, worldAudioFailure: string | null = null;
    let worldAudioLoading = Boolean(section), refreshWorldAudioControls: (() => void) | null = null;
    const listenerFollowsLocalPawn = () => ambience !== null || music !== null;
    if (section) void settledWorldAudioLoad.then(result => {
      if (disposed || signal.aborted || scene.isDisposed) return;
      worldAudioLoading = false;
      if (result.ok) {
        try {
          const { ambience: ambienceBundle, music: musicBundle } = result.value;
          if (ambienceBundle) { const created = createWorldAmbience(ambienceBundle, audio); ambience = created; boundaryReleases.push(() => created.dispose()); }
          if (musicBundle) { const created = createWorldMusic(musicBundle, audio); music = created; boundaryReleases.push(() => created.dispose()); }
        } catch (error) { worldAudioFailure = failureText(error, "Map music and ambience could not be prepared."); }
      } else worldAudioFailure = failureText(result.error, "Map music and ambience could not be verified.");
      refreshWorldAudioControls?.();
    });
    const combatResult = await settledCombatAudioLoad;
    validateLifetime();
    let combatFailure = combatResult.ok ? null : failureText(combatResult.error, "Original combat sounds failed to load.");
    const combatBundle = combatResult.ok ? combatResult.value : null;
    const configuredPlayer = profiles.get(appearanceId)!;
    const locomotionClips = resolveNativeLocomotionClips(fighter, configuredPlayer.clips.run, footstepBundle.definitions, configuredPlayer.clips.walk);
    const specialAttackPreview = resolveNativeSpecialAttackPreview(fighter, actionCues.inspection().coverage);
    const handAnchor = resolveNativeHumanHandAnchor(fighter);
    profiles.set(appearanceId, { ...configuredPlayer, clips: { ...configuredPlayer.clips,
      ...(locomotionClips.walkClip ? { walk: locomotionClips.walkClip } : {}),
      ...(specialAttackPreview.clip ? { specialAttack: specialAttackPreview.clip } : {}),
    }, boneAnchors: handAnchor.binding ? [handAnchor.binding] : [] });
    validateLifetime();
    const profileStagesLeatherShirt = playerProfile.upperItems.some(item => item.itemId === 22);
    const startingUpperItemId = settings.leatherShirt && profileStagesLeatherShirt ? 22 : null;
    const adapter = new NativeSliceAdapter(origin, navigation, startingUpperItemId,
      { displayName: playerProfile.name, appearanceId }, { walkSupported: locomotionClips.walkClip !== null,
        specialAttackPreviewSupported: specialAttackPreview.clip !== null,
        speed: nativeSliceSpeedProfile(playerProfile.sourceUnitsPerMetre) });
    boundaryReleases.push(() => adapter.dispose());
    const footstepGround = createFootstepGroundSampler(scene, { decoGrass: decoGrass.field, sourceUnitsPerMetre: playerProfile.sourceUnitsPerMetre });
    boundaryReleases.push(() => footstepGround.dispose());
    if (section) footstepGround.preload(section.terrainMeshes);
    const entityVector = (id: string): [number, number, number] | null => {
      const position = registry?.entity(id)?.position;
      return position ? [position.x, position.y, position.z] : null;
    };
    const footsteps = createNativeFootstepPreview(footstepBundle.definitions, audio, {
      groundContact: owner => owner === "local-player" ? adapter.groundContact : null,
      stepSounds: stepSounds.library,
      surfaceContext: (owner, contact) => owner === "local-player" ? footstepGround.describe(contact) : null,
      gait: owner => owner === "local-player" ? adapter.locomotionMode : null,
      spatial: { position: entityVector, listener: () => listenerFollowsLocalPawn() ? entityVector("local-player") : null,
        sourceUnitsPerMetre: playerProfile.sourceUnitsPerMetre },
      initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT,
    });
    boundaryReleases.push(() => footsteps.dispose());
    const clipPreview = createNativeClipPreviewHub();
    let registry: EntityRegistry;
    const ui = new WorldInterface(adapter, () => registry, canvas, { location: section ? "20_20 · native world section" : "Native asset slice", coordinateUnit: "m" });
    boundaryReleases.push(() => ui.dispose());
    registry = new EntityRegistry(scene, adapter, ui.labels, message => ui.showStatus(message), {
      createVisual: nativeCharacterFactory(profiles, actionCues, footsteps, clipPreview), ...(navigation ? { ground: navigation.ground } : {}),
    });
    boundaryReleases.push(() => registry.dispose());
    const localPawnListenerLocation = (): [number, number, number] | null => {
      const pawn = listenerFollowsLocalPawn() ? registry.localPlayerPosition : null;
      return pawn ? [pawn.x, pawn.y + playerProfile.collisionHeight / playerProfile.sourceUnitsPerMetre, pawn.z] : null;
    };
    let combatAudio: NativeCombatAudio | null = null;
    try {
      const created = createNativeCombatAudio(combatBundle, audio, {
        entity: id => registry.entity(id), sourceClock: id => registry.sourceClock(id),
        selectedEntityId: () => registry.selectedEntityId, paused: () => adapter.isPaused || isSceneSuspended(scene),
        listener: localPawnListenerLocation,
      }, [
        { entityId: "local-player", catalogId: playerProfile.catalogId, asset: fighter,
          collisionRadiusMetres: playerProfile.collisionRadius / playerProfile.sourceUnitsPerMetre,
          collisionHeightMetres: playerProfile.collisionHeight / playerProfile.sourceUnitsPerMetre },
        { entityId: "native-musveren", catalogId: "musveren:0", asset: monster,
          collisionRadiusMetres: musveren.collisionRadius / musveren.sourceUnitsPerMetre,
          collisionHeightMetres: musveren.collisionHeight / musveren.sourceUnitsPerMetre },
      ]);
      combatAudio = created;
      boundaryReleases.push(() => created.dispose());
    } catch (error) {
      combatFailure ??= failureText(error, "Combat hit sounds could not be prepared.");
    }
    const doors = movers && navigation ? createNativeDoorInteractions(scene, movers.targets, {
      player: () => registry.localPlayer, dispatch: command => adapter.dispatch(command),
      onCommand: listener => adapter.subscribeCommands(listener), paused: () => adapter.isPaused || isSceneSuspended(scene),
    }, navigation, playerCapsuleFromSourceCollision(), message => ui.showStatus(message)) : undefined;
    if (doors) boundaryReleases.push(() => doors.dispose());
    const releaseOnSceneDisposeObserver = scene.onDisposeObservable.add(stop);
    boundaryReleases.push(() => { scene.onDisposeObservable.remove(releaseOnSceneDisposeObserver); });
    signal.addEventListener("abort", stop, { once: true });
    boundaryReleases.push(() => signal.removeEventListener("abort", stop));
    options.onProgress?.({ stage: "assets", detail: "Assembling native characters, skinning and equipped parts…" });
    await registry.whenReady();
    validateLifetime();
    registry.update(0);
    let effectComponents: NativeEffectComponentPreview | null = null, effectComponentFailure: string | null = null;
    let initEffect: NativeEffectInitPreview | null = null;
    let shotEffect: NativeEffectShotPreview | null = null, powerStrike: NativePowerStrikePreview | null = null;
    let powerStrikeReason: string | null = "Original skill effect components are not staged.";
    try {
      const effectBundle = await loadNativeEffectComponents(signal);
      validateLifetime();
      if (effectBundle) {
        effectComponents = createNativeEffectComponentPreview(scene, effectBundle,
          () => registry.attachmentAnchor("local-player", "right-hand"),
          () => (registry.localPlayer?.health ?? 0) > 0, signal);
        boundaryReleases.push(() => effectComponents?.dispose());
        if (specialAttackPreview.clip) {
          initEffect = createNativeEffectInitPreview(scene, effectBundle, specialAttackPreview.clip, () => {
            const player = registry.localPlayer;
            return { anchor: registry.attachmentAnchor("local-player", "right-hand"), clock: registry.sourceClock("local-player"),
              sequence: player?.animationSequence ?? 0, action: player?.actionPreview ?? null,
              animation: player?.animation ?? "idle", alive: (player?.health ?? 0) > 0 };
          }, signal);
          boundaryReleases.push(() => initEffect?.dispose());
          const detachManualComponentDisablesInit = effectComponents.subscribe(() => {
            if (effectComponents?.snapshot().selection.component !== null) void initEffect?.setEnabled(false);
          });
          boundaryReleases.push(detachManualComponentDisablesInit);
        }
        const shotSource = resolveNativePowerStrikeShotSource(fighter, specialAttackPreview.clip);
        const shotTarget = resolveNativePowerStrikeShotTarget(musveren);
        powerStrikeReason = !initEffect ? specialAttackPreview.reason ?? "The original special-attack clip is unavailable." : shotSource.reason ?? shotTarget.reason;
        if (initEffect && shotSource.source && shotTarget.target) {
          const musverenShotTarget = shotTarget.target, init = initEffect;
          const shot = createNativeEffectShotPreview(scene, effectBundle, shotSource.source, () => {
            const player = registry.localPlayer, targetId = player?.actionTargetId ?? null;
            const entity = targetId ? registry.entity(targetId) : null, pivot = targetId ? registry.actorPivot(targetId) : null;
            return { caster: registry.actorPivot("local-player"), targetId,
              target: entity && pivot && targetId === "native-musveren" ? { pivot, collisionRadius: musverenShotTarget.collisionRadius, profileId: musverenShotTarget.profileId, alive: entity.health > 0 } : null,
              clock: registry.sourceClock("local-player"), sequence: player?.animationSequence ?? 0,
              action: player?.actionPreview ?? null, animation: player?.animation ?? "idle", alive: (player?.health ?? 0) > 0 };
          }, signal);
          shotEffect = shot;
          boundaryReleases.push(() => shot.dispose());
          const created = createNativePowerStrikePreview(init, shot, () => {
            const selectedOrOnlyNpcId = registry.selectedEntityId ?? "native-musveren";
            const entity = selectedOrOnlyNpcId === "native-musveren" ? registry.entity(selectedOrOnlyNpcId) : null;
            const pivot = entity ? registry.actorPivot(selectedOrOnlyNpcId) : null;
            return entity && pivot ? { id: selectedOrOnlyNpcId, name: entity.displayName, rootUniqueId: pivot.root.uniqueId,
              isValid: () => pivot.isValid() && (registry.entity(selectedOrOnlyNpcId)?.health ?? 0) > 0 } : null;
          }, () => (registry.localPlayer?.health ?? 0) > 0, async () => { await effectComponents?.select(null); },
          targetId => adapter.dispatch({ type: "preview-action", action: "special-attack", targetId }),
          listener => adapter.subscribeCommands(listener));
          powerStrike = created;
          boundaryReleases.push(() => created.dispose());
        }
      }
    } catch (error) {
      validateLifetime();
      effectComponentFailure = error instanceof Error ? error.message : "Original skill components could not be prepared.";
    }
    const materialOverrides = createNativeMaterialOverrides(scene, settings.materialOverrideEnabled ? {
      entityId: settings.materialEntityId ?? "local-player",
      sourceMaterial: settings.materialSource ?? "MFighter.UpBody.MFighter_m001_t04_u",
      tint: [settings.materialTint?.x ?? 1, settings.materialTint?.y ?? 1, settings.materialTint?.z ?? 1],
      roughness: settings.materialRoughness ?? 1,
    } : undefined);
    boundaryReleases.push(() => materialOverrides.dispose());
    if (worldFailure) ui.showStatus(`${worldFailure} Actor inspection area retained.`);
    else if (!section) ui.showStatus("No native world section staged. Actor inspection area retained.");
    else if (flameFailure) ui.showStatus(`${flameFailure} World and saved materials retained.`);
    else ui.clearStatus();
    boundaryReleases.push(ui.watchSound(() => audio.locked, () => audio.unlock()));
    boundaryReleases.push(attachWorldCamera(scene, canvas));
    boundaryReleases.push(attachTargeting(scene, registry, adapter, navigation, doors?.targeting));
    const camera = scene.getCameraByName("World camera") as ArcRotateCamera;
    const authoredCamera = { target: camera.target.clone(), radius: camera.radius, minZ: camera.minZ, maxZ: camera.maxZ,
      upperRadiusLimit: camera.upperRadiusLimit };
    let effectCamera: ReturnType<typeof createEffectInspectionCamera> | undefined;
    const follow = () => {
      effectCamera?.release();
      followFighter = true;
      camera.setTarget((registry.localPlayerPosition ?? origin).add(new Vector3(.6, .35, 0)), false, false, true);
      if (section) camera.radius = authoredCamera.radius;
    };
    const frameWorld = () => {
      if (!section) return;
      effectCamera?.release();
      followFighter = false;
      camera.setTarget(section.minimum.add(section.maximum).scale(.5), false, false, true);
      camera.radius = Math.max(12, section.maximum.subtract(section.minimum).length() * .85);
    };
    const flamePlacements = section?.manifest.placements?.filter(placement => placement.sourceMesh === "FX_E_S.Flameset.Default_Flame01") ?? [];
    const frameFlame = (placementId: string) => {
      if (!flamePlacements.some(placement => placement.id === placementId)) throw new Error("Unknown flame placement.");
      const root = scene.transformNodes.find(node => node.metadata?.nativePlacement?.id === placementId);
      if (!root) throw new Error("Flame placement is unavailable.");
      const bounds = root.getHierarchyBoundingVectors(true);
      effectCamera?.release();
      followFighter = false;
      camera.setTarget(bounds.min.add(bounds.max).scale(.5), false, false, true);
      camera.radius = Math.max(1, bounds.max.subtract(bounds.min).length() * 1.7);
    };
    if (section) {
      camera.upperRadiusLimit = Math.max(60, section.maximum.subtract(section.minimum).length() * 2);
      camera.maxZ = Math.max(camera.maxZ, camera.upperRadiusLimit * 4);
      camera.minZ = .03; follow();
      boundaryReleases.push(() => {
        camera.setTarget(authoredCamera.target, false, false, true); camera.radius = authoredCamera.radius;
        camera.minZ = authoredCamera.minZ; camera.maxZ = authoredCamera.maxZ; camera.upperRadiusLimit = authoredCamera.upperRadiusLimit;
      });
    }
    if (effectComponents) {
      let priorFollow = followFighter;
      effectCamera = createEffectInspectionCamera(camera, { bounds: () => shotEffect?.bounds() ?? initEffect?.bounds() ?? effectComponents?.bounds() ?? null }, active => {
        if (active) { priorFollow = followFighter; followFighter = false; }
        else followFighter = priorFollow;
      });
      boundaryReleases.push(() => effectCamera?.dispose());
    }
    const label = ui.root.querySelector(".world-location > span");
    const pendingEffects = section?.manifest.unsupportedRuntimeMaterials?.reduce((total, gap) => total + gap.placementIds.length, 0) ?? 0;
    if (label) label.textContent = section ? `Debug match unverified${pendingEffects ? flames ? " · flame preview" : ` · ${pendingEffects} effects pending` : ""}` : "Native rigs · synthetic behavior";
    const sheet = ui.sheet, describe = new SheetDescriber(sheet, boundaryReleases);
    const sections = {
      audio: sheet.section("audio", { title: "Audio", icon: "audio", order: 10 }),
      movement: sheet.section("movement", { title: "Movement", icon: "movement", order: 20 }),
      combat: sheet.section("combat", { title: "Combat", icon: "combat", order: 30 }),
      character: sheet.section("character", { title: "Character", icon: "character", order: 40 }),
      world: sheet.section("world", { title: "World", icon: "world", order: 50 }),
      effects: sheet.section("effects", { title: "Effects", icon: "effects", order: 60 }),
      debug: sheet.section("debug", { title: "Debug", icon: "debug", order: 70 }),
    };
    const groups = {
      mixer: sections.audio.group("mixer", "Mixer, music & ambience", { hint: "One AudioContext graph with master, music, ambience and effects channels. It starts on your first tap, click or key press; music and ambience then begin by themselves. Native mix rules are unverified." }),
      gait: sections.movement.group("gait", "Walk / run"),
      ground: sections.movement.group("ground", "Ground under fighter"),
      footsteps: sections.movement.group("footsteps", "Footsteps"),
      actions: sections.combat.group("actions", "Actions"),
      hits: sections.combat.group("hit-sounds", "Hit sounds"),
      powerStrike: sections.combat.group("power-strike", "Power Strike at target"),
      life: sections.combat.group("life", "Life"),
      appearance: sections.character.group("appearance", "Character & equipment"),
      camera: sections.world.group("camera", "Camera & terrain"),
      sky: sections.world.group("sky", "Sky"),
      flames: sections.world.group("flames", "Flames"),
      components: sections.effects.group("components", "Power Strike components"),
      init: sections.effects.group("init", "Init effects"),
    };
    const events = new AbortController();
    boundaryReleases.push(() => events.abort());
    attachNativeSliceDebugSection(sections.debug, { scene, camera, registry: () => registry, playerProfile, playerChoices, events: events.signal });
    const assetGroup = sections.debug.group("assets", "Asset inspector", {
      hint: "Opens a local converted asset package in its own preview scene. The world is suspended while the inspector is open and resumes unchanged.",
    });
    let inspectorOpen = false, suspensionBeforeInspector = false;
    const suspendWorldAndCuesForInspector = () => {
      if (disposed || inspectorOpen) return;
      suspensionBeforeInspector = isSceneSuspended(scene);
      inspectorOpen = true;
      setSceneSuspended(scene, true);
      audio.setPaused(true);
    };
    const restoreInspectorSuspension = () => {
      if (!inspectorOpen) return;
      inspectorOpen = false;
      setSceneSuspended(scene, suspensionBeforeInspector);
      audio.setPaused(adapter.isPaused || suspensionBeforeInspector);
    };
    let detachAssetImport: (() => void) | undefined;
    boundaryReleases.push(() => {
      try { detachAssetImport?.(); }
      finally { restoreInspectorSuspension(); }
    });
    detachAssetImport = attachAssetImport(scene, canvas, {
      host: assetGroup.element,
      onOpenChange(open) {
        if (open) suspendWorldAndCuesForInspector();
        else restoreInspectorSuspension();
      },
    });
    const flameFailureNote = document.createElement("p");
    flameFailureNote.id = "native-flame-status"; flameFailureNote.role = "status";
    const updateFlameFailureNote = () => {
      flameFailureNote.hidden = !flameFailure;
      flameFailureNote.textContent = flameFailure ? `${flameFailure} World and saved materials retained.` : "";
    };
    updateFlameFailureNote();
    groups.flames.element.append(flameFailureNote);
    const failFlames = (error: unknown) => {
      disposeFlames();
      flameFailure = error instanceof Error ? error.message : "Native flame preview update failed.";
      ui.showStatus(`${flameFailure} World and saved materials retained.`);
      updateFlameFailureNote();
      if (label) label.textContent = `Debug match unverified · ${pendingEffects} effects pending`;
    };
    const player = () => registry.localPlayer;
    const entityState = (id: string) => () => {
      const entity = registry.entity(id);
      return entity ? `${entity.animation}${entity.actionPreview ? ` (${entity.actionPreview})` : ""} · HP ${entity.health}/${entity.maximumHealth}` : "despawned";
    };
    const clipOf = (id: string) => () => registry.sourceClock(id)?.clip ?? "-";
    const actorVariables = (id: string, label: string): VariableInfo[] => [
      { name: `${label}.state`, value: entityState(id), values: "idle | run | attack · HP (last requested action)", source: "NativeSliceAdapter (synthetic behavior); the clip actually playing is the .clip row", status: "presentation" },
      { name: `${label}.clip`, value: clipOf(id), values: "original clip names", source: "actor package animation (source clock)", status: "native" },
    ];
    const button = (group: DevGroup, label: string, action: () => void, info: { testId?: string; hint?: string; variables?: () => VariableInfo[]; disabled?: boolean } = {}) => {
      const element = group.button({ label, ...info });
      element.addEventListener("click", action, { signal: events.signal });
      return element;
    };

    const hudRunButton = ui.root.querySelector<HTMLElement>('[data-action="run"]');
    hudRunButton?.addEventListener("click", () => adapter.dispatch({ type: "set-locomotion", mode: "run" }), { signal: events.signal });
    const gaitVariables = (): VariableInfo[] => [
      { name: "movement.gait", value: () => adapter.locomotionMode, values: locomotionClips.walkClip ? "walk | run" : "run", source: "set-locomotion command → source walk/run clip", status: "native" },
      { name: "movement.walkClip", value: () => locomotionClips.walkClip ?? "unavailable", values: "original clip name",
        source: locomotionClips.walkSource === "profile-alias" ? "profile WalkAnimName[0] alias (no staged footstep pair: walking is silent)" : "actor animation archive + staged footstep notify pair (catalog.animationAudio)", status: "native" },
      { name: "movement.runClip", value: () => locomotionClips.runClip, values: "original clip name", source: "player profile run clip (RunAnimName[0])", status: "native" },
      { name: "movement.speed", value: () => `${adapter.currentSpeed.toFixed(2)} m/s now`,
        values: `walk ${adapter.speedProfile.walkMetresPerSecond.toFixed(2)} | run ${adapter.speedProfile.runMetresPerSecond.toFixed(2)} m/s (walk speed for the first ${adapter.speedProfile.runStartSeconds} s of a run)`,
        source: `${adapter.speedProfile.source} ÷ sourceUnitsPerMetre ${playerProfile.sourceUnitsPerMetre}. Speeds are server data (no client file holds them); no acceleration ramp (APawn::calcVelocity).`, status: "presentation" },
      { name: "movement.clipRate", value: () => "1.0", values: "1.0 × NonAttackSpeedRate (1.0)", source: "UpdateMovementAnimation 0x10624cc0: walk/run clips are not stretched to the travel speed", status: "native" },
    ];
    if (locomotionClips.walkClip && hudRunButton) {
      const hudWalkButton = document.createElement("button");
      hudWalkButton.type = "button"; hudWalkButton.dataset.action = "walk"; hudWalkButton.dataset.testid = "native-walk-action";
      hudWalkButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2"/><path d="m9 21 2-6 3 3v3M11 15l1-6 3 3 3 1M12 9l-3 2-1 4"/></svg><span>Walk</span>';
      hudRunButton.after(hudWalkButton);
      boundaryReleases.push(() => hudWalkButton.remove());
      hudWalkButton.addEventListener("click", () => {
        adapter.dispatch({ type: "set-locomotion", mode: "walk" });
        adapter.dispatch({ type: "set-animation", animation: "run" });
        ui.showStatus("Walk demonstration · tap the ground to walk there", { transient: true });
      }, { signal: events.signal });
      describe.element(hudWalkButton, { title: "Walk", description: "Switches the fighter to the original walk clip (and its walk footsteps). Tap the ground to walk there; Run switches back.", variables: gaitVariables }, "none");
    }
    describe.element(hudRunButton, { title: "Run", description: "Switches the fighter to the original run clip and its run footsteps. Tap the ground to run there.", variables: gaitVariables }, "none");
    boundaryReleases.push(ui.bindGait(() => adapter.locomotionMode));
    describe.element(ui.root.querySelector(".world-location"), { title: section ? "20_20 native world section" : "Native asset slice",
      description: section ? "Source-derived location; native debug location and terrain materials remain unverified." : "Native rigs with synthetic behavior; no native world section is staged." }, "none");
    describe.element(ui.root.querySelector('[data-action="attack"]'), { title: "Attack", description: "Plays the fighter's original attack clip. Fist and voice sounds play at its AttackItem/AttackVoice notifies (hit or miss); each AttackShot plays the target's defense and damage sounds on the selected or nearest target in reach.",
      variables: () => [...actorVariables("local-player", "fighter"), ...(combatAudio ? pickRows(combatAudio.describe(), ["combat.hitSounds", "combat.lastHit"]) : [])] }, "none");
    describe.element(ui.root.querySelector(".diagnostics"), { title: "World diagnostics", description: "Frame rate, entity count and fighter position in browser metres. Debug tab shows camera and native coordinates.",
      variables: () => [{ name: "debug.fps", value: () => String(Math.round(scene.getEngine().getFps())), values: "frames per second", source: "AbstractEngine.getFps()", status: "presentation" }] }, "none");

    const audioControls = attachWorldAudioControls(groups.mixer.element, audio, { music, ambience, worldAudioFailure, worldAudioLoading });
    boundaryReleases.push(() => audioControls.dispose());
    refreshWorldAudioControls = () => audioControls.setWorldAudio({ music, ambience, failure: worldAudioFailure, loading: worldAudioLoading });
    refreshWorldAudioControls();
    for (const card of audioControls.cards()) {
      describe.testId(groups.mixer.element, card.testId, { title: card.title, ...(card.description ? { description: card.description } : {}),
        variables: () => worldAudioVariables(audioControls.describe().filter(row => card.rows.includes(row.name))) });
    }

    const locomotionControls = attachNativeLocomotionControls(groups.gait.element, adapter, locomotionClips.walkClip !== null, locomotionClips.reason);
    boundaryReleases.push(() => locomotionControls.dispose());
    {
      const root = groups.gait.element.querySelector<HTMLElement>('[data-testid="native-locomotion-controls"]');
      const note = locomotionClips.reason ? "" : describe.fold(root?.querySelector<HTMLElement>("p"));
      describe.element(root, { title: "Walk / run", description: `${note} Speeds are aCis server data (walk 80, run 115 units/s); a run starts at walk speed for 0.4 s. Footsteps follow the armed gait.`.trim(), variables: gaitVariables });
    }
    const groundContext = () => footstepGround.describe(adapter.groundContact);
    groups.ground.readout({ label: "Ground", testId: "native-ground-readout", value: () => footsteps.autoSurface().resolve(groundContext()).summary,
      hint: "Live support under the fighter (seeded at spawn, then from accepted moves) and what Auto footsteps resolve for it in the native order.",
    variables: () => {
      const resolved = () => footsteps.autoSurface().resolve(groundContext());
      return [
        { name: "ground.contact", value: () => groundContext().kind, values: "terrain | terrain-patch | placement | bsp | mesh | none", source: "WorldGroundContact (accepted capsule support) standing in for native Pawn.Base", status: "unverified" },
        { name: "ground.source", value: () => groundContext().sourceId ?? groundContext().meshName ?? "-", values: "placement / BSP / terrain id", source: "mesh metadata markers", status: "native" },
        { name: "ground.material", value: () => groundContext().material ?? "-", values: "support triangle material", source: "Not read by the native footstep notify (no material footstep field exists)", status: "unverified" },
        { name: "ground.decoGrass", value: () => { const reading = groundContext().decoGrass; return reading ? `${reading.expected.toFixed(2)} expected (${reading.grass ? "≥" : "<"} ${reading.threshold}) · sector ${reading.sector ?? "-"}` : "-"; },
          values: "expected deco instances within 64 units XY", source: `${decoGrass.field?.label ?? "deco-grass bundle not staged"}${decoGrassFailure ? ` (${decoGrassFailure})` : ""}`, status: "presentation" },
        { name: "ground.autoSurface", value: () => `${resolved().rule} · ${resolved().summary}`, values: "native order: support StepSound → volumes → ACTOR → GRASS/LAND",
          source: resolved().reason, status: resolved().status },
      ];
    } });
    const footstepControls = attachNativeFootstepControls(groups.footsteps.element, footsteps, footstepFailure,
      { stepSoundFailure, decoGrassFailure, isVisible: () => ui.sheet.isOpen });
    boundaryReleases.push(() => footstepControls.dispose());
    {
      const cards: [string, string, string[], string?][] = [
        ["footsteps.mode", "Footstep mode", ["footsteps.mode"], "Auto follows the native order: boots, the support's own StepSound, water/step volumes, ACTOR (Stone_Hard walk set) on other support, then GRASS or LAND on terrain. Steps always fire at the original notify times."],
        ["footsteps.renderDecoGrass", "RenderDeco grass footsteps", ["footsteps.renderDecoGrass", "footsteps.auto.terrain"], "On terrain the local player hears Grass where the expected decoration count within 64 units reaches 2, else Default. Approximation of the native deco instance count - the browser does not render decorations."],
        ["footsteps.surface", "Surface", ["footsteps.surface", "footsteps.auto.supportStepSounds", "footsteps.auto.actor", "footsteps.auto.terrain"], "All 16 original stepsound.uax groups (Water_Shalow keeps its spelling). Tapping one while Auto is on switches to Manual."],
        ["footsteps.variation", "Variation", ["footsteps.variation"], "Manual clip choice from the actual clips: ordinary Stone has two, the other surfaces three."],
        ["footsteps.bootsLayer", "Boot noise", ["footsteps.bootsLayer"]],
        ["footsteps.waterTransitions", "Water test", ["footsteps.waterTransitions"]],
        ["footsteps.readout", "Last footstep", ["footsteps.gait", "footsteps.auto.rule", "footsteps.auto.support", "footsteps.playback", "footsteps.lastClip"]],
      ];
      for (const [variable, title, names, description] of cards) {
        describe.element(groups.footsteps.element.querySelector(`[data-footstep-variable="${variable}"]`), { title, ...(description ? { description } : {}),
          variables: () => pickRows(footstepControls.describe(), names) });
      }
    }

    const specialAttackText = specialAttackPreview.reason ??
      "Original special-attack animation with its direct sound cues, the optional timed init effects (Effects tab) and hit sounds at its AttackShot. Full native skill playback remains unverified.";
    button(groups.actions, "Fighter attack", () => adapter.dispatch({ type: "set-animation", entityId: "local-player", animation: "attack" }),
      { testId: "native-fighter-attack", hint: "Same as the HUD Attack action: the original attack clip, with hit sounds at AttackShot.", variables: () => actorVariables("local-player", "fighter") });
    button(groups.actions, "Special attack preview", () => adapter.dispatch({ type: "preview-action", action: "special-attack" }),
      { testId: "native-special-attack-preview", disabled: specialAttackPreview.clip === null, hint: specialAttackText,
        variables: () => [{ name: "specialAttack.clip", value: () => specialAttackPreview.clip ?? "unavailable", values: "original clip", source: "fighter animation archive", status: "native" }, ...actorVariables("local-player", "fighter")] });
    button(groups.actions, "Musveren attack", () => adapter.dispatch({ type: "set-animation", entityId: "native-musveren", animation: "attack" }),
      { hint: "Greater Musveren plays its original atk01 clip (its own direct cues). Its AttackShot plays the fighter's defense and damage sounds - conditional: native route C, but no server record proves the hit.", variables: () => actorVariables("native-musveren", "musveren") });
    button(groups.actions, "Musveren death", () => adapter.dispatch({ type: "set-health", entityId: "native-musveren", health: 0 }),
      { hint: "Sets Musveren's synthetic health to 0: original death clip and its death cue.", variables: () => actorVariables("native-musveren", "musveren") });
    button(groups.actions, "Revive Musveren", () => adapter.dispatch({ type: "set-health", entityId: "native-musveren", health: 100 }),
      { hint: "Restores Musveren's synthetic health.", variables: () => actorVariables("native-musveren", "musveren") });
    if (specialAttackPreview.reason) groups.actions.note(specialAttackPreview.reason, { tone: "warning", testId: "native-special-attack-status" });
    const combatControls = attachNativeCombatAudioControls(groups.hits.element, combatAudio, combatFailure, () => audio.unlock());
    boundaryReleases.push(() => combatControls.dispose());
    {
      const rows = combatControls.describe();
      for (const card of combatControls.cards()) {
        const description = card.description ?? rows.find(row => row.name === card.names[0])?.detail;
        describe.element(card.element, { title: card.title, ...(description ? { description } : {}), variables: () => pickRows(rows, card.names) });
      }
    }
    const powerStrikeControls = attachNativePowerStrikeControls(groups.powerStrike.element, powerStrike, shotEffect, powerStrikeReason, () => effectCamera?.focus());
    boundaryReleases.push(() => powerStrikeControls.dispose());
    describe.testId(groups.powerStrike.element, "native-power-strike-controls", { title: "Power Strike at target",
      description: `Charges the original init effects, then plays the special-attack clip at Greater Musveren (selected, or the only NPC when nothing is selected) and shows the original impact components at its AttackShot. Its hit sounds play at any distance (no reach check for this explicit target). Cast/shot sounds are skillsoundgrp name-match candidates; targeting and particle policy are a ${PRESENTATION_CHOICE}. No damage is applied.`,
      variables: () => [
        { name: "powerStrike.pending", value: () => String(powerStrike?.snapshot().pending ?? false), values: "true | false", source: "nativePowerStrikePreview", status: "presentation" },
        { name: "powerStrike.target", value: () => powerStrike?.snapshot().targetName ?? registry.selectedEntity?.displayName ?? "Greater Musveren (default)", values: "Greater Musveren", source: "selection, else the slice's only NPC", status: "presentation" },
        { name: "powerStrike.impact", value: () => shotEffect?.snapshot().status ?? "unavailable", values: "off | loading | armed | waiting | playing | completed | failed", source: "AttackShot event of the original SpAtk01_1HS clip", status: "native" },
        ...(combatAudio ? pickRows(combatAudio.describe(), ["combat.powerStrikeSounds"]) : []),
      ] });
    button(groups.life, "Fighter death", () => adapter.dispatch({ type: "set-health", entityId: "local-player", health: 0 }),
      { hint: "Sets the fighter's synthetic health to 0: original death clip and death cue.", variables: () => actorVariables("local-player", "fighter") });
    button(groups.life, "Revive fighter", () => adapter.dispatch({ type: "set-health", entityId: "local-player", health: 100 }),
      { hint: "Restores the fighter's synthetic health.", variables: () => actorVariables("local-player", "fighter") });

    const equipmentVariables = (): VariableInfo[] => [
      { name: "equipment.upper", value: () => { const upper = player()?.equipment?.upper; return upper === undefined ? "starter shirt (none)" : `item ${upper}`; },
        values: "22 (Leather Shirt) | none", source: "armorgrp item 22 package; equip-upper command", status: "native" },
      { name: "character.profile", value: () => `${playerProfile.id} · ${playerProfile.name}`, values: [...playerChoices.values()].map(choice => choice.name).join(" | "), source: "catalog.playerProfiles (?character=)", status: "native" },
    ];
    if (playerChoices.size > 1) {
      groups.appearance.choice({ label: "Play as", testId: "native-play-as", display: "chips", value: playerProfile.id,
        options: [...playerChoices.values()].map(choice => ({ value: choice.id, label: choice.name.replace(/^Human (\w)/, (_, first: string) => first.toUpperCase()),
          hint: `Reloads with ?character=${choice.id}. Native scale: collision ${choice.collisionRadius}/${choice.collisionHeight} source units, DrawScale ${choice.actorScale.join("/")}.` })),
        hint: "Each choice reloads the slice with ?character=<id> and its own staged native package and clips (no height fitting).",
        variables: equipmentVariables,
        onChange: id => { const url = new URL(window.location.href); url.searchParams.set("character", id); window.location.assign(url.href); } });
    }
    button(groups.appearance, "Leather shirt", () => adapter.dispatch({ type: "equip-upper", itemId: 22 }),
      { hint: profileStagesLeatherShirt ? "Equips armorgrp item 22. Musveren's hits then use its own defense sounds." : `No item 22 upper part is staged for ${playerProfile.name}.`,
        variables: equipmentVariables, disabled: !profileStagesLeatherShirt });
    button(groups.appearance, "Starter shirt", () => adapter.dispatch({ type: "equip-upper", itemId: null }),
      { hint: "Removes the upper armor and restores the starter body part.", variables: equipmentVariables, disabled: !profileStagesLeatherShirt });

    const aliasEvidence = playerProfile.aliasEvidence;
    const aliasCoverage = nativeAliasCoverage(playerProfile.clips, aliasEvidence, playerClipsWithSavedFighterEdits());
    const archiveSha256 = catalog.archiveHashes?.get(playerProfile.catalogId) ?? null;
    const aliasGroup = sections.character.group("aliases", "Animation aliases", {
      hint: "Every native animation alias of this model: the Engine.Pawn localized key (WT_HAND family, index 0; socials PcSocialAnimName[N]) and the exact package clip it names. Tap a clip to play it once on your character. 'damage' stays empty: no class section assigns DamageAnimName and Interlude has no hit-reaction clip; Damagefly_<Class> (DamageFlyAnimName) is a knock-back.",
      variables: () => [
        { name: "aliases.coverage", value: () => nativeAliasCoverageText(aliasCoverage), values: `0-${aliasCoverage.total} of the browser's alias list`,
          source: aliasEvidence ? `${aliasEvidence.report} · sha ${aliasEvidence.reportSha256.slice(0, 12)}…` : "no staged alias evidence for this profile", status: aliasEvidence ? "native" : "unverified" },
        { name: "aliases.family", value: () => aliasEvidence?.family ?? "-", values: "WT_HAND (unarmed)",
          source: aliasEvidence ? `${aliasEvidence.familySource} · sha ${aliasEvidence.familySourceSha256.slice(0, 12)}…` : "-", status: aliasEvidence ? "native" : "unverified" },
        { name: "aliases.package", value: () => playerProfile.catalogId, values: "catalog.models id",
          source: `${playerProfile.assetId} · archive ${archiveSha256 ? `${archiveSha256.slice(0, 12)}…` : "unknown"}`, status: "native" },
        { name: "aliases.preview", value: () => clipPreview.previewing("local-player") ?? "-", values: "clip name while a preview plays",
          source: `one pass on the local actor, then the requested state (${PRESENTATION_CHOICE})`, status: "presentation" },
      ] });
    aliasGroup.readout({ label: "Coverage", testId: "native-alias-coverage", value: () => `${nativeAliasCoverageText(aliasCoverage)} · ${playerProfile.name}`,
      hint: "Aliases with an exact package clip, out of every alias the browser knows. Missing aliases are listed with their reason, never invented." });
    aliasGroup.readout({ label: "Clip now", testId: "native-alias-clip-now", value: () => {
      const previewing = clipPreview.previewing("local-player");
      return previewing ? `${previewing} (preview)` : registry.sourceClock("local-player")?.clip ?? "-";
    }, hint: "The clip the local actor's source clock is playing.", variables: () => actorVariables("local-player", "fighter") });
    const aliasTable = attachNativeAnimationAliasTable(aliasGroup.element, { coverage: aliasCoverage, profileName: playerProfile.name,
      packageLabel: `${playerProfile.catalogId} · ${playerProfile.assetId}`, archiveSha256, family: aliasEvidence?.family ?? null,
      play: clip => clipPreview.play("local-player", clip), previewing: () => clipPreview.previewing("local-player"),
      describe: (element, info, options) => sheet.describe(element, info, options), onStatus: message => ui.showStatus(message), signal: events.signal });
    boundaryReleases.push(() => aliasTable.dispose());

    const cameraVariables = (): VariableInfo[] => [
      { name: "camera.follow", value: () => String(followFighter), values: "true | false", source: "Follow fighter / Frame world", status: "presentation" },
      { name: "terrain.material", value: () => section?.inspection().terrainMaterial ?? "not loaded", values: "candidate-source-textures | neutral-inspection", source: "staged terrain layers", status: "unverified" },
    ];
    if (section) {
      button(groups.camera, "Frame world", frameWorld, { hint: "Frames the whole staged 20_20 section.", variables: cameraVariables });
      button(groups.camera, "Follow fighter", follow, { hint: "Returns the orbit camera to the fighter.", variables: cameraVariables });
      button(groups.camera, "Source textures", () => section?.setTerrainPreview(true), { hint: "Original terrain layer textures and alpha masks (blend is a browser shader; native look unverified).", variables: cameraVariables });
      button(groups.camera, "Neutral terrain", () => section?.setTerrainPreview(false), { hint: "Plain inspection material to read terrain shape and support.", variables: cameraVariables });
    } else groups.camera.note(worldFailure ? `${worldFailure} Actor inspection area retained.` : "No native world section staged. Actor inspection area retained.", { tone: "warning" });
    groups.sky.note(skyFailure ? `Sky preview unavailable: ${skyFailure}` : sky ? "Original sky geometry · stored colors." : "Original sky has not been staged.",
      { testId: "native-sky-status", tone: skyFailure ? "warning" : "info",
        hint: "Original sky geometry with stored colors by default. The optional source-row comparison is temporary; native time-of-day, cloud motion and visual matching remain unverified.",
        variables: () => [{ name: "sky.status", value: () => sky ? "staged" : skyFailure ? "failed" : "not staged", values: "staged | failed | not staged", source: "createNativeSkyPresentation", status: "unverified" }] });
    if (sky) {
      const comparisonControls = attachNativeSkyEnvironmentControls(groups.sky.element, sky);
      boundaryReleases.push(() => comparisonControls.dispose());
      const root = groups.sky.element.querySelector<HTMLElement>('[data-testid="sky-environment-comparison"]');
      const note = describe.fold(root?.querySelectorAll<HTMLElement>("p")[1]);
      describe.element(root, { title: "Sky color comparison", description: note || "Temporary source-row preview; stored sky materials stay unchanged." });
    }
    if (flamePlacements.length) {
      let next = 0;
      button(groups.flames, "Inspect flame", () => { frameFlame(flamePlacements[next % flamePlacements.length]!.id); next++; },
        { hint: "Frames the next Default_Flame01 placement in turn. Flame replay timing and lighting remain unverified.",
          variables: () => [{ name: "flames.placements", value: () => String(flamePlacements.length), values: "FX_E_S.Flameset.Default_Flame01 placements", source: "section manifest", status: "native" },
            { name: "flames.status", value: () => flames?.inspect().status ?? (flameFailure ? "failed" : "not present"), values: "status", source: "nativeFlamePresentation", status: "unverified" }] });
    }
    if (!flamePlacements.length && !flameFailure) groups.flames.note("No flame placements in this section.");

    const effectControls = attachNativeEffectComponentControls(groups.components.element, effectComponents, effectComponentFailure, () => effectCamera?.focus());
    boundaryReleases.push(() => effectControls.dispose());
    describe.testId(groups.components.element, "native-effect-controls", { title: "Power Strike components",
      description: "Individual original skill effect components (skill 3 level 1 bundle), shown one at a time on the right hand. Particle policy is a modern presentation; native emitter behaviour is unverified.",
      variables: () => [{ name: "effects.component", value: () => effectComponents?.snapshot().selection.component ?? "none", values: "component object", source: "catalog.effectComponents", status: "unverified" },
        { name: "effects.status", value: () => effectComponents?.snapshot().status ?? effectComponentFailure ?? "not staged", values: "status", source: "nativeEffectComponentPreview", status: "presentation" }] });
    const initControls = attachNativeEffectInitControls(groups.init.element, initEffect, async () => { await effectComponents?.select(null); }, () => effectCamera?.focus());
    boundaryReleases.push(() => initControls.dispose());
    describe.testId(groups.init.element, "native-init-effect-controls", { title: "Init effects",
      description: "Timed original init (charge) effects on the special-attack clip. Onset follows the source clip; lifetime/fade policy is a presentation choice.",
      variables: () => [{ name: "effects.init", value: () => initEffect?.snapshot().status ?? "unavailable", values: "status", source: "nativeEffectInitPreview", status: "presentation" }] });
    const observer = scene.onBeforeRenderObservable.add(() => {
      if (isSceneSuspended(scene)) { audio.setPaused(true); return; }
      const uncappedFrameSeconds = scene.getEngine().getDeltaTime() / 1000;
      const cappedFrameSeconds = Math.min(uncappedFrameSeconds, .1);
      audio.setPaused(adapter.isPaused);
      if (!adapter.isPaused) adapter.advance(cappedFrameSeconds);
      doors?.update(cappedFrameSeconds);
      const animationClockSeconds = adapter.isPaused ? 0 : cappedFrameSeconds;
      registry.update(animationClockSeconds);
      combatAudio?.update();
      effectComponents?.update();
      initEffect?.update();
      shotEffect?.update();
      effectCamera?.update();
      const ear = localPawnListenerLocation();
      if (ear) {
        const headingX = camera.target.x - camera.globalPosition.x, headingZ = camera.target.z - camera.globalPosition.z;
        audio.setListener(ear, headingX * headingX + headingZ * headingZ > 1e-8 ? [headingX, 0, headingZ] : undefined);
        ambience?.update(ear); music?.update(ear);
      }
      materialOverrides.update();
      if (section && followFighter && registry.localPlayerPosition) camera.setTarget(registry.localPlayerPosition.add(new Vector3(.6, .35, 0)), false, false, true);
      if (flames && flameClock) {
        try { updateFlames(flameClock.advance(uncappedFrameSeconds, adapter.isPaused)); }
        catch (error) { failFlames(error); }
      }
      ui.update(cappedFrameSeconds, scene.getEngine().getFps());
      audioControls.update();
      combatControls.update();
    });
    boundaryReleases.push(() => { scene.onBeforeRenderObservable.remove(observer); });
    let onDemandPerformanceProbe: ReturnType<typeof createWorldPerformanceProbe> | undefined;
    boundaryReleases.push(() => onDemandPerformanceProbe?.dispose());
    const diagnostics = { snapshot: () => ({ entities: registry.snapshot(), playerProfile,
      handAnchor: { ...handAnchor, policy: "converted-source-rig" as const, nativeCompositionVerified: false as const },
      specialAttackPreview: { ...specialAttackPreview, policy: "source-animation-preview" as const, nativeSkillVerified: false as const },
      effectComponents: effectComponents?.snapshot() ?? null, effectComponentFailure,
      nativeInitEffect: initEffect?.snapshot() ?? null,
      locomotion: { mode: adapter.locomotionMode, ...locomotionClips, speed: adapter.speedProfile, currentMetresPerSecond: adapter.currentSpeed,
        clipRate: 1, nativeSpeedVerified: false as const },
      groundContact: inspectNativeGroundContact(scene, adapter.groundContact, section),
      doors: doors ? { manifestSha256: movers!.manifestSha256, ...doors.inspection() } : null,
      skinMeshes: scene.meshes.filter(mesh => mesh.metadata?.l2NativeSkinWeights).map(mesh => ({ name: mesh.name, ...mesh.metadata.l2NativeSkinWeights })),
      nativeAttackReference: "unverified", nativeNpcProfile: musveren ?? null,
      materialOverride: materialOverrides.snapshot(),
      nativeFlames: flames?.inspect() ?? null, flameFailure: flameFailure ?? null,
      nativeSky: sky?.inspection() ?? null, skyFailure,
      nativeAudio: { ...audio.inspection(), cues: actionCues.inspection(), footsteps: footsteps.inspection(),
        footstepBundle: { manifests: footstepBundle.manifests, retainedConditionalEvents: footstepBundle.retainedConditionalEvents },
        footstepFailure, nativeParity: "unverified",
        stepSounds: { manifest: stepSounds.manifest, failure: stepSoundFailure, ground: footstepGround.inspection(),
          decoGrass: { manifest: decoGrass.manifest, failure: decoGrassFailure } },
        worldAudio: { failure: worldAudioFailure, loading: worldAudioLoading, ambience: ambience?.inspection() ?? null, music: music?.inspection() ?? null },
        combat: combatAudio?.inspection() ?? null, combatFailure },
      powerStrike: { reason: powerStrikeReason, action: powerStrike?.snapshot() ?? null, shot: shotEffect?.snapshot() ?? null },
      devSheet: ui.sheet.inspect(),
      flameReplay: flameClock ? { ...flameClock.inspect(), billboardTarget: "browser camera position proxy; native viewport actor equality unverified" } : null,
      nativeTerrain: section ? "source-section-loaded" : "not-loaded-in-actor-scene", phase2Networking: false,
      worldFailure: worldFailure ?? null,
      fog: { enabled: scene.fogEnabled, mode: scene.fogMode, start: scene.fogStart, end: scene.fogEnd },
      world: section ? { manifestSha256: section.manifestSha256, ...section.inspection(),
        sourceSpawn: [origin.x * 100, origin.z * 100, origin.y * 100], nativeLocationMatch: "unverified",
        navigation: section.supportMeshes?.length ? "local terrain and source-declared static/BSP triangle support; native collision/geodata unverified" : "local terrain support only; native/scenery collision unverified" } : null,
      fps: scene.getEngine().getFps(), camera: { target: camera.target.asArray(), alpha: camera.alpha, beta: camera.beta, radius: camera.radius,
        lowerRadiusLimit: camera.lowerRadiusLimit, upperRadiusLimit: camera.upperRadiusLimit, lowerBetaLimit: camera.lowerBetaLimit, upperBetaLimit: camera.upperBetaLimit } }),
      dispatch: adapter.dispatch.bind(adapter),
      async performance() {
        if (disposed) throw new Error("The native world is disposed.");
        const module = await import("../engine/worldPerformanceProbe");
        if (disposed) throw new Error("The native world was disposed while loading diagnostics.");
        return onDemandPerformanceProbe ??= module.createWorldPerformanceProbe(scene);
      },
      captureAudio: () => audio.captureStream(),
      setWorldAudioEnabled(enabled: boolean) {
        if (!enabled) audio.detachGestureUnlock(); else boundaryReleases.push(audio.attachGestureUnlock(window));
        music?.setEnabled(enabled); ambience?.setEnabled(enabled);
      },
      frameFlame,
      interactDoor(id: string) {
        if (!doors) throw new Error("Native doors are unavailable.");
        doors.activate(id);
      },
      setFlameReplay(time: NativeFlameReplayTime) {
        if (!flames || !flameClock) throw new Error("Native flame preview is unavailable.");
        flames.validateReplayTime(time);
        flameClock.seek(time);
        try { updateFlames(time); }
        catch (error) { failFlames(error); throw error; }
      } };
    window.__nativeSlice = diagnostics;
    boundaryReleases.push(() => { if (window.__nativeSlice === diagnostics) delete window.__nativeSlice; });
    return stop;
  } catch (error) { stop(); throw error; }
}

declare global { interface Window { __nativeSlice?: { snapshot(): { entities: ReturnType<EntityRegistry["snapshot"]>; skinMeshes: unknown[];
  playerProfile?: NativePlayerProfile;
  handAnchor?: ReturnType<typeof resolveNativeHumanHandAnchor> & { policy: "converted-source-rig"; nativeCompositionVerified: false };
  specialAttackPreview?: { clip: string | null; reason: string | null; policy: "source-animation-preview"; nativeSkillVerified: false };
  effectComponents?: ReturnType<NativeEffectComponentPreview["snapshot"]> | null; effectComponentFailure?: string | null;
  nativeInitEffect?: ReturnType<NativeEffectInitPreview["snapshot"]> | null;
  locomotion?: { mode: "walk" | "run"; walkClip: string | null; runClip: string; reason: string | null; speed: NativeSliceSpeedProfile;
    currentMetresPerSecond: number; clipRate: number; nativeSpeedVerified: false };
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
  flameReplay?: (ReturnType<ReturnType<typeof createNativeFlameReplayClock>["inspect"]> & { billboardTarget: string }) | null;
  fog?: { enabled: boolean; mode: number; start: number; end: number };
  world?: (ReturnType<NativeSection["inspection"]> & { manifestSha256: string; sourceSpawn: number[]; nativeLocationMatch: string; navigation: string }) | null;
  fps?: number; camera?: { target: number[]; alpha: number; beta: number; radius: number;
    lowerRadiusLimit: number | null; upperRadiusLimit: number | null; lowerBetaLimit: number | null; upperBetaLimit: number | null } }; dispatch: NativeSliceAdapter["dispatch"]; performance(): Promise<ReturnType<typeof createWorldPerformanceProbe>>; captureAudio?(): MediaStream | null; setWorldAudioEnabled?(enabled: boolean): void; setFlameReplay?(time: NativeFlameReplayTime): void; frameFlame?(placementId: string): void; interactDoor?(id: string): void } } }
