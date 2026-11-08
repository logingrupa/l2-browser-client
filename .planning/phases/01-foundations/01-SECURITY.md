---
phase: "1"
slug: "foundations"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-11-08"
---

# Phase 1 - Security

> Per-phase security contract: threat register, accepted risks, and audit trail. Register taken from the `<threat_model>` blocks of plans 01-01 to 01-17; no SUMMARY added a threat flag beyond its plan's register. Verified at ASVS level 1 (grep depth), block_on high, on PROMINENCE-PC.

---

## Trust boundaries

| Boundary | Description | Data crossing |
|----------|-------------|---------------|
| Branch name and `--base` to git | user strings reach a child process | git refs |
| `.planning/lanes.json` to the lane check | a lane could widen its own globs | ownership globs |
| Client tree on disk to the walker | names with spaces and `++`, junctions, locked files | file paths, bytes |
| Lock file to the reference client guard | committed JSON decides what conversion may read | hashes, sizes, mtimes |
| DATABASE-PC to IMPORTA-PC over tailnet ssh | remote command execution on the reference machine | walker script on stdin, hash JSON out |
| `/l2/catalog.json` and `asset.json` to browser and Python verifiers | staged structured input | catalog records, manifests |
| URL query (`world`, `authored`, `inspect`) to the router | user strings choose a route | fixed literals |
| `window.__nativeSlice` | page-global read access for e2e specs | local presentation state |
| `--client` and `--client-snapshot` to converters | choose which client tree is read | paths |
| `package.json` scripts | what runs on every machine and lane | commands |
| WorldCommand from the sheet or a future server to the adapter | ids and target ids are untrusted | integers, names |
| WorldEntity fields to presentation and DOM labels | adapter records reach the page | display text |
| Developer text input to the sheet | arbitrary strings become ids | integers, names |
| npm registry to `node_modules` | new third-party packages (01-16) | package code |
| Browser page to the local Inspector CLI bridge | WebSocket on port 4400 | scene data |
| Dev servers | local listeners on 5173 and 5175 | page assets |

---

## Threat register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Tampering / Elevation | `scripts/check-lane-ownership.mjs` git call | medium | mitigate | `execFileSync` with argument arrays (lines 122, 133); `gitReferencePattern` and `laneBranchPattern` (lines 10-11); no shell string | closed |
| T-01-02 | Tampering | `.planning/lanes.json` | low | mitigate | integration lane owns `.planning/**` (`lanes.json:133`), so a lane edit is a foreign path | closed |
| T-01-03 | Tampering / Information disclosure | `hash_reference_client_tree.walk_regular_files` | high | mitigate | `is_reparse_point_or_symlink`, `reject_reparse_ancestors`, `scandir` with `follow_symlinks=False` (lines 22-42); only `open(path, 'rb')`; `tests/pipeline/test_reference_client_tree.py` | closed |
| T-01-04 | Elevation | remote invocation design | high | mitigate | walker root read only from `sys.argv` (line 116), stdlib only, no writes; run as `python -I -B -` on stdin (01-02 and 01-13 summaries) | closed |
| T-01-05 | Tampering | `scripts/reference_client_guard.py` | high | mitigate | missing lock raises; class must be `equal` (line 73); size/mtime change forces re-hash, stale raises (lines 77-81); `..`, absolute, backslash and `:` paths rejected (lines 22-26); `tests/pipeline/test_reference_client_guard.py` | closed |
| T-01-06 | Denial of service | walker on locked files | low | accept | see accepted risks | closed |
| T-01-07 | Tampering | `loadNativeCatalog.ts`, `nativeCatalogIndex.ts` | medium | mitigate | archive path and SHA-256 checks and duplicate id throw (`loadNativeCatalog.ts:14-20`); safe-integer, bounded name and tile checks, duplicate entries throw (`nativeCatalogIndex.ts:22-76`); `readNativeCatalog.test.ts`, `nativeCatalogIndex.test.ts` | closed |
| T-01-08 | Denial of service | catalog memoisation and index size | low | mitigate | one fetch per signal with `throwIfAborted`; index built from loader-capped slices; `readNativeCatalog.test.ts` | closed |
| T-01-09 | Tampering | `loadEnvironment` route selection | low | mitigate | `query.get("world") !== "interlude"`, `query.get("authored") === "1"` (`src/scene/loadEnvironment.ts:76-79`) | closed |
| T-01-10 | Elevation | dynamic import of the authored module | low | mitigate | import specifiers are fixed literals; no query value forms a module path | closed |
| T-01-11 | Information disclosure | `nativeSliceDiagnostics` | low | accept | see accepted risks | closed |
| T-01-12 | Tampering | `loadImportedWorld` manifest validation | low | accept | see accepted risks | closed |
| T-01-13 | Tampering | world converter entry points | high | mitigate | guard after `parse_args`; `tests/pipeline/test_client_entry_points.py` scans every entry point | closed |
| T-01-14 | Tampering | actor, effect and migration entry points | high | mitigate | same scan test: `test_every_client_entry_point_calls_the_reference_client_guard`, `test_scan_flags_a_client_option_without_a_guard_call` | closed |
| T-01-15 | Tampering | dev and build scripts | medium | mitigate | `tests/unit/editorIndependence.test.ts`, `tests/unit/defaultEntryImportGraph.test.ts` | closed |
| T-01-16 | Tampering / Denial of service | adapter dispatch for spawn-npc, equip-item, cast-skill | medium | mitigate | `Number.isSafeInteger` and range checks in `src/world/sandboxCommands.ts:9,42`; `sandboxCommands.test.ts`, `gameWorldAdapterContract.test.ts` | closed |
| T-01-17 | Tampering / Information disclosure | `WorldEntity.modelUrl`, `loadCharacterModel` | medium | mitigate | `modelUrl` has no match in `src/`; assets resolve only through the catalog | closed |
| T-01-18 | Tampering | `readAssetPackage` and `verify_archive` v2 | medium | mitigate | v2 guard clauses in `src/assets/package/readAssetPackage.ts`; `assetPackageContract.test.ts`, `tests/pipeline/test_asset_manifest_v2.py` | closed |
| T-01-19 | Information disclosure / licensing | golden fixtures | high | mitigate | `scripts/generate_golden_fixtures.py` writes synthetic bytes only; byte-for-byte regeneration in `tests/pipeline/test_asset_manifest_v2.py` | closed |
| T-01-20 | Tampering | hash pins under CRLF checkout | medium | mitigate | `.gitattributes`: `recipes/*.lock.json text eol=lf`, `tests/fixtures/golden/** -text`; canonical JSON hashing | closed |
| T-01-21 | Elevation / Tampering | remote hashing over ssh | high | mitigate | tracked walker on stdin to `python -I -B -`, root as a plain argument, no remote writes, key auth from the existing ssh config; no secret in the repo | closed |
| T-01-22 | Tampering | lock integrity | medium | mitigate | lock committed LF; `tests/pipeline/test_reference_client_lock.py` re-checks Engine.dll against `recipes/native-inputs.lock.json` and the walker hash | closed |
| T-01-23 | Denial of service | descriptor XML parsing | low | accept | see accepted risks | closed |
| T-01-24 | Denial of service / Tampering | `createDevIdEntry` validation | medium | mitigate | `^\d{1,9}$` and `^[A-Za-z][A-Za-z0-9_]{0,63}$` (`src/ui/devSheet/devSheetIdEntry.ts:3-4`); `devSheetIdEntry.test.ts` | closed |
| T-01-25 | Tampering (script injection) | `EntityLabel` diagnostic and sheet notes | medium | mitigate | `textContent` only (`src/ui/EntityLabel.ts:31,59`); remaining `innerHTML` uses are static icon markup with no input-derived string | closed |
| T-01-26 | Tampering (architecture erosion) | `src/world` imports | medium | mitigate | `tests/unit/importBoundaries.test.ts` | closed |
| T-01-27 | Information disclosure | Inspector CLI bridge | medium | mitigate | `ShowInspector` calls `_StartInspectable(scene, { autoEnable: false })` inside `@babylonjs/inspector` 9.27.1; Inspector loads only under `inspect=1`; Playwright spec asserts no host other than 127.0.0.1 | closed |
| T-01-28 | Tampering | CDN loading | high | mitigate | Inspector imported from `node_modules` by dynamic import (`src/scene/openBabylonInspector.ts`); no remote script tag; build check keeps it out of the entry chunk (01-16 summary) | closed |
| T-01-29 | Tampering | `inspect` query parameter | low | mitigate | compared to the literal `"1"` (`src/App.ts:39`) | closed |
| T-01-30 | Information disclosure | dev and measurement servers | low | mitigate | `vite --host 127.0.0.1`, `strictPort: true` (`vite.config.ts:46`); Playwright base URL 127.0.0.1 | closed |
| T-01-SC (01-16) | Tampering | pnpm add of Inspector, Babylon peers, React and Fluent | high | mitigate | exact pins in `package.json`; registry legitimacy check recorded as OVERNIGHT-DECISIONS row 39 before install | closed |
| T-01-SC (other plans) | Tampering | npm/pip installs | low | accept | see accepted risks | closed |

*Status: open, closed, or open below the high threshold (non-blocking).*
*Severity: critical > high > medium > low. Only open threats at or above `workflow.security_block_on` count toward `threats_open`.*

---

## Accepted risks log

| Risk ID | Threat ref | Rationale | Accepted by | Date |
|---------|------------|-----------|-------------|------|
| AR-01-01 | T-01-06 | sharing violations are recorded as unreadable rows, never retried | plan 01-02 threat model | 2026-11-08 |
| AR-01-02 | T-01-11 | read-only snapshot of local presentation state in a development client; no secrets or server data | plan 01-05 threat model | 2026-11-08 |
| AR-01-03 | T-01-12 | existing reference world validation unchanged; that route is being deleted (OVERNIGHT-DECISIONS row 42) | plan 01-06 threat model | 2026-11-08 |
| AR-01-04 | T-01-23 | descriptor pinned by SHA-256 before parsing; ElementTree fetches no external entities | plan 01-13 threat model | 2026-11-08 |
| AR-01-05 | T-01-SC (other plans) | those plans install nothing | plan threat models | 2026-11-08 |

---

## Security audit trail

| Audit date | Threats total | Closed | Open | Run by |
|------------|---------------|--------|------|--------|
| 2026-11-08 | 32 | 32 | 0 | gsd-secure-phase, L1 grep depth, auditor skipped by the short-circuit rule |

---

## Sign-off

- [x] All threats have a disposition (mitigate, accept or transfer)
- [x] Accepted risks documented in the accepted risks log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-08
