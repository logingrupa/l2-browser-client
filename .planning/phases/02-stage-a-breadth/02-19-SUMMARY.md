---
phase: 02-stage-a-breadth
plan: 19
subsystem: ui
tags: [python, xdat, elbera-adapter, lane-store, window-layout, typescript-parser, census]

requires:
  - phase: 02-stage-a-breadth
    provides: "02-01 store_paths, 02-02 unit_ledger and gap_rows, 02-03 catalog_writer, 02-04 validate_catalog_record('windows', record) and the native-window-layout v1 contract"
provides:
  - "scripts/data/pinned_elbera_module.py: load or locate an Elbera script only at its SHA-256 pin, side-effect-free top level, no bytecode"
  - "scripts/data/interface_layout_adapter.py: interface.xdat to per-root-window native-window-layout v1 manifests with hashed opaque tails and the duplicate-id rule"
  - "scripts/data/convert_ui.py --step layout: 248 sealed window:<windowId> units and windows records in the data-ui lane store"
  - "src/ui/nativeWindows/nativeWindowLayoutTree.ts: parseNativeWindowManifest browser guard parser"
  - "docs/parts/ui/interface-window-census.json: the committed window denominator (rootWindowCount 248, windows[].windowId keys) for 02-26"
  - "scripts/data/lane_unit_outcomes.py: lane unit seal, gap row and pinned manifest store helpers shared by convert_tables and convert_ui"
affects: [02-20, 02-26, 02-28, 02-38, 02-51]

actuals:
  tokens: 41000
  tasks: 3
  commits: 3
plan_head_before: b49d42ed2e068c571489c9bb59428c1f5aa10868
plan_head_after: 31b397c3aa0afa865703fa22b5bcbe65e24de61a

tech-stack:
  added: []
  patterns:
    - "Outside parser behind a pin: SHA-256 checked on the bytes read, AST top-level check, then exec of that same compiled AST in a spec_from_file_location module"
    - "Tree node to scan record pairing through the identity of a list the pinned parser copies by reference, with a one-to-one guard"
    - "Committed census at a fixed path, indent 1, sorted keys, final LF, written by the converter's full run"

key-files:
  created:
    - scripts/data/pinned_elbera_module.py
    - scripts/data/interface_layout_adapter.py
    - scripts/data/convert_ui.py
    - scripts/data/lane_unit_outcomes.py
    - src/ui/nativeWindows/nativeWindowLayoutTree.ts
    - tests/fixtures/xdat/synthetic_interface_xdat.py
    - tests/fixtures/xdat/synthetic-window-layout.json
    - tests/pipeline/test_pinned_elbera_module.py
    - tests/pipeline/test_interface_layout_adapter.py
    - tests/unit/nativeWindowLayoutTree.test.ts
    - docs/parts/ui/interface-window-census.json
  modified:
    - scripts/data/convert_tables.py
    - docs/parts/ui/EVIDENCE.md
    - .planning/REQUIREMENTS.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Row 232: build_tree nodes pair with scan records by the identity of the textures list, with a one-to-one guard"
  - "Row 233: depends_on 02-03 and 02-04 kept beside the index's 02-01 and 02-02"
  - "Row 234: the pinned loader executes the compiled AST of the hashed bytes instead of letting the loader re-read the file"
  - "Row 235: the lane unit outcome helpers move out of convert_tables into scripts/data/lane_unit_outcomes.py"
  - "Row 236: the Elbera interface.json cross-check is read unpinned with its SHA-256 recorded"
  - "Row 237: windows catalog capacity is the decoded root count; a full-run decode failure exits 1; the census is written on every run without --window"
  - "Row 238: the decoded counts are stated from the census; tests assert only 165; UI-01 marked Complete"

patterns-established:
  - "An Elbera adapter hands Elbera only bytes that passed require_equal_file and sets the module data_g itself; main and its flags are never called"

requirements-completed: [UI-01]

coverage:
  - id: D1
    description: "Pinned Elbera loader refuses a wrong SHA-256, a top-level call or non-main conditional, a path outside the root or with backslashes, and writes no __pycache__"
    requirement: UI-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_pinned_elbera_module.py#PinnedElberaModuleTests"
        status: pass
    human_judgment: false
  - id: D2
    description: "Adapter refuses bytes off the b5b37678 pin, pairs every node with one scan record, hashes every tail [offset, end), keeps children and roots in source order and applies the duplicate-id rule"
    requirement: UI-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_interface_layout_adapter.py#DecodeRefusalTests, SyntheticInterfaceLayoutTests, WindowIdentifierTests"
        status: pass
    human_judgment: false
  - id: D3
    description: "convert_ui seals window units, writes validated windows records, skips sealed units and seals decode failures as decode-failed gap rows"
    requirement: UI-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_interface_layout_adapter.py#ConvertWindowUnitTests"
        status: pass
      - kind: integration
        ref: "python -B scripts/data/convert_ui.py --step layout --client E:/Lineage2-client (248 decoded, rerun 248 skipped-sealed)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Committed census: declared 165, roots in source order, unique ids, repeated names, sorted control names, parser pin and an Elbera cross-check that never feeds the decoded counts"
    requirement: UI-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_interface_layout_adapter.py#CommittedInterfaceWindowCensusTests, ElberaCrossCheckRefusalTests"
        status: pass
    human_judgment: false
  - id: D5
    description: "parseNativeWindowManifest accepts literal, synthetic fixture and all 248 lane store manifests and rejects wrong kind, version, id, hash, tail range, anchor enum, texture reference, unknown fields, depth over 64 and more than 4096 nodes"
    requirement: UI-01
    verification:
      - kind: unit
        ref: "tests/unit/nativeWindowLayoutTree.test.ts"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-11-08
status: complete
---

# Phase 2 Plan 19: UI-01 interface.xdat layout tree Summary

**The lock-equal `system/interface.xdat` (`b5b37678...1b641`) decodes through the SHA-pinned Elbera `parse_xdat` (`aeb7ebed...`, commit 12c9656) into 248 sealed `native-window-layout` v1 manifests with hashed opaque tails. The committed census records 165 declared windows, 248 root records and 2,638 scanned records, and the browser parser accepts every manifest.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-11-08T21:19:45Z
- **Completed:** 2026-11-08T21:39:00Z
- **Tasks:** 3
- **Files modified:** 17

## Accomplishments

- `load_pinned_elbera_module` resolves the script under the Elbera root and checks the SHA-256 of the bytes it read. It refuses any top-level statement other than imports, definitions, assignments, a docstring and the main guard. It then runs that same compiled AST in a module named `pinned_elbera_parse_xdat_aeb7ebed22d6`. No `__pycache__` appears under the Elbera checkout.
- `decode_interface_layout` refuses bytes off the pin, sets `data_g`, calls `scan` and `build_tree` and pairs nodes with records one to one. `window_layout_manifest` keeps build_tree's node fields unchanged and adds `sourceOffset` and `tail {offset, end, sha256}` to every node.
- `python -B scripts/data/convert_ui.py --step layout --client E:/Lineage2-client` writes all 248 manifests and `windows` records into `artifacts/lane-store/data-ui/l2/` (largest manifest 99,733 bytes) and the census. A rerun skips all 248 sealed units, and the census and catalog are byte-identical. A regeneration of all 248 manifests from the decode matched the stored bytes.
- Decoded roots: 143 top-level records, 90 with an ambiguous parent and 15 with a missing parent (build_tree keeps them visible as roots). 39 root names repeat and get `<name>#<ordinal>` ids. StatusWnd is unique and holds `StatusLeftTex`, `StatusCenterTex`, `StatusRightTex`, `CPBarTex`, `HPBarTex`, `MPBarTex`, `UserInfo` and `StatusTexSize`.
- `parseNativeWindowManifest` guards kind, version, id rule and name match, hashes, offsets, tail ranges, anchors 0 to 9, texture references, the drawer, text layout and parent resolution shapes, unknown fields, depth 64 and 4,096 nodes. It also checks that `textureRefs` equals the tree's first-seen union.

## Task Commits

1. **Task 1: Decode interface.xdat through the pinned Elbera parser and write window:StatusWnd end to end** - `5a00d38` (feat)
2. **Task 2: Every root window, the duplicate-id rule and the committed window census** - `614d5d9` (feat)
3. **Task 3: Count verdict against the Elbera cross-check, UI evidence and the UI-01 text** - `31b397c` (feat)

**Plan metadata:** the docs commit with this SUMMARY, REQUIREMENTS UI-01, STATUS ui line, STATE Needs Human and OVERNIGHT-DECISIONS rows 232 to 238.

## Files Created/Modified

- `scripts/data/pinned_elbera_module.py` (79 lines): `ELBERA_ROOT`, `ELBERA_COMMIT`, `PinnedElberaModuleError`, `resolve_elbera_path`, `require_pinned_elbera_script`, `load_pinned_elbera_module`
- `scripts/data/interface_layout_adapter.py` (137 lines): pins, `decode_interface_layout`, `window_identifiers`, `window_layout_manifest`, `interface_window_census`, `elbera_interface_cross_check`, `interface_layout_json_bytes`
- `scripts/data/convert_ui.py` (156 lines): `--step layout`, `--client`, `--output`, `--elbera-root`, `--window` (repeatable) or `--batch windows --limit <n>`; `LAYOUT_ALGORITHM_VERSION = 1`
- `scripts/data/lane_unit_outcomes.py` (60 lines): shared seal, gap row and store write helpers
- `scripts/data/convert_tables.py`: now uses `lane_unit_outcomes` (no behaviour change; its 7 tests pass)
- `src/ui/nativeWindows/nativeWindowLayoutTree.ts` (294 lines): `parseNativeWindowManifest`, `NativeWindowManifest`, `NativeWindowNode`, `NativeWindowManifestError`
- `tests/fixtures/xdat/synthetic_interface_xdat.py` and `synthetic-window-layout.json`: synthetic xdat bytes in the Elbera test style, and the 5 manifests the adapter makes from them (`python -B tests/fixtures/xdat/synthetic_interface_xdat.py` regenerates it)
- `tests/pipeline/test_pinned_elbera_module.py` (6 tests), `tests/pipeline/test_interface_layout_adapter.py` (23 tests), `tests/unit/nativeWindowLayoutTree.test.ts` (24 tests)
- `docs/parts/ui/interface-window-census.json` (69,453 bytes) and `docs/parts/ui/EVIDENCE.md`

## Decisions Made

Rows 232 to 238 of `.planning/OVERNIGHT-DECISIONS.md` (see key-decisions above). The window denominator for 02-26 is `docs/parts/ui/interface-window-census.json`: `rootWindowCount` 248 and the keys `window:<windows[].windowId>`. `scripts/native_store/coverage_denominators.py` (integration) still reports ui as unknown until 02-26 reads that file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - DRY, AGENTS.md] Shared lane unit outcome helpers**
- **Found during:** Task 1
- **Issue:** convert_ui needed the same lane-relative path, gap row replacement, decode-failure seal and pinned manifest store write as convert_tables.
- **Fix:** Moved them into `scripts/data/lane_unit_outcomes.py`. Both converters use it, and the step and lane come from the ledger.
- **Files modified:** scripts/data/lane_unit_outcomes.py, scripts/data/convert_tables.py
- **Commit:** 5a00d38

**2. [Rule 2 - Security, T-02-19-01] Loader runs the hashed bytes**
- **Found during:** Task 1
- **Issue:** `spec.loader.exec_module` reads the file a second time after the SHA check.
- **Fix:** The module comes from `spec_from_file_location`, but its body is the compiled AST of the checked bytes.
- **Commit:** 5a00d38

### Clarifications

- `require_pinned_elbera_script` is a planned export (02-28) and is used only by tests in this plan. `resolve_elbera_path` is an added export, used for the cross-check file.
- The decoded counts equal Elbera's numbers for its own file (248 roots, 2,638 records). They are stated as decoded counts from the census. No test asserts 248 or 2,638 (`grep -cE` prints 0).
- The fixture regeneration test normalises CRLF to LF before it compares bytes, because `core.autocrlf` is true here. `git diff --exit-code tests/fixtures/xdat/synthetic-window-layout.json` is the strict check, and it is clean.
- 02-05's `windowCatalogKey` and the gap row and unit key patterns accept the `#<ordinal>` suffix, so no blocker for 02-05.

**Total deviations:** 2 auto-fixed, 4 clarifications. **Impact:** none on outputs.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_pinned_elbera_module.py"`: 6 OK. `-p "test_interface_layout_adapter.py"`: 23 OK.
- `python -B scripts/data/convert_ui.py --step layout --client E:/Lineage2-client --window StatusWnd`: decoded, catalog record SHA-256 equal to the manifest file. Full run: 248 decoded (StatusWnd skipped as sealed), census written. Rerun: 248 skipped-sealed, census and catalog SHA-256 unchanged.
- `git diff --exit-code tests/fixtures/xdat/synthetic-window-layout.json`: clean.
- `python -B scripts/test_pipeline.py`: 1,265 tests OK, 105 skipped.
- `pnpm typecheck`: clean. `pnpm vitest run tests/unit/nativeWindowLayoutTree.test.ts`: 24 passed.
- `pnpm test:unit`: 1,632 passed, 82 skipped, 2 failed. The failures are the recorded red baseline (`nativeNpcProfiles.test.ts`, deferred-items.md).
- `node scripts/check-lane-ownership.mjs --base b49d42e --part ui`: `lane data-ui: 0 foreign paths`.
- `wc -l`: every new Python and TypeScript file is under 400 lines. `docs/parts/ui/EVIDENCE.md` is under 30,000 bytes. `grep -c "248 top-level records" .planning/REQUIREMENTS.md` prints 0.
- `ls E:/Lineage2Elbera/tools/xdat`: only `parse_xdat.py` and `test_parse_xdat.py`, so no bytecode was written.

## Process cleanup

This plan started only foreground `python`, `node`, `tsc` and `vitest` processes. Each one exited before the next step, and no dev server, Vite preview, Playwright or browser was started. The check before the docs commit found no process with `autonomous-roadmap` in its command line that this plan started, and nothing listening on 5175.

## Issues Encountered

None.

## User Setup Required

None. The restage of the data-ui lane store (now with 248 `windows` records, lane catalog `89aa9e6a...`) is a Needs Human line in STATE.md, owned by the integration thread.

## Next Phase Readiness

- 02-20 reads `window:StatusWnd` from the lane store and `controlNames` from the census. StatusWnd's textures are in `L2UI_CH3` (118/0, not reviewed by the texture reader, see 02-18).
- 02-26 takes the windows denominator from the census.
- 02-28 reuses `load_pinned_elbera_module` for `tools/ui/check_hair_selection_native.py`.

## Self-Check: PASSED

- FOUND: every file listed under key-files
- FOUND: 5a00d38, 614d5d9, 31b397c on HEAD

---
*Phase: 02-stage-a-breadth*
*Completed: 2026-11-08*
