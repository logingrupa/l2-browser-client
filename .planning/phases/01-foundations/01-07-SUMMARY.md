---
phase: 01-foundations
plan: 07
subsystem: asset-pipeline
tags: [python, reference-client, guard, found-03, world-converters]
status: complete

requires:
  - phase: 01-foundations
    provides: "require_reference_client and ReferenceClientAccess.require_equal_file (plan 01-02)"
provides:
  - "All twelve world-side converter entry points call require_reference_client right after parse_args"
  - "MapSources checks its client root on construction and passes every package read through require_equal_file"
  - "Per-file checks in native_sky, extract-native-terrain-patch, native_bsp_floor, native_bsp_building and restore-native-static-normals"
affects: [01-08, 01-13]

actuals:
  tokens: 5000
  tasks: 3
  commits: 3
plan_head_before: 645905cdfd4e3672e716036b026575340b119530
plan_head_after: 898611fb34200d7a69f181205a7d59ec563e4968

tech-stack:
  added: []
  patterns:
    - "World entry point: args = parser.parse_args(); require_reference_client(args.client) before any path resolution"
    - "A builder that reads client files takes client_access = require_reference_client(client) and reads through client_access.require_equal_file(relative)"

key-files:
  created: []
  modified:
    - scripts/native_sky.py
    - scripts/extract-native-terrain-patch.py
    - scripts/derive-native-map-model.py
    - scripts/derive-native-map-movers.py
    - scripts/native_bsp_building.py
    - scripts/native_bsp_floor.py
    - scripts/native_map.py
    - scripts/derive-native-map-overlap.py
    - scripts/native_map_geometry.py
    - scripts/native_map_overlap.py
    - scripts/export-native-map-audio.py
    - scripts/restore-native-static-normals.py
    - tests/pipeline/test_native_bsp_building.py

key-decisions:
  - "MapSources.get is the single client path builder for map packages, so it carries the per-file require_equal_file check for every map reader that uses it"
  - "Files above 400 lines got only the guard and comment removal; they shrank and were not split"

patterns-established:
  - "Guard call sits between parse_args and the first path resolution, so E: is refused before any output check or read"

requirements-completed: []

coverage:
  - id: D1
    description: "native_sky.py and native_map.py run against E:/Lineage2-client with no lock exit 1 with 'reference client lock missing' and leave the output directory empty"
    requirement: FOUND-03
    verification:
      - kind: manual
        ref: "python -B scripts/native_sky.py --client E:/Lineage2-client --output <empty temp>; python -B scripts/native_map.py --client E:/Lineage2-client --output <empty temp> --verify"
        status: pass
  - id: D2
    description: "World pipeline tests still pass with the guard wired in"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/pipeline/test_native_sky.py, test_native_terrain_patch.py, test_native_map_model_append.py, test_native_map_movers.py, test_native_bsp_*.py, test_native_map*.py, test_native_static_normals.py"
        status: pass

duration: 11 min
completed: 2026-11-08
---

# Phase 1 Plan 07: Guard the world converter entry points summary

**All twelve world-side converters now refuse `E:/Lineage2-client` before reading anything while the lock is missing. MapSources and five builders also check each client file against the lock before reading it.**

## Performance

- Duration: about 11 min (04:44 to 04:55 UTC, 06:44 to 06:55 Riga, outside the relay window)
- Tasks: 3 of 3
- Files: 13 modified (12 scripts and 1 test), 121 insertions, 168 deletions

## Accomplishments

- Every script in the plan calls `require_reference_client(<client root>)` right after `parse_args`, before any output check or path resolution. `export-native-map-audio.py` guards `--client-snapshot`. Its check runs inside the existing reported-failure block, so a refusal comes back as `{"status": "failed", "error": ...}`.
- `native_map.MapSources` calls the guard when it is built. `MapSources.get` checks `require_equal_file(relative)` before every package read. That gives a per-file check to every map reader that uses MapSources: native_bsp_floor, native_bsp_building, derive-native-map-model, native_map_geometry, native_map_movers and native_map_overlap.
- These builders now read client files through `client_access.require_equal_file`:
  - `native_sky.build`: `maps/20_20.unr`, `system/Engine.u` and `textures/l2_skies.utx`
  - `extract-native-terrain-patch.extract`: the map and the `T_20_20.utx` height package
  - `native_bsp_floor.build` and `native_bsp_building.build`: `maps/20_20.unr`, plus `system/Engine.u` through `actor_collision_evidence`
  - `restore-native-static-normals.derive`: the package and the dependencies. This replaces its two hand-written "escapes source client" checks.
- Every comment and non-runtime docstring in the 12 scripts is gone. Module docstrings passed as `description=__doc__` stay as CLI help. Names now carry what the comments said:
  - `convex_triangles_keeping_collinear_boundary_vertices` and `xzy_reflected_winding` (bsp building)
  - `xzy_reflected_fan_triangle`, `require_resolvable_reference`, `file123_licensee28_extra_field` and `exact_vertex_plane_normal` (bsp floor)
  - `unqualified_corrected_mask_uv` (terrain patch)
  - `require_existing_targets_match_before_writing`, which now replaces two duplicated loops, and `changed_resource_names` (overlap derivation)
  - `QUALIFIED_MASK_UV_SOURCE_SHA256`, `umodel_xzy_basis_permutation` and `native_row_major_as_gltf_column_major` (geometry)
  - `cancellation_avoiding_origin` (overlap)
- `derive-native-map-movers.py` now has a `main()` in place of the inline `__main__` block and its one-line `run` wrapper.

## Task commits

1. Task 1 (tracer): sky, terrain patch, model and mover entry points - `9001bbd`
2. Task 2: BSP, map and overlap derivation entry points - `79eea68`
3. Task 3: geometry, overlap, map audio and static normal entry points - `898611f`

## Verification

- Tracer refusal: `recipes/reference-client-tree.lock.json` is absent. `python -B scripts/native_sky.py --client E:/Lineage2-client --output <new temp dir>` exits 1, and stderr ends with `ReferenceClientLockError: reference client lock missing: recipes/reference-client-tree.lock.json; ...`. The temp directory stays empty. The refusal comes before the script's own "artifacts scratch output" check, so the guard is the first thing that runs.
- Second refusal: `python -B scripts/native_map.py --client E:/Lineage2-client --output <temp> --verify` exits 1 with `{"error": "reference client lock missing: ..."}`. Its output stays empty.
- Unit tests (BelowNormal priority):
  - `test_native_sky`: 1 run, 1 skipped
  - `test_native_terrain_patch`: 4 run, 1 skipped
  - `test_native_map_model_append`: 5 run, 5 skipped
  - `test_native_map_movers`: 12 run, 8 skipped
  - `test_native_bsp_*`: 8 run, 2 skipped
  - `test_native_map`: 17 run, 3 skipped
  - `test_native_map_overlap_derivation`: 2 run
  - `test_native_map_*`: 105 run, 30 skipped
  - `test_native_static_normals`: 8 run, 2 skipped
  - All OK. Tests that need the private IMPORTA-PC input keep skipping, because that input exists only in the main checkout.
- `pnpm test:pipeline`: 806 run, 1 error, 103 skipped. This matches the counts at the end of plan 01-02 exactly. The single error is the pre-existing `test_native_animation_aliases.RealReportTests.test_refuses_to_overwrite_a_different_output` (`FileNotFoundError` for `LineageWarrior.int`), already logged in `deferred-items.md`. Nothing new fails. The command exits 1 for that reason only.
- Acceptance greps: all 12 scripts contain `require_reference_client(` (zero files at 0). No `#` comment lines remain in any of the 12 scripts or in `tests/pipeline/test_native_bsp_building.py`.
- `python -B -m py_compile` passes on all 12 scripts. The `--help` output of the two derive scripts is unchanged.
- Processes: only foreground Python runs and one `pnpm test:pipeline` run were started, and each exited. The `Get-CimInstance Win32_Process` check found no python.exe or node.exe with `autonomous-roadmap` in its command line.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 2 - Correctness] Per-file checks wherever one builder owns the client reads**
- Found during: Tasks 1 to 3
- Issue: the plan asks for `require_equal_file` only where a script has one client path helper. native_sky, the terrain patch, both BSP builders and the static normals derivation each read their client files from one builder function, and MapSources is the shared reader for map packages.
- Fix: those reads go through `client_access.require_equal_file`. Other direct reads (native_map_geometry `safe_path(client, ...)`, native_map_overlap `verify_file`, the derive scripts' `local(client, ...)`) rely on the entry check, as OVERNIGHT-DECISIONS row 12 decided.
- Commits: `9001bbd`, `79eea68`, `898611f`

**2. [Rule 3 - Blocking] Renaming a documented helper touched its test**
- Found during: Task 2
- Issue: the comment rule required renaming `convex_triangles` to `convex_triangles_keeping_collinear_boundary_vertices`, which `tests/pipeline/test_native_bsp_building.py` imports.
- Fix: updated the test import and calls. Removed the test's three comments and renamed what they explained (`points_degenerating_a_vertex_zero_fan`, `twice_area_with_xzy_reflected_winding`).
- Commit: `79eea68`

**3. Scope kept to the plan's files**
- Renaming `clean_adapter_work` in export-native-map-audio.py would have touched `export-native-sounds.py`. Under the comment rule, that file would then need a full comment sweep, and it is out of this plan's scope. The rename was reverted and only the comment was removed.

Total: 2 auto-fixed, 1 scope note. Impact: refusal is stricter than the plan text asked. No option names or defaults changed.

## Issues encountered

- `pnpm test:pipeline` still exits 1 because of the pre-existing animation alias error (see Verification and `deferred-items.md`). It needs the same private-input `skipUnless` as the other tests. Not fixed here, because it is out of scope.
- Git Bash in this session refuses `cmd`, `powershell` and inline `python -c` wrappers. BelowNormal priority came from a helper outside the repo (`%TEMP%/l2b-autonomous/run_below_normal.py`, which calls `SetPriorityClass` and then runs the command). The process check went through `%TEMP%/l2b-autonomous/list_worktree_processes.py`.

## Known stubs

None.

## Threat flags

None beyond the plan's threat model. T-01-13 is mitigated: every world entry point checks the guard right after `parse_args`, and refusal is proven end to end on two entry points. The scan test that stops a future entry point from skipping the guard belongs to plan 01-08.

## Next phase readiness

- Plan 01-08 can wire the actor and data side with the same pattern, then add the scan test over every `--client` entry point.
- FOUND-03 stays pending until plan 01-13 records the lock (OVERNIGHT-DECISIONS row 18).

## Self-Check: PASSED

- All 13 modified files exist on disk. The plan creates no new files.
- Commits `9001bbd`, `79eea68` and `898611f` are ancestors of HEAD.
