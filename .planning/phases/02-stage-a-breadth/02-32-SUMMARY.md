---
phase: 02-stage-a-breadth
plan: 32
subsystem: integration
tags: [python, native-assets, dat-tables, npcgrp, material-slots, source-binding]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-09 Converter source digests through the reference client guard (recorded_source_sha256, table cache)"
provides:
  - "scripts/native_assets_lib/source_table_binding.py: source_slot_bindings, verify_source_table_binding, material_overrides_by_slot"
  - "Request field sourceBinding.slotBindings: [{slot, texturePath}] beside the unchanged single-slot form"
  - "One binding evidence shape: {table, sourceSha256, meshPath, meshReference, slotBindings: [{slot, texturePath, textureReference}], schema, decodedSha256}"
affects: [02-34]

actuals:
  tokens: 5700
  tasks: 3
  commits: 2
plan_head_before: 849c84282e1c7f307c48fff178b7ab0478850f67
plan_head_after: 37ebdb6bc226a3344bd92b7b4966addaa0c86ba2

tech-stack:
  added: []
  patterns:
    - "Exact key sets per request form, integer slot checks with bool excluded, override slot set equal to the cited slot set"

key-files:
  created:
    - scripts/native_assets_lib/source_table_binding.py
    - tests/pipeline/test_native_assets_slot_bindings.py
  modified:
    - scripts/native_assets.py
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "slotBindings request field and one evidence shape for both forms; the binding module also owns <slot>=<reference> override parsing (row 187)"
  - "ACT-02 stays Pending: this plan converts nothing, 02-34 converts the multi-texture NPC units (row 188)"

patterns-established:
  - "A material slot binds from a table only when the cited row names a non-empty texture equal to the request override"

requirements-completed: []

duration: 12min
completed: 2026-11-08
---

# Phase 2 Plan 32: Multi-slot verify_binding Summary

**`Converter.verify_binding` now verifies a list of npcgrp texture slots against the decoded table through one binding module, binds only cited slots with `native-table-selection`, and leaves every uncited slot the magenta `UNBOUND_SOURCE_SLOT_<index>` diagnostic.**

## Performance

- Started: 2026-11-08T18:37:39Z
- Completed: 2026-11-08T18:50Z
- Tasks: 3
- Files: 3 code and test files, plus planning docs

## Accomplishments

- `scripts/native_assets_lib/source_table_binding.py` (89 lines) is the single owner of table-to-request binding checks. It accepts the single form (`table, sourceSha256, meshPath, texturePath`, optional `slot`, default 0) or the list form (`table, sourceSha256, meshPath, slotBindings`), and refuses every other key set by name.
- A cited slot whose table texture is non-empty must have an equal override (casefold); a slot whose table texture is empty must have none. The override slot set must equal the cited slot set, otherwise `Recipe material override is not cited by its native table binding`.
- `Converter.verify_binding` keeps the source path, source hash and `table_cache` checks, then calls `verify_source_table_binding(request, self.table_cache[name])`. The inline `value` helper and comparison are deleted. `model_part` parses overrides through `material_overrides_by_slot`, so one function owns the `<slot>=<reference>` format.
- Real conversion client case: npcgrp row index 2, npc id 20003, mesh `LineageMonsters.goblin_m00`, textures `LineageMonstersTex.goblin_t00` and `LineageMonstersTex.goblin_t01`, verified as slots 0 and 1. The case ran (not skipped) on DATABASE-PC. Slot index equal to texture index is only this test's input; 02-34 labels the rule in its requests.

## Task commits

1. Task 1, two-slot tracer through Converter: `8c64e0e` feat(02-32): verify a list of table slot bindings in one binding module
2. Task 2, refusals, single-slot equivalence, recipe regression, real npcgrp row: `37ebdb6` test(02-32): cover slot binding refusals, single slot equivalence and a real npcgrp row
3. Task 3, pipeline run, ownership check, docs: this docs commit

## Acceptance counts

- `grep -c verify_source_table_binding scripts/native_assets.py`: 2 (import and call).
- `grep -c "def value" scripts/native_assets.py`: 2 at the plan start, 1 now (the one left is `verify_actor_attachment`).
- `wc -l scripts/native_assets.py`: 797 at the plan start, 782 now. `source_table_binding.py`: 89 lines.
- The comment grep over both Python files and the new test prints nothing.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_native_assets_slot_bindings.py"`: 18 tests OK, none skipped.
- `python -B -m unittest discover -s tests/pipeline -p "test_native_assets*.py"`: OK (4 skipped, all pre-existing).
- `python -B -m unittest discover -s tests/pipeline -p "test_native_mystic_players.py"`: 8 tests OK, 4 skipped.
- `pnpm test:pipeline` at BelowNormal: 1,141 tests OK, 107 skipped, 0 failures, 88 s. The 02-21 baseline was 1,123 OK and 107 skipped; this plan adds 18 tests. No baseline failure exists, so there is nothing new.
- `node scripts/check-lane-ownership.mjs --base 849c842 --part adapter-dispatch`: `lane integration: 0 foreign paths`, exit 0.
- The machine schedule check passed before every test command (DATABASE-PC, no active window).

## Cache note

`implementation_hash()` covers `native_assets_lib/*.py` and `native_assets.py`, so the next real conversion misses its cache once.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 2 - Single owner] Override parsing moved into the binding module**
- Found during: Task 1
- Issue: `model_part` parsed `<slot>=<reference>` overrides inline, and the new verifier needs the same parsing for its slot set check.
- Fix: `material_overrides_by_slot` in `source_table_binding.py` is used by both, with a guard for an entry that has no `=`. Same duplicate message as before.
- Files modified: `scripts/native_assets.py`, `scripts/native_assets_lib/source_table_binding.py`
- Commit: `8c64e0e`

**2. [TDD order] Task 2 had no red step**
- Found during: Task 2
- Issue: the Task 1 action already specified every guard clause (key sets, integer slots, duplicates, uncited overrides), so they landed with the tracer. The Task 2 behaviour tests passed on first run.
- Fix: none needed. Each refusal has its own test method with a message regex, so each guard is pinned. Extra cases beyond the list: an entry with extra keys, a cited slot without an override, a mesh mismatch, and case and leading-zero slot encoding.

## Known stubs

None.

## Threat flags

None. The new surface (decoded table strings and generated requests) is the one the plan's threat model covers; T-02-3201 to T-02-3203 are mitigated by the key set, slot, duplicate and slot set checks and by the unchanged source hash check before decode.

## Process cleanup

This plan started only foreground Python and pnpm runs, and every one exited. No listener on ports 5173 or 5175. The only Python and node processes on the machine predate this plan (node since 29 Oct, one Python started on 7 Nov).

## Self-Check: PASSED

- FOUND: scripts/native_assets_lib/source_table_binding.py
- FOUND: tests/pipeline/test_native_assets_slot_bindings.py
- FOUND: 8c64e0e
- FOUND: 37ebdb6
