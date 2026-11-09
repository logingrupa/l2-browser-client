# Audio evidence

Part `audio`, lane `actors`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: 20_20 footsteps, ambience and music are in progress.

## ACT-05 actor sounds (plan 02-44)

Status: audible labelled, owner listening pending. The report rows are evidence for owner listening and the Phase 3 check, not a verdict. ACT-05 stays Pending.

- Command: `python -B scripts/actors/convert_actors.py --client E:/Lineage2-client --actor-sounds npc:20001` for one bundle, `--batch actor-sounds --limit 20` for the next slice. Bundle keys come from the actors lane catalog in key order (characters, then NPCs, then skills by number).
- Each referenced Sound converts once through the guarded `Converter` audio route into a sealed `actor-sound` unit (only unchanged native WAV payloads are admitted). Each bundle is a sealed `actor-sounds` unit that runs the imported `combat_audio_bundle` builder unchanged and writes catalog record `actor-sounds:<key>` of the existing `native-combat-audio-dependencies` kind.
- Census `docs/parts/audio/actor-sound-census.json`: 21 sealed NPC bundles (the slice npc:12077, npc:12564 and npc:14001 to npc:14018 in key order, plus the tracer npc:20001 Gremlin). References: 219 unique package+leaf candidates, 0 exact identities, 0 unresolved, 3 empty slots. Listed bundles: 1,000 NPC, 3,064 skill; characters skipped (`character-census-absent`, plan 02-40 has not run).
- Gap rows (one or more per bundle, every row through `validate_gap_row`): `artifacts/lane-store/actors/work/actor-sounds/actor-sound-gap-rows.json`. Every NPC bundle carries `combat-role-route-unresolved:npcgrp/attackVoice`.
- Report: `artifacts/lane-store/actors/audio-reports/f0ccc57981bbea24b9416dec4f6c33e603bd4f4fbb69634e414e7fd2e9cab133.json` (served lane catalog SHA-256), 21 bundles, 219 rows `{key, sourceIdentity, played, peak}`, all `played: true` with finite peaks from 0.5506 to 1.2550. The tracer report for npc:20001 alone is `e00eb4b2....json` (6 rows). Runs used headless SwiftShader, so no performance claim.
- The npcgrp `sound_vol` and `sound_radius` labels stay swapped through the builder's native mapping (the Gremlin manifest carries soundRadius 50, soundVolume 250, soundRandom 70).

### Decision H item 3 routing

The hand-typed role map of `recipes/native-combat-audio.json` is recorded unresolved: every selection has `roles: null` and `unresolved.roles` with `combat-role-route-unresolved:<table>/<role>` and the former column as `previousValue` (audit only). `scripts/bundle-native-combat-audio.py` refuses that recipe. At runtime any combat bundle whose id is not `actor-sounds:<key>` adds one diagnostic per role, so the staged 20_20 hand bundle keeps playing with its routing labelled unresolved.

Generated routes come from `scripts/actors/combat_role_routes.py`: the decoded data-ui table manifest (SHA-checked against its `tables` record), its descriptor field order, and the pinned route proof `verify_anchors.json` (`03c3a036...`). A field is a sound-reference field when every non-empty decoded string names a lock-equal `.uax` package.

| Table | Role | Result | Field or reason |
|---|---|---|---|
| npcgrp | attackItem | bound | `attack_sound1` (ordinal 8), anchors `GetAttackItemSound 0x1061ec50`, `FL2NpcData::Serialize 0x104654f0` |
| npcgrp | defense | bound | `defense_sound1` (ordinal 9), `GetDefenseItemSound 0x1061f0a0` plus the serialize anchor |
| npcgrp | damage | bound | `damage_sound` (ordinal 10), `GetDamageSound 0x1061f9a0` plus the serialize anchor |
| npcgrp | attackVoice | unresolved | the getter reads no npc sound member |
| chargrp | all four | unresolved | `char loader` names no sound member in DAT order |
| armorgrp | defense | unresolved | no serialization anchor |
| weapongrp | attackItem | unresolved | `item base serialize` names no sound member in DAT order |
| skillsoundgrp | cast, shot | unresolved | no serialization anchor |
| alaudio | critical | bound | `EtcSound.CriticalSound`, anchor `Action_Attack` |
| alaudio | soulshot | unresolved | the `ss` branch names no `[Section]` key |

Hand-recipe cross-check (test only, `tests/pipeline/test_combat_role_routes.py`): the bound npcgrp attackItem, defense and damage routes and the ALAudio critical route agree with the former columns; no bound route disagrees.

## Open

- ACT-05 breadth: 979 NPC bundles and every skill bundle wait for later slices; skill bundles stay route gaps until a proof anchor names the skillsoundgrp members; player characters wait for plan 02-40.
- 5,269 sounds, 250 music files and 45 voice files with a labelled listen check (CHECK-02). World ambient, placement and music audio per tile is WORLD-02 in the world part.
- The lane catalog writer refuses the generated bundles: the builder copies the decoded table reader provenance, whose `{file: dats/npcgrp.xml, sha256}` reads as a bundle file pin (OVERNIGHT-DECISIONS row 478). The restage line is in `.planning/STATE.md` (plan 02-44).
- The audio part has no committed coverage denominator, so the actor sound gap rows live in the lane work folder, not in `gap-rows/` (row 477).

## Evidence

Notes: `docs/NATIVE_AUDIO.md`. Acceptance: `recipes/native-audio.acceptance.json`.
- Lane tool support for this repo is not available on DATABASE-PC yet; use plain `git worktree` until it lands.
- Tests: `tests/pipeline/test_combat_audio_recipe_unresolved_routing.py`, `test_combat_role_routes.py`, `test_actor_sound_bindings.py`, `tests/unit/combatAudioRoleRouting.test.ts`, `tests/unit/nativeCombatAudio.test.ts`, `tests/browser/sandbox-actor-audio.spec.ts`.
- Count differences to check in the decoder inventory: 435 vs 433 `.utx`, `chargrp` has 15 rows.
- The 02-23 tiles sweep is plan 02-70, which runs after 02-16 (wave 9; OVERNIGHT-DECISIONS row 303). 02-23 is complete with Tasks 1 and 2 (02-23-SUMMARY.md).
