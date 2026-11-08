---
gsd_state_version: "1.0"
current_phase: 1
current_phase_name: Foundations
status: executing
stopped_at: Completed 01-04-PLAN.md
last_updated: "2026-11-08T06:06:57.096Z"
last_activity: 2026-11-08
last_activity_desc: Phase 1 execution started
state_head: 96181452f66fe9693115ca6329f48fe80ba3115d
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 17
  completed_plans: 7
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-08)

**Core value:** A fully converted Lineage II Interlude client that runs in the browser and matches L2.exe side by side, driven only by what a server sends.
**Current focus:** Phase 1 — Foundations

## Current Position

Phase: 1 (Foundations) — EXECUTING
Plan: 8 of 17
Status: Ready to execute
Last activity: 2026-11-08 — Phase 1 execution started

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

## Accumulated Context

### Decisions

Locked set is in PROJECT.md `<decisions>`: DEC-OWN-1..8 and DEC-PORT-1..3.

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

### Pending Todos

- Commit the main checkout's uncommitted code before lanes start (lanes branch from committed code only). Planning files are committed (1b1b0b7).

### Blockers/Concerns

- Stage A exit threshold on the gap list is undefined: DEC-OWN-7 allows failing tiles as gaps while the success metric says every part is converted. Owner to say how many gaps still count as stage A done.
- Phase 1 needs ssh access to IMPORTA-PC (`fleet-importa-pc`) for the full-tree hash lock.
- `hairgrp` and `helmetgrp` have no layout in the local descriptor; Elbera route may also lack them (blocks source-backed hair for ACT-01).
- Streaming/LOD (WORLD-04) is a dependency of walking 153 tiles; the current native loader loads eagerly.
- Native reference capture fails the fixed 30 FPS cadence gate (4.1 FPS) and DATABASE-PC has no 120 Hz display; both gate Phases 5 and 6, not stage A (screenshots and listen checks).
- Native UI layouts from `interface.xdat` versus DESIGN.md mobile-first tokens: skin approach to settle when planning Phase 2 UI.
- Mobius transport (dumb relay) is a recommendation, not decided; decide at the start of Phase 4. Elbera `gateway/` and `editor/` are unaudited.
- Whether client-side collision survives next to a server-authoritative adapter is open (Phase 4 design).
- Lane tool support for this repo is not available on DATABASE-PC yet; use plain `git worktree` until it lands.
- Count differences to check in the decoder inventory: 435 vs 433 `.utx`, `chargrp` has 15 rows.

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

Last session: 2026-11-08T06:06:57.036Z
Stopped at: Completed 01-04-PLAN.md
Resume file: None
