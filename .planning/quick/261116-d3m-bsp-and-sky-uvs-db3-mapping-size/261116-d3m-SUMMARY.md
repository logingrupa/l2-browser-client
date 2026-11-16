---
quick: 261116-d3m
status: complete
branch: lane/combiner-db1
plan_head_before: fda1086
plan_head_after: 154d1e4
commits: 3
completed: 2026-11-16
---

# Quick task 261116-d3m: BSP and sky UVs by the DB-3 mapping size - summary

Supersedes the BSP UV part of 261115-k4b (source texture USize and VSize).

## Commits

- `7da6f85` BSP UVs by the DB-3 rule (`UModel::BuildRenderData` 0x105ee860); converter output version eccc7503 (still one raise over c4bf8e6c), source digest 968dc4fa, world gap reasons list 22, BSP step 6.
- `154d1e4` review fixes, below.
- This SUMMARY and the STATE row.

## Review fixes

- Sky-zone nodes use the same rule: `sky_geometry` takes `node_texture_coordinates` with the root's mapping size; a mapping gap drops the root with its row; a null sky surface takes DefaultMaterial. Sky step stays 3 (one raise over main, never sealed). E: 20_20 sky roots: 1024 x 1024, 512 x 128, 32 x 32; the served sky GLB still matches except UV values.
- No program pin, image or TEXCOORD_0 without a mapping size; such a material is not baked.
- An authored None object reference is a null child, not a decode failure.
- `world_material_sources` is built after the level reads again, so a layout gap row no longer depends on UModel.
- Tests: sealed `run_bsp_step` pass with TEXCOORD_0 values and cross-package inputs, a reference-client test of the FX_E_T water chain and Engine.DefaultTexture, an honest converter version test name, a class-default read check, the synthetic water fixture renamed, the BSP step test file split.

## Gate

- `pnpm typecheck` passes.
- Pipeline suite: 2,865 run, 74 skipped; 5 environment errors (unsealed 20_20 and 20_21 raw units, data-ui catalog without npcgrp) and 1 timing failure of test_item_unit_worker_processes (60 s gate under load; the file passes 9 of 9 alone).
- Unit suite: 2,926 passed, 101 skipped; 3 files do not load (lane lacks research data).

## Open

- x87 precision control during BuildRenderData is assumed 53-bit (REA question in `docs/parts/world/EVIDENCE.md`).
- Reconvert waits for the integration thread.
