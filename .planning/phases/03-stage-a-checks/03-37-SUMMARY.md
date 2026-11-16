---
phase: 03-stage-a-checks
plan: 37
subsystem: actors
tags: [actors, characters, player-profiles, rm-7, rm-9, gap-closure, actors-batch, rerun-chain, sandbox]
status: complete
gap_closure: true
requires:
  - phase: 03-stage-a-checks
    provides: "03-27 character conversion, class join and root mesh animation"
provides:
  - "scripts/actors/character_animation_family_recipe.py and recipes/actors/character-animation-families.json: 14 classes x 8 weapon slots x 21 families from RM-7"
  - "scripts/actors/character_player_profiles.py: clip binding (exact or one ASCII case-insensitive match) and the character-<n> profile"
  - "scripts/actors/character_store_records.py: the one player profile shape check and the character-player-profiles pack record"
  - "src/runtime/sandboxCharacterAppearances.ts: on-demand sandbox appearance for every served profile"
affects: [03-28, 03-30, 03-38, 03-16, 03-17, 03-19]
tech-stack:
  added: []
  patterns:
    - "A converter step seals a derived binding file as a second output next to its archive; the pack builder reads only sealed receipts and model records"
key-files:
  created:
    - scripts/actors/character_animation_family_recipe.py
    - recipes/actors/character-animation-families.json
    - scripts/actors/character_player_profiles.py
    - scripts/actors/character_store_records.py
    - src/runtime/sandboxCharacterAppearances.ts
    - tests/pipeline/test_character_animation_family_recipe.py
    - tests/pipeline/test_character_player_profiles.py
  modified:
    - scripts/actors/character_requests.py
    - scripts/actors/character_conversion.py
    - scripts/actors/character_census.py
    - scripts/stage_native_players.py
    - scripts/report-native-animation-aliases.py
    - scripts/prepare-native-player-aliases.py
    - recipes/actors/gap-reasons.json
    - docs/parts/player-characters/character-census.json
    - .gitattributes
    - src/runtime/sandboxCharacterVisual.ts
    - src/runtime/createNativeSliceRuntime.ts
    - tests/browser/sandbox-characters.spec.ts
    - tests/unit/sandboxCharacterVisual.test.ts
key-decisions:
  - "Row 1225: one family recipe; the idle recipe, generator and test are deleted"
  - "Row 1226: the recipe pins the RM-7 verified note, answer and manifest plus the Q3 pins"
  - "Row 1227: RM-9 answered; a unique ASCII case-insensitive match binds as case-only with no unconfirmed reason"
  - "Row 1228: hair and helmet stay census field gaps; the step row passes"
  - "Row 1229: forwardAxis [1,0,0]; the face shows on character:0"
  - "Row 1230: the R2 retirement moves to follow-up plan 03-38"
requirements-completed: []
duration: 80min
completed: 2026-11-16
plan_head_before: 911b708911fb2e284fb63df92464910d067b7f19
plan_head_after: 8b52b6a8d50f48564ab7da54b8aa6d2f8aebbfa2
actuals:
  tokens: 106000
  tasks: 3
  commits: 4
---

# Phase 3 Plan 37: Generated player profiles for the 14 converted characters Summary

All 14 chargrp characters now spawn from a generated profile pack. Their animation names come from RM-7 and the lock-equal `lineagewarrior.int`, and their clip binding follows the RM-9 FName rule. Each key loads and idles on the integration store, character 0 runs, and it faces the camera. The retirement of the hand-staged human profiles (R2) moves to follow-up plan 03-38.

## Result: characters that spawn, of 14

- **14 of 14** keys spawn their model and play their idle clip (`sandbox-characters.spec.ts`, integration store). Load-check records: 14 pass on union `9f100a39`.
- Census (`docs/parts/player-characters/character-census.json`): models converted 14, profiles written 14, gap keys 0, pending 0. The only gaps per key are the field gaps hair `hair-layout-undecoded` and helmet `helmet-layout-undecoded` (R5).
- Pack: `player-profiles/0e8247a6941791dcac0e1730208b6923be0315a8145c0bdeedf6a05cdb626115/manifest.json` (163,214 bytes), record `character-player-profiles` in the actors lane catalog and the union.
- Character 0 binding: 21 aliases bound, idle `Wait_Hand_MFighter`, run `Run_Hand_MFighter`, attack `Atk01_Hand_MFighter`, death `Death_MFighter`. Every class chain gives DrawScale 1 and DrawScale3D (1,1,1) from `Engine.Actor`, and PrePivot is absent through the checked ancestry.

## Tasks

1. **Animation family recipe (tracer), 8739059.** `character_animation_family_recipe.py --verification-folder ... --answer-folder ... --client E:/Lineage2-client [--check]` writes `recipes/actors/character-animation-families.json` (sha256 `5e3fc4d0...fc61`, 212,399 bytes). It holds 14 classes, 112 weapon profiles and 21 families, with 294 None values, all at WT_THROW (FName None, no remap). Every value and its `.int` line equal the answer. The recipe pins `verified-player-animations.md` `b3e80dc7`, the answer `fca99308`, the manifest `5e2e5ac1`, `verified-characters.md` `19fc5ff0` and the q3 replay `b8c23d0e`, and `lineagewarrior.int` and `engine.dll` are lock-equal. `--check` exits 0. `character_profile_fields` resolves once collision, DrawScale and the WT_HAND idle, run, attack and death values exist. The idle recipe, its generator and its test are deleted. Tracer `convert_actors.py --character 0`: exit 0, `reason: null`, free bytes 134,157,373,440 before and 133,992,198,144 after.
2. **Profile pack, store record, batch and chain steps 1 to 3, 092d776.**
   - The clip binding runs in `character_conversion.convert` on the converted GLB's clip names. It is sealed as `clip-binding.json`, a second unit output.
   - A missing or ambiguous required clip seals `character-clip-missing:<field>`. An authored non-zero PrePivot seals `character-pivot-unapplied`. Both reasons are new in actors gap list version 14.
   - Both `--batch characters` and `--character` rebuild the pack.
   - `profile_shape`, `alias_evidence_shape` and the alias, status and evidence constants now live in `character_store_records.py`, which also accepts `chargrpIndex`. `stage_native_players.py` keeps `ID` and `CATALOG_ID` for its importers. `bound_family_clip` replaces `resolve_reference`.
   - Tests check that the Python alias-to-field table equals `nativeAnimationAliases.ts`, and that `catalog_index_keys` gives 14 `character:` keys for a generated 14-profile pack.
3. **Runtime and browser check, 2cf2c05 and 8b52b6a.**
   - `sandboxCharacterAppearances.ts` registers `native-player:<profile id>` once per served profile. Its lazy loader runs `loadNativeModelPackages` and then `validateNativePlayerAssets`. Clips, forward axis, actor scale and collision half height come from the profile.
   - The local pawn keeps its loaded appearance. A record whose profile is not served says so. The not-loaded-in-this-sandbox path is deleted.
   - `pnpm typecheck` passes, and 7 targeted Vitest files pass (146 tests).
   - The spec moves to `NATIVE_STORE_ROOT=integration`.

## Screenshots and facing

- `artifacts/ui-evidence/03-37-character-0-idle-desktop.png` (1440 x 900), `03-37-character-0-idle-phone.png` (932 x 430 landscape, touch) and `03-37-character-0-run-desktop.png` (run clip `Run_Hand_MFighter` active). The sweep is in `03-37-characters-sweep-desktop.png`. The portrait 430 x 932 view has no horizontal scroll.
- **Facing (R1):** `03-37-character-0-facing-desktop.png` frames character 0 along its `forwardDirection`, and the face shows. `[1,0,0]` holds, and no axis was hand-tuned. Characters spawn at the slice monster's position, so the check first despawns `native-musveren` with the sandbox `despawn` command.
- Headless SwiftShader. No FPS claim is made.

## Re-run chain

| Step | Command | Result |
|---|---|---|
| 1 Lane re-run | `convert_actors.py --client E:/Lineage2-client --batch characters --limit 14` (one background process, BelowNormal) | exit 0, last line `character:13 ... "reason": null, "status": "pass"`. Free bytes 133,167,972,352 before and 133,257,662,464 after (identical-file sharing). Ran 20:04:14 to 20:09:45 UTC |
| 2 Lane catalog | `write_lane_catalog.py --lane actors`, then `--plan` | exit 0 and exit 0. Actors catalog `c0fad585e48faf1cc4eaaf4d9253c6ac30b6a78454c62dd879e308126e821d8b` (playerProfiles 1) |
| 3 Union rebuild | `write_lane_catalog.py --lane integration --union world --union actors --union data-ui` (schedule check first, BelowNormal) | exit 0. Union `06883731...9be3` before and **`9f100a39866d9a1307e9f495c510a10ba9ee1f8d9d033861dfe6d92a1fdd908c`** after. 30 files written. Free bytes 133,323,091,968 before and 133,418,090,496 after |
| 4 Touched-key sweep | `key_content_sha256_by_key` before and after; sweep with `sandbox-characters.spec.ts` | 14 touched keys of 17,859 (`character:0` to `:13`, all new; no other kind changed). The spec (port 5173 free): 3 passed, 14 load-check records pass |
| 5 Queue | `record_side_by_side_checks.py queue --store-root artifacts/lane-store/integration/l2` | **exit 1**: `Side-by-side queue failed: no native selection rule covers character keys` (see open follow-ups) |
| 6 Re-capture | - | not run: no sandbox halves yet (GP6) |
| 7 Ingest | - | not run: no sandbox halves yet (GP6) |

- Receipts gate: 15,618 receipts before and after. Only the 14 `characters` units changed, and none went missing or was added.
- `print_fingerprint_inputs.py` output is byte-equal before and after (sha256 `f8d07f58...4fb6`). `implementation_hash()` stays `c4bf8e6c...2bd8`. No NPC, item, skill or sound unit resealed.

## GP7 lines for 03-16, 03-17 and 03-19

- The census no longer has `profile: actor-default-unresolved:RunAnimName`. All 14 profiles are written.
- The spec marker `character:<n> gap: ...` becomes a loaded model for every key.
- STATE follow-ups "Character keys" and "Character profiles (ACT-01...)" are resolved by the generated pack. STATUS.md and the player-characters EVIDENCE.md profile lines change the same way.
- WT_THROW is "FName None, no remap (RM-7)". The `damage` alias is `no-family-value` (no class has DamageAnimName).

## R2: hand-staged human profile retirement (moved to 03-38)

The generated pack loads rows 0, 1, 8 and 9 (14 of 14). Under orchestrator override 6 and GP8 ("or in the plan it names"), the retirement moves to **follow-up plan 03-38**. These callers stay until then:

- Shared store record `native-player-profiles` with its four staged human packages and the loader's `unresolved` collision entries (main-checkout restage, Needs Human).
- The default local pawn `human-male-fighter` and `defaultNativePlayerProfile`, with its built-in identity check. Its audio is bound to `human-male-fighter:0` until 03-28, and the item 22 shirt (`leatherShirt`) stays until 03-30.
- `ID` and `CATALOG_ID` in `stage_native_players.py`, imported by frozen modules (GP2) and by the `stage_native_*audio` scripts.
- `recipes/native-{mfighter,ffighter,mmagic,fmagic}.json`, which build the staged packages.
- For 03-38 to delete: `recipes/native-player-{ffighter,mystics,aliases}-stage.json`, `recipes/native-player-mfighter-base.json`, `scripts/prepare-native-player-aliases.py`, `scripts/report-native-animation-aliases.py`, the staging route of `stage_native_players.py`, `assets:stage`, and `defaultNativePlayerProfile`. Also their tests `test_native_player_stage.py`, `test_native_player_aliases_stage.py`, `test_native_mystic_players.py` and `test_native_animation_aliases.py`, and the citations in `test_character_recipe_unresolved_values.py`, `test_character_profile_fields.py`, `test_client_entry_points.py`, `test_converter_output_guard.py`, `nativeAnimationAliasTable.ts`, `nativeAnimationAliases.ts`, `nativeAnimationAliasTable.test.ts`, `nativePlayerProfiles.test.ts`, the debug and runtime unit tests, `sandbox-equip.spec.ts`, `nativeSlice.spec.ts` and `docs/research/INDEX.md`.

## Deviations from Plan

1. **[Rule 3] Census rename in Task 1.** `character_census.py` records `animationFamilies` in place of `idleFamilies` in Task 1, because the source field rename would otherwise break the census.
2. **[Rule 2] Clip binding as a sealed output.** A receipt holds exactly `config`, `inputs`, `outputs` and `gapRows`. The config fixes the fingerprint before conversion, so the binding is sealed as `clip-binding.json`, a second output with its SHA-256.
3. **[Rule 2] DrawScale and PrePivot from the class chain.** `character_profile_fields` reads DrawScale, DrawScale3D and PrePivot through the same chain walk as collision. A missing DrawScale keeps `actor-default-unresolved:DrawScale`.
4. **RM-9 followed.** `verified-animation-name-resolution.md` exists, so a case-only binding is confirmed (ASCII-only fold) and no `clip-name-case-unconfirmed` reason is written (row 1227).
5. **Touched outside the Task 2 file list:** `scripts/prepare-native-player-aliases.py` and `tests/pipeline/test_native_player_aliases_stage.py` (imports re-pointed to `character_store_records`), and `scripts/report-native-animation-aliases.py` (imports `bound_family_clip`). 03-38 deletes all three. The report script's docstring stays until then.
6. **R2 moved to 03-38** (row 1230). The Task 3 gate checks on the legacy files therefore fail as planned. The final sandbox-characters rerun after deletions moves with it.
7. **Ownership checks.** Task 1 (player-characters): `.gitattributes` and `.planning/OVERNIGHT-DECISIONS.md` are foreign, as in 03-27. Task 2: the player-characters check names `scripts/stage_native_players.py` and the decisions file; the adapter-dispatch check names the 9 actors files. Task 3: the player-characters and ui checks name the 3 `src/runtime` files and the decisions file; the adapter-dispatch check names 0. Each lane's files are owned by one of the parts the plan names.

## Open questions for the orchestrator (IMPORTA-PC REA)

- RM-9: answered (`verified-animation-name-resolution.md`) and applied.
- N2: the verified answer says a None name is a no-op that keeps the current sequence (APawn::PlayAnim 0x106a7c40). This plan binds only WT_HAND, where no required value is None. The WT_THROW behaviour belongs to 03-30.
- N3: does combat idle use `AtkWaitAnimName`? (`GetCurWaitAnimName` and `GetCurTurnAnimName` were not traced.)
- N4: which function writes `CurWeaponType` +0x71d on equip (03-30)?

## Open follow-ups

- **03-38 R2 retirement** (list above).
- **Pair queue has no character rule.** Chain step 5 exits 1 with `no native selection rule covers character keys`. Now that character keys pass load, the `hair-4dd2` waiting rule selects `character:0`. Neither `native_selection_for_key` nor `session_kind_for_key` in `scripts/side_by_side/build_pair_queue.py` covers `character`, and the index shared definitions name no character selection. The plan that owns the queue (03-07 to 03-11) needs a character selection and session kind before the queue runs on this union.
- NPC facing: the NPC route passes no axis (`Vector3.Forward()`, +Z), while player profiles use `[1,0,0]` from the same converter mapping. This plan did not check whether a converted NPC faces its forward direction.
- Characters spawn at the slice monster's position, so any character screenshot that should show the face needs the monster moved or despawned first.

## Decisions logged

OVERNIGHT-DECISIONS rows 1225, 1226, 1227, 1228, 1229 and 1230.

## Process cleanup

- Everything this plan started ran to exit: the tracer, the batch, the census check, both lane catalog runs, the union rebuild, the queue, three Playwright runs (full spec, one character-0 rerun, one temporary facing probe whose spec file was deleted and never committed) and the Vitest and tsc runs.
- After the last run, nothing listens on 5173 or 5175, and no process with the worktree path, `convert_actors`, `write_lane_catalog`, `playwright`, `chrome-headless` or `vitest` in its command line remains.

## Self-Check: PASSED

- FOUND: scripts/actors/character_animation_family_recipe.py, recipes/actors/character-animation-families.json, scripts/actors/character_player_profiles.py, scripts/actors/character_store_records.py, src/runtime/sandboxCharacterAppearances.ts, tests/pipeline/test_character_animation_family_recipe.py, tests/pipeline/test_character_player_profiles.py
- FOUND commits: 8739059, 092d776, 2cf2c05, 8b52b6a
- `python -B -m unittest discover -s tests/pipeline -p "test_character_*.py"`: 95 tests OK. `test_catalog_index_keys.py`, `test_native_player_stage.py`, `test_native_player_aliases_stage.py`, `test_native_mystic_players.py`, `test_native_animation_aliases.py`, `test_gap_rows.py`, `test_data_ui_table_manifest.py`, `test_converter_implementation_hash.py` and `test_client_entry_points.py` are OK.
- Task 2 gate: census `--check` exit 0, `write_lane_catalog.py --lane actors --plan` exit 0.
- Task 3 gate: the Vitest part passes (146 tests). The legacy-file checks fail as planned, because R2 moved to 03-38. No listener remains on 5173 or 5175.
