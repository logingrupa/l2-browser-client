# l2lib investigation

Inspected 2026-11-07 at upstream commit `12c9656e2f053b233ec3fd87056491a6a6da8b0c` (HEAD checked). Upstream paths below are relative to `Lineage2Elbera-reference`; local paths are relative to `l2-browser-client`. Read upstream `AGENTS.md` and `LICENSE`: authored tool code is MIT, requiring its notice; the license explicitly excludes native game assets. No bundled third-party code occurs in this area.

## Inventory and actual purpose

All **20 filenames** were inventoried. The families are:

- Library/API: `__init__.py`, `ue2package.py`, `textures.py`, `l2dat.py`.
- Reflection/evidence helpers: `classdata.py`, `declarations.py`, `propertylayout.py`, `stringproperty.py`.
- Documentation: `README.md`.
- Tests/support: `tests/__init__.py`, `common.py`, `run_tests.py`, and `test_{ue2package,textures,l2dat,classdata,declarations,propertylayout,stringproperty,polys}.py`.

The directory is a Python offline parsing library, not a browser inspector, Babylon adapter, complete converter or native verifier. `tools/l2lib/ue2package.py:229` reads package tables; `:604`, `:728`, `:961` and `:1164` handle textures, skeletal material slots, Model and Polys records. `textures.py:224` produces RGBA8 and `:275` writes PNG. `l2dat.py:28` supplies binary primitives, not full table schemas. The reflection helpers recover saved declarations/default boundaries and calculate bounded linked layouts; they do not execute scripts or construct live class state (`classdata.py:152`, `declarations.py:141`, `propertylayout.py:376`).

Core readers use the standard library and accept bytes/package objects, returning Python records with selected hashes. Plaintext and protocol 121 are portable; other wrappers invoke the repository-relative `tools/bin/l2encdec`, including protocol 111 (`ue2package.py:123,1294,1323`). That path has no Windows executable discovery. Integration tests also require `umodel`, private package fixtures and, for DAT comparisons, `tools/dat/extract_charcreate.py` (`tests/common.py:13`, `tests/test_l2dat.py:13`). Both binaries, `tools/samples/t_aden.utx`, and upstream `assets/interlude/system/Engine.u` were absent at their expected paths. No dependencies were installed.

## Local overlap and reuse verdict

**Adapt narrowly: class/default evidence.** `read_class_default_prefix` and declaration/tree/field-chain readers are useful additions. They bound reads to each export, reject unsupported tokens, retain hashes, distinguish saved byte length from loaded script length, and follow linked fields rather than export order (`classdata.py:47,152`; `declarations.py:28,90,141`). Local `scripts/native_catalog/effects.py:264` still extracts authored defaults through pinned UELib/PowerShell and explicitly lacks individual default-property offsets. An adapter over local package tables could add exact boundary/declaration evidence without replacing the existing extractor. It must expose imports, names, superclass and qualified identities beyond today's BSP-only adapter (`scripts/native_bsp_floor.py:73`). File-123 admission and the restricted expression-token set remain material limits.

**Adapt: isolated string loading.** `stringproperty.py:13` preserves byte widening, embedded-NUL storage, UTF-16 surrogates and count-one clearing. Local `scripts/native_catalog/ue2.py:69,203` decodes strings using cp1252/strict UTF-16 and trims trailing NULs. A synthetic differential check confirmed byte `0x80` becomes code unit 128 upstream versus code point 8364 locally. This demonstrates a semantic discrepancy on authored input; it does not establish an affected native record. Retain raw payloads and qualify property-string semantics separately from package names and DAT strings.

**Reference only: generic package/material/DAT replacement.** Local `Package.properties` preserves ordered repeated tags, array indices, struct names, offsets and raw bytes (`scripts/native_catalog/ue2.py:168`). Upstream `read_properties` overwrites by name and discards array/struct metadata (`ue2package.py:444,482`); a synthetic indexed-field example returned one upstream entry versus two local records. Its general `body_reader` is not export-bounded (`:371`). `resolve_material` stops at imports and selects one diffuse chain (`:692`), while local `native_assets_lib/material_graph.py:28` preserves qualified cross-package graphs and defaults. Local `native_catalog/tables.py:71` already implements bounded Ver413 decoding without launching a binary.

**Retain existing reuse; defer expansion.** Selected Model readers are already pinned at this same commit in `scripts/vendor/lineage2elbera_bsp/SOURCE.json`. `read_polys` is a candidate when brush-local polygons become necessary, with distinct licensee gates (Model 21, Polys 22); older versions retain a heuristic (`ue2package.py:1147,1164`). `propertylayout` is an optional analysis aid, not a current rendering requirement: linked flags require explicit lifecycle/reference inputs. Texture decoders may serve comparison probes, but upstream G16-to-RGBA drops the low byte (`textures.py:197`); local `native_map.py:207,238` preserves 16-bit heights. Local `native_assets_lib/texture_mips.py:181` already preserves original mips and source metadata.

## Smallest proof and executed checks

A future proof should adapt one already-pinned file-123 class, recover prefix/declarations, then validate defaults through the exact export end using the local lossless tag reader. Require matching qualified references, explicit unsupported cases, unchanged raw hashes, and agreement with retained UELib authored defaults; do not replace its path before coverage is measured.

Executed from upstream `tools`: `python -B -m unittest l2lib.tests.test_classdata l2lib.tests.test_declarations l2lib.tests.test_propertylayout l2lib.tests.test_stringproperty l2lib.tests.test_polys` — **56 passed, zero skips**. Reviewed selected tests before execution. Two additional in-memory assertions confirmed the string and repeated-tag differences above. No native binary, private fixture, exporter, browser or full test battery ran. These establish synthetic parser/arithmetic behavior, not native source-record equality, rendered appearance or integrated runtime parity. Only this report was written.
