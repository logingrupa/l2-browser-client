# Player characters evidence

Part `player-characters`, lane `actors`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

- The class join is adopted (plan 02-83, 2026-11-12): `docs/parts/player-characters/character-class-sources.json` joins each of the 14 `chargrp` character rows to one `LineageWarrior` actor class, one to one, from the locked client.
- 9 character assemblies convert with the face on the class `HeadBone` and collision from the class defaults: rows 0, 3, 4, 5, 6, 7, 10, 11, 12 (`character-model:<index>` in the actors lane catalog `5dcadf8f...`).
- No character key loads yet: every key keeps a listed gap, and the browser shows each one as the labelled missing marker with that reason (load checks below).

## ACT-01 chargrp characters (plans 02-40 and 02-83)

Generator: `scripts/actors/character_requests.py` builds each assembly request from the decoded `chargrp` row. It never reads a hand-written recipe. `scripts/actors/convert_actors.py --character <index>` and `--batch characters --limit <n>` seal one `characters` ledger unit per `character:<index>` under `artifacts/lane-store/actors/work/character__<index>/characters/`. A converted assembly becomes the models record `character-model:<index>`. The committed census is `docs/parts/player-characters/character-census.json`. It holds field names, statuses, reasons and class names only, no client bytes.

Source tables:
- `system/chargrp.dat` `2bb52de2...`, decoded through `decode_table`: 15 rows.
- `classinfo-e` `53768197...`, `hairgrp` `03df4493...` and `helmetgrp` `ace5b171...`, read from the data-ui lane store manifests. Each manifest is checked against its tables record SHA and the lock.

Class join (plan 02-83, `scripts/actors/character_class_sources.py --client E:/Lineage2-client`):
- Searched: the 39 decoded table manifests of the data-ui lane (all but `chargrp` and the three name indexes) and the 25 script packages of `system/*.u`. `nwindow.u` is refused by the package table reader (not UE2 123) and is listed with its SHA-256.
- Class defaults are read through `read_class_defaults_with_provenance` (UELib `HeadBone`, `Mesh`, `SubMeshes`) for the `Engine.Pawn` subclasses of every package whose name table holds a `chargrp` mesh name. Only `LineageWarrior.u` `747b1e7c...` does (16 classes read); no `Engine.Pawn` subclass elsewhere descends from a class that names a row.
- A class names a row when its `Mesh` or `SubMeshes` default is a `body_mesh` or `face_mesh` reference of the row. Rows 8 and 9 join through the face mesh: their `body_mesh` fields name the m003 and m005 starter meshes, and the class `SubMeshes` name m001.
- Table records: 306 records in `armorgrp` (296) and `etcitemgrp` (10) name a row mesh, and none names an `Engine.Pawn` class, so no table adds a candidate.
- Verdict `adopted`: every row has exactly one candidate class and each class names one row.

| Row | Class | CollisionRadius / CollisionHeight (class default) | Model |
|---|---|---|---|
| 0 | MFighter | 9 / 23 | converted |
| 1 | FFighter | 8 / 23.5 | `animation-reference-missing` |
| 2 | MDarkElf | 7.5 / 24 | `animation-reference-missing` (was `texture-licensee-unsupported:123/27`) |
| 3 | FDarkElf | 7 / 23.5 | converted (was 123/27) |
| 4 | MDwarf | 9 / 18 | converted |
| 5 | FDwarf | 5 / 19 | converted (was 123/27) |
| 6 | MElf | 7.5 / 24 | converted |
| 7 | FElf | 7.5 / 23 | converted |
| 8 | MMagic | 7.5 / 22.8 | `converter-refused:Rigid attachment requires one verified root-only rigid skin` (the face mesh is not a root-only rigid skin) |
| 9 | FMagic | 6.5 / 22.5 | `animation-reference-missing` |
| 10 | MOrc | 11 / 28 | converted |
| 11 | FOrc | 7 / 27 | converted |
| 12 | MShaman | 7 / 27 | converted |
| 13 | FShaman | 8 / 25.5 | `animation-reference-missing` |

Every key's `characters` step row is a gap: converted rows carry the profile reason `actor-default-unresolved:WaitAnimName` (no idle animation family is sourced), the others their model reason above. Hair and helmet stay `hair-layout-undecoded` and `helmet-layout-undecoded` on every row. The face slot stays unbound on every row: each row lists 3 `face_texture` entries and no source selects one.

Census (`--batch characters --limit 14`, 2026-11-12, exit 0): 15 rows, 1 padding (row 14), 14 keys, 9 models converted, 0 profiles written, 14 gap keys, 0 pending.

Rules the generator holds:
- Body parts follow `body_mesh1` upward with their `body_texture` fields and cite `["Char", <row>, "body_mesh", "body_meshN"]` with the texture field, even an empty one, so the converter binding check passes.
- The row 0 body parts equal the four body parts of `recipes/native-mfighter.json` (cross-check test only).
- The actor class comes from `classinfo-e` first, then from the committed class source result; a `not-decided` result keeps `class-template-mapping-undecoded` with the result path as evidence. The request names the class, the result path and both SHA-256 values.
- The face part takes the class `Mesh` spelling when it equals the row face mesh without regard to case; a class `Mesh` naming another mesh is `actor-default-unresolved:Mesh`. A face with several `face_texture` entries carries no table binding; the converter checks its mesh against the class `Mesh` default.
- A mesh without a serialized Animation reference stays `animation-reference-missing`. No animation set is borrowed from a class or another row.
- 17 parts give `assembly-part-limit-exceeded:17`. Two rows that share a mesh keep separate requests.

Browser (`NATIVE_STORE_ROOT=actors pnpm test:e2e tests/browser/sandbox-characters.spec.ts`, 2026-11-12 17:12 Riga, ports 5173 and 5175 free, headless SwiftShader, no FPS claim): 3 passed.
- Sweep: every census key is spawned with `spawn-character` on `/`. Each shows the marker `character:<index> gap: <reason>` equal to its census reason.
- The 14 load-check records are `failed` with that marker text. No key has a pass record.
- Screenshots at 1440 x 900 and 932 x 430 landscape (`isMobile`, `hasTouch`); paths under Evidence.
- Portrait 430 x 932 has no horizontal scroll with a character spawned.

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
| 1 (female fighter) | 8 (`LineageWarrior.FFighter` default) | 23.5 (`LineageWarrior.FFighter` default) | 8 / 23.5 | agree: the class defaults give the old numbers; the stage recipe keeps them unresolved until the restage reads the generated profile |

## Open

- Profile: no idle animation family is sourced (`actor-default-unresolved:WaitAnimName`), so no character profile is written and no key loads.
- Animation reference (rows 1, 2, 9, 13): the base body mesh names no serialized Animation; no animation name is synthesized.
- Row 8: the converter refuses the `MMagic` face as a rigid head part because the mesh is not a root-only rigid skin.
- Face texture: each row lists 3 `face_texture` entries; the slot stays unbound until a source (for example the server's face choice) selects one.
- Hair and helmet: no decoded key field joins `hairgrp`/`helmetgrp` to `chargrp`.
- The shared store still serves the old hair colour 0 and the female fighter 8 / 23.5 until the restage in STATE.md.
- `recipes/native-player-aliases-stage.json` mirrors the shared store and still lists 8 / 23.5. It changes when that store is restaged.

## Evidence

- Class source search: `docs/parts/player-characters/character-class-sources.json`, written by `python -B scripts/actors/character_class_sources.py --client E:/Lineage2-client` (plan 02-83). It lists every searched table and script package with its SHA-256, each candidate and the verdict `adopted`.
- Census: `docs/parts/player-characters/character-census.json` (`--batch characters --limit 14`, 2026-11-12).
- Generator: `scripts/actors/character_requests.py`, `scripts/actors/character_conversion.py`, `scripts/actors/character_census.py`, run through `scripts/actors/convert_actors.py --character <index>` and `--batch characters --limit <n>`.
- Recipes with decision H markers: `recipes/native-mfighter.json`, `recipes/native-ffighter.json`, `recipes/native-mmagic.json`, `recipes/native-fmagic.json`, `recipes/native-player-ffighter-stage.json`.
- Loader: `src/assets/native/loadNativePlayerProfiles.ts` (`{ profiles, unresolved }`) and `src/assets/native/loadNativeCatalog.ts` (the `has unresolved` throw).
- Pipeline tests: `tests/pipeline/test_character_class_sources.py`, `tests/pipeline/test_character_requests.py` (with the row 0 cross-check against `recipes/native-mfighter.json`), `tests/pipeline/test_character_conversion_run.py` and `tests/pipeline/test_character_recipe_unresolved_values.py`.
- Unit tests: `tests/unit/nativePlayerProfiles.test.ts` and `tests/unit/nativeCatalogIndex.test.ts`.
- Browser: `tests/browser/sandbox-characters.spec.ts`. Load checks: `artifacts/lane-store/actors/load-checks/5dcadf8f53fa16eb381cdb7c37a05e238d19ef24f4d5709ecd6d6c264e927b1d.json`.
- Screenshots: `artifacts/character-evidence/character-first-1440x900.png`, `artifacts/character-evidence/character-first-932x430.png`, `artifacts/character-evidence/characters-sweep-1440x900.png`.
- Plan records: `.planning/phases/02-stage-a-breadth/02-40-SUMMARY.md` and `02-83-SUMMARY.md`; decision rows 571 to 586 and 1035 to 1038 in `.planning/OVERNIGHT-DECISIONS.md`.
