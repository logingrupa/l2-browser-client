---
phase: 02-stage-a-breadth
plan: 39
subsystem: sandbox
tags: [act-04, clip-picker, sandbox-sheet, clip-hub, play-clip, hover-cards, playwright, dec-own-9]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-36 ActorClipListingSource, ActorClipListing and the clip hub; 02-37 createSandboxRuntimeActions, the mounted pickers and play-clip presentation; 02-35 SandboxPickerHost, SandboxPickerFactory and sandboxPickerSections"
provides:
  - "createClipPicker (src/ui/devSheet/clipPicker.ts), the Clips SandboxPickerFactory registered last in sandboxPickerSections"
  - "SandboxPickerHost extends ActorClipListingSource"
  - "createSandboxRuntimeActions option clipListings, return type SandboxPickerHost & ActorClipListingSource"
  - "createNativeSliceRuntime passes its clipPreview hub as clipListings"
  - "Gremlin browser check of the clip picker on / (tests/browser/sandbox-npc-gremlin.spec.ts)"
affects: [02-55]

actuals:
  tokens: 13700
  tasks: 3
  commits: 5
plan_head_before: 8d03cafea54ab6094e9bde19bf3316f3101d6b03
plan_head_after: 8400b2c75a5087f2e6a78535998704f9ded1e43c

tech-stack:
  added: []
  patterns:
    - "Contract commit in integration globs first, then the data-ui commit, each checked by its own lane ownership range"
    - "A picker that rebuilds only the nodes it rendered last time, so the group keeps its controls across rereads"

key-files:
  created:
    - src/ui/devSheet/clipPicker.ts
    - tests/unit/clipPicker.test.ts
  modified:
    - src/runtime/sandboxRuntimeActions.ts
    - src/runtime/createNativeSliceRuntime.ts
    - src/ui/devSheet/sandboxPickerHost.ts
    - src/ui/devSheet/sandboxPickerRegistry.ts
    - tests/browser/sandbox-npc-gremlin.spec.ts
    - tests/unit/sandboxRuntimeActions.test.ts
    - tests/unit/devSheetPickers.test.ts
    - tests/unit/sandboxCommandSheet.test.ts
    - tests/unit/nativeSliceRuntimeSheet.test.ts
    - tests/unit/support/sandboxPickerHarness.ts
    - tests/unit/support/sandboxCommandSheetFakes.ts
    - tests/support/nativeSliceRuntimeHarness.ts
    - docs/parts/sandbox/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Row 567: contract commit A ff64387 adds clipListings to createSandboxRuntimeActions and passes clipPreview from createNativeSliceRuntime, declared in 02-PLAN-INDEX Shared names"
  - "Row 568: SandboxPickerHost extends ActorClipListingSource from 02-36 instead of a second listing interface"
  - "Row 569: a Reread clip listings button besides rereading on group open, because the group is open by default and attached before any spawn"
  - "Row 570: the clip picker browser cases use the page fixture with test.use per viewport, not manual browser contexts"

patterns-established:
  - "Clip rows carry hover-card variables clip.name, clip.durationSeconds, clip.events, clips.eventsWithoutClip (native) and clips.previewing (presentation)"

requirements-completed: [ACT-04]

coverage:
  - id: D1
    description: "Runtime host answers clip listings, entity order and previewing from the runtime clip hub"
    requirement: ACT-04
    verification:
      - kind: unit
        ref: "tests/unit/sandboxRuntimeActions.test.ts#answers listings, entity order and previewing from the clip hub it is given"
        status: pass
    human_judgment: false
  - id: D2
    description: "Clips picker dispatches play-clip with the chosen entity id and exact clip name; empty, ordering, late registration, adjacency, encoding and hover-card rules"
    requirement: ACT-04
    verification:
      - kind: unit
        ref: "tests/unit/clipPicker.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Gremlin npc:20001 spawned on / plays its first listed clip from the picker, read back as clips.previewing at 1440 x 900; 932 x 430 touch case; no horizontal scroll at 430 x 932"
    requirement: ACT-04
    verification:
      - kind: e2e
        ref: "tests/browser/sandbox-npc-gremlin.spec.ts (NATIVE_STORE_ROOT=actors DEV_PORT=5175)"
        status: pass
      - kind: automated_ui
        ref: "playwright:artifacts/npc-evidence/sandbox-clip-picker-npc-20001-1440x900.png"
        status: pass
      - kind: automated_ui
        ref: "playwright:artifacts/npc-evidence/sandbox-clip-picker-npc-20001-932x430.png"
        status: pass
    human_judgment: false
  - id: D4
    description: "The picker is an unstyled development tool inside the pinnable sheet with hover-card variables, never a cramped toggle list"
    requirement: ACT-04
    verification:
      - kind: unit
        ref: "tests/unit/devSheetSourceRules.test.ts"
        status: pass
    human_judgment: true
    rationale: "The prohibition is a judgment call on the owner's sheet UX preference; the screenshots show the layout"

duration: 21min
completed: 2026-11-10
---

# Phase 2 Plan 39: Clip picker Summary

**A Clips group in the sandbox sheet lists every actor the clip hub holds and plays any of its clips through play-clip, proven on the converted Gremlin npc:20001 on the native route.**

## Performance

- **Duration:** 21 min (2026-11-10 01:15 to 01:36 Riga)
- **Tasks:** 3 of 3
- **Files:** 17 changed (2 created)

## Accomplishments

- Contract commit A (`ff64387`): `createSandboxRuntimeActions` takes `clipListings: ActorClipListingSource` and delegates `actorClipEntityIds`, `actorClipListing` and `previewing` to it; `createNativeSliceRuntime.ts` passes its `clipPreview` hub. `createNativeSliceRuntime.ts` is 314 lines.
- `SandboxPickerHost` extends `ActorClipListingSource`; `createClipPicker()` is registered after the 02-35 pickers.
- The picker holds a "Reread clip listings" button, an actor select (hub registration order) and one button per clip (package order). A click dispatches `{ type: "play-clip", entityId, clipName }` with the exact name. No loaded actor shows "No loaded actor has clips.", an actor without clips shows "<entity id> has no clips.", and neither dispatches. Clip names go in through `textContent` only.
- Clip row hover cards: `clip.name`, `clip.durationSeconds`, `clip.events` (normalized time, type, sound), `clips.eventsWithoutClip` as native; `clips.previewing` as presentation.
- Gremlin browser check on `/` with the actors lane store passed.

## Task commits

1. Task 1 (tracer): `ff64387` feat(02-39): clip listings on the sandbox runtime host; `face111` feat(02-39): clip picker
2. Task 2 (TDD): `c647cef` test(02-39): clip picker empty, ordering, adjacency, encoding and hover-card cases (red); `791e880` feat(02-39): clip hover cards, empty notes, reread button and the Gremlin clip picker browser check (green)
3. Task 3: `8400b2c` docs(02-39): record the ACT-04 clip picker evidence, the sandbox status line and decision rows 567 to 570

## Verification

- Task 1 verify: typecheck clean; `vitest run clipPicker, sandboxRuntimeActions, actorClipPlayback, devSheetPickers` plus `sandboxCommandSheet` and `nativeSliceRuntimeSheet`: 6 files, 63 tests passed. Tracer gate re-run passed before Task 2.
- Ownership, commit A range: `node scripts/check-lane-ownership.mjs --base 8d03caf --part adapter-dispatch` printed `lane integration: 0 foreign paths`, exit 0.
- Ownership, commit A onward (after the last code commit, before the docs commit): `node scripts/check-lane-ownership.mjs --base ff64387 --part sandbox` printed `lane data-ui: 0 foreign paths`, exit 0.
- `git diff --name-only 8d03caf..HEAD -- src/runtime` lists exactly `src/runtime/createNativeSliceRuntime.ts` and `src/runtime/sandboxRuntimeActions.ts`.
- Task 2: `tests/unit/clipPicker.test.ts` 8 passed (5 red before the implementation). E2e `NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-npc-gremlin.spec.ts`, ports 5173 and 5175 free:
  - Run 1: 5 passed, 2 failed. Desktop hover read nothing because the pointer already sat on the clicked row (fixed by moving the pointer away first); the 932 x 430 case failed in Playwright's trace collection when closing its manual context after the screenshot was written (fixed by fixture pages, row 570). The portrait case passed.
  - Run 2: 6 passed, 1 failed: desktop passed (`atk01` read back as `clips.previewing`), 932 x 430 passed, the 02-22 cases passed; the 430 x 932 case got "WebGPU is required" from the SwiftShader adapter on its world load.
  - Portrait case alone (`-g "Clips section open"`): 1 passed, no horizontal scroll.
  - Screenshots: `artifacts/npc-evidence/sandbox-clip-picker-npc-20001-1440x900.png`, `artifacts/npc-evidence/sandbox-clip-picker-npc-20001-932x430.png`. Logs in `artifacts/npc-evidence/02-39-gremlin-e2e*.log`.
- Task 3: `pnpm typecheck` clean; full `pnpm test:unit`: 172 files passed, 4 skipped; 2,351 tests passed, 72 skipped, 0 failed. `docs/parts/sandbox/EVIDENCE.md` is 11,092 bytes.
- Acceptance greps: `createClipPicker` in the registry 2, `play-clip` in clipPicker.ts 1, `innerHTML` 0, `ActorClipListingSource` in sandboxPickerHost.ts 2, `clipListings` 5 and 1, "No loaded actor has clips." 1, colour and font pattern 0, `932` in the spec 6, `844` 0, `scrollWidth` 2, legacy route pattern 0.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Shared test fakes in commit A and B**
- Found during: Task 1
- Issue: the new required `clipListings` option and the widened `SandboxPickerHost` broke the typecheck of shared test support (`tests/unit/support/sandboxCommandSheetFakes.ts`, `tests/unit/support/sandboxPickerHarness.ts`, `tests/support/nativeSliceRuntimeHarness.ts`) and the group lists in `sandboxCommandSheet.test.ts` and `nativeSliceRuntimeSheet.test.ts`.
- Fix: commit A also carries `sandboxCommandSheetFakes.ts` (a real clip hub as `clipListings`), so its diff lists four files, not three; commit B updates the picker harness (optional `clipHub`, play-clip forwarded to it), the runtime harness group mock (`header`, `collapsed`) and the expected group lists. All are shared `tests/**`; both ownership checks exit 0.
- Commits: `ff64387`, `face111`

**2. [Rule 2 - Missing] Reread button**
- Found during: Task 2
- Issue: the Clips group is open by default and attached at runtime start, so rereading only on group open never shows an NPC spawned later.
- Fix: a "Reread clip listings" button (row 569), covered by the ordering and late-registration unit cases and used by the browser check.
- Commit: `791e880`

**3. [Rule 1 - Bug] Browser case structure**
- Found during: Task 2
- Issue: the hover after the click did not fire `pointerenter`; manual browser contexts failed in trace collection on close.
- Fix: move the pointer away before hovering; use the `page` fixture with `test.use` per viewport (row 570). Screenshots go to `artifacts/npc-evidence/` next to the 02-22 Gremlin evidence rather than the Playwright output folder, which each run clears.
- Commit: `791e880`

**Total deviations:** 3 auto-fixed (1 blocking, 1 missing functionality, 1 bug). **Impact:** no scope change; the integration-owned files are still only the two declared ones.

## Open follow-ups

- The SwiftShader WebGPU adapter refused one world load ("WebGPU is required") in the second full run of `sandbox-npc-gremlin.spec.ts`; the same case passed in the first run and alone. Cause not established.
- After commit B the runtime return annotation `SandboxPickerHost & ActorClipListingSource` equals `SandboxPickerHost`; a later integration plan may simplify it (plan's flagged assumption).

## Needs Human

None.

## Process cleanup

The e2e runs started their own Vite on 5175 through the Playwright webServer and stopped it on exit; the background waiters ended. After the last run: `curl http://127.0.0.1:5175/` and `http://127.0.0.1:5173/` get no answer, `netstat` shows no listener on 5173 or 5175, and no process with this worktree path, a Playwright browser or a headless shell remains (`ps -W`).

## Self-Check: PASSED

- Files exist: `src/ui/devSheet/clipPicker.ts`, `tests/unit/clipPicker.test.ts`, both screenshots.
- Commits on this branch: `ff64387`, `face111`, `c647cef`, `791e880`, `8400b2c`.
