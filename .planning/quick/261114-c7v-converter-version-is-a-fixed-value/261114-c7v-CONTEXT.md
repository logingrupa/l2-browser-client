# Quick task 261114-c7v: the converter version is a fixed value, not a hash of source bytes - context

Locked decisions of the orchestrator (thread "Speed Up Asset Conversion Tools", 2026-11-14).

## Why

`implementation_hash()` (`scripts/native_assets.py:160-162`) hashes the bytes of 55 source files (`implementation_source_paths()`, lines 153-157). It is part of every converter request key and of the unit fingerprints of meshes, bsp, movers, minimap, items, NPC models, characters, actor sounds, skill roots and UI textures. One changed byte, a line ending flip under `core.autocrlf`, or a new file in `native_assets_lib` or `native_catalog` marks all of them stale. That is the only reason those files are frozen. The owner lifted the freeze on 2026-11-13 on one condition: nothing already converted is converted again.

## Measured facts

- The real store (roadmap worktree) holds 14,836 sealed receipts. Every converter hash in them is one value: `c4bf8e6cf5f61bddf65a35e6fb65f6af34199e0589b978930aeb92d2f15a2bd8` (6,729 receipts across 11 steps; listing in `C:/laragon/l2b-orchestration/pipeline-speed/results/real-store-fingerprint-inputs.json`).
- That value is the hash of the roadmap worktree's bytes (40 files CRLF, 15 LF). This lane (all LF) computes `0bb618007f0306489bbd2683a741e2c38f9eb73c02b6472bdb94cf59e29a38c0`.
- Other byte hashes exist and stay as they are: the nine profile tool pins (`native_actor_profiles.py:83-86`), the three skill tool files (`skill_effect_conversion.py:45`), `builderSha256` (`actor_sound_conversion.py:105`), the class-defaults helper and implementation hashes (`mover_class_defaults.py`), the `extract_ue_defaults.ps1` hash inside class evidence and character archives.

## Locked decisions

1. **One constant.** `implementation_hash()` returns a module constant of `scripts/native_assets.py` whose value is `c4bf8e6cf5f61bddf65a35e6fb65f6af34199e0589b978930aeb92d2f15a2bd8`. It no longer reads any file. The function keeps its name, because pinned files call it and may not change. The constant's name says it is the converter output version and that a person raises it only when converter outputs change.
2. **Only `scripts/native_assets.py` changes among the hashed or pinned files.** Check before editing that no other fingerprint hashes it (profile pins, skill tool files, builder, class-defaults). No other file of the 55 and no pinned file is touched.
3. **A guard keeps the discipline.** One new test computes a SHA-256 over the 55 source files with CRLF read as LF and compares it with a recorded value in the test's own data. When it differs the test fails with the way out: prove the outputs are unchanged by a byte comparison and update the recorded value, or raise the version. The guard value must be equal in an LF and a mixed CRLF checkout. `implementation_source_paths()` stays as the guard's file list.
4. **Tests that pin byte hashing change to pin the new rule:** the value is the constant, and editing a source file does not change it. The planner lists every such test (the investigation names `test_converter_implementation_hash.py`, `test_native_assets_source_cache.py:148-151`, `test_actor_sound_slice_bookkeeping.py:199-202`, `test_actor_sound_bundle_reseal.py:97-104`) and any test that depends on this checkout's own lane store being sealed under `0bb618...`.
5. **Docs, short:** `docs/OUTPUT_CONTRACT.md` (the lines that define `converterVersion` as the implementation hash) and `docs/BATCH_PIPELINE_SPEED.md` (the open item on the byte hash, and one short list of the files that other fingerprints still hash and that therefore stay untouched).
6. **Not in scope:** the other byte hashes, any converter improvement, any change of an output byte, `.planning/PROJECT.md` and the decision logs (the roadmap thread records the decision).

## Rulings of the orchestrator on the plan (2026-11-14, these win over the text above and over the plan)

- R1: allow. The two tests of `ConversionClientDiagnosticSlotTests` may convert their two static meshes into this checkout's `artifacts/lane-store/integration/work/diagnostic-slots` during the whole suite. They did the same under the old value; it is this lane's own store. No skip is added. The summary names the two new request folders.
- R2: accepted. The old `native_batch.py` route (`adapter_pins`) stays as it is and is listed in the docs as still hashed by bytes.
- R3: accepted. `test_actor_sound_bundle_reseal.py:97-104` does not change.
- R4: accepted. The count is 6,224 receipts across 11 steps; the suite must report the test count of HEAD plus the added tests.
- Docs wording: an edit or a line ending flip of a converter source unseals nothing through the converter version; the files in the list "still hashed by bytes elsewhere" still unseal their own units. That list names every byte hash the planner and checker found, the old routes included.
- The summary names every on-disk holder of the converter hash and says for each whether it was measured. The list also names the published archives under `<lane>/l2/<sha>/asset.l2asset` (their `asset.json` holds `converterVersion`, their `provenance.json` holds `converterSha256`) and the two converter caches of this checkout's world lane; nothing on the new route compares those members at read.

## Hard constraints

- No output byte, request key, fingerprint or receipt of the real store changes: with the constant in place every sealed unit there stays sealed.
- AGENTS.md code rules. `.md` files stay short.
- One heavy command at a time, BelowNormal priority (`python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py <command>`); the machine crashed on 2026-11-12 and 2026-11-13.
- Never write under the roadmap worktree. Tests write only into temporary folders.

## Tests the plan must require

- `implementation_hash()` equals the constant and stays equal after a source file of the 55 is changed in a temporary copy of the scripts tree (or by a patched file list), and after a line ending flip.
- The guard: equal for LF and CRLF copies of the same sources; fails with the stated message when one byte of content changes; its recorded value matches this checkout.
- A converter request key and a unit fingerprint built in a test equal the ones built before the change when the old hash is patched to the constant (the key formula itself did not change).
- The whole pipeline suite once at the end against the baseline `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261113-h7k.log` (2,571 tests, two known errors). Name every test that changes from pass to fail, skip or error because this checkout's own lane store was sealed under `0bb618...`, with the reason.

## Proof the orchestrator runs afterwards

Read only against the real store: with this lane's code, every converter hash recomputed for a sample of sealed units of each of the 11 steps equals the recorded one, and a count of units whose seal check fails for the converter hash is zero.
