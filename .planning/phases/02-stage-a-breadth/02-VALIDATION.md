---
phase: "2"
slug: "stage-a-breadth"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-08"
---

# Phase 2 - Validation Strategy

> Per-phase validation contract. Source: `02-RESEARCH.md` section "Validation Architecture" (requirement to test map, sampling rate, Wave 0 gaps).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (`tests/unit/**/*.test.ts`), Python unittest via `scripts/test_pipeline.py` (`pnpm test:pipeline`), Playwright (`tests/browser`, port 5173; 5175 only per research open question 9) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `pnpm typecheck && pnpm test:unit` for TS tasks; `pnpm test:pipeline` for Python tasks |
| **Full suite command** | `pnpm typecheck && pnpm test:unit && pnpm test:pipeline`, plus the e2e specs a plan touches |
| **Estimated runtime** | unit about 3 minutes, pipeline about 2 minutes, each e2e spec 1 to 3 minutes |

---

## Sampling Rate

- **Every run** starts with `node scripts/check-machine-schedule.mjs` once plan 02-02 lands (the only machine window is the PROMINENCE-PC nightly backup, 23:15-03:45 Riga; DATABASE-PC is free all the time).
- **After every task commit:** the quick run command for the task's language.
- **After every plan:** the full suite plus the plan's Playwright spec when the port rule allows, plus `node scripts/check-lane-ownership.mjs --part <slug>` before the docs commit.
- **Phase gate:** full suite green except the known red baseline (2 cases of `nativeNpcProfiles.test.ts` until ACT-02 work fixes them), plus each tracer's recorded load-check and screenshot. "Loads" counts only from recorded load-check records; otherwise unverified.
- **Max feedback latency:** 300 seconds.
- **Process cleanup:** after every plan and verification, stop started dev servers, browsers, e2e runners and Vitest workers by PID or by a command line holding the checkout path or port.

---

## Per-Requirement Verification Map

The full map with file names and owning plans is the table "Phase requirements to test map" in `02-RESEARCH.md` (Validation Architecture). Every Phase 2 requirement (SAND-02, DATA-01..03, UI-01..03, WORLD-01..08, ACT-01..06, INT-01, CONV-01, CONV-02) has at least one automated check there; user-visible requirements also have a Playwright check, and audio requirements a labelled audible report (owner preference).

---

## Wave 0 Requirements

- [ ] `tests/pipeline/test_store_paths.py` with a junction fixture helper
- [ ] `tests/pipeline/test_unit_ledger.py` with injected clock and disk probes
- [ ] `tests/fixtures/lane-store/` synthetic lane store (catalog, one chunk manifest, one model from golden fixtures)
- [ ] synthetic xdat header builder and synthetic decoded-table bytes in `tests/fixtures`
- [ ] Playwright helper writing load-check records (`artifacts/lane-store/<lane>/load-checks/<catalogSha>.json`) and `tests/browser/support/loadCheckRecords.ts`
- [ ] `recipes/world/oracle/20_20/expected.json` frozen before any world diff test (sky, environment and movers included)
- [ ] `scripts/check-machine-schedule.mjs` plus Playwright `globalSetup`
- [ ] `tests/fixtures/world-07/` copied after the binary-field scan

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Staging lane outputs into the shared store `public\l2` | INT-01 | Store writers run only in the main checkout by the integration thread (owner rule) | Run the merge command the coverage report prints, in the main checkout, outside machine windows; then re-run the load sweeps against the shared store |
| Side-by-side checks against L2.exe on IMPORTA-PC | all parts (Phase 3) | Needs the native client running on IMPORTA-PC | Phase 3 (CHECK-01..05) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 300s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
