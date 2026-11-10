# Roadmap: l2-browser-client

## Overview

Breadth first (DEC-OWN-1). Phase 1 fixes contracts, the reference tree lock, the table inventory and a sandbox shell, and takes Babylon.js Editor off the build and runtime path (DEC-OWN-8) so no lane builds on it. Phase 2 converts the whole client across three lanes plus integration. Phase 3 proves each part side by side against L2.exe on IMPORTA-PC and fixes converters. Phase 4 plugs a server in through `GameWorldAdapter`. Phases 5 and 6 are the later polish stage: fixed native-parity thresholds, deferred slice items, GTX 1060 performance and reproducible builds. Per-tile Editor scenes are not planned; opening tiles in the Editor is optional viewer work (VIEW-01, v2).

## Phase mapping (GSD number vs docs/PORT_SCOPE.md section 8)

| GSD phase | PORT_SCOPE phase | Name |
|-----------|------------------|------|
| 1 | 0 | Foundations |
| 2 | 1 | Stage A breadth |
| 3 | 2 | Stage A checks |
| 4 | 3 | Stage B adapter |
| 5 | later (polish stage) | Native-parity polish |
| 6 | later (polish stage) | Performance and build reproducibility |

GSD phase = PORT_SCOPE phase + 1 for phases 1 to 4. Phases 5 and 6 have no PORT_SCOPE number.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): planned milestone work
- Decimal phases (2.1, 2.2): urgent insertions (marked INSERTED)

- [ ] **Phase 1: Foundations** - Contracts, IMPORTA-PC hash lock, `.dat` inventory, sandbox shell, Editor off the build and runtime path
- [ ] **Phase 2: Stage A breadth** - Convert the whole client in three lanes plus integration
- [ ] **Phase 3: Stage A checks** - Side-by-side checks against L2.exe on IMPORTA-PC, converter fixes
- [ ] **Phase 4: Stage B adapter** - Mobius through `GameWorldAdapter`, server-driven windows
- [ ] **Phase 5: Native-parity polish** - Fixed thresholds, audio rules, deferred slice items, gap burn-down
- [ ] **Phase 6: Performance and build reproducibility** - GTX 1060 120 FPS, optimizations, one reproducible build command

## Phase Details

### Phase 1: Foundations
**Goal**: Three lanes can start in parallel against frozen contracts, a locked reference tree and a table inventory, with a sandbox shell ready to receive content.
**Depends on**: Nothing (first phase). Work is committed first; lanes start only from committed code.
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, ARCH-01, ARCH-02, ARCH-03, ARCH-04, SAND-01, NOED-01, NOED-02, NOED-03, NOED-04, NOED-05
**Editor removal** (NOED-01..05, DEC-OWN-8): integration thread, merged before any Phase 2 lane starts, so lanes never build on the Editor path.
**Verification note**: the dev cold start is unexplained (dev suite 17/18, first goto of the since-removed courtyard route over 45 s, 262/288 JS requests, 21-23 s module gap; evidence artifacts/native-parity/research/editor-dev-startup). Re-measure dev startup on `/` after NOED-02 and NOED-03 remove the Editor pack; removing a suspected cause does not prove the gap is gone.
**Success Criteria** (what must be TRUE):
  1. A recorded full-tree hash lock shows `E:/Lineage2-client` equal to IMPORTA-PC `C:/Lineage2-client` (files, bytes, per-file SHA-256) or lists every difference, and conversion refuses to read E: while the lock is missing or stale.
  2. One inventory lists all 40 `.dat` tables with route (local descriptor, Elbera, none), record count and status, and exists before further decoding.
  3. In the sandbox shell a developer can issue spawn NPC, equip item, cast skill and open window by ID with no server; an ID without a converted asset shows a visible missing-asset diagnostic, not a stand-in.
  4. A contract test fails if the five `GameWorldAdapter` methods change, and the written output contract says how `asset.json` records units and handedness per route and how the catalog lists assets, with hash-pinned fixtures that run without the private client.
  5. A new lane can start on a `<part>/<slug>` branch and knows where its STATUS line, folder ownership (`.planning/lanes.json`) and `docs/parts/<part>/EVIDENCE.md` live.
  6. `pnpm dev` and `pnpm build` run without `babylonjs-editor-cli pack` or the Editor repair scripts (they sit in an optional `pnpm generate:editor`), `/` loads the native world straight from the `.l2asset` catalog with no Editor scene, and `?inspect=1` opens Babylon Inspector, lazy-loaded.
**Plans**: 17/17 plans executed in 6 waves

Plans:
**Wave 1**
- [x] 01-01-PLAN.md - Lane process files: lanes.json, ownership check, STATUS, DECISIONS, one EVIDENCE.md per part (FOUND-01)
- [x] 01-02-PLAN.md - Reference tree hash tooling and the E: guard at the central read helpers (FOUND-03)
- [x] 01-03-PLAN.md - One validated catalog reader and the L2-ID index (FOUND-02, SAND-01)
- [x] 01-04-PLAN.md - Native route scene built in code from typed config; authored=1 behind a dynamic import (NOED-01)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-05-PLAN.md - Native runtime split, injected world source, presentation provenance on the sheet (NOED-01, ARCH-03)
- [x] 01-07-PLAN.md - Guard wired into the world converter entry points (FOUND-03)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 01-06-PLAN.md - Default route on a code-built scene; Editor courtyard retired (NOED-03, NOED-01)
- [x] 01-08-PLAN.md - Guard wired into the actor and data entry points, scan test (FOUND-03)
- [x] 01-10-PLAN.md - Adapter contract test; spawn-npc, equip-item, cast-skill commands (ARCH-02, SAND-01)
- [x] 01-12-PLAN.md - asset.json v2, golden fixtures, written output contract (FOUND-02)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 01-09-PLAN.md - Editor off dev and build, Editor tests under test:editor, static graph test (NOED-02, NOED-05)
- [x] 01-11-PLAN.md - Missing-model demo and URL model loader deleted (ARCH-03, SAND-01)
- [x] 01-13-PLAN.md - Full-tree hash lock run and the 40-table .dat inventory (FOUND-03, FOUND-04)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 01-14-PLAN.md - Sandbox by-ID actions and the missing-asset marker (SAND-01, ARCH-03)
- [x] 01-15-PLAN.md - Import boundaries and server-boundary invariants (ARCH-01, ARCH-02, ARCH-04)
- [x] 01-16-PLAN.md - Babylon Inspector behind ?inspect=1, lazy-loaded (NOED-04)

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 01-17-PLAN.md - Browser checks on Editor-free routes and the dev cold-start re-measure (NOED-01, NOED-02, NOED-03)

### Phase 2: Stage A breadth
**Goal**: Every part of the native client is converted, or listed as an explicit gap, and loads in the offline sandbox.
**Depends on**: Phase 1
**Requirements**: SAND-02, DATA-01, DATA-02, DATA-03, UI-01, UI-02, UI-03, WORLD-01, WORLD-02, WORLD-03, WORLD-04, WORLD-05, WORLD-06, WORLD-07, WORLD-08, MAT-01, MAT-02, VIS-01, MOVE-01, ACT-01, ACT-02, ACT-03, ACT-04, ACT-05, ACT-06, FX-01, INT-01, CONV-01, CONV-02
**Lane map** (DEC-OWN-6, at most 3 lanes plus integration; UI runs in parallel from day one; WORLD-07, WORLD-08 and the DEC-OWN-12 IDs MAT-01, MAT-02, VIS-01, MOVE-01 and FX-01 provisional, owner review):
  - L1 world: WORLD-01..08, VIS-01, MOVE-01 and MAT-02. Starting input: [NATIVE_WORLD](../docs/NATIVE_WORLD.md) (Warning 7)
  - L2 actors: ACT-01..06, FX-01
  - L3 data + UI: DATA-01..03, UI-01..03, SAND-02
  - Integration: INT-01, MAT-01 (the shared UE2 material library); CONV-01 and CONV-02 govern all lanes
**Success Criteria** (what must be TRUE):
  1. A developer picks any of the 153 tiles in the sandbox and walks it with terrain, static meshes, BSP, sky, and ambient and placement audio loaded; tiles or steps that failed appear in the coverage report as gaps, and the minimap and world map show.
  2. A developer spawns any NPC or monster by `npcgrp` ID and any `chargrp` character (every race, gender, class), equips any weapon or armor by item ID, plays its animations and hears the sounds bound to its bundle.
  3. A developer casts any skill by ID and level and sees its visual and hears its sound where the source resolves them; effects whose emitter class or feature is not yet covered by the FX-01 emitter port show as explicit gaps with the class or feature named.
  4. All 40 tables are available as JSON with the inventory showing route and status each (sysstring/systemmsg count resolved), and the developer opens any of the about 140 `interface.xdat` windows from the pinnable sandbox sheet, filled with sandbox data.
  5. One coverage report lists converted, loads and gap counts per part, and walking across tile borders loads and unloads bounded cells without losing nearby collision, with a recorded baseline measurement.
**Plans**: 62/71 plans executed
- [x] 02-71-PLAN.md
- [x] 02-01-PLAN.md
- [x] 02-02-PLAN.md
- [x] 02-03-PLAN.md
- [x] 02-04-PLAN.md
- [x] 02-05-PLAN.md
- [x] 02-06-PLAN.md
- [x] 02-07-PLAN.md
- [x] 02-08-PLAN.md
- [x] 02-09-PLAN.md
- [x] 02-10-PLAN.md
- [x] 02-11-PLAN.md
- [x] 02-12-PLAN.md
- [x] 02-13-PLAN.md
- [x] 02-14-PLAN.md
- [x] 02-15-PLAN.md
- [x] 02-16-PLAN.md
- [x] 02-17-PLAN.md
- [x] 02-18-PLAN.md
- [x] 02-19-PLAN.md
- [x] 02-20-PLAN.md
- [x] 02-21-PLAN.md
- [x] 02-22-PLAN.md
- [x] 02-23-PLAN.md
- [x] 02-24-PLAN.md
- [x] 02-25-PLAN.md
- [x] 02-26-PLAN.md
- [x] 02-27-PLAN.md
- [x] 02-28-PLAN.md
- [x] 02-29-PLAN.md
- [x] 02-30-PLAN.md
- [x] 02-31-PLAN.md
- [x] 02-32-PLAN.md
- [x] 02-33-PLAN.md
- [x] 02-34-PLAN.md
- [x] 02-35-PLAN.md
- [x] 02-36-PLAN.md
- [x] 02-37-PLAN.md
- [x] 02-38-PLAN.md
- [x] 02-39-PLAN.md
- [x] 02-40-PLAN.md
- [x] 02-41-PLAN.md
- [x] 02-42-PLAN.md
- [x] 02-43-PLAN.md
- [x] 02-44-PLAN.md
- [x] 02-45-PLAN.md
- [x] 02-46-PLAN.md
- [ ] 02-47-PLAN.md
- [x] 02-48-PLAN.md
- [ ] 02-49-PLAN.md
- [ ] 02-50-PLAN.md
- [ ] 02-51-PLAN.md
- [x] 02-52-PLAN.md
- [x] 02-53-PLAN.md
- [ ] 02-54-PLAN.md
- [ ] 02-55-PLAN.md
- [x] 02-56-PLAN.md
- [x] 02-57-PLAN.md
- [x] 02-58-PLAN.md
- [x] 02-59-PLAN.md
- [x] 02-60-PLAN.md
- [x] 02-61-PLAN.md
- [x] 02-62-PLAN.md
- [x] 02-63-PLAN.md
- [ ] 02-64-PLAN.md
- [x] 02-65-PLAN.md
- [ ] 02-66-PLAN.md
- [ ] 02-67-PLAN.md
- [x] 02-68-PLAN.md
- [x] 02-69-PLAN.md
- [x] 02-70-PLAN.md
**UI hint**: yes

### Phase 3: Stage A checks
**Goal**: Stage A is proven: every converted part has a recorded side-by-side check against L2.exe on IMPORTA-PC, and defects are fixed in shared converters.
**Depends on**: Phase 2
**Requirements**: CHECK-01, CHECK-02, CHECK-03, CHECK-04, CHECK-05
**Success Criteria** (what must be TRUE):
  1. For world, characters/NPCs/items, skills and UI, a developer can open the part's EVIDENCE.md and see paired screenshots (sandbox vs L2.exe on IMPORTA-PC at the same location or ID) with a verdict of pass, mismatch or unverified.
  2. For world, actor and skill audio, listen-check results are recorded as labelled audible clips with verdicts; successful extraction or decoding is never recorded as a pass.
  3. Each mismatch becomes a converter fix (re-run shows the corrected result in the sandbox) or a listed gap; no tile is hand-patched.
  4. A stage A exit report states per part how many items were converted, load, were checked, and how many pass, mismatch, are unverified or are gaps, tied to the IMPORTA-PC hash lock.
**Plans**: TBD

### Phase 4: Stage B adapter
**Goal**: A stock Mobius server drives the client through `GameWorldAdapter` and the client displays what it sends; SpacetimeDB replaces it only if Mobius does not fit.
**Depends on**: Phase 3 (stage A before stage B)
**Requirements**: NET-01, NET-02, NET-03, NET-04, NET-05, NET-06, NET-07, NET-08, NET-09, NET-10, MOVE-02
**Lanes**: integration; the MOVE-02 reporter and record application are world-lane code. NET-09, NET-10 and MOVE-02 are provisional, owner review (DEC-OWN-12).
**Success Criteria** (what must be TRUE):
  1. The transport decision is recorded, and a player can log in through the relay, choose a character and enter a stock Mobius world from the browser; synthetic demos and placeholder login screens do not count.
  2. Moving, attacking and being attacked on Mobius shows server-sent HP/MP, damage with its flags and skill casts through the adapter; the client computes none of it and tooltip stats come from server data.
  3. NPC dialogs, shops (buy, sell, multisell) and social and quest windows open from server events and show server data in the Phase 2 windows.
  4. Repeated wrong passwords from one player are blocked by the relay once its per-address limit is reached, so other players can still log in. The attempts before the block reach Mobius, whose own ban threshold is raised and recorded. The relay logs account-to-address and reaches only the configured Mobius ports.
  5. Each handled packet type has a synthetic golden fixture, and capture-gated checks replay local Mobius captures when they are present (NET-04); if Mobius is judged not to fit, a SpacetimeDB adapter emits the same adapter events.
**Plans**: TBD
**UI hint**: yes

### Phase 5: Native-parity polish
**Goal**: The polish list reaches the fixed native-parity thresholds, which are never relaxed.
**Depends on**: Phase 3 (stage A complete); sequenced after Phase 4 per the owner's "later polish stage"
**Requirements**: POL-01, POL-02, POL-03, POL-04
**Success Criteria** (what must be TRUE):
  1. Native reference recordings meet the fixed reference cadence, and the four visual cases (Human male fighter, Greater Musveren including death, Power Strike 3, a declared 20_20 section) pass the thresholds in `recipes/native-parity.acceptance.json`, each result recording that file's SHA-256; missing evidence stays unverified.
  2. Audio tolerances and one alignment method are written before comparison; footsteps change with surface and character/equipment using the ALAudio.dll rules, specialized attack sounds play, and matched native/browser recordings are retained.
  3. On 20_20, for male and female, the same clicks end at the same places as in L2.exe, within a tolerance written before the comparison, and the upper-landing camera stays in front of the roof.
  4. The stage A gap list is shorter: each gap is converted or still listed with a stated reason.
**Plans**: TBD

### Phase 6: Performance and build reproducibility
**Goal**: The client holds the GTX 1060 target and one documented command rebuilds the converted client reproducibly.
**Depends on**: Phase 5
**Requirements**: PERF-01, PERF-02, EDIT-02
**Success Criteria** (what must be TRUE):
  1. On DATABASE-PC's GTX 1060 at 1920 x 1080, DPR 1, the protocol workload (32 actors, eight Power Strike effects every 2 s, three trials of 15 s warmup and 90 s measurement) records median and p95 frame intervals, draw calls and memory; 120 FPS is sustained on a 120 Hz or faster display, or the report gives labelled timings and the presentation limit with no estimated pass.
  2. Instancing, GPU texture compression and culling each show before/after numbers on the same workload, with no regression in startup, movement or cleanup on the native catalog route. BSP zone and portal culling (VIS-01, built in Phase 2) becomes the default only after this measurement shows a gain.
  3. One documented command runs inventory, conversion, validation and benchmark, and a clean repeat build reproduces matching outputs with conversion cache hits.
  (Opening converted tiles in Babylon.js Editor is optional viewer work, VIEW-01 in v2, and is not a success criterion; DEC-OWN-8.)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 (Phase 5 may start before Phase 4 finishes since it depends only on Phase 3).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations | 17/17 | In Progress | - |
| 2. Stage A breadth | 62/71 | In Progress | - |
| 3. Stage A checks | 0/TBD | Not started | - |
| 4. Stage B adapter | 0/TBD | Not started | - |
| 5. Native-parity polish | 0/TBD | Not started | - |
| 6. Performance and build reproducibility | 0/TBD | Not started | - |

## Coverage

66 of 66 v1 requirements mapped, each to exactly one phase (Phase 1: 14, Phase 2: 29, Phase 3: 5, Phase 4: 11, Phase 5: 4, Phase 6: 3). Per-requirement traceability: `.planning/REQUIREMENTS.md`. Deferred to v2: GEO-01, LATE-01, VIEW-01 (optional Editor viewer). Superseded: REQ-work-order-v2-depth-first, EDIT-01 (DEC-OWN-8).

---
*Roadmap created: 2026-11-08. Updated 2026-11-08 for DEC-OWN-8, DEC-OWN-11 and DEC-OWN-12.*
