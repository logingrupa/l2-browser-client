---
phase: 01-foundations
plan: 16
subsystem: developer-tools
tags: [babylonjs, inspector, react, fluentui, vite, lazy-loading, playwright, supply-chain]

requires:
  - phase: 01-09
    provides: esbuild static import graph helper (staticImportClosure) and the default entry graph test
provides:
  - "@babylonjs/inspector and seven Babylon editor peers pinned exactly at 9.27.1, with React 19.3.1, Fluent UI and usehooks-ts peers pinned exactly"
  - "openBabylonInspector(scene), the only module importing @babylonjs/inspector"
  - "App opens the Inspector after reveal when the inspect query equals 1, and closes it on dispose"
  - "Playwright check tests/browser/inspector.spec.ts (stable Inspector root selector #babylon-inspector-container)"
affects: [01-17, phase-02-ui]

actuals:
  tokens: 4766
  tasks: 2
  commits: 3
plan_head_before: c93792f55181193b92af3f790d808fa392e15940
plan_head_after: a4cb0f4f0d8299a1cd136ae9f8443627f02a95a1

tech-stack:
  added:
    - "@babylonjs/inspector 9.27.1"
    - "@babylonjs/gui-editor, materials, serializers, node-editor, node-geometry-editor, node-particle-editor, node-render-graph-editor 9.27.1"
    - "react 19.3.1, react-dom 19.3.1"
    - "@fluentui/react-components 9.75.1, @fluentui/react-icons 2.0.345, @fluentui/react-utilities 9.27.0, @fluentui/react-motion-components-preview 0.15.10"
    - "@fluentui-contrib/react-virtualizer 1.0.0, @fluentui-contrib/react-resize-handle 0.8.4"
    - "usehooks-ts 3.1.1"
    - "@types/react 19.3.0, @types/react-dom 19.3.0 (dev)"
  patterns:
    - "Developer tools load behind a literal query flag through a dynamic import after reveal, and the static import graph test proves they stay out of src/main.ts"
    - "Third-party installs during an unattended run pass a fail-closed registry check (exact version, vendor repository, no install scripts) recorded in OVERNIGHT-DECISIONS.md before the install"

key-files:
  created:
    - src/scene/openBabylonInspector.ts
    - tests/browser/inspector.spec.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - src/App.ts
    - tests/unit/appStartup.test.ts
    - tests/unit/defaultEntryImportGraph.test.ts
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Automated fail-closed legitimacy check replaced the human package checkpoint (OVERNIGHT-DECISIONS row 39); React's repository field now reads github.com/react/react, accepted because github.com/facebook/react answers 301 to it and the npm maintainers are fb and react-bot"
  - "The Playwright check runs on the sandbox route ?world=interlude, not the default reference-world route, which needs more than 90 s to reach ready under SwiftShader"
  - "@babylonjs/inspector moved out of the Editor package list of defaultEntryImportGraph.test.ts into its own check that also bans React and Fluent from the default entry"

patterns-established:
  - "Lazy developer tool: App awaits import('./scene/<tool>') only behind a literal query flag, keeps the returned closer and calls it in dispose, also when the tool finishes opening after dispose"

requirements-completed: [NOED-04]

coverage:
  - id: D1
    description: "Inspector and its seven Babylon peers pinned exactly to 9.27.1, the same version as @babylonjs/core, with one core version installed"
    requirement: NOED-04
    verification:
      - kind: other
        ref: "node -e package.json pin check (inspector and core both 9.27.1) and pnpm why @babylonjs/core: Found 1 version of @babylonjs/core"
        status: pass
    human_judgment: false
  - id: D2
    description: "?inspect=1 opens Babylon Inspector after reveal through a dynamic import; without it nothing opens; dispose closes it"
    requirement: NOED-04
    verification:
      - kind: unit
        ref: "tests/unit/appStartup.test.ts#Babylon Inspector query flag"
        status: pass
      - kind: e2e
        ref: "tests/browser/inspector.spec.ts#inspect=1 lazy-loads Babylon Inspector from the local dev server and shows it over the revealed sandbox"
        status: pass
      - kind: e2e
        ref: "tests/browser/inspector.spec.ts#the sandbox route without inspect requests no Inspector code and shows no Inspector"
        status: pass
    human_judgment: false
  - id: D3
    description: "Inspector absent from the default static graph and from the production entry chunk"
    requirement: NOED-04
    verification:
      - kind: unit
        ref: "tests/unit/defaultEntryImportGraph.test.ts#reaches the Babylon Inspector only through a dynamic import"
        status: pass
      - kind: other
        ref: "pnpm build, then grep -l ShowInspector dist/assets/*.js: only index-C1KB_7lK.js and openBabylonInspector-foii9u3Y.js, not the entry index-BySK9Sks.js"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-11-08
status: complete
---

# Phase 1 Plan 16: Lazy Babylon Inspector behind inspect=1 Summary

**Babylon Inspector 9.27.1 opens over the revealed sandbox with `?inspect=1` through a dynamic import, with exact pins for its Babylon, React and Fluent peers, a recorded registry legitimacy check, and a production build that keeps it out of the entry chunk**

## Performance

- **Duration:** 14 min
- **Started:** 2026-11-08T08:07:54Z
- **Completed:** 2026-11-08T08:21:19Z
- **Tasks:** 2 (Task 2 was verification only and changed no file)
- **Files modified:** 8

## Accomplishments
- Legitimacy check of all 19 packages against the npm registry, recorded as OVERNIGHT-DECISIONS row 39 before the install; every package passed.
- `@babylonjs/inspector` and the seven Babylon editor peers installed at 9.27.1, and the peers pnpm resolved pinned exactly. `pnpm why @babylonjs/core` prints `Found 1 version of @babylonjs/core` (9.27.1).
- `src/scene/openBabylonInspector.ts` is the only module that imports `@babylonjs/inspector`. `App` loads it with `import("./scene/openBabylonInspector")` after the reveal sets `data-world-state="ready"`, only when `inspect` equals `"1"`. `App.dispose` calls the closer, including when the Inspector finishes opening after dispose.
- Inspector v2 renders on the WebGPU engine (RESEARCH assumption A1 now checked): Scene Explorer on the left and Properties on the right, over the sandbox. The screenshot is at `test-results/inspector-sandbox-1440x900.png`, which is gitignored and rewritten on each run. It was taken under headless SwiftShader, so its FPS readout is not a measurement.

## Task Commits

1. **Task 1: Verify, install and lazy-load the Inspector**
   - `d55fbff` (docs): OVERNIGHT-DECISIONS row 39, the legitimacy results
   - `c957681` (chore): package.json and pnpm-lock.yaml only, exact pins
   - `a4cb0f4` (feat): openBabylonInspector, App hook, unit, graph and Playwright checks
2. **Task 2: Production build keeps the Inspector in its own chunk.** No commit: the build exposed no missing peer, so package.json did not change.

## Verification results

- `pnpm typecheck`: passes.
- `pnpm vitest run tests/unit/appStartup.test.ts tests/unit/defaultEntryImportGraph.test.ts`: 2 files, 17 tests passed.
- Full `pnpm test:unit`: 111 files, 1386 passed, 2 failed, 82 skipped. The 2 failures are the known pre-existing `tests/unit/nativeNpcProfiles.test.ts` cases.
- `pnpm test:e2e tests/browser/inspector.spec.ts`: 2 passed (24.1 s). `netstat -ano | grep LISTENING | grep -E ':(5173|5175) '` printed nothing before each run.
- The spec asserts: a request URL containing `@babylonjs_inspector` or `@babylonjs/inspector`; `#babylon-inspector-container` visible with the text `Scene Explorer`; no page error; no request or WebSocket to a host other than 127.0.0.1. Without the flag it asserts no Inspector request and no `#babylon-inspector-container`.
- `pnpm build`: exit 0 in 2 min 25 s. The log has no `babylonjs-editor-cli` line.
- Bundle check: `dist/index.html` loads only `assets/index-BySK9Sks.js` (4,159,167 bytes) and has no modulepreload links. That entry chunk does not contain `ShowInspector`, and it has no React or Fluent code. `grep -l ShowInspector dist/assets/*.js` lists only:
  - `index-C1KB_7lK.js` (2,512,390 bytes): the Inspector, React and Fluent.
  - `openBabylonInspector-foii9u3Y.js` (958 bytes): the lazy wrapper.
- Other lazy chunks from the Inspector's own dynamic imports: `babylon.guiEditor` 1.81 MB, `babylon.nodeEditor` 1.95 MB, `babylon.nodeGeometryEditor` 5.71 MB, `babylon.nodeParticleEditor` 1.86 MB, `babylon.nodeRenderGraphEditor` 1.86 MB, `extensionsListService` 108.5 kB, `quickCreateToolsService` 35.3 kB, `glTFSerializer` 61.0 kB.
- `grep -rln "@babylonjs/inspector" src` prints only `src/scene/openBabylonInspector.ts`.

## Files Created/Modified
- `src/scene/openBabylonInspector.ts`: dynamic import of `@babylonjs/inspector`, `ShowInspector(scene, { layoutMode: "overlay" })`, returns the token's dispose.
- `src/App.ts`: opens the Inspector after reveal behind the literal `inspect=1` and closes it in dispose. The Editor attribution comment is removed; NOTICE keeps the attribution.
- `tests/unit/appStartup.test.ts`: new `Babylon Inspector query flag` suite with 7 cases. It also stubs `window` for the existing suite and has no comments left.
- `tests/unit/defaultEntryImportGraph.test.ts`: the Inspector module is a dynamic import target and not a static module. No Inspector, React or Fluent package is in the default static graph.
- `tests/browser/inspector.spec.ts`: Playwright check at 1440 x 900.
- `package.json`, `pnpm-lock.yaml`: exact pins.
- `.planning/OVERNIGHT-DECISIONS.md`: row 39.

## Decisions Made
- Row 39 (OVERNIGHT-DECISIONS): an automated fail-closed check replaced the human package checkpoint. Two repository fields differ from the plan's expected list, and both were checked against the same vendor:
  - React 19.3.x names github.com/react/react. github.com/facebook/react answers 301 to it, 19.2.0 still named facebook/react, and the npm maintainers are `fb` and `react-bot`.
  - `@fluentui/react-icons` lives in microsoft/fluentui-system-icons.
- `@types/react` and `@types/react-dom` 19.3.0 are pinned as dev dependencies, because the node editors and the Fluent packages declare them as peers.
- `babylonjs-gltf2interface`, a peer of serializers, was already locked at 9.33.2 through loaders and is unchanged.
- `@babylonjs/lite` is an optional peer and was not installed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Playwright check runs on the sandbox route instead of `/`**
- **Found during:** Task 1, first Playwright run
- **Issue:** On `/` and `/?inspect=1` the default reference world stayed at "Loading world data, step 1 of 4" for the whole 90 s ready timeout under SwiftShader. The console showed glslang shader warnings (`sampler constructor must appear at point of use`). `world.spec.ts` gives `/` 150 s for the same load. The plan's truth says "opens Babylon Inspector in the running sandbox".
- **Fix:** Both cases use `?world=interlude`: `/?world=interlude&inspect=1` and `/?world=interlude`. The App flag does not depend on the route, and the unit tests cover the query values `""`, `?inspect=0`, `?inspect=true` and `?world=interlude`.
- **Files modified:** tests/browser/inspector.spec.ts
- **Verification:** 2 passed (24.1 s)
- **Committed in:** a4cb0f4

**2. [Rule 2 - Correctness] An Inspector that finishes opening after dispose is closed at once**
- **Found during:** Task 1
- **Issue:** The plan only asked to call the closer in dispose. A pagehide or hot reload during the dynamic import would leave an Inspector open on a disposed scene.
- **Fix:** `App.openInspector` checks `isDisposed` after each await and closes a late Inspector. A unit test covers this.
- **Files modified:** src/App.ts, tests/unit/appStartup.test.ts
- **Committed in:** a4cb0f4

**3. [Rule 1 - Naming] `@babylonjs/inspector` removed from the Editor package list**
- **Found during:** Task 1
- **Issue:** `defaultEntryImportGraph.test.ts` listed the Inspector as an Editor package. It is not one.
- **Fix:** A dedicated test covers the Inspector, React and Fluent packages, plus the module's dynamic-only reachability.
- **Committed in:** a4cb0f4

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 correctness, 1 naming)
**Impact on plan:** No scope creep. NOED-04 is verified on the sandbox route, which is where the plan's truth places it.

## Issues Encountered
- The default route `/` did not reach ready within 90 s under headless SwiftShader on PROMINENCE-PC. This is not caused by this plan: the App change runs only after ready. It is the reference world load that `world.spec.ts` already budgets 150 s for. It is not investigated here.
- pnpm reports `Ignored build scripts: esbuild@0.28.2, sharp@0.34.3`. These packages were already installed, and the new packages declare no install scripts.

## Process cleanup
- Playwright started and stopped its own dev server on 5173. Afterwards netstat showed no listener on 5173 or 5175. No node, Vite, Playwright or browser process with `l2b-auto`, `:5173` or `ms-playwright` in its command line remains.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Ready for 01-17: NOED-04 passes, so the sandbox STATUS.md line needs no "unverified" note for the Inspector.

---
*Phase: 01-foundations*
*Completed: 2026-11-08*

## Self-Check: PASSED
