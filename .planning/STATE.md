---
gsd_state_version: "1.0"
current_phase: 02
current_phase_name: Stage A breadth
status: executing
stopped_at: Completed 02-26-PLAN.md
last_updated: "2026-11-09T04:41:40.800Z"
last_activity: 2026-11-09
last_activity_desc: Phase 02 plan 02-15 complete (TerrainInfo-derived 4x4-sector chunk plan and per-chunk terrain for 20_21 and 20_20, WORLD-01 pending)
state_head: 5352a07d60013235e36934dbb683249259349d60
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 87
  completed_plans: 51
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-08)

**Core value:** A fully converted Lineage II Interlude client that runs in the browser and matches L2.exe side by side, driven only by what a server sends.
**Current focus:** Phase 02 - Stage A breadth (Phase 1 verification deferred to the owner)

## Current Position

Phase: 02 (Stage A breadth) - EXECUTING
Plan: 02-41 complete, 32 of 70 plans summarized
Status: Executing Phase 2; Phase 1 is verification_deferred_human (see Deferred Verification)
Last activity: 2026-11-09 - Plan 02-41 complete: `EquipmentSlot` is `upper` or `body-part:<value>` named by the source `body_part` value; `isEquipmentSlot` accepts only the canonical form, `equipmentSlotForBodyPart` owns the key form, equipment keys sort `upper` first then by value; all 19 distinct decoded weapongrp and armorgrp `body_part` values map to accepted slots, meaning undecoded; `pnpm test:unit` 1,927 passed, 0 failed. ACT-03 stays Pending until 02-21 and 02-42.

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 1 P02 | 15 min | 2 tasks | 11 files |
| Phase 01 P07 | 11 min | 3 tasks | 13 files |
| Phase 01 P08 | 13 min | 3 tasks | 20 files |
| Phase 01 P01 | 8 min | 2 tasks | 26 files |
| Phase 01 P13 | 9 min | 2 tasks | 8 files |
| Phase 01 P03 | 13 min | 3 tasks | 16 files |
| Phase 01 P04 | 15min | 2 tasks | 15 files |
| Phase 01 P05 | 25min | 3 tasks | 26 files |
| Phase 01 P10 | 12min | 2 tasks | 14 files |
| Phase 01 P12 | 17min | 3 tasks | 26 files |
| Phase 1 P06 | 10 min | 2 tasks | 22 files |
| Phase 01 P09 | 8min | 2 tasks | 28 files |
| Phase 01 P11 | 6 min | 2 tasks | 24 files |
| Phase 01 P15 | 5 min | 2 tasks | 13 files |
| Phase 01 P14 | 16 min | 3 tasks | 23 files |
| Phase 01 P16 | 14 min | 2 tasks | 8 files |
| Phase 01 P17 | 50min | 4 tasks | 27 files |
| Phase 02 P10 | 15 min | 3 tasks | 9 files |
| Phase 02 P11 | 24 min | 3 tasks | 13 files |
| Phase 02 P01 | 25 min | 3 tasks | 33 files |
| Phase 02 P02 | 16 min | 3 tasks | 14 files |
| Phase 2 P03 | 20min | 3 tasks | 17 files |
| Phase 2 P06 | 20min | 3 tasks | 13 files |
| Phase 2 P08 | 20min | 3 tasks | 7 files |
| Phase 02 P09 | 12min | 3 tasks | 10 files |
| Phase 02 P56 | 17 min | 3 tasks | 28 files |
| Phase 02 P04 | 25min | 3 tasks | 17 files |
| Phase 02 P18 | 8 min | 2 tasks | 5 files |
| Phase 02 P21 | 25 min | 3 tasks | 14 files |
| Phase 02 P32 | 12 min | 3 tasks | 3 files |
| Phase 02 P57 | 25 min | 3 tasks | 22 files |
| Phase 02 P59 | 35 min | 3 tasks | 20 files |
| Phase 02 P05 | 16min | 3 tasks | 21 files |
| Phase 02 P07 | 15min | 3 tasks | 13 files |
| Phase 02 P17 | 35min | 3 tasks | 21 files |
| Phase 2 P19 | 20min | 3 tasks | 17 files |
| Phase 02 P24 | 15min | 3 tasks | 7 files |
| Phase 02 P60 | 40min | 3 tasks | 33 files |
| Phase 2 P12 | 25min | 3 tasks | 12 files |
| Phase 02 P20 | 30min | 3 tasks | 26 files |
| Phase 02 P22 | 31min | 3 tasks | 16 files |
| Phase 2 P27 | 19min | 3 tasks | 14 files |
| Phase 02 P23 | 8min | 3 tasks | 9 files |
| Phase 2 P13 | 17min | 2 tasks | 6 files |
| Phase 02 P14 | 19min | 3 tasks | 14 files |
| Phase 2 P28 | 14min | 3 tasks | 11 files |
| Phase 02 P33 | 12min | 3 tasks | 19 files |
| Phase 2 P36 | 8min | 3 tasks | 10 files |
| Phase 02 P41 | 6min | 3 tasks | 6 files |
| Phase 2 P15 | 40min | 3 tasks | 25 files |
| Phase 02 P26 | 27min | 3 tasks | 14 files |

## Accumulated Context

### Decisions

Locked set is in PROJECT.md `<decisions>`: DEC-OWN-1..12 and DEC-PORT-1..3.

- [Roadmap]: Breadth-first; REQ-work-order-v2-depth-first is superseded (DEC-OWN-1).
- [Roadmap]: Phase 2 is organised as lanes L1 world, L2 actors, L3 data + UI, plus integration; UI runs in parallel from the start (DEC-OWN-6).
- [Roadmap]: Stage A bar is the lighter per-part check; fixed thresholds live in Phases 5 and 6 (DEC-OWN-3).
- [Roadmap]: Phase numbering is PORT_SCOPE phase + 1 for phases 1 to 4; Phases 5 and 6 are the polish stage.
- [DEC-OWN-8]: Babylon.js Editor leaves the build and runtime path. NOED-01..05 are Phase 1 integration work, merged before any Phase 2 lane starts. Per-tile Editor scenes are dropped; optional viewer work is VIEW-01 (v2). `stage-webgpu-compilers` stays in dev and build (runtime needs glslang/twgsl).
- [Phase 1]: 01-02: FOUND-03 stays pending until plan 01-13 records recipes/reference-client-tree.lock.json; the guard and tooling exist and are tested on synthetic trees
- [Phase 1]: 01-02: lock hashingScriptSha256 covers the walker with CRLF normalised to LF
- [Phase 01]: 01-07: MapSources.get carries the per-file require_equal_file check for every map package reader; world entry points call require_reference_client right after parse_args
- [Phase 01]: Plan 01-08: the scan test tests/pipeline/test_client_entry_points.py fails if any --client entry point skips require_reference_client; all 23 call it
- [Phase 01]: Plan 01-08: the UModel -path gap is recorded in deferred-items.md (OVERNIGHT-DECISIONS row 21) and must close before plan 01-13's lock enables E: conversion
- [Phase 1]: 01-01: lane ownership is by lane (world, actors, data-ui, integration) in .planning/lanes.json; Stage B parts 12-19 sit in integration until Phase 4
- [Phase 1]: 01-01: every native-store writer script stays integration-owned; scripts/check-lane-ownership.mjs exits 1 on foreign paths and 2 on a part/slug branch whose part names no lane (OVERNIGHT-DECISIONS row 22)
- [Phase 01]: 01-13: reference client lock committed; lock keys keep the on-disk spelling (system/engine.dll) and lookups casefold
- [Phase 01]: 01-13: dat inventory counts are decode list lengths or quoted Elbera evidence, else unknown; no UModel conversion on E: until plan 01-12
- [Phase 01]: Plan 01-03: item:<id> is one converted record listing every backing equipment model and player profile; section and mover loaders return null when the native store is not staged (OVERNIGHT-DECISIONS row 26)
- [Phase 01]: Plan 01-03: readNativeCatalog is the only /l2/catalog.json reader (memoised per AbortSignal); L2-ID keys npc:, item:, skill:<id>:<level>, window:, tile:<XX_YY> resolve through buildNativeCatalogIndex
- [Phase 01]: 01-04: native route builds scene, camera, lights and fog in code from presentationConfiguration (saved Editor values, labelled presentation, formerly Editor-authored, not L2); authored=1 only via dynamic import of authoredNativeWorld.ts
- [Phase 01]: 01-04: NativeParityScript field defaults read nativeSandboxConfiguration; parity test pins both configs to the saved Editor JSON
- [Phase 01]: Plan 01-05: createNativeSliceRuntime takes its camera and a NativeSliceWorldSource; the catalog source is the default and Editor world handling lives in src/editor/authoredNativeWorldSource.ts, passed only by NativeParityScript
- [Phase 01]: Plan 01-05: PresentationConfiguration.source is named files; sheet variables cite them with the formerly Editor-authored label (OVERNIGHT-DECISIONS rows 28-29)
- [Phase 01]: Plan 01-05: the dev sheet keeps its last tab; nativeSlice.spec selects the General tab before Resume (row 30)
- [Phase 01]: Plan 01-10: both adapters share pure by-ID command helpers in src/world/sandboxCommands.ts; equip-item replaces equip-upper with slot upper only; cast-skill emits a skill-cast record and computes nothing
- [Phase 01]: Plan 01-10: MockWorldAdapter handles set-health through the clamp shared with NativeSliceAdapter (OVERNIGHT-DECISIONS row 31)
- [Phase 01]: Plan 01-12: asset.json v2 (source.path, clientBuild from the tree lock, converterVersion, model coordinates right-handed Y up metres); readers accept v1 and v2 until the integration thread restages public/l2
- [Phase 01]: Plan 01-12: Converter.run refuses before UModel starts unless the target package's transitive import closure is lock-equal (OVERNIGHT-DECISIONS row 32)
- [Phase 1]: 01-06: the default route builds its scene in code and starts createWorldRuntime from loadEnvironment; an unstaged reference world shows a not-staged status; the courtyard Editor scene and WorldScript are deleted
- [Phase 1]: 01-06: one shared attachScenePresentationGroup lists presentation values on both the default and native route sheets
- [Phase 01]: 01-09: dev and build run only stage-webgpu-compilers before Vite; Editor steps live in optional generate:editor and Editor-path tests in test:editor (tests/editor, 18 files)
- [Phase 01]: 01-09: tests/unit Editor scan covers Editor packages and src/scripts; splitting the authored cases of nativeSliceRuntime.test.ts is deferred (OVERNIGHT-DECISIONS row 34)
- [Phase 01]: 01-11: createCharacterVisual is the procedural character only; factories share the CharacterVisualFactory type
- [Phase 01]: 01-15: ARCH-04 stays pending until 01-14 lands its ARCH-04 edge truth; the src/world import boundary is now tested
- [Phase 01]: Sandbox NPC presentation resolves through the catalog index; an ID without a converted, loaded model gets a meshless label-only marker (npc:<id> not in catalog), never a stand-in body
- [Phase 01]: navigation.origin is built from x, y, z; spreading a Babylon Vector3 dropped every sandbox spawn on the native section (OVERNIGHT-DECISIONS row 38)
- [Phase 01]: Catalog lookup text has one owner (describeNativeCatalogLookup) and the Power Strike bundle id one name (powerStrikeEffectBundleId)
- [Phase 01]: 01-16: Babylon Inspector 9.27.1 lazy-loaded behind ?inspect=1; peers pinned exactly after an automated legitimacy check (OVERNIGHT-DECISIONS row 39); Playwright check runs on the sandbox route
- [Phase 01]: Plan 01-17 deletes browser cases that only exercised the Talking Island reference route and re-points the generic WebGPU, loading-panel and asset-package checks to ?world=interlude (OVERNIGHT-DECISIONS row 44)
- [Phase 01]: The private preview scripts read the ?world=interlude route, catalog path and origin from scripts/private-preview-targets.mjs; the burst diagnosis HEADs the built catalog and section resources
- [Phase 02]: Plan 02-10: only spawn-character and play-clip join WorldCommand (14 members); tile stays a ?map= reload, audio stays on the mixer (OVERNIGHT-DECISIONS row 60, owner review)
- [Phase 02]: Plan 02-10: spawned characters are remote-player entities carrying only characterTemplateIndex; presentation reads characterTemplateIndex and requestedClip { clipName, requestSequence } (rows 61 and 62)
- [Phase 02]: Plan 02-10: both adapters dispatch exhaustively; an unknown runtime command type throws a RangeError; clip names are 1 to 128 UTF-16 code units kept verbatim (rows 63 and 64)
- [Phase 02]: Plan 02-10: ACT-01 and ACT-04 stay Pending; 02-36, 02-37, 02-39 and 02-40 deliver the rest of each requirement (row 66)
- [Phase 02]: 02-11: WORLD-07 review ran before the world tracers; a fresh-context headless Claude reviewer re-hashed 74/74 rows and gave 47 verdicts (12 adopted, 21 rejected, 14 polish), owner review (OVERNIGHT-DECISIONS rows 67-68)
- [Phase 02]: 02-11: absolute path fields in WORLD-07 fixtures are dropped with their JSON pointers and keep only a Basename sibling field; COMPOSITION_SUMMARY.json is not copied (row 69)
- [Phase 02]: 02-11: WORLD-07 stays Pending until 02-15 and 02-45 deliver the converter steps for the adopted findings (row 70)
- [Phase 02]: Plan 02-01: scripts/native_store/store_paths.py owns the path helpers and require_converter_output; Converter.__init__ and native_batch.prepare call it first, proven against real NTFS junctions (OVERNIGHT-DECISIONS rows 71-76)
- [Phase 02]: Plan 02-01: converter outputs live only in a dedicated folder under artifacts/; the export scripts pass their ROOT to Converter; scratch/ converter caches are refused (rows 74 and 79)
- [Phase 02]: Plan 02-01: measured red baseline is the 2 nativeNpcProfiles cases; the suite-load 5000 ms timeouts were fixed at the root on 2026-11-09 (cheaper fixtures, one helper owner, Vitest `maxWorkers: "50%"`), superseding row 77 (row 300)
- [Merge]: native-world-slice merged (DEC-OWN-11): `/` opens the code-built native sandbox, the `world` parameter, Talking Island route, courtyard demo, `MockWorldAdapter` and procedural characters are gone, and `NativeSliceAdapter` is the only adapter (OVERNIGHT-DECISIONS row 80)
- [DEC-OWN-12]: UE2 materials and fog, the BSP visibility walk, MoveActor and APawn movement, particle emitters, and network framing, codec and replay are our own code modelled on Lineage2JS (notes in `.planning/reference/lineage2js/`); the owner-delegated defaults D1-D7 are in PROJECT.md. MAT-01, MAT-02, VIS-01, MOVE-01 and FX-01 are Phase 2, MOVE-02, NET-09 and NET-10 Phase 4, all provisional, owner review (OVERNIGHT-DECISIONS rows 81-88)
- [DEC-OWN-12]: Under MAT-02, fog and lighting move from presentationConfiguration to L2 data (ZoneInfo, L2FogInfo, Env.int); presentationConfiguration then keeps only camera and debug values. Until MAT-02 lands, its saved Editor fog and light values are the interim state
- [Phase 2]: 02-02: one seal driver, scripts/native_store/unit_ledger.py, over native_batch adapters (OVERNIGHT row 103)
- [Phase 2]: 02-02: Playwright machine-window guard runs at config load, not globalSetup (row 104)
- [Phase 2]: 02-02: gap rows use one schema and a closed reason list; lanes extend it in recipes/<lane>/gap-reasons.json (rows 108, 111)
- [Phase 2]: 02-02: INT-01 and WORLD-03 stay Pending (row 112)
- [Phase 2]: Plan 02-03: lane converters write through catalog_writer (read_store_catalog, merge_catalog_slice, add_store_file, write_store) and pin with write_lane_catalog.py; identical duplicate records kept once, differing refused; --plan prints the pre-02-24 restage line (OVERNIGHT-DECISIONS rows 114 to 122)
- [Phase 2]: 02-06: NATIVE_STORE_ROOT takes the lanes.json keys plus fixture (committed tests/fixtures/lane-store/l2); catalog and coverage only from the selected root, other /l2/ paths fall back to public/l2 read only, X-Native-Store-Source names the store (rows 123-125)
- [Phase 2]: 02-06: the switch is serve-only and proven absent by resolveConfig in both modes plus a publicDir false bundle grep; no THIRD_PARTY_NOTICES.md, attribution stays in docs/SOURCE_REUSE.md (rows 126-127)
- [Phase 2]: 02-06: load-check records live in artifacts/lane-store/<lane>/load-checks/<catalogSha256>.json, one record per key, sorted, atomic rewrite; INT-01 and WORLD-05 stay Pending (row 130)
- [Phase 2]: 02-08: CONV-02 contract in tests/pipeline/test_source_preservation_contract.py; normalisation ban allow-lists only scripts/audit_musveren_weights.py, WEIGHTS_0 allow-list adds rigid.py read-only (rows 132-133)
- [Phase 2]: 02-08: editor member removed from recipes/native-parity.acceptance.json; POL-01 members pinned to plan-start bytes at bcb3b1a, new file SHA-256 bdbff732 in docs/NATIVE_PARITY.md (row 135)
- [Phase 2]: 02-08: Source preservation lists 15 steps, 2 unresolved (zero-tangent repair); CONV-01 proven by import closure and selectors, receipts stay with 02-14 and 02-43; CONV-01 and CONV-02 stay Pending (rows 134, 137, 139)
- [Phase 02]: 02-09: the owner's SHA-256 proof (a763a0c) wins over the plan's size and time shortcut; Converter digests come from the guard's identity-cached proof, no second memo (OVERNIGHT row 141)
- [Phase 02]: 02-09: new converter outputs keep logs, non-glTF work files and evidence/export-manifest.json; intermediate .gltf and .bin are hash-listed only (row 144)
- [Phase 02]: 02-09: export-native-sounds.py verifies the export manifest exactly; converterVersion change makes earlier cache records miss once (rows 145, 146)
- [Phase 02]: Plan 02-56: typed payload layout is list order at 4-byte boundaries with zero padding and no trailing bytes, names <GROUP>.<field> (row 150)
- [Phase 02]: Plan 02-56: sourceFrame heading 0 along source +X, 16384 along source +Y, as Babylon rotation.y = -heading * pi / 32768 (row 151)
- [Phase 02]: Plan 02-56: placement uses the sine table like native_map_geometry.py; the half-turn entry is its own unconfirmed row (row 152)
- [Phase 02]: Plan 02-56: MOVE-01, VIS-01, MAT-01 and FX-01 stay Pending; shared foundations only (row 156)
- [Phase 02]: Plan 02-04: tiles, tables and windows records validated by validate_catalog_record inside merge_catalog_slice; native-tile-runtime and native-tile-chunk-runtime v1 layouts, 4x4 chunk id rule and size bounds (rows 159, 163, 164)
- [Phase 02]: Plan 02-04: tile resource kinds and mask UV rules beyond the base come from the world-owned recipes/world/tile-manifest-vocabulary.json, which the loader requires; 02-16 creates it with empty lists, world plans append and bump listVersion (row 160)
- [Phase 02]: Plan 02-04: tests/fixtures/catalog-index-keys.json is the writer-half key contract that 02-05 and 02-07 assert; coverage rows carry steps (rows 162, 165)
- [Phase 02]: Plan 02-04: INT-01, WORLD-01, UI-01 and DATA-01 stay Pending; writer half only (row 169)
- [Phase 02]: 02-18: texture package census adds referenceTreeLockSha256 to {schemaVersion, packages}; 28 of 48 systextures packages are on reviewed texture versions, L2UI_CH3, l2ui and L2_RadarMap are 118/0 and town_map is 123/23 (unreviewed)
- [Phase 02]: 02-18: UI-02 stays Pending; the census is only an input to the window plans (OVERNIGHT-DECISIONS row 171)
- [Phase 02]: 02-21: conversion unit key is <kind>:<sha256> over canonical ASCII JSON of the exact selection, owned by actors.actor_unit_inventory.conversion_unit_key (OVERNIGHT-DECISIONS 176)
- [Phase 02]: 02-21: actor census resolves textures against lock-equal .utx and .ukx, hair groups gate only the hair gap unit, census rows carry no sourceIdentity.object, --check compares parsed content (rows 179-182)
- [Phase 02]: 02-21: ACT-01, ACT-02, ACT-03, ACT-05, ACT-06 stay Pending; the census gives every actor row a status but converts nothing (row 186)
- [Phase 02]: 02-32: sourceBinding.slotBindings request field and one binding evidence shape for both forms; source_table_binding.py owns the check and override parsing (row 187)
- [Phase 02]: 02-32: ACT-02 stays Pending; the verifier widening converts nothing, 02-34 converts the multi-texture NPC units (row 188)
- [Phase 02]: 02-57: recast moves to devDependencies at 0.43.0 (Editor navmesh plugin test); tests/unit/importBoundaries.vendor.test.ts keeps recast, @babylonjs/materials and @babylonjs/node-particle-editor out of src/** outside the lazy inspector entry and forbids Babylon particle systems and collision movement (rows 189-190)
- [Phase 02]: 02-57: tools/reference-overlap/ is the one overlap check for the five DEC-OWN-12 areas: 12-token reviewer runs, 20-token blocking runs outside the constant allowlist, identifiers matched under consistent renaming, exit 2 for an absent or unpinned clone; worktrees pass --reference-root C:/laragon/www/l2-browser-client (rows 191-195)
- [Phase 02]: 02-57: MAT-01, VIS-01, MOVE-01 and FX-01 stay Pending; the first overlap run leaves bsp-visibility, movement and particles red with 17 generic blocking runs in the 02-56 shared modules for reviewer sign-off (rows 193, 196)
- [Phase 02]: 02-59: one class-default reader, scripts/native_assets_lib/class_defaults.py read_class_defaults_with_provenance(class_name, fields, work_root, class_scripts): authored, class-default or ue-zero, the most derived declaration wins (Engine.Shader redeclares AlphaRef), cache under <work_root>/class-defaults/ (OVERNIGHT-DECISIONS rows 197-198)
- [Phase 02]: 02-59: read_material_graph keeps any root's nodes, tags and references, AnimNext loops kept and other cycles refused; derive_material_program types every field with provenance; native-materials/<sha of program.json>/graph.json and program.json; reasons material-class-unported:<qualified class> and material-feature-unported:<property>, seed listVersion 2 (rows 199-202)
- [Phase 02]: 02-59: Interlude material census from export tables of 830 lock-equal packages: 20 classes, 14 reviewed, 6 material-class-unported (GlowModifier, Cubemap, VertexColor, Fire.FireTexture, Fire.WetTexture, TexOscillatorTriggered); MAT-01 and CONV-02 stay Pending (rows 203-205)
- [Phase 02]: readNativeCoverageUnlessAbsent takes servedCatalogSha256 as a second parameter; buildNativeCatalogIndex(catalog, signal) keeps its signature (OVERNIGHT-DECISIONS row 206)
- [Phase 02]: NativeCatalog.servedCatalogSha256 is the SHA-256 of the served catalog bytes; coverage for another catalog is refused (row 207)
- [Phase 02]: Coverage pass rows are ignored; gap, pending and failed rows answer gap only for keys with no index entry (row 209)
- [Phase 02]: src/runtime/sandboxNpcVisual.ts narrows on status !== converted for the gap member; one foreign path in the npcs ownership check (row 211)
- [Phase 02]: 02-07: docs/coverage.md is the committed coverage table, regenerated by pnpm report:coverage (row 213)
- [Phase 02]: 02-07: denominators only from the dat table inventory and the reference lock; ui, sandbox, audio, minimap and movement-geodata unknown; items 9238 shown with its inventory countSource (rows 217, 220)
- [Phase 02]: 02-07: failed rows count under gap, unlisted keys of counted denominators count as pending, keys outside an enumerated denominator are refused (rows 215, 216, 221)
- [Phase 02]: 02-07: INT-01 and WORLD-03 stay Pending until staging, sandbox marks and the 02-12 tile census (row 222)
- [Phase 02]: Plan 02-17: inventory counts come only from sealed table decodes of the locked source (row 224); sysstring-e strict decode fails, DATA-03 verdict count-unresolved with the ASCF rule left to the owner (row 227); actor_census names its eight tables now that TABLES lists 37 pinned layouts (row 228)
- [Phase 2]: 02-19: build_tree nodes pair with scan records by textures list identity with a one-to-one guard; the pinned Elbera loader runs the compiled AST of the hashed bytes (OVERNIGHT-DECISIONS 232, 234)
- [Phase 2]: 02-19: docs/parts/ui/interface-window-census.json is the windows denominator (rootWindowCount 248); tests assert only 165 declared; lane unit outcome helpers shared by both data-ui converters; UI-01 Complete (rows 235, 237, 238)
- [Phase 02]: 02-24: merge_lane_store.py runs only in the main checkout (git-dir equals git-common-dir, cwd is the top level) into <cwd>/public/l2; --plan prints its exact command running this worktree's script by absolute path; duplicate ids are refused even when identical; catalog_writer.pinned_store_files owns the pinned-file rule (OVERNIGHT rows 239-245)
- [Phase 02]: 02-60: one UE2 material library in src/materials/ue2 (Babylon-free model, one blend table keyed by enum ordinal, fog with fogEnd, display gamma ramp, one GLSL ShaderMaterial factory, swatch harness keyed by program SHA-256); texture image pins and the materials overlap sign-off stay open; MAT-01 Pending (OVERNIGHT-DECISIONS rows 246 to 257)
- [Phase 2]: 02-12: census terrain-height gate by T_XX_YY.utx package name until 02-13 reads TerrainInfo.TerrainMap (A11); terrainMapPackage null (OVERNIGHT row 260)
- [Phase 2]: 02-12: 20_20 oracle placements pinned by SHA-256 of their compact canonical matrix JSON, not stored matrices (row 261)
- [Phase 2]: 02-12: eligible tiles get census gap row pending step-pending:raw; terrain-height-version-unsupported:<version> listed in recipes/world/gap-reasons.json (rows 262, 263)
- [Phase 02]: 02-20 rows 268-272: CP and MP are adapter-field-absent gaps (steps field-cp, field-mp); the field binding is the unverified recipes/data/window-field-bindings.json read through ?raw; the Converter owns UI texture policy (StatusWnd's 19 L2UI_CH3 references decode-failed:FormatError); anchors start at the parent origin; one textures gap row per window with every outcome in its evidence file
- [Phase 02]: 02-20 rows 273-276: anchor proof label owned by nativeWindowAnchors.ts; layer open takes no signal; ui-textures.json adds packageSha256 and reason; UI-02 stays Pending until 02-38
- [Phase 02]: Plan 02-22: one models record per (mesh, ordered textures), id = unit key; profiles join by modelCatalogId (row 277)
- [Phase 02]: Plan 02-22: actors lane catalog not pinned; write_lane_catalog refuses relative file pins in npc profile manifests, restage waits on integration (row 287)
- [Phase 02]: Plan 02-22: npc:20001 spawn by id proven on the harness page; sandbox spawn open (row 279); ACT-02 stays Pending (row 290)
- [Phase 2]: 02-27: name index tables records are npcname_e_names, itemname_e_names, skillname_e_names because the 02-04 id rule refuses npcname-e-names; catalog_writer.is_table_name_index_id keeps them outside the coverage data denominator (OVERNIGHT-DECISIONS rows 292 and 293)
- [Phase 2]: 02-27: eula-e, servername-e and questname-e stay decode-failed gaps with no tolerance and no NaN encoding; DATA-01 stays Pending (OVERNIGHT-DECISIONS rows 294 and 297)
- [Phase 02]: 02-23: fetchVerifiedAssetPackage reuses the exported loadNativeModelPackages archive loader; windows and skills load-check records carry assetManifestSchemaVersion null; the tiles sweep is plan 02-70 (OVERNIGHT-DECISIONS row 303)
- [Phase 2]: 02-13: terrainMapPackage is an object with a basis field (TerrainInfo.TerrainMap or package-name), null on non-tile rows (OVERNIGHT-DECISIONS 304)
- [Phase 2]: 02-13: map-gate-fail tiles keep the by-name terrain gate until their map reader exists, 02-52 (305); census committed with the code in Task 1 (306); WORLD-03 and WORLD-01 stay Pending (307)
- [Phase 02]: 02-14: raw products in the world lane work root under products/, never the served tree (row 308)
- [Phase 02]: 02-14: receipt inputs hold only the map lock eSha256; every package read is listed in products/source-dependencies.json (row 312)
- [Phase 02]: 02-14: hand-chosen 20_20 windows labelled with a top-level unresolved list, reason hand-chosen-presentation-window; WORLD-01 stays Pending (rows 311, 314)
- [Phase 2]: 02-28: hairgrp, helmetgrp and hairaccessarygrp decode through the pinned Elbera hair_pairs and keyed_hair_pairs on route elbera-adapter; descriptorSha256 holds the Elbera script SHA, the proof label lives in the receipt, inventory and evidence (OVERNIGHT-DECISIONS rows 317 and 318)
- [Phase 2]: 02-28: hairgrp cross-checks recorded, not resolved: 258 of 450 words are -1 against the pinned UCHAR layout, the flat ddf declares 120 CHAR fields per record; DATA-02 Complete with field meanings unverified on 4dd2 (rows 320, 321 and 323)
- [Phase 02]: 02-33: NPC profiles join models only through joinNpcProfileToModel by modelCatalogId; legacy-single-mesh-match kept only for the shared-store record native-npc-profiles, npc-model: records never candidates, ending with the Needs Human (plan 02-05) restage (OVERNIGHT-DECISIONS rows 326, 327)
- [Phase 02]: 02-33: NPC profile bounds 64 bundles x 256 profiles in Python and TypeScript, pinned by tests/unit/nativeNpcProfileBounds.test.ts; nativeSliceNpcIds [21622] (rows 324, 325)
- [Phase 02]: Plan 02-36: typed clip events in src/assets/native/actorClipEvents.ts, listing and play API in src/animation/actorClipPlayback.ts (OVERNIGHT-DECISIONS row 329)
- [Phase 02]: Plan 02-36: the clip hub answers actorClipEntityIds and actorClipListing in place of available; play delegates to playActorClip with unchanged refusal texts (row 330)
- [Phase 02]: Plan 02-36: a malformed asset.json event fails the actor load with ActorClipEventsError; all 1,740 served-store events parse; ACT-04 stays Pending until 02-37 and 02-39 (rows 66 and 331)
- [Phase 02]: Plan 02-41: equipment slots are upper or body-part:<value>, the source body_part value in canonical decimal; equipmentSlotForBodyPart owns the key form and upper stays as its own key sorted first (OVERNIGHT-DECISIONS rows 332, 333)
- [Phase 02]: Plan 02-41: a repeat equip and an unequip of an empty slot keep the row 46 confirmation update with the unchanged entity, against the must-have wording, so the sandbox sheet acceptance check holds; ACT-03 stays Pending until 02-21 and 02-42 (row 334)
- [Phase 2]: 02-15: tiles plan as TerrainInfo-derived 4x4-sector chunks chunk-<column>-<row>; every chunk terrain labelled extrapolated (OVERNIGHT-DECISIONS 335-337)
- [Phase 2]: 02-15: anchor = first PlayerStart whose bEnabled resolves true from its tag or the Engine.PlayerStart class chain; unresolved gives a null anchor (row 338)
- [Phase 2]: 02-15: per-chunk gap rows name the first failing qualified sector, not the chunk id; empty layer slots stay listed; the chunk planner replaces the hand-chosen 20_20 XY windows (rows 339-341)
- [Phase 02]: 02-26: census status precedence converted, failed, gap, pending; reason from the latest step in GAP_CENSUS_STEP_ORDER (OVERNIGHT row 346)
- [Phase 02]: 02-26: seed reason item-group-row-absent (listVersion 3); etcitem and ungrouped item rows are integration lane census rows (rows 347, 348)
- [Phase 02]: 02-26: --census-lanes reads gap rows, converted keys and lane-pinned load checks; a report measures only its lanes' parts; output artifacts/lane-store/integration/coverage-census.json (rows 349, 350)
- [Phase 02]: 02-26: denominators from committed files only, chargrp 15 with no padding row subtracted; unchanged reruns keep generatedAtRiga; INT-01 stays Pending (rows 351 to 353)

### Pending Todos

- Unexecuted Phase 2 plans written before the merge still name removed code: 02-20 and 02-41 build their tracers on `MockWorldAdapter` (use `NativeSliceAdapter`), and 02-23 opens `/?world=interlude&map=20_21` (use `/?map=20_21`).
- Commit the main checkout's uncommitted code before lanes start (lanes branch from committed code only). Planning files are committed (1b1b0b7).
- Data-ui approval is still needed for `read_class_defaults` (`scripts/native_catalog/effects.py:264`) to become a thin caller of the integration `scripts/native_assets_lib/class_defaults.py` or be removed; actors approved the same for `DefaultReader` in `scripts/native_effect_bundle.py` (Lineage2JS handoff, FX-01).

### Blockers/Concerns

- Stage A exit threshold on the gap list is undefined: DEC-OWN-7 allows failing tiles as gaps while the success metric says every part is converted. Owner to say how many gaps still count as stage A done.
- Phase 1 needs ssh access to IMPORTA-PC (`fleet-importa-pc`) for the full-tree hash lock.
- `hairgrp` and `helmetgrp` have no layout in the local descriptor; Elbera route may also lack them (blocks source-backed hair for ACT-01).
- Streaming/LOD (WORLD-04) is a dependency of walking 153 tiles; the current native loader loads eagerly.
- Native reference capture fails the fixed 30 FPS cadence gate (4.1 FPS) and DATABASE-PC has no 120 Hz display; both gate Phases 5 and 6, not stage A (screenshots and listen checks).
- Native UI layouts from `interface.xdat` versus custom HUD tokens: settled by DEC-OWN-10 (2026-11-08, commit 62741d8): the original Interlude interface only, skin, fonts and icons from converted UI textures; DESIGN.md deleted.
- Mobius transport (dumb relay) is a recommendation, not decided; decide at the start of Phase 4. Elbera `gateway/` and `editor/` are read-only behaviour references, not port sources (NET-03, DEC-OWN-12).
- Client-side collision next to a server-authoritative adapter: settled by DEC-OWN-12 (2026-11-08): converter collision feeds the MOVE-01 port, which moves pawns between server updates and drives sandbox walking; the server stays authoritative (MOVE-02); Phase 4 settles correction thresholds only.
- If main is ever merged with this branch, bce4a04/06bdbda edit docs/ROADMAP.md, PRODUCT.md and NOTICE, which this branch deleted: keep the deletions.
- Lane tool support for this repo is not available on DATABASE-PC yet; use plain `git worktree` until it lands.
- Count differences to check in the decoder inventory: 435 vs 433 `.utx`, `chargrp` has 15 rows.
- The 02-23 tiles sweep is plan 02-70, which runs after 02-16 (wave 9; OVERNIGHT-DECISIONS row 303). 02-23 is complete with Tasks 1 and 2 (02-23-SUMMARY.md).

## Needs Human

- Needs Human (plan 01-12): restage `public/l2` to asset.json v2 from the main checkout (integration thread only; lanes never restage the store). Converters now write v2; the staged store is still v1.
- Needs Human (plan 01-12): after that restage, delete v1 acceptance in `src/assets/package/readAssetPackage.ts`, `src/effects/nativePowerStrikeSource.ts` and `scripts/native_assets_lib/asset_manifest.py`, and regenerate the golden fixtures without `model-v1.l2asset` (see docs/OUTPUT_CONTRACT.md, "Transition from v1").
- Needs Human (independent review IR-08): `scripts/build_dat_table_inventory.py` records the Elbera evidence counts of sysstring-e and systemmsg-e as 2083 each, copied from docs/PORT_SCOPE.md section 2. Two tables with the same count may be a copy error in the source note; confirm both counts against the reference client before DATA-03 relies on them.
- Needs Human (phase 1 code review, OVERNIGHT-DECISIONS row 49): review the behaviour-changing fixes CR-101, CR-102, WR-102, WR-401, CR-301 and the partial WR-310 and WR-501.
- Needs Human (01-VERIFICATION.md): choose the E: scope of `inventory()` in `scripts/native_catalog/cli.py`, lock-equal files only or IMPORTA-PC only; today it hashes every E: file behind the entry check.
- Needs Human (01-VERIFICATION.md): confirm the five prohibitions that can only be judged, not tested.
- Needs Human (phase 1 verification): Phase 1 is human_needed with 6 of 6 criteria verified; it stays pending until the items above are reviewed. The autonomous run continues with Phase 2 (OVERNIGHT-DECISIONS row 59); Phase 1 is not marked complete.
- Resolved (plan 02-57, OVERNIGHT-DECISIONS rows 193, 258 and 299): the 17 blocking runs and 956 reviewer runs in the 02-56 shared modules are signed off by independent fresh-context Claude reviewers (`tools/reference-overlap/signedOffRuns.json`, `tools/reference-overlap/reviewedRuns/`); bsp-visibility, movement and particles exit 0 with `--require-reviewed`. The owner may revoke any entry.
- Needs Human (plan 02-05): after the restage that brings profiles with modelCatalogId (02-22 and later) into public/l2, delete the mesh-name NPC join for profiles without modelCatalogId in src/assets/native/nativeCatalogIndex.ts (an actors-lane change in a later plan)
- Needs Human (plan 02-05, OVERNIGHT-DECISIONS row 211): `node scripts/check-lane-ownership.mjs --base 606ae66 --part npcs` lists one foreign path, `src/runtime/sandboxNpcVisual.ts` (integration), changed from `status === "not-in-catalog"` to `status !== "converted"` so the new `gap` lookup answer typechecks; the integration owner confirms or moves the line.
- Needs Human (plans 02-17 and 02-19): restage C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap/artifacts/lane-store/data-ui/l2 into C:/laragon/www/l2-browser-client/public/l2 from the main checkout with the lane store merge tool of plan 02-24 (expected base catalog sha256 55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe, lane catalog sha256 89aa9e6a142fbb2b044784e8b7088c13a7908cac3d4f3a116692646a1d13cb58); printed by `python -B scripts/native_store/write_lane_catalog.py --lane data-ui --plan` after plan 02-19 added the 248 `windows` records
- Needs Human (plan 02-20): restage the data-ui lane store with `cd C:/laragon/www/l2-browser-client && python -B C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap/scripts/native_store/merge_lane_store.py --lane-store C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap/artifacts/lane-store/data-ui/l2 --target public/l2 --expected-base-catalog-sha256 55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe` (printed by `python -B scripts/native_store/write_lane_catalog.py --lane data-ui --plan`); plan 02-20 added no catalog record (lane catalog still 89aa9e6a), only gap rows and a load check. StatusWnd stays unskinned until the Converter's package reader supports UE2 118 (L2UI_CH3, l2ui, L2_RadarMap).
- Needs Human (plan 02-17, OVERNIGHT-DECISIONS row 227, answers IR-08 in part): the strict decode of sysstring-e fails with `FormatError: Unterminated Unreal string`; its header declares 2083 records and systemmsg-e decodes strictly to 2083 (`docs/parts/data/sysstring-systemmsg-counts.json`, verdict count-unresolved). An untracked probe put the first failing row at index 1551 (stringID 1551, decoded offset 27677), a one-byte ASCF whose only byte is 0x20, not NUL. Decide whether ASCF follows the pinned dat_engine `read_ascf` rule (drop the last byte unchecked) so sysstring-e can decode, or stays strict.
- Needs Human (plan 02-17, OVERNIGHT-DECISIONS row 228): `node scripts/check-lane-ownership.mjs --base 87ca690 --part data` lists one foreign path, `scripts/actors/actor_census.py` (actors), which now names its eight tables in `ACTOR_CENSUS_TABLES` because `TABLES` lists all 37 pinned layouts; the actors owner confirms or moves the constant.
- Needs Human (plan 02-60, OVERNIGHT-DECISIONS rows 254 and 298): the materials overlap review signed off all 171 blocking runs and reviewed 4,549 of 4,560 reviewer runs; 11 reviewer runs stay open for the owner (listed in `docs/parts/adapter-dispatch/EVIDENCE.md` "Materials sign-offs"): `node tools/reference-overlap/referenceOverlap.mjs --area materials --require-reviewed --reference-root C:/laragon/www/l2-browser-client` exits 1 on them, and exits 0 without `--require-reviewed`.
- Needs Human (plan 02-22): `python -B scripts/native_store/write_lane_catalog.py --lane actors --plan` prints no restage command; it exits 1 with `store file npc-profiles/b2a0489c1d4cc579ede4caaaa050f89347342acd71eeb66416e2dad2236341d2/manifest.json pins 'source/classes/Core.Object.bin' by a relative file name; only /l2 resource pins can be followed`. The actors lane store (`artifacts/lane-store/actors/l2`, catalog 2961c011bc33841f7e0f11b01dfd2b2ee5706005ddd3a4c8d9a12c5a40d90731, one `models` and one `npcProfiles` record) cannot be pinned or merged until the integration owner extends `catalog_writer.pinned_store_files` (and `merge_lane_store.py`) to follow a manifest's relative `{file, sha256}` pins under its own folder, or chooses another profile bundle layout (OVERNIGHT-DECISIONS row 287).
- Needs Human (plan 02-22): `npc:20001 sandbox spawn: open` (docs/parts/npcs/EVIDENCE.md): the integration owner wires `loadConvertedNpcModel` into `sandboxNpcAppearanceByModel` in `src/runtime/createNativeSliceRuntime.ts`, and the sandbox needs a served catalog holding the base records (player profile, `musveren:0`) together with the actors lane records.
- Needs Human (plan 02-33): no printed merge command; `python -B scripts/native_store/write_lane_catalog.py --lane actors --plan` exits 1 on 2026-11-09 04:51 Riga with `store file npc-profiles/b2a0489c1d4cc579ede4caaaa050f89347342acd71eeb66416e2dad2236341d2/manifest.json pins 'source/classes/Core.Object.bin' by a relative file name; only /l2 resource pins can be followed` (the plan 02-22 refusal), so the merge command it would print (`cd C:/laragon/www/l2-browser-client && python -B C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap/scripts/native_store/merge_lane_store.py --lane-store C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap/artifacts/lane-store/actors/l2 --target public/l2 --expected-base-catalog-sha256 <sourceCatalogSha256>`) waits on that pin rule. `scripts/stage_native_runtime.py` still refuses NPC profile bundles over 128 profiles, so lane NPC profiles restage only through that merge command. The restage that later rewrites the shared-store bundle with `modelCatalogId` (the plan 02-05 legacy join removal) must in the same change switch the `musveren:0` reads in `src/runtime/createNativeSliceRuntime.ts` to the joined id of `nativeSliceNpcIds`, because that restage re-keys the slice NPC model.
- Needs Human (plan 02-27): restage the data-ui lane store with `cd C:/laragon/www/l2-browser-client && python -B C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap/scripts/native_store/merge_lane_store.py --lane-store C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap/artifacts/lane-store/data-ui/l2 --target public/l2 --expected-base-catalog-sha256 55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe` (printed by `python -B scripts/native_store/write_lane_catalog.py --lane data-ui --plan`); lane catalog now 022a3af3 with 33 decoded tables and three name index records.
- Needs Human (plan 02-27, OVERNIGHT-DECISIONS rows 292 and 293): `node scripts/check-lane-ownership.mjs --base 798e712 --part data` lists three foreign paths, `scripts/native_store/catalog_writer.py` (`is_table_name_index_id`, `TABLE_NAME_INDEX_ID_SUFFIX`), `scripts/native_store/build_coverage_report.py` (drops `table:*_names` keys before the data denominator) and `docs/OUTPUT_CONTRACT.md` (the tables id row); the integration owner confirms the `_names` derived-id rule or widens the tables id contract.
- Needs Human (plan 02-27, OVERNIGHT-DECISIONS row 294): three more linked tables are sealed `decode-failed:FormatError` gaps: eula-e (`Unexpected safe-package trailer: eula: `, the pinned layout reads past the payload), servername-e (730 unread bytes before the SafePackage trailer) and questname-e (`Out of range float values are not JSON compliant: nan`, a FLOAT field decodes to NaN). Decide the layout fix for the first two and how a native-table manifest carries a NaN float.
- Needs Human (plan 02-28): restage the data-ui lane store with `cd C:/laragon/www/l2-browser-client && python -B C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap/scripts/native_store/merge_lane_store.py --lane-store C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap/artifacts/lane-store/data-ui/l2 --target public/l2 --expected-base-catalog-sha256 55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe` (printed by `python -B scripts/native_store/write_lane_catalog.py --lane data-ui --plan`); lane catalog now 41439f5c with the three `elbera-adapter` hair tables (hairgrp, helmetgrp, hairaccessarygrp).
- Needs Human (plan 02-28, OVERNIGHT-DECISIONS rows 320 and 321): the hair field meanings are Elbera's (Elbera 07b24 proof, unverified on 4dd2). On hairgrp 258 of 450 words are -1, which the local UCHAR layout reads as 255, and the flat ddf declares 120 CHAR fields per record against Elbera's 30 int32 words; the Phase 3 check against the 4dd2 Engine.dll decides which reading the client uses.
- Needs Human (plan 02-14): pnpm assets:migrate --verify-only in the main checkout is expected to refuse with a recipe pin error because recipes/native-map-20_20.json and recipes/native-map-debug-location.json now carry their unresolved window labels; whether to re-migrate those jobs or to retire the 20_20 chain after the oracle diff is the integration thread's decision (CONTEXT B, deferred), and the staged store is unchanged until then.
- Needs Human (plan 02-14): `scripts/native_batch_adapters.py` and `scripts/export-native-sounds.py` (integration-owned) list `native_map.py` in their own implementation file sets but not the moved `scripts/world/map_actor_properties.py`, `map_sources.py` and `terrain_height_texture.py`, so their fingerprints do not cover the moved code; the legacy `native_map.implementation()` now hashes the moved modules too, so legacy map receipts in the main checkout report "rebuild required" on verify.

- Needs Human (plan 02-34): no printed restage command; `python -B scripts/native_store/write_lane_catalog.py --lane actors --plan` exits 1 on 2026-11-09 08:46 Riga with `store file npc-profiles/8ac1569873a31eb75b7cd5d3e85efd9361b89e77aa599c862fcff6ac23e6c4fd/manifest.json pins 'source/classes/Core.Object.bin' by a relative file name; only /l2 resource pins can be followed` (the plan 02-22 refusal). The actors lane store (`artifacts/lane-store/actors/l2`, catalog 9a97925016665e9b0aefed5083fb4010eb4d7ea534c6b154c5b4b08404fa7ea1, 110 `models`, 6 `npcProfiles` packs with 1,496 profiles) restages only through the 02-24 merge command once the integration owner extends the pin rule; `scripts/stage_native_runtime.py` refuses bundles whose `requestedProfiles` exceed `resolvedProfiles`.
- Needs Human (plan 02-34, OVERNIGHT-DECISIONS row 367): 1,907 NPC batch rows name a class (195 classes, mostly `LineageNPC.*` and `LineageNpcEV.*`, whose package files are `lineagenpc.u` and `lineagenpcev.u`) and 36 rows a mesh that resolves only to another case spelling, so the exact-identity rule of `scripts/native_actor_profiles.py` keeps them `converter-refused` gaps. Decide whether package-qualified UE2 names match case-insensitively or stay exact.

## Deferred Verification

| Phase | State | Resume |
|-------|-------|--------|
| 1 | verification_deferred_human | /gsd-verify-work 1 |

## Deferred Items

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Polish list | Stair turns walked as in L2.exe, with no client routing | Phase 5 (POL-03) | 2026-11-08 | v1 |
| Polish list | Upper-landing camera roof occlusion | Phase 5 (POL-03) | 2026-11-08 | v1 |
| Polish list | Automatic surface footsteps (ALAudio.dll rules) | Phase 5 (POL-02) | 2026-11-08 | v1 |
| Polish list | Specialized attack sounds (six female events unresolved) | Phase 5 (POL-02) | 2026-11-08 | v1 |
| v2 | Real geodata movement display (GEO-01) | Deferred | 2026-11-08 | - |
| v2 | Sieges, Olympiad, Seven Signs, GM tools, boats windows (LATE-01) | Deferred | 2026-11-08 | - |

## Session Continuity

Last session: 2026-11-09T04:41:40.334Z
Stopped at: Completed 02-26-PLAN.md
Resume file: None
- Needs Human (OVERNIGHT-DECISIONS row 301): the actors lane confirms the import repoints in `scripts/prepare-native-player-aliases.py` and `scripts/test_effect_readiness.py`; the world lane points `scripts/world/copy_world07_fixtures.py` at `scripts/native_assets_lib/sha256_identity.py` and removes its pin from the owner scan in `tests/pipeline/test_converter_output_guard.py`.
