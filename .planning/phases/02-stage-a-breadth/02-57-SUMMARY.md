---
phase: 02-stage-a-breadth
plan: 57
subsystem: integration
tags: [vendor-boundary, import-boundary, dependencies, clean-room, reference-overlap, dec-own-12]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-56 shared Babylon-free modules (src/shared/**, src/world/sourceFrame.ts) and the shared import specifier reader"
provides:
  - "tests/unit/importBoundaries.vendor.test.ts: the D7 vendor boundary over src/** and the no-vendor-semantics rule"
  - "@recast-navigation/core and generators as devDependencies only (0.43.0)"
  - "tools/reference-overlap/referenceOverlap.mjs: normaliseSourceTokens, findSharedTokenRuns, runReferenceOverlap and the --area CLI"
  - "tools/reference-overlap/overlapAreas.json: thresholds 12 and 20, the two pinned clones, five areas with source globs, reference globs and constant allowlists"
affects: [02-60, 02-61, 02-63, 02-65, 02-68, phase-4-network]

actuals:
  tokens: 19000
  tasks: 3
  commits: 3
plan_head_before: 1d9e89d78cc44fdc9a0f17cf8ba6712845594291
plan_head_after: 5443433f6e0c0ebd2c5a48a0513fb83c948cf87a

tech-stack:
  added: []
  patterns:
    - "Import boundary checks read specifiers from text through tests/support/sourceImportSpecifiers.ts readSourceTextImports, so synthetic probe sources exercise the same check as the real tree"
    - "Overlap tokens match identifiers under consistent renaming: an identifier compares by its back distance to the same name inside the run"
    - "A tool under tools/ is an .mjs module with one .d.mts declaration, imported by Vitest"

key-files:
  created:
    - tests/unit/importBoundaries.vendor.test.ts
    - tests/unit/referenceOverlap.test.ts
    - tools/reference-overlap/referenceOverlap.mjs
    - tools/reference-overlap/referenceOverlap.d.mts
    - tools/reference-overlap/sourceTokens.mjs
    - tools/reference-overlap/sharedTokenRuns.mjs
    - tools/reference-overlap/repositoryGlob.mjs
    - tools/reference-overlap/overlapAreas.json
    - tests/fixtures/reference-overlap/repository/src/scene/world/movement/stepIntegration.ts
    - tests/fixtures/reference-overlap/repository/src/scene/world/movement/headingWrap.ts
    - tests/fixtures/reference-overlap/repository/src/scene/world/movement/replyCodeTable.ts
    - tests/fixtures/reference-overlap/reference-clone/src/physics/fixtureReference.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - tests/support/sourceImportSpecifiers.ts
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - docs/EDITOR_VIEWER.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Recast moves to devDependencies at 0.43.0 rather than out of the manifest, because the Editor navmesh plugin test still bundles it (row 189)"
  - "The lockfile section move is hand-edited and proven by pnpm install --offline --frozen-lockfile, because an offline re-resolve lacks cached metadata (row 190)"
  - "The overlap tool is split into sourceTokens, sharedTokenRuns, repositoryGlob and referenceOverlap modules under tools/reference-overlap/ (row 191)"
  - "Normalisation drops comments and import declarations, compares identifiers under consistent renaming and groups reviewer runs by source span (row 192)"
  - "Area source globs include the 02-56 shared modules each area uses, and the first run is left red for review (row 193)"
  - "IDENTITY_AFFINE_MATRIX is allowlisted as kind identity-matrix (row 194)"
  - "--reference-root reaches the main checkout's clones; each clone's .git/HEAD must equal its pinned commit (row 195)"
  - "MAT-01, VIS-01, MOVE-01 and FX-01 stay Pending (row 196)"

patterns-established:
  - "Every DEC-OWN-12 port runs node tools/reference-overlap/referenceOverlap.mjs --area <name> --reference-root C:/laragon/www/l2-browser-client before its docs commit, and its owning EVIDENCE.md carries the reviewer sign-off"

requirements-completed: []

duration: 25min
completed: 2026-11-08
---

# Phase 2 Plan 57: Vendor boundary and reference overlap check Summary

**A Vitest boundary keeps recast, Babylon materials, the node particle editor, Babylon particle systems and Babylon collision movement out of `src/**`; recast is a pinned devDependency only; and `node tools/reference-overlap/referenceOverlap.mjs --area <name>` is the one clean-room overlap check for materials, bsp-visibility, movement, particles and network, with 12-token reviewer runs, 20-token blocking runs and exit 2 for an absent or unpinned clone.**

## Performance

- Duration: about 25 min (18:48 to 19:13 UTC), including one 5 min `pnpm build`.
- Tasks: 3 of 3.
- Files: 12 created, 8 modified.

## Accomplishments

- `tests/unit/importBoundaries.vendor.test.ts` (19 cases) scans all 161 `src/**` modules: no `@recast-navigation/*`, `@babylonjs/materials` or `@babylonjs/node-particle-editor` specifier (static, `export from` or `import()`) outside `src/scene/openBabylonInspector.ts`, and no `ParticleSystem`, `GPUParticleSystem`, `SolidParticleSystem`, `moveWithCollisions` or `checkCollisions`. Synthetic probe sources prove each refusal names the module or line, the inspector entry is exempt, and `@babylonjs/core` material imports are not mistaken for the forbidden package. The same file pins recast out of `dependencies` and at 0.43.0 in `devDependencies`.
- `package.json` and `pnpm-lock.yaml` move the two recast packages between sections only: the lockfile diff is 6 lines out and 6 lines in, all recast importer lines, no new package name. `pnpm install --offline --frozen-lockfile` reports the lockfile up to date; `pnpm build` passes; the Editor script test passes.
- `tools/reference-overlap/` reads files with `readFileSync` only. `normaliseSourceTokens` strips line and block comments and import declarations, turns identifiers and strings into placeholders, keeps keywords and multi-character operators, and keeps numbers by canonical value (`0x10` is `16`, `1_000` is `1000`). `findSharedTokenRuns` indexes reference windows by hash, verifies each candidate, extends it to the maximal run and drops runs an earlier start already covers. `runReferenceOverlap` checks each clone's `.git/HEAD` against its pin, expands the area globs, locates allowlisted constant declarations and returns `{area, referenceCommits, thresholds, sourceFiles, referenceFileCount, reviewerRuns, blockingRuns}`.
- First real run against the main checkout's clones (`854f629`, `4aac1bd`): materials and network have no sources yet and exit 0; bsp-visibility, movement and particles exit 1 with 17 blocking runs, all in the 02-56 shared modules and all generic shapes (argument guards, vector arithmetic, a tuple type). Recorded in EVIDENCE as open and in STATE Needs Human for a reviewer who did not write the code.

## Task commits

1. Task 1 RED: `a55d249` test(02-57): add the D7 vendor boundary test over src
2. Task 1 GREEN: `ba52000` feat(02-57): move recast navigation out of the runtime dependencies
3. Task 2: `5443433` feat(02-57): add the one reference overlap check for the DEC-OWN-12 areas
4. Task 3 and plan metadata: the docs commit holding this summary, EVIDENCE, STATUS, EDITOR_VIEWER, STATE, ROADMAP and OVERNIGHT-DECISIONS

## Acceptance counts

| Check | Result |
|---|---|
| Vendor boundary test | 19 of 19 pass; RED before the move (2 dependency cases failed, `RED_EVIDENCE_OK` from the JUnit record) |
| Overlap test | 20 of 20 pass |
| `overlapAreas.json` five areas | present (acceptance one-liner exits 0) |
| Lockfile diff | section move only, no new name |
| Lane ownership | `lane integration: 0 foreign paths` |
| `pnpm typecheck` | clean |
| `pnpm test:unit` | 1538 pass, 82 skipped, 2 fail: the known `nativeNpcProfiles.test.ts` red baseline |
| `pnpm build` | passes |
| Editor script test | 2 of 2 pass |
| Real overlap run | materials 0 and network 0 (no sources); bsp-visibility 8, movement 5, particles 4 blocking; reviewer spans 607, 150 and 216 |

## Verification

- `node scripts/check-machine-schedule.mjs && pnpm vitest run tests/unit/importBoundaries.vendor.test.ts`, the package.json one-liner and `pnpm build`: pass.
- `pnpm vitest run --config vitest.editor.config.ts tests/editor/editorScript.test.ts`: pass.
- `node scripts/check-machine-schedule.mjs && pnpm vitest run tests/unit/referenceOverlap.test.ts`: pass.
- `node scripts/check-lane-ownership.mjs --base 1d9e89d --part adapter-dispatch`: 0 foreign paths.
- In this worktree without `--reference-root` the tool exits 2 with `reference clone absent: <worktree>\.assets\reference\lineage2js`, as specified.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Offline install cannot re-resolve the manifest**
- Found during: Task 1
- Issue: `pnpm install --offline` failed with `ERR_PNPM_NO_OFFLINE_META` for `scheduler@0.28.0`; it re-resolves after a manifest change and the metadata cache lacks that entry.
- Fix: moved the two importer entries between lockfile sections by hand and verified with `pnpm install --offline --frozen-lockfile` ("Lockfile is up to date"). Nothing was fetched. Row 190.
- Files: `pnpm-lock.yaml`. Commit: `ba52000`.

**2. [Rule 2 - Correctness] Identifier normalisation too coarse**
- Found during: Task 2, first real run.
- Issue: one placeholder for every identifier listed 4,719 matches for three movement source files; three imports in a row already made a 21-token blocking run.
- Fix: identifiers compare under consistent renaming (same name maps to same name within a run), import declarations are dropped, reviewer runs are grouped by source span. Renaming every identifier still cannot hide a run (test "is not hidden by renaming every identifier consistently"), and binding names differently does separate them. Row 192.
- Files: `tools/reference-overlap/sourceTokens.mjs`, `sharedTokenRuns.mjs`. Commit: `5443433`.

**3. [Rule 3 - Blocking] File size**
- The tool split into four modules to stay under about 400 lines; `referenceOverlap.mjs` re-exports `normaliseSourceTokens` and `findSharedTokenRuns` so the plan's export list holds. Row 191.

**4. [Rule 2 - Correctness] Clone version check and reference root**
- Added: each clone's `.git/HEAD` must equal its pinned commit, else exit 2; a reference glob set that matches no file exits 2; `--reference-root` reaches the main checkout's clones from a worktree. Row 195.

**5. Shared import reader**
- `tests/support/sourceImportSpecifiers.ts` gained `readSourceTextImports` and `readSourceModuleText`, so the vendor test checks synthetic probe text with the same reader. It already saw `import()`.

### Process deviations

- Task 2 was written implementation first and tested after; no RED record exists for Task 2. Task 1 followed RED then GREEN with a classified record.
- The machine runs this session at normal priority: the session guard refused the PowerShell `BelowNormal` wrapper, so install, build and tests ran plainly (DATABASE-PC has no relay window).
- The process listing by command line (PowerShell `Get-CimInstance`) was refused by the session guard; cleanup was checked with `netstat` and the shell process list instead.

## Known stubs

None.

## Threat flags

None beyond the plan's register. T-02-57-01: the test scans every `tools/reference-overlap/*.mjs` for `child_process`, `import(`, `require(`, `eval(`, `new Function`, `node:vm` and `node:worker_threads` and finds none. T-02-SC: no package fetched or added.

## Needs Human

- 17 blocking runs in the 02-56 shared modules need a reviewer who did not write `src/shared/**`, or an owner decision to narrow the area source globs or the normalisation (STATE Needs Human, row 193).

## Process cleanup

Every command ran in the foreground and exited: Vitest runs, `pnpm install`, `pnpm build`, the overlap runs. No dev server, preview or browser was started. After the plan `netstat -ano` shows no listener on 5173 or 5175 and the shell process list shows no node, Vite, Vitest or browser process.

## Self-Check: PASSED

- Files: all 12 created files exist.
- Commits: `a55d249`, `ba52000` and `5443433` are ancestors of HEAD.
