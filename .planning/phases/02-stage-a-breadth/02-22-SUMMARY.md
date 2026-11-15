---
phase: 02-stage-a-breadth
plan: 22
subsystem: actors
tags: [actors, npcgrp, converter, unit-ledger, lane-store, harness, playwright, gap-rows]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-21 census units and conversion_unit_key, 02-03 catalog writer calling form, 02-05 modelCatalogId NPC join, 02-06 NATIVE_STORE_ROOT and load-check records, 02-09 guarded Converter digests, 02-02 unit ledger and gap rows"
  - phase: 01-foundations
    provides: "01-14 sandbox NPC visual and the native slice runtime (read only; the sandbox step stays open)"
provides:
  - "scripts/actors/npc_requests.py: npc_model_request, npc_profile_recipe, serialized_animation_reference, animation_reference_gap_reason, label_npc_sound_identities, npc_effect_binding_record"
  - "scripts/actors/convert_actors.py: convert_npc, main; CLI `--client <root> [--output <dir>] [--umodel <path>] --npc <id>`; ledger steps npc-model and npc-profile, gap step npc-sound-identities"
  - "scripts/actors/npc_store_records.py: converted_model_store_files_and_record, profile_bundle_store_files_and_record"
  - "native_actor_profiles: modelCatalogId on profile rows, UnresolvedActorDefaultError, MAXIMUM_PROFILES_PER_BUNDLE, MAXIMUM_NPC_PROFILE_BUNDLES"
  - "src/assets/native/loadNativeCatalog.ts loadNativeModelPackages; src/assets/native/loadConvertedNpcModel.ts loadConvertedNpcModel"
  - "tests/browser/harness/native-npc.html?npc=<id> with window.__nativeNpcHarness {ready, snapshot, play}"
  - "recipes/actors/gap-reasons.json listVersion 2"
affects: [02-24, 02-33, 02-34, 02-36, 02-39, 02-43, 02-44, 02-55]

actuals:
  tokens: 20200
  tasks: 3
  commits: 3
plan_head_before: 5046428fc94ccf40780789e17e4c80a829c898b3
plan_head_after: 6e07236e78b6fd1183731e1685a19e7cdb7b5bc9

tech-stack:
  added: []
  patterns:
    - "NPC requests and profile recipes generated from decoded rows; no hand-typed recipe is read"
    - "Profile-to-model join only through modelCatalogId = the census unit key"
    - "Ledger receipts list a step-folder copy of the converter archive, since receipt outputs sit under l2/ or work/"
    - "Sealed reruns rewrite each npc key's gap row from the sealed receipt, so units shared by several rows stay correct"

key-files:
  created:
    - scripts/actors/npc_requests.py
    - scripts/actors/convert_actors.py
    - scripts/actors/npc_store_records.py
    - src/assets/native/loadConvertedNpcModel.ts
    - tests/pipeline/test_npc_requests.py
    - tests/unit/loadConvertedNpcModel.test.ts
    - tests/browser/harness/native-npc.html
    - tests/browser/harness/nativeNpcHarness.ts
    - tests/browser/sandbox-npc-gremlin.spec.ts
  modified:
    - scripts/native_actor_profiles.py
    - src/assets/native/loadNativeCatalog.ts
    - recipes/actors/gap-reasons.json
    - docs/parts/npcs/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Row 277: one models record per (mesh, ordered textures), id = unit key; the request cites the unit's first npcgrp row"
  - "Row 278: texture_name[i] binds material slot i, unverified presentation in the request limitations"
  - "Row 279: spawn by id on the harness page; the sandbox spawn stays open"
  - "Row 280: profile recipe, manifest and npcProfiles record id interlude:npc-profiles:<npcId>"
  - "Row 281: nameTable is the file name of the census npcname path"
  - "Row 282: actors gap reasons listVersion 2 adds four reasons; three plan reasons already sit in the seed list"
  - "Row 283: the npc-model receipt lists a step-folder copy of the archive"
  - "Row 284: npc-model fingerprint over lock inputs plus the request without the animation reference, the Converter hash and the UModel pin"
  - "Row 285: sound and effect identities in sound-and-effect-identities.json; sound fields match _sound plus digits; one npc-sound-identities gap row per key"
  - "Row 286: class packages read by UELib are in the bundle manifest sourceFiles, not the receipt inputs"
  - "Row 287: the lane catalog is not pinned; write_lane_catalog refuses the profile manifest's relative file pins (Needs Human)"
  - "Row 288: ReferenceClientLockError propagates unsealed; an unreadable sound package is labelled sound-package-refused"
  - "Row 289: screenshots in artifacts/npc-evidence/"
  - "Row 290: ACT-02 stays Pending"
  - "Row 291: the gap mapping landed with the tracer; the Task 2 commit holds its tests"

patterns-established:
  - "Lane NPC conversion: census unit, generated request, sealed npc-model unit, generated profile, sealed npc-profile unit, then models and npcProfiles records"

requirements-completed: []

coverage:
  - id: D1
    description: "npc:20001 converted from its decoded rows into the actors lane store with a generated request and profile, joined by modelCatalogId"
    requirement: ACT-02
    verification:
      - kind: integration
        ref: "python -B scripts/actors/convert_actors.py --client E:/Lineage2-client --npc 20001"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_npc_requests.py#NpcModelRequestTests"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_npc_requests.py#NpcProfileRecipeTests"
        status: pass
    human_judgment: false
  - id: D2
    description: "npc:20001 spawns by id on the harness page with meshes, a skeleton and 8 native clips; load-check pass record"
    requirement: ACT-02
    verification:
      - kind: e2e
        ref: "tests/browser/sandbox-npc-gremlin.spec.ts#spawns npc:20001 by id from the actors lane store with meshes, a skeleton and native clips"
        status: pass
      - kind: unit
        ref: "tests/unit/loadConvertedNpcModel.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Gaps instead of raises: census, name row, animation reference, actor default and converter refusals; transient failures stay unsealed"
    requirement: ACT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_npc_requests.py#ConvertNpcGapTests"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_npc_requests.py#ConvertActorsGapReasonListTests"
        status: pass
    human_judgment: false
  - id: D4
    description: "Gremlin sound identity labels and the attack effect binding record"
    requirement: ACT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_npc_requests.py#SoundIdentityLabelTests"
        status: pass
    human_judgment: false
  - id: D5
    description: "npc:20002 labelled marker at 1440 x 900 and 932 x 430, no horizontal scroll at 430 x 932"
    requirement: ACT-02
    verification:
      - kind: e2e
        ref: "tests/browser/sandbox-npc-gremlin.spec.ts (three marker cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "In-sandbox spawn of npc:20001 (last D-E step)"
    requirement: ACT-02
    human_judgment: true
    rationale: "Open by design: needs integration wiring in src/runtime/createNativeSliceRuntime.ts and a served catalog with base and lane records"

duration: 31min
completed: 2026-11-09
---

# Phase 2 Plan 22: Actors tracer npc:20001 Gremlin Summary

**npc:20001 Gremlin converts from its decoded npcgrp and npcname rows through the pinned Converter into the actors lane store (model `npc-model:0f7fff4b...`, animation set from the mesh's serialized reference `LineageMonsters.gremlin_anim`, 8 clips), its generated profile joins the model by `modelCatalogId`, and it spawns by id on the harness page with native clips and a pass load-check record; npc:20002 shows a labelled marker. The lane catalog cannot be pinned yet: the profile manifest's relative file pins are refused by the integration catalog writer.**

## Performance

- Duration: about 31 min (2026-11-08T23:45Z to 2026-11-09T00:16Z)
- Tasks: 3 of 3
- Files: 9 created, 7 modified

## Accomplishments

- `python -B scripts/actors/convert_actors.py --client E:/Lineage2-client --npc 20001` prints `npc-model` pass and `npc-profile` pass in about 45 s on a cold converter; the rerun prints both with `cacheHit: true` and the lane catalog SHA-256 stays `2961c011...0731`.
- The model archive `1c3a4092...bda5` (1,858,071 bytes, asset manifest v2, 17 animation events) carries 8 clips: atk01, atkwait, run, Wait, Walk, death, deathwait, SpWait01.
- Profile values come from the `LineageMonster.gremlin` class defaults: drawScale 1.0, drawScale3D [1, 1, 1], collisionRadius 10.0, collisionHeight 15.0, prePivot unsupported.
- Sound identities (receipt output `work/npc__20001/npc-profile/sound-and-effect-identities.json`):
  - `attack_sound1[0]` empty
  - `defense_sound1[0..2]` `MonSound.Hit_Wet_4`, `MonSound.Hit_normal_3`, `MonSound.Hit_Bone_8`: unique-package-leaf-candidate (`monsound.Public_Hit_Wet.Hit_Wet_4`, `monsound.Public_Hit_Normal.Hit_Normal_3`, `monsound.Public_Hit_Bone.Hit_Bone_8`)
  - `damage_sound[0..2]` `MonSound.gremlin_dmg_1` to `_3`: unique-package-leaf-candidate (`monsound.gremlin.gremlin_dmg_1` to `_3`)
  - `sound_vol` 50.0 and `sound_radius` 250.0 copied with the swap note; no `sound-identity-unresolved` row
- Effect binding: `attack_effect` = `LineageEffect.p_u002_a`, `binding-record-only`.
- npc:20002 marker text: `npc:20002 not-in-catalog: not in catalog` (the lane store has no coverage report, so the index answers not-in-catalog).

## Task commits

1. Task 1 (tracer), row to rendered model with clips: `ebe0527` feat(02-22): convert npc:20001 Gremlin from its decoded rows into the actors lane store and spawn it by id with native clips
2. Task 2 (TDD), gaps, sound labels, effect binding, npc:20002 marker: `909db03` test(02-22): listed gaps for census, name, animation, actor-default and converter refusals, Gremlin sound labels, and the npc:20002 marker at three viewports
3. Task 3, evidence: `6e07236` docs(02-22): record the npc:20001 Gremlin tracer, its sound and effect identities, the npc:20002 marker and the open sandbox spawn in the npcs evidence

Tracer gate: the Task 1 verify ran end to end (unittest, typecheck, vitest, the real conversion, the browser check with 5173 and 5175 free) before Task 2 started.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_npc_requests.py"`: 17 OK (the E: case ran). `test_native_actor_profiles.py` 12 OK, `test_client_entry_points.py` 7 OK, `test_gap_rows.py` 11 OK.
- `pnpm typecheck`: clean. `pnpm vitest run tests/unit/loadConvertedNpcModel.test.ts tests/unit/nativeCatalogIndex.test.ts tests/unit/nativeResource.test.ts`: 52 passed.
- `NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-npc-gremlin.spec.ts` at 02:04 Riga, ports 5173 and 5175 free: 4 passed (Gremlin clips and playback, marker at 1440 x 900, marker at 932 x 430 with `isMobile` and `hasTouch`, no horizontal scroll at 430 x 932). Headless SwiftShader: no FPS claim.
- Load-check record: `artifacts/lane-store/actors/load-checks/2961c011bc33841f7e0f11b01dfd2b2ee5706005ddd3a4c8d9a12c5a40d90731.json`, `{key: "npc:20001", status: "pass", reason: null, assetManifestSchemaVersion: 2}`.
- Screenshots: `artifacts/npc-evidence/npc-20001-20002-1440x900.png`, `artifacts/npc-evidence/npc-20001-20002-932x430.png`.
- `python -B scripts/test_pipeline.py`: 1,343 tests OK, 104 skipped.
- `pnpm test:unit`: 13 failed, 1,786 passed. Rerunning the 5 failing files alone leaves the known `laneOwnership` adapter-dispatch evidence-size case and the 2 known `nativeNpcProfiles` cases ("Native player body source identity mismatch", 02-01 baseline); the rest are parallel-load timeouts. No new red.
- `node scripts/check-lane-ownership.mjs --base 5046428 --part npcs`: `lane actors: 0 foreign paths`.
- Acceptance greps: one `npc-model:` id in the lane catalog and the profile manifest carries it; `_anim['"}]` 0 in both new scripts; `require_converter_output` 2 and `require_reference_client` 2 in `convert_actors.py`; no `native-(npc-profiles|musveren|mfighter)` text in the generators; no comment or docstring in the touched Python; every touched file under 400 lines (`native_actor_profiles.py` 381); listVersion 2; EVIDENCE.md 16,064 bytes with the `npc:20001 sandbox spawn: open` line naming `createNativeSliceRuntime.ts`; `Needs Human (plan 02-22)` in STATE.md.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The lane catalog cannot be pinned**
- Found during: Task 1 (first real run)
- Issue: `write_lane_catalog.py --lane actors` (and `--plan`) refuse the npc profile manifest: it pins its bundle files as relative `{file, sha256}` records, and `catalog_writer.pinned_store_files` follows only `/l2` pins. `merge_lane_store.py` refuses the same pins (02-24).
- Fix: `convert_actors.py` writes the store and does not pin; the restage handoff is a Needs Human line with the exact refusal (row 287). The harness reads the unpinned lane catalog; `sourceCatalogSha256` is optional.
- Files: scripts/actors/convert_actors.py. Commit: ebe0527

**2. [Rule 3 - Blocking] Receipt shape and output roots**
- The ledger receipt holds exactly config, inputs, outputs and gapRows, and outputs must sit under `l2/` or `work/`. The archive is copied into the npc-model step folder and listed there (row 283); sound and effect identities are an output file (row 285); class packages are in the bundle manifest (row 286).

**3. [Rule 1 - Bug] Shared units across npc rows**
- A census unit can be shared by several npcgrp rows. The request cites the unit's first row so the fingerprint and archive do not depend on which npc ran first (row 284), and a sealed rerun rewrites the gap row for the current npc key from the receipt.

**4. [Rule 2 - Correctness] Lock errors are not converter refusals**
- `ReferenceClientLockError` subclasses `ValueError`; it now propagates and leaves the unit unsealed instead of sealing `converter-refused` (row 288).

**5. Sound field names**
- The decoded Gremlin row names its sound fields `attack_sound1`, `defense_sound1` and `damage_sound`; the plan's "ends in `_sound`" would miss two of them, so the match is `_sound` plus optional digits (row 285). Sound references are classified by the shared `reference_candidates`, which compares full objects casefolded; that is the plan's named classifier.

**6. Other clarifications**
- `loadNativeCatalog`'s caller is `loadNativeActorCatalog`; it passes its current list to `loadNativeModelPackages`.
- `convert_npc` takes an extra `store_root` (from `--output`).
- Store helpers live in `scripts/actors/npc_store_records.py` to keep `convert_actors.py` under 400 lines (317).
- Screenshots went to `artifacts/npc-evidence/` (row 289).
- An NPC id with no npcgrp row is refused (exit 1) rather than given a gap row; the census covers npcgrp rows only.
- Heavy commands ran through `nice -n 10` in Git Bash; the PowerShell tool is not available to this session.

**Total deviations:** 4 auto-fixed, 2 clarification groups. **Impact:** the tracer reaches the harness load; only the restage handoff is blocked on an integration change.

## TDD gate compliance

Task 2 is `tdd="true"`. The gap mapping, sound labels and effect record were written with the tracer in `ebe0527`, so the Task 2 tests in `909db03` passed on their first run; there is no RED commit (row 291).

## Known stubs

None.

## Threat flags

None beyond the plan's register: T-02-2201 (`require_converter_output` on `--output` and the Converter root), T-02-2202 (`require_reference_client` right after `parse_args`; `test_client_entry_points.py` green), T-02-2203 (one Converter per run, ledger seals, preflight), T-02-2204 (`?npc=` through the pattern and `npcCatalogKey`, marker by `textContent`), T-02-2205 (join by `modelCatalogId`, source-object guard, archive hash check), T-02-2206 (path-free reasons, tested with `<output>`).

## Needs Human

- Pin and restage of the actors lane store waits on the integration owner (relative file pins in npc profile manifests).
- `npc:20001 sandbox spawn: open`: runtime wiring in `src/runtime/createNativeSliceRuntime.ts` and a served catalog with base and lane records.

## Process cleanup

- Started: foreground Python conversions and unittest runs, two `scripts/test_pipeline.py` runs, Vitest runs, `tsc`, and two Playwright runs whose `pnpm dev` web server on 5175 Playwright stopped at exit. Nothing ran in the background; no manual dev server.
- Check at 02:16 Riga: `netstat -ano | grep LISTENING | grep -E ':(5173|5175) '` prints nothing. `Get-CimInstance Win32_Process` filtered on `autonomous-roadmap`, `:5173`, `--port 5175` and `playwright` (run from `artifacts/scratch/02-22/list_processes.py`) lists only the listing query and its shell. A `python -B scripts/test_pipeline.py` (PID 28308) seen at 02:15 had exited by the next listing. `ps -W` shows only the three node processes from Oct 29 (WINPID 5700, 5704, 25728), not this plan's; no chrome, headless shell, UModel or esbuild process.

## Next phase readiness

- 02-33 and 02-34 reuse `convert_npc`, the request generator and `npc_store_records` for NPC batches; 02-33 raises `MAXIMUM_NPC_PROFILE_BUNDLES` and makes the `modelCatalogId` join exclusive.
- 02-39 extends `sandbox-npc-gremlin.spec.ts` for `play-clip`; 02-43 and 02-44 read the effect binding record and the sound labels.

## Self-Check: PASSED

- FOUND: scripts/actors/npc_requests.py, scripts/actors/convert_actors.py, scripts/actors/npc_store_records.py, src/assets/native/loadConvertedNpcModel.ts, tests/pipeline/test_npc_requests.py, tests/unit/loadConvertedNpcModel.test.ts, tests/browser/harness/native-npc.html, tests/browser/harness/nativeNpcHarness.ts, tests/browser/sandbox-npc-gremlin.spec.ts
- FOUND: ebe0527, 909db03, 6e07236 on HEAD
