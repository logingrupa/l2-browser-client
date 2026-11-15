import type { Scene } from "@babylonjs/core/scene";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { NativePlayerProfile } from "../assets/native/loadNativePlayerProfiles";
import type { NativeClipPreviewHub } from "../assets/native/nativeClipPreview";
import type { resolveNativeLocomotionClips } from "../assets/native/nativeLocomotion";
import { isNativeSliceAdapterWithSourcedSpeed, type NativeSliceAdapter, type NativeSliceAdapterWithSourcedSpeed } from "../world/NativeSliceAdapter";
import type { WorldGroundContact } from "../world/WorldNavigation";
import type { EntityRegistry } from "../entities/EntityRegistry";
import type { WorldInterface } from "../ui/WorldInterface";
import type { DevGroup, DevSection } from "../ui/devSheet/DevSheet";
import type { VariableInfo } from "../ui/devSheet/types";
import type { createNativeFootstepPreview } from "../audio/nativeFootstepPreview";
import type { createFootstepGroundSampler } from "../audio/footstepSurfaceGround";
import type { NativeCombatAudio } from "../audio/nativeCombatAudio";
import { attachWorldAudioControls } from "../audio/worldAudioControls";
import { attachNativeFootstepControls } from "../audio/nativeFootstepControls";
import { attachNativeCombatAudioControls } from "../audio/nativeCombatAudioControls";
import { attachNativePowerStrikeControls } from "../ui/nativePowerStrikeControls";
import { attachNativeLocomotionControls } from "../ui/nativeLocomotionControls";
import { attachNativeEffectComponentControls } from "../ui/nativeEffectComponentControls";
import { attachNativeEffectInitControls } from "../ui/nativeEffectInitControls";
import { attachAssetImport } from "../ui/AssetImportPanel";
import { isSceneSuspended, setSceneSuspended } from "../engine/renderSuspension";
import { PRESENTATION_CHOICE, createNativeSliceSheetTools, pickRows, worldAudioVariables, type NativeSliceSheetTools } from "./nativeSliceSheet";
import { attachNativeSliceDebugSection } from "./nativeSliceDebug";
import { attachNativeSliceCharacterSheet } from "./attachNativeSliceCharacterSheet";
import { attachNativeSliceWorldSheet, type NativeSliceCameraControls } from "./attachNativeSliceWorldSheet";
import type { NativeSliceWorld } from "./loadNativeSliceWorld";
import type { NativeSliceAudio } from "./loadNativeSliceAudio";
import type { NativeSliceEffects } from "./createNativeSliceEffects";
import type { NativeSliceSettings } from "./createNativeSliceRuntime";
import { nativeWorldLocationTitles } from "./nativeWorldLocationTitles";
import type { DisplayGammaInspection } from "../materials/ue2/babylon/displayGammaPostProcess";

export interface NativeSliceSheetContext {
  scene: Scene;
  camera: ArcRotateCamera;
  canvas: HTMLCanvasElement;
  ui: WorldInterface;
  adapter: NativeSliceAdapter;
  registry: EntityRegistry;
  settings: NativeSliceSettings;
  playerProfile: NativePlayerProfile;
  playerChoices: ReadonlyMap<string, NativePlayerProfile>;
  profileStagesLeatherShirt: boolean;
  archiveHashes: ReadonlyMap<string, string> | undefined;
  clipPreview: NativeClipPreviewHub;
  displayGamma: DisplayGammaInspection;
  locomotionClips: ReturnType<typeof resolveNativeLocomotionClips>;
  specialAttackPreview: { clip: string | null; reason: string | null };
  world: NativeSliceWorld;
  audio: NativeSliceAudio;
  footsteps: ReturnType<typeof createNativeFootstepPreview>;
  footstepGround: ReturnType<typeof createFootstepGroundSampler>;
  localSurfaceContact: () => WorldGroundContact | null;
  combatAudio: NativeCombatAudio | null;
  combatFailure: string | null;
  effects: NativeSliceEffects;
  cameraControls: NativeSliceCameraControls;
  focusEffectCamera: () => void;
  isDisposed: () => boolean;
  addRelease: (release: () => void) => void;
}

export interface NativeSliceSheet {
  update(): void;
  failFlames(error: unknown): void;
}

function attachHeadsUpDisplayCards(context: NativeSliceSheetContext, tools: NativeSliceSheetTools, gaitVariables: () => VariableInfo[]): void {
  const { ui, adapter, scene, locomotionClips, combatAudio, world: { section } } = context;
  const { describe, events } = tools;
  const hudRunButton = ui.root.querySelector<HTMLElement>('[data-action="run"]');
  hudRunButton?.addEventListener("click", () => adapter.dispatch({ type: "set-locomotion", mode: "run" }), { signal: events });
  if (locomotionClips.walkClip && hudRunButton) {
    const hudWalkButton = document.createElement("button");
    hudWalkButton.type = "button"; hudWalkButton.dataset.action = "walk"; hudWalkButton.dataset.testid = "native-walk-action";
    hudWalkButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2"/><path d="m9 21 2-6 3 3v3M11 15l1-6 3 3 3 1M12 9l-3 2-1 4"/></svg><span>Walk</span>';
    hudRunButton.after(hudWalkButton);
    context.addRelease(() => hudWalkButton.remove());
    hudWalkButton.addEventListener("click", () => {
      adapter.dispatch({ type: "set-locomotion", mode: "walk" });
      adapter.dispatch({ type: "set-animation", animation: "run" });
      ui.showStatus("Walk demonstration · tap the ground to walk there", { transient: true });
    }, { signal: events });
    describe.element(hudWalkButton, { title: "Walk", description: "Switches the fighter to the original walk clip (and its walk footsteps). Tap the ground to walk there; Run switches back.", variables: gaitVariables }, "none");
  }
  describe.element(hudRunButton, { title: "Run", description: "Switches the fighter to the original run clip and its run footsteps. Tap the ground to run there.", variables: gaitVariables }, "none");
  context.addRelease(ui.bindGait(() => adapter.locomotionMode));
  const locationTitles = nativeWorldLocationTitles(section);
  describe.element(ui.root.querySelector(".world-location"), { title: locationTitles.sheetTitle, description: locationTitles.description }, "none");
  describe.element(ui.root.querySelector('[data-action="attack"]'), { title: "Attack", description: "Plays the fighter's original attack clip. Fist and voice sounds play at its AttackItem/AttackVoice notifies (hit or miss); each AttackShot plays the target's defense and damage sounds on the selected or nearest target in reach.",
    variables: () => [...tools.actorVariables("local-player", "fighter"), ...(combatAudio ? pickRows(combatAudio.describe(), ["combat.hitSounds", "combat.lastHit"]) : [])] }, "none");
  describe.element(ui.root.querySelector(".diagnostics"), { title: "World diagnostics", description: "Frame rate, entity count and fighter position in browser metres. Debug tab shows camera and native coordinates.",
    variables: () => [{ name: "debug.fps", value: () => String(Math.round(scene.getEngine().getFps())), values: "frames per second", source: "AbstractEngine.getFps()", status: "presentation" }] }, "none");
}

function attachAudioSection(section: DevSection, context: NativeSliceSheetContext, tools: NativeSliceSheetTools) {
  const mixerGroup = section.group("mixer", "Mixer, music & ambience", { hint: "One AudioContext graph with master, music, ambience and effects channels. It starts on your first tap, click or key press; music and ambience then begin by themselves. Native mix rules are unverified." });
  const worldAudio = context.audio.worldAudio;
  const audioControls = attachWorldAudioControls(mixerGroup.element, context.audio.mixer, { music: worldAudio.music, ambience: worldAudio.ambience,
    worldAudioFailure: worldAudio.failure, worldAudioLoading: worldAudio.loading });
  context.addRelease(() => audioControls.dispose());
  worldAudio.onChange = () => audioControls.setWorldAudio({ music: worldAudio.music, ambience: worldAudio.ambience, failure: worldAudio.failure, loading: worldAudio.loading });
  worldAudio.onChange();
  for (const card of audioControls.cards()) {
    tools.describe.testId(mixerGroup.element, card.testId, { title: card.title, ...(card.description ? { description: card.description } : {}),
      variables: () => worldAudioVariables(audioControls.describe().filter(row => card.rows.includes(row.name))) });
  }
  return audioControls;
}

function movementSpeedVariable(adapter: NativeSliceAdapter, sourceUnitsPerMetre: number): VariableInfo {
  const speed = adapter.speedProfile;
  if (!speed.isSourced) {
    return { name: "movement.speed", value: () => "speed-unresolved: move-local is refused", values: "no speed (no sourced server speed for this class)",
      source: speed.source, status: "unverified" };
  }
  return { name: "movement.speed", value: () => `${(adapter.locomotionMode === "walk" ? speed.walkMetresPerSecond : speed.runMetresPerSecond).toFixed(2)} m/s in the next move record`,
    values: `walk ${speed.walkMetresPerSecond.toFixed(2)} | run ${speed.runMetresPerSecond.toFixed(2)} m/s (walk speed for the first ${speed.runStartSeconds} s of a run)`,
    source: `${speed.source} ÷ sourceUnitsPerMetre ${sourceUnitsPerMetre}. Speeds are server data (no client file holds them); no acceleration ramp (APawn::calcVelocity).`,
    status: "presentation" };
}

function attachSourcedGaitCard(gaitGroup: DevGroup, adapter: NativeSliceAdapterWithSourcedSpeed, context: NativeSliceSheetContext,
  tools: NativeSliceSheetTools, gaitVariables: () => VariableInfo[]): void {
  const { locomotionClips } = context;
  const locomotionControls = attachNativeLocomotionControls(gaitGroup.element, adapter, locomotionClips.walkClip !== null, locomotionClips.reason);
  context.addRelease(() => locomotionControls.dispose());
  const locomotionRoot = gaitGroup.element.querySelector<HTMLElement>('[data-testid="native-locomotion-controls"]');
  const locomotionNote = locomotionClips.reason ? "" : tools.describe.foldStaticNoteIntoDescription(locomotionRoot?.querySelector<HTMLElement>("p"));
  const speed = adapter.speedProfile;
  tools.describe.element(locomotionRoot, { title: "Walk / run", description: `${locomotionNote} Speeds are aCis server data (walk ${speed.walkMetresPerSecond.toFixed(2)}, run ${speed.runMetresPerSecond.toFixed(2)} m/s); a run starts at walk speed for ${speed.runStartSeconds} s. Footsteps follow the armed gait.`.trim(), variables: gaitVariables });
}

function attachMovementSection(section: DevSection, context: NativeSliceSheetContext, tools: NativeSliceSheetTools, gaitVariables: () => VariableInfo[]): void {
  const { adapter, footsteps, footstepGround, audio, ui } = context;
  const { describe } = tools;
  const gaitGroup = section.group("gait", "Walk / run"), groundGroup = section.group("ground", "Ground under fighter");
  const footstepGroup = section.group("footsteps", "Footsteps");
  if (isNativeSliceAdapterWithSourcedSpeed(adapter)) attachSourcedGaitCard(gaitGroup, adapter, context, tools, gaitVariables);
  else {
    gaitGroup.note(`speed-unresolved: ${adapter.speedProfile.source}`, { tone: "warning", testId: "native-speed-unresolved", title: "Walk / run",
      hint: `No sourced server speed exists for ${context.playerProfile.name}, so the adapter refuses move-local and the gait card is not shown.`, variables: gaitVariables });
  }
  const groundContext = () => footstepGround.describe(context.localSurfaceContact());
  const resolvedSurface = () => footsteps.autoSurface().resolve(groundContext());
  groundGroup.readout({ label: "Ground", testId: "native-ground-readout", value: () => resolvedSurface().summary,
    hint: "Live support under the fighter (seeded at spawn, then from accepted moves) and what Auto footsteps resolve for it in the native order.",
    variables: () => [
      { name: "ground.contact", value: () => groundContext().kind, values: "terrain | terrain-patch | placement | bsp | mesh | none", source: "WorldGroundContact (accepted capsule support) standing in for native Pawn.Base", status: "unverified" },
      { name: "ground.source", value: () => groundContext().sourceId ?? groundContext().meshName ?? "-", values: "placement / BSP / terrain id", source: "mesh metadata markers", status: "native" },
      { name: "ground.material", value: () => groundContext().material ?? "-", values: "support triangle material", source: "Not read by the native footstep notify (no material footstep field exists)", status: "unverified" },
      { name: "ground.decoGrass", value: () => { const reading = groundContext().decoGrass; return reading ? `${reading.expected.toFixed(2)} expected (${reading.grass ? "≥" : "<"} ${reading.threshold}) · sector ${reading.sector ?? "-"}` : "-"; },
        values: "expected deco instances within 64 units XY", source: `${audio.decoGrass.field?.label ?? "deco-grass bundle not staged"}${audio.decoGrassFailure ? ` (${audio.decoGrassFailure})` : ""}`, status: "presentation" },
      { name: "ground.autoSurface", value: () => `${resolvedSurface().rule} · ${resolvedSurface().summary}`, values: "native order: support StepSound → volumes → ACTOR → GRASS/LAND",
        source: resolvedSurface().reason, status: resolvedSurface().status },
    ] });
  const footstepControls = attachNativeFootstepControls(footstepGroup.element, footsteps, audio.footstepFailure,
    { stepSoundFailure: audio.stepSoundFailure, decoGrassFailure: audio.decoGrassFailure, isVisible: () => ui.sheet.isOpen });
  context.addRelease(() => footstepControls.dispose());
  const footstepCards: [string, string, string[], string?][] = [
    ["footsteps.mode", "Footstep mode", ["footsteps.mode"], "Auto follows the native order: boots, the support's own StepSound, water/step volumes, ACTOR (Stone_Hard walk set) on other support, then GRASS or LAND on terrain. Steps always fire at the original notify times."],
    ["footsteps.renderDecoGrass", "RenderDeco grass footsteps", ["footsteps.renderDecoGrass", "footsteps.auto.terrain"], "On terrain the local player hears Grass where the expected decoration count within 64 units reaches 2, else Default. Approximation of the native deco instance count - the browser does not render decorations."],
    ["footsteps.surface", "Surface", ["footsteps.surface", "footsteps.auto.supportStepSounds", "footsteps.auto.actor", "footsteps.auto.terrain"], "All 16 original stepsound.uax groups (Water_Shalow keeps its spelling). Tapping one while Auto is on switches to Manual."],
    ["footsteps.variation", "Variation", ["footsteps.variation"], "Manual clip choice from the actual clips: ordinary Stone has two, the other surfaces three."],
    ["footsteps.bootsLayer", "Boot noise", ["footsteps.bootsLayer"]],
    ["footsteps.waterTransitions", "Water test", ["footsteps.waterTransitions"]],
    ["footsteps.readout", "Last footstep", ["footsteps.gait", "footsteps.auto.rule", "footsteps.auto.support", "footsteps.playback", "footsteps.lastClip"]],
  ];
  for (const [variable, title, names, description] of footstepCards) {
    describe.element(footstepGroup.element.querySelector(`[data-footstep-variable="${variable}"]`), { title, ...(description ? { description } : {}),
      variables: () => pickRows(footstepControls.describe(), names) });
  }
}

function attachCombatSection(section: DevSection, context: NativeSliceSheetContext, tools: NativeSliceSheetTools) {
  const { adapter, registry, specialAttackPreview, combatAudio, effects } = context;
  const { button, describe, actorVariables } = tools;
  const actionGroup = section.group("actions", "Actions"), hitGroup = section.group("hit-sounds", "Hit sounds");
  const powerStrikeGroup = section.group("power-strike", "Power Strike at target"), lifeGroup = section.group("life", "Life");
  const specialAttackText = specialAttackPreview.reason ??
    "Original special-attack animation with its direct sound cues, the optional timed init effects (Effects tab) and hit sounds at its AttackShot. Full native skill playback remains unverified.";
  button(actionGroup, "Fighter attack", () => adapter.dispatch({ type: "set-animation", entityId: "local-player", animation: "attack" }),
    { testId: "native-fighter-attack", hint: "Same as the HUD Attack action: the original attack clip, with hit sounds at AttackShot.", variables: () => actorVariables("local-player", "fighter") });
  button(actionGroup, "Special attack preview", () => adapter.dispatch({ type: "preview-action", action: "special-attack" }),
    { testId: "native-special-attack-preview", disabled: specialAttackPreview.clip === null, hint: specialAttackText,
      variables: () => [{ name: "specialAttack.clip", value: () => specialAttackPreview.clip ?? "unavailable", values: "original clip", source: "fighter animation archive", status: "native" }, ...actorVariables("local-player", "fighter")] });
  button(actionGroup, "Musveren attack", () => adapter.dispatch({ type: "set-animation", entityId: "native-musveren", animation: "attack" }),
    { hint: "Greater Musveren plays its original atk01 clip (its own direct cues). Its AttackShot plays the fighter's defense and damage sounds - conditional: native route C, but no server record proves the hit.", variables: () => actorVariables("native-musveren", "musveren") });
  button(actionGroup, "Musveren death", () => adapter.dispatch({ type: "set-health", entityId: "native-musveren", health: 0 }),
    { hint: "Sets Musveren's synthetic health to 0: original death clip and its death cue.", variables: () => actorVariables("native-musveren", "musveren") });
  button(actionGroup, "Revive Musveren", () => adapter.dispatch({ type: "set-health", entityId: "native-musveren", health: 100 }),
    { hint: "Restores Musveren's synthetic health.", variables: () => actorVariables("native-musveren", "musveren") });
  if (specialAttackPreview.reason) actionGroup.note(specialAttackPreview.reason, { tone: "warning", testId: "native-special-attack-status" });
  const combatControls = attachNativeCombatAudioControls(hitGroup.element, combatAudio, context.combatFailure, () => context.audio.mixer.unlock());
  context.addRelease(() => combatControls.dispose());
  const combatRows = combatControls.describe();
  for (const card of combatControls.cards()) {
    const description = card.description ?? combatRows.find(row => row.name === card.names[0])?.detail;
    describe.element(card.element, { title: card.title, ...(description ? { description } : {}), variables: () => pickRows(combatRows, card.names) });
  }
  const { powerStrike, shotEffect } = effects;
  const powerStrikeControls = attachNativePowerStrikeControls(powerStrikeGroup.element, powerStrike, shotEffect, effects.powerStrikeReason, context.focusEffectCamera);
  context.addRelease(() => powerStrikeControls.dispose());
  describe.testId(powerStrikeGroup.element, "native-power-strike-controls", { title: "Power Strike at target",
    description: `Charges the original init effects, then plays the special-attack clip at Greater Musveren (selected, or the only NPC when nothing is selected) and shows the original impact components at its AttackShot. Its hit sounds play at any distance (no reach check for this explicit target). Cast/shot sounds are skillsoundgrp name-match candidates; targeting and particle policy are a ${PRESENTATION_CHOICE}. No damage is applied.`,
    variables: () => [
      { name: "powerStrike.pending", value: () => String(powerStrike?.snapshot().pending ?? false), values: "true | false", source: "nativePowerStrikePreview", status: "presentation" },
      { name: "powerStrike.target", value: () => powerStrike?.snapshot().targetName ?? registry.selectedEntity?.displayName ?? "Greater Musveren (default)", values: "Greater Musveren", source: "selection, else the slice's only NPC", status: "presentation" },
      { name: "powerStrike.impact", value: () => shotEffect?.snapshot().status ?? "unavailable", values: "off | loading | armed | waiting | playing | completed | failed", source: "AttackShot event of the original SpAtk01_1HS clip", status: "native" },
      ...(combatAudio ? pickRows(combatAudio.describe(), ["combat.powerStrikeSounds"]) : []),
    ] });
  button(lifeGroup, "Fighter death", () => adapter.dispatch({ type: "set-health", entityId: "local-player", health: 0 }),
    { hint: "Sets the fighter's synthetic health to 0: original death clip and death cue.", variables: () => actorVariables("local-player", "fighter") });
  button(lifeGroup, "Revive fighter", () => adapter.dispatch({ type: "set-health", entityId: "local-player", health: 100 }),
    { hint: "Restores the fighter's synthetic health.", variables: () => actorVariables("local-player", "fighter") });
  return combatControls;
}

function attachEffectsSection(section: DevSection, context: NativeSliceSheetContext, tools: NativeSliceSheetTools): void {
  const { effectComponents, effectComponentFailure, initEffect } = context.effects;
  const componentGroup = section.group("components", "Power Strike components"), initGroup = section.group("init", "Init effects");
  const effectControls = attachNativeEffectComponentControls(componentGroup.element, effectComponents, effectComponentFailure, context.focusEffectCamera);
  context.addRelease(() => effectControls.dispose());
  tools.describe.testId(componentGroup.element, "native-effect-controls", { title: "Power Strike components",
    description: "Individual original skill effect components (skill 3 level 1 bundle), shown one at a time on the right hand. Particle policy is a modern presentation; native emitter behaviour is unverified.",
    variables: () => [{ name: "effects.component", value: () => effectComponents?.snapshot().selection.component ?? "none", values: "component object", source: "catalog.effectComponents", status: "unverified" },
      { name: "effects.status", value: () => effectComponents?.snapshot().status ?? effectComponentFailure ?? "not staged", values: "status", source: "nativeEffectComponentPreview", status: "presentation" }] });
  const initControls = attachNativeEffectInitControls(initGroup.element, initEffect, async () => { await effectComponents?.select(null); }, context.focusEffectCamera);
  context.addRelease(() => initControls.dispose());
  tools.describe.testId(initGroup.element, "native-init-effect-controls", { title: "Init effects",
    description: "Timed original init (charge) effects on the special-attack clip. Onset follows the source clip; lifetime/fade policy is a presentation choice.",
    variables: () => [{ name: "effects.init", value: () => initEffect?.snapshot().status ?? "unavailable", values: "status", source: "nativeEffectInitPreview", status: "presentation" }] });
}

function attachAssetInspector(section: DevSection, context: NativeSliceSheetContext): void {
  const { scene, adapter, audio } = context;
  const assetGroup = section.group("assets", "Asset inspector", {
    hint: "Opens a local converted asset package in its own preview scene. The world is suspended while the inspector is open and resumes unchanged.",
  });
  let inspectorOpen = false, suspensionBeforeInspector = false;
  const suspendWorldAndCuesForInspector = () => {
    if (context.isDisposed() || inspectorOpen) return;
    suspensionBeforeInspector = isSceneSuspended(scene);
    inspectorOpen = true;
    setSceneSuspended(scene, true);
    audio.mixer.setPaused(true);
  };
  const restoreInspectorSuspension = () => {
    if (!inspectorOpen) return;
    inspectorOpen = false;
    setSceneSuspended(scene, suspensionBeforeInspector);
    audio.mixer.setPaused(adapter.isPaused || suspensionBeforeInspector);
  };
  let detachAssetImport: (() => void) | undefined;
  context.addRelease(() => {
    try { detachAssetImport?.(); }
    finally { restoreInspectorSuspension(); }
  });
  detachAssetImport = attachAssetImport(scene, context.canvas, {
    host: assetGroup.element,
    onOpenChange(open) {
      if (open) suspendWorldAndCuesForInspector();
      else restoreInspectorSuspension();
    },
  });
}

export function attachNativeSliceSheet(context: NativeSliceSheetContext): NativeSliceSheet {
  const { ui, adapter, registry, playerProfile, locomotionClips, world: { section, flames } } = context;
  for (const name of ["spawn", "teleport"]) ui.root.querySelector(`[data-action="${name}"]`)?.remove();
  const label = ui.root.querySelector(".world-location > span");
  const pendingEffects = section?.manifest.unsupportedRuntimeMaterials?.reduce((total, gap) => total + gap.placementIds.length, 0) ?? 0;
  if (label) label.textContent = section ? `Debug match unverified${pendingEffects ? flames.presentation ? " · flame preview" : ` · ${pendingEffects} effects pending` : ""}` : "Native rigs · synthetic behavior";
  const sheet = ui.sheet;
  const sections = {
    audio: sheet.section("audio", { title: "Audio", icon: "audio", order: 10 }),
    movement: sheet.section("movement", { title: "Movement", icon: "movement", order: 20 }),
    combat: sheet.section("combat", { title: "Combat", icon: "combat", order: 30 }),
    character: sheet.section("character", { title: "Character", icon: "character", order: 40 }),
    world: sheet.section("world", { title: "World", icon: "world", order: 50 }),
    effects: sheet.section("effects", { title: "Effects", icon: "effects", order: 60 }),
    debug: sheet.section("debug", { title: "Debug", icon: "debug", order: 70 }),
  };
  const events = new AbortController();
  context.addRelease(() => events.abort());
  const tools = createNativeSliceSheetTools(sheet, registry, events.signal, context.addRelease);
  attachNativeSliceDebugSection(sections.debug, { scene: context.scene, camera: context.camera, registry: () => registry, playerProfile,
    playerChoices: context.playerChoices, events: events.signal });
  attachAssetInspector(sections.debug, context);
  const gaitVariables = (): VariableInfo[] => [
    { name: "movement.gait", value: () => adapter.locomotionMode, values: locomotionClips.walkClip ? "walk | run" : "run", source: "set-locomotion command → source walk/run clip", status: "native" },
    { name: "movement.walkClip", value: () => locomotionClips.walkClip ?? "unavailable", values: "original clip name",
      source: locomotionClips.walkSource === "profile-alias" ? "profile WalkAnimName[0] alias (no staged footstep pair: walking is silent)" : "actor animation archive + staged footstep notify pair (catalog.animationAudio)", status: "native" },
    { name: "movement.runClip", value: () => locomotionClips.runClip, values: "original clip name", source: "player profile run clip (RunAnimName[0])", status: "native" },
    movementSpeedVariable(adapter, playerProfile.sourceUnitsPerMetre),
    { name: "movement.clipRate", value: () => "1.0", values: "1.0 × NonAttackSpeedRate (1.0)", source: "UpdateMovementAnimation 0x10624cc0: walk/run clips are not stretched to the travel speed", status: "native" },
  ];
  attachHeadsUpDisplayCards(context, tools, gaitVariables);
  const audioControls = attachAudioSection(sections.audio, context, tools);
  attachMovementSection(sections.movement, context, tools, gaitVariables);
  const combatControls = attachCombatSection(sections.combat, context, tools);
  attachNativeSliceCharacterSheet(sections.character, context, tools);
  const worldSheet = attachNativeSliceWorldSheet(sections.world, context, tools);
  attachEffectsSection(sections.effects, context, tools);
  return {
    update() { audioControls.update(); combatControls.update(); },
    failFlames(error) {
      flames.fail(error);
      ui.showStatus(`${flames.failure} World and saved materials retained.`);
      worldSheet.showFlameFailure();
      if (label) label.textContent = `Debug match unverified · ${pendingEffects} effects pending`;
    },
  };
}
