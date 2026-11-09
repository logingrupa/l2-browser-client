---
phase: 02-stage-a-breadth
plan: 36
subsystem: actors
tags: [act-04, animation, clips, asset-json, babylon, vitest]
status: complete
requires:
  - phase: 02-10
    provides: native actor presentation and the clip preview hub
  - phase: 02-22
    provides: converted npc:20001 with 17 asset.json animation events
provides:
  - typed parse of asset.json animationEvents (parseActorClipEvents, ActorClipEvent, ActorClipEventsError)
  - clip listing joined by exact sequence name (listActorClips) and the one play API (playActorClip)
  - clip hub answers actorClipEntityIds() and actorClipListing(entityId); available removed
affects: [02-37, 02-39]
actuals:
  tokens: 9975
  tasks: 3
  commits: 4
plan_head_before: 4b6e9e11d23f7ed0f76a9a21b39bd4a466b44b52
plan_head_after: 1d2ba2358113dadc8bcaf5c1a6db91e4ea8d6adf
tech-stack:
  added: []
  patterns:
    - "Guard helpers per field at the decoded-file boundary, error carries ordinal and field"
    - "One refusal owner (playActorClip) that the hub delegates to"
key-files:
  created:
    - src/assets/native/actorClipEvents.ts
    - src/animation/actorClipPlayback.ts
    - tests/unit/actorClipEvents.test.ts
    - tests/unit/actorClipPlayback.test.ts
  modified:
    - src/assets/native/nativeClipPreview.ts
    - src/assets/native/NativeCharacterVisual.ts
    - tests/unit/nativeCharacterVisual.test.ts
    - docs/parts/npcs/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "Typed events live in src/assets/native/actorClipEvents.ts; join and play rules in src/animation/actorClipPlayback.ts (row 329)"
  - "actorClipEntityIds and actorClipListing replace the hub's available; play delegates to playActorClip with unchanged refusal texts (row 330)"
  - "A malformed asset.json event fails the actor load with ActorClipEventsError like other profile checks; all 1,740 served-store events parse (row 331)"
requirements-completed: []
requirements-partial: [ACT-04]
coverage:
  - id: D1
    description: "asset.json animationEvents parse into typed records with every source field verbatim plus the ordinal, guarded per field"
    requirement: ACT-04
    verification:
      - kind: unit
        ref: "tests/unit/actorClipEvents.test.ts"
        status: pass
  - id: D2
    description: "Clip listing joined by exact name, ordered by normalized time then ordinal, with eventsWithoutClip and the one play API"
    requirement: ACT-04
    verification:
      - kind: unit
        ref: "tests/unit/actorClipPlayback.test.ts#actor clip listing and play rules"
        status: pass
  - id: D3
    description: "End to end: synthetic asset.json events through nativeCharacterFactory, the hub listing and NativeActor playback once"
    requirement: ACT-04
    verification:
      - kind: integration
        ref: "tests/unit/actorClipPlayback.test.ts#lists a loaded actor's evented clip and plays it once through the hub"
        status: pass
duration: 8min
completed: 2026-11-09
---

# Phase 2 Plan 36: Typed actor clips, events and one play API summary

asset.json `animationEvents` are now typed records (`parseActorClipEvents`), joined by exact sequence name to the loaded glTF clips (`listActorClips`) and played through one API (`playActorClip`); the clip hub lists every loaded actor's clips, durations and events for 02-37 and 02-39.

## Performance

- Start: 2026-11-09T02:56:43Z (04:56 Riga). End: about 05:04 Riga. 3 tasks, 10 files.
- Plan start SHA (parent of the oldest `(02-36)` commit): `4b6e9e11d23f7ed0f76a9a21b39bd4a466b44b52`.

## Accomplishments

- `src/assets/native/actorClipEvents.ts` (94 lines): `ActorClipEvent` keeps `animationSet`, `clip`, `normalizedTime`, `timeSeconds`, `type`, `notifyObject` (source `object`), `notifyFunction` (source `function`), `sound`, `properties` (via `structuredClone`), `sourceFrames`, `sourceRate`, `timingBasis` and the manifest `ordinal`. Nothing is recomputed. `ActorClipEventsError` carries `ordinal` (null for a non-list input) and `field`.
- `src/animation/actorClipPlayback.ts` (60 lines): `listActorClips` keeps package clip order, sorts events by `normalizedTime` then `ordinal`, keeps unmatched events in `eventsWithoutClip`, refuses duplicate loaded names. `playActorClip` owns the three refusal texts moved verbatim from the hub.
- `NativeClipPreviewHub` extends `ActorClipListingSource`; `available` is gone; `play` and `previewing` keep their signatures, so `src/runtime/attachNativeSliceCharacterSheet.ts` typechecks unchanged.
- `nativeCharacterFactory` registers `listActorClips(loaded.clips, parseActorClipEvents(profile.asset.manifest.animationEvents))`, so converted NPCs that go through the factory answer `actorClipListing` like the local player.
- Read-only check against the served store: all 1,740 events in the 6 evented top-level packages under `public/l2` parse under the guards (fields seen: strings, numbers, `sound` string or null, `properties` objects; 61 same-time ties, 2 events at time 0, 0 unresolved types). The extra converter field `resolvedFile` is not part of the typed record (it is not in the plan's field list and `nativeEventAudio.ts` already owns it).

## Task commits

1. Task 1 (tracer): `7ea1c07` feat(02-36): carry asset.json clip events through one clip listing and one play API
2. Task 2 (TDD): `36488bc` test(02-36): add failing cases for clip event guards and the ordering, adjacency, empty and encoding rules (RED); `5bf5656` feat(02-36): guard clip events at the asset.json boundary and order clip listings by source time (GREEN)
3. Task 3: `1d2ba23` docs(02-36): record the typed clip events, the clip listing and the one play API as ACT-04 evidence

## TDD gate compliance

- RED: `36488bc` ran 34 failing cases (no `ActorClipEventsError` export, no sorting, no duplicate refusal).
- GREEN: `5bf5656`, all 74 cases in the three files pass. No refactor commit needed.

## Verification

- Tracer gate: `pnpm typecheck && pnpm vitest run tests/unit/actorClipPlayback.test.ts tests/unit/nativeCharacterVisual.test.ts`: 2 files, 27 tests passed. Re-run after the tracer before expanding.
- Task 2: typecheck clean, 3 files, 74 tests passed.
- Full suite `pnpm typecheck && pnpm test:unit` at 05:02 Riga: 144 files passed, 5 skipped; 1,909 tests passed, 82 skipped, 0 failed. Matches the baseline (02-33 closed the `nativeNpcProfiles` red cases; `nativeEffectStage` did not flake).
- Ownership check, run after the last code commit `5bf5656` and before the docs commit:

```
$ node scripts/check-lane-ownership.mjs --base 4b6e9e11d23f7ed0f76a9a21b39bd4a466b44b52 --part npcs
lane actors: 0 foreign paths
exit=0
```

- Acceptance greps: `parseActorClipEvents` export 1; `listActorClips|playActorClip` exports 2; `playActorClip(` in the hub 1; `available` in the hub 0; `listActorClips(` in NativeCharacterVisual 1; no `hub.available` or `.available(` in `src` or `tests/unit`; `class ActorClipEventsError` 1; `eventsWithoutClip` 4; no case folding, trim or normalize in `actorClipPlayback.ts`; no `eval(`, `new Function` or `notifyFunction(` in either file; `EVIDENCE.md` 20,620 bytes.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] ActorClipEventsError fields declared explicitly instead of as constructor parameter properties**
- Found during: Task 2, the read-only real-store parse check through `node --experimental-strip-types`, which refuses parameter properties.
- Fix: declared `ordinal` and `field` as readonly fields set in the constructor. Same public shape.
- Files: `src/assets/native/actorClipEvents.ts`. Commit: `5bf5656`.

**2. [Rule 2 - Critical] Guards for `object`, `function`, `sound` and `properties` too**
- The plan's guard list named clip, animationSet, type, timingBasis and the numbers. The typed record also needs `notifyObject`, `notifyFunction` (strings), `sound` (string or null) and `properties` (a plain object), so they get the same guard and error shape. Tested in `actorClipEvents.test.ts`.

No other deviation. `LoadedActorClip` (the `{name, durationSeconds}` input type of `listActorClips`) is module-private, so the export list matches the plan.

## Requirement status

ACT-04 stays Pending in `.planning/REQUIREMENTS.md`. This plan delivers the typed clips, events and play API. The requirement also says "the sandbox plays any clip", which 02-37 (`play-clip`) and 02-39 (clip picker) deliver, per OVERNIGHT-DECISIONS row 66.

## Decisions logged

OVERNIGHT-DECISIONS rows 329 (file and name placement), 330 (`actorClipListing` and `actorClipEntityIds` replace `available`), 331 (a malformed event fails the actor load at the boundary).

## Needs Human

None.

## Known stubs

None.

## Threat flags

None beyond the plan's register. T-02-36-01, T-02-36-02 and T-02-36-04 are mitigated and tested; T-02-36-03 accepted.

## Process cleanup

This plan started only `tsc` and Vitest runs in the foreground; each exited. After the docs commit, no listener on ports 5173 or 5175, and no `vitest` or `tsc` process remains. The only `node.exe` processes are three service processes started on Oct 29, not by this plan.

## Next

02-37 (sandbox `play-clip` through `playActorClip`) and 02-39 (sheet clip picker reading `ActorClipListingSource`).

## Self-Check: PASSED

All four created files exist; commits 7ea1c07, 36488bc, 5bf5656 and 1d2ba23 are on plan/autonomous-roadmap.
