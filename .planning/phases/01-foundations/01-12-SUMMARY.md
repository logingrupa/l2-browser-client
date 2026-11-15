---
phase: 01-foundations
plan: 12
subsystem: asset-pipeline
status: complete
tags: [output-contract, asset-json-v2, golden-fixtures, umodel-guard, FOUND-02]
requires:
  - phase: 01-foundations
    provides: "01-02 reference client guard and lock layout; 01-03 readNativeCatalog and buildNativeCatalogIndex; 01-07 and 01-08 guarded entry points; 01-13 committed reference-client-tree.lock.json"
provides:
  - scripts/native_assets_lib/asset_manifest.py (v2 builder, v1-v2 validator, coordinates accessor, clientBuild reader)
  - scripts/native_assets_lib/umodel_import_closure.py (lock-equal import closure check before UModel)
  - scripts/generate_golden_fixtures.py and tests/fixtures/golden/ (synthetic fixtures, fixtures.lock.json)
  - docs/OUTPUT_CONTRACT.md
  - readAssetPackage manifest type schemaVersion 1 | 2 with normalised coordinates
affects: [every converter run, staged store restage, Power Strike resolver, map overlap audit, export-native-sounds verification]
tech-stack:
  added: []
  patterns:
    - "One Python writer (build_asset_manifest) and one Python validator (require_supported_asset_manifest); one browser validator (readAssetPackage)"
    - "Fixture pins hash JSON in json_bytes canonical form and binaries raw; the folder is -text in .gitattributes"
    - "UModel runs only after the target package's whole import closure passed require_equal_file"
key-files:
  created:
    - scripts/native_assets_lib/asset_manifest.py
    - scripts/native_assets_lib/umodel_import_closure.py
    - scripts/generate_golden_fixtures.py
    - tests/fixtures/golden/model-v1.l2asset
    - tests/fixtures/golden/model-v2.l2asset
    - tests/fixtures/golden/audio-v2.l2asset
    - tests/fixtures/golden/reference-client-tree.lock.json
    - tests/fixtures/golden/l2/catalog.json
    - tests/fixtures/golden/fixtures.lock.json
    - tests/unit/assetPackageContract.test.ts
    - tests/pipeline/test_asset_manifest_v2.py
    - tests/pipeline/test_native_assets_manifest_v2.py
    - tests/pipeline/test_umodel_import_closure.py
    - docs/OUTPUT_CONTRACT.md
  modified:
    - .gitattributes
    - scripts/native_assets.py
    - scripts/native_map_overlap.py
    - src/assets/package/readAssetPackage.ts
    - src/effects/nativePowerStrikeSource.ts
    - tests/fixtures/assetPackageFixture.ts
    - tests/unit/assetPackage.test.ts
    - tests/unit/nativePowerStrikeSource.test.ts
    - tests/unit/nativeResource.test.ts
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/phases/01-foundations/deferred-items.md
key-decisions:
  - "asset.json v2: source.path {host, absolutePath}, clientBuild {referenceTreeLockSha256, engineDllSha256} read from the tree lock, converterVersion = implementation_hash(), model coordinates {metre, 100, right, Y, sourceToGltf}; the writer refuses without the lock"
  - "UModel pre-read gap closed by the import closure (OVERNIGHT-DECISIONS row 32): Converter.run refuses before UModel starts unless every package in the target's transitive imports is lock-equal, resolvable to one file and parseable"
  - "provenance.json source carries the same source.path as asset.json, so existing provenance-equals-asset checks stay exact"
duration: 17min
completed: 2026-11-08
commits: 4
plan_head_before: 14c70a5a6d25195eba59bc564e40bc198721edc3
plan_head_after: 1355d7bc574f8b69a4a472ba3884731446464a33
actuals:
  tokens: 60000
  tasks: 3
  commits: 4
---

# Phase 1 Plan 12: Output contract v2 Summary

Converters now write asset.json schemaVersion 2 (source path, client build from the committed tree lock, converter hash, right-handed Y-up metre coordinates for models) through one Python builder; the browser reader, the Python verifier and the Power Strike resolver accept v1 and v2; synthetic hash-pinned golden fixtures run without the private client; `docs/OUTPUT_CONTRACT.md` writes the contract down; and UModel no longer runs until the target package's whole import closure is lock-equal.

## What passes now

- `python -B -m unittest discover -s tests/pipeline -p "test_asset_manifest_v2.py"`: 15 tests OK (determinant check, clientBuild from the fixture lock, missing lock refused, v1-v2 validation, byte-identical regeneration, sorted fixture lock).
- `test_native_assets_manifest_v2.py`: 4 OK (verify_archive accepts golden v1 and v2, rejects schemaVersion 3; a real `Converter.convert` writes v2 with this host, the resolved media path, the fixture clientBuild and `implementation_hash()`; no lock means no write).
- `test_umodel_import_closure.py`: 3 OK (a non-equal transitive import and an unresolvable import are refused with `subprocess.run` never called; an all-equal closure runs UModel once and records all three packages as dependencies).
- `pnpm typecheck`: clean.
- `pnpm test:pipeline`: 860 run, OK (103 skipped), exit 0.
- `pnpm test:unit`: 1500 passed, 3 failed, 82 skipped. The 3 failures are already known: `editorGeometryCompat.test.ts` (Editor install hash, plan 01-09), the 2 `nativeNpcProfiles.test.ts` cases (plan 01-03 note), and a `nativeEditorBspAppend.test.ts` 5000 ms timeout under full-suite load (plan 01-05 note; it passed alone in this session).
- Acceptance greps: 3 golden `.l2asset` files; generator mentions no client or store path (0); no comments in `readAssetPackage.ts` or `nativePowerStrikeSource.ts` (0, 0); `manifest['schemaVersion'] != 1` gone from `native_assets.py`; `grep -c "Needs Human" .planning/STATE.md` = 3; no em or en dashes in `OUTPUT_CONTRACT.md`.

## Task commits

| Task | Commit | What |
| --- | --- | --- |
| 1 | e3ac082 | v2 builder, golden fixtures and lock, v1-v2 browser reader, contract tests |
| 2 | e9cfba8 | converter writes v2, verify_archive and overlap audit use the shared validator, UModel import closure check |
| 2 fix | 597318e | provenance source matches the v2 source; shared normalised fixture manifest |
| 3 | 1355d7b | `docs/OUTPUT_CONTRACT.md`, Needs Human lines in STATE.md |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Power Strike resolver changed in task 1, not task 2**
- **Found during:** Task 1 typecheck
- **Issue:** the discriminated manifest type no longer types `model.unit` and `model.sourceToGltf`, so `nativePowerStrikeSource.ts` failed typecheck as soon as the reader changed.
- **Fix:** moved the resolver to `manifest.coordinates` and v1-or-v2 acceptance in the same commit; its test gained a v2 case and coordinate-missing and schemaVersion 3 rejections.
- **Commit:** e3ac082

**2. [Rule 1 - Bug] provenance.json source differed from the v2 asset source**
- **Found during:** Task 3 full `pnpm test:pipeline` (18 errors in `test_native_sounds.py`, "Converted provenance differs").
- **Issue:** `export-native-sounds.py` requires `provenance['source'] == asset['source']`; v2 adds `source.path` to the asset only.
- **Fix:** the converter computes the source path record once and writes it into both.
- **Commit:** 597318e

**3. [Rule 1 - Bug] Two tests compared the read manifest with the raw fixture manifest**
- **Found during:** Task 3 full `pnpm test:unit` (`assetPackage.test.ts`, `nativeResource.test.ts`).
- **Fix:** `assetFixture` returns `readManifest` with the normalised coordinates; both tests use it.
- **Commit:** 597318e

**4. Catalog fixture generated in task 1**
- The generator writes `l2/catalog.json` with the other fixtures, so it landed in the task 1 commit and the catalog test sits in `assetPackageContract.test.ts` from the start. No behaviour difference from the plan.

**5. Test placement**
- `tests/pipeline/test_native_assets.py` needed no change (its v1 manifests stay valid). The converter and verify_archive v2 cases live in the new `test_native_assets_manifest_v2.py`, keeping `test_native_assets.py` (which has comments, under the touch rule) untouched and both files small.

**6. `scripts/native_assets.py` grew by 14 lines (781 to 795)**
- The plan expected no growth. The additions are the manifest call, the import closure hook and two imports; the logic lives in the two new library modules. The file was already over 400 lines before this plan.

### Extra item in scope: UModel pre-read gap

Closed with option (a) from deferred-items.md (OVERNIGHT-DECISIONS row 32). `Converter.run` calls `require_lock_equal_umodel_reads` before building the UModel command. It walks the target package's top-level imports (`outerIndex == 0`) transitively through `Converter.package`, which resolves each name to exactly one package file and checks it with `require_equal_file`, then parses it for its own imports. A missing or ambiguous name, a parse failure or a non-equal file raises before UModel starts. The closure is cached per root package per `convert` call. The post-run log check stays as a second check. Residual, recorded in deferred-items.md: `scripts/native_catalog/cli.py` (`inventory` and UModel `-list`) still reads client files outside `require_equal_file`; it writes a catalog, not converted assets.

### Other notes

- `implementation_hash()` changes because `native_assets_lib` gained two modules and `native_assets.py` changed. The converter version is derived, as intended, so every new conversion has a new cache key.
- Module docstrings in `native_assets.py` and `native_map_overlap.py` became named description constants for argparse (comment rule).

## Known Stubs

None.

## Needs Human

- Restage `public/l2` to asset.json v2 from the main checkout (integration thread).
- After that restage, delete v1 acceptance in `readAssetPackage.ts`, `nativePowerStrikeSource.ts` and `asset_manifest.py`, and regenerate fixtures without `model-v1.l2asset`.

## Threat Flags

None beyond the plan's register. T-01-18 (guard clauses on every v2 field), T-01-19 (synthetic-only generator, byte-for-byte regeneration test) and T-01-20 (canonical JSON hashing, `-text` rule) are mitigated as planned.

## Processes

Only Vitest, tsc and Python test runs were started, each in the foreground and finished. `list_worktree_processes.py` found no node or python process with `autonomous-roadmap` in its command line after the last run.

## Self-Check: PASSED

All created files exist; commits e3ac082, e9cfba8, 597318e and 1355d7b are on HEAD.
