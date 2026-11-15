# Phase 1 independent review

## Reviewer setup

- Reviewer: a fresh-context general-purpose Claude agent. It replaces the Codex cross-model review (OVERNIGHT-DECISIONS row 40; Codex is out of credits until 2026-11-12).
- Input given to the reviewer, and nothing else: `git diff 9c64e61..HEAD -- src scripts tests package.json vite.config.ts vitest*.ts playwright*.ts recipes`, the Phase 1 section of `.planning/REQUIREMENTS.md`, `AGENTS.md` and `docs/OUTPUT_CONTRACT.md`.
- Result: 0 blockers, 5 warnings, 8 info.
- Fix round: one round for the 5 warnings, each finding checked against the code first, one commit and one test per fix. Info findings are noted, not fixed. Decision rows 50 to 52.

## Findings

| ID | Severity | File:line | Summary | Disposition | Test |
|----|----------|-----------|---------|-------------|------|
| IR-01 | warning | src/assets/native/NativeCharacterVisual.ts:116-140, 243-248 | A failed equip rolls the visual back while the adapter keeps the new item, so every later `setEntity` retries the equip and posts the error again on each movement frame | Fixed in a4e9cc3: the rejected item is remembered and not retried while the adapter still reports it; a new equipment change is tried and reported once | tests/unit/nativeCharacterVisual.test.ts "attempts a rejected equip once per equipment change instead of on every movement update" (red on the old code: 5 statuses instead of 1) |
| IR-02 | warning | src/runtime/attachSandboxCommandSheet.ts:107-110, src/assets/native/nativeCatalogIndex.ts:113-125 | `item:<id>` reports "converted" when any staged player profile lists it, not the loaded character | Fixed in c129435: the sheet gets the active player profile ID and warns "item:22 converted for human-male-fighter, not for human-male-mystic" | tests/unit/sandboxCommandSheet.test.ts "warns that item 22 is converted only for the staged profiles when another character is loaded" |
| IR-03 | warning | scripts/reference_client_guard.py:104-105 | `require_lock_equal_record` accepts a file on a size and modification time match without hashing; FOUND-03 asks for per-file SHA-256 proof | Fixed in a763a0c: every lock-checked read compares SHA-256 with `eSha256`, cached in process by path, size and modification time | tests/pipeline/test_reference_client_guard.py "changed bytes with the locked size and modification time report a stale lock" and "unchanged file is hashed once per size and modification time" (both red on the old guard) |
| IR-04 | warning | scripts/audit-native-footstep-config.py:138-142 | `require_equal_file` runs before the `source.is_file()` check, so `locked-package-not-staged` cannot be reached on lock-checked roots | Fixed in db1b892: presence is checked first, then the lock-equal bytes | tests/pipeline/test_native_footstep_config.py "locked package absent from a lock-checked root is reported not staged" (red on the old script) and "present package on a lock-checked root still needs lock-equal bytes" |
| IR-05 | warning | tests/unit/gameWorldAdapterContract.test.ts:13-20, tests/unit/architectureInvariants.test.ts:23-31 | ARCH-02 frozen-contract checks use only `expectTypeOf`, which does nothing at runtime | Not a defect: `tsconfig.json` includes `tests`, so `pnpm typecheck` (also part of `pnpm build`) enforces the assertions. Changing `dispose(): void` to `dispose(): unknown` fails typecheck at gameWorldAdapterContract.test.ts(19,63). The runtime half is the existing "answers all five methods at runtime" case. A prototype-equals-five-names check would fail on NativeSliceAdapter, which also exposes presentation getters and `subscribeCommands` | Mutation run of `pnpm exec tsc --noEmit`, reverted |
| IR-06 | info | scripts/build_reference_client_lock.py:166, 188-190 | `hashingScriptSha256` hashes the local script, not the one that wrote the manifests | Noted, not fixed in this round | None |
| IR-07 | info | src/runtime/attachNativeSliceWorldSheet.ts:79 | The Scene presentation group shows `nativeSandboxPresentation` when authored is 1 | Noted, not fixed in this round | None |
| IR-08 | info | scripts/build_dat_table_inventory.py:20-32 | Elbera record counts are hard-coded from a doc; sysstring-e and systemmsg-e are both 2083, possibly a copy error | Noted, not fixed in this round; added to `## Needs Human` in STATE.md as a source-fidelity question (docs/PORT_SCOPE.md already flags the equal counts under DATA-03) | None |
| IR-09 | info | scripts/native_assets.py:782, 144 | `require_reference_client` is called twice | Noted, not fixed in this round | None |
| IR-10 | info | src/ui/WorldInterface.ts:102 | `renderSound` is called again in the catch | Noted, not fixed in this round (file not touched) | None |
| IR-11 | info | src/world/GameWorldAdapter.ts:8 | Closing brace on the method line | Noted, not fixed in this round (file not touched; the IR-05 mutation was reverted) | None |
| IR-12 | info | tests/editor/* | Moved files still contain comments | Noted, not fixed in this round | None |
| IR-13 | info | src/ui/worldStyles.ts | New `.entity-diagnostic` styling versus DEC-OWN-10 | Noted, not fixed in this round | None |

## Bookkeeping

- ARCH-04 and NOED-05 ticked complete in `.planning/REQUIREMENTS.md` (35e37d1); 01-VERIFICATION.md marks both satisfied. NOED-02 stays pending for the DATABASE-PC cold-start re-measure.

## Test results (PROMINENCE-PC, BelowNormal priority)

- `pnpm typecheck`: passes.
- `pnpm test:unit`: 115 files passed, 1 failed, 5 skipped; 1402 tests passed, 2 failed, 82 skipped. The 2 failures are the known cases in tests/unit/nativeNpcProfiles.test.ts ("uses one catalog snapshot and exact hashed metadata" in https and file).
- pytest over the touched modules and every module that uses `reference_client_lock_fixture.py` (20 modules, including test_reference_client_guard, test_native_footstep_config, test_reference_client_lock, test_reference_client_tree, test_native_catalog_package_lock, test_native_map_lock, scripts/native_catalog/test_effects): 251 passed, 33 skipped (tests that need `E:/Lineage2-client`, absent on this host).
- No e2e run: the changed sheet text is covered by Vitest, and the browser spec's default fighter path is unchanged.
