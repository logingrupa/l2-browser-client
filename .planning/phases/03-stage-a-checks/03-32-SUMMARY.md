---
phase: 03-stage-a-checks
plan: 32
subsystem: ui
tags: [ui, textbox, fonts, digit-atlas, bitmap-font, zone-name, gap-closure, rerun-chain]
status: complete
gap_closure: true
requires:
  - phase: 03-stage-a-checks
    provides: "03-22 zone sampler and NewRadarWnd texture choice; Q9 verified-fonts.md"
provides:
  - "convert_ui.py --step fonts (scripts/data/ui_font_step.py): one sealed ui-font unit per atlas font from recipes/data/ui-fonts.json"
  - "fonts catalog slice (writer, union, TS reader) with ui-font:<fontType> records"
  - "TextBoxes draw decoded default text with the converted client font, colour and align (nativeWindowFonts.ts, nativeWindowTextBox.ts)"
  - "NewRadarWnd zoneName and zoneNameShadow draw the sampled zone name (recipes/data/zone-name-text-boxes.json)"
affects: [03-35, 03-16, 03-17]
tech-stack:
  added: []
  patterns:
    - "A glyph is a positioned element: atlas as background and mask, decoded colour by CSS multiply (presentation label on the element)"
key-files:
  created:
    - scripts/data/ui_font_step.py
    - recipes/data/ui-fonts.json
    - recipes/data/zone-name-text-boxes.json
    - src/ui/nativeWindows/nativeWindowFonts.ts
    - src/ui/nativeWindows/nativeWindowTextBox.ts
    - src/ui/nativeWindows/zoneNameTextBoxRecipe.ts
    - tests/pipeline/test_ui_fonts.py
    - tests/unit/nativeWindowTextBox.test.ts
    - tests/browser/native-window-text.spec.ts
  modified:
    - scripts/data/convert_ui.py
    - scripts/native_store/catalog_writer.py
    - recipes/data/gap-reasons.json
    - src/assets/native/nativeCatalogRecords.ts
    - src/assets/native/readNativeCatalog.ts
    - src/ui/nativeWindows/nativeWindowRenderer.ts
    - src/ui/nativeWindows/nativeWindowLayer.ts
    - src/ui/nativeWindows/minimapControl.ts
    - tests/browser/native-window-statuswnd.spec.ts
    - tests/browser/world-minimap.spec.ts
key-decisions:
  - "Row 1220: TextBoxes whose default text is the XDAT sentinel \"undefined\" draw nothing and carry textbox-text-undefined-sentinel"
  - "Row 1221: fontType 0 and 1 draw with the L2Font-e bitmap fonts and list font-bitmap-branch-unconfirmed (GIsTrueFontUse open)"
requirements-completed: []
duration: 60min
completed: 2026-11-16
plan_head_before: caff9e5c576e15791e37592ec74cdf519cd36259
plan_head_after: 32995a4672c70d6d62c940a72b1d5527d72783b7
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
---

# Phase 3 Plan 32: TextBox labels with converted client fonts Summary

TextBoxes now draw their decoded text with fonts converted from the client. Q9 (verified-fonts.md) is answered, so the plan ran in full. Four fonts convert as sealed data-ui units: L2Font-e SmallFont-e and LargeFont-e with their .gly tables (fontType 0 and 1), and the NWindow.Number and XLargeNumber digit atlases (10 and 11). 89 of 837 TextBoxes draw text. Each of the other 748 names the reason it does not. `label-unresolved` is gone.

## TextBox outcome on union 06883731 (837 TextBoxes, 248 windows)

| Outcome | Count |
| --- | --- |
| drawn, fontType 0 (SmallFont-e) | 76 |
| drawn, fontType 1 (LargeFont-e) | 10 |
| drawn, fontType 10 (NWindow.Number) | 3 |
| `textbox-text-undefined-sentinel` | 388 |
| `textbox-text-set-at-runtime` (empty default text) | 316 |
| `font-gdi-face-unconverted:6` | 29 |
| `font-gdi-face-unconverted:7` | 5 |
| `font-gdi-face-unconverted:4` | 1 |
| `textbox-tail-unresolved` (the 9 tails the pinned parser misses) | 9 |

- Every drawn fontType 0 and 1 box also lists `font-bitmap-branch-unconfirmed` (row 1221).
- No fontType 11 box has literal text. Its 9 boxes are empty, and StatusWnd txtStatusLevel is one of them.
- The effective font is the stored value. The +0x80 default chain applies only to template records, and Q10 part 4 shows none of the 306 template records is a TextBox.
- The planning count of "512 with a defaultText" counted the 388 "undefined" sentinels. Only 124 TextBoxes hold literal text, and 89 of those draw.

## Screenshots (1440 x 900, headless SwiftShader, no FPS claim)

- `artifacts/ui-evidence/03-32-StatusWnd-desktop.png`: CP in the NWindow.Number digit atlas, #DCDCDC.
- `artifacts/ui-evidence/03-32-ItemEnchantWnd-desktop.png`: "100%" in LargeFont-e and "0" in SmallFont-e.
- The StatusWnd spec also rewrote `statuswnd-1440x900.png` and `statuswnd-932x430.png`.

## Re-run chain

1. Lane re-run: `convert_ui.py --step fonts --client E:/Lineage2-client --batch fonts --limit 4` exited 0 (4 converted). Free bytes went from 137,426,493,440 to 137,425,346,560. The tracer `--font-type 10` run went from 138,286,821,376 to 138,286,620,672. The first `--limit 3` batch sealed fonts 0 and 1 as gaps, because `L2Font-e` is ambiguous; this was fixed (see deviations).
2. Lane catalog: `write_lane_catalog.py --lane data-ui` exited 0 (catalog a1ed0880, fonts 4). The `--plan` run exited 0.
3. Union rebuild exited 0. The union catalog went from f081dc4c...7c6b to **068837314403f2f42148227b69daec41f7fc1ca8f8440b40ee0dcf52fbf69be3** (fonts 4, windows 248, 19 files written). Free bytes went from 137,416,392,704 to 137,253,634,048.
4. to 7. Not run: no touched keys. The union only adds the four `fonts` records, and these belong to no catalog key, so no key content digest changes. Window keys draw text now, but their digest is the window manifest SHA-256, which did not change. A sandbox half captured before this plan shows no text (follow-up).
- Browser check: `DEV_PORT=5181 NATIVE_STORE_ROOT=integration pnpm test:e2e tests/browser/native-window-statuswnd.spec.ts tests/browser/native-window-text.spec.ts` passed 5 of 5. Port 5181 was free before the run.

## Task commits

1. ab1c2cd: font step, fonts slice, TextBox renderer path and narrower reasons; fontType 10 converted as the tracer.
2. 99ed289: zone name through the GetLocInfo text boxes; minimap text gap dropped; reason list version 3 without `label-unresolved`.
3. 32995a4: package path fix, pending-count limit, font batch, and the union browser specs.

## Deviations from Plan

- **[Rule 1 - Bug] Ambiguous L2Font-e package (task 3).** `systextures/L2Font-e.utx` and `textures/L2Font-e.utx` are both lock-equal with different hashes, so a stem lookup refused. The step now resolves the recipe path that the Q9 report cites (systextures, 09233daa). `UI_FONT_ALGORITHM_VERSION` 2 reseals all four units. Commit 32995a4.
- **[Rule 1 - Bug] `--limit` counted sealed units (task 3).** A batch with `--limit` at the pending count skipped fontType 11. The limit now counts only units that are not skipped, as the layout step does.
- **[Rule 3] Lane ownership.** `scripts/native_store/catalog_writer.py` (integration) and `src/assets/native/nativeCatalogRecords.ts` and `readNativeCatalog.ts` (actors lane) carry the new `fonts` slice, the same way 03-25 carried `materialPrograms`. Task 1 ownership checks: `--part ui` flags those 3 paths and `--part adapter-dispatch` flags the data-ui paths. Tasks 2 and 3 have 0 foreign paths.
- **Tests after code (task 1).** The font step was written before `test_ui_fonts.py`, so there is no RED run for task 1.
- **Screenshot names.** The orchestrator wanted the `03-32-<window>-desktop.png` names, so a new spec writes them. The StatusWnd spec keeps its 02-20 names.
- **NewRadarWnd only.** MinimapWnd has no verified zone name text box (`minimap-binding` stays open). Its txtCurLoc and similar boxes keep `textbox-text-set-at-runtime`.

## Open questions for the orchestrator

- What does NCTextBox draw when the text FString is the XDAT sentinel "undefined"? Does a non-zero textId override it with the sysstring? This covers 388 boxes, 279 of them with a textId.
- What is the runtime GIsTrueFontUse and language branch on the reference client (Q9 unresolved)? It decides whether fontType 0 and 1 draw with the bitmap route.
- Types 4, 6 and 7 are GDI faces from TTFontInfo.ini. Can a GDI rasterization of vivo-medium.ttf and koi8.ttf (weight 600, -MulDiv(size, 96, 72)) be captured as reference glyphs, or should the client TTF files load through FontFace?
- The 20-byte .gly trailer is not read; its SHA-256 is recorded in each font manifest.
- PaintSingleLine alignment and autosize placement are not verified. The text offset (left, centre or right inside the control width) is labelled presentation.

## Open follow-ups

- The window side-by-side halves captured before this plan show no text. Re-capture the window keys on union 06883731 (03-16 or 03-17).
- `docs/parts/ui/EVIDENCE.md` still describes `label-unresolved` (lines 18, 31 and 37). Under GP7, 03-16, 03-19 or 03-20 update it.
- Alignment 4 (MacroEditWnd.txtMacroName, empty text) is not drawn per character. It needs no branch until such a box holds text.

## Process cleanup

- The Playwright `webServer` on 5181 stopped with the run. No listener remains on 5173, 5175 or 5181.
- No process has this worktree path in its command line. The union and batch processes exited 0.
- `print_fingerprint_inputs.py` is the same before and after: implementation c4bf8e6c...2bd8, umodel 13502e5a...64a0.
- The reference overlap review was not run per plan; the orchestrator runs it once per phase.

## Self-Check: PASSED

- Files exist: scripts/data/ui_font_step.py, recipes/data/ui-fonts.json, recipes/data/zone-name-text-boxes.json, src/ui/nativeWindows/nativeWindowFonts.ts, src/ui/nativeWindows/nativeWindowTextBox.ts, src/ui/nativeWindows/zoneNameTextBoxRecipe.ts, tests/pipeline/test_ui_fonts.py, tests/unit/nativeWindowTextBox.test.ts, tests/browser/native-window-text.spec.ts.
- Commits ab1c2cd, 99ed289 and 32995a4 are on HEAD.
- Gates: `test_ui_fonts.py` passes 9 tests. `nativeWindowTextBox`, `nativeWindowRenderer` and `minimapControl` vitest pass. `tsc --noEmit` is clean. The task 3 gate exits 0.
