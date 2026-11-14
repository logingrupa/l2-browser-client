# Audio evidence

Part `audio`, lane `actors`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: 20_20 footsteps, ambience and music are in progress.

## ACT-05 actor sounds (plan 02-44)

Status: audible labelled, owner listening pending. The report rows are evidence for owner listening and the Phase 3 check, not a verdict. ACT-05 stays Pending.

- Command: `python -B scripts/actors/convert_actors.py --client E:/Lineage2-client --actor-sounds npc:20001` (or `skill-sound-row:<n>`) for one bundle, `--batch actor-sounds --limit <pending count>` for the batch. Bundle keys: the NPCs of the actors lane catalog, then every decoded skillsoundgrp row by its 0-based ordinal; `--actor-sounds` refuses character and per-skill keys at argument parsing.
- Each referenced Sound converts once through the guarded `Converter` audio route into a sealed `actor-sound` unit (only unchanged native WAV payloads are admitted). Each bundle is a sealed `actor-sounds` unit that runs the imported `combat_audio_bundle` builder unchanged and writes catalog record `actor-sounds:<key>` of the existing `native-combat-audio-dependencies` kind.
- Census `docs/parts/audio/actor-sound-census.json`: 21 sealed NPC bundles (the slice npc:12077, npc:12564 and npc:14001 to npc:14018 in key order, plus the tracer npc:20001 Gremlin). References: 219 unique package+leaf candidates, 0 exact identities, 0 unresolved, 3 empty slots. Listed bundles: 1,000 NPC, 3,064 skill; characters skipped (`character-census-absent`, plan 02-40 has not run). From the next census write the character entry is `{count 0, skippedReason, skippedByReason}`: with the current character census `skippedReason` is null and `skippedByReason` is `{class-template-mapping-undecoded: 14}`, and `character-census-absent` applies only when the census file is missing (b4ba6b7).
- Gap rows (one or more per bundle, every row through `validate_gap_row`): `artifacts/lane-store/actors/work/actor-sounds/actor-sound-gap-rows.json`. Every NPC bundle carries `combat-role-route-unresolved:npcgrp/attackVoice`.
- Report: `artifacts/lane-store/actors/audio-reports/f0ccc57981bbea24b9416dec4f6c33e603bd4f4fbb69634e414e7fd2e9cab133.json` (served lane catalog SHA-256), 21 bundles, 219 rows `{key, sourceIdentity, played, peak}`, all `played: true` with finite peaks from 0.5506 to 1.2550. The tracer report for npc:20001 alone is `e00eb4b2....json` (6 rows). Runs used headless SwiftShader, so no performance claim.
- The npcgrp `sound_vol` and `sound_radius` labels stay swapped through the builder's native mapping (the Gremlin manifest carries soundRadius 50, soundVolume 250, soundRandom 70).
- Refusal reasons of the sound conversion and the bundle builder are path-free (`<source>`, `<output>`) like the other converter routes, and a bundle resealed without a manifest or without a sound row loses its `actor-sounds` combatAudio record (9297264, b587d05; `tests/pipeline/test_actor_sound_refusal_reasons.py`, `test_actor_sound_bundle_reseal.py`).
- `export-native-sounds.py` reads strict JSON (32 MiB cap), SHA-256, reparse refusal and confined portable paths from their shared owners (15f79ef). Its implementation fingerprint now also pins `native_store/store_paths.py`, so `run.json` fingerprints of earlier exports no longer match: an existing sound output needs a fresh destination or `--reuse-from`.

### NPC actor sound batch to completion (plan 02-78)

Run after the NPC batch of 02-78 (see the npcs EVIDENCE), so every converted NPC has its profile in the lane catalog. Disk projection before each slice from the bundle and sound unit receipts (none below the 4 GiB floor; before the last slice 4,077 bundles at 1,084,987 bytes each, 4,423,491,999 bytes, against 89,353,359,360 free).

- Slices on 2026-11-11 and 12 (Riga): 100 bundles (21:54 to 21:58), 4 x 250 (22:03 to 23:02), one slice of 4,077 (23:03 to 02:28, decision row 1022), and `--actor-sounds npc:35647` for the one key left after it. The 21 bundles of 02-44 were resealed under the current builder.
- All 5,177 profiled NPCs have a sealed `actor-sounds` unit (`docs/parts/audio/actor-sound-census.json`): 5,175 bundles with a `combatAudio` record and 2 `npc-names-no-sound` units without one (npc:13036 and npc:32131, whose npcgrp sound columns are all empty; decision row 1020). References: 46,080 unique package+leaf candidates, 0 exact identities, 76 unresolved (`sound-identity-unresolved`), 2,566 empty slots.
- Gap rows (`work/actor-sounds/actor-sound-gap-rows.json`, all through `validate_gap_row`): `combat-role-route-unresolved:npcgrp/attackVoice` 5,175, `sound-identity-unresolved` 76, `npc-names-no-sound` 2.
- Actors lane coverage on lane catalog `a1562da9aba4d7b8f9095a595a7a2e05fe8509e43079fb9c5f1bfec1f5668326` (5,175 `combatAudio`, 614 `models`, 23 `npcProfiles`, 3,064 `effectComponents`): audio 5,196 converted of 8,046 (npc-sounds 5,175 pass, 1,319 gap following their NPC, 1 pending: npc-sounds:21622, which follows npc:21622; tile-audio 21 pass from the world lane), 1,320 gap, 1,530 pending (1,398 skill-sound-row and 131 tile-audio rows wait on their own steps). `write_lane_catalog.py --lane actors --plan` prints its merge command. Free bytes after the batch: 82,335,555,584.

### Skill sound rows (plan 02-95)

One sealed `actor-sounds` unit per skillsoundgrp row, key `skill-sound-row:<n>` (0-based, the key of the 02-21 unit inventory and the 02-72 audio coverage), instead of one per skill key: the 10,649 skill keys of the actors lane use only 758 distinct rows, so per-row units write each row's WAVs once (decision row P1157). A bundle carries one selection per member or caster-indexed entry that names a sound (ids `skill-sound-row-<n>-skillsoundgrp-<role>-member-<m>` and `-caster-mesh-type-<t>`).

- Batch on 2026-11-13 (Riga 19:20 to 19:47): tracer `skill-sound-row:3` (skill 4 level 1) and the caster sample `skill-sound-row:288`, then one `--batch actor-sounds --limit 1396` process, exit 0, 1,396 keys attempted, no npc key. `npc:12077` stayed a cache hit after each binder change, so none of the 5,177 NPC units resealed.
- Census `docs/parts/audio/actor-sound-census.json`: 6,575 sealed units, 5,177 NPC (5,175 bundles with a `combatAudio` record plus the 2 `npc-names-no-sound` units npc:13036 and npc:32131) and 1,398 skill sound rows: 1,365 bundles, 11 `skill-sound-row-names-no-sound` and 22 `skillsound-row-match-ambiguous:2` (the builder selects a row by its skill id and level, which match two rows). References: 59,150 unique package+leaf candidates, 0 exact identities, 79 unresolved, 2,566 empty slots.
- Skill row gap rows: `skill-sound-caster-index-unresolved:cast` 356 and `:shot` 398, `skill-sound-member-unrouted:4` 143, `:13` 13 and `:22` 1, `sound-identity-unresolved` 3 (the data typos `SkillSound2.antaras_creak` twice and `MonSound3.antars_ground_wave`).
- Disk: 1,365 bundle folders hold 1,532,037,999 bytes (12,973 WAV copies) and the skill row work folders 483,097,774 bytes. The projection before the batch, 15,394,279,264 bytes from the measured tracer drops less the once-per-process catalog and table writes, left more than the 4 GiB floor of 21,748,654,080 free bytes; free bytes rose to 24,148,627,456 during the batch because other work on the machine released space.
- Lane catalog `d6b1d71e...` (combatAudio 6,540, effectComponents 10,649, models 6,096, npcProfiles 23); `write_lane_catalog.py --lane actors --plan` ran next, exit 0, and printed its merge command.
- The 22 ambiguous rows (11 skill id and level pairs) and the names they hold:

| Row | Skill | Names |
|---|---|---|
| 242, 1371 | 1012 level 1 | `SkillSound.recharge_cast`, `SkillSound3.decey_shot`, plus 28 caster-indexed names (both rows equal) |
| 250, 1372 | 1031 level 1 | `SkillSound4.disrupt_undead_cast`, `SkillSound.disrupt_undead_shot`, plus 28 caster-indexed names (both rows equal) |
| 342, 1373 | 1217 level 1 | `SkillSound4.greater_heal_cast`, `SkillSound4.greater_heal_shot`, plus 28 caster-indexed names (both rows equal) |
| 782, 783 | 4032 level 1 | `SkillSound.war_cry_cast`, `SkillSound.Critical_Hit_02` (both rows equal) |
| 855, 856 | 4119 level 1 | `SkillSound.curse_poison_cast`, `SkillSound.curse_poison_shot` (both rows equal) |
| 901 | 4178 level 1 | `SkillSound.flame_strike_cast`, `SkillSound.flame_strike_shot`, `SkillSound.flame_strike_explotion` |
| 902 | 4178 level 1 | the same three, plus `SkillSound.flame_strike_explotion` at DAT 12 |
| 904 | 4180 level 1 | `SkillSound4.fatal_strike_cast`, `SkillSound.Critical_Hit` |
| 905 | 4180 level 1 | `SkillSound3.battle_roar_cast`, `SkillSound.wind_strike_shot` |
| 933 | 4208 level 1 | `SkillSound.power_shot_cast`, `SkillSound.power_shot_shot`, `SkillSound.power_shot_explotion` |
| 934 | 4208 level 1 | `SkillSound3.shieldstun_cast`, `SkillSound.power_shot_shot`, `SkillSound3.shieldstun_shot` |
| 1072, 1073 | 4513 level 1 | `SkillSound.might_shot`; `SkillSound3.haste_shot` |
| 1074, 1075 | 4514 level 1 | `SkillSound3.hate_shot`; `SkillSound4.regeneration_shot` |
| 1257, 1258 | 5007 level 1 | `SkillSound6.frintessa_04` at DAT 2 and 11; `SkillSound6.frintessa_02` at DAT 2 and 11 |

### Combat sound routes (Decision H item 3, plan 02-95)

The hand-typed role map of `recipes/native-combat-audio.json` is recorded unresolved: every selection has `roles: null` and `unresolved.roles` with `combat-role-route-unresolved:<table>/<role>` and the former column as `previousValue` (audit only). `scripts/bundle-native-combat-audio.py` refuses that recipe. At runtime any combat bundle whose id is not `actor-sounds:<key>` adds one diagnostic per role, so the staged 20_20 hand bundle keeps playing with its routing labelled unresolved.

Generated routes come from `scripts/actors/combat_role_routes.py` over the decoded data-ui table manifest (SHA-checked against its `tables` record). Two sources, never both for one table and role (the binder refuses a double claim):

- `recipes/actors/combat-sound-routes.json` (plan 02-95, read by `scripts/actors/combat_sound_route_recipe.py`): the routes the 2026-11-13 verification confirmed with two lenses (decision row P1147). It pins `system/Engine.dll` 4dd2f63c (image base 0x10300000, equal to the lock entry) and records per route its serialize, selector and consumer addresses, its trigger and, per row member, the verbatim DAT ordinal with its ordinal constant and count-term number. It names no descriptor column. `scripts/actors/dat_field_ordinals.py` walks the descriptor layout over every decoded row, and a member binds to the one field whose constant and count terms match in every row.
- The Q4 proof `verify_anchors.json` (`03c3a036...`), not re-derived on 2026-11-13: npcgrp and alaudio critical only. The npcgrp binding stays byte-identical, so no NPC unit resealed.

| Table | Role | Result | Source | Field |
|---|---|---|---|---|
| skillsoundgrp | cast | bound, 3 members | recipe | DAT 2, 11, 20 (row +0x08, +0x0c, +0x10), PlaySkillSound stage 1 from SkillEffectInit 0x104fa6ad, on the effect actor |
| skillsoundgrp | shot | bound, 3 members | recipe | DAT 3, 12, 21 (row +0x14, +0x18, +0x1c), stage 2 from SkillEffectShot 0x1050ceb2 |
| chargrp | attackItem | bound | recipe | `18 + S + j` (descriptor ordinal of `attack_sound`) |
| chargrp | defense | bound | recipe | `18 + S + A + j` |
| chargrp | damage | bound | recipe | `18 + S + A + D + j` |
| chargrp | attackVoice | bound, 8 groups | recipe | `19 + S + A + D + H + sum(k<g, 1+V[k]) + j`; the group count 8 is derived from the member offsets and checked on the real rows |
| armorgrp | defense | bound | recipe | `88 + M + u32(+0x588) + u32(+0x59c) + j` |
| weapongrp | attackItem | bound | recipe | `28 + u32(+0xdc) + u32(+0xf0) + j` |
| alaudio | soulshot | bound | recipe | `EtcSound.SoulShotSound` of the lock-equal ALAudio.int 25f4e583 (SkillSound.Soul_Shot_Shot, Vol 250.0, Radius 50.0, native default volume 255.0) |
| npcgrp | attackItem, defense, damage | bound | Q4 proof | `attack_sound1`, `defense_sound1`, `damage_sound` (ordinals 8, 9, 10) |
| alaudio | critical | bound | Q4 proof | `EtcSound.CriticalSound` |
| npcgrp | attackVoice | unresolved | recipe negative | no FL2NpcData::Serialize 0x104654f0 member reaches an attack-voice consumer; the only attack-voice path reads chargrp and skips pawn+0x694 bit 0x04 (vtable-slot sweep inside Engine.dll only). The census keeps the Q4 detail |

The Q4 proof branches the recipe replaced (the chargrp and weapongrp serialization anchors, the soulshot branch token) are deleted. `tests/pipeline/test_combat_sound_route_recipe.py` re-derives every recipe ordinal from the real rows of the lock-equal client (its client-gated cases ran on DATABASE-PC): 1,398 skillsoundgrp rows of 61 fields `U,U,(S,S,S,F*6)x3,S*30,F,F`, members non-empty in 1,335, 20, 1, 1,105, 93 and 4 rows, all `Package.Name`; armorgrp 816 single-entry rows holding an empty placeholder; weapongrp 1,313 rows with 54 empty and 4 malformed entries; chargrp group 5 count 1 with an empty name in every one of its 14 class rows; the ALAudio.int soulshot values. Hand-recipe cross-check (test only): every bound route agrees with the former column on member 0; only npcgrp attackVoice is not bound.

The caster-indexed table of PlaySkillSound (row +0x74, `[row + (stage*15 + meshType)*4 + 0x38]`, DAT 29 to 43 for cast and 44 to 58 for shot) is routed by the mesh type pawn+0x698 (User::GetMeshType 0x10480bb0, verified 2026-11-13, decision row P1153): mesh types 0 to 13 bind to LineageWarrior.MFighter to FShaman, the classes of `docs/parts/player-characters/character-class-sources.json`, as cast or shot selections with the mesh class as `sourceObject`, played on the pawn. Slot 14 is empty in every row and no mesh type returns it.

## Tile world audio (02-46)

Status: audible labelled, owner listening pending. WORLD-02 stays Pending until the owner listening round and the integration wiring below.

- Route: with `?map=XX_YY`, `readSelectedTileWorldAudioRecords` (`src/assets/native/readSelectedTileWorldAudio.ts`) lists the `world-audio` resources of that tile manifest, and `loadNativeWorldAudio` dispatches each by its fetched manifest kind (`native-map-ambience`, `native-map-music`, `native-tile-placement-audio`) after the SHA-256 and length check. Without `?map=` the catalog `worldAudio` slice loads as before with strict kind equality. A selected tile without world-audio resources loads silent with the reason `no tile audio resources`.
- Check: `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-audio.spec.ts` passed twice on 2026-11-10 (2 passed, 1.8 min, port 5173 free): the phone run (932 x 430 landscape, `isMobile`, `hasTouch`, unlock by a touchscreen tap on the canvas, portrait 430 x 932 no horizontal scroll) and the desktop run (1440 x 900, unlock by a mouse click). Headless SwiftShader, so no performance claim.
- Report: `artifacts/lane-store/actors/reports/world-tile-audio-f60ce2d838a827528ae80907ed511549d84abb152904f59247f1dbb84b84bd6e.json` (served world lane catalog SHA-256, written 09:47 Riga, file SHA-256 `96c14b31...`), two entries for `tile:20_20`:
  - music: manifest `fdf8f738...`, `20_20.MusicVolume0`, `music:D03_F` original Ogg, `played: true`, music bus peak 0.0000877 (the first run read 0.000277; the track opens quietly at the pinned l2.ini MusicVolume 0.1).
  - ambience: manifest `0e3362b4...`, `20_20.AmbientSoundObject4222`, `ambsound.dungeon.d_wind_loop_21` loop, `played: true`, ambience bus peak 0.0442.
- Placement: the test stops the player at the centre of the first MusicVolume with the server stop command (`cannot-move`), then `set-animation idle` publishes that position. `move-local` cannot reach it: MusicVolume0 of 20_20 lies under the terrain and navigation only grounds a target within 0.8 m. This is a test fixture position computed from the manifest bounds, not a gameplay value.
- Silent sources: placement audio (543 placements, 15 StepSound sounds on 20_20) is loaded and parsed but not played; automatic surface footstep playback is polish (DEC-OWN-1). MusicVolume1 of 20_20 was not entered by the check.
- Sheet: the music, ambience and placement audio cards take the map path, volume, emitter and placement counts and track names from the loaded manifests and point at `scripts/world/world_audio_step.py`. Selection, looping, silence outside volumes and gain are labelled unverified or presentation. Unit tests: `tests/unit/tileWorldAudio.test.ts`, `loadNativeWorldAudio.test.ts`, `worldAudioControls.test.ts`, `worldMusic.test.ts` (on-plane MusicVolume edge).
- Known false presentation until integration: `src/runtime/**` does not yet pass `placementAudio` and `silentReason` to `setWorldAudio`, so the live sheet shows "No StepSound placement audio loaded" on a tile that has it (index rule 14; integration follow-up in STATE.md).
- This actors-lane check writes only the report above; the `tile:20_20` load-check record stays with the world lane specs (02-31, 02-45).

## Open

- Owner listening round for the tile world audio report (research A16).
- ACT-05 breadth: every converted NPC has its bundle or a listed gap (02-78 above) and every skillsoundgrp row has its sealed unit (02-95 above); player characters have no bundle route until their profiles are written (`character-sound-bundle-not-built`), although the chargrp routes are bound.
- Skill sound playback (02-95 adds no runtime playback and no random source): on the skill-cast event the runtime joins the skill id and level to `actor-sounds:skill-sound-row:<n>` the GetSkillSoundData way (the row of the level, else the level 1 row), plays the cast member slots on the init-stage effect actor and the shot member slots at the shot stage, and the caster-indexed slot of the caster mesh type on the pawn. Built in the actors lane, wired by integration with the world mixer. Slot choice stays the builder policy `slotSelection: runtime-appRand-modulo`.
- Converted coverage rule for `skill-sound-row:<n>` keys in `scripts/native_store/gap_census_derived_parts.py` (integration): the audio coverage still lists the 1,398 rows `step-pending:skill-sounds` although every row has its sealed unit.
- Caster-indexed table for casters without a mesh type: NPC pawns (pawn+0x694 bit 0x04 set) keep no User::GetMeshType value, so their caster-indexed entry stays `skill-sound-caster-index-unresolved:<stage>`; slot 14 and the server packet field that sets the mesh type stay unresolved.
- Third string members DAT 4, 13 and 22: no verified consumer reads them (`skill-sound-member-unrouted:<ordinal>`).
- Member use inside one stage: whether a stage with several non-empty members (for example cast DAT 2 and 11) plays one of them or all is not verified; the bundle carries every member slot.
- Per-actor `actor-sounds:<key>` bundles load at spawn (02-87, ACT-05): `wireSpawnedActorSounds` in `src/runtime/spawnedActorSoundWiring.ts` loads the bundle through `loadSpawnedActorSounds` (02-80) and `bindSpawnedActorSoundCues` plays each clip notify with exactly one bundle slot, once per clip pass, from that entity's own bundle. The browser run plays a notify cue on npc:14663; 591 of 5,175 bundles bind any notify (SC2e).
- Role slots of a spawned bundle (attackItem, damage, defense and the rest) never play by themselves: the binding coverage lists them as `combat-role-route-unresolved:<table>/<role>` with their slot keys until a source route exists, and lists every notify without exactly one bundle slot as unbound with its sound identity. No fallback sound plays.
- 5,269 sounds, 250 music files and 45 voice files with a labelled listen check (CHECK-02). Tiles other than 20_20 have no audible check yet.
- The actor sound gap rows live in the lane work folder, not in `gap-rows/` (row 477); the npc-sounds coverage keys (02-72) follow the NPC rows and the `combatAudio` records.

## Evidence

Notes: `docs/NATIVE_AUDIO.md`. Acceptance: `recipes/native-audio.acceptance.json`.
- Lane tool support for this repo is not available on DATABASE-PC yet; use plain `git worktree` until it lands.
- Route recipe: `recipes/actors/combat-sound-routes.json`; batch and tracer measurements: `artifacts/lane-store/actors/measurements/combat-sound-routes-tracer.json`, `combat-sound-routes-batch.json` and `combat-sound-routes-batch-stdout.jsonl` (lane outputs).
- Tests: `tests/pipeline/test_combat_sound_route_recipe.py` (client-gated re-derivation), `test_dat_field_ordinals.py`, `test_combat_audio_recipe_unresolved_routing.py`, `test_combat_role_routes.py`, `test_actor_sound_bindings.py`, `test_actor_sound_refusal_reasons.py`, `test_actor_sound_bundle_reseal.py`, `tests/unit/combatAudioRoleRouting.test.ts`, `tests/unit/nativeCombatAudio.test.ts`, `tests/unit/spawnedActorSoundCues.test.ts`, `tests/browser/sandbox-actor-audio.spec.ts`, `tests/browser/world-tile-audio.spec.ts`.
- Count differences to check in the decoder inventory: 435 vs 433 `.utx`, `chargrp` has 15 rows.
- The 02-23 tiles sweep is plan 02-70, which runs after 02-16 (wave 9; OVERNIGHT-DECISIONS row 303). 02-23 is complete with Tasks 1 and 2 (02-23-SUMMARY.md).
