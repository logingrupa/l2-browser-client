# Native asset pipeline

How client files become `.l2asset` packages and catalog entries ([OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md)). Stage A converts the whole client breadth first ([STATUS.md](../STATUS.md)). Decisions and work order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- One small script per game system, sharing readers in `scripts/native_assets_lib/`. One character, skill or world section converts without running all extraction (CONV-01). Recipes select objects; readers are not copied per race or tile.
- `scripts/native_assets.py`: `pnpm assets:convert`, `assets:batch <recipe>`, `assets:verify <archive>`. Recipes are JSON request arrays: `materials: ["0=Package.Group.Material"]` binds slots, an assembly takes up to 16 `parts`, `sourceBinding` pins a DAT hash and fields.
- `pnpm assets:pipeline` is optional. Exit 0 complete, 2 partial, 1 failure; none means native acceptance.
- `assets:convert` and `assets:effects` default to `E:/lineage2-client`, where `scripts/reference_client_guard.py` reads only files the tree lock (`recipes/reference-client-tree.lock.json`) classes `equal`.
- The pinned tools live in the main checkout's ignored `.assets/native-tools/` (`umodel`, `ue-explorer`, `dat-schema`, `open-l2encdec`), and lanes use them through absolute defaults. UModel build1590 is SHA-256 pinned (`13502e5a...364a0`). `--umodel` and `L2_UMODEL`, `L2_UELIB`, `L2_POWERSHELL`, `L2_SCHEMA_ROOT`, `L2_CRYPTO_SOURCE` move tools; pinned hashes still apply.
- No height normalization, ground fitting, root-drift removal or weight normalization (CONV-02). An unbound material slot is a named magenta diagnostic; no texture is guessed by name.
- `stage_native_runtime.py` (`assets:migrate --stage-runtime`) replaces the catalog ([NATIVE_MIGRATION.md](NATIVE_MIGRATION.md)). Other `stage_native_*.py` stagers take the expected catalog hash and add only their records. Store writers run only in the main checkout (INT-01).

## Open

- Whole client: 153 tiles (WORLD-01, WORLD-02), all classes (ACT-01), NPCs (ACT-02), items (ACT-03), sounds (ACT-05), skill visuals (ACT-06).
- `hairgrp` selection is unresolved; hair colour 0 in `recipes/native-mfighter.json` is a recipe choice (ACT-01, DATA-02).
- `assets:effects` writes extraction graphs, not playable effects (ACT-06).

## Pointers

- Other `assets:*` commands in `package.json`; `scripts/bundle-native-*-audio.py`.
- `pnpm test:pipeline` runs `tests/pipeline/` and `scripts/native_catalog/` tests.
- [NATIVE_TEXTURES.md](NATIVE_TEXTURES.md), [NATIVE_AUDIO.md](NATIVE_AUDIO.md), `docs/parts/<part>/EVIDENCE.md`, [research/INDEX.md](research/INDEX.md).
