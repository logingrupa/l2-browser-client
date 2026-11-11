---
phase: "03"
slug: "stage-a-checks"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-11"
---

# Phase 03 - Validation strategy

> Per-phase validation contract for feedback sampling during execution. Source: 03-RESEARCH.md "Validation Architecture"; task ids follow 03-PLAN-INDEX.md.

---

## Test infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Python 3.12 unittest through `scripts/test_pipeline.py`; Vitest 5.1.0; Playwright 1.64.1 (SwiftShader WebGPU, `workers: 1`) |
| **Config file** | `vitest.config.ts` (`tests/unit/**/*.test.ts`, `maxWorkers: "50%"`), `playwright.config.ts` (`webServer: pnpm dev`, port `DEV_PORT` or 5173) |
| **Quick run command** | `python -B -m unittest discover -s tests/pipeline -p "<file>.py" -v`; `pnpm vitest run tests/unit/<file>.test.ts`; `pnpm typecheck` |
| **Full suite command** | `pnpm typecheck && pnpm test:unit && python scripts/test_pipeline.py` (once per machine at a time; run at the phase gate in 03-17) |
| **Estimated runtime** | targeted files under 30 seconds; full suites several minutes; sweeps and capture slices are long resumable runs, not feedback checks |

---

## Sampling rate

- **Every run:** starts with `node scripts/check-machine-schedule.mjs &&`.
- **After every task commit:** the targeted command in the task's `<verify>`, plus `pnpm typecheck` for TypeScript changes.
- **After every plan:** `python scripts/test_pipeline.py` for Python plans, the plan's Vitest files for TypeScript plans, and `node scripts/check-lane-ownership.mjs --base <plan or task start> --part <slug>`.
- **Before `/gsd-verify-work`:** the full suite in 03-17 is green, the final union has complete load records, and the generated report is balanced with no stale-after-fix.
- **Max feedback latency:** 60 seconds for targeted checks.

---

## Per-task verification map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure behavior | Test type | Automated command | File exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | CHECK-03 | T-03-02 | record paths confined; strict decode | pipeline | `python -B -m unittest discover -s tests/pipeline -p "test_side_by_side_check_records.py" -v` | W0 | pending |
| 03-01-02 | 01 | 1 | CHECK-01 | - | digest moves only with the key's content | pipeline | `python -B -m unittest discover -s tests/pipeline -p "test_side_by_side_key_digest.py" -v` | W0 | pending |
| 03-01-03 | 01 | 1 | CHECK-02, CHECK-03 | T-03-01 | no pass without both halves and an independent reviewer; audio owner-only | pipeline | `python -B -m unittest discover -s tests/pipeline -p "test_side_by_side_*.py" -v` | W0 | pending |
| 03-02-01 | 02 | 1 | CHECK-01 | T-03-04 | hour only through the adapter event | unit | `pnpm vitest run tests/unit/nativeSliceSetEnvironment.test.ts tests/unit/gameWorldAdapterContract.test.ts` | W0 | pending |
| 03-02-02 | 02 | 1 | CHECK-01 | T-03-05 | out-of-limit pose refused, camera unchanged | unit, e2e | `pnpm vitest run tests/unit/nativeSliceCameraPose.test.ts` and `pnpm test:e2e tests/browser/nativeSliceFraming.spec.ts` | W0 | pending |
| 03-18-01 | 18 | 2 | CHECK-04, CHECK-01 | T-03-37 | diagnostic list read from the material's own inspect values | e2e | `pnpm test:e2e tests/browser/nativeSliceDiagnosticMaterials.spec.ts` | W0 | pending |
| 03-18-02 | 18 | 2 | CHECK-04 | T-03-37 | only disabled or invisible meshes and compiled materials left out | unit | `pnpm vitest run tests/unit/visibleDiagnosticMaterials.test.ts` | W0 | pending |
| 03-03-01 | 03 | 1 | CHECK-01 | T-03-06 | selected keys validated | unit, e2e | `pnpm vitest run tests/unit/loadCheckRecords.test.ts` | yes | pending |
| 03-03-02/03 | 03 | 1 | CHECK-05 | T-03-07 | union loads only on the union catalog | command | pending-count command in 03-03 context prints 0 per kind | n/a | pending |
| 03-04-01 | 04 | 2 | CHECK-01 | T-03-08 | ingest re-hashes and refuses stale digests | pipeline | `python -B -m unittest discover -s tests/pipeline -p "test_record_side_by_side_checks.py" -v` | W0 | pending |
| 03-04-02 | 04 | 2 | CHECK-01 | T-03-09 | selection data from decoded tables only | pipeline | `python -B -m unittest discover -s tests/pipeline -p "test_pair_queue.py" -v` | W0 | pending |
| 03-04-03 | 04 | 2 | CHECK-02, CHECK-03 | T-03-10 | judge refuses capturer as reviewer and agent audio verdicts | pipeline | `python -B -m unittest discover -s tests/pipeline -p "test_record_side_by_side_checks.py" -v` | W0 | pending |
| 03-05-01/02 | 05 | 2 | CHECK-05 | T-03-11 | unbalanced report refused; reference from the lock | pipeline | `python -B -m unittest discover -s tests/pipeline -p "test_coverage_report.py" -v` | yes (extend) | pending |
| 03-05-03 | 05 | 2 | CHECK-05 | T-03-12 | schema 2 exact fields | unit | `pnpm vitest run tests/unit/readNativeCoverage.test.ts tests/unit/nativeCatalogIndexCoverage.test.ts` | yes (extend) | pending |
| 03-06-01/02 | 06 | 2 | CHECK-01 | T-03-13, T-03-15, T-03-16, T-03-17 | encoded remote input; confined writes; preflight refusals; task cleanup | pipeline | `python -B -m unittest discover -s tests/pipeline -p "test_native_capture_driver.py" -v` | W0 | pending |
| 03-06-03 | 06 | 2 | CHECK-01, CHECK-02 | T-03-14 | re-hash after scp; lock tie | pipeline | `python -B -m unittest discover -s tests/pipeline -p "test_import_native_captures.py" -v` | W0 | pending |
| 03-07-01/02 | 07 | 3 | CHECK-01, CHECK-03 | T-03-18, T-03-19 | receipts re-validated on ingest | unit, e2e | `pnpm vitest run tests/unit/sandboxHalfCaptures.test.ts`; windows slice | W0 | pending |
| 03-08-01/02 | 08 | 4 | CHECK-01, CHECK-03 | T-03-20 | no invented pose | e2e, command | tiles and minimap slices; record check in 03-08 | W0 | pending |
| 03-09-01..03 | 09 | 4 | CHECK-01, CHECK-03 | T-03-21 | npc selection carries expected mesh text | e2e, command | npcs, items, skills slices; record checks in 03-09 | W0 | pending |
| 03-10-01/02 | 10 | 5 | CHECK-02, CHECK-03 | T-03-23, T-03-24 | audio records only listen-needs-owner | unit, e2e | `pnpm vitest run tests/unit/audioClipCaptures.test.ts`; audio slice | W0 | pending |
| 03-11-01/02 | 11 | 6 | CHECK-04 | T-03-25 | unknown findings stay unrouted | pipeline | `python -B -m unittest discover -s tests/pipeline -p "test_list_check_defects.py" -v` | W0 | pending |
| 03-12-01..03 | 12 | 7 | CHECK-04 | T-03-26, T-03-27 | fixes only in shared steps, failing-first tests | pipeline | world step tests per 03-12 verify; `python scripts/test_pipeline.py` | per fix | pending |
| 03-13-01..03 | 13 | 8 | CHECK-04 | T-03-28, T-03-29 | same, actors | pipeline | actors step tests per 03-13 verify | per fix | pending |
| 03-14-01/02 | 14 | 9 | CHECK-04 | T-03-30, T-03-31 | same, data-ui | pipeline | `test_convert_tables.py`, `test_ui_texture_step.py`, `test_gap_*.py` | per fix | pending |
| 03-15-01..03 | 15 | 10 | CHECK-05 | T-03-32, T-03-33 | report generated, balanced, tied to the lock | command | report command and the balance check in 03-15 | n/a | pending |
| 03-16-01/02 | 16 | 11 | CHECK-03 | T-03-34 | world-lane block counts equal the report; exactly three `##` headings | unit, command | `pnpm vitest run tests/unit/laneOwnership.test.ts` and the stage A block gate in 03-16 | yes | pending |
| 03-19-01..03 | 19 | 11 | CHECK-03 | T-03-38 | actors-lane block counts equal the report; audio waits for the owner's listen batch | unit, command | `pnpm vitest run tests/unit/laneOwnership.test.ts` and the stage A block gate in 03-19 | yes | pending |
| 03-20-01/02 | 20 | 11 | CHECK-03 | T-03-39 | data-ui block counts equal the report; table verdicts only through displaying pairs | unit, command | `pnpm vitest run tests/unit/laneOwnership.test.ts` and the stage A block gate in 03-20 | yes | pending |
| 03-17-01..03 | 17 | 12 | CHECK-01, CHECK-02, CHECK-03 | T-03-35, T-03-36 | owner lines start with the refusing preflight | command, full suite | `pnpm typecheck && pnpm test:unit && python scripts/test_pipeline.py` | n/a | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 requirements

- [ ] `tests/pipeline/side_by_side_fixture.py`: synthetic union store, records and receipts (03-01, extended in 03-04)
- [ ] `tests/pipeline/test_side_by_side_check_records.py`, `test_side_by_side_key_digest.py` (03-01)
- [ ] `tests/pipeline/test_pair_queue.py`, `test_record_side_by_side_checks.py` (03-04)
- [ ] `tests/pipeline/native_capture_transcript_fixture.py`, `test_native_capture_driver.py`, `test_import_native_captures.py` (03-06; synthetic transcripts, no L2 bytes)
- [ ] `tests/unit/nativeSliceSetEnvironment.test.ts`, `nativeSliceCameraPose.test.ts`, `tests/browser/nativeSliceFraming.spec.ts` (03-02)
- [ ] `tests/unit/visibleDiagnosticMaterials.test.ts`, `tests/browser/nativeSliceDiagnosticMaterials.spec.ts` (03-18)
- [ ] `tests/unit/sandboxHalfCaptures.test.ts` (03-07), `tests/unit/audioClipCaptures.test.ts` (03-10), `tests/pipeline/test_list_check_defects.py` (03-11)
- [ ] Extend `tests/pipeline/test_coverage_report.py` and `tests/unit/readNativeCoverage.test.ts` for schema 2 (03-05)
- No framework install is needed.

---

## Manual-only verifications

| Behavior | Requirement | Why manual | Test instructions |
|----------|-------------|------------|-------------------|
| Native halves for the offline Debug batch (tile 20_20 startup, nv npcs, pv items, sv skills) | CHECK-01 | Needs the owner's go-ahead and a free session 1 on IMPORTA-PC; Phase 3 starts no L2.exe (P7) | STATE line `Needs Human (plan 03-17, offline Debug batch)`: preflight, driver capture per batch, import, fresh reviewer judge, cleanup check |
| Native halves for windows, the minimap, other tiles and server-route items | CHECK-01 | Needs the Phase 4 stock Mobius server | STATE line `Needs Human (plan 03-17, server batch)`; re-opens as a Phase 3 follow-up once Mobius runs |
| Listen verdicts for world, actor and skill audio | CHECK-02 | Needs the owner's ears; no tool records L2.exe audio | STATE line `Needs Human (plan 03-17, listen batch)`: clip folder and the owner-only judge command |
| Main-checkout restage of the final union | CHECK-04 follow-through | Only the integration thread in the main checkout may write `public/l2` | STATE line `Needs Human (plan 03-17, restage)` |

---

## Phase verification outcome

By P7 no plan in this phase starts L2.exe or captures a native half, so ROADMAP Phase 3 success criteria 1 and 2 cannot hold inside the phase (P16, plan-check revision 1, planning row P43).

| Criterion | Status the phase verification reports | Evidence or closing step |
|-----------|----------------------------------------|--------------------------|
| SC1 paired screenshots | human_needed | STATE lines `Needs Human (plan 03-17, offline Debug batch)` and `Needs Human (plan 03-17, server batch)`; every pair record stays unverified until then |
| SC2 listen checks | human_needed | STATE line `Needs Human (plan 03-17, listen batch)`; every audio record stays `listen-needs-owner` until then |
| SC3 fixes or gaps | verified | the 03-12 to 03-14 pipeline tests and re-run records |
| SC4 exit report | verified | `docs/coverage.md` "Stage A exit" from 03-15 and the 03-05 report tests |

- `03-VERIFICATION.md` reports status human_needed, lists SC1 and SC2 as human_needed with the lines above as its human verification items, and never reports either as passed.
- Stage A is not yet proven while SC1 and SC2 are human_needed: Phase 4 may proceed, because its stock Mobius server closes the server batch; Phase 5, which depends on Phase 3 stage A complete, waits for the three sessions. 03-17 writes both facts into STATE.

---

## Validation sign-off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency under 60 s for targeted checks
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
