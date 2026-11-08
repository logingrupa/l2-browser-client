---
phase: 02-stage-a-breadth
plan: 10
subsystem: world-contract
status: complete
tags: [world-command, game-world-adapter, sandbox, spawn-character, play-clip, exhaustive-dispatch, ACT-01, ACT-04]
requires:
  - phase: 01-foundations
    provides: "GameWorldAdapter contract test and the shared sandbox command helpers (plan 01-10)"
  - phase: 01-foundations
    provides: "Sandbox command sheet wired to the adapter (plan 01-14)"
provides:
  - "WorldCommand members spawn-character { characterTemplateIndex } and play-clip { entityId, clipName } (14 members in total)"
  - "WorldEntity fields characterTemplateIndex and requestedClip { clipName, requestSequence }"
  - "src/world/sandboxCommands.ts: createSpawnedCharacterEntity, entityWithRequestedClip, isSandboxClipName, maximumSandboxClipNameLength (128), unknownWorldCommandError"
  - "Exhaustive dispatch in MockWorldAdapter and NativeSliceAdapter: a never default throws a RangeError naming an unknown runtime type"
affects: [02-35 sandbox pickers, 02-36 clip API, 02-37 spawn-character and play-clip presentation, 02-39 clip picker, 02-40 player characters, Phase 4 server adapter (NET-04)]
actuals:
  tokens: 13500
  tasks: 3
  commits: 3
plan_head_before: 60e77745699169554c66b15c335fc119439f056a
plan_head_after: c6b2e3f4471ef7358b0971272232d74e62564e22
tech-stack:
  added: []
  patterns:
    - "Adapters switch over every WorldCommand with `default: { const unhandledCommand: never = command; throw unknownWorldCommandError(unhandledCommand); }`, so a new member without a case fails pnpm typecheck"
    - "Sandbox spawns share one placement ordinal across kinds and keep one id sequence per kind; both advance only after a successful placement"
key-files:
  created:
    - .planning/phases/02-stage-a-breadth/deferred-items.md
  modified:
    - src/world/worldTypes.ts
    - src/world/sandboxCommands.ts
    - src/world/MockWorldAdapter.ts
    - src/world/NativeSliceAdapter.ts
    - tests/unit/gameWorldAdapterContract.test.ts
    - tests/unit/sandboxCommands.test.ts
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "Only spawn-character and play-clip join WorldCommand (14 members); tile selection stays a ?map= reload and audio stays on the mixer (OVERNIGHT-DECISIONS row 60, owner review)"
  - "Spawned characters are kind remote-player, carry only characterTemplateIndex, and MockWorldAdapter does not simulate them (row 61)"
  - "Presentation reads characterTemplateIndex and requestedClip { clipName, requestSequence } from adapter events; ids are character-<index>-<sequence> (row 62)"
  - "An unknown runtime command type throws a RangeError naming the type (row 63)"
  - "Clip names are 1 to 128 UTF-16 code units, kept verbatim (row 64)"
metrics:
  duration: 15 min
  completed: 2026-11-08
---

# Phase 2 Plan 10: WorldCommand sandbox contract Summary

`WorldCommand` now has 14 members. The two new ones are `spawn-character`, which takes a chargrp template index, and `play-clip`, which takes an entity id and the exact original clip name. `MockWorldAdapter` and `NativeSliceAdapter` both switch over every member with a `never` default, so a member added without a case fails `pnpm typecheck`, and an unknown type that arrives at runtime throws a RangeError. The five `GameWorldAdapter` methods are unchanged.

## What was built

- `src/world/worldTypes.ts`: the two union members in the one-line style, `characterTemplateIndex?: number` and `requestedClip?: { clipName; requestSequence }` on `WorldEntity`.
- `src/world/sandboxCommands.ts` (91 lines):
  - `createSpawnedCharacterEntity(index, sequence, position)`: a frozen entity with id `character-<index>-<sequence>`, kind remote-player, display name `character:<index>`, health 100 of 100 and animation idle. It has no appearance, race, class or sex.
  - `isSandboxClipName` and `maximumSandboxClipNameLength = 128`.
  - `entityWithRequestedClip(entities, command)`: copies the entity and sets only `requestedClip`, with a per-entity sequence counted from 1.
  - `unknownWorldCommandError(never)`: the shared RangeError message.
- `src/world/MockWorldAdapter.ts` (244 lines):
  - Adds the spawn-character and play-clip cases.
  - set-locomotion and preview-action become explicit empty cases, so ignoring them is now visible.
  - Adds the never default.
  - spawn-npc and spawn-character share `sandboxSpawnPlacementOrdinal`, with `spawnedNpcCount` and `spawnedCharacterCount` as per-kind id sequences.
  - `advanceTick` simulates only the remote players in `initialPositions`. This removes the `initialPositions.get(id)!` crash that a spawned remote player would have caused.
- `src/world/NativeSliceAdapter.ts` (219 lines):
  - The if/else chain is now a switch. Command-listener forwarding still runs first.
  - teleport-local and spawn become explicit empty cases.
  - set-locomotion, preview-action and move-local move into named private methods with their original conditions.
  - The same shared ordinal and per-kind sequences as the mock, plus a shared `emit`.
- Tests:
  - `gameWorldAdapterContract.test.ts`: a type-level case lists all 14 `WorldCommand["type"]` values and both new member shapes, and a runtime case on both adapters checks that `no-such-command` throws a RangeError naming the type.
  - `sandboxCommands.test.ts`: describe.each blocks "spawn-character on %s" and "play-clip on %s", plus a block for MockWorldAdapter simulation.

## Verification

- `pnpm typecheck`: clean.
- `pnpm vitest run` on gameWorldAdapterContract, sandboxCommands, nativeSliceAdapter, world and importBoundaries: 5 files, 89 tests pass.
- Fail-first proof: a temp script removed the `spawn-character` case from each adapter in turn and ran `pnpm typecheck`, then restored the file. Both runs failed: `MockWorldAdapter.ts(122,15): error TS2322: Type '{ readonly type: "spawn-character"; readonly characterTemplateIndex: number; }' is not assignable to type 'never'.`, and the same error at `NativeSliceAdapter.ts(137,15)`.
- NPC-only positions at plan start were recorded by running the new "keeps the plan-start positions" case before the change. It passed on 60e7774 and still passes:
  - Mock: (-3.5, 0, -6), (-1, 0, -6), (1.5, 0, -6).
  - Native: (1.4, 0, 0), (2.8, 0, 0), (4.2, 0, 0).
- TDD for Task 2: the red commit a76a3cf failed 12 cases, because both adapters threw the new RangeError for `play-clip`. Commit c6b2e3f makes them pass.
- Acceptance greps:
  - `spawn-character` and `play-clip` each appear once in `worldTypes.ts`.
  - `const unhandledCommand: never` appears once in each adapter.
  - Every touched file is under 400 lines and has no comments.
- `node scripts/check-lane-ownership.mjs --base 60e7774 --part adapter-dispatch`: "lane integration: 0 foreign paths", exit 0.
- `pnpm test:unit` (full suite, BelowNormal) does not pass. It was run twice:
  - 14:35: 23 of 1523 cases failed.
  - 14:37: 26 cases failed.
  - Apart from the 2 known `nativeNpcProfiles.test.ts` cases ("Native player body source identity mismatch"), every failure is a 5000 ms timeout in a store-heavy native file, and the failing set changes from run to run.
  - Run alone, the 8 files that failed in the first run fail only on those 2 known cases.
  - None of these files depends on `src/world` behaviour. Details are in `deferred-items.md` and OVERNIGHT-DECISIONS row 65.
  - The recorded 02-01 baseline does not exist yet, because 02-10 is the first Phase 2 plan executed.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Schedule check and BelowNormal runner**
- **Found during:** Task 1
- **Issue:** `scripts/check-machine-schedule.mjs` (02-02) does not exist yet. The sandboxed Bash tool also refuses `cmd //c start //belownormal` and `powershell`.
- **Fix:**
  - The plan's Intl fallback runs as a temp script outside the repo (Europe/Riga; exit 2 in Sun 10:00-14:00 or Thu 19:00-21:30). It ran before every test or typecheck run and reported "clear" each time (14:29 to 14:37 Riga).
  - A temp node wrapper calls `os.setPriority(PRIORITY_BELOW_NORMAL)` and then runs pnpm synchronously.
  - Nothing was added to the repo.

**2. [Rule 1 - Bug] MockWorldAdapter would crash on a spawned remote player with navigation**
- **Found during:** Task 1, as the plan predicted.
- **Fix:** `advanceTick` now reads `initialPositions.get(entity.id)` once and simulates only when it is present. The non-null assertion is gone.
- **Commit:** b3363cb

**3. [Rule 2 - Clarity] NativeSliceAdapter helper methods**
- set-locomotion, preview-action and move-local moved out of the switch into `setLocomotion`, `previewAction` and `moveLocalPlayer`, keeping their exact conditions. A shared `emit` replaces the repeated listener loops.
- nativeSliceAdapter.test.ts and world.test.ts stay green.

### Not done as written

- The full `pnpm test:unit` does not fail only on a recorded baseline. 02-01 has not run, and the extra failures are load timeouts outside this plan's files. They were deferred rather than hidden with longer timeouts.

## Known Stubs

None. The spawned character carries no appearance on purpose (CONTEXT decision I). 02-37 presents it from the catalog or as the missing marker.

## Threat Flags

None beyond the plan's threat model. T-02-10-01, T-02-10-02 and T-02-10-04 are mitigated and tested. T-02-10-03 is transferred to 02-37 and 02-39.

## Process cleanup

- Every command this plan ran was synchronous: the temp wrapper used spawnSync for pnpm, vitest and tsc.
- A read-only `Get-CimInstance Win32_Process` listing at 14:39 Riga showed no process with `autonomous-roadmap` in its command line apart from the listing itself.
- The node processes that remain belong to the main checkout and were started at 14:27 by another session: `pnpm exec playwright test --reporter=line` (PID 5084, worker 36132) and `pnpm dev` with vite `--host 127.0.0.1` (PIDs 19796 and 32940, esbuild 9492). This plan did not start them and left them running.

## Self-Check: PASSED

- Files: worldTypes.ts, sandboxCommands.ts, MockWorldAdapter.ts, NativeSliceAdapter.ts, both test files, EVIDENCE.md, OVERNIGHT-DECISIONS.md and deferred-items.md all exist.
- Commits b3363cb, a76a3cf and c6b2e3f are ancestors of HEAD.
- `grep -c "14 WorldCommand members" docs/parts/adapter-dispatch/EVIDENCE.md` prints 1.
