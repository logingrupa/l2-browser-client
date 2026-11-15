---
phase: 02-stage-a-breadth
plan: 41
subsystem: adapter-dispatch
tags: [act-03, equipment, sandbox-commands, native-slice-adapter, vitest]
status: complete
requires:
  - phase: 02-27
    provides: decoded weapongrp and armorgrp native-table manifests in the data-ui lane store
provides:
  - BodyPartEquipmentSlot and EquipmentSlot = "upper" | BodyPartEquipmentSlot
  - isEquipmentSlot (canonical form) and equipmentSlotForBodyPart (one owner of the key form)
  - canonical equipment key order (upper first, then body-part slots by ascending value)
affects: [02-42]
actuals:
  tokens: 3949
  tasks: 3
  commits: 3
plan_head_before: aa132c35b1069d71c12b87b9588939257b1dacac
plan_head_after: 0b7274300c563f7e446609d4f63d8809f5d9009b
tech-stack:
  added: []
  patterns:
    - "Template literal slot type validated by a canonical regex plus a safe-integer check"
    - "Real-data test reads a lane manifest only after its catalog SHA-256 and length match"
key-files:
  created:
    - tests/unit/equipItemSlots.test.ts
  modified:
    - src/world/worldTypes.ts
    - src/world/sandboxCommands.ts
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
decisions:
  - "Slots are named body-part:<value>, the source body_part value in canonical decimal (row 332)"
  - "The legacy upper slot stays as its own key sorted first (row 333)"
  - "A repeat equip and an unequip of an empty slot keep the row 46 confirmation update (row 334)"
metrics:
  duration: 6min
  completed: 2026-11-09
---

# Phase 2 Plan 41: Body-part equipment slots Summary

**`EquipmentSlot` now accepts `upper` or `body-part:<value>` named by the source `body_part` value, validated in canonical form and ordered canonically, and all 19 distinct decoded weapongrp and armorgrp `body_part` values map to accepted slots.**

## Performance

- Started: 2026-11-09T03:08:52Z
- Completed: 2026-11-09T03:15Z
- Tasks: 3
- Files: 6

## Accomplishments

- `src/world/worldTypes.ts`: `BodyPartEquipmentSlot = \`body-part:${number}\``; `EquipmentSlot = "upper" | BodyPartEquipmentSlot`. The command payload widens; the five `GameWorldAdapter` methods are unchanged.
- `src/world/sandboxCommands.ts`: `isEquipmentSlot` (accepts `upper` or `^body-part:(0|[1-9][0-9]*)$` with a safe integer) replaces the `equipmentSlots` array; `equipmentSlotForBodyPart` returns null unless the value is a safe non-negative integer; `orderEquipmentSlotsCanonically` sorts `upper` first, then body-part slots by number. No slot names, meanings, stats or outcomes are added.
- `tests/unit/equipItemSlots.test.ts` (18 cases): the tracer case through `NativeSliceAdapter.dispatch`. It also covers the encoding edge (9 non-canonical spellings, no event), adjacency (replace, repeat, upper and body-part as separate keys), the empty edge, ordering (two equip orders give deep-equal snapshots with keys `upper, body-part:3, body-part:12`) and concurrency (dispatch order, later one wins). Every case runs on both the default and a walk-capable locomotion profile. Further cases show equip changes no field except `equipment`, and test the helpers.
- Decoded census (data-ui lane store, manifests hash-checked against `catalog.json`), `value:rows`, every meaning undecoded:
  - weapongrp (1,313 rows): `0:33 7:530 8:96 14:654`
  - armorgrp (1,014 rows): `0:13 1:40 3:40 4:41 6:96 9:151 10:147 11:101 12:172 13:17 15:74 16:1 17:39 18:25 19:57`

## Task commits

1. Task 1 (tracer): `b1b0678` feat(02-41): equip and unequip a body-part slot through NativeSliceAdapter dispatch
2. Task 2: `be924b3` feat(02-41): order equipment keys canonically and prove every decoded body_part maps to a slot
3. Task 3: `0b72743` docs(02-41): record the body-part equipment slots and the decoded body_part census as ACT-03 evidence

## Verification

- Task 1 verify: `pnpm typecheck` clean; `equipItemSlots`, `sandboxCommands`, `gameWorldAdapterContract` 29 passed. The tracer test failed before the change (no update emitted).
- Task 2 RED: against the Task 1 helpers the two ordering cases failed (16 passed, 2 failed); GREEN after `orderEquipmentSlotsCanonically`: `equipItemSlots`, `sandboxCommands`, `nativeSliceAdapter` 48 passed.
- `pnpm test:unit`: 145 files passed, 5 skipped; 1927 tests passed, 82 skipped, 0 failed (no red baseline remains).
- Lane ownership, run after the last code commit (`be924b3`) and before the docs commit:

```
$ node scripts/check-lane-ownership.mjs --base aa132c35b1069d71c12b87b9588939257b1dacac --part adapter-dispatch
lane integration: 0 foreign paths
exit=0
```

- Acceptance greps: `export type BodyPartEquipmentSlot` 1; the two exported helpers 2; `const equipmentSlots` 0; `orderEquipmentSlotsCanonically` 2; quoted body-region names 0; `ACT-03` in evidence 1; `body-part:<value>` in OVERNIGHT-DECISIONS 1.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Evidence doc crossed the 30 KB limit test**
- Found during: Task 3 (`tests/unit/laneOwnership.test.ts` "has an evidence doc for adapter-dispatch under 30 KB", 30878 bytes)
- Fix: the ACT-03 section was shortened and the separate Evidence bullet folded into it; the doc is 30641 bytes and the suite is green.
- Files: `docs/parts/adapter-dispatch/EVIDENCE.md`
- Commit: `0b72743`

### Plan conflicts resolved

**2. Repeat equip and empty unequip keep the confirmation update (OVERNIGHT-DECISIONS row 334)**
- The must-haves say these emit nothing. The task action says "keep the existing no-change rule for repeat equips", and that rule (row 46, commit `38077ae`) emits one `update` carrying the unchanged entity. The sandbox sheet's acceptance check depends on it (`tests/unit/sandboxCommandSheet.test.ts` "reports the item the local player already wears as converted", `tests/browser/sandbox.spec.ts`).
- Choice: keep the confirmation. No equipment change and at most one update per command still hold. Emitting nothing would mean changing `src/runtime` outside this part. Reverting to silence is a two-line change in `entityWithEquippedItem`.

## Decisions logged

- Row 332: slot key form `body-part:<value>`.
- Row 333: the legacy `upper` slot stays, sorted first, with no inferred `body_part` link.
- Row 334: the repeat-equip and empty-unequip confirmation stays (above).

## Known Stubs

None. `equipmentSlotForBodyPart` gets its production caller in 02-42 (item index records), as the plan states.

## Needs Human

None.

## Process cleanup

The only processes this plan started were foreground Vitest and tsc runs, and each one exited. Nothing listens on 5173 or 5175. The `node.exe` processes still on the machine were started on Oct 29, before this plan. No dev server, preview or browser was started.

## Self-Check: PASSED

- FOUND: tests/unit/equipItemSlots.test.ts
- FOUND: b1b0678, be924b3, 0b72743 (ancestors of HEAD)
