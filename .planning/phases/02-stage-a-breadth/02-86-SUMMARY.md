---
phase: 02-stage-a-breadth
plan: 86
subsystem: world BSP and sky surface materials
tags: [world, gap-closure, mat-01, mat-02, material-program, texture-image-pins, tile-manifest, lane-store]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-74 derive_material_program(texture_images=...) and write_material_program_record; 02-82 sky textures through the shared 118/0 library"
provides:
  - "scripts/world/material_texture_images.py: reviewed_texture_nodes, material_texture_image_pins, write_material_texture_images; PNGs at native-materials/textures/<sha256>/texture.png"
  - "BSP surface programs pin every reviewed Engine.Texture node to its Converter texture PNG; a failed conversion keeps image null and its conversion gap reason"
  - "Sky programs pin every reviewed Texture node to its shared-library PNG (sky_texture_products_by_node, sky_texture_pngs_by_node)"
  - "One program writer: material_program_record (bsp) and write_sky_material_program (sky) are deleted"
  - "Tile resource kind surface-materials: native-materials/surface-materials-<sha256>.json with a files map of every graph, program and image of the tile's BSP and sky, followed by the lane catalog and merge walk"
  - "bsp and sky products list materialFiles; BSP_STEP_ALGORITHM_VERSION 5, SKY_STEP_ALGORITHM_VERSION 2, TILE_MANIFEST_STEP_ALGORITHM_VERSION 12, vocabulary listVersion 10"
affects: [02-88 (reseals every world tile under the new step versions), 02-89 (restage carries the material files), 03-12]

actuals:
  tokens: 13700
  tasks: 3
  commits: 4
plan_head_before: df3f88b4b5304b969e02282c481b22ffa8d7b321
plan_head_after: 7641e2a

tech-stack:
  added: []
  patterns:
    - "A per-tile listing in the native-materials bundle folder whose files map makes the store walk copy JSON members as leaves, so a graph is never parsed as a manifest"
    - "Texture images content-addressed outside the program folder so the program pin has no hash cycle"

key-files:
  created:
    - scripts/world/material_texture_images.py
  modified:
    - scripts/world/bsp_surface_materials.py
    - scripts/world/bsp_step.py
    - scripts/world/sky_materials.py
    - scripts/world/sky_step.py
    - scripts/world/tile_manifest_step.py
    - recipes/world/tile-manifest-vocabulary.json
    - scripts/native_store/tile_manifest_validation.py
    - src/scene/world/nativeTileManifest.ts
    - docs/OUTPUT_CONTRACT.md
    - tests/pipeline/test_world_bsp_step.py
    - tests/pipeline/test_world_sky_materials.py
    - tests/pipeline/test_world_sky_step.py
    - tests/pipeline/test_tile_manifest_step.py
    - tests/pipeline/test_material_graph.py
    - tests/unit/nativeTileManifestResources.test.ts
    - tests/browser/world-tile-lighting.spec.ts

key-decisions:
  - "1042: the surface-materials listing lives at native-materials/surface-materials-<sha>.json with a files map relative to native-materials/, so the walk copies graphs, programs and images as leaves and checks SHA-256 and size"
  - "1043: texture images at native-materials/textures/<png sha256>/texture.png"
  - "1044: the new kind's path template in tile_manifest_validation.py and nativeTileManifest.ts, and the OUTPUT_CONTRACT rows, are the plan's two integration paths"
  - "1045: every registered step from terrain to manifest re-ran on 20_21 and 20_20, because those tiles were already stale upstream of bsp"

patterns-established:
  - "World steps that write material programs list their store files as product materialFiles; the tile manifest step turns them into one pinned listing"

requirements-completed: []

coverage:
  - id: D1
    description: "BSP surface programs carry the image pin of every reviewed Texture node; a failed texture keeps image null and its conversion gap reason"
    requirement: MAT-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_bsp_step.py#test_every_reviewed_texture_node_is_converted_and_pinned_by_its_png_in_the_store"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_world_bsp_step.py#test_a_texture_that_fails_conversion_keeps_a_null_image_and_its_conversion_gap_reason"
        status: pass
      - kind: integration
        ref: "20_21 bsp re-run: 42 of 42 Texture nodes pinned, every PNG hash-checked; 20_20: 49 pinned, 1 null with its UModel duplicate-leaf failure row"
        status: pass
    human_judgment: false
  - id: D2
    description: "Sky programs carry the PNG pin of the sky texture through the one program writer"
    requirement: MAT-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_sky_materials.py#SkyProgramTextureImageTests"
        status: pass
      - kind: integration
        ref: "20_21 and 20_20 sky re-runs: 3 of 3 sky Texture nodes pinned each, no sky gap rows"
        status: pass
    human_judgment: false
  - id: D3
    description: "Each tile manifest pins one surface-materials listing that the lane catalog walk and the merge follow to every material file"
    requirement: MAT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_bsp_step.py#test_the_tile_manifest_pins_one_listing_the_store_walk_follows_to_every_material_file_of_its_bsp_and_sky"
        status: pass
      - kind: unit
        ref: "tests/unit/nativeTileManifestResources.test.ts#accepts one surface-materials listing"
        status: pass
      - kind: integration
        ref: "write_lane_catalog.py --lane world and --plan exit 0; world lane pin walk 7464 files, 0 missing, 0 mismatched"
        status: pass
    human_judgment: false
  - id: D4
    description: "20_21 BSP sections draw through the UE2 material library with their lightmaps"
    requirement: MAT-02
    verification:
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-lighting.spec.ts (2 passed): library-compiled 114 of 125, lightmapped 110"
        status: pass
    human_judgment: true
    rationale: "MAT-01 and MAT-02 are provisional, owner review (index G2); the visual match with L2.exe is a side-by-side check in Phase 3"

duration: 1h 13m
completed: 2026-11-12
---

# Phase 2 Plan 86: BSP and sky texture image pins and the surface-materials tile resource Summary

**BSP and sky material programs now pin every reviewed Texture node to a converted PNG at `native-materials/textures/<sha>/texture.png` through the one program writer, each tile manifest pins a `surface-materials` listing the lane merge walk follows, and on 20_21 114 of 125 BSP sections draw through the UE2 material library (was 0 of 125).**

## Performance

- Duration: 1h 13m (2026-11-12 18:12 to 19:25 Riga)
- Tasks: 3 of 3
- Files: 17 code, test and doc files across 3 task commits

## Accomplishments

- Task 1 (tracer): `convert_surface_material` converts every reviewed `Engine.Texture` node of the surface graph through `Converter.texture`, builds `{path, sha256, bytes}` pins with `material_texture_image_pins`, derives the program with `texture_images`, writes it through `write_material_program_record`, and writes the PNGs with `write_material_texture_images`. A texture that fails conversion keeps `image: null` and adds its `decode-failed:` reason. `material_program_record` is deleted. The bsp product lists its `materialFiles`. `BSP_STEP_ALGORITHM_VERSION` is 5. The lighting spec now requires a `library-compiled` 20_21 section.
- Task 2: `sky_texture_products_by_node` converts every reviewed Texture node of a sky graph through the shared texture library, and `sky_material_program` takes the PNG pins. A library refusal keeps `image: null` and adds its reason as a gap row on the root. The drawn sky texture reuses the converted product. `write_sky_material_program` is deleted, and the sky step writes through `write_material_program_record`. The sky product lists its `materialFiles`. `SKY_STEP_ALGORITHM_VERSION` is 2.
- Task 3: the tile manifest step merges the bsp and sky `materialFiles`. It refuses a path outside `native-materials/`, and a file pinned twice with different pins. It writes `native-materials/surface-materials-<sha>.json` (kind `native-tile-surface-materials`, a `files` map keyed relative to `native-materials/` with `sha256` and `bytes`) and pins it as tile resource `surface-materials`. Vocabulary `listVersion` is 10, and `TILE_MANIFEST_STEP_ALGORITHM_VERSION` is 12. The path template is in the Python validator and the browser reader, and the parity test passes. `docs/OUTPUT_CONTRACT.md` names the kind and the texture prefix.

## Merge walk check (index rule 14)

`catalog_writer.pinned_file_child_references` parses every JSON that an absolute `/l2` pin reaches. A `native-materials/<sha>/graph.json` holds package records `{file, sha256}`, and the walk would read those as bundle member pins and refuse them. The listing therefore sits directly in the `native-materials` bundle folder, and its `files` map members are leaves whose SHA-256 and size are checked (row 1042). `merge_lane_store.py` (read only) copies exactly the files `verify_pinned_store_files` returns, so it follows the listing. No integration change to the walk is needed.

## Runs (world lane store)

- Each step ran alone: `node scripts/check-machine-schedule.mjs && python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py python -B scripts/world/convert_tile.py --client E:/Lineage2-client --map <tile> --step <step>`. On 20_21 the steps ran 18:36 to 18:50; on 20_20 they ran 18:54 to 19:10. Every step exited 0.
- 20_21: 22 BSP materials (20 textured), 84 material files (40 images). All 42 BSP Texture nodes are pinned and none is null. The 3 sky Texture nodes are pinned. The listing `surface-materials-452523d6...json` names all 93 files. Tile manifest `tiles/b5dd3f08.../tile.json`.
- 20_20: 30 BSP materials (28 textured). 49 Texture nodes are pinned. One is null, `Oren_HED_T2.hed_danwall01`, with the failed row `decode-failed:ValueError:UModel cannot safely select this duplicate leaf name`. The 3 sky nodes are pinned. The listing `surface-materials-5e6e2186...json` names 117 files. 20_20 had no map-emitters resource before this plan either.
- Free bytes on C: went from 16,114,323,456 before the first bsp run to 13,472,612,352 after the 20_20 chain. Most of the drop is the meshes re-runs.
- `write_lane_catalog.py --lane world` ran after 20_21 (catalog `ea435286...`) and again after 20_20 (catalog `19f8d1dd...`, 62 tiles, `filesWritten` 0). Both runs exited 0, and each was followed by `--plan`, which exited 0 and printed the merge command into `public/l2` with base `55c12147...`.
- Pin check on the world lane store alone, the 02-55 walk shape with the repo walk rules (`check_world_lane_pins_02_86.py` in the orchestration helpers folder): 7,464 files, 0 missing, 0 mismatched, 175 reached as listing members.
- `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-lighting.spec.ts` ran with nothing listening on 5173. Desktop and phone landscape both passed. Section statuses: `library-compiled` 114, `library-diagnostic` 11, `program-unconverted` 0, `lighting-gap` 0. 125 sections, 110 lightmapped. Before this plan all 125 were `texture-image-absent`. The desktop screenshot shows the 20_21 BSP walls textured and lightmapped.

## Task commits

1. `1017ac7` Pin every reviewed Texture node of a BSP surface program to its converted PNG in the world lane store (task 1, tracer; tracer gate: verify re-run, passed)
2. `3d1320d` Pin the converted sky texture PNGs on the sky programs and write them through the one program record writer (task 2)
3. `7641e2a` Pin one surface-materials listing per tile so the lane catalog and merge copy every BSP and sky material graph, program and texture image (task 3)

`commits: 4` is `git rev-list --count df3f88b..7641e2a`. It includes `e4fd7e9`, which another agent committed in this worktree while the plan ran.

## Deviations from plan

1. [Rule 3 - Blocking] The plan re-runs only bsp and lighting on 20_21, and only sky and manifest on 20_20. On both tiles, terrain, meshes, movers, collision, emitters, bsp-visibility, sky, audio, lighting and minimap were already stale before this plan, and collision refused to run without current meshes and movers. Every registered step from terrain to manifest therefore ran on both tiles, one process at a time, after all three code commits (row 1045). That also means one manifest run per tile instead of an interim one in Task 1.
2. [Rule 3 - Blocking] A new tile resource kind needs its path template in `scripts/native_store/tile_manifest_validation.py` and `src/scene/world/nativeTileManifest.ts`. Without them the vocabulary load and the browser reader refuse the kind. Both got one template line, a parity test and a Vitest case. The plan's text said "no runtime file changes" (row 1044).
3. [Docs truth] `docs/OUTPUT_CONTRACT.md` lists every store prefix and every tile resource kind. It now names `surface-materials` and `native-materials/textures/<sha>/texture.png`.
4. [Shared helper] `scripts/world/material_texture_images.py` is new. It is the one owner of the texture image path, pin and write for both the bsp and sky steps. `native_assets_lib/material_resources.py` is frozen (rule G6).
5. [Behaviour] A sky texture refusal is now a gap row even when the root later stops for an unported root or a presentation field gap, because every reviewed Texture node is converted before the program is derived. A `FormatError` while decoding a sky texture is now a failed row for that root. Before, it ended the step.
6. Tests reused across files: `test_world_bsp_step.py` imports `SYNTHETIC_CLASS_DEFAULTS`, `synthetic_png_bytes` and `synthetic_tile` from the existing test modules. `test_material_graph.py` lost its comparison against the two deleted writers, and its test was renamed.

## Lane ownership

`node scripts/check-lane-ownership.mjs --base df3f88b --part world` reports 7 foreign paths. Two are this plan's: `scripts/native_store/tile_manifest_validation.py` and `docs/OUTPUT_CONTRACT.md` (row 1044). The other five, `.planning/phases/03-stage-a-checks/03-12` to `03-15-PLAN.md` and `03-PLAN-INDEX.md`, come only from the concurrent commit `e4fd7e9`.

## Reference overlap

No area in `tools/reference-overlap/overlapAreas.json` covers `scripts/world/bsp_surface_materials.py`, `sky_*`, `tile_manifest_step.py`, `material_texture_images.py` or `src/scene/world/nativeTileManifest.ts`, so there is no blocking or unreviewed run to report.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_world_bsp_step.py" -v`: 25 OK (1 skipped). `-p "test_world_sky_*.py"`: 29 OK. `-p "test_world_*.py"`: 308 OK (8 skipped). `-p "test_tile_*.py"`: 90 OK. `-p "test_minimap_*.py"`: 37 OK. `-p "test_*pin*.py"`: 77 OK. `-p "test_material_*.py"`: 30 OK. `test_catalog_record_shapes.py` (template parity): 28 OK.
- Full `python -B scripts/test_pipeline.py` at BelowNormal: 2,327 tests OK (56 skipped).
- `pnpm vitest run tests/unit/nativeTileManifestResources.test.ts`: 8 passed. `pnpm typecheck`: passed.
- The Task 3 verify command (unittest, `--plan`, no listener on 5173 or 5175) exited 0.
- The self-contained repo name check (DEC-OWN-11) is empty for everything written here.

## Decisions logged

Rows 1042 to 1045 in `.planning/OVERNIGHT-DECISIONS.md`.

## Requirements

MAT-01 and MAT-02 are not marked complete. Plan 02-89 alone writes REQUIREMENTS.md (rule G9), and both stay provisional, owner review. This plan delivers the surface half of the MAT-01/MAT-02 gap.

## Open follow-ups

- The other world tiles reseal in the 02-88 batch: bsp version 5, sky version 2 and manifest version 12 make every sealed bsp, sky and manifest unit re-run.
- 11 of the 125 20_21 sections stay `library-diagnostic`. The spec's inspection file keeps only the status counts, not each section's reasons, so this run does not record which library features they need. The 20_21 bsp gap rows name `FX_E_T.WaterSurfaceShaderSet.WaterShader01` (`material-class-unported:Engine.TexOscillatorTriggered`) and the surface adapters that have no diffuse for Combiner and TexPanner roots. The per-section reasons are left for the 02-88 world evidence.
- `Oren_HED_T2.hed_danwall01` on 20_20 cannot convert: UModel cannot safely select a duplicate leaf name. Its Texture node stays `image: null` with that failed row.
- The shared store carries the new files only after the owner restage that 02-89 records.

## Needs Human

None added.

## Known stubs

None.

## Threat flags

None beyond the plan's threat model. T-02-86-01 is mitigated: every pin comes from the converted bytes (SHA-256 and size), `checked_texture_image` checks it again, and the browser checks the bytes again. T-02-86-02 is mitigated: the listing names every file, and both `--plan` and the pin walk pass.

## Process cleanup

This plan started the step runs, the lane catalog runs, the pin walk, the Python suites, one Vitest run, `pnpm typecheck` and one Playwright run. Playwright started its own `pnpm dev` on 5173 and stopped it on exit. Every process ran in the foreground or as one bounded background command that was waited on to exit. After the last run, nothing listened on 5173 or 5175. No node, python, browser or UModel process had this worktree path in its command line; only the shell running the check did.

## Self-Check: PASSED

- FOUND: scripts/world/material_texture_images.py, .planning/phases/02-stage-a-breadth/02-86-SUMMARY.md
- FOUND commits: 1017ac7, 3d1320d, 7641e2a (ancestors of HEAD)
- `material_program_record` and `write_sky_material_program` no longer appear under `scripts/`
