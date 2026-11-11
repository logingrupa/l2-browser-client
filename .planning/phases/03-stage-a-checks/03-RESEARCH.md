# Phase 3: Stage A checks - Research

**Researched:** 2026-11-11 (autonomous; the owner is away)
**Domain:** side-by-side check records, sandbox-half capture slices, a native capture driver that is built and tested but not run, a stage A exit report on the existing coverage report, and converter fixes found by the checks
**Confidence:** HIGH for the repository facts and the unattended scope; MEDIUM for the native driver's behaviour against L2.exe, which nobody may run in Phase 3

<user_constraints>
## User constraints (from 03-CONTEXT.md)

### Phase boundary and execution constraints

Every converted part gets a recorded side-by-side check against L2.exe on IMPORTA-PC (`C:/Lineage2-client`, DEC-OWN-2), with a verdict of pass, mismatch or unverified; audio gets labelled listen-check clips; defects become shared converter fixes or listed gaps; and a stage A exit report, generated from data, states per part converted, loads, checked, pass, mismatch, unverified and gap counts tied to the hash lock. Requirements CHECK-01 to CHECK-05. The bar is DEC-OWN-3 (qualitative pairs); the fixed POL-01 and POL-02 thresholds stay Phase 5.

What this run can and cannot do:
- Unattended on DATABASE-PC (free all the time, heavy commands at BelowNormal): the sandbox half of every pair, union load sweeps, census and coverage, browser audio clips, the check records (all unverified until a native half exists), the native capture driver with its tests, the exit report, and converter fixes for defects these checks find.
- Not without the owner: any L2.exe run on IMPORTA-PC. Session 1 there runs the owner's other client (`C:\Games\Reborn\Legacy`) and the levelup bot (feasibility probe, 2026-11-11 about 07:10 Riga), and every earlier L2.exe launch on IMPORTA-PC had an explicit owner approval. Offline Debug mode reaches only map 20_20 and the `sv`, `nv` and `pv` viewers; UI windows, the minimap, the HUD, other tiles and other classes need a game server, which is the stock Mobius of Phase 4; listen checks need the owner's ears.
- So Phase 3 delivers the full unattended scope and leaves the native halves as unverified records plus exact Needs Human lines. Success criteria 1 and 2 stay human_needed until those sessions run; no native half is ever faked or borrowed.

Execution constraints (carried from Phase 2, binding on every plan):
- Work only in this worktree on branch `plan/autonomous-roadmap`; commit on this branch only; no push or merge. Phase 3 execution starts after the Phase 2 code review fix round has committed, from a commit the first plan names.
- Lane stores under `artifacts/lane-store/<lane>/` (ignored) and the integration union are written here; the main-checkout restage stays the one Needs Human command; never run `assets:*`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*` or preview scripts against the main checkout or `public\l2`.
- IMPORTA-PC is read-only over `ssh -p 2026 rolan@importa-pc.tail40ecb2.ts.net` (hashes, listings, process queries); nothing is written inside `C:/Lineage2-client`.
- Dev server on port 5175; `pnpm test:e2e` on port 5173 only while nothing listens there; one full `pnpm test:unit` per machine at a time. Stop what a run started by PID or by a command line holding this worktree path or port, never by image name.

### Locked decisions

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
- L2.exe on IMPORTA-PC (P7): Phase 3 starts no L2.exe, registers no scheduled task, injects no input and changes no profile, `LocalMap` or audio routing on IMPORTA-PC without the owner. A T3 agent on environment 20b54a96 is not used to drive it either. Read-only ssh (hashes of `system/l2.ini`, `Control-L2.ps1` and `CONTROL.md`, process listings) is allowed to prepare receipts and preflight checks.
- Native work by what it needs (P8):
  - Owner go-ahead and a free session 1, no server: the offline Debug client on 20_20 gives the world 20_20 startup pose, NPC pairs through `nv`, item pairs through `pv`, skill pairs through `sv` and the debug male fighter pawn. That session first probes input delivery (End, Tab, viewer clicks, failed on 2026-11-05), `setres 1440x900x32w`, the PawnViewer Map and time controls, `nv` and `pv` search by ID, and the startup PlayerStart.
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

### Claude's discretion

- Plan split, wave order, file and module names, record field spelling and the per-kind spec layout, within AGENTS.md code rules: no comments, full-word names, files under about 400 lines, a Vitest or pipeline test per behaviour change, a Playwright check for UI, no dead code, never an invented L2 value.
- Slice sizes for sweeps and sandbox-half captures, and the census-class keys used for the one-per-class queue step, as long as the rule is written down and reproducible from the census.

### Deferred ideas (out of scope)

- POL-01 numeric parity, the 30 FPS reference capture and the particle metrics: Phase 5.
- Audio tolerances, one alignment method and matched recordings: POL-02, Phase 5. An IMPORTA audio loopback route is an owner decision.
- Profile or `LocalMap` changes on IMPORTA's Debug profile to reach other tiles offline: owner decision, after the owner session probes the viewer controls.
- In-world pairs from the aCis stack or a third-party server: not used; Mobius comes in Phase 4.
- Image-difference tooling (pixel or SSIM metrics): polish stage. Stage A pairs are judged qualitatively.
- Denominators for audio and minimap (they need new key kinds, a contract change): later, with a logged decision.
- The stage A done threshold on the gap list: owner.
- The main-checkout restage of `public/l2`: integration thread, Needs Human.
</user_constraints>

Research refinements of the locked decisions are logged as pending decision rows. They are provisional, for owner review, in `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md`:
- **P21:** a key content digest replaces "the key's manifest SHA-256", which npc, item and skill keys do not have.
- **P22:** the sandbox hour is a `set-environment` adapter command, not a direct setter.
- **P23:** audio records are keyed by owning key, role and source SHA-256.

<phase_requirements>
## Phase requirements

| ID | Description (`.planning/REQUIREMENTS.md:82-86`) | Research support |
| --- | --- | --- |
| CHECK-01 | For world, characters/NPCs/items, skills and UI, paired screenshots (sandbox vs L2.exe on IMPORTA-PC at the same location or ID) are captured per part. | Sandbox halves come from one resumable capture slice per kind on the union (sections 4.4 and 4.5). The native halves come from the committed driver and the import step (4.7). In Phase 3 the driver is tested on transcripts only, so every record stays unverified with a closed reason (4.2). Criterion 1 stays human_needed. |
| CHECK-02 | Audio (world, actor, skill) gets a listen check against L2.exe with labelled audible results; extraction or decoding alone is not a pass. | Labelled browser clips go through `window.__nativeSlice.captureAudio()` and the existing report pattern (4.6). Records use the triple key of P23 with verdict `unverified` `listen-needs-owner`. The writer refuses an audio pass or mismatch outright (4.2). |
| CHECK-03 | Each part's verdict (pass, mismatch, unverified) is recorded in `docs/parts/<part>/EVIDENCE.md`; missing or uncertain evidence is unverified, never a pass. | `docs/parts/<part>/side-by-side-checks.json` has one validated writer (4.2). Each EVIDENCE.md gets a "Stage A check" section with counts and links (4.10). Five parts must be trimmed first because of the 30,720-byte limit (pitfall 6). |
| CHECK-04 | Defects found are fixed in the shared converter step and re-run, never hand-patched per tile; unfixable ones join the gap list. | The fix route and re-run chain are in 4.9. Defects are detected automatically from diagnostic materials and load failures (4.4). Unfixable cases are refused and recorded with closed gap reasons. |
| CHECK-05 | A stage A exit report states per part converted, loads, checked, and pass / mismatch / unverified / gap counts, referencing the IMPORTA-PC hash lock. | `build_coverage_report.py` is extended with a split-out stage A module, schema version 2 and a reference block from `reference_client_build(lock)`. Its invariants are enforced by the validator (4.8). |
</phase_requirements>

## Summary

Phase 3 is mostly integration code built from patterns this repository already has. The load-check slice machinery (`tests/browser/support/loadCheckRecords.ts`, `scripts/native_store/load_check_records.py`) is the model for resumable, catalog-keyed sandbox-half captures. The coverage report (`scripts/native_store/build_coverage_report.py`, 300 lines) is the one owner the exit report extends. `native_source_stage.py` already shows the ssh, `-EncodedCommand` and hash-verify route the native driver needs. No new package is needed. The stack is Playwright 1.64.1, Vitest 5.1.0, Python 3.12 unittest through `scripts/test_pipeline.py`, OpenSSH and PowerShell on IMPORTA-PC.

Three facts shape the plans more than CONTEXT.md states:
- **"The key's manifest SHA-256" does not exist for npc, item and skill keys.** An NPC is a profile row inside an `npcProfiles` pack joined to a `models` archive. An item is one or more `models` records, and a skill level is several `effectComponents` records. Only tiles, windows and tables have one `manifestSha256` each. The stale rule of P13 therefore needs a per-key content digest that one Python module computes (P21).
- **The sandbox hour cannot be a plain setter.** The environment clock is fed only by adapter `environment` events (`src/runtime/worldEnvironmentWiring.ts:61-62`), and AGENTS.md routes all gameplay state through `GameWorldAdapter`. The hour setter is therefore a sandbox command answered by `NativeSliceAdapter` (P22). Only the camera pose is a view-only member of `window.__nativeSlice`.
- **Every union rebuild resets the union load records.** Load records are keyed by the catalog SHA-256 (`lane_load_check_path`, `store_paths.py:121-124`), and pairs are captured on the union. Every converter fix (P18 step 3) therefore makes every key's union load unrecorded until the union sweeps run again. Plans must put the fix round before the final sweep and the final report.

L2.exe on IMPORTA-PC is out of reach for this run. A read-only check at 07:33 Riga showed PID 36092 `C:\Games\Reborn\Legacy\system\l2.exe` in session 1. `system/l2.ini` holds the LAN profile `0809edc9...`, not the Debug profile `e0e4a52e...`. The driver is built and tested on transcripts, and every record carries an unverified reason. Success criteria 1 and 2 end human_needed, and 3 and 4 are proved by tests and the generated report.

**Primary recommendation:** Build four contracts first: the record module with its key digest and queue rule, the adapter `set-environment` command with the camera pose setter, the exit report, and the driver with the import step. Then run the sweep, sandbox-half and audio-clip slices on `NATIVE_STORE_ROOT=integration`. Fix the defects those slices find. Last, run the final sweep, regenerate the report and write the per-part evidence sections.

## Architectural responsibility map

| Capability | Primary tier | Secondary tier | Rationale |
| --- | --- | --- | --- |
| Check record schema, validation and writing | Pipeline (Python, `scripts/native_store/`) | - | One owner (P12). It is integration-owned because `scripts/native_store/**` is unclaimed in `.planning/lanes.json`. |
| Key content digest and stale rule | Pipeline (Python) | - | The report and the record writer must agree. One module does it, so TS never re-derives it. |
| Pair queue order (P5) | Pipeline (Python) | - | It reads census files and union load records, which are Python-owned. |
| Sandbox-half capture | Browser (Playwright on the sandbox runtime) | Browser runtime (`window.__nativeSlice`) | The sandbox is the checking tool. Captures are presentation evidence, written to ignored artifacts. |
| Sandbox hour | World adapter (`NativeSliceAdapter`) | Runtime environment wiring | Gameplay and world state enter only through `GameWorldAdapter` (AGENTS.md server boundary). |
| Camera pose | Browser runtime (view only) | - | Framing is presentation, not gameplay state. |
| Audio clips | Browser (mixer `captureStream`) | Pipeline record writer | A clip is evidence for listening. The verdict is always unverified in Phase 3. |
| Native capture (driver) | Pipeline (Python on DATABASE-PC) driving PowerShell on IMPORTA-PC | IMPORTA `Control-L2.ps1` v3 | Committed tooling (P10). IMPORTA stays read-only except `debug-control/captures/`. |
| Exit report | Pipeline (Python, `build_coverage_report.py` plus a split module) | - | It extends one owner (P14). |
| Converter fixes | The owning lane's converter step | Union rebuild (integration) | DEC-OWN-7 and CHECK-04: fixes happen in shared steps, never in output. |
| Verdicts | Independent fresh-context Claude reviewer through the writer CLI | - | P3. A capturing agent never judges its own pair. |

## Project constraints (from CLAUDE.md and AGENTS.md)

- `.planning/PROJECT.md` decisions (DEC-OWN-1 to DEC-OWN-12) win. Fix a doc that disagrees with `.planning` in the same change.
- Never invent Lineage II values. Every value comes from the reference client through a pinned recipe or script and records its source. An unresolved value stays visibly unresolved, with no procedural stand-ins.
- The only game interface is the original Interlude interface (DEC-OWN-10). No HUD polish and no design-skill output.
- Server boundary: gameplay state enters only through `GameWorldAdapter`. The client computes no damage, stats or outcomes. This is why P22 exists.
- Lanes: no `assets:*`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*`, `merge_lane_store.py` or preview scripts against the main checkout. Only one full `pnpm test:unit` per machine. The Vitest budget is `maxWorkers: "50%"`.
- Clean up after every plan: stop dev servers, Playwright browsers and Vitest workers by PID or by a command line holding this worktree path or port, never by image name. Before a done claim, nothing may listen on the dev port.
- DATABASE-PC is free all the time. Run heavy commands at BelowNormal priority (helper `C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py` after `node scripts/check-machine-schedule.mjs`).
- Desktop screenshots are 1440 x 900, and the phone is 932 x 430 landscape. SwiftShader FPS readouts are not measurements.
- Docs: one EVIDENCE.md per part under 30,720 bytes with the headings `## Passes now`, `## Open` and `## Evidence`. STATUS.md has one line per part. DECISIONS.md is append-only. No handoff prompts.
- Git: commit on this branch only, never push or merge. Stage paths by name. Commit messages carry no attribution line.
- Code: no dead code, no comments of any kind (docstrings included), full-word names, files under about 400 lines, TypeScript strict with no `any`, pnpm only. Every behaviour change has a Vitest or pipeline test, and UI changes add a Playwright check. A TODO needs a requirement ID. Text uses plain hyphens and sentence-case headings.

## Standard stack

### Core (all present; nothing to install)

| Tool | Version (verified this session) | Purpose | Why standard here |
| --- | --- | --- | --- |
| Playwright | 1.64.1 (`package.json` devDependency) | Sandbox-half captures, load sweeps, audio clips | It is already the e2e runner. The config uses `workers: 1` and `baseURL` from `DEV_PORT \|\| 5173` [VERIFIED: playwright.config.ts:8,13: `` const baseURL = `http://127.0.0.1:${Number(process.env.DEV_PORT \|\| 5173)}`; `` and `fullyParallel: false, workers: 1, timeout: 45_000`] |
| Vitest | 5.1.0 | TS unit tests (queue-independent pure functions, the adapter command, the camera setter) | [VERIFIED: vitest.config.ts:2: `include: ["tests/unit/**/*.test.ts"], maxWorkers: "50%"`] |
| Python unittest | Python 3.12.6 | Record module, digest, queue, report, driver and import tests | `pnpm test:pipeline` runs `scripts/test_pipeline.py`, which discovers `tests/pipeline` and `scripts/native_catalog`. A targeted run, `python -B -m unittest tests.pipeline.test_coverage_report`, took 2.8 s this session. |
| Node | v24.15.0 | Runs `scripts/check-machine-schedule.mjs` and `check-lane-ownership.mjs` | Already in use |
| pnpm | 10.32.1 | Scripts `report:coverage`, `test:pipeline`, `test:e2e`, `test:unit`, `typecheck` | [VERIFIED: package.json scripts: `"report:coverage": "python -B scripts/native_store/build_coverage_report.py"`, `"test:pipeline": "python scripts/test_pipeline.py"`, `"test:e2e": "playwright test"`] |
| OpenSSH to IMPORTA-PC | port 2026, BatchMode | Read-only preflight (hashes, process lists) and, in the owner session only, the driver | The connection was verified this session. The remote shell is Git Bash: `cat /c/...` works, while cmd `type C:\...` fails. |

### Supporting (in repo, reuse by import)

| Module | Use |
| --- | --- |
| `native_store.load_check_records.is_catalog_key`, `is_riga_timestamp` | Record validation (do not copy them) |
| `native_store.canonical_json.canonical_json_bytes`, `catalog_writer.replace_file` | Byte-stable committed JSON |
| `native_store.catalog_index_keys.read_measured_catalog`, `validated_slice_records`, `staged_profiles` | Key content digest inputs |
| `native_store.gap_rows.CATALOG_KEY_PATTERNS`, `load_gap_reason_patterns`, `is_listed_reason` | Keys and closed gap reasons (P19) |
| `native_assets_lib.asset_manifest.reference_client_build`, `reference_client_guard.read_reference_client_lock` | Exit report reference block |
| `native_store.unit_ledger.read_machine_schedule`, `require_host_clock_on_riga_time` | Schedule refusal in the driver, the import step and the report |
| `tests/browser/support/loadCheckRecordFile.ts` `servedLaneCatalogSha256` | The sandbox half's catalog SHA-256 from the served header |
| `scripts/check-machine-schedule.mjs` `formatRigaTimestamp` | Riga timestamps in receipts |

### Alternatives considered

| Instead of | Could use | Tradeoff |
| --- | --- | --- |
| A Python single writer with TS writing only ignored receipts | A TS writer plus a Python reader (03-PATTERNS.md suggestion) | Two schema owners drift. P12 says one validated writer. Recommend that TS write ignored receipt JSON and that Python ingest, validate and write the committed records. |
| Qualitative reviewer verdicts | pixelmatch or SSIM | Deferred to the polish stage (CONTEXT Deferred). Do not add an image-difference package. |
| A committed driver | The ignored main-checkout `invoke-interactive.ps1` | That script is uncommitted and tied to the 2026-11-05 numbering. P10 requires committed tooling. |

**Installation:** none.

## Package legitimacy audit

No external package is installed in this phase. Every tool above is already in `package.json` or the Python standard library. **Packages removed:** none. **Packages flagged:** none.

## Architecture patterns

### 4.1 System architecture diagram

```
                       union catalog (artifacts/lane-store/integration/l2/catalog.json, sha C)
                                   |
         +-------------------------+--------------------------+
         |                         |                          |
  load sweeps (existing)    queue builder (Python)      exit report (Python)
  load-checks/<C>.json      reads census files,          coverage rows + check records
         |                  load records on C,           + reference_client_build(lock)
         +-------> pass --> P5 order, key digests  ---->  docs/coverage.md "Stage A exit"
                            artifacts/side-by-side/queue/<C>.json (ignored)
                                   |
             +---------------------+----------------------+
             |                                            |
   sandbox-half slice (Playwright, 1440x900,        audio clip slice (Playwright,
   NATIVE_STORE_ROOT=integration)                    captureAudio, labelled)
   set-environment via adapter, camera pose          receipt: owning key, role,
   PNG + receipt -> artifacts/side-by-side/<part>/   package, object, source sha
             |                                            |
             +------------------+-------------------------+
                                v
               record writer CLI (Python, the one writer)
               validates receipt, recomputes the key digest on C,
               writes docs/parts/<part>/side-by-side-checks.json
                    ^                     ^                    |
                    |                     |                    v
   native import (owner session)   reviewer verdict      defects: diagnostic materials,
   PNG + receipt sha, lock ref     (fresh Claude, P3)    load failures, mismatches
                    ^                                          |
   native driver (owner session; Phase 3: transcripts only)    v
   pins Control-L2.ps1 and CONTROL.md, refuses foreign L2.exe  owning converter step fix
   temporary interactive task, captures/ only                  -> lane re-run -> lane catalog
                                                               -> union rebuild (new C') -> sweeps
                                                               -> sandbox half again -> re-judge
```

### 4.2 Check record schema and the one writer

Put the module at `scripts/native_store/side_by_side_check_records.py` with an error class `SideBySideCheckRecordError(ValueError)`. Shape it after `load_check_records.py` (exact field sets, strict JSON decode with `refuse_duplicate_json_keys`, records sorted with one per key). Write with `canonical_json_bytes` plus `replace_file`.

Recommended document per part (`docs/parts/<part>/side-by-side-checks.json`):
- `schemaVersion: 1`, `part`, `records` (sorted).
- A record holds:
  - `key`, `verdict` (one of `pass`, `mismatch`, `unverified`) and `reason`;
  - `nativeSelection`, for example `{viewer: "nv", text: "<name>", expectedMeshText: "..."}` or `{route: "offline-debug-startup"}`;
  - `sandboxHalf` (below) and `nativeHalf` (below, or null);
  - `difference` and `suspectedStep` (non-null only for mismatch);
  - `reviewer` and `judgedAtRiga` (null while unverified with no judgement);
  - `sandboxHalfHistory`, the list of earlier `{pngSha256, keyContentSha256}` (P18).
- `sandboxHalf` holds `catalogSha256`, `keyContentSha256` (P21), `pngPath` (repository-relative, under `artifacts/side-by-side/<part>/`), `pngSha256`, `viewport {width, height}`, `cameraPose {target, alpha, beta, radius}`, `environment {gameMinutes, environmentType}`, `diagnosticMaterialRoots` (sorted list) and `capturedAtRiga`.
- `nativeHalf` holds `referenceTreeLockSha256` (from `reference_client_build`, never the raw lock file hash), `receiptPath`, `receiptSha256`, `pngSha256`, `windowSize`, `l2IniSha256Before`, `l2IniSha256After`, `controllerSha256` and `controlDocumentSha256`.

Guard clauses (the writer refuses all of these):
- `pass` or `mismatch` without both halves or without a `reviewer` that differs from the capturing agent id.
- `mismatch` without `difference` and `suspectedStep`.
- `unverified` with a reason outside the closed tuple.
- Any audio record whose verdict is not `unverified` with reason `listen-needs-owner` (P4).
- A `nativeHalf` whose `referenceTreeLockSha256` differs from the current `reference_client_build(lock)` (P13 re-lock rule).
- A PNG path outside `artifacts/side-by-side/<part>/`.

The closed unverified reasons, verbatim from P1, are `native-session-needs-owner`, `native-needs-server`, `listen-needs-owner`, `native-selection-unconfirmed`, `framing-not-comparable`, `reviewer-uncertain`, `loads-failed`, `loads-unrecorded`, `stale-after-fix`, `not-yet-queued` and `no-pair-shows-table`. `not-yet-queued` and `loads-unrecorded` are computed by the report for keys without a record. They are never stored (a stored record means the key is queued).

Writer CLI at `scripts/side_by_side/record_side_by_side_checks.py`, with subcommands `queue`, `ingest-sandbox-halves`, `import-native-halves` (calls 4.7) and `judge`. `judge` takes `--part --key --verdict --reason|--difference --suspected-step --reviewer`. It is the only route by which a reviewer writes, so no JSON is edited by hand.

Audio (P23): `docs/parts/audio/side-by-side-checks.json` records are keyed by (`key`, `role`, `sourceSha256`), where `role` is one of `ambience`, `placement`, `music`, `voice`, `combat` or `skill` (the P4 list), and carry `sourcePackage` and `sourceObject`.

### 4.3 Key content digest (P21) and the stale rule (P13)

Put this in `scripts/native_store/side_by_side_key_digest.py` and reuse the slice readers of `catalog_index_keys.py`. Catalog record shapes were read from the union catalog this session:
- `tiles`: `{"id": "15_20", "manifest": "/l2/tiles/<sha>/tile.json", "manifestBytes": 8706, "manifestSha256": "67baa588..."}` [VERIFIED: artifacts/lane-store/integration/l2/catalog.json read with python]
- `windows`: `{"id": "AbnormalStatusWnd", "manifest": ..., "manifestSha256": "0f17e4d5..."}`; `tables`: `{"id": "actionname-e", ..., "manifestSha256": "c7238be2...", "sourceSha256": ...}`
- `effectComponents`: `{"bundleId": "interlude:skill-root:skill.wh.1011", "id": "interlude:skill:1011:level:10:native-description-action", "manifest": ..., "manifestSha256": "8f1cbf21..."}`, many per skill level
- `models`: `{"archive": ..., "archiveSha256": ..., "assetId": ..., "id": ...}`; item model ids match `ITEM_MODEL_RECORD_ID_PATTERN` (`catalog_index_keys.py:22`)
- `npcProfiles`: packs whose manifest lists profiles. `npc_profile_key` joins by `modelCatalogId` or a unique mesh (`catalog_index_keys.py:129-151`).
- `combatAudio`: `{"id": "actor-sounds:npc:12077", ..., "manifestSha256": "92f477fd..."}`

Digest rule: build the sorted list of `{slice, id, pins}` for every record that `catalog_index_keys` attributes to the key, where `pins` holds that record's `manifestSha256`, `archiveSha256` or `imageSha256` fields. For npc and character keys, add the joined profile object. The digest is `sha256(canonical_json_bytes(list))`. A record is `stale-after-fix` when the current union digest differs from `sandboxHalf.keyContentSha256`. This makes a sandbox half survive a union rebuild that leaves the key's content unchanged, which is the point of P13.

### 4.4 Queue rule (P5) and sandbox-half captures

Put the queue in `scripts/side_by_side/build_pair_queue.py` as a pure function with a pipeline test. It writes the ignored file `artifacts/side-by-side/queue/<catalogSha256>.json` with `{key, part, keyContentSha256, nativeSelection, order}`, and the `queue` subcommand writes unverified records for queued keys.
- Eligible keys have a load `pass` on the union catalog. Loads come only from records on that catalog SHA (`merged_load_statuses`, `build_coverage_report.py:47-54`).
- Order:
  1. The Phase 2 waiting keys. The planner names the keys from the evidence lines (npcgrp texture-slot NPCs, a PTDS 3/6 skill, `tile:20_20`, a hair-bearing character once one converts, a minimap tile, `window:StatusWnd`).
  2. One key per census class: package for npcs and items, map licensee for tiles, emitter class for skills, window type for ui.
  3. The rest in census order.
- Gap keys never enter the queue. `player-characters` therefore has no records today, since all 15 keys are gaps (`docs/coverage.md`).

Sandbox halves come from one Playwright spec per kind (`tests/browser/side-by-side-<kind>.spec.ts`) and one shared runner (`tests/browser/support/sandboxHalfCaptures.ts`), copied from `runLoadCheckSlice`. Settings come from the environment: `NATIVE_STORE_ROOT=integration`, `SIDE_BY_SIDE_KIND=<kind>` and `SIDE_BY_SIDE_LIMIT=<n>`. The runner reads the queue file of the served catalog SHA and skips keys whose receipt for that digest exists. It sets the viewport to `desktopViewport` [VERIFIED: tests/browser/browserViewports.ts:3: `export const desktopViewport = { width: 1440, height: 900 };`], drives the sandbox, sets the hour and camera, takes the screenshot, hashes it with `node:crypto` and writes a receipt. After the slice, `record_side_by_side_checks.py ingest-sandbox-halves --part <part>` validates and writes the records.

Drive per kind with existing commands [VERIFIED: src/world/worldTypes.ts:73-79: `{ readonly type: "spawn-npc"; readonly npcId: number }`, `{ readonly type: "equip-item"; readonly slot: EquipmentSlot; readonly itemId: number | null; readonly entityId?: string }`, `{ readonly type: "cast-skill"; readonly skillId: number; readonly level: number; readonly targetId?: string }`]:
- tiles: `/?map=XX_YY` at the first enabled PlayerStart (the route already spawns there);
- npcs: `spawn-npc` on `/?map=20_20`;
- items: `equip-item` on the default player body;
- skills: `cast-skill` on the player;
- windows: `tests/browser/harness/native-window.html?window=<Name>`, which already reads `window` [VERIFIED: tests/browser/harness/nativeWindowHarness.ts:69: `const windowId = harnessParameters.get("window");`].

Automatic defect detection (P17 "magenta or unresolved diagnostic"): diagnostic materials are created as `` `UE2 diagnostic: ${loaded.program.root}` `` and inspect as `status: "diagnostic"` [VERIFIED: src/materials/ue2/babylon/material.ts:107,117]. Expose the visible diagnostic roots through the `__nativeSlice` snapshot rather than matching names in the spec. Record them in `diagnosticMaterialRoots`, and route any non-empty list to the fix round (4.9).

### 4.5 Camera pose and hour (P11, P22)

- Camera: add `setCameraPose(pose)` to the `diagnostics` object in `src/runtime/nativeSliceDiagnostics.ts`, in the style of `setFlameReplay` (validate, then apply). The pose shape equals the snapshot read-out `{ target: camera.target.asArray(), alpha, beta, radius }` [VERIFIED: src/runtime/nativeSliceDiagnostics.ts:102: `camera: { target: camera.target.asArray(), alpha: camera.alpha, beta: camera.beta, radius: camera.radius,`], so a receipt pose round-trips. Respect the radius and beta limits the snapshot exposes, and refuse values outside them. Do not clamp silently.
- Hour: add a sandbox `WorldCommand` `{ type: "set-environment"; gameMinutes: number; environmentType: number }`, answered by `NativeSliceAdapter` with the existing event [VERIFIED: src/world/worldTypes.ts:52: `| { readonly type: "environment"; readonly gameMinutes: number; readonly environmentType: number }`]. The clock validates both values and rejects unknown environment types with a `RangeError` (`worldEnvironmentClock.ts:51-54`). The spec sends it through `window.__nativeSlice.dispatch`. This is a contract change in `src/world/` (adapter-dispatch, integration), so it lands in the first wave.
- The native hour in offline Debug mode is not known. Until the owner session reads the PawnViewer Time control, pairs where the hour matters get `framing-not-comparable`, and the sandbox half records the program's `startTimeHours` fallback that it used (`worldEnvironmentClock.ts:46-47`).

### 4.6 Audio clips (CHECK-02, P4, P23)

Model the spec on `tests/browser/sandbox-actor-audio.spec.ts` (labelled report, status text "audible labelled, owner listening pending") and `world-tile-audio.spec.ts`. Record from `captureAudio: () => audio.mixer.captureStream()` [VERIFIED: src/runtime/nativeSliceDiagnostics.ts:118] with `MediaRecorder` into `artifacts/side-by-side/audio/`. Each clip receipt names the owning key, role, package, object and source SHA-256. There is no audio load-check kind (`LOAD_CHECK_KINDS` = `["tiles", "npcs", "items", "skills", "windows"]` [VERIFIED: tests/browser/support/loadCheckRecords.ts:9]), so clips come from bundles of queued keys: world audio of queued tiles, `combatAudio` of queued npcs, and skill audio of queued skills. A clip records "played and audible", never a verdict.

### 4.7 Native capture driver and import (P10), built and tested, not run

The IMPORTA controller interface, read over ssh this session:
- `Control-L2.ps1` SHA-256 `542B89CC299DAE3AC0D045D272D309F72936AF8B39FAB22EE1A57A6A24CAEADC` and `CONTROL.md` `ACD93F64580261369A4F209C81CEE7D48694D0299160467D844EC9C6A3137262`. Both match the context and 03-PATTERNS.md.
- `[ValidateSet('Capabilities', 'Environment', 'State', 'Command', 'Keys', 'Click', 'Drag', 'Wheel', 'Screenshot', 'PlaySkill', 'PlayNpcAnimation', 'ToggleFreeze', 'ToggleFps')] [string]$Action`, `[ValidateSet('sv', 'nv', 'pv', 'exit')] [string]$Command`, `[ValidateRange(1, 65535)] [int]$SkillId = 3`, `[string]$ScreenshotPath`, `[ValidateSet('Auto', 'Window', 'Screen')] [string]$CaptureMode = 'Auto'`, `[string]$ClientRoot = 'C:\Lineage2-client'` [VERIFIED: IMPORTA `C:/Lineage2-client-support/debug-control/Control-L2.ps1` lines 1-31, read with `sed -n 1,60p` over ssh].
- `unsupported = @('Absolute camera transform', 'Simulation frame stepping', 'Animation seeking', 'Deterministic native replay', 'Programmatic native FPS telemetry', 'Asset conversion')` (same file, Capabilities block).
- `viewer-layouts/` holds only `musveren-mesh.png`, `npc-death-menu.png`, `pawn-title.png`, `skill-tabs.png` and `provenance.json`.

Driver design (`scripts/side_by_side/native_capture_driver.py`, `run_command=subprocess.run` injected):
1. The batch comes from the committed records: unverified keys with reason `native-session-needs-owner`, grouped by viewer (startup, `nv`, `pv`, `sv`).
2. Preflight over `ssh -o BatchMode=yes`, with a PowerShell program sent as `-EncodedCommand` carrying base64 JSON so no remote string is interpolated (analog `native_source_stage.py remote_hashes`):
   - refuse on controller or doc hash drift;
   - refuse while any `L2.exe` whose path is not under `C:\Lineage2-client` runs, or any bot process runs;
   - refuse unless `system/l2.ini` hashes to the Debug profile `e0e4a52ee3e539472eeae49cc34852ad8845592995809a69982a2b4f056acfde` [VERIFIED: recipes/reference-client-tree.lock.json:66006-66009 `"connection-profiles/l2-Debug.ini": ["volatile-config", 3376, "e0e4a52e..."`];
   - record the before hash.
3. Run through one temporary interactive scheduled task per batch. It calls `Control-L2.ps1` actions (`Command`, `Keys`, `Click`, `PlaySkill`, `Screenshot -ScreenshotPath C:\Lineage2-client-support\debug-control\captures\<batch>\<key>.png`), is unregistered in a `finally`, and is checked as gone.
4. Receipts record the lock reference, the controller and doc SHA-256, the window size from `State`, the PNG SHA-256 computed on IMPORTA, and `system/l2.ini` before and after.
5. Import (`scripts/side_by_side/import_native_captures.py`) copies with scp into a temporary path, re-hashes, moves into `artifacts/side-by-side/<part>/native/`, and writes native halves through the record module.

Phase 3 tests replay committed transcript fixtures (JSON stdout of each remote step, no L2 bytes, D3). The dry run prints the batch and the exact commands without ssh. STATE Needs Human gets three lines (offline Debug batch, server batch, listen batch), each with preflight, driver command, import command, reviewer step and cleanup check (P9).

### 4.8 Exit report (CHECK-05, P14, P15, P16)

- Keep `build_coverage_report.py` as the owner, and move the stage A join into `scripts/native_store/stage_a_exit_counts.py`. The owner is 300 lines and would pass 400 otherwise.
- Bump `COVERAGE_REPORT_SCHEMA_VERSION = 1` to 2 and add `reference` to `COVERAGE_REPORT_FIELDS` [VERIFIED: scripts/native_store/build_coverage_report.py:26-27: `COVERAGE_REPORT_SCHEMA_VERSION = 1`, `COVERAGE_REPORT_FIELDS = frozenset({'schemaVersion', 'catalogSha256', 'storeRoot', 'generatedAtRiga', 'denominators', 'parts', 'rows'})`].
- The reference block holds `referenceTreeLockSha256` `1957c96800aa45cb10c984f3f2e6f8d1f5f0b1713f086f20560db01f4d1d2b52`, `engineDllSha256` `4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`, `importaFileCount` 5629 and `importaTotalBytes` 7814256191. [VERIFIED: `reference_client_build(read_reference_client_lock(...))` run this session printed the two digests. The lock `hosts.importa` printed `"fileCount": 5629`, `"totalBytes": 7814256191`. The raw lock file hashes `e314cd1181232c5e0cd1e6c4af3ae85e043e82d0a1d2170f69f45b773044a8b7`, which must not be used.]
- Per part, add `checked`, `pass`, `mismatch` and `unverified` with `unverifiedByReason`. The validator enforces `converted = checked + unverified` and `checked = pass + mismatch`, recomputed from rows the way `validate_coverage_report` recomputes `parts` (`build_coverage_report.py:184-187`).
- Keys without a record count as `not-yet-queued` when they load and are not queued, as `loads-failed` or `loads-unrecorded` otherwise, and as `stale-after-fix` when the digest differs.
- The parts with no denominator, `COVERAGE_PART_ORDER` `('data', 'sandbox', 'world', 'player-characters', 'ui', 'npcs', 'items', 'skills-effects', 'audio', 'minimap', 'movement-geodata')` with `UNKNOWN_DENOMINATOR = 'unknown'` [VERIFIED: scripts/native_store/coverage_denominators.py:13-15], keep `unknown`. Their record counts are still listed, and the reason is stated (P15).
- For `data` tables, a `table:` key counts as checked only through a recorded pair that lists the table key and the row ids it shows, and it takes that pair's verdict. Otherwise it is `no-pair-shows-table`.
- The markdown gets a "Stage A exit" table and a rule text constant in the style of `LOADS_RULE_TEXT`. Nothing is typed by hand.

### 4.9 Converter fixes (CHECK-04, P17 to P20)

| Defect source | Owner | Re-run |
| --- | --- | --- |
| world tile | `scripts/world/convert_tile.py --step <step>` / `convert_tile_batch.py` | the step's sealed units via the seal fingerprint (`unit_ledger.py`) |
| npcs, items, skills, characters | `scripts/actors/convert_actors.py` | same |
| tables, ui | `scripts/data/convert_tables.py`, `convert_ui.py` | same |

The chain after a fix:
1. Rewrite the lane catalog.
2. Rebuild the union: `python -B scripts/native_store/write_lane_catalog.py --lane integration --union world --union actors --union data-ui`.
3. Run a load-sweep slice on the touched keys.
4. Capture a new sandbox half, so `sandboxHalfHistory` gains the old PNG and digest.
5. Run a fresh reviewer.

Unfixable classes are refused by the step with a closed reason added to `recipes/<lane>/gap-reasons.json` (lowercase literal pattern rule `REASON_LITERAL_PATTERN`, `gap_rows.py:38`). Defects already on STATE "Open follow-ups" are cited, not fixed: union tile loads without collision, the level model licensees 18, 23, 25 and 30, the tile seam and map emitter playback. Each fix plan runs `node scripts/check-lane-ownership.mjs --base <plan start> --part <slug>`.

### 4.10 Evidence sections

Each part's EVIDENCE.md gets a short "Stage A check" block inside `## Passes now` or `## Open`. The test requires these three exact headings [VERIFIED: tests/unit/laneOwnership.test.ts:249: `for (const heading of ["## Passes now", "## Open", "## Evidence"])`] with byte limit `const evidenceDocumentByteLimit = 30_720;` (line 17). Do not add a new top-level heading that the test would ignore, and keep the section to counts, a JSON link and the capture folder. Sizes measured this session: skills-effects 30,050, movement-geodata 29,969, npcs 29,797, adapter-dispatch 29,617 and world 29,084 bytes. Trim these first.

### Recommended file layout

```
scripts/native_store/side_by_side_check_records.py   schema, validation, read, write (one owner)
scripts/native_store/side_by_side_key_digest.py      key content digest over the union catalog
scripts/native_store/stage_a_exit_counts.py          per part checked/pass/mismatch/unverified by reason
scripts/side_by_side/build_pair_queue.py             P5 queue (pure) and the ignored queue file
scripts/side_by_side/record_side_by_side_checks.py   CLI: queue, ingest-sandbox-halves, import-native-halves, judge
scripts/side_by_side/native_capture_driver.py        preflight, batch, temporary task (owner session only)
scripts/side_by_side/import_native_captures.py       scp, re-hash, native halves
tests/browser/support/sandboxHalfCaptures.ts         slice runner and receipts
tests/browser/side-by-side-{tiles,npcs,items,skills,windows,audio}.spec.ts
tests/pipeline/test_side_by_side_check_records.py, test_side_by_side_key_digest.py, test_pair_queue.py,
  test_native_capture_driver.py, test_import_native_captures.py, test_coverage_report.py (extended)
tests/pipeline/fixtures or *_fixture.py: synthetic records, receipts, driver transcripts
tests/unit/sandboxHalfCaptures.test.ts, nativeSliceSetEnvironment.test.ts, nativeSliceCameraPose.test.ts
```

### Anti-patterns to avoid

- Writing `side-by-side-checks.json` from TypeScript or by hand. Use one Python writer.
- Keying staleness on the catalog SHA-256. Every union rebuild changes it, so key it on the key digest.
- Setting the environment clock directly from `__nativeSlice`. That bypasses the adapter (P22).
- Using the 2026-11-05 PNGs as native halves. They predate the 2026-11-08 lock and carry no key.
- Recording an audio verdict from peaks, spectra or byte identity.
- Clamping a camera pose silently, or inventing a camera pose "to match" a native screenshot. Poses come from receipts or from the route's own PlayerStart.
- Running the driver against IMPORTA in Phase 3.

## Don't hand-roll

| Problem | Don't build | Use instead | Why |
| --- | --- | --- | --- |
| Strict JSON with duplicate-key refusal | a new decoder | `refuse_duplicate_json_keys`, `refuse_non_finite_json_number` from `native_store.catalog_writer` | Same trust-boundary rules as the load records |
| Byte-stable committed JSON | `json.dumps(indent=2)` | `canonical_json_bytes` plus `replace_file` | Reruns stay byte-identical, matching the coverage tests |
| Catalog key derivation | a second key mapper | `catalog_index_keys` and its slice helpers | The NPC join rules are subtle (`modelCatalogId`, unique mesh) |
| Served catalog identity in browser specs | reading the catalog file | `servedLaneCatalogSha256(baseUrl)` | The served header is what the page actually used |
| Riga timestamps | `zoneinfo` | `formatRigaTimestamp` and `read_machine_schedule()['rigaTime']` | `zoneinfo` data is missing here (02-RESEARCH sampling note) |
| Reference identity | hashing the lock file | `reference_client_build(lock)` | The raw lock hash `e314cd11...` matches no committed census |
| Remote PowerShell input | string-built commands | base64 JSON plus `-EncodedCommand` (`native_source_stage.py`) | No quoting or injection bugs (seen live this session: `$_` mangled by the remote shell) |
| Image comparison | pixel metrics | the qualitative reviewer (P3) | Deferred to polish (DEC-OWN-3) |

## Common pitfalls

1. **Union rebuild resets union loads.** Load records are per catalog SHA (`store_paths.py:121-124`, `.../load-checks/{catalog_sha256}.json`). Through `--census-lanes`, the report also counts each lane's own records against that lane's current catalog (`merged_load_statuses`, `build_coverage_report.py:47-54`; `02-55-SUMMARY.md:119`). The P5 queue and the stage A join must still use union-catalog records only, because pairs are captured on the union (02-55: lane records never carry over to it). After any P18 rebuild, every key reads `loads-unrecorded` for stage A until the union sweeps run again. Order the work as fixes, then the final union sweeps, then the final report. Do not report "checked" numbers from a union whose sweeps are stale.
2. **Phase 2 review fixes still running.** Phase 3 execution starts from a commit the first plan names, after that round commits. Sandbox halves captured before then may go stale at once.
3. **SwiftShader is slow.** The per-key timeout is `loadCheckKeyTimeoutMilliseconds = 90_000`, and tiles take 180 s (`loadCheckRecords.ts:14-15`). Keep slices small (5 to 20 keys) and resumable. Only one e2e run, on port 5173, while nothing listens there.
4. **Lane-owned doc folders.** `docs/parts/<part>/**` belongs to the world, actors or data-ui lanes (`.planning/lanes.json`). A plan that writes records or evidence for parts of several lanes fails `check-lane-ownership.mjs --part <slug>` for some of them. Split doc and record writes per lane, one `--part` per plan or task commit. `scripts/native_store/**` and `scripts/side_by_side/**` are unclaimed, so they belong to integration.
5. **Name collisions in `nv`.** `nv` searches by English name, and names repeat (for example `field_stalker_m00` in 22 npcgrp rows). Control-L2 has no general NPC-selection action. Only Greater Musveren has a layout reference (`viewer-layouts/musveren-mesh.png`), so the driver cannot confirm other selections. Every `nv` pair starts `native-selection-unconfirmed` until a reviewer reads the mesh and texture text in the PNG and it equals the key's npcgrp row.
6. **The EVIDENCE byte limit.** Five docs sit at 29,084 to 30,050 bytes. Trim older detail to git history first and keep the new block short.
7. **The profile on IMPORTA.** `system/l2.ini` is the LAN profile `0809edc9...` now (live hash this session equals lock line 73377). The NATIVE_PARITY notes say to launch `L2.exe` directly, windowed, with RunAsInvoker and the Debug INI, that `Start-Client rewrites the INI` and that exclusive fullscreen crashes. Switching profiles is an owner action. The driver refuses unless the Debug hash is present and records it before and after.
8. **The offline view is limited.** Offline Debug mode has a compass-only HUD and no absolute camera API, so world pairs beyond the 20_20 startup pose are `native-needs-server` or `framing-not-comparable`.
9. **`inputSent` is not proof.** CONTROL.md says an `inputSent` result shows only that input was delivered. Native halves need the screenshot itself, and the reviewer judges what it shows.
10. **The 30 FPS particle metrics** in `.planning/reference/lineage2js/04-particles.md:473` are a reference note. They are POL-01, not stage A (DEC-OWN-3).
11. **No comments.** That includes docstrings and the inline `#` in the `native_source_stage.py` analog. Remove every comment in any file you touch.
12. **Machine schedule.** The report, the driver and the Playwright config refuse inside a machine window (`refuseTestRunInsideMachineWindow`). DATABASE-PC has none today. Heavy runs still go at BelowNormal.
13. **Process cleanup.** Every slice starts `pnpm dev` through the Playwright `webServer`. Check that no listener remains on 5173 or 5175 and that no chrome or node process with this worktree path remains.

## Code examples

Record validation skeleton (names are proposals; every constant shown is quoted in 4.2 or comes from the modules cited):
```python
from native_store.load_check_records import is_catalog_key, is_riga_timestamp

SIDE_BY_SIDE_VERDICTS = ('pass', 'mismatch', 'unverified')
UNVERIFIED_REASONS = ('native-session-needs-owner', 'native-needs-server', 'listen-needs-owner', 'native-selection-unconfirmed',
                      'framing-not-comparable', 'reviewer-uncertain', 'loads-failed', 'loads-unrecorded', 'stale-after-fix',
                      'not-yet-queued', 'no-pair-shows-table')
STORED_UNVERIFIED_REASONS = tuple(reason for reason in UNVERIFIED_REASONS if reason not in ('not-yet-queued', 'loads-unrecorded'))


def validate_side_by_side_verdict(record, path):
    if record['verdict'] not in SIDE_BY_SIDE_VERDICTS:
        raise SideBySideCheckRecordError(f'side-by-side record {record["key"]} verdict must be one of {", ".join(SIDE_BY_SIDE_VERDICTS)}: {path}')
    if record['verdict'] == 'unverified':
        if record['reason'] not in STORED_UNVERIFIED_REASONS:
            raise SideBySideCheckRecordError(f'side-by-side record {record["key"]} reason is not in the closed list: {record["reason"]!r} in {path}')
        return
    if record['nativeHalf'] is None or record['sandboxHalf'] is None or record['reviewer'] is None:
        raise SideBySideCheckRecordError(f'side-by-side record {record["key"]} {record["verdict"]} needs both halves and a reviewer: {path}')
    if not is_riga_timestamp(record['judgedAtRiga']):
        raise SideBySideCheckRecordError(f'side-by-side record {record["key"]} judgedAtRiga must be ISO 8601 with the Riga offset: {path}')
```

Exit invariant, in the same recompute-and-compare style as `validate_coverage_report`:
```python
def require_stage_a_counts_balance(part, counts):
    if counts['converted'] != counts['checked'] + counts['unverified'] or counts['checked'] != counts['pass'] + counts['mismatch']:
        raise CoverageReportError(f'stage A counts of {part} do not balance: {counts!r}')
```

Sandbox hour through the adapter (P22). The command type is a proposal, and the event shape is quoted from `worldTypes.ts:52`:
```typescript
case "set-environment":
  this.emit({ type: "environment", gameMinutes: command.gameMinutes, environmentType: command.environmentType });
  return;
```

## State of the art

| Old approach | Current approach | When changed | Impact |
| --- | --- | --- | --- |
| Ad hoc native PNGs from the uncommitted `invoke-interactive.ps1` (2026-11-05) | A committed driver, pinned by SHA-256, with receipts (P10) | Phase 3 | Native halves become reproducible and tied to the 2026-11-08 lock |
| Verdict text inline in EVIDENCE.md | Committed per-key JSON plus a short evidence section | Phase 3 (P12) | Fits the byte limit and is countable by the report |
| Coverage with loads only | Coverage with stage A exit columns and a reference block (schema 2) | Phase 3 (P14) | Gives CHECK-05 from data |

## Assumptions log

| # | Claim | Section | Risk if wrong |
| --- | --- | --- | --- |
| A1 | `NativeSliceAdapter` can emit an `environment` event from a new sandbox command without touching other subscribers. [ASSUMED] | 4.5 | If the emit path is shared differently, the command needs a small adapter refactor. The contract plan finds out at once. |
| A2 | The `__nativeSlice` snapshot can expose visible diagnostic material roots cheaply. [ASSUMED] | 4.4 | If not, the spec counts `status: "diagnostic"` through a registry accessor. Same behaviour, different seam. |
| A3 | `MediaRecorder` on the mixer `captureStream()` records a playable clip under headless Chromium. [ASSUMED] | 4.6 | If headless gives silence, the clip receipt records "played" from the existing report pattern, and the clip is re-recorded with `WORLD_HARDWARE_TEST=1` on the GTX 1060. |
| A4 | A temporary interactive scheduled task plus `Control-L2.ps1` still drives the current IMPORTA desktop. [ASSUMED; last proved 2026-11-05, with input failures after action 025] | 4.7 | The owner session's probe step finds this out. The driver's tests do not depend on it. |
| A5 | The census files expose a usable class field per part (package, licensee, emitter class, window type) for the queue's second step. [ASSUMED; files exist, fields not opened this session] | 4.4 | The planner opens `actor-unit-census.json`, `tile-census.json` and `interface-window-census.json` and writes down the exact field. If a field is missing, that step uses census order and logs a row. |
| A6 | Skill audio bundles are reachable by skill key in the union catalog. [ASSUMED] | 4.6 | If they are not keyed, skill clips wait, and the audio record count states it. |

## Open questions (RESOLVED)

1. **Which keys are "the Phase 2 waiting keys"?**
   - Known: the evidence lines name the rules (npcgrp texture slot, PTDS 3 and 6, the 20_20 sky, 4dd2 hair, the minimap projection, `window:StatusWnd`).
   - Unclear: the exact npc, skill and tile keys that show each rule and also load on the union.
   - Recommendation: the queue plan selects them with a written rule. For example, take the lowest npc id whose npcgrp row has more than one non-empty `texture_name` slot and a union load pass. Log it as a row and never hand-list keys.
   - RESOLVED: planning row P27 fixes each waiting-key rule by name (`npc-texture-slot`, `ptds-3`, `ptds-6`, `sky-20-20`, `minimap-projection`, `hair-4dd2`, `statuswnd`) in 03-PLAN-INDEX.md "Queue" step 1, built by `build_pair_queue.py` in 03-04; a rule whose key is not eligible is listed with key null and its reason, so no key is hand-listed. The class field of queue step 2 (research A5) is fixed by planning row P26, and the per-kind slice size by P28.
2. **Should sandbox halves for `native-needs-server` parts (ui, other tiles) be captured now?**
   - Recommendation: yes. They are cheap and unattended, they find sandbox-side defects for CHECK-04, and the record stays unverified.
   - RESOLVED: yes, by planning row P29. 03-07 captures every queued window half and 03-08 the tile and minimap halves; each record carries session kind `server` and the stored reason `native-needs-server` (03-PLAN-INDEX.md "Queue"), never a pass.
3. **Minimap and audio counts.**
   - Recommendation: report record counts with denominator `unknown` (P15). Do not add key kinds.
   - RESOLVED: decision P15 in 03-CONTEXT.md keeps sandbox, audio, minimap and movement-geodata at denominator `unknown` with the reason stated in the report; audio records are keyed by owning key, role and source SHA-256 (P23) and minimap records by tile key in `docs/parts/minimap/side-by-side-checks.json` (P37); 03-05 reports their record counts beside the unknown denominator, and new key kinds stay deferred (03-CONTEXT.md "Deferred Ideas").

## Environment availability

| Dependency | Required by | Available | Version | Fallback |
| --- | --- | --- | --- | --- |
| Node, pnpm | all TS work | yes | v24.15.0, 10.32.1 | - |
| Python | pipeline, report, driver | yes | 3.12.6 | - |
| Playwright Chromium (SwiftShader WebGPU) | sandbox halves, sweeps, clips | yes (`node_modules/.bin/playwright`) | 1.64.1 | - |
| Union lane store | every slice | yes: `artifacts/lane-store/integration/l2/catalog.json`, SHA-256 `bba52c475030586905cfb2f5eeef509f6862a21b8605a379a2b89baca301008c`, 1,810,934 bytes; one load file on that SHA | - | - |
| Machine schedule | all runs | yes: `{"host":"DATABASE-PC","rigaTime":"2026-11-11T07:34:50+02:00","activeWindow":null}` | - | - |
| ssh to IMPORTA-PC | read-only preflight | yes (port 2026, BatchMode) | - | - |
| L2.exe offline Debug session | native halves | no: session 1 holds PID 36092 `C:\Games\Reborn\Legacy\system\l2.exe`, and `system/l2.ini` is the LAN profile | - | unverified records plus a Needs Human line |
| Game server (stock Mobius) | ui, minimap, other tiles, in-world audio | no (Phase 4) | - | `native-needs-server` |
| The owner's ears | audio verdicts | no | - | `listen-needs-owner` |

**Missing with no fallback in Phase 3:** native halves and listen verdicts. Criteria 1 and 2 stay human_needed by design (P16).

## Validation Architecture

### Test framework

| Property | Value |
| --- | --- |
| TS unit | Vitest 5.1.0, `vitest.config.ts` (`tests/unit/**/*.test.ts`, `maxWorkers: "50%"`) |
| Pipeline | Python unittest via `scripts/test_pipeline.py` (discovers `tests/pipeline` and `scripts/native_catalog`). Targeted: `python -B -m unittest tests.pipeline.<module>` |
| Browser | Playwright 1.64.1, `playwright.config.ts` (`workers: 1`, `webServer: pnpm dev`, port `DEV_PORT \|\| 5173`) |
| Quick run command | `pnpm typecheck && pnpm test:unit -- tests/unit/<file>` (TS); `python -B -m unittest tests.pipeline.<module>` (Python) |
| Full suite command | `pnpm typecheck && pnpm test:unit && pnpm test:pipeline` (config `workflow.test_command` is `pnpm typecheck && pnpm test:unit`), plus the touched e2e specs when 5173 is free |

### Phase requirements to test map

| Req | Behaviour | Test type | Automated command | File exists? |
| --- | --- | --- | --- | --- |
| CHECK-01 | Record schema: exact fields, closed verdicts and reasons, both halves and a reviewer for pass and mismatch, PNG path confinement, lock-reference match | unit (pipeline) | `python -B -m unittest tests.pipeline.test_side_by_side_check_records` | no, Wave 0 |
| CHECK-01 | Key content digest: tile, window and table equal their `manifestSha256`-based digest; npc changes when the profile row or model archive changes; skill changes when any component changes; stale-after-fix fires | unit (pipeline) | `python -B -m unittest tests.pipeline.test_side_by_side_key_digest` | no, Wave 0 |
| CHECK-01 | Queue order: waiting keys, then one per class, then census order; gap and unloaded keys excluded | unit (pipeline) | `python -B -m unittest tests.pipeline.test_pair_queue` | no, Wave 0 |
| CHECK-01 | Sandbox slice runner: settings guards, resumable skip, one receipt per key | unit (TS) | `pnpm test:unit -- tests/unit/sandboxHalfCaptures.test.ts` | no, Wave 0 |
| CHECK-01 | `set-environment` reaches the clock through the adapter; `setCameraPose` round-trips the snapshot and refuses out-of-limit values | unit (TS) | `pnpm test:unit -- tests/unit/nativeSliceSetEnvironment.test.ts tests/unit/nativeSliceCameraPose.test.ts` | no, Wave 0 |
| CHECK-01 | Sandbox halves captured at 1440 x 900 on the union, receipts ingested | e2e (slice) | `NATIVE_STORE_ROOT=integration SIDE_BY_SIDE_KIND=npcs SIDE_BY_SIDE_LIMIT=5 pnpm test:e2e tests/browser/side-by-side-npcs.spec.ts` | no, Wave 0 |
| CHECK-01 | Driver: refuses on hash drift, a foreign L2.exe, a bot, a non-Debug l2.ini, or a capture path outside `captures/`; unregisters the task; receipts complete; dry run prints the batch | unit (pipeline, transcript fixtures) | `python -B -m unittest tests.pipeline.test_native_capture_driver tests.pipeline.test_import_native_captures` | no, Wave 0 |
| CHECK-02 | Audio record refuses any verdict other than unverified `listen-needs-owner`; clip receipts carry key, role, package, object and SHA-256 | unit (pipeline) plus e2e slice | `python -B -m unittest tests.pipeline.test_side_by_side_check_records`; `NATIVE_STORE_ROOT=integration pnpm test:e2e tests/browser/side-by-side-audio.spec.ts` | no, Wave 0 |
| CHECK-03 | EVIDENCE docs keep the headings and stay under 30,720 bytes after the Stage A section | unit (TS) | `pnpm test:unit -- tests/unit/laneOwnership.test.ts` | yes |
| CHECK-04 | Each fix has its step's pipeline test; the re-run changes the seal fingerprint and the record history keeps old and new PNG SHA-256 | unit (pipeline) per owning step | `python -B -m unittest tests.pipeline.<owning step test>` | per fix |
| CHECK-05 | Report schema 2, reference block equal to `reference_client_build`, `converted = checked + unverified`, `checked = pass + mismatch`, unknown denominators kept, table verdict through a displaying pair, refusal on imbalance, byte-stable reruns | unit (pipeline) | `python -B -m unittest tests.pipeline.test_coverage_report` | yes (extend) |
| CHECK-05 | Generated report on the union | command | `python -B scripts/native_store/build_coverage_report.py --store-root artifacts/lane-store/integration/l2 --census-lanes world actors data-ui integration --markdown docs/coverage.md` (the 02-55 command, `02-55-SUMMARY.md:87`; flags per `main`, `build_coverage_report.py:277-282`) | n/a |

### Sampling rate

- **Every run** starts with `node scripts/check-machine-schedule.mjs &&`.
- **Per task commit:** the targeted quick command of the touched module (under 30 s), plus `pnpm typecheck` for TS.
- **Per wave merge:** `pnpm typecheck && pnpm test:unit && pnpm test:pipeline`, one full unit run on the machine, and the lane ownership check per `--part`.
- **Phase gate:** the full suite green, the final sweeps on the final union catalog, `pnpm report:coverage` regenerated with balanced stage A counts, and every queued key holding a record. Then `/gsd-verify-work`, which ends human_needed for criteria 1 and 2.

### Wave 0 gaps

- [ ] `tests/pipeline/side_by_side_fixture.py`: synthetic records, receipts and a synthetic union catalog (reuse `catalog_store_fixture.write_store_catalog`)
- [ ] `tests/pipeline/test_side_by_side_check_records.py` (CHECK-01, CHECK-02, CHECK-03)
- [ ] `tests/pipeline/test_side_by_side_key_digest.py` (CHECK-01, P13 and P21)
- [ ] `tests/pipeline/test_pair_queue.py` (P5)
- [ ] `tests/pipeline/fixtures/native-driver-transcripts/*.json`: recorded stdout per remote step, no L2 bytes (D3)
- [ ] `tests/pipeline/test_native_capture_driver.py`, `test_import_native_captures.py` (P10)
- [ ] `tests/unit/sandboxHalfCaptures.test.ts`, `nativeSliceSetEnvironment.test.ts`, `nativeSliceCameraPose.test.ts`
- [ ] Extend `tests/pipeline/test_coverage_report.py` for schema 2 and the stage A invariants (CHECK-05)
- No framework install is needed.

### Manual-only verifications

| Behaviour | Requirement | Why manual | Instructions |
| --- | --- | --- | --- |
| Native halves for the offline Debug batch | CHECK-01 | Needs an owner go-ahead and a free session 1 on IMPORTA-PC | STATE Needs Human line "offline Debug batch": preflight, driver, import, reviewer, cleanup |
| Native halves for ui, the minimap, other tiles and classes | CHECK-01 | Needs the Phase 4 Mobius server | STATE Needs Human line "server batch"; re-opens as a Phase 3 follow-up |
| Listen verdicts | CHECK-02 | Needs the owner's ears | STATE Needs Human line "listen batch" |

## Security domain

`security_enforcement` is absent from `.planning/config.json`, so it is treated as enabled.

| ASVS category | Applies | Standard control |
| --- | --- | --- |
| V2 Authentication | no (ssh keys exist; nothing new) | `ssh -o BatchMode=yes`, key-based |
| V3 Session management | no | - |
| V4 Access control | yes | IMPORTA writes are confined to `debug-control/captures/`; nothing is written in `C:/Lineage2-client`; repository writes are confined via `confined_child_path` and `require_converter_output` |
| V5 Input validation | yes | Exact-field validators for records, receipts and transcripts. Names from decoded `npcname-e` (an untrusted decoded file) are passed as base64 JSON, never interpolated into PowerShell or SendKeys text without an allow-list of characters |
| V6 Cryptography | no new crypto | SHA-256 via `hashlib` and `node:crypto` |

| Threat | STRIDE | Mitigation |
| --- | --- | --- |
| Command injection into the remote PowerShell through key or name text | Tampering | `-EncodedCommand` with base64 JSON data, validated identifiers only |
| A stale or forged native PNG passed off as a native half | Spoofing | The receipt carries the PNG SHA-256 computed on IMPORTA, re-hashed after scp, plus the lock reference and l2.ini before and after |
| A capture path escaping into the repository or the client tree | Tampering | Confinement checks plus a refusal test |
| Disturbing the owner's other client or bot | Denial of service | The preflight refuses a foreign L2.exe or bot. No run in Phase 3 |

## Sources

### Primary (HIGH confidence, read this session)
- `.planning/phases/03-stage-a-checks/03-CONTEXT.md`, `03-PATTERNS.md`; `.planning/REQUIREMENTS.md:82-86`; `.planning/ROADMAP.md:169-178`; `docs/VERIFICATION.md`; `docs/coverage.md`; `STATUS.md`; `docs/NATIVE_PARITY.md:15-24`
- `scripts/native_store/build_coverage_report.py`, `coverage_denominators.py`, `load_check_records.py`, `gap_rows.py`, `catalog_index_keys.py`, `store_paths.py`, `gap_census.py`; `scripts/native_assets_lib/asset_manifest.py:35-39`
- `tests/browser/support/loadCheckRecords.ts`, `loadCheckRecordFile.ts`, `tests/browser/load-sweep-npcs.spec.ts`, `browserViewports.ts`, `nativeSandboxRoute.ts`, `sandbox-equip.spec.ts`; `tests/unit/laneOwnership.test.ts`; `tests/pipeline/test_coverage_report.py`
- `src/runtime/nativeSliceDiagnostics.ts`, `sandboxRuntimeActions.ts`, `worldEnvironmentWiring.ts`; `src/scene/world/lighting/worldEnvironmentClock.ts`; `src/world/worldTypes.ts`; `src/materials/ue2/babylon/material.ts`
- `recipes/reference-client-tree.lock.json` (hosts, class counts, Debug INI, l2.ini, nwindow.dll records); the union catalog `artifacts/lane-store/integration/l2/catalog.json`
- IMPORTA-PC, read-only: `debug-control/CONTROL.md`, `Control-L2.ps1` header, folder listing, hashes, process list, `viewer-layouts/`

### Secondary (background, unverified)
- `C:/laragon/l2b-orchestration/autonomous-roadmap/phase3-feasibility.md`, `phase3-assumptions.md`

### Tertiary
- None. No web sources were needed. The domain is repository-internal.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Nothing new is installed, and versions were read from the repository and tools.
- Architecture: HIGH for records, report and slices (direct analogs). MEDIUM for the driver, which can only be tested on transcripts in this phase.
- Pitfalls: HIGH. Each was observed in the code, the lock or the live IMPORTA state this session.

**Research date:** 2026-11-11
**Valid until:** 2026-11-18, or the next union rebuild or re-lock, whichever comes first
