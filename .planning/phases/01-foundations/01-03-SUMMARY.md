---
phase: 01-foundations
plan: 03
subsystem: native-asset-loading
status: complete
tags: [catalog, l2-id-index, native-store, FOUND-02, SAND-01]
requires:
  - phase: 01-foundations
    provides: "staged v1 catalog under public/l2 (read-only junction); hash-pinned NPC and player profile loaders"
provides:
  - src/assets/native/readNativeCatalog.ts (readNativeCatalog, readNativeCatalogUnlessNotStaged, NativeCatalog, NativeStoreNotStagedError)
  - src/assets/native/nativeCatalogIndex.ts (buildNativeCatalogIndex, NativeCatalogIndex, NativeCatalogLookup, record types, npc/item/skill/window/tile key builders)
  - tests/unit/readNativeCatalog.test.ts, tests/unit/nativeCatalogIndex.test.ts (including a staged-store case)
affects: [sandbox ID resolution (SAND-01), Phase 2 lanes resolving L2 IDs, every loader that reads catalog slices, UI-01 window keys, DATA-01 unknown-ID status]
actuals:
  tokens: 19556
  tasks: 3
  commits: 3
plan_head_before: c77469e2aeb81ed71aa528cfd5669f93e5cd5ab3
plan_head_after: 88fd6bf0120d492b6de3355489dce8e87e8388b7
tech-stack:
  added: []
  patterns:
    - "One catalog owner: readNativeCatalog fetches /l2/catalog.json once per AbortSignal (WeakMap memo, rejected reads evicted) and checks the v1 envelope; loaders keep their own slice, hash and path validation"
    - "Optional loaders that may run without a staged store use readNativeCatalogUnlessNotStaged and return null; everything else lets NativeStoreNotStagedError surface"
    - "L2-ID keys: npc:<id>, item:<id>, skill:<id>:<level>, window:<name>, tile:<XX_YY>; a key is converted only when a catalog record backs it, duplicates throw"
key-files:
  created:
    - src/assets/native/readNativeCatalog.ts
    - src/assets/native/nativeCatalogIndex.ts
    - tests/unit/readNativeCatalog.test.ts
    - tests/unit/nativeCatalogIndex.test.ts
  modified:
    - src/assets/native/loadNativeCatalog.ts
    - src/scene/world/loadNativeSection.ts
    - src/scene/world/loadNativeMovers.ts
    - src/assets/native/loadNativeWorldAudio.ts
    - src/effects/nativeEffectComponents.ts
    - src/audio/loadNativeCombatAudio.ts
    - src/editor/captureNativeWorld.ts
    - tests/unit/nativePlayerProfiles.test.ts
    - tests/unit/nativeSection.test.ts
    - tests/unit/nativeMoverLoader.test.ts
    - tests/unit/nativeEffectComponents.test.ts
    - tests/unit/nativeResource.test.ts
    - .planning/phases/01-foundations/deferred-items.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "item:<id> is one converted record listing every backing equipment model and player profile (staged item 22 has fighter-equipment:0 and female-fighter-equipment:0) (OVERNIGHT-DECISIONS row 26)"
  - "Section and mover loaders both return null for a store that is not staged (HTTP 404 or HTML fallback) through readNativeCatalogUnlessNotStaged; world audio, effect and combat audio still throw (OVERNIGHT-DECISIONS row 26)"
  - "An NPC profile whose mesh matches more than one model record is rejected as a duplicate key, never resolved to the first match"
requirements-completed: [FOUND-02, SAND-01]
coverage:
  - id: D1
    description: "One validated catalog reader: one fetch per signal, 404 and HTML page raise NativeStoreNotStagedError, other HTTP errors carry the status, bad envelope rejected, rejected reads evicted"
    requirement: FOUND-02
    verification:
      - kind: unit
        ref: "tests/unit/readNativeCatalog.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "L2-ID index on inline catalogs: npc:21622 converted to musveren:0, npc:1 and skill:3:2 not in catalog, item:22, skill:3:1 and tile:20_20 converted, window:StatusWnd not in catalog (UI-01), empty catalog all not in catalog, duplicates throw, order independent, key builders reject -1, 1.5 and NaN"
    requirement: SAND-01
    verification:
      - kind: unit
        ref: "tests/unit/nativeCatalogIndex.test.ts#native catalog L2-ID index"
        status: pass
    human_judgment: false
  - id: D3
    description: "Index on the staged store (public/l2) resolves npc:21622, item:22, skill:3:1 and tile:20_20 as converted with one catalog fetch; the case ran, not skipped"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "tests/unit/nativeCatalogIndex.test.ts#native catalog L2-ID index on the staged store"
        status: pass
    human_judgment: false
  - id: D4
    description: "Only src/assets/native/readNativeCatalog.ts names /l2/catalog.json; the seven former fetch sites read their slice through the reader and the unit suite shows only the two pre-existing failures"
    requirement: FOUND-02
    verification:
      - kind: other
        ref: "grep -rl /l2/catalog.json src"
        status: pass
      - kind: unit
        ref: "pnpm test:unit (1454 passed, 2 failed in pre-existing files editorGeometryCompat and nativeNpcProfiles)"
        status: pass
    human_judgment: false
duration: 13min
completed: 2026-11-08
---

# Phase 1 Plan 03: One catalog reader and the L2-ID index Summary

**`readNativeCatalog` is now the only code in `src` that fetches `/l2/catalog.json`, with per-signal memoisation and a `NativeStoreNotStagedError` for a missing store. `buildNativeCatalogIndex` resolves `npc:`, `item:`, `skill:`, `window:` and `tile:` keys against the staged v1 store, and converted means a catalog record backs the key.**

## Performance

- **Duration:** about 13 min
- **Started:** 2026-11-08T05:36:00Z
- **Completed:** 2026-11-08T05:49:00Z
- **Tasks:** 3
- **Files modified:** 16 source and test files, plus 2 planning files

## Accomplishments

- One reader owns the catalog fetch, the schemaVersion 1 envelope check (an array `models`, and every other slice an array when present), and memoisation per AbortSignal. Absent slices come back as empty arrays.
- The L2-ID index uses only fields the v1 store already has, so nothing had to be restaged:
  - NPC keys come from the hash-pinned NPC profile manifest, joined to the model whose `source.object` equals the profile mesh.
  - Item keys come from player profile `upperItems` whose `catalogId` is a model record.
  - Skill keys come from effect component ids.
  - Tile keys come from section ids.
  - Window keys always report not in catalog (UI-01).
- On the staged store, `npc:21622` (model `musveren:0`), `item:22`, `skill:3:1` and `tile:20_20` resolve as converted. `window:StatusWnd` resolves as not in catalog.
- All seven former fetch sites now take their slice from the reader: actor catalog, section, movers, world audio, effect components, combat audio and the Editor capture page. The Editor capture page now also goes through `nativeResourceUrl`.
- The section loader's error text no longer tells the reader to run the store-writing `pnpm assets:migrate --stage-runtime`.

## Task commits

1. **Task 1: one catalog reader and the L2-ID index, wired through the actor catalog** - `fb0d6ee` (feat)
2. **Task 2: section, mover and world audio loaders read through the reader** - `98d1331` (refactor)
3. **Task 3: effect, combat audio and Editor capture read through the reader** - `88fd6bf` (refactor)

## Files created and modified

- `src/assets/native/readNativeCatalog.ts`: the reader, `readNativeCatalogUnlessNotStaged`, `NativeCatalog`, `NativeStoreNotStagedError`.
- `src/assets/native/nativeCatalogIndex.ts`: key builders, lookup types, `buildNativeCatalogIndex`.
- `src/assets/native/loadNativeCatalog.ts`: the private `readCatalog` is deleted, and the three exported loaders call the reader.
- `src/scene/world/loadNativeSection.ts`: `stagedSection` reads `catalog.sections` and returns null when the store is not staged. The comments are gone; the extras binding and the clone rollback became the named helpers `bindMeshExtrasByGltfPrimitivePointer` and `disposeSceneNodesCreatedAfter`.
- `src/scene/world/loadNativeMovers.ts`: reads `catalog.movers` and returns null when the store is not staged or has no movers.
- `src/assets/native/loadNativeWorldAudio.ts`: `readNativeWorldAudioRecords` returns the reader's `worldAudio`. The comments became named types and the constants `ambientSoundObjectDefaultRadius` and `ambientSoundObjectDefaultVolume`.
- `src/effects/nativeEffectComponents.ts`, `src/audio/loadNativeCombatAudio.ts` (its fetcher is passed through to the reader), `src/editor/captureNativeWorld.ts` (`reflectWrapperForLeftHandedEditorAuthoring`): these read through the reader, and their comments are gone.
- Tests:
  - New: `readNativeCatalog.test.ts` and `nativeCatalogIndex.test.ts`.
  - Catalog stubs now satisfy the envelope (`models: []`, or a real `Response` that has `text()`) in `nativePlayerProfiles`, `nativeSection`, `nativeMoverLoader`, `nativeEffectComponents` and `nativeResource`.
  - The comments in `nativeSection.test.ts` and `nativeEffectComponents.test.ts` are gone.

## Decisions made

See key-decisions and OVERNIGHT-DECISIONS row 26. The plan's own choices were taken as written.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Test stubs without `text()` or `models`**
- **Found during:** Tasks 1 to 3
- **Issue:** The reader reads the body as text so it can detect the HTML fallback page, and it requires `models`. Several stubs returned plain objects with only `json()`, or catalogs with no `models`.
- **Fix:** Those stubs now return a real `Response`, or a stub that has `text()`, and include `models: []`. That covers `nativePlayerProfiles.test.ts` (Task 1, outside the Task 1 file list but in its verify list) and `nativeResource.test.ts` (found in the full Task 3 run).
- **Verification:** The listed test files pass.
- **Committed in:** fb0d6ee, 98d1331, 88fd6bf

**2. [Rule 2 - DRY] Shared not-staged helper**
- **Found during:** Task 2
- **Issue:** The section and mover loaders both needed "read the catalog, but return null when the store is not staged".
- **Fix:** Added `readNativeCatalogUnlessNotStaged` to the reader module instead of writing two local try/catch blocks.
- **Committed in:** 98d1331

**3. [Plan wording] Section invalid-catalog text**
- **Found during:** Task 2
- **Issue:** The envelope check moved into the reader, which now raises "Native asset catalog is invalid.", so the section loader's own invalid-catalog line no longer exists.
- **Fix:** The rewritten advice "Stage the native world section from the main checkout." now ends the section record identity error instead. `assets:migrate` no longer appears in the file.
- **Committed in:** 98d1331

**Total deviations:** 3 (2 auto-fixed plus 1 wording placement). **Impact:** no scope creep. `tests/unit/loadNativeWorldAudio.test.ts` and `tests/unit/nativeCombatAudio.test.ts` needed no change: their stubs already satisfied the envelope, or they never call the reader.

## Issues encountered

- **`tests/unit/nativeNpcProfiles.test.ts`:** the same 2 cases fail before and after this plan, so it is neither better nor worse. The cause is not the shared store, as the plan 01-01 note assumed. The case serves an inline catalog with `models: []`, and `loadNativeActorCatalog` then fails body validation for the default player. Details and a fix are in `deferred-items.md`.
- **`tests/unit/editorGeometryCompat.test.ts`:** fails as before (Editor fixture hash). Plan 01-09 owns it.
- **`tests/unit/nativeEffectStage.test.ts`:** timed out once at 5000 ms in a full BelowNormal run, then passed alone and in the next full run. It does not import anything this plan changed. Logged in `deferred-items.md`.
- **Processes:** this plan started only typecheck and Vitest runs, all in the foreground. The `list_worktree_processes.py` check found no node.exe or python.exe whose command line contains `autonomous-roadmap`, so nothing was left running.

## User setup required

None.

## Next phase readiness

- Phase 2 lanes and the sandbox sheet can resolve IDs through `buildNativeCatalogIndex(await readNativeCatalog(signal), signal)`.
- A third status, "unknown ID", arrives with DATA-01. Window keys turn converted with UI-01.

---
*Phase: 01-foundations*
*Completed: 2026-11-08*

## Self-Check: PASSED

- Created files exist: readNativeCatalog.ts, nativeCatalogIndex.ts, readNativeCatalog.test.ts, nativeCatalogIndex.test.ts.
- Task commits fb0d6ee, 98d1331, 88fd6bf are on this branch.
- Plan verification: `pnpm typecheck` clean; `grep -rl /l2/catalog.json src` prints only src/assets/native/readNativeCatalog.ts; the staged-store index case ran and passed; `pnpm test:unit` shows only the two pre-existing failing files.
