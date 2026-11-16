---
phase: 03-stage-a-checks
plan: 27
subsystem: actors
tags: [actors, characters, chargrp, idle-animation, skinned-head-part, gap-closure, actors-batch, rerun-chain]
status: complete
gap_closure: true
requires:
  - phase: 02-stage-a-breadth
    provides: "02-83 class join and the character conversion step"
provides:
  - "scripts/actors/character_head_part_routes.py: a skinned head part whose bones all exist in the body skeleton converts as a body part; a missing bone gaps as skinned-part-bone-missing:<bones>"
  - "scripts/actors/character_idle_family_recipe.py and recipes/actors/character-idle-families.json: WaitAnimName per mesh type and weapon type from the lock-equal lineagewarrior.int (Q2), plus the root mesh animation fact (Q3)"
  - "Every character animation set is the Animation the class Mesh default (root mesh) serializes"
  - "scripts/actors/character_census.py --client [--check]"
affects: [03-28, 03-30, 03-16, 03-17]
tech-stack:
  added: []
  patterns:
    - "A generated recipe pins the verified facts file and its replay results by SHA-256 and refuses a source pin that differs from the lock"
key-files:
  created:
    - scripts/actors/character_head_part_routes.py
    - scripts/actors/character_idle_family_recipe.py
    - recipes/actors/character-idle-families.json
    - tests/pipeline/test_character_skinned_head_parts.py
    - tests/pipeline/test_character_idle_family_recipe.py
    - tests/pipeline/test_character_profile_fields.py
  modified:
    - scripts/actors/character_conversion.py
    - scripts/actors/character_requests.py
    - scripts/actors/character_census.py
    - recipes/actors/gap-reasons.json
    - docs/parts/player-characters/character-census.json
    - .gitattributes
    - tests/pipeline/test_character_requests.py
    - tests/pipeline/test_character_conversion_run.py
    - tests/pipeline/test_data_ui_table_manifest.py
key-decisions:
  - "Row 1217: a class with its WaitAnimName families keeps the profile gap actor-default-unresolved:RunAnimName (run, attack and death families are unverified, Q2b)"
  - "Row 1218: every row takes the root mesh animation (Q3 binding), not only rows 1, 2, 9 and 13"
  - "Row 1219: no client character route on idle alone; the sandbox keeps the gap marker"
requirements-completed: []
duration: 81min
completed: 2026-11-16
plan_head_before: 72949a5e180ea87fac14cc783fa2045161975e10
plan_head_after: e7fcce27c9e8dee39c6f1c7bddf4fd3f361e5ebf
actuals:
  tokens: 26000
  tasks: 3
  commits: 5
---

# Phase 3 Plan 27: Character keys (skinned head parts, idle families, root mesh animation) Summary

All 14 chargrp character models now convert (9 before). Row 8's face converts as a skinned part. Rows 1, 2, 9 and 13 take the root mesh animation from Q3. The idle families come from the lock-equal `lineagewarrior.int` through a pinned recipe (Q2). Every key still has a profile gap, because the client player profile also needs run, attack and death families, and their native selection is not verified.

## Result: characters converted of 15

- 15 chargrp rows: 14 character keys and 1 padding row (row 14, `no-mesh-in-row` on body_mesh1 to 4).
- Models converted: 14 of 14 keys (`character-model:0` to `:13`). Profiles written: 0. Gap keys: 14. Pending: 0.
- Gap reason per key (census `docs/parts/player-characters/character-census.json`):

| Key | Model | Profile gap | Other field gaps |
|---|---|---|---|
| character:0 to character:13 | converted | `actor-default-unresolved:RunAnimName` | hair `hair-layout-undecoded`, helmet `helmet-layout-undecoded` |
| row 14 | padding | - | `no-mesh-in-row` (body_mesh1 to 4) |

- Before: rows 1, 2, 9 and 13 were `animation-reference-missing`, and row 8 was `converter-refused:Rigid attachment requires one verified root-only rigid skin`. Every key had `actor-default-unresolved:WaitAnimName`.
- The face slot stays unbound on every row (3 `face_texture` entries, server-selected).

## Tasks

1. **Skinned head parts (tracer), cdba9a8.** `character_head_part_routes.py` decodes each head part's native skeleton. A root-only rigid part (every influence on bone 0) keeps the rigid HeadBone path. A skinned part whose bones (name and parent) all exist in the first body part's skeleton loses its `rigidAttachment` and merges as a body part. A missing bone seals `skinned-part-bone-missing:<bones>` (new reason, actors list version 13). A decoder refusal seals `converter-refused:<message>` on field `parts`. Tracer `convert_actors.py --character 8`: exit 0. `MMagic_m000_f` is skinned to 86 bones of `Magic.MMagic_M005_u`, missing none, and the model converts. Free bytes went from 141,181,218,816 to 141,042,778,112.
2. **Idle family recipe and root mesh animation, e243b7d and 22c6662.** `character_idle_family_recipe.py --verification-folder C:/laragon/l2b-orchestration/rea-in/20261113-roadmap-verify --client E:/Lineage2-client` writes `recipes/actors/character-idle-families.json` (sha256 `873cca92...77a5`, 20,669 bytes); `--check` exits 0.
   - It pins `verified-characters.md` `19fc5ff0...0fb6`, `q2-phase3-replay/replay-result.json` `0b3e1177...8a1b` and `q3-phase3-replay/replay-result.json` `b8c23d0e...7e3a`.
   - The source `system/lineagewarrior.int` `8d951cbc...9485` and `system/engine.dll` `4dd2f63c...5b08` must be lock-equal and equal to what the replays read.
   - It holds 14 mesh types, 98 WaitAnimName values (indexes 0 to 5 and 7), and `WT_THROW` (index 6) unresolved on every class. The getter is `APawn::GetWaitAnimName` 0x103416e0 and the jump table is 0x10481be8.
   - The generator reads only the WaitAnimName keys. The shared section parser refuses the whole section on an unrelated repeated key (`SpAtk13AnimName`), and that parser is a frozen converter source.
   - `character_requests` adds `profileFields.idleAnimations` (by weapon type, with the recipe path and SHA-256) and `rootMesh`. `character_conversion` reads the animation reference from the class `Mesh` default root mesh.
   - `.gitattributes` keeps the recipe and the census at LF, so `--check` stays byte-equal.
3. **Census CLI, batch, chain and browser, 85d3bb9 and e7fcce2.** `character_census.py --client E:/Lineage2-client [--check]`; `--check` exits 0 after the batch.

## Re-run chain

| Step | Command | Result |
|---|---|---|
| 1 Lane re-run | `convert_actors.py --client E:/Lineage2-client --batch characters --limit 14` (one background process, BelowNormal) | exit 0, last line `character:13 ... actor-default-unresolved:RunAnimName`; free bytes 139,887,562,752 before, 139,625,152,512 after (15:16:27 to 15:22:37 UTC) |
| 2 Lane catalog | `write_lane_catalog.py --lane actors`, then `--plan` | exit 0 and exit 0; actors catalog `ec4610ae...9406` (models 6,101) |
| 3 Union rebuild | `write_lane_catalog.py --lane integration --union world --union actors --union data-ui` (schedule check first, BelowNormal) | exit 0; union catalog `8ce39e0e...edd1` before, **`f081dc4ca7d269324aff53ad63ecf72a0b555192daa16b59c31be6f2851d7c6b`** after; 31 files written; free bytes 139,670,605,824 before, 139,222,142,976 after |
| 4 Touched-key sweep | `key_content_sha256_by_key` before and after | 0 touched keys of 17,845: a character key exists only through a player profile, and none is written; no sweep to run |
| 5 Queue | `record_side_by_side_checks.py queue --store-root artifacts/lane-store/integration/l2` | exit 0, counts `{}` |
| 6 Re-capture | - | not run: no touched keys |
| 7 Ingest | - | not run: no touched keys |

Receipt gate: 15,618 receipts before (`9457dc71...`) and after (`0e86847c...`). Only the 14 `characters` units changed, and none went missing or was added (`artifacts/lane-store/actors/measurements/characters-receipts-gate.json`). No NPC, item, skill or sound unit resealed. `print_fingerprint_inputs.py` output is byte-equal before and after, and `implementation_hash()` is unchanged.

## Browser

- `NATIVE_STORE_ROOT=integration pnpm test:e2e tests/browser/sandbox-characters.spec.ts` (port 5173 free): 3 failed at world entry with "Native terrain materials failed: Native preview texture catalog identity/hash/path is invalid." This is the known STATE follow-up "Default sandbox route on the integration store (03-18, P1204)". It is not caused by this plan, and the spec change made for it was reverted.
- `NATIVE_STORE_ROOT=actors pnpm test:e2e tests/browser/sandbox-characters.spec.ts` (port 5173 free, headless SwiftShader, no FPS claim): 3 passed. Every census key spawns as the marker `character:<n> gap: actor-default-unresolved:RunAnimName`.
- Screenshots: `artifacts/character-evidence/character-first-1440x900.png`, `character-first-932x430.png` and `characters-sweep-1440x900.png`. No screenshot of a converted character in idle exists, because no character key loads a model (row 1219). `artifacts/ui-evidence/03-27-character-<n>-idle-desktop.png` was not written.

## Deviations from Plan

1. **[Rule 3] Own WaitAnimName reader.** `native_animation_families.section_records` refuses the whole class section on a repeated `SpAtk13AnimName`, and that module is frozen (GP2). The generator reads only `WaitAnimName[i]=` lines and refuses a repeated WaitAnimName key with another value. It is tested.
2. **[Rule 2] Root mesh animation for every row.** Q3 states the binding is the root mesh's animation, so every row reads it from the class `Mesh` default, not only rows 1, 2, 9 and 13 (row 1218). The old test that kept the body mesh as the animation source was replaced.
3. **[Rule 2] `.gitattributes` LF pins** for the two `--check` files. This is the one path the ownership check calls foreign (`lane actors: 1 foreign paths .gitattributes`), as in 149c3ae.
4. **Profile tests split** into `tests/pipeline/test_character_profile_fields.py`, so that `test_character_requests.py` stays near 400 lines. `test_data_ui_table_manifest.py` copies the recipe into its temporary project.
5. **Spec not moved to integration.** The integration default route fails at world entry (pre-existing). The spec keeps its actors lane route.

## Open questions for the orchestrator (IMPORTA-PC REA)

- Q2 answered (WaitAnimName), and Q3 answered (root mesh animation).
- **Q2b (new):** For a player pawn, are `RunAnimName`, `Atk01AnimName` and `DeathAnimName` read through getters indexed by `CurWeaponType` like `APawn::GetWaitAnimName` 0x103416e0? Give each getter's address, or the native table if one is used. Without this, no client player profile can be written and no character key loads.
- `WaitAnimName[6]` (WT_THROW) has no key in any class section. Does the getter fall back to another index for WT_THROW?

## Open follow-ups

- Client character route: a generated player profile pack per chargrp row (idle, run, attack and death clips, collision, actor scale and forward axis from sources). It needs Q2b. 03-30 equips on a converted character and needs this route.
- The orchestrator's idle screenshot waits for that route.
- The integration default route `/` fails at world entry (STATE "Default sandbox route on the integration store"). Plans that need the union on `/` are blocked until it is fixed.
- The player-characters EVIDENCE.md still lists row 8 refused and rows 1, 2, 9 and 13 as `animation-reference-missing`. GP7 leaves that update to 03-16, 03-19 and 03-20.

## Decisions logged

OVERNIGHT-DECISIONS rows 1217, 1218 and 1219.

## Process cleanup

- Stopped everything this plan started: the tracer, the batch, the census and lane catalog runs, the union rebuild and both Playwright runs (each exited by itself).
- After the last run, nothing listens on 5173, 5175, 5178 or 5179. No process with the worktree path, `convert_actors`, `playwright` or `chrome-headless` in its command line remains.
- A Vite server on 5178 (PID 11516) ran at plan start. It was not started by this plan, was left alone, and had exited by the end.

## Self-Check: PASSED

- FOUND: scripts/actors/character_head_part_routes.py, scripts/actors/character_idle_family_recipe.py, recipes/actors/character-idle-families.json, tests/pipeline/test_character_skinned_head_parts.py, tests/pipeline/test_character_idle_family_recipe.py, tests/pipeline/test_character_profile_fields.py
- FOUND commits: cdba9a8, e243b7d, 22c6662, 85d3bb9, e7fcce2
- `python -B -m unittest discover -s tests/pipeline -p "test_character_*.py"`: 77 tests OK; `test_gap_rows.py`, `test_data_ui_table_manifest.py`, `test_catalog_index_keys.py` and `test_converter_implementation_hash.py` OK
- Task 3 gate: census `--check` exit 0, `write_lane_catalog.py --lane actors --plan` exit 0, no listener on 5173 or 5175
