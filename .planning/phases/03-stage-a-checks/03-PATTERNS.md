# Phase 3: Stage A checks - Pattern map

**Mapped:** 2026-11-11
**Files analyzed:** 12 (new or changed, from 03-CONTEXT.md decisions P1 to P20; names are proposals, the planner may rename within the AGENTS.md code rules)
**Analogs found:** 11 / 12

## File classification

| New or changed file | Role | Data flow | Closest analog | Match quality |
| --- | --- | --- | --- | --- |
| `scripts/native_store/side_by_side_check_records.py` (new, the one validated writer and reader of `docs/parts/<part>/side-by-side-checks.json`) | model / validator | file I/O | `scripts/native_store/load_check_records.py` | exact |
| `tests/browser/support/sideBySideCheckRecordFile.ts` (new, TS reader and atomic writer used by the pair-capture specs) | model / validator | file I/O | `tests/browser/support/loadCheckRecordFile.ts` | exact |
| `tests/browser/support/sandboxHalfCaptures.ts` (new, resumable slice runner for sandbox halves) | utility | batch | `tests/browser/support/loadCheckRecords.ts` | exact |
| `tests/browser/side-by-side-<kind>.spec.ts` (new, one per kind: tiles, npcs, items, skills) | test / runner | batch | `tests/browser/load-sweep-windows.spec.ts` | exact |
| `tests/browser/side-by-side-audio.spec.ts` (new, labelled listen-check clips) | test / runner | streaming | `tests/browser/sandbox-actor-audio.spec.ts` | role-match |
| `src/runtime/nativeSliceDiagnostics.ts` (changed, add camera pose and hour setters, P11) | provider | request-response | itself, `setFlameReplay` and `interactDoor` members | exact |
| `scripts/native_store/build_coverage_report.py` (changed, Stage A exit columns and reference block, P14) | service | batch / transform | itself | exact |
| `scripts/side_by_side/native_capture_driver.py` (new, P10) | service | request-response over ssh | `scripts/native_source_stage.py` `remote_hashes` | role-match |
| `scripts/side_by_side/import_native_captures.py` (new, copy PNGs back with SHA-256, write native halves) | service | file I/O | `scripts/native_source_stage.py` `stage` (scp plus hash verify) | role-match |
| `tests/pipeline/test_side_by_side_check_records.py`, `test_native_capture_driver.py`, extended `test_coverage_report.py` | test | batch | `tests/pipeline/test_coverage_report.py` | exact |
| `docs/parts/<part>/EVIDENCE.md` "Stage A check" section, `docs/coverage.md` "Stage A exit" table (generated) | doc | - | `coverage_markdown` in `build_coverage_report.py` | exact |
| Reviewer verdict prompt or step (fresh-context Claude reviewer, P3) | process | - | none in code | no analog |

## Pattern assignments

### `scripts/native_store/side_by_side_check_records.py` (model, file I/O)

**Analog:** `scripts/native_store/load_check_records.py` (93 lines)

Imports and constants (lines 1-16): frozenset field lists, schema version, size cap, Riga timestamp regex.
```python
from native_store.catalog_writer import CatalogWriteError, refuse_duplicate_json_keys, refuse_non_finite_json_number
from native_store.gap_rows import CATALOG_KEY_PATTERNS
LOAD_CHECK_FILE_SCHEMA_VERSION = 1
LOAD_CHECK_FILE_FIELDS = frozenset({'schemaVersion', 'lane', 'catalogSha256', 'records'})
LOAD_CHECK_RECORD_FIELDS = frozenset({'key', 'status', 'reason', 'atRiga', 'assetManifestSchemaVersion'})
```
Copy for: `SIDE_BY_SIDE_RECORD_FIELDS` (key, verdict, reason, nativeSelection, sandboxHalf, nativeHalf, reviewer, judgedAtRiga, plus the old and new sandbox half SHA-256 history from P18), a closed `UNVERIFIED_REASONS` tuple holding exactly the P1 list, and `VERDICTS = ('pass', 'mismatch', 'unverified')`.

Per-record guard clauses (lines 37-56): exact field set, `is_catalog_key`, status-reason coupling, `is_riga_timestamp`. Map to: pass needs both halves and a reviewer; mismatch needs both halves and a named difference plus suspected step; unverified needs a reason from the closed list; `nativeHalf` is null or a full receipt (lock reference, receipt path and SHA-256, PNG SHA-256, window size).

Strict JSON decode (lines 59-67): size cap, `refuse_duplicate_json_keys`, `refuse_non_finite_json_number`. File-level checks (lines 70-93): exact document fields, schema version, no repeated key, records sorted by key. Reuse `is_catalog_key` and `is_riga_timestamp` by import, do not copy them.

Writing: reuse `native_store.canonical_json.canonical_json_bytes` and `native_store.catalog_writer.replace_file` (used in `build_coverage_report.py` lines 13, 15, 265) so the committed JSON is byte-stable.

Stale rule (P13): a function that compares the record's `sandboxHalf.manifestSha256` with the current catalog's manifest SHA-256 and returns `stale-after-fix`; read the catalog through `native_store.catalog_index_keys.read_measured_catalog` (as `build_coverage_report.py` line 104).

### `tests/browser/support/sideBySideCheckRecordFile.ts` (model, file I/O)

**Analog:** `tests/browser/support/loadCheckRecordFile.ts` (144 lines)

- Types (lines 8-23): readonly interfaces and a literal `schemaVersion: 1`.
- Field and pattern constants (lines 26-40): reuse `catalogKeyPatterns` and `catalogSha256Pattern` by exporting them from one place rather than a second copy (DRY).
- `validateLoadCheckRecord` (lines 59-78): `refuse(problem)` closure producing one clear error; `isPlainObject` and `hasExactlyFields` helpers (lines 42-48).
- `writeFileAtomically` (lines 107-116) and read-merge-sort-write (lines 118-125): one record per key replaced in place, sorted by key, `JSON.stringify(..., null, 2) + "\n"`.
- `servedLaneCatalogSha256` (lines 135-144): the sandbox half's catalog SHA-256 comes from the served `NATIVE_STORE_LANE_CATALOG_SHA256_HEADER`, never from a file read.

The Python module stays the single owner of the schema; the TS side must validate the same fields, and a pipeline test should read a file the TS writer produced (or a shared fixture) so the two cannot drift.

### `tests/browser/support/sandboxHalfCaptures.ts` (utility, batch)

**Analog:** `tests/browser/support/loadCheckRecords.ts` (172 lines)

- Settings from env with guard clauses (lines 58-68): `NATIVE_STORE_ROOT`, a kind env, a limit env in plain decimal; return null to skip.
- Actions interface for testability (lines 31-38) and `runLoadCheckSlice` (lines 113-127): served catalog SHA-256, recorded keys, pending keys sliced by limit, one record written per key.
- Error capture to one line (`firstMessageLine`, lines 96-111): reuse by import.
- Harness settle helper (lines 131-141): `page.on("pageerror")`, `waitForFunction` on the harness state, then `evaluate`.
- `loadCheckSkipReason` (lines 86-90): skip text names the exact command; copy for the pair-capture command.

Queue order (P5) replaces `pendingLoadCheckKeys` (lines 70-72): keys with a load pass on the union catalog, ordered Phase 2 waiting keys, then one per census class, then census order. Keep the ordering a pure function with a Vitest test like the slice functions above.

### `tests/browser/side-by-side-<kind>.spec.ts` (runner, batch)

**Analog:** `tests/browser/load-sweep-windows.spec.ts` (48 lines)

- Top-level `settings` read and `test.skip(settings === null || settings.kind !== kind, ...)` (lines 10-13).
- Per-key fresh page in `try/finally { keyPage.close() }` (lines 27-39).
- `test.setTimeout(sliceTimeout)` and a closing assertion that every checked key was recorded exactly once (lines 41-48).
Add: `page.setViewportSize` to 1440 x 900 from `tests/browser/browserViewports.ts`, the camera pose and hour set through `window.__nativeSlice`, a screenshot to ignored `artifacts/side-by-side/<part>/`, its SHA-256 via `node:crypto`. Harness pages per kind: `native-npc.html`, `native-skill-effect.html`, `native-window.html`, `material-swatch.html`, and `?map=` for tiles.

### `tests/browser/side-by-side-audio.spec.ts` (runner, streaming)

**Analog:** `tests/browser/sandbox-actor-audio.spec.ts` (lines 1-60 read)

- Lane gate by `test.skip(process.env.NATIVE_STORE_ROOT !== laneName, ...)` (lines 26-27).
- Harness drive and poll on `window.__actorAudioHarness.state` (lines 39-53); `expect(pageErrors).toEqual([])`.
- Labelled status string `"audible labelled, owner listening pending"` (line 16): reuse the idea, record `listen-needs-owner` in the check record. Each clip carries package, object, SHA-256, owning key and bundle role (P4). No pass or mismatch is ever written from audio data.

### `src/runtime/nativeSliceDiagnostics.ts` (provider, request-response)

**Analog:** itself (171 lines)

- Setter members on the `diagnostics` object (lines 125-135): `interactDoor` and `setFlameReplay` throw a plain `Error` when the subsystem is unavailable, validate first, then apply. Copy for `setCameraPose({ target, alpha, beta, radius })` and an hour setter delegating to `inputs.environment` (the snapshot already reads `camera` at lines 102-103 and `environment` at line 78).
- Extend the `declare global` `__nativeSlice` type (lines 143-171) with the new optional members.
- Note: the file has no comments; keep it that way. It is 171 lines, room to grow. The camera read-out shape in the snapshot is the same shape the setter takes, so the receipt pose round-trips.
- Needs a Vitest unit test and a Playwright check (UI-affecting).

### `scripts/native_store/build_coverage_report.py` (service, batch)

**Analog:** itself (300 lines; it will pass about 400 with the new columns, so split the Stage A join into a new module, for example `scripts/native_store/stage_a_exit_counts.py`, and import it)

- Report assembly and its validator are symmetric: `build_coverage_report` (lines 103-126) builds, `validate_coverage_report` (lines 165-188) recomputes `parts` from rows and refuses on difference (lines 184-187). Copy that recompute-and-compare for the P14 invariants `converted = checked + unverified` and `checked = pass + mismatch`.
- `COVERAGE_REPORT_FIELDS` and `COVERAGE_ROW_FIELDS` (lines 27-28) and `COVERAGE_REPORT_SCHEMA_VERSION` (line 26): bump the schema version when adding the stage A fields and a `reference` block.
- `count_part_rows` (lines 87-95): add checked, pass, mismatch, unverified by reason; respect `UNKNOWN_DENOMINATOR` (P15).
- Markdown (lines 207-236): `MARKDOWN_TABLE_HEADER`, one row function, rule texts as module constants (`LOADS_RULE_TEXT`). Add a "Stage A exit" header and rule text the same way.
- Reference block (P14): `reference_client_build(lock)` in `scripts/native_assets_lib/asset_manifest.py` lines 35-39 returns `referenceTreeLockSha256` and `engineDllSha256`; never hash the raw lock file (`e314cd11...`).
- Write path guards (lines 239-266): machine schedule refusal, Riga clock check, `report_keeping_unchanged_generation_time`, `replace_file`. Keep as is.

### `scripts/side_by_side/native_capture_driver.py` (service, ssh request-response)

**Analog:** `scripts/native_source_stage.py` `remote_hashes` (lines 106-139)

- Validate every input before building the remote call (lines 107-112, `fleet_alias`, `validate_source_root`).
- Pass data as base64 JSON into a PowerShell program sent with `-EncodedCommand` (lines 114-137); `ssh -o BatchMode=yes -o ConnectTimeout=8`, `capture_output=True, text=True, timeout=..., check=True` (line 138); strip a BOM from stdout (line 139). The `system/l2.ini` protected-hash read (lines 109-110, 134) is the before and after receipt hash.
- Remove the inline `#` comment at line 113 pattern when copying; this repo forbids comments.
- Inject `run_command=subprocess.run` as a parameter the way `build_coverage_report.write_coverage_report` does (lines 257-258, 275), so the unit tests replay recorded transcript fixtures with no L2 bytes and no ssh (P10).
- Refusals as guard clauses with clear errors: pinned SHA-256 of `Control-L2.ps1` and `CONTROL.md` drifted; a foreign L2.exe or the bot holds session 1; write target outside `C:/Lineage2-client-support/debug-control/captures/`.
- `main(argv=None, ..., run_command=subprocess.run)` with argparse and a JSON line on stdout, as `build_coverage_report.main` (lines 275-296).
- Folder `scripts/side_by_side/` is outside the banned `stage_*`, `assets:*`, `derive-*`, `migrate-*` prefixes.

### `scripts/side_by_side/import_native_captures.py` (service, file I/O)

**Analog:** `scripts/native_source_stage.py` `stage` (lines 142-200): scp into a temporary path, hash-verify, then move; protected-file hash read again after copying. Writes only into ignored `artifacts/side-by-side/` and into the check records through the single writer module above.

### Pipeline tests

**Analog:** `tests/pipeline/test_coverage_report.py` (335 lines)

- Path setup (lines 11-13): `ROOT`, `sys.path` inserts for `scripts` and `tests/pipeline`.
- Synthetic fixtures (`tests/pipeline/coverage_census_fixture.py`, `catalog_store_fixture.write_store_catalog`), factory helpers like `load_check_record` and `write_load_check_file` (lines 52-61), fixed Riga timestamps (lines 27-28).
- `unittest.TestCase` with a `tempfile.TemporaryDirectory` project root (lines 68-70).
Add: fixtures for side-by-side records, the converted = checked + unverified refusal, stale-after-fix, and driver transcript fixtures (committed, no L2 bytes, D3).

## Shared patterns

### Strict validation at trust boundaries
**Source:** `scripts/native_store/load_check_records.py` lines 37-93; `tests/browser/support/loadCheckRecordFile.ts` lines 59-92.
**Apply to:** check records, receipts, driver transcripts, import step. Exact field sets, closed enums, sorted unique keys, one error class per module (`LoadCheckRecordError`, `CoverageReportError`).

### Byte-stable writes
**Source:** `canonical_json_bytes` and `replace_file` (`build_coverage_report.py` lines 13, 15, 191-192, 265); TS `writeFileAtomically` (`loadCheckRecordFile.ts` lines 107-116).
**Apply to:** `side-by-side-checks.json`, `coverage.json`.

### Resumable slices keyed by the served catalog
**Source:** `loadCheckRecords.ts` lines 113-127 and `servedLaneCatalogSha256` (`loadCheckRecordFile.ts` lines 135-144).
**Apply to:** sandbox-half captures and audio clips; run with `NATIVE_STORE_ROOT=integration`.

### Injected command runner and machine schedule
**Source:** `build_coverage_report.py` lines 257-261 (`read_machine_schedule`, `require_host_clock_on_riga_time`, `run_command`).
**Apply to:** capture driver, import step, report.

### Riga timestamps
**Source:** `is_riga_timestamp` (`load_check_records.py` lines 27-34) and `formatRigaTimestamp` (`scripts/check-machine-schedule.mjs`, used in `loadCheckRecords.ts` line 170).
**Apply to:** `judgedAtRiga`, capture receipts.

### Closed gap reasons
**Source:** `scripts/native_store/gap_rows.py` (`load_gap_reason_patterns`, `is_listed_reason`) and `recipes/<lane>/gap-reasons.json`.
**Apply to:** P19 unfixable defects; new reasons follow `<domain>-class-unported:<class>` or `<domain>-feature-unported:<property>`.

### EVIDENCE.md size
**Source:** `tests/unit/laneOwnership.test.ts` line 17 (`evidenceDocumentByteLimit = 30_720`).
**Apply to:** every "Stage A check" section; trim older detail first in world, npcs, movement-geodata, skills-effects and adapter-dispatch.

## No analog found

| File | Role | Data flow | Reason |
| --- | --- | --- | --- |
| Reviewer verdict step (P3) | process | - | No code owns verdicts today; the 02-57 reviewer practice is a workflow, not a module. The planner should make the reviewer write through the single record writer with a `reviewer` field, never edit JSON by hand. |

Converter fixes (P17) have no single analog: each lands in its owning step (`scripts/world/convert_tile.py`, `scripts/actors/convert_actors.py`, `scripts/data/convert_ui.py`, `convert_tables.py`) and follows that step's existing pipeline test and seal fingerprint (`scripts/native_store/unit_ledger.py`).

## Metadata

**Analog search scope:** `scripts/native_store/`, `scripts/`, `tests/browser/`, `tests/browser/support/`, `tests/pipeline/`, `src/runtime/`
**Files scanned:** 14
**Pattern extraction date:** 2026-11-11
