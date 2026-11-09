---
phase: 02-stage-a-breadth
plan: 25
subsystem: sandbox
tags: [sandbox, catalog-index, coverage, dev-sheet, playwright, package-scripts, int-01]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-05 NativeCatalogLookup converted | not-in-catalog | gap with the coverage reason; 02-07 build_coverage_report.py; 02-22 actors lane store with npc:20001 converted and npc:20002 gap; 02-14, 02-17, 02-19, 02-22 lane converter entry points; 02-08 PackageScriptNamingTests"
  - phase: 01-foundations
    provides: "01-14 sandbox command sheet and missing-asset marker"
provides:
  - "src/runtime/sandboxCatalogLookupNote.ts: describeSandboxCatalogLookup, SandboxCatalogLookupNote"
  - "All four by-ID sandbox actions note converted, gap or not in catalog with the reason; shared sandbox.lastKey and sandbox.lastLookup variables"
  - "tests/unit/support/sandboxCommandSheetFakes.ts: fakeCatalogIndexOver, createSandboxSection, attachSandboxSheetWithFakes"
  - "package.json convert:tables, convert:world, convert:actors, convert:ui"
affects: [02-26, 02-55, 02-70]

actuals:
  tokens: 13000
  tasks: 3
  commits: 3
plan_head_before: e09690e75c0262ae3d605f192393872d6d62346a
plan_head_after: b92d7bd7452e1f2378f9111fb79907d083bd3a77

tech-stack:
  added: []
  patterns:
    - "One mapping from catalog lookup to sheet note text and tone; the text reuses the index's describeNativeCatalogLookup"
    - "Browser checks read expected lookup states from the served /l2/catalog.json and /l2/coverage.json instead of typing them"

key-files:
  created:
    - src/runtime/sandboxCatalogLookupNote.ts
    - tests/unit/sandboxCoverageNotes.test.ts
    - tests/unit/support/sandboxCommandSheetFakes.ts
    - tests/browser/sandbox-coverage-notes.spec.ts
  modified:
    - src/runtime/attachSandboxCommandSheet.ts
    - src/runtime/sandboxNpcVisual.ts
    - tests/unit/sandboxCommandSheet.test.ts
    - tests/unit/sandboxNpcAppearances.test.ts
    - tests/browser/sandbox.spec.ts
    - tests/browser/sandbox-lane-npc-spawn.spec.ts
    - package.json
    - tests/pipeline/test_converter_independence.py
    - README.md
    - STATUS.md
    - docs/parts/sandbox/EVIDENCE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Row 446: note text from describeNativeCatalogLookup, tone from an exhaustive switch (converted info, gap and not in catalog warning), set through textContent"
  - "Row 447: the browser check runs on NATIVE_STORE_ROOT=actors with the coverage regenerated in Task 1 and reads expected notes from the served files"
  - "Row 448: a stale coverage file is 02-05's refusal; no new runtime code"
  - "Row 449: the spawn note drops the model suffix; the spawn presentation's unused key and modelCatalogId fields are deleted"
  - "Row 450: one shared last lookup; sandbox.lastKey and sandbox.lastLookup on every by-ID entry; per-group lastKey variables deleted"
  - "Row 451: README converter example without --, since pnpm 10 forwards it to the script"

patterns-established:
  - "Sandbox sheet unit tests share tests/unit/support/sandboxCommandSheetFakes.ts"

requirements-completed: []

coverage:
  - id: D1
    description: "describeSandboxCatalogLookup maps converted, gap and not in catalog to note text and tone, reasons verbatim and literal"
    requirement: INT-01
    verification:
      - kind: unit
        ref: "tests/unit/sandboxCoverageNotes.test.ts#describeSandboxCatalogLookup"
        status: pass
    human_judgment: false
  - id: D2
    description: "Spawn NPC notes npc:20001 converted, npc:20002 gap with its served coverage reason and npc:999999 not in catalog in a real browser on the actors lane store, and still spawns the missing-asset marker"
    requirement: INT-01
    verification:
      - kind: unit
        ref: "tests/unit/sandboxCoverageNotes.test.ts#sandbox spawn NPC coverage notes"
        status: pass
      - kind: e2e
        ref: "tests/browser/sandbox-coverage-notes.spec.ts#every by-ID action notes its key as converted, gap or not in catalog with the reason from the served catalog and coverage"
        status: pass
    human_judgment: false
  - id: D3
    description: "Equip item, Cast skill and Open window use the same notes; sandbox.lastKey and sandbox.lastLookup on every entry; open window never dispatches"
    requirement: INT-01
    verification:
      - kind: unit
        ref: "tests/unit/sandboxCoverageNotes.test.ts#sandbox equip, cast and open window coverage notes"
        status: pass
      - kind: e2e
        ref: "tests/browser/sandbox-coverage-notes.spec.ts (item 999999, skill 7 level 1, StatusWnd)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Screenshots at 1440 x 900 and 932 x 430 touch, no horizontal scroll at 430 x 932"
    requirement: INT-01
    verification:
      - kind: e2e
        ref: "test-results/sandbox-coverage-notes/sandbox-coverage-notes-desktop.png and sandbox-coverage-notes-phone.png"
        status: pass
    human_judgment: false
  - id: D5
    description: "Exactly four convert:* package scripts pointing at existing lane entry points"
    requirement: INT-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_converter_independence.py#PackageScriptNamingTests.test_package_declares_exactly_the_four_lane_converter_scripts"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-11-09
---

# Phase 2 Plan 25: Sandbox coverage notes and convert:* scripts Summary

**Every by-ID sandbox action (spawn NPC, equip item, cast skill, open window) now notes its key as converted (info), gap with the coverage row reason, or not in catalog with the index reason (warning), through one `describeSandboxCatalogLookup`. A real-browser check on the actors lane store shows npc:20001 converted, npc:20002 gap with its served coverage reason and npc:999999 not in catalog. The four lane converters are named `convert:tables`, `convert:world`, `convert:actors` and `convert:ui`.**

## Performance

- Duration: about 22 min (2026-11-09T13:04Z to 13:26Z)
- Tasks: 3 of 3
- Files: 4 created, 12 modified

## Accomplishments

- `src/runtime/sandboxCatalogLookupNote.ts`: `describeSandboxCatalogLookup(lookup)` returns `{ tone, text }`. The text comes from the index's `describeNativeCatalogLookup`, the same wording the missing-asset marker label uses. The tone comes from an exhaustive switch whose default assigns to `never`.
- `attachSandboxCommandSheet.ts`: all four actions call `describeSandboxCatalogLookup(` (4 call sites, 193 lines). Two notes are kept on top of the lookup: rejected by the adapter, and converted for another player profile / converted but its appearance cannot load. Both are warnings. `sandbox.lastKey` and `sandbox.lastLookup` sit on every by-ID entry and follow the last submitted key. `sandbox.lastLookup` reads `converted` or `<status>: <reason>`, has status `native`, and names `nativeCatalogIndex`, `/l2/catalog.json` and `/l2/coverage.json` as its source.
- Gap and not-in-catalog keys still dispatch. A gap NPC is drawn as the 01-14 missing-asset marker (label `npc:20002 gap: <reason>`, no mesh, no model), never as a stand-in body.
- `package.json`: `convert:tables`, `convert:world`, `convert:actors` and `convert:ui` come after `test:pipeline`. A new `PackageScriptNamingTests` case asserts this exact set and that each invoked file exists. README lists them.

## Task commits

1. Task 1 (tracer): `02ca591` Note each sandbox NPC spawn as converted, gap or not in catalog from the catalog index
2. Task 2: `9910f05` Note equip, cast and open window lookups through the shared sandbox note and share the last lookup variables
3. Task 3: `b92d7bd` Name the four lane converters convert:tables, convert:world, convert:actors and convert:ui

## Verification

- Task 1: `pnpm report:coverage --store-root artifacts/lane-store/actors/l2 --lane actors` regenerated the coverage report, still pinned to lane catalog `7ab1cdcf97c76c81...`. npc:20002 is a gap row: `converter-refused:Mesh bone has no unique native parent/name mapping: bip01 r finger0nub`.
- `pnpm typecheck`: clean. `pnpm vitest run tests/unit/sandboxCoverageNotes.test.ts tests/unit/sandboxCommandSheet.test.ts tests/unit/sandboxNpcAppearances.test.ts`: 45 passed.
- Tracer gate: `NATIVE_STORE_ROOT=actors pnpm test:e2e tests/browser/sandbox-coverage-notes.spec.ts` passed (port 5173 free, 2026-11-09 15:08 Riga). After Task 2 the 2-test spec passed again (15:14 Riga, 1.8 min).
- Screenshots: `test-results/sandbox-coverage-notes/sandbox-coverage-notes-desktop.png` (1440 x 900: spawn npc:999999 not in catalog, item:999999 not in catalog, skill:7:1 gap: native-skill-dispatch-required, window:StatusWnd not in catalog: interface windows are not converted yet (UI-01)). `test-results/sandbox-coverage-notes/sandbox-coverage-notes-phone.png` (932 x 430, isMobile and hasTouch). The portrait check asserts `scrollWidth` 430 at 430 x 932. A group shows one note at a time, so the three spawn states are asserted one after another; the screenshots show the last note of each group.
- `python -B -m unittest discover -s tests/pipeline -p "test_converter_independence.py" -k PackageScriptNamingTests -v`: 10 OK.
- Full `pnpm test:unit`: 153 files passed, 5 skipped (2,056 tests passed, 82 skipped). Full `pnpm test:pipeline`: 1,659 tests OK (103 skipped). No failures outside the baseline.
- `node scripts/check-lane-ownership.mjs --base e09690e --part adapter-dispatch`: `lane integration: 0 foreign paths`, exit 0.
- Acceptance: `convert:actors,convert:tables,convert:ui,convert:world`; `grep -c "convert:world" README.md` = 1; the STATUS.md sandbox line names converted, gap and not in catalog.
- Reference overlap: not run. None of the files this plan touched falls in a DEC-OWN-12 area.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] README example without `--`**
- Found during: Task 1 (`pnpm report:coverage -- --store-root ...` failed: argparse got a literal `--`) and Task 3.
- Issue: pnpm 10 forwards `--` to the script, so `pnpm convert:world -- --map 20_21 --step raw` would fail. Every converter also requires `--client`.
- Fix: the README example is `pnpm convert:world --client E:/Lineage2-client --map 20_21 --step raw` and says to leave `--` out (row 451).
- Commit: `b92d7bd`

**2. [Rule 3 - Blocking] Existing specs expected the old spawn text**
- Issue: `tests/browser/sandbox.spec.ts`, `tests/browser/sandbox-lane-npc-spawn.spec.ts` and `tests/unit/sandboxCommandSheet.test.ts` expected `npc:<id> converted, model <id>`.
- Fix: they now expect `npc:<id> converted` (row 449). The spawn presentation's `key` and `modelCatalogId` fields had no reader left and are deleted (`src/runtime/sandboxNpcVisual.ts`, `tests/unit/sandboxNpcAppearances.test.ts`).
- Commits: `02ca591`, `9910f05`

**3. [Rule 2 - DRY] Shared sandbox sheet fakes**
- The 01-14 sheet fakes moved from `tests/unit/sandboxCommandSheet.test.ts` to `tests/unit/support/sandboxCommandSheetFakes.ts`, so the new coverage notes test reuses them instead of copying them.
- Commit: `02ca591`

**4. Not-in-catalog text with the plain reason**
- The plan example wrote `npc:999999 not in catalog: <reason>`. The index's plain reason is the words "not in catalog", so the note stays `npc:999999 not in catalog`. Any other reason is appended in full (Vitest case "names a not-in-catalog reason other than the plain one"). The reason is not hidden: the plain reason is the status text itself (row 446).

**5. Docs**
- Also added one line to `docs/parts/sandbox/EVIDENCE.md` "Passes now", because STATUS.md points to it.

Total deviations: 5 (1 bug, 1 blocking, 1 DRY, 2 wording or docs). Impact: none on scope.

## Decisions logged

OVERNIGHT-DECISIONS rows 446 to 451 (see key-decisions).

## Requirements

- INT-01: the sandbox half ("the sandbox marks IDs as available or gap") is done and passes in a browser. INT-01 stays Pending: 02-55 and 02-70 also declare it and have no summary, and the main-checkout restage is still Needs Human (STATE.md, rule 4).

## Needs Human

None new.

## Process cleanup

- Playwright started its own `pnpm dev` on 5173 and stopped it after each run. `netstat -ano | grep LISTENING | grep -E ':(5173|5175) '` prints nothing (only TIME_WAIT sockets stayed). This plan started no `pnpm dev --port 5175`.
- `ps -W` shows no node, chrome or python process started by this plan. A node and a python process that appeared at 15:22:03 Riga had exited by the next check (`tasklist` finds no such PID). The PowerShell `Get-CimInstance` command-line listing could not run, because this session's sandbox refuses `powershell.exe` calls. The check was done by PID and port instead.

## Next

Ready for the next plan in phase 2.

## Self-Check: PASSED

- FOUND: src/runtime/sandboxCatalogLookupNote.ts, tests/unit/sandboxCoverageNotes.test.ts, tests/unit/support/sandboxCommandSheetFakes.ts, tests/browser/sandbox-coverage-notes.spec.ts, both screenshots
- FOUND: 02ca591, 9910f05, b92d7bd on HEAD
