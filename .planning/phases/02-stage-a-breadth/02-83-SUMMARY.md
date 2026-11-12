---
phase: 02-stage-a-breadth
plan: 83
subsystem: actors lane, player characters
tags: [chargrp, class-join, class-defaults, uelib, character-batch, gap-closure, sc2b]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-73 texture library (123/27 layouts reviewed), 02-74 material programs, 02-92 material adapter limitations; 02-40 character generator and census"
provides:
  - "scripts/actors/character_class_sources.py: bounded search of the data-ui table manifests and the locked script packages for the chargrp row to actor class join (chargrp_row_meshes_by_row, table_record_candidates, pawn_class_ancestries, class_default_candidate, class_join_verdict, read_character_class_sources)"
  - "docs/parts/player-characters/character-class-sources.json: committed result, verdict adopted, 14 rows to 14 LineageWarrior classes"
  - "resolve_character_actor_class(classinfo_table, class_sources, row_index): classinfo-e first, then the committed result (route character-class-sources)"
  - "CharacterSources.class_sources; CLASS_SOURCES_ROUTE, ADOPTED_CLASS_SOURCES_VERDICT, NOT_DECIDED_CLASS_SOURCES_VERDICT, CLASS_MESH_FIELD in character_requests"
affects: [02-89, 03-11]

actuals:
  tokens: 70000
  tasks: 3
  commits: 5
plan_head_before: 8bcd9868492c601090bac4ccbc903a28a31f3af5
plan_head_after: adc09e3405233e0ec6055dc0908bd3d4aa206f6f

tech-stack:
  added: []
  patterns:
    - "A join from client data is adopted only when every source names exactly one candidate per row and each candidate names one row; the committed result lists every searched source with its SHA-256 either way"
    - "A committed input that enters unit fingerprints is identified by the SHA-256 of its canonical JSON, so a line ending rewrite does not unseal units"

key-files:
  created:
    - scripts/actors/character_class_sources.py
    - docs/parts/player-characters/character-class-sources.json
    - tests/pipeline/test_character_class_sources.py
  modified:
    - scripts/actors/character_requests.py
    - scripts/actors/character_conversion.py
    - scripts/actors/character_census.py
    - tests/pipeline/test_character_requests.py
    - tests/pipeline/test_data_ui_table_manifest.py
    - docs/parts/player-characters/character-census.json
    - docs/parts/player-characters/EVIDENCE.md

key-decisions:
  - "1035: the row identity of the class join is the row's body_mesh and face_mesh references (rows 8 and 9 join through the face mesh); adopted only one to one"
  - "1036: a face with several face_texture entries carries no table binding; its mesh is checked by the converter against the class Mesh default and the slot stays unbound"
  - "1037: the face part takes the class Mesh spelling when it equals the row face mesh without regard to case"
  - "1038: the class source result is identified by the SHA-256 of its canonical JSON"

patterns-established:
  - "Class-default searches bound decompilation by the package name table: only Engine.Pawn subclasses in packages whose name table holds a row mesh name, plus their descendants, are decompiled"

duration: 34min
completed: 2026-11-12
---

# Phase 2 Plan 83: Character class join and batch Summary

The locked client joins every chargrp character row to exactly one `LineageWarrior` actor class through the class `Mesh` and `SubMeshes` defaults. The join is committed with its sources and adopted. 9 of 14 character assemblies now convert with the face on the class `HeadBone` and collision from the class defaults. Every key still has a listed gap: the profile has no sourced idle animation family.

## Performance

- Duration: about 34 minutes (2026-11-12 16:43 to 17:17 Riga).
- Tasks: 3 of 3, plus 2 Rule 1 fixes found during the batch.
- Files: 10 changed (3 created).

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 (tracer) | Class source search over the locked client, committed with its verdict | 2d096bf | character_class_sources.py, character-class-sources.json, test_character_class_sources.py, EVIDENCE, character_requests.py (path constant) |
| 2 | Requests read the adopted join or keep the gap with evidence | 2d018f8 | character_requests.py, character_conversion.py, character_census.py, character_class_sources.py, three test files |
| 3 (fix) | Table bindings with a texture path so the converter accepts the joined face | 01c063a | character_requests.py, character_class_sources.py, test_character_requests.py |
| 3 (fix) | Face part in the class Mesh spelling | d084246 | character_requests.py, test_character_requests.py |
| 3 | Character batch, census and spawn check | adc09e3 | character-census.json, EVIDENCE |

## What happened

- Search (Task 1): 39 decoded data-ui table manifests (all but `chargrp` and the three name indexes) and the 25 script packages of `system/*.u`. `nwindow.u` is refused by the package table reader (not UE2 123) and is listed with its SHA-256. Only `LineageWarrior.u` `747b1e7c...` has a chargrp mesh name in its name table. Its 16 `Engine.Pawn` subclasses were decompiled through `read_class_defaults_with_provenance`, and no `Engine.Pawn` subclass elsewhere descends from one that names a row. 306 table records (armorgrp 296, etcitemgrp 10) name a row mesh, and none names a Pawn class. Verdict `adopted`: rows 0 to 13 map to MFighter, FFighter, MDarkElf, FDarkElf, MDwarf, FDwarf, MElf, FElf, MMagic, FMagic, MOrc, FOrc, MShaman and FShaman. The search takes about 18 s.
- Requests (Task 2): the class comes from `classinfo-e` first, then from the result. A `not-decided` result keeps `class-template-mapping-undecoded` for every row, even a row with one candidate. The request limitation names the class, the result path and both SHA-256 values. A class package that differs from the searched one is refused.
- Batch (Task 3):
  - First unit `--character 0`, run alone: free bytes 10,350,223,360 before and 10,165,055,488 after. The measured drop per sealed unit is 185,167,872 bytes. The projection for the 13 remaining keys is 2,407,182,336 bytes, which leaves 7,757,873,152 free against the floor `BATCH_MINIMUM_FREE_BYTES` 4,294,967,296.
  - The first attempt of unit 0 was refused by the converter (`Source binding must use either texturePath or slotBindings`). Fix 01c063a.
  - Batch 1 (`--batch characters --limit 14`, one process): exit 0. Rows 8, 10 and 11 were converter-refused (`Rigid attachment bone/mesh differs`, a letter-case difference). Fix d084246.
  - Batch 2 (same command, one process): exit 0. It re-ran rows 8 to 11 and took the other rows as cache hits. Free bytes were 9,425,739,776 before it. At 17:18 Riga, after the catalog write, free bytes were 14,932,090,880. That rise came from space freed outside this plan, and nothing was deleted to make room.
  - `write_lane_catalog.py --lane actors` exit 0 (catalog `5dcadf8f...`, 6,096 models). `--plan` exit 0.
- Result per row:
  - Converted, with the profile gap `actor-default-unresolved:WaitAnimName`: rows 0, 3, 4, 5, 6, 7, 10, 11 and 12. Rows 3 and 5 convert on the 02-73 texture library.
  - `animation-reference-missing`: rows 1, 2, 9 and 13. This is row 2's next blocker after 123/27.
  - Row 8: `converter-refused:Rigid attachment requires one verified root-only rigid skin`.
- Female fighter collision from `LineageWarrior.FFighter` is 8 / 23.5. That agrees with the decision H audit values.
- Browser: `NATIVE_STORE_ROOT=actors pnpm test:e2e tests/browser/sandbox-characters.spec.ts`, 3 passed (2.8 min, port 5173 free, SwiftShader, no FPS claim). All 14 keys show their census gap marker, and the load-check records are in `artifacts/lane-store/actors/load-checks/5dcadf8f53fa16eb381cdb7c37a05e238d19ef24f4d5709ecd6d6c264e927b1d.json`.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_character_*.py" -v`: 53 OK (class sources 9, requests 30 with the real-client row 0 cross-check, conversion run 7, recipe unresolved values 7).
- `python -B -m unittest discover -s tests/pipeline -p "test_data_ui_table_manifest.py"`: 13 OK. `-p "test_actor_sound*.py"`: 38 OK.
- `pnpm vitest run tests/unit/laneOwnership.test.ts`: 36 passed. The player-characters EVIDENCE already had `## Evidence` at plan start, so the fact in the plan text was stale. The doc is now 10,902 bytes.
- Task 3 verify: census counts `{characters 14, modelsConverted 9, profilesWritten 0, gapKeys 14, pendingKeys 0}`. `write_lane_catalog.py --lane actors --plan` exit 0. Nothing listens on 5173 or 5175.
- `node scripts/check-lane-ownership.mjs --base 8bcd986 --part player-characters`: lane actors, 0 foreign paths (run before the docs commit).
- Reference overlap: no area in `tools/reference-overlap/overlapAreas.json` covers `scripts/actors/character_*`, so there was no run to record.
- The self-contained repo name check (DEC-OWN-11) is empty for everything this plan wrote.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pawn ancestry stopped at the root class**
- Found during: Task 1, first search run (0 Pawn classes, 0 candidates).
- Fix: `pawn_class_ancestries` walks the full export-table chain and keeps classes with `Engine.Pawn` below them, with a test.
- Commit: 2d096bf.

**2. [Rule 1 - Bug] The converter refused the generated face binding**
- Found during: Task 3, first unit (`converter-refused:Source binding must use either texturePath or slotBindings`).
- Issue: a binding without `texturePath` is refused by the frozen converter. The generator left it out for an empty or ambiguous texture.
- Fix: body parts cite their texture field even when it is empty. A face with several `face_texture` entries carries no table binding, its mesh is checked against the class `Mesh` default, and a limitation names the unbound slot. A test runs every generated binding through `verify_source_table_binding`.
- Commit: 01c063a (decision row 1036).

**3. [Rule 1 - Bug] Face mesh letter case**
- Found during: Task 3, batch 1 (rows 8, 10 and 11 `Rigid attachment bone/mesh differs from the cited native actor defaults`).
- Fix: the face part takes the class `Mesh` spelling when it equals the row face mesh without regard to case. A class `Mesh` that names another mesh is `actor-default-unresolved:Mesh`.
- Commit: d084246 (decision row 1037).

### Other adjustments

- Row identity: the plan names a chargrp body mesh. Rows 8 and 9 join only through `face_mesh`, because their body meshes are m003 and m005 starter meshes that no class names. The face mesh is in the row identity, and the one-to-one rule is unchanged (row 1035).
- The result hash is the SHA-256 of canonical JSON, not of the file bytes (row 1038, autocrlf).
- Task 1 put `CHARACTER_CLASS_SOURCES_RELATIVE_PATH` into `character_requests.py`, a Task 2 file, so the search module can import it without an import cycle.
- Task 2's tests and code were written in one pass and run together. They were not committed as a separate red step.
- The batch ran twice as one process each time, because the two fixes were found between the runs. A second convert process never ran alongside the first.

## Requirements

- ACT-01: stays Pending. The class join is adopted and 9 assemblies convert. No profile is written (no sourced `WaitAnimName` family), rows 1, 2, 9, 13 and 8 have model gaps, hair, helmet and the face texture stay unresolved, and the restage is outstanding. REQUIREMENTS.md is not changed (rule G9).

## Decisions logged

OVERNIGHT-DECISIONS rows 1035 to 1038.

## Needs Human

None new. Gap SC2b no longer needs IMPORTA-PC for the class join, because the locked client decides it. The actors lane restage remains the existing main-checkout line. `--plan` prints `cd C:/laragon/www/l2-browser-client && python -B .../scripts/native_store/merge_lane_store.py --lane-store .../artifacts/lane-store/actors/l2 --target public/l2 --expected-base-catalog-sha256 55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe` for lane catalog `5dcadf8f...`. It stays held behind the union fix (rule G9).

## Open follow-ups

- ACT-01 profile: no source names the character idle animation family (`WaitAnimName`), so every key keeps a profile gap and no key loads.
- Rows 1, 2, 9 and 13: the base body mesh has no serialized Animation reference. Rows 0 and 3 to 7 have one. A sourced animation package per row is still missing.
- Row 8: the converter rigid-attachment path refuses the `MMagic_m000_f` face because it is not a root-only rigid skin. A skinned head part needs a converter change, which is a frozen source.
- Face texture: each row lists 3 `face_texture` entries. The selection is server appearance data (NET), so the slot stays unbound.
- `recipes/native-player-ffighter-stage.json` keeps 8 / 23.5 unresolved. The class defaults now give the same values, and the stage recipe changes at the restage.

## Known Stubs

None.

## Process cleanup

- Started by this executor: two class source searches, `--character 0` twice, two batch processes (background, both exit 0, waited on with `Wait-Process` by PID, no sleep loop), `write_lane_catalog.py` and `--plan`, one Playwright run on 5173 (Playwright started and stopped its web server and browser), and targeted unittest and vitest runs.
- Check at 17:17 Riga: nothing listens on 5173 or 5175, and no node, python or browser process has this worktree path in its command line.

## Self-Check: PASSED

- FOUND: scripts/actors/character_class_sources.py, docs/parts/player-characters/character-class-sources.json, tests/pipeline/test_character_class_sources.py, .planning/phases/02-stage-a-breadth/02-83-SUMMARY.md
- FOUND commits on plan/autonomous-roadmap: 2d096bf, 2d018f8, 01c063a, d084246, adc09e3
