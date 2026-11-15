---
phase: "1"
slug: "foundations"
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-08"
---

# Phase 1 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `01-RESEARCH.md` section "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.1.0 (`tests/unit/**/*.test.ts`), Python unittest via `scripts/test_pipeline.py` (`pnpm test:pipeline`), Playwright 1.64.1 (`tests/browser`, port 5173) |
| **Config file** | `vitest.config.ts`, `vitest.editor.config.ts`, `playwright.config.ts`, startup spec `tests/startup/devStartup.spec.ts` (port 5175) |
| **Quick run command** | `pnpm typecheck && pnpm vitest run <touched test files>` |
| **Full suite command** | `pnpm typecheck && pnpm test:unit`, plus `pnpm test:pipeline`, plus `pnpm test:e2e` only while port 5173 is free |
| **Estimated runtime** | ~180 seconds unit, ~120 seconds pipeline, e2e several minutes |

---

## Sampling Rate

- **After every task commit:** `pnpm typecheck && pnpm vitest run <touched test files>`; pipeline tasks also run their unittest module.
- **After every plan wave:** `pnpm typecheck && pnpm test:unit` and `pnpm test:pipeline`.
- **Before `/gsd-verify-work`:** both full suites green, `pnpm build` green once (BelowNormal, outside relay windows), `pnpm test:e2e` green with port 5173 free, dev cold-start re-measure recorded.
- **Max feedback latency:** 300 seconds
- **Process cleanup:** after every plan and verification, stop started dev servers, browsers, e2e runners and Vitest workers by PID or by a command line holding this worktree path or port.
- **Relay windows:** no tests, builds or hashing Sun 10:00-14:00 and Thu 19:00-21:30 Riga.

---

## Per-Requirement Verification Map

| Requirement | Behaviour | Test Type | Automated Command | File Exists | Status |
|-------------|-----------|-----------|-------------------|-------------|--------|
| FOUND-01 | lanes.json valid, every part has one lane, check script flags foreign paths; STATUS.md one line per part; EVIDENCE.md under 30 KB | unit | `pnpm vitest run tests/unit/laneOwnership.test.ts` | yes | green |
| FOUND-02 | Reader accepts v1 and v2 asset.json, rejects bad `coordinates`; writer emits v2; fixture lock hashes match | unit + pytest | `pnpm vitest run tests/unit/assetPackageContract.test.ts`; `python -B -m unittest discover -s tests/pipeline -p test_asset_manifest_v2.py` | yes | green |
| FOUND-02 | One catalog reader with `npc:`/`item:`/`skill:`/`tile:`/`window:` index from a catalog fixture | unit | `pnpm vitest run tests/unit/nativeCatalogIndex.test.ts` | yes | green |
| FOUND-03 | Walker rejects reparse points, deterministic order; classifier (equal, E-only, IMPORTA-only, differing, volatile-config); guard refuses E: when lock missing or stale, allows equal paths only; every `--client` script calls the guard | pytest | `python -B -m unittest discover -s tests/pipeline -p "test_reference_client_*.py"` | yes | green |
| FOUND-04 | Inventory has 40 rows; counts only from pinned decode or Elbera evidence | pytest | `python -B -m unittest discover -s tests/pipeline -p test_dat_table_inventory.py` | yes | green |
| ARCH-01 | `src/ui/**` imports no decoded weapongrp/armorgrp/skillgrp module | unit | `pnpm vitest run tests/unit/architectureInvariants.test.ts` | yes | green |
| ARCH-02 | Five frozen methods (type), both adapters conform (runtime), no `@babylonjs` in `src/world/**`, concrete adapters only in composition roots | typecheck + unit | `pnpm typecheck && pnpm vitest run tests/unit/gameWorldAdapterContract.test.ts tests/unit/importBoundaries.test.ts` | yes | green |
| ARCH-03 | Missing ID keeps entity, shows label marker and sheet note, no mesh; readiness barrier still gates reveal | unit + e2e | `pnpm vitest run tests/unit/sandboxMissingAsset.test.ts`; `pnpm test:e2e tests/browser/sandbox.spec.ts` | yes | green |
| ARCH-04 | Asset resolution outside adapters | unit | as ARCH-02 | yes | green |
| SAND-01 | spawn-npc / equip-item / cast-skill handled by both adapters with L2 IDs; open window by ID reports not in catalog; sheet controls exist | unit + e2e | `pnpm vitest run tests/unit/sandboxCommands.test.ts`; `pnpm test:e2e tests/browser/sandbox.spec.ts` | yes | green |
| NOED-01 | Native route builds its scene in code; config equals the saved Editor values; `authored=1` only via dynamic import | unit + e2e | `pnpm vitest run tests/unit/presentationConfiguration.test.ts tests/unit/environmentRouting.test.ts`; `pnpm test:e2e tests/browser/nativeSlice.spec.ts` | yes | green |
| NOED-02 | dev/build scripts contain no Editor step; static graph of `src/main.ts` excludes editor-tools and `src/scripts.ts` | unit | `pnpm vitest run tests/unit/defaultEntryImportGraph.test.ts` | yes | green |
| NOED-03 | No `example.scene` / courtyard path; default route ready without staging (browser case runs on `?world=interlude`, OVERNIGHT-DECISIONS rows 42 and 44) | unit + e2e | `pnpm vitest run tests/unit/environmentRouting.test.ts`; `pnpm test:e2e tests/browser/webgpu.spec.ts` | yes | green |
| NOED-04 | Inspector absent from static graph; `?inspect=1` opens it | unit + e2e | `pnpm vitest run tests/unit/defaultEntryImportGraph.test.ts`; `pnpm test:e2e tests/browser/inspector.spec.ts` | yes | green |
| NOED-05 | `test:unit` includes no Editor-path test; dev/build do not reference `generate:editor` | unit | `pnpm vitest run tests/unit/editorIndependence.test.ts` | yes | green |

---

## Wave 0 Requirements

- [x] `vitest.editor.config.ts` + `test:editor` script; Editor-path tests move out of `test:unit`
- [x] Shared static-graph helper for tests (`tests/support/staticImportGraph.ts`)
- [x] Golden fixture generator, fixture lock, `.gitattributes` LF rules for hashed JSON
- [x] `tests/pipeline/test_reference_client_*.py`, `test_dat_table_inventory.py`, `test_asset_manifest_v2.py`
- [x] `tests/unit/gameWorldAdapterContract.test.ts`, `importBoundaries.test.ts`, `defaultEntryImportGraph.test.ts`, `laneOwnership.test.ts`, `architectureInvariants.test.ts`
- [x] `tests/browser/sandbox.spec.ts`, `tests/browser/inspector.spec.ts`; startup measurement `tests/startup/devStartup.spec.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full-tree hash lock of both client trees | FOUND-03 | Needs the private client trees and the IMPORTA-PC ssh link; heavy hashing | Done in plan 01-13 (`recipes/reference-client-tree.lock.json`); `test_reference_client_lock.py` checks the committed lock automatically. Re-lock only when a tree changes. The 2 real-tree guard cases skip where `E:/Lineage2-client` is absent (PROMINENCE-PC) |
| Dev cold-start re-measure | NOED-02, NOED-03 | Timing on the real machine | Measured in plan 01-17 on PROMINENCE-PC (Ryzen 7 7800X3D, not comparable to the DATABASE-PC baseline). Open: the like-for-like DATABASE-PC re-measure with `tests/startup/devStartup.spec.ts` on port 5175, outside relay windows |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 300s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-11-08

---

## Validation Audit 2026-11-08

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Run on PROMINENCE-PC at BelowNormal, port 5173 free:
- `pnpm typecheck` green; the 12 mapped Vitest files: 124 passed.
- Mapped pytest modules (`test_asset_manifest_v2`, `test_reference_client_*`, `test_dat_table_inventory`, `test_client_entry_points`, `test_native_assets_manifest_v2`): 71 passed, 2 skipped (no `E:/Lineage2-client` here).
- Playwright `sandbox`, `inspector`, `nativeSlice`, `webgpu` specs: 10 passed (SwiftShader; no FPS claim).
- Full `pnpm test:unit`: 1394 passed, 2 failed, both the known pre-existing `tests/unit/nativeNpcProfiles.test.ts` cases, not mapped to a phase 1 requirement.
- Full `pnpm test:pipeline`: 17 errors, all from this host, none in a phase 1 module: Pillow missing (`test_native_sky`), temp paths past the Windows 260-character limit (`test_native_terrain_runtime_migration`, `test_stage_native_runtime`), and Python 3.11 lacking `Path.is_junction` (`test_catalog`). OVERNIGHT-DECISIONS row 45.
