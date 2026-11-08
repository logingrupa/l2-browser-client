# UI framework and windows evidence

Part `ui`, lane `data-ui`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

- UI-01 layout tree (plan 02-19). `system/interface.xdat` is lock-equal, SHA-256 `b5b37678674162f3a19380e86fa357a44e330f99607504c927c41e3dcd31b641`. The adapter refuses any other bytes. The Elbera parser `tools/xdat/parse_xdat.py` (commit `12c9656`, SHA-256 `aeb7ebed22d68fdca8f8a9828c32620c01be4ca03623c4a020dc0fcbf2ea5409`) runs only through `scan` and `build_tree`, on bytes that already passed the reference client guard. Its `main`, `--check` and `--emit` paths are never called.
- Decoded counts, from the committed census: 165 declared windows (the file header), 248 root records and 2,638 scanned records. Of the 248 roots, 143 are top-level records. 90 have an ambiguous parent name and 15 have a missing parent, so `build_tree` keeps them as roots. 39 root names repeat. They get `<name>#<ordinal>` ids in source order.
- `python -B scripts/data/convert_ui.py --step layout --client E:/Lineage2-client` writes one `native-window-layout` v1 manifest and one `windows` catalog record per root into `artifacts/lane-store/data-ui/l2/`, each sealed as unit `window:<windowId>` (step `layout`). A rerun skips every sealed unit, and the census is byte-identical. A regeneration of all 248 manifests from the decode matched the stored bytes.
- Every node keeps the parser's header fields, its `sourceOffset` and `tail: {offset, end, sha256}`, the SHA-256 of exactly the source bytes `[offset, end)`. Type-dependent tails stay opaque.
- Anchors carry the label "Elbera NWindow af6c3437 proof, unverified on IMPORTA 7c12fb6b". Our `system/nwindow.dll` is lock class `differing`, so the anchor reading is not verified on this client.
- `parseNativeWindowManifest` (`src/ui/nativeWindows/nativeWindowLayoutTree.ts`) parses all 248 lane store manifests and the synthetic fixture.
- The Elbera cross-check is `assets/gamedata/interface.json`, made from a different `Interface.xdat` (`a7969a86...`). It reports 165 declared and 248 windows. It is recorded in the census as `elberaCrossCheck` and never feeds the decoded counts.
- Texture package census (plan 02-18): 48 lock-equal `systextures/*.utx` packages. 28 are on reviewed texture reader versions and 20 are `texture-licensee-unsupported`, among them L2UI_CH3, l2ui and L2_RadarMap at 118/0.

- UI-02 StatusWnd tracer (plan 02-20), browser check passed at 01:32 Riga on 2026-11-09 (headless SwiftShader, no FPS claim). The harness page `tests/browser/harness/native-window.html?window=StatusWnd`, served with `NATIVE_STORE_ROOT=data-ui`, renders the root at the decoded 256 x 92 and places every control with the anchor resolver `src/ui/nativeWindows/nativeWindowAnchors.ts`. The resolver follows the Elbera `docs/native-layout-evidence.md` (commit `12c9656`, SHA-256 `424f80d1...fea319`) and is labelled unverified. It starts each control at its parent's left and top, then applies `left += offsetX - selfPointX + targetPointX` with each point truncated toward zero. Relative heights are also unverified.
- HP: the gauge control `HPBarTex` draws a fill clipped to `Math.trunc(width * health / maximumHealth)` from the `NativeSliceAdapter` local player. The browser check sets health to 37 and reads the truncated width.
- CP and MP: `CPBarTex` and `MPBarTex` carry `adapter-field-absent:cp` and `adapter-field-absent:mp` and draw no fill. Every TextBox carries `label-unresolved` and draws no text. The adapter has no CP or MP field.
- The control-to-field binding is `recipes/data/window-field-bindings.json`, an unverified presentation mapping read through a Vite `?raw` import. Each row cites a pinned Elbera line by SHA-256 and excerpt. A Vitest scan finds no decoded window or control name as a string literal in `src/ui/nativeWindows/*.ts`. The one decoded name equal to a rendered control type, `TextBox`, is reported by the scan.
- Controls render in source order (DOM order). This is a presentation rule. The native draw order is unverified.
- Textures: `python -B scripts/data/convert_ui.py --step textures --client E:/Lineage2-client --window StatusWnd` sends every StatusWnd reference through the guarded `Converter`. All 19 fail with `decode-failed:FormatError`, because the repo package reader accepts only UE2 123 and L2UI_CH3 is 118/0. The run converts nothing and adds no `textures` record. `artifacts/lane-store/data-ui/gap-rows/textures.json` holds one row for `window:StatusWnd`. Its evidence file lists all 19 outcomes. `field-cp.json` and `field-mp.json` hold the CP and MP rows. A rerun skips the sealed unit, and `recipes/data/ui-textures.json` (1,094 references, generated) stays byte-identical.
- Load check: `artifacts/lane-store/data-ui/load-checks/89aa9e6a142fbb2b044784e8b7088c13a7908cac3d4f3a116692646a1d13cb58.json` holds `{key: window:StatusWnd, status: pass}` for the served lane catalog.

## Open

- UI-02: the window registry and every other window (02-38). StatusWnd shows no skin until the converter's package reader supports UE2 118 (L2UI_CH3, l2ui, L2_RadarMap). The screenshots therefore show empty positioned boxes.
- UI-03: only the original Interlude interface, checked at 932 x 430 and 430 x 932.
- The lane store is not restaged into `public/l2` (integration thread, see STATE.md Needs Human).
- Only window:StatusWnd has a load check. The other windows are unverified.

## Evidence

- `docs/parts/ui/interface-window-census.json`: decoded counts, roots in source order with `windowId`, `name`, `type` and `sourceOffset`, repeated root names, sorted control names, parser pin and `elberaCrossCheck`.
- `docs/parts/ui/texture-package-census.json`: 02-18 texture package census.
- `tests/pipeline/test_interface_layout_adapter.py`: source pin, one-to-one node pairing, tail hashes, child order, duplicate-id rule, sealed units, decode gap rows, census and cross-check, fixture regeneration.
- `tests/pipeline/test_pinned_elbera_module.py`: SHA pin, top-level statement check, root confinement, no bytecode.
- `tests/unit/nativeWindowLayoutTree.test.ts`: parser guards, the synthetic fixture `tests/fixtures/xdat/synthetic-window-layout.json` and the lane store manifests.
- `tests/unit/nativeWindowAnchors.test.ts`, `tests/unit/nativeWindowRenderer.test.ts`, `tests/unit/nativeWindowFieldBindings.test.ts`: anchor table and truncation, gaps, gauge fill, binding recipe and the no-literal-names scan.
- `tests/pipeline/test_ui_texture_step.py`: texture requests, package resolution, case variants, converted records, decode-failed and field gap rows, sealed rerun.
- `tests/browser/native-window-statuswnd.spec.ts`: 1440 x 900, 932 x 430 (`isMobile`, `hasTouch`) and the 430 x 932 portrait no-scroll case. Screenshots: `artifacts/ui-evidence/statuswnd-1440x900.png` and `artifacts/ui-evidence/statuswnd-932x430.png`.
