---
phase: 02-stage-a-breadth
plan: 33
subsystem: actors
tags: [actors, npcs, npc-profiles, catalog-index, model-join, bounds]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-05 index join by modelCatalogId, 02-22 lane NPC conversion with npc-model: unit keys and the Python bound constants, 02-24 write_lane_catalog --plan merge command"
provides:
  - "src/assets/native/nativeNpcModelJoin.ts: joinNpcProfileToModel, NativeNpcModelJoin, NativeNpcModelJoinKind"
  - "src/assets/native/loadNativeNpcProfiles.ts: npcModelCatalogIdPattern, sharedStoreNpcProfileRecordId, maximumNpcProfileBundles, maximumProfilesPerBundle"
  - "src/assets/native/loadNativeCatalog.ts: nativeSliceNpcIds; loadNativeActorCatalog loads slice NPC models through the join"
  - "src/assets/native/nativeCatalogIndex.ts: NativeNpcCatalogRecord.join, exported readModelSourceObjects"
  - "scripts/native_actor_profiles.py: MAXIMUM_PROFILES_PER_BUNDLE 256, MAXIMUM_NPC_PROFILE_BUNDLES 64"
  - "tests/support/nativeActorCatalogFixtures.ts: fixturePlayerProfile, modelArchiveFixture, serveStoreFiles"
affects: [02-34, 02-36, 02-39, 02-55]

actuals:
  tokens: 12300
  tasks: 3
  commits: 4
plan_head_before: f7e274d1b67170be3cd04502dc813c4dffe92745
plan_head_after: 163fbd96d5816f6a91c494f4daa424479cad52b5

tech-stack:
  added: []
  patterns:
    - "One NPC profile to model join shared by the catalog index and the actor catalog loader"
    - "Legacy mesh match confined to one named catalog record and never offered unit-keyed records"
    - "Cross-language bounds pinned by a test that reads the Python source and the committed census"

key-files:
  created:
    - src/assets/native/nativeNpcModelJoin.ts
    - tests/unit/nativeNpcProfileBounds.test.ts
    - tests/support/nativeActorCatalogFixtures.ts
  modified:
    - src/assets/native/loadNativeNpcProfiles.ts
    - src/assets/native/nativeCatalogIndex.ts
    - src/assets/native/loadNativeCatalog.ts
    - scripts/native_actor_profiles.py
    - tests/unit/nativeCatalogIndex.test.ts
    - tests/unit/nativeNpcProfiles.test.ts
    - tests/unit/nativePlayerProfiles.test.ts
    - tests/unit/loadConvertedNpcModel.test.ts
    - tests/unit/sandboxCommandSheet.test.ts
    - tests/unit/sandboxMissingAsset.test.ts
    - tests/pipeline/test_native_actor_profiles.py
    - docs/parts/npcs/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/phases/01-foundations/deferred-items.md

key-decisions:
  - "Row 324: bounds 64 bundles x 256 profiles in Python and TypeScript, input-size guards covering the 6,519 npcgrp rows"
  - "Row 325: nativeSliceNpcIds = [21622], pinned to recipes/native-npc-profiles.json; the actor loader names no model id"
  - "Row 326: legacy-single-mesh-match only for the shared-store record native-npc-profiles, npc-model: records never candidates; ends with the Needs Human (plan 02-05) restage, which also switches the runtime musveren:0 reads"
  - "Row 327: several legacy mesh candidates answer not-in-catalog as today, not a thrown error"
  - "Row 328: nativeResource.test.ts stays on loadNativeActorCatalog; loadNativeCatalog was already gone"

patterns-established:
  - "NPC model selection: profile modelCatalogId, else the confined legacy match, both through joinNpcProfileToModel"

requirements-completed: []

coverage:
  - id: D1
    description: "Profiles with modelCatalogId resolve to that model; the shared-mesh pair resolves to two models; a missing id is not-in-catalog; a different mesh refuses the catalog"
    requirement: ACT-02
    verification:
      - kind: unit
        ref: "tests/unit/nativeCatalogIndex.test.ts#native catalog NPC model and character joins"
        status: pass
    human_judgment: false
  - id: D2
    description: "Legacy join confined to native-npc-profiles; other bundles refuse profiles without modelCatalogId; merged catalog keeps npc:21622 on musveren:0"
    requirement: ACT-02
    verification:
      - kind: unit
        ref: "tests/unit/nativeCatalogIndex.test.ts#keeps the shared-store npc:21622 on musveren:0 in a catalog merged with a lane pack of the same mesh"
        status: pass
      - kind: unit
        ref: "tests/unit/nativeNpcProfiles.test.ts#keeps the shared-store npc 21622 on musveren:0 in a merged catalog and requests no npc-model: archive"
        status: pass
    human_judgment: false
  - id: D3
    description: "Bounds 64 x 256 in both languages, product covers the census row count; slice ids and record id pinned to recipes"
    requirement: ACT-02
    verification:
      - kind: unit
        ref: "tests/unit/nativeNpcProfileBounds.test.ts"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_native_actor_profiles.py#ProfileBoundTests"
        status: pass
    human_judgment: false
  - id: D4
    description: "The two red nativeNpcProfiles snapshot cases pass"
    requirement: ACT-02
    verification:
      - kind: unit
        ref: "tests/unit/nativeNpcProfiles.test.ts#uses one catalog snapshot and exact hashed metadata"
        status: pass
    human_judgment: false
  - id: D5
    description: "Actors lane store resolves npc:20001 by modelCatalogId"
    requirement: ACT-02
    verification:
      - kind: integration
        ref: "tests/unit/nativeCatalogIndex.test.ts#native catalog L2-ID index on the actors lane store"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-11-09
---

# Phase 2 Plan 33: NPC profile join by model catalog id and lifted bounds Summary

**One join (`joinNpcProfileToModel`) now resolves every NPC key by the profile's `modelCatalogId`; the old mesh-name match survives only for the shared-store record `native-npc-profiles` (npc:21622 on `musveren:0`) and never sees `npc-model:` records. Profile bounds are 64 bundles of 256 profiles in both languages, the actor catalog loader names no model id, and the two red `nativeNpcProfiles` cases pass.**

## Performance

- Duration: about 12 min (2026-11-09T02:41Z to 02:53Z)
- Tasks: 3 of 3
- Files: 3 created, 16 modified

## Accomplishments

- `src/assets/native/nativeNpcModelJoin.ts` is the only place that compares a model source object with `profile.mesh` (`grep -c "=== profile.mesh" src/assets/native/nativeCatalogIndex.ts` prints 0). Index records carry `join: "model-catalog-id" | "legacy-single-mesh-match"`.
- `modelCatalogId` must match `^npc-model:[a-f0-9]{64}$` (`npcModelCatalogIdPattern`), the same pattern as `MODEL_CATALOG_ID_PATTERN` in Python. Any other value throws `Native NPC profile model catalog id is invalid.`
- A profile without `modelCatalogId` outside record `native-npc-profiles` throws `Native NPC profile <id> in bundle <record id> has no model catalog id.`
- `loadNativeActorCatalog` loads NPC profiles first, then the models joined to `nativeSliceNpcIds` (`[21622]`). `grep -c "musveren:0" src/assets/native/loadNativeCatalog.ts` prints 0. `src/runtime/createNativeSliceRuntime.ts` is unchanged: on the staged store and on any merged lane catalog the legacy join still keys the slice NPC model `musveren:0`.
- Bounds: `MAXIMUM_PROFILES_PER_BUNDLE = 256`, `MAXIMUM_NPC_PROFILE_BUNDLES = 64`. The TypeScript exports are equal (agreement test). 16,384 is at least the 6,519 npcgrp rows.

## Task commits

1. Task 1 (tracer), the modelCatalogId join through loader and index: `09cdabd` feat(02-33): join NPC profiles to models through one modelCatalogId join and confine the legacy mesh match to the shared-store bundle
2. Task 2 (TDD) RED: `0fd7525` test(02-33): add failing cases for the lifted NPC profile bounds, the slice NPC ids and the joined actor catalog models
3. Task 2 (TDD) GREEN: `11a47bf` feat(02-33): lift the NPC profile bounds to 64 bundles of 256 profiles and load slice NPC models through the profile join
4. Task 3, evidence and handoff: `163fbd9` docs(02-33): record the modelCatalogId join, the confined legacy match, the lifted bounds and the restage handoff

Tracer gate: the Task 1 verify (`pnpm typecheck` clean, 6 vitest files 143 passed) ran end to end before Task 2 started.

## Verification

- `pnpm typecheck`: clean after Task 1 and after Task 2.
- Task 1 vitest (`nativeCatalogIndex`, `loadConvertedNpcModel`, `sandboxCommandSheet`, `sandboxMissingAsset`, `nativeCatalogIndexCoverage`, `nativePowerStrikeSource`): 6 files, 143 passed. Quoted from the verbose output:
  - `✓ native catalog NPC model and character joins > refuses a profile without modelCatalogId in a bundle other than the shared-store bundle`
  - `✓ native catalog NPC model and character joins > keeps the shared-store npc:21622 on musveren:0 in a catalog merged with a lane pack of the same mesh`
  - `✓ native catalog L2-ID index on the actors lane store, skipped while that store is absent > resolves npc:20001 through its modelCatalogId 6ms` (ran, not skipped; `artifacts/lane-store/actors/l2/catalog.json` exists)
  - the staged-store case ran against read-only `public/l2` and resolves `npc:21622` with `join: "legacy-single-mesh-match"`.
- Task 2 RED: 7 TypeScript cases and 2 Python cases failed for the intended reasons, among them `expected undefined to be 128` and the two snapshot cases. GREEN: `nativeNpcProfiles`, `nativeNpcProfileBounds`, `nativeResource`, `nativePlayerProfiles`, `nativeCatalogIndex`, `loadConvertedNpcModel` and `nativeSliceWorldSource` gave 7 files, 119 passed. `nativeNpcProfiles.test.ts`: 17 of 17 (baseline: 2 failed). The six `nativeSliceRuntime*` files plus `nativePowerStrikeSource` gave 7 files, 122 passed. `python -B -m unittest discover -s tests/pipeline -p "test_native_actor_profiles.py"`: 14 OK.
- `pnpm test:unit` at 04:50 Riga (nice 10): `Test Files 142 passed | 5 skipped (147)`, `Tests 1861 passed | 82 skipped (1943)`. No failure. No 02-01 baseline failure appeared in this run.
- `node scripts/check-lane-ownership.mjs --base f7e274d --part npcs`: `lane actors: 0 foreign paths`.
- Acceptance greps: `joinNpcProfileToModel` in the index 2, `=== profile.mesh` in the index 0, `npcModelCatalogIdPattern` in the join module 2, `sharedStoreNpcProfileRecordId` in the loader 2, `musveren:0` in `loadNativeCatalog.ts` 0, `export async function loadNativeCatalog` 0, `loadNativeCatalog(` in src and tests: nothing, `records.length > 16|profiles.length > 128` 0. Every touched file is under 400 lines; the largest are `scripts/native_actor_profiles.py` at 381 and `tests/unit/nativeCatalogIndex.test.ts` at 380.
- The self-contained wording grep is empty.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Four more test files construct NPC index records**
- Found during: Task 1
- Issue: `NativeNpcCatalogRecord.join` is a required field. `sandboxCommandSheet.test.ts`, `sandboxMissingAsset.test.ts` and `loadConvertedNpcModel.test.ts` build records without it.
- Fix: those records now carry `join`. Files: those three tests. Commit: 09cdabd.

**2. [Rule 1 - Bug] `nativePlayerProfiles.test.ts` expected `musveren:0` without an NPC profile**
- Found during: Task 2
- Issue: the "fetches only the selected body/equipment and NPC" case relied on the hard-coded `musveren:0`.
- Fix: the case now expects no NPC model when no profile joins one, and it shares `fixturePlayerProfile` from the new `tests/support/nativeActorCatalogFixtures.ts`, which the NPC profile tests also use. Commit: 11a47bf.

### Plan text against the code at plan start

- `loadNativeCatalog` and its default list were already gone (02-22). The `musveren:0` literal sat in `loadNativeActorCatalog` (1 occurrence, not 2). `tests/unit/nativeResource.test.ts` never called `loadNativeCatalog`, and it passes unchanged on `loadNativeActorCatalog` (row 328).
- Several legacy candidates answer `not-in-catalog` with the existing reason. The action text said the duplicate error is thrown. The must-have says "refused as today", which is the existing not-in-catalog answer and its test (row 327).
- The plan names `tests/unit/nativeSliceRuntime.test.ts`, which does not exist. The six `nativeSliceRuntime*` files ran in its place.
- No `npc-model:20001` fixture needed a rewrite to the 64-hex form. The 02-05 shared-mesh cases were replaced with 64-hex keys, and the old short ids are now refusal cases.
- `write_lane_catalog.py --lane actors --plan` printed no merge command. It exits 1 with the 02-22 relative-pin refusal. The Needs Human line records that exact output and the command form it would print.

**Total deviations:** 2 auto-fixed, 5 plan-text clarifications. **Impact:** none on scope.

## TDD gate compliance

Task 2: RED commit `0fd7525` (test), then GREEN commit `11a47bf` (feat). RED evidence: 7 vitest failures and 2 unittest failures before the change, and all pass after it. No refactor commit.

## Known stubs

None.

## Threat flags

None beyond the plan register. T-02-3301: the bounds are exported constants that the bounds tests use; the byte bound and the hash check run before parse. T-02-3302: the pattern check, the named-model mesh guard, the bundle refusal, the `npc-model:` exclusion and the ambiguity answer. T-02-3303: the agreement test reads the Python source.

## Needs Human

- `Needs Human (plan 02-33)` in `.planning/STATE.md`: the actors `--plan` refusal (relative file pins); `scripts/stage_native_runtime.py` keeps its 128-profile check, so lane NPC profiles restage only through the merge command; the shared-store restage with `modelCatalogId` must switch the `musveren:0` reads in `src/runtime/createNativeSliceRuntime.ts` to the joined id of `nativeSliceNpcIds` in the same change.

## Requirement status

- ACT-02: stays Pending. The contract is widened for breadth, but only npc:20001 is converted, and the sandbox spawn and the lane restage are open.

## Process cleanup

- Started: foreground `tsc`, Vitest runs, one `pnpm test:unit`, Python unittest runs, and one `write_lane_catalog.py --plan`. No dev server, no Playwright, nothing in the background.
- Check at 04:53 Riga: `artifacts/scratch/02-33/list_processes.py` (Win32_Process filtered on `autonomous-roadmap`, `vitest`, `playwright` and `--port 5175`) lists only its own PowerShell query and the session shells. `netstat -ano | grep -E ":(5173|5175) .*LISTENING"` prints nothing.

## Next phase readiness

- 02-34 can write lane packs (`interlude:npc-profiles:pack-<hex>`) of up to 256 profiles each, up to 64 packs. Every profile must carry `modelCatalogId`, and the packs must leave shared-store npc ids out.

## Self-Check: PASSED

- FOUND: src/assets/native/nativeNpcModelJoin.ts, tests/unit/nativeNpcProfileBounds.test.ts, tests/support/nativeActorCatalogFixtures.ts
- FOUND: 09cdabd, 0fd7525, 11a47bf, 163fbd9 on HEAD
