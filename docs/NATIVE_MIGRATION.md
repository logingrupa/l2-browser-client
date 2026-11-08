# Native migration

The optional `pnpm assets:migrate` (`scripts/native_migration.py`) converts the pinned inputs for the four fixed parity cases (Human male fighter, Greater Musveren, Power Strike, a 20_20 section). A pass is conversion evidence, not visual or playable acceptance. Decisions and work order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- `recipes/native-inputs.lock.json` pins 143 files / 2,511,063,181 bytes from IMPORTA-PC `C:/Lineage2-client`: 133 packages, eight DAT tables, `LineageWarrior.int`, `system/Engine.dll`. Inputs only. Default `--client`: staged copy `artifacts/native-parity/inputs/IMPORTA-PC`.
- `Engine.dll` is hashed evidence, never loaded; `system/l2.ini` is hashed only, never copied.
- `recipes/native-migration.json` has eight jobs: fighter, equipment, Musveren, NPC profiles, 20_20 map, its textures, its section, Power Strike dispatch.
- Output `artifacts/native-parity/migration/`: `inventory.json`, `coverage.json`, `validation.json`, `products.json`, `run.json`, and `reproducibility.json` with `--prove-rebuild`.
- `--prove-rebuild` replays the cache, rebuilds into an empty directory and compares every product. Also `--verify-only`, `--inventory-only` and `--fleet-stage` (refills inputs from IMPORTA-PC, refuses a differing file).
- `--stage-runtime` (`scripts/stage_native_runtime.py`) replaces `public/l2/catalog.json` with migration products only, dropping other records. Do not run it on the current store.
- Last recorded `--prove-rebuild --stage-runtime` run: 381/381 byte-identical products, 100 archives. Receipts: `artifacts/native-parity/migration/{reproducibility,validation}.json`.

## Open

- Musveren: native choice between its two kept weight streams, deformation parity (POL-01).
- Sword attachment and native attack (ACT-03, POL-01).
- unverified: whether the 381/381 run predates asset.json v2 (plan 01-12).
- Other per-case gaps live in the case docs: [NPC profiles](NATIVE_NPC_PROFILES.md), [Power Strike](NATIVE_POWER_STRIKE.md), [world](NATIVE_WORLD.md).

## Pointers

- Single adapters `scripts/native_map.py`, `scripts/native_effect_bundle.py`, `scripts/native_actor_profiles.py`.
- `pnpm test:pipeline --migration-output <dir>`; `tests/pipeline/test_native_migration.py`.
- [ASSET_PIPELINE.md](ASSET_PIPELINE.md), [NATIVE_TEXTURES.md](NATIVE_TEXTURES.md), [NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md), [NATIVE_POWER_STRIKE.md](NATIVE_POWER_STRIKE.md).
