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

## Open

- UI-02: build windows from the manifests and fill them with sandbox data. StatusWnd tracer in 02-20, window registry in 02-38. StatusWnd's skin is in L2UI_CH3 (118/0), which the repo texture reader has not reviewed.
- UI-03: only the original Interlude interface, checked at 932 x 430 and 430 x 932.
- The lane store is not restaged into `public/l2` (integration thread, see STATE.md Needs Human).
- No browser load check yet: the windows coverage row is unverified.

## Evidence

- `docs/parts/ui/interface-window-census.json`: decoded counts, roots in source order with `windowId`, `name`, `type` and `sourceOffset`, repeated root names, sorted control names, parser pin and `elberaCrossCheck`.
- `docs/parts/ui/texture-package-census.json`: 02-18 texture package census.
- `tests/pipeline/test_interface_layout_adapter.py`: source pin, one-to-one node pairing, tail hashes, child order, duplicate-id rule, sealed units, decode gap rows, census and cross-check, fixture regeneration.
- `tests/pipeline/test_pinned_elbera_module.py`: SHA pin, top-level statement check, root confinement, no bytecode.
- `tests/unit/nativeWindowLayoutTree.test.ts`: parser guards, the synthetic fixture `tests/fixtures/xdat/synthetic-window-layout.json` and the lane store manifests.
