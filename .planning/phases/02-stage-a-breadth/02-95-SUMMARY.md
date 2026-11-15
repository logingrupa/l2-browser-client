---
phase: 02-stage-a-breadth
plan: 95
subsystem: actors-audio
tags: [combat-sound-routes, skillsoundgrp, chargrp, armorgrp, weapongrp, alaudio, dat-ordinals, actor-sounds, unit-ledger]

requires:
  - phase: 02-78
    provides: the 5,177 sealed NPC actor-sounds units and the npcgrp Q4 binding that must stay byte-identical
  - phase: 02-79
    provides: the item batch and lane catalog this batch extends
  - phase: 02-88
    provides: the free machine after the tile batch (no parallel convert load)
provides:
  - recipes/actors/combat-sound-routes.json, the pinned verified combat sound route source (Engine.dll 4dd2f63c)
  - scripts/actors/combat_sound_route_recipe.py (read_combat_sound_route_recipe) and scripts/actors/dat_field_ordinals.py (descriptor_field_ordinal_terms)
  - recipe-bound skillsoundgrp cast and shot, chargrp attackItem, defense, damage and eight attackVoice groups, armorgrp defense, weapongrp attackItem and alaudio soulshot routes
  - caster-indexed skill sound routes for mesh types 0 to 13 (LineageWarrior.MFighter to FShaman)
  - 1,398 sealed skill-sound-row:<n> actor-sounds units (1,365 bundles)
affects: [02-89, integration coverage rule, skill sound playback, actors lane restage]

actuals:
  tokens: 58460
  tasks: 3
  commits: 5
plan_head_before: 2982e2f1080de972e58471f09351478f6b0d1b56
plan_head_after: 2508170

tech-stack:
  added: []
  patterns:
    - "Route recipe members bind by ordinal terms (constant plus count-term number) matched in every decoded row, never by descriptor column name"
    - "Roles read from several row members bind to ordered member lists; the bundle carries one selection per member that names a sound"

key-files:
  created:
    - recipes/actors/combat-sound-routes.json
    - scripts/actors/combat_sound_route_recipe.py
    - scripts/actors/dat_field_ordinals.py
    - tests/pipeline/test_combat_sound_route_recipe.py
    - tests/pipeline/test_dat_field_ordinals.py
  modified:
    - .gitattributes
    - recipes/actors/gap-reasons.json
    - scripts/actors/combat_role_routes.py
    - scripts/actors/actor_sound_bindings.py
    - scripts/actors/actor_sound_conversion.py
    - scripts/actors/actor_sound_batch.py
    - tests/pipeline/test_combat_role_routes.py
    - tests/pipeline/test_actor_sound_bindings.py
    - tests/pipeline/test_actor_sound_bundle_reseal.py
    - tests/pipeline/test_actor_sound_slice_bookkeeping.py
    - docs/parts/audio/actor-sound-census.json
    - docs/parts/audio/EVIDENCE.md

key-decisions:
  - "Skill sound units per skillsoundgrp row (skill-sound-row:<n>, 1,398 rows) instead of per skill key (10,649 keys over 758 rows); the per-skill-key kind is deleted (P1157)"
  - "npcgrp and alaudio critical stay on the Q4 proof so the NPC binding stays byte-identical and no NPC unit reseals (P1158)"
  - "Roles read from several row members bind to ordered member record lists, one bundle selection per member that names a sound (P1159)"
  - "The recipe is pinned to LF in .gitattributes because its SHA-256 is in every skill-sound-row fingerprint (P1160)"
  - "The batch projection subtracts the once-per-process catalog and table writes from the measured tracer drop, with a caster-row sample (P1161)"
  - "The 2 x 15 caster-indexed table binds mesh types 0 to 13 for player casters; NPC casters keep skill-sound-caster-index-unresolved:<stage> (P1162)"

patterns-established:
  - "Binder source refusal: a table and role claimed by both the recipe and the Q4 proof is a CombatRouteSourceConflict"
  - "Recipe negatives (confirmedUnresolved) never bind even when another source would"

requirements-completed: []

coverage:
  - id: D1
    description: "Pinned verified route recipe, strict reader and DAT ordinal walk, re-derived from the real rows of the lock-equal client"
    requirement: "ACT-05"
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_combat_sound_route_recipe.py -v (17 tests, client-gated cases ran)"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_dat_field_ordinals.py"
        status: pass
    human_judgment: false
  - id: D2
    description: "Binder binds every verified route from the recipe, keeps npcgrp byte-identical, refuses double claims and the npcgrp attackVoice negative"
    requirement: "ACT-05"
    verification:
      - kind: unit
        ref: "tests/pipeline/test_combat_role_routes.py (24 tests)"
        status: pass
      - kind: other
        ref: "gate_02_95.py 2 (census routes bound, npcgrp equal to 1904cf7)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every skillsoundgrp row sealed as a skill-sound-row unit, NPC units untouched, fingerprint inputs unchanged"
    requirement: "ACT-05"
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_actor_sound_*.py (43 tests)"
        status: pass
      - kind: other
        ref: "gate_02_95.py 3 (1,398 rows and 6,575 sealed, batch exit 0, npcKeysAttempted 0, fingerprint inputs equal)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Skill sound playback on the skill-cast event and owner listening"
    verification: []
    human_judgment: true
    rationale: "This plan adds no runtime playback; playback and the listening round are later work, so ACT-05 stays Pending"

duration: 65min
completed: 2026-11-13
status: complete
---

# Phase 2 Plan 95: Verified combat sound routes and per-row skill sound units Summary

**A pinned Engine.dll 4dd2f63c route recipe, re-derived from the real DAT rows, now binds skillsoundgrp cast and shot, every chargrp role (eight voice groups), armorgrp defense, weapongrp attackItem, alaudio soulshot and the caster-indexed table for 14 player mesh types, and all 1,398 skillsoundgrp rows are sealed skill-sound-row units (1,365 bundles) without resealing any of the 5,177 NPC units.**

## Performance

- **Duration:** about 65 min
- **Started:** 2026-11-13T16:50Z (18:50 Riga)
- **Completed:** 2026-11-13T17:55Z
- **Tasks:** 3 of 3
- **Files modified:** 17

## Accomplishments

- `recipes/actors/combat-sound-routes.json` pins system/Engine.dll at 4dd2f63c (image base 0x10300000, equal to the `system/engine.dll` lock entry), the verified facts SHA-256 005bb997... and the mesh type facts SHA-256 c6425595..., with serialize, selector and consumer anchors, a trigger and the verbatim DAT ordinal, ordinal constant and count-term number of every member. It names no descriptor column. The chargrp attackVoice group count 8 is marked as derived from the member offsets (counts at +0x188 + 4g end at +0x1a8), and the client-gated test confirms eight bound groups.
- `descriptor_field_ordinal_terms` walks the descriptor layout over decoded rows (scalar readers, counted lists, wrappers, conditional blocks, MTX from the pinned definitions.xml) and reproduces every verified ordinal on the real tables: skillsoundgrp DAT 2/11/20 and 3/12/21, chargrp (18,4), (18,5), (18,6) and (19+g, 7+g), armorgrp (88,62), weapongrp (28,2).
- The binder takes the recipe and the Q4 proof; npcgrp and alaudio critical stay on the Q4 proof, and with the recipe passed in the synthetic npcgrp binding equals the old one key for key. `npc:12077` printed `cacheHit: true` after each binder change.
- Census routes: every verified role bound, npcgrp equal to 1904cf7 with attackVoice unresolved under its Q4 detail; the hand-recipe comparison reads agree on member 0 for every bound route.
- One batch (`--batch actor-sounds --limit 1396`, exit 0, 1,396 skill-sound-row keys, 0 npc keys) sealed every row. Lane catalog `d6b1d71e...` written once (combatAudio 6,540), `--plan` exit 0.

### Census against catalog records

The census lists 5,177 NPC bundles, and the actors lane catalog holds 5,175 NPC `combatAudio` records: the 2 others are `npc-names-no-sound` units (npc:13036 and npc:32131, all npcgrp sound columns empty) with no record. With the 1,365 skill bundles the catalog holds 6,540 `combatAudio` records.

### Skill sound row outcomes

- 1,365 bundles, 11 `skill-sound-row-names-no-sound`, 22 `skillsound-row-match-ambiguous:2`.
- Gap rows: `skill-sound-caster-index-unresolved:cast` 356 and `:shot` 398, `skill-sound-member-unrouted:4` 143, `:13` 13, `:22` 1, `sound-identity-unresolved` 3 (`SkillSound2.antaras_creak` twice, `MonSound3.antars_ground_wave`, the data typos the verification names).
- Store: 1,365 bundle folders, 1,532,037,999 bytes (12,973 WAV copies); skill row work folders 483,097,774 bytes.

### The 22 ambiguous rows (11 skill id and level pairs)

| Row | Skill | Names |
|---|---|---|
| 242, 1371 | 1012 level 1 | `SkillSound.recharge_cast`, `SkillSound3.decey_shot`, plus 28 caster-indexed names (rows equal) |
| 250, 1372 | 1031 level 1 | `SkillSound4.disrupt_undead_cast`, `SkillSound.disrupt_undead_shot`, plus 28 caster-indexed names (rows equal) |
| 342, 1373 | 1217 level 1 | `SkillSound4.greater_heal_cast`, `SkillSound4.greater_heal_shot`, plus 28 caster-indexed names (rows equal) |
| 782, 783 | 4032 level 1 | `SkillSound.war_cry_cast`, `SkillSound.Critical_Hit_02` (rows equal) |
| 855, 856 | 4119 level 1 | `SkillSound.curse_poison_cast`, `SkillSound.curse_poison_shot` (rows equal) |
| 901 | 4178 level 1 | `SkillSound.flame_strike_cast`, `SkillSound.flame_strike_shot`, `SkillSound.flame_strike_explotion` |
| 902 | 4178 level 1 | the same three plus `SkillSound.flame_strike_explotion` at DAT 12 |
| 904 | 4180 level 1 | `SkillSound4.fatal_strike_cast`, `SkillSound.Critical_Hit` |
| 905 | 4180 level 1 | `SkillSound3.battle_roar_cast`, `SkillSound.wind_strike_shot` |
| 933 | 4208 level 1 | `SkillSound.power_shot_cast`, `SkillSound.power_shot_shot`, `SkillSound.power_shot_explotion` |
| 934 | 4208 level 1 | `SkillSound3.shieldstun_cast`, `SkillSound.power_shot_shot`, `SkillSound3.shieldstun_shot` |
| 1072, 1073 | 4513 level 1 | `SkillSound.might_shot`; `SkillSound3.haste_shot` |
| 1074, 1075 | 4514 level 1 | `SkillSound3.hate_shot`; `SkillSound4.regeneration_shot` |
| 1257, 1258 | 5007 level 1 | `SkillSound6.frintessa_04` at DAT 2 and 11; `SkillSound6.frintessa_02` at DAT 2 and 11 |

## Task Commits

1. **Task 1: Tracer, skillsoundgrp routes from the recipe through one skill sound row** - `9c477f9` (code, tests, recipe), `aa48279` (census)
2. **Task 2: chargrp, armorgrp, weapongrp, soulshot, the npcgrp negative, caster-indexed and unrouted gaps, retired proof branches** - `71013f1` (code, tests, recipe), `2f0441d` (census)
3. **Task 3: The skill sound row batch, lane catalog, audio evidence** - `2508170` (census, evidence)

## Files Created/Modified

- `recipes/actors/combat-sound-routes.json` - pinned verified route recipe
- `scripts/actors/combat_sound_route_recipe.py` - strict recipe reader with the lock pins and the no-descriptor-name rule
- `scripts/actors/dat_field_ordinals.py` - DAT field ordinal terms over decoded rows
- `scripts/actors/combat_role_routes.py` - recipe binding, double-claim refusal, recipe negative, caster-indexed routes and unrouted fields; Q4 chargrp, weapongrp and soulshot branches deleted
- `scripts/actors/actor_sound_bindings.py` - member and caster-indexed selections, skill sound row actor rows, unrouted field gap rows; the per-skill-key path deleted
- `scripts/actors/actor_sound_conversion.py` - reads the recipe once, passes the layout, adds unrouted field gap rows
- `scripts/actors/actor_sound_batch.py` - skill-sound-row keys and no-sound rules, census `routeRecipe`, `casterIndexedRoutes`, `unroutedFields`, `bundles.skillSoundRow`
- `recipes/actors/gap-reasons.json` - listVersion 11 with the four new reasons
- `.gitattributes` - the recipe pinned to LF
- `docs/parts/audio/actor-sound-census.json`, `docs/parts/audio/EVIDENCE.md` - census and evidence (21,384 bytes)

## Decisions Made

Rows P1157 to P1162 in `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md` (key-decisions above).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Recipe pinned to LF line endings**
- **Found during:** Task 1 commit
- **Issue:** the recipe SHA-256 is in every skill-sound-row unit fingerprint, and `core.autocrlf true` would give the main checkout CRLF bytes, so the restage would reseal all 1,398 units.
- **Fix:** `recipes/actors/combat-sound-routes.json text eol=lf` in `.gitattributes`, as the lock file already is. `check-lane-ownership.mjs --base 2982e2f --part audio` reports this line as the one foreign path of the actors lane (exit 1): recorded as the step result, for integration to take at merge (P1160).
- **Commit:** `9c477f9`

**2. [Checker warning] Caster-indexed table routed for player casters**
- **Found during:** Task 2
- **Issue:** the plan kept the 2 x 15 table as a gap; the verified Q7 fact (pawn+0x698 is the mesh type 0 to 13) arrived after planning.
- **Fix:** `casterIndexedRoutes` in the recipe and binder; selections `-caster-mesh-type-<t>` with the mesh class as `sourceObject`; `skill-sound-caster-index-unresolved:<stage>` stays for casters without a mesh type; tests check every mesh class is a class default of `docs/parts/player-characters/character-class-sources.json` and slot 14 is empty in every row.
- **Commit:** `71013f1`

**3. [Rule 2 - Disk] Member selections only for members that name a sound**
- **Issue:** each selection copies the full 61-field raw row; empty members and caster entries would add tens of MB of manifest copies.
- **Fix:** member and caster-indexed selections are built only when the decoded field names a sound; single-member roles (npcgrp) keep their one selection unchanged.

**4. [Rule 3 - Measurement] Disk projection**
- **Issue:** the raw tracer drop (51,523,584 bytes) was dominated by concurrent machine writes; a cache-hit npc:12077 run that wrote no unit dropped 116,559,872 bytes.
- **Fix:** projection from the measured drop less the once-per-process catalog, coverage and table writes, with a second sample on caster row 288: 15,394,279,264 bytes against 21,748,654,080 free (P1161). Actual store use was about 2.0 GB, and free bytes rose to 24,148,627,456 during the batch.

**5. [Data fact] chargrp group 5**
- The verified fact "group 5 holds an empty name in every row" holds for the 14 class rows; row 14 is the padding row with every voice count 0. The test checks the 14 rows.

**Total deviations:** 5 (2 correctness, 1 checker warning, 1 measurement, 1 data wording). **Impact:** no frozen converter file changed and no sealed NPC unit resealed.

## Requirement status

- ACT-05: advanced, stays **Pending**. Gap SC3b converter half closed (routes bound, skill sound bundles built); playback on the skill-cast event and the owner listening round remain, so `requirements-completed` is empty.

## Open follow-ups (for 02-89, SC3b narrowed)

Each with its unblocking step:
1. Skill sound playback on the skill-cast event: the GetSkillSoundData join (level, else level 1) to `actor-sounds:skill-sound-row:<n>`, cast member slots on the init-stage effect actor, shot member slots at the shot stage, the caster-indexed slot of the caster mesh type on the pawn. Unblock: an actors lane runtime plan, then integration wiring with the world mixer.
2. Converted coverage rule for `skill-sound-row:<n>` keys in `scripts/native_store/gap_census_derived_parts.py`: the audio coverage still lists the rows `step-pending:skill-sounds`. Unblock: integration reads the sealed skill-sound-row receipts.
3. Caster-indexed entry for casters without a mesh type (NPCs, pawn+0x694 bit 0x04) and slot 14: `skill-sound-caster-index-unresolved:<stage>`. Unblock: a native answer for the NPC index path and the packet field that sets the mesh type.
4. Third members DAT 4, 13 and 22: `skill-sound-member-unrouted:<ordinal>`. Unblock: a verified consumer, or a verified negative.
5. Member use inside one stage (one or all non-empty members). Unblock: an IMPORTA-PC native session capturing a skill with two cast members.

## Needs Human

None.

## Process cleanup

Every process this plan started exited: the tracer, sample and check conversions, the batch (exit 0), both `write_lane_catalog.py` runs and the unittest runs. No listener on 5173 or 5175. One `run_below_normal.py python -B scripts/test_pipeline.py` process (PID 1420, started 19:50:51 Riga by another agent in this worktree) was running at the end; this plan did not start it and left it alone.

## Next Phase Readiness

02-89 can read SC3b as narrowed to the five items above.

## Self-Check: PASSED

- Created files exist: recipe, reader, ordinal walk, both tests, this SUMMARY.
- Commits 9c477f9, aa48279, 71013f1, 2f0441d, 2508170 are on `plan/autonomous-roadmap`.
- Gates 1, 2 and 3 print True; `git diff --stat 1904cf7` over the frozen converter files is empty; `print_fingerprint_inputs.py` output is byte-equal before and after.
