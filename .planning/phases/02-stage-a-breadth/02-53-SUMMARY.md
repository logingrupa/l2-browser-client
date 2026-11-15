---
phase: 02-stage-a-breadth
plan: 53
subsystem: world
tags: [world, ue2, static-mesh, static-materials, lineage2-licensee, elbera-l2lib, cross-check, census, WORLD-01]
requires:
  - phase: 02-29
    provides: meshes step that gates each .usx on REVIEWED_VERSIONS and writes static-material-layout-unreviewed gap rows
  - phase: 02-52
    provides: ELBERA_L2LIB_PINS, elbera_package and elbera_tool_record in scripts/world/elbera_reader_cross_check.py
  - phase: 02-19
    provides: load_pinned_elbera_module and ELBERA_ROOT in scripts/data/pinned_elbera_module.py
provides:
  - committed .usx census docs/parts/adapter-dispatch/static-mesh-package-census.json (212 lock-equal packages, header, StaticMesh export count, reviewed flag, reason)
  - static material licensees 123/12, 123/18, 123/0, 123/14 and 123/15 reviewed, each with an equal Elbera l2lib cross-check row and a REVIEWED_VERSION_EVIDENCE record
  - static_material_cross_check_row and elbera_static_mesh_material_references in scripts/native_assets_lib/static_material_cross_check.py
  - scripts/record_static_material_cross_check.py, which records a cross-check row and, on equality, the real-client cases
  - static_material_layout_unreviewed_reason and read_static_material_slots in scripts/native_assets_lib/static_materials.py
affects: [02-54, WORLD-01]
actuals:
  tokens: 70600
  tasks: 3
  commits: 10
plan_head_before: 504fbf1c28fbca0132652b793c84689610749d0d
plan_head_after: 38dfb1845a0c5f8d4fd36440f88da290affc843f
tech-stack:
  added: []
  patterns:
    - "Static material version evidence: REVIEWED_VERSIONS = frozenset(REVIEWED_VERSION_EVIDENCE); layout-reviewed licensees cite LAYOUT_EVIDENCE and the real-client cases, cross-checked ones add crossCheck {tool, commit, pins, result{package, comparedExports, referencesSha256, equal, record}}"
    - "Cross-check row: {version, package, lockSha256, comparedExports, ourReferencesSha256, crossCheckReferencesSha256, tool{name, commit, pins}, equal, firstDifferingExport}, re-derived by the real-client test"
key-files:
  created:
    - scripts/native_assets_lib/static_material_cross_check.py
    - scripts/static_material_package_census.py
    - scripts/record_static_material_cross_check.py
    - docs/parts/adapter-dispatch/static-mesh-package-census.json
    - tests/fixtures/static-materials/cross-checks.json
    - tests/pipeline/test_static_material_package_census.py
    - tests/pipeline/test_static_material_reviewed_versions.py
  modified:
    - scripts/native_assets_lib/static_materials.py
    - tests/pipeline/test_static_materials.py
    - tests/pipeline/fixtures/static-material-versions.json
    - tests/pipeline/test_world_static_mesh_step.py
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/STATE.md
key-decisions:
  - "Elbera l2lib ue2package.py under the 02-52 pin is the cross-check: read_properties(auto) per StaticMesh body, each Materials element as a packed stream, qualified_ref per Material; parse_skillfx.decode_struct_array is not loaded because its module edits sys.path at top level (row 540)"
  - "The census lives under docs/parts/adapter-dispatch/; the two UE118 packages keep their header with a null StaticMesh count and the meshes step's reason text (row 541)"
  - "The meshes re-run stays with 02-54; 02-53 counts 599 resolvable 20_21 gap rows (row 542)"
  - "test_world_static_mesh_step.py uses the refused neighbour 123/13 as its unreviewed example (row 543)"
  - "Static material real-client tests read the hash-pinned packages through the reference client guard instead of a local-only folder; the recorder writes rows and cases (row 544)"
  - "WORLD-01 stays Pending (row 545)"
patterns-established:
  - "Grow a static material licensee: run record_static_material_cross_check.py --licensee N on the first census package, add a cross_checked_version_evidence record only on equal true, regenerate the census, one commit"
requirements-completed: []
coverage:
  - id: D1
    description: "Licensee 12 reads the licensee 20 synthetic slots; 11, 13 and every other unreviewed neighbour of a reviewed licensee are refused with a message listing REVIEWED_VERSIONS"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_static_materials.py#StaticMaterialTests"
        status: pass
    human_judgment: false
  - id: D2
    description: "Explicit-null, omitted Material and missing Materials array keep distinct statuses for every reviewed version; slot order and duplicates stay as in the source"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_static_materials.py#StaticMaterialTests"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every reviewed version has an evidence record; cross-checked ones an equal row whose result matches; a missing record, a missing row or an unequal row each fail"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_static_material_reviewed_versions.py#ReviewedVersionEvidenceTests"
        status: pass
    human_judgment: false
  - id: D4
    description: "The five cross-check rows reproduce exactly on E:/Lineage2-client; all 165 real-client cases (the 20 original with 280 slots plus 145 new) read their recorded slots; the committed cases equal a fresh recorder read"
    requirement: WORLD-01
    verification:
      - kind: integration
        ref: "tests/pipeline/test_static_material_reviewed_versions.py#ElberaStaticMaterialCrossCheckTests, ExpandedSectionMaterialTests, RealSectionMaterialTests; tests/pipeline/test_static_material_package_census.py#RecordedRealClientCaseTests"
        status: pass
    human_judgment: false
  - id: D5
    description: "The .usx census lists every lock-equal .usx with header, StaticMesh count and reason, sorted and byte-identical on rerun, refuses output outside docs/parts/adapter-dispatch/, and its reviewed flags equal REVIEWED_VERSIONS"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_static_material_package_census.py"
        status: pass
    human_judgment: false
duration: 24min
completed: 2026-11-09
status: complete
---

# Phase 2 Plan 53: Static-material reader widening Summary

**The static material slot reader now accepts UE123 licensees 0, 12, 14, 15 and 18 besides the nine layout-reviewed ones. Each was added only after every StaticMesh export of its first census package read the same ordered material references through our reader and through the SHA-pinned Elbera l2lib reader. 210 of the 212 lock-equal `.usx` packages are now reviewed; the two UE118 packages stay refused. 599 of the 881 per-object meshes gap rows on 20_21 become convertible when 02-54 re-runs the meshes step.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-11-09T20:42:21Z
- **Completed:** 2026-11-09T21:06:00Z
- **Tasks:** 3 of 3

## Accomplishments

- Census (`scripts/static_material_package_census.py`, 184 lines): reads the header and export table of every lock-equal `.usx` through `require_equal_file` and `read_package_index` (header only through `summary` when the UE123 table adapter refuses a package), at BelowNormal after `require_batch_preflight`. It refuses an output outside `docs/parts/adapter-dispatch/`. Measured before 02-53: 56 of 212 unreviewed, the same as research 5.1.

| Unreviewed version | Packages | StaticMesh exports | Result |
|---|---|---|---|
| 123/12 | 42 | 808 | reviewed, equal on `cruma_s.usx` (31 exports) |
| 123/18 | 6 | 220 | reviewed, equal on `dion_punish_s.usx` (77) |
| 123/0 | 3 | 38 | reviewed, equal on `L2_Lobby_Classic.usx` (28) |
| 123/14 | 2 | 18 | reviewed, equal on `dion_curumadungeon_boss_s.usx` (7) |
| 123/15 | 1 | 2 | reviewed, equal on `dion_partisan_door_s.usx` (2) |
| 118/0, 118/11 | 1 each | unknown (UE118 tables not indexed) | refused: the slot reader is UE123 only |

- Cross-check (`scripts/native_assets_lib/static_material_cross_check.py`, 96 lines): our side reads every `Engine.StaticMesh` export with `read_static_material_slots`; the Elbera side loads `tools/l2lib/ue2package.py` under the 02-52 pin through `elbera_package` (guard access only) and reads each Materials array with `read_properties` and `qualified_ref`. Both sides are casefolded under Unreal name rules and hashed as canonical JSON. No Elbera entry point runs.
- `static_materials.py` (175 lines): no comment or docstring left (baseline 3 comment lines and 5 docstring quotes); helpers renamed (`require_static_material_format`, `source_byte_range_record`, `slot_property_values_keeping_unknown_payloads`); `REVIEWED_VERSIONS` derives from `REVIEWED_VERSION_EVIDENCE`; the refusal lists the reviewed versions and the refused one; `native_static_materials` keeps its output shape, so converted metadata does not change.
- Real-client cases: 145 new cases (31 + 77 + 28 + 7 + 2, package and slot hashes only) appended to `static-material-versions.json`; the 20 original cases and their 280 slots are unchanged.
- 02-29 gaps: `artifacts/lane-store/world/work/tile__20_21/meshes/products/static-meshes.json` holds 881 gap rows; 599 are now resolvable (596 `static-material-layout-unreviewed:123/12`, 3 `:123/14`). The other 282 are 279 `UModel cannot safely select this duplicate leaf name` and 3 `Expected exactly one exported payload`. 20_20 has no meshes product in this checkout. `artifacts/lane-store/world/gap-rows/meshes.json` holds one tile row, 20_21, with the first reason `:123/14`. Nothing was converted.

## Task commits

1. Task 1 (licensee 12, tracer): `a992735` test (red), `73ef12e` census and cross-check tooling, `809c38f` licensee 12
2. Task 2 (other licensees): `e9030a8` 123/18, `a4da7d6` 123/0, `2794402` 123/14, `ddecc0f` 123/15, `ab2d640` recorder tests, `676b785` test file split
3. Task 3 (gaps, evidence, handoff): `38dfb18` docs (evidence, STATUS, decisions, STATE follow-up)

## Verification

- `node scripts/check-machine-schedule.mjs && python -B -m unittest discover -s tests/pipeline -p "test_static_material*.py"`: 38 tests OK, none skipped on DATABASE-PC (E: and the Elbera checkout present).
- `tests/pipeline/test_world_static_mesh_step.py`: 22 tests OK.
- `pnpm test:pipeline` (run as `python -B scripts/test_pipeline.py` at BelowNormal): 1,690 tests, 72 skipped, OK. It started before `ab2d640` and `676b785`; those two commits changed only static material test files, which the targeted run above covers.
- `node scripts/check-lane-ownership.mjs --base 504fbf1 --part adapter-dispatch`: `lane integration: 0 foreign paths`.
- Shared store not written: `public/l2/catalog.json` last written 2026-11-08 02:06 (+02:00), before the first plan commit at 2026-11-09 22:52.
- Acceptance: `(123, 12) in REVIEWED_VERSIONS` prints `True`; comment lines in `static_materials.py` 0; `"""` count 0; absolute paths in `static_material_cross_check.py` 0; `git log -- scripts/native_assets_lib/static_materials.py` shows one commit per added version.
- Reference overlap: none of the five DEC-OWN-12 areas covers `scripts/**` Python, so no run applies.
- The self-contained repo name check (DEC-OWN-11) is empty for everything this plan wrote.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The world meshes step test used 123/12 as its unreviewed example**
- Found during: Task 1. `tests/pipeline/test_world_static_mesh_step.py` expected `static-material-layout-unreviewed:123/12`, which the plan reviews.
- Fix: the example is now the refused neighbour 123/13 (row 543). Commit `809c38f`.

**2. [Rule 3 - Blocking] The real-client tests read a local-only folder that this checkout lacks**
- Found during: Task 1. `artifacts/native-parity/inputs/IMPORTA-PC` is absent here, so the 280-slot case was skipped.
- Fix: the tests read the same hash-pinned packages from `E:/Lineage2-client` through the guard (row 544); the 280-slot case now runs. Commit `a992735`.

**3. [Rule 1 - Bug] A lobby package reuses a StaticMesh name for an export of another class**
- Found during: Task 2 (licensee 0). The expanded test picked the first export with the object name.
- Fix: it selects by object name and `Engine.StaticMesh` class and requires exactly one match. Commit `a4da7d6`.

**4. [Rule 1 - Bug] An earlier test insertion moved two synthetic cases into the evidence class**
- Found during: the file split. The excessive-count and mutation cases had ended up under `ReviewedVersionEvidenceTests`; they still ran, but in the wrong class.
- Fix: they are back in `StaticMaterialTests`, and the 476-line test file is split under 400 lines. Commit `676b785`.

### Additions beyond the plan text

- `scripts/record_static_material_cross_check.py` (103 lines) writes the cross-check rows and cases: the plan asked for the rows and cases but named no tool. The row carries an extra `firstDifferingExport` field (null on equality) so an unequal check names its first differing export.
- `read_static_material_slots` splits the version gate from the slot read so that the cross-check reads a candidate version before it is reviewed; `native_static_materials` is the gate plus the read.
- `tests/pipeline/test_static_material_reviewed_versions.py` is a new file from the split; the plan listed only the two other test files.

## Known stubs

None.

## Decisions logged

`.planning/OVERNIGHT-DECISIONS.md` rows 540 to 545.

## Needs Human

None. Nothing here touches the shared store.

## Open follow-ups

- Added to `.planning/STATE.md`: 02-54 makes the meshes fingerprint see `REVIEWED_VERSIONS`, calls `static_material_layout_unreviewed_reason` instead of building the reason text in `static_mesh_step.py`, and re-runs the meshes step (599 20_21 rows).

## Process cleanup

This plan started no dev server, Vite preview, Playwright or browser. Its Python runs (census, recorder, unittest and the pipeline suite) all exited; afterwards no python or node process started by this plan remained, and nothing listened on port 5175. The scratch scripts under the ignored `artifacts/` were deleted.

## Self-Check

PASSED. All seven created files exist; the commits a992735, 73ef12e, 809c38f, e9030a8, a4da7d6, 2794402, ddecc0f, ab2d640, 676b785 and 38dfb18 are on HEAD.
