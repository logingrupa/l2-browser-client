---
phase: 02-stage-a-breadth
plan: 4
subsystem: native-store
status: complete
tags: [catalog-writer, tile-manifest, tables, windows, golden-fixtures, output-contract]
requires:
  - phase: 02-stage-a-breadth
    provides: gap_rows validate_gap_row and the seed reasons (02-02); catalog_writer merge_catalog_slice, replace_file and write_lane_catalog (02-03)
provides:
  - validate_catalog_record in catalog_writer.py, called by merge_catalog_slice, with tiles, tables and windows record shapes
  - scripts/native_store/tile_manifest_validation.py (TileManifestError, load_tile_manifest_vocabulary, validate_tile_manifest, validate_tile_chunk_manifest and the shared constants)
  - synthetic golden tile 00_00 with chunk-0-0, table syntheticfixture and window SyntheticFixtureWnd
  - tests/fixtures/catalog-index-keys.json, the key contract 02-05 and 02-07 assert
  - docs/OUTPUT_CONTRACT.md sections for the new slices, Manifest kinds, the tile manifest vocabulary, Gap rows, Coverage report and the 02-05 key table
affects: [02-05, 02-07, 02-15, 02-16, 02-17, 02-19, 02-26, 02-30, 02-31, 02-45, 02-50, 02-61, 02-62]
tech-stack:
  added: []
  patterns:
    - "A catalog slice with a pinned manifest declares a PinnedManifestRecordShape (fields, id pattern, manifest path pattern with a sha256 group, byte bound)"
    - "require_pinned_path(path, sha256, path_pattern, error_type, label) is the one check that a resource path matches its kind, the browser path rule and its pinned SHA-256"
    - "World-owned vocabulary files widen closed sets that integration code validates, the same way lane gap reason files do"
key-files:
  created:
    - scripts/native_store/tile_manifest_validation.py
    - tests/pipeline/test_catalog_record_shapes.py
    - tests/fixtures/catalog-index-keys.json
    - tests/fixtures/golden/l2/tiles/bda58735e24af8da075d8acc808efdb632711c9f5ea6fa60067a7ccbc5bde5ef/tile.json
    - tests/fixtures/golden/l2/maps/9b72bc07057c7db92dfb479c4a74135dfac8a5be276a0b52e359c141674f3c5d/native-tile-chunk-runtime/manifest.json
    - tests/fixtures/golden/l2/tables/5e4cbff3f9a9bb05450e6b39c5f8abdd25cd964542ac7a7033cec2781205d3d1/syntheticfixture.json
    - tests/fixtures/golden/l2/windows/6ed18b1c35fedb7962c38aafacf0306df7f0dc25c7b888f647635737b6b86ac3/window.json
  modified:
    - scripts/native_store/catalog_writer.py
    - scripts/native_store/gap_rows.py
    - scripts/generate_golden_fixtures.py
    - tests/fixtures/golden/l2/catalog.json
    - tests/fixtures/golden/fixtures.lock.json
    - tests/unit/assetPackageContract.test.ts
    - tests/pipeline/test_lane_catalog_writer.py
    - docs/OUTPUT_CONTRACT.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "Tile and chunk field layouts, gap rows one per step sorted by step (row 159)"
  - "World-owned tile-manifest-vocabulary.json, created by 02-16, required by the loader, never written by 02-04 (row 160)"
  - "Resources sorted by (kind, manifest) with hash-addressed paths (row 161)"
  - "catalog-index-keys.json is the writer-half key contract (row 162)"
  - "4x4 chunk id rule (row 163)"
  - "Size bounds 8,000,000 / 32 MiB / 128 MiB (row 164)"
  - "coverage rows carry steps (row 165)"
  - "Legacy single-mesh NPC join kept for profiles without modelCatalogId (row 166)"
  - "test_asset_manifest_v2.py needs no edit (row 167)"
  - "TILE_ID_PATTERN lives in catalog_writer.py to avoid an import cycle (row 168)"
  - "INT-01, WORLD-01, UI-01 and DATA-01 stay Pending (row 169)"
requirements-completed: []
duration: 25min
completed: 2026-11-08
commits: 3
plan_head_before: 52cc356d5e49e7497284f0d79c81413816ff4d6e
plan_head_after: 15d86e362d7b8697644c094240a0d179e84d482d
actuals:
  tokens: 20600
  tasks: 3
  commits: 3
---

# Phase 2 Plan 4: Catalog record shapes and tile manifest kinds (writer half) summary

The catalog writer now refuses malformed `tiles`, `tables` and `windows` records inside every merge. The two tile manifest kinds have a validator backed by a world-owned vocabulary file, which the validator requires. The golden store carries one synthetic tile with one chunk, one table and one window. `docs/OUTPUT_CONTRACT.md` states the contract that the 02-05 reader implements.

## What was built

- `catalog_writer.py`:
  - `validate_catalog_record(slice_name, record)` runs first in `merge_catalog_slice`.
  - Every slice needs a non-empty string `id`. `tiles`, `tables` and `windows` must hold exactly their fields. The id pattern is checked, the manifest path must match its kind and the browser rule, the SHA-256 in the path must equal `manifestSha256`, and the byte length must be in bounds.
  - `tables` also checks `recordCount` (a safe integer of at least 0) and `sourceSha256`, and refuses an inlined `records` key.
  - `KNOWN_CATALOG_SLICES` gains `tiles`, `tables` and `windows`.
- `tile_manifest_validation.py`:
  - `validate_tile_manifest` and `validate_tile_chunk_manifest` cover the truths and every case in the behaviour block.
  - `load_tile_manifest_vocabulary` reads `recipes/world/tile-manifest-vocabulary.json`. A missing file raises `TileManifestError` naming the path.
  - Importing the module reads no file. A subprocess test makes any file read at import fail and shows that nothing is read.
- `generate_golden_fixtures.py`: `pinned_json_manifest` writes the synthetic chunk, tile, table and window manifests and gives their catalog pins. Regeneration is byte-identical.
- `gap_rows.write_gap_rows` writes through `catalog_writer.replace_file`, so there is one atomic writer. `test_gap_rows.py` passes unchanged.
- `tests/fixtures/catalog-index-keys.json` holds `skill:0:1`, `table:syntheticfixture`, `tile:00_00` and `window:SyntheticFixtureWnd`. A pipeline test derives each key from its golden record.

## Commits

| Task | Commit | Subject |
| --- | --- | --- |
| 1 | e15e23d | feat(02-04): validate tiles records and the two tile manifest kinds against a synthetic golden tile |
| 2 | 468b6e0 | feat(02-04): validate tables and windows records, add the golden table and window, and complete the written contract |
| 3 | 15d86e3 | refactor(02-04): write gap rows through the one atomic writer and test new-slice lane merges |

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_catalog_record_shapes.py" -v`: 22 tests OK. The vocabulary cases pass: missing file refused, import reads no file, the 02-16 shape, the shape after 02-31, all four kinds and each refusal.
- `test_asset_manifest_v2.py`: 15 OK, so regeneration is byte-identical. A separate `generate_golden_fixtures.py --output $TEMP/golden-check-0204` followed by `diff -r` against `tests/fixtures/golden` showed no difference.
- `pnpm vitest run tests/unit/assetPackageContract.test.ts`: 13 of 13 pass. The path list now has 10 pinned files.
- `test_gap_rows.py`: 11 OK. `test_lane_catalog_writer.py`: 23 OK, two of them new.
- `pnpm test:pipeline` at BelowNormal: 1086 tests OK, 107 skipped, 0 failures.
- `pnpm test:unit` at BelowNormal (Vitest 5.1.0, 127 files, 1583 tests):
  - Run 2: 2 failed, 1499 passed, 82 skipped. The 2 failures are the two known `nativeNpcProfiles.test.ts` cases ("Native player body source identity mismatch").
  - Run 1 also had one 5000 ms timeout in `nativeEffectStage.test.ts > rejects a mutated existing payload without repairing it`. This file is on the research list of timeout cases, and the 02-01 baseline records one timeout per run on a busy machine. It is not related to this plan's files.
  - So the failures match the 02-01 baseline.
- `node scripts/check-lane-ownership.mjs --base 52cc356 --part adapter-dispatch`: "lane integration: 0 foreign paths", exit 0.
- Acceptance greps:
  - `native-tile-chunk-runtime` appears 5 times in `docs/OUTPUT_CONTRACT.md` and the vocabulary path once.
  - The three new section headings are counted 3, and the file has no en or em dash.
  - The inventory check passes 40 names. The `catalog-index-keys.json` node check exits 0.
  - `modelCatalogId` appears 2 times and `chargrpIndex` 3 times.
  - `NamedTemporaryFile` appears 0 times in `gap_rows.py` and `replace_file` 2 times. Only `catalog_writer.py` defines `replace_file`.
  - `test ! -e recipes/world/tile-manifest-vocabulary.json` exits 0.
- The tokenize comment check exits 0 for every touched Python file, and no touched file has a docstring. `assetPackageContract.test.ts` has no comment.
- The retired-workspace name grep finds nothing in any file this plan wrote.

## Deviations from plan

### Auto-fixed issues

1. **[Rule 3 - Blocking] Import cycle avoided.** The validator needs `catalog_writer`'s path helpers. Defining `TILE_ID_PATTERN` in `tile_manifest_validation.py` and importing it into `catalog_writer.py` would create a cycle. So the pattern lives in `catalog_writer.py`, and the validator imports it. `QUALIFIED_OBJECT_PATTERN` is `gap_rows.QUALIFIED_OBJECT_NAME_PATTERN` under the planned name. Both names can still be imported from the validator, as 02-15 needs (row 168).
2. **[Rule 2 - Correctness] Fixed orders and no duplicates where the plan was silent.** Gap rows inside a manifest are one per step and sorted by step. A chunk lists each model id once. Resource and component paths are hash-addressed, with the path SHA equal to the pin. This keeps manifest bytes deterministic and makes path tampering visible (rows 159 and 161).
3. **[Rule 3 - Tooling] Priority wrapper.** The PowerShell priority prefix is not available in this session. The full suites ran through `subprocess.run(..., creationflags=BELOW_NORMAL_PRIORITY_CLASS)`, which gives the same BelowNormal priority, and child processes inherit it.

### Signature detail

`require_pinned_resource(record, kind_path_pattern)` from the plan sketch became `catalog_writer.require_pinned_path(path, sha256, path_pattern, error_type, label)` plus `require_byte_length`. Catalog records and manifest entries name their path and SHA fields differently, and this keeps one owner for the check across both error types.

## Known stubs

None. The golden chunk's null terrain, bsp and collision are intentional synthetic gaps, each with a `step-pending:<step>` row.

## Needs Human

Nothing new.

## Process cleanup

No dev server, Vite preview, Playwright or browser was started. Every test and suite command ran in the foreground and exited. The check afterwards:
- `ps -W` shows only node.exe processes from Oct 29 and one python.exe started the previous evening, before this run.
- `netstat -ano | grep -E ":(5173|5175) .*LISTENING"` is empty.
- No process started by this plan remains.

## Self-Check: PASSED

- All created files exist.
- Commits e15e23d, 468b6e0 and 15d86e3 are ancestors of HEAD.
