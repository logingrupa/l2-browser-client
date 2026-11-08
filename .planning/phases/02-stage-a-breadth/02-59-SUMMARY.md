---
phase: 02-stage-a-breadth
plan: 59
subsystem: integration
tags: [materials, class-defaults, material-graph, material-program, census, gap-reasons, dec-own-12, mat-01, conv-02]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-02 gap-row schema and seed reason list, require_batch_preflight and run_at_below_normal_priority; 02-01 require_converter_output"
provides:
  - "scripts/native_assets_lib/class_defaults.py: read_class_defaults_with_provenance, read_class_field_declarations, ClassDefaultValue, ClassFieldDeclaration, CLASS_DEFAULT_PROVENANCES, ReferenceClientClassScripts"
  - "scripts/native_assets_lib/material_graph.py: read_material_graph, REVIEWED_MATERIAL_CLASSES, material_class_unported_reason, material_feature_unported_reason"
  - "scripts/native_assets_lib/material_program.py: derive_material_program, read_material_class_defaults"
  - "scripts/native_assets_lib/material_resources.py: write_native_material_resources (/l2/native-materials/<sha>/graph.json and program.json)"
  - "scripts/audit-material-census.py and docs/parts/adapter-dispatch/material-class-census.json"
  - "gap reasons material-class-unported:<class> and material-feature-unported:<property> (seed listVersion 2, effect-class-unsupported removed)"
affects: [02-30, 02-31, 02-43, 02-45, 02-60, 02-61, 02-62, 02-68, 02-69]

actuals:
  tokens: 28600
  tasks: 3
  commits: 4
plan_head_before: b679a7c7d7c3ffab6c2fed66c6a030fd109fb116
plan_head_after: af7c143478838bafef3bbeee211c08a32b570661

tech-stack:
  added: []
  patterns:
    - "Class defaults come from one reader with an injectable class-script source: ReferenceClientClassScripts for the client, a synthetic double in tests"
    - "Material readers return gap reasons; the lane step that owns the part writes the rows"
    - "Synthetic UE2 packages for tests are built from JSON in tests/fixtures/material-graph/ by tests/pipeline/material_graph_fixture.py and parsed by the real ue2 property reader"

key-files:
  created:
    - scripts/native_assets_lib/class_defaults.py
    - scripts/native_assets_lib/material_program.py
    - scripts/native_assets_lib/material_resources.py
    - scripts/audit-material-census.py
    - docs/parts/adapter-dispatch/material-class-census.json
    - tests/pipeline/test_class_defaults.py
    - tests/pipeline/test_material_graph.py
    - tests/pipeline/test_material_census.py
    - tests/pipeline/material_graph_fixture.py
    - tests/pipeline/synthetic_class_scripts.py
    - tests/fixtures/material-graph/shader-combiner-panner-texture.json
    - tests/fixtures/material-graph/unported-classes-and-features.json
  modified:
    - scripts/native_assets_lib/material_graph.py
    - scripts/native_store/gap_reasons.json
    - tests/pipeline/test_gap_rows.py
    - docs/OUTPUT_CONTRACT.md
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/STATE.md

key-decisions:
  - "read_class_defaults_with_provenance takes a fourth class_scripts argument; the queried class's own defaults are authored, an ancestor's class-default, a declared unset field ue-zero with value null (row 197)"
  - "A redeclared field hides the ancestor declaration and its default; Interlude Engine.Shader redeclares AlphaRef (row 198)"
  - "Reviewed classes are qualified Engine.* names and the class reason carries the qualified class; Engine.Palette is preserved data, not a material (row 199)"
  - "AnimNext loops are kept, every other reference cycle is refused (row 200)"
  - "material-feature-unported covers undeclared properties, ArrayProperty children, a triggered MaterialSequence.TriggerAction and FinalBlend FB_Add, whose field is unconfirmed (row 201)"
  - "native-materials/<sha>/ is addressed by the SHA-256 of program.json (row 202)"
  - "The census resolves material classes through system/*.u export-table super chains with its own 118 and 123 table reader and lists intrinsic classes as unresolved (row 203)"
  - "preserve_material_graph, DefaultReader and read_class_defaults are not rerouted in this plan (row 204)"
  - "MAT-01 and CONV-02 stay Pending (row 205)"

patterns-established:
  - "Every material root owner (static mesh slot, BSP surface, terrain layer, skeletal slot, emitter or sky surface) calls read_material_graph on its root export, read_material_class_defaults, derive_material_program and write_native_material_resources, then writes gap rows for the returned reasons"

requirements-completed: []

coverage:
  - deliverable: "Class-default reader with authored, class-default and ue-zero provenance"
    human_judgment: false
    verification:
      - {kind: test, ref: "tests/pipeline/test_class_defaults.py", status: pass}
  - deliverable: "Source-preserving material graph, typed program and native-materials writer"
    human_judgment: false
    verification:
      - {kind: test, ref: "tests/pipeline/test_material_graph.py", status: pass}
  - deliverable: "Material gap reasons in the seed list"
    human_judgment: false
    verification:
      - {kind: test, ref: "tests/pipeline/test_material_graph.py#MaterialGapReasonTests", status: pass}
      - {kind: test, ref: "tests/pipeline/test_gap_rows.py", status: pass}
  - deliverable: "Interlude material class census"
    human_judgment: false
    verification:
      - {kind: test, ref: "tests/pipeline/test_material_census.py", status: pass}
      - {kind: command, ref: "python -B scripts/audit-material-census.py --client E:/Lineage2-client", status: pass}

duration: 35min
completed: 2026-11-08
---

# Phase 2 Plan 59: Class-default and material graph readers Summary

**One class-default reader walks any UE2 class chain through the pinned UELib and returns every field as authored, class-default or ue-zero; `read_material_graph` keeps any material root's nodes, tags and references as decoded; `derive_material_program` types each field beside it with that provenance; `write_native_material_resources` writes `/l2/native-materials/<sha>/graph.json` and `program.json`; and the Interlude census counts 42,124 material exports in 20 classes across all 830 lock-equal packages, 14 reviewed and 6 `material-class-unported`.**

## Performance

- Duration: about 35 min (19:16 to 19:51 UTC), including two 3 min census runs and one 2 min `pnpm test:pipeline`.
- Tasks: 3 of 3.
- Files: 12 created, 8 modified.

## Accomplishments

- `class_defaults.py`: the class chain comes from the export table (`SourcePackages`), each class is decompiled once through the data-ui `read_class_defaults` (UELib pin unchanged) and cached as `<work_root>/class-defaults/<Class>.json`, reused while the package SHA-256 and UELib pin match; the work root must pass `require_converter_output`. Struct and static-array defaults inherit member by member. A field the chain does not declare is refused, so nothing is filled that the source does not declare. Real client: `Engine.StaticMeshActor.bBlockPlayers` is `true`, authored by `Engine.StaticMeshActor`; `FrameBufferBlending` member 8 is `FB_Add`.
- `material_graph.py` `read_material_graph(package, root_export)`: breadth-first over decoded ObjectProperty tags inside one package, nodes sorted by export index with verbatim property tags, export span and native tail hashes; imports recorded with their class, not followed; `AnimNext` loops kept, other cycles, foreign roots and forged references refused; 128 nodes at most. The existing `preserve_material_graph` StaticMesh policy is unchanged apart from its comments.
- `material_program.py`: `read_material_class_defaults` reads each reviewed class once (fields below `Core.Object`); `derive_material_program` gives every field a provenance, enums as `{ordinal, name}`, references as node ids, structs as raw bytes, and the `unconfirmed` and `unported` statuses with their reasons. Nothing is flattened or evaluated.
- `material_resources.py` refuses `public/l2` (test) and writes graph and program immutably with matching SHA-256 records.
- `gap_reasons.json`: listVersion 2, `material-class-unported:<class>` and `material-feature-unported:<property>` added, `effect-class-unsupported:<class>` removed (no row or code used it).
- `scripts/audit-material-census.py`: 830 packages read (versions 118 and 123, none unreadable); reviewed 14 classes with 42,010 exports, unported Engine.GlowModifier 41, Engine.Cubemap 36, Engine.VertexColor 29, Fire.FireTexture 3, Fire.WetTexture 3, Engine.TexOscillatorTriggered 2; 14 intrinsic classes listed as `unresolvedClasses`.
- Real material run: all 46 Shader, Combiner and FinalBlend roots of `textures/FX_E_T.utx` convert, with only `material-class-unported:Engine.TexOscillatorTriggered`.

## Task commits

1. Task 1 RED: `949510c` test(02-59): add the class-default provenance reader tests
2. Task 1 GREEN: `fb56301` feat(02-59): add the one class-default reader with authored, class-default and ue-zero provenance
3. Task 2: `1d3b070` feat(02-59): add the source-preserving material graph, typed program and native-materials writer
4. Task 3: `af7c143` feat(02-59): add the Interlude material class census from export tables
5. Docs: the commit holding this summary, EVIDENCE, STATUS, STATE, ROADMAP and OVERNIGHT-DECISIONS rows 197 to 205

## Acceptance counts

| Check | Result |
|---|---|
| `grep -c "ue-zero" class_defaults.py` | 2 |
| `grep -c "effect-class-unsupported" gap_reasons.json` | 0 (baseline 1) |
| `grep -c "material-class-unported" gap_reasons.json` | 1 |
| `grep -c "native-materials" docs/OUTPUT_CONTRACT.md` | 2 |
| `test_class_defaults.py` | 11 pass (2 on the conversion client) |
| `test_material_graph.py` | 15 pass (1 on the conversion client) |
| `test_material_census.py` | 5 pass (1 on the conversion client) |
| `test_gap_rows.py` | 11 pass |
| `pnpm test:pipeline` | 1,172 tests, 0 failures, 107 skipped |
| Lane ownership | `lane integration: 0 foreign paths` |
| Reference overlap `--area materials` | exit 0, no `src/materials` sources yet |
| Census file | every class `reviewed` or `material-class-unported` |

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The reader needs a client and a testable class source**
- Found during: Task 1.
- Issue: `read_class_defaults_with_provenance(class_name, fields, work_root)` has no client root, and synthetic chains need an injectable source.
- Fix: a fourth argument `class_scripts` (`ReferenceClientClassScripts(client)` or a test double). Row 197. Commit `fb56301`.

**2. [Rule 1 - Bug] Redeclared fields in Interlude classes**
- Found during: Task 2, first real run on `FX_E_T.utx`.
- Issue: `Engine.Shader` redeclares `AlphaRef` from `Engine.Material`; the first reader refused the duplicate field list.
- Fix: the most derived declaration wins and hides the ancestor's default; synthetic shadow test added. Row 198. Commit `1d3b070`.

**3. [Rule 1 - Bug] Animated texture loops**
- Found during: Task 2, real run.
- Issue: refusing every cycle (threat T-02-59-01 as written) failed `FX_E_T.WaterSurfaceSet.waterfall001`, whose `AnimNext` chain loops.
- Fix: only a cycle with a non-`AnimNext` edge is refused; loop and refusal both tested. Row 200. Commit `1d3b070`.

**4. [Rule 2 - Correctness] Field schema for the typed program**
- `read_class_field_declarations` and `ClassFieldDeclaration` added to `class_defaults.py`, so the program types fields from the decompiled declarations and enums instead of a typed list. Commit `1d3b070`.

**5. [Rule 3 - Blocking] Version-118 packages in the census**
- `native_catalog.ue2.Package` (data-ui, not editable here) refuses version 118, which `l2_skies.utx` and other packages use; the census has its own export-table reader for 118 and 123, checked against `Package` on `FX_E_T.utx`. Intrinsic classes without a script export are listed, not dropped. Row 203. Commit `af7c143`.

**6. Test support**
- `test_gap_rows.py` expected seed listVersion 1 with 28 reasons; it now expects 2 with 29. The synthetic class-script double moved to `tests/pipeline/synthetic_class_scripts.py` for both test files.

### Process deviations

- Task 2 code was drafted before its tests ran; its tests and code landed in one commit, so there is no RED record for Task 2. Task 1 followed RED then GREEN.
- `material_graph.py` already existed (the Converter's StaticMesh preserve policy); the new reader was added to it instead of a new file, and its docstrings and comments were removed.

**Total deviations:** 5 auto-fixed (2 bugs, 2 blocking, 1 correctness) plus one test-support change. **Impact:** the plan's contracts hold; the reader signature gains one argument and the cycle rule follows real Interlude data.

## Known stubs

None.

## Threat flags

None beyond the plan's register. T-02-59-01: guard clauses on root, reference index and table entry, the 128-node bound, and refusal of non-`AnimNext` cycles. T-02-59-02: `write_native_material_resources` and the class-default cache both go through `require_converter_output`. T-02-SC: nothing installed.

## Needs Human

None new. The pending data-ui approval for `read_class_defaults` stays in STATE Pending Todos.

## Process cleanup

Every command ran in the foreground or as one background census run that exited 0 before this summary. No dev server, preview, Playwright, browser or Vitest run was started. After the plan `netstat -ano` shows no listener on 5173 or 5175; the shell process list shows no python, node, Vite or browser process from this plan (one `python.exe` from 2026-11-07 predates the plan). The scratch folders under `artifacts/test-scratch/` were removed.

## Self-Check: PASSED

- Files: all 12 created files exist.
- Commits: `949510c`, `fb56301`, `1d3b070` and `af7c143` are ancestors of HEAD.
