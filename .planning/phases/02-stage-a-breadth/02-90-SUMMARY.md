---
phase: 02-stage-a-breadth
plan: 90
subsystem: world batch
tags: [world-lane, world-03, gap-closure, sc1a, sc1b, unit-ledger, current-seal, stale-seal]
status: complete
requires:
  - phase: 02-stage-a-breadth
    provides: 02-55 world lane store and catalog, 02-47 tile batch, 02-54 meshes review state fingerprint
provides:
  - scripts/world/tile_step_current_seals.py with TILE_STEP_SEAL_CHECKS and unit_step_seal (current, stale, pending or unsealed per unit and step)
  - scripts/world/locked_input_receipt.py with receipt_with_current_version_config_and_locked_inputs, the one owner of the version, config and locked-inputs receipt rule
  - raw_map_ledger and raw_map_unit_fingerprint in raw_map_step.py, chunk_plan_unit in tile_chunk_plan.py, tile_manifest_unit in tile_manifest_step.py, sealed_bsp_unit_config in bsp_step.py, sealed_mover_unit_config in mover_step.py
  - tile_step_registry refuses a registered step without a current-seal check
affects: [02-88 world batch run and world EVIDENCE, 02-86 tile manifest edits, 03-12 convert_tile_batch edits]
tech-stack:
  added: []
  patterns: [one current-seal check per registered step, seal checks injected into the batch like the step runner, stale seals are work and read pending]
key-files:
  created:
    - scripts/world/tile_step_current_seals.py
    - scripts/world/locked_input_receipt.py
    - tests/pipeline/test_tile_step_current_seals.py
    - tests/pipeline/tile_step_seal_fixture.py
  modified:
    - scripts/world/eligible_tile_selection.py
    - scripts/world/convert_tile_batch.py
    - scripts/world/tile_step_registry.py
    - scripts/world/raw_map_step.py
    - scripts/world/tile_chunk_plan.py
    - scripts/world/tile_manifest_step.py
    - scripts/world/world_audio_step.py
    - scripts/world/bsp_step.py
    - scripts/world/sky_step.py
    - scripts/world/mover_step.py
    - scripts/world/minimap_step.py
    - scripts/world/tile_step_gap_rows.py
    - tests/pipeline/test_convert_tile_batch.py
decisions:
  - "P956: the receipt rule lives in the leaf module scripts/world/locked_input_receipt.py, because the registry imports every step that calls it; bsp, sky and movers drop their copies"
  - "P957: raw_map_unit_fingerprint is keyed by map path (non-tile census maps), tile_manifest_unit returns the whole unit, and the registry entry is unit_step_seal with injected checks"
  - "P958: a stale step is work even with a recorded gap or failed row and reads pending batch-pending until rerun; OSError or ValueError while inspecting is not current in tile_has_work and a failed row in tile_rows"
  - "P959: upstream_failed_row moves to tile_step_gap_rows.py to cut the minimap_step import cycle"
metrics:
  duration: 25min
  completed: 2026-11-11
actuals:
  tokens: 17500
  tasks: 2
  commits: 3
plan_head_before: 167b7255a42a4c095a437618e861ee79cfaac987
plan_head_after: 2e55ddaa81e5136764c3c902f5c5d96dc70911f6
---

# Phase 2 Plan 90: Current-seal registry for the tile batch summary

**The tile batch and the single-step row now read every seal through one registry that asks each step's own unit, config or recipe function whether the seal is current. A stale seal is batch work and reads pending, never as its old pass or gap rows. The version 1 inspection ledger is gone.**

## Performance

- Duration: about 25 min (2026-11-11 13:45 to 14:10 UTC)
- Tasks: 2 of 2
- Files: 17 changed (4 created)

## Accomplishments

- `scripts/world/tile_step_current_seals.py`: `TILE_STEP_SEAL_CHECKS` holds one check for each of the 14 names in `TILE_STEP_NAMES`. `unit_step_seal(project_root, unit_key, step, step_seal_checks)` answers `current`, `stale`, `pending` or `unsealed` and gives the receipt evidence path.
  - The seven steps with a unit helper (raw, chunks, terrain, meshes, collision, emitters, bsp-visibility and lighting) compare with `UnitLedger.is_sealed(unit_key, <step unit>.fingerprint)`.
  - The four steps whose inputs are found during the run (bsp, sky, world audio and movers) use the shared version, config and locked-inputs rule with each step's own config function.
  - Minimap uses its own `current_minimap_receipt` with `upstream_sealed_fingerprints`.
  - The tile manifest uses `tile_manifest_unit` on the current sealed terrain.
- A pending answer comes only from the step's own upstream-unsealed errors: `ChunkPlanStepError`, `TerrainChunkStepError`, and `UpstreamUnitPendingError` for an unsealed mover class receipt or minimap upstream.
- `eligible_tile_selection.sealed_unit_step`, `sealed_tile_step`, `seal_derived_step_row` and `unit_step_evidence` read seals only through the registry. `SEAL_INSPECTION_ALGORITHM_VERSION` and `seal_inspection_ledger` are deleted.
- `convert_tile_batch.tile_has_work` returns true on a stale seal even when the recorded row is gap or failed. `step_result` uses the registry answer. `tile_rows` drops the recorded rows of stale steps, so a stale step reads `pending batch-pending` until a batch reruns it. `main` passes `TILE_STEP_SEAL_CHECKS`. Tests inject synthetic checks, the same way they inject the step runner.
- One owner for each rule:
  - The raw fingerprint lives in `raw_map_unit_fingerprint`, used by `run_raw_map_step`, `raw_unit_fingerprint` and the registry.
  - The chunk plan fingerprint lives in `chunk_plan_unit`, used by `sealed_chunk_plan`, `run_chunk_plan_step` and the registry.
  - The manifest fingerprint lives in `tile_manifest_unit`, used by `run_tile_manifest_step` and the registry.
  - The receipt rule lives in `receipt_with_current_version_config_and_locked_inputs`, used by world audio, bsp, sky, movers and the registry. The three copies in `bsp_step.current_sealed_receipt`, `sky_step.current_sky_receipt` and inside `mover_step.sealed_movers` are deleted.
- Fingerprint values do not change. Configs and inputs are the same dicts as before, so existing current seals stay current.

## Task commits

1. Task 1 (tracer): a stale world audio seal is batch work through the registry. Commit `b89669c`.
2. Task 2: every registered step answers current, stale or pending, and the version 1 inspection goes. Commit `2e55dda`.

`commits: 3` is measured from the plan ledger. It includes `9dde07f` ("Review the 02-77 water volume overlap runs in movement"), a concurrent orchestrator commit that is not part of this plan.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_tile_step_current_seals.py" -v`: 17 tests OK. They cover:
  - current, stale and pending answers for all 14 steps
  - world audio two versions below the step
  - an older rawFingerprint in the config
  - bsp and sky input records that no longer equal their lock records
  - a manifest that is stale for each of its 10 upstream fingerprints
  - registry coverage and refusal
  - the version 1 constants being absent
- `python -B -m unittest discover -s tests/pipeline -p "test_convert_tile_batch.py" -v`: 21 tests OK. This includes the batch tracer: a v1 world audio seal under a v3 step makes the tile work, the slice reruns audio and the row reads pass, and a tile with every seal current has no work.
- `python -B -m unittest discover -s tests/pipeline -p "test_world_*.py"`: 300 tests OK, 7 skipped. Also OK: `test_tile_manifest_step.py` (18), `test_tile_chunk_plan.py` (16), `test_minimap_step.py` (14), `test_terrain_chunk_step.py` (21), `test_level_model_licensees.py` (13), `test_minimap_join.py` (20).
- `python -B scripts/world/convert_tile_batch.py --help` and `python -B scripts/world/convert_tile.py --help` exit 0. Every touched module imports cleanly on its own, with no import cycle.
- `node scripts/check-lane-ownership.mjs --base 167b725 --part world` lists 2 foreign paths: `tools/reference-overlap/reviewedRuns/movement.json` and `tools/reference-overlap/signedOffRuns.json`. Both come only from the concurrent commit `9dde07f`. Every path this plan touched is world-owned (`scripts/world/**`) or shared (`tests/pipeline/**`).
- Reference overlap: no area in `tools/reference-overlap/overlapAreas.json` covers `scripts/world` Python, so there is no run to record.
- No batch slice was run, per the plan. 02-88 runs the batch once.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The receipt rule moved to a leaf module, not into the registry module.**
- Found during: Task 1.
- Issue: the registry imports `world_audio_step`, `bsp_step`, `sky_step` and `mover_step`, and these must call the rule. Putting the rule in the registry module makes an import cycle.
- Fix: the rule is `scripts/world/locked_input_receipt.py`. It is still one owner, and every caller uses it (decision row P956).
- Commits: `b89669c`, `2e55dda`.

**2. [Rule 3 - Blocking] `upstream_failed_row` moved to `tile_step_gap_rows.py`.**
- Found during: Task 2.
- Issue: `minimap_step` imported it from `eligible_tile_selection`, which now imports the registry. That is an import cycle.
- Fix: it moved together with `PENDING_STATUS` and the reason prefix (row P959).
- Commit: `2e55dda`.

**3. [Rule 2 - One owner] bsp, sky and movers call the shared receipt rule.**
- Issue: their own copies of the rule are deleted. bsp gains `sealed_bsp_unit_config` and movers gains `sealed_mover_unit_config`, so their `sealed_*` helper and the registry compose the config once.
- Files: `bsp_step.py`, `sky_step.py` and `mover_step.py`, which the plan's file list does not name.
- Commit: `2e55dda`.

**4. Names and signatures (row P957).**
- `raw_map_unit_fingerprint(project_root, map_path, lock_record)` takes a map path, not a tile id, because the raw step also seals non-tile census maps and `convert_tile` derives their rows through the registry. `raw_map_unit` keeps reading only the census, because a census-gap map returns its gap row before any fingerprint or lock class check.
- `tile_manifest_unit(project_root, tile_id, lock_record, terrain_unit)` returns the ledger, fingerprint, config and sealed upstream products. This replaces the planned `tile_manifest_unit_fingerprint`, so the run does not compute every upstream twice.
- The public entry is `unit_step_seal(...)`, which returns the state and receipt, instead of `current_sealed_receipt(project_root, tile_id, step)`. The batch needs to tell stale apart from unsealed.

**5. Inspection errors are widened to `OSError` and `ValueError`; before, they were `UnitLedgerError` only (row P958).** Computing a current fingerprint can now raise step errors. These show up as a not-current step in `tile_has_work` and as a failed row in `tile_rows`.

**6. New test helper `tests/pipeline/tile_step_seal_fixture.py`.** It follows the `*_fixture.py` convention and is shared by the two test files.

## Notes for 02-88

- A tile whose stale step fails before the ledger `begin` (for example, a decode error) keeps its stale seal. It stays batch work on every batch run, and its recorded failed row is replaced by pending until the step seals. With `--limit 1`, such a tile would take the only slot each run. Use a limit larger than the number of such tiles, or rerun that step with `convert_tile.py`.
- The world audio units sealed before `6c4cfa6` and the meshes units sealed before the 02-54 review state now answer stale. One `convert_tile_batch.py --eligible` resume reruns them.

## Known stubs

None.

## Process cleanup

This plan started no dev server, browser, Playwright or Vitest process. Every Python, node and PowerShell command ran in the foreground and exited. The final check for processes whose command line holds this worktree path is in the executor report.

## Self-Check: PASSED

- FOUND: `scripts/world/tile_step_current_seals.py`, `scripts/world/locked_input_receipt.py`, `tests/pipeline/test_tile_step_current_seals.py`, `tests/pipeline/tile_step_seal_fixture.py`
- FOUND: commits `b89669c` and `2e55dda` on `plan/autonomous-roadmap`
