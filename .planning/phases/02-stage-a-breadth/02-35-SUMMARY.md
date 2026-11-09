---
phase: 02-stage-a-breadth
plan: 35
subsystem: sandbox
tags: [sand-02, dev-sheet, pickers, name-index, hover-cards, vitest]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-27 npcname_e_names, itemname_e_names, skillname_e_names native-table-name-index v1 tables records; 02-41 EquipmentSlot, isEquipmentSlot, equipmentSlotForBodyPart; 02-10 spawn-character; 02-19 window id pattern with #<ordinal>; 02-05 catalog index statuses and keys(prefix)"
  - phase: 01-foundations
    provides: "01-14 createDevIdEntry and DevGroup.idEntry"
provides:
  - "SandboxPickerHost, SandboxPickerContext, SandboxActionOutcome (src/ui/devSheet/sandboxPickerHost.ts)"
  - "SandboxPickerFactory and sandboxPickerSections = tile, spawn, equip, cast, window (src/ui/devSheet/sandboxPickerRegistry.ts)"
  - "readNativeTableNameIndex, nameIndexRecordId, NativeTableNameEntry, NativeTableNameIndexRead (src/ui/nativeTables/readNativeTableNameIndex.ts)"
  - "sandboxPickerMatchLimit and matchNativeNameEntries (src/ui/devSheet/sandboxPickerMatches.ts)"
  - "Shared picker controls: startPickerLifetime, createSandboxResultNote, attachSandboxNameSearch, attachSandboxCatalogKeyChoice, outcomeOfLookup (src/ui/devSheet/sandboxPickerControls.ts)"
  - "Id entry field kinds search, tile and window"
  - "fetchCatalogPinnedBytes (src/ui/fetchCatalogPinnedBytes.ts)"
  - "DevSheet.ts split into devSheetLayout, devSheetDrag, devSheetKeyboard and devSheetTabs"
affects: [02-37, 02-39]

actuals:
  tokens: 46000
  tasks: 3
  commits: 3
plan_head_before: 4a8297fc002be007490b3b7f830efd598329ab79
plan_head_after: 4e178abf4c5e510735097102880d680b4c36d667

tech-stack:
  added: []
  patterns:
    - "A picker is a factory {id, title, attach(group, context)} whose release removes every node it added and gates every callback"
    - "Name searches read a hash-checked name index once per table and signal; the latest search wins and an aborted read clears the list"
    - "Source rules test: line count, comment scan that skips strings, and a styling scan with a synthetic red case"

key-files:
  created:
    - src/ui/devSheet/sandboxPickerHost.ts
    - src/ui/devSheet/sandboxPickerRegistry.ts
    - src/ui/devSheet/sandboxPickerMatches.ts
    - src/ui/devSheet/sandboxPickerControls.ts
    - src/ui/devSheet/tilePicker.ts
    - src/ui/devSheet/spawnPicker.ts
    - src/ui/devSheet/equipPicker.ts
    - src/ui/devSheet/castPicker.ts
    - src/ui/devSheet/windowPicker.ts
    - src/ui/devSheet/devSheetLayout.ts
    - src/ui/devSheet/devSheetDrag.ts
    - src/ui/devSheet/devSheetKeyboard.ts
    - src/ui/devSheet/devSheetTabs.ts
    - src/ui/nativeTables/readNativeTableNameIndex.ts
    - src/ui/fetchCatalogPinnedBytes.ts
    - tests/unit/devSheetPickers.test.ts
    - tests/unit/devSheetPickerActions.test.ts
    - tests/unit/readNativeTableNameIndex.test.ts
    - tests/unit/devSheetSourceRules.test.ts
    - tests/unit/support/sandboxPickerHarness.ts
  modified:
    - src/ui/devSheet/DevSheet.ts
    - src/ui/devSheet/hoverCards.ts
    - src/ui/devSheet/devSheetIdEntry.ts
    - src/ui/devSheet/types.ts
    - src/ui/nativeWindows/nativeWindowManifestLoader.ts
    - tests/unit/devSheetIdEntry.test.ts
    - tests/unit/loadNativeTileChunks.test.ts
    - docs/parts/sandbox/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "No audio picker: the Audio section master mute and volume is the SAND-02 audio control (row 463)"
  - "SandboxPickerHost: dispatch, reloadTile returning an outcome, openWindow returning a promise of one; no audio methods (row 464)"
  - "SandboxPickerContext carries host, catalog index, name reader, selection, current tile and signal (row 465)"
  - "depends_on keeps 02-41; the equip picker spells no body-part: string (row 466)"
  - "Name search is an id entry field kind search plus a select choice and a pick button (row 467)"
  - "fetchCatalogPinnedBytes is the one pinned fetch in src/ui (row 468)"
  - "02-37 retires attachSandboxCommandSheet's id-entry groups, sandboxCatalogLookupNote and the name kind (row 470)"
  - "SAND-02 stays Pending until 02-37 mounts the pickers (row 471)"

requirements-completed: []

metrics:
  duration: 30min
  completed: 2026-11-09
---

# Phase 2 Plan 35: SAND-02 sheet side pickers summary

**The developer sheet now has tile, spawn (NPC and character), equip, cast and window pickers behind one `SandboxPickerHost` contract. Each picker searches decoded names from the hash-checked 02-27 name indexes or lists catalog keys, shows converted, gap or not in catalog with its reason for the key it acts on, and exposes `sandbox.<picker>.<variable>` hover-card variables. `DevSheet.ts` went from 734 lines to 330, split into four modules by concern, with no comments, and `tests/unit/devSheet.test.ts` passes unchanged.**

## Performance

- Started 2026-11-09T14:09:08Z, completed 2026-11-09T14:39Z (about 30 min)
- Tasks: 3 of 3
- Files: 20 created, 10 modified

## Accomplishments

- Task 1 (tracer): `readNativeTableNameIndex(tableId, signal)` finds the `<table>_names` tables record (`npcname-e` becomes `npcname_e_names`, as 02-27 named it), fetches the manifest through `fetchCatalogPinnedBytes`, checks byte length and SHA-256, and validates kind `native-table-name-index` v1, the table, one or two identifier fields, safe non-negative integer identifiers, string names, and `entryCount` against the list and the catalog `recordCount`. Reads under one signal share one fetch per table; an aborted signal rejects a pending read. The spawn picker searches that index (name substring, case-insensitive, or an all-digit id), lists up to `sandboxPickerMatchLimit` (12) matches as `<name> (npc:<id> <status>)`, and its pick button dispatches exactly `{type: "spawn-npc", npcId}` through the host and notes `describeNativeCatalogLookup` of `npc:<id>`.
- Task 2: `DevSheet.ts` keeps the public class, its API and `stickyExplanation`. `devSheetLayout.ts` holds mode, docking, lift, stage size, snaps, card zone, layout name and status text. `devSheetDrag.ts` holds the grip drag and snap release. `devSheetKeyboard.ts` holds the typing-target check and the sheet, tab and chip keys. `devSheetTabs.ts` holds sections, tabs, activation, reveal, fades, filter application, filter open state and the header flash. No selector, test id, storage key or timing changed. `hoverCards.ts` lost its comments, so every devSheet module is under 400 lines.
- Task 3: the tile picker lists `catalogIndex.keys("tile:")` with status and reason and reloads a picked or typed `XX_YY` tile through `host.reloadTile`, showing the outcome. `2021` and `20-21` are refused before the host. The spawn picker adds `spawn-character`, bounded by the `table:chargrp` record count when that record is converted; without it any non-negative index is accepted and the note names the table status. The equip picker searches `itemname-e` and equips into `upper` or the slot `equipmentSlotForBodyPart` builds from a typed body_part value, checked by `isEquipmentSlot` before dispatch (`grep -c "body-part:" equipPicker.ts` is 0). The cast picker searches `skillname-e`, one row per id and level, and targets the selected entity. The window picker lists `catalogIndex.keys("window:")` including `#<ordinal>` ids and awaits `host.openWindow`. The id entry gains the `search`, `tile` and `window` field kinds. The source rules test checks the picker and name-index modules for stylesheet imports, style writes, styling classes, colours and fonts, and a synthetic violating source trips every rule.

## Picker variables

| Picker | Hover-card variables |
|---|---|
| tile | `sandbox.tile.current`, `.selected`, `.lookup`, `.outcome`, `.walk` (presentation: walking is the existing tap-to-move) |
| spawn | `sandbox.spawn.query`, `.selected`, `.nameIndex`, `.matchLimit`, `.lookup`, `.characterTemplateCount` |
| equip | `sandbox.equip.query`, `.selected`, `.nameIndex`, `.matchLimit`, `.slot` (unverified: 02-41 slot form; body_part meaning undecoded), `.lookup` |
| cast | `sandbox.cast.query`, `.selected`, `.nameIndex`, `.matchLimit`, `.target`, `.lookup` |
| window | `sandbox.window.selected`, `.lookup`, `.outcome` |

## Task commits

1. Task 1 (tracer): `ab7b3a6` feat(02-35): spawn picker from the npcname-e name index through the catalog to a spawn-npc dispatch on the sandbox host
2. Task 2: `f5c8312` refactor(02-35): split DevSheet.ts into layout, drag, keyboard and tab modules with no comments
3. Task 3: `4e178ab` feat(02-35): tile, character, equip, cast and window pickers with hover-card variables and the sandbox evidence

The tracer gate passed: Task 1's verify (typecheck plus the picker, reader and devSheet tests) ran green before Task 2 started.

## Requirements

- SAND-02: Pending. The sheet side is done; 02-37 implements the host, mounts `sandboxPickerSections` on `/` and runs the browser check (row 471). `requirements.ready-ids` also blocks it while sibling plans that declare SAND-02 have no SUMMARY.

## Edge cases

- Adjacency: two "Gremlin" rows with ids 20001 and 20002 are two options; one skill at levels 1 and 2 is two rows.
- Empty: a blank search shows "Type a name or an ID to search npcname-e." with no list and no read; a missing index shows `table:npcname_e_names not in catalog: <reason>; table:npcname-e <status>. ID entry still works.`
- Ordering: id, then level, then source order, capped at 12 (20 matches show 12, starting at the lowest id).
- Idempotency: every picker's release removes the nodes it added; a second release does nothing; a submit on a released form dispatches nothing; a window outcome after release shows nothing.
- Concurrency: two reads under one signal share one manifest fetch; an aborted read rejects and the picker clears its earlier matches and notes "read stopped".

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Typecheck was red before this plan**
- Found during: Task 1 verify
- Issue: `tests/unit/loadNativeTileChunks.test.ts(151,44): error TS2532: Object is possibly 'undefined'` (from 02-29) failed `pnpm typecheck`.
- Fix: one non-null assertion on the tampered byte index.
- Commit: `ab7b3a6`

**2. [Rule 3 - Blocking] hoverCards.ts had 402 lines**
- Found during: Task 2 (the source rules test requires every devSheet module under 400 lines)
- Fix: stripped its comments (AGENTS per-file comment rule) and renamed `nameCode`, `textElements` and `titles` to `codeBreakingOnlyAfterDots`, `textContentOwnedTags` and `movedNativeTitles`; 366 lines.
- Commit: `f5c8312`

### Other adjustments

- No search control existed on the sheet, so the id entry gained a `search` field kind (empty allowed, up to 64 characters) and the match list is a `select` choice with a pick button (row 467).
- The pinned fetch moved from `nativeWindowManifestLoader.ts` into `src/ui/fetchCatalogPinnedBytes.ts` so the reader and the window loader share it (row 468).
- Picker tests are split into `devSheetPickers.test.ts` (spawn, registry, character) and `devSheetPickerActions.test.ts` (tile, equip, cast, window) over a shared harness in `tests/unit/support/sandboxPickerHarness.ts`, to keep each file under 400 lines.
- Shared picker logic lives in `sandboxPickerControls.ts`, not in each picker (DRY); it is covered by the styling rule through the `sandboxPicker*.ts` glob.
- Task 3 is marked `tdd="true"`, but its tests were written alongside the pickers in one commit, not as a separate failing commit first. The styling rule's red case is the synthetic source inside the test.

**Total deviations:** 2 auto-fixed (both blocking). **Impact:** none on the plan's contract; both fixes keep the build and the source rule green.

## Decisions logged

Rows 463 to 471 in `.planning/OVERNIGHT-DECISIONS.md`.

## Verification

- `node scripts/check-machine-schedule.mjs` printed `activeWindow: null` before every run.
- `pnpm typecheck` clean after each task.
- `pnpm test:unit`: 158 files passed, 5 skipped; 2194 tests passed, 82 skipped, 0 failed (no red baseline left).
- Browser regression on the split sheet: `pnpm test:e2e tests/browser/sandbox.spec.ts tests/browser/nativeSlice.spec.ts`, port 5173 free, 4 passed (3.5 min). The pickers themselves are not mounted on `/` yet (02-37). Headless SwiftShader; no FPS claims.
- Acceptance: `export interface SandboxPickerHost` 1; `wc -l DevSheet.ts` 330 (was 734); every new file under 400 lines; `tests/unit/devSheet.test.ts` has no commit in `4a8297f..HEAD`; `grep -c "body-part:" equipPicker.ts` 0; `wc -c EVIDENCE.md` 8776.
- Lane ownership after the last code commit:

```
$ node scripts/check-lane-ownership.mjs --base 4a8297f --part sandbox
lane data-ui: 0 foreign paths
exit=0
```

- Reference overlap: no DEC-OWN-12 area covers `src/ui` (areas: materials, bsp-visibility, movement, particles, network), so no run applies.
- The self-contained repo name check (DEC-OWN-11) is empty.

## Known Stubs

None. The pickers are complete behind `SandboxPickerHost`; 02-37 provides the runtime host, as the plan states.

## Threat Flags

None. Decoded names reach the DOM only through `textContent` and option text (picker test with a markup name). The reader checks length, SHA-256 and the manifest shape (T-02-35-01). Inputs are bounded: integers to 9 digits, search to 64 characters, tile and window ids to their patterns, and matches to 12 (T-02-35-03).

## Needs Human

None.

## Process cleanup

This plan started foreground tsc and Vitest runs and one Playwright run (its own web server on 5173), and each one exited. Afterwards nothing listened on 5173 or 5175, and the process list showed no node, browser or Playwright process from this plan; the only node processes were started on Oct 29, before this plan.

## Self-Check: PASSED

- Created files exist: `src/ui/devSheet/sandboxPickerHost.ts`, `sandboxPickerRegistry.ts`, `sandboxPickerMatches.ts`, `sandboxPickerControls.ts`, `tilePicker.ts`, `spawnPicker.ts`, `equipPicker.ts`, `castPicker.ts`, `windowPicker.ts`, `devSheetLayout.ts`, `devSheetDrag.ts`, `devSheetKeyboard.ts`, `devSheetTabs.ts`, `src/ui/nativeTables/readNativeTableNameIndex.ts`, `src/ui/fetchCatalogPinnedBytes.ts` and the five test files.
- Commits `ab7b3a6`, `f5c8312` and `4e178ab` are ancestors of HEAD.
