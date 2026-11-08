---
phase: 02-stage-a-breadth
plan: 3
subsystem: native-store
status: complete
tags: [catalog-writer, lane-store, lane-catalog, stagers, pipeline]
requires:
  - phase: 02-stage-a-breadth
    provides: store_paths (02-01) for reparse refusal, confined child paths, portable names and lane store roots; check-machine-schedule.mjs (02-02)
provides:
  - scripts/native_store/catalog_writer.py, the single owner of sha256 helpers, replace_file, immutable_write, add_store_file, read_store_catalog, merge_catalog_slice and write_store
  - scripts/native_store/write_lane_catalog.py with --lane, --union (repeatable) and --plan; lane catalogs carry sourceCatalogSha256
  - stage_native_runtime.build_runtime_store_files and a stage_runtime that writes only through write_store
  - the lane converter calling form that 02-16, 02-22 and later lane plans follow
affects: [02-04, 02-06, 02-16, 02-22, 02-24, 02-55, every lane converter step]
tech-stack:
  added: []
  patterns:
    - "Lane converters write through read_store_catalog, merge_catalog_slice, add_store_file and write_store, then pin with write_lane_catalog.py --lane <lane>"
    - "write_store verifies every destination and the catalog bytes before the first write and replaces catalog.json last"
key-files:
  created:
    - scripts/native_store/catalog_writer.py
    - scripts/native_store/write_lane_catalog.py
    - tests/pipeline/test_lane_catalog_writer.py
  modified:
    - scripts/stage_native_runtime.py
    - scripts/stage_native_world_audio.py
    - scripts/stage_native_players.py
    - scripts/stage_native_animation_audio.py
    - scripts/stage_native_combat_audio.py
    - scripts/stage_native_stepsound_package.py
    - scripts/stage_native_stepsound_deco_grass.py
    - scripts/stage-native-movers.py
    - scripts/derive-native-map-bsp.py
    - scripts/derive-native-map-overlap.py
    - scripts/migrate-native-terrain-runtime.py
    - tests/pipeline/test_stage_native_runtime.py
    - tests/pipeline/test_native_world_audio.py
    - tests/pipeline/test_native_map_bsp.py
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "build_runtime_store_files stays in stage_native_runtime.py because it reads the migration folder format (row 114)"
  - "read_store_catalog, add_store_file, read_current_catalog_bytes and verify_store_destinations join the library (row 115)"
  - "Identical duplicate records are kept once; differing ones are refused (row 116)"
  - "Union capacity is the target slice length plus the incoming count (row 117)"
  - "--plan prints a restage instruction until 02-24 and refuses a lane that is not written yet (row 118)"
  - "migrate-native-terrain-runtime.py stays at 446 lines (row 119)"
  - "Three runtime staging tests expect the write_store refusals (row 120)"
  - "The BSP and mover immutable_write variants keep their names (row 121)"
  - "INT-01 stays Pending (row 122)"
requirements-completed: []
duration: 20min
completed: 2026-11-08
commits: 5
plan_head_before: 767cc0b4f218c2c9a79e18c098df3dc2c15c4b70
plan_head_after: f505646dd8ba36e0034dde0850feb2b965ff0900
actuals:
  tokens: 20000
  tasks: 3
  commits: 5
---

# Phase 2 Plan 03: Catalog writer library and lane catalog Summary

**One catalog writer library now owns the verify-then-write store rules. The stagers and their ten importers use it. `write_lane_catalog.py` pins a lane catalog to the SHA-256 of the read-only `public/l2/catalog.json`, unions lane stores with duplicate refusal, and prints a one-line restage handoff under `--plan`.**

## Performance

- Duration: about 20 min (17:56 to 18:15 Riga, Sunday; DATABASE-PC has no relay window)
- Tasks: 3 of 3
- Files: 17 changed in the five task commits, plus the docs commit

## Accomplishments

- `scripts/native_store/catalog_writer.py` (151 lines) provides:
  - `CatalogWriteError`, `KNOWN_CATALOG_SLICES` (the ten slices of docs/OUTPUT_CONTRACT.md), `NATIVE_RESOURCE_PATH_PATTERN` (the browser regex, compared with `nativeResourceUrl.ts` by a test) and `MAXIMUM_CATALOG_BYTES` (32 MiB)
  - `sha256_hex`, `sha256_of_file`, `replace_file` and `immutable_write`, moved from `stage_native_runtime.py` with the same messages
  - `add_store_file`, `read_current_catalog_bytes`, `read_store_catalog` (duplicate keys and non-finite numbers refused) and `merge_catalog_slice`
  - `verify_store_destinations` and `write_store`
- `write_store` refuses a reparse point on the store root path, refuses a differing existing file before the first write, refuses a catalog that changed since it was read (before and after the file writes), and replaces `catalog.json` last and only when the bytes change.
- `scripts/native_store/write_lane_catalog.py` (148 lines):
  - single lane: verifies every record file in the lane store (SHA-256 and byte length), sets `sourceCatalogSha256` and writes; byte-identical on rerun
  - `--union`: union lanes must be pinned to the current base SHA-256; their files (except top-level `catalog.json` and `coverage.json`) are copied and their records merged in command-line order
  - `--plan`: writes nothing and prints one `restage ...` line
- `stage_native_runtime.py`:
  - `build_runtime_store_files(migration)` returns `(files, catalog)`
  - `stage_runtime` compares the absolute destination with this project's `public/l2` without resolving it, then calls `write_store`
  - In this worktree `public/l2` is a junction, so the stager can no longer reach the main store at all.
- `stage_native_world_audio.py` merges through `merge_catalog_slice(catalog, 'worldAudio', entry, MAX_RECORDS)` after the "Another bundle of this kind" check. Stage mode writes through `write_store`, and plan and verify-only use `verify_store_destinations`.
- The nine other importers take `immutable_write` and `replace_file` from `native_store.catalog_writer`; `verified_archive` stays in `stage_native_runtime`. `migrate-native-terrain-runtime.py` adds `native_store/catalog_writer.py` to its implementation hash tuple.
- Comments and docstrings are gone from every touched file. `__doc__` descriptions became `RUNTIME_STAGE_DESCRIPTION`, `MOVER_STAGE_DESCRIPTION`, `BSP_FLOOR_DERIVATION_DESCRIPTION`, `OVERLAP_DERIVATION_DESCRIPTION`, `TERRAIN_RUNTIME_MIGRATION_DESCRIPTION` and `LANE_CATALOG_DESCRIPTION`.

## Lane converter calling form

Lane plans (02-16, 02-22 and later) write their outputs like this, with no private copy of any helper:

```python
from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import add_store_file, merge_catalog_slice, read_store_catalog, write_store
from native_store.store_paths import lane_store_root

store_root = lane_store_root(project_root, '<lane>')
catalog, before = read_store_catalog(store_root)
catalog = merge_catalog_slice(catalog, '<slice>', record, LANE_OWN_CAPACITY)
files = {}
add_store_file(files, '<sha256>/asset.l2asset', archive_bytes)
write_store(store_root, files, before, json_bytes(catalog))
```

1. Merge each record with the lane's own capacity, for example the npcProfiles cap that 02-33 raises. The record's `/l2/` paths must name files that the same step adds to the lane store.
2. Pin the catalog to the shared store: `python -B scripts/native_store/write_lane_catalog.py --lane <lane>`. It refuses a record whose file is missing or differs, and sets `sourceCatalogSha256`.
3. The integration union (02-55) runs `--lane integration --union world --union actors --union data-ui`.
4. For the handoff, run `python -B scripts/native_store/write_lane_catalog.py --lane <lane> --plan`, then write its single line into `.planning/STATE.md` as `Needs Human (plan 02-NN): <line>`. From 02-24 on, the line is the exact `merge_lane_store.py` command.

## Task commits

1. Task 1, tracer: catalog writer library and a pinned single-lane catalog - `075094b` (feat)
2. Task 2: stager tests expect the shared store writer refusals - `be612b4` (test); stagers write through the shared catalog writer - `75ad984` (refactor)
3. Task 3: failing union, duplicate and `--plan` tests - `fcf0522` (test); lane catalog union with duplicate refusal and the `--plan` restage line - `f505646` (feat)

The tracer gate passed: the Task 1 `<verify>` ran end to end with 13 tests ok. The junction case ran with `_winapi.CreateJunction` and did not skip.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_lane_catalog_writer.py" -v`: 21 tests ok, 0 skipped. Among them:
  - `test_lane_catalog_is_pinned_and_byte_identical_twice` (the second run writes 0 files and the snapshot is unchanged)
  - `test_write_store_refuses_a_catalog_changed_after_it_was_read` and `..._while_files_were_written`
  - `test_plan_prints_one_restage_line_and_writes_nothing` (exactly one line starting `restage `)
- `test_stage_native_runtime.py`: 22 tests ok, 1 skipped (the local NPC bundle is absent, as before).
- `test_native_world_audio.py`: 6 tests ok, 2 skipped (Core.dll and the canonical decode are absent, as before).
- `pnpm test:pipeline` (`python scripts/test_pipeline.py`) at BelowNormal through a ctypes `SetPriorityClass` wrapper: 999 tests OK, 103 skipped. That matches the 02-01 baseline skip count, with no failures. After Task 2 it was 991 OK and 103 skipped.
- `python -B scripts/native_store/write_lane_catalog.py --lane plan` printed the usage with `actors, data-ui, integration, world` and exited 2.
- `grep -rlE "from stage_native_runtime import.*\b(immutable_write|replace_file)\b" scripts` prints nothing (baseline 10 files).
- `grep -c "def build_runtime_store_files" scripts/stage_native_runtime.py` prints 1.
- `grep -c` for the six library function definitions in `catalog_writer.py` prints 6.
- The tokenize and ast comment check exits 0, and `grep -c '"""'` prints 0, for:
  - both new modules
  - the new test
  - the eleven edited scripts
  - the three edited tests
- `node scripts/check-lane-ownership.mjs --base 767cc0b --part adapter-dispatch`: "lane integration: 0 foreign paths", exit 0.
- `git status --short artifacts public` prints nothing. No stager, derive, migrate or restage script ran; `write_lane_catalog.py` ran only on temp projects and for the argparse refusal.
- The self-contained wording grep over `scripts` and `tests/pipeline` prints nothing.

## TDD gate compliance

- Task 2 (refactor of existing behaviour):
  - RED: `be612b4` updated three runtime staging expectations to messages that exist only in `write_store`, so they fail against the old stager.
  - GREEN: `75ad984`.
- Task 3:
  - RED: `fcf0522`. 7 of the 8 new cases failed (4 errors, 3 failures). The unknown-lane case already passed, because argparse `choices` came from Task 1.
  - GREEN: `f505646`, 21 of 21.
- No refactor commit was needed.

## Decisions made

OVERNIGHT-DECISIONS rows 114 to 122:
- `build_runtime_store_files` placement (114)
- the extra library functions (115)
- identical duplicates kept once (116)
- the union capacity rule (117)
- the pre-02-24 restage line and the stale-lane refusal (118)
- the `migrate-native-terrain-runtime.py` size exception (119)
- the changed runtime test messages (120)
- the two remaining `immutable_write` variants (121)
- INT-01 stays Pending (122)

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The BSP helper renames were reverted**
- Found during: Task 2 (full pipeline run)
- Issue: `derive-native-map-bsp.py` lost its docstrings, and its local `immutable_write`, `unlinked` and `value_spans` were renamed to fit the naming rule. But `derive-native-map-terrain.py`, `derive-native-map-model.py` and `derive-native-map-building.py` load that file as a module and call those names, so 8 cases in `test_native_map_terrain.py` failed with AttributeError.
- Fix: the original names are back; only docstrings and comments are removed. The acceptance grep for `^def (immutable_write|replace_file)\(` therefore also lists `derive-native-map-bsp.py` (exclusive-create variant) and `native_map_movers.py` (world-owned, different signature) (row 121).
- Commit: 75ad984

**2. [Rule 1 - Bug] Runtime staging test expectations follow write_store**
- Issue: `write_store` refuses a differing destination before `immutable_write` runs, so "corrupt; preserved" became "Existing immutable store file differs; preserved". `stage_runtime` no longer resolves its destination, so a linked `public/l2` is refused by the reparse check instead of "only to this project".
- Fix: three expectations changed; the outside folders are still asserted empty (row 120).
- Commit: be612b4

**3. [Rule 2 - Correctness] `--plan` refuses a lane that is not written yet**
- Issue: a plan line computed from unwritten union changes would name a lane catalog SHA-256 that is not on disk.
- Fix: `--plan` exits 1 when files would be added or the catalog bytes would change (row 118). This is covered by `test_plan_refuses_a_lane_without_a_catalog_or_with_unwritten_changes`.
- Commit: f505646

**4. [Rule 2 - Correctness] `add_store_file` refuses `catalog.json`**
- Only `write_store` writes the store catalog, so a file map cannot overwrite it behind the before/after check.
- Commit: 075094b

**5. [Code rules] Renames where removed comments carried meaning**
- `stage_native_runtime.directory_link` in the test is now `directory_link_or_junction_without_symlink_privilege`.
- Two test names were extended:
  - `test_catalog_preserves_format_unknown_fields_and_the_unrelated_first_section_with_the_same_hash`
  - `test_every_object_matches_the_canonical_decode_and_omitted_fields_stay_null`
- `migrate-native-terrain-runtime.catalog_replace` is now `replace_catalog_section_span`. It has no outside callers.
- The `# noqa: E402` markers in `test_native_world_audio.py` are removed; the repo runs no flake8 or ruff.

## Known stubs

None.

## Needs Human

None added. This plan produces no lane output, so there is nothing to restage.

## Process cleanup

- Processes started: three `python scripts/test_pipeline.py` runs under the BelowNormal wrapper and the unittest runs. All ran in the foreground and exited. No dev server, Vite preview, Playwright or browser was started.
- Listing at 18:15 Riga, through `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'autonomous-roadmap' }`:
  - `13376 35432 powershell.exe powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'autonomous-roadmap' } ..."`
  - `1 processes with autonomous-roadmap in the command line`
  - The only match is the listing query itself, so none remain and nothing needed stopping.
- `netstat -ano` shows no listener on 5173 or 5175.

## Self-Check: PASSED

- FOUND: scripts/native_store/catalog_writer.py, scripts/native_store/write_lane_catalog.py, tests/pipeline/test_lane_catalog_writer.py
- FOUND: 075094b, be612b4, 75ad984, fcf0522, f505646 (all ancestors of HEAD)
