---
phase: 02-stage-a-breadth
plan: 38
subsystem: ui
tags: [ui-02, ui-03, native-windows, window-registry, control-types, gap-rows, dec-own-10, playwright, load-sweep]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-20 renderer, layer, loader and textures step; 02-23 windows load-sweep spec; 02-35 window picker and catalog key choice; 02-37 runtime host and window layer on the native route"
provides:
  - "buildNativeWindowRegistry and NativeWindowRegistryEntry (src/ui/nativeWindows/nativeWindowRegistry.ts)"
  - "recipes/data/native-window-control-types.json, the declared rendered control types"
  - "scripts/data/window_control_gaps.py: window_control_gap_rows, read_rendered_control_types, convert_window_controls; convert_ui.py --step controls; ledger step controls; gap-rows/controls.json"
  - "NativeWindowLayer.presentation (overflow hidden)"
  - "tests/unit/nativeWindowStyleSources.test.ts (DEC-OWN-10 scan) and tests/browser/native-window-layout.spec.ts (UI-03 viewports)"
affects: [02-51, 02-55]

actuals:
  tokens: 12500
  tasks: 3
  commits: 3
plan_head_before: b60bc74fdd692e872fe454b4f0c440c2a52594a3
plan_head_after: 6013fe4

tech-stack:
  added: []
  patterns:
    - "A declared recipe list with an agreement test against the code constant that uses it"
    - "One gap row per key and step, the full per-control list in the unit's evidence file"
    - "A pure source scanner proven red on synthetic violating sources inside the same test"

key-files:
  created:
    - src/ui/nativeWindows/nativeWindowRegistry.ts
    - recipes/data/native-window-control-types.json
    - scripts/data/window_control_gaps.py
    - tests/unit/nativeWindowRegistry.test.ts
    - tests/unit/nativeWindowStyleSources.test.ts
    - tests/pipeline/test_window_control_gaps.py
    - tests/support/sourceStringLiterals.ts
    - tests/browser/native-window-layout.spec.ts
  modified:
    - src/ui/nativeWindows/nativeWindowLayer.ts
    - src/ui/devSheet/windowPicker.ts
    - src/ui/devSheet/tilePicker.ts
    - src/ui/devSheet/sandboxPickerControls.ts
    - scripts/data/convert_ui.py
    - scripts/native_store/gap_census.py
    - tests/unit/nativeWindowRenderer.test.ts
    - tests/unit/devSheetPickerActions.test.ts
    - tests/unit/sandboxCoverageNotes.test.ts
    - tests/pipeline/test_gap_census.py
    - docs/parts/ui/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Row 558: the rendered control types are declared in recipes/data/native-window-control-types.json with an agreement test against nativeWindowRenderedControlTypes"
  - "Row 559: the window layer clips with overflow hidden and reports it as a presentation variable"
  - "Row 560: ledger step controls writes one gap row per window naming its first unsupported control; control-gaps.json lists every one"
  - "Row 561: controls joins GAP_CENSUS_STEP_ORDER between layout and textures (one foreign integration path)"
  - "Row 562: a pending census window is not-in-catalog in the registry; gap and failed rows stay gap"
  - "Row 563: the tracer is AbnormalStatusWnd (StatusIcon, StatusIconCtrl)"
  - "Row 564: a second textures slice sealed all 248 windows, 0 pending"
  - "Row 565: attachSandboxCatalogKeyChoice takes entries and an empty text; the window picker lists through the registry"
  - "Row 566: UI-02 and UI-03 complete"

requirements-completed: [UI-02, UI-03]

metrics:
  duration: 40min
  completed: 2026-11-10
---

# Phase 2 Plan 38: Window registry and UI-03 summary

**`buildNativeWindowRegistry` lists all 248 catalog windows with status and reason, ordered by base name and then by ordinal as a number. The Sandbox window picker lists only through it, and any window opens by id on `/`. `convert_ui.py --step controls` sealed every window: 111 windows have 462 controls of 26 types that the renderer does not draw, and each is a visible `data-native-gap` and a `controls` gap row. The textures step sealed all 248 windows, with 4 references converted. A source scan proves `src/ui/nativeWindows` has no custom styling. StatusWnd and AbnormalStatusWnd open at their decoded sizes at 1440 x 900 and 932 x 430, with no horizontal scroll at 430 x 932. A windows sweep slice recorded 20 passes.**

## Performance

- Started 2026-11-09T22:33Z (00:33 Riga), completed about 23:13Z (01:13 Riga)
- Tasks: 3 of 3
- Files: 8 created, 14 modified

## Accomplishments

- Task 1 (tracer): `recipes/data/native-window-control-types.json` declares Window, Texture, Button and TextBox. `window_control_gap_rows` walks the manifest tree in source order. `convert_window_controls` seals step `controls` per window. `convert_ui.py --step controls` takes `--window` or `--batch windows --limit`, and it reads only the lane-store manifests, after checking each SHA-256, byte length and window id. `buildNativeWindowRegistry` checks that every key round-trips through `windowCatalogKey`. The window picker gets its options and its `no windows converted` note from the registry. The tracer is `AbnormalStatusWnd`, the first root in census source order with an unsupported type (`StatusIcon`, `StatusIconCtrl`). Its controls step wrote the row `control-type-unsupported:StatusIconCtrl`, object `AbnormalStatusWnd.StatusIcon`. Its textures step gives 4 texture gaps. The 1440 x 900 browser case passed before Task 2 started, so the tracer gate held.
- Task 2: the agreement test replaces the hard-coded type list in `nativeWindowRenderer.test.ts`. `nativeWindowStyleSources.test.ts` runs a pure scanner against 19 synthetic violating sources (all red), one clean source (green) and every module of `src/ui/nativeWindows` (green). The layer sets `overflow: hidden` and returns `presentation`. Slices:
  - Controls: `--batch windows --limit 400` sealed 248 of 248 windows. 111 windows have gap rows.
  - Textures: `--limit 40` sealed 41 windows (40 plus StatusWnd from 02-20). A second slice, `--limit 248`, sealed all 248, so 0 are pending.
  - Texture references: 4 of 1,094 converted (`Default.BlackTexture`, `Icon.skill_i.skill1313`, `Icon.skill_i.skill1314`, `town_map.icon_i00`). 918 are `decode-failed:FormatError` (UE2 118), 145 are `texture-reference-unresolved` and 27 are `decode-failed:ValueError`. 199 windows keep a `textures` gap row.
  - The texture recipe `recipes/data/ui-textures.json` regenerated byte-identical.
- Task 3: `native-window-layout.spec.ts` runs at 1440 x 900, at 932 x 430 with `isMobile` and `hasTouch`, and at 430 x 932 with both windows and the sheet open. It ran 3 of 3 passed. The windows sweep slice recorded 20 pass and 0 failed for the served lane catalog `65a042ef...`. The evidence doc is 11,136 bytes.

## Task commits

1. Task 1 (tracer): `b327f8f` feat(02-38): list catalog windows through a registry, record unsupported control types as controls gap rows and open the AbnormalStatusWnd tracer from the sheet
2. Task 2: `68150b4` feat(02-38): seal controls and textures for every root window, prove the declared control types and scan native windows for custom styling
3. Task 3: `6013fe4` test(02-38): check native windows at 932 x 430, 430 x 932 and 1440 x 900, record a windows load-sweep slice and update the ui evidence

## Edge cases

- UI-02 adjacency: `Back2#1` and `Back2#2` are separate registry entries. The registry test covers this, and the sweep opened both.
- UI-02 empty: a catalog without windows gives an empty registry, and the picker shows `no windows converted` instead of a select. A census window absent from the catalog (a pending coverage row) shows `not-in-catalog` with its reason.
- UI-02 encoding: ids are compared exactly, including case. The `#` ordinal stays in the id and the key. The sweep spec URL-encodes the id with `encodeURIComponent`, and the layout spec builds attribute selectors with `JSON.stringify`.
- UI-02 ordering: base names compare in code point order (`NameB` before `Name_Two` before `name`), then ordinals as numbers (`Name#2` before `Name#10`). The picker test checks the registry order.

## Verification

- `node scripts/check-machine-schedule.mjs` printed `activeWindow: null` before every run.
- `pnpm typecheck` was clean after each task.
- Targeted Vitest: `nativeWindowRegistry`, `devSheetPickers`, `devSheetPickerActions` and `devSheetSourceRules` (96 passed). `nativeWindowStyleSources`, `nativeWindowRenderer`, `mountSandboxWindowLayer` and `sandboxRuntimeActions` (47 passed).
- Pipeline: `test_window_control_gaps.py` 8 OK, `test_gap_census.py` 19 OK, `test_ui_texture_step.py` 8 OK.
- Full `pnpm test:unit` (01:09 Riga): 171 files passed, 4 skipped; 2,340 tests passed, 72 skipped, 0 failed.
- Full `python -B scripts/test_pipeline.py` (01:03 Riga): 1,707 tests OK, 61 skipped.
- Browser checks ran with port 5173 free, headless SwiftShader, no FPS claim:
  - `NATIVE_STORE_ROOT=data-ui pnpm test:e2e tests/browser/native-window-layout.spec.ts`: 1 passed after Task 1, then 3 passed after Task 3.
  - `LOAD_CHECK_KIND=windows LOAD_CHECK_LIMIT=20 NATIVE_STORE_ROOT=data-ui pnpm test:e2e tests/browser/load-sweep-windows.spec.ts`: 1 passed, 20 window keys recorded pass in `artifacts/lane-store/data-ui/load-checks/65a042efc207ab7b17368bdfa77011d37357dfbd21f8fc43bbca7b93c6bebba3.json`.
- Screenshots: `artifacts/ui-evidence/native-windows-1440x900.png` and `artifacts/ui-evidence/native-windows-932x430.png`. The windows show no skin because their textures are gaps. The DOM assertions carry the size and gap checks.
- No browser check was skipped, so `artifacts/ui-evidence/02-38-e2e-unverified.log` does not exist and no spec is unverified.
- Lane ownership after the last code commit:

```
$ node scripts/check-lane-ownership.mjs --base b60bc74 --part ui
lane data-ui: 1 foreign paths
scripts/native_store/gap_census.py
exit=1
```

  Accepted in row 561. It is the one-word step-order addition the coverage census needs.
- Reference overlap: no DEC-OWN-12 area (materials, bsp-visibility, movement, particles, network) covers `src/ui` or `scripts/data`, so no run applies.
- The self-contained repo name check (DEC-OWN-11) is empty for everything this plan wrote. Every touched file has no comments, and every file is under 400 lines.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The coverage census refused the new step**
- Found during: Task 1.
- Issue: `GAP_CENSUS_STEP_ORDER` in `scripts/native_store/gap_census.py` (integration lane) has no `controls` step, so the coverage refresh at the end of `convert_ui.py` would fail.
- Fix: `controls` was added between `layout` and `textures`, and the census test now lists it (row 561).
- Commit: `b327f8f`.

**2. [Rule 3 - Blocking] One gap row per key and step**
- Found during: Task 1.
- Issue: the plan asks for one gap row per unsupported control, but `write_gap_rows` refuses a repeated key within one step. This is the same contract as 02-20 row 272.
- Fix: one `controls` row per window names its first unsupported control. `work/window__<id>/controls/control-gaps.json` lists every control (row 560).
- Commit: `b327f8f`.

**3. [Rule 1 - Bug] Picker order in the coverage-notes test**
- Found during: Task 3, full `pnpm test:unit`.
- Issue: `sandboxCoverageNotes.test.ts` expected catalog insertion order. The picker now lists in registry order.
- Fix: the case expects the registry order.
- Commit: `6013fe4`.

### Other adjustments

- Two adjustments widened the picker API:
  - `attachSandboxCatalogKeyChoice` takes `entries` and `emptyText`. The tile picker builds its entries with the new `catalogKeyChoiceEntries` (row 565).
  - The string-literal reader moved to `tests/support/sourceStringLiterals.ts`, so the renderer test and the style scan share one copy.
- The textures step ran a second slice to cover all 248 windows (row 564).
- `tdd="true"` on Task 2: the tests went into the same commit as the code. Before the commit, the style scan was red on the real folder until its image-path rule was anchored, which avoided a false hit on the loader's own `/l2/` path pattern.

**Total deviations:** 3 auto-fixed. **Impact:** gap rows keep the 02-02 contract. No output was weakened.

## Requirements

- UI-02: complete (row 566). 02-38 is the last plan that declares it.
- UI-03: complete (row 566).

## Decisions logged

Rows 558 to 566 in `.planning/OVERNIGHT-DECISIONS.md`.

## Known Stubs

None. The unsupported controls, unconverted textures and unresolved labels are explicit gap markers and gap rows.

## Threat Flags

None beyond the plan's register. T-02-38-01: the loader checks are unchanged, and `decoded_window_manifests_with_records` checks SHA-256, length and window id. T-02-38-02: ids must round-trip through `windowCatalogKey`, and are URL-encoded and selector-escaped in tests. T-02-38-03: the textures slices ran only through the guarded `Converter` into the lane root. T-02-38-04: loads count only from the 20 records pinned to `65a042ef...`.

## Needs Human

- Restage line added to `.planning/STATE.md`: `Needs Human (plan 02-38)` with the merge command that `python -B scripts/native_store/write_lane_catalog.py --lane data-ui --plan` printed (data-ui lane catalog `65a042ef...`).

## Open follow-ups

None new. Later sweep slices continue on the 228 windows that have no load-check record.

## Process cleanup

This plan started foreground tsc, Vitest, Python and UModel runs, plus three Playwright runs. Each Playwright run started its own Vite web server on 5173 and stopped it on exit. Nothing ran in the background. After the last run, `netstat -ano | grep LISTENING | grep -E ':(5173|5175) '` printed nothing. `ps -W` showed no Chrome, headless shell, Playwright, esbuild or UModel process. The only node and python processes were from Oct 29 and Nov 7 (WINPID 5700, 5704, 25728, 29876), none started by this plan. The PowerShell `Get-CimInstance` check was refused by the session sandbox.

## Self-Check: PASSED

- Created files exist: `src/ui/nativeWindows/nativeWindowRegistry.ts`, `recipes/data/native-window-control-types.json`, `scripts/data/window_control_gaps.py`, `tests/unit/nativeWindowRegistry.test.ts`, `tests/unit/nativeWindowStyleSources.test.ts`, `tests/pipeline/test_window_control_gaps.py`, `tests/support/sourceStringLiterals.ts`, `tests/browser/native-window-layout.spec.ts`, and both screenshots.
- Commits `b327f8f`, `68150b4` and `6013fe4` are ancestors of HEAD.
