---
phase: 03-stage-a-checks
plan: 06
subsystem: side-by-side
tags: [python, powershell, ssh, native-capture, importa-pc, stage-a]
requires:
  - phase: 03-stage-a-checks
    provides: side_by_side_check_records.py (03-01), the pair queue and its native selection rules (03-04)
provides:
  - native_capture_driver.py, the integration-owned batch selection, dry run, preflight and capture run with an injected command runner
  - native_capture_remote_programs.py, the PowerShell programs and the batch script, fed only base64 JSON through -EncodedCommand
  - native_capture_transcripts.py, the transcript and receipt checks against the controller pins and the hash lock
  - import_native_captures.py, the scp import that re-hashes every PNG and writes native halves through the one record writer
  - native_capture_transcript_fixture.py, synthetic remote transcripts and captured batch folders with no L2 bytes
affects: [03-17, 03-15]
actuals:
  tokens: 23800
  tasks: 3
  commits: 3
plan_head_before: 86f99537a23958a7d087ad12f3ed9490d3fb1758
plan_head_after: 5626d8546ca86440fdef0b35017e25c268ceb91c
tech-stack:
  added: []
  patterns:
    - "Remote programs are constants; their only data is one base64 JSON document in the program header"
    - "A remote step that registers a task is followed by a task-removal step in a Python finally, and both prove the task gone"
key-files:
  created:
    - scripts/side_by_side/native_capture_driver.py
    - scripts/side_by_side/native_capture_remote_programs.py
    - scripts/side_by_side/native_capture_transcripts.py
    - scripts/side_by_side/import_native_captures.py
    - tests/pipeline/native_capture_transcript_fixture.py
    - tests/pipeline/test_native_capture_driver.py
    - tests/pipeline/test_import_native_captures.py
  modified:
    - scripts/native_store/side_by_side_check_records.py
    - scripts/side_by_side/build_pair_queue.py
    - scripts/side_by_side/side_by_side_receipts.py
    - tests/pipeline/side_by_side_fixture.py
    - tests/pipeline/test_record_side_by_side_checks.py
    - tests/pipeline/test_coverage_stage_a_exit.py
key-decisions:
  - "P1191 to P1202 appended to pending-decision-rows.md: review-pending for sv and startup pairs and native-selection-unconfirmed for nv and pv pairs through one rule; Engine.dll and the Debug profile hash come from the lock; the bot text stays l2-levelup-assistant, unverified; l2.exe and l2.bin both count as Lineage II clients; windowSize and clientSize from the State action; nv types the name and pv the item id with no added key; 120 s plus 30 s per key; receipt paths read from the uploaded batch input; a judged record is never replaced by an import; a repeated batch reuses its folder; task registration as in the 2026-11-05 launcher; capturedBy from --captured-by"
patterns-established:
  - "Native halves enter the records only through import_native_captures.py, after every PNG of the batch matches the SHA-256 computed on IMPORTA-PC"
requirements-completed: []
requirements-addressed: [CHECK-01, CHECK-02]
duration: 35min
completed: 2026-11-14
status: complete
---

# Phase 3 Plan 06: Native capture driver and import summary

**A committed driver turns the offline Debug owner session into one preflight, one capture command and one import command: it selects each nv, pv, sv or startup batch from the committed check records, refuses an unsafe IMPORTA-PC state, runs the batch through one temporary interactive task that it always removes, and lets a native half into the records only after every PNG re-hashes to the SHA-256 computed on IMPORTA-PC. Nothing ran against IMPORTA-PC except one read-only hash and process query.**

## Performance

- **Duration:** 35min
- **Started:** 2026-11-14T06:55:55Z
- **Completed:** 2026-11-14T07:30:06Z
- **Tasks:** 3 of 3
- **Files:** 7 created, 6 modified

## Accomplishments

- `native_capture_driver.py batch --batch <offline-debug-startup|nv|pv|sv> --dry-run` reads the records of world, npcs, items and skills-effects, keeps the keys with reason `native-session-needs-owner` whose `nativeSelection` names that viewer or route, and prints the batch id (viewer plus the first 12 hex of the SHA-256 of the sorted key list) and the six exact steps (preflight, prepare-capture-folder, two scp uploads, capture, task-removal) with no runner call. On the committed records today every batch is empty, for example `sv-37517e5f3dc6` with `"keys": []`.
- `preflight` refuses, one line each, on: `Control-L2.ps1` not `542b89cc...`, `CONTROL.md` not `acd93f64...`, an Engine.dll other than `reference_client_build(lock)['engineDllSha256']`, an `l2.exe` or `l2.bin` outside `C:\Lineage2-client` or with no readable path, a process whose path or command line holds `l2-levelup-assistant`, session 1 not `Active`, and an `l2.ini` other than the lock entry `connection-profiles/l2-Debug.ini`. When clear it prints the l2.ini hash.
- `capture --batch <viewer> --captured-by <executor:03-NN|owner>` runs the preflight, creates `captures/<batch>/` (deleting only a stale completion marker), uploads `batch-script.ps1` and `batch-input.json`, then registers one task `L2b-NativeCapture-<batch>` (user rolan, Interactive, Limited), starts it, waits for `batch-complete.json` within 120 s plus 30 s per key and unregisters it in the remote `finally`; a separate task-removal step runs in a Python `finally` and both report whether the task is gone. Every remote path is checked against `captures/<batch>/` before the first remote call.
- The batch script runs in session 1 and, per key, calls only `Control-L2.ps1` actions with record values: `State`, then `Command` (none for the startup capture), `PlaySkill -SkillId` for sv, `Keys` with the decoded name (nv) or item id (pv), then `Screenshot -ScreenshotPath captures/<batch>/<key file name>.png`. Its receipt holds key, part, viewer, batch id, capturedBy, the controller, CONTROL.md and Engine.dll SHA-256, l2.ini before and after, `windowSize` and `clientSize` from `State`, the action statuses, the capture method, the PNG path, the PNG SHA-256 computed on IMPORTA-PC and capturedAtRiga.
- The run fails, and prints both l2.ini hashes, on a task still registered after unregistering, an l2.ini that changed, a missing or malformed receipt, a receipt off the pins or the lock, or a batch that did not complete.
- `import_native_captures.py --batch <id>` copies `captures/<batch>` with `scp -r` into `artifacts/side-by-side/native-import/<batch>/`, requires a complete marker, validates every receipt, refuses the whole batch when any PNG is missing or differs from its receipt SHA-256, moves PNGs and receipts into `artifacts/side-by-side/<part>/native/` and writes each native half (current `referenceTreeLockSha256`, receipt path and SHA-256, PNG SHA-256, window size, l2.ini hashes, controller and document SHA-256, capturedBy, capturedAtRiga) through `write_side_by_side_records`. Records stay `unverified`: `native-selection-unconfirmed` for nv and pv, `review-pending` for sv and the startup tile. A second import of the same batch leaves the records byte-identical, and a judged record is never replaced.
- `reason_with_native_half` in `build_pair_queue.py` is the one rule for the reason a record carries once it has a native half; the sandbox re-ingest in `side_by_side_receipts.py` now uses it too, so a recaptured npc half keeps `native-selection-unconfirmed`.

## Read-only IMPORTA-PC query

One ssh query (`ssh -o BatchMode=yes -o ConnectTimeout=8 fleet-importa-pc powershell -NoProfile -NonInteractive -EncodedCommand ...`, read-only: file hashes, `Get-CimInstance Win32_Process`, `query session`), exit 0, at 2026-11-14 09:14:08 Riga:

```
host                   IMPORTA-PC
controllerSha256       542b89cc299dae3ac0d045d272d309f72936af8b39fab22ee1a57a6a24caeadc  (equals the pin)
controlDocumentSha256  acd93f64580261369a4f209c81cee7d48694d0299160467d844ec9c6a3137262  (equals the pin)
engineDllSha256        4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08  (equals the lock)
l2IniSha256            0809edc984352198212787d7be1393dc94a267d70cab8b502a4493e67c013801  (the LAN profile, not Debug e0e4a52e...)
clientProcesses        []   (no l2.exe or l2.bin runs)
levelupProcesses       []   (no process name or command line holds "levelup")
session 1              console  rolan  1  Active
```

So the pins hold, and the driver's preflight would refuse today on one line only: `system/l2.ini SHA-256 0809edc9... is not the Debug profile e0e4a52e...`. Switching the profile is part of the 03-17 session (DEC-OWN-13). The bot name stays unverified because no bot ran.

No driver command and no import ran against IMPORTA-PC in this plan.

## Task commits

1. **Task 1: Tracer - batch from committed records, dry run and preflight against synthetic transcripts** - `b198d30`
2. **Task 2: The capture run through one temporary interactive task, confined writes and receipts** - `8718923`
3. **Task 3: Import with re-hash, read-only pin check on IMPORTA, ownership check and cleanup** - `5626d85`

## Files created/modified

- `scripts/side_by_side/native_capture_driver.py` - batch selection, remote paths and inputs, the six steps, preflight run, capture run and the CLI (386 lines)
- `scripts/side_by_side/native_capture_remote_programs.py` - preflight, prepare-folder, capture and task-removal programs, the batch script, the base64 JSON header (131 lines)
- `scripts/side_by_side/native_capture_transcripts.py` - pins, preflight refusals, capture and removal transcript checks, receipt checks shared with the import (168 lines)
- `scripts/side_by_side/import_native_captures.py` - scp import, completion and receipt checks, re-hash, move and native halves (171 lines)
- `scripts/native_store/side_by_side_check_records.py` - `read_project_reference_client_lock` and `NATIVE_SELECTION_UNCONFIRMED_REASON`
- `scripts/side_by_side/build_pair_queue.py` - `reason_with_native_half`
- `scripts/side_by_side/side_by_side_receipts.py` - the re-ingest reason uses `reason_with_native_half`
- `tests/pipeline/native_capture_transcript_fixture.py` - fake runner, transcripts, synthetic records and captured batch folders
- `tests/pipeline/test_native_capture_driver.py` - 27 tests: batch, dry run, encoding, every refusal, the capture run
- `tests/pipeline/test_import_native_captures.py` - 8 tests: scp, native halves, reasons, re-hash refusal, lock refusal, l2.ini, incomplete batch, idempotence, judged records
- `tests/pipeline/side_by_side_fixture.py` - the synthetic lock records the Debug profile
- `tests/pipeline/test_record_side_by_side_checks.py` - two re-ingest reason tests
- `tests/pipeline/test_coverage_stage_a_exit.py` - reads the synthetic host counts from the fixture

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_native_capture_driver.py" -v`: 27 tests OK.
- `python -B -m unittest discover -s tests/pipeline -p "test_import_native_captures.py" -v`: 8 tests OK.
- `python -B scripts/side_by_side/native_capture_driver.py batch --batch sv --dry-run`: exit 0, one JSON line, `"keys": []`. The longest remote command (capture) is 7,664 characters.
- The four remote programs and the batch script parse without errors in the Windows PowerShell 5.1 parser on DATABASE-PC (`[System.Management.Automation.Language.Parser]::ParseInput`, nothing executed).
- The read-only preflight and task-removal programs ran locally on DATABASE-PC (preflight hashing repository files, removal of the absent task `L2b-NativeCapture-sv-000000000000`); their real output passed `validate_preflight_transcript` and `validate_task_removal_transcript`, the controller hash equalled `sha256sum AGENTS.md`, session 1 read `Active`, and empty, one-element and many-element process lists came out as JSON lists. No scheduled task was registered.
- `python scripts/test_pipeline.py` at BelowNormal: `Ran 2810 tests in 621.859s`, `OK (skipped=56)`, exit 0.
- `node scripts/check-lane-ownership.mjs --base 86f99537a23958a7d087ad12f3ed9490d3fb1758 --part adapter-dispatch`: `lane integration: 0 foreign paths`.
- `grep -c "#"` prints 0 for every file this plan created or touched (the one `#` in `test_coverage_stage_a_exit.py` is the `## Stage A exit` heading text in a byte string).
- `grep -c "EncodedCommand"`: 1 in `native_capture_driver.py`.
- Reference overlap: no area in `tools/reference-overlap/overlapAreas.json` covers `scripts/side_by_side/**`, so no run applies.

## Decisions made

Rows P1191 to P1202 were appended to `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md` (03-PLAN-INDEX.md rule 2), all provisional, owner review. The three the plan asked for: `review-pending` (P41) applied by the import for sv and startup pairs, with `native-selection-unconfirmed` for nv and pv (P1191); the Engine.dll lock tie and the Debug profile hash from the lock (P1192); the bot process name, not found running, kept as `l2-levelup-assistant` and unverified (P1193).

## Deviations from plan

### Auto-fixed issues

**1. [Rule 2 - correctness] Both Lineage II image names**
- **Found during:** Task 1
- **Issue:** The plan names `l2.exe`, but the 2026-11-05 `Control-L2.ps1` State and Screenshot results (main checkout ignored `artifacts/native-parity/reference-current/028-state.json` and `033-screenshot-result.json`, read only) show the reference client running as `C:\Lineage2-client\system\l2.bin`. A foreign client could run under either name.
- **Fix:** The preflight lists `l2.exe` and `l2.bin` and refuses any outside `C:\Lineage2-client` (P1194).

**2. [Rule 3 - blocking] State and Screenshot output fields**
- **Found during:** Task 2
- **Issue:** The window size must come from the State action, whose output fields the plan does not name.
- **Fix:** Read the recorded 2026-11-05 State and Screenshot outputs above (fields `window.width`, `window.height`, `client.width`, `client.height`, `captureMethod`, `ok`, `status`) instead of opening IMPORTA-PC. The receipt holds `windowSize` and `clientSize` (P1195).

**3. [Code rules - file size] Transcript and receipt checks in their own module**
- **Found during:** Task 2
- **Issue:** With the capture run the driver would have passed about 400 lines, and the import needs the same receipt checks.
- **Fix:** `native_capture_transcripts.py` holds the pins, the preflight refusals and the transcript and receipt checks; the driver and the import import it.
- **Commit:** `8718923`

**4. [Rule 1 - bug] Command length grew with the key count**
- **Found during:** Task 2
- **Issue:** Passing every receipt path in the capture program input would pass the 32,767-character Windows command line at about 70 keys.
- **Fix:** The capture program reads the receipt paths from the uploaded `batch-input.json` (P1198).
- **Commit:** `8718923`

**5. [Rule 2 - DRY] One rule for the reason beside a native half**
- **Found during:** Task 3
- **Issue:** The sandbox re-ingest set `review-pending` whenever a native half existed, which would turn an nv or pv pair imported as `native-selection-unconfirmed` into `review-pending` on its next sandbox capture.
- **Fix:** `reason_with_native_half` in `build_pair_queue.py` serves both the import and the re-ingest; two tests in `test_record_side_by_side_checks.py`.

**6. [Fixture] The synthetic lock records the Debug profile**
- **Found during:** Task 1
- **Issue:** The preflight reads the Debug profile hash from the lock, and the shared synthetic lock held only Engine.dll.
- **Fix:** `side_by_side_fixture.write_reference_client_lock` adds `connection-profiles/l2-Debug.ini`, `SYNTHETIC_IMPORTA_HOST` counts 2 files and 47 bytes, and the stage A reference test reads those counts from the fixture instead of the typed `1 files and 24 bytes`.
- **Commit:** `b198d30`

**7. [Requirements] CHECK-01 and CHECK-02 not marked complete**
- This plan builds and tests the native capture tooling; no native half exists yet and 03-17 runs the first batch. They stay open, listed as addressed.

## Known stubs

None.

## Open questions for the orchestrator

- Whether `nv` and `pv` need a key after the search text (for example Enter) to apply it is not in the verified facts or `CONTROL.md` as read; the batch types the text only and the reviewer judges the PNG (P1196). 03-17's input probe answers it.
- `sv` selects by skill ID only; levels of one skill get the same native capture. Whether the viewer can select a level is open for 03-17.

## Needs Human

None.

## Open follow-ups

- Native capture first live run (CHECK-01, 03-06, P1193 to P1197): the capture program and the batch script have run only against synthetic transcripts. Unverified on IMPORTA-PC: the bot process name, whether nv and pv apply the typed text without another key, and the time PlaySkill needs before the screenshot. Unblocked by: the 03-17 offline Debug batch through this driver.

## Process cleanup

This plan started Python unittest runs, the BelowNormal `scripts/test_pipeline.py` run (background task, exit 0 at 09:29 Riga), one read-only ssh query to IMPORTA-PC (exit 0, `subprocess.run` waited for it) and local `powershell` parser and read-only program runs; all exited. Afterwards `netstat -ano` showed no listener on 5173 or 5175, and `Get-CimInstance Win32_Process` showed no process with this worktree path in its command line. The one ssh.exe still listed was created at 09:29:58 Riga by another process, after this plan's only ssh had exited, and was left alone. No dev server, Playwright, browser, Vitest or scheduled task was started.

## Self-check: PASSED

- FOUND: scripts/side_by_side/native_capture_driver.py, native_capture_remote_programs.py, native_capture_transcripts.py, import_native_captures.py, tests/pipeline/native_capture_transcript_fixture.py, test_native_capture_driver.py, test_import_native_captures.py
- FOUND: b198d30, 8718923, 5626d85 (ancestors of HEAD)
