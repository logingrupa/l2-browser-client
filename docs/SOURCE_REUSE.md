# Source reuse and licences

Where this client's code and data come from and under which licence. Decisions and work order: [PROJECT.md](../.planning/PROJECT.md) (DEC-OWN-2, DEC-SRC-1) and [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- The native reference is IMPORTA-PC `C:/Lineage2-client`, a modified third-party Interlude client. Identity, Engine.dll hash and the E: guard: [NATIVE_CLIENT_AUDIT.md](NATIVE_CLIENT_AUDIT.md).
- Native files stay read-only. Converted output, native audio and captures stay in ignored `artifacts/` and `public/l2/`. No Lineage II content is committed or published.
- Lineage2Elbera is MIT, pinned at `12c9656e2f053b233ec3fd87056491a6a6da8b0c` ([reuse audit](LINEAGE2ELBERA_REUSE_AUDIT.md)). `scripts/vendor/lineage2elbera_bsp/` keeps its `LICENSE` and source hashes.
- DEC-SRC-1: no source or assets are copied from other workspaces or from projects without a redistribution licence.
- The pinned conversion tools in the ignored `.assets/native-tools/` are read by path and never committed or published: UModel build1590, UELib, the l2-editor `.dat` schemas at revision `f2a2cc16120dd8ffabd60255aaad59fa4d6b6f53` (with its `LICENSE`) and open-l2encdec at commit `6f33578252389dfac2824c0132ce1d015cff04e5` (with its `LICENSE`).
- The repo started from the Babylon.js Editor v5.5.3 Vanilla template (revision `e3fce2cea68c6a32fdbacbb4c5aa4e6a0f154db7`). Retained template files are modified: package management, strict checking and the application lifecycle changed; the example scene, sample bitmaps, example box behaviour and physics initialization are removed. `tests/editor/editorScript.test.ts` adapts Editor 5.5.3 `editor/src/tools/compile.ts`. These and Babylon.js are Apache-2.0 (`LICENSE`, `docs/licenses/`). The Editor is an optional viewer (DEC-OWN-8).
- `@fontsource-variable/cormorant-garamond` 5.3.0 ships in `src/` styles under SIL OFL 1.1.

## Open

- DEC-OWN-10 dropped Cormorant Garamond headings with the custom HUD direction. The owner decides whether the font stays (UI-03).

## Pointers

- [NATIVE_CLIENT_AUDIT.md](NATIVE_CLIENT_AUDIT.md), [NATIVE_BSP_FLOOR.md](NATIVE_BSP_FLOOR.md), [OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md).
- `LICENSE`, `docs/licenses/`, `scripts/vendor/lineage2elbera_bsp/SOURCE.json`.
