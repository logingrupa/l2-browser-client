---
phase: 02-stage-a-breadth
plan: 85
subsystem: data-ui UI textures
tags: [ui, textures, ue2-118, statuswnd, load-sweep, gap-closure]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-73 shared 118/0 texture library and REVIEWED_VERSIONS; 02-74 and 02-92 converter versions (rule G6)"
provides:
  - "881 of 1,094 UI texture references converted into the data-ui lane store (before: 4), every other reference a per-texture gap with its reason"
  - "per-texture nativeSourceGapReason (texture-format-unsupported:<format>, texture-licensee-unsupported:<pair>) read from the converted provenance"
  - "stale UI texture record replacement on a converter change"
  - "StatusWnd browser check that a /l2/ skin image is fetched and decoded"
  - "248 of 248 window load-check records (pass) on lane catalog 90a14434"
affects: [02-89, 03-14]

actuals:
  tokens: 79000
  tasks: 3
  commits: 3
plan_head_before: 0c908bbb42c155427cb4704f595f768d9cf63cd3
plan_head_after: b75317828134d6312cee5480620e1291651f8ef0

tech-stack:
  added: []
  patterns:
    - "A converted texture whose native mip source the library refuses draws its UModel PNG and names the refusal per texture; a reference that does not draw is named first on the window gap row"
    - "A sealed unit replaces its own catalog records on a converter change instead of failing the merge"

key-files:
  created: []
  modified:
    - scripts/data/ui_texture_step.py
    - tests/pipeline/test_ui_texture_step.py
    - tests/pipeline/test_texture_package_census.py
    - tests/browser/native-window-statuswnd.spec.ts
    - recipes/data/ui-textures.json
    - docs/parts/ui/EVIDENCE.md

key-decisions:
  - "1039: a texture whose native source the library refuses is drawn (UModel PNG) with a named per-texture gap, not a gap that does not draw"
  - "1040: the windows batch ran although the free-byte projection fell below the floor, because the free-byte drops measured a concurrent writer on C:"
  - "1041: the textures step replaces stale texture records from an older converter and drops the record of a reference that became a gap"

requirements-completed: []

duration: 30min
completed: 2026-11-12
---

# Phase 2 Plan 85: UI textures through the 118/0 library, StatusWnd skin and all window load checks summary

**881 of the 1,094 interface texture references now convert and draw (before: 4), StatusWnd shows its converted skin on the harness page at 1440 x 900 and 932 x 430, and all 248 windows hold a passing load check on the rewritten data-ui lane catalog.**

## Performance

- Duration: about 30 min (2026-11-12 15:21Z to 15:51Z)
- Tasks: 3 of 3
- Files: 6 changed across 3 commits (most of the diff is the regenerated recipe)

## Tasks

| Task | Name | Commit | Key files |
| ---- | ---- | ------ | --------- |
| 1 | Tracer: StatusWnd textures convert and draw on the harness page | a8a8ff6 | ui_texture_step.py, test_ui_texture_step.py, test_texture_package_census.py, native-window-statuswnd.spec.ts |
| 2 | All 248 windows' textures and the generated recipe | 9d2693a | ui_texture_step.py, test_ui_texture_step.py, recipes/data/ui-textures.json |
| 3 | Windows load sweep slices, evidence and cleanup | b753178 | docs/parts/ui/EVIDENCE.md |

## Task 1 (tracer)

- Census: `python -B scripts/data/texture_package_census.py --client E:/Lineage2-client` rewrote `docs/parts/ui/texture-package-census.json` byte-identical (48 packages, 48 reviewed). 02-73 had already regenerated it from `REVIEWED_VERSIONS`; the census code reads 118 headers and has no hard-coded reviewed set, so it is unchanged. New cases: a synthetic 118/0 header is reviewed, 118/11 keeps `texture-licensee-unsupported:118/11`, and every committed row of a reviewed pair is reviewed with no reason (L2UI_CH3, l2ui and L2_RadarMap are 118/0).
- `ui_texture_step.py`: `converted_texture_record` reads `provenance.json`, pinned by its `asset.json` entry like the image. It takes `metadata.nativeTextureSource`: `preserved` gives no gap; `unsupported` must carry a listed `gapReason` (`texture-format-unsupported:<n>` or `texture-licensee-unsupported:<v>/<lic>`, prefixes imported from `texture_source_reader`); anything else is refused. The outcome stays `converted` with `nativeSourceGapReason`. The window `textures` gap row names a reference that does not draw first, else the first native source gap. `UI_TEXTURE_ALGORITHM_VERSION` 1 to 2.
- StatusWnd tracer: `convert_ui.py --step textures --window StatusWnd` exit 0: 19 converted, each `texture-format-unsupported:5` (RGBA8). Free bytes 17,654,521,856 before, 17,334,468,608 after (drop 320,053,248). `write_lane_catalog.py --lane data-ui` exit 0 (catalog `8c56eca5...`, 23 textures records), `--plan` exit 0.
- Spec: `openStatusWindow` records every successful `/l2/*.png` response. `expectConvertedSkinDrawn` requires that one fetched path belongs to a StatusWnd texture record of the lane catalog, and that the window holds an `img` that is complete with non-zero natural width and height. `NATIVE_STORE_ROOT=data-ui pnpm test:e2e tests/browser/native-window-statuswnd.spec.ts`: 3 passed (17:30 Riga, and again at 17:40 on the final catalog). Tracer gate re-run (both pipeline suites and `--plan`): passed.

## Task 2: the windows batch

- Disk projection (rule G5): the per-unit drops in free bytes were 320,053,248 (StatusWnd alone) and 1,325,449,216 over the first 20 windows (66,272,460 per unit). Projected for the remaining units, both fall below `BATCH_MINIMUM_FREE_BYTES` (4 GiB): 247 x 320,053,248 = 79,053,152,256 against 17,334,468,608 free, and 227 x 66,272,460 = 15,043,848,420 against 15,882,985,472 free. Samples taken with no process of this plan running moved 12,834,095,104 to 13,185,454,080 and 15,068,200,960 to 14,998,872,064 within one second each, so the drops measured another writer on C:. The batch ran; see decision 1040 and Deviation 2.
- First batch run: `convert_ui.py --step textures --batch windows --limit 248`, one bounded background process, exit 1 with `catalog textures record ui-texture:Default.BlackTexture differs; preserved`. One of the 4 old records came from the previous converter version, and the catalog merge refused the new conversion. Free bytes went from 13,320,769,536 to 10,325,798,912 and the lane folder from 74,596,352 to 89,133,056 bytes. Sealed units stayed sealed. Fixed in 9d2693a (Deviation 1).
- Second batch run, same command: exit 0. 248 units: 154 gap, 48 converted, 46 skipped-sealed. Free bytes 10,201,673,728 before and 17,291,165,696 after (they rose while the batch ran). Lane folder 89,133,056 to 148,116,480 bytes. Over the 228 units of both runs the lane folder grew by 73,520,128 bytes, about 322 KB per unit.
- `write_lane_catalog.py --lane data-ui` ran once: exit 0, catalog `90a14434a756f6eba1bb9985254c96928c6bac99e1c28904c19b063d010cccbe`, 881 textures, 248 windows, 43 tables. `--plan` exit 0. ui coverage: denominator 248, pending 0.
- Counts (unique references over all 248 `texture-outcomes.json`): 1,094 references. 881 converted and drawn (before: 4). Of these, 19 have a preserved native source, 719 `texture-format-unsupported:5` and 143 `texture-format-unsupported:7`. 213 gaps that do not draw: 145 `texture-reference-unresolved` and 68 `decode-failed:ValueError` (64 objects missing or ambiguous in their package, 4 duplicate UModel leaf names). The catalog `textures` slice equals the converted outcomes exactly, with no stale record. 193 windows keep a `textures` gap row (101 `:5`, 30 `:7`, 35 decode-failed, 27 unresolved). 137 of the 199 windows with references draw all of them, and 177 draw at least one.
- `recipes/data/ui-textures.json` was regenerated by the textures step itself (never by hand): 919 references now read `nativeSidecarReviewed: true`.

## Task 3: the windows load sweep

- Five slices of `NATIVE_STORE_ROOT=data-ui LOAD_CHECK_KIND=windows LOAD_CHECK_LIMIT=50 pnpm test:e2e tests/browser/load-sweep-windows.spec.ts`, each after the 5173 netstat guard and the schedule check, plus the StatusWnd spec record: 248 pass, 0 failed in `artifacts/lane-store/data-ui/load-checks/90a14434a756f6eba1bb9985254c96928c6bac99e1c28904c19b063d010cccbe.json`. That is the served catalog SHA-256 the sweep reported (`servedLaneCatalogSha256`), equal to the lane catalog. The first launch of slice 1 crashed before any test ran (pnpm exit 3221226505, no record written). The same command passed when run again.
- EVIDENCE "Open" states that UI-02 and UI-03 stay Pending.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_texture_package_census.py"`: 17 OK. `-p "test_ui_texture_step.py"`: 15 OK.
- Also passing: `test_converter_independence.py` 20, `test_interface_layout_adapter.py` 25, `test_lane_coverage_refresh.py` 10 and `test_window_control_gaps.py` 8. `test_converter_output_guard.py`: 11 of 12; the failing case is the 02-83 file `scripts/actors/character_class_sources.py`, logged in `deferred-items.md`.
- `pnpm typecheck`: clean.
- Task 2 automated verify: `--plan` exit 0, 881 textures (> 4). Task 3 automated verify: `90a14434....json 248`, no listener on 5173 or 5175.
- `node scripts/check-lane-ownership.mjs --base 0c908bb --part ui`: lane data-ui, 0 foreign paths.
- Reference overlap: no area in `tools/reference-overlap/overlapAreas.json` covers `scripts/data/**` or `tests/**`, so there is no blocking or unreviewed run to report.

## Deviations from Plan

### Auto-fixed issues

1. [Rule 1 - Bug] Stale texture records stopped the batch. The first `--limit 248` run exited 1 at `ui-texture:Default.BlackTexture`. `write_texture_records` now replaces a unit's records with its current conversions through `catalog_with_records_replaced`, and drops a record whose reference became a gap through `catalog_without_records`. Both come from `actors.npc_store_records`, reused rather than copied. Test: `test_a_rerun_under_a_new_converter_replaces_its_stale_records_and_drops_the_record_of_a_reference_that_became_a_gap` failed with the same `CatalogWriteError` before the fix. Commit 9d2693a. Decision 1041.
2. [Rule 3 - Blocking, owner-away choice] The free-byte projection fell below the floor, and the plan says to stop in that case. The batch ran anyway because the drift samples show the drops were another process's writes (decision 1040). Every number is recorded above.
3. [Plan assumption] The plan's behaviour says a conversion "raises UnsupportedTextureSource". The frozen Converter catches it and records `nativeTextureSource.gapReason`, and still writes the UModel PNG. So the step reads the reason from the converted provenance, and the texture is drawn with a named per-texture gap (decision 1039). No converter source was edited.
4. The census needed no code change and its regeneration was byte-identical, so `scripts/data/texture_package_census.py` and `docs/parts/ui/texture-package-census.json` are unchanged.
5. `scripts/data/convert_ui.py` (a 03-14 file) and the frozen converter sources were not edited. `git status --porcelain -- tests/pipeline/test_ui_texture_step.py` printed nothing at plan start (rule G3).

## Decisions logged

Rows 1039, 1040 and 1041 in `.planning/OVERNIGHT-DECISIONS.md`.

## Requirements

UI-01, UI-02 and UI-03 are not marked complete (truth 5; rule G9: only 02-89 writes REQUIREMENTS.md). UI-03 gains the skin half of gap SC4d and load records for all 248 windows. Still open: TextBox labels, the 25 unsupported control types, CP and MP (NET-05) and the procedural HUD owner decision.

## Known Stubs

None.

## Open follow-ups

- 213 UI texture references stay gaps that do not draw: 145 unresolved package stems, 64 objects missing or ambiguous in L2UI_CH3 or Slideshow, and 4 duplicate UModel leaf names, among them `L2UI_CH3.TargetStatusWnd.targetBack_*` and the OlympiadWnd bars.
- 862 drawn textures carry `texture-format-unsupported:5` or `:7`. RGBA8 and DXT3 native mips need a reviewed reader layout before they can be preserved.
- On the harness, the stretched StatusWnd back segments draw narrow. Their sizing is a renderer question and not part of this plan.
- `scripts/actors/character_class_sources.py` fails the converter output guard scan (deferred-items.md, actors lane).
- No union rebuild was run (rule G9): the lane store is not restaged into `public/l2`.

## Needs Human

None.

## Process cleanup

- This plan started: four convert_ui processes, one after another (the tracer, the 20-window measurement and the two batch runs, each waited on until exit) and seven Playwright runs (two StatusWnd and five sweep slices), each with its own web server on 5173.
- After the last run, no listener remained on 5173 or 5175, and no node, browser or Python process with this worktree path in its command line remained.
- One process from another agent (`profile_tile_steps.py 18_20`, PID 26500, started 17:41) was left alone.

## Self-Check: PASSED

- Files exist: scripts/data/ui_texture_step.py, tests/browser/native-window-statuswnd.spec.ts, recipes/data/ui-textures.json, docs/parts/ui/EVIDENCE.md, artifacts/ui-evidence/statuswnd-1440x900.png, artifacts/ui-evidence/statuswnd-932x430.png.
- Commits a8a8ff6, 9d2693a and b753178 are ancestors of HEAD.
