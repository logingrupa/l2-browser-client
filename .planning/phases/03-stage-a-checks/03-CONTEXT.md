# Phase 3: Stage A checks - Context

**Gathered:** 2026-11-11 (smart discuss, autonomous; the owner is away, so each grey area answer is the Recommended one, taken by the discuss agent and logged as pending decision rows P1 to P20 in `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md`, which move into `.planning/OVERNIGHT-DECISIONS.md` for owner review at the next replay)
**Status:** Ready for planning

<domain>
## Phase Boundary

Every converted part gets a recorded side-by-side check against L2.exe on IMPORTA-PC (`C:/Lineage2-client`, DEC-OWN-2), with a verdict of pass, mismatch or unverified; audio gets labelled listen-check clips; defects become shared converter fixes or listed gaps; and a stage A exit report, generated from data, states per part converted, loads, checked, pass, mismatch, unverified and gap counts tied to the hash lock. Requirements CHECK-01 to CHECK-05. The bar is DEC-OWN-3 (qualitative pairs); the fixed POL-01 and POL-02 thresholds stay Phase 5.

What this run can and cannot do:
- Unattended on DATABASE-PC (free all the time, heavy commands at BelowNormal): the sandbox half of every pair, union load sweeps, census and coverage, browser audio clips, the check records (all unverified until a native half exists), the native capture driver with its tests, the exit report, and converter fixes for defects these checks find.
- Agents on IMPORTA-PC (DEC-OWN-13, 2026-11-12, supersedes P7): agents launch the reference L2.exe in offline Debug mode through `Control-L2.ps1` and capture native halves. The owner's other client (`C:\Games\Reborn\Legacy`) may be stopped by its PID before a session. Offline Debug mode reaches only map 20_20 and the `sv`, `nv` and `pv` viewers; UI windows, the minimap, the HUD, other tiles and other classes need a game server, which is the stock Mobius of Phase 4; listen checks need the owner's ears.
- So Phase 3 captures the offline Debug native halves itself (03-17) and leaves only the server batch (Phase 4 Mobius) and the listen batch (the owner's ears) as unverified records plus exact Needs Human lines. Success criteria 1 and 2 stay human_needed until those two sessions run; no native half is ever faked or borrowed.

Execution constraints (carried from Phase 2, binding on every plan):
- Work only in this worktree on branch `plan/autonomous-roadmap`; commit on this branch only; no push or merge. Phase 3 execution starts after the Phase 2 code review fix round has committed, from a commit the first plan names.
- Lane stores under `artifacts/lane-store/<lane>/` (ignored) and the integration union are written here; the main-checkout restage stays the one Needs Human command; never run `assets:*`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*` or preview scripts against the main checkout or `public\l2`.
- IMPORTA-PC is read-only over `ssh -p 2026 rolan@importa-pc.tail40ecb2.ts.net` (hashes, listings, process queries); nothing is written inside `C:/Lineage2-client`.
- Dev server on port 5175; `pnpm test:e2e` on port 5173 only while nothing listens there; one full `pnpm test:unit` per machine at a time. Stop what a run started by PID or by a command line holding this worktree path or port, never by image name.

</domain>

<decisions>
## Implementation Decisions

### A. Verdict rules per part (CHECK-01, CHECK-02, CHECK-03)
- Verdicts (P1). **pass**: one check record joins a native half and a sandbox half of the same key. The native half is a capture of L2.exe on IMPORTA-PC under the current hash lock, with a receipt holding the lock reference, the SHA-256 of `system/l2.ini` before and after, the controller script SHA-256, the window size and the PNG SHA-256. The sandbox half is a capture from the served catalog with its catalog SHA-256 and the key's manifest SHA-256. An independent reviewer finds the same source content in both: the same meshes and silhouette, texture and colour per slot, animation clip or pose, effect components with matching shape, colour and rough timing, and for world the same terrain, BSP, static meshes and sky at the declared location. Differences the receipts explain by framing (window size, camera pose, hour, debug overlay, the patched `system/nwindow.dll` captions on IMPORTA) do not block a pass. **mismatch**: both halves exist and the reviewer names a content difference that framing does not explain (missing or extra geometry, wrong texture or slot, wrong tint, wrong clip, a missing or extra effect component, a magenta or unresolved diagnostic where L2.exe draws content); the record names the visible difference and the suspected converter step. **unverified**: everything else, always with one reason from a closed list, at least `native-session-needs-owner`, `native-needs-server`, `listen-needs-owner`, `native-selection-unconfirmed`, `framing-not-comparable`, `reviewer-uncertain`, `loads-failed`, `loads-unrecorded`, `stale-after-fix`, `not-yet-queued` and `no-pair-shows-table`. Planning may add a reason through a logged decision row, never a pass by default.
- What each part's pair shows and how the native key is selected (P2):
  - world `tile:XX_YY`: the same tile and location. Offline Debug reaches only 20_20 at its startup pose; the sandbox side is `?map=20_20` at the first enabled PlayerStart. Other tiles are `native-needs-server` unless the owner session finds a native map control. Both camera poses are recorded.
  - npcs `npc:<id>`: `nv` by English name from the decoded `npcname-e`. The pair counts only when the viewer's mesh and texture text equals the key's npcgrp row, else `native-selection-unconfirmed`, because names repeat (for example `field_stalker_m00` in 22 npcgrp rows).
  - items `item:<id>`: `pv` equip on the debug pawn against the sandbox equip on the same chargrp body, confirmed by the displayed mesh text.
  - player-characters `character:<n>`: the `pv` pawn; all 15 keys are gaps today, and gap keys never get pairs.
  - skills-effects `skill:<id>:<level>`: `sv` by skill ID on the debug pawn against the sandbox cast on the same body. Stage A judges component presence, shape, colour and rough timing. The five-repetition, 30 FPS particle metrics proposed in `.planning/reference/lineage2js/04-particles.md:473` are a reference note, not a decision; they stay POL-01 (DEC-OWN-3, STATE blocker on the 4.1 FPS capture).
  - ui `window:<Name>` and minimap: an in-world session at the same resolution, so `native-needs-server`.
  - data `table:<name>`: no picture of its own. A table counts as checked only through a recorded pair that shows text or an icon decoded from it (the pair lists the table keys and row IDs it displays), and takes that pair's verdict; otherwise `no-pair-shows-table`.
  - sandbox and movement-geodata: no stage A pair in Phase 3. The sandbox is the checking tool, and traversal against L2.exe is POL-03; the report states this as the reason.
- Who judges while the owner is away (P3): an independent fresh-context Claude reviewer that neither captured nor converted the pair reads both images and both receipts and gives one verdict with a one-line reason; uncertainty gives `reviewer-uncertain`. Every recorded pass and mismatch is provisional, owner review, and the owner may revoke any. The capturing agent never judges its own pair. Codex is out until 2026-11-12, so no Codex vote is planned.
- Audio (P4): the browser half is a labelled audible clip (through `window.__nativeSlice.captureAudio()` or the actor-audio harness) carrying the exact source identity (package, object, SHA-256), the owning key and the bundle role (ambience, placement, music, voice, combat, skill). No tool records L2.exe audio (`Record-L2.ps1` is video only), and a loopback route would change IMPORTA's audio routing, so every audio verdict stays unverified `listen-needs-owner` until the owner listens to the pair. No agent records an audio pass or mismatch from peaks, spectra or byte identity, and Phase 3 defines no audio tolerance (POL-02 owns tolerances; `recipes/native-audio.acceptance.json` stays unestablished).
- Which keys are paired (P5): the queue is every converted key with a load pass on the union catalog, ordered by a written rule. First come the keys Phase 2 left waiting for a pair (the npcgrp texture-slot rule, the PTDS 3 and 6 swatch, the sky on 20_20, the 4dd2 hair field meanings, the minimap projection, `window:StatusWnd`). Then one key per census class (package, licensee, emitter class, window type), so each converter path is covered once. Then the rest in census order. Converted keys not yet in the queue count as `not-yet-queued`. The queue lives in the committed check records (decision C1), never in a hand list.

### B. What runs unattended now and what waits for IMPORTA-PC
- Unattended now on DATABASE-PC (P6):
  - the union load sweeps continue per kind as resumable slices until every converted union key has a record (`NATIVE_STORE_ROOT=integration LOAD_CHECK_KIND=<kind> LOAD_CHECK_LIMIT=<n> pnpm test:e2e tests/browser/load-sweep-<kind>.spec.ts`);
  - sandbox halves for queued keys in queue order, one Playwright pair-capture spec per kind on the integration union, written as resumable slices;
  - labelled browser audio clips for the bound world, actor and skill bundles of queued keys;
  - census and `pnpm report:coverage` regenerated from the union;
  - check records written with their unverified reasons;
  - the native capture driver's unit tests and dry run;
  - the exit report;
  - converter fixes for defects these checks find (area D).
- L2.exe on IMPORTA-PC (P7, superseded by DEC-OWN-13 on 2026-11-12): agents may start the reference L2.exe, register the driver's temporary task, inject input and switch `system/l2.ini` to the Debug profile, and may use the T3 agent on environment 20b54a96. Another Lineage II client in session 1 is stopped by its PID, never by image name. The client trees stay read-only, and every session restores `system/l2.ini` and any profile it changed and stops the L2.exe it started.
- Native work by what it needs (P8):
  - A free session 1, no server: the offline Debug client on 20_20 gives the world 20_20 startup pose, NPC pairs through `nv`, item pairs through `pv`, skill pairs through `sv` and the debug male fighter pawn. That session first probes input delivery (End, Tab, viewer clicks, failed on 2026-11-05), `setres 1440x900x32w`, the PawnViewer Map and time controls, `nv` and `pv` search by ID, and the startup PlayerStart.
  - A server: stock Mobius on DATABASE-PC from Phase 4, with an account and a character. It is needed for UI windows, the minimap, the HUD, other tiles by walking or teleport, other races and classes, and in-world audio.
  - The owner's ears, or an owner-approved loopback route: every audio verdict.
  - The aCis 409 Docker stack and third-party servers (the PROMINENCE Bartz session) are not used for pairs. DEC-PORT-2 names Mobius, and DEC-OWN-2 puts every comparison on IMPORTA-PC.
- Recording deferred native checks (P9): each queued key has a check record with its sandbox half and an unverified reason (`native-session-needs-owner`, `native-needs-server` or `listen-needs-owner`), never a pass. STATE.md Needs Human gets one line per session kind (offline Debug batch, server batch, listen batch), not one per key, because the key list lives in the committed records. Each line holds:
  - the preflight: the owner closes the other client and the bot, a display is active, and the driver's preflight prints the l2.ini profile hash;
  - the exact driver command with its batch selector;
  - the import command that copies native PNGs back with SHA-256 and writes native halves into the records;
  - the reviewer step;
  - the cleanup check: temporary tasks unregistered, and the l2.ini hash the same before and after.
  `docs/VERIFICATION.md` "Open" and the part STATUS lines say the same in one line each.
- Native capture tooling (P10): a committed driver, integration-owned, in a folder outside the banned store-writer prefixes (for example `scripts/side_by_side/`; `stage_*` is banned). It:
  - generates the batch from the committed check records (keys and native selection);
  - pins IMPORTA's `C:/Lineage2-client-support/debug-control/Control-L2.ps1` and `CONTROL.md` by SHA-256 and refuses on drift;
  - refuses to start while a foreign L2.exe or the bot holds session 1;
  - drives captures through a temporary interactive scheduled task that it unregisters, writing only under `C:/Lineage2-client-support/debug-control/captures/`;
  - copies PNGs and receipts back into ignored `artifacts/side-by-side/`.
  Unit tests run it against recorded transcript fixtures with no L2 bytes; it is not run against IMPORTA in Phase 3. The 2026-11-05 captures in the main checkout predate the 2026-11-08 lock, carry no key and match no sandbox camera, so they are background only and never a native half.
- Sandbox framing (P11): sandbox halves at 1440 x 900 (the AGENTS.md desktop size) on headless SwiftShader WebGPU, which disqualifies only FPS claims. A spec-facing camera pose and hour setter on `window.__nativeSlice` lets a pair be re-framed to the native receipt. The owner session tries `setres 1440x900x32w` first; if the native window cannot be 1440 x 900, the sandbox half is re-captured unattended at the receipt's size. DEC-OWN-9 phone shots stay UI layout evidence, not pair halves.

### C. Check records and the stage A exit report (CHECK-03, CHECK-05)
- Where records live (P12): images and clips go in ignored `artifacts/side-by-side/<part>/` and are never committed (PROJECT.md out of scope). Per-key check records go in a committed `docs/parts/<part>/side-by-side-checks.json`, written only by one validated writer. Each record holds:
  - the key, verdict and reason;
  - the native selection;
  - the sandbox half: catalog SHA-256, key manifest SHA-256, path, SHA-256, viewport, camera pose and hour;
  - the native half or null: lock reference, receipt path and SHA-256, PNG SHA-256 and window size;
  - the reviewer and `judgedAtRiga`.
  Each part's EVIDENCE.md gets one short "Stage A check" section with the counts, the JSON link and the local capture folder. EVIDENCE.md stays under the 30,720-byte test limit; world, npcs, movement-geodata, skills-effects and adapter-dispatch are at 29,084 to 30,050 bytes, so those parts first move older detail to git history, as AGENTS.md allows.
- Keying and invalidation (P13): the sandbox half is keyed by the key's manifest SHA-256 in the served catalog. The native half is keyed by the lock reference and the native selection, so it stays valid across converter fixes. When the current catalog holds a different manifest SHA-256 for the key than its sandbox half, the verdict becomes `stale-after-fix` until a fresh sandbox half is captured and judged again. A re-lock makes every native half stale.
- How the exit report is produced (P14): the one owner `scripts/native_store/build_coverage_report.py` (`pnpm report:coverage`) is extended, with no parallel report. Per part it adds checked, pass, mismatch and unverified (with counts per reason) from the committed check records, joined to the census rows of the served catalog. It also adds a reference block from `reference_client_build(lock)` in `scripts/native_assets_lib/asset_manifest.py` (`referenceTreeLockSha256` `1957c968...`, which every committed census carries, and Engine.dll `4dd2f63c...`) plus the lock's IMPORTA file count (5,629). The report writes `coverage.json` and a "Stage A exit" table in `docs/coverage.md`. Column rules:
  - converted: the served union catalog lists the key;
  - loads: the load-check record on that catalog;
  - checked: a judged pair (pass or mismatch) on the key's current manifest SHA-256;
  - unverified: every converted key without a judged pair, by reason;
  - gap: census gap and failed rows;
  - pending: census pending.
  The validator refuses a report unless converted = checked + unverified and checked = pass + mismatch. Nothing is typed by hand, and a pipeline test runs it on synthetic fixtures.
- Parts with no committed denominator (P15): sandbox, audio, minimap and movement-geodata stay `unknown`, and the report states why. The audio census counts bound bundles, not keys. Minimap census keys would collide with world `tile:` keys. The sandbox is the tool, and movement-geodata has no census. Their check-record counts are still reported. No denominator is invented.
- Exit threshold and Phase 3 exit state (P16): the report states numbers only. How many gaps still count as stage A done stays the owner's call (STATE Blockers). Phase 3 verification is human_needed once the unattended scope is done: criteria 3 and 4 are verified by tests and the generated report, and criteria 1 and 2 wait for the native sessions. Phase 3 is not marked complete while native halves are missing. The server-dependent pairs need the Phase 4 Mobius server, so waiting for every pair before Phase 4 would deadlock. Phase 4 may proceed, and those pairs re-open as a Phase 3 follow-up once Mobius runs; the Needs Human server line says so.

### D. Converter fixes found by checks (CHECK-04)
- Fix route (P17): every defect a check finds is fixed in the owning shared converter step, with a pipeline test. Defects include a mismatch verdict, a load failure, and a magenta or unresolved diagnostic in a sandbox half. The owning steps are:
  - world: `scripts/world/convert_tile.py --step <step>` and `convert_tile_batch.py`;
  - actors: `scripts/actors/convert_actors.py`;
  - data-ui: `scripts/data/convert_ui.py` and `convert_tables.py`.
  The fix changes the step's seal fingerprint, so the re-run covers every unit of that step, not only the checked key. Never edit one tile's or one key's output, never add a per-key recipe override, never add a runtime special case (DEC-OWN-7).
- Re-run chain (P18):
  1. The fixed step re-runs for its sealed units in the lane store.
  2. The lane catalog is rewritten.
  3. The union is rebuilt (`python -B scripts/native_store/write_lane_catalog.py --lane integration --union world --union actors --union data-ui`).
  4. A load-sweep slice runs on the touched keys.
  5. The sandbox half is captured again, and a fresh reviewer judges the pair again.
  The record keeps the old and new sandbox half SHA-256, so "a re-run shows the corrected result" is recorded evidence. The main-checkout restage stays the one Needs Human command, with its catalog SHA-256 updated.
- Unfixable defects (P19): the step refuses that case class and writes a gap row with a reason from its lane's closed list. A new reason goes into `recipes/<lane>/gap-reasons.json` with its evidence, following `<domain>-class-unported:<class>` or `<domain>-feature-unported:<property>` where those fit. The key leaves the catalog on the re-run and counts as a gap, not as a converted key with a standing mismatch.
- Scope and order (P20): Phase 3 fixes only defects its own checks find. Defects already on STATE Open follow-ups are cited by the record's reason, not duplicated, and stay Phase 2 follow-ups; examples are union tile loads, the level model licensees, the tile seam and map emitter playback. Phase 3 resumes no Phase 2 breadth batch except the re-runs a fix needs. Each fix stays inside its lane's globs (`node scripts/check-lane-ownership.mjs --base <plan start> --part <slug>`). A risky converter fix gets one independent Claude review instead of the Codex cross-model review until 2026-11-12.

### Claude's Discretion
- Plan split, wave order, file and module names, record field spelling and the per-kind spec layout, within AGENTS.md code rules: no comments, full-word names, files under about 400 lines, a Vitest or pipeline test per behaviour change, a Playwright check for UI, no dead code, never an invented L2 value.
- Slice sizes for sweeps and sandbox-half captures, and the census-class keys used for the one-per-class queue step, as long as the rule is written down and reproducible from the census.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/native_store/build_coverage_report.py` (300 lines): per part denominator, converted, loads pass, failed and unverified, gap and pending; per key census status, reason and steps; `validate_coverage_report`; `LOADS_RULE_TEXT`. `scripts/native_store/coverage_denominators.py`: `COVERAGE_PART_ORDER` (11 parts) and `UNKNOWN_DENOMINATOR` for sandbox, audio, minimap and movement-geodata.
- `tests/browser/support/loadCheckRecords.ts`, `loadCheckRecordFile.ts` and `scripts/native_store/load_check_records.py`: one record per key per served catalog SHA-256, resumable slices, kinds tiles, npcs, items, skills and windows. This is the model for the side-by-side records and sandbox-half slices.
- `scripts/native_store/gap_rows.py`: `CATALOG_KEY_PATTERNS`, the closed reason lists per lane (`recipes/world|actors|data/gap-reasons.json`) and the seed list.
- `scripts/native_assets_lib/asset_manifest.py` `reference_client_build(lock)`: gives `referenceTreeLockSha256` `1957c96800aa...` and Engine.dll `4dd2f63c606d...` (measured 2026-11-11). The raw lock file hashes to `e314cd11...` and must not be used as the reference. The lock records IMPORTA at 5,629 files and 7,814,256,191 bytes.
- Harness pages `tests/browser/harness/native-npc.html`, `native-skill-effect.html`, `native-window.html`, `actor-audio.html`, `material-swatch.html` and `load-check.html`; viewports in `tests/browser/browserViewports.ts`.
- `src/runtime/nativeSliceDiagnostics.ts`: the `window.__nativeSlice` snapshot with a camera read-out and `captureAudio()`; there is no camera or hour setter yet. `src/runtime/sandboxRuntimeActions.ts`: `?map=`, window by ID, spawn, equip and cast by ID.
- IMPORTA-PC, read-only and outside the repo: `C:/Lineage2-client-support/debug-control/` has `Control-L2.ps1` (`542b89cc...`), `CONTROL.md`, `PLAYBACK.md`, `HUD-COMPARISON.md`, `UI-AUDIT.md`, and `Record-L2.ps1` (MP4, no audio). The only working remote route recorded so far is a temporary interactive scheduled task (main-checkout ignored `artifacts/native-parity/reference-current/invoke-interactive.ps1`).

### Established Patterns
- Union loads come only from slices run with `NATIVE_STORE_ROOT=integration`, recorded under the union catalog `bba52c47...`; lane records are never carried over (02-55).
- Census-based gap rows with one schema and closed reasons; seal fingerprints decide re-runs (`scripts/native_store/unit_ledger.py`).
- Tests that need the private client skip with a reason; committed fixtures are synthetic or indices and hashes (D3).
- Heavy runs go through the BelowNormal helper in `C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py`, after `node scripts/check-machine-schedule.mjs`.
- Independent fresh-context Claude reviewers stand in for owner-level sign-offs, provisional and revocable (02-57).

### Integration Points
- `pnpm report:coverage` writes `coverage.json` and `docs/coverage.md`. The union table today, as converted of denominator, loads pass, gap and pending: data 40/40, 0, 0, 0; world 62/163, 22 (40 failed), 22, 79; player-characters 0/15, 0, 15, 0; ui 248/248, 20, 0, 0; npcs 1000/6519, 5, 1527, 3992; items 96/9238, 51, 8074, 1068; skills-effects 3064/29812, 5, 18210, 8538.
- `docs/parts/<part>/EVIDENCE.md` with its 30,720-byte limit (`tests/unit/laneOwnership.test.ts:17`); `docs/parts/**` folders are lane-owned per `.planning/lanes.json`, while `scripts/native_store/**` and a new driver folder are unclaimed, so integration owns them.
- `.planning/STATE.md` Needs Human and Open follow-ups, `docs/VERIFICATION.md` "Open", and STATUS.md part lines.

</code_context>

<specifics>
## Specific Ideas

- Owner rules from memory: never list items for the owner to label, so the owner gets exact commands and the reviewer labels; make every step programmatic; prefer audible, labelled results over more research; all staged media comes from our recipes and scripts.
- Items Phase 2 left for Phase 3 pairs: the npcgrp `texture_name[i]` slot rule (`docs/parts/npcs/EVIDENCE.md:18`, OVERNIGHT-DECISIONS row 278); the minimap tile grid and projection (`docs/parts/minimap/EVIDENCE.md:27`); the PTDS 3 and 6 swatch (`docs/parts/skills-effects/EVIDENCE.md`); the sky against L2.exe (`docs/NATIVE_SKY.md`); the 4dd2 hair field meanings; the world camera lists in `.planning/reference/lineage2js/01-materials-fog.md`, `02-bsp-visibility.md` and `03-movement.md` (reference notes, not decisions).
- The cases already seen in L2.exe barely overlap what loads in the union: `skill:3:*` (Power Strike) are gaps, `npc:21622` (Greater Musveren) is pending, and `npc:20001` is converted with its union load unrecorded. The four POL-01 cases therefore enter the queue only when their keys convert and load.
- After each native session, the receipt records the `system/l2.ini` hash before and after, and the client is left as found (prior practice in the 2026-11-05 pass).

</specifics>

<deferred>
## Deferred Ideas

- POL-01 numeric parity, the 30 FPS reference capture and the particle metrics: Phase 5.
- Audio tolerances, one alignment method and matched recordings: POL-02, Phase 5. An IMPORTA audio loopback route is an owner decision.
- Profile or `LocalMap` changes on IMPORTA's Debug profile to reach other tiles offline: owner decision, after the owner session probes the viewer controls.
- In-world pairs from the aCis stack or a third-party server: not used; Mobius comes in Phase 4.
- Image-difference tooling (pixel or SSIM metrics): polish stage. Stage A pairs are judged qualitatively.
- Denominators for audio and minimap (they need new key kinds, a contract change): later, with a logged decision.
- The stage A done threshold on the gap list: owner.
- The main-checkout restage of `public/l2`: integration thread, Needs Human.

</deferred>
