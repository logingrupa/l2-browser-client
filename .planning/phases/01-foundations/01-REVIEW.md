---
phase: 01-foundations
reviewed: 2026-11-08T09:36:02Z
depth: standard
files_reviewed: 198
files_reviewed_list:
  - .claude/settings.json
  - package.json
  - playwright.startup.config.ts
  - vitest.editor.config.ts
  - src/App.ts
  - src/assets/CharacterVisual.ts
  - src/assets/characterBounds.ts
  - src/assets/characterProfiles.ts
  - src/assets/native/NativeCharacterVisual.ts
  - src/assets/native/loadNativeCatalog.ts
  - src/assets/native/loadNativeWorldAudio.ts
  - src/assets/native/nativeCatalogIndex.ts
  - src/assets/native/nativeOrProceduralCharacter.ts
  - src/assets/native/readNativeCatalog.ts
  - src/assets/package/readAssetPackage.ts
  - src/audio/loadNativeCombatAudio.ts
  - src/editor/authoredNativeWorldSource.ts
  - src/editor/captureNativeWorld.ts
  - src/effects/nativeEffectComponents.ts
  - src/effects/nativePowerStrikeSource.ts
  - src/entities/EntityRegistry.ts
  - src/entities/attachTargeting.ts
  - src/runtime/attachNativeSliceCharacterSheet.ts
  - src/runtime/attachNativeSliceSheet.ts
  - src/runtime/attachNativeSliceWorldSheet.ts
  - src/runtime/attachSandboxCommandSheet.ts
  - src/runtime/attachScenePresentationGroup.ts
  - src/runtime/createNativeSliceEffects.ts
  - src/runtime/createNativeSliceRuntime.ts
  - src/runtime/createWorldRuntime.ts
  - src/runtime/loadNativeSliceAudio.ts
  - src/runtime/loadNativeSliceWorld.ts
  - src/runtime/nativeSandboxConfiguration.ts
  - src/runtime/nativeSliceDebug.ts
  - src/runtime/nativeSliceDiagnostics.ts
  - src/runtime/nativeSliceSheet.ts
  - src/runtime/nativeSliceWorldSource.ts
  - src/runtime/presentationConfigurationVariables.ts
  - src/runtime/sandboxNpcVisual.ts
  - src/runtime/startNativeSandboxRuntime.ts
  - src/scene/authoredNativeWorld.ts
  - src/scene/buildPresentationScene.ts
  - src/scene/documentTitles.ts
  - src/scene/environmentContext.ts
  - src/scene/loadEnvironment.ts
  - src/scene/navigation/meshNavigation.ts
  - src/scene/openBabylonInspector.ts
  - src/scene/presentationConfiguration.ts
  - src/scene/registerSceneShaders.ts
  - src/scene/world/loadImportedWorld.ts
  - src/scene/world/loadNativeMovers.ts
  - src/scene/world/loadNativeSection.ts
  - src/scripts.ts
  - src/scripts/nativeParity.ts
  - src/ui/EntityLabel.ts
  - src/ui/WorldInterface.ts
  - src/ui/devSheet/devSheetIdEntry.ts
  - src/ui/devSheet/devSheetParts.ts
  - src/ui/devSheet/devSheetStyles.ts
  - src/ui/devSheet/types.ts
  - src/ui/nativeLocomotionControls.ts
  - src/ui/worldStyles.ts
  - src/world/GameWorldAdapter.ts
  - src/world/MockWorldAdapter.ts
  - src/world/NativeSliceAdapter.ts
  - src/world/sandboxCommands.ts
  - src/world/worldTypes.ts
  - tests/browser/assetPackage.spec.ts
  - tests/browser/inspector.spec.ts
  - tests/browser/loadingPanel.spec.ts
  - tests/browser/nativeBsp.spec.ts
  - tests/browser/nativeFacing.spec.ts
  - tests/browser/nativeFlame.spec.ts
  - tests/browser/nativeReveal.spec.ts
  - tests/browser/nativeSlice.spec.ts
  - tests/browser/nativeStartup.spec.ts
  - tests/browser/sandbox.spec.ts
  - tests/browser/stagedNativeTerrainPath.ts
  - tests/browser/terrainLegacyReference.spec.ts
  - tests/browser/webgpu.spec.ts
  - tests/editor/authoredEnvironmentRouting.test.ts
  - tests/editor/authoredNativeSection.test.ts
  - tests/editor/editorAuthoredMaterials.test.ts
  - tests/editor/editorFogExport.test.ts
  - tests/editor/editorGeometryCompat.test.ts
  - tests/editor/editorMaterials.test.ts
  - tests/editor/editorScene.test.ts
  - tests/editor/editorScript.test.ts
  - tests/editor/editorWebgpuCompat.test.ts
  - tests/editor/environmentLoading.test.ts
  - tests/editor/nativeEditorBspAppend.test.ts
  - tests/editor/nativeEditorModelAppend.test.ts
  - tests/editor/nativeEditorPlacementAppend.test.ts
  - tests/editor/nativeEditorScene.test.ts
  - tests/editor/nativeEditorTerrainAppend.test.ts
  - tests/editor/nativeEditorUv2.test.ts
  - tests/editor/nativeParityScript.test.ts
  - tests/editor/nativeTerrainExportMaterials.test.ts
  - tests/fixtures/assetPackageFixture.ts
  - tests/fixtures/native940Contact.ts
  - tests/startup/devStartup.spec.ts
  - tests/support/sourceImportSpecifiers.ts
  - tests/support/staticImportGraph.ts
  - tests/unit/animation.test.ts
  - tests/unit/appStartup.test.ts
  - tests/unit/architectureInvariants.test.ts
  - tests/unit/assetPackage.test.ts
  - tests/unit/assetPackageContract.test.ts
  - tests/unit/assets.test.ts
  - tests/unit/defaultEntryImportGraph.test.ts
  - tests/unit/devSheetIdEntry.test.ts
  - tests/unit/editorIndependence.test.ts
  - tests/unit/entityGroundClearance.test.ts
  - tests/unit/entityReadiness.test.ts
  - tests/unit/environmentRouting.test.ts
  - tests/unit/gameWorldAdapterContract.test.ts
  - tests/unit/importBoundaries.test.ts
  - tests/unit/laneOwnership.test.ts
  - tests/unit/nativeBspSupport.test.ts
  - tests/unit/nativeCatalogIndex.test.ts
  - tests/unit/nativeEffectComponents.test.ts
  - tests/unit/nativeLocomotion.test.ts
  - tests/unit/nativeMoverLoader.test.ts
  - tests/unit/nativeOrProceduralCharacter.test.ts
  - tests/unit/nativePlayerProfiles.test.ts
  - tests/unit/nativePowerStrikeSource.test.ts
  - tests/unit/nativeResource.test.ts
  - tests/unit/nativeSection.test.ts
  - tests/unit/nativeSliceAdapter.test.ts
  - tests/unit/nativeSliceRuntime.test.ts
  - tests/unit/nativeSliceWorldSource.test.ts
  - tests/unit/nativeSpecialAttackPreview.test.ts
  - tests/unit/navigation.test.ts
  - tests/unit/navigationContact.test.ts
  - tests/unit/navigationDynamic.test.ts
  - tests/unit/presentationConfiguration.test.ts
  - tests/unit/presentationConfigurationVariables.test.ts
  - tests/unit/privatePreviewTargets.test.ts
  - tests/unit/readNativeCatalog.test.ts
  - tests/unit/sandboxCommandSheet.test.ts
  - tests/unit/sandboxCommands.test.ts
  - tests/unit/sandboxMissingAsset.test.ts
  - tests/unit/world.test.ts
  - tests/unit/worldInterfaceSheet.test.ts
  - tests/unit/worldRuntime.test.ts
  - scripts/audit-native-footstep-config.py
  - scripts/audit_musveren_weights.py
  - scripts/build_dat_table_inventory.py
  - scripts/build_reference_client_lock.py
  - scripts/check-lane-ownership.d.mts
  - scripts/check-lane-ownership.mjs
  - scripts/check-private-preview-burst.mjs
  - scripts/check-private-preview-external.mjs
  - scripts/check-private-preview.mjs
  - scripts/derive-native-map-model.py
  - scripts/derive-native-map-movers.py
  - scripts/derive-native-map-overlap.py
  - scripts/export-native-map-audio.py
  - scripts/export-native-sounds.py
  - scripts/extract-native-terrain-patch.py
  - scripts/generate_golden_fixtures.py
  - scripts/hash_reference_client_tree.py
  - scripts/native_actor_profiles.py
  - scripts/native_assets.py
  - scripts/native_assets_lib/asset_manifest.py
  - scripts/native_assets_lib/umodel_import_closure.py
  - scripts/native_bsp_building.py
  - scripts/native_bsp_floor.py
  - scripts/native_catalog/cli.py
  - scripts/native_catalog/effects.py
  - scripts/native_catalog/tables.py
  - scripts/native_catalog/test_catalog.py
  - scripts/native_catalog/test_effects.py
  - scripts/native_effect_bundle.py
  - scripts/native_effects.py
  - scripts/native_map.py
  - scripts/native_map_geometry.py
  - scripts/native_map_overlap.py
  - scripts/native_migration.py
  - scripts/native_sky.py
  - scripts/prepare-native-player-aliases.py
  - scripts/private-preview-targets.d.mts
  - scripts/private-preview-targets.mjs
  - scripts/private-preview-tunnel.ps1
  - scripts/private-preview.mjs
  - scripts/reference_client_guard.py
  - scripts/report-native-animation-aliases.py
  - scripts/restore-native-static-normals.py
  - tests/pipeline/test_asset_manifest_v2.py
  - tests/pipeline/test_client_entry_points.py
  - tests/pipeline/test_dat_table_inventory.py
  - tests/pipeline/test_native_actor_profiles.py
  - tests/pipeline/test_native_animation_aliases.py
  - tests/pipeline/test_native_assets_manifest_v2.py
  - tests/pipeline/test_native_bsp_building.py
  - tests/pipeline/test_native_effect_bundle.py
  - tests/pipeline/test_native_sounds.py
  - tests/pipeline/test_reference_client_guard.py
  - tests/pipeline/test_reference_client_lock.py
  - tests/pipeline/test_reference_client_tree.py
  - tests/pipeline/test_umodel_import_closure.py
findings:
  critical: 6
  warning: 40
  info: 34
  total: 80
  necessity: 5
status: issues_found
---

# Phase 1: code review report

Three parallel standard-depth reviewers covered the phase scope (SUMMARY key files plus the phase-range evaluation scope, 201 code files; docs, binary fixtures and lock data excluded, see OVERNIGHT-DECISIONS row 46). Part A covers application source and root config (IDs 1NN), part B the TypeScript tests (2NN), part C the Python and Node scripts and pipeline tests (3NN). Findings tagged "(reference route)" concern the route that the removal branch deletes.


## Part (part A: application source and root config)

**Reviewed:** 2026-11-08T09:36:02Z
**Depth:** standard
**Files Reviewed:** 67
**Status:** issues_found

### Summary

I read every listed file as it stands and checked the phase diff from `2d29a34`. Where a finding depends on a called module or on staged data, I checked that too: `src/ui/AssetImportPanel.ts`, `src/main.ts`, `.gitignore`, `public/l2/catalog.json`, the staged player-profile manifest and `assets/native-parity.scene/config.json`. The necessity rubric (`necessity-review.md`) was read and applied.

Overall: the phase delivers the code-built native sandbox route, a shared catalog reader, the sandbox command sheet and a catalog index. Comment removal is complete in every listed file. The main defects are these:

- Two source-fidelity violations on the default native sandbox route. Human fighter speeds are applied to every player profile, and a saved Editor idle clip overrides the sourced unarmed idle.
- A catalog-index build that can block the whole sandbox because two model packages share one source object, which the staged catalog already has.
- Sandbox command notes that report success whether or not the adapter acted.
- A schema-v2 regression in the asset inspector.
- An inspector failure that tears down a ready world.
- A startup-measurement config that bypasses the compiler staging `pnpm dev` performs.

### Critical Issues

### CR-101: Human fighter aCis speeds applied to every player profile, including mystics

**File:** `src/world/NativeSliceAdapter.ts:19-27`, `src/runtime/createNativeSliceRuntime.ts:139-142`, `src/runtime/attachNativeSliceSheet.ts:118`
**Issue:** `nativeSliceSpeedProfile` always derives walk/run speed from `ACIS_HUMAN_FIGHTER_SPEED`. Its own source string scopes it to "humanFighter.xml ... class 0, both sexes". `createNativeSliceRuntime` calls it for whichever profile `?character=` selects. The staged catalog has `human-male-mystic` and `human-female-mystic`, and the Character sheet offers them through "Play as". Playing as a mystic therefore moves at the human fighter's server speeds and labels them with the fighter's source. That breaks the rule "Never invent Lineage II values ... every value records its source". The Movement card text at `attachNativeSliceSheet.ts:118` also hardcodes "walk 80, run 115 units/s ... 0.4 s" as literals, so it duplicates the constants and stays wrong for every non-fighter profile.
**Fix:** Key the speed table by the profile's class and make an unsourced class visibly unresolved, not a fighter copy. Render the card text from `adapter.speedProfile`:
```ts
const sourcedSpeedByPlayerProfile: ReadonlyMap<string, typeof ACIS_HUMAN_FIGHTER_SPEED> = new Map([
  ["human-male-fighter", ACIS_HUMAN_FIGHTER_SPEED], ["human-female-fighter", ACIS_HUMAN_FIGHTER_SPEED]]);
export function nativeSliceSpeedProfile(profileId: string, sourceUnitsPerMetre: number): NativeSliceSpeedProfile | null {
  const sourced = sourcedSpeedByPlayerProfile.get(profileId);
  return sourced ? Object.freeze({ walkMetresPerSecond: sourced.walkUnitsPerSecond / sourceUnitsPerMetre, ... }) : null;
}
```
When it returns null, show "speed unresolved for <profile>" in the sheet. For `attachNativeSliceSheet.ts:118`, build the string from `adapter.speedProfile.source` and its values.

### CR-102: Default sandbox route replaces the sourced unarmed idle with a one-handed-sword idle

**File:** `src/runtime/nativeSandboxConfiguration.ts:29`, `src/runtime/createNativeSliceRuntime.ts:83-85`
**Issue:** For the default `human-male-fighter` profile, `playerClipsWithSavedFighterEdits` replaces the sourced profile clips with `settings.fighterIdle/Run/Attack/Death`. The new code-built sandbox route now hardcodes `fighterIdle: "Wait_1HS_MFighter"`, copied from the old Editor scene's saved script values. The staged, sourced player profile (`/l2/player-profiles/353463d3.../manifest.json`) gives `idle: "Wait_Hand_MFighter"`, the WT_HAND family that the run (`Run_Hand_MFighter`) and attack (`Atk01_Hand_MFighter`) clips also use. The unarmed default fighter therefore idles in the one-handed-sword pose. The alias evidence family shown in the Character tab is WT_HAND, so the route contradicts its own sourced data. `nativeSandboxConfiguration` labels these values "presentation, not L2". An animation clip choice is Lineage II data, though, and a presentation override must not replace the sourced value on the default native route.
**Fix:** Drop the clip overrides from `nativeSandboxConfiguration` and use `playerProfile.clips` for every profile, so the default route plays sourced clips. If the Editor-saved values must stay reachable, keep them only on the optional `authored=1` path:
```ts
const playerClipsWithSavedFighterEdits = () => playerProfile.clips;
```

### Warnings

### WR-101: Catalog index build blocks the whole sandbox when model packages share a source object

**File:** `src/assets/native/nativeCatalogIndex.ts:95-96`, `src/runtime/createNativeSliceRuntime.ts:78`
**Issue:** NPC records are matched to a model by `sourceObject === profile.mesh`, and more than one match throws `duplicateEntries`. The staged catalog already has two model packages with the same source object: `human-male-fighter:0` and `fighter-equipment:0` are both `Fighter.MFighter_m001_u`, so the source object is not unique by construction. Any staged NPC profile whose mesh is a shared player or equipment mesh makes `buildNativeCatalogIndex` throw. It is awaited unguarded at `createNativeSliceRuntime.ts:78`, before the world and actors load, so the failure kills native sandbox startup even though only the Sandbox command sheet uses the index.
**Fix:** Select the model package by an unambiguous rule (for example the package whose catalog id the NPC profile names, or only `kind: "model"` body packages). Record an ambiguous match as a `not-in-catalog` entry with the reason, not as a thrown error:
```ts
if (modelIds.length > 1) { addEntry({ status: "not-in-catalog", key, reason: `mesh ${profile.mesh} matches ${modelIds.length} converted packages` }); continue; }
```
Also catch an index failure in the runtime and show it as a Sandbox-tab note, not a startup failure.

### WR-102: Sandbox command notes report success whatever the adapter did

**File:** `src/runtime/attachSandboxCommandSheet.ts:68-73`, `:91-96`, `:114-120`
**Issue:** Each `onSubmit` dispatches the command and then shows a note from a separate catalog lookup. The note does not depend on whether the adapter accepted the command. `NativeSliceAdapter.spawnNpc` silently returns when `navigation.spawn` finds no free support (`NativeSliceAdapter.ts`, `if (!position) return;`). `skillCastEvent` returns null when the caster or target is dead. In those cases the sheet still says "npc:21622 converted, model musveren:0" or "skill:3:1 converted" in the info tone, although nothing spawned or was cast. The developer gets false evidence about what the adapter did.
**Fix:** Derive the note from the adapter's response. Subscribe for the matching `spawn` or `skill-cast` event during the dispatch (dispatch is synchronous for both adapters), and report "rejected by the adapter" when none arrives:
```ts
let accepted = false;
const unsubscribe = context.adapter.subscribe(event => { if (event.type === "spawn" && event.entity.npcId === npcId) accepted = true; });
context.adapter.dispatch({ type: "spawn-npc", npcId }); unsubscribe();
showResult(accepted ? describeSpawnPresentation(lastSpawn) : `${lastSpawn.key}: spawn rejected (no free supported position)`, accepted ? "info" : "warning");
```

### WR-103: asset.json v2 support breaks the asset inspector's unit readout

**File:** `src/assets/package/readAssetPackage.ts:10,13,116` (consumer `src/ui/AssetImportPanel.ts:148`)
**Issue:** The phase moves model units into `manifest.coordinates` and normalizes only schema v1 (line 116). Schema v2 manifests are returned as-is, and their `model` entry no longer carries `sourceUnitsPerMetre`. `model` is now typed `{ file: string; [key: string]: unknown }`, so the type checker no longer catches the stale read in `AssetImportPanel.ts:148` (`manifest.model.sourceUnitsPerMetre`). For every v2 package the inspector prints "1 metre = undefined source units".
**Fix:** Read the normalized field in the consumer. Also tighten the type so `model` cannot be indexed for unit fields:
```ts
if (manifest.coordinates) metadataRow("Unit", `1 metre = ${manifest.coordinates.sourceUnitsPerMetre} source units`);
```

### WR-104: A failed `?inspect=1` load tears down a ready world

**File:** `src/App.ts:39`
**Issue:** `init()` awaits `openInspector` after the world is marked ready (`worldState = "ready"`, loading panel removed). If the dynamic `import("@babylonjs/inspector")` chunk fails or `ShowInspector` throws, `init()` rejects. `src/main.ts` then runs `app.dispose(); showLoadingError(error)`, which disposes a working scene and shows a load failure. A debug tool failure destroys the game view.
**Fix:** Keep inspector failures out of the startup path:
```ts
if (new URLSearchParams(window.location.search).get("inspect") === "1") {
  void this.openInspector(this.scene).catch((error: unknown) => console.error("Babylon Inspector failed to open.", error));
}
```

### WR-105: Startup measurement server skips the WebGPU compiler staging that `pnpm dev` runs

**File:** `playwright.startup.config.ts:12`
**Issue:** The web server command is `pnpm exec vite ...`, but `pnpm dev` is `node scripts/stage-webgpu-compilers.mjs && vite`. `public/vendor/babylon/` is gitignored (`.gitignore`), and AGENTS.md says the runtime loads those compilers. On a fresh checkout or lane, the "dev cold start" run serves no staged compilers. It either fails or measures a different startup from the one it claims to re-measure (plan 01-17).
**Fix:**
```ts
webServer: { command: "node scripts/stage-webgpu-compilers.mjs && pnpm exec vite --host 127.0.0.1 --port 5175 --strictPort", ... }
```

### WR-106: Navigation constants tuned for the reference route are applied, unsourced, to the native route

**File:** `src/scene/navigation/meshNavigation.ts:6-7,143,297,322`; `src/entities/attachTargeting.ts:29`
**Issue:** This phase moved the file and deleted the comment saying `maxStep = 0.3, skin = 0.002` are "source-world units, matching the audited .4764767 visual scale", which is the reference route's scale. `loadNativeSliceWorld.ts:122` now uses the same module for the native 20_20 section in metres. Step height 0.3, the 45 degree slope limit (duplicated in `attachTargeting.ts:29`), the 1.4 occupied-spawn spacing (line 297, duplicating `sandboxActorSpacingMetres`), the 0.8 destination drop (line 322) and the default capsule `{ radius: .1, height: .9 }` (line 143) have no recorded Lineage II source. They therefore act as procedural stand-ins on the native route. The rename that the comment rule requires was also not done: `skin`, `tri`, `p`, `q`, `aa`, `ee`, `d1`-`d6`, `s`, `t`, `u`, `v` violate the full-word naming rule in a file this phase touched.
**Fix:** Pass the step height, slope and spacing in through `MeshNavigationOptions`, with the native route supplying sourced values (or marking them unresolved). Name them (`maximumStepHeightMetres`, `contactSkinMetres`, `walkableSlopeCosine`). Share one constant with `attachTargeting` and `NativeSliceAdapter`, and rename the single-letter locals.

### WR-107: Duplicated error and promise helpers live in a UI-sheet module

**File:** `src/runtime/nativeSliceSheet.ts:7-10`, `src/runtime/loadNativeSliceWorld.ts:69`
**Issue:** `failureText` in `nativeSliceSheet.ts` and `failureMessage` in `loadNativeSliceWorld.ts` are the same function. Both were added in this phase, which breaks "one owner per piece of logic". `settle`/`Settled`/`failureText` are generic helpers, but they live in the developer-sheet module. That makes the audio loader (`loadNativeSliceAudio.ts:12`) and the effects loader (`createNativeSliceEffects.ts:12`) depend on a sheet module for non-UI logic.
**Fix:** Move `settle`, `Settled` and one `failureText` into a small `src/runtime/settledTasks.ts`, import it in all three runtime modules, and delete `failureMessage`.

### WR-108: `loadNativeCatalog` is a production export used only by tests

**File:** `src/assets/native/loadNativeCatalog.ts:7-8,27-29`
**Issue:** `loadNativeCatalog` and the hardcoded default `wanted` list (`["human-male-fighter:0", "fighter-equipment:0", "musveren:0"]`) that only it uses have no caller in `src/`. The only caller is `tests/unit/nativeResource.test.ts:43`. The phase touched this file, and AGENTS.md says to delete code in the change that makes it unused.
**Fix:** Delete `loadNativeCatalog` and the default parameter. Point the test at `loadNativeActorCatalog` or at `loadModels` through an exported, named function that production uses.

### WR-109: Generality without instantiation - catalog index `keys()` and tile entries have no production consumer

**File:** `src/assets/native/nativeCatalogIndex.ts:10-11,19,25,51-54,127-136,145-147`
**Category:** necessity
**Issue:** `NativeCatalogIndex.keys()` is called only in `tests/unit/nativeCatalogIndex.test.ts:69,78`. `tile:` entries (`NativeTileCatalogRecord`, `tileCatalogKey`, `sectionTilePattern` and the section loop) are built on every sandbox start, but no `src/` code looks up a `tile:` key. The only callers are `tests/unit/assetPackageContract.test.ts:99` and `nativeCatalogIndex.test.ts`. The sandbox sheet uses only `npc:`, `item:`, `skill:` and `window:` lookups (`attachSandboxCommandSheet.ts`, `sandboxNpcVisual.ts`).
**Fix:** Remove `keys()` and the tile indexing until a requirement consumes them (keep the duplicate-section-id validation if it is wanted at the boundary), or add the consumer in the same change.

### WR-110: Generality without instantiation - `createWorldRuntime` `suppliedAdapter` is never supplied (reference route)

**File:** `src/runtime/createWorldRuntime.ts:24,32`
**Category:** necessity
**Issue:** The only production call is `createWorldRuntime(scene, camera)` (`src/scene/loadEnvironment.ts:66`), and both tests call it without an adapter (`tests/unit/worldRuntime.test.ts:81,93`). The optional adapter has one instantiation (`MockWorldAdapter`), and the cleanup disposes whatever was supplied, so the parameter only carries an untested ownership contract.
**Fix:** Drop the parameter and construct `MockWorldAdapter` directly (moot once the reference route is deleted).

### WR-111: Impossible-state guards on the verified Musveren profile

**File:** `src/runtime/createNativeSliceRuntime.ts:101-102`, `src/runtime/nativeSliceDiagnostics.ts:73`
**Category:** necessity
**Issue:** `musveren` is a `const`, and line 91 throws when it is undefined, so TypeScript narrows it for the rest of the function. The six `musveren!` assertions on lines 101-102 guard a state that cannot occur (the same function uses plain `musveren.` at lines 183-184). `NativeSliceDiagnosticInputs.musveren` is typed `NativeNpcProfile` (non-nullable), so `inputs.musveren ?? null` can never produce `null`.
**Fix:** Remove the `!` assertions and the `?? null`.

### Info

### IN-101: Sound-cue click handler has a catch branch that changes nothing

**File:** `src/ui/WorldInterface.ts:102`
**Issue:** `try { void this.soundUnlock?.(); } catch { this.renderSound(); return; } this.renderSound();` calls `renderSound` on both paths, so the catch only swallows errors. `WorldAudioMixer.unlock()` never throws synchronously; it catches internally and returns a promise.
**Fix:** `this.soundCue.addEventListener("click", () => { void this.soundUnlock?.(); this.renderSound(); }, ...)`.

### IN-102: Unneeded exports and a positional wrapper in `nativeSliceSheet.ts`

**File:** `src/runtime/nativeSliceSheet.ts:25,30,49-51,53`
**Issue:** `DescribedRow`, `SheetDescriber` and `SheetButtonInfo` are exported but never imported elsewhere. `readout(group, label, value, testId, hint, variables)` only reorders arguments of `group.readout({...})` and is used only by `nativeSliceDebug.ts`.
**Fix:** Un-export the three types and call `group.readout({ ... })` directly in `nativeSliceDebug.ts`.

### IN-103: Native-unit conversion hardcodes 100 instead of `sourceUnitsPerMetre`

**File:** `src/runtime/nativeSliceDebug.ts:36,39`, `src/runtime/nativeSliceDiagnostics.ts:91`
**Issue:** `current.x * 100` and `origin.x * 100` duplicate the conversion that `playerProfile.sourceUnitsPerMetre` already holds, and the hint text says "x 100" as a literal.
**Fix:** Use `playerProfile.sourceUnitsPerMetre` (available in both option objects) through one shared `browserMetresToNativeUnits` helper.

### IN-104: Spawned NPCs get an invented kind and HP

**File:** `src/world/sandboxCommands.ts:15,20-21`
**Issue:** `createSpawnedNpcEntity` marks every NPC id `kind: "monster"` with `health/maximumHealth: 100`, and the label shows that as a health bar. Many NPC ids are not monsters, and neither value comes from a source.
**Fix:** Mark the values synthetic in the entity (for example omit the health bar for spawned NPCs), or note the gap against DATA-01 in the sheet.

### IN-105: Catalog read cache ignores the `fetchResource` argument

**File:** `src/assets/native/readNativeCatalog.ts:70-79`
**Issue:** The cache is keyed only by `signal`. A caller that passes its own fetcher with an already-used signal (as `loadNativeCombatAudio(signal, { fetch })` allows) silently gets the first caller's result.
**Fix:** Key the cache by signal and fetcher (`WeakMap<AbortSignal, Map<typeof fetch, Promise<NativeCatalog>>>`), or drop the fetcher parameter and inject it once.

### IN-106: Custom styling added to the stand-in HUD and the developer sheet after DEC-OWN-10

**File:** `src/ui/worldStyles.ts:82-83`, `src/ui/devSheet/devSheetStyles.ts:129-133`
**Issue:** Commit 7cf031f (09:55, after DEC-OWN-10 at 09:40) adds a styled `.entity-diagnostic` chip with its own background and padding to the in-world labels, plus `.dev-id-entry*` rules with a custom message colour. The binding run rules say the sandbox, developer sheet and diagnostic UI get no custom styling.
**Fix:** Keep only the structural rules (`[hidden] { display: none }`, grid or flex layout). Drop the background and colour additions.

### IN-107: "Open authored world" is always offered although its scene is not generated by `pnpm dev`

**File:** `src/runtime/nativeSliceDebug.ts:56-58,65-76`
**Issue:** `public/scene/` is gitignored and only `pnpm generate:editor` writes it (NOED-02). In this checkout `public/scene` does not exist. The button is enabled whenever the current route differs, so it leads to a load failure on a clean checkout, or to a stale scene from an earlier generate.
**Fix:** Probe `HEAD /scene/native-world.babylon` once and disable the button with a "run pnpm generate:editor" hint when it is missing.

### IN-108: Authored route assigns `activeCamera` without a guard

**File:** `src/scene/authoredNativeWorld.ts:23`
**Issue:** `scene.activeCamera = scene.getCameraByName("World camera")` accepts `null` from a decoded scene file (a trust boundary). The removed reference-route code validated the camera type, while this path only fails later with Babylon's generic "No camera defined".
**Fix:** `const camera = scene.getCameraByName("World camera"); if (!(camera instanceof ArcRotateCamera)) throw new Error("The authored native scene has no World camera."); scene.activeCamera = camera;`

### IN-109: Non-portable `file:` path in package.json

**File:** `package.json:77`
**Issue:** `"file:tools\\editor-webgpu-compat"` uses a Windows backslash, which pnpm on POSIX treats as part of the directory name.
**Fix:** `"file:tools/editor-webgpu-compat"`.

### IN-110: Reference route leftovers (reference route)

**File:** `src/runtime/createWorldRuntime.ts:61,87,103`, `src/scene/world/loadImportedWorld.ts:60,68`, `src/world/MockWorldAdapter.ts:73-90`, `src/ui/WorldInterface.ts:70-71,141-142`
**Issue:**
- `new Vector3(0, 0.5, 0)` duplicates `talkingIslandCameraOverrides.targetOffsetAboveSpawnPoint`.
- `WorldDiagnostics.snapshot().camera` is still typed `| null` although it is always set now.
- `isViteIndexHtmlFallback` duplicates `readNativeCatalog`'s `htmlFallbackPage`.
- `JSON.parse(content)` on the staging receipt is unguarded at a trust boundary.
- The `spawn` and `teleport-local` commands and their HUD buttons serve only `MockWorldAdapter` and become dead with the route.
**Fix:** Delete them together with the reference route. Until then, reuse the shared constant and the HTML-fallback check.

### IN-111: Formatting slip in the adapter contract

**File:** `src/world/GameWorldAdapter.ts:8`
**Issue:** `dispose(): void;}` puts the closing brace on the member line of the single trust-boundary interface.
**Fix:** Put the closing brace on its own line.

---

_Reviewed: 2026-11-08T09:36:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_


# Phase 1: Code review report, part B (TypeScript tests)

**Reviewed:** 2026-11-08T09:35:00Z
**Depth:** standard
**Files reviewed:** 75 (the config list has 78 entries; three of them are files the diff renamed, so they are reviewed at their new paths)
**Status:** issues_found

### Summary

I read every listed Vitest, Playwright, fixture and support file in full and diffed the phase changes against `2d29a34`. For each claim I checked the source module it depends on: `readAssetPackage.ts`, `nativeSandboxConfiguration.ts`, `lanes.json`, `DECISIONS.md`, `.gitignore`, `src/editor/*`, `defaultEntryImportGraph.test.ts` and plan 01-09. I ran no builds, dev servers or test suites.

Main concerns:
- The dev cold-start spec passes even when the world never loads, so its "no Editor tools" claim can be vacuous.
- A phase-edited describe title still carries the forbidden external workspace name.
- The editor-independence guard is weaker than plan 01-09 specified, and an Editor-path module is already tested in the default unit suite.
- The asset contract rejection cases match a message fragment that almost every package error shares, and they have no positive control.
- There are sleep-based negative checks in WebGPU device-loss and in character cancellation.
- Two default unit test files crash, rather than skip, on any checkout without the gitignored store or artifacts. Lanes are such checkouts.
- AGENTS.md is violated in phase-touched files: `any`, comments, and a 910-line test file.

### Critical issues

### CR-201: Dev cold-start spec passes when the world never becomes ready

**File:** `tests/startup/devStartup.spec.ts:28-29, 48, 53`
**Issue:** `waitFor(...).then(() => Date.now(), () => null)` swallows the 240 s ready timeout and turns it into `millisecondsToReady: null`. The only assertion is `editorToolsRequestCount === 0` (line 53). Suppose startup throws before the runtime or its dynamic imports are requested: a broken module, a failed catalog, or a missing store. Then no Editor request is made and the test passes. So the NOED evidence "dev cold start requests no Editor tools" can come from a client that never loaded. `failedRequests` is recorded (line 48) but never asserted, so failed module downloads also pass silently.
**Fix:**
```ts
await page.locator('body[data-world-state="ready"]').waitFor({ timeout: readyBudgetMilliseconds });
const readyAtMilliseconds = Date.now();
...
await testInfo.attach(...);
expect(measurement.failedRequests).toEqual([]);
expect(measurement.millisecondsToReady).not.toBeNull();
expect(measurement.editorToolsRequestCount).toBe(0);
```
If a null-ready measurement must still be written for diagnostics, write it in a `finally` block and keep the ready assertion.

### CR-202: Phase-edited describe title contains the forbidden external workspace name (reference route)

**File:** `tests/unit/nativeOrProceduralCharacter.test.ts:13`
**Issue:** This phase rewrote the describe title ("courtyard" became "default route"), and the rewritten line kept the external workspace name that the run rules forbid in any repo file. The owner's `git grep -I -i -n -E ...` check from the run rules (section "Self-contained repo wording") matches this line, so the check is not empty for text this phase wrote. The test covers the default route's Human characters, which is the reference route.
**Fix:** Rename the title to something like `describe("default route Human characters use native packages, never the externally adapted GLBs", ...)`. Then re-run the owner's grep over `tests/`. The test goes away with the reference route on the deletion branch, and the title must not survive a merge either.

### Warnings

### WR-201: Editor-independence guard misses `src/editor/` and authored-world markers, and the default suite already tests an Editor module

**File:** `tests/unit/editorIndependence.test.ts:15`, `tests/unit/nativeSliceRuntime.test.ts:13, 155`
**Issue:** Plan 01-09 Task 2 requires the scan to reject any `tests/unit` file that contains `src/editor/` or `authoredNativeWorld`. `editorReferenceMarkers` lists only the three package names and `src/scripts"`. Because of that gap, `tests/unit/nativeSliceRuntime.test.ts` imports `../../src/editor/authoredNativeWorldSource` (line 13) and drives it (line 155) inside `pnpm test:unit`. `defaultEntryImportGraph.test.ts:7-8` classifies both `src/editor/` and `loadAuthoredNativeSection.ts`, which that module imports, as Editor modules. This contradicts the plan's must-have that "pnpm test:unit runs no Editor-path test".
**Fix:** Add `"src/editor/"` and `"authoredNativeWorld"` to `editorReferenceMarkers`. Move the authored-world cases of `nativeSliceRuntime.test.ts` (`createSavedAuthoredWorld` and every test that sets `worldSource = authoredNativeWorldSource`) into a new `tests/editor/authoredNativeSliceRuntime.test.ts`.

### WR-202: Asset contract rejection cases accept any asset.json error, with no positive control

**File:** `tests/unit/assetPackageContract.test.ts:40-47, 81-90`
**Issue:** All six "rejects %s" cases assert `rejects.toThrow(/asset\.json/)`. In `readAssetPackage.ts`, nearly every failure contains that fragment, including "The package needs a root asset.json smaller than 1 MiB." (line 123) and "asset.json has an invalid file inventory." (line 112). No case shows that `repackedWithManifest(path, () => {})` is accepted. If the repack helper breaks, for example by dropping `coordinates` incorrectly or producing a bad stored ZIP, every rejection case still passes for the wrong reason.
**Fix:** Add `await expect(readAssetPackage(await repackedWithManifest(path, () => {}))).resolves.toBeDefined()` for each fixture. Give each row the exact expected message, for example `"asset.json v2 model needs coordinates in metres, right-handed, Y up, with a 16-number source transform."` for the left-handed and missing-coordinates rows, and assert `rejects.toThrow(expectedMessage)`.

### WR-203: Device-loss negative check relies on a 100 ms sleep

**File:** `tests/browser/webgpu.spec.ts:106-107` (also `:56`)
**Issue:** `await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))` followed by `expect(devices).toBe(1)` treats "no second device within 100 ms" as "the disposed world is never revived". A revival that runs after 100 ms (a deferred reload or a retry timer) passes. This is the sleep-based pattern AGENTS.md forbids. Line 56 adds a `setTimeout(0)` macrotask flush inside `graphicsSnapshot`.
**Fix:** Assert an observable terminal state instead of elapsed time. Record every `requestDevice` call and the runtime state in the probe, wait with `expect.poll` for the error UI and `window.__nativeSlice === undefined` (or a disposed world snapshot), then assert `devices === 1`. Drop the `setTimeout(0)`: `onSubmittedWorkDone()` already orders the read after the submitted work.

### WR-204: Cancellation test asserts absence after a 10 ms sleep (reference route)

**File:** `tests/unit/nativeOrProceduralCharacter.test.ts:83`
**Issue:** `resolve(await set()); await new Promise(done => setTimeout(done, 10));` then asserts that the procedural factory was never called and the scene is empty. A late continuation that runs after 10 ms passes. It is a sleep standing in for a deterministic completion signal.
**Fix:** Have the factory expose its settle promise, or await the appearance promise chain the visual consumed (`await appearances.then(() => undefined)` followed by `await visual.ready.catch(() => undefined)`), then assert. Alternatively use `vi.useFakeTimers()` with `await vi.runAllTimersAsync()`.

### WR-205: Default unit tests crash, rather than skip, without gitignored artifacts or the staged store

**File:** `tests/unit/nativeEffectComponents.test.ts:7-8`, `tests/unit/nativePowerStrikeSource.test.ts:15-18`
**Issue:** `nativeEffectComponents.test.ts` runs a top-level `await readFile(...)` under `artifacts/native-parity/research/...`, and `artifacts/` is gitignored (`.gitignore:33`). `nativePowerStrikeSource.test.ts` reads `public/l2/...` in `beforeAll`, and `public/l2/` is gitignored (`.gitignore:41`). On a lane checkout or any clean clone, `pnpm test:unit` fails on these files instead of reporting a skip. `nativeCatalogIndex.test.ts:119` already uses `describe.skipIf(!existsSync(...))` for the same situation.
**Fix:** Gate both with `describe.skipIf(!existsSync(requiredPath))` and move the top-level `await readFile` into a `beforeAll` inside the gated describe. Better still, pin the needed bytes as golden fixtures under `tests/fixtures/golden/` with a `fixtures.lock.json` row, as `assetPackageContract.test.ts` does.

### WR-206: `any` in phase-touched test files

**File:** `tests/unit/nativeEffectComponents.test.ts:15`, `tests/unit/nativePowerStrikeSource.test.ts:33, 128-133`
**Issue:** AGENTS.md says "TypeScript strict, no `any`". Both files were edited in this phase. `type Json = Record<string, any>` and `edit: (value: any) => void` with six `(v: any) =>` mutators remain.
**Fix:** Type the decoded sidecar as `unknown` and narrow it, or declare a minimal interface, for example `interface AnimationSourceSidecar { parts: { animationSet: string; clips: { name: string; sourceDurationSeconds: number; sourceMotionSha256: string }[] }[] }`, and use `edit: (sidecar: AnimationSourceSidecar) => void`. For `Json`, use `Record<string, unknown>` and narrow at the use sites.

### WR-207: nativeSliceRuntime.test.ts is 910 lines and mixes concerns

**File:** `tests/unit/nativeSliceRuntime.test.ts:1-910`
**Issue:** AGENTS.md says to split any file that grows past about 400 lines or mixes concerns. This phase changed 167 lines here. The file mixes catalog world startup, authored saved-world handling (an Editor-path concern, see WR-201), flame replay, sheet variables, cancellation and audio.
**Fix:** Split by responsibility, for example `nativeSliceRuntimeStartup.test.ts`, `nativeSliceRuntimeCancellation.test.ts`, `nativeSliceRuntimeFlames.test.ts`, `nativeSliceRuntimeSheet.test.ts` and `tests/editor/authoredNativeSliceRuntime.test.ts`. Put the shared `boundaries` mocks in a `tests/unit/support/nativeSliceRuntimeHarness.ts`.

### WR-208: Comments left in a phase-touched file

**File:** `tests/unit/assetPackage.test.ts:65, 69`
**Issue:** This phase edited the file (line 13 now uses `fixture.readManifest`). AGENTS.md: "When you touch a file, remove every comment in the whole file". The trailing comments `// Babylon 9.27.1 global reset regression.` and `// Safe after repeated replace/close cleanup.` remain.
**Fix:** Delete both comments and move their meaning into the test names, for example `it("keeps Effect.prototype.setMatrix after the Babylon 9.27.1 global reset", ...)` and `it("restores world precision safely after repeated replace and close", ...)`.

### WR-209: Impossible-state guard - conditional flame-clock assertion

**File:** `tests/browser/nativeFlame.spec.ts:38-39`
**Category:** necessity
**Issue:** `if (textureRate > 0 && fadeRate > 0) expect(...)` guards on values the test imports from the typed constant `nativeSandboxConfiguration`. Both are `1` (`src/runtime/nativeSandboxConfiguration.ts:41-42`), so the guard always holds. It defends against nothing today. If someone changes a rate to `0`, the clock-synchronization check silently disappears and the test still passes.
**Fix:** Remove the `if` and assert unconditionally. If a zero rate ever becomes valid, add a separate explicit test for that configuration.

### WR-210: Lane and decision invariants are stale against current decisions

**File:** `tests/unit/laneOwnership.test.ts:237, 65`
**Issue:** The required decision IDs stop at `DEC-OWN-9` (`Array.from({ length: 9 }, ...)`), but DEC-OWN-10 is a current decision (`DECISIONS.md:29`, `.planning/PROJECT.md:71`, and AGENTS.md cites "DEC-OWN-1 to DEC-OWN-10"). Deleting its DECISIONS.md line would not fail the test. Separately, `writerFileNamePattern` and the `assets:`/`world:stage` filter leave out the preview scripts, which AGENTS.md lists among the main-store writers lanes must not run (`preview:private`, which runs `scripts/private-preview.mjs`). So their integration-lane ownership is not enforced.
**Fix:** Use `{ length: 10 }`, or derive the required IDs from `.planning/PROJECT.md` with a `/DEC-OWN-\d+/g` scan. Extend the writer selection with `name.startsWith("preview")` package scripts and their script paths.

### Info

### IN-201: Comments and `any` remain in the moved Editor tests

**File:** `tests/editor/authoredNativeSection.test.ts:72-73, 140`, `tests/editor/editorAuthoredMaterials.test.ts:77-78, 95-96`, `tests/editor/editorGeometryCompat.test.ts:40-42`, `tests/editor/editorWebgpuCompat.test.ts:21, 110`, `tests/editor/nativeEditorBspAppend.test.ts:13`, `tests/editor/nativeEditorPlacementAppend.test.ts:7, 64, 118`, `tests/editor/nativeEditorScene.test.ts:23-24`, `tests/editor/nativeEditorTerrainAppend.test.ts:104`
**Issue:** The plan treated a pure move as not touching content, but AGENTS.md says "No comments in code. Ever." `nativeEditorTerrainAppend.test.ts:104` also takes `receipt: any`.
**Fix:** Clear them on the next edit of each file: rename tests or helpers to carry the explanation, and type the receipt.

### IN-202: The same fake Editor geometry helper is pasted in four files

**File:** `tests/editor/nativeEditorScene.test.ts:25-37`, `tests/editor/nativeEditorBspAppend.test.ts:14-22`, `tests/editor/nativeEditorModelAppend.test.ts:13-21`, `tests/editor/nativeEditorTerrainAppend.test.ts:15-22`
**Issue:** Near-identical `fixtureHelper` source strings and `app.asar` detection appear in four places (one variant adds `uv2s`), which breaks the DRY rule.
**Fix:** Move them to `tests/editor/support/editorGeometryHelperFixture.ts`, exporting `installedEditorGeometryHelperOptions()`.

### IN-203: The staged section lookup is repeated across browser specs

**File:** `tests/browser/stagedNativeTerrainPath.ts:5-8`, `tests/browser/nativeReveal.spec.ts:46-50`, `tests/browser/nativeBsp.spec.ts:6-8`, `tests/browser/webgpu.spec.ts:114-117`
**Issue:** Each file re-reads `public/l2/catalog.json`, finds `map-20-20-section` and parses its manifest in its own way.
**Fix:** Export `readStagedNativeSection(): { record, manifest }` from the existing `stagedNativeTerrainPath.ts` (renamed, for example, to `stagedNativeSection.ts`) and reuse it.

### IN-204: Unsourced numeric expectations in browser specs

**File:** `tests/browser/nativeSlice.spec.ts:155-156`, `tests/browser/nativeFlame.spec.ts:28-32`, `tests/browser/nativeBsp.spec.ts:29, 34`
**Issue:** Musveren idle bounds (`-.11751600205898288`, `.2797630667686462`), flame counts (`12/24/17`, `62/157`) and wall bounds (`103.8`, `944.5`, `950`) are literals with no recorded source. `webgpu.spec.ts:120-151` derives the same flame counts from the staged manifest. The wall range duplicates the oracle's `allowedContactRegion.historicalWallRangeZ`.
**Fix:** Derive the counts from the staged manifest, as `webgpu.spec.ts` does, and read the wall range from `contactOracle.allowedContactRegion`. Read the Musveren bounds from a pinned evidence file whose path and hash are named in the test.

### IN-205: Phone contexts collect no page errors

**File:** `tests/browser/assetPackage.spec.ts:139-144, 255-261`
**Issue:** `openLandscapePhonePage` opens a fresh context without `pageerror` or `console` listeners, so landscape-phone runtime errors do not fail the evidence checks.
**Fix:** Attach the same error collector inside `openLandscapePhonePage` and assert that it is empty before closing the context.

### IN-206: Portrait run writes an evidence screenshot

**File:** `tests/browser/loadingPanel.spec.ts:13, 50`
**Issue:** The viewport loop includes `portrait` and saves `portrait-loading.png` into the evidence folder. DEC-OWN-9 keeps portrait as a horizontal-scroll check only.
**Fix:** Keep the portrait layout and scroll assertions, but skip the screenshot when `name === "portrait"`.

### IN-207: Native evidence checks fall back to unvalidated archives

**File:** `tests/browser/assetPackage.spec.ts:15-27, 187-188`
**Issue:** When `conversion-validation.json` lacks the entry, `nativePackage()` scans `artifacts/native-assets` for any matching `asset.json`. The assembled-character test also falls back to two hard-coded hash paths. Either way, the "actual native conversion" evidence can come from a package that never passed validation.
**Fix:** Use only `validatedNativePackage(...)`, plus the explicit environment overrides, and skip with a clear reason otherwise.

### IN-208: Disposal tests count microtasks

**File:** `tests/unit/environmentRouting.test.ts:61, 74`
**Issue:** `await Promise.resolve(); await Promise.resolve();` depends on the exact await depth inside `loadEnvironment`. Adding one more `await` makes the test fail falsely.
**Fix:** Use `await vi.waitFor(() => expect(lateStop).toHaveBeenCalledTimes(1))`.

### IN-209: Legacy reference readiness poll waits out its timeout on a reported failure

**File:** `tests/browser/terrainLegacyReference.spec.ts:9`
**Issue:** `state?.failure ?? state?.ready ?? false` returns the failure string. `toBe(true)` then keeps polling for the full 60 s before it reports.
**Fix:** Poll `state?.failure !== null || state?.ready === true`, then assert `failure` is `null`.

### IN-210: "Cold start" measurement keeps the Vite dependency cache

**File:** `tests/startup/devStartup.spec.ts:14`, `playwright.startup.config.ts:12`
**Issue:** A fresh server is started (`reuseExistingServer: false`), but `node_modules/.vite` persists between runs, so the measurement is a warm-cache start. That matters when results are compared against the DATABASE-PC baseline.
**Fix:** Either start Vite with `--force` for the measurement run, or label the measurement as a warm dependency cache in the attached JSON.

---

_Reviewed: 2026-11-08T09:35:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_


# Phase 1: Code review report (part C, pipeline and tooling scripts)

**Reviewed:** 2026-11-08T09:34:00Z
**Depth:** standard
**Files reviewed:** 56
**Status:** issues_found

### Summary

Scope: the Python and Node pipeline and tooling scripts plus the pytest pipeline tests changed between `2d29a34` and `HEAD`. Most of the review time went to the FOUND-03 reference-client guard (`reference_client_guard.py`), the tree hasher and lock builder, and the per-file `require_equal_file` bindings in the converters.

The guard core works for the spelling it was tested with. It does per-file class lookup, does a stat-first check and re-hashes on a size or mtime change, and refuses the whole root when `Engine.dll` is stale. The comment cleanup and renames left no stale references; I checked that every renamed symbol the tests import still exists. The problems:

- The guard only engages when the root string equals `E:/Lineage2-client` after `resolve()`. Any other spelling of the same tree skips the lock completely (CR-301).
- One `--client` entry point still reads, decodes and runs UModel on E: packages with no per-file lock check. The scan test does not notice, because it only checks that the guard name is called somewhere (CR-302, WR-310).
- The lock builder accepts any two manifests without checking which host or root they came from (WR-301).
- Every converted asset gets the lock's Interlude build identity stamped on it, whatever root it was converted from (WR-302).
- A few smaller problems in error handling, provenance and DRY.

I ran no repo scripts and no test suites. Two small probe scripts outside the repository confirmed how Python resolves Windows paths (CR-301) and how the closure re-raise fails (WR-304). The necessity rubric was read and applied.

### Critical issues

### CR-301: The reference-client guard fails open for any other spelling of the E: tree (UNC, admin share, `\\?\` prefix, mapped drive)

**File:** `scripts/reference_client_guard.py:96-102`
**Issue:** `require_reference_client` requires the lock only when `str(Path(root).resolve()).casefold()` equals `str(Path('E:/Lineage2-client').resolve()).casefold()`. Any root that fails that one string comparison gets `ReferenceClientAccess(resolved_root, None)`, which confines paths but has `requires_lock = False`. So `require_equal_file` never checks the lock class or staleness for it. On Windows, `Path.resolve()` does not normalise these spellings to the drive-letter form. A probe on this machine (Python 3.11.9) shows `\\?\C:\Windows`, `\\localhost\C$\Windows` and `\\127.0.0.1\C$\Windows` all resolve to themselves, unchanged. So `--client \\DATABASE-PC\E$\Lineage2-client`, a mapped network drive letter, `\\localhost\E$\Lineage2-client` or `\\?\E:\Lineage2-client` read the same bytes with no lock at all: differing, e-only and volatile files are all accepted. In this multi-machine setup a mapped share is a realistic way to point a converter at DATABASE-PC's tree. FOUND-03 depends on this guard alone, so the allowlist has to fail closed.
**Fix:** Compare file identity, not strings, and fail closed for unknown roots that hold the conversion tree's `Engine.dll`:
```python
def same_directory(first, second):
    try:
        return os.path.samefile(first, second)
    except OSError:
        return False

def is_conversion_root(resolved_root, resolved_conversion_root):
    if str(resolved_root).startswith('\\\\'):
        raise ReferenceClientLockError(f'reference client root must be a local drive path, not UNC or device path: {resolved_root}')
    return str(resolved_root).casefold() == str(resolved_conversion_root).casefold() or same_directory(resolved_root, resolved_conversion_root)
```
Use `is_conversion_root(...)` in place of the string comparison on line 98. Also refuse a non-conversion root whose `system/Engine.dll` hash equals the lock's `eSha256` while its lock class is not proven, or require such roots to be listed in an explicit snapshot allowlist. Add tests in `tests/pipeline/test_reference_client_guard.py` for a UNC or `\\?\` spelling of the synthetic conversion root.

### CR-302: `native_catalog/cli.py --package` reads, decodes and runs UModel on E: packages without a per-file lock check

**File:** `scripts/native_catalog/cli.py:128-176` (read at 129 and 158, UModel at 135)
**Issue:** `main` calls `require_reference_client(args.client)` once (line 219). That only proves the lock exists and `Engine.dll` is equal. `catalog_package` then resolves the requested package with `within(client, relative)` (line 129), runs UModel `-list` on it with `-path=<client>` (line 135), decodes it with `Package(source.read_bytes(), ...)` (line 158), and writes `package-index.json` and `animation-events.json` derived from its bytes. It never calls `require_equal_file`. The default `--client` is `E:/lineage2-client` (line 208). So `--package animations/<a differing or e-only package>` produces source-derived artifacts from a file the lock marks as not equal. That is the read FOUND-03 and PORT_SCOPE section 2 forbid ("Converters read an E: file only when ... lists it equal"). The table path in the same CLI is guarded (through `tables.table_source_path`), so this gap is specific to packages. `tests/pipeline/test_client_entry_points.py` passes anyway (see WR-310).
**Fix:** Route the package through the guard and check the UModel import closure the same way `Converter.run` does:
```python
def catalog_package(client_access, client, relative, destination, umodel):
    source = client_access.require_equal_file(relative)
    if source.suffix.lower() not in NATIVE:
        raise FormatError('--package requires an original native package')
    ...
```
Pass `client_access = require_reference_client(client)` from `main`. Before running UModel, call `require_lock_equal_import_closure` (from `native_assets_lib/umodel_import_closure.py`) with a loader backed by `client_access`. Add a test in the `PerFileReaderBindingTests` style that refuses a differing package.

### Warnings

### WR-301: The lock builder never checks that the two manifests come from the expected hosts and roots, or from two different trees

**File:** `scripts/build_reference_client_lock.py:119-123, 148-155`
**Issue:** `classify_reference_client_trees` checks the schema, field types, sorting and paths of each manifest. It never compares `manifest['host']` or `manifest['root']` with `REFERENCE_HOST`/`REFERENCE_ROOT` (`IMPORTA-PC`, `C:/Lineage2-client`) or `CONVERSION_HOST`/`CONVERSION_ROOT`. Yet it writes those constants into the lock as if they were proven (lines 150-153). Passing the E: manifest twice (`--importa-manifest e.json --e-manifest e.json`) gives a lock where every file is `equal`. That certifies the conversion tree against itself, and the guard then accepts every file. Swapped manifests are also accepted silently. This is the trust boundary for the whole FOUND-03 proof.
**Fix:**
```python
def require_manifest_origin(manifest, side, expected_host, expected_root):
    if manifest['host'] != expected_host or manifest['root'].replace('\\', '/').rstrip('/').casefold() != expected_root.casefold():
        raise ReferenceClientManifestError(f'{side} manifest was hashed on {manifest["host"]} at {manifest["root"]}, expected {expected_host} at {expected_root}')
```
Call it for both sides in `classify_reference_client_trees`, and add a test for the duplicated-manifest and swapped-manifest cases.

### WR-302: `Converter.convert` stamps the lock's Interlude `clientBuild` on assets from any client root

**File:** `scripts/native_assets.py:688`, `scripts/native_assets_lib/asset_manifest.py:37-51`
**Issue:** Every asset.json v2 gets `clientBuild = reference_client_build(REFERENCE_CLIENT_LOCK_PATH)`, which is the lock's `Engine.dll` SHA-256 and the lock hash. That happens whatever `self.client` is. For a root other than E:, `require_reference_client` does not compare that root's `system/Engine.dll` to anything, so a package converted from an unrelated client or a partial snapshot is labelled with the reference build. `tests/pipeline/test_native_assets_manifest_v2.py:57-73` shows this: it converts from a temp client with no `Engine.dll` and gets a full `clientBuild`. That is recorded provenance that was never measured.
**Fix:** Derive `engineDllSha256` from the converted root. Hash `self.client / 'system/Engine.dll'` through `self.reference_client.require_equal_file`, compare it with the lock's `importaSha256`, and refuse (or record `clientBuild` as unresolved) when the file is missing or differs. Update the test so the synthetic client carries a matching `system/Engine.dll`, and add a refusal case.

### WR-303: Verify and geometry paths read and decode client files with no per-file lock check

**File:** `scripts/native_map_geometry.py:595`, `scripts/native_map.py:420-424`, `scripts/native_map_overlap.py:41-57` (used at 331-332, 341-344, 394-395)
**Issue:** `build_geometry` decodes the map with `Package(safe_path(client, raw_manifest['recipe']['map']).read_bytes(), ...)`, which bypasses `MapSources.get`. `verify_map` and `native_map_overlap.verify_file` hash client files straight from receipt and provenance tables. The only proof of equality is a hash in a retained local receipt. Receipts written before this phase (before `MapSources.get` gained `require_equal_file`) were never lock-checked, so a receipt made from a differing E: file verifies and is then decoded again. STATE.md says "MapSources.get carries the per-file require_equal_file check for every map package reader", but these readers sidestep it.
**Fix:** Pass the `ReferenceClientAccess` into `verify_map`, `verify_file` and `build_geometry`. Replace `safe_path(client, relative)` for client-side reads with `client_access.require_equal_file(relative)`, keeping `safe_path` for output roots. In `build_geometry`, use `MapSources(client).get(raw_manifest['recipe']['map'])`.

### WR-304: The import-closure re-raise crashes with `TypeError` for `UnicodeDecodeError` and other ValueError subclasses

**File:** `scripts/native_assets_lib/umodel_import_closure.py:17-20`
**Issue:** `raise type(error)(f'UModel would read ...')` assumes every `ValueError` subclass takes one message argument. `native_catalog/ue2.py:78` decodes package names with `raw.decode('cp1252')`, which raises `UnicodeDecodeError` on bytes 0x81/0x8D/0x8F/0x90/0x9D (and on unpaired UTF-16 surrogates). `UnicodeDecodeError('msg')` raises `TypeError: function takes exactly 5 arguments (1 given)`, which I confirmed with a probe. The real cause is lost, and callers that catch `ValueError` (for example `native_assets.main`) do not catch the `TypeError`.
**Fix:** Wrap in one owned error type and keep the guard's error class distinct:
```python
class UModelImportClosureError(ValueError):
    pass
...
        except ReferenceClientLockError as error:
            raise ReferenceClientLockError(f'UModel would read {package_name} while converting {root_package_name}: {error}') from error
        except ValueError as error:
            raise UModelImportClosureError(f'UModel would read {package_name} while converting {root_package_name}: {error}') from error
```

### WR-305: The DAT inventory turns a stale-lock error into a "not equal to IMPORTA-PC" row instead of stopping

**File:** `scripts/build_dat_table_inventory.py:116-119`
**Issue:** `count_local_decoded_table` catches every `ReferenceClientLockError` and records `status: 'E: copy not equal to IMPORTA-PC'`. The guard also raises that error for "reference client lock is stale for ...; re-lock ordered" (an equal file whose bytes changed since the lock) and for path confinement failures. A stale lock should stop the run, but here it becomes a committed inventory row that claims a lock class the lock does not record.
**Fix:** Decide from the lock record, not the exception. Look up `lock['files']` for `system/<file>`. Write the "not equal" row only when its class is not `equal`, and let any other `ReferenceClientLockError` propagate to `main`.

### WR-306: The DAT inventory `countSource` always names `E:/Lineage2-client/`, whatever `--client` was read

**File:** `scripts/build_dat_table_inventory.py:44, 121, 183`
**Issue:** `LOCAL_DECODE_COUNT_SOURCE` hard-codes `'... on lock-equal E:/Lineage2-client/'`, and line 121 appends it to every decoded count. `--client` is a free argument (line 183). Run against an IMPORTA-PC snapshot or any other root, which the guard does not lock-check, the output still says the counts came from lock-equal E:. AGENTS.md requires every value to record its real source.
**Fix:** Build the source from the access actually used, for example `f'scripts/native_catalog/tables.py decode_table on {client_access.root.as_posix()}/system/{row["file"]}'`, plus `' (lock-equal)'` only when `client_access.requires_lock`.

### WR-307: Three readers of the reference lock apply three different levels of validation, and the field list is defined three times

**File:** `scripts/reference_client_guard.py:10, 35-51`; `scripts/native_assets_lib/asset_manifest.py:11, 37-51`; `scripts/build_dat_table_inventory.py:87-95, 189`; `scripts/build_reference_client_lock.py:20`; `scripts/generate_golden_fixtures.py:25`
**Issue:** The guard checks `schemaVersion`, `fileFields` and casefold uniqueness. `reference_client_build` checks neither `schemaVersion` nor that `fileFields` is the expected list. It zips whatever field list the file declares, so a reordered `fileFields` silently yields the wrong column as `importaSha256`. `build_dat_table_inventory.main` parses the lock raw again and indexes `values[2]` by position, and a malformed lock raises `KeyError`/`TypeError` there, which `main`'s `except (OSError, ValueError)` does not catch. The six-field list exists in three files, and the `system/Engine.dll` path in two. This breaks the AGENTS.md one-owner rule at a trust boundary.
**Fix:** Make `reference_client_guard.read_reference_client_lock` the only parser, returning the validated document and records. Have `reference_client_build` and `build_dat_table_inventory` call it and index records by field name. Import `REFERENCE_CLIENT_LOCK_FILE_FIELDS` and `ENGINE_LIBRARY_RELATIVE_PATH` from the guard in the builder, `asset_manifest.py` and `generate_golden_fixtures.py`.

### WR-308: The lane ownership check misses renames out of another lane's paths

**File:** `scripts/check-lane-ownership.mjs:132-135`
**Issue:** `git diff --name-only base...HEAD` uses rename detection by default (`diff.renames`), so a rename lists only the destination path. A lane that moves a file owned by another lane into its own `owns` tree shows no foreign path, even though it deleted a file it does not own. The ownership gate is the only automated lane boundary check.
**Fix:** Use `["diff", "--name-only", "--no-renames", "-z", `${baseReference}...HEAD`]` and split on `"\0"`. With `--no-renames`, the deleted source path is listed too, and `-z` avoids `core.quotePath` quoting for non-ASCII paths. Add a unit test with a renamed path.

### WR-309: Tool and schema paths hard-coded to a workspace outside this repository, in four touched files

**File:** `scripts/native_assets.py:31`, `scripts/native_catalog/cli.py:17`, `scripts/native_catalog/effects.py:13`, `scripts/native_catalog/tables.py:12-13`
**Issue:** These files were edited in this phase but still default `UMODEL`, `UELIB`, `SCHEMA_ROOT` and `CRYPTO_SOURCE` to absolute paths inside sibling workspaces outside this repository. The repository's own self-contained wording check (the `git grep` named in the run rules) is therefore non-empty on these exact lines. The paths do not exist on PROMINENCE-PC, and `native_assets.UMODEL` and `effects.UELIB` cannot be overridden by environment variable, unlike their neighbours.
**Fix:** Move the pinned tool locations into one recipe (for example `recipes/native-tools.json` holding path and SHA-256), read them through one helper with an environment override, and delete the four literal paths. The SHA-256 pins stay where they are.

### WR-310: The entry-point scan test passes for scripts that read E: files without the per-file guard

**File:** `tests/pipeline/test_client_entry_points.py:53-55, 79-80`
**Issue:** `calls_reference_client_guard` passes if the module calls a function named `require_reference_client` anywhere, with any argument. It does not check that the call guards the parsed `--client` value, or that reads go through `require_equal_file`. CR-302 (`native_catalog/cli.py`) and WR-303 pass the scan, yet STATE.md cites this test as the proof that "all 23 call it". The test gives false assurance for the requirement it is cited for.
**Fix:** Make the static check stricter, or add a behavioural test. For each entry point, run its `main` against the synthetic `SyntheticReferenceClientTrees` conversion root with a request that touches `system/chargrp.dat` (differing), and assert `ReferenceClientLockError`. At minimum, assert that the guard's first argument is the `args.<client option>` attribute.

### Info

### IN-301: The burst check reads catalog-supplied manifest paths before validating them

**File:** `scripts/check-private-preview-burst.mjs:24-30`
**Issue:** `readDistFile(sectionRecord.manifest)` joins an unvalidated catalog string onto `dist/` and reads it. `nativeSectionResourcePaths` validates the hash-addressed form only afterwards, so a `manifest` of `/../../x` reads outside `dist/` before the error. The impact is low (local read, JSON parse only), but the order is backwards at a decoded-file boundary.
**Fix:** Validate `sectionRecord` (hash and `/l2/maps/<hash>/map-section-runtime/manifest.json` form) before reading, for example by exporting a `nativeSectionManifestPath(sectionRecord)` helper from `private-preview-targets.mjs`.

### IN-302: Module docstrings kept as argparse descriptions in 21 touched files, unlike the constant pattern used elsewhere in the phase

**File:** for example `scripts/build_reference_client_lock.py:1` (new in this phase), `scripts/export-native-map-audio.py:2-7`, `scripts/native_map_geometry.py:2`, `scripts/native_effects.py:1`
**Issue:** `native_assets.py` and `native_map_overlap.py` replaced `description=__doc__` with named constants (`CONVERTER_DESCRIPTION`, `OVERLAP_AUDIT_DESCRIPTION`), but 21 other touched scripts keep prose module docstrings. Some, like `export-native-map-audio.py`, include usage notes beyond help text. That is inconsistent with the AGENTS.md "no comments" cleanup applied to the rest of each file.
**Fix:** Apply the same named-description-constant pattern everywhere, or record the docstring-as-help exception in AGENTS.md.

### IN-303: Duplicated hashing and lock helpers

**File:** `scripts/hash_reference_client_tree.py:48-49, 91-92`; `scripts/build_reference_client_lock.py:29-38`; `scripts/native_assets_lib/gltf.py:20-21`; `scripts/reference_client_guard.py:20-27`
**Issue:** `canonical_json_bytes` is byte-for-byte `gltf.json_bytes`. `manifest_sort_key` is defined in both the hasher and the builder. `require_manifest_path` and `require_confined_relative_path` implement the same confinement rule with different messages. The hasher is pinned by `hashingScriptSha256`, so it may intentionally stand alone, but the builder and guard copies need one owner.
**Fix:** Keep the hasher self-contained (pinned), and have the builder import `manifest_sort_key` and `canonical_json_bytes` from it and the confinement check from the guard.

### IN-304: A directory-level read error aborts the tree hash with a traceback instead of an `unreadable` record

**File:** `scripts/hash_reference_client_tree.py:36-38, 106-109`
**Issue:** Per-file `OSError` becomes an `unreadable` row, but `os.scandir(directory)` and `entry.stat()` errors (for example `PermissionError` on a protected subfolder) propagate. `main` catches only `ValueError`, so the run ends in a raw traceback. That fails closed, but without the clear error that the per-file path gives.
**Fix:** Catch `OSError` around `os.scandir` and turn it into a `ValueError('Unreadable directory inside the reference tree: ...')` so `main` reports it cleanly.

### IN-305: The lane ownership type declarations claim fields the validator never checks, and `lanes.json` `branchPattern` is ignored

**File:** `scripts/check-lane-ownership.d.mts:1-12`, `scripts/check-lane-ownership.mjs:10, 29-57`
**Issue:** `validateLaneOwnership(ownership: unknown): LaneOwnership` returns `title`, `maximumParallelLanes` and `branchPattern` as typed, but never validates them. The script hard-codes `laneBranchPattern` and never reads `rules.branchPattern`, so the file field is a second, unused source of truth.
**Fix:** Validate the declared fields (or drop them from the type), and either derive the branch regex from `rules.branchPattern` or remove that key from `lanes.json`.

### IN-306: The tunnel script repeats the preview URL literal that `private-preview-targets.mjs` now owns

**File:** `scripts/private-preview-tunnel.ps1:79`
**Issue:** `'https://l2.kingdom.lv/?world=interlude'` duplicates `privatePreviewOrigin + privatePreviewWorldPath`. Both copies were edited in this phase, so they will drift again.
**Fix:** Have `private-preview.mjs` pass the URL to the tunnel script as a parameter, or read it from one shared JSON file that both runtimes can load.

### IN-307: Already-defended-elsewhere: duplicate guard call right before `Converter`

**File:** `scripts/native_assets.py:782-783`
**Category:** necessity
**Issue:** `main` calls `require_reference_client(args.client)` and on the next line constructs `Converter(args.client, ...)`, whose `__init__` (line 144) makes the same call before any read or write. Nothing runs between the two, so the first call guards nothing the second does not. It seems to exist only to satisfy the name scan in `test_client_entry_points.py` (see WR-310).
**Fix:** Drop line 782 once the entry-point test checks behaviour rather than call names.

---

_Reviewed: 2026-11-08T09:34:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_


## Iteration 2 re-review of the fix commits

The --auto loop re-reviewed only what the fix commits changed (17a358d..), in two parallel reviewers: TypeScript (IDs 4NN) and Python and Node (IDs 5NN). Nine new warnings and six info items; the warnings were fixed in iteration 2. No iteration 3 re-review was run (OVERNIGHT-DECISIONS row 47).


## Phase 1: Code review report (re-review, iteration 2, TypeScript side)

**Reviewed:** 2026-11-08T11:17:16Z
**Depth:** standard
**Files Reviewed:** 59
**Status:** issues_found

### Summary

Scope: the TypeScript files that the fix commits `17a358d..HEAD` changed. The Python and `.mjs` files go to a separate reviewer. I reviewed only the fix diffs and the code they call. Deliberately skipped findings (WR-106, WR-109, WR-110, WR-111, CR-202, WR-204, WR-209) and the original Info items are not re-reported.

What the fixes resolve, checked against source:
- CR-101: resolved. The speed is looked up per profile id, only the two human fighter ids get `ACIS_HUMAN_FIGHTER_SPEED`, and every other profile is marked `isSourced: false` with a visible "speed unresolved" readout. The card text is built from `adapter.speedProfile`, and no hardcoded "walk 80, run 115" text is left in `src/`.
- CR-102: resolved. `fighterIdle/Run/Attack/Death`, `playerClips`, `authored-override` and `alias.editorClip` no longer appear in `src` or `tests`. Every profile plays `playerProfile.clips`.
- WR-101: resolved. An ambiguous mesh now becomes a `not-in-catalog` entry. An index build failure falls back to `unavailableNativeCatalogIndex`, and the Sandbox tab shows a note.
- WR-102: partly resolved. See WR-401: the new acceptance check reports a valid no-op equip as rejected.
- WR-103: resolved in code and in the Vitest test. The Playwright check does not bite (WR-403).
- WR-104, WR-105, WR-107, WR-108: resolved. No leftover `failureMessage` or `loadNativeCatalog` export remains, and `pnpm dev` already binds `--host 127.0.0.1`, so the startup URL still matches.
- CR-201, WR-202, WR-203, WR-205, WR-206, WR-208, WR-210: resolved, and the assertions are not vacuous.
- WR-201: resolved for `tests/unit`. The new `tests/support` directory is not guarded (WR-402).
- WR-207: resolved. The case count reconciles: 54 original `it` declarations, of which 9 were world cases. Now there are 45 unique cases plus the 2 new sheet cases, and the 9 world cases are registered once for the source world (unit) and once for the authored world (editor).

Other checks: no comments remain in any touched TS file, and the wording grep is clean for every file in scope (the hits it does print are in files outside this scope and in the skipped CR-202). No `any` was introduced and no Lineage II value was invented.

### Warnings

### WR-401: Equipping the item already worn is reported as "equip rejected by the adapter"

**File:** `src/runtime/attachSandboxCommandSheet.ts:105-109` (with `src/world/sandboxCommands.ts:34` and `src/runtime/createNativeSliceRuntime.ts:137`)
**Issue:** The WR-102 fix counts an equip as accepted only when an `update` event arrives that carries the item in the slot. `entityWithEquippedItem` returns `null` when the slot already holds that item (`entity.equipment?.[command.slot] === (command.itemId ?? undefined)`), so the adapter emits nothing. On the default route, `leatherShirt: true` starts the player with item 22, which is the only converted upper item. Submitting 22 on the Sandbox tab therefore shows "item:22: equip rejected by the adapter" as a warning, even though the requested state holds. The unit fake in `tests/unit/sandboxCommandSheet.test.ts:45` always emits an `update`, and `tests/browser/sandbox.spec.ts:58` only equips 999999, so neither test can catch this.
**Fix:** Tell "no change" apart from "rejected". For example, have the sheet read the local player's current equipment before dispatch (pass `getInitialState`, or a `currentEquipment(slot)` accessor, through the context) and report "item:22 already equipped" when it already matches. Add a unit case where the fake adapter starts with item 22 equipped and emits no event.
```ts
const alreadyEquipped = context.equippedItemId(sandboxEquipmentSlot) === itemId;
if (alreadyEquipped) showResult(`${lastLookup.key}: already equipped`, "info");
else if (!accepted) showResult(`${lastLookup.key}: equip rejected by the adapter`, "warning");
```

### WR-402: The Editor-independence guard does not scan the new shared `tests/support` modules that the unit tests import

**File:** `tests/unit/editorIndependence.test.ts:42-50`
**Issue:** WR-201 moved the runtime harness and the shared world cases into `tests/support/nativeSliceRuntimeHarness.ts` and `tests/support/nativeSliceRuntimeWorldCases.ts`. Six default unit files import them. The guard only reads files under `tests/unit/`, so an `src/editor/` or `authoredNativeWorld` import added to either support module would run in the default `test:unit` suite with the guard still green. That is the regression WR-201 was meant to close.
**Fix:** Scan every `.ts` file under `tests/support/` as well, or better, the import closure of `tests/unit/**`:
```ts
const guardedTestDirectories = ["tests/unit/", "tests/support/"];
```
Add a bite proof: put an Editor marker into a support file temporarily and show that the test fails.

### WR-403: The WR-103 Playwright check uses an asset.json v1 fixture, so it passed before the fix too

**File:** `tests/browser/assetPackage.spec.ts:77-80`
**Issue:** The bug was that a v2 manifest has no `model.sourceUnitsPerMetre`. `assetFixture()` (`tests/fixtures/assetPackageFixture.ts:69-74`) builds a `schemaVersion: 1` model with `model.sourceUnitsPerMetre: 100`, and the pre-fix code read exactly that field. The new assertion `toContainText("Unit1 metre = 100 source units")` would therefore pass on the pre-fix `AssetImportPanel.ts`. The UI change has no Playwright check that covers the case it fixes (AGENTS.md: "UI changes also get a Playwright check").
**Fix:** Load a v2 model package in the spec, for example the pinned golden `model-v2.l2asset` used by `tests/unit/assetPackageContract.test.ts`, and assert its `coordinates.sourceUnitsPerMetre` row.

### WR-404: New UI copy file carries an em dash

**File:** `src/ui/assetSourceMetadataRows.ts:11` (also asserted in `tests/unit/assetSourceMetadataRows.test.ts:22`)
**Issue:** The fix created this file, and its "Viewer scale" value is `"1:1 — no size normalization"`. AGENTS.md says human-readable text, including UI copy, uses plain hyphens with no em or en dashes. Moving the string into a new file was the moment to fix it.
**Fix:**
```ts
...(manifest.model ? [["Viewer scale", "1:1 - no size normalization"] as const] : []),
```
Update the unit assertion to match.

### WR-405: The new catch-all rejection handler also swallows aborts, and no test covers an abort during the index build

**File:** `src/runtime/createNativeSliceRuntime.ts:75-80,85`
**Issue:** The WR-101 fix turns every rejection of `buildNativeCatalogIndex(..., signal)` into `unavailableNativeCatalogIndex`, including an `AbortError` from its `loadNativeNpcProfiles(..., signal)` fetch. Cancellation now depends only on the `validateLifetime()` call five lines later. The fix report says "Abort still propagates through validateLifetime", but none of the split runtime tests (`tests/unit/nativeSliceRuntimeCancellation.test.ts`) aborts while the index is building. If that call is ever moved, startup quietly continues on a cancelled signal, and nothing guards against it.
**Fix:** Re-throw aborts in the rejection handler (`if (signal.aborted) throw error;`), or call `validateLifetime()` at the start of the handler. Add a cancellation case where `readCatalog` resolves, the NPC profile fetch is pending, the signal aborts, and the test expects `rejects.toHaveProperty("name", "AbortError")`.

### Info

### IN-401: Double blank line left where `failureMessage` was deleted

**File:** `src/runtime/loadNativeSliceWorld.ts:69-70`
**Issue:** The deletion left two consecutive empty lines between `NativeSliceWorldOptions` and `prepareFlames`.
**Fix:** Remove one blank line.

### IN-402: The acceptance check assumes `dispatch` emits its events synchronously, but the adapter contract does not say so

**File:** `src/runtime/attachSandboxCommandSheet.ts:41-46`, `src/world/GameWorldAdapter.ts:6`
**Issue:** `dispatchAndObserveAcceptance` unsubscribes as soon as `dispatch` returns. `GameWorldAdapter.dispatch(command): void` promises no synchronous emission, so a server-backed adapter would get every spawn, equip and cast labelled "rejected". The fixer marked this for human verification. It is recorded here so the limitation stays visible.
**Fix:** When a server adapter lands, show the note when the matching event arrives, or on an explicit rejection event from the server, instead of inferring rejection when no event comes back.

### IN-403: An ambiguous mesh match is labelled `not-in-catalog` even though the packages are in the catalog

**File:** `src/assets/native/nativeCatalogIndex.ts:101-104`
**Issue:** The note reads "npc:21622 not in catalog: mesh ... matches 2 converted packages (...)", and the status contradicts the reason. The `unavailableNativeCatalogIndex` lookups (`:85-88`) have the same mismatch.
**Fix:** Consider a distinct lookup status such as `ambiguous` or `unavailable`, so callers and the sheet do not report converted packages as missing.

### IN-404: The readout for an unresolved speed shows a meaningless "walk speed for the first 0 s" clause

**File:** `src/ui/nativeLocomotionControls.ts:36-38`, `src/runtime/attachNativeSliceSheet.ts:119,272`
**Issue:** For unresolved profiles, `runStartSeconds` comes from `SYNTHETIC_SLICE_SPEED` (0). The readout then says "0.70 m/s (walk speed for the first 0 s), speed unresolved", and the sheet description says "a run starts at walk speed for 0 s".
**Fix:** Leave out the run-start clause when `isSourced` is false.

---

_Reviewed: 2026-11-08T11:17:16Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_


## Phase 1: Code review report (re-review, iteration 2)

**Reviewed:** 2026-11-08T13:30:00Z
**Depth:** standard
**Files reviewed:** 37
**Status:** issues_found

### Summary

Scope: only what commits `17a358d..HEAD` changed in the listed files. WR-309 and the original Info findings are excluded as instructed. I ran no repo scripts or test suites. Two read-only Python one-liners compared `recipes/reference-client-tree.lock.json` with `recipes/native-inputs.lock.json`, and a tokenizer pass scanned every touched `.py` file for comments and docstrings.

Fix status per original finding:

| Finding | Status | Evidence |
|---|---|---|
| CR-301 | Resolved | `scripts/reference_client_guard.py:71-74,118-123`: every root except the exact lock `referenceRoot` on the lock `referenceHost` now opens with `requires_lock=True` and checks `system/Engine.dll`. UNC, `\\?\`, admin-share and mapped spellings all fail closed. Tests at `tests/pipeline/test_reference_client_guard.py:128-183` cover this. |
| CR-302 | Resolved | `scripts/native_catalog/cli.py:129-145`: the package goes through `require_equal_file` and the full UModel import closure is checked before UModel runs. `tests/pipeline/test_native_catalog_package_lock.py` checks that UModel is not called and no output is written. |
| WR-301 | Resolved | `scripts/build_reference_client_lock.py:119-133`: host and normalised root are checked per side. Duplicated, swapped and foreign-host cases are tested. |
| WR-302 | Resolved | `scripts/native_assets.py:171-178`: `clientBuild` is stamped only after the converted root's own `system/Engine.dll` hashes to the lock's `importaSha256`. Missing and differing cases are tested. |
| WR-303 | Resolved in code, partly tested | `native_map.py:254-257,421-425,476`, `native_map_geometry.py:424,550,593`, `native_map_overlap.py:61-63,337,349,401`. See WR-504 for the untested overlap wiring. |
| WR-304 | Resolved | `scripts/native_assets_lib/umodel_import_closure.py:9-10,48-51`: one owned error type, cause kept, and the guard error class stays distinct. |
| WR-305 | Resolved | `scripts/build_dat_table_inventory.py:114-127`: the lock record decides the outcome, and other lock errors propagate to `main`. |
| WR-306 | Resolved | `scripts/build_dat_table_inventory.py:122-124`: the source names `client_access.root` and adds `lock-equal` only when the lock applied. |
| WR-307 | Resolved, one leftover constant | There is now one parser, `read_reference_client_lock`, and records are indexed by field name. The leftover duplicated lock path is IN-501. |
| WR-308 | Resolved | `scripts/check-lane-ownership.mjs:133-134` uses `--no-renames -z`. The new test would fail without either flag. |
| WR-310 | Partly resolved | The guard argument must now be the parsed option attribute. The "reads through the per-file lock check" part is still a whole-module presence check that the original CR-302 code passes (WR-501). |

No new fail-open path was found in the guard itself. No comments, docstrings or dead code are left in the touched Python files or in `check-lane-ownership.mjs`. No forbidden workspace names were introduced.

### Known consequence: snapshot roots now need the lock and `system/Engine.dll`

- **Main snapshot `artifacts/native-parity/inputs/IMPORTA-PC`:** no existing caller breaks. All 143 files pinned in `recipes/native-inputs.lock.json`, including `system/Engine.dll` (`4dd2f63c...`), are class `equal` in the committed reference lock, and their `eSha256` matches the pinned SHA-256, so every pinned read passes the per-file check through the hash path. The only lock entries that are not `equal` and could sit in an IMPORTA-PC copy are `Start-LAN.cmd`, `Start-Tailscale.cmd`, `iwo/...dat`, `system/nwindow.dll`, `system/l2.zip`, `READ-ME.txt`, `Start-Client.ps1`, `Start-Debug.cmd` and `*.ini`. No script reads any of them (checked with grep). Callers that default to this root: `derive-native-map-model.py`, `derive-native-map-overlap.py`, `native_migration.py`, `prepare-native-player-aliases.py`, `report-native-animation-aliases.py`, `audit-native-footstep-config.py`, `export-native-map-audio.py`, `export-native-sounds.py`, the `native-pipeline-*.json` recipe roots passed by `native_batch_adapters.py`, and the snapshot tests (`test_native_bsp_building`, `test_native_bsp_floor`, `test_native_sky`, `test_native_map_geometry`, `test_native_presentations` `CLIENT`). The snapshot is gitignored and absent on this host, so this holds only while the DATABASE-PC copy matches its input lock.
- **Research snapshot `artifacts/native-parity/research/npc-actor-profiles/inputs/IMPORTA-PC`:** this is not proven safe (WR-503).
- **Cost:** a snapshot file's mtime almost never equals the E: `eModifiedNanoseconds`, so every snapshot read now re-hashes the whole file. That affects performance only, which is out of scope here.

### Warnings

### WR-501: The entry-point scan still passes the exact CR-302 defect, so its per-file check cannot fail for a mixed module

**File:** `tests/pipeline/test_client_entry_points.py:107-117, 128, 149-152, 199-200`
**Issue:** `index_module` computes `self.module_references[module_name]` with `referenced_definitions(module_name, module_tree, ...)`. That walks the whole module tree, including every function body. So `reaches_per_file_guard` returns True if `.require_equal_file` appears anywhere in the module, or if the module references any guarded definition anywhere. It does not show that the reads in the entry point go through the guard.

Traced on the pre-fix `scripts/native_catalog/cli.py` (`git show 17a358d:scripts/native_catalog/cli.py`):
1. Line 219 is `require_reference_client(args.client)`, so the option check passes.
2. Line 251 calls `decode_table`, imported `from .tables`, which resolves to `('native_catalog.tables', 'decode_table')`.
3. `decode_table` references `table_source_path`, whose body contains `.require_equal_file`, so propagation marks `decode_table` as guarded.

The module therefore "reaches" the guard and the scan reports no failure, although `catalog_package` read, decoded and ran UModel on unguarded packages. The pre-fix `native_map.py` (WR-303) passes the same way through `MapSources.get` (line 272). The test name `test_every_client_entry_point_..._reads_through_the_per_file_lock_check` and the cited proof claim more than the check delivers. `guarded_client_destinations` (lines 64-67) also accepts any `<name>.<dest>` argument, so `require_reference_client(self.client)` in a class satisfies `--client` even if `main` never guards `args.client`.
**Fix:** Either rename the test and its STATE.md citation to what it proves ("every client entry point guards its parsed option and touches the per-file check somewhere"), or add the behavioural test the original finding asked for. For each entry in `KNOWN_CLIENT_ENTRY_POINTS`, run its `main` against the `SyntheticReferenceClientTrees` conversion root with a request that reads `system/chargrp.dat` or `animations/Mage.ukx`, and assert `ReferenceClientLockError`. At minimum, restrict `guarded_client_destinations` to `call.args[0].value.id` equal to the name bound by `parser.parse_args(...)`, and add a synthetic case shaped like the pre-fix CLI (a guarded imported helper plus a raw `within(client, relative).read_bytes()` in another function) that must be flagged.

### WR-502: A missing file under a lock-checked root orders a re-lock. Every non-reference root now hits this message

**File:** `scripts/reference_client_guard.py:97-100` (reached from `open_reference_client_access` line 122)
**Issue:** `require_lock_equal_record` turns any `OSError` from `os.stat` into `reference client lock is stale for <path>; re-lock ordered (FileNotFoundError)`. Before this fix, only E: reached that line. Now every root except the locked reference root does. Three cases give a wrong remediation:
- A mistyped `--client`.
- A partial or research snapshot without `system/Engine.dll` (WR-503).
- A receipt dependency that was deleted from a snapshot (`native_map.verify_map` line 421 now runs the guard before its own "Map hash/length mismatch" check).

In each case the message tells the integration thread to rerun the full-tree hash lock on DATABASE-PC, which is a heavy, schedule-bound job. The real fault is the selected root. AGENTS.md asks for clear errors at trust boundaries.
**Fix:**
```python
        try:
            status = os.stat(path)
        except FileNotFoundError:
            raise ReferenceClientLockError(
                f'reference client root {self.root.as_posix()} has no {relative_path}; a lock-checked root must hold every file it reads') from None
        except OSError as error:
            raise ReferenceClientLockError(f'reference client lock is stale for {relative_path}; re-lock ordered ({type(error).__name__})') from error
```
Add a guard test that opens a root without `system/Engine.dll` and asserts the root-specific message.

### WR-503: The research snapshot used by the npcname oracle tests is now a lock-checked root, and nothing shows it holds `system/Engine.dll`

**File:** `tests/pipeline/test_native_presentations.py:24, 200-204, 231, 236, 247`
**Issue:** `NPCNAME_CLIENT = ROOT / 'artifacts/native-parity/research/npc-actor-profiles/inputs/IMPORTA-PC'` is passed to `decode_table`. That calls `table_source_path`, then `require_reference_client(NPCNAME_CLIENT)`. The root is neither the reference root nor on IMPORTA-PC, so `open_reference_client_access` now requires `system/Engine.dll` there with the locked hash. The class skip guard checks only `system/npcname-e.dat`, `SCHEMA_ROOT` and `CRYPTO_SOURCE`. No committed lock or recipe records this research root's file set: `recipes/native-inputs.lock.json` covers only the main snapshot, and `docs/research/INDEX.md:80` lists only the README. On a host that holds this research root without `Engine.dll`, `NativeNpcNameTableTests.setUpClass` now errors with the misleading stale-lock message from WR-502 instead of running or skipping. I could not inspect the directory here, because `artifacts/` is gitignored and absent on PROMINENCE-PC. This is the one existing caller in the repo that the new snapshot rule may break. `system/npcname-e.dat` itself is `equal` in the lock (`84c79b73...`), so pointing the test at the main snapshot, which pins the same file and hash, would work.
**Fix:** Point `NPCNAME_CLIENT` at the main snapshot `artifacts/native-parity/inputs/IMPORTA-PC`. It pins `system/npcname-e.dat` with the same SHA-256 the test asserts, plus `system/Engine.dll`. Then delete the research-root constant. If the research root has to stay, add `(NPCNAME_CLIENT / 'system/Engine.dll').is_file()` to the skip condition and record the decision.

### WR-504: The WR-303 overlap-audit fix has no test that fails if its three call sites revert

**File:** `scripts/native_map_overlap.py:337, 349, 401`; `tests/pipeline/test_native_map_lock.py:85-90`
**Issue:** `test_overlap_audit_client_files_must_be_lock_equal` calls the new helper `verify_lock_equal_client_file` directly. Nothing calls `audit_overlap`: `tests/pipeline/test_native_map_overlap.py` imports only `parse_glb`, `select_overlaps`, `source_placement` and similar helpers. If any of the three `verify_lock_equal_client_file(client, ...)` calls in `audit_overlap` went back to `verify_file(client, ...)`, which is the WR-303 defect, no test would fail. The other WR-303 readers (`verify_map`, `verify_geometry`, `build_geometry`, `read_class_evidence`) are each exercised through their real entry function, so the overlap audit is the odd one out. AGENTS.md requires a test for each behaviour change.
**Fix:** In `MapReadPathLockTests`, call `native_map_overlap.audit_overlap` with retained receipts whose `sourceDependencies` and raw `dependencies` name `system/chargrp.dat`, and assert `ReferenceClientLockError ... is differing, not equal` before any GLB parse. Alternatively, patch `native_map_overlap.verify_lock_equal_client_file` with a recording stub and assert that every client-side table goes through it.

### Info

### IN-501: The lock builder still defines its own copy of the lock path (WR-307 leftover)

**File:** `scripts/build_reference_client_lock.py:13`
**Issue:** `DEFAULT_LOCK_OUTPUT_PATH = REPOSITORY_ROOT / 'recipes' / 'reference-client-tree.lock.json'` duplicates `reference_client_guard.REFERENCE_CLIENT_LOCK_PATH` (line 8). The builder already imports from the guard for the field list and schema version.
**Fix:** Import `REFERENCE_CLIENT_LOCK_PATH` from `reference_client_guard`, use it as the `--output` default, and delete the local constant.

### IN-502: The catalog CLI repeats the converter's lock-equal package loader

**File:** `scripts/native_catalog/cli.py:129-137`; `scripts/native_assets.py:159-192`
**Issue:** `require_lock_equal_umodel_closure` rebuilds the same loader that `Converter.package` and `Converter.source` provide: index by stem, `resolve_package_path`, `require_equal_file`, then `Package(read_bytes)`. Only the index and resolve steps were moved into `umodel_import_closure.py`. Two owners now decide which file an import name loads and how it is lock-checked.
**Fix:** Move a `lock_equal_package_loader(client_access)` factory into `native_assets_lib/umodel_import_closure.py` that returns `(path, Package)`. Use it in `cli.py` and have `Converter.package` call it, keeping only its dependency recording and cache.

---

_Reviewed: 2026-11-08T13:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

