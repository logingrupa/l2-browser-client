---
phase: 01-foundations
plan: 14
subsystem: sandbox
tags: [sandbox, developer-sheet, catalog-index, missing-asset, babylonjs, playwright]

requires:
  - phase: 01-03
    provides: native catalog index and key builders (npcCatalogKey, itemCatalogKey, skillCatalogKey, windowCatalogKey)
  - phase: 01-05
    provides: native slice composition root and the Power Strike preview
  - phase: 01-10
    provides: spawn-npc, equip-item, cast-skill commands and the skill-cast event
  - phase: 01-11
    provides: server boundary through GameWorldAdapter
provides:
  - Developer sheet ID-entry control (createDevIdEntry, DevGroup.idEntry)
  - Sandbox sheet section with spawn NPC, equip item, cast skill and open window by ID
  - NPC visual resolution through the catalog index with a meshless, label-only missing-asset marker
  - EntityLabel.setDiagnostic, CharacterVisual.missingAssetDiagnostic, registry snapshot field missingAssetDiagnostic
  - Navigation origin reported as plain coordinates, so sandbox spawns land on the native section
affects: [01-16, 01-17, phase-02-actors, phase-02-ui]

actuals:
  tokens: 19066
  tasks: 3
  commits: 6
plan_head_before: e5657eee80c7fc7b81dcfc901acacb86cb742a3e
plan_head_after: 26744ed80d87134cc9462ebe273da7e2f02dcb2e

tech-stack:
  added: []
  patterns:
    - "Sandbox by-ID actions build presentation keys with the catalog index key builders and report converted or not in catalog"
    - "A missing asset keeps its entity record and gets a meshless visual whose diagnostic becomes a label line, never a stand-in body"
    - "One result note per sandbox group, replaced on each submit"

key-files:
  created:
    - src/ui/devSheet/devSheetIdEntry.ts
    - src/runtime/attachSandboxCommandSheet.ts
    - src/runtime/sandboxNpcVisual.ts
    - tests/unit/devSheetIdEntry.test.ts
    - tests/unit/sandboxCommandSheet.test.ts
    - tests/unit/sandboxMissingAsset.test.ts
    - tests/browser/sandbox.spec.ts
  modified:
    - src/ui/devSheet/types.ts
    - src/ui/devSheet/devSheetParts.ts
    - src/ui/devSheet/devSheetStyles.ts
    - src/ui/EntityLabel.ts
    - src/ui/worldStyles.ts
    - src/assets/CharacterVisual.ts
    - src/entities/EntityRegistry.ts
    - src/assets/native/nativeCatalogIndex.ts
    - src/effects/nativeEffectComponents.ts
    - src/runtime/createNativeSliceRuntime.ts
    - src/scene/navigation/meshNavigation.ts
    - tests/unit/nativeSliceRuntime.test.ts
    - tests/unit/nativeSliceWorldSource.test.ts
    - tests/unit/entityReadiness.test.ts
    - tests/unit/entityGroundClearance.test.ts
    - tests/unit/navigation.test.ts

key-decisions:
  - "Sandbox NPC presentation is resolved by one function (resolveSandboxNpcPresentation) used by both the visual factory and the sheet note"
  - "Catalog lookup text has one owner, describeNativeCatalogLookup in nativeCatalogIndex.ts, with notInCatalogReason exported"
  - "The staged Power Strike bundle id is named once as powerStrikeEffectBundleId in nativeEffectComponents.ts"
  - "Only musveren:0 maps to a loaded appearance (native-musveren); a converted NPC with another model gets the marker with a 'model not loaded in this sandbox' diagnostic"
  - "navigation.origin is built from x, y and z instead of spreading a Babylon Vector3 (OVERNIGHT-DECISIONS row 38)"

patterns-established:
  - "DevGroup.idEntry: validated form controls on the developer sheet, hover-card through the existing describe path"
  - "Runtime tests that mock loadNativeActorCatalog also stub readNativeCatalog, because the composition root builds the catalog index"

requirements-completed: [SAND-01, ARCH-03]

coverage:
  - id: D1
    description: "ID entry rejects empty, negative, fractional, non-numeric and oversized input with a visible message and dispatches nothing"
    requirement: SAND-01
    verification:
      - kind: unit
        ref: "tests/unit/devSheetIdEntry.test.ts"
        status: pass
      - kind: e2e
        ref: "tests/browser/sandbox.spec.ts ('abc' input)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Spawn NPC by ID: 21622 gets the converted Greater Musveren model; 12345 keeps its entity record, renders no meshes and shows a labelled marker plus a warning note"
    requirement: ARCH-03
    verification:
      - kind: unit
        ref: "tests/unit/sandboxMissingAsset.test.ts"
        status: pass
      - kind: e2e
        ref: "tests/browser/sandbox.spec.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Equip item, cast skill and open window by ID with converted or not in catalog notes; casting skill 3 level 1 starts the staged Power Strike preview; open window never dispatches"
    requirement: SAND-01
    verification:
      - kind: unit
        ref: "tests/unit/sandboxCommandSheet.test.ts"
        status: pass
      - kind: e2e
        ref: "tests/browser/sandbox.spec.ts (equip 999999, open window StatusWnd)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Sandbox controls live in the pinnable developer sheet with hover-card variables, unstyled beyond the existing sheet rules (DEC-OWN-10)"
    requirement: SAND-01
    verification:
      - kind: e2e
        ref: "playwright:.planning/phases/01-foundations/01-14-sandbox-missing-asset.png"
        status: pass
    human_judgment: true
    rationale: "The owner UX preference (pinnable sheet, no cramped toggle list) is a judgment call on the screenshot"

duration: 16min
completed: 2026-11-08
status: complete
---

# Phase 1 Plan 14: Sandbox by-ID actions and missing-asset diagnostic summary

**The developer sheet gains a Sandbox section that spawns NPCs, equips items, casts skills and looks up windows by ID through the catalog index, and an NPC ID without a converted model now shows a meshless, label-only "npc:<id> not in catalog" marker instead of a stand-in body.**

## Performance

- **Duration:** about 16 min
- **Started:** 2026-11-08T07:49:13Z
- **Completed:** 2026-11-08T08:05:22Z
- **Tasks:** 3
- **Files modified:** 23

## Accomplishments

- `createDevIdEntry` and `DevGroup.idEntry`: a form per action with one labelled input per field, integers limited to `^\d{1,9}$`, safe integers and a minimum, names limited to `^[A-Za-z][A-Za-z0-9_]{0,63}$`; a rejection writes into an `aria-live="polite"` message and calls nothing.
- `sandboxNpcVisualFactory` routes entities with an `npcId` through `npcCatalogKey`; converted with a loaded model goes to the native factory with `appearanceId: native-musveren`, anything else gets `createMissingAssetMarkerVisual` (an empty TransformNode, no meshes, no `ready` promise, so later spawns never re-block the startup barrier).
- `EntityRegistry` passes the visual's `missingAssetDiagnostic` to `EntityLabel.setDiagnostic` (textContent only) and adds it to snapshot rows.
- `attachSandboxCommandSheet` adds four groups (Spawn NPC, Equip item, Cast skill, Open window) with hover-card variables `sandbox.lastKey`, `sandbox.lastLookup`, `sandbox.equip.slot`, `sandbox.equip.lastKey`, `sandbox.cast.target`, `sandbox.cast.lastKey`, `sandbox.window.lastKey`. Equip and cast dispatch their commands; open window never touches the adapter. A `skill-cast` event whose key is converted to the staged Power Strike bundle starts the Power Strike preview; the subscription is released with the runtime.

## Task commits

1. **Task 1: Spawn NPC by ID end to end, with the missing-asset marker** - `3799554` (feat)
2. **Task 2: Equip item, cast skill and open window by ID** - `584f5ce` (test, RED), `ee84245` (feat, GREEN)
3. **Task 3: Playwright check of the sandbox on the staged store** - `5e20490` (test)
4. **Deviation fixes** - `51956d0` (fix, navigation origin), `26744ed` (test doubles)

## Verification

- `pnpm typecheck`: 0 errors.
- `pnpm test:unit`: 1378 passed, 2 failed, 82 skipped (111 files: 105 passed, 1 failed, 5 skipped). The 2 failures are the known pre-existing `tests/unit/nativeNpcProfiles.test.ts` cases listed in `deferred-items.md`.
- Plan-listed tests: `devSheetIdEntry`, `sandboxMissingAsset`, `devSheet`, `nativeSliceRuntime`, `sandboxCommandSheet`, `sandboxCommands` all pass.
- `pnpm test:e2e tests/browser/sandbox.spec.ts`: 1 passed (20.5 s) on PROMINENCE-PC, port 5173 free before the run (netstat printed nothing). Headless SwiftShader; no FPS claim is made.
- Screenshot (1440 x 900): `.planning/phases/01-foundations/01-14-sandbox-missing-asset.png`, copied from `test-results/sandbox-missing-asset.png`. It shows the Sandbox section, the warning note and the in-world `npc:12345` label with its `npc:12345 not in catalog` diagnostic line.
- Acceptance greps: `createMissingAssetMarkerVisual` 2 hits and no `MeshBuilder|CreateBox|CreateSphere|createProceduralCharacter` in `sandboxNpcVisual.ts`; `createNativeSliceRuntime.ts` 303 lines; `devSheetParts.ts` 339 lines; `attachSandboxCommandSheet.ts` 157 lines with 2 `windowCatalogKey` hits.
- Process cleanup: after the runs, no listener on 5173 or 5175 and no node or chrome process whose command line holds `l2b-auto`, `ms-playwright` or either port.

## Decisions made

- One result note per group, replaced on each submit, so repeated use does not grow the sheet.
- The Sandbox section sits at order 5, right after General, with no icon; the icon set has no sandbox glyph and DEC-OWN-10 rules out new styling.
- The marker's label bounds (label height 2.25 m, selection radius 0.825 m) are a sandbox presentation choice, not a Lineage II value, named `missingAssetMarkerPresentationBounds`.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Sandbox spawns were dropped on the native section**
- **Found during:** Task 3 (Playwright run)
- **Issue:** `createWorldNavigation` returned `origin: { ...options.origin }`. The runtime passes a Babylon Vector3, whose spread copies only `_x/_y/_z`, so `navigation.origin.x` was undefined and `NativeSliceAdapter.spawnNpc` built NaN offsets; `findSpawn` rejected every candidate and no NPC appeared.
- **Fix:** build the origin from `x`, `y` and `z`.
- **Files modified:** `src/scene/navigation/meshNavigation.ts`, `tests/unit/navigation.test.ts` (a Vector3-origin test that spawns through `NativeSliceAdapter`; it fails without the fix).
- **Committed in:** `51956d0`. Recorded as OVERNIGHT-DECISIONS row 38.

**2. [Rule 3 - Blocking] Test doubles out of step with the new wiring**
- **Found during:** full unit run after Task 3
- **Issue:** `EntityLabel` doubles in `entityReadiness` and `entityGroundClearance` lacked `setDiagnostic`; `nativeSliceRuntime` and `nativeSliceWorldSource` mock `loadNativeActorCatalog` but the composition root now also calls `readNativeCatalog` for the index; `nativeSliceRuntime` mocked `nativeEffectComponents` without the new constant.
- **Fix:** add `setDiagnostic` to the doubles, stub `readNativeCatalog` with an empty valid catalog, mock `nativeEffectComponents` over its original exports. The comment in `entityGroundClearance.test.ts` was removed per AGENTS.md.
- **Committed in:** `3799554`, `ee84245`, `26744ed`.

**3. [Rule 2 - DRY] Shared names outside the plan file list**
- `src/assets/native/nativeCatalogIndex.ts` exports `notInCatalogReason` and `describeNativeCatalogLookup`; `src/effects/nativeEffectComponents.ts` exports `powerStrikeEffectBundleId` and uses it. Neither file had comments. `nativeEffectInitTimeline.ts` and `nativeEffectShotTimeline.ts` still repeat the bundle id literal; left as they are to keep the change scoped.

**Total deviations:** 3 (1 bug, 1 blocking, 1 DRY). **Impact:** the navigation fix was required for the plan goal in a real browser; the rest is wiring.

## Issues encountered

- The marker for npc 12345 spawns 2.9 m from the player and projects outside the default close camera, so its label is hidden. The Playwright check zooms out with six mouse-wheel steps over the canvas before asserting visibility. This is a test step, not a product change.
- Headless SwiftShader draws the 3D view dark in the screenshot; the HTML labels and the sheet are the evidence.

## Known stubs

- Open window reports every name as `not in catalog: interface windows are not converted yet (UI-01)`. Intentional: no interface windows are converted yet; UI-01 resolves it.
- Equip item supports the `upper` slot only (OVERNIGHT-DECISIONS row 13); other slots need decoded item data (DATA-01).

## User setup required

None.

## Next phase readiness

- SAND-01 and ARCH-03 are met on the staged store: spawn NPC, equip item, cast skill and open window by ID run with no server, and a missing ID shows a visible diagnostic, not a stand-in.
- Cast skill was proved in unit tests only; the Playwright check does not cast, because the Power Strike preview's own browser checks live in `nativeSlice.spec.ts`.
- The rest of the e2e suite was not re-run in this plan; the new Sandbox tab adds one tab before Audio.

## Self-check: PASSED

- Files found: devSheetIdEntry.ts, attachSandboxCommandSheet.ts, sandboxNpcVisual.ts, the three new unit tests, sandbox.spec.ts, the screenshot.
- Commits found in HEAD: 3799554, 584f5ce, ee84245, 51956d0, 5e20490, 26744ed.
