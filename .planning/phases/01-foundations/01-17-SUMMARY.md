---
phase: 01-foundations
plan: 17
subsystem: browser-checks
status: complete
tags: [e2e, playwright, noed, cold-start, private-preview]
requires: ["01-01", "01-06", "01-09", "01-11", "01-12", "01-13", "01-14", "01-15", "01-16"]
provides:
  - every browser check on ?world=interlude or a test harness page
  - native store not-staged browser check
  - dev cold-start measurement config and spec on port 5175
  - private preview scripts on ?world=interlude with a shared target module
affects: [sandbox, world, private-preview]
tech-stack:
  added: []
  patterns:
    - one shared module owns the private preview origin, route and catalog path
key-files:
  created:
    - playwright.startup.config.ts
    - tests/startup/devStartup.spec.ts
    - scripts/private-preview-targets.mjs
    - scripts/private-preview-targets.d.mts
    - tests/unit/privatePreviewTargets.test.ts
  modified:
    - tests/browser/webgpu.spec.ts
    - tests/browser/loadingPanel.spec.ts
    - tests/browser/assetPackage.spec.ts
    - tests/browser/nativeStartup.spec.ts
    - tests/browser/nativeFacing.spec.ts
    - tests/browser/nativeReveal.spec.ts
    - tests/browser/nativeBsp.spec.ts
    - tests/browser/nativeFlame.spec.ts
    - tests/browser/nativeSlice.spec.ts
    - tests/browser/terrainLegacyReference.spec.ts
    - tests/browser/stagedNativeTerrainPath.ts
    - tests/fixtures/native940Contact.ts
    - scripts/private-preview.mjs
    - scripts/check-private-preview.mjs
    - scripts/check-private-preview-burst.mjs
    - scripts/check-private-preview-external.mjs
    - scripts/private-preview-tunnel.ps1
    - docs/parts/sandbox/EVIDENCE.md
    - STATUS.md
  deleted:
    - tests/browser/demo.spec.ts
    - tests/browser/nativeEditor.spec.ts
    - tests/browser/world.spec.ts
    - tests/browser/routeReferenceWorldAsNotStaged.ts
    - tests/unit/terrainSurfaceFragmentSource.test.ts
decisions:
  - "Plan 01-17 deletes browser cases that only exercised the Talking Island reference route and re-points the generic WebGPU, loading-panel and asset-package checks to ?world=interlude (OVERNIGHT-DECISIONS row 44)"
  - "The private preview scripts read the ?world=interlude route, catalog path and origin from scripts/private-preview-targets.mjs; the burst diagnosis HEADs the built catalog and section resources"
requirements-completed: [NOED-01, NOED-03]
coverage:
  - requirement: NOED-01
    verification: { kind: e2e, ref: pnpm test:e2e, status: passed }
  - requirement: NOED-03
    verification: { kind: e2e, ref: pnpm test:e2e, status: passed }
  - requirement: NOED-02
    verification: { kind: e2e, ref: pnpm exec playwright test --config playwright.startup.config.ts, status: partial }
metrics:
  duration: 50min
  completed: 2026-11-08
actuals:
  tokens: 51000
  tasks: 4
  commits: 8
plan_head_before: 37a074f48416fb7a917ac46c8e831088f812e975
plan_head_after: 5436dd70be4de90962f2b368ffdc3d86e0d0a272
---

# Phase 1 Plan 17: Browser checks on the native sandbox route Summary

Every Playwright check now opens `?world=interlude` or a harness page. The full e2e suite passes on PROMINENCE-PC with port 5173 free. The private preview scripts target `/?world=interlude` through one shared module, and the dev cold start was re-measured on port 5175 with zero Editor-tools requests.

The plan was resumed from the WIP commits 017904c and 084cc14 after owner decision row 42, which removes the Talking Island reference route and lineagen. Nothing was built on the reference route.

## Commits

`commits: 8` is measured from 37a074f. Two of those eight are owner docs commits that landed during the pause and are not plan work: 08dd13d and 25dcd14.

| Commit | What |
|--------|------|
| 017904c | (earlier run) reference world shader fix, now reverted; also deleted demo.spec.ts and nativeEditor.spec.ts (kept) |
| 084cc14 | (earlier run) WIP spec edits, finished and verified here |
| 41f5caa | Restore `src/scene/world/terrainSurfaces.ts` to 37a074f, delete `tests/unit/terrainSurfaceFragmentSource.test.ts` |
| 3aed82b | Private preview scripts on `?world=interlude`, shared target module, Vitest, deferred item resolved |
| 9bf31bb | Generic browser checks re-pointed to `?world=interlude`, reference-only specs deleted, OVERNIGHT-DECISIONS row 44 |
| 5436dd7 | Startup measurement on `?world=interlude` only, sandbox EVIDENCE and STATUS |

## Deleted, with reasons

- `tests/browser/demo.spec.ts` (017904c, kept): every case targeted the retired courtyard or the deleted Fallback Sentinel. `tests/unit/world.test.ts` covers MockWorldAdapter.
- `tests/browser/nativeEditor.spec.ts` (017904c, kept): it only exercised the authored Editor world (`authored=1`).
- `tests/browser/world.spec.ts`: all three cases ran on the reference island. They covered entering the island, the phone touch case, and the not-staged and corrupt-receipt states through `/assets/world/manifest.json`.
- `tests/browser/routeReferenceWorldAsNotStaged.ts`: only reference-route cases used it.
- The webgpu.spec.ts case "renders the code-built default scene using a real WebGPU device": it only proved WebGPU on the reference route. The source-world case checks the same device, context, no-WebGL and submission conditions on `?world=interlude`.
- `tests/unit/terrainSurfaceFragmentSource.test.ts`: it pinned the reference-world shader change, which was reverted on owner instruction.
- Kept on purpose: `tests/browser/terrainLegacyReference.spec.ts`. It is a synthetic WebGL2 harness page for the native terrain UV rule (WORLD-01). It never opens `/` and never reads `public/assets/world`. Its phone screenshot is already 932 x 430 with isMobile and hasTouch.

## Re-pointed to `?world=interlude`

- webgpu.spec.ts: device loss after entry, WebGPU unavailable, and device request rejected. The world-request guard now watches `/l2/` only.
- loadingPanel.spec.ts: the module download failure case on a landscape phone (932 x 430, isMobile, hasTouch).
- assetPackage.spec.ts: the drop and developer-sheet helpers (entity count 2, and `__nativeSlice` instead of `__worldDiagnostics`). Both phone screenshots are under `artifacts/native-integration/` at 932 x 430.
- From the WIP, verified here: nativeStartup (retryable section failure, and "Native asset store not staged" when `/l2/catalog.json` is missing), nativeFacing, nativeReveal, nativeBsp, nativeFlame (reads `nativeSandboxConfiguration`), and nativeSlice (imports `nativeSandboxConfiguration` and `nativeSandboxPresentation`).
- tests/startup/devStartup.spec.ts: measures `?world=interlude` only.
- Private preview: `scripts/private-preview.mjs` (invite redirect), `check-private-preview.mjs`, `check-private-preview-burst.mjs`, `check-private-preview-external.mjs` and `private-preview-tunnel.ps1`. The burst diagnosis now HEADs the built catalog and every hash-addressed section resource instead of `dist/scene/native-world.babylon`. The external phone context is 932 x 430, and its headless FPS readout field is removed.

## Test results

- `pnpm typecheck`: exit 0.
- `pnpm test:unit` (BelowNormal): 112 files (1 failed, 106 passed, 5 skipped), 1478 tests (2 failed, 1394 passed, 82 skipped). The 2 failures are the known `tests/unit/nativeNpcProfiles.test.ts` cases. New: `tests/unit/privatePreviewTargets.test.ts`, 8 of 8 pass.
- Touched specs (webgpu, loadingPanel, assetPackage, nativeStartup), port 5173 free: 15 tests, 12 passed, 3 skipped, 0 failed.
- Full `pnpm test:e2e`, 2026-11-08 11:03 Riga, port 5173 free (`Get-NetTCPConnection -LocalPort 5173 -State Listen` empty): 36 tests, 31 passed, 5 skipped, 0 failed, 7.0 min.
- The 5 skips are cases whose local artifacts are missing on PROMINENCE-PC, so they are unverified here, not passed:
  - three assetPackage.spec.ts native-package cases (no `artifacts/native-assets`)
  - nativeTexture.spec.ts (no `artifacts/native-parity/migration/coverage.json`)
  - one nativeBsp.spec.ts case (no Actor940 contact oracle)
- No FPS or performance figure from these headless SwiftShader runs is reported.
- `pnpm build` was not run. The plan's tasks do not require it, and the phase gate runs it once.

## Dev cold start

PROMINENCE-PC, Ryzen 7 7800X3D, not comparable to the DATABASE-PC baseline.

Route `?world=interlude` on a fresh Vite at 127.0.0.1:5175 with a warm deps cache (browserHash `c9433f75` before both runs). Neither run printed "new dependencies optimized".

| Run | Script requests | Script bytes | First `src/runtime/` request | Longest gap | Ready | Editor-tools requests |
|-----|-----------------|--------------|------------------------------|-------------|-------|-----------------------|
| 1 | 630 | 13,648,199 | 0.551 s | 1.225 s | 10.234 s | 0 |
| 2 | 630 | 13,648,183 | 0.577 s | 0.822 s | 10.222 s | 0 |

The baseline is 262 and 288 script requests, first runtime module at 38.56 s and 39.25 s, and longest gap 22.984 s and 21.528 s. It was measured on DATABASE-PC on `?world=courtyard`. These runs cannot say whether that gap is gone, so NOED-02 stays out of `requirements-completed` until the like-for-like DATABASE-PC re-measure (OVERNIGHT-DECISIONS row 36). Traces: `artifacts/dev-startup/prominence-run-1/` and `prominence-run-2/`.

## Deviations from Plan

- [Rule 4 resolved by owner decision row 42] The reference-route parts of Task 1 were dropped. world.spec.ts was deleted instead of rewritten, and the default-route checks moved from `/` to `?world=interlude`. The 017904c shader fix was reverted.
- [Rule 2] Each re-pointed case that now loads the full native section uses the same test budget as its sibling native cases: 120 s for loadingPanel, 240 s for webgpu device loss, and 360 s for the two assetPackage cases that load twice. No expect timeout or `waitUntil` was changed.
- [Rule 3] `playwright.startup.config.ts` pipes the Vite stdout, so the "new dependencies optimized" check can be read.
- Folded in from the owner: the NOED-01 private preview follow-up from deferred-items.md (resolved there).
- STATUS.md `data` line: left as is. It already states the Phase 1 result (E: lock, 40-table inventory).
- My first commit of 3aed82b accidentally included the world.spec.ts deletion. I soft-reset that one unpushed local commit and split the work into 3aed82b and 9bf31bb.

## Known Stubs

None.

## Process cleanup

Playwright started and stopped its own servers on 5173 and 5175. After the runs, nothing listened on 5173 or 5175. The only processes left with `l2b-auto` in their command line were the orchestrator session and its shells. No node or chrome process from these runs remained.

## Self-Check: PASSED

- Files exist: playwright.startup.config.ts, tests/startup/devStartup.spec.ts, scripts/private-preview-targets.mjs, tests/unit/privatePreviewTargets.test.ts.
- Files absent: tests/browser/demo.spec.ts, nativeEditor.spec.ts, world.spec.ts, routeReferenceWorldAsNotStaged.ts, and tests/unit/terrainSurfaceFragmentSource.test.ts.
- Commits 41f5caa, 3aed82b, 9bf31bb and 5436dd7 are ancestors of HEAD.
