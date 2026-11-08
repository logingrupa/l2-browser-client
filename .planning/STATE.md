---
gsd_state_version: "1.0"
current_phase: 02
current_phase_name: Stage A breadth
status: executing
stopped_at: Completed 02-10-PLAN.md
last_updated: "2026-11-08T12:44:31.000Z"
last_activity: 2026-11-08
last_activity_desc: Phase 02 plan 02-10 complete (first Phase 2 plan executed)
state_head: d7f587051cbfc3924342230859c813d17901e406
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 72
  completed_plans: 18
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-08)

**Core value:** A fully converted Lineage II Interlude client that runs in the browser and matches L2.exe side by side, driven only by what a server sends.
**Current focus:** Phase 02 - Stage A breadth (Phase 1 verification deferred to the owner)

## Current Position

Phase: 02 (Stage A breadth) - EXECUTING
Plan: 02-10 complete, 1 of 55 plans executed
Status: Executing Phase 2; Phase 1 is verification_deferred_human (see Deferred Verification)
Last activity: 2026-11-08 - Plan 02-10 WorldCommand sandbox contract complete

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

## Accumulated Context

### Decisions

Locked set is in PROJECT.md `<decisions>`: DEC-OWN-1..10 and DEC-PORT-1..3.

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

### Pending Todos

- Commit the main checkout's uncommitted code before lanes start (lanes branch from committed code only). Planning files are committed (1b1b0b7).

### Blockers/Concerns

- Stage A exit threshold on the gap list is undefined: DEC-OWN-7 allows failing tiles as gaps while the success metric says every part is converted. Owner to say how many gaps still count as stage A done.
- Phase 1 needs ssh access to IMPORTA-PC (`fleet-importa-pc`) for the full-tree hash lock.
- `hairgrp` and `helmetgrp` have no layout in the local descriptor; Elbera route may also lack them (blocks source-backed hair for ACT-01).
- Streaming/LOD (WORLD-04) is a dependency of walking 153 tiles; the current native loader loads eagerly.
- Native reference capture fails the fixed 30 FPS cadence gate (4.1 FPS) and DATABASE-PC has no 120 Hz display; both gate Phases 5 and 6, not stage A (screenshots and listen checks).
- Native UI layouts from `interface.xdat` versus custom HUD tokens: settled by DEC-OWN-10 (2026-11-08, commit 62741d8): the original Interlude interface only, skin, fonts and icons from converted UI textures; DESIGN.md deleted.
- Mobius transport (dumb relay) is a recommendation, not decided; decide at the start of Phase 4. Elbera `gateway/` and `editor/` are unaudited.
- Whether client-side collision survives next to a server-authoritative adapter is open (Phase 4 design).
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

## Deferred Verification

| Phase | State | Resume |
|-------|-------|--------|
| 1 | verification_deferred_human | /gsd-verify-work 1 |

## Deferred Items

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Polish list | Automatic stair routing around turns | Phase 5 (POL-03) | 2026-11-08 | v1 |
| Polish list | Upper-landing camera roof occlusion | Phase 5 (POL-03) | 2026-11-08 | v1 |
| Polish list | Automatic surface footsteps (ALAudio.dll rules) | Phase 5 (POL-02) | 2026-11-08 | v1 |
| Polish list | Specialized attack sounds (six female events unresolved) | Phase 5 (POL-02) | 2026-11-08 | v1 |
| v2 | Real geodata movement display (GEO-01) | Deferred | 2026-11-08 | - |
| v2 | Sieges, Olympiad, Seven Signs, GM tools, boats windows (LATE-01) | Deferred | 2026-11-08 | - |

## Session Continuity

Last session: 2026-11-08T12:42:59.561Z
Stopped at: Completed 02-10-PLAN.md
Resume file: None
