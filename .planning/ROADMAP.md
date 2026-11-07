# Roadmap: l2-browser-client

## Overview

Breadth first (DEC-OWN-1). Phase 1 fixes contracts, the reference tree lock, the table inventory and a sandbox shell. Phase 2 converts the whole client across three lanes plus integration. Phase 3 proves each part side by side against L2.exe on IMPORTA-PC and fixes converters. Phase 4 plugs a server in through `GameWorldAdapter`. Phases 5 and 6 are the later polish stage: fixed native-parity thresholds, deferred slice items, GTX 1060 performance and per-tile Editor scenes.

## Phase mapping (GSD number vs docs/PORT_SCOPE.md section 8)

| GSD phase | PORT_SCOPE phase | Name |
|-----------|------------------|------|
| 1 | 0 | Foundations |
| 2 | 1 | Stage A breadth |
| 3 | 2 | Stage A checks |
| 4 | 3 | Stage B adapter |
| 5 | later (polish stage) | Native-parity polish |
| 6 | later (polish stage) | Performance and per-tile Editor scenes |

GSD phase = PORT_SCOPE phase + 1 for phases 1 to 4. Phases 5 and 6 have no PORT_SCOPE number.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): planned milestone work
- Decimal phases (2.1, 2.2): urgent insertions (marked INSERTED)

- [ ] **Phase 1: Foundations** - Contracts, IMPORTA-PC hash lock, `.dat` inventory, sandbox shell
- [ ] **Phase 2: Stage A breadth** - Convert the whole client in three lanes plus integration
- [ ] **Phase 3: Stage A checks** - Side-by-side checks against L2.exe on IMPORTA-PC, converter fixes
- [ ] **Phase 4: Stage B adapter** - Mobius through `GameWorldAdapter`, server-driven windows
- [ ] **Phase 5: Native-parity polish** - Fixed thresholds, audio rules, deferred slice items, gap burn-down
- [ ] **Phase 6: Performance and Editor scenes** - GTX 1060 120 FPS, optimizations, per-tile Editor scenes

## Phase Details

### Phase 1: Foundations
**Goal**: Three lanes can start in parallel against frozen contracts, a locked reference tree and a table inventory, with a sandbox shell ready to receive content.
**Depends on**: Nothing (first phase). Work is committed first; lanes start only from committed code.
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, ARCH-01, ARCH-02, ARCH-03, ARCH-04, SAND-01
**Success Criteria** (what must be TRUE):
  1. A recorded full-tree hash lock shows `E:/Lineage2-client` equal to IMPORTA-PC `C:/Lineage2-client` (files, bytes, per-file SHA-256) or lists every difference, and conversion refuses to read E: while the lock is missing or stale.
  2. One inventory lists all 40 `.dat` tables with route (local descriptor, Elbera, none), record count and status, and exists before further decoding.
  3. In the sandbox shell a developer can issue spawn NPC, equip item, cast skill and open window by ID with no server; an ID without a converted asset shows a visible missing-asset diagnostic, not a stand-in.
  4. A contract test fails if the five `GameWorldAdapter` methods change, and the written output contract says how `asset.json` records units and handedness per route and how the catalog lists assets, with hash-pinned fixtures that run without the private client.
  5. A new lane can start on a `<part>/<slug>` branch and knows where its STATUS line, folder ownership (`.planning/lanes.json`) and `docs/parts/<part>/EVIDENCE.md` live.
**Plans**: TBD

### Phase 2: Stage A breadth
**Goal**: Every part of the native client is converted, or listed as an explicit gap, and loads in the offline sandbox.
**Depends on**: Phase 1
**Requirements**: SAND-02, DATA-01, DATA-02, DATA-03, UI-01, UI-02, UI-03, WORLD-01, WORLD-02, WORLD-03, WORLD-04, WORLD-05, WORLD-06, ACT-01, ACT-02, ACT-03, ACT-04, ACT-05, ACT-06, INT-01, CONV-01, CONV-02
**Lane map** (DEC-OWN-6, at most 3 lanes plus integration; UI runs in parallel from day one):
  - L1 world: WORLD-01..06
  - L2 actors: ACT-01..06
  - L3 data + UI: DATA-01..03, UI-01..03, SAND-02
  - Integration: INT-01; CONV-01 and CONV-02 govern all lanes
**Success Criteria** (what must be TRUE):
  1. A developer picks any of the 153 tiles in the sandbox and walks it with terrain, static meshes, BSP, sky, and ambient and placement audio loaded; tiles or steps that failed appear in the coverage report as gaps, and the minimap and world map show.
  2. A developer spawns any NPC or monster by `npcgrp` ID and any `chargrp` character (every race, gender, class), equips any weapon or armor by item ID, plays its animations and hears the sounds bound to its bundle.
  3. A developer casts any skill by ID and level and sees its visual and hears its sound where the source resolves them; effects that need missing native behaviour show as explicit gaps.
  4. All 40 tables are available as JSON with the inventory showing route and status each (sysstring/systemmsg count resolved), and the developer opens any of the about 140 `interface.xdat` windows from the pinnable sandbox sheet, filled with sandbox data.
  5. One coverage report lists converted, loads and gap counts per part, and walking across tile borders loads and unloads bounded cells without losing nearby collision, with a recorded baseline measurement.
**Plans**: TBD
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
**Requirements**: NET-01, NET-02, NET-03, NET-04, NET-05, NET-06, NET-07, NET-08
**Success Criteria** (what must be TRUE):
  1. The transport decision is recorded, and a player can log in through the relay, choose a character and enter a stock Mobius world from the browser; synthetic demos and placeholder login screens do not count.
  2. Moving, attacking and being attacked on Mobius shows server-sent HP/MP, damage with its flags and skill casts through the adapter; the client computes none of it and tooltip stats come from server data.
  3. NPC dialogs, shops (buy, sell, multisell) and social and quest windows open from server events and show server data in the Phase 2 windows.
  4. Repeated wrong passwords from one player are stopped by the relay before Mobius sees them, so other players can still log in; the relay logs account-to-address and reaches only the configured Mobius ports.
  5. Each handled packet type has a golden fixture from captured Mobius packets; if Mobius is judged not to fit, a SpacetimeDB adapter emits the same adapter events.
**Plans**: TBD
**UI hint**: yes

### Phase 5: Native-parity polish
**Goal**: The polish list reaches the fixed native-parity thresholds, which are never relaxed.
**Depends on**: Phase 3 (stage A complete); sequenced after Phase 4 per the owner's "later polish stage"
**Requirements**: POL-01, POL-02, POL-03, POL-04
**Success Criteria** (what must be TRUE):
  1. Native reference recordings meet the fixed reference cadence, and the four visual cases (Human male fighter, Greater Musveren including death, Power Strike 3, a declared 20_20 section) pass the thresholds in `recipes/native-parity.acceptance.json`, each result recording that file's SHA-256; missing evidence stays unverified.
  2. Audio tolerances and one alignment method are written before comparison; footsteps change with surface and character/equipment using the ALAudio.dll rules, specialized attack sounds play, and matched native/browser recordings are retained.
  3. On 20_20 a human character routes automatically around stair turns and the upper-landing camera is not hidden by roof geometry, for male and female.
  4. The stage A gap list is shorter: each gap is converted or still listed with a stated reason.
**Plans**: TBD

### Phase 6: Performance and Editor scenes
**Goal**: The client holds the GTX 1060 target and every converted tile is editable in Babylon.js Editor.
**Depends on**: Phase 5
**Requirements**: PERF-01, PERF-02, EDIT-01, EDIT-02
**Success Criteria** (what must be TRUE):
  1. On DATABASE-PC's GTX 1060 at 1920 x 1080, DPR 1, the protocol workload (32 actors, eight Power Strike effects every 2 s, three trials of 15 s warmup and 90 s measurement) records median and p95 frame intervals, draw calls and memory; 120 FPS is sustained on a 120 Hz or faster display, or the report gives labelled timings and the presentation limit with no estimated pass.
  2. Instancing, GPU texture compression and culling each show before/after numbers on the same workload, with no regression in startup, movement or cleanup on source-loaded and authored routes.
  3. A developer opens any converted tile as a Babylon.js Editor scene in Editor 5.5.3, changes it, saves, reopens, rebuilds and sees the change in the browser; regeneration does not overwrite saved edits.
  4. One documented command runs inventory, conversion, validation and benchmark, and a clean repeat build reproduces matching outputs with conversion cache hits.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 (Phase 5 may start before Phase 4 finishes since it depends only on Phase 3).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations | 0/TBD | Not started | - |
| 2. Stage A breadth | 0/TBD | Not started | - |
| 3. Stage A checks | 0/TBD | Not started | - |
| 4. Stage B adapter | 0/TBD | Not started | - |
| 5. Native-parity polish | 0/TBD | Not started | - |
| 6. Performance and Editor scenes | 0/TBD | Not started | - |

## Coverage

52 of 52 v1 requirements mapped, each to exactly one phase (Phase 1: 9, Phase 2: 22, Phase 3: 5, Phase 4: 8, Phase 5: 4, Phase 6: 4). Per-requirement traceability: `.planning/REQUIREMENTS.md`. Deferred to v2: GEO-01, LATE-01. Superseded: REQ-work-order-v2-depth-first.

---
*Roadmap created: 2026-11-08*
