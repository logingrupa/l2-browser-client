---
gsd_state_version: "1.0"
current_phase: 02
current_phase_name: Stage A breadth
status: executing
stopped_at: Completed 02-57-PLAN.md
last_updated: "2026-11-08T19:11:34.149Z"
last_activity: 2026-11-08
last_activity_desc: Phase 02 plan 02-57 complete (D7 vendor boundary and reference overlap check)
state_head: 5443433f6e0c0ebd2c5a48a0513fb83c948cf87a
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 86
  completed_plans: 31
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-08)

**Core value:** A fully converted Lineage II Interlude client that runs in the browser and matches L2.exe side by side, driven only by what a server sends.
**Current focus:** Phase 02 - Stage A breadth (Phase 1 verification deferred to the owner)

## Current Position

Phase: 02 (Stage A breadth) - EXECUTING
Plan: 02-57 complete, 14 of 69 plans executed
Status: Executing Phase 2; Phase 1 is verification_deferred_human (see Deferred Verification)
Last activity: 2026-11-08 - Plan 02-57 complete: `tests/unit/importBoundaries.vendor.test.ts` keeps `@recast-navigation/*`, `@babylonjs/materials` and `@babylonjs/node-particle-editor` out of `src/**` outside `src/scene/openBabylonInspector.ts` and forbids Babylon particle systems and collision movement; recast is a 0.43.0 devDependency only; `node tools/reference-overlap/referenceOverlap.mjs --area <materials|bsp-visibility|movement|particles|network>` lists 12-token reviewer runs and exits 1 on 20-token runs outside the allowlist, 2 on an absent or unpinned clone; its first run leaves three areas red on the 02-56 shared modules (Needs Human). Earlier: plan 02-32 complete: `Converter.verify_binding` verifies `sourceBinding.slotBindings: [{slot, texturePath}]` or the unchanged single form through `scripts/native_assets_lib/source_table_binding.py`; only table-cited slots bind with `native-table-selection`, uncited slots stay magenta, every override must be cited, and npcgrp npc 20003 (`LineageMonsters.goblin_m00`, two textures) verifies on the conversion client; ACT-02 stays Pending for 02-34. Earlier: plan 02-21 complete: `python -B scripts/actors/actor_census.py --client E:/Lineage2-client [--check]` reads the 20 lock `animations/` package headers and the 27 texture packages actor rows name through `require_equal_file`, and commits `docs/parts/npcs/actor-unit-census.json` with 7,532 units (633 NPC units per exact mesh and ordered textures, 15 chargrp rows with 30 hair and helmet gaps, 523 weapon and 4,688 armor units, 245 skill roots, 1,398 skill sound rows); every one of the 38,673 npc, character, weapon and armor item, and skill rows has one census gap row in `artifacts/lane-store/actors/gap-rows/census.json`; ACT-01, 02, 03, 05 and 06 stay Pending. Earlier: plan 02-18 complete: `scripts/data/texture_package_census.py` reads only the 128-byte header of each of the 48 lock-equal `systextures/*.utx` packages through `require_equal_file` and commits `docs/parts/ui/texture-package-census.json`: 28 on reviewed texture versions, 20 `texture-licensee-unsupported` (L2UI_CH3, l2ui, L2_RadarMap at 118/0, town_map at 123/23), no decode failures. Earlier: plan 02-04 complete: the catalog writer refuses malformed `tiles`, `tables` and `windows` records in every merge (`validate_catalog_record`), `scripts/native_store/tile_manifest_validation.py` validates `native-tile-runtime` and `native-tile-chunk-runtime` v1 against the world-owned `recipes/world/tile-manifest-vocabulary.json` (created by 02-16), the golden store gains tile 00_00, table syntheticfixture and window SyntheticFixtureWnd, `tests/fixtures/catalog-index-keys.json` pins the golden index keys, and `docs/OUTPUT_CONTRACT.md` states the contract the 02-05 reader implements. Earlier: plan 02-56, the shared Babylon-free modules, typed payload reader and source frame. Earlier: plan 02-09 complete: `Converter` takes every client digest from the reference client guard through `scripts/native_assets_lib/converter_source_digests.py` (one SHA-256 per file identity per process on lock-checked roots, every read on the reference root), pins compare against `recorded_source_sha256`, `implementation_hash` runs once per conversion, and new outputs keep logs, non-glTF exports and `evidence/export-manifest.json` through `scripts/native_assets_lib/conversion_evidence.py` instead of the whole work tree. Earlier: plan 02-08, CONV-02 and CONV-01 contract tests (`tests/pipeline/test_source_preservation_contract.py`, `tests/pipeline/test_converter_independence.py`), the OUTPUT_CONTRACT "Source preservation" section with 15 repair, restore and preserve steps, and the Editor round-trip block removed from `recipes/native-parity.acceptance.json` with every POL-01 member pinned. Earlier: plan 02-06, the serve-only `NATIVE_STORE_ROOT` dev switch (`vite/nativeStoreRootPlugin.ts`) serves `/l2/` from a lane store or the committed fixture store on port 5175, with catalog and coverage only from that root, proven absent from the production bundle; the load-check record format and its atomic per-key writer (`tests/browser/support/loadCheckRecordFile.ts`). Earlier: plan 02-03, one catalog writer library (`scripts/native_store/catalog_writer.py`) under every stager and importer, and `write_lane_catalog.py` with `--lane`, `--union` and `--plan`, pinning lane catalogs to the shared store's catalog SHA-256. Earlier: plan 02-02, one Riga machine schedule owner (`scripts/check-machine-schedule.mjs`, guarded in both Playwright configs), the resumable `UnitLedger` with `require_batch_preflight`, and the gap-row schema with the closed reason list. Earlier: applied the Lineage2JS reference handoff (DEC-OWN-12): eight provisional requirements MAT-01, MAT-02, VIS-01, MOVE-01, FX-01 (Phase 2) and MOVE-02, NET-09, NET-10 (Phase 4), v1 now 66; earlier the native-world-slice merge (DEC-OWN-11) left only the native routes

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
| Phase 02 P57 | 25 min | 3 tasks tasks | 20 files files |

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
- [Phase 02]: Plan 02-01: measured red baseline is the 2 nativeNpcProfiles cases plus at most one load-dependent 5000 ms timeout; no timeout or worker count changed (row 77)
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

## Needs Human

- Needs Human (plan 01-12): restage `public/l2` to asset.json v2 from the main checkout (integration thread only; lanes never restage the store). Converters now write v2; the staged store is still v1.
- Needs Human (plan 01-12): after that restage, delete v1 acceptance in `src/assets/package/readAssetPackage.ts`, `src/effects/nativePowerStrikeSource.ts` and `scripts/native_assets_lib/asset_manifest.py`, and regenerate the golden fixtures without `model-v1.l2asset` (see docs/OUTPUT_CONTRACT.md, "Transition from v1").
- Needs Human (independent review IR-08): `scripts/build_dat_table_inventory.py` records the Elbera evidence counts of sysstring-e and systemmsg-e as 2083 each, copied from docs/PORT_SCOPE.md section 2. Two tables with the same count may be a copy error in the source note; confirm both counts against the reference client before DATA-03 relies on them.
- Needs Human (phase 1 code review, OVERNIGHT-DECISIONS row 49): review the behaviour-changing fixes CR-101, CR-102, WR-102, WR-401, CR-301 and the partial WR-310 and WR-501.
- Needs Human (01-VERIFICATION.md): choose the E: scope of `inventory()` in `scripts/native_catalog/cli.py`, lock-equal files only or IMPORTA-PC only; today it hashes every E: file behind the entry check.
- Needs Human (01-VERIFICATION.md): confirm the five prohibitions that can only be judged, not tested.
- Needs Human (phase 1 verification): Phase 1 is human_needed with 6 of 6 criteria verified; it stays pending until the items above are reviewed. The autonomous run continues with Phase 2 (OVERNIGHT-DECISIONS row 59); Phase 1 is not marked complete.
- Needs Human (plan 02-57, OVERNIGHT-DECISIONS row 193): `node tools/reference-overlap/referenceOverlap.mjs --area <bsp-visibility|movement|particles> --reference-root C:/laragon/www/l2-browser-client` exits 1 with 17 blocking runs, all in the 02-56 shared modules (`src/shared/fixedStep.ts` 4, `presentationClock.ts` 4, `typedPayload.ts` 5, `math/vector3.ts` 3, `src/world/sourceFrame.ts` 1): argument guards, vector arithmetic and a tuple type matched against unrelated reference code. A reviewer who did not write `src/shared/**` signs off the spans in docs/parts/adapter-dispatch/EVIDENCE.md, or the owner narrows the area source globs or the normalisation in `tools/reference-overlap/`.

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

Last session: 2026-11-08T19:11:33.815Z
Stopped at: Completed 02-57-PLAN.md
Resume file: None
