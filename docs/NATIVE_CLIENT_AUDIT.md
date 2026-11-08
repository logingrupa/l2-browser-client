# Native client audit

Reference client identity, source formats, decoders and pinned tools. Folder counts and the 40 tables: [PORT_SCOPE.md section 2](PORT_SCOPE.md#2-what-the-client-contains); scrambling: [section 3](PORT_SCOPE.md#3-how-the-files-are-scrambled-and-decoded). Decisions and order: [.planning/PROJECT.md](../.planning/PROJECT.md), [.planning/ROADMAP.md](../.planning/ROADMAP.md).

## Now

- Reference: IMPORTA-PC `C:/Lineage2-client` (DEC-OWN-2), a modified third-party Mobius Interlude build. Engine.dll SHA-256 `4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`. `L2.exe` is a replacement launcher; its version does not identify the asset revision.
- `scripts/reference_client_guard.py` reads a client file only when `recipes/reference-client-tree.lock.json` classes it equal (FOUND-03). Only the lock's exact reference root on its reference host skips the lock; every other root and spelling (UNC, admin share, `\\?\` prefix, mapped drive) needs it. Results: [parts/data/EVIDENCE.md](parts/data/EVIDENCE.md).
- `recipes/native-inputs.lock.json` is input-only (DEC-OWN-5); its pinned closure: [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md). Output: [OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md).
- Catalog: `pnpm assets:catalog --client <root> --output <json>` hashes originals, records wrapper and package versions and writes a `.receipt.json` beside the output. `--package`, `--table`, `--table-source npcname=npcname-e.dat` add inputs; `--verify` rehashes without UModel. Integration thread only.
- `.dat`: the hash-pinned `06_interlude.xml` descriptor wins where it covers a table; Elbera fills gaps behind an adapter (DEC-OWN-4). No H5 or guessed later layouts. `decode_table(client, 'npcname', source_filename='npcname-e.dat')` lives in `scripts/native_catalog/tables.py`. Inventory: `docs/parts/data/dat-table-inventory.json`. Decoded tables are client display copies, never server stats (ARCH-01).
- `scripts/native_catalog/ue2.py` (`read_animation_events`) keeps notify timing, sound references and raw authored properties. `pnpm assets:effects --client <root> --skill <id> --level <n> --output <json>` extracts skill effect graphs; extraction is not runtime equivalence (ACT-06).
- Ver121 `.utx` XOR keys come from the lowercase original filename, so renaming before decoding breaks them. Music `.ogg` files carry an L2SD wrapper the pipeline removes.
- UModel build1590, SHA-256 `13502e5a4d8f6b5f32252afebd6360f7302ccfaccf6b8dda65beff0be2d364a0` (CONV-02). Listings prove readability only. Its glTF export already scales by 0.01 and swaps Y and Z; never apply a second 0.01. Its glTF materials are placeholders and the CLI export omits animation keys.

## Open

- Tables without a local layout (`hairgrp`, `helmetgrp`): [reuse audit](LINEAGE2ELBERA_REUSE_AUDIT.md) (DATA-02). NPC `PrePivot` and DrawScale: [NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md).
- ACT-04 only partly covers conditional notify events.
- Attachment formulas, `bFaceRotation`, particle integration and blend equations are not recovered (ACT-03, ACT-06, POL-01).

## Pointers

- Tests: `pnpm test:pipeline`; real-source tests skip without native inputs. UELib pin: `UELIB_SHA256` in `scripts/native_catalog/effects.py`.
- Local evidence: `artifacts/native-client-audit/` (its inventory and listings predate the lock and describe the E: tree), `artifacts/native-effects/`.
- [NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md), [ASSET_PIPELINE.md](ASSET_PIPELINE.md), [SOURCE_REUSE.md](SOURCE_REUSE.md).
