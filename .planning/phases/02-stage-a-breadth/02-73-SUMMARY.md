---
phase: 02-stage-a-breadth
plan: 73
subsystem: converter texture library
tags: [ue2, texture, licensee, elbera, cross-check, gap-reasons]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-55 phase tail (union and restage handoff); 02-45 sky reader that proved the 118/0 layout"
provides:
  - "scripts/native_assets_lib/texture_package_118.py: UnrealPackage118, read_unreal_package, read_texture_source_118"
  - "scripts/native_assets_lib/texture_source_reader.py: the shared native texture record reader (mips, palette, prefix), UnsupportedTextureSource with a gap reason"
  - "scripts/native_assets_lib/lineage_material_prefix.py: the cited Lineage material prefix rule and its evidence"
  - "REVIEWED_VERSIONS = (118,0), (123,0), (123,16), (123,18), (123,20), (123,23), (123,25), (123,27), (123,28), (123,30)"
  - "tests/fixtures/texture-layouts/cross-checks.json and one texture-<v>-<lic>.json fixture per reviewed layout"
  - "scripts/native_store/texture_layout_cross_checks.py: writes and validates the cross-check rows"
  - "gap reason texture-format-unsupported:<format> (seed listVersion 4) and nativeTextureSource.gapReason in Converter metadata"
affects: [02-82, 02-83, 02-85, 02-78, 02-79, 02-88, 02-89, 02-92]

actuals:
  tokens: 162600
  tasks: 3
  commits: 3
plan_head_before: 44110f3a6938576b9a37108742899b266fedb93d
plan_head_after: f284468d0ceaafc40e300a4c2f003b0c9457b2b9

tech-stack:
  added: []
  patterns:
    - "A texture layout joins REVIEWED_VERSIONS only with a hash-only Elbera mip row, a Converter conversion with equal native mips and a synthetic fixture; the test fails when any of them is missing"
    - "The cross-check texture of a layout is picked by rule (first export with a reviewed format and a UModel-unique leaf name) and the test recomputes the row through the same rule"

key-files:
  created:
    - scripts/native_assets_lib/texture_package_118.py
    - scripts/native_assets_lib/texture_source_reader.py
    - scripts/native_assets_lib/lineage_material_prefix.py
    - scripts/native_store/texture_layout_cross_checks.py
    - tests/fixtures/texture-layouts/cross-checks.json
    - tests/fixtures/texture-layouts/texture-118-0.json (and nine texture-123-<lic>.json)
    - tests/pipeline/test_texture_package_118.py
    - tests/pipeline/test_texture_layout_cross_checks.py
    - tests/pipeline/texture_layout_fixture.py
  modified:
    - scripts/native_assets_lib/texture_mips.py
    - scripts/native_assets.py
    - scripts/native_store/gap_reasons.json
    - docs/parts/ui/texture-package-census.json
    - docs/parts/npcs/actor-unit-census.json
    - docs/NATIVE_TEXTURES.md

key-decisions:
  - "P824: the world sky copy (SkyLayoutPackage, sky_layout_texture_source) stays as a declared second copy until 02-82 (rule G1)"
  - "P825: the UI texture census is rewritten by its own generator whenever REVIEWED_VERSIONS changes; synthetic tests use 118/11 as the unreviewed 118 pair"
  - "P826: 123/0, listed as refused by the committed actor census, is cross-checked like the five named licensees and joins the reviewed layouts"
  - "P827: cross-check texture selection rule (reviewed format, UModel-unique leaf name); 123/23 uses town_map.utx, 123/30 aden_village_t.utx"
  - "P828: the actor unit census is rewritten by its own generator; 915 units move from texture licensee gaps to convertible"

patterns-established:
  - "One texture library: build_texture_source is the one entry; it refuses unreviewed layouts and dispatches 118/0 to read_texture_source_118"

requirements-completed: []

coverage:
  - id: D1
    description: "UE2 118/0 packages (L2UI_CH3, L2_RadarMap) read through the shared texture library and convert through the Converter with mips equal to Elbera"
    requirement: UI-03
    verification:
      - kind: unit
        ref: "tests/pipeline/test_texture_package_118.py"
        status: pass
      - kind: integration
        ref: "tests/pipeline/test_texture_layout_cross_checks.py#test_every_committed_row_recomputes_from_the_locked_client_and_pinned_elbera"
        status: pass
    human_judgment: false
  - id: D2
    description: "Census-listed 123 licensees 16, 18, 23, 25, 27 and 0 reviewed with fixtures and exact Elbera rows; none refused"
    requirement: ACT-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_texture_layout_cross_checks.py"
        status: pass
    human_judgment: false
  - id: D3
    description: "Unreviewed texture formats are named texture-format-unsupported:<format> gaps per texture"
    requirement: WORLD-06
    verification:
      - kind: unit
        ref: "tests/pipeline/test_texture_mips.py#TextureSourceGapReasonTests; tests/pipeline/test_texture_package_118.py#ConverterFormatGapTests"
        status: pass
    human_judgment: false

duration: 36min
completed: 2026-11-11
---

# Phase 2 Plan 73: Shared 118/0 and cited 123 licensee texture reader summary

**One converter texture library now reads UE2 118/0 packages and the census-listed 123 licensees (0, 16, 18, 23, 25, 27), each reviewed only after an exact Elbera mip cross-check, a Converter conversion with equal native mips and a synthetic fixture; unreviewed formats are named `texture-format-unsupported:<format>` gaps.**

## Performance

- Duration: about 36 min (2026-11-11T11:44Z to 12:20Z)
- Tasks: 3 of 3
- Files: 33 changed across 3 commits (most of the diff is the two regenerated censuses)

## Accomplishments

- `texture_package_118.py` holds `UnrealPackage118` (bounded tables, export bounds), `read_unreal_package` and `read_texture_source_118`. The shared record reading (lazy-array end, mip bits, byte counts, mip halving, exact record end, palette) moved to `texture_source_reader.py`, so the 118 and 123 readers keep every check of the sky reader and of the 123 reader with one copy.
- `build_texture_source` is the one entry: it refuses a layout outside `REVIEWED_VERSIONS` and dispatches 118/0 to the 118 reader. The Converter opens every package through `read_unreal_package`.
- `lineage_material_prefix.py` owns the cited prefix rule (Elbera l2lib README `32b12d39`, UEViewer `UnMaterial2.h` `9e27b80d`); the reader reads the prefix the rule gives and refuses shader-block licensees other than 30 as `texture-licensee-unsupported`.
- Cross-check rows (hashes only, Elbera commit `12c9656`): L2UI_CH3 `RefineEffect.refinegrade2_27` (DXT5) and L2_RadarMap `RadarMaps.Global` (DXT1) for 118/0; fdarkelf (27), logbg (16), town_map (23), goldcubes (25), aden_caslte_door_t (18), improved_model_npc_01 (0), default (20), DropItemsTex (28), aden_village_t (30). Every row is exact on every mip level and converted through the Converter with equal native mips. No pair was refused.
- Effect on later batches: all 48 lock-equal `systextures/*.utx` of the UI census are now reviewed (35 after Task 1, 48 after Task 2), and 915 actor units (815 of them 123/27 character rows) move from texture licensee gaps to convertible.
- `texture-format-unsupported:<format>` is in the seed list (listVersion 4); both readers raise `UnsupportedTextureSource` with that reason, and the Converter records it as `nativeTextureSource.gapReason` (checked on a real RGBA8 L2UI_CH3 texture: `texture-format-unsupported:5`). L2UI_CH3 holds 1,752 RGBA8 and 670 DXT3 textures, which stay named format gaps.

## Converter version (rule G6)

- New converter implementation hash: `9d22a042ba0c77d6a481333d00f38d0380ae4a611385ad330367b9d5d9fa48fa` (after f284468). Every converter-cached unit reseals on its next run; the batch plans 02-78, 02-79, 02-83, 02-85 and 02-88 run after this plan.
- `data/pinned_elbera_module.py` joined `implementation_source_paths` because the texture library now imports its commit pin.

## Task commits

1. Task 1 (tracer): `9f58637` Read UE2 118/0 texture packages through one shared texture library and review the layout against Elbera
2. Task 2: `2edb85e` Review the census-listed 123 texture licensees through the cited Lineage material prefix rule and exact Elbera cross-checks
3. Task 3: `f284468` Name unreviewed texture formats as texture-format-unsupported gaps per texture

## Deviations from plan

1. [Rule 3 - Blocking] Committed censuses validate against `REVIEWED_VERSIONS`. The UI texture census (`docs/parts/ui/texture-package-census.json`, Tasks 1 and 2) and the actor unit census (`docs/parts/npcs/actor-unit-census.json`, Task 2) were rewritten with their own generators, so `check-lane-ownership` lists these two paths as foreign to the integration lane (P825, P828). The actor census generator's trailing lane coverage refresh failed on pre-existing audio tile keys from 02-72 after the census file was written; `--check` passes.
2. [Rule 3 - Blocking] Synthetic tests that used now-reviewed pairs as their unreviewed example moved to 118/11 (`test_ui_texture_step.py`, `test_minimap_join.py`, `test_minimap_step.py`) and 123/31 (`actor_census_fixture.py`, `test_actor_census.py`, `test_actor_unit_inventory.py`, `test_world_sky_materials.py`).
3. [Rule 2 - Scope] 123/0 (listed by the actor census) was cross-checked and reviewed with the five named licensees (P826).
4. [Rule 1 - Bug] Task 1 made the converter import `data/pinned_elbera_module.py` without hashing it; `test_converter_implementation_hash` caught it and Task 2 added the file to `implementation_source_paths`.
5. [Rule 3 - Blocking] Two pairs' first census textures cannot go through the Converter (cubemaps.utx leaf names are not unique for UModel; L2Font.utx exists twice in the client tree). The selection rule now requires a UModel-unique leaf name and the pair takes its next lock-equal package (P827).
6. Added module `texture_source_reader.py` (not in the plan's file list) to share the record reader between the 118 and 123 paths without an import cycle, and `scripts/native_store/texture_layout_cross_checks.py` as the row writer and validator.
7. Task 3 also touched `scripts/native_assets.py` (one field, `gapReason`), because rule G6 forbids later converter edits and the Converter path is how 02-85 sees the reason.
8. Task 3 TDD order: the readers already carried the reason from the Task 1 refactor, so the new format gap tests were green on first run once the seed list was bumped; no separate RED commit.

## Decisions logged

P824 to P828 in `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md` (rule G2).

## Requirements

- UI-03, WORLD-06, ACT-01: reader half delivered (gaps SC4d, SC1d and SC2b); status stays with 02-89, which alone writes REQUIREMENTS.md (rule G9). Not marked complete here.

## Open follow-ups

- 02-82: switch `scripts/world/sky_materials.py` to `read_unreal_package` and `build_texture_source`, delete `SkyLayoutPackage` and `sky_layout_texture_source`, import `lineage_material_prefix` from `native_assets_lib` and delete the world copy in `reader_licensee_layouts.py`; rerun the minimap join census, whose L2_RadarMap row still reads `reviewed: false`.
- 02-85 and 02-82: `texture_licensee_unsupported_reason` in `texture_source_reader.py` is the converter-side owner; `data/texture_package_census.unsupported_licensee_reason` and `world/minimap_join.TEXTURE_LICENSEE_UNSUPPORTED_REASON_PREFIX` can import it.
- 02-85: write a per-texture gap row from `nativeTextureSource.gapReason` for the 1,752 RGBA8 and 670 DXT3 L2UI_CH3 textures.

## Needs Human

None.

## Reference overlap

No `tools/reference-overlap/overlapAreas.json` area covers Python under `scripts/native_assets_lib/` or `scripts/native_store/` (Python scanning lands in 02-93), so there is no blocking or unreviewed run to report.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_texture_*.py"`: OK (2 pre-existing skips for absent local IMPORTA-PC fixtures).
- `test_texture_layout_cross_checks.py` with the locked client and pinned Elbera present on DATABASE-PC: OK, all 11 rows recompute.
- `test_gap_rows.py`: OK. Full `python scripts/test_pipeline.py` after Task 3: 2066 tests OK (57 skipped). Vitest `nativeNpcProfileBounds` and `readNativeCoverage`: 28 passed.
- `node scripts/check-lane-ownership.mjs --base 44110f3 --part adapter-dispatch`: 2 foreign paths, the two regenerated censuses (deviation 1).

## Process cleanup

Started only short foreground runs (Python tests, census generators, the cross-check tool and its UModel subprocesses, one Vitest run); no dev server, preview or browser. After the last run no process with this worktree path or UModel in its command line remained, and nothing listened on 5173 or 5175.

## Self-Check: PASSED

- Created files exist: texture_package_118.py, texture_source_reader.py, lineage_material_prefix.py, texture_layout_cross_checks.py, cross-checks.json, 10 layout fixtures, three test modules.
- Commits 9f58637, 2edb85e and f284468 are ancestors of HEAD.
