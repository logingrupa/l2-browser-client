import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { loadNativeActorCatalog } from "../assets/native/loadNativeCatalog";
import { readNativeCatalog } from "../assets/native/readNativeCatalog";
import { defaultNativePlayerProfile } from "../assets/native/loadNativePlayerProfiles";
import type { AssetPackage } from "../assets/package/readAssetPackage";
import { nativeCharacterFactory, type NativeCharacterProfile } from "../assets/native/NativeCharacterVisual";
import { createNativeClipPreviewHub } from "../assets/native/nativeClipPreview";
import { NativeSliceAdapter, nativeSliceSpeedProfile } from "../world/NativeSliceAdapter";
import { EntityRegistry } from "../entities/EntityRegistry";
import { WorldInterface } from "../ui/WorldInterface";
import { attachTargeting } from "../entities/attachTargeting";
import { attachWorldCamera } from "../camera/WorldCamera";
import { createNativeDoorInteractions } from "../scene/world/nativeDoorInteractions";
import { getWorldCanvas } from "../scene/getWorldCanvas";
import { createNativeMaterialOverrides } from "../assets/native/nativeMaterialOverrides";
import type { SceneStartupProgress } from "../scene/guardSceneStartup";
import { catalogNativeSliceWorldSource, type NativeSliceWorldSource } from "./nativeSliceWorldSource";
import { loadNativeSliceWorld } from "./loadNativeSliceWorld";
import { beginNativeSliceAudioLoads, createNativeSliceCombatAudio, loadNativeSliceAudio } from "./loadNativeSliceAudio";
import { createNativeSliceEffects } from "./createNativeSliceEffects";
import { attachNativeSliceDiagnostics } from "./nativeSliceDiagnostics";
import { attachNativeSliceSheet } from "./attachNativeSliceSheet";
import { createNativeFootstepPreview, NATIVE_FOOTSTEP_WORLD_DEFAULT } from "../audio/nativeFootstepPreview";
import { createFootstepGroundSampler } from "../audio/footstepSurfaceGround";
import { resolveNativeLocomotionClips } from "../assets/native/nativeLocomotion";
import { resolveNativeSpecialAttackPreview } from "../assets/native/nativeSpecialAttackPreview";
import { resolveNativeHumanHandAnchor } from "../assets/native/nativeHumanHandAnchor";
import { createEffectInspectionCamera } from "../effects/nativeEffectInspectionCamera";
import { isSceneSuspended } from "../engine/renderSuspension";
import { sandboxNpcVisualFactory } from "./sandboxNpcVisual";
import { attachSandboxCommandSheet } from "./attachSandboxCommandSheet";
import { buildNativeCatalogIndexOrUnavailable } from "./buildNativeCatalogIndexOrUnavailable";

const sandboxNpcAppearanceByModel: ReadonlyMap<string, string> = new Map([["musveren:0", "native-musveren"]]);
const sandboxNpcAppearanceOfModel = (modelCatalogId: string) => sandboxNpcAppearanceByModel.get(modelCatalogId) ?? null;

export interface NativeSliceSettings {
  playerProfileId?: string;
  origin: Vector3;
  leatherShirt: boolean;
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

export interface NativeSliceRuntimeOptions {
  requireWorld?: boolean;
  onProgress?: (progress: SceneStartupProgress) => void;
  worldSource?: NativeSliceWorldSource;
}

export async function createNativeSliceRuntime(scene: Scene, camera: ArcRotateCamera, settings: NativeSliceSettings, signal: AbortSignal,
  options: NativeSliceRuntimeOptions = {}): Promise<() => void> {
  const validateLifetime = () => {
    signal.throwIfAborted();
    if (scene.isDisposed) throw new Error("The native scene was disposed during startup.");
    if (camera.isDisposed()) throw new Error("The native slice camera was disposed.");
  };
  validateLifetime();
  const canvas = getWorldCanvas(scene.getEngine());
  if (!canvas) throw new Error("The native scene requires a rendering canvas.");
  options.onProgress?.({ stage: "assets", detail: "Loading native character and equipment packages…" });
  const selectedId = new URLSearchParams(window.location?.search ?? "").get("character") ?? settings.playerProfileId ?? defaultNativePlayerProfile.id;
  const catalog = await loadNativeActorCatalog(signal, selectedId);
  const { catalogIndex, catalogIndexFailure } = await buildNativeCatalogIndexOrUnavailable(await readNativeCatalog(signal), signal);
  const playerProfile = catalog.playerProfile ?? defaultNativePlayerProfile;
  const playerChoices = catalog.playerProfiles ?? new Map([[playerProfile.id, playerProfile]]);
  const usesDefaultPlayerProfile = playerProfile.id === defaultNativePlayerProfile.id;
  const appearanceId = usesDefaultPlayerProfile ? "native-human-fighter" : `native-player:${playerProfile.id}`;
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
      clips: playerProfile.clips,
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
  const audioLoads = beginNativeSliceAudioLoads(catalog.animationAudio, signal);
  const addRelease = (release: () => void) => { boundaryReleases.push(release); };
  try {
    const playerCapsuleFromSourceCollision = () => ({ radius: playerProfile.collisionRadius / playerProfile.sourceUnitsPerMetre,
      height: 2 * playerProfile.collisionHeight / playerProfile.sourceUnitsPerMetre });
    const world = await loadNativeSliceWorld(scene, camera, settings, options.worldSource ?? catalogNativeSliceWorldSource, signal, {
      requireWorld: options.requireWorld ?? false, ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      validateLifetime, playerCapsule: playerCapsuleFromSourceCollision });
    boundaryReleases.push(world.release);
    const { section, movers, navigation, origin, worldFailure, flames, sky, skyFailure } = world;
    let followFighter = true;
    const nativeAudio = await loadNativeSliceAudio(audioLoads, { assets, animationAudio: catalog.animationAudio,
      archiveHashes: catalog.archiveHashes ?? new Map(), activeCatalogIds: [playerProfile.catalogId, "musveren:0"],
      hasWorldSection: Boolean(section), signal, validateLifetime, isRuntimeStopped: () => disposed || signal.aborted || scene.isDisposed, addRelease });
    const { mixer: audio, actionCues, footstepBundle, stepSounds, decoGrass, decoGrassFailure, footstepFailure, stepSoundFailure, listenerFollowsLocalPawn } = nativeAudio;
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
        speed: nativeSliceSpeedProfile(playerProfile.id, playerProfile.sourceUnitsPerMetre) });
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
      createVisual: sandboxNpcVisualFactory(catalogIndex, nativeCharacterFactory(profiles, actionCues, footsteps, clipPreview), sandboxNpcAppearanceOfModel),
      ...(navigation ? { ground: navigation.ground } : {}),
    });
    boundaryReleases.push(() => registry.dispose());
    const localPawnListenerLocation = (): [number, number, number] | null => {
      const pawn = listenerFollowsLocalPawn() ? registry.localPlayerPosition : null;
      return pawn ? [pawn.x, pawn.y + playerProfile.collisionHeight / playerProfile.sourceUnitsPerMetre, pawn.z] : null;
    };
    const { combatAudio, combatFailure } = createNativeSliceCombatAudio(nativeAudio, {
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
    ], addRelease);
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
    const effects = await createNativeSliceEffects({ scene, registry, adapter, fighter, musveren, specialAttackPreview, signal, validateLifetime, addRelease });
    const { effectComponents, effectComponentFailure, initEffect, shotEffect, powerStrike, powerStrikeReason } = effects;
    const materialOverrides = createNativeMaterialOverrides(scene, settings.materialOverrideEnabled ? {
      entityId: settings.materialEntityId ?? "local-player",
      sourceMaterial: settings.materialSource ?? "MFighter.UpBody.MFighter_m001_t04_u",
      tint: [settings.materialTint?.x ?? 1, settings.materialTint?.y ?? 1, settings.materialTint?.z ?? 1],
      roughness: settings.materialRoughness ?? 1,
    } : undefined);
    boundaryReleases.push(() => materialOverrides.dispose());
    if (worldFailure) ui.showStatus(`${worldFailure} Actor inspection area retained.`);
    else if (!section) ui.showStatus("No native world section staged. Actor inspection area retained.");
    else if (flames.failure) ui.showStatus(`${flames.failure} World and saved materials retained.`);
    else ui.clearStatus();
    boundaryReleases.push(ui.watchSound(() => audio.locked, () => audio.unlock()));
    boundaryReleases.push(attachWorldCamera(scene, canvas));
    boundaryReleases.push(attachTargeting(scene, registry, adapter, navigation, doors?.targeting));
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
    const flamePlacementIds = section?.manifest.placements?.filter(placement => placement.sourceMesh === "FX_E_S.Flameset.Default_Flame01").map(placement => placement.id) ?? [];
    const frameFlame = (placementId: string) => {
      if (!flamePlacementIds.includes(placementId)) throw new Error("Unknown flame placement.");
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
    const nativeSliceSheet = attachNativeSliceSheet({ scene, camera, canvas, ui, adapter, registry, settings, playerProfile, playerChoices,
      profileStagesLeatherShirt, archiveHashes: catalog.archiveHashes, clipPreview,
      locomotionClips, specialAttackPreview, world, audio: nativeAudio, footsteps, footstepGround, combatAudio, combatFailure, effects,
      cameraControls: { follow, frameWorld, frameFlame, flamePlacementIds, isFollowingFighter: () => followFighter },
      focusEffectCamera: () => effectCamera?.focus(), isDisposed: () => disposed, addRelease });
    boundaryReleases.push(attachSandboxCommandSheet({ section: ui.sheet.section("sandbox", { title: "Sandbox", order: 5 }), adapter,
      index: catalogIndex, indexFailure: catalogIndexFailure, appearanceOfModel: sandboxNpcAppearanceOfModel, selectedEntityId: () => registry.selectedEntityId,
      activePlayerProfileId: playerProfile.id, powerStrike }));
    const failFlames = (error: unknown) => nativeSliceSheet.failFlames(error);
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
        nativeAudio.worldAudio.ambience?.update(ear); nativeAudio.worldAudio.music?.update(ear);
      }
      materialOverrides.update();
      if (section && followFighter && registry.localPlayerPosition) camera.setTarget(registry.localPlayerPosition.add(new Vector3(.6, .35, 0)), false, false, true);
      if (flames.presentation && flames.clock) {
        try { flames.update(flames.clock.advance(uncappedFrameSeconds, adapter.isPaused)); }
        catch (error) { failFlames(error); }
      }
      ui.update(cappedFrameSeconds, scene.getEngine().getFps());
      nativeSliceSheet.update();
    });
    boundaryReleases.push(() => { scene.onBeforeRenderObservable.remove(observer); });
    boundaryReleases.push(attachNativeSliceDiagnostics({ scene, camera, registry, adapter, ui, playerProfile, musveren, handAnchor,
      specialAttackPreview, locomotionClips, world, audio: nativeAudio, footsteps, footstepGround, combatAudio, combatFailure, effects,
      doors, materialOverrides, frameFlame, failFlames, isDisposed: () => disposed, addRelease }));
    return stop;
  } catch (error) { stop(); throw error; }
}

