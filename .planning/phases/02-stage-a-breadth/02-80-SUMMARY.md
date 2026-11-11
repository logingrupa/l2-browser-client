---
phase: 02-stage-a-breadth
plan: 80
subsystem: actors audio
tags: [actors-lane, audio, act-05, actor-sounds, clip-notify, gap-closure, sc2e]
status: complete
requires:
  - phase: 02-stage-a-breadth
    provides: 02-44 actor-sounds:<key> combatAudio records and the generatedActorSoundBundlePrefix guard, 02-36 actor clip events, 02-55 actors lane catalog
provides:
  - src/audio/spawnedActorSoundCues.ts with loadSpawnedActorSounds and bindSpawnedActorSoundCues
  - catalog index keys actor-sounds:<key> and actorSoundsCatalogKey
  - groupLessReferenceAgreesWithAdmittedExport exported as the one notify-to-slot matcher
affects: [02-87 spawn wiring, 02-78 audio EVIDENCE, ACT-05 listening round]
tech-stack:
  added: []
  patterns: [one bundle per binding, polled entity clip clock with per-pass cursor, coverage lists bound, unbound and unresolved roles]
key-files:
  created:
    - src/audio/spawnedActorSoundCues.ts
    - tests/unit/spawnedActorSoundCues.test.ts
  modified:
    - src/audio/loadNativeCombatAudio.ts
    - src/assets/native/nativeCatalogIndex.ts
    - tests/unit/nativeCatalogIndex.test.ts
    - docs/parts/audio/EVIDENCE.md
decisions:
  - "P835: the catalog index answers actor-sounds:<key> from generated combatAudio records; loadSpawnedActorSounds looks the key up there"
  - "P836: the absent-bundle reason reuses describeNativeCatalogLookup (actor-sounds:npc:20002 not in catalog)"
  - "P837: once and loop clips fire notify cues; a new clip pass catches up from the clip start and the mixer drops stale offsets"
  - "P838: dispose stops the binding's owner voices and pawn ledger rows; shared registered buffers stay"
  - "P839: a group-less notify that agrees with several bundle sounds stays unbound"
metrics:
  duration: 10min
  completed: 2026-11-11
actuals:
  tokens: 8000
  tasks: 2
  commits: 2
plan_head_before: eea43c6295b14c769912c692b9bd438e699b3f0b
plan_head_after: e9765da525a51adcc156482b0685ad8e4abf5889
---

# Phase 2 Plan 80: Spawned actor sound cues summary

Any spawned entity's `actor-sounds:<key>` bundle can now be loaded and its clip notify cues bound. This is the module half of gap SC2e. `loadSpawnedActorSounds(catalogKey, catalogIndex, signal)` looks up `actor-sounds:<catalogKey>` in the catalog index. Any npc, character or other entity key works, with no fixed list. When the index lists the record, the function loads the bundle through `loadNativeCombatAudio`, which verifies SHA-256 and size. Otherwise it returns `{ bundle: null, reason }`. `bindSpawnedActorSoundCues({ entityId, clipEvents, bundle, mixer, clipClock })` parses the clip events with `parseActorClipEvents`. It binds every notify sound to a bundle slot object through the bundle's own `groupLessReferenceAgreesWithAdmittedExport` rule. It registers only the bound sounds and plays each cue once per clip pass when the polled entity clip clock passes the source time. Each binding owns one bundle. `nativeCombatAudio.ts` and `nativeActionCuePreview.ts` are unchanged.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Tracer: a synthetic spawned NPC plays one notify cue from its bundle | 96c7414 | src/audio/spawnedActorSoundCues.ts, tests/unit/spawnedActorSoundCues.test.ts, src/audio/loadNativeCombatAudio.ts, src/assets/native/nativeCatalogIndex.ts, tests/unit/nativeCatalogIndex.test.ts |
| 2 | Coverage of unbound notifies and roles, dispose, and evidence | e9765da | tests/unit/spawnedActorSoundCues.test.ts, docs/parts/audio/EVIDENCE.md |

The tracer gate passed: `pnpm vitest run tests/unit/spawnedActorSoundCues.test.ts` was green end to end before Task 2 expanded the slice.

## What the tests prove

`tests/unit/spawnedActorSoundCues.test.ts` has 11 cases, all passing. The tests use a test double for the mixer and a polled clock, so no second runtime adapter is involved.
- A `SyntheticSound.Group.CueOne` notify at 0.4 s plays once, with offset 0.1, when the clock goes 0.3 to 0.5. It never plays before 0.4 s, and it does not repeat at 0.9.
- A replayed clip plays the cue again. A clip stopped at 0.2 s (switched to `wait`, then null) plays nothing.
- A looping clip plays the cue on every pass. A paused clock consumes the cue without sound.
- Two entities with two bundles each play only their own cue under their own owner.
- A bundle that is not an `actor-sounds:` bundle is refused at bind.
- A notify without a bundle slot is listed as unbound with its sound identity. Nothing is registered or played for it, and sound-less notifies are not listed.
- A group-less notify that agrees with two bundle sounds is unbound (`notify-sound-matches-several-bundle-sounds`).
- Every role slot is listed as `combat-role-route-unresolved:npcgrp/damage` with its slot keys and never plays.
- Dispose stops the owner's voices once and plays nothing after.
- `loadSpawnedActorSounds` loads `actor-sounds:npc:20001` and `actor-sounds:character:3` through stubbed served bytes. The loaded bundle carries the `actor-sounds:` id, so `combatAudioRoleRoutingDiagnostics` returns `[]` for it. This is the first real caller of the row 475 guard, and it is tested. `npc:20002` returns `{ bundle: null, reason: "actor-sounds:npc:20002 not in catalog" }`.

`tests/unit/nativeCatalogIndex.test.ts` adds one case. Generated combatAudio records answer `actor-sounds:<key>` as converted with `entityCatalogKey`, hand bundles are skipped, and `actorSoundsCatalogKey` refuses an empty key or an already-prefixed key.

## Verification

- `pnpm vitest run tests/unit/spawnedActorSoundCues.test.ts`: 11 passed.
- These related files passed together, 125 tests: `spawnedActorSoundCues`, `nativeCatalogIndex`, `nativeCatalogIndexCoverage`, `buildNativeCatalogIndexOrUnavailable`, `nativeCombatAudio`, `combatAudioRoleRouting` and `pinnedNativeResourceLoaders`.
- `pnpm typecheck`: clean.
- `node scripts/check-lane-ownership.mjs --base eea43c6 --part audio`: lane actors, 0 foreign paths.
- Reference overlap: no area in `tools/reference-overlap/overlapAreas.json` covers `src/audio/**` or `src/assets/native/**`, so there is no run to record.
- No comments in any touched file. `spawnedActorSoundCues.ts` is 159 lines and `nativeCatalogIndex.ts` is 261 lines. The audio EVIDENCE is 12,292 bytes and has no em or en dashes.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The catalog index had no actor-sounds keys.**
- **Found during:** Task 1.
- **Issue:** The plan passes the catalog index to `loadSpawnedActorSounds`, and 02-87 passes the same index. But `buildNativeCatalogIndex` never read `catalog.combatAudio`, so every `actor-sounds:` lookup would have been `not-in-catalog`.
- **Fix:** `buildNativeCatalogIndex` now adds a converted lookup with record `{ entityCatalogKey }` for every combatAudio record whose id starts with `generatedActorSoundBundlePrefix`. `actorSoundsCatalogKey` builds the key from that one prefix owner. Decision row P835.
- **Files modified:** `src/assets/native/nativeCatalogIndex.ts` and `tests/unit/nativeCatalogIndex.test.ts`. Both are outside the plan's file list but inside the actors lane globs.
- **Commit:** 96c7414.

**2. [Rule 3 - Blocking] The matcher was private.**
- **Found during:** Task 1.
- **Issue:** The plan says to import the bundle's qualified-name rule and never write a second matcher, but `groupLessReferenceAgreesWithAdmittedExport` was not exported.
- **Fix:** It is now exported from `src/audio/loadNativeCombatAudio.ts`. That is a one-word change, and the file has no comments.
- **Commit:** 96c7414.

### Other deviations

- **Absent-bundle wording.** The plan's literal is "actor-sounds:npc:20002 is not in the catalog". The reason reuses `describeNativeCatalogLookup` and reads "actor-sounds:npc:20002 not in catalog" (P836).
- **Task 2 test order.** Task 1 needed the coverage list to choose bound cues, and dispose is part of the binding shape, so both landed in the Task 1 code. Task 2 added their tests. Those tests passed on first run, so there is no separate red commit for Task 2.
- **What dispose releases.** Dispose stops the owner's voices and releases its pawn ledger rows. It does not unregister buffers, because `native-combat:<sha>` keys are shared with the default bundle and other bindings (P838).

## Known Stubs

None. The module has no caller until 02-87 wires it on spawn. The plan intends this (index rule 14: lane plans never edit `src/runtime/**`).

## Threat Flags

None. The served bundle bytes still pass through `loadNativeCombatAudio`'s pinned SHA-256 and size check (T-02-80-01). The coverage lists every bound and unbound cue with its identity (T-02-80-02).

## Requirements

- ACT-05 stays Pending. The module half of SC2e is done, but runtime wiring (02-87) and the owner listening round are still open. Under rule G9, only 02-89 writes `.planning/REQUIREMENTS.md`, so this plan marks nothing complete.

## Open follow-ups

- 02-87 calls `loadSpawnedActorSounds` and `bindSpawnedActorSoundCues` on spawn and calls `binding.update()` each frame.
- Role routing stays `combat-role-route-unresolved` until a source route exists.

## Process cleanup

Only foreground `pnpm vitest run` and `pnpm typecheck` runs were started, and each exited. A check of `Win32_Process` for command lines that hold `autonomous-roadmap` together with vitest, vite, playwright or tsc found only the check itself. Nothing listens on port 5175. No dev server, browser or e2e run was started.

## Self-Check: PASSED

- FOUND: src/audio/spawnedActorSoundCues.ts, tests/unit/spawnedActorSoundCues.test.ts
- FOUND: 96c7414, e9765da (ancestors of HEAD)
