---
phase: 02-stage-a-breadth
plan: 74
subsystem: adapter-dispatch
tags: [integration, gap-closure, mat-01, mat-02, conv-02, found-02, material-program, texture-image-pins, source-preservation]
status: complete
requires:
  - phase: 02-stage-a-breadth
    provides: 02-59 material graph and program derivation, 02-60 UE2 material library, 02-72 OUTPUT_CONTRACT edits
provides:
  - derive_material_program(graph, class_defaults, texture_images=...) writing the image member on every Engine.Texture node
  - checked_texture_image and checked_texture_images, the Python pin guard, with MAXIMUM_TEXTURE_IMAGE_BYTES
  - write_material_program_record(store_root, graph, program), the one program record writer 02-86 moves the bsp and sky steps onto
  - tests/fixtures/material-programs/textured-program.json, written by the pipeline test and compiled by Vitest
  - maximumTextureImageBytes exported from src/materials/ue2/model/materialProgram.ts
  - unresolved_evidence_problem and REPAIR_STEPS_AWAITING_OWNER_DECISION in the source preservation contract
affects: [02-86 (passes pins, deletes material_program_record and write_sky_material_program), 02-89 (keeps the CONV-02 tangent Needs Human line), every batch that reseals native-materials]
tech-stack:
  added: []
  patterns: [one shared contract fixture written by Python and parsed by TypeScript, constant parity read from the Python integer literal, owner decision list pinned to the unresolved rows by an equality test]
key-files:
  created:
    - tests/pipeline/test_material_program_images.py
    - tests/fixtures/material-programs/textured-program.json
    - tests/unit/materialProgramImagePins.test.ts
  modified:
    - scripts/native_assets_lib/material_program.py
    - scripts/native_assets_lib/material_resources.py
    - src/materials/ue2/model/materialProgram.ts
    - docs/OUTPUT_CONTRACT.md
    - tests/pipeline/test_material_graph.py
    - tests/pipeline/source_preservation_scan.py
    - tests/pipeline/test_source_preservation_contract.py
    - .gitattributes
    - docs/parts/adapter-dispatch/EVIDENCE.md
decisions:
  - "P964: only Engine.Texture nodes carry the image member (the pin or null); other nodes carry none, so programs that reach no Texture keep their bytes"
  - "P965: a pin must hold exactly bytes, path and sha256, and a pin naming no node of the graph is refused like a pin on another class"
  - "P966: materialProgram.ts exports maximumTextureImageBytes and material_program.py holds MAXIMUM_TEXTURE_IMAGE_BYTES = 33554432; the Vitest reads the Python literal and checks equality and the limit edge"
  - "P967: the fixture is the SkyPanner root of the synthetic shader-combiner-panner-texture graph with a 2 x 2 stored-deflate PNG pin; MATERIAL_PROGRAM_FIXTURE_UPDATE=1 is the update path; tests/fixtures/material-programs/** is -text"
  - "P968: the CONV-02 build1590 tangent repair gets its Needs Human line in STATE.md now, because the contract cites it"
metrics:
  duration: 10min
  completed: 2026-11-11
commits: 4
plan_head_before: 4d39548c7a5e5194185ba98df423bf5eb4dde269
plan_head_after: c44ce3459169dcc7d5de6213770ce48891463dff
actuals:
  tokens: 19500
  tasks: 3
  commits: 4
---

# Phase 2 Plan 74: texture image pins on material programs and the unresolved evidence refusal Summary

`derive_material_program` now takes `texture_images` keyed by Texture node object. It writes each pin as the node `image` `{path, sha256, bytes}`, and a Texture node without a pin keeps `image: null`. A synthetic textured program written by the pipeline test parses in `parseMaterialProgram` and compiles to one sampler whose frame image is the pin. The source preservation contract now refuses `unresolved:` defect evidence on every running repair except the two build1590 tangent steps, which stay pinned by name to the CONV-02 owner decision.

## What was built

- Task 1 (tracer): `program_node` sets `image` on every `Engine.Texture` node from the `texture_images` mapping (default empty), and `None` when no pin is given. `tests/pipeline/test_material_program_images.py` derives the program of the synthetic `SkyPanner` root (a TexPanner over one Engine.Texture) with a pin for a 2 x 2 synthetic PNG. It compares the program byte for byte with `tests/fixtures/material-programs/textured-program.json`, which only `MATERIAL_PROGRAM_FIXTURE_UPDATE=1` regenerates. `tests/unit/materialProgramImagePins.test.ts` parses that fixture: the image sits on the Texture node only, the program compiles to one sampler whose `frameImages` is the pin with the panner as its modifier, and the same program with `image: null` compiles to `texture-image-absent:SyntheticMaterials.SkyTexture`. Tracer gate: verify re-run end to end, passed.
- Task 2: `checked_texture_images` refuses these pins with `MaterialProgramError` before any program is built: a pin on a node that is not `Engine.Texture`, a pin naming no node of the graph, a path that does not match the `/l2/` native resource rule of `readTextureImage`, a malformed SHA-256, a size that is not a positive int up to `MAXIMUM_TEXTURE_IMAGE_BYTES` (33554432, equal to the exported `maximumTextureImageBytes`, checked by the Vitest at the limit and one byte over), and a pin with members other than bytes, path and sha256. `write_material_program_record(store_root, graph, program)` in `material_resources.py` returns `({directory, programSha256}, files)`. A test shows it equals what `material_program_record` (bsp) and `write_sky_material_program` (sky) return today, so 02-86 can delete both copies. The OUTPUT_CONTRACT native-materials row documents the Texture node `image` field (pin or null with `texture-image-absent:<node>`), the guard and the writer. This closes the converter half of the slice-10 finding on `materialProgram.ts:156`.
- Typed tile resources paragraph (slice-08 finding on `scripts/world/typed_payload.py:98`, FOUND-02): the committed contract already describes native-tile-collision, bsp-visibility and lighting as typed payload folders `maps/<asset.json sha256>/<folder>/` holding `asset.json` and a 4-byte aligned `payload.bin`, not `.l2asset` packages. It has said so since commit 48e2287 ("Write the Phase 2 independent review fix report and apply its evidence notes to the docs"), so it was left unchanged.
- Task 3: `defect_evidence_problem` now returns "a running repair needs repo-backed defect evidence, not unresolved" for any `unresolved: ` cell. The check that the missing proof is named moved to `unresolved_evidence_problem`. `REPAIR_STEPS_AWAITING_OWNER_DECISION = ('omit-zero-tangent-attribute', 'repair_vertex_metadata')` sits beside the other allow-lists. Three tests use it:
  - `test_every_row_outside_the_owner_decision_list_has_repo_backed_defect_evidence` (renamed)
  - `test_owner_decision_list_is_exactly_the_unresolved_rows`: it fails on a new unresolved row, or on a pinned row whose evidence became a repo path
  - `test_contract_names_the_repairs_awaiting_the_owner_decision`

  The contract prose states the rule. `scripts/native_assets_lib/gltf.py` and the two evidence cells are unchanged (rules G7 and G10).

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_material_*.py" -v`: 30 tests OK.
- `python -B -m unittest discover -s tests/pipeline -p "test_source_preservation_contract.py" -v`: 31 tests OK. The plan's one-line check that `defect_evidence_problem('unresolved: no test reproduces the defect')` is truthy exits 0. At plan start it returned None.
- `pnpm vitest run tests/unit/materialProgramImagePins.test.ts tests/unit/materialProgram.test.ts tests/unit/ue2StagePlan.test.ts`: 39 tests passed. `pnpm typecheck` passes.
- Callers of the changed derivation: `test_world_bsp_step.py` 20 OK (1 skipped), `test_world_sky_step.py` 16 OK, `test_world_sky_materials.py` 26 OK, `test_native_material_graph.py` 5 OK (3 skipped).
- `node scripts/check-lane-ownership.mjs --base 4d39548 --part adapter-dispatch`: lane integration, 0 foreign paths.
- Reference overlap, area `materials` (`node tools/reference-overlap/referenceOverlap.mjs --area materials --reference-root C:/laragon/www/l2-browser-client`): exit 0, 0 blocking runs, 0 unreviewed runs. The report went to stdout and no report file was written.

## Deviations from Plan

### Auto-fixed issues

1. [Rule 3 - Blocking] `maximumTextureImageBytes` was module-private in `src/materials/ue2/model/materialProgram.ts`. It is now exported so the Vitest can assert both sides agree (one-word change; file not in files_modified). Commit af538d4.
2. [Rule 3 - Blocking] `.gitattributes` gains `tests/fixtures/material-programs/** -text`. Without it, an autocrlf checkout rewrites the fixture to CRLF and the byte-for-byte comparison fails. Commit cddfd42.
3. [Rule 2 - Correctness] The pin guard also refuses a pin naming no node of the graph and a pin with members other than bytes, path and sha256, because the program writes the pin as given (P965).
4. [Docs truth] `docs/parts/adapter-dispatch/EVIDENCE.md` said no converter writes the `image` member. It now says the derivation writes it and no world step passes pins until 02-86. The file stays 30,666 bytes, under 30,720. STATE.md open follow-up "BSP surface material files and texture image pins" now names what 02-74 delivered and what 02-86 does. Both changes are in the docs commit.
5. The plan names the TypeScript reader `readMaterialProgram`; the exported function is `parseMaterialProgram`, and the tests use it.

### Commit count

`commits: 4` is measured as `git rev-list --count 4d39548..HEAD` and includes bc6f078 ("Review the Python converter overlap runs 02-93 added to bsp-visibility and movement"). Another agent committed it in this worktree while the plan ran. This plan's task commits are cddfd42, af538d4 and c44ce34.

## Decisions

Rows 964 to 968 in `.planning/OVERNIGHT-DECISIONS.md` (P964 to P968 in STATE.md).

## Needs Human

- Added: CONV-02 gap item (a), the build1590 tangent repair. Prove the zero-vector tangents with a test, or remove `repair_vertex_metadata` and the `omit-zero-tangent-attribute` record. This is an owner decision (rule G10, OVERNIGHT-DECISIONS rows 887 and 968).

## Open follow-ups

- 02-86 passes the pins of the textures it converts, replaces `material_program_record` and `write_sky_material_program` with `write_material_program_record`, deletes the comparison against them in `test_program_record_writer_returns_the_directory_and_program_pin_the_world_steps_write_today`, and restages the BSP and sky programs.
- Program bytes change for every program that reaches a Texture node (`image: null` added). Under rule G6, native-materials directories and the bsp and sky steps that pin them reseal on their next run.

## Known stubs

None. The `NO_TEXTURE_IMAGES` default is the real state of every caller until 02-86, and it compiles to the named `texture-image-absent:<node>` diagnostic, not to a stand-in.

## Threat flags

None beyond the plan's threat model. T-02-74-01 and T-02-74-02 are mitigated by `checked_texture_image` (path rule, SHA-256, size) and again by `readTextureImage`. T-02-74-03 is mitigated by `test_owner_decision_list_is_exactly_the_unresolved_rows`.

## Process cleanup

This plan started no dev server, Vite preview, Playwright or e2e runner. Each Vitest and Python run exited when it finished. After the last run, nothing listened on ports 5173 or 5175, and the only process whose command line contains the worktree path was the shell running that check.

## Self-Check: PASSED

- FOUND: tests/pipeline/test_material_program_images.py, tests/fixtures/material-programs/textured-program.json, tests/unit/materialProgramImagePins.test.ts
- FOUND commits: cddfd42, af538d4, c44ce34
