---
phase: 02-stage-a-breadth
plan: 18
subsystem: ui
tags: [python, ue2, utx, reference-client-guard, census]

requires:
  - phase: 02-stage-a-breadth
    provides: "02-02 machine schedule gate (scripts/check-machine-schedule.mjs) and the lock-checked reference client guard"
provides:
  - "scripts/data/texture_package_census.py: header-only census of lock-equal systextures/*.utx packages against texture_mips.REVIEWED_VERSIONS"
  - "docs/parts/ui/texture-package-census.json: 48 rows {path, packageVersion, licensee, reviewed, reason} with referenceTreeLockSha256"
  - "tests/pipeline/test_texture_package_census.py: synthetic-header and committed-census tests"
affects: [02-19, 02-20, 02-50]

actuals:
  tokens: 8000
  tasks: 2
  commits: 2
plan_head_before: aebdf4bad5855b5de6dab6d5f2e7bf1d0fec460a
plan_head_after: 5a48d3054362ccd746897f616d8cb575b4531322

tech-stack:
  added: []
  patterns:
    - "Header-only package census: require_equal_file, then one bounded 128-byte read into native_catalog.ue2.summary"
    - "Fixed committed output path with no --output flag, same writer shape as build_dat_table_inventory.py"

key-files:
  created:
    - scripts/data/texture_package_census.py
    - docs/parts/ui/texture-package-census.json
    - tests/pipeline/test_texture_package_census.py
  modified:
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "The census adds referenceTreeLockSha256 to the planned {schemaVersion, packages} shape (OVERNIGHT-DECISIONS row 170)"
  - "UI-02 stays Pending: the census is only an input to the window plans (row 171)"

patterns-established:
  - "Texture package licensee gaps are stated as texture-licensee-unsupported:<version>/<licensee> rows before any converter runs"

requirements-completed: []

coverage:
  - id: D1
    description: "Header-only census row for one package through the guard, with reviewed decision, unsupported and decode-failed reasons, and a 128-byte read bound"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_texture_package_census.py#TexturePackageCensusRowTests"
        status: pass
      - kind: integration
        ref: "python -B -c ... texture_package_census_row(require_reference_client('E:/Lineage2-client'), 'systextures/L2UI_CH3.utx')"
        status: pass
    human_judgment: false
  - id: D2
    description: "Census build refuses casefold-equal lock paths and a lock without systextures packages, sorts by (casefolded path, path), keeps the lock spelling and reruns byte-identically"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_texture_package_census.py#TexturePackageCensusBuildTests"
        status: pass
    human_judgment: false
  - id: D3
    description: "Committed census of all 48 lock-equal systextures packages, validated against the committed lock"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_texture_package_census.py#CommittedTexturePackageCensusTests"
        status: pass
      - kind: other
        ref: "python -B scripts/data/texture_package_census.py --client E:/Lineage2-client && git diff --exit-code docs/parts/ui/texture-package-census.json"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-11-08
status: complete
---

# Phase 2 Plan 18: UI texture package census Summary

**Header-only census of the 48 lock-equal `systextures/*.utx` packages: 28 are on reviewed texture reader versions (123/20, 123/28, 123/30) and 20 are stated `texture-licensee-unsupported` gaps, including L2UI_CH3, l2ui and L2_RadarMap at 118/0.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-11-08T17:57:51Z
- **Completed:** 2026-11-08T18:05:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- `texture_package_census_row` reads each package only through `require_reference_client(root).require_equal_file(path)`, then one bounded 128-byte read into `native_catalog.ue2.summary`. `reviewed` comes from `native_assets_lib.texture_mips.REVIEWED_VERSIONS`. No licensee is inferred from a file name.
- `build_texture_package_census` selects lock rows with class `equal` that match `systextures/<name>.utx` (casefolded). It refuses casefold-equal lock paths, naming both, and refuses a lock with no match. It sorts by (casefolded path, path), keeps the lock's on-disk spelling and pins the rows with `referenceTreeLockSha256`.
- Committed `docs/parts/ui/texture-package-census.json`. A rerun on `E:/Lineage2-client` is byte-identical.

## Census result (for 02-19 evidence, 02-20 and 02-50)

| Pair (version/licensee) | Reviewed | Packages |
|---|---|---|
| 123/28 | yes | 26 |
| 123/20 | yes | 1 |
| 123/30 | yes | 1 |
| 118/0 | no | 7: Direction, L2_Pawn, L2_RadarMap, l2ui, L2UI_CH3, sek, symbol |
| 123/27 | no | 4: fdarkelf, fdwarf, lineagedecostex, mdarkelf |
| 123/16 | no | 3: logbg, uwindowfonts, wareffectstextures |
| 123/23 | no | 2: cubemaps, town_map |
| 123/25 | no | 2: goldcubes, lineagemonsterstex2 |
| 123/18 | no | 2: l2_skilltime, pledge |

No header failed to decode. Of the packages 02-20 and 02-50 need, `Icon.utx` and `l2zonename.utx` are reviewed. `L2UI_CH3.utx`, `l2ui.utx` and `L2_RadarMap.utx` (118/0) and `town_map.utx` (123/23) are unreviewed by the repo texture reader. Their UModel export is not decided by this column (02-20 decides that).

## Task Commits

1. **Task 1: Census one package, systextures/L2UI_CH3.utx, from guarded header read to a validated row** - `d9941e5` (feat)
2. **Task 2: Census every systextures package into the committed JSON** - `5a48d30` (feat)

**Plan metadata:** this docs commit (SUMMARY, STATUS ui line, OVERNIGHT-DECISIONS rows 170 and 171)

## Files Created/Modified

- `scripts/data/texture_package_census.py` - census CLI (`--client` only) and library: `TEXTURE_PACKAGE_PATH_PATTERN`, `HEADER_BYTE_COUNT`, `TexturePackageCensusError`, `texture_package_census_row`, `build_texture_package_census`, `validate_texture_package_census`, `texture_package_census_bytes`, `main` (151 lines)
- `docs/parts/ui/texture-package-census.json` - committed census, 48 rows
- `tests/pipeline/test_texture_package_census.py` - 15 tests: synthetic Ver121 headers, read-size spy, refusals, ordering, rerun identity, `main`, and the committed census checked against the committed lock
- `STATUS.md` - ui line now gives the census counts
- `.planning/OVERNIGHT-DECISIONS.md` - rows 170 and 171

## Decisions Made

- Row 170: `referenceTreeLockSha256` is added to the census shape, so each row's source lock is recorded. The committed-census test fails if the lock moves without a rerun.
- Row 171: UI-02 stays Pending. This plan is only an input to it.

## Deviations from Plan

### Clarifications

**1. The guard hashes each read package once.** The plan truth says no file is hashed "beyond the guard's stat check". On a lock-checked root (`E:/Lineage2-client` on DATABASE-PC), `require_equal_file` checks size and sha256 against the lock and caches the digest per size and mtime. So each of the 48 packages is hashed once by the sanctioned guard. The census code itself reads only 128 bytes per package and never hashes the tree. The read-size spy test proves the census read. The guard was not changed (it is not in this plan's ownership).

**2. BelowNormal priority not applied.** This session's shell refuses PowerShell commands, so the `PriorityClass='BelowNormal'` prefix could not be used. The full `test_pipeline.py` run (73 s) and the two census runs ran at normal priority. DATABASE-PC has no relay window.

**Total deviations:** 0 auto-fixed, 2 clarifications. **Impact:** none on outputs.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_texture_package_census.py"`: 15 tests OK.
- Tracer on real bytes: `systextures/L2UI_CH3.utx` gives `{packageVersion: 118, licensee: 0, reviewed: false, reason: texture-licensee-unsupported:118/0}`.
- `python -B scripts/data/texture_package_census.py --client E:/Lineage2-client` then `git diff --exit-code docs/parts/ui/texture-package-census.json`: identical (48 packages, 28 reviewed).
- `python -B scripts/test_pipeline.py` (what `pnpm test:pipeline` runs): 1101 tests OK, 107 skipped.
- `node scripts/check-lane-ownership.mjs --base aebdf4b --part ui`: `lane data-ui: 0 foreign paths`.
- `wc -l < scripts/data/texture_package_census.py`: 151.
- Self-contained wording grep over the new files: no matches.

## Process cleanup

This plan started only foreground `python` and `node` processes, and each one exited before the next step. Nothing listens on 5175, and no dev server, Vite, Playwright or Vitest process was started. One `python.exe` (PID 29876) was already running, from 21:43 on a previous day. This plan did not start it and left it alone.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

- 02-19 can quote the census table above in `docs/parts/ui/EVIDENCE.md`.
- 02-20 (StatusWnd) and 02-50 (minimap) now know that L2UI_CH3, l2ui, L2_RadarMap and town_map are not on reviewed texture reader versions. They must state a gap or use a UModel route that does not depend on that reader.

## Self-Check: PASSED

- FOUND: scripts/data/texture_package_census.py, docs/parts/ui/texture-package-census.json, tests/pipeline/test_texture_package_census.py
- FOUND: d9941e5, 5a48d30 on HEAD

---
*Phase: 02-stage-a-breadth*
*Completed: 2026-11-08*
