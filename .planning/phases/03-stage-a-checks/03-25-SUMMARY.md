---
phase: 03-stage-a-checks
plan: 25
subsystem: actors
tags: [actors, materials, skeletal, ue2-library, bone-influences, gap-closure, actors-batch, rerun-chain]
status: complete
gap_closure: true
requires:
  - phase: 03-stage-a-checks
    provides: "03-24 shared program path scripts/world/surface_material_programs.py and the stored texture image reuse"
provides:
  - "scripts/actors/actor_material_programs.py: one sealed unit material-program:<object> (step material-programs) per distinct material object of the sealed actors lane models"
  - "convert_actors.py --batch material-programs and --material-programs-of <npc:|item:|character: key>"
  - "Catalog slice materialPrograms: pinned listing records accepted by catalog_writer, the lane catalog, the union and the TS reader"
  - "src/assets/native/actorMaterialPrograms.ts: slot to program join and the slot object reader of an actor model package"
  - "UE2 library vertex stage with Babylon bone influences; skeletal slots bound through the join"
  - "src/assets/native/decodeNativeStorePng.ts: the one owner of the native store PNG decoder"
affects: [03-07, 03-09, 03-11, 03-13, 03-19, 03-36]
tech-stack:
  added: []
  patterns:
    - "A shared actors unit reads the sealed model archives (provenance) it derives from and re-extracts no model"
    - "A catalog slice record is a pinned listing manifest whose files map pins every program, graph and texture for the union walk"
key-files:
  created:
    - scripts/actors/actor_material_programs.py
    - src/assets/native/actorMaterialPrograms.ts
    - src/assets/native/decodeNativeStorePng.ts
    - tests/pipeline/test_actor_material_programs.py
    - tests/unit/actorMaterialPrograms.test.ts
    - tests/unit/decodeNativeStorePng.test.ts
    - tests/support/syntheticPngBytes.ts
    - tests/fixtures/actorMaterialProgramsFixture.ts
  modified:
    - scripts/actors/convert_actors.py
    - scripts/actors/actor_arguments.py
    - scripts/native_store/catalog_writer.py
    - scripts/native_store/unit_ledger.py
    - src/assets/native/nativeSkeletalMaterials.ts
    - src/assets/native/NativeActor.ts
    - src/assets/native/NativeCharacterVisual.ts
    - src/assets/native/nativeEquippedBodyPartItems.ts
    - src/assets/native/nativeCatalogRecords.ts
    - src/assets/native/readNativeCatalog.ts
    - src/materials/ue2/babylon/material.ts
    - src/materials/ue2/babylon/loadNativeMaterial.ts
    - src/materials/ue2/model/stagePlan.ts
    - src/runtime/createNativeSliceRuntime.ts
    - src/scene/world/staticMeshLibraryMaterials.ts
    - src/scene/world/nativeTerrainPreview.ts
    - src/scene/world/nativeFlameMaterials.ts
    - src/effects/nativeEffectTexture.ts
    - tests/browser/harness/loadCheckHarness.ts
    - tests/browser/sandbox-npc-gremlin.spec.ts
key-decisions:
  - "P1216: a slot's material object is the root the converter resolved (unsupportedMaterialAdapter.object, else nativeMaterialGraph[0].object, else texture) from the sealed archive provenance"
  - "P1217: material-program units write no key-level gap rows; reasons live in the unit product, the listing and the slot inspection; recipes/actors/gap-reasons.json unchanged"
  - "P1218: a materialPrograms record is a pinned listing manifest record, like tiles, tables and windows"
  - "P1219: the apostrophe joins the unit key and material program id alphabets (LineageWeaponsTex.knife_o'_silenus...)"
  - "P1220: one library vertex source for every mesh: finalWorld through bonesDeclaration and bonesVertex, then viewProjection"
  - "P1221: NativeActor.create, nativeCharacterFactory and NativeEquippedBodyPartItems take the served catalog's ActorMaterialPrograms"
  - "P1222: a skeletal slot whose program compiles to a diagnostic plan keeps its converted texture material (as P1215 for static meshes)"
requirements-completed: []
requirements-addressed: [MAT-01, MAT-02]
metrics:
  duration: 1h 30m
  completed: 2026-11-14
  tasks: 3
  files: 52
estimate:
  tokens: 100000
  tasks: 3
actuals:
  tokens: 47100
  tasks: 3
  commits: 7
plan_head_before: 9c0347b051a795eac27ba1722c3623a1a1af4809
plan_head_after: 4ffcb7b6ca7ce40ecb7b1c4b8d2665dc935fbba7
---

# Phase 3 Plan 25: Shared skeletal material programs and the skinned library vertex stage Summary

Every material object named by a sealed actors lane model now converts once. Each becomes one shared `material-program:<object>` unit, made through the program path that 03-24 built for BSP and static meshes, and the units sit in a new `materialPrograms` catalog slice. At runtime, a skinned NPC, item or character slot whose program compiles draws through the UE2 library, and the library vertex stage applies the mesh skeleton's bone influences.

One batch sealed 3,375 units in 21.5 minutes with exit 0; with the tracer and the timing run, 3,381 objects are sealed. Of these, 3,348 have ported roots and 33 are gaps. No model unit was extracted or sealed again.

## What was built

- **Unit kind (task 1, cfa0993).** `scripts/actors/actor_material_programs.py` reads each sealed model archive in the actors lane catalog:
  - It checks the archive against its pin and reads `provenance.json`.
  - For each slot it takes the root object the converter resolved: `unsupportedMaterialAdapter.object`, else `nativeMaterialGraph[0].object`, else `texture`. An assembly joins its parts' slots in glTF material order.
  - The inventory counts each object once, without regard to case.
  - Each unit runs `material_program_outcome` from the 03-24 shared module with the actors sources: MapSources, the actors converter folder, the actors class scripts and the actors store.
  - It writes a listing `native-materials/material-program-<sha256>.json`. The listing holds `sourceObject`, the `program` pin, `rootPorted`, `gapReasons` and a `files` map that pins the program, graph and texture files.
  - It seals a product that holds the catalog record. The unit fingerprint covers the material package lock records plus `{sourceObject, converterSha256}`.
- **Batch and single-key form.** `convert_actors.py --batch material-programs --limit N` and `--material-programs-of <npc:|item:|character: key>`; an `npc:` key is resolved through the profile `modelCatalogId`. After the units, the run publishes one catalog record per sealed object in the inventory. It does this even when a preflight stop ends the run.
- **Catalog slice.** `KNOWN_CATALOG_SLICES` gains `materialPrograms`, a pinned manifest record shape:
  - id `material-program:<UE2 object path>`;
  - manifest `/l2/native-materials/material-program-<sha256>.json`, at most 1,000,000 bytes.

  The lane catalog check and the union follow the listing's files map. An unknown slice is still refused (union test), and no catalog key kind is added.
- **TS join.**
  - `readNativeCatalog` reads the slice, and `readMaterialProgramCatalogRecord` validates a record.
  - `actorMaterialProgramsOfCatalog` joins a slot object, without regard to case, to its program. Otherwise it returns `actor-slot-material-none`, `actor-slot-material-unlisted`, the listing gap reasons or `actor-material-program-invalid:<message>`. It fetches each listing once.
  - `readActorModelSlotSourceObjects` reads the same slot rule from the package provenance, or returns `absent`.
- **Skinned vertex stage and binding (task 2, 30293e4 and f51aba4).**
  - The library vertex source computes `finalWorld = world`, includes Babylon `bonesDeclaration` and `bonesVertex`, and draws `viewProjection * finalWorld * position`. An unskinned mesh compiles with `NUM_BONE_INFLUENCERS 0`, so BSP, static mesh and diagnostic materials keep the same math.
  - `bindSkeletalSlotMaterials` joins each slot by its glTF material index (`/materials/<n>`) to the provenance slot object.
  - Only a compiled plan replaces the slot material. A slot with a diagnostic plan keeps its converted texture material as `library-diagnostic` with the plan reasons (P1222, as P1215 for static meshes). A slot without a program keeps it as `program-gap` with the join reasons.
  - `library-vertex-stage-unskinned`, `program-unconverted` and the extras-pin path are gone from skeletal slots.
  - `NativeActor.create`, `nativeCharacterFactory` and `NativeEquippedBodyPartItems` take the served catalog's material programs, and the load-check harness passes them too.
- **Review cleanups of f10993d (688d0f4).**
  - `decodeNativeStorePng` in `src/assets/native/decodeNativeStorePng.ts` is now the one owner of the native store PNG decoder, and its errors say "Native store PNG". Library, effect, flame and terrain loads import it. The terrain preview keeps its own layer size check.
  - `staticMeshLibraryMaterials` refuses a listing row with `rootPorted` false and no gap reason. None of the 23,146 union rows has that shape.
  - The stage plan carries each animation frame's USize and VSize, and `loadNativeMaterial` refuses a decoded texture of another size. All 9,122 world lane program textures match.

## Tracer and batch

- **Tracer** `--material-programs-of npc:20001`: exit 0; `lineagemonsterstex.gremlin.gremlin_t00` sealed as a ported program. Free bytes went from 146,722,619,392 to 146,712,215,552 (`artifacts/lane-store/actors/measurements/actor-material-programs-tracer.json`).
  - The first tracer run had keyed the npcgrp short reference `LineageMonstersTex.gremlin_t00`, which is not an export.
  - That unit, its listing and its catalog record were removed before the slot rule changed (P1216).
- **Timing run** `--material-programs-of character:0`: 5 units pass in 22.8 s.
- **Inventory:** 6,096 models, 3,381 distinct objects, 3,375 pending.
- **Batch** `convert_actors.py --client E:/Lineage2-client --batch material-programs --limit 3375`, one background process at BelowNormal, 20:01:03 to 20:22:34 UTC:
  - Exit 0. Stderr holds only the share line; the share step linked 557,915,981 bytes of identical PNGs.
  - Free bytes went from 146,679,422,976 to 146,384,359,424 (295 MB).
  - Outcomes: 3,342 pass, 33 gap (`material-class-unported:Engine.GlowModifier`). Sealed: 3,381 (3,348 pass, 33 gap).
- **Library compile** of the 3,381 listings (TS `compileMaterialStagePlan`): 2,421 compiled, 927 diagnostic and 33 program gaps. The diagnostic plans:
  - `material-reference-external`: 895 (specular TexEnvMap that reaches `CubeMaps.*` in another package);
  - `material-feature-unported`: 21;
  - `texture-image-absent`: 10;
  - `material-class-unported`: 1.
- **Receipt gate** (`actor-material-programs-batch.json`):
  - Receipts: 12,237 before (`c17aa503...`), 15,618 after (`a6fad75d...`).
  - No earlier receipt changed or went missing (`unchangedBefore: true`). All 3,381 new receipts are of step `material-programs`.
  - `print_fingerprint_inputs.py` output is byte-equal before and after (`implementation_hash` `c4bf8e6c...2bd8`).

## Re-run chain

| Step | Command | Result |
| --- | --- | --- |
| 1 Lane re-run | `convert_actors.py --client E:/Lineage2-client --batch material-programs --limit 3375` | exit 0. Free bytes 146,679,422,976 before, 146,384,359,424 after |
| 2 Lane catalog | `write_lane_catalog.py --lane actors`, then `--plan` | exit 0 and 0. Actors lane catalog `cbf017ff34a608acacdc66671653a8744e993e8ed0e5f8c9ea81bf236895593c` (materialPrograms 3,381, models 6,096); restage base `55c12147...` |
| 3 Union rebuild | `write_lane_catalog.py --lane integration --union world --union actors --union data-ui` (schedule check first, BelowNormal) | **exit 1, failed**: `Existing immutable runtime asset is corrupt; preserved: ...\integration\l2\b9973a89...\model.glb`. Union catalog `bfd4c64834c123682ff48257382a31ed4c7f7a11f5b57873ed8aab2c7a63fbe6` before and after. Free bytes 146,464,423,936 before, 146,219,126,784 after (20:26:31 to 20:47:17 UTC) |
| 4 Touched-key sweep | - | not run: union rebuild did not exit 0 (the stderr line above) |
| 5 Queue | - | not run: union rebuild did not exit 0 |
| 6 Re-capture | - | not run: no sandbox halves yet; union rebuild did not exit 0 |
| 7 Ingest | - | not run: no sandbox halves yet; union rebuild did not exit 0 |

Cause of the union failure (P1223): the actors lane file `actors/l2/b9973a89.../model.glb` (item:429 armor, pin `modelSha256` `c8fce657...`) reads as `e74840e6...` through the file cache, with one bit flipped at offset 5,484,658 (0xeb read as 0xfb). This is the same bit-4 flip as the 03-24 incident (P1175). The file keeps its 2026-11-12 mtime and size, and the `model.glb` inside its own `asset.l2asset` hashes to the pin. A read with `FILE_FLAG_NO_BUFFERING` hashes the file on disk to `c8fce657...`, so the disk is intact and the flipped copy sits in the page cache in RAM. The union ran once, as the chain rule says. It may have copied new lane files into the integration store before the refusal, but none is pinned by the unchanged union catalog. The chain record is in `artifacts/lane-store/actors/measurements/actor-material-programs-batch.json` (`chain`).

## Task commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Tracer: unit kind, batch, catalog slice and TS join | cfa0993 | actor_material_programs.py, convert_actors.py, actor_arguments.py, catalog_writer.py, actorMaterialPrograms.ts, nativeCatalogRecords.ts, readNativeCatalog.ts, tests |
| - | Review cleanups of f10993d | 688d0f4 | decodeNativeStorePng.ts, staticMeshLibraryMaterials.ts, stagePlan.ts, loadNativeMaterial.ts, importers, tests |
| 2 | Skinned vertex stage and skeletal slot binding | 30293e4 | material.ts, nativeSkeletalMaterials.ts, NativeActor.ts, NativeCharacterVisual.ts, nativeEquippedBodyPartItems.ts, createNativeSliceRuntime.ts, loadCheckHarness.ts, 14 tests |
| 3 | Apostrophe in UE2 object paths (Rule 1, found by the batch inventory) | 4f94ce4 | unit_ledger.py, catalog_writer.py, actor_material_programs.py, the TS readers, tests |
| 2 | Runtime test catalogs with the new slice (Rule 1, found by the full unit run) | 29857fb | nativeSliceRuntimeHarness.ts, nativeSliceWorldSource.test.ts |
| 2 | Diagnostic plans keep the texture material (P1222) | f51aba4 | nativeSkeletalMaterials.ts and its test |
| 3 | Sandbox check of the gremlin library material | 4ffcb7b | sandbox-npc-gremlin.spec.ts |

## TDD gate compliance

- **Task 1:** the unit module was drafted before its pipeline test, so the module never failed its own test first. RED came from the first test expectations, which failed on the second texture conversion, and from the tracer's decode-failed unit, which drove the change of slot rule. New tests: 10 pipeline tests, 2 union tests and 12 join tests.
- **Task 2:**
  - The five binding tests were written first and failed (5 failed).
  - The static mesh guard test failed before its guard was added (RED shown).
  - The USize and VSize refusal test was written against the old loader, which had no size check.
- **Tracer gate:** the task 1 verify was re-run after the tracer reseal and passed before task 2.

## Checks

- **Task 1 verify:** `test_actor_material_programs.py` 10 OK; `test_lane_*.py` 120 OK; `actorMaterialPrograms.test.ts` 12 passed.
- **Task 2 verify:** the `nativeSkeletalMaterials`, `actorMaterialPrograms`, `materialProgram` and `nativeActor` tests, 50 passed.
- **Full unit run:** `pnpm test:unit` (242 files), 2,932 passed and 59 skipped. An earlier full run found the 53 runtime harness failures that 29857fb fixes. `pnpm typecheck` is clean.
- **Pipeline subsets:** 358 tests (actors, catalog, coverage, gap census, lane, merge, npc, item, side-by-side, static mesh, unit ledger, world store), 521 native tests, 122 census tests and 108 material tests pass. `test_converter_implementation_hash.py` passes unchanged.
- **Task 3 verify:** see the chain table and the process cleanup.
- **Browser checks** (`NATIVE_STORE_ROOT=actors`, port 5173 free), `sandbox-npc-gremlin.spec.ts`:
  - First run: 5 passed. Two phone cases of the harness failed: the SwiftShader adapter answered "WebGPU is required" in a new context. This is the known follow-up "Headless WebGPU refusal (02-39)", and the harness page does not use the changed code.
  - A rerun of the four phone and portrait cases: 4 passed.
  - The 1440 x 900 clip picker check finds every npc:20001 part on `UE2 material: lineagemonsterstex.gremlin.gremlin_t00`. The screenshots `artifacts/npc-evidence/sandbox-clip-picker-npc-20001-1440x900.png` and `-932x430.png` show the gremlin skinned and textured in its clip pose.
- **Lane ownership** (`--part npcs`). Every foreign path is an integration edit named in the plan context.
  - Task 1 (`--base 9c0347b`): 1 foreign path, `scripts/native_store/catalog_writer.py`.
  - Review cleanups (`--base cfa0993`): 7 foreign paths in `src/materials/**` and `src/scene/world/**`.
  - Task 2 (`--base 688d0f4`): 2 foreign paths, `material.ts` and `createNativeSliceRuntime.ts`.
  - Task 3 (`--base 30293e4`): 2 foreign paths, `scripts/native_store/catalog_writer.py` and `scripts/native_store/unit_ledger.py` (the apostrophe alphabet). The whole plan (`--base 9c0347b`) has 9 foreign paths.
- **Reference overlap, area materials.** Command: `node tools/reference-overlap/referenceOverlap.mjs --area materials --reference-root C:/laragon/www/l2-browser-client`. Report: `C:/laragon/l2b-orchestration/autonomous-roadmap/03-25/reference-overlap-materials.json`.
  - 10 blocking runs: material.ts 7, loadNativeMaterial.ts 2, stagePlan.ts 1.
  - 105 unreviewed runs: loadNativeMaterial.ts 66, material.ts 33, stagePlan.ts 6.
  - 4 stale sign-offs.

  Under the run rules these runs are only recorded: no code was rewritten and no sign-off was added.

## Deviations from plan

### Auto-fixed issues

1. **[Rule 1] Slot object identity (P1216).** The plan read material names from the model GLBs, but those names do not identify the material object:
   - A skeletal GLB material is named after its leaf texture.
   - The npcgrp reference in provenance is a short name that is not an export; the tracer sealed `decode-failed:FormatError:material export missing or ambiguous`.

   The inventory and the runtime now read, from the sealed archive provenance, the root that the converter resolved.
2. **[Rule 1] Apostrophe (P1219, 4f94ce4).** The full inventory named `LineageWeaponsTex.knife_o'_silenus.knife_o'_silenus_t00_wp`, which the unit key alphabet refused. The ledger key, the slice id and both readers now share one UE2 object path alphabet. The shared `unit_ledger.py` is not a fingerprint input.
3. **[Rule 1] Runtime harness catalogs (29857fb).** The untyped empty test catalogs lacked the new slice.
4. **[Design] No key-level gap rows and no new gap reasons (P1217).** One material object is shared by many keys. A gap row on an npc:, item: or character: key would turn a converted key that loads into a census gap and drop it from the sandbox-half queue. `recipes/actors/gap-reasons.json` is unchanged.
5. **[Design] Diagnostic plans keep the texture material (P1222, f51aba4).** 927 of the 3,381 plans are diagnostic, and the magenta diagnostic would have replaced their converted textures.
6. **[Rule 3] Files outside the plan list:**
   - Scripts: `actor_arguments.py` and `unit_ledger.py`.
   - Runtime: `material.ts` (the vertex stage lives there, not in `stagePlan.ts`), `NativeActor.ts`, `NativeCharacterVisual.ts`, `nativeEquippedBodyPartItems.ts`, `createNativeSliceRuntime.ts` and `loadCheckHarness.ts`.
   - The review cleanup files and the gremlin spec.
   - 14 unit tests whose actor and factory calls take the new parameter.

   `test_lane_catalog_writer.py` needed no change, because the union tests cover the slice.
7. **[AGENTS.md] Comments removed** from `nativeFlameMaterials.ts`, its test, `nativeActor.test.ts` and `nativeFootstepPreview.test.ts`. The `Material.dispose` flag is now the named constant `disposeWithoutWalkingSourceMeshes`.

**Impact:** every must-have truth holds except the sandbox steps of the chain, which wait for 03-07.

## Open follow-ups

- **Key content digests do not cover material programs (CHECK-02).** `side_by_side_key_digest.py` attributes no `materialPrograms` record to the npc:, item: or character: keys whose models name it. A later program reseal therefore touches no key, and the step 4 sweep cannot see it. Unblocked by: attributing listing pins to keys through the model provenance slots in the digest owner.
- **895 actor programs stay diagnostic with `material-reference-external`** (specular TexEnvMap that reaches `CubeMaps.*`), because the shared program path reads one package per material. Unblocked by: cross-package texture nodes in the material graph. Cubemap stays `material-class-unported` (03-24 counts 15 Cubemap objects).
- **33 objects stay `material-class-unported:Engine.GlowModifier`.**
- **Stale skeletal slot text in `docs/parts/skills-effects/EVIDENCE.md:111`.** It still describes skeletal slots as extras-pinned and `library-vertex-stage-unskinned`. 03-19 states this plan's result there (GP7).
- Union rebuild and chain steps 4 and 5 for 03-25 (INT-01): the union refused on a page cache bit flip (P1223), and the disk copy is intact. Re-run once, after the flipped page has left memory (for example after a restart): `node scripts/check-machine-schedule.mjs`, then `python -B scripts/native_store/write_lane_catalog.py --lane integration --union world --union actors --union data-ui`, then the touched-key sweep and `record_side_by_side_checks.py queue`. Because of the digest follow-up above, expect no touched npc:, item: or character: key; a 25-key npcs slice (`NATIVE_STORE_ROOT=integration LOAD_CHECK_KIND=npcs LOAD_CHECK_LIMIT=25 pnpm test:e2e tests/browser/load-sweep-npcs.spec.ts`) then exercises the library materials on the union. The restage (Needs Human plan 02-89) still names `bfd4c648...` until this union lands.
- DATABASE-PC hardware (Needs Human, 2026-11-14): second bit flip in one day, now persisting in the page cache across reads; recorded on that item.

## Open questions (for the orchestrator)

- None from native code. No D3DDrv listing was needed: skeletal slots use the same library material classes, and no particle material bind value was derived.

## Decision rows

Appended to `pending-decision-rows.md`: P1216 to P1222 (see key-decisions).

## Known stubs

None.

## Process cleanup

- This plan started:
  - the tracer and timing `convert_actors.py` runs, the pending counts, the batch (one background process, exited 0), the lane catalog runs, the union rebuild (exited 1), the receipt snapshots and the read-only inspection scripts;
  - unittest and Vitest runs, two full `pnpm test:unit` runs and the reference overlap run;
  - two Playwright runs of `sandbox-npc-gremlin.spec.ts`, each with its own webServer on 5173, stopped by Playwright at the end.
- One waiting loop of mine (a 170 s bounded `bash` loop on the batch exit file) ran once and ended by itself; no further polling was used.
- After the last run: `Get-CimInstance Win32_Process` filtered on `autonomous-roadmap` shows no node, python, chrome or umodel process of this plan, and `netstat` shows no listener on 5173 or 5175 (the task 3 verify printed exit 0).

## Self-Check: PASSED

- FOUND: the 8 created files listed under key-files.created.
- FOUND: commits cfa0993, 688d0f4, 30293e4, 4f94ce4, 29857fb, f51aba4 and 4ffcb7b on `plan/autonomous-roadmap`; `git rev-list --count 9c0347b..HEAD` is 7 before this SUMMARY.
- FOUND: `artifacts/lane-store/actors/measurements/actor-material-programs-batch.json` (exitCode 0, receiptGate.unchangedBefore true, newSteps ["material-programs"], chain steps 1 to 7) and `actor-material-programs-tracer.json` (ignored lane outputs).
