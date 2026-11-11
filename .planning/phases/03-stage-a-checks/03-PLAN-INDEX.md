# Phase 3: Stage A checks - plan index

Planned 2026-11-11 (autonomous; the owner is away), revised once after the plan check (18 plans in 12 waves). Binding inputs: `03-CONTEXT.md` (P1 to P20), the research refinements P21 to P23 and the planning rows P24 to P44 in `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md` (all provisional, owner review). Every plan reads this file; its rules and definitions are part of each plan.

## Plans and waves

| Wave | Plan | Lane, `--part` | Objective | Requirements |
| --- | --- | --- | --- | --- |
| 1 | 03-01 | integration, adapter-dispatch | Check record module and key content digest; names the Phase 3 start commit | CHECK-01, CHECK-02, CHECK-03 |
| 1 | 03-02 | integration, adapter-dispatch | `set-environment` sandbox command and camera pose setter | CHECK-01 |
| 1 | 03-03 | integration, adapter-dispatch | Union currency, key-list sweep selector, full union load sweeps | CHECK-01, CHECK-05 |
| 2 | 03-04 | integration, adapter-dispatch | Pair queue and the record writer CLI (queue, ingest, judge) | CHECK-01, CHECK-02, CHECK-03 |
| 2 | 03-05 | integration then actors | Stage A exit report on the coverage owner, schema 2, TS reader | CHECK-05 |
| 2 | 03-06 | integration, adapter-dispatch | Native capture driver and import, transcript-tested, never run against IMPORTA | CHECK-01, CHECK-02 |
| 2 | 03-18 | integration, adapter-dispatch | Visible diagnostic materials in the `__nativeSlice` snapshot (split from 03-02 in revision 1, P44; after 03-02 because both edit `nativeSliceDiagnostics.ts`) | CHECK-01, CHECK-04 |
| 3 | 03-07 | data-ui, ui | Sandbox-half slice runner, windows spec, all queued window halves | CHECK-01, CHECK-03 |
| 4 | 03-08 | world, world | Tile and minimap halves | CHECK-01, CHECK-03 |
| 4 | 03-09 | actors, npcs | NPC, item and skill halves | CHECK-01, CHECK-03 |
| 5 | 03-10 | actors, audio | Labelled audio clips for queued keys | CHECK-02, CHECK-03 |
| 6 | 03-11 | integration, adapter-dispatch | Defect list from the halves and the union loads | CHECK-04 |
| 7 | 03-12 | world, world | World converter fixes and the re-run chain | CHECK-04 |
| 8 | 03-13 | actors, npcs | Actors converter fixes and the re-run chain | CHECK-04 |
| 9 | 03-14 | data-ui, ui | Data and UI converter fixes and the re-run chain | CHECK-04 |
| 10 | 03-15 | integration, adapter-dispatch | Final union sweeps and the generated stage A exit report | CHECK-05 |
| 11 | 03-16 | world, actors, data-ui (one task each) | Stage A check sections in the lane EVIDENCE docs | CHECK-03 |
| 12 | 03-17 | integration, adapter-dispatch | Needs Human session lines, VERIFICATION Open, STATUS, adapter-dispatch evidence | CHECK-01, CHECK-02, CHECK-03 |

The fix plans 03-12, 03-13 and 03-14 are chained because each rebuilds the integration union. Waves state dependencies; execution stays one sequential executor (rule 1). 03-08 and 03-09 depend on 03-18 as well as 03-07, because their sandbox halves record `diagnosticMaterials`.

Phase exit (P16, P43): by P7 no plan captures a native half, so ROADMAP Phase 3 success criteria 1 and 2 stay human_needed until the offline Debug, server and listen sessions of 03-17 run. 03-17 and the phase verification report them human_needed with those Needs Human lines, never passed; the phase closes human_needed with Stage A not yet proven. Phase 4 may proceed (its server closes the server batch); Phase 5, which depends on Phase 3 stage A complete, waits for the three sessions.

## Rules every plan carries

1. One sequential executor in this worktree (`C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap`), branch `plan/autonomous-roadmap`. Commit only; never push or merge. Stage paths by name; never `git add -A`, `git stash`, `git reset` or `git checkout`. If git reports `index.lock` exists, wait 15 seconds and retry, at most 6 times. Commit messages are plain prose with plain hyphens and carry no attribution line of any kind.
2. The owner is away. Never ask and never wait. Where a choice is needed take the Recommended option, else the most reversible one, and append a row `| P<n> | <YYYY-MM-DD HH:MM Riga> | <question> | <choice> | <reason> |` to `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md`, numbering after the last P row. New requirements are marked "provisional, owner review". Reversibility ratings add no checkpoint.
3. Every run starts with `node scripts/check-machine-schedule.mjs &&`. Exit 2 means a machine window: stop cleanly, record it, resume later; never sleep or poll. Heavy runs (sweeps, captures, converter steps, union rebuilds, reports) run at BelowNormal through `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py <command ...>`.
4. Browser runs: before `pnpm test:e2e`, `netstat -ano | grep LISTENING | grep -E ':5173 '` must print nothing; otherwise the slice is recorded "unverified: port 5173 busy" with the netstat line and that process is left alone. A manual dev server uses port 5175. Only one full `pnpm test:unit` per machine at a time; plans run targeted Vitest files. Headless SwiftShader FPS is never a measurement.
5. Never run `assets:*`, `assets:stage`, `world:stage`, `stage_*`, `derive-*`, `migrate-*`, preview scripts or `merge_lane_store.py`, and never write `public/l2` or the main checkout. Lane stores under `artifacts/lane-store/<lane>/` and the integration union are written here. The main-checkout restage stays the Needs Human command.
6. IMPORTA-PC is read-only (`ssh -p 2026 rolan@importa-pc.tail40ecb2.ts.net`, `-o BatchMode=yes`): hashes, listings and process queries only. Phase 3 starts no L2.exe, registers no scheduled task, injects no input and changes no profile, `LocalMap` or audio routing there, and no T3 agent drives it (P7). No native half is ever faked or borrowed; the 2026-11-05 captures are background only.
7. Code rules (AGENTS.md): no comments of any kind, docstrings included; when a file is touched, every comment in the whole file goes and what it explained is renamed into the code. Full-word names, files under about 400 lines, no dead code, no speculative options, TypeScript strict with no `any`, pnpm only. Every behaviour change ships with a Vitest or pipeline test; UI-affecting changes also get a Playwright check. Never invent a Lineage II value; every value comes from the reference client through a pinned recipe, script or decoded table.
8. Record the plan start with `git rev-parse HEAD` before Task 1. Before each docs commit run `node scripts/check-lane-ownership.mjs --base <base> --part <slug>`; a plan that writes files of several lanes runs the check at the end of each task with that task's start commit as base, before the next task commits.
9. Docs use plain hyphens and sentence-case headings. EVIDENCE.md stays under 30,720 bytes with exactly the headings `## Passes now`, `## Open` and `## Evidence`. STATUS.md stays one line per part, rewritten in place.
10. The last task of every plan stops what the plan started (Playwright `webServer`, browsers, Vitest workers, Python runs, ssh) by PID or by a command line holding this worktree path or port 5173 or 5175, never by image name, and confirms no listener remains on 5173 or 5175.

## Shared definitions

### Check record document (P12, P21, P23)

`docs/parts/<part>/side-by-side-checks.json`, written only by `scripts/native_store/side_by_side_check_records.py` through `canonical_json_bytes` and `replace_file`: `{schemaVersion: 1, part, records}`. Records are sorted by their identity: `key` for every part except audio, and `(key, role, sourceSha256)` for audio.

A record holds exactly:
- `key` (a catalog key, `is_catalog_key`), `verdict` (`pass`, `mismatch`, `unverified`) and `reason` (null for pass and mismatch, else a stored reason);
- `nativeSelection` (object per kind, below);
- `sandboxHalf` (below; required) and `nativeHalf` (below, or null);
- `difference` and `suspectedStep` (strings for mismatch, null otherwise);
- `reviewer` and `judgedAtRiga` (null unless judged);
- `sandboxHalfHistory` (list of earlier `{pngSha256, keyContentSha256, capturedAtRiga}`, oldest first; P18);
- `displayedTableRows` (sorted list of `{tableKey, rowIds}` the sandbox page reported it displayed; empty when it reported none).
Audio records add `role` (`ambience`, `placement`, `music`, `voice`, `combat`, `skill`), `sourcePackage`, `sourceObject` and `sourceSha256`, and their sandbox half is a clip.

`sandboxHalf`: `catalogSha256`, `keyContentSha256`, `pngPath` (repository-relative under `artifacts/side-by-side/<part>/sandbox/`), `pngSha256`, `viewport {width, height}`, `cameraPose {target [x, y, z], alpha, beta, radius}` or null, `environment {gameMinutes, environmentType, source}` or null, `diagnosticMaterials` (sorted list of `{root, unportedClass, reasons}`; null only for window keys, P33), `capturedBy` and `capturedAtRiga`. An audio sandbox half has `clipPath` and `clipSha256` under `artifacts/side-by-side/audio/clips/`, `durationSeconds` and `peakAboveZero` instead of the PNG, viewport, pose and diagnostics fields.

`nativeHalf`: `referenceTreeLockSha256` (from `reference_client_build(lock)`, never the raw lock file hash), `receiptPath`, `receiptSha256`, `pngSha256`, `windowSize {width, height}`, `l2IniSha256Before`, `l2IniSha256After`, `controllerSha256`, `controlDocumentSha256`, `capturedBy` and `capturedAtRiga`.

Identities (P39): `capturedBy` is `executor:03-NN` for this phase's plans; `reviewer` is `reviewer:<fresh agent id>` or `owner`. The writer refuses a reviewer equal to either half's `capturedBy`.

### Reasons (P1, P25)

- Stored by the writer: `native-session-needs-owner`, `native-needs-server`, `listen-needs-owner`, `native-selection-unconfirmed`, `framing-not-comparable`, `reviewer-uncertain`, and `review-pending` (both halves present, no reviewer verdict yet; added by planning row P41, never a pass).
- Computed by the report only, never stored: `sandbox-capture-failed` (planning row P42), `loads-failed`, `loads-unrecorded`, `stale-after-fix`, `not-yet-queued`, `no-pair-shows-table`.
- Report precedence for a converted key: a judged record (pass or mismatch) on the current key content digest counts as checked; else `stale-after-fix` when a record exists with another digest; else the record's stored reason; else `sandbox-capture-failed` when the key has no record and a capture failure file holds its current digest; else `loads-failed` when the union load record failed; else `loads-unrecorded` when the union catalog has no load record for the key; else `not-yet-queued`.
- Tables (P32): a `table:` key takes mismatch if any record lists it in `displayedTableRows` with verdict mismatch, else pass if any such record is pass, else unverified with the reason of the first such record in key order; no such record gives `no-pair-shows-table`.
- Audio (P4, P31): agents write only `unverified` `listen-needs-owner`; the writer accepts an audio pass or mismatch only with reviewer `owner`.

### Key content digest (P21)

`scripts/native_store/side_by_side_key_digest.py`: for `tile:`, `window:` and `table:` keys the digest is the one catalog record's `manifestSha256`; for every other key it is the SHA-256 of `canonical_json_bytes` of the sorted list of `{slice, id, pins}` over every union catalog record `catalog_index_keys` attributes to the key, where `pins` holds that record's `manifestSha256`, `archiveSha256`, `modelSha256` or `imageSha256` fields, plus the joined profile object for `npc:` and `character:` keys.

### Queue (P5, P26 to P28, P36)

`scripts/side_by_side/build_pair_queue.py` writes the ignored `artifacts/side-by-side/queue/<catalogSha256>.json`. Eligible keys are converted union keys with a load `pass` record on that union catalog SHA-256 and not a census gap. Order per kind:
1. Waiting keys of Phase 2 (rule names fixed): `npc-texture-slot` = the lowest `npc:` id whose joined profile lists two or more texture names (`docs/parts/npcs/EVIDENCE.md:18`); `ptds-3` and `ptds-6` = the lowest `skill:` key whose effect manifests hold a component with effective `DrawStyle` 3, respectively 6 (`docs/parts/skills-effects/EVIDENCE.md:124`); `sky-20-20` = `tile:20_20` (`docs/NATIVE_SKY.md`); `minimap-projection` = `tile:20_20`, whose minimap half the tiles spec captures (`docs/parts/minimap/EVIDENCE.md:27`); `hair-4dd2` = the lowest converted `character:` key (none today: recorded with key null and its reason); `statuswnd` = `window:StatusWnd`. A rule whose key is not eligible is listed with key null and the reason.
2. One key per census class, in first-seen census order: `npc:` and `item:` by the `source.package` of the key's model records; `tile:` by the map `licensee` in `docs/parts/world/tile-census.json`; `skill:` by the sorted tuple of `components[].class` over the key's effect manifests; `window:` by the window `type` in `docs/parts/ui/interface-window-census.json`.
3. The rest in census order (the row order of the union `coverage.json`), up to 25 keys per kind in Phase 3 (P28); later slices continue with the same command.
Minimap entries (P37): every queued `tile:` key whose tile manifest pins a `minimap` resource also gets one entry with part `minimap` and the same key, ordered right after its tile entry; minimap records live in `docs/parts/minimap/side-by-side-checks.json`, keyed by the tile key, with session kind `server`.
Each entry holds `order`, `key`, `part`, `step` (`waiting`, `class`, `census`), `rule` or `classValue`, `keyContentSha256`, `nativeSelection` and `sessionKind` (`offline-debug`, `server`, `listen`). Session kind sets the stored reason: offline-debug gives `native-session-needs-owner`, server gives `native-needs-server`, listen gives `listen-needs-owner`. Offline-debug covers `tile:20_20` at its startup pose, `npc:` keys through `nv`, `skill:` keys through `sv` on the debug pawn, and `item:` keys whose converted model records include the race column of the debug male fighter pawn through `pv`; every other tile, item, window and minimap half is `server` (P2, P36).

`nativeSelection` per kind: tile `{route: "offline-debug-startup" | "server-world", map}`; npc `{viewer: "nv", searchText, expectedMeshText, expectedTextureTexts}` from the decoded `npcname-e` and the joined npcgrp profile; item `{viewer: "pv" | "server-world", itemId, expectedMeshTexts}`; skill `{viewer: "sv", skillId, level}`; window `{route: "server-world", window}`; minimap `{route: "server-world", window: <minimap window id>, map}`; audio `{route: "listen", role}`.

### Receipts and captures

A key whose capture throws gets a failure file `artifacts/side-by-side/<part>/failures/<key file name>.json` (`key`, `catalogSha256`, `keyContentSha256`, first error line, `atRiga`) instead of a receipt, and the slice continues; a failure for the current digest is skipped on resume, and 03-11 lists it as a defect (P42).

TS specs write ignored receipts `artifacts/side-by-side/<part>/receipts/<key file name>.json` (the sandbox half fields plus `key`, `part` and `displayedTableRows`) and images under `artifacts/side-by-side/<part>/sandbox/`. The key file name replaces `:` with `_`. Captures run at `desktopViewport` (1440 x 900) on `NATIVE_STORE_ROOT=integration`. `python -B scripts/side_by_side/record_side_by_side_checks.py ingest-sandbox-halves --part <part>` validates receipts, recomputes each key digest on the current union, derives `nativeSelection` and the stored reason from the key with the same pure functions the queue uses (`native_selection_for_key`, `session_kind_for_key` in `build_pair_queue.py`), and writes records; a digest that differs from the receipt is refused as a stale capture.

The re-run chain after a converter fix (P18) uses these steps in order: re-run the fixed step for its sealed units in the lane store, rewrite the lane catalog, rebuild the union, sweep the touched keys with `LOAD_CHECK_KEYS`, run `record_side_by_side_checks.py queue` on the new union, re-capture the touched keys with `SIDE_BY_SIDE_KEYS`, and ingest; the writer moves each replaced sandbox half into `sandboxHalfHistory`.

### Commands used across plans

- Union rebuild: `python -B scripts/native_store/write_lane_catalog.py --lane integration --union world --union actors --union data-ui`.
- Load sweep slice: `NATIVE_STORE_ROOT=integration LOAD_CHECK_KIND=<kind> LOAD_CHECK_LIMIT=<n> [LOAD_CHECK_KEYS=<key,key>] pnpm test:e2e tests/browser/load-sweep-<kind>.spec.ts`.
- Sandbox half slice: `NATIVE_STORE_ROOT=integration SIDE_BY_SIDE_KIND=<kind> SIDE_BY_SIDE_LIMIT=<n> SIDE_BY_SIDE_CAPTURED_BY=executor:03-NN [SIDE_BY_SIDE_KEYS=<key,key>] pnpm test:e2e tests/browser/side-by-side-<kind>.spec.ts`, then `python -B scripts/side_by_side/record_side_by_side_checks.py ingest-sandbox-halves --part <part> --store-root artifacts/lane-store/integration/l2`.
- Report: `python -B scripts/native_store/build_coverage_report.py --store-root artifacts/lane-store/integration/l2 --census-lanes world actors data-ui integration --markdown docs/coverage.md`.
- Targeted tests: `python -B -m unittest discover -s tests/pipeline -p "<file>.py" -v`; `pnpm vitest run tests/unit/<file>.test.ts`.

### Phase start (P34)

Phase 3 execution starts after the Phase 2 code review fix round has committed: `git log -1 --format=%H -- .planning/phases/02-stage-a-breadth/02-REVIEW-FIX.md` prints a SHA and `git status --porcelain --untracked-files=no -- src scripts tests` prints nothing. Plan 03-01 records `git rev-parse HEAD` at that point as the Phase 3 start commit in its SUMMARY.
