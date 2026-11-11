# Audio evidence

Part `audio`, lane `actors`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: 20_20 footsteps, ambience and music are in progress.

## ACT-05 actor sounds (plan 02-44)

Status: audible labelled, owner listening pending. The report rows are evidence for owner listening and the Phase 3 check, not a verdict. ACT-05 stays Pending.

- Command: `python -B scripts/actors/convert_actors.py --client E:/Lineage2-client --actor-sounds npc:20001` for one bundle, `--batch actor-sounds --limit 20` for the next slice. Bundle keys come from the actors lane catalog in key order: NPCs, then skills by number; `--actor-sounds` refuses character keys at argument parsing (b4ba6b7).
- Each referenced Sound converts once through the guarded `Converter` audio route into a sealed `actor-sound` unit (only unchanged native WAV payloads are admitted). Each bundle is a sealed `actor-sounds` unit that runs the imported `combat_audio_bundle` builder unchanged and writes catalog record `actor-sounds:<key>` of the existing `native-combat-audio-dependencies` kind.
- Census `docs/parts/audio/actor-sound-census.json`: 21 sealed NPC bundles (the slice npc:12077, npc:12564 and npc:14001 to npc:14018 in key order, plus the tracer npc:20001 Gremlin). References: 219 unique package+leaf candidates, 0 exact identities, 0 unresolved, 3 empty slots. Listed bundles: 1,000 NPC, 3,064 skill; characters skipped (`character-census-absent`, plan 02-40 has not run). From the next census write the character entry is `{count 0, skippedReason, skippedByReason}`: with the current character census `skippedReason` is null and `skippedByReason` is `{class-template-mapping-undecoded: 14}`, and `character-census-absent` applies only when the census file is missing (b4ba6b7).
- A skill whose binding has no exact skillsoundgrp row is sealed as an `actor-sounds` bundle ledger unit whose gap row is `no-exact-skillsound-row` with the receipt as evidence; bounded `--batch actor-sounds` slices skip it, and the next actor-sound census counts it in `sealedBundles` (33a3c12).
- Gap rows (one or more per bundle, every row through `validate_gap_row`): `artifacts/lane-store/actors/work/actor-sounds/actor-sound-gap-rows.json`. Every NPC bundle carries `combat-role-route-unresolved:npcgrp/attackVoice`.
- Report: `artifacts/lane-store/actors/audio-reports/f0ccc57981bbea24b9416dec4f6c33e603bd4f4fbb69634e414e7fd2e9cab133.json` (served lane catalog SHA-256), 21 bundles, 219 rows `{key, sourceIdentity, played, peak}`, all `played: true` with finite peaks from 0.5506 to 1.2550. The tracer report for npc:20001 alone is `e00eb4b2....json` (6 rows). Runs used headless SwiftShader, so no performance claim.
- The npcgrp `sound_vol` and `sound_radius` labels stay swapped through the builder's native mapping (the Gremlin manifest carries soundRadius 50, soundVolume 250, soundRandom 70).
- Refusal reasons of the sound conversion and the bundle builder are path-free (`<source>`, `<output>`) like the other converter routes, and a bundle resealed without a manifest or without a sound row loses its `actor-sounds` combatAudio record (9297264, b587d05; `tests/pipeline/test_actor_sound_refusal_reasons.py`, `test_actor_sound_bundle_reseal.py`).
- `export-native-sounds.py` reads strict JSON (32 MiB cap), SHA-256, reparse refusal and confined portable paths from their shared owners (15f79ef). Its implementation fingerprint now also pins `native_store/store_paths.py`, so `run.json` fingerprints of earlier exports no longer match: an existing sound output needs a fresh destination or `--reuse-from`.

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
- ACT-05 breadth: 979 NPC bundles and every skill bundle wait for later slices; skill bundles stay route gaps until a proof anchor names the skillsoundgrp members; player characters have no bundle route until their profiles are written (`character-sound-bundle-not-built`).
- Per-actor `actor-sounds:<key>` bundles are still not loaded at spawn (SC2e): plan 02-80 owns the spawned actor sound module and 02-87 wires it on spawn (ACT-05).
- 5,269 sounds, 250 music files and 45 voice files with a labelled listen check (CHECK-02). Tiles other than 20_20 have no audible check yet.
- The 21 sealed bundles in the actors lane store were built before the builder recorded the decoded table reader provenance by `path` (`out_of_bundle_reader_provenance` in `scripts/native_assets_lib/combat_audio_bundle.py`). Their manifests still name `{file: dats/npcgrp.xml, sha256}`, which the lane catalog writer reads as a bundle file pin and refuses (row 478). The builder change alters their fingerprint, so `convert_actors.py --batch actor-sounds` reseals them: the batch decides skip or redo through `UnitLedger.is_sealed` on the bundle fingerprint, and each resealed bundle replaces its own `combatAudio` record. A rebuilt bundle pins only the manifest and the WAV files it holds (`tests/pipeline/test_native_combat_audio.py` `LaneStoreCombatAudioPinTests`).
- The audio part has no committed coverage denominator, so the actor sound gap rows live in the lane work folder, not in `gap-rows/` (row 477).

## Evidence

Notes: `docs/NATIVE_AUDIO.md`. Acceptance: `recipes/native-audio.acceptance.json`.
- Lane tool support for this repo is not available on DATABASE-PC yet; use plain `git worktree` until it lands.
- Tests: `tests/pipeline/test_combat_audio_recipe_unresolved_routing.py`, `test_combat_role_routes.py`, `test_actor_sound_bindings.py`, `test_actor_sound_refusal_reasons.py`, `test_actor_sound_bundle_reseal.py`, `tests/unit/combatAudioRoleRouting.test.ts`, `tests/unit/nativeCombatAudio.test.ts`, `tests/browser/sandbox-actor-audio.spec.ts`, `tests/browser/world-tile-audio.spec.ts`.
- Count differences to check in the decoder inventory: 435 vs 433 `.utx`, `chargrp` has 15 rows.
- The 02-23 tiles sweep is plan 02-70, which runs after 02-16 (wave 9; OVERNIGHT-DECISIONS row 303). 02-23 is complete with Tasks 1 and 2 (02-23-SUMMARY.md).
