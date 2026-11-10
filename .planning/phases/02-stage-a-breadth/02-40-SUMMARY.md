---
phase: 02-stage-a-breadth
plan: 40
subsystem: actors
tags: [act-01, chargrp, decision-h, unit-ledger, lane-store, census, playwright]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-10 spawn-character; 02-21 actor unit census; 02-22 convert_actors, serialized_animation_reference; 02-27 classinfo-e manifest; 02-28 hairgrp and helmetgrp manifests; 02-34 npc_store_records and the batch pattern; 02-37 spawn-character presentation"
provides:
  - "scripts/actors/character_requests.py: build_character_request, character_gap_rows, resolve_character_actor_class, collision_from_class_chain, character_profile_fields, layout_binding, manifest_record_fields"
  - "scripts/actors/character_conversion.py: CharacterConversionRun, CharacterSources, read_character_sources, model_gap_reason, data_ui_table_manifest"
  - "scripts/actors/character_census.py: run_character_conversion, run_character_batch, write_character_census, CHARACTER_BATCH_NAME"
  - "scripts/actors/actor_arguments.py and scripts/actors/path_free_messages.py (moved out of convert_actors.py)"
  - "convert_actors.py --character <chargrpIndex> and --batch characters --limit <n>"
  - "actor_unit_inventory.convertible_model_unit_count (NPC and chargrp units)"
  - "loadNativePlayerProfiles returns { profiles, unresolved }; NativeUnresolvedProfileField, NativePlayerProfileCatalog"
  - "docs/parts/player-characters/character-census.json"
  - "recipes/actors/gap-reasons.json listVersion 7 with assembly-part-limit-exceeded:<count>; gap census step characters"
affects: [02-42, integration restage, ACT-01]

actuals:
  tokens: 42000
  tasks: 3
  commits: 5
plan_head_before: 5c1db70f8ab9e42474bccbbb28927200bfe4ef15
plan_head_after: 3675cba90e2d24bd9ca068974de7d12e5654ee7e

tech-stack:
  added: []
  patterns:
    - "Decision H marker: the hand value becomes [] or null with unresolved {<field>: {reason, previousValue}}; previousValue is read by cross-check tests only"
    - "A character key's characters gap row names the first unresolved field: census gate, then model conversion, then profile"
    - "Generated requests are built from the decoded row only; the hand recipe is read by a cross-check test only"

key-files:
  created:
    - scripts/actors/character_requests.py
    - scripts/actors/character_conversion.py
    - scripts/actors/character_census.py
    - scripts/actors/actor_arguments.py
    - scripts/actors/path_free_messages.py
    - tests/pipeline/test_character_recipe_unresolved_values.py
    - tests/pipeline/test_character_requests.py
    - tests/browser/sandbox-characters.spec.ts
    - docs/parts/player-characters/character-census.json
  modified:
    - recipes/native-mfighter.json
    - recipes/native-mmagic.json
    - recipes/native-fmagic.json
    - recipes/native-ffighter.json
    - recipes/native-player-ffighter-stage.json
    - recipes/actors/gap-reasons.json
    - src/assets/native/loadNativePlayerProfiles.ts
    - src/assets/native/loadNativeCatalog.ts
    - src/assets/native/nativeCatalogIndex.ts
    - tests/unit/nativePlayerProfiles.test.ts
    - scripts/actors/convert_actors.py
    - scripts/actors/actor_unit_inventory.py
    - scripts/actors/npc_batch.py
    - scripts/native_store/gap_census.py
    - docs/parts/player-characters/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Decision H marker shape unresolved {field: {reason, previousValue}}, previousValue audit-only (row 571)"
  - "loadNativePlayerProfiles returns { profiles, unresolved }; loadNativeActorCatalog throws every unresolved field (row 572)"
  - "Class join only through classinfo-e chargrp_index plus actor_class; the 4dd2 layout has neither, so every row is class-template-mapping-undecoded (row 573)"
  - "Padding row = no body mesh, row 14 (row 574)"
  - "assembly-part-limit-exceeded:<count> at the converter's 16-part cap (row 575)"
  - "Census hair proof is HAIR_TABLE_FIELD_PROOF, the 4dd2 Engine.dll reading, not the superseded Elbera label (row 576)"
  - "Hair and helmet join only by a decoded field in both; none exists (row 577)"
  - "Joined-class profile stays actor-default-unresolved:WaitAnimName; no playerProfiles record in this plan (row 578)"
  - "Several face textures leave the face slot unbound (row 579)"
  - "characters step added to the integration gap census, one accepted foreign path (row 580)"
  - "One model capacity for NPC and chargrp units (row 581)"
  - "convert_actors.py split by concern, 382 lines (row 582)"
  - "animation-reference-missing for rows 1, 9, 13 (row 583)"
  - "Stale docs/ASSET_PIPELINE.md hair sentence left for integration (row 584); aliases stage mirror left for the restage (row 585)"
  - "ACT-01 stays Pending (row 586)"

requirements-completed: []

metrics:
  duration: 55min
  completed: 2026-11-10
---

# Phase 2 Plan 40: chargrp characters and decision H markers summary

**The hand-typed hair colour 0 in the four human recipes and the female fighter collision 8 / 23.5 are now recorded as unresolved, with reasons. The runtime loader reports an unresolved profile instead of loading it. A generator builds every `chargrp` row from the decoded table. Of the 15 rows, one is padding and 14 are character keys. 8 body assemblies convert into the actors lane store, every key is a listed gap with its reason, and the browser shows all 14 as labelled markers.**

## Performance

- Started 2026-11-09T23:38Z (01:38 Riga), completed about 00:32Z (02:32 Riga)
- Tasks: 3 of 3. Commits: 5. Files: 9 created, 18 modified.

## Accomplishments

- **Decision H, item 1.** In each human recipe, the two hair parts drop the class `Hair` override. Each now holds `materials: []` and `unresolved.materials {reason: hair-layout-undecoded, previousValue}`. The limitations now say the hair waits on DATA-02 and ACT-01. The three pipeline twins point only at these recipes.
- **Decision H, item 2.** The female fighter stage profile holds `null` collision dimensions with `actor-default-unresolved:CollisionRadius` and `actor-default-unresolved:CollisionHeight`. `loadNativePlayerProfiles` returns `{ profiles, unresolved }`. `loadNativeActorCatalog` throws `Native player profile human-female-fighter has unresolved collisionRadius: actor-default-unresolved:CollisionRadius; ...`. No `src/runtime/**` caller changed (`pnpm typecheck` clean).
- **Generator.** `build_character_request` uses only the decoded row.
  - Body parts follow `body_mesh1` upward with chargrp `sourceBinding` paths. Row 0 equals the hand `native-mfighter.json` body parts; a cross-check test ran on E:.
  - The face attaches only through a source-joined class, and the converter's `verify_actor_attachment` accepts the generated attachment in a test.
  - Hair and helmet bind only through a decoded join field, and their citation carries the field proof.
  - Collision is read through the declared parent chain and records which class supplied each value.
  - The edge cases are covered: the 16 and 17 part boundary, a shared mesh, empty fields, unqualified references, ordering, precision and padding.
- **Real batch.** `convert_actors.py --batch characters --limit 15` sealed 14 units:
  - Converted body assemblies: rows 0, 4, 6, 7, 8, 10, 11 and 12, as `character-model:<index>`.
  - `texture-licensee-unsupported:123/27`: rows 2, 3 and 5.
  - `animation-reference-missing`: rows 1, 9 and 13.
  - Every key's profile is `class-template-mapping-undecoded`, because classinfo-e decodes only `class` and `description`.
  - A second run reported 14 sealed units with `cacheHit: true` and rewrote the census byte-identically.
- **Browser sweep.** All 14 keys spawn on `/` as markers whose text is `character:<index> gap: <census reason>`. There are 14 `failed` load-check records on lane catalog `64d8fcb4...`. Screenshots were taken at 1440 x 900 and 932 x 430 landscape, and the 430 x 932 portrait view has no horizontal scroll.

## Task commits

1. Task 1 (tracer):
   - `e8e4048` fix(02-40): mark hand-typed hair and collision values unresolved
   - `5ffb61d` feat(02-40): chargrp row 0 tracer
2. Task 2: `56de651` feat(02-40): convert every chargrp row to an assembly or a listed gap and commit the character census
3. Task 3:
   - `46244b5` test(02-40): sweep every chargrp character key on the native route
   - `3675cba` docs(02-40): record the ACT-01 character census, the decision H markers, the restage handoff and decision rows 571 to 586

Tracer gate: Task 1's verify ran end to end before Task 2 started. It covered the two unittest files, typecheck, the vitest files, the row 0 conversion (`complete.json` present), `write_lane_catalog --lane actors` and the browser spec (1 passed). The `--character 0` rerun reported `cacheHit: true`.

## Verification

- `test_character_recipe_unresolved_values.py`: 7 OK. `test_character_requests.py`: 23 OK, including the E: row 0 cross-check.
- `nativePlayerProfiles.test.ts` and `nativeCatalogIndex.test.ts`: 101 passed.
- `pnpm typecheck`: clean.
- `pnpm test:unit` (02:19 Riga): 172 files passed, 4 skipped; 2,361 tests passed, 72 skipped. Log: `artifacts/scratch/02-40/unit-final.log`.
- `pnpm test:pipeline` at nice 10: `Ran 1737 tests`, `OK (skipped=61)`. Log: `artifacts/scratch/02-40/pipeline-final.log`.
- `NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-characters.spec.ts` ran with ports 5173 and 5175 free, on headless SwiftShader, so there is no FPS claim.
  - The sweep case passed alone after a fix (see deviations).
  - The two screenshot and portrait cases passed in the full run.
  - The spec is passed, not unverified.
- Acceptance greps:
  - `.Hair.` overrides left in the four recipes: 0.
  - `hair-layout-undecoded`: 2 in each of the four recipes. `explicit recipe appearance choice`: 0 in each.
  - The stage profile check exits 0.
  - `has unresolved` appears in `loadNativeCatalog.ts`. `previousValue` appears only on the key-allowlist line of `loadNativePlayerProfiles.ts`.
  - Comment lines in the three TypeScript loaders: 0.
  - `def build_character_request` appears once. `--character` is present in `convert_actors.py`.
  - Recipe paths in the generator files: 0.
  - Class-name regex: 0. `.Hair.` in `character_requests.py`: 0. `previousValue` in the generator files: 0.
  - `CollisionRadius|CollisionHeight` in `character_requests.py`: 1.
  - `Needs Human (plan 02-40)` in STATE.md: 2.
  - EVIDENCE.md is 6,841 bytes.
  - The spec has `scrollWidth` and `UNBOUND_SOURCE_SLOT_`, and no 844 or `world=`.
- `node scripts/check-lane-ownership.mjs --base 5c1db70 --part player-characters`, run after the last code commit and before the docs commit:

```
lane actors: 1 foreign paths
scripts/native_store/gap_census.py
exit=1
```

  The one foreign path is the `characters` step in the integration gap census. It is accepted as a lane confirmation (row 580), following the precedent of 02-43's `skills` step.
- Reference overlap: no DEC-OWN-12 area (materials, bsp-visibility, movement, particles, network) covers `scripts/actors` or `src/assets/native`, so no run applies.
- No retired sibling workspace name was written. Every `check-machine-schedule` call printed `activeWindow: null`.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] `convert_actors.py` was already 406 lines.** The argument parsers moved to `actor_arguments.py` and `path_free_reason` to `path_free_messages.py`. The character code lives in three new modules, which leaves `convert_actors.py` at 382 lines (row 582). Commit `5ffb61d`.

**2. [Rule 3 - Blocking] The gap census refused the `characters` step.** `characters` was added to `GAP_CENSUS_STEP_ORDER` (row 580). Commit `5ffb61d`.

**3. [Rule 1 - Bug] The models capacity counted only NPC units.** One `convertible_model_unit_count(census)` now serves the NPC and character paths (row 581). Commit `5ffb61d`.

**4. [Rule 1 - Bug] The sweep spec assumed the entity id `character-<index>-1`.** The spawn id sequence is per kind, so the second spawn is `character-1-2`. The spec now finds the single spawned entity by its `character-<index>-` prefix. Commit `46244b5`.

### Other adjustments

- The plan's `loadNativePlayerPackages` failures map does not exist in this tree. The unresolved message is thrown by `loadNativeActorCatalog` for the requested profile instead (row 572).
- The plan's hair label "Elbera 07b24 proof, unverified on 4dd2" was superseded by commit 1c2abf3. The census carries `HAIR_TABLE_FIELD_PROOF`, so the plan's `hairFieldProof ==` acceptance line does not match (row 576).
- `build_character_request(chargrp_row, row_index, actor_class, sources)` takes a fourth `sources` argument (chargrp, classinfo, hairgrp, helmetgrp and the class reader). It returns `request`, `profileFields`, `parts`, `hair`, `helmet` and `gaps`; the conversion turns these into gap rows.
- With a joined class and resolved collision, the profile still stays a gap at `actor-default-unresolved:WaitAnimName`. Alias derivation is not built, and no playerProfiles writer exists, because no row joins a class (row 578).
- The `assembly-part-limit-exceeded` reason landed with the tracer commit, because the generator needs it.
- TDD for Task 2: the behaviour tests were written after the generator code from the tracer, so they passed on first run except for 3 that needed a class reader double. There is no separate RED commit.

## Requirements

- ACT-01: Pending (row 586). Every chargrp row is a converted body or a listed gap, but no character key converts, because no decoded class join exists.

## Known stubs

None. Every gap is a listed reason in the census and the coverage report.

## Needs Human

- `Needs Human (plan 02-40)`: the actors lane merge command printed by `write_lane_catalog.py --lane actors --plan` (catalog `64d8fcb4...`).
- `Needs Human (plan 02-40)`: restage the human characters so the shared store drops hair colour 0 and the 8 / 23.5.

## Open follow-ups

- Character class join, the hair and helmet join, texture licensee 123/27, and the missing Animation reference for rows 1, 9 and 13 (STATE.md line, rows 573, 577 and 578).
- The `docs/ASSET_PIPELINE.md` hair sentence for the integration thread (row 584).

## Threat flags

None beyond the register:
- T-02-40-01: every client read goes through the guard and `locked_input_records`. The data-ui manifests are SHA-checked against their record and the lock.
- T-02-40-02: output goes through `require_converter_output` and lane paths only.
- T-02-40-05: there is no name matching.
- T-02-40-06 and T-02-40-07 are covered by the tests above.

## Process cleanup

- Started: foreground Python conversions, unittest runs, `pnpm test:unit`, `pnpm test:pipeline` and `tsc`, and four Playwright runs whose `pnpm dev` web server on 5175 Playwright stopped at exit.
- Check at 02:29 Riga: `netstat` shows no listener on 5173 or 5175.
- `artifacts/scratch/02-40/list_processes.py` (filtered on `autonomous-roadmap`, `:5173`, `--port 5175`, `playwright`, `umodel` and `chrome-headless-shell`) lists only its own PowerShell. Nothing started by this plan remains.

## Self-Check: PASSED

- Created files exist: `scripts/actors/character_requests.py`, `character_conversion.py`, `character_census.py`, `actor_arguments.py`, `path_free_messages.py`, `tests/pipeline/test_character_recipe_unresolved_values.py`, `tests/pipeline/test_character_requests.py`, `tests/browser/sandbox-characters.spec.ts`, `docs/parts/player-characters/character-census.json`.
- Commits `e8e4048`, `5ffb61d`, `56de651`, `46244b5` and `3675cba` are ancestors of HEAD.
