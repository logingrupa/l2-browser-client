# Phase 2 plan index

Canonical list of the Phase 2 (Stage A breadth) plans. Every `02-NN-PLAN.md` uses the id, title, lane, `--part` slug, requirements, `depends_on`, wave, key files and shared names written here, so plans written separately agree.

Sources: `02-RESEARCH.md` sections 4, 6 and 11 (where 6 and 11 disagree, 11 wins), `02-CONTEXT.md`, `02-VALIDATION.md`, `.planning/PROJECT.md` (DEC-OWN-1 to DEC-OWN-12), `AGENTS.md`, `docs/OUTPUT_CONTRACT.md` and the Phase 1 summaries. Anything marked "chosen in index" is a name, split or dependency that the research left open. The first plan that builds such an item logs it as a row in `.planning/OVERNIGHT-DECISIONS.md`.

## How to read the ids

- Plan ids are the plain integers 02-01 to 02-69. Plans 02-56 to 02-69 were added for DEC-OWN-12 (own implementations of five areas) and have no research id. The single sequential executor runs plans in wave order (see Waves); inside a wave, in id order.
- Research ids (in `02-RESEARCH.md` and `02-VALIDATION.md`) are different from 02-10 on. Only 02-01 to 02-09 keep their numbers. Translate a research id with the "Research" column. Never cite a research id as a plan id.
- Wave = 1 + the highest wave among a plan's Phase 2 dependencies. Phase 1 dependencies count as wave 0. With one executor, a wave groups plans; nothing runs in parallel.
- Phase gate: no Phase 2 plan starts before Phase 1 is complete (summaries for 01-14, 01-16 and 01-17 exist). `depends_on` lists a Phase 1 plan only where a plan uses its artifacts directly.
- Plan count: 69.

## Rules every plan carries

1. One sequential executor in this worktree (`C:\Users\rolan\.t3\worktrees\l2-browser-client\autonomous-roadmap`, branch `plan/autonomous-roadmap`). Commit only. Never push or merge. Every plan is `autonomous: true` and has no human checkpoint. Reversibility gates are off: a plan rates its one-way doors in its text and adds no checkpoint.
2. Lane outputs go to `artifacts/lane-store/<lane>/l2/` (ignored), never to `public/l2`, which is a read-only junction to the shared store. Never run a script that writes the store: `assets:*`, `world:stage`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*` or preview. Restaging the shared store is a Needs Human line in `.planning/STATE.md` that holds the exact main-checkout command.
3. Converters read `E:/Lineage2-client` only through the Phase 1 guard (`require_reference_client(root).require_equal_file(path)`) and only for lock-equal files. IMPORTA-PC is read-only. Never run `native_catalog/cli.py main`, `inventory()` or any other whole-tree hash.
4. Machine schedule: DATABASE-PC is free all the time (owner, 2026-11-08); the only machine window is the PROMINENCE-PC nightly backup, 23:15-03:45 Riga. Once 02-02 lands, every run starts with `node scripts/check-machine-schedule.mjs &&`. Inside a window, the plan stops cleanly and resumes later. It never sleeps or polls. Heavy commands run at BelowNormal. Check free disk before a batch.
5. The dev server is `pnpm dev --port 5175`. Run `pnpm test:e2e` only while nothing listens on 5173. Otherwise record the browser check as "unverified", never as passed. Make no headless FPS or performance claims. FPS comes only from `WORLD_HARDWARE_TEST=1` on the GTX 1060.
6. The last task of every plan stops what the plan started, by PID or by a command line that holds the checkout path or the port. Never stop a process by image name. The task then confirms that nothing it started still runs.
7. Ownership: each plan stays inside one lane's globs in `.planning/lanes.json`. `tests/browser/**`, `tests/fixtures/**`, `tests/pipeline/**` and `tests/unit/**` are shared. After its last code commit and before its docs commit, each plan runs `node scripts/check-lane-ownership.mjs --base <plan start> --part <slug>`. The docs commit holds the SUMMARY and any edits to `.planning/**`, `STATUS.md`, `DECISIONS.md` and `REQUIREMENTS.md`.
8. Code rules (`AGENTS.md`):
   - No comments. When a plan touches a file, it strips every comment in that file. The licence line at `vite.config.ts:1` moves to `THIRD_PARTY_NOTICES.md` in 02-06.
   - Full-word names.
   - Files stay under about 400 lines. New logic goes in new modules.
   - No dead code and no speculative options.
   - TypeScript strict, no `any`, pnpm only.
   - Vitest for every behaviour change, Playwright for every UI change. A "done" claim needs a passing test or a screenshot.
   - Never invent Lineage II values. An unresolved value stays visibly unresolved.
   - Plain hyphens only, and sentence-case headings.
9. Viewports (DEC-OWN-9):
   - Phone evidence is 932 x 430 landscape with `isMobile` and `hasTouch`.
   - Portrait 430 x 932 is only a no-horizontal-scroll check.
   - Desktop is 1440 x 900.
   - Never use 844 x 390 or 390 x 844. Section 11.15 supersedes the "844 x 390" in research row 02-23 (now 02-38).
10. Interface (DEC-OWN-10):
    - The only game interface is the original Interlude interface. Window layout comes from `interface.xdat`. Skin, fonts and icons come from the converted UI textures.
    - No custom HUD and no design tokens. `src/ui/nativeWindows/**` contains no colour literal, no `font-family` and no image outside `/l2/`.
    - DESIGN.md stays deleted.
    - The procedural HUD and the developer sheet are unstyled stand-ins and development tools.
    - Never use the impeccable or frontend-design skills.
11. Gaps: every unit that is not converted is a gap row with a listed reason, never a stand-in. "Loads" counts only from a recorded load-check record.
12. Known red baseline: 2 cases of `nativeNpcProfiles.test.ts` (fixed in 02-33) and the flaky `nativeEffectStage.test.ts`. 02-01 re-runs `pnpm test:unit` once outside a machine window and records the actual red list.
13. Placement of new modules (chosen in index):
    - World: `scripts/world/`, `recipes/world/` and `src/scene/world/`.
    - Actors: `scripts/actors/`, `recipes/actors/`, `src/assets/native/`, `src/animation/`, `src/audio/` and `src/effects/`.
    - Data-ui: `scripts/data/`, `scripts/native_catalog/`, `recipes/data/` and `src/ui/`.
    - Integration: `scripts/native_store/`, `scripts/native_assets_lib/`, `vite/`, `src/runtime/`, `src/world/`, `src/entities/`, `src/scene/navigation/`, and for DEC-OWN-12 `src/shared/`, `src/materials/` and `tools/reference-overlap/`.
    - DEC-OWN-12 lane folders: world `src/scene/world/movement/` (core in `movement/core/`) and `src/scene/world/bspVisibility/` (core in `bspVisibility/core/`); actors `src/effects/particles/` (`sim/`, `render/` and `effectScheduler.ts`). Each Babylon-free core imports only `src/shared/**` outside itself, checked by one `tests/unit/importBoundaries.<area>.test.ts`.
    - A module split out of a lane-owned single file (`native_map.py`, `native_map_geometry.py`, `native_effect_bundle.py`) goes into the lane's directory. It never becomes a new top-level `scripts/native_*.py`, because that path is unclaimed and falls to integration.
14. Runtime wiring (chosen in index):
    - Lane plans never edit `src/runtime/**`, `src/world/**`, `src/entities/**`, `src/scene/navigation/**`, `package.json`, `vite.config.ts` or `playwright.config.ts`. Integration does that wiring in 02-10 (adapter commands), 02-25 (sheet gap notes and `convert:*`), 02-37 (pickers, window opening, spawn-character and play-clip presentation), 02-58 (the DEC-OWN-12 adapter record types) and 02-67 (collision world context, movement presenter, environment clock and the transparent comparator). 02-48 moved to the world lane (DEC-OWN-12 movement handoff).
    - A lane makes its output reachable without that wiring. World uses `?map=XX_YY` through `src/scene/world/selectedNativeTile.ts`. Actors use the catalog index and the 01-14 sandbox command sheet. Data-ui pickers register in `sandboxPickerRegistry`. Before 02-37, a UI window is checked on the harness page `tests/browser/harness/native-window.html`.

## Master table

| Id | Research | Title | Lane, `--part` | Requirements | depends_on | Wave |
|---|---|---|---|---|---|---|
| 02-01 | 02-01 | Store paths and output guard | integration, adapter-dispatch | INT-01, CONV-01 | 01-17 | 1 |
| 02-02 | 02-02 | Unit ledger, gap rows and machine schedule | integration, adapter-dispatch | INT-01, WORLD-03 | 02-01 | 2 |
| 02-03 | 02-03 | Catalog writer library and lane catalog | integration, adapter-dispatch | INT-01 | 02-01 | 2 |
| 02-04 | 02-04 | Catalog keys writer half and tile manifest kinds | integration, adapter-dispatch | INT-01, WORLD-01, UI-01, DATA-01 | 02-02, 02-03 | 3 |
| 02-05 | 02-05 | Catalog keys reader half | actors, npcs | INT-01, WORLD-01, UI-01, DATA-01 | 02-04 | 4 |
| 02-06 | 02-06 | NATIVE_STORE_ROOT dev plugin | integration, adapter-dispatch | INT-01, WORLD-05 | 02-01, 01-09, 01-16 | 2 |
| 02-07 | 02-07 | Coverage skeleton | integration, adapter-dispatch | INT-01, WORLD-03 | 02-02, 02-04, 02-06 | 4 |
| 02-08 | 02-08 | CONV-01 and CONV-02 contract tests | integration, adapter-dispatch | CONV-01, CONV-02 | 02-01 | 2 |
| 02-09 | 02-09 | Converter cost fix | integration, adapter-dispatch | ACT-02, CONV-01 | 02-01 | 2 |
| 02-10 | 02-44 | WorldCommand sandbox contract | integration, adapter-dispatch | ACT-01, ACT-04 | 01-14 | 1 |
| 02-11 | 02-24 | WORLD-07 independent review | world, world | WORLD-07 | 01-17 | 1 |
| 02-12 | 02-13 | World oracle and tile census | world, world | WORLD-03, WORLD-01 | 02-02, 02-07 | 5 |
| 02-13 | 02-50 | Terrain-height gate census | world, world | WORLD-03, WORLD-01 | 02-12 | 6 |
| 02-14 | 02-14 | World raw step | world, world | WORLD-01 | 02-12 | 6 |
| 02-15 | 02-15 | Chunk planner and terrain step | world, world | WORLD-01 | 02-14, 02-11 | 7 |
| 02-16 | 02-16 | World tracer 20_21 walk | world, world | WORLD-05, WORLD-01 | 02-15, 02-04, 02-05, 02-06 | 8 |
| 02-17 | 02-10 | Data tracer: generic decode and DATA-03 | data-ui, data | DATA-01, DATA-03 | 02-01, 02-02, 02-04 | 4 |
| 02-18 | 02-45 | UI texture package census | data-ui, ui | UI-02 | 02-02 | 3 |
| 02-19 | 02-11 | UI-01 layout tree | data-ui, ui | UI-01 | 02-01, 02-02, 02-03, 02-04 | 4 |
| 02-20 | 02-12 | UI tracer window:StatusWnd | data-ui, ui | UI-02 | 02-19, 02-05, 02-06, 02-18, 01-14 | 5 |
| 02-21 | 02-17 | Actors census and unit inventory | actors, npcs | ACT-01, ACT-02, ACT-03, ACT-05, ACT-06 | 02-02 | 3 |
| 02-22 | 02-18 | Actors tracer npc:20001 Gremlin | actors, npcs | ACT-02 | 02-21, 02-03, 02-05, 02-06, 02-09, 01-14 | 5 |
| 02-23 | 02-46 | Load-check sweeps | integration, adapter-dispatch | INT-01 | 02-05, 02-06, 02-07 | 5 |
| 02-24 | 02-47 | Lane store merge tool | integration, adapter-dispatch | INT-01 | 02-03, 02-04 | 4 |
| 02-25 | 02-19 | Integration tracer: sandbox available or gap | integration, adapter-dispatch | INT-01 | 02-07, 02-16, 02-17, 02-20, 02-22 | 9 |
| 02-26 | 02-48 | Gap census | integration, adapter-dispatch | INT-01 | 02-07, 02-13, 02-17, 02-19, 02-21 | 7 |
| 02-27 | 02-20 | Remaining tables and name indexes | data-ui, data | DATA-01 | 02-17 | 5 |
| 02-28 | 02-21 | Hair tables | data-ui, data | DATA-02 | 02-17, 02-19, 02-27 | 6 |
| 02-29 | 02-25 | Static meshes per chunk | world, world | WORLD-01 | 02-12, 02-16 | 9 |
| 02-30 | 02-26 | BSP and collision | world, world | WORLD-01, WORLD-08, VIS-01, MOVE-01 | 02-29, 02-56, 02-59 | 10 |
| 02-31 | 02-49 | Mover step | world, world | WORLD-01, MOVE-01 | 02-14, 02-16, 02-29, 02-30 | 11 |
| 02-32 | 02-34 | Multi-slot verify_binding | integration, adapter-dispatch | ACT-02 | 02-09 | 3 |
| 02-33 | 02-35 | NPC contract widening | actors, npcs | ACT-02 | 02-22, 02-24 | 6 |
| 02-34 | 02-36 | NPC breadth | actors, npcs | ACT-02 | 02-21, 02-23, 02-24, 02-32, 02-33 | 7 |
| 02-35 | 02-22 | DevSheet split and pickers | data-ui, sandbox | SAND-02 | 02-10, 02-16, 02-19, 02-27, 02-41, 01-14 | 9 |
| 02-36 | 02-41a | Clip events and playback API | actors, npcs | ACT-04 | 02-10, 02-22 | 6 |
| 02-37 | 02-22b | Sandbox runtime wiring | integration, adapter-dispatch | SAND-02, ACT-01, ACT-04 | 02-10, 02-35, 02-36, 02-20, 02-25 | 10 |
| 02-38 | 02-23 | Window registry and UI-03 | data-ui, ui | UI-02, UI-03 | 02-20, 02-23, 02-35, 02-37 | 11 |
| 02-39 | 02-41b | Clip picker | data-ui, sandbox | ACT-04 | 02-36, 02-37 | 11 |
| 02-40 | 02-37 | Player characters | actors, player-characters | ACT-01 | 02-10, 02-27, 02-28, 02-34, 02-37 | 11 |
| 02-41 | 02-38 | EquipmentSlot widening | integration, adapter-dispatch | ACT-03 | 02-27 | 6 |
| 02-42 | 02-39 | Items | actors, items | ACT-03 | 02-23, 02-40, 02-41 | 12 |
| 02-43 | 02-40 | Skill binding table | actors, skills-effects | ACT-06, FX-01 | 02-21, 02-23, 02-34, 02-59 | 8 |
| 02-44 | 02-42 | Actor audio bindings | actors, audio | ACT-05 | 02-27, 02-34, 02-43 | 9 |
| 02-45 | 02-27a | Tile sky and audio converters | world, world | WORLD-02, MAT-01 | 02-11, 02-14, 02-16, 02-27, 02-29, 02-30, 02-31, 02-59 | 12 |
| 02-46 | 02-27b | Tile audio runtime | actors, audio | WORLD-02 | 02-16, 02-45 | 13 |
| 02-47 | 02-28 | Eligible-39 batch | world, world | WORLD-01, WORLD-02, WORLD-03 | 02-13, 02-23, 02-29, 02-30, 02-31, 02-45, 02-61, 02-62 | 14 |
| 02-48 | 02-29 | Cell-aware collision world | world, movement-geodata | WORLD-04, MOVE-01 | 02-30, 02-56 | 11 |
| 02-49 | 02-30 | Streaming baseline and residency | world, world | WORLD-04, MOVE-01 | 02-47, 02-48, 02-67 | 16 |
| 02-50 | 02-31a | Minimap and town map join | world, minimap | WORLD-06 | 02-18, 02-19, 02-27, 02-47 | 15 |
| 02-51 | 02-31b | Minimap and world map view | data-ui, ui | WORLD-06 | 02-38, 02-50 | 16 |
| 02-52 | 02-32w | World reader widening | world, world | WORLD-01 | 02-13, 02-14, 02-15, 02-19 | 8 |
| 02-53 | 02-32i | Static-material reader widening | integration, adapter-dispatch | WORLD-01 | 02-29, 02-52, 02-19 | 10 |
| 02-54 | 02-33 | Licensee-23, 25 and 30 tiles | world, world | WORLD-01, WORLD-03 | 02-47, 02-50, 02-52, 02-53 | 16 |
| 02-55 | 02-43 | Integration union and restage handoff | integration, adapter-dispatch | INT-01 | 02-24, 02-25, 02-26, 02-28, 02-38, 02-39, 02-42, 02-44, 02-46, 02-49, 02-51, 02-54, 02-57, 02-67, 02-69 | 17 |
| 02-56 | new | Shared Babylon-free modules and the source frame | integration, adapter-dispatch | MOVE-01, VIS-01, MAT-01, FX-01 | 02-01 | 2 |
| 02-57 | new | Vendor boundary and reference overlap check | integration, adapter-dispatch | MAT-01, VIS-01, MOVE-01, FX-01 | 02-56 | 3 |
| 02-58 | new | Adapter record types contract commit | integration, adapter-dispatch | MOVE-01, MAT-02, FX-01 | 02-41, 02-56 | 7 |
| 02-59 | new | Class-default and material graph readers | integration, adapter-dispatch | MAT-01, CONV-02 | 02-02 | 3 |
| 02-60 | new | UE2 material runtime library and swatch | integration, adapter-dispatch | MAT-01 | 02-06, 02-56, 02-57, 02-59 | 4 |
| 02-61 | new | Zone table, map emitters and BSP visibility resource | world, world | VIS-01, WORLD-01, FX-01 | 02-30, 02-43, 02-57 | 11 |
| 02-62 | new | BSP lightmaps and tile lighting export | world, world | MAT-02 | 02-45, 02-59, 02-61 | 13 |
| 02-63 | new | BSP visibility walk and binding | world, world | VIS-01 | 02-56, 02-57, 02-61 | 12 |
| 02-64 | new | Tile lighting, fog and environment runtime | world, world | MAT-02, MAT-01, FX-01 | 02-58, 02-60, 02-62, 02-63, 02-65, 02-69 | 14 |
| 02-65 | new | Movement core traces and MoveActor | world, movement-geodata | MOVE-01, WORLD-08 | 02-48, 02-57 | 12 |
| 02-66 | new | Pawn physics, follow camera and movement presenter | world, movement-geodata | MOVE-01, WORLD-05 | 02-58, 02-65 | 13 |
| 02-67 | new | Runtime wiring for movement, environment and translucent order | integration, adapter-dispatch | MOVE-01, MAT-02, VIS-01, WORLD-05 | 02-37, 02-63, 02-64, 02-66 | 15 |
| 02-68 | new | Emitter simulation core | actors, skills-effects | FX-01, ACT-06 | 02-43, 02-56, 02-57 | 9 |
| 02-69 | new | Ribbon emitter, L2 emitter natives and particle rendering | actors, skills-effects | FX-01, ACT-06, MAT-01 | 02-58, 02-60, 02-61, 02-68 | 12 |

Research to new id (02-56 to 02-69 have none): 02-01..02-09 = same; 02-10 = 02-17; 02-11 = 02-19; 02-12 = 02-20; 02-13 = 02-12; 02-14 = 02-14; 02-15 = 02-15; 02-16 = 02-16; 02-17 = 02-21; 02-18 = 02-22; 02-19 = 02-25; 02-20 = 02-27; 02-21 = 02-28; 02-22 = 02-35; 02-22b = 02-37; 02-23 = 02-38; 02-24 = 02-11; 02-25 = 02-29; 02-26 = 02-30; 02-27a = 02-45; 02-27b = 02-46; 02-28 = 02-47; 02-29 = 02-48; 02-30 = 02-49; 02-31a = 02-50; 02-31b = 02-51; 02-32w = 02-52; 02-32i = 02-53; 02-33 = 02-54; 02-34 = 02-32; 02-35 = 02-33; 02-36 = 02-34; 02-37 = 02-40; 02-38 = 02-41; 02-39 = 02-42; 02-40 = 02-43; 02-41a = 02-36; 02-41b = 02-39; 02-42 = 02-44; 02-43 = 02-55; 02-44 = 02-10; 02-45 = 02-18; 02-46 = 02-23; 02-47 = 02-24; 02-48 = 02-26; 02-49 = 02-31; 02-50 = 02-13.

## Waves

| Wave | Plans |
|---|---|
| 1 | 02-01, 02-10, 02-11 |
| 2 | 02-02, 02-03, 02-06, 02-08, 02-09, 02-56 |
| 3 | 02-04, 02-18, 02-21, 02-32, 02-57, 02-59 |
| 4 | 02-05, 02-07, 02-17, 02-19, 02-24, 02-60 |
| 5 | 02-12, 02-20, 02-22, 02-23, 02-27 |
| 6 | 02-13, 02-14, 02-28, 02-33, 02-36, 02-41 |
| 7 | 02-15, 02-26, 02-34, 02-58 |
| 8 | 02-16, 02-43, 02-52 |
| 9 | 02-25, 02-29, 02-35, 02-44, 02-68 |
| 10 | 02-30, 02-37, 02-53 |
| 11 | 02-31, 02-38, 02-39, 02-40, 02-48, 02-61 |
| 12 | 02-42, 02-45, 02-63, 02-65, 02-69 |
| 13 | 02-46, 02-62, 02-66 |
| 14 | 02-47, 02-64 |
| 15 | 02-50, 02-67 |
| 16 | 02-49, 02-51, 02-54 |
| 17 | 02-55 |

The run order is the wave order (GSD runs waves in order, and plans inside a wave in id order). Waves and the master table columns `depends_on` and Wave are regenerated from the plan frontmatter, which is the source of truth; a dependency may have a higher id (for example 02-35 depends on 02-41). Tracers plus census-based gap coverage are "done for this run"; breadth plans seal resumable units and continue in later runs.

## Dependency notes

Dependencies added to the research tables (applied above; the master table and Waves are regenerated from the plan frontmatter, which wins over these notes):
- 02-04 adds 02-02: it documents the gap-row and `coverage.json` envelope that 02-05 reads (chosen in index).
- 02-07 adds 02-06: 02-06 owns the load-check record file format (chosen in index). The research left the record writer in research 02-46, which would run after the tracers that write records.
- 02-15 adds 02-11: research row 02-24 says "before 02-15".
- 02-20 adds 02-18 (research 11.7). 02-35, 02-37 and 02-40 add 02-10 (research 11.3).
- 02-34, 02-38, 02-42, 02-43 and 02-47 add 02-23, because each ends with one sweep slice (research 11.1).
- 02-52 adds 02-13 (research 11.6). 02-50 adds 02-18 (research 11.7).
- 02-47 adds 02-31 (the batch runs the mover step too) and 02-13 (eligibility comes from the committed census). Both chosen in index.
- Research pair 02-41 splits into 02-36 (depends on 02-22 and 02-10) and 02-39 (depends on 02-36 and 02-37). 02-37 adds 02-36, because it wires play-clip presentation onto the clip API. 02-38 and 02-40 add 02-37, because their browser checks need sandbox window opening and spawn-character presentation. All chosen in index.
- 02-46 adds 02-16, because its browser check loads a tile (chosen in index). 02-51 adds 02-38, because MinimapCtrl is a control type in the window registry (chosen in index).
- 02-53 depends on 02-29 instead of the pair's 02-14 and 02-50: the static-material growth is checked against the per-object gaps of 02-29 (chosen in index).
- DEC-OWN-12 plans (2026-11-08 handoff): 02-30 adds 02-56 and 02-59 (typed payload format, class defaults, material graph); 02-45 adds 02-59; 02-47 adds 02-61 and 02-62 so the batch runs the new steps; 02-48 now depends on 02-30 and 02-56 and is world, movement-geodata; 02-49 adds 02-67 (runtime collision context); 02-55 adds 02-57, 02-67 and 02-69. Chosen in index.
- New research plans: 02-10 depends on 01-14. 02-23 depends on 02-05, 02-06 and 02-07. 02-24 depends on 02-03 and 02-04. 02-26 depends on 02-07, 02-13, 02-17, 02-19 and 02-21. 02-55 depends on the last plan of every lane chain. All chosen in index.

## Shared interfaces

Each name below is relied on by more than one plan. The owning plan builds it. Later plans import it and never redefine it.

### Paths and layout

| Name | Value | Owner |
|---|---|---|
| Lane names | `world`, `actors`, `data-ui`, `integration`, the keys of `.planning/lanes.json` | 02-01 |
| Lane store | `artifacts/lane-store/<lane>/l2/`, with the same prefixes as `public/l2` | 02-01 |
| Existing prefixes | Models and textures `/l2/<archiveSha256>/asset.l2asset` (no kind prefix); sections `maps/<sha>/map-section-runtime/manifest.json`; `npc-profiles/<sha>/`; `world-audio/<sha>/`. Never `/l2/models/<sha>/` | 02-01 docs |
| New prefixes | `tables/<sha>/<table>.json`, `windows/<sha>/window.json`, `tiles/<sha>/tile.json`, chunk `maps/<sha>/native-tile-chunk-runtime/manifest.json` | 02-04 |
| Path rule | Every name matches the `nativeResourceUrl.ts` regex `^\/l2\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$`. That file stays untouched | all |
| Ledger work root | `artifacts/lane-store/<lane>/work/<unitDirectory>/<step>/` (chosen in index) | 02-02 |
| Gap-row files | `artifacts/lane-store/<lane>/gap-rows/<step>.json` (chosen in index) | 02-02 |
| Load-check records | `artifacts/lane-store/<lane>/load-checks/<catalogSha256>.json` | 02-06 |
| Coverage | `<store root>/coverage.json`, served as `/l2/coverage.json`, outside the catalog so that no SHA becomes circular; the committed table is `docs/coverage.md` | 02-04 shape, 02-07 writer |
| Integration union | `artifacts/lane-store/integration/l2/` (chosen in index) | 02-55 |

### `scripts/native_store/` (integration, package `scripts/native_store/__init__.py`)

- `store_paths.py` (02-01):
  - `refuse_reparse_points(path)`, deduplicated from `native_batch.py:54-67` and `stage_native_players.py:61-84`.
  - `lane_store_root(project_root, lane_name)`, which validates the lane name against `lanes.json`.
  - `require_converter_output(project_root, output)`: the realpath must lie under `<project>/artifacts/`, outside the realpath of `public/l2`, with no reparse ancestor. It raises `ConverterOutputRefusedError` (chosen in index).
  - Helpers chosen in index: `lane_work_root(project_root, lane_name)`, `lane_gap_rows_path(project_root, lane_name, step)` and `lane_load_check_path(project_root, lane_name, catalog_sha256)`.
  - Bound by 02-01 at `Converter.__init__` and `native_batch.run`, and by every `scripts/<lane>/` entry point. 02-17 binds `scripts/native_catalog/cli.py --output` (data-ui owned) and widens the scan test `tests/pipeline/test_converter_output_guard.py` to cover it.
- `unit_ledger.py` (02-02, names chosen in index):
  - `UnitLedger(work_root, step, algorithm_version)` with `unit_fingerprint(input_sha256s, config)`, `is_sealed(unit_key, fingerprint)`, `begin(unit_key, fingerprint)` and `seal(unit_key, fingerprint, receipt)`.
  - `unit_directory_name(key)` replaces `:` with `__`, so `tile:20_21` becomes `tile__20_21`.
  - `require_batch_preflight(project_root, lane_name, minimum_free_bytes)` and `run_at_below_normal_priority()`.
- `gap_rows.py` and `gap_reasons.json` (02-02): see "Gap rows" below.
- `catalog_writer.py` (02-03):
  - `build_runtime_store_files`, `merge_catalog_slice(catalog, slice_name, record, capacity)` and `write_store(store_root, files, before, after)`.
  - `immutable_write` and `replace_file`, moved from `stage_native_runtime.py`.
  - 02-04 adds `validate_catalog_record(slice_name, record)` (chosen in index).
  - Capacities are passed by the caller. Lane code holds its own caps, for example the npcProfiles cap that 02-33 raises.
- `tile_manifest_validation.py` (02-04, chosen in index): `validate_tile_manifest(manifest)` and `validate_tile_chunk_manifest(manifest)`.
- `write_lane_catalog.py` (02-03): see the CLIs below.
- `load_check_records.py` (02-07, chosen in index): `read_load_check_records(project_root, lane_name, catalog_sha256)`.
- `build_coverage_report.py` (02-07) and `gap_census.py` (02-26, chosen in index: `build_gap_census(denominators, gap_rows, catalog_index_keys)`).
- `merge_lane_store.py` (02-24).

### Unit ledger record fields (02-02)

- `owner.json`: `{unitKey, step, lane, plan, host, pid, startedAtRiga}`.
- `.running.json`: `{unitKey, step, fingerprint, startedAtRiga}`. A `.running.json` with no seal means the unit is redone on the next run.
- `receipt.json`: `{unitKey, step, fingerprint, algorithmVersion, config, inputs: [{path, sha256}], outputs: [{path, sha256, bytes}], gapRows: [...], freeBytesBefore, freeBytesAfter, host, finishedAtRiga}`.
- `complete.json` (the seal): `{unitKey, step, fingerprint, receiptSha256}`. A rerun skips a unit whose seal fingerprint matches and whose receipt hash verifies.
- Fingerprint: SHA-256 over the sorted lock `eSha256` values of the inputs, the step's `algorithmVersion` and the canonical config JSON. It never includes an implementation self-hash, so a comment edit does not rehash the chain.
- Times: ISO 8601 with the Riga offset, for example `2026-11-08T15:05:00+02:00` (chosen in index).
- Preflight: it refuses inside a machine window (by calling `node scripts/check-machine-schedule.mjs` through `subprocess`), below the free-disk floor (`shutil.disk_usage` of the lane root, with value and Riga time logged in the receipt) and through `public/l2`.

### Gap rows (02-02; reasons extended by lane plans)

- Row: `{key, part, step, status, reason, sourceIdentity, evidence}`.
  - `status`: `"pass" | "gap" | "pending" | "failed"`.
  - `reason`: required unless `pass`, and must match a listed pattern.
  - `sourceIdentity`: `{path, sha256, object?}` (chosen in index).
  - `evidence`: a repo- or lane-relative path to a receipt or doc.
- Keys:
  - `tile:XX_YY` and `map:<name>` for the 10 non-tile maps (chosen in index).
  - `npc:<id>`, `item:<id>`, `skill:<id>:<level>`, `table:<name>` and `window:<windowId>`.
  - `character:<chargrpIndex>` (research 11.13).
- Parts: the parts in `lanes.json` (`data`, `ui`, `sandbox`, `world`, `minimap`, `movement-geodata`, `player-characters`, `npcs`, `items`, `skills-effects`, `audio`).
- Functions: `GAP_ROW_STATUSES`, `validate_gap_row(row)`, `write_gap_rows(project_root, lane_name, step, rows)` and `read_gap_rows(project_root, lane_name)`.
- Reason list, chosen in index for ownership:
  - The seed lives in `scripts/native_store/gap_reasons.json` with a `listVersion` (02-02).
  - A lane plan that needs a reason missing from the seed adds it to its own `recipes/world/gap-reasons.json`, `recipes/actors/gap-reasons.json` or `recipes/data/gap-reasons.json` and bumps that file's `listVersion`.
  - `gap_rows.py` loads the seed plus each lane file that exists.
- Seed reasons (research 4.4 and 11, plus ones chosen in index, marked *):
  - Map and terrain: `map-licensee-unsupported:<v>/<lic>`, `map-version-unsupported:<version>`, `terrain-height-package-missing`, `terrain-height-licensee-unsupported:123/<lic>`, `census-pending`.
  - Actors: `skeletal-licensee-unsupported:<v>/<lic>`, `no-mesh-in-row`, `animation-reference-missing`, `actor-default-unresolved:<field>`, `multi-slot-binding-unsupported`, `hair-layout-undecoded`, `helmet-layout-undecoded`.
  - Skills and sound: `native-skill-dispatch-required`, `no-exact-skillsound-row`, `effect-class-unsupported:<class>` (removed by 02-59 with a `listVersion` bump; actors registers `emitter-class-unported:<class>` in 02-43 and `emitter-feature-unported:<property>` in 02-68, linked to FX-01), `sound-identity-unresolved`.
  - DEC-OWN-12 naming: `<domain>-class-unported:<class>` and `<domain>-feature-unported:<property>`. 02-59 seeds `material-class-unported:<class>` and `material-feature-unported:<property>`; the reader returns them and the consuming lane step writes the rows.
  - Decode and UI: `decode-failed:<error>`, `control-type-unsupported:<type>`, `adapter-field-absent:<field>`.
  - World: `collision-unreadable`, `mover-unsupported:<reason>`, `lod-derivative-unplanned`.
  - Items: `etcitem-presentation-unplanned`.
  - Chosen in index: `texture-licensee-unsupported:<v>/<lic>`*, `static-material-layout-unreviewed:<v>/<lic>`*, `equipment-slot-meaning-undecoded:<bodyPart>`*, `class-template-mapping-undecoded`*.
  - Pending steps (chosen in 02-02): `step-pending:<step>` is the one reason for a step that has not run yet. 02-04's golden chunk, 02-07's coverage tests and 02-16's pending tile steps use it; no lane file adds a second pending reason.

### Machine schedule check (02-02)

- Module: `scripts/check-machine-schedule.mjs` plus the sibling `scripts/check-machine-schedule.d.mts` (01-01 pattern). It exports `MACHINE_WINDOWS` and `findActiveMachineWindow(hostName, instant)`, using `Intl` with `Europe/Riga`.
- Windows: only the PROMINENCE-PC nightly backup, 23:15-03:45 (`02-VALIDATION.md`). DATABASE-PC has none (owner, 2026-11-08).
- Exit codes (chosen in index): exit 0 outside a window; exit 2 inside one, printing the window and the Riga time; exit 1 on error.
- Callers:
  - The ledger, through `subprocess`.
  - Playwright, through `tests/browser/support/machineScheduleGlobalSetup.ts`, registered in `playwright.config.ts`.
  - Executors, as the prefix `node scripts/check-machine-schedule.mjs &&`.
- Test: `tests/unit/checkMachineSchedule.test.ts`.

### Catalog records and manifests (02-04 writer half, 02-05 reader half)

The catalog stays `schemaVersion: 1` with the existing slices. New slices, each a manifest record `{id, manifest, manifestSha256, manifestBytes, ...}`:

| Slice | Record | Notes |
|---|---|---|
| `tables` | `{id, manifest: "/l2/tables/<sha>/<table>.json", manifestSha256, manifestBytes, recordCount, sourceSha256}` | `id` is the inventory `table` name (`npcgrp`, `itemname-e`). The manifest is fetched lazily and never inlined (`skillgrp` is 14.5 MB), with its own size bound |
| `windows` | `{id, manifest: "/l2/windows/<sha>/window.json", manifestSha256, manifestBytes}` | One manifest per root window (chosen in index). Duplicate rule (chosen in index): a root name that appears once keeps its bare name; a repeated root name gives every occurrence `<name>#<ordinal>`, 1-based in source order |
| `tiles` | `{id: "XX_YY", manifest: "/l2/tiles/<sha>/tile.json", manifestSha256, manifestBytes}` | The manifest is kind `native-tile-runtime` |

Manifest kinds:
- `native-tile-runtime` v1 (chosen in index):
  - Fields: `{kind, schemaVersion: 1, tileId, sourceMap, sourceSha256, frame, anchor, chunks, resources, gaps}`.
  - `frame` comes from TerrainInfo `Location`/`TerrainScale`.
  - `anchor` is the first enabled PlayerStart in source order: `{playerStart, location}`.
  - `chunks` is a list of `{chunkId, manifest, manifestSha256, manifestBytes}`.
  - `resources` is a list of `{kind, manifest, manifestSha256, manifestBytes}`. The accepted kinds come only from the world-owned `recipes/world/tile-manifest-vocabulary.json` `{schemaVersion: 1, listVersion, resourceKinds, maskUvRules}`, read by 02-04 `load_tile_manifest_vocabulary`. 02-16 creates it (empty lists, 02-04); 02-30 adds `native-tile-collision`, 02-31 `movers`, 02-45 `sky` and `world-audio`, 02-50 `minimap`, 02-61 `map-emitters` and `bsp-visibility`, and 02-62 `lighting`, each with a `listVersion` bump of one before its step writes that kind. Each plan lists the file in `files_modified`.
  - Tile resource kinds, listed together: `sky`, `world-audio`, `movers` and `minimap`, and the DEC-OWN-12 kinds `bsp-visibility` (one per tile, VIS-01), `native-tile-collision` (BSPT per map as a tile resource; VOLS, SMSH, PLAC, TERR and MOVR in the chunk `collision` resource; WORLD-08, MOVE-01) and `lighting` (one per tile, MAT-02). The three DEC-OWN-12 kinds are `.l2asset` with `asset.json` recording units source and axes UE2 Z up, written by `scripts/world/typed_payload.py` and read by `src/shared/typedPayload.ts`; `map-emitters` (FX-01) is a JSON manifest. The world lighting step (02-62) owns `lighting`. Plan 02-53 owns texture licensee and layout widening.
  - `gaps` holds gap rows.
- `native-tile-chunk-runtime` v1 (research 4.6):
  - Fields: `{kind, schemaVersion: 1, tileId, chunkId, sectorRange, terrain, models, bsp, collision, gaps}`.
  - `terrain`: `{resource, sha256, maskUvRule}`, where `maskUvRule` is `"extrapolated"` outside the 20_20 capture.
  - `models` holds zero or more model records.
  - `collision` is a separate resource, never fed by LOD: the chunk native-tile-collision `.l2asset` (02-30).
  - Chunk ids are `chunk-<column>-<row>`, with 0-based indices on the 4x4-sector grid (chosen in index).
  - The old `map-section-runtime` kind stays until the 20_20 chain retires.
- Table manifest `native-table` v1 (chosen in index): `{kind, schemaVersion: 1, table, sourcePath, sourceSha256, descriptorSha256, route, recordCount, records}`. `route` is `"local-descriptor"` or `"elbera-adapter"`.
- Window manifest `native-window-layout` v1 (chosen in index):
  - Fields: `{kind, schemaVersion: 1, windowId, name, sourceSha256, sourceOffset, root, textureRefs, anchorProof}`.
  - `root` holds the header fields, `children` and `tail: {offset, end, sha256}`.
  - `anchorProof` is `"Elbera NWindow af6c3437 proof, unverified on IMPORTA 7c12fb6b"`.
- `coverage.json` v1 (shape in 02-04, written by 02-07, completed by 02-26):
  - Fields: `{schemaVersion: 1, catalogSha256, storeRoot, generatedAtRiga, denominators, parts, rows}`.
  - `denominators` maps `<part>` to `{count | "unknown", source}`.
  - `parts` maps `<part>` to `{denominator, converted, loads: {pass, failed, unverified}, gap, pending}`.
  - `rows` is a list of `{key, part, status, reason, converted, loads}`, one row per denominator key.
- NPC profile join (02-05, written by 02-22, widened by 02-33): a profile carries `modelCatalogId` (chosen in index), the `id` of a `models` record. A mesh name never selects a profile.
- Characters: `character:<chargrpIndex>` resolves from `playerProfiles` records that carry `chargrpIndex` (chosen in index). 02-05 resolves it and 02-40 writes it.

### Browser catalog index and coverage reader (02-05, actors files)

- `readNativeCatalog` keeps `tables`, `windows` and `tiles`. Before 02-05, unknown slices are dropped silently, so 02-04 and 02-05 land back to back.
- `buildNativeCatalogIndex(catalog, signal)` keeps its signature. Its status is `"converted" | "not-in-catalog" | "gap"`.
  - `table:`, `window:` and `tile:` come from the new slices. The legacy `map-XX-YY-section` sections still answer `tile:`.
  - `gap` and its reason come from the `/l2/coverage.json` rows.
- `src/assets/native/readNativeCoverage.ts` (chosen in index) exports `readNativeCoverageUnlessAbsent(signal)`, mirroring `readNativeCatalogUnlessNotStaged`. It refuses a coverage file whose `catalogSha256` differs from the served catalog.
- Key builders: the existing `npcCatalogKey`, `itemCatalogKey`, `skillCatalogKey`, `windowCatalogKey` and the tile builder, plus `tableCatalogKey` and `characterCatalogKey` (chosen in index).

### NATIVE_STORE_ROOT dev plugin (02-06)

- `vite/nativeStoreRootPlugin.ts` exports `nativeStoreRootPlugin()` with `apply: "serve"`. It is registered in `vite.config.ts`.
- Environment: `NATIVE_STORE_ROOT=<lane name>` (`world`, `actors`, `data-ui`, `integration`), which resolves to `artifacts/lane-store/<lane>/l2`, or `NATIVE_STORE_ROOT=fixture` (`NATIVE_STORE_FIXTURE_NAME`), which resolves to the committed `tests/fixtures/lane-store/l2`. The plugin refuses a root that resolves to the realpath of `public/l2`.
- Serving:
  - `/l2/catalog.json` and `/l2/coverage.json` come only from the lane store.
  - Every other `/l2/` path comes from the lane store first, then from `public/l2` read-only (research open question 4).
  - Request paths are checked against a copy of the `nativeResourceUrl.ts` regex. An agreement test keeps the copy in step.
  - Content types: `.json`, `.glb`, `.png`, `.ogg`, `.wav`, and `.l2asset` as `application/zip`.
  - Single-range requests are supported for music (chosen in index from the research's two options).
- Build absence: `tests/unit/nativeStoreRootBuildAbsence.test.ts` plus a grep of `dist/`. The grep runs only outside machine windows.
- Fixture lane store `tests/fixtures/lane-store/`: catalog plus one model from the golden fixtures (02-06). 02-16 adds one chunk manifest.

### Load-check records (02-06 format and writer, 02-07 Python reader, 02-23 sweeps)

- File (path above): `{schemaVersion: 1, lane, catalogSha256, records: [{key, status: "pass" | "failed", reason, atRiga, assetManifestSchemaVersion}]}`. A new catalog SHA starts a new file. The file is rewritten atomically after each key. `assetManifestSchemaVersion` notes v1 or v2 (research 11.4).
- `tests/browser/support/loadCheckRecordFile.ts` (02-06, chosen in index): `hashServedLaneCatalog(baseUrl)`, `readLoadCheckRecords(laneName, catalogSha256)` and `writeLoadCheckRecord(laneName, catalogSha256, record)`. Tracers 02-16, 02-20 and 02-22 use it.
- `tests/browser/support/loadCheckRecords.ts` (02-23, research name):
  - Exports `pendingLoadCheckKeys(...)` and `runLoadCheckSlice(...)`. It skips keys already recorded.
  - Environment: `LOAD_CHECK_KIND` (`tiles`, `npcs`, `items`, `skills` or `windows`) and `LOAD_CHECK_LIMIT`.
  - Specs: `tests/browser/load-sweep-{tiles,npcs,items,skills,windows}.spec.ts`.

### CLIs and package scripts

- Common flags of lane converters (chosen in index):
  - `--client <root>` is checked by `require_reference_client`.
  - `--output <dir>` is checked by `require_converter_output`. It defaults to `artifacts/lane-store/<lane>/l2`.
  - Single-unit selectors leave receipts for that key only (research 11.17):
    - `--table <name>`
    - `--map XX_YY --step <step>`
    - `--npc <id>`
    - `--character <chargrpIndex>`
    - `--item <id>`
    - `--skill <id> --level <n>`
  - Batches use `--batch <kind> --limit <n>` on the ledger.
- Entry points (names chosen in index except where noted):
  - `scripts/data/convert_tables.py` (02-17; research name).
  - `scripts/data/convert_ui.py --step layout|textures` (02-19, 02-20).
  - `scripts/world/convert_tile.py --map XX_YY --step <step>`. The steps arrive in this order: `raw` (02-14), `chunks` and `terrain` (02-15), `manifest` (02-16), `meshes` (02-29), `bsp` and `collision` (02-30), `bsp-visibility` (new plan after 02-30: 02-61, with `emitters` before it), `movers` (02-31, after which `collision` runs again to add MOVR), `sky` and `audio` (02-45), `lighting` (02-62), `minimap` (02-50).
  - `scripts/world/convert_tile_batch.py --eligible --limit <n>` (02-47).
  - `scripts/actors/convert_actors.py`. The selectors arrive in this order: `--npc` (02-22), `--batch npcs` (02-34), `--character` (02-40), `--item` (02-42), `--skill/--level` (02-43).
- Until 02-25 lands, lane commands run as `python -B scripts/<lane>/...`.
- `package.json` (integration only):
  - `report:coverage` = `python -B scripts/native_store/build_coverage_report.py` (02-07).
  - `convert:tables`, `convert:world`, `convert:actors` and `convert:ui` point to the four entry points above (02-25).
  - No script uses a banned prefix. Only `assets:pipeline` may reach `native_batch` (02-08).
- `python -B scripts/native_store/write_lane_catalog.py --lane <lane> [--union <lane> ...] [--plan]` (02-03; flags other than `--plan` chosen in index):
  - It writes `artifacts/lane-store/<lane>/l2/catalog.json` with `sourceCatalogSha256` (the SHA-256 of the base `public/l2/catalog.json` bytes, read-only).
  - It refuses duplicate ids.
  - `--plan` writes nothing. It prints the Needs Human restage line. From 02-24 on, that line is the exact `merge_lane_store.py` command.
- `python -B scripts/native_store/build_coverage_report.py --store-root <dir> [--lane <lane>] [--output <file>] [--markdown docs/coverage.md]` (02-07; flags chosen in index):
  - It reads any catalog root, including `public/l2` read-only.
  - `--output` defaults to `<store-root>/coverage.json` and is refused under `public/l2`.
  - Denominators come only from committed data: the inventory, the lock and the committed censuses.
- `python -B scripts/native_store/merge_lane_store.py --lane-store <dir> --target <main-checkout public/l2> --expected-base-catalog-sha256 <sha>` (02-24; flags chosen in index):
  - It refuses differing immutable files, duplicate ids, a wrong base SHA and v1 lane archives.
  - It is tested on temp dirs only and never run here.
- `node scripts/check-lane-ownership.mjs --base <plan start> --part <slug>`: unchanged from Phase 1. Contract plans use `--part adapter-dispatch` (research A7).
- Environment variables: `DEV_PORT`, `NATIVE_STORE_ROOT`, `LOAD_CHECK_KIND`, `LOAD_CHECK_LIMIT`, `WORLD_HARDWARE_TEST=1`.

### WorldCommand and sandbox actions

- 02-10 adds exactly two `WorldCommand` members to `src/world/worldTypes.ts` (research 11.3, A12):
  - `{ type: "spawn-character"; characterTemplateIndex: number }`
  - `{ type: "play-clip"; entityId: string; clipName: string }`
- `NativeSliceAdapter` switches with an exhaustive `never` (02-10 also covered `MockWorldAdapter`, which DEC-OWN-11 removed afterwards; later plans use `NativeSliceAdapter` or a test-only double). `tests/unit/gameWorldAdapterContract.test.ts` enumerates the command set. The five `GameWorldAdapter` methods stay frozen.
- 02-58 adds the DEC-OWN-12 D6 record types in one contract commit before adapter code: events `command-rejected`, `environment`, `move`, `stop`, `correct`, `teleport`; commands `report-position`, `cannot-move`; an origin on `move-local`; EntityKind `npc`; and the typed pre-world `AccountSession`. Movement records and intents carry source units, `WorldEntity` stays metres through `src/world/sourceFrame.ts` (D1).
- Tile selection and audio volume are not WorldCommands. They are runtime actions:
  - Tile selection is a `?map=XX_YY` reload. `src/scene/world/selectedNativeTile.ts` (02-16, chosen in index) exports `selectedNativeTileIdentity(location)` and is the only reader of `?map=`.
  - Audio uses the `WorldAudioMixer` `setMuted`, `setVolume`, `setBusVolume` and `setBusMuted`.
- `src/ui/devSheet/sandboxPickerHost.ts` (02-35, chosen in index) defines `SandboxPickerHost`: `{ dispatch(command), reloadTile(tileId), openWindow(windowId) }` (02-35 and 02-37 carry no audio members; the Audio section is the SAND-02 audio control). 02-39 widens it with `ActorClipListingSource` from 02-36 (`actorClipEntityIds()`, `actorClipListing(entityId)`, `previewing(entityId)`).
- `src/ui/devSheet/sandboxPickerRegistry.ts` (02-35, chosen in index) exports `sandboxPickerSections`, a list of `SandboxPickerFactory` entries `{ id, title, attach(group, context) }`; each receives a `SandboxPickerContext` whose `host` is the `SandboxPickerHost`. Later pickers (02-39 `createClipPicker()`) register there.
- `src/runtime/sandboxRuntimeActions.ts` (02-37, chosen in index) exports `createSandboxRuntimeActions(...)`, which implements `SandboxPickerHost`. 02-37 mounts the registry once in `src/runtime/attachSandboxCommandSheet.ts`, the Sandbox section that `src/runtime/createNativeSliceRuntime.ts` attaches since 01-14; `createNativeSliceRuntime.ts` creates the host and the native window layer. `attachNativeSliceSheet.ts` does not hold the picker wiring. It also presents spawn-character (character visual, or the missing marker for `character:<index>`) and play-clip, using the clip API from 02-36. Declared cross-lane edit, the one exception to rule 14: 02-39 (data-ui, sandbox) adds the option `clipListings: ActorClipListingSource` and its three delegating members to `createSandboxRuntimeActions`, and passes the runtime's `clipPreview` hub at the `createNativeSliceRuntime.ts` call site, in one contract commit that touches only those two `src/runtime/**` files, checked with `--part adapter-dispatch` and logged in OVERNIGHT-DECISIONS.
- Sheet variables reuse `VariableInfo` statuses `"native" | "presentation" | "unverified"` and `describe(element, info)` (owner preference: a pinnable sheet with hover-cards).

### Censuses and committed data (no Lineage II bytes)

- `recipes/world/oracle/20_20/expected.json` (02-12): counts and hashes, all read from the junction read-only and pinned to the catalog SHA:
  - `map-20-20-section` manifest `2e73654e...`, 62 models, 157 placements, Brush397 and Brush610 subsets.
  - Sky `f7a0b5ef...`, environment `e10827c4...`, movers `0de5d083...` with 8 movers.
- `docs/parts/world/tile-census.json` (02-12, extended by 02-13 and 02-54):
  - Fields: `{schemaVersion: 1, referenceTreeLockSha256, maps: [{map, kind: "tile" | "non-tile", key, packageVersion, licensee, wrapper, mapReaderGate, terrainHeightGate, terrainMapPackage, status: "eligible" | "gap", reason}]}`. Fields chosen in index.
  - It covers 153 tiles plus 10 non-tile maps. Coverage reads it.
- `docs/parts/npcs/actor-unit-census.json` (02-21, chosen in index):
  - Fields: `{schemaVersion: 1, packages: [{path, packageVersion, licensee, skeletalReaderGate}], units: [{key, part, unitKind, status: "convertible" | "gap", reason, sourceIdentity}]}`.
  - `unitKind` covers NPC (mesh, ordered textures), weapon mesh, armor mesh per race column, chargrp row, skill root and sound row.
- `docs/parts/ui/texture-package-census.json` (02-18): `{schemaVersion: 1, packages: [{path, packageVersion, licensee, reviewed, reason}]}`.
- `docs/parts/data/dat-table-inventory.json` (Phase 1, updated by 02-17, 02-27 and 02-28): rows `{table, route, recordCount, status}`, where `recordCount` is a sourced integer or `"unknown"`.
- Denominators (research 4.8):
  - Tables: 40.
  - Tiles: 153 (lock).
  - NPCs: npcgrp, 6,519.
  - Items: itemname-e, 9,238.
  - Skills: skillgrp, 29,812 rows.
  - Characters: chargrp, 15 rows, without the padding row.
  - Windows: `"unknown"` until 02-19, then the measured counts. Never the PORT_SCOPE "about 140".

### Elbera adapters (pinned commit `12c9656`, data and UI only)

- `scripts/data/pinned_elbera_module.py` (02-19, chosen in index) exports `load_pinned_elbera_module(relative_path, expected_sha256)` (with `sys.dont_write_bytecode = True`) and `require_pinned_elbera_script(relative_path, expected_sha256)`. Callers:
  - 02-19: `tools/xdat/parse_xdat.py` `scan` and `build_tree`, with `data_g` set and never `main --check`.
  - 02-28: `tools/ui/check_hair_selection_native.py` `hair_pairs` and `keyed_hair_pairs`, never `verify` or `--check`.
- The checkout location is the one constant in `scripts/data/pinned_elbera_module.py`; no other plan names it. World collision runs no Elbera code: the vendored `scripts/vendor/lineage2elbera_bsp/` reader is in-repo, world-owned converter code pinned in SOURCE.json, and the Elbera collision, terrain and MoveActor modules are read-only behaviour references (DEC-OWN-12).
- Elbera reads E: unguarded through its `assets/interlude` junction, so every input passes `require_equal_file` first.
- Labels: "Elbera 07b24 proof, unverified on 4dd2" (DATA-02). "Elbera NWindow af6c3437 proof, unverified on IMPORTA 7c12fb6b" (UI-01 anchors).

### UI, clip and world runtime modules

- `src/ui/nativeWindows/` (data-ui):
  - `nativeWindowLayoutTree.ts` with `parseNativeWindowManifest` (02-19).
  - `nativeWindowRenderer.ts` with `renderNativeWindow(container, windowManifest, worldState)` (02-20).
  - `nativeWindowAnchors.ts`, an anchor resolver labelled unverified (02-20).
  - `nativeWindowRegistry.ts` (02-38).
  - `minimapControl.ts` and `worldMapView.ts` (02-51).
  - Names chosen in index except the folder.
- The harness page `tests/browser/harness/native-window.html` with `nativeWindowHarness.ts` (02-20, chosen in index) renders one window by `?window=<id>` from the served lane store.
- `src/assets/native/actorClipEvents.ts` (`parseActorClipEvents`) and `src/animation/actorClipPlayback.ts` (`listActorClips`, `playActorClip`) come from 02-36 (chosen in index). They are typed over the existing `animationEvents`, with no new decoder.
- `src/scene/world/`:
  - `nativeTileChunkManifest.ts` (`parseNativeTileChunkManifest`) and `loadNativeTileChunks.ts` (02-16).
  - `worldResidencyRing.ts` (02-49).
  - `minimapJoin.ts` (02-50).
  - Names chosen in index except `nativeTileChunkManifest`.
- `src/scene/world/movement/core/collisionWorld.ts` (02-48, world, movement-geodata) has `requireCell(cellId, footprint)`, `addCell(cellId, cell)`, `removeCell(cellId)` and `isReady(position)` on the MOVE-01 core's collision world, fed by `src/scene/world/movement/loadCollisionCells.ts`. `collisionCellContextFor(scene)` hands the world and the player focus to the world loader; 02-67 provides it from the runtime and retires `meshNavigation.ts`, `WorldNavigation.ts` and `syntheticMovement.ts`. The collision world takes native-tile-collision resources only, never a mesh.

### DEC-OWN-12 shared names (02-56 to 02-69)

- `src/shared/` (02-56, integration): `readTypedPayload` (container `asset.json {units, axes, sourceSha256, converterVersion, arrays}` plus one little-endian payload, array names `<GROUP>.<field>`), `math/` (vector, affine matrix, plane), `math/rotator.ts` (one rule per use), `random.ts` (domain-tagged streams), `presentationClock.ts`, `fixedStep.ts`. `src/world/sourceFrame.ts` is the only source-to-scene transform (`world = (x, z, y) * 0.01`). `tests/support/goldenTrace.ts` and `typedPayloadFixture.ts` are shared test helpers.
- 02-57: `tests/unit/importBoundaries.vendor.test.ts` (D7) and `tools/reference-overlap/referenceOverlap.mjs --area <area>` (reviewer at 12 tokens, blocking at 20).
- 02-59: `scripts/native_assets_lib/class_defaults.py` `read_class_defaults_with_provenance` (authored, class-default, ue-zero), `material_graph.py` `read_material_graph`, `material_program.py`, `material_resources.py` (`/l2/native-materials/<sha>/graph.json` and `program.json`).
- 02-60: `src/materials/ue2/model/**` and `src/materials/ue2/babylon/material.ts` (`createNativeMaterial`, `particleFragmentChain`); swatch harness `tests/browser/harness/material-swatch.html`.
- World: `scripts/world/typed_payload.py` and `level_model.py` (02-30), `level_zones.py` and `bsp_leaf_membership.py` (02-61), `computeTileVisibilityFrame` and `memberVisible` (02-63), `cameraEnvironment.ts` and `worldEnvironmentClock.ts` (02-64), `moveActor`, `singleLineCheck`, `pointCheck`, `volumesContaining` (02-65), `createMovementPresenter`, `calculateBehindView`, `traceClickDestination` (02-66).
- Actors: `createEffectScheduler` and the `sim/` emitters (02-68), `playTileMapEmitters` and `bindParticleMaterial` (02-69); `recipes/actors/emitter-class-coverage.json` lists the simulated classes (02-43, extended by 02-68 and 02-69).
- Integration runtime: `wireWorldMovement`, `wireWorldEnvironment`, `installTransparentRenderingOrder` (02-67; one comparator by distance then per-actor emitter ordinal, no absolute alphaIndex).
- Constants rows everywhere: `{id, value, provenance, status, interludeEvidence, runtimeDefault}`, status `ue2-data`, `unconfirmed`, `confirmed-interlude`, `corrected-interlude` or `unknown` (`recipes/world/bsp-visibility.json`, `movement-native-rules.json`, `lighting-rules.json`, `src/materials/ue2/model/constants/`, `docs/parts/skills-effects/PARTICLE_SEMANTICS.md`).

### Docs owners

- `docs/OUTPUT_CONTRACT.md` (integration):
  - Lane-store note with the mixed prefixes (02-01).
  - New slices, manifest kinds and the `coverage.json` envelope (02-04).
  - Load-check records (02-06).
  - "Source preservation", including the repair steps with defect evidence (02-08).
- `docs/coverage.md` (integration): owned by 02-07, refreshed by 02-26 and 02-55.
- `docs/parts/<part>/EVIDENCE.md`: owned by its lane, under about 30 KB. A lane never edits another lane's evidence.
- `STATUS.md` (one line per part) and `.planning/STATE.md` Needs Human lines go in each plan's docs commit. The Needs Human format is `Needs Human (plan 02-NN): <exact main-checkout command>`.

### Departures to log in OVERNIGHT-DECISIONS (research 11.16, new ids)

| Departure | Plan |
|---|---|
| `--part adapter-dispatch` for contract plans | 02-01 |
| `unit_ledger` over `native_batch` adapters | 02-02 |
| `docs/coverage.md` over an EVIDENCE table | 02-07 |
| Two-member WorldCommand | 02-10 |
| WORLD-07 review before the tracers | 02-11 |
| CP and MP as `adapter-field-absent` gaps; the CONTEXT F DESIGN.md parts are obsolete | 02-20 |
| Model record per (mesh, ordered textures) | 02-22 |
| Flat `.ddf` copy, hairgrp only | 02-28 |
| Null-level LOD | 02-49 |
| 02-48 moves from integration to world (collision world cells instead of mesh navigation) | 02-48 |
| No Elbera collision cross-check; collision from the stored tree and declared sources | 02-30 |
| Recast to devDependencies rather than removal | 02-57 |
| The sandbox adapter stands in for the server on report-position and cannot-move | 02-58 |
| Swatch route as a dev-only harness page | 02-60 |

## Planning groups

| Group | Plans | Focus |
|---|---|---|
| 1. Store and catalog contracts | 02-01, 02-02, 02-03, 02-04, 02-05, 02-06, 02-07 | Lane store and output guard, ledger, gap rows and schedule check, catalog writer, new keys and manifest kinds, dev plugin, coverage |
| 2. Converter contracts and integration tail | 02-08, 02-09, 02-10, 02-23, 02-24, 02-25, 02-26, 02-55 | CONV tests, converter cost, WorldCommand, load-check sweeps, merge tool, sandbox gap notes, gap census, union and restage handoff |
| 3. World tracer and steps | 02-11, 02-12, 02-13, 02-14, 02-15, 02-16 | WORLD-07 review, 20_20 oracle and tile census, terrain-height gate, raw, chunk and terrain steps, 20_21 walk |
| 4. Data, UI and sandbox sheet | 02-17, 02-18, 02-19, 02-20, 02-27, 02-28, 02-35, 02-37, 02-38 | Table decode and DATA-03, texture census, xdat tree, StatusWnd, all tables and hair tables, DevSheet pickers, runtime wiring, window registry at 932 x 430 |
| 5. Actors census, tracer and NPCs | 02-21, 02-22, 02-32, 02-33, 02-34 | `.ukx` census and unit inventory, Gremlin tracer, multi-slot binding, NPC contract widening, NPC batches |
| 6. Actors characters, items, skills, clips and audio | 02-36, 02-39, 02-40, 02-41, 02-42, 02-43, 02-44 | Clip API and picker, chargrp characters, equipment slots and items, skill binding table, actor sound bindings |
| 7. World geometry, collision, sky and audio | 02-29, 02-30, 02-31, 02-45, 02-46, 02-47 | Static meshes, BSP and collision, movers, sky and tile audio, eligible-39 batch |
| 8. World streaming, maps and reader growth | 02-48, 02-49, 02-50, 02-51, 02-52, 02-53, 02-54 | Collision world cells, streaming baseline and residency, minimap and world map, map, terrain and static-material reader growth, licensee tiles |
| 9. DEC-OWN-12 own implementations | 02-56, 02-57, 02-58, 02-59, 02-60, 02-61, 02-62, 02-63, 02-64, 02-65, 02-66, 02-67, 02-68, 02-69 | Shared modules and source frame, vendor boundary and overlap check, adapter record types, class-default and material readers, material library, zones, map emitters and BSP visibility, lighting, the visibility walk, lighting runtime, the movement port, runtime wiring, the emitter port |

## Plan details

Each entry gives the one-line objective and the key `files_modified`. Planners add tests and files as needed, inside the lane's globs.

### Group 1: store and catalog contracts

- **02-01 Store paths and output guard.** One store-paths module refuses junction and `public/l2` writes. It binds the guard into the integration-owned converter entry points, moves `scripts/build_dat_table_inventory.py` to data-ui in `lanes.json`, documents the real lane-store prefixes, and records the actual red unit-test baseline. Files: `scripts/native_store/__init__.py`, `scripts/native_store/store_paths.py`, `scripts/native_assets.py`, `scripts/native_batch.py`, `scripts/stage_native_players.py`, `.planning/lanes.json`, `docs/OUTPUT_CONTRACT.md`, `tests/pipeline/test_store_paths.py` (temp junction through `_winapi.CreateJunction`, skipped with a reason when unavailable), `tests/pipeline/test_converter_output_guard.py`.
- **02-02 Unit ledger, gap rows and machine schedule.** One resumable seal ledger whose fingerprint holds no self-hash. A batch preflight checks the machine window, free disk, the junction and BelowNormal priority. The plan also adds the gap-row schema with the seed reason list, and `check-machine-schedule.mjs` with a Playwright globalSetup. Files: `scripts/native_store/unit_ledger.py`, `scripts/native_store/gap_rows.py`, `scripts/native_store/gap_reasons.json`, `scripts/check-machine-schedule.mjs`, `scripts/check-machine-schedule.d.mts`, `playwright.config.ts`, `tests/browser/support/machineScheduleGlobalSetup.ts`, `tests/pipeline/test_unit_ledger.py` (injected clock and disk), `tests/pipeline/test_gap_rows.py`, `tests/unit/checkMachineSchedule.test.ts`.
- **02-03 Catalog writer library and lane catalog.** Extract the pure build, merge and write functions from the stagers. The stagers keep their CLIs, are never run, and lose their comments. Add `write_lane_catalog.py`, which writes `sourceCatalogSha256`, unions lane stores with duplicate refusal, and prints the Needs Human handoff under `--plan`. Files: `scripts/native_store/catalog_writer.py`, `scripts/native_store/write_lane_catalog.py`, `scripts/stage_native_runtime.py`, `scripts/stage_native_world_audio.py`, `tests/pipeline/test_lane_catalog_writer.py` (golden fixtures, byte-identical twice).
- **02-04 Catalog keys writer half and tile manifest kinds.** Document and validate the `tables`, `windows` and `tiles` records, the `native-tile-runtime` and `native-tile-chunk-runtime` v1 manifests and the `coverage.json` envelope, then regenerate the golden fixtures. Files: `docs/OUTPUT_CONTRACT.md`, `scripts/native_store/catalog_writer.py`, `scripts/native_store/tile_manifest_validation.py`, `scripts/generate_golden_fixtures.py`, `tests/fixtures/golden/l2/catalog.json`, `tests/fixtures/golden/fixtures.lock.json`, `tests/pipeline/test_catalog_record_shapes.py`, `tests/pipeline/test_asset_manifest_v2.py`.
- **02-05 Catalog keys reader half.** `readNativeCatalog` keeps the new slices. The index answers `table:`, `window:`, `tile:` and `character:` keys and a `gap` status from `/l2/coverage.json`. NPC lookup joins by `modelCatalogId`. Files: `src/assets/native/readNativeCatalog.ts`, `src/assets/native/nativeCatalogIndex.ts`, `src/assets/native/readNativeCoverage.ts`, `tests/unit/readNativeCatalog.test.ts`, `tests/unit/nativeCatalogIndex.test.ts`, `tests/unit/readNativeCoverage.test.ts`.
- **02-06 NATIVE_STORE_ROOT dev plugin.** A serve-only Vite plugin serves `/l2/*` from a lane store with a read-only `public/l2` fallback, and is proven absent from the build. The plan also adds the fixture lane store and the load-check record file helper, and moves the `vite.config.ts:1` licence line to `THIRD_PARTY_NOTICES.md`. Files: `vite/nativeStoreRootPlugin.ts`, `vite.config.ts`, `THIRD_PARTY_NOTICES.md`, `tests/fixtures/lane-store/**`, `tests/browser/support/loadCheckRecordFile.ts`, `tests/unit/nativeStoreRootPlugin.test.ts`, `tests/unit/nativeStoreRootBuildAbsence.test.ts`, `tests/unit/loadCheckRecordFile.test.ts`, `tests/browser/lane-store-switch.spec.ts`, `docs/OUTPUT_CONTRACT.md`.
- **02-07 Coverage skeleton.** `build_coverage_report.py` writes `coverage.json` and `docs/coverage.md` from committed denominators and from load-check records only, and adds `report:coverage`. Every tile is `gap: census-pending` until 02-12 lands. Files: `scripts/native_store/build_coverage_report.py`, `scripts/native_store/load_check_records.py`, `package.json`, `docs/coverage.md`, `STATUS.md`, `tests/pipeline/test_coverage_report.py`.

### Group 2: converter contracts and integration tail

- **02-08 CONV-01 and CONV-02 contract tests.** Contract tests pin the UModel SHA-256, the `.l2asset` limits and the magenta `[1, 0, 1, 1]` slots. A scan bans normalisation, ground fitting, root-drift removal and weight renormalisation, with an allow-list for `restore_native_weights` and `audit_musveren_weights.py`. Further tests prove that one target, one skill and one tile convert alone and that no `convert:*` entry uses a banned prefix or `native_batch`. OUTPUT_CONTRACT gains "Source preservation", which lists every repair, restore and preserve step with its defect evidence. Files: `tests/pipeline/test_source_preservation_contract.py`, `tests/pipeline/test_converter_independence.py`, `docs/OUTPUT_CONTRACT.md`.
- **02-09 Converter cost fix.** `Converter.source` and cache hits trust the lock `eSha256` when size and mtime match, with a per-batch memo. The `evidence/` copy keeps the log and the export manifest and drops the intermediate glTF (research A10). Files: `scripts/native_assets.py`, `tests/pipeline/test_native_assets_source_cache.py`.
- **02-10 WorldCommand sandbox contract.** Add `spawn-character` and `play-clip`. Both adapters handle them with an exhaustive `never`, and a contract test enumerates the command set. Files: `src/world/worldTypes.ts`, `src/world/sandboxCommands.ts`, `src/world/MockWorldAdapter.ts` (removed afterwards by DEC-OWN-11), `src/world/NativeSliceAdapter.ts`, `tests/unit/gameWorldAdapterContract.test.ts`, `tests/unit/sandboxCommands.test.ts`.
- **02-23 Load-check sweeps.** A resumable sweep helper and five sweep specs record pass or failed per catalog key, pinned to the served catalog SHA. Plans 02-34, 02-38, 02-42, 02-43 and 02-47 each end with one slice. Files: `tests/browser/support/loadCheckRecords.ts`, `tests/browser/load-sweep-tiles.spec.ts`, `tests/browser/load-sweep-npcs.spec.ts`, `tests/browser/load-sweep-items.spec.ts`, `tests/browser/load-sweep-skills.spec.ts`, `tests/browser/load-sweep-windows.spec.ts`, `tests/unit/loadCheckRecords.test.ts`.
- **02-24 Lane store merge tool.** `merge_lane_store.py` verifies before it copies and refuses differing immutable files, duplicate ids, a wrong base SHA and v1 lane archives. It is tested on temp dirs and never run here. `write_lane_catalog.py --plan` prints its exact command. Files: `scripts/native_store/merge_lane_store.py`, `scripts/native_store/write_lane_catalog.py`, `tests/pipeline/test_merge_lane_store.py`.
- **02-25 Integration tracer: sandbox available or gap.** For every by-ID action, the sandbox sheet shows converted, gap or not-in-catalog, with the reason, from the index. `package.json` gains `convert:tables`, `convert:world`, `convert:actors` and `convert:ui`. A Playwright screenshot is taken at 1440 x 900 and 932 x 430. Files: `package.json`, `src/runtime/attachSandboxCommandSheet.ts`, `tests/unit/sandboxCoverageNotes.test.ts`, `tests/browser/sandbox-coverage-notes.spec.ts`.
- **02-26 Gap census.** Every denominator row in every part (tables, tiles and non-tile maps, NPCs, items, skills, characters, windows) has exactly one status. A test fails on a missing row or an unlisted reason. Files: `scripts/native_store/gap_census.py`, `scripts/native_store/build_coverage_report.py`, `tests/pipeline/test_gap_census.py`, `docs/coverage.md`.
- **02-55 Integration union and restage handoff.** Union the lane stores into `artifacts/lane-store/integration/l2/` and re-run coverage and the gap census. Append the Needs Human merge command. INT-01 stays "partial: staging Needs Human". Files: `docs/coverage.md`, `STATUS.md`, `.planning/STATE.md`.

### Group 3: world tracer and steps

- **02-11 WORLD-07 independent review.** A read-only Claude reviewer subagent, not the packet's author, re-hashes the 74-file packet in the main checkout (read-only). It gives each finding one verdict (adopted, rejected, polish) in world EVIDENCE, recording agent type, model id, time and re-hash result. The plan copies the scanned layer-sequence and music-join fixtures (paths dropped, manifest SHA kept) into `tests/fixtures/world-07/`. Files: `scripts/world/copy_world07_fixtures.py`, `tests/fixtures/world-07/**`, `tests/pipeline/test_world07_fixture_copy.py`, `tests/pipeline/test_terrain_layer_order_fixtures.py`, `tests/pipeline/test_music_volume_join.py`, `docs/parts/world/EVIDENCE.md`.
- **02-12 World oracle and tile census.** Freeze the 20_20 oracle (sections, BSP subsets, sky, environment, movers) into `expected.json`, which holds no L2 bytes. Commit the census of 153 tiles and 10 non-tile maps with gate results, so every ineligible tile is a gap. Files: `scripts/world/freeze_world_oracle.py`, `scripts/world/tile_census.py`, `recipes/world/oracle/20_20/expected.json`, `docs/parts/world/tile-census.json`, `tests/pipeline/test_world_oracle.py`, `tests/pipeline/test_tile_census.py`.
- **02-13 Terrain-height gate census.** Record each tile's `TerrainMap` package and licensee in the census, with `terrain-height-licensee-unsupported:123/<lic>` or `terrain-height-package-missing`, which turns research A11 into evidence. Files: `scripts/world/tile_census.py`, `docs/parts/world/tile-census.json`, `tests/pipeline/test_tile_census.py`.
- **02-14 World raw step.** Split `native_map.py` under 400 lines into `scripts/world/` modules, make the section box optional, and run the raw step per `--map` on the ledger. The real-client 20_21 case skips when E: is absent. Files: `scripts/native_map.py`, `scripts/world/raw_map_step.py`, `scripts/world/convert_tile.py`, new `scripts/world/` modules split from `native_map.py`, `tests/pipeline/test_world_raw_step.py`.
- **02-15 Chunk planner and terrain step.** Plan the 4x4-sector chunks from TerrainInfo, anchored at the first enabled PlayerStart. Write the per-chunk terrain labelled `extrapolated` under the `require-xy-preserve-z-discrepancies` policy, adopting any 02-11 layer-order verdicts. Split `native_map_geometry.py`. Files: `scripts/native_map_geometry.py`, new `scripts/world/` modules split from it, `scripts/world/tile_chunk_plan.py`, `scripts/world/terrain_chunk_step.py`, `scripts/world/convert_tile.py`, `tests/pipeline/test_tile_chunk_plan.py`, `tests/pipeline/test_terrain_chunk_step.py`.
- **02-16 World tracer 20_21 walk.** Write the 20_21 tile and chunk manifests and the lane catalog `tiles` record. Load them by `?map=20_21`, with terrain collision passed at construction. Walk the tile through `NATIVE_STORE_ROOT=world`, writing a load-check record. Meshes, BSP, sky and audio stay `pending`. Files: `scripts/world/tile_manifest_step.py`, `scripts/world/convert_tile.py`, `src/scene/world/selectedNativeTile.ts`, `src/scene/world/nativeTileChunkManifest.ts`, `src/scene/world/loadNativeTileChunks.ts`, `src/scene/world/loadNativeSection.ts`, `tests/unit/nativeTileChunkManifest.test.ts`, `tests/fixtures/lane-store/**`, `tests/browser/world-tile-walk.spec.ts`.

### Group 4: data, UI and sandbox sheet

- **02-17 Data tracer: generic decode and DATA-03.**
  - Pin 29 more layouts in a pins module and share one case-insensitive source resolver with the inventory. Fix the hard-coded `source` and make uniqueness data-driven.
  - Bind the output guard in `native_catalog/cli.py`.
  - Add `convert_tables.py` on the ledger, decoding the gap-key tables first (`itemname-e`, `etcitemgrp`, `classinfo-e`, `npcname-e`, `skillname-e`). A cp1252 decode error becomes a `decode-failed` row.
  - Settle the sysstring-e and systemmsg-e count by strict decode.
  - Files: `scripts/native_catalog/tables.py`, `scripts/native_catalog/table_layout_pins.py`, `scripts/native_catalog/table_source_resolver.py`, `scripts/native_catalog/cli.py`, `scripts/build_dat_table_inventory.py`, `scripts/data/convert_tables.py`, `scripts/data/sysstring_systemmsg_counts.py`, `docs/parts/data/dat-table-inventory.json`, `docs/parts/data/EVIDENCE.md`, `tests/pipeline/test_table_source_resolver.py`, `tests/pipeline/test_convert_tables.py`, `tests/pipeline/test_sysstring_systemmsg_counts.py`, `tests/pipeline/test_dat_table_inventory.py`, `tests/pipeline/test_converter_output_guard.py`.
- **02-18 UI texture package census.** A header-only census of `systextures/*.utx` through `require_equal_file`, checked against `REVIEWED_VERSIONS`, into a committed JSON. Files: `scripts/data/texture_package_census.py`, `docs/parts/ui/texture-package-census.json`, `tests/pipeline/test_texture_package_census.py`.
- **02-19 UI-01 layout tree.** Decode `interface.xdat` (lock-equal, SHA `b5b37678...`) through the pinned Elbera adapter into per-window manifests with hashed opaque tails and the duplicate-id rule. Record the declared, root and control counts; the test asserts 165 declared and never asserts 248. The REQUIREMENTS.md UI-01 text fix goes in the docs commit. Files: `scripts/data/pinned_elbera_module.py`, `scripts/data/interface_layout_adapter.py`, `scripts/data/convert_ui.py`, `src/ui/nativeWindows/nativeWindowLayoutTree.ts`, `tests/fixtures/xdat/**` (synthetic header builder), `tests/pipeline/test_interface_layout_adapter.py`, `tests/unit/nativeWindowLayoutTree.test.ts`, `docs/parts/ui/EVIDENCE.md`.
- **02-20 UI tracer window:StatusWnd.** Render StatusWnd from the decoded tree with UI textures converted through the guarded converter, or per-control texture gaps. HP comes from the `NativeSliceAdapter` local player (DEC-OWN-11 removed `MockWorldAdapter`), CP and MP are `adapter-field-absent` gaps, and labels stay unresolved. A test proves no control name is a literal. The window is checked on the harness page at 932 x 430 and 1440 x 900. Files: `src/ui/nativeWindows/nativeWindowRenderer.ts`, `src/ui/nativeWindows/nativeWindowAnchors.ts`, `scripts/data/ui_texture_step.py`, `scripts/data/convert_ui.py`, `recipes/data/ui-textures.json` (generated from the tree, never typed), `tests/unit/nativeWindowRenderer.test.ts`, `tests/browser/harness/native-window.html`, `tests/browser/harness/nativeWindowHarness.ts`, `tests/browser/native-window-statuswnd.spec.ts`.
- **02-27 Remaining tables and name indexes.** Decode all 37 descriptor-linked tables with seals, regenerate the inventory and its test tallies, and emit small npcname, itemname and skillname indexes for the pickers. Files: `scripts/data/convert_tables.py`, `scripts/data/table_name_indexes.py`, `docs/parts/data/dat-table-inventory.json`, `tests/pipeline/test_convert_tables.py`, `tests/pipeline/test_dat_table_inventory.py`.
- **02-28 Hair tables.** Decode hairgrp, helmetgrp and hairaccessarygrp through the pinned Elbera importer, labelled "Elbera 07b24 proof, unverified on 4dd2", with a UCHAR versus int32 cross-check. Cross-check hairgrp against the flat lock-equal `.ddf` read through the guard. Files: `scripts/data/hair_table_adapter.py`, `docs/parts/data/dat-table-inventory.json`, `tests/pipeline/test_hair_table_adapter.py`.
- **02-35 DevSheet split and pickers.** Split `DevSheet.ts` (734 lines) and strip all its comments. Add tile, spawn, equip, cast, window and audio pickers with hover-card variables, driven by catalog names, behind `SandboxPickerHost` and `sandboxPickerRegistry`. Files: `src/ui/devSheet/DevSheet.ts` and its split modules, `src/ui/devSheet/sandboxPickerHost.ts`, `src/ui/devSheet/sandboxPickerRegistry.ts`, `src/ui/devSheet/tilePicker.ts`, `spawnPicker.ts`, `equipPicker.ts`, `castPicker.ts`, `windowPicker.ts`, `audioPicker.ts`, `tests/unit/devSheetPickers.test.ts`, `docs/parts/sandbox/EVIDENCE.md`.
- **02-37 Sandbox runtime wiring.** `SandboxRuntimeActions` wires the picker registry into the runtime: tile reload, dispatch, window opening and mixer mute and volume. It also presents spawn-character and play-clip. Files: `src/runtime/sandboxRuntimeActions.ts`, `src/runtime/attachSandboxCommandSheet.ts`, `src/runtime/createNativeSliceRuntime.ts`, `src/runtime/sandboxCharacterVisual.ts`, `src/entities/EntityRegistry.ts`, `tests/unit/sandboxRuntimeActions.test.ts`, `tests/browser/sandbox-sheet-pickers.spec.ts`.
- **02-38 Window registry and UI-03.** Render every root window, with gap rows for each unsupported control type or texture, and open any window by id. A scan rejects colour literals, `font-family` and images outside `/l2/`. Checks run at 932 x 430 and 430 x 932 (no horizontal scroll), plus 1440 x 900. The plan ends with a windows sweep slice. Files: `src/ui/nativeWindows/nativeWindowRegistry.ts`, `src/ui/nativeWindows/nativeWindowRenderer.ts`, `scripts/data/convert_ui.py`, `tests/unit/nativeWindowStyleSources.test.ts`, `tests/browser/native-window-layout.spec.ts`, `docs/parts/ui/EVIDENCE.md`.

### Group 5: actors census, tracer and NPCs

- **02-21 Actors census and unit inventory.** A header census of the 20 `.ukx` files and `Skill.usk` through `inspect_header` behind the guard. A unit inventory from the decoded tables covers NPCs (mesh, ordered textures), weapons, armor per race column, the 15 chargrp rows, skill roots and sound rows, each convertible or a gap. Files: `scripts/actors/actor_census.py`, `scripts/actors/actor_unit_inventory.py`, `docs/parts/npcs/actor-unit-census.json`, `docs/parts/npcs/EVIDENCE.md`, `tests/pipeline/test_actor_census.py`.
- **02-22 Actors tracer npc:20001 Gremlin.**
  - Generate the request and the profile from the row. Unresolved fields become gaps, not raises.
  - Take the animation from the serialized reference, or record `animation-reference-missing`.
  - Label the exact `MonSound.*` identities as `unique-package-leaf-candidate`.
  - Convert into the actors lane store with a model record per (mesh, ordered textures).
  - Spawn the Gremlin by id with its clips, plus the `npc:20002` missing marker.
  - Files: `scripts/actors/npc_requests.py`, `scripts/actors/convert_actors.py`, `scripts/native_actor_profiles.py`, `tests/pipeline/test_npc_requests.py`, `tests/browser/sandbox-npc-gremlin.spec.ts`, `docs/parts/npcs/EVIDENCE.md`.
- **02-32 Multi-slot verify_binding.** `verify_binding` accepts a list of slot bindings, so multi-texture NPC rows (5,199 rows) convert, and unbound slots stay magenta. Files: `scripts/native_assets.py`, `tests/pipeline/test_native_assets_slot_bindings.py`.
- **02-33 NPC contract widening.** Join profiles to models by `modelCatalogId` and lift the 16 x 128 profile caps in lane code. The `stage_native_runtime.py:215` cap becomes a Needs Human staging line. Drop the `musveren:0` hard-code and fix the 2 red `nativeNpcProfiles` cases. Files: `src/assets/native/loadNativeNpcProfiles.ts`, `src/assets/native/loadNativeCatalog.ts`, `src/assets/native/nativeCatalogIndex.ts`, `scripts/native_actor_profiles.py`, `tests/unit/nativeNpcProfiles.test.ts`, `tests/unit/nativeCatalogIndex.test.ts`.
- **02-34 NPC breadth.** Ledger batches build one Converter per batch and convert the LineageMonsters 123/28 units first. Effect bundles stay under 96 classes, and other licensees stay gaps. The plan ends with an npcs sweep slice. Files: `scripts/actors/convert_actors.py`, `scripts/actors/effect_bundle_packing.py`, `tests/pipeline/test_npc_requests.py`, `tests/pipeline/test_effect_bundle_packing.py`, `docs/parts/npcs/EVIDENCE.md`.

### Group 6: actors characters, items, skills, clips and audio

- **02-36 Clip events and playback API.** A typed parse of the existing `animationEvents` and a clip list joined by sequence, with a play API. No new decoder. Files: `src/assets/native/actorClipEvents.ts`, `src/animation/actorClipPlayback.ts`, `tests/unit/actorClipEvents.test.ts`, `tests/unit/actorClipPlayback.test.ts`.
- **02-39 Clip picker.** A registered sheet picker plays any clip of the selected actor through `play-clip`, checked on the Gremlin spec. Files: `src/ui/devSheet/clipPicker.ts`, `src/ui/devSheet/sandboxPickerRegistry.ts`, `tests/unit/clipPicker.test.ts`, `tests/browser/sandbox-npc-gremlin.spec.ts`.
- **02-40 Player characters.** chargrp assemblies are generated for every real row: body parts plus face, with `rigidAttachment` from class defaults. Hair and helmet are explicit gaps, and the class-to-template mapping is a gap until `classinfo-e` is decoded. Characters spawn through `spawn-character`. Files: `scripts/actors/character_requests.py`, `scripts/actors/convert_actors.py`, `tests/pipeline/test_character_requests.py`, `tests/browser/sandbox-characters.spec.ts`, `docs/parts/player-characters/EVIDENCE.md`.
- **02-41 EquipmentSlot widening.** Slots come from source `body_part` values with decoded meanings. Otherwise they are `equipment-slot-meaning-undecoded` gaps, with no invented slot names. Files: `src/world/worldTypes.ts`, `src/world/sandboxCommands.ts`, `tests/unit/equipItemSlots.test.ts`.
- **02-42 Items.** Weapon units and armor units per race column equip by item id. Socket sidecars are kept, and the hand anchor comes from class defaults or is a gap. The plan ends with an items sweep slice. Files: `scripts/actors/item_requests.py`, `scripts/actors/convert_actors.py`, `src/assets/native/nativeHumanHandAnchor.ts`, `tests/pipeline/test_item_requests.py`, `tests/browser/sandbox-equip.spec.ts`, `docs/parts/items/EVIDENCE.md`.
- **02-43 Skill binding table.** Every skillgrp row maps to a visual root, to `native-skill-dispatch-required` or to a gap. A sound comes only from an exact skillsoundgrp row, with no level-1 fallback. Bundles use the 02-34 packing for Sprite, Mesh, Beam, Ribbon and VertMesh emitters, so no second conversion pass is needed; simulation coverage follows FX-01, and any class the simulator does not run is `emitter-class-unported:<class>`. The plan ends with a skills sweep slice. Files: `scripts/actors/skill_binding_table.py`, `scripts/actors/convert_actors.py`, `src/effects/castSkillIndex.ts`, `tests/pipeline/test_skill_binding_table.py`, `tests/unit/castSkillIndex.test.ts`, `tests/browser/sandbox-skill-cast.spec.ts`, `docs/parts/skills-effects/EVIDENCE.md`.
- **02-44 Actor audio bindings.** Per-bundle sound manifests label each sound exact or leaf-candidate, keep unresolved records, and account for the swapped npcgrp `sound_vol` and `sound_radius` labels. Inputs pass through the guard. An audible labelled report `{key, sourceIdentity, played, peak}` completes the check. Files: `scripts/actors/actor_sound_bindings.py`, `src/audio/` actor sound loaders, `tests/pipeline/test_actor_sound_bindings.py`, `tests/browser/sandbox-actor-audio.spec.ts`, `docs/parts/audio/EVIDENCE.md`.

### Group 7: world geometry, collision, sky and audio

- **02-29 Static meshes per chunk.** Convert each chunk's static meshes through the imported `Converter` with no Z window. Unreviewed `.usx` files become per-object `static-material-layout-unreviewed` gaps. A subset diff checks 20_20 against the oracle. Files: `scripts/world/static_mesh_step.py`, `scripts/world/convert_tile.py`, `src/scene/world/loadNativeTileChunks.ts`, `tests/pipeline/test_world_static_mesh_step.py`, `tests/browser/world-tile-meshes.spec.ts`.
- **02-30 BSP and collision.** Whole-level visual BSP per chunk in sections keyed by material, PF_Unlit, lightmap texture and outdoor class (D5), plus per-node index ranges for VIS-01. Collision is the native-tile-collision `.l2asset` in source units through `scripts/world/typed_payload.py`: the stored Level.Model collision tree as one BSPT group per map (IsCsg outside-bit solidity, PolyFlags diagnostic only), and per chunk VOLS (BlockingVolumes and PhysicsVolumes with their full transform), SMSH, PLAC and TERR, from declared sources only, with class defaults from 02-59. No Elbera code runs; the oracle subsets Brush397 and Brush610 are checked. Unreadable collision is `collision-unreadable`. Files: `scripts/world/level_model.py`, `scripts/world/bsp_step.py`, `scripts/world/typed_payload.py`, `scripts/world/collision_step.py`, `src/scene/world/nativeBspResources.ts`, `tests/pipeline/support/level_model_fixture.py`, `tests/pipeline/test_world_collision_step.py`, `tests/browser/world-tile-meshes.spec.ts`.
- **02-31 Mover step.** Extract every `Engine.Mover` export per tile, with `mover-unsupported:<reason>` gaps. Mover collision goes into the MOVR group of the chunk collision resource. The 20_20 movers serve as a superset check. Tile-general mover ids appear only in the new manifest kinds. Files: `scripts/world/mover_step.py`, `scripts/world/convert_tile.py`, `src/scene/world/nativeMoverManifest.ts`, `tests/pipeline/test_world_mover_step.py`.
- **02-45 Tile sky and audio converters.** The sky comes from SkyZoneInfo. Ambient and placement audio come without the self-copied inventory of `export-native-map-audio.py`. The WORLD-07 music join from 02-11 becomes a tile step. Original bytes are kept, and the tile manifest resources are written. `scripts/world/sky_materials.py` calls the generalized reader in `scripts/native_assets_lib/material_graph.py` (02-59) instead of walking ColorModifier, Shader, TexPanner and Texture itself. Files: `scripts/world/sky_step.py`, `scripts/world/world_audio_step.py`, `scripts/world/convert_tile.py`, `src/scene/world/nativeSkyPresentation.ts`, `tests/pipeline/test_world_sky_step.py`, `tests/pipeline/test_world_audio_step.py`.
- **02-46 Tile audio runtime.** After unlock, the audio runtime plays the selected tile's music and ambience from the tile manifest resources. A labelled report completes the check. Files: `src/assets/native/loadNativeWorldAudio.ts`, `src/audio/worldAudioControls.ts`, `src/audio/worldMusic.ts`, `tests/unit/tileWorldAudio.test.ts`, `tests/browser/world-tile-audio.spec.ts`, `docs/parts/audio/EVIDENCE.md`.
- **02-47 Eligible-39 batch.** A resumable driver with preflight runs every world step on the 39 eligible tiles. It runs in slices outside machine windows and writes coverage per tile. The plan ends with a tiles sweep slice. Files: `scripts/world/convert_tile_batch.py`, `tests/pipeline/test_convert_tile_batch.py`, `docs/parts/world/EVIDENCE.md`.

### Group 8: world streaming, maps and reader growth

- **02-48 Cell-aware collision world (world, movement-geodata).** The MOVE-01 core's collision world adds and removes decoded native-tile-collision cells (`addCell`, `removeCell`) and reports not ready (`isReady`) while required cells are missing, fed by `loadCollisionCells.ts`; the scene context hands it to the world loader, and 02-67 provides it from the runtime. Files: `src/scene/world/movement/core/collisionWorld.ts`, `src/scene/world/movement/core/decodeNativeTileCollision.ts`, `src/scene/world/movement/loadCollisionCells.ts`, `src/scene/world/movement/collisionCellContext.ts`, `tests/unit/collisionWorldCells.test.ts`, `tests/unit/importBoundaries.movement.test.ts`.
- **02-49 Streaming baseline and residency.** Measure the headless baseline (counts, bytes, load time) first; FPS comes only from `WORLD_HARDWARE_TEST=1`. Then add a residency ring with one container per chunk, a wider collision ring, null-level LOD as a presentation variable, and disposal. LOD never feeds collision. Playwright crosses a tile border. Files: `src/scene/world/worldResidencyRing.ts`, `src/scene/world/loadNativeTileChunks.ts`, `scripts/measure-native-world.mjs`, `docs/parts/world/streaming-baseline.json`, `tests/unit/worldResidencyRing.test.ts`, `tests/unit/collisionInputsFromCellsOnly.test.ts`, `tests/browser/world-tile-border.spec.ts`. The ring feeds the 02-48 collision world with decoded cells, never meshes.
- **02-50 Minimap and town map join.** Join the `L2_RadarMap.utx`, `town_map.utx` and `l2zonename.utx` textures (licensees from 02-18) with zonename and huntingzone per tile, as a tile resource. Files: `scripts/world/minimap_step.py`, `scripts/world/convert_tile.py`, `src/scene/world/minimapJoin.ts`, `tests/pipeline/test_minimap_step.py`, `tests/unit/minimapJoin.test.ts`, `docs/parts/minimap/EVIDENCE.md`.
- **02-51 Minimap and world map view.** Render MinimapCtrl and the world map view from the join inside the native window registry, with the player position from the adapter state. Files: `src/ui/nativeWindows/minimapControl.ts`, `src/ui/nativeWindows/worldMapView.ts`, `tests/browser/world-minimap.spec.ts`.
- **02-52 World reader widening.** Grow the map and G16 terrain readers one licensee at a time in the 11.6 order: G16 T-25, T-23, map 30, map 23 with T-23, then the rest. Each step has a fixture and an Elbera or UELib cross-check, and no values are fitted. Files: new `scripts/world/` reader modules (split from `native_map.py` and `native_map_geometry.py`), `tests/fixtures/world-readers/**`, `tests/pipeline/test_world_reader_licensees.py`.
- **02-53 Static-material reader widening.** Grow the `static_materials.py` reviewed versions (`.usx` licensee 12) with a fixture and a cross-check, then re-run the 02-29 per-object gaps. Files: `scripts/native_assets_lib/static_materials.py`, `tests/pipeline/test_static_materials.py`.
- **02-54 Licensee-23, 25 and 30 tiles.** Re-run the census-gap tiles after each reader step. Lobby leaves the gap list when map licensee 30 lands, which satisfies WORLD-03 ("Lobby status known before Phase 4"). Files: `docs/parts/world/tile-census.json`, `docs/parts/world/EVIDENCE.md`, `tests/pipeline/test_tile_census.py`.

### Group 9: DEC-OWN-12 own implementations

- **02-56 Shared Babylon-free modules and the source frame.** Typed payload reader with a golden payload, `sourceFrame.ts`, math, rotator, random, presentation clock, fixed step, golden-trace helper, `importBoundaries.shared.test.ts`.
- **02-57 Vendor boundary and reference overlap check.** D7 boundary test, recast to devDependencies, `tools/reference-overlap/`.
- **02-58 Adapter record types contract commit.** The D6 record types and `AccountSession` in one commit; the sandbox adapter answers report-position and cannot-move.
- **02-59 Class-default and material graph readers.** `class_defaults.py`, `material_graph.py`, program and resource writer, material census, material gap reasons.
- **02-60 UE2 material runtime library and swatch.** `src/materials/ue2/**`, the one blend table, fog, gamma, the factory and the swatch harness.
- **02-61 Zone table, map emitters and BSP visibility resource.** `level_zones.py`, `bsp_leaf_membership.py`, the `emitters` and `bsp-visibility` steps, `recipes/world/bsp-visibility.json`, solidity census.
- **02-62 BSP lightmaps and tile lighting export.** The `lighting` step with BSP lightmaps (D2), lights, fog actors, light lists, terrain shadow maps and the environment program.
- **02-63 BSP visibility walk and binding.** The Babylon-free walk, translucent order on, culling off by default, map-emitter gating.
- **02-64 Tile lighting, fog and environment runtime.** Lighting through the material library, the environment clock, the camera-environment record, map emitter playback on tiles.
- **02-65 Movement core traces and MoveActor.** MoveActor, line and point checks over every collision kind, volume containment, `recipes/world/movement-native-rules.json`.
- **02-66 Pawn physics, follow camera and movement presenter.** Walking, stepUp, falling, swimming, flying, speed and rotation rules, CalcBehindView, click trace, the presenter.
- **02-67 Runtime wiring for movement, environment and translucent order.** Collision world context and snapshot field, presenter on adapter move records, environment clock, camera far plane, transparent comparator, retirement of synthetic movement and mesh navigation.
- **02-68 Emitter simulation core.** Sprite and Mesh emitters, Emitter actor rules, the fixed-step scheduler, golden traces, `PARTICLE_SEMANTICS.md`, `importBoundaries.particles.test.ts`.
- **02-69 Ribbon emitter, L2 emitter natives and particle rendering.** RibbonEmitter, the skill natives, rendering through the library, map emitter playback, skeletal slot materials on the library.

## Same-wave file overlap (checked 2026-11-08)

Plans in the same wave share only append-only tracking files (`.planning/OVERNIGHT-DECISIONS.md`, `STATUS.md`, `.planning/STATE.md`) and three documents (`docs/OUTPUT_CONTRACT.md` in wave 2 by 02-06 and 02-08, `docs/parts/npcs/EVIDENCE.md` in wave 6 by 02-33 and 02-36, `docs/parts/world/EVIDENCE.md` in wave 8 by 02-16 and 02-52). With one sequential executor (`workflow.use_worktrees: false`) plans never run at the same time, so these are edits in sequence, not conflicts. If plans are ever run in parallel worktrees, those pairs must be serialized. The DEC-OWN-12 world plans (02-30, 02-31, 02-45, 02-61, 02-62) also share `scripts/world/convert_tile.py`, `scripts/world/tile_manifest_step.py`, `recipes/world/gap-reasons.json` and `recipes/world/tile-manifest-vocabulary.json`; they run in sequence under the one executor, each with its own `listVersion` bump.
