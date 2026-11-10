---
phase: 02-stage-a-breadth
plan: 50
subsystem: world
tags: [world-06, minimap, exact-join, tile-steps, census, native-store]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-18 texture package census (L2_RadarMap 118/0, town_map 123/23, l2zonename 123/28); 02-19 layout adapter; 02-27 table decoder; 02-45 tile resource registration and read_sky_material_package; 02-47 step registry and batch"
provides:
  - "scripts/world/minimap_join.py: join_minimap_sources, MINIMAP_JOIN_ALGORITHM_VERSION, locked_tile_grid, minimap_projection"
  - "scripts/world/minimap_sources.py: MinimapSources, locked_tile_ids, decoded_table_rows, tile_frame_extent"
  - "scripts/world/minimap_step.py: run_minimap_step, sealed_minimap, tile_minimap_row, read_minimap_sources"
  - "scripts/world/minimap_join_census.py and docs/parts/minimap/minimap-join-census.json (153 tile rows)"
  - "src/scene/world/minimapJoin.ts: parseNativeTileMinimapManifest, loadNativeTileMinimap, minimapTexturePosition, NativeTileMinimap, NativeTileMinimapError"
  - "tile resource kind minimap (vocabulary listVersion 9); gap reason minimap-join-unresolved:<what> (world list listVersion 14)"
affects: [02-51, integration-restage]

estimate:
  tokens: 85000
  tasks: 3
actuals:
  tokens: 48000
  tasks: 3
  commits: 4
plan_head_before: 84600c24f534da58673010bd2768eb000dc0e0a8
plan_head_after: 27d5622

tech-stack:
  added: []
  patterns:
    - "A pure join module returns joined items with their rule and source plus gaps as data; the step and the census share it"
    - "Package indexes for 118/0 and 123 packages come from the one reviewed table reader of 02-45"

key-files:
  created:
    - scripts/world/minimap_join.py
    - scripts/world/minimap_sources.py
    - scripts/world/minimap_step.py
    - scripts/world/minimap_join_census.py
    - src/scene/world/minimapJoin.ts
    - tests/pipeline/test_minimap_join.py
    - tests/pipeline/test_minimap_step.py
    - tests/unit/minimapJoin.test.ts
    - docs/parts/minimap/minimap-join-census.json
  modified:
    - scripts/world/tile_step_registry.py
    - scripts/world/tile_manifest_step.py
    - src/scene/world/nativeTileManifest.ts
    - recipes/world/gap-reasons.json
    - recipes/world/tile-manifest-vocabulary.json
    - tests/pipeline/test_tile_manifest_step.py
    - docs/parts/minimap/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Exact-name rules only, each joined item carries its rule and source (row 710)"
  - "tile-id also joins the zone name package, whose exports are named by tile id (row 711)"
  - "Zone rows join by MapX and MapY only when every row lies in the locked grid; 21 rows lie outside, so zone joins are gaps (row 712)"
  - "Hunting zones join by start location inside the closed TerrainInfo frame extent (row 713)"
  - "tile-frame-extent projection labelled unverified; null with no radar texture (row 714)"
  - "native-tile-minimap v1 under maps/<sha>/native-tile-minimap/, reason pattern minimap-join-unresolved:<what> (row 715)"
  - "Package indexes reuse read_sky_material_package for 118/0; unreviewed licensee gives texture-licensee-unsupported (row 716)"
  - "Registry, gap-row file, census CLI and ownership follow the repository rules the plan text predates (row 717)"

metrics:
  duration: 40min
  started: 2026-11-10T22:02:00+02:00
  completed: 2026-11-10T22:42:00+02:00
---

# Phase 2 Plan 50: Minimap join Summary

**Each converted tile now carries a hash-pinned `native-tile-minimap` resource. It is built only from exact-name joins of the radar, town map and zone name packages with the decoded `zonename` and `huntingzone` rows, and every tile that cannot join is a listed gap. A committed census covers all 153 locked tiles: no radar export is named by a tile, so all 153 are radar gaps, and the zone name texture of every tile joins by tile id.**

## What was built

- `scripts/world/minimap_join.py` (pure). Rules under Unreal casefolding:
  - `tile-id` applies to radar and zone name exports.
  - `tile-id-map` applies to all three packages, with the Elbera 12c9656 citation.
  - `zonename-map`, `zonename-name` and `huntingzone-name` follow the plan.
  - Zones join through `zonename-grid`, which is gated on every MapX and MapY lying inside the locked grid.
  - Hunting zones join through `huntingzone-start-in-frame`, using a closed frame.
  - The projection is the `tile-frame-extent` rule with status `unverified`.
  - A joined radar texture in an unreviewed package is a licensee gap.
- `scripts/world/minimap_step.py`:
  - Each `.utx` is read through `require_reference_client(client).require_equal_file`, and each `.dat` through the 02-27 `decode_table`.
  - The fingerprint covers the lock eSha256 of the tile map and the five inputs, plus the raw and chunk plan fingerprints and the join version, on `UnitLedger(work, "minimap", 1)`.
  - A joined radar texture in a reviewed package converts through `Converter.convert` (`kind: texture`) into `/l2/<sha>/asset.l2asset`.
  - A census gap tile returns its census gap without touching the client. A missing raw seal returns `pending upstream-step-failed:raw` and a missing chunk plan seal returns `pending upstream-step-failed:chunks`.
- Registration:
  - `minimap` runs after `lighting` and before `manifest` in `tile_step_registry.py`, so the batch picks it up with no edit.
  - `tile_manifest_step.py` lists one `minimap` resource and the minimap tile gap row. The manifest algorithm is now 11.
  - `nativeTileManifest.ts` accepts the `minimap` kind, and the vocabulary sync test still passes.
- `scripts/world/minimap_join_census.py --client <root>` writes `docs/parts/minimap/minimap-join-census.json`, which holds names, counts and hashes only.
- `src/scene/world/minimapJoin.ts`: a guard-clause parser, `loadNativeTileMinimap` (SHA-256 verified before parse) and `minimapTexturePosition`. The position step is scene metres times 100, the inverse of `native_to_gltf`. Projected positions are labelled unverified. When there is no projection, it returns null with the reason.

## Run results (2026-11-10, DATABASE-PC)

- Tile 20_21:
  - `convert_tile.py --map 20_21 --step minimap` gives the gap `minimap-join-unresolved:radar-texture`. The manifest is `/l2/maps/a0a0f0a1.../native-tile-minimap/manifest.json` (2,592 bytes). It joins zone name texture `l2zonename.20_21` (tile-id) and hunting zones 4 Cruma Marshlands and 5 Cruma Tower.
  - `--step manifest` lists the tile with one `minimap` resource.
  - `write_lane_catalog.py --lane world` finished.
- Batch `convert_tile_batch.py --eligible --limit 9` (exit 0) ran the minimap and manifest steps on 17_12 to 19_16. 20_20 then ran through `convert_tile.py` (`--step minimap`, then `--step manifest`). World lane catalog `7c9dae88...` has 11 tile records.
- Tiles with a minimap resource: 17_12, 18_10, 18_11, 18_12, 18_17, 18_20, 18_22, 19_10, 19_16, 20_20, 20_21 (11 of 11 converted).
- Minimap gap rows in `gap-rows/minimap.json`, one per eligible tile (39):
  - gap `minimap-join-unresolved:radar-texture`: 11
  - pending `batch-pending`: 28
- Manifest gaps across the 11 tiles:
  - `minimap-join-unresolved:radar-texture`: 11
  - `minimap-join-unresolved:zone-grid`: 11
- Census (SHA-256 `26bf8426...e37f6`, byte-identical on rerun): 153 rows, all gap.
  - Gap reasons: radar-texture 153, zone-grid 153, projection 141.
  - Rule matches: tile-id 153, huntingzone-start-in-frame 11, every other rule 0.
  - zonename has 369 rows, 21 outside the grid 15..26 by 10..26. huntingzone has 220 rows.
  - World map pieces `int_worldmap1` to `int_worldmap6` are present as evidence only.
  - MinimapCtrl controls: `MinimapWnd.Minimap` and `NewRadarWnd.specialHiddenMap`.

## Task commits

| Task | Commit | Subject |
| --- | --- | --- |
| 1 Tracer: exact join, step, resource, browser parse | 0532e65 | Join tile minimap sources by exact names into a native-tile-minimap resource |
| 2 Census of 153 tiles | d91a96c | Census the exact-name minimap join of all 153 locked tiles |
| 3 Converted tiles, evidence, decisions | 27d5622 | Record the minimap join evidence on the 11 converted tiles and its decisions |

`git rev-list --count 84600c2..HEAD` before this summary commit is 4. That count includes e8c7e46, a concurrent movement review commit by another thread on this branch. The tracer gate passed: Task 1's verify ran end to end on the real client before Task 2.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_minimap_*.py"`: 30 tests OK. The real-client 20_21 case ran because E: is present.
- `pnpm typecheck`: clean. `pnpm vitest run tests/unit/minimapJoin.test.ts`: 7 passed.
- `pnpm test:pipeline` at BelowNormal: 1,848 tests OK, 56 skipped. `pnpm test:unit` at BelowNormal: 2,565 passed, 59 skipped, 0 failed.
- Acceptance checks:
  - The vocabulary node check exits 0.
  - `git diff --stat <start> -- scripts/native_store/tile_manifest_validation.py` is empty.
  - `grep -c require_equal_file scripts/world/minimap_step.py` prints 1.
  - The prefix and distance grep on `minimap_join.py` prints 0.
  - `grep -c minimap-join-unresolved recipes/world/gap-reasons.json` prints 1.
  - The census row count check exits 0, and so does the long binary run check.
  - `grep -c "Nothing yet" docs/parts/minimap/EVIDENCE.md` prints 0.
- `check-lane-ownership.mjs --base 84600c2 --part minimap` exits 1. The two paths it lists, `tools/reference-overlap/reviewedRuns/movement.json` and `signedOffRuns.json`, both come from e8c7e46 by another thread. This plan's three commits touch only world-lane paths and shared tests (row 717).
- Reference overlap: no DEC-OWN-12 area in `tools/reference-overlap/overlapAreas.json` covers `scripts/world/minimap_*` or `src/scene/world/minimapJoin.ts`, so there are no runs to report.
- Every `check-machine-schedule` call printed `activeWindow: null`.

## Deviations from Plan

**1. [Rule 3 - Blocking] The registry lives in `tile_step_registry.py`.** 02-47 moved the step registry out of `convert_tile.py`, so `convert_tile.py` was not edited. `minimap` sits after `lighting`, which is after `audio`, and directly before `manifest`. Row 717.

**2. [Rule 3 - Blocking] `ue2.read_package_index` refuses the 118/0 radar package.** The index uses `read_sky_material_package` (02-45), which reads 118/0 with the reviewed table layout. Row 716.

**3. [Rule 3 - Blocking] The census takes no `--output`.** `test_converter_output_guard` requires every lane script with `--output` to call `require_converter_output`. Committed reports instead write a fixed tracked path, as `tile_census.py` and 02-18 do. The CLI is `python -B scripts/world/minimap_join_census.py --client <root>`, and a test proves `--output` is refused.

**4. [Rule 3 - Blocking] Step rows.** They keep part `world` (`tile_step_row`, which the coverage key mapping needs) and are written to the per-step file `gap-rows/minimap.json` (02-47 row 681), not to `tile-steps.json`.

**5. [Rule 2 - Missing critical] Two extra `<what>` values and a source helper.**
- `zone-rows` and `hunting-zone-rows` exist so that zero decoded rows becomes a listed gap. The reasons file holds the one pattern `minimap-join-unresolved:<what>`. Row 715.
- `scripts/world/minimap_sources.py` was added for lock paths, tile ids, table rows and the frame extent, which the step and the census share.

**6. [Rule 1 - Bug] Citation text.** The `tile-id-map` citation first quoted Elbera's tile-named rows, which tripped the world tile-identity scan (`test_world_tile_general_steps`). It now reads "TOWN_MAPS rows named <tile id>_map".

**7. Projection gap scope.** When no radar texture joins, the projection is null and only the radar gap is listed, so the radar gap stays the explaining reason. A projection gap is listed only for a missing frame or a non-square converted texture. Row 714.

**8. `tile-id` on the zone name package.** `l2zonename.utx` names its exports by tile id, so the exact `tile-id` rule also feeds `zoneNameTextures`. Row 711.

Tests were written in the same task commits as the code, not as separate red commits.

## Requirements

- WORLD-06: Pending. The data side is in place: a sourced, hash-pinned resource on every converted tile, a 153-tile census and the browser parser. The minimap itself is unresolved. No radar export carries a tile name, the radar package is 118/0, zone joins are gated by 21 out-of-grid rows, and the 02-51 view is not built. Not marked complete.

## Needs Human

- Restage the world lane store (integration thread) to catalog `7c9dae88...`, whose 11 tile manifests now carry a `minimap` resource. This is the existing world lane restage line in STATE.md.

## Open follow-ups

- The radar texture naming rule is unknown. Find which client data names the per-tile radar image, or confirm the minimap draws from the `int_worldmap` pieces with a sourced georeference (Phase 3 check).
- The meaning of the 21 zonename rows with MapX or MapY outside the grid (0 and similar), on IMPORTA.
- 28 eligible tiles are still `batch-pending` (the 02-47 resume command). Their minimap step runs with the batch.

## Known Stubs

None. Gaps are data with listed reasons.

## Threat Flags

None beyond the plan's threat model. Reads are guarded (T-02-50-01). Decoded strings are only compared, never used to build paths (T-02-50-02). The parser uses guard clauses, `nativeResourceUrl` and a SHA-256 check before parsing (T-02-50-03). The census holds no texture bytes, and a test rejects runs of 129 or more characters (T-02-50-04).

## Process cleanup

- Started: foreground `python -B` steps, census and test runs, one batch slice, two `powershell -NoProfile` wrappers for the full pipeline and unit suites, `pnpm typecheck` and `vitest`. Each one exited before the next step.
- No dev server, Vite preview, Playwright or browser was started.
- The final `Get-CimInstance Win32_Process` listing for `*autonomous-roadmap*` found only the listing command itself. Nothing listens on 5173 or 5175.

## Self-Check: PASSED

- Files exist: `scripts/world/minimap_join.py`, `minimap_sources.py`, `minimap_step.py`, `minimap_join_census.py`, `src/scene/world/minimapJoin.ts`, `tests/pipeline/test_minimap_join.py`, `tests/pipeline/test_minimap_step.py`, `tests/unit/minimapJoin.test.ts`, `docs/parts/minimap/minimap-join-census.json`.
- Commits 0532e65, d91a96c and 27d5622 are ancestors of HEAD.
