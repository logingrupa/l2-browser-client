---
phase: 01-foundations
verified: 2026-11-08T11:46:28Z
status: human_needed
score: 6/6 must-haves verified
covered_files: [".planning/phases/01-foundations/01-01-PLAN.md", ".planning/phases/01-foundations/01-01-SUMMARY.md", ".planning/phases/01-foundations/01-02-PLAN.md", ".planning/phases/01-foundations/01-02-SUMMARY.md", ".planning/phases/01-foundations/01-03-PLAN.md", ".planning/phases/01-foundations/01-03-SUMMARY.md", ".planning/phases/01-foundations/01-04-PLAN.md", ".planning/phases/01-foundations/01-04-SUMMARY.md", ".planning/phases/01-foundations/01-05-PLAN.md", ".planning/phases/01-foundations/01-05-SUMMARY.md", ".planning/phases/01-foundations/01-06-PLAN.md", ".planning/phases/01-foundations/01-06-SUMMARY.md", ".planning/phases/01-foundations/01-07-PLAN.md", ".planning/phases/01-foundations/01-07-SUMMARY.md", ".planning/phases/01-foundations/01-08-PLAN.md", ".planning/phases/01-foundations/01-08-SUMMARY.md", ".planning/phases/01-foundations/01-09-PLAN.md", ".planning/phases/01-foundations/01-09-SUMMARY.md", ".planning/phases/01-foundations/01-10-PLAN.md", ".planning/phases/01-foundations/01-10-SUMMARY.md", ".planning/phases/01-foundations/01-11-PLAN.md", ".planning/phases/01-foundations/01-11-SUMMARY.md", ".planning/phases/01-foundations/01-12-PLAN.md", ".planning/phases/01-foundations/01-12-SUMMARY.md", ".planning/phases/01-foundations/01-13-PLAN.md", ".planning/phases/01-foundations/01-13-SUMMARY.md", ".planning/phases/01-foundations/01-14-PLAN.md", ".planning/phases/01-foundations/01-14-SUMMARY.md", ".planning/phases/01-foundations/01-15-PLAN.md", ".planning/phases/01-foundations/01-15-SUMMARY.md", ".planning/phases/01-foundations/01-16-PLAN.md", ".planning/phases/01-foundations/01-16-SUMMARY.md", ".planning/phases/01-foundations/01-17-PLAN.md", ".planning/phases/01-foundations/01-17-SUMMARY.md", "DECISIONS.md", "STATUS.md", "docs/OUTPUT_CONTRACT.md", "docs/parts/data/dat-table-inventory.json", "package.json", "recipes/reference-client-tree.lock.json", "scripts/build_dat_table_inventory.py", "scripts/build_reference_client_lock.py", "scripts/check-lane-ownership.mjs", "scripts/hash_reference_client_tree.py", "scripts/native_catalog/cli.py", "scripts/reference_client_guard.py", "src/App.ts", "src/runtime/attachSandboxCommandSheet.ts", "src/runtime/createNativeSliceRuntime.ts", "src/runtime/sandboxNpcVisual.ts", "src/scene/loadEnvironment.ts", "src/scene/openBabylonInspector.ts", "src/world/GameWorldAdapter.ts", "src/world/worldTypes.ts", "tests/browser/inspector.spec.ts", "tests/browser/sandbox.spec.ts", "tests/fixtures/golden/fixtures.lock.json", "tests/pipeline/test_client_entry_points.py", "tests/unit/architectureInvariants.test.ts", "tests/unit/defaultEntryImportGraph.test.ts", "tests/unit/editorIndependence.test.ts", "tests/unit/gameWorldAdapterContract.test.ts", "tests/unit/importBoundaries.test.ts", "tests/unit/sandboxCommandSheet.test.ts"]
covered_digest: "v4:sha256:6dc2516ba98a3da7fa26f910dc93cb610fb7b3ffec2b5899d4e31a521e9ce2d6"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Run tests/startup/devStartup.spec.ts (playwright.startup.config.ts, port 5175) on DATABASE-PC outside the relay windows and compare with the 262/288 request, 38.56/39.25 s first runtime module and 22.98/21.53 s longest gap baseline"
    expected: "Recorded like-for-like numbers in docs/parts/sandbox/EVIDENCE.md, with zero babylonjs-editor-tools requests; the gap is called gone or still present only from these numbers"
    why_human: "The roadmap verification note needs the original machine; PROMINENCE-PC (Ryzen 7 7800X3D) numbers are not comparable and this host has no E: tree or GTX 1060"
  - test: "Owner look at the behaviour-changing review fixes listed in OVERNIGHT-DECISIONS row 49: CR-101, CR-102, WR-102 and WR-401, CR-301, WR-310 and WR-501"
    expected: "Owner accepts or reverts each fix (each has its own commit and test)"
    why_human: "The fixers marked them requires human verification; they change sourced speed readouts, default clips, sandbox notes and guard scope"
  - test: "Decide the native_catalog/cli.py inventory scope: inventory() hashes and reads a 128-byte header of every file under --client, including the 4 differing, 4111 e-only and 22 volatile-config E: files, behind only the entry guard"
    expected: "Either limit the inventory on E: to lock-equal files, or keep the catalog CLI on IMPORTA-PC only (deferred-items.md, plan 01-12 section, owner: data lane or integration thread)"
    why_human: "It writes a source catalog, not converted assets, so it does not break SC1 as written, but it is an E: read outside require_equal_file and the fix is an owner choice"
  - test: "Confirm the five judgment-tier prohibitions (01-01 native-store writers stay integration-owned, 01-06 no code-built courtyard stand-in, 01-10 upper slot only, 01-14 controls in the pinnable sheet, 01-17 no claim that the cold-start gap is fixed)"
    expected: "Owner agrees with the verifier's non-authoritative pass on each"
    why_human: "unverified-prohibition - human review recommended; judgment-tier items have no test that can prove them"
---

# Phase 1: Foundations verification report

**Phase goal:** Three lanes can start in parallel against frozen contracts, a locked reference tree and a table inventory, with a sandbox shell ready to receive content.
**Verified:** 2026-11-08T11:46:28Z on PROMINENCE-PC
**Status:** human_needed
**Re-verification:** No, initial verification

## Goal achievement

### Observable truths (roadmap success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A recorded full-tree hash lock shows E: equal to IMPORTA-PC or lists every difference, and conversion refuses E: while the lock is missing or stale | VERIFIED | `recipes/reference-client-tree.lock.json` schemaVersion 1: E: 9,737 files / 7,839,082,362 bytes (DATABASE-PC), IMPORTA-PC 5,629 files / 7,814,256,191 bytes; classes equal 5602, e-only 4111, differing 4 (Start-LAN.cmd, Start-Tailscale.cmd, one iwo .dat, system/nwindow.dll), importa-only 4, volatile-config 22, unreadable 0; `system/engine.dll` equal at 4dd2f63c...5b08. `scripts/reference_client_guard.py` raises on a missing lock, requires lock class `equal` per file, re-hashes on any size or mtime change and fails closed for every root except the lock's own reference root on its host. Pytest here: guard 21, lock 8 (2 skipped, no E:), tree 12, entry-point scan 7, catalog package lock 3, all OK |
| 2 | One inventory lists all 40 `.dat` tables with route, record count and status | VERIFIED | `docs/parts/data/dat-table-inventory.json`: 40 rows, sorted, unique; routes local-decoded 8, local-layout-only 29, elbera 3; 14 integer counts, 26 `unknown`, each count with a named source; `test_dat_table_inventory.py` 19 OK |
| 3 | Sandbox: spawn NPC, equip item, cast skill and open window by ID with no server; a missing ID shows a visible diagnostic, not a stand-in | VERIFIED | `attachSandboxCommandSheet.ts` wired from `createNativeSliceRuntime.ts:257`; `sandboxNpcVisual.ts` gives a meshless label-only marker. `tests/browser/sandbox.spec.ts` passed here on `?world=interlude` (npc 12345 marker with meshCount 0, npc 21622 converted Musveren, item 22 and 999999, window StatusWnd not in catalog, bad input rejected). Cast skill 3 level 1 and the Power Strike start: `sandboxCommandSheet.test.ts` passed |
| 4 | Adapter contract test fails if the five methods change; written output contract for units, handedness and catalog; hash-pinned fixtures without the private client | VERIFIED | `gameWorldAdapterContract.test.ts` uses `expectTypeOf<keyof GameWorldAdapter>()` (tsconfig includes `tests`, `pnpm typecheck` exit 0) plus a runtime check of both adapters; `docs/OUTPUT_CONTRACT.md` has units and handedness per route and the catalog key table; `tests/fixtures/golden/fixtures.lock.json` with synthetic fixtures; `assetPackageContract.test.ts`, `test_asset_manifest_v2.py` (15) and `test_native_assets_manifest_v2.py` (5) pass |
| 5 | A new lane knows its branch, STATUS line, folder ownership and EVIDENCE.md | VERIFIED | `.planning/lanes.json` has lanes world, actors, data-ui, integration; derive-*, migrate-*, stage-* and `native_assets.py` sit in integration; `scripts/check-lane-ownership.mjs`; STATUS.md has 19 part lines; all 19 `docs/parts/<part>/EVIDENCE.md` exist; DECISIONS.md lists DEC-OWN-1..10, same set as PROJECT.md; `laneOwnership.test.ts` passed |
| 6 | `pnpm dev` and `pnpm build` run without the Editor pack or repair scripts (moved to `generate:editor`), `?world=interlude` loads from the catalog with no Editor scene, `?inspect=1` opens a lazy Inspector | VERIFIED | package.json: dev is `stage-webgpu-compilers && vite`, build is `stage-webgpu-compilers && typecheck && vite build`, the six Editor steps live only in `generate:editor`; `vite.config.ts` loads no Editor plugin; `loadEnvironment.ts` builds the native scene in code, `authored=1` only through `import("./authoredNativeWorld")`; `defaultEntryImportGraph.test.ts` and `editorIndependence.test.ts` pass; `inspector.spec.ts` (2 cases) passed here; @babylonjs/inspector and core both 9.27.1 |

**Score:** 6/6 truths verified (0 present, behavior-unverified)

### Required artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `recipes/reference-client-tree.lock.json` | VERIFIED | 2.4 MB, 9,743 path records |
| `scripts/reference_client_guard.py` | VERIFIED | 135 lines, used by all 23 client entry points (scan test) |
| `docs/parts/data/dat-table-inventory.json` | VERIFIED | 40 rows |
| `src/assets/native/readNativeCatalog.ts`, `nativeCatalogIndex.ts` | VERIFIED | index built in `createNativeSliceRuntime.ts:74`, failure shown on the Sandbox tab |
| `src/runtime/attachSandboxCommandSheet.ts`, `sandboxNpcVisual.ts` | VERIFIED | wired, exercised by e2e |
| `src/world/GameWorldAdapter.ts` + contract test | VERIFIED | five methods |
| `docs/OUTPUT_CONTRACT.md`, golden fixtures | VERIFIED | |
| `.planning/lanes.json`, `scripts/check-lane-ownership.mjs`, STATUS.md, DECISIONS.md, EVIDENCE.md x19 | VERIFIED | |
| `src/scene/openBabylonInspector.ts` | VERIFIED | dynamic import only |
| `tests/startup/devStartup.spec.ts`, `playwright.startup.config.ts` | VERIFIED (exists) | DATABASE-PC run pending |

### Key link verification

| From | To | Status |
|------|----|--------|
| `createNativeSliceRuntime.ts` | `attachSandboxCommandSheet` | WIRED (line 257) |
| `createNativeSliceRuntime.ts` | `sandboxNpcVisualFactory` | WIRED (line 159) |
| `loadEnvironment.ts` | `startNativeSandboxRuntime` | WIRED |
| `loadEnvironment.ts` | `./authoredNativeWorld` | dynamic import only |
| `App.ts:39` | `openBabylonInspector` | dynamic import under `inspect=1` |
| `native_catalog/cli.py`, converters | `require_reference_client` | WIRED (entry-point scan test) |

### Behavioral spot-checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Types incl. contract `expectTypeOf` | `pnpm typecheck` (BelowNormal) | exit 0 | PASS |
| 13 mapped Vitest files | `pnpm vitest run ...` | 145 passed | PASS |
| 8 mapped pytest modules | `python -B -m unittest discover ...` | 90 OK, 2 skipped (no E:) | PASS |
| Sandbox, inspector, native not-staged | `pnpm test:e2e sandbox inspector nativeStartup` (5173 free) | 5 passed, 45 s | PASS |

No FPS figure is taken from these SwiftShader runs. `pnpm build` was not re-run here; plan 01-16 recorded a green build with the Inspector out of the entry chunk. Full `pnpm test:unit` was not re-run (validation audit: 1394 passed, only the 2 known `nativeNpcProfiles` failures).

### Probe execution

No phase-declared probe scripts. Skipped.

### Requirements coverage

| Requirement | Source plan | Status | Evidence |
|-------------|-------------|--------|----------|
| FOUND-01 | 01-01 | SATISFIED | truth 5 |
| FOUND-02 | 01-03, 01-12 | SATISFIED | truth 4, catalog reader |
| FOUND-03 | 01-02, 01-07, 01-08, 01-13 | SATISFIED | truth 1 (see human item 3) |
| FOUND-04 | 01-13 | SATISFIED | truth 2 |
| ARCH-01 | 01-15 | SATISFIED | `architectureInvariants.test.ts`: no display-copy table import in src/ui or src/runtime, skill-cast carries identity only |
| ARCH-02 | 01-10, 01-15 | SATISFIED | contract test, `importBoundaries.test.ts` |
| ARCH-03 | 01-05, 01-11, 01-14 | SATISFIED | missing-asset marker, not-staged error e2e, readiness barrier test |
| ARCH-04 | 01-15 | SATISFIED | `importBoundaries.test.ts`; 01-14 key-builder truth landed. REQUIREMENTS.md still says Pending |
| SAND-01 | 01-03, 01-10, 01-11, 01-14 | SATISFIED | truth 3 |
| NOED-01 | 01-04, 01-05, 01-06, 01-17 | SATISFIED | truth 6 |
| NOED-02 | 01-09, 01-17 | SATISFIED (code); re-measure is human item 1 | scripts and static graph test. REQUIREMENTS.md still says Pending |
| NOED-03 | 01-06, 01-17 | SATISFIED | `assets/example.scene` and `public/scene` gone |
| NOED-04 | 01-16 | SATISFIED | inspector e2e passed here |
| NOED-05 | 01-09 | SATISFIED | `editorIndependence.test.ts`; Editor tests only under `test:editor`. REQUIREMENTS.md still says Pending |

All 14 phase IDs are claimed by at least one plan; none orphaned.

### Anti-patterns found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| 216 phase-touched src, scripts and tests files | TBD, FIXME, XXX, TODO, code comments | none found | - |
| `.planning/REQUIREMENTS.md` | ARCH-04, NOED-02, NOED-05 unticked and Pending although satisfied in code | Warning | Bookkeeping; tick when the phase closes (NOED-02 after the DATABASE-PC re-measure if the owner wants that) |
| `STATUS.md` sandbox line | says "DATABASE-PC re-measure pending" but does not name NOED-02 (01-17 truth) | Info | Wording |
| Wording grep from the run rules | 47 hits in 27 files, one phase-touched (`tests/unit/nativeOrProceduralCharacter.test.ts`, CR-202) | Info | Deferred to the reference-route removal branch (rows 42 and 48) |
| `scripts/native_catalog/cli.py` `inventory()` | reads non-equal E: files behind only the entry guard | Warning | Human item 3 |

### Human verification required

1. **DATABASE-PC cold-start re-measure.** Run the startup spec on port 5175 outside the relay windows and record like-for-like numbers.
2. **Review fixes from row 49.** Owner accepts or reverts CR-101, CR-102, WR-102/WR-401, CR-301, WR-310/WR-501.
3. **Catalog CLI inventory scope on E:.** Limit to lock-equal files or keep the CLI on IMPORTA-PC.
4. **Judgment-tier prohibitions.** The verifier's pass on the five items is not authoritative.

### Gaps summary

No blocking gap. All six roadmap criteria and all 14 requirements hold in the code, and the checks behind them were re-run on this host: typecheck, 145 Vitest cases, 90 pytest cases and 5 Playwright cases. What remains is other-machine and owner work. REQUIREMENTS.md bookkeeping is also behind.

---

_Verified: 2026-11-08T11:46:28Z_
_Verifier: Claude (gsd-verifier)_
