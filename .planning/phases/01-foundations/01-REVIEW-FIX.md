---
phase: 01-foundations
fixed_at: 2026-11-08T13:50:00+02:00
review_path: .planning/phases/01-foundations/01-REVIEW.md
iteration: 2
findings_in_scope: 46
fixed: 38
skipped: 8
status: partial
---

# Phase 1: code review fix report

Fix scope critical and warning. Iteration 1 ran three sequential fixers (part A source, part B tests, part C scripts) on the 37 original critical and warning findings: 29 fixed, 8 skipped (3 necessity findings out of the default scope, 4 deferred to the reference-route removal branch or its tool move, 1 unsourced). Iteration 2 fixed all 9 warnings the re-review of the fix commits found. Info findings are out of scope.

## Fixed Issues


### CR-101: Human fighter aCis speeds applied to every player profile, including mystics

**Files modified:** `src/world/NativeSliceAdapter.ts`, `src/runtime/createNativeSliceRuntime.ts`, `src/runtime/attachNativeSliceSheet.ts`, `src/ui/nativeLocomotionControls.ts`, `tests/unit/nativeSliceAdapterSpeed.test.ts`, `tests/unit/nativeLocomotionControls.test.ts`, `tests/browser/nativeSpeed.spec.ts` (new)
**Commit:** 208f97b
**Status:** fixed: requires human verification
**Applied fix:** `nativeSliceSpeedProfile(playerProfileId, sourceUnitsPerMetre)` now looks the speed up per profile. Only `human-male-fighter` and `human-female-fighter` map to `ACIS_HUMAN_FIGHTER_SPEED`, because its own recorded source scopes it to class 0, both sexes. Every other profile gets the existing synthetic stand-in with `isSourced: false` and the source "speed unresolved for <profile>: no sourced server speed is recorded for this class". The movement readout appends ", speed unresolved". The card text is now built from `adapter.speedProfile` instead of the "walk 80, run 115, 0.4 s" literals. The sheet variable shows the unresolved source with status `unverified`. No speed value was invented.
**Test added:** Vitest cases for fighter/mystic resolution and the unresolved readout; Playwright `tests/browser/nativeSpeed.spec.ts` checks the fighter readout (1.15 m/s) and the mystic readout (marked unresolved).
**Human check:** confirm the profile-id to class 0 mapping, and that the synthetic speed is the right visible stand-in for mystics.

### CR-102: Default sandbox route replaces the sourced unarmed idle with a one-handed-sword idle

**Files modified:** `src/runtime/createNativeSliceRuntime.ts`, `src/runtime/nativeSandboxConfiguration.ts`, `src/runtime/startNativeSandboxRuntime.ts`, `src/scripts/nativeParity.ts`, `src/runtime/presentationConfigurationVariables.ts`, `src/runtime/attachNativeSliceSheet.ts`, `src/runtime/attachNativeSliceCharacterSheet.ts`, `src/assets/native/nativeAnimationAliases.ts`, `src/ui/nativeAnimationAliasTable.ts`, `src/assets/native/loadNativePlayerProfiles.ts` (comments removed, `supersedesBuiltIn` renamed `matchesBuiltInMaleFighterIdentity`), `assets/native-parity.scene/config.json`, tests `nativeSliceRuntime`, `nativeSliceWorldSource`, `presentationConfigurationVariables`, `environmentRouting`, `nativePlayerProfiles`, `tests/editor/nativeParityScript.test.ts`, `tests/browser/nativeSlice.spec.ts`
**Commits:** c51d273, 0e34999 (follow-up: stale saved Editor values)
**Status:** fixed: requires human verification
**Applied fix:** Every profile plays `playerProfile.clips`. The `fighterIdle/Run/Attack/Death` overrides are gone from the sandbox configuration, `NativeSliceSettings`, the Editor script fields, the sheet variables and the saved native parity scene. The default fighter idle is now the sourced `Wait_Hand_MFighter`. The `authored-override` alias status, the coverage `clip` field and the third `nativeAliasCoverage` parameter existed only for those overrides, so they are deleted too. The gitignored generated `assets/native-world.scene/config.json` was briefly edited and then restored byte for byte, so it is unchanged.
**Test added:** the runtime test asserts that the default fighter gets `defaultNativePlayerProfile.clips` with idle `Wait_Hand_MFighter`. The Playwright `nativeSlice.spec.ts` now waits for the sourced idle, run and attack clips (3 passed).
**Human check:** the default fighter now also gets the full staged alias set (walk, cast and so on) instead of only four clips. That is sourced data, but it changes default-route behavior.

### WR-101: Catalog index build blocks the whole sandbox when model packages share a source object

**Files modified:** `src/assets/native/nativeCatalogIndex.ts`, `src/runtime/createNativeSliceRuntime.ts`, `src/runtime/attachSandboxCommandSheet.ts`, `tests/unit/nativeCatalogIndex.test.ts`, `tests/unit/nativeSliceRuntime.test.ts`, `tests/unit/sandboxCommandSheet.test.ts`
**Commit:** 5350264
**Applied fix:** An NPC whose mesh matches several converted packages is now a `not-in-catalog` entry whose reason lists the matching packages, instead of a thrown error. An index build failure no longer fails startup: it becomes `unavailableNativeCatalogIndex(failure)`, where every lookup reports "catalog index unavailable: ...", and the Sandbox tab shows a warning note (`sandbox-catalog-index-failure`). Abort still propagates through `validateLifetime`.
**Test added:** an ambiguous-mesh lookup, the unavailable-index lookups, the sheet note, and a runtime start with a broken catalog. Playwright `sandbox.spec.ts` 1 passed.

### WR-102: Sandbox command notes report success whatever the adapter did

**Files modified:** `src/runtime/attachSandboxCommandSheet.ts`, `tests/unit/sandboxCommandSheet.test.ts`
**Commit:** 085ab41
**Status:** fixed: requires human verification
**Applied fix:** Spawn, equip and cast now subscribe for the matching `spawn` (same npcId), `update` (local player with the item in the slot) or `skill-cast` (same id and level) event during the dispatch. If no such event arrives, the note reads "<key>: spawn/equip/cast rejected by the adapter" in the warning tone. The temporary listener is always removed.
**Test added:** rejection cases for all three commands, plus a check that no listener leaks. Playwright `sandbox.spec.ts` 1 passed.
**Human check:** this relies on both current adapters dispatching synchronously. A future asynchronous server adapter would need an event-driven note instead.

### WR-103: asset.json v2 support breaks the asset inspector's unit readout

**Files modified:** `src/assets/package/readAssetPackage.ts`, `src/ui/AssetImportPanel.ts` (also removed its one comment), `src/ui/assetSourceMetadataRows.ts` (new), `tests/unit/assetSourceMetadataRows.test.ts` (new), `tests/browser/assetPackage.spec.ts`
**Commit:** 4f889de
**Applied fix:** A new function `assetSourceMetadataRows` builds the inspector's Source details rows and reads the unit from `manifest.coordinates`. The model entry type is split per schema (v1 keeps its unit fields, v2 is `{ file }` only), so a stale `model.sourceUnitsPerMetre` read no longer type-checks.
**Test added:** Vitest for the v2 unit (52.5), the normalized v1 unit, and no unit row for audio. Playwright checks the "1 metre = 100 source units" row (1 passed).

### WR-104: A failed `?inspect=1` load tears down a ready world

**Files modified:** `src/App.ts`, `tests/unit/appStartup.test.ts`
**Commit:** bb03cb7
**Applied fix:** `init()` still awaits the inspector, so open and close ordering is unchanged, but a rejection is caught and logged as "Babylon Inspector failed to open.". The world stays ready and is not disposed.
**Test added:** "keeps the ready world when the Inspector fails to open". I confirmed it fails on the pre-fix `App.ts`. Playwright `inspector.spec.ts` 2 passed.

### WR-105: Startup measurement server skips the WebGPU compiler staging that `pnpm dev` runs

**Files modified:** `playwright.startup.config.ts`, `tests/unit/startupMeasurementConfig.test.ts` (new)
**Commit:** 746e55a
**Applied fix:** The web server command is now `pnpm dev --port 5175 --strictPort`, so compiler staging has one owner (the `dev` script). I started it once on 5175 and saw "WebGPU compilers ready" followed by Vite listening on 127.0.0.1:5175, then stopped it by PID tree.
**Test added:** a config test asserting that the command goes through `pnpm dev` and that the `dev` script stages the compilers.

### WR-107: Duplicated error and promise helpers live in a UI-sheet module

**Files modified:** `src/runtime/settledTasks.ts` (new), `src/runtime/nativeSliceSheet.ts`, `src/runtime/loadNativeSliceAudio.ts`, `src/runtime/createNativeSliceEffects.ts`, `src/runtime/createNativeSliceRuntime.ts`, `src/runtime/loadNativeSliceWorld.ts`, `tests/unit/settledTasks.test.ts` (new)
**Commit:** af04b30
**Applied fix:** `settle`, `Settled` and `failureText` now live in `src/runtime/settledTasks.ts`. `failureMessage` is deleted, and the runtime modules no longer import the sheet module for non-UI logic.
**Test added:** `tests/unit/settledTasks.test.ts`.

### WR-108: `loadNativeCatalog` is a production export used only by tests

**Files modified:** `src/assets/native/loadNativeCatalog.ts`, `tests/unit/nativeResource.test.ts`
**Commit:** 86e5aad
**Applied fix:** `loadNativeCatalog` and the hardcoded default `wanted` list are deleted, and `loadModels` now needs an explicit list. The byte and corruption test now runs through `loadNativePlayerPackages`, which production uses.
**Test added:** the existing package byte and corruption case, now pointed at the production function (passes under https: and file:).


### CR-201: Dev cold-start spec passes when the world never becomes ready

**Files modified:** `tests/startup/devStartup.spec.ts`
**Commit:** daa9da4
**Applied fix:** The measurement JSON is still written and attached for diagnostics. After that, the spec asserts that `millisecondsToReady` is not null, that `failedRequests` equals `[]` and that `editorToolsRequestCount` is 0.
**Proof it bites:** Baseline `pnpm exec playwright test --config playwright.startup.config.ts` passed 1/1 (18.6 s). With `readyBudgetMilliseconds = 1` it failed on the ready assertion. With an injected `fetch("http://127.0.0.1:1/unreachable")` it failed on `failedRequests` (received the unreachable URL). Both breaks were restored and not committed.

### WR-201: Editor-independence guard misses `src/editor/` and authored-world markers, and the default suite already tests an Editor module

**Files modified:** `tests/unit/editorIndependence.test.ts` (marker change). The authored-world cases moved in the WR-207 commit.
**Commit:** 617af49 (markers), dcfca9a (move to `tests/editor/authoredNativeSliceRuntime.test.ts`)
**Applied fix:** `editorReferenceMarkers` now also holds `"src/editor/"` and `"authoredNativeWorld"`. No file in `tests/unit` references `src/editor` any more. The shared harness and the world cases live in `tests/support/`, take the world source by injection and never import `src/editor`.
**Proof it bites:** I put the pre-split `nativeSliceRuntime.test.ts` back into `tests/unit` temporarily, and `editorIndependence.test.ts` failed with `expected [ 'nativeSliceRuntime.test.ts' ] to deeply equal []`. I then deleted the file again.
**Note:** OVERNIGHT-DECISIONS row 34 and the STATE.md line for 01-09 still describe this split as deferred. I did not edit `.planning`, so the orchestrator should update both.

### WR-202: Asset contract rejection cases accept any asset.json error, with no positive control

**Files modified:** `tests/unit/assetPackageContract.test.ts`
**Commit:** 55a297e
**Applied fix:** New positive control: for `model-v1`, `model-v2` and `audio-v2`, the unedited repack is accepted and its manifest equals the original's. Each rejection row now carries the exact reader message and asserts `rejects.toHaveProperty("message", expectedMessage)`.
**Proof it bites:** I made two temporary breaks: the repack helper deleted `coordinates` for every version, and the clientBuild row deleted `files` instead. Three tests failed: the model-v2 positive control, the left-handed row and the clientBuild row. The old `/asset\.json/` regex would have accepted the wrong message on the clientBuild row. Restored; 13/13 pass.

### WR-203: Device-loss negative check relies on a 100 ms sleep

**Files modified:** `tests/browser/webgpu.spec.ts`
**Commit:** 826ce5c
**Applied fix:** The probe now counts `deviceRequests` at call time, before the device resolves. I removed the 100 ms sleep and also the `setTimeout(0)` in `graphicsSnapshot`. After loss, the spec waits for these terminal states: the alert, the retry button, the hidden canvas, `data-world-state="loading"` and `window.__nativeSlice === undefined` (polled). Then it asserts `{ deviceRequests: 1, devices: 1 }`.
**Proof it bites:** Baseline `webgpu.spec.ts` passed 4/4 on SwiftShader (1.5 min). An awaited second `requestAdapter().requestDevice()` after loss failed the spec (`deviceRequests: 2`). Restored.
**Limitation, for human review:** A revival scheduled after the terminal state still passes. No deterministic signal exists for "never". A fire-and-forget request did not register in time. Re-enabling Babylon's `_restoreEngineAfterContextLost` produced no device request even 3 s later, so the old sleep would not have caught that regression either.

### WR-205: Default unit tests crash, rather than skip, without gitignored artifacts or the staged store

**Files modified:** `tests/unit/nativeEffectComponents.test.ts`, `tests/unit/nativePowerStrikeSource.test.ts`
**Commit:** dbb63d5
**Applied fix:** I moved the top-level `await readFile` into a guarded `beforeAll`. A `beforeEach(context => context.skip(missing, reason))` now skips each test and states the reason, naming the missing gitignored retained research output, or the missing `public/l2` paths for the staged store. When the inputs are present, the tests run and assert as before.
**Proof it bites:** With the inputs present, 90/90 pass. With absence simulated (existence check pointed at `<path>.absent`), 90 were skipped and the verbose reporter shows the reason on each. The pre-fix file under the same absence failed at load with `ENOENT` ("no tests"). Restored.

### WR-206: `any` in phase-touched test files

**Files modified:** `tests/unit/nativeEffectComponents.test.ts`, `tests/unit/nativePowerStrikeSource.test.ts`
**Commit:** f97f010
**Applied fix:** The retained fixture is now typed `EffectManifest`, and I deleted the `Json` alias. `catalog` is `Record<string, unknown>`. The sidecar uses the new interfaces `AnimationSourceSidecar` and `AnimationSourceClip`, plus the helper `maleSpecialAttackClip`. I renamed helpers and parameters to full words: `copyRetainedManifest`, `retainedCatalogEntry`, `serveFetchedFiles`, `loadServedEffectComponents`, `chargeMeshComponent`, `liveSignal`, `sha256Hex`, `encodeJson`, `asset`, `file`, `sidecar`, `clip`.
**Proof it bites:** Misspelled fields (`texture!.sha265`, `animationSett`) now fail `tsc` with TS2551, where `any` let them through before. Restored; 90/90 pass.

### WR-207: nativeSliceRuntime.test.ts is 910 lines and mixes concerns

**Files modified:** I deleted `tests/unit/nativeSliceRuntime.test.ts` and added these files:
- `tests/support/nativeSliceRuntimeHarness.ts` (179 lines): mocks, setup and fixtures
- `tests/support/nativeSliceRuntimeWorldCases.ts` (209 lines): cases shared by the source and authored worlds
- `tests/unit/nativeSliceRuntimeStartup.test.ts`
- `tests/unit/nativeSliceRuntimeCancellation.test.ts`
- `tests/unit/nativeSliceRuntimeFlames.test.ts`
- `tests/unit/nativeSliceRuntimeInspector.test.ts`
- `tests/unit/nativeSliceRuntimeSheet.test.ts`
- `tests/unit/nativeSliceRuntimePlayerProfiles.test.ts`
- `tests/editor/authoredNativeSliceRuntime.test.ts`

Every file is under 210 lines.

**Commit:** dcfca9a
**Applied fix:** The split follows the reviewer's layout. Cases that ran over both world sources are now registered once, through `registerFlamePresentationWorldCases` and `registerPackageInspectionWorldCase`. The source world registers them in the unit files and the saved authored world in the Editor file, so the case bodies are not duplicated.
**Proof:** The case count is unchanged: 87 before, now 66 unit plus 21 editor. Every case still asserts through the mocked boundaries, which shows the harness mocks still apply (Vitest needs the hoisted mock object exported after declaration). `pnpm typecheck` is clean.

### WR-208: Comments left in a phase-touched file

**Files modified:** `tests/unit/assetPackage.test.ts`
**Commit:** 310addc
**Applied fix:** I deleted both trailing comments. Their meaning, the Babylon 9.27.1 global reset and the repeated restore, is now in the test name.
**Proof:** No comments remain in the file; 15/15 pass. This is not a behavior change.

### WR-210: Lane and decision invariants are stale against current decisions

**Files modified:** `tests/unit/laneOwnership.test.ts`
**Commit:** 6587abd
**Applied fix:** The required decision IDs are now every `- DEC-X-N` that `.planning/PROJECT.md` defines (21 IDs, including DEC-OWN-10). An explicit `DEC-OWN-10` check keeps the derived list from passing empty. The writer-script selection now includes `preview*` package scripts and their script paths, and asserts that `scripts/private-preview.mjs` is in the list.
**Proof it bites:** I made two temporary breaks: deleted the DEC-OWN-10 line from DECISIONS.md, and dropped the `preview` filter. Each caused a failure: `arrayContaining` for the decisions, and `toContain("scripts/private-preview.mjs")` for the writers. Restored; 35/35 pass.


### CR-301: The reference-client guard fails open for any other spelling of the E: tree (UNC, admin share, `\\?\` prefix, mapped drive)

**Files modified:** `scripts/reference_client_guard.py`, `tests/pipeline/reference_client_lock_fixture.py` (new), `tests/pipeline/test_reference_client_guard.py`, `tests/pipeline/test_reference_client_lock.py`, plus synthetic-client setup in 14 pipeline test files, `docs/NATIVE_CLIENT_AUDIT.md`, `docs/parts/data/EVIDENCE.md`
**Commit:** 40c4e56
**Status:** fixed: requires human verification
**Applied fix:** The guard now reads the lock for every root. It skips the per-file check only when the current host equals the lock's `referenceHost` and the resolved root equals the lock's `referenceRoot`. Every other root and spelling needs the lock and an equal `system/Engine.dll`. `DATABASE_PC_CONVERSION_ROOT` and the unused `lock_path`/`conversion_root` parameters were deleted. Synthetic test clients now say they are the locked reference root through `lock_client_as_reference_root`.
**Tests added:** `test_every_root_without_lock_is_refused`, `test_reference_root_on_another_host_requires_the_lock`, `test_root_outside_the_lock_requires_the_lock`, `test_device_and_share_spellings_of_the_reference_root_require_the_lock` (end to end through `\\?\`, `\\localhost\C$` and `\\127.0.0.1\C$`; it skips a spelling the host cannot reach), and `test_only_the_exact_reference_root_on_the_reference_host_skips_the_lock` (UNC, admin share, `\\?\`, `\\?\UNC`, mapped drive `Z:`, E:, and another host).
**Note:** Snapshot roots such as `artifacts/native-parity/inputs/IMPORTA-PC` now need the lock too. They must hold `system/Engine.dll`, and only lock-equal files can be read from them.

### CR-302: `native_catalog/cli.py --package` reads, decodes and runs UModel on E: packages without a per-file lock check

**Files modified:** `scripts/native_catalog/cli.py`, `scripts/native_assets_lib/umodel_import_closure.py`, `scripts/native_assets.py`, `tests/pipeline/test_native_catalog_package_lock.py` (new)
**Commit:** 995a12c
**Applied fix:** `catalog_package` takes the `ReferenceClientAccess`, resolves the package through `require_equal_file`, and checks the UModel import closure before UModel runs. The package-name lookup (`index_package_files_by_casefolded_stem`, `resolve_package_path`) moved beside the closure check, so the converter and the catalog CLI share it.
**Tests added:** A differing package is refused before UModel runs or any output is written. An equal package with a differing import is refused before UModel runs. UModel runs once the whole closure is lock-equal.

### WR-301: The lock builder never checks that the two manifests come from the expected hosts and roots, or from two different trees

**Files modified:** `scripts/build_reference_client_lock.py`, `tests/pipeline/test_reference_client_tree.py`
**Commit:** e7f9563
**Applied fix:** `require_manifest_origin` compares each manifest's host and normalized root with the expected reference or conversion origin. The module docstring became `LOCK_BUILDER_DESCRIPTION`.
**Tests added:** The builder refuses the conversion manifest passed twice, the reference manifest passed twice, swapped manifests, and a manifest from a foreign host. A further test checks that the lock records the origins it proved.

### WR-302: `Converter.convert` stamps the lock's Interlude `clientBuild` on assets from any client root

**Files modified:** `scripts/native_assets.py`, `scripts/native_assets_lib/asset_manifest.py`, `scripts/generate_golden_fixtures.py`, `tests/pipeline/reference_client_lock_fixture.py`, `tests/pipeline/test_native_assets_manifest_v2.py`, `tests/pipeline/test_asset_manifest_v2.py`, `tests/pipeline/test_native_effect_bundle.py`, `docs/OUTPUT_CONTRACT.md`
**Commit:** ccb5e5f
**Applied fix:** `Converter.measured_client_build` takes `clientBuild` from the lock that authorized its reads. It hashes the converted root's own `system/Engine.dll` and refuses the conversion when that file is missing or differs. `reference_client_build` now takes a parsed lock. The golden fixtures regenerate byte for byte.
**Tests added:** `test_converter_refuses_to_stamp_a_build_its_client_engine_library_does_not_match` (differing and missing cases).

### WR-303: Verify and geometry paths read and decode client files with no per-file lock check

**Files modified:** `scripts/native_map.py`, `scripts/native_map_geometry.py`, `scripts/native_map_overlap.py`, `tests/pipeline/test_native_map.py`, `tests/pipeline/test_native_map_lock.py` (new)
**Commit:** 72744ce
**Applied fix:** `require_lock_equal_client_path` in `native_map.py` is the one owner of a lock-checked client path, and `MapSources.get` uses it too. It is applied in `verify_map`, the `migrate_map` recheck, `verify_geometry`, the `build_geometry` map decode, reused class evidence, and the overlap audit through `verify_lock_equal_client_file`. Both module docstrings became named description constants.
**Tests added:** Seven cases. Each read path refuses a lock-differing file even when the receipt hash matches it, and the equal-file cases are accepted.

### WR-304: The import-closure re-raise crashes with `TypeError` for `UnicodeDecodeError` and other ValueError subclasses

**Files modified:** `scripts/native_assets_lib/umodel_import_closure.py`, `tests/pipeline/test_umodel_import_closure.py`
**Commit:** b6c4376
**Applied fix:** Lock errors are re-raised as `ReferenceClientLockError`. Every other `ValueError` becomes `UModelImportClosureError`, and both keep the cause.
**Tests added:** `test_an_undecodable_package_name_keeps_its_cause_in_one_closure_error`. Before the fix it raised `TypeError: function takes exactly 5 arguments`.

### WR-305: The DAT inventory turns a stale-lock error into a "not equal to IMPORTA-PC" row instead of stopping

**Files modified:** `scripts/build_dat_table_inventory.py`, `tests/pipeline/test_dat_table_inventory.py`
**Commit:** 3352059
**Applied fix:** A not-equal row is written only when the lock record's class is not `equal` and the lock applies to the root. Any other lock error propagates.
**Tests added:** A differing table is recorded without being decoded. A stale lock on an equal table stops the run.

### WR-306: The DAT inventory `countSource` always names `E:/Lineage2-client/`, whatever `--client` was read

**Files modified:** `scripts/build_dat_table_inventory.py`, `tests/pipeline/test_dat_table_inventory.py`
**Commit:** cdc0ed7
**Applied fix:** `local_decode_count_source` names the root that was actually read and adds `lock-equal` only when the lock applied. The committed inventory still matches when the root is the locked conversion root.
**Tests added:** `test_the_count_source_names_the_root_that_was_read_and_whether_the_lock_applied`. The committed-inventory test now derives the root from the lock's `conversionRoot`.

### WR-307: Three readers of the reference lock apply three different levels of validation, and the field list is defined three times

**Files modified:** `scripts/reference_client_guard.py`, `scripts/native_assets_lib/asset_manifest.py`, `scripts/build_dat_table_inventory.py`, `scripts/build_reference_client_lock.py`, `scripts/generate_golden_fixtures.py`, `tests/pipeline/test_asset_manifest_v2.py`, `tests/pipeline/test_reference_client_lock.py`, `tests/pipeline/test_umodel_import_closure.py`
**Commit:** 4629cbb
**Applied fix:** `read_reference_client_lock` is the only parser. It returns a `ReferenceClientLock` with the document and the records looked up by path name, and `ReferenceClientAccess` carries that lock. `reference_client_build` and the dat inventory use it, and the inventory no longer re-parses the lock or indexes records by position. The field list, schema version and `system/Engine.dll` path are imported from the guard everywhere.
**Tests added:** `test_refuses_a_lock_whose_file_fields_are_reordered`.

### WR-308: The lane ownership check misses renames out of another lane's paths

**Files modified:** `scripts/check-lane-ownership.mjs`, `tests/unit/laneOwnership.test.ts`
**Commit:** 6981944
**Applied fix:** `git diff --name-only --no-renames -z`, split on NUL.
**Tests added:** A Vitest case where moving a data-ui file into the world lane flags the deleted source path, and a non-ASCII world path is read unquoted. The lane test file passes (36 of 36) and `pnpm typecheck` passes.

### WR-310: The entry-point scan test passes for scripts that read E: files without the per-file guard

**Files modified:** `tests/pipeline/test_client_entry_points.py`
**Commit:** a754138
**Status:** fixed: requires human verification
**Applied fix:** The scan now requires `require_reference_client(<parsed>.<dest>)` for every `--client*` option. It also proves that a `require_equal_file` read is reachable: it resolves imports, module aliases and `spec_from_file_location` script loads, and it ignores the guard's own Engine.dll root check. All 23 entry points pass.
**Tests added:** The scan flags a fixed-root guard and a root-guard-only reader. It accepts direct, imported and dynamically loaded per-file guards. A check outside the repository showed that removing `require_equal_file` from `native_catalog/tables.py` or `native_map.py` makes the scan flag the dependent entry points.
**Limit:** It is static. It catches an entry point with no per-file read path at all, but not one that mixes guarded and unguarded reads.


### WR-401: Equipping the item already worn is reported as "equip rejected by the adapter"

**Files modified:** `src/world/sandboxCommands.ts`, `tests/unit/sandboxCommands.test.ts`, `tests/unit/sandboxCommandSheet.test.ts`, `tests/browser/sandbox.spec.ts`
**Commit:** 38077ae
**Applied fix:** The fix is at the adapter boundary. `entityWithEquippedItem` now returns the unchanged entity when the slot already holds the requested item, or is already empty for `null`. Both `MockWorldAdapter` and `NativeSliceAdapter` therefore emit an `update` that confirms the equip, and the sheet's acceptance check still only reads adapter events. The extra unchanged `update` is a no-op for `EntityRegistry` and `NativeCharacterVisual`, which compares the upper slot before it reloads anything.
**Test:** The `sandboxCommands.test.ts` case now expects the confirming update on both adapters. A new `sandboxCommandSheet.test.ts` case drives a real `NativeSliceAdapter` that starts with item 22 and expects "item:22 converted" with tone info. The Playwright `sandbox.spec.ts` step submits 22 on `?world=interlude`. Proofs without the fix:
- Vitest: 3 failures.
- Playwright: received "item:22: equip rejected by the adapter".

With the fix, Vitest passes (74 tests across the 6 equip-related files) and Playwright passes (1 passed, 25 s, port 5173 was free).
**Status:** fixed: requires human verification. It changes the adapter contract, because an equip that changes nothing now emits an update. Recorded as OVERNIGHT-DECISIONS row 46 (commit f462207).

### WR-402: The Editor-independence guard does not scan the new shared `tests/support` modules that the unit tests import

**Files modified:** `tests/unit/editorIndependence.test.ts`
**Commit:** a8db947
**Applied fix:** The guard now scans both `tests/unit/` and `tests/support/` and uses project-relative paths. It also asserts that the support harness is in the scanned set, so a scan that finds nothing cannot pass.
**Test:** Bite proof: appending `export const editorMarkerProbe = "src/editor/";` to `tests/support/nativeSliceRuntimeWorldCases.ts` made the test fail and name that file. The file was then restored.

### WR-403: The WR-103 Playwright check uses an asset.json v1 fixture, so it passed before the fix too

**Files modified:** `tests/browser/assetPackage.spec.ts`
**Commit:** 2296470
**Applied fix:** A new Playwright case opens an asset.json v2 model package and asserts the `Unit` row against `manifest.coordinates.sourceUnitsPerMetre`. The package is built from the pinned golden `model-v2.l2asset`: its manifest is kept, and its `model.glb` is replaced by the visible fixture triangle (file inventory and source hash updated). The golden GLB alone is refused by the viewer with "The model has no finite visible geometry".
**Test:** Port 5173 had no listener, so the test ran. With the fix: 2 passed. With the pre-fix `AssetImportPanel.ts` from 17a358d it failed, receiving "Unit1 metre = undefined source units".

### WR-404: New UI copy file carries an em dash

**Files modified:** `src/ui/assetSourceMetadataRows.ts`, `tests/unit/assetSourceMetadataRows.test.ts`
**Commit:** 283ef29
**Applied fix:** "1:1 — no size normalization" is now "1:1 - no size normalization", and the unit assertion matches.
**Test:** `assetSourceMetadataRows.test.ts` passes. With the pre-fix source file it fails (1 failed).

### WR-405: The new catch-all rejection handler also swallows aborts, and no test covers an abort during the index build

**Files modified:** `src/runtime/createNativeSliceRuntime.ts`, `src/runtime/buildNativeCatalogIndexOrUnavailable.ts` (new), `tests/unit/buildNativeCatalogIndexOrUnavailable.test.ts` (new), `tests/unit/nativeSliceRuntimeCancellation.test.ts`
**Commit:** e5d6cd5
**Applied fix:** The index build and its unavailable fallback moved into `buildNativeCatalogIndexOrUnavailable`. It calls `signal.throwIfAborted()` before it falls back, so an abort is re-raised and never becomes an unavailable index. The runtime calls this function, and the unused imports there are gone. New file reason: the fallback had to be testable on its own, because in the runtime the later `validateLifetime()` masks the defect.
**Test:** The new unit file covers three cases:
- An abort while the NPC profile fetch is pending rejects with AbortError.
- A duplicate catalog entry returns the unavailable index and names the failure.
- A clean catalog returns no failure.

The cancellation test also gets the case the review asked for: the NPC profile fetch is pending, the signal aborts, the runtime rejects with AbortError and no UI or registry is created. Proof: without the `throwIfAborted` line the abort case fails, with `catalogIndexFailure: "This operation was aborted"`. The runtime-level case passes on the old code too, because the later `validateLifetime()` catches the abort there. That is the masking the review described, and the case stays as a regression guard.

### WR-501: The entry-point scan still passes the exact CR-302 defect, so its per-file check cannot fail for a mixed module

**Files modified:** `tests/pipeline/test_client_entry_points.py`
**Commit:** b4144e8
**Applied fix:** The fix takes the review's "rename" option plus the destination restriction:
- `guarded_client_destinations` now accepts only `require_reference_client(<name>.<dest>)` where `<name>` is bound by an assignment from `parse_args(...)`. A `self.client` guard inside a class no longer satisfies `--client`.
- The test is renamed to `test_every_client_entry_point_guards_its_parsed_client_option_and_references_the_per_file_lock_check`.
- STATE.md needed no change: its line 87 cites only the `require_reference_client` claim, which is still true.

All 23 real entry points still pass.
**Test:** A new synthetic case covers an instance-attribute guard (must be flagged) and a parsed-arguments guard (must pass). Without the restriction the new case fails (1 failed).
**Status:** fixed: requires human verification. Still open:
- A synthetic case shaped like the pre-fix CLI: a guarded imported helper, plus a raw `within(client, relative).read_bytes()` in another function, which must be flagged.
- The behavioural run of every entry point `main` against `SyntheticReferenceClientTrees`.

Module-wide reachability cannot catch a mixed module, which is why the test name now claims only "references". Recorded in OVERNIGHT-DECISIONS row 46.

### WR-502: A missing file under a lock-checked root orders a re-lock. Every non-reference root now hits this message

**Files modified:** `scripts/reference_client_guard.py`, `tests/pipeline/test_reference_client_guard.py`
**Commit:** 7f70d4a
**Applied fix:** `require_lock_equal_record` now handles `FileNotFoundError` on its own. It raises `reference client root <root> has no <path>; a lock-checked root must hold every file it reads`, with no re-lock order. Other `OSError`s keep the stale-lock message and now chain the cause.
**Test:** Two new cases:
- A root without `system/Engine.dll` fails at `require_reference_client`. The test checks the exact message and that "re-lock" is absent.
- An equal file deleted from the conversion root gets the root-specific message.

Both fail against the pre-fix guard (2 failed). The guard module passes with 21 tests. The modules that call the guard pass too (65 passed, 18 skipped).

### WR-503: The research snapshot used by the npcname oracle tests is now a lock-checked root, and nothing shows it holds `system/Engine.dll`

**Files modified:** `tests/pipeline/test_native_presentations.py`
**Commit:** 70ce3b1
**Applied fix:** The research-root constant `NPCNAME_CLIENT` is deleted. `NativeNpcNameTableTests` now reads `CLIENT`, the main snapshot `artifacts/native-parity/inputs/IMPORTA-PC`. That snapshot pins `system/npcname-e.dat` with the same SHA-256 `84c79b73...` and also pins `system/Engine.dll` (`recipes/native-inputs.lock.json`). The skip condition now also requires `CLIENT / ENGINE_LIBRARY_RELATIVE_PATH`, imported from the guard, so it matches what the guard requires. A host without the snapshot, or with a partial one, skips instead of erroring.
**Test:** On this host the module passes (8 passed, 12 skipped). A temporary probe created a dummy `npcname-e.dat` under both roots (no Engine.dll) and stand-in formats. The old module errored in `setUpClass` (errors 1, run 0), and the new module skipped all 4 cases. The probe files were deleted afterwards. A direct `require_reference_client` call on the research root now returns the WR-502 root-specific message.

### WR-504: The WR-303 overlap-audit fix has no test that fails if its three call sites revert

**Files modified:** `tests/pipeline/test_native_map_lock.py`
**Commit:** ab09976
**Applied fix:** `MapReadPathLockTests` gets three new tests:
- Two drive the real `native_map_overlap.audit_overlap` through a synthetic bundle (section, runtime and raw receipts). One has a differing section `sourceDependencies` entry and one a differing raw `dependencies` entry. Each asserts "system/chargrp.dat is differing, not equal".
- The third parses `audit_overlap` and asserts that every call taking `client` as its first argument goes to `verify_lock_equal_client_file` (exactly 3), `MapSources` or `read_class_evidence`. The model provenance call site needs a real UE2 map package to reach at runtime, so this check covers it.

**Test:** Mutation proof, reverting each call site to `verify_file(client, ...)` one at a time:
- Site 1 (section dependencies): 2 failed.
- Site 2 (raw dependencies): 2 failed.
- Site 3 (model provenance): 1 failed.


## Skipped Issues


### WR-106: Navigation constants tuned for the reference route are applied, unsourced, to the native route

**File:** `src/scene/navigation/meshNavigation.ts:6-7,143,297,322`
**Reason:** source values not available on this host. The step height, slope limit, spawn spacing, destination drop and default capsule have no recorded Lineage II source in the repo, and the reference client `C:/Lineage2-client` is outside the reference lock on PROMINENCE-PC (E:/ does not exist), so the true values cannot be recovered here. The other fix route, marking them unresolved through per-route `MeshNavigationOptions`, would also need the reference route caller (`src/runtime/createWorldRuntime.ts`, being deleted by the reference-route removal branch) to supply the options, or a compatibility default. I did not do the rename-only part (full-word locals, shared slope and spacing constants) in isolation either. It should land together with the sourced or unresolved values in one change to this 340-line geometry module.
**Original issue:** `maxStep = 0.3`, `skin = 0.002`, the 45 degree slope (duplicated in `attachTargeting.ts:29`), the 1.4 spawn spacing, the 0.8 destination drop and the default capsule act as unsourced stand-ins on the native route, and single-letter locals break the naming rule.

### WR-109: Generality without instantiation - catalog index `keys()` and tile entries have no production consumer

**File:** `src/assets/native/nativeCatalogIndex.ts:10-11,19,25,51-54,127-136,145-147`
**Reason:** necessity finding, out of default fix scope.
**Original issue:** `keys()` and the `tile:` entries are consumed only by tests.

### WR-110: Generality without instantiation - `createWorldRuntime` `suppliedAdapter` is never supplied (reference route)

**File:** `src/runtime/createWorldRuntime.ts:24,32`
**Reason:** necessity finding, out of default fix scope; deferred: module being deleted by the reference-route removal branch.
**Original issue:** the optional adapter parameter is never supplied in production or tests.

### WR-111: Impossible-state guards on the verified Musveren profile

**File:** `src/runtime/createNativeSliceRuntime.ts:101-102`, `src/runtime/nativeSliceDiagnostics.ts:73`
**Reason:** necessity finding, out of default fix scope.
**Original issue:** six `musveren!` assertions and an `?? null` guard a state that TypeScript already excludes.

---

_Fixed: 2026-11-08T10:10:45Z_
_Fixer: gsd-code-fixer_
_Iteration: 1_

### CR-202: Phase-edited describe title contains the forbidden external workspace name (reference route)

**File:** `tests/unit/nativeOrProceduralCharacter.test.ts:13`
**Reason:** Deferred: the reference-route removal branch is deleting this module.
**Original issue:** The rewritten describe title kept an external workspace name that the run rules' wording grep forbids.

### WR-204: Cancellation test asserts absence after a 10 ms sleep (reference route)

**File:** `tests/unit/nativeOrProceduralCharacter.test.ts:83`
**Reason:** Deferred: the reference-route removal branch is deleting this module.
**Original issue:** A 10 ms sleep stands in for a deterministic completion signal before the absence assertions.

### WR-209: Impossible-state guard - conditional flame-clock assertion

**File:** `tests/browser/nativeFlame.spec.ts:38-39`
**Reason:** Necessity finding, out of the default fix scope.
**Original issue:** `if (textureRate > 0 && fadeRate > 0)` guards on constants that are always 1, so the clock-sync assertion could silently vanish.


### WR-309: Tool and schema paths hard-coded to a workspace outside this repository, in four touched files

**File:** `scripts/native_assets.py:31`, `scripts/native_catalog/cli.py:17`, `scripts/native_catalog/effects.py:13`, `scripts/native_catalog/tables.py:12-13`
**Reason:** deferred: the reference-route removal branch moves those tools into .assets/native-tools/ (OVERNIGHT-DECISIONS row 42)
**Original issue:** `UMODEL`, `UELIB`, `SCHEMA_ROOT` and `CRYPTO_SOURCE` default to absolute paths outside this repository, so the self-contained wording check is not empty on those lines.

---

_Fixed: 2026-11-08T13:15:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
