---
phase: 03-stage-a-checks
plan: 04
subsystem: adapter-dispatch
status: complete
tags: [python, side-by-side, pair-queue, check-records, stage-a]
requires:
  - phase: 03-stage-a-checks
    provides: side_by_side_check_records.py writer, side_by_side_key_digest.py, side_by_side_fixture.py (03-01)
provides:
  - build_pair_queue.py with build_pair_queue, write_pair_queue, queue_file_path, native_selection_for_key, session_kind_for_key
  - record_side_by_side_checks.py subcommands queue, ingest-sandbox-halves, ingest-audio-clips, judge
  - the ignored queue file artifacts/side-by-side/queue/<catalogSha256>.json with waitingRules and entries
  - the sandbox receipt and audio clip receipt shapes that 03-07 to 03-10 write
affects: [03-05, 03-06, 03-07, 03-08, 03-09, 03-10, 03-11, 03-15, 03-17]
actuals:
  tokens: 18400
  tasks: 3
  commits: 3
plan_head_before: bc4105bf7d328e83b2c98efbef4ae456305857da
plan_head_after: c06925401ac0e36db28054c4377d4423037b6e74
tech-stack:
  added: []
  patterns:
    - "Queue facts are read once per run from the union catalog, its pinned manifests and the committed census files; nothing is typed per key"
    - "Every CLI write goes through write_side_by_side_records, so a refusal leaves the record file byte-identical"
key-files:
  created:
    - scripts/side_by_side/build_pair_queue.py
    - scripts/side_by_side/pair_queue_union.py
    - scripts/side_by_side/pair_queue_key_facts.py
    - scripts/side_by_side/pair_queue_waiting_rules.py
    - scripts/side_by_side/side_by_side_receipts.py
    - scripts/side_by_side/audio_clip_receipts.py
    - scripts/side_by_side/side_by_side_judgements.py
    - scripts/side_by_side/record_side_by_side_checks.py
    - tests/pipeline/test_pair_queue.py
    - tests/pipeline/test_record_side_by_side_checks.py
  modified:
    - tests/pipeline/side_by_side_fixture.py
key-decisions:
  - "P1174 to P1183 appended to pending-decision-rows.md: census gap means coverage status gap or failed; waiting rules take the lowest eligible match else key null with candidate and reason; class values already queued count as covered; debug pawn column m_HumnFigh; npc and item expected texts from the decoded npcgrp, armorgrp and weapongrp selections; minimap window from the route radar function (NewRadarWnd); no coverage regenerate needed; audio receipt shape; ingest replacement rules; judge records only reviewer-uncertain among unverified reasons"
patterns-established:
  - "Specs write ignored receipts; only record_side_by_side_checks.py turns them into committed records"
requirements-completed: []
requirements-addressed: [CHECK-01, CHECK-02, CHECK-03]
duration: 47min
completed: 2026-11-14
---

# Phase 3 Plan 04: Pair queue and the side-by-side record CLI summary

**The pair queue is now a pure function of the union catalog, its union load records, the committed census files and the union coverage rows, and `record_side_by_side_checks.py` is the one route from sandbox receipts, audio clips and reviewer verdicts into the committed check records.**

## Performance

- Duration: about 47 min (2026-11-14 05:19 to 06:07 UTC, 07:19 to 08:07 Riga)
- Tasks: 3 of 3
- Files: 10 created, 1 modified
- Plan start commit (rule 8): `bc4105bf7d328e83b2c98efbef4ae456305857da`

## Accomplishments

- `build_pair_queue.py` admits converted union keys that are not a census gap and have a load `pass` on the union catalog SHA-256. Per kind it orders the seven waiting rules, then one key per class value not yet covered, then census order up to 25 more keys. A tile that pins a `minimap` resource gets a `minimap` entry right after it. Each entry holds `order`, `key`, `part`, `step`, `rule` or `classValue`, `keyContentSha256`, `nativeSelection` and `sessionKind`. The document also lists every waiting rule in `waitingRules` as `{rule, part, key, candidateKey, reason}`, plus `debugPawnArmorColumn`.
- Native selection comes only from decoded data:
  - npc: `searchText` from the union's decoded `npcname-e`, mesh and texture texts from the npcgrp selection of the joined model unit in `actor-unit-census.json`;
  - item: `pv` when a model record joins a weapon unit or an `m_HumnFigh` armor unit, else `server-world`, with mesh texts from those unit selections;
  - skill: id and level from the key;
  - tile: `offline-debug-startup` for `tile:20_20`, else `server-world`;
  - window: `server-world`;
  - minimap: the window named by the minimap route `radar.getLocInfo.function` (`NewRadarWnd`).
- `ingest-sandbox-halves` reads the receipts strictly, re-hashes the PNG, recomputes the key digest on the current union and refuses a mismatch as a stale capture. It then writes unverified records with the session kind's stored reason (or `review-pending` when a native half is stored).
- `ingest-audio-clips` writes one unverified `listen-needs-owner` record per `(key, role, sourceSha256)` receipt after re-hashing the clip.
- `judge` stamps `judgedAtRiga` from the machine schedule's `rigaTime` and writes only through the 03-01 writer. A pass without a native half, a capturer as reviewer and an audio pass from anyone but `owner` are refused, and the file stays byte-identical.

## Real union queue (catalog `e25d005ea7d2a3fe6275c4fe02bb8719f190cbeaaaca831ad341a10126012baf`)

The union `coverage.json` already carried this catalog SHA-256, so no regenerate ran (P1180). `python -B scripts/side_by_side/record_side_by_side_checks.py queue --store-root artifacts/lane-store/integration/l2` at BelowNormal exited 0 and printed:

```
{"catalogSha256": "e25d005ea7d2a3fe6275c4fe02bb8719f190cbeaaaca831ad341a10126012baf", "counts": {"npcs": {"census": 21, "class": 3, "waiting": 1}, "skills-effects": {"census": 2, "waiting": 1}, "ui": {"census": 1, "class": 1}}, "queueFile": "artifacts/side-by-side/queue/e25d005ea7d2a3fe6275c4fe02bb8719f190cbeaaaca831ad341a10126012baf.json"}
```

The queue file SHA-256 is `c7dc889de3a83b8fa1d9b32df681a4fdadf6afb7d2f2c4836ad740e3ff5a9b93`, the same on three runs. Every one of the 17,802 converted tile, window, npc, item and skill keys (plus 143 minimap selections) went through `session_kind_for_key`, `native_selection_for_key` and the class value with no refusal. The result: 10,649 skill, 5,177 npc, 1,528 item and 1 tile keys are `offline-debug`; 248 window, 142 tile and 57 item keys are `server`.

Waiting rules:

| Rule | Part | Key | Candidate | Reason |
| --- | --- | --- | --- | --- |
| npc-texture-slot | npcs | npc:12526 (Wind Strider, 2 textures) | npc:12526 | - |
| ptds-3 | skills-effects | skill:1012:1 | skill:1012:1 | - |
| ptds-6 | skills-effects | skill:1012:1 | skill:1012:1 | - |
| sky-20-20 | world | null | tile:20_20 | census-gap |
| minimap-projection | minimap | null | tile:20_20 | census-gap |
| hair-4dd2 | player-characters | null | null | no-matching-key |
| statuswnd | ui | null | window:StatusWnd | census-gap |

Eligibility, class values and entries per kind:

| Kind | Eligible | Not eligible | Class values | Waiting | Class | Census |
| --- | --- | --- | --- | --- | --- | --- |
| tile | 0 | 143 census-gap | 0 | 0 | 0 | 0 |
| window | 2 | 202 census-gap, 44 loads-unrecorded | 1 (Texture) | 0 | 1 (`window:BackDisable#1`) | 1 |
| npc | 25 | 5,152 loads-unrecorded | 4 (LineageMonsters, LineageNpcs, LineageMonsters2, LineageNPCs2) | 1 | 3 | 21 |
| item | 0 | 1,585 census-gap | 0 | 0 | 0 | 0 |
| skill | 3 | 10,058 census-gap, 588 loads-unrecorded | 1 (MeshEmitter and SpriteEmitter) | 1 | 0 | 2 |

The queue is small because union `e25d005e` holds load records for only the 150 keys of the pin-check slices, and because every tile and item row is a census gap (P1174). Both points are under Open follow-ups.

## Task commits

1. **Task 1: Tracer, window queue and sandbox ingest** - `28f3087`
2. **Task 2: Full queue order, census classes and native selection** - `8c96e93`
3. **Task 3: judge, ingest-audio-clips and refusals** - `c069254`

`git rev-list --count bc4105b..HEAD` measured 3.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_record_side_by_side_checks.py" -v`: 10 tests OK.
- `python -B -m unittest discover -s tests/pipeline -p "test_pair_queue.py" -v`: 8 tests OK. Each Task 2 behaviour bullet has a test: waiting rule order and null reasons, class step, census budget, gap and load exclusion and no player-characters entry, session kinds and native selection, the minimap entry right after its tile, a byte-identical queue file.
- `python -B -m unittest discover -s tests/pipeline -p "test_side_by_side_*.py"`: OK (03-01 writer and digest tests unchanged).
- `python scripts/test_pipeline.py` at BelowNormal, three runs:
  - run 1: 2,758 tests, 1 failure: the one-owner guard for `decode_strict_json`, which this plan's helper name broke and Task 3 fixed;
  - run 2: 1 error in `test_world_reader_licensees` (20_21, a truncated temporary actors JSON in `build_map_into_temporary_directory`), in a file this plan does not touch; the file passed 24 of 24 on its own;
  - run 3: `Ran 2758 tests in 608.382s`, `OK (skipped=56)`, exit 0.
- `node scripts/check-lane-ownership.mjs --base bc4105bf7d328e83b2c98efbef4ae456305857da --part adapter-dispatch`: `lane integration: 0 foreign paths`.
- `grep -v '^\s*$' scripts/side_by_side/*.py | grep -c "#"`: 0.
- `ls artifacts/side-by-side/queue/` shows `e25d005e....json`; `git status --short docs/parts` printed nothing, so no committed record was written.
- Reference overlap: no area in `tools/reference-overlap/overlapAreas.json` covers `scripts/side_by_side/**`, so no run applies.

## Decisions made

Rows P1174 to P1183 were appended to `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md` (03-PLAN-INDEX.md rule 2), all provisional, for owner review:

- census gap means a coverage status of gap or failed;
- a waiting rule takes its lowest eligible match, and when there is none it lists key null with the candidate and the reason;
- class values that a queued key already covers get no second entry;
- the debug pawn race column is `m_HumnFigh`;
- npc and item expected texts come from the decoded table selections;
- the minimap window comes from the route's radar function;
- coverage needed no regenerate;
- the audio receipt shape;
- the ingest replacement rules;
- judge stores only `reviewer-uncertain` among the unverified reasons.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] `validate_coverage_report` refuses a re-read coverage.json**
- **Found during:** Task 1 (the first real queue run exited 1)
- **Issue:** `canonical_json_bytes` sorts the `denominators` keys, so a coverage.json read back from disk fails the part order check (`coverage denominators must list measured parts in the order ...`).
- **Fix:** The queue checks the rows structurally (the exact coverage row fields and the catalog SHA-256) and does not call the validator. The validator is recorded as an open follow-up for 03-05, which owns the report.
- **Commit:** `28f3087`

**2. [Rule 1 - Bug] Duplicate owner of `decode_strict_json`**
- **Found during:** Task 3 (pipeline suite run 1)
- **Issue:** `scripts/side_by_side/pair_queue_union.py` defined a second top-level `decode_strict_json`, against the one-owner guard in `test_converter_output_guard.py`.
- **Fix:** Renamed it to `decode_strict_store_json`. It wraps the store's own `refuse_duplicate_json_keys` and `refuse_non_finite_json_number`, as `load_check_records.py` does.
- **Commit:** `c069254`

**3. [Code rules - file size and single responsibility] The queue split into five modules**
- `pair_queue_union.py` (union catalog, loads and coverage), `pair_queue_key_facts.py` (per-kind facts from manifests and census files), `pair_queue_waiting_rules.py` (the seven rules), `build_pair_queue.py` (order, native selection and session kind, as the index names), plus `side_by_side_receipts.py`, `audio_clip_receipts.py` and `side_by_side_judgements.py` behind the CLI. Each is under 240 lines.

**4. [Index wording] Minimap waiting entry**
- `minimap-projection` targets `(minimap, tile:20_20)`. That entry is the minimap follower of the `sky-20-20` tile entry, labelled with the `minimap-projection` rule, so no `(part, key)` pair is queued twice.

**5. [Requirements] CHECK-01, CHECK-02 and CHECK-03 are not marked complete**
- This plan builds the queue and the record CLI. No part has records yet, and the native halves wait for 03-17 and the server and listen sessions. The requirements stay open and are listed as addressed, as in 03-01.

## Known stubs

None.

## Needs Human

None.

## Open questions for the orchestrator

- The race and sex of the offline Debug pawn are not in any `verified-*.md`. The queue uses `m_HumnFigh` (P1177). The offline session confirms it through the `pv` mesh text.

## Open follow-ups

- Union load records on e25d005e (CHECK-01): only the 150 pin-check slice keys have union load records, so 5,152 npc, 588 skill and 44 window keys that are census pass stay `loads-unrecorded` and outside the queue. Unblocked by: the full union load sweeps on e25d005e (`NATIVE_STORE_ROOT=integration LOAD_CHECK_KIND=<kind> LOAD_CHECK_LIMIT=<pending> pnpm test:e2e tests/browser/load-sweep-<kind>.spec.ts`), then `record_side_by_side_checks.py queue` again.
- World and items have no eligible key (CHECK-01, P1174): every tile row is a census gap through the minimap step (`minimap-join-unresolved:radar-anchor`) and every item row through `equipment-slot-meaning-undecoded:<n>`. So `sky-20-20`, `minimap-projection` and `statuswnd` (`adapter-field-absent:mp`) have no key, and 03-08 and 03-09 get no tile or item entries. Unblocked by: the gap plans that close those reasons (03-22, 03-23, 03-30), or an owner decision that a key gapped only by a step the pair itself checks is still queued.
- Coverage report re-read (CHECK-05, 03-05): `validate_coverage_report` refuses a coverage.json read back from disk, because the canonical bytes sort `denominators`. Unblocked by: 03-05 comparing the denominator order after canonical sorting, or keeping it in a list.
- Intermittent world reader test (run 2 above): one run of `test_world_reader_licensees` read a truncated temporary actors JSON for 20_21. Unblocked by: the world lane checking that `build_map_into_temporary_directory` waits for its output before reading.

## Process cleanup

This plan started only Python processes: the unittest runs, five BelowNormal `record_side_by_side_checks.py queue` runs and three BelowNormal `scripts/test_pipeline.py` runs (wrapper PIDs 13260, 109524 and 140008). All of them exited. Afterwards no listener remained on 5173 or 5175, and `Get-CimInstance Win32_Process` found no python, node or browser process with this worktree path in its command line; only the bash and powershell of the check itself matched. No dev server, Playwright, browser, Vitest or ssh process was started.

## Self-check: PASSED

- FOUND: scripts/side_by_side/build_pair_queue.py, pair_queue_union.py, pair_queue_key_facts.py, pair_queue_waiting_rules.py, side_by_side_receipts.py, audio_clip_receipts.py, side_by_side_judgements.py, record_side_by_side_checks.py, tests/pipeline/test_pair_queue.py, tests/pipeline/test_record_side_by_side_checks.py
- FOUND: 28f3087, 8c96e93, c069254 (ancestors of HEAD)
