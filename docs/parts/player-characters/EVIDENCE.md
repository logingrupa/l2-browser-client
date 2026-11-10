# Player characters evidence

Part `player-characters`, lane `actors`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

No character key is converted yet: every one of the 14 `chargrp` character keys is a listed gap, and the browser shows each one as the labelled missing marker with that reason.

## ACT-01 chargrp characters (plan 02-40, 2026-11-10)

Generator: `scripts/actors/character_requests.py` builds each assembly request from the decoded `chargrp` row. It never reads a hand-written recipe. `scripts/actors/convert_actors.py --character <index>` and `--batch characters --limit <n>` seal one `characters` ledger unit per `character:<index>` under `artifacts/lane-store/actors/work/character__<index>/characters/`. A converted body assembly becomes the models record `character-model:<index>`. The committed census is `docs/parts/player-characters/character-census.json`. It holds field names, statuses, reasons and class names only, no client bytes.

Source tables:
- `system/chargrp.dat` `2bb52de2...`, decoded through `decode_table`: 15 rows.
- `classinfo-e` `53768197...`, `hairgrp` `03df4493...` and `helmetgrp` `ace5b171...`, read from the data-ui lane store manifests. Each manifest is checked against its tables record SHA and the lock.

Census (`--batch characters --limit 15`, 2026-11-10):

| Count | Rows |
|---|---|
| Decoded rows | 15 |
| Padding (no body mesh, no key) | 1: row 14 |
| Character keys | 14 |
| Body assemblies converted | 8: rows 0, 4, 6, 7, 8, 10, 11, 12 (`character-model:<index>`) |
| Profiles written | 0 |
| Keys converted in the catalog index | 0 |

Gap by reason (the `characters` step row of each key):

| Reason | Keys |
|---|---|
| `class-template-mapping-undecoded` | 0, 4, 6, 7, 8, 10, 11, 12 (body converted; face, collision and profile need a class) |
| `texture-licensee-unsupported:123/27` | 2, 3, 5 (census gate, no conversion attempt) |
| `animation-reference-missing` | 1, 9, 13 (the base body mesh holds no serialized Animation reference; no animation name is synthesized) |

Rules the generator holds:
- Body parts follow `body_mesh1` upward with their `body_texture` fields and cite `["Char", <row>, "body_mesh", "body_meshN"]`.
- The row 0 body parts equal the four body parts of `recipes/native-mfighter.json` (cross-check test only).
- An empty texture leaves the slot unbound (CONV-02 magenta). An unqualified reference is `actor-default-unresolved:<field>`.
- 17 parts give `assembly-part-limit-exceeded:17`. Two rows that share a mesh keep separate requests.
- Class join: the decoded `classinfo-e` fields are `class` and `description`. Neither names a `chargrp` row or an actor class, so no row has a class. The face, the collision dimensions and the profile stay `class-template-mapping-undecoded`. A join needs the fields `chargrp_index` and `actor_class`.
- Hair and helmet: `hairgrp` records are positional int32 pair rows with no field, and `helmetgrp` records hold `key` and `pairs`. No field is shared with a `chargrp` row, so every row is `hair-layout-undecoded` and `helmet-layout-undecoded`, and no hair colour is chosen. The field proof is the 4dd2 `Engine.dll` hair loader reading (`HAIR_TABLE_FIELD_PROOF`).

Browser (`NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-characters.spec.ts`, 2026-11-10 02:1x Riga, ports 5173 and 5175 free, headless SwiftShader, no FPS claim):
- Sweep: every census key is spawned with `spawn-character` on `/`. Each shows the marker `character:<index> gap: <reason>` equal to its census reason.
- The 14 load-check records are `failed` with that marker text. No key has a pass record.
- Screenshots at 1440 x 900 and 932 x 430 landscape (`isMobile`, `hasTouch`); paths under Evidence.
- The label-only marker can sit outside the camera frame. The DOM and snapshot assertions carry the check.
- Portrait 430 x 932 has no horizontal scroll with a character spawned.

Lane catalog `64d8fcb4...` holds 121 models: NPC models plus the 8 character assemblies.

## Decision H (owner recipe audit, 2026-11-08)

Item 1, hair:
- The two hair parts of `recipes/native-mfighter.json`, `native-mmagic.json`, `native-fmagic.json` and `native-ffighter.json` no longer carry the class `Hair` colour-0 texture. Each part holds `materials: []` and `unresolved.materials {reason: hair-layout-undecoded, previousValue}`.
- The limitations say the hair texture and colour wait for `hairgrp`/`helmetgrp` (DATA-02) and the generated assemblies (ACT-01).
- The `native-pipeline-ffighter`, `-fmagic` and `-mmagic` twins point only at these recipes.
- Hair bound from `hairgrp`/`helmetgrp`: none. Unresolved: all 14 keys, with the reasons above.
- The sweep checks that no loaded character part uses one of the eight old override textures. No character loads yet, so the check has no case to run.

Item 2, female fighter collision:
- `recipes/native-player-ffighter-stage.json` profile `human-female-fighter` now holds `collisionRadius: null` and `collisionHeight: null`. Its `unresolved` block holds `actor-default-unresolved:CollisionRadius` and `actor-default-unresolved:CollisionHeight`, with the old 8 and 23.5 kept only as `previousValue`.
- `loadNativePlayerProfiles` returns `{ profiles, unresolved }`. `loadNativeActorCatalog` throws `Native player profile human-female-fighter has unresolved collisionRadius: actor-default-unresolved:CollisionRadius; ...` instead of loading a default.

| Row | Generated CollisionRadius | Generated CollisionHeight | Old value | Comparison |
|---|---|---|---|---|
| 1 (female fighter) | none: `class-template-mapping-undecoded` | none: `class-template-mapping-undecoded` | 8 / 23.5 | disagree: the generator gives no value, so the old numbers stay unconfirmed; nothing is adjusted |

## Open

- The class join: no decoded source joins a `chargrp` row to its actor class.
  - Until one does, no face, collision, alias or profile exists, and no character key converts.
  - A candidate for owner review: the actor class whose default `Mesh` equals the row's face mesh (OVERNIGHT-DECISIONS).
- Hair and helmet: no decoded key field joins `hairgrp`/`helmetgrp` to `chargrp`.
- Texture licensee 123/27 (rows 2, 3, 5) waits on the texture reader.
- Animation reference (rows 1, 9, 13): the body mesh names no animation.
- The shared store still serves the old hair colour 0 and the female fighter 8 / 23.5 until the restage in STATE.md.
- `recipes/native-player-aliases-stage.json` mirrors the shared store and still lists 8 / 23.5. It changes when that store is restaged.

## Evidence

- Census: `docs/parts/player-characters/character-census.json` (`--batch characters --limit 15`, 2026-11-10; a rerun rewrote it byte-identically with `cacheHit: true`).
- Generator: `scripts/actors/character_requests.py`, `scripts/actors/character_conversion.py`, `scripts/actors/character_census.py`, run through `scripts/actors/convert_actors.py --character <index>` and `--batch characters --limit <n>`.
- Recipes with decision H markers: `recipes/native-mfighter.json`, `recipes/native-ffighter.json`, `recipes/native-mmagic.json`, `recipes/native-fmagic.json`, `recipes/native-player-ffighter-stage.json`.
- Loader: `src/assets/native/loadNativePlayerProfiles.ts` (`{ profiles, unresolved }`) and `src/assets/native/loadNativeCatalog.ts` (the `has unresolved` throw).
- Pipeline tests: `tests/pipeline/test_character_recipe_unresolved_values.py` (7 OK) and `tests/pipeline/test_character_requests.py` (23 OK, with the row 0 cross-check against `recipes/native-mfighter.json`).
- Unit tests: `tests/unit/nativePlayerProfiles.test.ts` and `tests/unit/nativeCatalogIndex.test.ts`.
- Browser: `tests/browser/sandbox-characters.spec.ts`. Load checks: `artifacts/lane-store/actors/load-checks/64d8fcb444e4b84f8042fc314d9eac6e0073acd3ef0b9ff6944d72e3be588e9f.json`.
- Screenshots: `artifacts/character-evidence/character-first-1440x900.png`, `artifacts/character-evidence/character-first-932x430.png`, `artifacts/character-evidence/characters-sweep-1440x900.png`.
- Run logs: `artifacts/scratch/02-40/unit-final.log`, `artifacts/scratch/02-40/pipeline-final.log`, `artifacts/scratch/02-40/batch-1.log`, `artifacts/scratch/02-40/batch-2.log`.
- Plan record: `.planning/phases/02-stage-a-breadth/02-40-SUMMARY.md`; decision rows 571 to 586 in `.planning/OVERNIGHT-DECISIONS.md`.
