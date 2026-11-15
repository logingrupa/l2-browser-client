---
phase: 02-stage-a-breadth
plan: 21
subsystem: actors
tags: [python, ue2, ukx, utx, dat-tables, reference-client-guard, census, gap-rows]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-02 gap-row schema (validate_gap_row, write_gap_rows, seed reasons), machine schedule gate and run_at_below_normal_priority; 02-01 lane store guard"
provides:
  - "scripts/actors/actor_census.py: CLI `--client <root> [--check]`, ActorPackageCensus (lazy lock-checked header gates), PackageHeaderView, skeletal_reader_gate, write_actor_census, actor_units_and_rows"
  - "scripts/actors/actor_unit_inventory.py: conversion_unit_key (single owner of `<kind>:<sha256>` keys), npc_units_and_rows, character_units_and_rows"
  - "scripts/actors/item_unit_inventory.py: item_units_and_rows, armorgrp_mtx_column_names"
  - "scripts/actors/skill_unit_inventory.py: skill_units_and_rows"
  - "docs/parts/npcs/actor-unit-census.json: 47 package rows, 8 table rows, 7,532 units"
  - "artifacts/lane-store/actors/gap-rows/census.json (ignored): 38,673 census rows, one per npc, character, weapon and armor item, and skill (id, level)"
  - "recipes/actors/gap-reasons.json: actors lane reasons"
affects: [02-22, 02-26, 02-32, 02-34, 02-40, 02-42, 02-43, 02-44]

actuals:
  tokens: 16200
  tasks: 3
  commits: 3
plan_head_before: 619ce0cc3db3c5aeddaf002f0f3bff0143036349
plan_head_after: c62b0bf09c7bd591348cbc5329ffdbc122149307

tech-stack:
  added: []
  patterns:
    - "Lazy lock-checked package census: every header read is require_equal_file then inspect_header, cached per path, rows emitted sorted by path"
    - "Conversion unit identity as SHA-256 over canonical ASCII JSON of the exact decoded selection"
    - "Census check compares parsed content, so checkout line endings never fail it"

key-files:
  created:
    - scripts/actors/__init__.py
    - scripts/actors/actor_census.py
    - scripts/actors/actor_unit_inventory.py
    - scripts/actors/item_unit_inventory.py
    - scripts/actors/skill_unit_inventory.py
    - recipes/actors/gap-reasons.json
    - docs/parts/npcs/actor-unit-census.json
    - tests/pipeline/actor_census_fixture.py
    - tests/pipeline/test_actor_census.py
    - tests/pipeline/test_actor_unit_inventory.py
  modified:
    - docs/parts/npcs/EVIDENCE.md
    - tests/pipeline/test_gap_rows.py
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Skeletal gate probes SkeletalReader on a header-only view, no copied version pair (row 172)"
  - "Fixed committed census path, no --output (row 173); census adds referenceTreeLockSha256, tables, wrapper, textureReaderGate and selection (row 174)"
  - "npcname path is the decoder's own resolution, recorded in tables (row 175)"
  - "Unit key `<kind>:<sha256>` over canonical ASCII JSON, owned by conversion_unit_key (row 176)"
  - "Reason order mesh, skeletal, texture package, texture licensee, multi-slot (row 177); etcitem rows left to 02-26 (row 178)"
  - "Textures resolve against .utx and .ukx (row 179); hair groups gate only the hair gap unit (row 180)"
  - "Census rows carry no sourceIdentity.object (row 181); --check compares parsed content (row 182)"
  - "ActorPackageCensus object and actor_units_and_rows in actor_census.py (row 183); weapon units from wp_mesh and texture (row 184); skill root gaps propagate, sound units part audio (row 185)"
  - "ACT-01, ACT-02, ACT-03, ACT-05, ACT-06 stay Pending (row 186)"

patterns-established:
  - "Every actor denominator row gets exactly one census status before any converter runs"

requirements-completed: []

coverage:
  - id: D1
    description: "Header census of every lock animations .ukx/.usk package plus the texture packages actor rows name, with skeletal and texture gates"
    requirement: ACT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_actor_census.py#PackageHeaderGateTests"
        status: pass
      - kind: integration
        ref: "tests/pipeline/test_actor_census.py#CommittedActorCensusTests"
        status: pass
    human_judgment: false
  - id: D2
    description: "NPC units per exact (mesh, ordered textures); listed gap reasons; one census row per npcgrp row"
    requirement: ACT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_actor_census.py#NpcUnitInventoryTests"
        status: pass
    human_judgment: false
  - id: D3
    description: "chargrp rows with explicit hair and helmet gaps; weapon and armor units; item rows"
    requirement: ACT-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_actor_unit_inventory.py#CharacterUnitInventoryTests"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_actor_unit_inventory.py#ItemUnitInventoryTests"
        status: pass
    human_judgment: false
  - id: D4
    description: "Skill roots, one row per (skill id, level) with ambiguity kept, one unit per skillsoundgrp row"
    requirement: ACT-06
    verification:
      - kind: unit
        ref: "tests/pipeline/test_actor_unit_inventory.py#SkillUnitInventoryTests"
        status: pass
    human_judgment: false
  - id: D5
    description: "Committed census reproduces byte for byte and --check passes against E:/Lineage2-client"
    requirement: ACT-03
    verification:
      - kind: integration
        ref: "python -B scripts/actors/actor_census.py --client E:/Lineage2-client --check"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-08
---

# Phase 2 Plan 21: Actors census and unit inventory Summary

**Lock-checked header census of the 20 `animations/` packages and 27 texture packages, plus a unit inventory of 7,532 NPC, character, weapon, armor, skill-root and skill-sound units that gives all 38,673 actor table rows exactly one census status.**

## Performance

- Duration: about 25 min (18:13 to 18:38 UTC)
- Tasks: 3 of 3
- Files: 10 created, 4 modified

## Accomplishments

- `python -B scripts/actors/actor_census.py --client E:/Lineage2-client` decodes the eight `TABLES`, reads only the 47 package headers it needs through `require_equal_file`, writes the committed census and the lane gap rows in about 6 s; `--check` recomputes and writes nothing.
- 633 NPC units from 6,519 npcgrp rows (88 pass both header gates); 341 units wait on multi-slot binding (02-32).
- 15 chargrp rows (11 pending, 3 `texture-licensee-unsupported:123/27`, 1 `no-mesh-in-row`) plus 30 explicit hair and helmet gap units.
- 523 weapon units, 4,688 armor units over the 31 MTX columns of the decoded armorgrp layout; 2,327 item rows.
- 245 skill roots (all resolve to `animations/Skill.usk`), 29,812 skill rows (17,576 `native-skill-dispatch-required`, no duplicate pairs on this client), 1,398 skill sound units.

## Census result (for 02-22, 02-26, 02-34, 02-40 to 02-44)

Unit counts by `unitKind` (`python -c` count over the committed census):

| unitKind | convertible | gap |
|---|---|---|
| npc-model | 88 | 545 |
| chargrp-row | 11 | 4 |
| chargrp-hair | 0 | 15 |
| chargrp-helmet | 0 | 15 |
| weapon-mesh | 523 | 0 |
| armor-mesh | 2,883 | 1,805 |
| skill-root | 245 | 0 |
| skill-sound-row | 1,398 | 0 |

Refused skeletal headers: `LineageAccessory.ukx` and `LineageMonsters3.ukx` (123/31), `improved_model_npc_01.ukx` (123/0, plain UnrealPackage wrapper). Refused texture headers: licensee 27 (`fdarkelf`, `fdwarf`, `mdarkelf`, `lineagedecostex`), 25 (`lineagemonsterstex2`, `interior_b_t`), 23 (`dion_curumadungeon_t`) and 0. Full tables are in `docs/parts/npcs/EVIDENCE.md`.

## Task Commits

1. Task 1, NPC census end to end: `d56b9ff` feat(02-21): census actor package headers and npcgrp rows into conversion units
2. Task 2, characters, items, skills and sound rows: `f86a3cc` feat(02-21): add characters, items, skills and skill sound rows to the actor census
3. Task 3, evidence: `c62b0bf` docs(02-21): record the actor unit census in the npcs evidence

## Files Created/Modified

- `scripts/actors/actor_census.py` (272 lines): CLI, package census, census envelope, writer and check.
- `scripts/actors/actor_unit_inventory.py` (124 lines): unit key, shared row and unit builders, NPC and character inventory.
- `scripts/actors/item_unit_inventory.py` (68 lines), `scripts/actors/skill_unit_inventory.py` (51 lines).
- `tests/pipeline/actor_census_fixture.py`: synthetic lock-checked client and decoded-table builders shared by both test files.
- `tests/pipeline/test_gap_rows.py`: two assertions assumed the repository had no lane reason file; they now read the repository's list versions.
- `docs/parts/npcs/actor-unit-census.json`: 5.06 MB of names, hashes, header integers and counts (no string of 129 or more base64 characters, asserted).

## Decisions Made

OVERNIGHT-DECISIONS rows 172 to 186 (listed in the frontmatter). The unit key form (row 176) is the one to review first: 02-22 and 02-34 use it as the model catalog id.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Texture packages also resolve against `.ukx`**
- Found during: Task 1. 629 npcgrp texture references name `improved_model_npc_01`, which exists only as `animations/improved_model_npc_01.ukx`; a `.utx`-only lookup reported it as `texture-package-not-in-client`.
- Fix: texture stems resolve against lock-equal `.utx` and `.ukx`; that package row carries both gates. Row 179. Commit `d56b9ff`.

**2. [Rule 1 - Bug] Census rows carry no `sourceIdentity.object`**
- The planned `npc_id=<id>` object fails `QUALIFIED_OBJECT_NAME_PATTERN` in `validate_gap_row`. Rows carry the decoded table `{path, sha256}`. Row 181. Commit `d56b9ff`.

**3. [Rule 1 - Bug] Lane reason file broke two gap row tests**
- `tests/pipeline/test_gap_rows.py` asserted `{'seed': 1}` as the repository's list versions; with `recipes/actors/gap-reasons.json` they read `gap_reason_list_versions()` instead, and one redundant assertion went. Commit `d56b9ff`.

**4. [Rule 2 - Correctness] `--check` compares parsed content**
- `core.autocrlf=true` turns the committed census into CRLF on a fresh checkout, so a byte comparison would fail. The test covers a CRLF copy. Row 182. Commit `d56b9ff`.

**5. [Rule 1 - Bug] Hair groups gate only the hair gap unit**
- Found during: Task 2. Every chargrp row names the same `FDarkElf` hair with a licensee-27 texture, which turned all 14 rows into texture gaps from an undecoded layout. Row 180. Commit `f86a3cc`.

**6. [Rule 3 - Blocking] Package census object and build function placement**
- `item_unit_inventory` imports the unit key from `actor_unit_inventory`, so the build function could not live there without an import cycle, and the plan's `inventory(` grep would match `build_actor_unit_inventory`. The build function is `actor_census.actor_units_and_rows(tables, armor_mesh_columns, package_census)`; per-kind functions take an `ActorPackageCensus` instead of `(package_rows, lock_files)`, and `census_actor_packages` became `ActorPackageCensus.package_rows()`. Row 183.

**7. Writer** uses `native_store.canonical_json.canonical_json_bytes` (sorted keys, indent 2, ASCII) rather than `native_catalog.cli.json_bytes`, which does not sort keys.

## TDD gate compliance

Task 2 is `tdd="true"`. Its tests were written alongside the implementation and first run green; there is no separate RED commit.

## Verification

- `node scripts/check-machine-schedule.mjs && python -B -m unittest discover -s tests/pipeline -p "test_actor_*.py"`: 22 tests OK.
- `python -B -m unittest discover -s tests/pipeline -p test_client_entry_points.py`: 7 tests OK.
- `python -B scripts/actors/actor_census.py --client E:/Lineage2-client` then `--check`: exit 0, census SHA-256 `1d43ebce...`.
- Acceptance: 20 packages with a skeletal gate; npcgrp `rowCount` 6519 and 6,519 `npc:` gap rows; npcname path `system/npcname-e.dat`; 15 `character:` rows equal the chargrp `rowCount`; 29,812 `skill:` rows equal the decoded pairs; `require_equal_file` in `actor_census.py`; no `rglob`, `os.walk` or `inventory(` in the actor modules; no `(123, 28), (123, 30)` text and no hand-typed recipe name in them; every Python file under 400 lines; EVIDENCE.md 11,654 bytes.
- `python -B scripts/test_pipeline.py` (`pnpm test:pipeline`) at BelowNormal: 1,123 tests OK, 107 skipped, 80 s (1,112 after Task 1).
- `node scripts/check-lane-ownership.mjs --base 619ce0c --part npcs`: lane actors, 0 foreign paths.

## Process cleanup

This plan started only foreground Python and node runs; no dev server, preview or browser. After the last run, `netstat -ano` shows no listener on 5173 or 5175. The PowerShell `Get-CimInstance` listing is refused by this session's worktree guard and `wmic` is absent, so the check used `tasklist /V`: the one `python.exe` (PID 29876) was created on 2026-11-07 19:43 UTC, before this plan, and the three `node.exe` processes run in session 0 (Services). None was started by this plan, and nothing was stopped.

## Known Stubs

None. `chargrp-hair` and `chargrp-helmet` units have `selection: null` on purpose (ACT-01: no guessed hair selection).

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None.

## Next Phase Readiness

02-22 (Gremlin tracer) and 02-34 (NPC batches) can import `conversion_unit_key` and read `npc-model` units and the npcname path from the census; 02-26 reads the `census` step gap rows; 02-32 lifts `multi-slot-binding-unsupported`.

## Self-Check: PASSED
