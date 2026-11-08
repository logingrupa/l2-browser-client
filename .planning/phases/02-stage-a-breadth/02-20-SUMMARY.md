---
phase: 02-stage-a-breadth
plan: 20
subsystem: ui
tags: [native-windows, anchors, statuswnd, playwright, lane-store, converter, gap-rows]

requires:
  - phase: 02-stage-a-breadth
    provides: "02-19 window manifests and parseNativeWindowManifest, 02-05 catalog windows and textures slices, 02-06 NATIVE_STORE_ROOT and load-check records, 02-18 texture package census, 02-02 gap rows and unit ledger"
  - phase: 01-foundations
    provides: "01-14 sandbox NativeSliceAdapter set-health"
provides:
  - "src/ui/nativeWindows/nativeWindowAnchors.ts: resolveNativeWindowRectangles, nativeWindowAnchorPointFractions, nativeWindowAnchorEvidence, nativeWindowAnchorProof"
  - "src/ui/nativeWindows/nativeWindowRenderer.ts: renderNativeWindow, nativeWindowRenderedControlTypes"
  - "src/ui/nativeWindows/nativeWindowManifestLoader.ts: loadNativeWindowManifest, resolveNativeWindowTextures, revokeNativeWindowTextures"
  - "src/ui/nativeWindows/nativeWindowLayer.ts: createNativeWindowLayer with open, refresh, close, openWindowIds, dispose"
  - "src/ui/nativeWindows/nativeWindowFieldBindings.ts: readNativeWindowFieldBindings over recipes/data/window-field-bindings.json"
  - "scripts/data/ui_texture_step.py and convert_ui.py --step textures; recipes/data/ui-textures.json (generated); recipes/data/gap-reasons.json (data-ui list v1)"
  - "Harness tests/browser/harness/native-window.html?window=<id> with window.__nativeWindowHarness {result, setHealth}"
affects: [02-25, 02-26, 02-37, 02-38, 02-51]

actuals:
  tokens: 27650
  tasks: 3
  commits: 3
plan_head_before: a2f58350795aa797065e8165d0b1d3ea3ebfa64e
plan_head_after: 92e27d228ae6e8371dbd74d654489b59fb333b2f

tech-stack:
  added: []
  patterns:
    - "Committed browser recipe read through a Vite ?raw import and validated with guard clauses"
    - "One gap row per key and step; per-reference outcomes in the unit's evidence file"
    - "Playwright serial describe with an afterAll load-check record written from the recorded failures"

key-files:
  created:
    - src/ui/nativeWindows/nativeWindowAnchors.ts
    - src/ui/nativeWindows/nativeWindowRenderer.ts
    - src/ui/nativeWindows/nativeWindowManifestLoader.ts
    - src/ui/nativeWindows/nativeWindowLayer.ts
    - src/ui/nativeWindows/nativeWindowFieldBindings.ts
    - recipes/data/window-field-bindings.json
    - recipes/data/gap-reasons.json
    - recipes/data/ui-textures.json
    - scripts/data/ui_texture_step.py
    - tests/browser/harness/native-window.html
    - tests/browser/harness/nativeWindowHarness.ts
    - tests/browser/native-window-statuswnd.spec.ts
    - tests/unit/nativeWindowAnchors.test.ts
    - tests/unit/nativeWindowRenderer.test.ts
    - tests/unit/nativeWindowFieldBindings.test.ts
    - tests/pipeline/test_ui_texture_step.py
  modified:
    - src/ui/nativeWindows/nativeWindowLayoutTree.ts
    - tests/unit/nativeWindowLayoutTree.test.ts
    - scripts/data/convert_ui.py
    - scripts/data/lane_unit_outcomes.py
    - scripts/data/texture_package_census.py
    - docs/parts/ui/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/phases/02-stage-a-breadth/deferred-items.md

key-decisions:
  - "Row 268: CP and MP are adapter-field-absent gaps with no fill, gap rows in steps field-cp and field-mp (DEC-OWN-10)"
  - "Row 269: the field binding lives in recipes/data/window-field-bindings.json, read through ?raw, unverified, each row citing a pinned Elbera line"
  - "Row 270: the Converter owns UI texture policy; StatusWnd's 19 L2UI_CH3 references are decode-failed:FormatError, no second texture path"
  - "Row 271: the anchor resolver starts each control at its parent's left and top; no-position and no-size are anchor-unresolved gaps"
  - "Row 272: one textures gap row per window naming the first failing reference, every outcome in texture-outcomes.json"
  - "Row 273: nativeWindowAnchorProof moves into nativeWindowAnchors.ts"
  - "Row 274: the layer's open takes no signal; its lifetime signal aborts loads on dispose"
  - "Row 275: ui-textures.json rows add packageSha256 and reason"
  - "Row 276: UI-02 stays Pending until 02-38"

requirements-completed: []

duration: 30min
completed: 2026-11-09
status: complete
---

# Phase 2 Plan 20: UI tracer window:StatusWnd Summary

**StatusWnd renders from its decoded `interface.xdat` manifest on the harness page served from the data-ui lane store. Every control is placed by the unverified Elbera anchor resolver. HP is a fill clipped to `Math.trunc(width * health / maximumHealth)` from the `NativeSliceAdapter` local player. CP and MP are `adapter-field-absent` gaps and labels are `label-unresolved`. All 19 StatusWnd textures are `decode-failed:FormatError` gaps, because the Converter's package reader refuses UE2 118 (L2UI_CH3). The browser check passed at 1440 x 900 and 932 x 430, with no horizontal scroll at 430 x 932, and wrote a `window:StatusWnd` pass load check.**

## Performance

- **Duration:** about 30 min
- **Started:** 2026-11-08T23:12:13Z
- **Completed:** 2026-11-08T23:42:00Z
- **Tasks:** 3 of 3
- **Files modified:** 26

## Accomplishments

- `resolveNativeWindowRectangles(root, screen)` places each node at its parent's left and top, then applies `left += offsetX - selfPointX + targetPointX` (the same for top), with each anchor point truncated toward zero. It takes the nine enum rows from the pinned `docs/native-layout-evidence.md`. A Vitest case hashes that document (`424f80d1...`) and compares its table byte for byte. Relative sizes are `Math.trunc(rate * reference + offset)`. Gaps: `zero-anchor-enum`, `no-position`, `no-size`, `target-missing`, `target-ambiguous`, `cycle`. Named targets are compared byte-exact within the window.
- `renderNativeWindow` creates one absolutely positioned div per node in source order. Each div has `data-native-control` and `data-native-type`, and the root has `data-native-window`. Inline styles are only position, left, top, width and height in px. The renderer draws the first resolved texture as an `img`, draws a bound gauge fill and marks gaps in a space-separated `data-native-gap`. It never writes manifest text into the DOM.
- `loadNativeWindowManifest` checks the windows record, byte length, SHA-256 and window id before parsing. `resolveNativeWindowTextures` checks `ui-texture:<reference>` records, image path, length and SHA-256 before it creates object URLs. Missing records give `texture-not-in-catalog`.
- `createNativeWindowLayer` brings an open window forward instead of copying it, shares loads in flight, and revokes every object URL on `close` and `dispose`.
- `convert_ui.py --step textures` regenerates `recipes/data/ui-textures.json` (1,094 references, sorted, byte-identical on rerun). It then converts each reference of the selected windows through one guarded `Converter` per run. The StatusWnd unit is sealed, and a rerun prints `skipped-sealed`.

## Task Commits

1. **Task 1 (tracer): StatusWnd from manifest to screen with HP from the adapter** - `eccdea4` (feat)
2. **Task 2: StatusWnd UI textures through the guarded converter, or texture gap rows** - `5cca5ab` (feat)
3. **Task 3: Playwright check at three viewports with a load-check record, the no-literal-names scan and evidence** - `92e27d2` (test)

**Plan metadata:** the docs commit with this SUMMARY, STATUS ui line, STATE Needs Human, OVERNIGHT-DECISIONS rows 268 to 276 and deferred-items.

## Files Created/Modified

- `src/ui/nativeWindows/nativeWindowAnchors.ts` (161 lines), `nativeWindowRenderer.ts` (168), `nativeWindowManifestLoader.ts` (95), `nativeWindowLayer.ts` (86), `nativeWindowFieldBindings.ts` (92). `nativeWindowLayoutTree.ts` now imports the anchor proof label.
- `recipes/data/window-field-bindings.json`: `HPBarTex` bound to `health`/`maximumHealth` with fill `L2UI_CH3.StatusWnd.StatusHPCenter_Gauge`. `CPBarTex` and `MPBarTex` carry `adapter-field-absent:cp` and `:mp`. The HP row cites Elbera `tools/xdat/parse_xdat.py` line 542 (`aeb7ebed...`). The CP and MP rows cite `docs/ui-port-handoff.md` line 96 (`ec0b3682...`).
- `recipes/data/gap-reasons.json`: listVersion 1 with `texture-reference-unresolved`, `texture-not-in-catalog`, `anchor-unresolved:<reason>`, `label-unresolved`.
- `scripts/data/ui_texture_step.py` (199 lines): `UI_TEXTURE_ALGORITHM_VERSION`, `ui_texture_requests`, `convert_window_textures`, `ui_texture_recipe_bytes`. `convert_ui.py` (207 lines) gains `--step textures`. `lane_unit_outcomes.replace_step_gap_row` and `texture_package_census.reference_tree_lock_sha256` are shared helpers.

## Decisions Made

Rows 268 to 276 of `.planning/OVERNIGHT-DECISIONS.md` (see key-decisions above).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The gap-row contract allows one row per key and step**
- **Found during:** Task 2
- **Issue:** The plan asks for a gap row per failing reference and per absent field on `window:StatusWnd`. `write_gap_rows` refuses a repeated key in one step, and the coverage report reads one row per step.
- **Fix:** One `textures` row names the first failing reference. `work/window__StatusWnd/textures/texture-outcomes.json` (its evidence) lists all 19 outcomes. CP and MP rows go to steps `field-cp` and `field-mp` (row 272).
- **Files modified:** scripts/data/ui_texture_step.py, scripts/data/lane_unit_outcomes.py
- **Commit:** 5cca5ab

**2. [Rule 2 - DRY] One owner for the anchor proof label and the lock SHA-256**
- **Found during:** Tasks 1 and 2
- **Issue:** The label was defined in `nativeWindowLayoutTree.ts`, and the census lock SHA-256 was computed inline.
- **Fix:** `nativeWindowAnchorProof` lives in `nativeWindowAnchors.ts`, and `reference_tree_lock_sha256` lives in `texture_package_census.py`. Both are imported where they are used.
- **Commits:** eccdea4, 5cca5ab

### Clarifications

- The texture conversion did not produce a single texture. A probe on `L2UI_CH3.StatusWnd.StatusHPCenter_Gauge` and the real run both stop in `native_catalog.ue2.Package`: "Package table adapter supports UE2 123/licensee0..31". The converted-record path is covered only by the fake-converter pipeline test.
- The screenshots show a blank page. StatusWnd has no converted skin, and the renderer adds no colour or styling (DEC-OWN-10). The DOM assertions carry the geometry and gauge checks.
- `convert_window_textures` takes two extra keyword arguments, `converter_identity` (implementation hash and UModel pin, part of the fingerprint) and `field_bindings_document`.
- `ui-textures.json` rows add `packageSha256` and `reason` (row 275).
- `layer.open(windowId)` takes no signal (row 274).
- Tests and implementation went into one commit per task, not separate RED and GREEN commits. The Task 2 tests were run before the real conversion.
- Playwright ran with `DEV_PORT=5175`, the plan's dev port. Both 5173 and 5175 were free before each run.
- The comment rule needed no work: every touched file had zero comment lines before and after.

**Total deviations:** 2 auto-fixed, 8 clarifications. **Impact:** gap rows keep the 02-02 contract; no output was weakened.

## Verification

- `pnpm typecheck`: clean.
- `pnpm vitest run tests/unit/nativeWindowAnchors.test.ts tests/unit/nativeWindowRenderer.test.ts tests/unit/nativeWindowLayoutTree.test.ts tests/unit/nativeWindowFieldBindings.test.ts`: 43 passed. The pinned evidence table case ran, it was not skipped.
- `python -B -m unittest discover -s tests/pipeline -p "test_ui_texture_step.py"`: 8 OK. `-p "test_gap_rows.py"`: 11 OK. `test_interface_layout_adapter.py` 23 OK, `test_convert_tables.py` 7 OK, `test_texture_package_census.py` 15 OK.
- `python -B scripts/data/convert_ui.py --step textures --client E:/Lineage2-client --window StatusWnd`: `{"converted": 0, "fieldGaps": 2, "status": "gap", "textureGaps": 19}`. The rerun printed `skipped-sealed`, and `recipes/data/ui-textures.json` SHA-256 stayed `3f71ac1d...a091a6`.
- `NATIVE_STORE_ROOT=data-ui DEV_PORT=5175 pnpm test:e2e tests/browser/native-window-statuswnd.spec.ts` (01:32 Riga, 5173 and 5175 free): 3 passed. These were 1440 x 900, 932 x 430 with `isMobile` and `hasTouch`, and the 430 x 932 no-scroll case. Screenshots: `artifacts/ui-evidence/statuswnd-1440x900.png` and `statuswnd-932x430.png`. Load check: `artifacts/lane-store/data-ui/load-checks/89aa9e6a142fbb2b044784e8b7088c13a7908cac3d4f3a116692646a1d13cb58.json`, `window:StatusWnd` pass. The run was headless SwiftShader, so there is no FPS claim.
- `python -B scripts/test_pipeline.py`: 1,326 tests OK, 105 skipped.
- `pnpm test:unit`: 1,781 passed, 15 failed, 82 skipped. Rerunning the 7 failing files alone leaves only the known `laneOwnership` adapter-dispatch evidence-size case (recorded under 02-12). The rest are parallel-load timeouts and the 2 known `nativeNpcProfiles` cases. This plan touched none of those files (deferred-items.md).
- `node scripts/check-lane-ownership.mjs --base a2f5835 --part ui`: `lane data-ui: 0 foreign paths`, exit 0.
- `wc -l src/ui/nativeWindows/*.ts`: every file is under 400 lines. `docs/parts/ui/EVIDENCE.md` is 6,885 bytes. `grep -c "unverified on IMPORTA 7c12fb6b" src/ui/nativeWindows/nativeWindowAnchors.ts` prints 1.

## Process cleanup

This plan started foreground `tsc`, `vitest` and `python` processes and two Playwright runs. Each Playwright run started its own `pnpm dev` web server on 5175 and stopped it on exit. Nothing ran in the background. Check after the last run: `netstat -ano | grep LISTENING | grep -E ':(5173|5175) '` prints nothing. `ps -W` shows only node processes from Oct 29 (WINPID 5700, 5704, 25728) and a python from Nov 7 (29876), none started by this plan, and no chrome, headless shell, esbuild or UModel process. The PowerShell `Get-CimInstance` check was refused by the session sandbox, as it was in 02-06.

## Known Stubs

None. The CP, MP, label and texture gaps are explicit gap markers and gap rows, not stubs.

## Threat Flags

None beyond the plan's register. T-02-20-01 (length and SHA-256 checks in the loader), T-02-20-02 (window id pattern, catalog paths through `nativeResourceUrl`), T-02-20-03 (no HTML sinks, renderer test), T-02-20-04 (only the guarded Converter) and T-02-20-05 (URL revocation on close and dispose) are covered.

## User Setup Required

None. The restage is a Needs Human line in STATE.md, owned by the integration thread. The lane catalog is unchanged at `89aa9e6a`.

## Next Phase Readiness

- 02-38 reuses `createNativeWindowLayer`, the renderer and the binding recipe for every window and adds the style source scan.
- StatusWnd gets a skin as soon as the Converter's package reader accepts UE2 118. Rerunning `convert_ui.py --step textures` then reconverts, because the converter implementation hash is part of the unit fingerprint.

## Self-Check: PASSED
