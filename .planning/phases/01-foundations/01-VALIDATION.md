---
phase: "1"
slug: "foundations"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-08"
---

# Phase 1 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `01-RESEARCH.md` section "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.1.0 (`tests/unit/**/*.test.ts`), Python unittest via `scripts/test_pipeline.py` (`pnpm test:pipeline`), Playwright 1.64.1 (`tests/browser`, port 5173) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`; new `vitest.editor.config.ts` (Wave 0) |
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
| FOUND-01 | lanes.json valid, every part has one lane, check script flags foreign paths; STATUS.md one line per part; EVIDENCE.md under 30 KB | unit | `pnpm vitest run tests/unit/laneOwnership.test.ts` | W0 | pending |
| FOUND-02 | Reader accepts v1 and v2 asset.json, rejects bad `coordinates`; writer emits v2; fixture lock hashes match | unit + pytest | `pnpm vitest run tests/unit/assetPackageContract.test.ts`; `python -B -m unittest discover -s tests/pipeline -p test_asset_manifest_v2.py` | W0 | pending |
| FOUND-02 | One catalog reader with `npc:`/`item:`/`skill:`/`tile:`/`window:` index from a catalog fixture | unit | `pnpm vitest run tests/unit/nativeCatalogIndex.test.ts` | W0 | pending |
| FOUND-03 | Walker rejects reparse points, deterministic order; classifier (equal, E-only, IMPORTA-only, differing, volatile-config); guard refuses E: when lock missing or stale, allows equal paths only; every `--client` script calls the guard | pytest | `python -B -m unittest discover -s tests/pipeline -p "test_reference_client_*.py"` | W0 | pending |
| FOUND-04 | Inventory has 40 rows; counts only from pinned decode or Elbera evidence | pytest | `python -B -m unittest discover -s tests/pipeline -p test_dat_table_inventory.py` | W0 | pending |
| ARCH-01 | `src/ui/**` imports no decoded weapongrp/armorgrp/skillgrp module | unit | `pnpm vitest run tests/unit/architectureInvariants.test.ts` | W0 | pending |
| ARCH-02 | Five frozen methods (type), both adapters conform (runtime), no `@babylonjs` in `src/world/**`, concrete adapters only in composition roots | typecheck + unit | `pnpm typecheck && pnpm vitest run tests/unit/gameWorldAdapterContract.test.ts tests/unit/importBoundaries.test.ts` | W0 | pending |
| ARCH-03 | Missing ID keeps entity, shows label marker and sheet note, no mesh; readiness barrier still gates reveal | unit + e2e | `pnpm vitest run tests/unit/sandboxMissingAsset.test.ts`; `pnpm test:e2e tests/browser/sandbox.spec.ts` | W0 | pending |
| ARCH-04 | Asset resolution outside adapters | unit | as ARCH-02 | W0 | pending |
| SAND-01 | spawn-npc / equip-item / cast-skill handled by both adapters with L2 IDs; open window by ID reports not in catalog; sheet controls exist | unit + e2e | `pnpm vitest run tests/unit/sandboxCommands.test.ts`; `pnpm test:e2e tests/browser/sandbox.spec.ts` | W0 | pending |
| NOED-01 | Native route builds its scene in code; config equals the saved Editor values; `authored=1` only via dynamic import | unit + e2e | `pnpm vitest run tests/unit/presentationConfiguration.test.ts tests/unit/environmentRouting.test.ts`; `pnpm test:e2e tests/browser/nativeSlice.spec.ts` | partly | pending |
| NOED-02 | dev/build scripts contain no Editor step; static graph of `src/main.ts` excludes editor-tools and `src/scripts.ts` | unit | `pnpm vitest run tests/unit/defaultEntryImportGraph.test.ts` | W0 | pending |
| NOED-03 | No `example.scene` / courtyard path; default route ready without staging | unit + e2e | `pnpm vitest run tests/unit/environmentRouting.test.ts`; `pnpm test:e2e tests/browser/webgpu.spec.ts` | rewrite | pending |
| NOED-04 | Inspector absent from static graph; `?inspect=1` opens it | unit + e2e | `pnpm vitest run tests/unit/defaultEntryImportGraph.test.ts`; `pnpm test:e2e tests/browser/inspector.spec.ts` | W0 | pending |
| NOED-05 | `test:unit` includes no Editor-path test; dev/build do not reference `generate:editor` | unit | `pnpm vitest run tests/unit/editorIndependence.test.ts` | W0 | pending |

---

## Wave 0 Requirements

- [ ] `vitest.editor.config.ts` + `test:editor` script; Editor-path tests move out of `test:unit`
- [ ] Shared esbuild static-graph helper for tests
- [ ] Golden fixture generator, fixture lock, `.gitattributes` LF rules for hashed JSON
- [ ] `tests/pipeline/test_reference_client_*.py`, `test_dat_table_inventory.py`, `test_asset_manifest_v2.py`
- [ ] `tests/unit/gameWorldAdapterContract.test.ts`, `importBoundaries.test.ts`, `defaultEntryImportGraph.test.ts`, `laneOwnership.test.ts`, `architectureInvariants.test.ts`
- [ ] `tests/browser/sandbox.spec.ts`, `tests/browser/inspector.spec.ts`; startup measurement script

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full-tree hash lock of both client trees | FOUND-03 | Needs the private client trees and the IMPORTA-PC ssh link; heavy hashing | Run the tracked lock script outside relay windows at BelowNormal; commit the lock; the pytest suite then checks the guard against it |
| Dev cold-start re-measure | NOED-02, NOED-03 | Timing on the real machine | Run the startup measurement script on port 5175 after the Editor pack is removed; record the result in the part's EVIDENCE.md |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 300s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
