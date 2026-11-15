---
phase: 02-stage-a-breadth
plan: 34
subsystem: actors
tags: [npcs, unit-ledger, profile-packs, multi-slot, load-check]
requires:
  - phase: 02-21
    provides: actor unit census and unit keys
  - phase: 02-22
    provides: convert_npc, npc_model_request, npc_profile_recipe, npc_store_records
  - phase: 02-23
    provides: npcs load-check sweep spec
  - phase: 02-24
    provides: lane store merge tool (restage path)
  - phase: 02-32
    provides: sourceBinding.slotBindings
  - phase: 02-33
    provides: modelCatalogId join and 64 x 256 profile bounds
provides:
  - resumable NPC batch on the unit ledger (convert_actors.py --batch npcs --limit <n>, --print-batch-plan)
  - class-closure packing reused by 02-43 (effect_bundle_packing.py)
  - profile bundles with excludedProfiles
  - 6 NPC profile packs (1,496 profiles) and 110 models in the actors lane store
affects: [02-43, 02-44, 02-55, 02-05 restage]
actuals:
  tokens: 40000
  tasks: 3
  commits: 9
plan_head_before: 38285545bd634aafd1ca04ad421ceb58f205aa8b
plan_head_after: eb5592f484eb6edb41bf4621848f9e1ae076ccaa
tech-stack:
  added: []
  patterns:
    - "Pack membership is cut once over every scheduled row in batch order; a pack's bundle holds only rows whose model unit passed"
    - "Per-row refusals of the profile builder are checked before packs are cut, so one row never refuses a pack"
key-files:
  created:
    - scripts/actors/npc_batch.py
    - scripts/actors/effect_bundle_packing.py
    - tests/pipeline/test_npc_batch.py
    - tests/pipeline/test_effect_bundle_packing.py
  modified:
    - scripts/actors/convert_actors.py
    - scripts/actors/npc_requests.py
    - scripts/actors/npc_store_records.py
    - scripts/actors/actor_unit_inventory.py
    - scripts/native_actor_profiles.py
    - recipes/actors/gap-reasons.json
    - docs/parts/npcs/actor-unit-census.json
    - docs/parts/npcs/EVIDENCE.md
    - tests/pipeline/test_npc_requests.py
    - tests/pipeline/test_actor_census.py
    - tests/pipeline/test_native_actor_profiles.py
    - STATUS.md
key-decisions:
  - "02-34: batch order LineageMonsters.ukx first, then package path, then unit key; shared-store npc ids (21622) out of lane packs (OVERNIGHT-DECISIONS 354, 360)"
  - "02-34: packs strictly below the imported MAX_CLASSES, at most 256 profiles, cut in row order; id interlude:npc-profiles:pack-<16 hex> (355 to 357)"
  - "02-34: per-row class, inheritance and mesh identity refusals are gap rows before packs are cut; exact identity kept, case-insensitive matching left to the owner (366, 367)"
  - "02-34: batch profile gap rows use the npc-profile step the gap census orders; ledger step npc-profile-pack, algorithm version 2 (368)"
  - "02-34: a pack record replaces the single-NPC lane record of its npc ids; the slice writes the lane store unpinned (362, 363)"
requirements-completed: []
coverage:
  - id: D1
    description: "Census gives multi-texture NPC units no gap; requests bind texture index i to slot i with slotBindings"
    requirement: ACT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_npc_requests.py#test_a_multi_texture_request_binds_every_texture_index_to_its_slot_and_overrides_only_non_empty_slots"
        status: pass
      - kind: other
        ref: "python -B scripts/actors/actor_census.py --client E:/Lineage2-client --check"
        status: pass
    human_judgment: false
  - id: D2
    description: "Class-closure packing strictly below MAX_CLASSES and the batch plan"
    requirement: ACT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_effect_bundle_packing.py"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_npc_batch.py#NpcProfilePackRecipeTests"
        status: pass
    human_judgment: false
  - id: D3
    description: "Resumable slices: resume, preflight stop, failure mapping, exclusions, shared-store ids"
    requirement: ACT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_npc_batch.py"
        status: pass
      - kind: integration
        ref: "pnpm test:pipeline (1518 OK, 103 skipped)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Real slices and the npcs load-check sweep slice"
    requirement: ACT-02
    verification:
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=actors LOAD_CHECK_KIND=npcs LOAD_CHECK_LIMIT=20 pnpm test:e2e tests/browser/load-sweep-npcs.spec.ts (20 pass on catalog 9a979250)"
        status: pass
    human_judgment: true
    rationale: "ACT-02 stays Pending: 142 of 429 units are sealed, 1,943 rows wait on the owner's identity decision, and the lane store is not restaged."
duration: 2h 6m
completed: 2026-11-09
status: complete
---

# Phase 2 Plan 34: NPC breadth batch Summary

**The NPC batch converts census `npc-model` units in a fixed order through multi-slot models and packs their profiles into bundles whose class closure stays below the imported `MAX_CLASSES`. After six 20-unit slices plus the first-pack slice, the actors lane store holds 110 models and 6 profile packs with 1,496 profiles, and an npcs sweep slice records 20 passes. Every other row has one listed gap or stays pending for the same resume command.**

## Performance

- Started 2026-11-09T04:43Z (06:43 Riga). Completed 2026-11-09T06:49Z.
- Tasks: 3 of 3. Commits: 9. Files: 17 changed in code and docs. There are 4 new files.

## Accomplishments

- `python -B scripts/actors/convert_actors.py --client E:/Lineage2-client --batch npcs --limit 20` is the resume command. `--print-batch-plan` prints 429 units, 5,083 scheduled rows and 13 packs, and writes nothing. The largest pack closure is 53 classes against a limit of 96. `--limit 0` is refused by argparse with exit 2.
- Census: `multi-slot-binding-unsupported` is gone. 429 `npc-model` units are convertible, 204 are gaps, and the npc rows split into 5,084 pending and 1,435 gap. Counting the units whose reason is `multi-slot-binding-unsupported` prints 0.
- Packs written, with profiles and classes (catalog `9a97925016665e9b0aefed5083fb4010eb4d7ea534c6b154c5b4b08404fa7ea1`):

  | Pack | Profiles | Classes |
  |---|---|---|
  | `pack-dd3dcd75b2d67a8c` | 255 | 34 |
  | `pack-44dee04491697db4` | 238 | 39 |
  | `pack-5c5676fe7d7eacb0` | 256 | 27 |
  | `pack-ba4b801b02ae7115` | 255 | 32 |
  | `pack-cedf47d7edde7448` | 246 | 43 |
  | `pack-5dda58bf4165fd02` | 246 | 37 |

  The first-pack run (Task 1) wrote `interlude:npc-profiles:pack-cf1a32a935682d0a` with 251 profiles and 34 classes. The row 366 fix cut the packs again and it became `pack-dd3dcd75b2d67a8c`.
- Model units: 142 sealed. 132 pass and 10 are `converter-refused`: 5 unique-bone mapping, 2 `Native wedge has no point or influences`, 2 `No diffuse material adapter for GlowModifier`, 1 ambiguous influence slots.
- Planning gaps: 1,907 rows whose class resolves only in another case and 36 rows whose mesh does, both `converter-refused`, plus 48 `npc-name-empty` rows.

## Task commits

1. Task 1 (tracer): `cb10081` feat(02-34) converts census units in batch order through multi-slot models into class-limited profile packs. The tracer gate re-ran the Task 1 verify end to end before Task 2.
2. Task 2 (TDD):
   - RED `3eaa4d8` and `be1f92c` add the tests.
   - GREEN `c5b010a` adds the excluded profiles.
   - Rule 1 fixes `c7b7a0c`, `47c80f6` and `8483462`.
   - Evidence `ff49836`.
3. Task 3: `eb5592f` docs(02-34) records the sweep slice, the final state, the decision rows and the handoffs.

## Verification

- `python -B -m unittest discover -s tests/pipeline`, all OK:
  - `test_npc_batch.py` 20
  - `test_effect_bundle_packing.py` 8
  - `test_npc_requests.py` 18
  - `test_actor_*.py` 22
  - `test_native_actor_profiles.py` 15
  - `test_client_entry_points.py` 7
  - `test_gap_rows.py` 12
  - `test_gap_census.py` 19, which reads the real lane stores
- `pnpm test:pipeline` at nice 10: `Ran 1518 tests`, `OK (skipped=103)`. The first run failed in `test_gap_census.py` on the new step name, which led to the row 368 fix.
- `python -B scripts/actors/actor_census.py --client E:/Lineage2-client --check` passes.
- Acceptance greps:
  - `grep -c MAX_CLASSES`: 0 in `effect_bundle_packing.py` and 3 in `npc_batch.py`.
  - The `\b96\b` grep prints 0 for both files.
  - `native-(npc-profiles|musveren|mfighter)` gives 0 in `convert_actors.py`, `npc_requests.py` and `effect_bundle_packing.py`. In `npc_batch.py` the shared-store recipe path appears once, as the constant that only `shared_store_npc_ids` reads.
  - Line counts, all under 400: `npc_batch.py` 391, `native_actor_profiles.py` 394, `convert_actors.py` 367, `test_npc_batch.py` 397.
  - No comments, apart from the existing shebang.
- Gap-row and manifest loop (`artifacts/scratch/02-34/batch_stats.py`):
  - Every row in `artifacts/lane-store/actors/gap-rows/*.json` passes `validate_gap_row`.
  - `npc-model`: 44 rows `converter-refused:`.
  - `npc-profile`: 1,943 rows `converter-refused:` and 48 `npc-name-empty`.
  - All 13 manifests under `l2/npc-profiles/` are free of shared-store ids, and every profile in them has `modelCatalogId`.
- Resume (`artifacts/scratch/02-34/slice_overlap.py` over the slice logs): every slice reports `already sealed by an earlier slice 0`, giving 142 distinct units over 142 conversions. The unit test `test_a_second_slice_converts_nothing_and_leaves_the_lane_store_bytes_and_times_unchanged` covers the exact rerun.
- npcs sweep slice, run at 08:43 Riga with 5173 and 5175 free:
  - Playwright reports 1 passed.
  - `artifacts/lane-store/actors/load-checks/9a979250...7ea1.json` holds 20 records, all pass with `assetManifestSchemaVersion` 2.
  - Headless SwiftShader, so no FPS claim.
- `node scripts/check-lane-ownership.mjs --base 3828554 --part npcs`: `lane actors: 0 foreign paths`.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] One row's case-different class refused a whole pack.** Found in slices 2 and 3: 238 and 255 rows sealed as `converter-refused:Actor class requires an exact qualified export identity`. The batch plan now turns such rows into gaps before packs are cut. Commit `c7b7a0c`, OVERNIGHT-DECISIONS row 366.

**2. [Rule 1 - Bug] The same failure for mesh spelling and inheritance.** Found in slice 4: 2 packs refused by 36 mesh rows. `NpcSourceIdentities.row_identity_refusal` now checks the class, the Engine.Actor and Core.Object chain and the mesh, using the builder's own message constants. Commit `47c80f6`, row 367.

**3. [Rule 1 - Bug] The gap census refused step `npc-profile-pack`.** Batch profile gap rows now use `npc-profile`, and the pack algorithm version moves to 2. Commit `8483462`, row 368.

**4. [Rule 1 - Bug] Duplicate profiles in the lane catalog.** The 02-22 record `interlude:npc-profiles:20001` and a pack both profiled npc:20001. A pack record now replaces that single-NPC record, and `--npc` refuses an id that another record already profiles. A model whose archive was reconverted replaces its record. Row 362.

**5. [Rule 3 - Blocking] The slice does not call `write_lane_catalog.py --lane actors`.** It refuses the relative pins of the profile manifests. The slice writes the lane store unpinned, and the handoff is a Needs Human line. Row 363.

**6. Signatures.** The plan's signatures could not see the rows or the name table. The code uses `npc_batch_order(census, npcgrp_rows, excluded_npc_ids)`, `npc_profile_packs(ordered_rows, closure_of, name_table)` and `npc_batch_plan(..., source_identities, ...)`. Row 361.

**7. Shared constants.** The outcome constants moved into `npc_requests.py` to avoid an import cycle. `_tool_pins` became `npc_profile_tool_pins` and is part of the pack fingerprint (row 365). The excluded-profile bundle test lives in `test_native_actor_profiles.py`, which keeps `test_npc_batch.py` under 400 lines.

**8. Run size.** The run size was 3 slices of 20 after the first pack. Slices 4, 5 and 6 ran to apply fixes 1 to 3, and the npcs sweep slice ran twice. The first sweep result, on catalog 0d9a015a, was superseded by slice 6 and does not count.

**9. Ownership check base.** The verify form `"${PLAN_COMMITS%%$'\n'*}~1"` is refused by `check-lane-ownership.mjs` with `invalid --base`. The plan-start SHA `3828554` is the same commit and was used instead.

**10. Sound identity labels.** Batch rows do not write the per-row sound identity labels that `--npc` writes. Row 364.

**Total deviations:** 4 Rule 1 bug fixes, 1 Rule 3 block, 5 adjustments. **Impact:** packs are deterministic and per-row refusals stay listed. The restage handoff is unchanged from 02-22.

## TDD gate compliance

- RED `3eaa4d8` failed on `_extract_bundle` raising `UnresolvedActorDefaultError: ... CollisionHeight`.
- RED `be1f92c` added the two batch exclusion cases. They failed with 2 failures and 1 error.
- GREEN `c5b010a` passes 16 of 16.
- The resume, refusal, failure-mapping and shared-store cases passed on their first run, because the Task 1 tracer code already held that behaviour.

## Needs Human

- Restage: `write_lane_catalog.py --lane actors --plan` exits 1 with the plan 02-22 relative-pin refusal, so no command is printed. The line in STATE.md quotes the exact error and catalog 9a979250.
- Identity: 1,907 class rows and 36 mesh rows match their export only case-insensitively (`lineagenpc.u`, `lineagenpcev.u`). The owner decides between exact and case-insensitive matching (row 367).

## Known stubs

None.

## Threat flags

None beyond the plan register:
- T-02-3401: the preflight runs before every unit and every pack.
- T-02-3402: `require_converter_output`.
- T-02-3403: one Converter per slice.
- T-02-3404: cycle refusal plus the strict closure bound.
- T-02-3405: reasons are path-free.

## Process cleanup

- Started: foreground Python slices, run through `bash` scripts in `artifacts/scratch/02-34/` and backgrounded by the harness; unittest and pipeline runs; two Playwright runs, whose `pnpm dev` web server on 5173 Playwright stopped at exit.
- Check at 08:48 Riga: `netstat -ano | grep LISTENING | grep -E ':(5173|5175) '` prints nothing.
- `Get-CimInstance Win32_Process`, filtered on `autonomous-roadmap`, `:5173`, `--port 5175`, `playwright`, `umodel` and `chrome-headless-shell` (run from `artifacts/scratch/02-34/list_processes.py`), lists only the listing's own powershell and its bash shells. No UModel, browser or node process of this plan remains.

## Next phase readiness

- Later runs continue with the resume command. 287 convertible units and 7 packs remain, and the sweep continues on later slices.
- 02-43 reuses `pack_items_by_class_closure` and `native_class_closure`.

## Self-Check: PASSED

- FOUND: scripts/actors/npc_batch.py, scripts/actors/effect_bundle_packing.py, tests/pipeline/test_npc_batch.py, tests/pipeline/test_effect_bundle_packing.py
- FOUND on HEAD: cb10081, 3eaa4d8, be1f92c, c5b010a, c7b7a0c, 47c80f6, ff49836, 8483462, eb5592f
