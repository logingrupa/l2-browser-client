---
phase: 03-stage-a-checks
plan: 39
subsystem: actors
tags: [actors, characters, hair, rm-11, gap-closure, actors-batch, rerun-chain, material-programs]
status: complete
gap_closure: true
requires:
  - phase: 03-stage-a-checks
    provides: "03-37 generated player profiles; all 14 character keys load"
provides:
  - "scripts/actors/character_hair_recipe.py and recipes/actors/character-hair-parts.json: RM-11 hair parts per mesh type, default halves, helmetgrp and hairaccessarygrp mappings for 03-30"
  - "scripts/actors/pinned_answer_files.py: one owner of pinned answer reads and lock-equal checks"
  - "Hair halves in every character request at the default appearance; the face binds face_texture[0]"
affects: [03-30, 03-38, 03-28, 03-16, 03-17, 03-19]
tech-stack:
  added: []
  patterns:
    - "Every head part is checked by bone name and parent against the body skeleton before conversion; an unmatched hair part is left out with a hair field gap"
key-files:
  created:
    - scripts/actors/character_hair_recipe.py
    - scripts/actors/pinned_answer_files.py
    - recipes/actors/character-hair-parts.json
    - tests/pipeline/test_character_hair_recipe.py
  modified:
    - scripts/actors/character_requests.py
    - scripts/actors/character_head_part_routes.py
    - scripts/actors/character_conversion.py
    - scripts/actors/character_census.py
    - scripts/actors/character_animation_family_recipe.py
    - scripts/actors/actor_unit_inventory.py
    - scripts/actors/character_player_profiles.py
    - recipes/actors/gap-reasons.json
    - docs/parts/npcs/actor-unit-census.json
    - docs/parts/player-characters/character-census.json
    - tests/browser/sandbox-characters.spec.ts
    - tests/unit/nativeSkeletalMaterials.test.ts
    - tests/support/materialProgramFixture.ts
key-decisions:
  - "Row 1231 (H1): HairStyle 0, HairColor 0, Face 0 are the default appearance until Phase 4"
  - "Row 1232 (H2): the mesh family is the package of chargrp face_mesh[0], required to be an Engine.dll family literal"
  - "Row 1233 (H3): group-less names resolve through the converter rule until RM-13"
  - "Row 1234 (H4): helmetgrp and hairaccessarygrp mappings are stored; 03-30 applies them"
  - "Row 1235 (H5): an unresolved export gaps only its half"
  - "Row 1236: a hair part whose bones the body skeleton lacks is left out; the rest of the character converts"
requirements-completed: []
duration: 62min
completed: 2026-11-17
plan_head_before: d7885cc90e4f515bbe93e2bd39daf0831d8404fe
plan_head_after: 56e200a
actuals:
  tokens: 118000
  tasks: 3
  commits: 5
---

# Phase 3 Plan 39: Character hair from the RM-11 hairgrp rule Summary

Every character request now carries the hair halves that hairgrp maps for its mesh type at the default appearance (HairStyle 0, HairColor 0, Face 0). The names, mappings and exports come from the pinned RM-11 answer, the sealed hair table manifests and the lock-equal Engine.dll and chargrp. The chargrp hair join and its 30 inventory gap units are gone. The characters and material-program batches sealed, but the union rebuild stopped on a pin refusal caused by a memory read fault. The browser check and its screenshots therefore did not run.

## Hair per class (default appearance)

| Key | Class | Result |
|---|---|---|
| 0, 1, 5, 6, 8, 9 | MFighter, FFighter, FDwarf, MElf, MMagic, FMagic | both halves bound |
| 2, 4, 11, 12, 13 | MDarkElf, MDwarf, FOrc, MShaman, FShaman | back only (front mapped None) |
| 3 | FDarkElf | front drawn; back is a gap: `skinned-part-bone-missing:Hair01..Hair13` |
| 7 | FElf | front drawn; back is a gap: `skinned-part-bone-missing:Hair01..Hair13` |
| 10 | MOrc | no hair (front None); back is a gap: `rigid-part-bone-unmatched:` (46 bones under other parents) |

- The census counts 11 hair rows bound and 3 hair gaps. Helmet is `decoded` on all 14 rows (applied by 03-30), and all 14 models and profiles are written.
- The recipe (`dfea6a6b...dce9`, 366,899 bytes) has 22 resolved halves, 6 none and 0 unresolved. Helmetgrp keys 1 to 3 each hold 134 keep and 286 hide cells. Hairaccessarygrp keys 0 to 3 hold 0, 0, 196 and 196 replace cells. Row 14 of both tables is excluded with the reason `no chargrp mesh type 14`.
- The face binds `face_texture[0]`, for example `MFighter.MFighter_m000_t00_f` on character 0.

## Tasks

1. **Recipe and tracer, 65f26a6.**
   - `character_hair_recipe.py --check` exits 0, and the MFighter halves equal the answer: exports 661 and 662, FinalBlend 310 and Texture 309.
   - The chargrp hair join (`layout_gap`, `layout_binding`, `layout_part`, `manifest_record_fields`, `layout_binding_limitation`) is deleted.
   - Tracer `--character 0`: exit 0, both halves rigid on `Bip01_head`. Free bytes were 134,137,188,352 before and 133,945,483,264 after.
2. **Inventory and census, 2e08235, 3b5a834 and 6955206.**
   - The actor census check passed before the edit. The census then went from 7,768 to 7,738 units, and only the 30 `chargrp-hair` and `chargrp-helmet` units differ.
   - Profile limitations name the default appearance and the 03-30 equipment mappings.
   - `character_census.py --check` exits 0.
3. **Hair slot test and spec, 56e200a.**
   - The FinalBlend hair slot (FB_AlphaBlend, AlphaTest, AlphaRef 5, TwoSided) binds `library-compiled` with `MATERIAL_ALPHATESTANDBLEND`, back-face culling off and a 5/255 discard. Its fields equal the converted export 310 program, and no binding code changed.
   - The spec reads no legacy recipe. It adds `sideViewRadians` and the character 0 front and side hair captures. `pnpm typecheck` passes, and the Vitest file passes 6 tests.

## Re-run chain

| Step | Command | Result |
|---|---|---|
| 1a Characters | `convert_actors.py --batch characters --limit 14` | First run: exit 0, but rows 3, 7 and 10 lost their models (hair bone mismatch, fixed in 3b5a834). Second run: exit 0, 14 pass, free bytes 132,893,458,432 before and 132,685,758,464 after |
| 1b Material programs | `convert_actors.py --material-programs-of character:N`, N = 0 to 13, run one after another | 89 pending (every character material lacked the closure stamp). All 14 exit 0, 89 pass. Free bytes 132,655,280,128 before and 132,546,482,176 after |
| 2 Lane catalog | `write_lane_catalog.py --lane actors`, then `--plan` | exit 0 and exit 0. Actors catalog `3a3a4da6...fbb12` (materialPrograms 3,423) |
| 3 Union rebuild | schedule check, then the union at BelowNormal | **exit 1**: `pinned store file SHA-256 differs from its pin e5f3598f...4d92: 5e48ce18.../model.glb`. The union stays `9f100a39...908c` |
| 4 to 7 | - | not run: union rebuild did not exit 0 |

- **Pin refusal hashes** (item 472 FOrc_m004_l model.glb, one inode with 3 links, 6,918,460 bytes):
  - Buffered read through the actors path: `457077fb...d45f`, twice.
  - Buffered read through the integration path: `e5f3598f...4d92`.
  - Unbuffered read: `e5f3598f...4d92`, equal to the pin.
  - The file on disk is intact. This is the fifth memory read fault (file cache), so per the orchestrator note the union stops here.
- Receipts gate: 15,618 receipts before and 15,660 after. Changed: 14 `characters` and 47 `material-programs`. Added: 42 `material-programs`. None are missing, and no NPC, item, skill or sound unit changed.
- `print_fingerprint_inputs.py` output is byte-equal before and after (`d133d18e...1599`). `test_converter_implementation_hash.py` passes, and `converterSha256` stays `2abf9b67...750d`.
- **Stale actors units:**
  - Before: all 15,618 receipts are stale. 15,617 carry no `converterSourcesSha256` stamp, because they were sealed before the closure stamp.
  - After: 15,557 are stale and 103 are current (14 characters and 89 material programs, closure `5cabd055...`). Stale by step: actor-sounds 6,575, items 3,684, material-programs 3,334, actor-sound 909, npc-model 539, skill-effect-root 245, skill-dispatch-class 236, npc-profile-pack 34, npc-profile 1.
  - Recommended after DB-7 merges: one `convert_actors.py --batch <kind> --limit <stale count>` per kind, held by the full re-convert hold.

## Screenshots and browser check

Not run. The union did not rebuild, so the four `03-39-character-0-hair-*` PNGs do not exist and no load-check record was written on a new union. Port 5173 was also busy (PID 20320, a vite server of this worktree started 2026-11-16 23:26, before this plan; left alone).

## GP7 lines for 03-16, 03-17 and 03-19

- The character census loses `hair-layout-undecoded` and `helmet-layout-undecoded`. Hair is `bound` at the default appearance for 11 keys, with named gaps on rows 3, 7 and 10 (above). Helmet is `decoded` (applied by 03-30).
- The actor unit census loses the 30 `chargrp-hair` and `chargrp-helmet` units (npcs EVIDENCE lines 104, 156 and 157).
- STATE follow-up "hairgrp and helmetgrp have no layout": resolved.
- ACT-01 "Missing hair/helmet layouts are explicit gaps" now reads: hair bound at a named default appearance, three hair bone gaps.
- Queue rule `hair-4dd2` now selects a key with hair, once the queue has a character rule.
- New actors gap reasons (list version 16): `hair-export-unresolved:<half>`, `hair-submesh-unlisted:<half>` and `rigid-part-bone-unmatched:<bones>`.

## Deviations from Plan

1. **[Rule 1] Hair bone mismatch dropped three whole models.** The first characters batch sealed rows 3 and 7 as `skinned-part-bone-missing` (dynamic hair with its own Hair01 to Hair13 bones). It sealed row 10 as `converter-refused: Mesh bone has no unique native parent/name mapping: bip01 pelvis`, because the converter maps every part to the root animation.
   - `character_head_part_routes.py` now checks every head part's bones (name and parent) against the body skeleton.
   - An unmatched hair part is left out with a hair field gap, and an unmatched face still leaves no request.
   - The Task 2 census gate therefore fails on rows 3, 7 and 10: their reasons are bone gaps, outside the two reasons the gate lists. Decision row 1236.
2. **Skinned hair routes.** FFighter (both halves), MMagic back, FShaman back and FDarkElf front route `skinned`: all their bones exist in the body, and they convert as body parts. Every other drawn half routes rigid. Nothing was hand-tuned.
3. **Material programs per character key.** `--batch material-programs` takes the first stale objects of all 3,423, so it would break the full re-convert hold. The 14 `--material-programs-of character:N` runs converted exactly the 89 character materials.
4. **Character batch run twice.** The first run is recorded above. The second resealed the 14 units after the route fix.
5. **Files outside the task lists:** `recipes/actors/gap-reasons.json` (three reasons). `character_lane_converter` lives in `character_hair_recipe.py` and `character_census.py` imports it, to avoid an import cycle.
6. **Ownership checks:**
   - Task 1 (player-characters): `.gitattributes` and `.planning/OVERNIGHT-DECISIONS.md` are foreign, as in 03-37.
   - Task 2 (player-characters and npcs): the decisions file is foreign.
   - Task 3: 0 foreign paths.

## Open questions for the orchestrator (IMPORTA-PC REA)

- **RM-13:** unanswered. It asks for the native selector of the mesh package family (effectivePawn+0x698), and whether StaticLoadObject resolves group-less names, and by which rule.
- **Open from RM-11:**
  - Head attachment math: our palette uses the head inverse bind matrix, while native copies the head bone to part+0xdc.
  - NCBoneSimul hair physics, which rows 3 and 7 back hair need.
  - Bones and assets for other styles, colours and faces.
  - Out-of-range HairStyle, HairColor and Face.
  - Async load completion order.
  - Helmetgrp row 14 and the hairaccessarygrp semantics.
  - The FB_AlphaBlend pair and depth-write rule (POL-04), the transparent draw order and unlit actor lighting.
  - Server appearance switching (Phase 4).
  - The FDarkElf `_u00` swap and the hide-part operation (03-30).
- **New:** the MOrc back hair skeleton places Bip01 Pelvis and 45 other bones under other parents than MOrc_m001_u does. Native draws it through its own USubSkeletalMeshInstance.

## Open follow-ups

- **Union rebuild after the memory fault:** run `node scripts/check-machine-schedule.mjs`, then `python -B scripts/native_store/write_lane_catalog.py --lane integration --union world --union actors --union data-ui`. Then sweep the touched keys with `NATIVE_STORE_ROOT=integration pnpm test:e2e tests/browser/sandbox-characters.spec.ts`, with port 5173 free; it writes the four hair screenshots. Then run `record_side_by_side_checks.py queue`.
- **03-38 (R2 legacy retirement)** comes after this plan. The spec no longer reads the legacy human recipes. 03-38 still drops the hair citations in `test_character_recipe_unresolved_values.py` and retires `recipes/native-{mfighter,ffighter,mmagic,fmagic}.json` and the rest of the 03-37 list.
- Dynamic hair (rows 3 and 7 back) and the MOrc back hair hierarchy need a native answer before they draw.

## Decisions logged

OVERNIGHT-DECISIONS rows 1231 to 1236.

## Process cleanup

- Everything this plan started ran to exit: the tracer, two character batches, 14 material-program runs, the actor and character censuses, two lane catalog runs, the union, the probes, Vitest and tsc. No Playwright run started.
- No process with `convert_actors`, `write_lane_catalog` or `vitest` remains. The only process with this worktree path is the pre-existing vite on 5173 (PID 20320 and its esbuild), which this plan did not start. Nothing listens on 5175.

## Self-Check: PASSED

- FOUND: scripts/actors/character_hair_recipe.py, scripts/actors/pinned_answer_files.py, recipes/actors/character-hair-parts.json, tests/pipeline/test_character_hair_recipe.py
- FOUND commits: 65f26a6, 2e08235, 3b5a834, 6955206, 56e200a
- `test_character_*.py`: 117 tests OK. `test_data_ui_table_manifest.py`, `test_actor_unit_inventory.py`, `test_actor_census.py`, `test_hair_table_adapter.py`, `test_dat_table_inventory.py` and `test_converter_implementation_hash.py` are OK. Vitest `nativeSkeletalMaterials.test.ts`: 6 passed.
- Task 3 gate: the Vitest part passes. The union, load-check and PNG checks fail as recorded above.
