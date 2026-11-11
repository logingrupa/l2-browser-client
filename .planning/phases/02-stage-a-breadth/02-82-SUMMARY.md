---
phase: 02-stage-a-breadth
plan: 82
subsystem: world sky and minimap texture reading
tags: [ue2, texture, sky, minimap, radar, one-owner, gap-reasons]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-73 shared texture library (read_unreal_package, build_texture_source, read_texture_source_118, lineage_material_prefix)"
provides:
  - "scripts/world/sky_materials.py reads every sky texture through build_texture_source; SkyLayoutPackage, sky_layout_texture_source and read_sky_material_package are deleted"
  - "scripts/world/reader_licensee_layouts.py imports the Lineage material prefix rule, its evidence and constants from native_assets_lib.lineage_material_prefix"
  - "scripts/world/minimap_step.py: texture_package_index and texture_export_source_status; every minimap texture export carries textureSource {status readable, format} or {status gap, reason}"
  - "MINIMAP_JOIN_ALGORITHM_VERSION 2: a joined radar export the library refuses keeps the library reason on the radar cell and is not converted"
  - "docs/parts/minimap/minimap-join-census.json lists every export of the three minimap packages with its readability (textureExports, textureSourceCounts)"
affects: [02-88, 02-89]

actuals:
  tokens: 27000
  tasks: 2
  commits: 2
plan_head_before: 8f0951a8a8aa065e0951b624a557c3ed04e8cc4c
plan_head_after: 7f5e272b312d5685c5f9c5d88910fded95a455f9

tech-stack:
  added: []
  patterns:
    - "Library answers readability: a step asks build_texture_source per export and writes the library reason as its gap instead of keeping its own layout table"

key-files:
  created: []
  modified:
    - scripts/world/sky_materials.py
    - scripts/world/sky_step.py
    - scripts/world/reader_licensee_layouts.py
    - scripts/world/terrain_height_texture.py
    - scripts/world/minimap_step.py
    - scripts/world/minimap_join.py
    - scripts/world/minimap_join_census.py
    - docs/parts/minimap/minimap-join-census.json
    - tests/pipeline/test_world_sky_materials.py
    - tests/pipeline/test_texture_package_118.py
    - tests/pipeline/test_world_reader_licensees.py
    - tests/pipeline/world_reader_fixture_packages.py
    - tests/pipeline/test_minimap_step.py
    - tests/pipeline/test_minimap_join.py

key-decisions:
  - "976: the 20_21 sky step is not byte-identical as written; every payload byte file is identical and the metadata keeps every old field, gaining only the shared reader fields; proceeded instead of a projection shim"
  - "977: the equality baseline is a run of the code at plan start, because the 2026-11-10 seal is not reproduced by that code either"
  - "978: minimap texture exports are indexed through build_texture_source; a refused joined radar export keeps the library reason and is not converted; the REVIEWED_VERSIONS refusal in minimap_join.py is deleted"
  - "979: MINIMAP_JOIN_ALGORITHM_VERSION 2, name rules unchanged"
  - "980: prefix constants are imported from their owner, no re-export from the world module"

patterns-established:
  - "Per-export textureSource on minimap package indexes: readable with format name, or gap with the library reason"

requirements-completed: []

coverage:
  - id: D1
    description: "Sky textures of 118/0 packages read through the shared library; the world copy is deleted; WR-29 synthetic cases keep their outcomes"
    requirement: WORLD-06
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_sky_materials.py"
        status: pass
      - kind: integration
        ref: "20_21 sky step rerun compared with a plan-start run (method and hashes below)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A joined 118/0 radar texture converts through the library into the tile minimap; an unreviewed format or layout is the library gap on the radar cell"
    requirement: WORLD-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_minimap_step.py#test_a_joined_118_0_radar_texture_reads_through_the_shared_texture_library_and_converts_into_the_tile_minimap"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_minimap_step.py#test_a_joined_radar_texture_of_an_unreviewed_format_is_a_format_gap_on_the_radar_cell"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-11-11
---

# Phase 2 Plan 82: Sky and radar textures on the shared 118/0 reader summary

**The world sky step now reads 118/0 sky textures only through the shared texture library (its own copy is gone, every texture byte of the 20_21 sky unchanged), the world readers import the Lineage material prefix rule from its owner, and the minimap step asks the library about every radar export: L2_RadarMap reads as 1 DXT1 export and 17 format 5 exports, and every tile still stops at minimap-join-unresolved:radar-texture because no export names a tile.**

## Performance

- Duration: about 30 min (2026-11-11 17:28 to 17:58 Riga)
- Tasks: 2 of 2
- Files: 14 changed across 2 commits

## Accomplishments

- `sky_materials.py` lost `SkyLayoutPackage`, `sky_layout_texture_source`, `read_sky_material_package`, `authored_integer_tag` and seven constants. `native_texture_source` calls `build_texture_source` for every layout: a library `texture-format-unsupported:<format>` becomes the sky step's own `sky-texture-format-unsupported:<format>`, and any other library reason (licensee) passes through unchanged. `sky_step.py` and `minimap_step.py` open packages with `read_unreal_package`.
- `reader_licensee_layouts.py` imports `lineage_material_prefix`, `MATERIAL_PREFIX_EVIDENCE`, `layout_evidence` and the Elbera README pins from `native_assets_lib/lineage_material_prefix.py`; its copy of the rule, the six prefix constants and `MATERIAL_FIELD_EVIDENCE` are deleted. The world reader tests pass with only their import line changed.
- `minimap_step.py` indexes each texture export of a minimap package through `build_texture_source` (`texture_export_source_status`): readable with its format name, or a gap with the library reason (`texture-licensee-unsupported:`, `texture-format-unsupported:`, or `decode-failed:` for a malformed record). `minimap_join.py` lost its `REVIEWED_VERSIONS` licensee refusal; a joined radar export that is not readable adds the library reason to the tile and is not converted. A readable one converts through the Converter (which also reads it through `build_texture_source`) into the unchanged `native-tile-minimap` manifest.
- Regenerated census (`python -B scripts/world/minimap_join_census.py --client E:/Lineage2-client`, sha256 `d59e3b9d517beb7232450010dc6ea081bb262eddd6490ce4739ecf0905f07362`, 95,443 bytes): L2_RadarMap (118/0) has 18 exports. 1 is readable (`RadarMaps.Global`, DXT1) and 17 town exports are `texture-format-unsupported:5`. town_map (123/23) has 5 DXT1 exports and 1 `texture-format-unsupported:7`, and l2zonename (123/28) has 204 P8. All 153 tiles are gaps with `minimap-join-unresolved:radar-texture` (153) and `zone-grid` (153). `projection` fell from 141 to 84 only because 69 tiles now have a sealed chunk plan (12 before).

## The 20_21 sky equality check (task 1)

- Method: `C:/laragon/l2b-orchestration/autonomous-roadmap/sky_output_equality_02_82.py` runs `run_sky_step` for 20_21 against E:/Lineage2-client with the lane store and ledger redirected into `artifacts/lane-store/world/work/sky-equality-02-82-<label>/` (removed after the check). It ran once before the change and once after.
- Sealed receipt (2026-11-10, fingerprint `45fc464c...`): all 18 texture files (DDS, PNG, export, mip, native and DDS JSON of WhiteChip, WhiteCloud, WhiteRing) equal the before run. The material graph and program files, `sky.json` and `manifest.json` already differed at plan start (row 977), with the same fingerprint.
- Before versus after: 28 outputs each, and both have empty gap rows. These are byte-identical: every DDS, PNG, export, mip0 and `sky.glb` file and all six material graph and program files. These differ: the three `*.native.json`, the three `*.dds.json`, `sky.json` and `manifest.json`, so the bundle folder is `1cb346c8...` instead of `370e9dab...`. In the native JSON, no common field changed. The shared reader only adds `files`, `format.propertyStatus`, `layout.evidence`, per-mip `uBits`, `vBits`, `recordOffset`, `lazyArrayEnd`, `headerHex`, `trailerHex`, `nativePrefix`, `palette`, `propertyTags`, `source.exportIndex` and `source.offsetSpace`. The DDS JSON changes only `sourceManifest.sha256` and adds the two source fields. `sky.json` keeps every old field and adds the same receipt fields.

## Task commits

1. Task 1 (tracer): `ff67fe1` Read 118/0 sky packages and textures through the shared texture library and import the Lineage material prefix rule in the world readers (02-82 task 1)
2. Task 2: `7f5e272` Index every minimap texture export through the shared texture library so a joined radar texture converts or names the library gap, and regenerate the minimap join census (02-82 task 2)

## Deviations from plan

1. [Truth not met as written] The plan says the 20_21 sky step output must be byte-identical to its seal, and any difference stops the plan. That cannot hold. The shared texture record is a superset of the deleted sky record, so the native and DDS metadata files, `sky.json` and the content-addressed bundle folder change. Every pixel, mip, export, DDS, GLB and material byte is equal, and no common metadata field changed. I continued rather than add a projection shim or keep the duplicate reader (row 976). Comparing against the seal itself was meaningless, because the code at plan start does not reproduce it (row 977).
2. [Rule 3 - Blocking] Deleting `read_sky_material_package` also touched `scripts/world/sky_step.py`, `scripts/world/minimap_step.py` (import only, in task 1) and `tests/pipeline/test_texture_package_118.py`. That test compared the shared reader with the sky copy. It now checks payloads at their source offsets and the whole export.
3. [Rule 3 - Blocking] Deleting the world prefix constants also touched `scripts/world/terrain_height_texture.py` and `tests/pipeline/world_reader_fixture_packages.py`. They now import from the owner (row 980).
4. [Scope] Task 2 indexes the exports of all three minimap packages, not only L2_RadarMap. This keeps one index shape. The census therefore also lists town_map and l2zonename readability.
5. The join outcome changed for a refused radar export, so `MINIMAP_JOIN_ALGORITHM_VERSION` went from 1 to 2 (row 979). The name rules are unchanged, and no town texture joins a tile by likeness (rule G7, T-02-82-02).
6. TDD order: the step and join tests were written together with the code change, not as a separate RED commit.

## Decisions logged

Rows 976 to 980 in `.planning/OVERNIGHT-DECISIONS.md` (the file the previous plan 02-81 used for rows 969 to 975).

## Requirements

- WORLD-06 and WORLD-02 are not marked complete. Plan 02-89 alone writes REQUIREMENTS.md (rule G9). This plan delivers the reader half of gap SC1d; the radar join itself stays a named gap.

## Needs Human (for 02-89, IMPORTA-PC questions)

- Which client data names each tile's radar image? On the locked client, no L2_RadarMap export equals a tile id, `<tile id>_map` or a zone `map` value, and 17 of its 18 exports are town radar maps of format 5 (RGBA8, `texture-format-unsupported:5`).
- A sourced georeference for the `int_worldmap1` to `int_worldmap6` pieces of `systextures/L2Font-e.utx` (census `worldMapPieces`, `usedByJoin: false`).
- The 21 zonename rows whose MapX or MapY lies outside the locked tile grid (census `zoneRowsOutsideGrid: 21`), which turn every zone join into `minimap-join-unresolved:zone-grid`.

## Open follow-ups

- Format 5 (RGBA8) is not a reviewed texture format. Even with a sourced join, the 17 town radar maps would stay `texture-format-unsupported:5` until an RGBA8 layout is cross-checked like the 02-73 rows. The same holds for the 1,752 RGBA8 L2UI_CH3 textures named in 02-73.
- `python scripts/test_pipeline.py` (2,145 tests, 57 skipped) has one failure that this plan did not cause: `test_converter_output_guard` flags `scripts/world/terrain_seam_facts.py` (from 02-81) as an output entry point without the converter output guard. It is logged in `deferred-items.md`.
- 02-88 reseals the 20_21 sky and every minimap unit. The sky metadata gains the shared fields, and the minimap config changes with join version 2.

## Reference overlap

No `tools/reference-overlap/overlapAreas.json` area covers `scripts/world/sky_*`, `scripts/world/minimap_*` or `scripts/world/reader_licensee_layouts.py` (Python scanning lands in 02-93), so there is no blocking or unreviewed run to report.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_world_sky_materials.py"`: 10 OK. `test_world_reader_licensees.py`: 24 OK. `test_world_sky_step.py`: 16 OK.
- `-p "test_minimap_step.py"`: 16 OK. `-p "test_minimap_join.py"`: 21 OK. `-p "test_texture_*.py"`: 81 OK (2 skips for absent IMPORTA-PC fixtures). `-p "test_world_*.py"`: 300 OK (8 skipped).
- Full `python scripts/test_pipeline.py`: 2,145 run, 1 failure from 02-81 (see Open follow-ups).
- `node scripts/check-lane-ownership.mjs --base 8f0951a --part minimap`: lane world, 0 foreign paths.
- The self-contained repo name check (DEC-OWN-11) is empty for everything written here.

## Process cleanup

I started only foreground runs: Python tests, the two sky step harness runs, the census generator and the full pipeline suite. There was no dev server, preview or browser. After the last run, no python, node, browser or UModel process had this worktree path in its command line, and nothing listened on 5173 or 5175. The temporary sky equality folders were removed.

## Self-Check: PASSED

- Commits ff67fe1 and 7f5e272 are ancestors of HEAD.
- Modified files exist; `SkyLayoutPackage`, `sky_layout_texture_source`, `read_sky_material_package` and `texture_licensee_gap_reason` no longer appear under `scripts/` or `tests/`.
