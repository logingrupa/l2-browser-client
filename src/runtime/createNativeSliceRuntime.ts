import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { loadNativeActorCatalog } from "../assets/native/loadNativeCatalog";
import { readNativeCatalog } from "../assets/native/readNativeCatalog";
import { defaultNativePlayerProfile } from "../assets/native/loadNativePlayerProfiles";
import type { AssetPackage } from "../assets/package/readAssetPackage";
import { nativeCharacterFactory, type NativeCharacterProfile } from "../assets/native/NativeCharacterVisual";
import { catalogEquippedItemSource } from "../assets/native/nativeEquippedItemSource";
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
import { applyNativeSliceCameraPose, assertNativeSliceCameraPoseWithinLimits, type NativeSliceCameraPose } from "./nativeSliceCameraPose";
import { attachNativeSliceSheet } from "./attachNativeSliceSheet";
import { createNativeFootstepPreview, NATIVE_FOOTSTEP_WORLD_DEFAULT } from "../audio/nativeFootstepPreview";
import { createFootstepGroundSampler } from "../audio/footstepSurfaceGround";
import { resolveNativeLocomotionClips } from "../assets/native/nativeLocomotion";
import { resolveNativeSpecialAttackPreview } from "../assets/native/nativeSpecialAttackPreview";
import { resolveNativeHumanHandAnchor } from "../assets/native/nativeHumanHandAnchor";
import { createEffectInspectionCamera } from "../effects/nativeEffectInspectionCamera";
import { isSceneSuspended } from "../engine/renderSuspension";
import { sandboxNpcVisualFactory } from "./sandboxNpcVisual";
import { sandboxCharacterVisualFactory, sandboxLoadedPlayerProfileAppearance } from "./sandboxCharacterVisual";
import { attachSandboxCommandSheet } from "./attachSandboxCommandSheet";
import { createSandboxRuntimeActions } from "./sandboxRuntimeActions";
import { mountSandboxWindowLayer } from "./mountSandboxWindowLayer";
import { readNativeTableNameIndex } from "../ui/nativeTables/readNativeTableNameIndex";
import { selectedNativeTileIdentity } from "../scene/world/selectedNativeTile";
import { buildNativeCatalogIndexOrUnavailable } from "./buildNativeCatalogIndexOrUnavailable";
import { nativeWorldLocationTitles } from "./nativeWorldLocationTitles";
import { wireWorldMovement } from "./worldMovementWiring";
import { loadTileCollisionCells } from "./tileCollisionCells";
import { provideCollisionCellContext } from "../scene/world/movement/collisionCellContext";
import { createCollisionWorld } from "../scene/world/movement/core/collisionWorld";
import { committedMovementRules } from "./committedMovementRules";
import { cameraFogOnZoneChange, wireWorldEnvironment } from "./worldEnvironmentWiring";
import { installTransparentRenderingOrder } from "./transparentRenderingOrder";
import { hasUnappliedActorPivot, nativeNpcCharacterProfile, sandboxNpcAppearances } from "./sandboxNpcAppearances";
import type { WorldEntity } from "../world/worldTypes";
import type { WorldPosition } from "../world/sourceFrame";
import { createCollisionWorldNavigation } from "./collisionWorldNavigation";
import { sampleFootstepSurfaceContact } from "./footstepSurfaceContact";

const loadedSandboxNpcAppearanceByModel: ReadonlyMap<string, string> = new Map([["musveren:0", "native-musveren"]]);
const defaultRouteCollisionTileId = "20_20";
const localPlayerId = "local-player";

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
  const servedCatalog = await readNativeCatalog(signal);
  const { catalogIndex, catalogIndexFailure } = await buildNativeCatalogIndexOrUnavailable(servedCatalog, signal);
  const playerProfile = catalog.playerProfile ?? defaultNativePlayerProfile;
  const playerChoices = catalog.playerProfiles ?? new Map([[playerProfile.id, playerProfile]]);
  const usesDefaultPlayerProfile = playerProfile.id === defaultNativePlayerProfile.id;
  const appearanceId = usesDefaultPlayerProfile ? "native-human-fighter" : `native-player:${playerProfile.id}`;
  const assets: ReadonlyMap<string, AssetPackage> = catalog.models, musveren = catalog.npcProfiles.get("npc:21622");
  validateLifetime();
  if (![playerProfile.catalogId, "musveren:0", ...playerProfile.upperItems.map(item => item.catalogId)].every(id => assets.has(id))) {
    throw new Error("The selected native character, Musveren or equipment package is unavailable. Stage its verified player assets.");
  }
  if (!musveren || musveren.mesh !== assets.get("musveren:0")!.manifest.source.object || hasUnappliedActorPivot(musveren)) {
    throw new Error("The native slice needs its verified NPC 21622 profile and a supported actor pivot.");
  }
  const fighter = assets.get(playerProfile.catalogId)!, monster = assets.get("musveren:0")!;
  const profiles = new Map<string, NativeCharacterProfile>([
    [appearanceId, { asset: fighter,
      clips: playerProfile.clips,
      upperItems: new Map(playerProfile.upperItems.map(item => [item.itemId, assets.get(item.catalogId)!])),
      forwardAxis: Vector3.FromArray(playerProfile.forwardAxis), actorScale: Vector3.FromArray(playerProfile.actorScale) }],
    ["native-musveren", nativeNpcCharacterProfile(musveren, monster)],
  ]);
  const sandboxAppearanceOfNpc = sandboxNpcAppearances({ catalog: servedCatalog, npcProfiles: catalog.npcProfiles,
    loadedAppearanceByModel: loadedSandboxNpcAppearanceByModel, characterProfiles: profiles });
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
    boundaryReleases.push(installTransparentRenderingOrder(scene));
    const collisionWorld = createCollisionWorld();
    let localPlayerFocus: (() => WorldPosition | null) | null = null;
    boundaryReleases.push(provideCollisionCellContext(scene, { world: collisionWorld, focusPosition: () => localPlayerFocus?.() ?? null }));
    const playerCapsuleFromSourceCollision = () => ({ radius: playerProfile.collisionRadius / playerProfile.sourceUnitsPerMetre,
      height: 2 * playerProfile.collisionHeight / playerProfile.sourceUnitsPerMetre });
    const world = await loadNativeSliceWorld(scene, camera, settings, options.worldSource ?? catalogNativeSliceWorldSource, signal, {
      requireWorld: options.requireWorld ?? false, ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      validateLifetime });
    boundaryReleases.push(world.release);
    const { section, movers, origin, worldFailure, flames, sky, skyFailure } = world;
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
    const adapter = new NativeSliceAdapter(origin, startingUpperItemId,
      { displayName: playerProfile.name, appearanceId }, { walkSupported: locomotionClips.walkClip !== null,
        specialAttackPreviewSupported: specialAttackPreview.clip !== null,
        speed: nativeSliceSpeedProfile(playerProfile.id, playerProfile.sourceUnitsPerMetre),
        collision: { radius: playerProfile.collisionRadius, height: playerProfile.collisionHeight },
        moveTypes: { walk: committedMovementRules.pawn.walkMoveType, run: committedMovementRules.pawn.runMoveType } });
    boundaryReleases.push(() => adapter.dispose());
    const movementLifetime = new AbortController();
    boundaryReleases.push(() => movementLifetime.abort());
    const sectionStreamsTileCollision = selectedNativeTileIdentity(window.location) !== null;
    const movement = wireWorldMovement({ adapter, camera, rules: committedMovementRules, localPlayerId, collisionWorld,
      loadCollisionCells: !section ? () => Promise.reject(new Error("No native world section is loaded, so no tile collision is resident."))
        : sectionStreamsTileCollision ? () => Promise.resolve(null) : (world, lifetime) => loadTileCollisionCells(world, defaultRouteCollisionTileId, lifetime),
      loadedBounds: section ? { get minimum() { return section.minimum; }, get maximum() { return section.maximum; } } : null,
      localWalkAnimationFramesInMove: adapter.speedProfile.isSourced
        ? Math.round(adapter.speedProfile.runStartSeconds * committedMovementRules.pawn.runStartFramesPerSecond) : null,
      signal: movementLifetime.signal });
    boundaryReleases.push(() => movement.release());
    const localFeetPosition = () => movement.pose(localPlayerId)?.feetPosition ?? registry?.localPlayer?.position ?? null;
    const localSurfaceContact = () => sampleFootstepSurfaceContact(scene, localFeetPosition(), playerProfile.collisionHeight / playerProfile.sourceUnitsPerMetre);
    const footstepGround = createFootstepGroundSampler(scene, { decoGrass: decoGrass.field, sourceUnitsPerMetre: playerProfile.sourceUnitsPerMetre });
    boundaryReleases.push(() => footstepGround.dispose());
    if (section) footstepGround.preload(section.terrainMeshes);
    const entityVector = (id: string): [number, number, number] | null => {
      const position = registry?.entity(id)?.position;
      return position ? [position.x, position.y, position.z] : null;
    };
    const footsteps = createNativeFootstepPreview(footstepBundle.definitions, audio, {
      groundContact: owner => owner === localPlayerId ? localSurfaceContact() : null,
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
    const ui = new WorldInterface(adapter, () => registry, canvas, { location: nativeWorldLocationTitles(section).heading, coordinateUnit: "m" });
    boundaryReleases.push(() => ui.dispose());
    registry = new EntityRegistry(scene, adapter, ui.labels, message => ui.showStatus(message), {
      createVisual: sandboxCharacterVisualFactory(catalogIndex,
        sandboxNpcVisualFactory(catalogIndex, nativeCharacterFactory(profiles, catalogEquippedItemSource(servedCatalog, catalogIndex), actionCues, footsteps, clipPreview), sandboxAppearanceOfNpc),
        sandboxLoadedPlayerProfileAppearance(playerProfile.id, appearanceId)),
      actorClipPlayer: entityId => clipPreview.actorClipPlayer(entityId),
      ...(section ? { ground: (position: WorldPosition) => movement.groundBelow(position) } : {}),
      movementPose: entityId => movement.pose(entityId),
    });
    boundaryReleases.push(() => registry.dispose());
    localPlayerFocus = () => registry.localPlayerPosition;
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
    const presentedLocalPlayer = (): WorldEntity | null => {
      const entity = registry.localPlayer, pose = entity ? movement.pose(entity.id) : null;
      return entity && pose ? { ...entity, position: pose.feetPosition, animation: pose.isMoving ? "run" : entity.animation } : entity;
    };
    const doors = movers ? createNativeDoorInteractions(scene, movers.targets, {
      player: presentedLocalPlayer, dispatch: command => adapter.dispatch(command),
      onCommand: listener => adapter.subscribeCommands(listener), paused: () => adapter.isPaused || isSceneSuspended(scene),
    }, createCollisionWorldNavigation(movement, origin, { radius: playerProfile.collisionRadius, height: playerProfile.collisionHeight }),
    playerCapsuleFromSourceCollision(), message => ui.showStatus(message)) : undefined;
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
    boundaryReleases.push(attachTargeting(scene, registry, adapter, (origin, direction) => movement.destinationAlongRay(origin, direction), doors?.targeting));
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
    const setCameraPose = (pose: NativeSliceCameraPose) => {
      assertNativeSliceCameraPoseWithinLimits(camera, pose);
      effectCamera?.release();
      followFighter = false;
      applyNativeSliceCameraPose(camera, pose);
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
    const environment = wireWorldEnvironment({ adapter, camera, environmentClock: section?.environmentClock ?? null,
      cameraFog: section ? cameraFogOnZoneChange(section) : () => null, presentationFarPlane: camera.maxZ });
    boundaryReleases.push(() => environment.release());
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
      locomotionClips, specialAttackPreview, world, audio: nativeAudio, footsteps, footstepGround, localSurfaceContact, combatAudio, combatFailure, effects,
      cameraControls: { follow, frameWorld, frameFlame, flamePlacementIds, isFollowingFighter: () => followFighter },
      focusEffectCamera: () => effectCamera?.focus(), isDisposed: () => disposed, addRelease });
    const sandboxLifetime = new AbortController();
    boundaryReleases.push(() => sandboxLifetime.abort());
    const sandboxWindows = mountSandboxWindowLayer(ui.root, adapter, () => registry.localPlayer);
    boundaryReleases.push(sandboxWindows.release);
    boundaryReleases.push(attachSandboxCommandSheet({ section: ui.sheet.section("sandbox", { title: "Sandbox", order: 5 }), adapter,
      indexFailure: catalogIndexFailure, powerStrike, pickerContext: {
        host: createSandboxRuntimeActions({ adapter, windowLayer: sandboxWindows.layer, location: window.location, signal: sandboxLifetime.signal,
          clipListings: clipPreview }),
        catalogIndex, readNameIndex: readNativeTableNameIndex, selectedEntityId: () => registry.selectedEntityId,
        currentTileId: () => selectedNativeTileIdentity(window.location), signal: sandboxLifetime.signal,
      } }));
    const failFlames = (error: unknown) => nativeSliceSheet.failFlames(error);
    const observer = scene.onBeforeRenderObservable.add(() => {
      if (isSceneSuspended(scene)) { audio.setPaused(true); return; }
      const uncappedFrameSeconds = scene.getEngine().getDeltaTime() / 1000;
      const cappedFrameSeconds = Math.min(uncappedFrameSeconds, .1);
      audio.setPaused(adapter.isPaused);
      if (!adapter.isPaused) movement.advance(uncappedFrameSeconds);
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
      if (section && followFighter && registry.localPlayerPosition) {
        camera.setTarget(registry.localPlayerPosition.add(new Vector3(.6, .35, 0)), false, false, true);
        movement.constrainFollowCamera();
      }
      environment.update();
      if (flames.presentation && flames.clock) {
        try { flames.update(flames.clock.advance(uncappedFrameSeconds, adapter.isPaused)); }
        catch (error) { failFlames(error); }
      }
      ui.update(cappedFrameSeconds, scene.getEngine().getFps());
      nativeSliceSheet.update();
    });
    boundaryReleases.push(() => { scene.onBeforeRenderObservable.remove(observer); });
    boundaryReleases.push(attachNativeSliceDiagnostics({ scene, camera, registry, adapter, ui, playerProfile, musveren, handAnchor,
      specialAttackPreview, locomotionClips, world, audio: nativeAudio, footsteps, footstepGround, localSurfaceContact, combatAudio, combatFailure, effects,
      doors, movement, environment, materialOverrides, frameFlame, setCameraPose, failFlames, isDisposed: () => disposed, addRelease }));
    return stop;
  } catch (error) { stop(); throw error; }
}

