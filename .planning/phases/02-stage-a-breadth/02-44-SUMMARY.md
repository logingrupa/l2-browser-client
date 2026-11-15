---
phase: 02-stage-a-breadth
plan: 44
subsystem: audio
tags: [act-05, decision-h, combat-audio, actor-sounds, unit-ledger, route-proof, labelled-report]
status: complete
requires:
  - phase: 02-27
    provides: decoded npcgrp, skillsoundgrp, chargrp, armorgrp and weapongrp native-table manifests in the data-ui lane store
  - phase: 02-34
    provides: NPC profile packs (modelCatalogId and mesh per npc id) in the actors lane catalog
  - phase: 02-43
    provides: skill binding rows with soundRowOrdinal and 3,064 skill effect records
provides:
  - "recipes/native-combat-audio.json: roles null plus unresolved.roles {reason, previousValue} per selection; bundle-native-combat-audio.py refuses it"
  - "src/audio/combatAudioRoleRouting.ts: generatedActorSoundBundlePrefix, combatAudioRoleRoutingDiagnostics; createNativeCombatAudio appends them"
  - "scripts/actors/combat_role_routes.py: COMBAT_ROLE_ROUTE_PROOF, bind_combat_role_routes, combat_route_table_manifest, combat_route_config_manifest, descriptor_record_field_names, read_combat_role_route_proof"
  - "scripts/actors/actor_sound_bindings.py: build_actor_sound_recipe, actor_sound_gap_rows, actor_sound_bundle_id, skill_actor_row, actor_sound_reference_counts"
  - "scripts/actors/actor_sound_conversion.py and actor_sound_batch.py: sealed actor-sound and actor-sounds units, lane corpus, builder run, census"
  - "convert_actors.py --actor-sounds <key> and --batch actor-sounds --limit <n>"
  - "loadNativeCombatAudio without the 8-record cap"
  - "tests/browser/harness/actor-audio.html, actorAudioHarness.ts, sandbox-actor-audio.spec.ts"
  - "docs/parts/audio/actor-sound-census.json"
affects: [02-05 restage, 02-40, phase 3 listen check]
tech-stack:
  added: []
  patterns:
    - "A role routes to a column only through a pinned proof anchor the code can match exactly; every other step leaves a recorded combat-role-route-unresolved reason"
    - "A lane corpus in the builder's staged-sound inventory and coverage shapes lets the integration-owned builder run unchanged on lane-root products"
key-files:
  created:
    - src/audio/combatAudioRoleRouting.ts
    - scripts/actors/combat_role_routes.py
    - scripts/actors/actor_sound_bindings.py
    - scripts/actors/actor_sound_conversion.py
    - scripts/actors/actor_sound_batch.py
    - tests/pipeline/test_combat_audio_recipe_unresolved_routing.py
    - tests/pipeline/test_combat_role_routes.py
    - tests/pipeline/test_actor_sound_bindings.py
    - tests/unit/combatAudioRoleRouting.test.ts
    - tests/browser/harness/actor-audio.html
    - tests/browser/harness/actorAudioHarness.ts
    - tests/browser/sandbox-actor-audio.spec.ts
    - docs/parts/audio/actor-sound-census.json
  modified:
    - recipes/native-combat-audio.json
    - recipes/actors/gap-reasons.json
    - scripts/bundle-native-combat-audio.py
    - scripts/actors/convert_actors.py
    - src/audio/nativeCombatAudio.ts
    - src/audio/loadNativeCombatAudio.ts
    - tests/unit/nativeCombatAudio.test.ts
    - docs/parts/audio/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/phases/02-stage-a-breadth/deferred-items.md
key-decisions:
  - "02-44: actor-sounds:<key> combatAudio records of the existing native-combat-audio-dependencies kind (row 472)"
  - "02-44: hand-typed role map marked roles null plus unresolved.roles, previousValue audit-only; the runtime diagnostic keys on the actor-sounds: record id prefix; the staged 20_20 hand bundle keeps playing labelled unresolved (rows 474 to 476)"
  - "02-44: actor sound gap rows live in the lane work folder until the audio part has a coverage denominator (row 477)"
  - "02-44: the lane catalog writer refuses the generated bundles' decoded-table reader provenance pin; builder unchanged, restage line recorded (row 478)"
  - "02-44: route rule = sound-reference fields by lock-equal .uax packages plus getter offsets meeting one snd<N> serialization member in DAT order; only npcgrp attackItem, defense, damage and ALAudio critical bind (row 479)"
  - "02-44: ACT-05 stays Pending (row 484)"
requirements-completed: []
actuals:
  tokens: 44600
  tasks: 3
  commits: 4
plan_head_before: 3eff5828637239506c477aebba85982d486b4316
plan_head_after: 525cb438647747c4343d16ed6197d3414f358d24
duration: 45min
completed: 2026-11-09
---

# Phase 2 Plan 44: Actor sounds with proven routes Summary

**The hand-typed combat role map is now recorded unresolved and diagnosed at runtime, and generated actor sound bundles route a role to a column only through the pinned Q4 proof: npcgrp attackItem, defense and damage bind, every other table role stays a recorded gap. 21 NPC bundles (Gremlin plus a 20-bundle slice) are sealed in the actors lane store with 219 leaf-candidate sounds, and all 219 played into an audible labelled report (owner listening pending).**

## Performance

- Started 2026-11-09 16:44 Riga (14:52 UTC first test), finished 17:33 Riga.
- Tasks: 3 of 3. Commits: 4. Files: 25 changed, 13 new.

## Accomplishments

- Decision H item 3: all 9 selections of `recipes/native-combat-audio.json` hold `roles: null` and `unresolved.roles` with `combat-role-route-unresolved:<table>/<role>` and the former column as `previousValue`. `bundle-native-combat-audio.py --plan` exits 1 naming every selection, role and reason. `createNativeCombatAudio` adds one diagnostic per role for any bundle whose id is not `actor-sounds:<key>`; the staged 20_20 bundle still plays (unit test).
- Route binder on the real proof (`03c3a036...`) and the data-ui manifests: npcgrp binds `attack_sound1` (ordinal 8), `defense_sound1` (9) and `damage_sound` (10) from `GetAttackItemSound`, `GetDefenseItemSound`, `GetDamageSound` and `FL2NpcData::Serialize`. npcgrp attackVoice, all chargrp roles, armorgrp, weapongrp and skillsoundgrp stay unresolved with the missing proof step named. ALAudio critical binds to `EtcSound.CriticalSound`; soulshot stays unresolved. Every bound route agrees with the hand recipe (test-only cross-check).
- `convert_actors.py --actor-sounds npc:20001`: 6 Gremlin sounds (3 `MonSound.Hit_*`, 3 `gremlin_dmg_*`) convert through the guarded Converter into sealed `actor-sound` units; the imported builder writes `actor-sounds:npc:20001` (`c2108a95...`), 1 empty attack slot, soundRadius 50, soundVolume 250, soundRandom 70. A rerun is byte-identical (census, gap rows, catalog).
- `--batch actor-sounds --limit 20` sealed npc:12077, npc:12564 and npc:14001 to npc:14018: totals 219 unique package+leaf candidates, 0 exact, 0 unresolved, 3 empty.
- Audible report `artifacts/lane-store/actors/audio-reports/f0ccc579...json`: 21 bundles, 219 rows, all `played: true`, peaks 0.5506 to 1.2550, no decode problem. Tracer report `e00eb4b2...json` (6 rows).

## Task commits

1. Task 1 (tracer), commit 1: `ccd576a` fix(02-44): mark the hand-typed combat role routing unresolved
2. Task 1 (tracer), commit 2: `3274a3d` feat(02-44): Gremlin actor sounds tracer. The tracer gate re-ran the Task 1 verify end to end (pipeline tests, typecheck, vitest, conversion, e2e) before Task 2.
3. Task 2: `6309206` test(02-44): every table route rule, the hand-recipe cross-check, ACT-05 edges and the actor sound census
4. Task 3: `525cb43` docs(02-44): ACT-05 actor sound evidence, the decision H routing table, the restage line and decision rows 472 to 485

## Requirements

- ACT-05: Pending (row 484). 21 of 1,000 listed NPC bundles sealed; skill bundles stay route gaps; characters wait for 02-40; listening is the owner's.

## Verification

- `test_combat_audio_recipe_unresolved_routing.py` 4 OK, `test_combat_role_routes.py` 13 OK, `test_actor_sound_bindings.py` 18 OK, `test_native_combat_audio.py` OK.
- `pnpm vitest run tests/unit/combatAudioRoleRouting.test.ts tests/unit/nativeCombatAudio.test.ts`: 34 passed. `pnpm typecheck`: exit 0.
- `pnpm test:pipeline` at nice 10: `Ran 1688 tests`, `OK (skipped=96)`.
- `pnpm test:unit`: 2,200 passed, 1 failed: `nativeWindowLayoutTree.test.ts` real data-ui lane read timed out at 5,000 ms under the full run and passes alone (431 ms); outside this plan, logged in deferred-items.md.
- `NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-actor-audio.spec.ts` with 5173 and 5175 free: 1 passed (tracer, 30 s) and 1 passed (slice, 3.2 m). The first tracer attempt under a coreutils `timeout` wrapper crashed with Windows exit 0xC0000409 before any test ran; the plain rerun passed. Headless SwiftShader, no performance claim.
- Acceptance greps: roles all null (assert exits 0); `combat-role-route-unresolved` listed once; `combatAudioRoleRoutingDiagnostics(` 1 in `nativeCombatAudio.ts`, comment lines 0, 559 lines (was 624); column labels 0 in `combat_role_routes.py`; `previousValue` 0 in the binder, bindings, convert_actors and the two new modules; `def build_actor_sound_recipe` 1; `list(combatAudio, 8)` 0; `--actor-sounds` present; fuzzy-match grep 0 in both modules; `combat_audio_bundle` referenced in `actor_sound_bindings.py`; `combat_audio_bundle.py` unchanged; EVIDENCE has ACT-05 and decision H, 5,989 bytes, no listen-check pass wording.
- `node scripts/check-lane-ownership.mjs --base 3eff582 --part audio`, run after the last code commit `6309206` and before the docs commit: `lane actors: 0 foreign paths`, exit 0.
- `write_lane_catalog.py --lane actors` and `--plan` exit 1 (row 478; restage line in STATE.md).

## Deviations from plan

### Auto-fixed issues

1. **[Rule 1 - Bug] Census tables used the wrong row collection.** The first tracer run decoded chargrp for the census and failed on a hand-written collection map; the conversion now uses the builder's own `TABLES` collections, and decoded copies are written to the lane work folder only for tables a recipe uses. Commit `3274a3d`.
2. **[Rule 1 - Bug] Prefix checks matched the source-rule scan.** Receipt output selection used `startswith(`, which the prohibition scan refuses; it now compares path parts. Commit `3274a3d`.

### Other adjustments

- **Gap rows location (row 477).** The audio part has an unknown coverage denominator and the real-lane census refuses audio rows, so the actor sound gap rows live in `work/actor-sounds/actor-sound-gap-rows.json` (all rows validated) instead of `gap-rows/actor-sounds.json`.
- **Signatures.** `build_actor_sound_recipe(bundle_key, actor_rows, routes_by_table, recipe_inputs)` and `actor_sound_gap_rows(bundle_key, actor_rows, routes_by_table, manifest, table_identities, evidence, converter_reasons)` take the pins and identities the plan signature could not carry.
- **New modules (row 482).** `actor_sound_conversion.py` and `actor_sound_batch.py`; `convert_actors.py` is 404 lines with only the flags.
- **Census field (row 481).** `handRecipeComparison` is not in the generated census; the comparison lives in the test and the EVIDENCE table so no generator path reads `previousValue`. Route entries carry `anchors` or `detail` instead.
- **Spec scope (row 485).** One spec auditions the tracer and every sliced bundle into one report per served catalog.
- **Native numeric mapping (row 480).** Typed from the builder's documented swap, proven by a test with distinct values.
- **Report rows** carry `sourceIdentity {object, status, references, slots}`; decode or playback problems are listed per bundle (none occurred).

### Process deviations

- Task 2 behaviour was implemented with the Task 1 tracer, so its tests passed on first run and there is no RED commit (as in 02-43).

**Total deviations:** 2 auto-fixed (Rule 1), 7 adjustments, each in a decision row.

## TDD gate compliance

Task 1 tests were written first and failed (`test_combat_audio_recipe_unresolved_routing.py` 11 failures before the recipe edit; the binder and bindings tests failed on missing modules). Task 2 has no separate RED commit (above).

## Needs Human

- Restage: `write_lane_catalog.py --lane actors --plan` exits 1 with the `combat-audio/<sha>/dats/npcgrp.xml` pin refusal; the exact line is in `.planning/STATE.md` (plan 02-44). Actors lane catalog `f0ccc579...` holds 21 `actor-sounds:` records.

## Known stubs

None.

## Threat flags

None beyond the plan register: T-02-44-01 every client read goes through the Converter's lock-equal source digests or `require_equal_file_with_locked_sha256`; T-02-44-02 the builder's exact or unique-leaf rule plus a scan test; T-02-44-03 the loader's SHA-256 and 8,000,000-byte bounds stay; T-02-44-04 the report is named by the served catalog SHA and says owner listening pending; T-02-44-05 preflight before each bundle, slice limit 20, the harness closes its AudioContext; T-02-44-06 recipe marker, refusal and test; T-02-44-07 the proof is parsed only when its SHA-256 equals the pin.

## Process cleanup

- Started by this plan: foreground Python conversions and test runs, Vitest runs, and three Playwright runs, each with its own `pnpm dev` web server on 5175, which Playwright stopped.
- Check at 17:33 Riga: `netstat -ano | grep LISTENING | grep -E ':(5173|5175) '` prints nothing. `ps -W` filtered on node, chrome, headless, python, vite, playwright and umodel lists only three node.exe from Oct 29 and one python.exe from Nov 7, which predate this plan.

## Self-Check: PASSED

- FOUND: src/audio/combatAudioRoleRouting.ts, scripts/actors/combat_role_routes.py, scripts/actors/actor_sound_bindings.py, scripts/actors/actor_sound_conversion.py, scripts/actors/actor_sound_batch.py, tests/browser/sandbox-actor-audio.spec.ts, docs/parts/audio/actor-sound-census.json
- FOUND on HEAD: ccd576a, 3274a3d, 6309206, 525cb43
