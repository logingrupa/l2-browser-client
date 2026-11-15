# Phase 1: Foundations - Research

**Researched:** 2026-11-08
**Domain:** Contracts and tooling for a Babylon.js 9.27.1 WebGPU browser client plus its Python conversion pipeline: Editor removal from the build and runtime path, adapter contract, catalog reader, asset.json v2, reference-tree hash lock, `.dat` inventory, sandbox by-ID commands, lane process files
**Confidence:** HIGH for code shape and repo facts (all read this session), MEDIUM for Babylon Inspector integration (package metadata verified, runtime behaviour on WebGPU unverified), MEDIUM for hashing runtime behaviour on IMPORTA-PC (tooling verified by listing, no hashing run)

## Summary

Phase 1 is mostly a refactor of a working codebase, not greenfield. The Editor dependency is narrower than it looks: only four source files import `babylonjs-editor-tools` (`src/scene/loadEnvironment.ts:34`, `src/scripts.ts:6`, `src/scripts/nativeParity.ts:3`, `src/scripts/world.ts:2`), but the two Editor *scenes* also own the camera, lights, clear colour and fog, and the Editor *script lifecycle* is what starts both runtimes (`NativeParityScript.onStart` calls `createNativeSliceRuntime`; `WorldScript.onStart` calls `createWorldRuntime`). Removing the Editor therefore means: (1) a code-built scene factory with typed presentation config carrying the exact saved values, (2) `loadEnvironment` becoming a router that starts the runtimes itself and registers them with the existing readiness barrier (`registerSceneStartup`), and (3) moving the authored route plus everything Editor-specific behind one `await import()`.

The contract work is additive on the TypeScript side (new `WorldCommand`/`WorldEvent` variants, one catalog reader with an L2-ID index built from the existing v1 catalog, asset.json v2 accepted alongside v1) and additive on the Python side (v2 writer fields, one shared reference-client guard, a tree-hash script, an inventory script). TypeScript 7.0.2 exposes no stable JS compiler API, so every import-graph test uses esbuild 0.28.2 metafiles (already used in `tests/unit/editorScript.test.ts`), plus a plain source-text scan for type-only imports that esbuild erases.

The biggest risk is `@babylonjs/inspector@9.27.1`: it exists at exactly 9.27.1, but it is a React 19 + Fluent UI app with 21 declared peers, none of which (and not the inspector itself) are in the local pnpm store. An offline install is impossible; an online `pnpm add` is required, outside relay windows. The second risk is line endings: `core.autocrlf=true` checks JSON out as CRLF, so any SHA-256 taken over a committed JSON file's working-tree bytes (lock file, fixture lock) differs from the index bytes. Hash canonical JSON, or add `.gitattributes` rules.

**Primary recommendation:** Land Phase 1 as contract-first waves: (W1) process files + adapter contract + import-boundary tests + reference-client guard and lock tooling, (W2) Editor-free scene factory, runtime split and route router with v1-compatible catalog reader, (W3) sandbox by-ID commands and missing-asset diagnostic, asset.json v2 writer, inventory, (W4) Inspector, e2e rewrite and cold-start re-measure. Use esbuild metafiles for every graph assertion, canonical JSON for every committed hash, and never derive a presentation value except from the saved Editor JSON it replaces.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### A. Output contract (FOUND-02)
- `asset.json` gets schemaVersion 2 with `source.path` (host plus absolute path), `clientBuild`, `converterVersion` (the existing `implementation_hash()` of `scripts/native_assets.py`) and `coordinates {unit, sourceUnitsPerMetre, handedness, upAxis, sourceToGltf}`. `provenance.json` inside the archive stays as detailed evidence.
- `clientBuild` = SHA-256 of the committed full-tree lock file plus the Engine.dll SHA-256 (`4dd2f63c...`); both derived, nothing invented.
- The written contract names two entry kinds: `.l2asset` packages, and hash-pinned JSON manifests (sections, movers, profiles, audio, effect components) that reference only hash-addressed files under `/l2/<kind>/<sha>/` and carry the same provenance block. World tiles are not repacked into `.l2asset` (128 MiB limit).
- The existing store in `public\l2` is v1 and cannot be restaged from this worktree (owner rule). Converters write v2 from now on; the browser reader accepts v1 packages until the integration thread restages the store from the main checkout. That restage, and deleting v1 acceptance afterwards, go under Needs Human in STATE.md. (Deviation from the analyzer, which assumed an immediate restage; logged.)
- One validated catalog reader replaces the six separate catalog fetch sites (`loadNativeCatalog.ts`, `loadNativeSection.ts`, `loadNativeWorldAudio.ts`, `nativeEffectComponents.ts`, `loadNativeMovers.ts`, `captureNativeWorld.ts`) and exposes an L2-ID index: `npc:<id>`, `item:<id>`, `skill:<id>:<level>`, `window:<name>`, `tile:<XX_YY>`.
- Golden fixtures: a committed script generates synthetic, format-correct fixtures with no L2 bytes; their SHA-256 values are pinned in a fixture lock and checked by Vitest and pytest. Tests that need the private client stay local and skip when it is absent. Converted L2 binaries never enter git.

#### B. Reference tree lock (FOUND-03)
- Hash every file of both trees (`E:/Lineage2-client` on DATABASE-PC, `C:/Lineage2-client` on IMPORTA-PC) and classify each path: equal, E-only, IMPORTA-only, differing. Conversion may read an E: file only when its path is "equal".
- Volatile files (`l2.ini`, `user.ini`, logs, `.bak`) are listed as differences of class volatile-config that conversion never reads.
- One shared Python guard, called by every `--client` entry point, refuses E: when the lock is missing or stale. Stale = lock missing, or a file's size or mtime differs from the lock record (then re-hash that file), or a re-lock is ordered when Engine.dll or the IMPORTA-PC tree changes.
- The lock is a separate committed `recipes/reference-client-tree.lock.json` (hashes and sizes only). `recipes/native-inputs.lock.json` stays input-only (DEC-OWN-5).
- IMPORTA-PC is hashed by one remote run over the tailnet ssh endpoint above (walk the tree, reject reparse points, as `scripts/native_source_stage.py:106-139` does), at BelowNormal priority, outside the relay windows. The hashing script is tracked so the lock is reproducible.

#### C. `.dat` inventory (FOUND-04)
- Two columns for route: `descriptorLayout` (yes for the 37 tables in `06_interlude.xml`), and `route` = local-decoded (the 8 tables in `scripts/native_catalog/tables.py`), local-layout-only (29), elbera (hairgrp, helmetgrp, hairaccessarygrp, once their parser is confirmed), or none.
- Record counts only from a pinned decode: the 8 local tables now; PORT_SCOPE's Elbera counts shown as Elbera evidence; everything else "unknown". The inventory exists before any further decoding.
- The 8 locked tables are read now; the other 32 are read from E: only after the lock passes.
- Generated JSON plus a table in `docs/parts/data/EVIDENCE.md`, with a test that asserts 40 rows.

#### D. Adapter contract and sandbox commands (ARCH-01..04, SAND-01)
- Contract test: a type-level `expectTypeOf` check that the `GameWorldAdapter` keys are exactly the five method names with their signatures, plus a runtime check that both adapters conform. `WorldEvent` and `WorldCommand` unions are not frozen, but a change to them merges first as a contract branch.
- Spawn NPC, equip item and cast skill become `WorldCommand` variants; both adapters handle them and emit records carrying L2 IDs (`npcId`, equipment by slot, a cast event). Presentation resolves them through the catalog index. Open window is a sheet action only, outside the adapter.
- Missing-asset diagnostic: the entity record still exists, and the scene shows a labelled in-world marker plus a sheet note with the ID and reason. `load-missing-model` and the Fallback Sentinel are deleted.
- Phase 1 distinguishes only "converted" vs "not in catalog"; "unknown ID" arrives with DATA-01.
- Import boundaries: a Vitest check that only runtime composition roots import concrete adapters, and that adapter files and `worldTypes` do not import `@babylonjs`. `src/world/meshNavigation.ts` (presentation-side, imports Babylon) moves out of `src/world`. The frame is metres, Y up, right-handed; the wrong "left-handed" comment goes with the comment cleanup.
- ARCH-01 (no gameplay math, tooltips from server data) and ARCH-04 (presentation-only client behaviour) are recorded as invariants with a check where one is mechanical (for example no import of `.dat` stat fields into tooltip code); they are not new features.

#### E. Native scene built in code (NOED-01..05)
- Camera, lights, clear colour and fog values move from the Editor scene into typed config with identical values (camera alpha -1.8, beta 1.15, radius 4.25, maxZ 100; two lights at 0.65; clear colour [0.49,0.59,0.56]; fog 32-85), each shown on the sheet with status "presentation, formerly Editor-authored, not L2".
- Editor inspector fields in `src/scripts/nativeParity.ts` become typed config carrying the saved values exactly (`Wait_1HS_MFighter`, `leatherShirt` true); the tint and roughness override stays behind `materialOverrideEnabled=false`.
- Default route: the Editor courtyard (`assets/example.scene`, `loadScene` in `src/scene/loadEnvironment.ts`) is retired. The default view keeps its non-Editor content (the reference Talking Island world from `/assets/world/manifest.json` and the converted characters in `public/assets/characters`) on a scene built in code with the same presentation config. `?world=interlude` boots the native catalog sandbox and shows an explicit "store not staged" diagnostic when the catalog is missing. (Deviation from the analyzer's recommendation to delete the Talking Island route and procedural characters: that deletes recent owner-directed work and the analyzer flagged it for owner confirmation, so the reversible choice was taken; logged.)
- `authored=1` lives in one dynamically imported module that alone imports `babylonjs-editor-tools` and `src/scripts.ts`. Courtyard and `authored=1` e2e cases are deleted. A Vitest check on an esbuild metafile proves the static graph of `src/main.ts` excludes them.
- `pnpm dev` and `pnpm build` run `stage-webgpu-compilers` only; `ensure-webgpu-project`, `validate-editor-materials`, `preserve-native-editor-uv2`, `babylonjs-editor-cli pack`, `preserve-native-editor-fog` and `share-native-terrain-export-materials` move to `pnpm generate:editor`. `project.bjseditor` and `pnpm assets:editor` stay, nothing depends on them.
- Babylon Inspector: `@babylonjs/inspector` pinned exactly to the `@babylonjs/core` version, loaded by dynamic import under `?inspect=1`; a metafile test proves it is not statically imported and a Playwright check opens it. If the exact version or its peers cannot be installed offline, record the gap rather than loading it from a CDN.
- Re-measure dev cold start after the Editor pack is removed (ROADMAP verification note); a removed suspect cause is not proof the gap is gone.

#### F. Process files (FOUND-01)
- `STATUS.md` and `DECISIONS.md` at the repo root (AGENTS.md names them bare); `.planning/lanes.json` for ownership.
- `DECISIONS.md`: one dated line per decision ID (DEC-OWN-1..8, DEC-PORT-1..3 and the carried ones), linking to the full text in `.planning/PROJECT.md`, which stays the text GSD reads.
- Ownership by lane, not by role: L1 world, L2 actors, L3 data + UI, integration. Integration owns `package.json`, the catalog writer, `src/runtime/**` and the status files. A check script compares a branch's diff against its lane's globs. (Role globs from PORT_SCOPE would overlap `scripts/**` between L1 and L2.)
- Parts = PORT_SCOPE section 5 parts as slugs, each owned by one lane, one `docs/parts/<part>/EVIDENCE.md` per part.

#### Execution constraints (CONTEXT `<domain>`, binding on every plan)
- Work only in this worktree `C:\Users\rolan\.t3\worktrees\l2-browser-client\autonomous-roadmap` (branch `plan/autonomous-roadmap`). `public\l2` is a read-only junction to the main checkout's 2.4 GB native store. Never run `assets:*`, `world:stage`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*` or preview scripts against the main checkout or `public\l2`. Never `git worktree remove` this tree.
- Dev server: `pnpm dev --port 5175`. `pnpm test:e2e` uses port 5173; run it only while nothing listens on 5173.
- DATABASE-PC relays a livestream Sun 10:00-14:00 and Thu 19:00-21:30 Riga: no builds, dev servers, tests, installs, hashing or conversions then. Heavy commands at BelowNormal priority.
- After every plan and verification, stop the dev servers, browsers, e2e runners and Vitest workers you started, by PID or by a command line holding this worktree path or port, never by image name.
- IMPORTA-PC: `ssh -p 2026 rolan@importa-pc.tail40ecb2.ts.net` (bash shell, `sha256sum`, `pwsh`, Python 3.11 available). Both client trees are read-only.
- Commit only on this branch; no push, no merge.

### Claude's Discretion
- Plan split, wave order and file layout, within AGENTS.md code rules (no comments, full-word names, files under about 400 lines, Vitest per behaviour change, Playwright for UI, no dead code).
- Whether the hash lock JSON is one file or a compact per-folder layout, as long as it is committed, deterministic and under a sensible size.

### Deferred Ideas (OUT OF SCOPE)
- Restaging `public\l2` to asset.json v2 and deleting v1 reader acceptance: integration thread in the main checkout (Needs Human).
- Removing `NativeSliceAdapter.subscribeCommands` by moving the Power Strike trigger onto `WorldEvent`: only if the contract work makes it free; otherwise Phase 2 integration.
- Rejecting unknown IDs (vs not converted): DATA-01, Phase 2.
- Decoding the 29 layout-only tables and the Elbera-only tables: DATA-01, DATA-02, Phase 2.
- Deleting the reference Talking Island route and the procedural characters: owner decision (logged).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | STATUS.md, DECISIONS.md, `.planning/lanes.json`, `docs/parts/<part>/EVIDENCE.md`, lane rules | "Process files" pattern; none of the four exist yet (verified `ls`); PORT_SCOPE section 5 gives 19 parts; ownership check grammar restricted to `dir/**` + exact paths |
| FOUND-02 | Output contract written and testable, golden fixtures | asset.json v1 shape (`readAssetPackage.ts:2-16`, `native_assets.py:674-686`), `SOURCE_TO_GLTF` determinant gives handedness, v1/v2 dual acceptance sites (3 TS, 1 Python verifier), canonical-JSON hashing pitfall |
| FOUND-03 | Full-tree hash lock E: vs IMPORTA-PC, guard refuses E: | Tree facts (5,629 files / 7,814,256,191 bytes on IMPORTA; 9,737 files on E:), Python walker pattern with reparse rejection and BelowNormal priority, ~20 `--client` entry points, stdin-piped remote run |
| FOUND-04 | 40-table inventory | Descriptor parse (37 active links, 3 commented), 8 local tables and their locked inputs in the main checkout, Elbera counts from PORT_SCOPE, case-insensitive pattern matching |
| ARCH-01 | No client gameplay math; tooltips from server data | Mechanical check: text scan that `src/ui/**` imports no decoded `weapongrp`/`armorgrp`/`skillgrp` module; invariant line in contract doc |
| ARCH-02 | Five frozen methods, typed records, no Babylon types | `expectTypeOf` on `GameWorldAdapter` (checked by `pnpm typecheck`), runtime conformance test, esbuild graph + text scan for `@babylonjs` in `src/world/**` |
| ARCH-03 | Visible missing-resource diagnostics, no stand-ins, readiness barrier kept | Delete `load-missing-model`/Fallback Sentinel/`modelUrl` path; label-only in-world marker via existing `EntityLabel`; `registerSceneStartup` reused by code-built routes |
| ARCH-04 | Client-owned behaviour stays in presentation | Invariant doc; adapter boundary test; asset resolution via catalog index outside adapters |
| SAND-01 | Spawn NPC, equip item, cast skill, open window by ID; missing-asset diagnostic | New `WorldCommand`/`WorldEvent` variants, catalog L2-ID index built from v1 catalog fields, DevSheet needs a new ID-entry control (no text input exists today) |
| NOED-01 | Native route boots without Editor scene; typed config on sheet; `authored=1` via dynamic import | Exact saved values extracted (camera, lights, clear colour, fog mode 0, script fields); runtime split plan for the 914-line file; injected world source for authored route |
| NOED-02 | dev/build run only `stage-webgpu-compilers`; test fails on static Editor import | `package.json` scripts; esbuild metafile static-closure walker following only `import-statement` edges |
| NOED-03 | Courtyard retired | Courtyard-dependent unit tests and e2e specs listed with replacement coverage |
| NOED-04 | Inspector behind `?inspect=1`, pinned to core version | `@babylonjs/inspector@9.27.1` exists; 21 peers; not in local store; `ShowInspector` starts the CLI bridge with `autoEnable: false` |
| NOED-05 | Editor stays optional viewer; no test, build, lane or gate depends on it | Editor-only unit tests moved to a separate `test:editor` Vitest config excluded from `test:unit` |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

These are binding; the planner must verify every plan against them.

- Decisions: `.planning/PROJECT.md` (DEC-OWN-1..8) and `docs/PORT_SCOPE.md` win over every other doc.
- Source fidelity: never invent Lineage II values; every value comes from IMPORTA-PC `C:/Lineage2-client` through a pinned recipe or script and records its source. E: is a conversion source only after the full-tree hash lock. Unresolved values stay visibly unresolved; no procedural stand-ins on the native route.
- Server boundary: gameplay state enters only through `GameWorldAdapter`; the client never computes damage, stats, quest or progression outcomes.
- Lanes: at most 3 plus integration; branch `<part>/<slug>`; lanes never run native-store writers (`assets:*`, `world:stage`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*`, preview scripts); lanes start from committed code; one branch merged at a time; contract changes merge first.
- Build: Editor not in the build path; no Editor steps in `pnpm dev`/`pnpm build`; `stage-webgpu-compilers` stays.
- Docs: one `docs/parts/<part>/EVIDENCE.md` per part under about 30 KB; `STATUS.md` one line per part rewritten in place; `DECISIONS.md` append-only, one dated line each; no new continuation or handoff prompts.
- Git: commit on own branch; never push or merge without the owner.
- Code: no dead code (delete in the same change that makes it unused); DRY, single responsibility; no speculative abstractions or compatibility shims for paths that no longer exist; **no comments in code, ever** (only bare `@ts-expect-error`, named-rule `eslint-disable-next-line`, shebang); full-word names; when touching a file remove every comment in the whole file and rename what they explained; fix root causes, no retries/sleeps/tolerances; validate at trust boundaries with guard clauses; files under about 400 lines; TS strict, no `any`, pnpm only; every behaviour change ships a Vitest test, UI changes also a Playwright check; "done" needs a passing test or screenshot; TODO only with a requirement ID; plain hyphens, no em/en dashes, sentence-case headings in human-readable text.
- Test process cleanup: stop started dev servers, browsers, e2e runners, Vitest workers by PID or by command line holding the worktree path/port, never by image name; check before a done claim.
- Machine schedule: nothing heavy in the relay windows; BelowNormal priority for heavy commands.
- Project skills: none (`.claude/skills` and `.agents/skills` absent, verified).

Note on the comment rule: `vite.config.ts`, `src/main.ts`, `src/App.ts`, `src/scene/loadEnvironment.ts`, `src/world/*.ts`, `src/runtime/*.ts`, `scripts/native_assets.py`, `scripts/native_source_stage.py`, `scripts/native_catalog/tables.py` and `src/assets/package/readAssetPackage.ts` all carry comments today. Every plan task that touches one of them must budget for full-file comment removal and the renames those comments were explaining.

## Architectural Responsibility Map

| Capability | Primary tier | Secondary tier | Rationale |
|------------|-------------|----------------|-----------|
| Reference-tree hashing and lock | Pipeline (Python, DATABASE-PC + IMPORTA-PC over ssh) | Repo (`recipes/`) | Source identity is a converter-side concern; the browser never sees source paths |
| E: refusal guard | Pipeline (shared Python module) | - | Every `--client` entry point is Python |
| asset.json v2 writer | Pipeline (`native_assets.py`) | Browser reader (accepts v1 and v2) | Writer owns provenance; reader validates at the trust boundary |
| `.dat` inventory | Pipeline (generator script) | Docs (`docs/parts/data/EVIDENCE.md`) | Counts come only from pinned decodes |
| Catalog reader + L2-ID index | Browser (`src/assets/native/`) | - | One validated trust-boundary reader replacing 7 fetch sites |
| Scene construction (camera, lights, fog) | Browser presentation (`src/scene/`) | Typed config module | Presentation values, formerly Editor-authored, not L2 |
| Runtime composition (adapter + registry + sheet) | Browser (`src/runtime/**`, integration-owned) | - | Only composition roots may construct concrete adapters |
| Gameplay state (spawn, equip, cast records) | Adapter tier (`src/world/**`, Babylon-free) | - | ARCH-02 boundary |
| Asset resolution of L2 IDs | Browser presentation | Catalog index | ARCH-04: resolution stays outside adapters |
| Babylon Inspector | Browser, lazy chunk | - | Developer tool, absent from default bundle |
| Lane ownership check | Repo tooling (node or Python script) | `.planning/lanes.json` | Integration-owned process file |

## Standard Stack

### Core (installed, verified from `node_modules/*/package.json` this session)

| Library | Version | Purpose | Why standard |
|---------|---------|---------|--------------|
| `@babylonjs/core` | 9.27.1 | Engine, WebGPU | Locked stack (PROJECT.md) |
| `vite` | 7.3.7 | Dev server and build | Locked stack |
| `vitest` | 5.1.0 | Unit tests; re-exports `expectTypeOf` from `expect-type` (`node_modules/vitest/dist/index.d.ts:14`) | Locked stack |
| `esbuild` | 0.28.2 | Import-graph tests via `metafile` | Already used by `tests/unit/editorScript.test.ts`; `Metafile.inputs[path].imports[].kind` is typed `ImportKind` with `'import-statement' \| 'dynamic-import' \| ...` (`node_modules/esbuild/lib/main.d.ts:398-410`); `packages?: 'bundle' \| 'external'` (`:134`) |
| `typescript` | 7.0.2 | `pnpm typecheck` only | Its `.` export is `./lib/version.cjs` (version string only); all compiler APIs are under `./unstable/*` and talk to the native binary over IPC (`node_modules/typescript/package.json` exports). Not usable for import-graph tests |
| `@playwright/test` | 1.64.1 | Browser checks (port 5173, SwiftShader WebGPU flags in `playwright.config.ts`) | Locked stack |
| Python | 3.12.6 (DATABASE-PC), 3.11.9 (IMPORTA-PC) | Pipeline, hashing | `hashlib.file_digest` needs 3.11+, both satisfy |

### Supporting (to install for NOED-04)

| Library | Version | Purpose | When to use |
|---------|---------|---------|-------------|
| `@babylonjs/inspector` | 9.27.1 exact | `ShowInspector(scene)` | Only under `?inspect=1`, via `await import()` |
| `@babylonjs/gui-editor`, `@babylonjs/materials`, `@babylonjs/serializers`, `@babylonjs/node-editor`, `@babylonjs/node-geometry-editor`, `@babylonjs/node-particle-editor`, `@babylonjs/node-render-graph-editor` | 9.27.1 exact each (all verified published at 9.27.1) | Inspector peers (static and dynamic imports inside the inspector chunk) | Pin explicitly; otherwise `autoInstallPeers: true` resolves `^9.0.0` to 9.35.0 and mixes Babylon versions |
| `react`, `react-dom` | `>=16.14.0 <20.0.0` peer; latest 19.3.1 | Inspector UI | Let pnpm resolve, then pin the resolved version exactly |
| `@fluentui/react-components` (^9.70.0, latest 9.75.1), `@fluentui/react-icons` (^2.0.310), `@fluentui/react-utilities` (^9.26.2), `@fluentui/react-motion-components-preview` (^0.15.2), `@fluentui-contrib/react-virtualizer` (^1.0.0), `@fluentui-contrib/react-resize-handle` (^0.8.4), `usehooks-ts` (^3.1.1) | resolved at install, then pinned | Inspector UI | Same |

`@babylonjs/lite` is the only optional peer (`peerDependenciesMeta = { '@babylonjs/lite': { optional: true } }`); skip it.

### Alternatives considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| esbuild metafile graph test | TypeScript 7 `unstable/sync` API | Unstable, spawns the native compiler over IPC; rejected |
| esbuild metafile graph test | Vite build manifest | Needs a full build per test run (slow, BelowNormal rules); metafile is in-memory and seconds |
| Python tree walker | `sha256sum` + `find` in MSYS bash | MSYS `find -type l` does not see Windows junctions; no reparse-point rejection; path quoting with spaces |
| Python tree walker | Existing PowerShell encoded-command pattern | 24 files per call design; would need 235+ ssh calls for 5,629 files; Python pipeline preferred by owner |

**Installation (NOED-04, outside relay windows, BelowNormal):**
```bash
pnpm add -E @babylonjs/inspector@9.27.1 @babylonjs/gui-editor@9.27.1 @babylonjs/materials@9.27.1 @babylonjs/serializers@9.27.1 @babylonjs/node-editor@9.27.1 @babylonjs/node-geometry-editor@9.27.1 @babylonjs/node-particle-editor@9.27.1 @babylonjs/node-render-graph-editor@9.27.1
```
Then pin the auto-installed React/Fluent peers that pnpm resolved, exactly, in `package.json`, and commit `package.json` + `pnpm-lock.yaml` as their own commit.

**Version verification (run this session):** `pnpm view @babylonjs/inspector@9.27.1 version` returned `9.27.1` (published 2026-09-18T13:55:49Z; `latest` dist-tag is 9.35.0). Each of the seven Babylon peers returned `9.27.1`. `@babylonjs/shared-ui-components` is bundled inside the inspector `lib/` (no separate dependency).

## Package Legitimacy Audit

`gsd-tools query package-legitimacy check --ecosystem npm` was run on all packages below. Every `SUS` verdict carries the single reason `too-new`, which the seam computes from the *latest* publish date (Babylon released 9.35.0 on 2026-11-06; React 19.3.1 on 2026-10-14). The pinned 9.27.1 Babylon versions are 7 weeks old. All Babylon packages point at `git+https://github.com/BabylonJS/Babylon.js.git`, no postinstall scripts.

| Package | Registry | Latest published | Weekly downloads | Source repo | Verdict | Disposition |
|---------|----------|------------------|------------------|-------------|---------|-------------|
| @babylonjs/inspector | npm | 2026-11-06 (pinned 9.27.1: 2026-09-18) | 52,347 | BabylonJS/Babylon.js | SUS (too-new) | Flagged, checkpoint before install |
| @babylonjs/gui-editor | npm | 2026-11-06 | 51,890 | BabylonJS/Babylon.js | SUS (too-new) | Flagged |
| @babylonjs/materials | npm | 2026-11-06 | 109,081 | BabylonJS/Babylon.js | SUS (too-new) | Flagged |
| @babylonjs/serializers | npm | 2026-11-06 | 65,138 | BabylonJS/Babylon.js | SUS (too-new) | Flagged |
| @babylonjs/node-editor | npm | 2026-11-06 | 14,228 | BabylonJS/Babylon.js | SUS (too-new) | Flagged |
| @babylonjs/node-geometry-editor | npm | 2026-11-06 | 12,070 | BabylonJS/Babylon.js | SUS (too-new) | Flagged |
| @babylonjs/node-particle-editor | npm | 2026-11-06 | 11,571 | BabylonJS/Babylon.js | SUS (too-new) | Flagged |
| @babylonjs/node-render-graph-editor | npm | 2026-11-06 | 11,807 | BabylonJS/Babylon.js | SUS (too-new) | Flagged |
| react | npm | 2026-10-14 | 252,355,743 | facebook/react | SUS (too-new) | Flagged |
| react-dom | npm | 2026-10-14 | 236,823,583 | facebook/react | SUS (too-new) | Flagged |
| @fluentui/react-components | npm | 2026-11-02 | 686,631 | microsoft/fluentui | SUS (too-new) | Flagged |
| @fluentui/react-icons | npm | 2026-10-30 | 985,853 | microsoft/fluentui | SUS (too-new) | Flagged |
| @fluentui/react-utilities | npm | 2026-10-19 | 733,078 | microsoft/fluentui | SUS (too-new) | Flagged |
| @fluentui/react-motion-components-preview | npm | 2026-10-19 | 695,309 | microsoft/fluentui | SUS (too-new) | Flagged |
| usehooks-ts | npm | 2025-02-05 | 8,744,463 | - | OK | Approved |
| @fluentui-contrib/react-virtualizer | npm | 2026-03-03 | 28,799 | - | OK | Approved |
| @fluentui-contrib/react-resize-handle | npm | 2026-03-06 | 18,456 | - | OK | Approved |

**Packages removed due to SLOP verdict:** none.
**Packages flagged as suspicious (SUS):** the 14 above. Every package name came from the inspector's own `peerDependencies` (`pnpm view @babylonjs/inspector@9.27.1 peerDependencies`) and from the import specifiers inside its published `lib/index-CZ1-Y-Rv.js`, not from search. Per protocol the planner inserts one `checkpoint:human-verify` before the install task. Owner is away (yolo mode): the checkpoint should record "same-vendor peers of an official Babylon package, flagged only by latest-release recency" in OVERNIGHT-DECISIONS.md and proceed, or record the NOED-04 gap if the owner rule is read as "offline only" (see Open question 1).

## Architecture Patterns

### System architecture diagram

```
                       URL (?world=, ?authored=, ?inspect=, ?character=)
                                        |
                                 src/main.ts -> App
                                        |
                               loadEnvironment (router, no Editor import)
             +--------------------------+-----------------------------+
             |                          |                             |
   default route                 ?world=interlude              ?world=interlude&authored=1
   buildReferenceScene()         buildNativeSandboxScene()     await import(authoredNativeWorld)
   (camera/lights/fog from       (camera/lights/fog from        -> babylonjs-editor-tools loadScene
    typed presentation config)    typed presentation config)    -> src/scripts.ts -> NativeParityScript
             |                          |                             |
   createWorldRuntime            createNativeSliceRuntime(scene, camera, settings, worldSource)
   MockWorldAdapter              NativeSliceAdapter       <- worldSource = loadNativeSection | authored section
             |                          |
             +------------+-------------+
                          v
        GameWorldAdapter (5 frozen methods)  <-- WorldCommand: spawn-npc / equip-item / cast-skill / ...
                          |  WorldEvent: spawn(entity{npcId}) / update(entity{equipment by slot}) / skill-cast
                          v
        EntityRegistry + presentation resolvers ---- NativeCatalogIndex (npc:, item:, skill:, window:, tile:)
                          |                                     ^
                          |                    one catalog reader (fetch /l2/catalog.json once, validate v1)
                          v
        found -> load .l2asset (verify SHA-256, accept asset.json v1|v2)
        not in catalog -> entity kept, label-only in-world marker + sheet note (id, reason)
                          |
        registerSceneStartup -> prepareSceneForReveal (readiness barrier) -> reveal
                          |
        ?inspect=1 -> await import(@babylonjs/inspector) -> ShowInspector(scene)   (lazy chunk)

 Pipeline side (Python):
   hash_reference_client_tree.py --(stdin over ssh)--> IMPORTA-PC C:/Lineage2-client  -> manifest JSON
   hash_reference_client_tree.py (local)            --> DATABASE-PC E:/Lineage2-client -> manifest JSON
   lock builder: classify equal | E-only | IMPORTA-only | differing | volatile-config -> recipes/reference-client-tree.lock.json
   every --client entry point -> reference_client_guard.require_reference_client(root) -> refuses E: if missing/stale
   native_assets.py -> asset.json v2 {source.path, clientBuild, converterVersion, coordinates}
   dat inventory generator -> recipes or docs JSON (40 rows) -> docs/parts/data/EVIDENCE.md table
```

### Recommended project structure (new and moved files only)

```
src/
  scene/
    loadEnvironment.ts               router only; no babylonjs-editor-tools, no ../scripts
    presentationConfiguration.ts      typed camera/lights/clear/fog values (plain data, no Babylon imports)
    buildPresentationScene.ts         applies config to a new Scene (ArcRotateCamera "World camera", two lights)
    authoredNativeWorld.ts            ONLY module importing babylonjs-editor-tools and ../scripts (dynamic import target)
    openBabylonInspector.ts           ONLY module importing @babylonjs/inspector (dynamic import target)
    navigation/meshNavigation.ts      moved out of src/world (imports Babylon)
  runtime/                            integration-owned composition roots
    createNativeSliceRuntime.ts       composition only (target < 400 lines)
    nativeSandboxConfiguration.ts     saved script values (Wait_1HS_MFighter, leatherShirt true, ...)
    loadNativeSliceWorld.ts           section, movers, navigation, flames, sky
    loadNativeSliceAudio.ts           footstep, stepsound, deco-grass, world and combat audio
    createNativeSliceEffects.ts       effect components, init, shot, power strike
    attachNativeSliceSheet*.ts        sheet sections split per tab
    nativeSliceDiagnostics.ts         window.__nativeSlice + declare global
    sandboxCommands.ts                by-ID sheet actions (spawn, equip, cast, open window)
  assets/native/
    readNativeCatalog.ts              the one catalog reader (fetch + validate + memoize per signal)
    nativeCatalogIndex.ts             L2-ID index
  world/                              Babylon-free: GameWorldAdapter, worldTypes, adapters, WorldNavigation types
scripts/
  hash_reference_client_tree.py       walker, stdlib only, runs on both hosts
  build_reference_client_lock.py      classify two manifests -> lock (or one CLI with subcommands)
  reference_client_guard.py           shared guard imported by every --client entry point
  build_dat_table_inventory.py        40-row inventory
  generate_golden_fixtures.py         synthetic fixtures, no L2 bytes (or a .mjs twin for TS fixtures)
recipes/
  reference-client-tree.lock.json
docs/
  OUTPUT_CONTRACT.md                  written contract (or a section of ARCHITECTURE.md)
  parts/<part>/EVIDENCE.md
STATUS.md, DECISIONS.md, .planning/lanes.json
tests/fixtures/golden/ + fixture lock
```

### Pattern 1: Code-built scene from saved Editor values (NOED-01, NOED-03)

**What:** A typed, Babylon-free config module carries every non-default value the Editor serialized; a small builder applies it.
**Exact saved values (read this session):**

Native route, `assets/native-parity.scene/cameras/World camera.json` [VERIFIED: file read]: `"type": "ArcRotateCamera"`, `alpha -1.7999999999999998`, `beta 1.15`, `radius 4.25`, `target [0.6, 0.15, 0]`, `minZ 0.005`, `maxZ 100`, `fov 0.9`, `fovMode 1`, `lowerRadiusLimit 0.4`, `upperRadiusLimit 10`, `lowerBetaLimit 0.35`, `upperBetaLimit 1.45`, `inertia 0.7`, `panningInertia 0.9`, `speed 2`, `pinchToPanMaxDistance 20`, `allowUpsideDown True`.

Default route, `assets/example.scene/cameras/world-camera.json` [VERIFIED]: `alpha -1.5707963267948966`, `beta 1.05`, `radius 26`, `target [0, 0.8, 1]`, `minZ 0.1`, `maxZ 250`, `fov 0.9`, `lowerRadiusLimit 10`, `upperRadiusLimit 38`, `lowerBetaLimit 0.35`, `upperBetaLimit 1.45`, `inertia 0.7`. The Talking Island path then overrides at runtime (`loadEnvironment.ts:74-82`): clear colour `0.58, 0.71, 0.8, 1`, `alpha -Math.PI / 2.5`, `beta 1.1`, `radius 8`, `lowerRadiusLimit 1`, `upperRadiusLimit 50`, `minZ 0.05`, `maxZ 4000`.

Lights, identical in both scenes [VERIFIED]: `"Sky light"` `type 3` (hemispheric) `intensity 0.65`, `direction [0, 1, 0]`, `diffuse [1, 1, 1]`, `specular [1, 1, 1]`, `groundColor [0.2980392156862745, 0.34509803921568627, 0.30196078431372547]`; `"Sunlight"` `type 1` (directional) `intensity 0.65`, `direction [-0.5, -1, 0.6]`, `position [12, 25, -12]`, `diffuse [1, 0.9411764705882353, 0.807843137254902]`, `specular [1, 1, 1]`.

Scene config [VERIFIED: `config.json` of both scenes]: `clearColor [0.49, 0.59, 0.56, 1]`, `ambientColor [0, 0, 0]`; fog `fogStart 32`, `fogEnd 85`, `fogDensity 0.006`, `fogColor [0.49, 0.59, 0.56]`. **Fog mode differs:** native-parity `"fogEnabled": true, "fogMode": 0` (FOGMODE_NONE, so no fog renders); example `"fogMode": 3` (linear). `tests/browser/nativeSlice.spec.ts:193` asserts `initial.fog?.mode` is `0` on the native route.

Script values, `assets/native-parity.scene/config.json` `metadata.scripts[0].values` [VERIFIED]: `leatherShirt true`, `origin [0, 0, 0]`, `fighterIdle "Wait_1HS_MFighter"`, `fighterRun "Run_Hand_MFighter"`, `fighterAttack "Atk01_Hand_MFighter"`, `fighterDeath "Death_MFighter"`, `materialOverrideEnabled false`, `materialEntityId "local-player"`, `materialSource "MFighter.UpBody.MFighter_m001_t04_u"`, `materialTint [0.45, 1, 0.6]`, `materialRoughness 0.45`. **Not saved** (code defaults from `src/scripts/nativeParity.ts:10-30` apply): `playerProfileId "human-male-fighter"`, `flamePreviewEnabled true`, `flameTextureSeconds 0`, `flameFadeSeconds 0`, `flameTextureRate 1`, `flameFadeRate 1`.

**When to use:** both code-built routes. The authored route keeps reading its own Editor scene.
**Parity test:** while `assets/native-parity.scene` stays in the tree, a Vitest test reads those JSON files and asserts the typed config equals them field by field; delete the test in the same commit that deletes the scene folder (if ever). `tests/browser/nativeSlice.spec.ts:38-67` (`authoredState()` reads `assets/native-parity.scene/config.json` and `cameras/`) must be rewritten to import the typed config instead.

### Pattern 2: Router plus injected world source (NOED-01)

`createNativeSliceRuntime` currently couples to the Editor in four places: `:96` requires `scene.getCameraByName("World camera")`, `:174` `restoreEditorAuthoredMaterials`, `:176` `attachAuthoredNativeSection`, `:143,:205-207` hides the authored courtyard meshes, plus `:181-191` mirrors an authored left-handed camera. Pass the camera in explicitly and inject a `worldSource` (the default is `loadNativeSection`; the authored module passes a source that runs `restoreEditorAuthoredMaterials` + `attachAuthoredNativeSection` and owns the camera mirror). Then `src/editor/restoreEditorAuthoredMaterials.ts` and `src/scene/world/loadAuthoredNativeSection.ts` are reachable only from `authoredNativeWorld.ts`. The code-built native scene has no courtyard meshes, so the hide/restore loop goes from the default path.

Runtime startup without Editor scripts: the router calls `requireSceneStartup(scene, "native-world")`, starts the runtime itself and calls `registerSceneStartup(scene, "native-world", ready)` (`src/scene/prepareSceneForReveal.ts:16-23`), the same contract `NativeParityScript.onStart` uses today (`src/scripts/nativeParity.ts:43-53`). `App.ts` and `prepareSceneForReveal` stay unchanged.

`src/scripts/nativeParity.ts` stays as the Editor script for `authored=1` only; its field initializers read from `nativeSandboxConfiguration` so the saved values live in one place (DRY). `src/scripts/world.ts` and `assets/example.scene` go with the courtyard; `src/scripts.ts` is regenerated by `babylonjs-editor-cli pack` (its `createScriptsFile` writes `src/scripts.ts`, verified in `node_modules/babylonjs-editor-cli/build/index.node.js`), so `pnpm generate:editor` after deleting `world.ts` rewrites it; until then the tracked file must be edited to drop the `world` entry or the Editor-path typecheck fails.

### Pattern 3: Static import graph via esbuild metafile (NOED-02, NOED-04, ARCH-02)

```typescript
import { build, type Metafile } from "esbuild";

async function staticClosureOfEntry(entryPoint: string): Promise<{ modules: Set<string>; packages: Set<string> }> {
  const result = await build({
    entryPoints: [entryPoint], bundle: true, write: false, metafile: true,
    packages: "external", platform: "browser", format: "esm", target: "es2022",
    loader: { ".css": "empty" }, logLevel: "silent",
  });
  const inputs: Metafile["inputs"] = result.metafile.inputs;
  const modules = new Set<string>(), packages = new Set<string>();
  const pending = Object.keys(inputs).filter(path => path.endsWith(entryPoint.replace(/^\.\//, "")));
  while (pending.length) {
    const path = pending.pop()!;
    if (modules.has(path)) continue;
    modules.add(path);
    for (const edge of inputs[path]?.imports ?? []) {
      if (edge.kind !== "import-statement") continue;
      if (edge.external) packages.add(edge.path); else pending.push(edge.path);
    }
  }
  return { modules, packages };
}
```
Assertions: `packages` has no entry starting with `babylonjs-editor-tools` or `@babylonjs/inspector`; `modules` contains no `src/scripts.ts`, `src/scripts/`, `src/editor/`, `loadAuthoredNativeSection.ts`. `packages: "external"` keeps the run fast and means the test passes even before `@babylonjs/inspector` is installed (dynamic imports of a missing external package are not resolved). Remember esbuild elides type-only imports, so the "no Babylon types in `src/world`" rule needs a text scan too (Pattern 4).

### Pattern 4: Adapter contract test (ARCH-02)

```typescript
import { describe, expect, expectTypeOf, it } from "vitest";
import type { GameWorldAdapter } from "../../src/world/GameWorldAdapter";
import type { WorldCommand, WorldEntity, WorldEvent } from "../../src/world/worldTypes";

describe("GameWorldAdapter contract", () => {
  it("keeps exactly the five frozen methods", () => {
    expectTypeOf<keyof GameWorldAdapter>().toEqualTypeOf<"getInitialState" | "subscribe" | "dispatch" | "advance" | "dispose">();
    expectTypeOf<GameWorldAdapter["getInitialState"]>().toEqualTypeOf<() => readonly WorldEntity[]>();
    expectTypeOf<GameWorldAdapter["subscribe"]>().toEqualTypeOf<(listener: (event: WorldEvent) => void) => () => void>();
    expectTypeOf<GameWorldAdapter["dispatch"]>().toEqualTypeOf<(command: WorldCommand) => void>();
    expectTypeOf<GameWorldAdapter["advance"]>().toEqualTypeOf<(deltaTimeSeconds: number) => void>();
    expectTypeOf<GameWorldAdapter["dispose"]>().toEqualTypeOf<() => void>();
  });
});
```
The signatures above are copied from `src/world/GameWorldAdapter.ts:8-15` [VERIFIED]. `expectTypeOf` fails at type-check time, not at Vitest runtime: the guard is `pnpm typecheck` (already in the GSD test command `pnpm typecheck && pnpm test:unit`; `tsconfig.json` `include` covers `tests`). Add a runtime check that constructs both adapters and asserts `Object.keys`-free conformance by calling each method once. Note the parameter name inside the function type does not affect type equality; only types and arity do.

Boundary text scan (catches type-only imports esbuild erases): every `.ts` under `src/world/` contains no `@babylonjs` substring; only files under `src/runtime/` import `MockWorldAdapter` or `NativeSliceAdapter` by value or type. Today `src/ui/nativeLocomotionControls.ts:2` does `import type { NativeSliceAdapter }` - narrow it to a small interface first, or the new test fails.

### Pattern 5: Deterministic remote tree manifest (FOUND-03)

```python
import ctypes, hashlib, json, os, stat, sys
from pathlib import Path

BELOW_NORMAL_PRIORITY_CLASS = 0x00004000

def lower_process_priority():
    kernel32 = ctypes.windll.kernel32
    kernel32.SetPriorityClass(kernel32.GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS)

def walk_regular_files(root):
    pending = [root]
    while pending:
        directory = pending.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                attributes = entry.stat(follow_symlinks=False).st_file_attributes
                if attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT or entry.is_symlink():
                    raise ValueError('Reparse point inside the reference tree: ' + entry.path)
                if entry.is_dir(follow_symlinks=False):
                    pending.append(entry.path)
                elif entry.is_file(follow_symlinks=False):
                    yield Path(entry.path)

def manifest_rows(root):
    rows = []
    for path in walk_regular_files(str(root)):
        relative = path.relative_to(root).as_posix()
        status = path.stat()
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        rows.append({'path': relative, 'bytes': status.st_size, 'sha256': digest, 'modifiedNanoseconds': status.st_mtime_ns})
    return sorted(rows, key=lambda row: (row['path'].casefold(), row['path']))
```
Run remotely without writing anything on IMPORTA-PC: `ssh -o BatchMode=yes -p 2026 rolan@importa-pc.tail40ecb2.ts.net 'python -I -B - C:/Lineage2-client' < scripts/hash_reference_client_tree.py > <local scratch>`. `python` on that MSYS shell resolves to native Windows `C:/Users/rolan/AppData/Local/Programs/Python/Python311/python` (verified `which`), so `st_file_attributes` and `ctypes.windll` work. Write output with `sys.stdout.buffer.write(canonical_bytes)` to avoid console code-page translation. Also hash the root's own parents for reparse points (as `native_source_stage.py:120-122` does for each path). The lock records the script's own SHA-256 and the Python version per side. The pattern mirrors `native_source_stage.remote_hashes` (`scripts/native_source_stage.py:106-139`): config as data, root canonicalised, reparse rejection, lowercase hex SHA-256.

### Pattern 6: Canonical hashing of committed JSON

`git config core.autocrlf` is `true` and `git ls-files --eol` shows `i/lf w/crlf` for `recipes/native-inputs.lock.json` and `package.json` [VERIFIED]. So:
- `clientBuild` must hash the canonical serialisation (`json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')`, the repo's `json_bytes` in `scripts/native_assets_lib/gltf.py:20-21`), not the working-tree file bytes. Recommended field shape: `"clientBuild": {"referenceTreeLockSha256": "<canonical sha>", "engineDllSha256": "4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08"}` (Engine.dll hash verified verbatim in `recipes/native-inputs.lock.json` first file record).
- Golden fixture locks: either generate binary fixtures only, or add `.gitattributes` (`tests/fixtures/golden/** -text`, `recipes/*.lock.json eol=lf`) in the same commit as the fixtures, and still verify by hashing canonical forms for JSON.

### Pattern 7: asset.json v2 (FOUND-02)

Current v1 writer (`scripts/native_assets.py:674-677`) [VERIFIED]: `manifest = {'schemaVersion': 1, 'id': 'interlude:' + identity, 'name': identity, 'kind': kind, 'source': source, 'limitations': limitations, 'animationEvents': events}`; models add `'model': {'file': primary, 'unit': 'metre', 'sourceUnitsPerMetre': 100, 'sourceToGltf': SOURCE_TO_GLTF}` with `SOURCE_TO_GLTF = [.01, 0, 0, 0, 0, 0, .01, 0, 0, .01, 0, 0, 0, 0, 0, 1]` (`native_assets.py:32`). `source` is `{'edition': 'interlude', 'package', 'object', 'sha256', 'packageVersion', 'licenseeVersion'}` (packages) or `{'edition','package','object','sha256'}` (media). `provenance.json` already carries `converterSha256: implementation_hash()`.

v2 adds `source.path` (host + absolute path; the converter knows `self.client` and the relative path; the host comes from the lock's `sourceHost`), `clientBuild`, `converterVersion` (= `implementation_hash()`, `native_assets.py:134-137`) and `coordinates`. Derive handedness from the matrix rather than hard-coding it: column-major `SOURCE_TO_GLTF` maps source X to glTF X, source Y to glTF Z and source Z to glTF Y, so its 3x3 determinant is negative (a reflection). glTF's frame is right-handed, +Y up, metres [CITED: Khronos glTF 2.0 spec, "Coordinate System and Units"], so the record is `coordinates: {unit: "metre", sourceUnitsPerMetre: 100, handedness: "right", upAxis: "Y", sourceToGltf: [...]}` with a writer assertion `determinant < 0` documenting that the source frame is the opposite handedness, Z up. For audio and texture packages, `coordinates` is absent (no spatial route); say so in the contract.

v1/v2 acceptance sites to update together: `src/assets/package/readAssetPackage.ts:3,82` (`schemaVersion: 1` literal and check), `src/effects/nativePowerStrikeSource.ts:81` (`manifest.schemaVersion !== 1`), `scripts/native_assets.py:126` (`verify_archive`: `manifest['schemaVersion'] != 1`), and any Python reader of `asset.json` (`derive-native-map-model.py:81`, `native_map_overlap.py:415`, `restore-native-static-normals.py:83`, `stage_native_runtime.py` via `verified_archive`). Accept `1 | 2` in readers; write `2` in writers. The v1 branch is the documented temporary path until the Needs Human restage, not a speculative shim.

### Pattern 8: One catalog reader + L2-ID index (FOUND-02, SAND-01)

Seven fetch sites of `/l2/catalog.json` exist today, one more than CONTEXT lists [VERIFIED by grep]: `loadNativeCatalog.ts:7`, `loadNativeSection.ts:146`, `loadNativeWorldAudio.ts:101`, `nativeEffectComponents.ts:110`, `loadNativeMovers.ts:47`, `loadNativeCombatAudio.ts:144` (injectable `fetcher`), and `src/editor/captureNativeWorld.ts:81` (Editor capture page, raw `fetch` without `nativeResourceUrl`). `nativeTerrainPreview.ts:120` validates a catalog object passed in. The reader fetches once per startup lifetime (memoised by `AbortSignal`), validates `schemaVersion === 1`, and hands typed slices to each loader. The index is built from v1 fields that already exist, so no restage is needed:
- `npc:<id>`: `catalog.npcProfiles` records (profile ids are already `npc:21622`, `createNativeSliceRuntime.ts:111`).
- `item:<id>`: `playerProfiles[].upperItems[].itemId` to `catalogId` (only item 22 today).
- `skill:<id>:<level>`: `effectComponents` (skill 3 level 1 today).
- `tile:<XX_YY>`: `sections` (20_20 today).
- `window:<name>`: empty until UI-01 (every lookup reports "not in catalog").
`captureNativeWorld.ts` is an Editor capture tool; move it with the authored/Editor code or have it use the reader.

### Pattern 9: Sandbox by-ID commands (SAND-01)

Contract additions (merge first as their own commit/branch): `WorldCommand` gains `{ type: "spawn-npc"; npcId: number }`, `{ type: "equip-item"; entityId?: string; itemId: number | null; slot: <slot union> }` (replacing or generalising `equip-upper`), `{ type: "cast-skill"; skillId: number; level: number; targetId?: string }`; `WorldEntity` gains `npcId?: number` and `equipment` keyed by slot; `WorldEvent` gains `{ type: "skill-cast"; casterId: string; skillId: number; level: number; targetId?: string }`. Delete `{ type: "load-missing-model" }` and the `modelUrl` fallback path (`MockWorldAdapter.ts:90-91,151-166`, `WorldInterface.ts:171,178`, `worldTypes.ts:33,58`), with `tests/unit/world.test.ts:57-62` and `worldInterfaceSheet.test.ts:38,50` updated. Slot names for equipment must come from source data (armorgrp/weapongrp body-part fields) or stay the single existing `upper` slot in Phase 1; do not invent a slot list.

The DevSheet has no text-input control (`src/ui/devSheet/types.ts` defines choice, button, toggle, slider, readout, note only). An ID-entry control is a new DevSheet part; `DevSheet.ts` is 734 lines, so touching it means splitting it (and removing its comments). Put the four actions in a "Sandbox" section of the pinnable sheet with hover-card variables (owner UX preference). Missing-asset diagnostic: keep the entity record; render no body; use the existing projected `EntityLabel` (`src/ui/EntityLabel.ts`) as the labelled in-world marker with text like `npc:12345 not in catalog`, plus a `group.note({ tone: "warning" })` with ID and reason. A label is not a procedural stand-in body.

### Pattern 10: Lazy Babylon Inspector (NOED-04)

```typescript
export async function openBabylonInspector(scene: Scene): Promise<() => Promise<void>> {
  const { ShowInspector } = await import("@babylonjs/inspector");
  const inspectorToken = ShowInspector(scene, { layoutMode: "overlay" });
  return () => inspectorToken.dispose();
}
```
`ShowInspector(scene: Scene, options?: Partial<InspectorOptions>): InspectorToken` and `InspectorToken.dispose(): Promise<void>` [VERIFIED: `lib/inspector.d.ts`, `lib/inspector.common.d.ts` of 9.27.1 on unpkg]. `layoutMode` is `"inline" | "overlay"`, default `"overlay"`; `autoResizeEngine` defaults true. Inside `ShowInspector` the CLI bridge is created with `_StartInspectable(scene, { autoEnable: false })` (line 28115 of `lib/index-CZ1-Y-Rv.js`), so no WebSocket to `ws://127.0.0.1:4400` opens unless the user enables it. Call it after `prepareSceneForReveal` resolves, from the router or App, gated by `new URLSearchParams(location.search).get("inspect") === "1"`, and dispose the token in `App.dispose`.

### Anti-patterns to avoid

- **Re-creating the courtyard in code** (ground plane, paving meshes): that is a procedural stand-in. Default route without a staged island shows a visible "reference world not staged" diagnostic on an otherwise empty code-built scene.
- **Typing presentation config with Babylon classes** (`Vector3`, `Color3`): keeps it out of Playwright node imports and adapter-adjacent code. Use plain tuples; convert in the builder.
- **Hashing working-tree JSON bytes** for any committed pin (CRLF on checkout).
- **`optimizeDeps.exclude` for the inspector**: React is CommonJS; excluding it from pre-bundling breaks the import. Leave Vite's default discovery.
- **Loading the inspector from a CDN** (explicitly forbidden by CONTEXT).
- **Reading E: in the inventory or any converter before the lock passes**; the 8 local tables are read from the hash-pinned snapshot instead.
- **Inventing equipment slots, ID ranges or window names** for the sandbox.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Import-graph analysis | Regex import parser over `src/**` | esbuild `metafile` (+ text scan only for type-only imports) | Resolution, re-exports, `.ts` extensions, dynamic vs static are all handled |
| Type-level contract | Runtime `Object.keys` check of an interface | Vitest `expectTypeOf` + `pnpm typecheck` | Interfaces do not exist at runtime |
| SHA-256 of large files | Manual chunked loops | `hashlib.file_digest` (3.11+) | Already used in `native_assets.hash_file` |
| Canonical JSON | Ad hoc `json.dumps` variants | `json_bytes` from `scripts/native_assets_lib/gltf.py` | One serialisation everywhere |
| Remote hashing transport | New PowerShell encoded commands | `ssh ... python -I -B - <root>` with the tracked script on stdin | One tool, reproducible, no remote writes |
| Glob matching for lane ownership | Full glob engine | Restrict `lanes.json` to `<dir>/**` and exact paths; prefix match | No minimatch dependency installed; simpler, testable |
| Scene readiness | New readiness hooks | `requireSceneStartup` / `registerSceneStartup` / `prepareSceneForReveal` | Existing barrier with tests (`appStartup.test.ts`) |
| Inspector UI | Custom scene explorer | `@babylonjs/inspector` | Requirement |
| ZIP/package verification | New reader | `readAssetPackage.ts` (extend to v2) | Already strict ZIP_STORED + per-file SHA-256 |

**Key insight:** almost every Phase 1 mechanism already exists in the repo in some form (remote hashing, canonical JSON, package verification, readiness barrier, metafile test). The work is consolidation and relocation, which is exactly where the comment rule, the 400-line rule and the no-dead-code rule bite; budget plan tasks for that.

## Runtime State Inventory

This is a refactor/migration phase (Editor removal, route rename, contract change).

| Category | Items found | Action required |
|----------|-------------|-----------------|
| Stored data | `public/l2/catalog.json` + 120 hash-addressed entries, asset.json v1 inside every `.l2asset` (main checkout store via junction). Browser `localStorage` dev-sheet state (`src/ui/devSheet/devSheetState.ts`) keyed by section IDs. | No data migration in Phase 1 (v1 accepted; restage is Needs Human). If sheet section IDs change, old saved state is ignored harmlessly; verify `devSheetState` tolerates unknown keys. |
| Live service config | None: no external services. IMPORTA-PC trees are read-only and nothing is written there. | None, verified by design (stdin-piped script). |
| OS-registered state | None found for this repo (no scheduled tasks, services). Editor desktop app keeps `project.bjseditor` `"lastOpenedScene": "/assets/native-world.scene"`. | None. `project.bjseditor` stays (NOED-05). |
| Secrets and env vars | `.env` read by `playwright.config.ts` (`DEV_PORT`); `vite.config.ts` reads `DEV_PORT`. No secret names change. | None. `pnpm dev --port 5175` overrides via Vite CLI. |
| Build artifacts / generated files | `public/scene/*.babylon` (gitignored, generated by `babylonjs-editor-cli pack`; stale copies stay in worktrees and main checkout), `src/scripts.ts` (tracked, generated by pack), `.bjseditor/` (gitignored), `public/vendor/babylon/9.27.1/` (gitignored, generated by `stage-webgpu-compilers`, still needed), `node_modules/.vite/deps` cache (holds `babylonjs-editor-tools` pre-bundle; affects cold-start measurement). | After NOED-02 nothing in dev/build reads `public/scene/`; leave the files (harmless) or note them. Edit `src/scripts.ts` when `scripts/world.ts` is deleted. Record `.vite/deps/_metadata.json` `browserHash` with every cold-start measurement. |

## Common Pitfalls

### Pitfall 1: Fog "32-85" is not linear fog on the native route
**What goes wrong:** The code-built native scene enables linear fog and the native e2e check (`fog.mode === 0`) fails, or visuals change.
**Why:** `native-parity.scene/config.json` saves `fogEnabled true, fogMode 0`; `preserve-native-editor-fog.mjs` packs `fogMode` 0 (NONE). Only the courtyard used mode 3.
**How to avoid:** Config carries `mode` explicitly: native `0`, default route value taken from example.scene (`3`) only if the default route keeps fog.
**Warning signs:** `window.__nativeSlice.snapshot().fog.mode !== 0`.

### Pitfall 2: Babylon serialized-scene defaults are not constructor defaults
**What goes wrong:** A camera built with `new ArcRotateCamera(...)` differs from the loaded one (`minZ`, `fov`, `inertia`, beta limits, `fovMode`).
**How to avoid:** Copy every field from the saved JSON that differs from the Babylon constructor default (list in Pattern 1) and assert with the parity test.

### Pitfall 3: Default route on a clean checkout has nothing to stand on
**What goes wrong:** `demo.spec.ts`, `webgpu.spec.ts` (courtyard WebGPU, device loss, adapter failure cases) and `loadingPanel.spec.ts` module-failure case used `?world=courtyard` because it reaches "ready" without staged assets.
**How to avoid:** The code-built default scene must reach `data-world-state="ready"` without `/assets/world/manifest.json` (empty scene + visible "reference world not staged" status), so WebGPU and loading-panel checks move to `/`. MockWorldAdapter behaviour coverage (picking, teleport snap, ground move, animation states) moves to Vitest where possible, e2e only when the island is staged.

### Pitfall 4: Inspector peers break Vite resolution
**What goes wrong:** `import('@babylonjs/node-editor')` inside the inspector chunk fails to resolve in `vite build` or the dev optimizer if a peer is missing or version-skewed.
**How to avoid:** Install all 7 Babylon peers at exactly 9.27.1; let `autoInstallPeers: true` (lockfile `settings.autoInstallPeers: true`, verified) bring React/Fluent, then pin. Run `pnpm build` once after install.
**Warning signs:** "Could not resolve" in Vite optimizer output; two `@babylonjs/core` versions in `pnpm why @babylonjs/core`.

### Pitfall 5: Vite pre-bundles the inspector at cold start
**What goes wrong:** Dev cold-start numbers get worse after NOED-02 because Vite's dependency scanner follows the dynamic `import("@babylonjs/inspector")` and pre-bundles React + Fluent [ASSUMED: Vite scanner follows dynamic imports].
**How to avoid:** Record the optimizer step separately (Vite log "new dependencies optimized" and `_metadata.json`), and measure page module waterfall with a warm deps cache as the baseline did.

### Pitfall 6: CRLF breaks committed hashes
See Pattern 6. Symptom: lock or fixture SHA verifies on the writer's machine and fails after a fresh checkout.

### Pitfall 7: Lock path rules stricter than the tree
**What goes wrong:** Reusing `native_source_stage.relative_path` rejects real paths: its regex `[A-Za-z0-9_./-]+` refuses `L2FileEdit-master/L2 File Editor EN.exe` and `loaderCT1++.exe` (5 such files on IMPORTA-PC, 8 on E:, verified by listing).
**How to avoid:** The lock records every path as found (POSIX, original case) and validates only "no `..`, no absolute, no reparse"; the guard's per-file read check compares casefolded paths.

### Pitfall 8: E: and IMPORTA-PC differ structurally, not only in config
E: has 9,737 files with a nested `L2FileEdit-master/L2FileEdit-master/` copy (8,220 files vs 4,110 on IMPORTA-PC), `L2FileEdit-master.zip`, `Start-Kingdom.cmd`, `Start-Local.cmd`, `system/l2.ini.bak-20261104-111916`, `connection-profiles/` with 3 files (IMPORTA-PC 4); IMPORTA-PC has `READ-ME.txt`, `Start-Client.ps1`, `Start-Debug.cmd`, `system/Running.ini` (system 149 vs 148). Content folders (`animations` 20, `maps` 163, `music` 250, `sounds` 26, `staticmeshes` 212, `systextures` 70, `textures` 387, `voice` 46, `l2text` 184) have equal counts. The lock must show all of these as E-only / IMPORTA-only, and volatile-config for `*.ini`, logs and `.bak`. Run IMPORTA-PC hashing while L2.exe is not running (it holds `user.ini`/logs open; a sharing violation must be recorded as an unreadable difference, never skipped silently).

### Pitfall 9: `--client` entry points are many and drift
About 20 scripts accept `--client` (grep of `scripts/`), with three different defaults: `E:/lineage2-client` (`native_assets.py:762`, `native_catalog/cli.py:208`, `native_effects.py:12`), `ROOT/'artifacts/native-parity/inputs/IMPORTA-PC'` (`native_migration.py:370`, `derive-native-map-model.py:190`, `derive-native-map-overlap.py:181`, `prepare-native-player-aliases.py:206`, `report-native-animation-aliases.py:485`), or required. Add a pytest that scans `scripts/**/*.py` for `add_argument('--client'` and asserts the same module calls the guard, so new entry points cannot skip it. The guard must also bind at read time inside `Converter.__init__` (`native_assets.py:146-151` indexes every package under the client via `rglob`).

### Pitfall 10: Descriptor patterns are case-mixed regexes
`06_interlude.xml` uses `ActionName-[\w]+\.dat`, `EnterEventgrp.dat`, `SkillSoundgrp.dat`, `QuestName-...`, `RaidData-...`, `SkillName-...`, `ZoneName-...` while files are lowercase (`actionname-e.dat`, `entereventgrp.dat`). Parse with `xml.etree.ElementTree` (comments vanish, which correctly drops the three commented links `hairaccessarygrp`, `hairgrp`, `helmetgrp`) and match with `re.fullmatch(pattern, name, re.IGNORECASE)`. Verify the descriptor hash first (`SCHEMA_HASHES['06_interlude.xml'] = '5df8b7af1b510daa26008fa4fe91e100253f40161f1f1f9560e3569d539cdef6'`, `tables.py:19`). The descriptor lives outside the repo (`SCHEMA_ROOT`, `tables.py:16`), so the generator runs locally and commits its JSON; the 40-row test reads only the committed JSON.

### Pitfall 11: Editor tests silently stay in the default suite
`editorScene.test.ts` (imports `pack` from `babylonjs-editor-cli`), `nativeEditorScene.test.ts`, `editorScript.test.ts`, `editorWebgpuCompat.test.ts`, `editorGeometryCompat.test.ts`, `editorMaterials.test.ts`, `editorFogExport.test.ts`, `nativeEditorUv2.test.ts`, `nativeTerrainExportMaterials.test.ts`, `nativeEditorTerrainAppend.test.ts`, `editorAuthoredMaterials.test.ts`, `authoredNativeSection.test.ts`, `nativeParityScript.test.ts` exercise Editor-path code. NOED-05 says no test depends on the Editor: move them to a `vitest.editor.config.ts` + `pnpm test:editor` excluded from `test:unit`, or delete those whose subject is deleted.

### Pitfall 12: 914-line runtime split invites behaviour drift
`window.__nativeSlice` is read by most native e2e specs; its shape (`createNativeSliceRuntime.ts:895-914`) must survive the split byte-for-byte in type. Move it whole into `nativeSliceDiagnostics.ts` first, then split the rest; keep `tests/unit/nativeSliceRuntime.test.ts` green at every step.

## Code Examples

### Dat inventory route classification (FOUND-04)

```python
import re
import xml.etree.ElementTree as ElementTree

LOCAL_DECODED_TABLES = ('skillgrp', 'skillsoundgrp', 'mobskillanimgrp', 'chargrp', 'armorgrp', 'weapongrp', 'npcgrp', 'npcname')
ELBERA_CANDIDATE_TABLES = ('hairgrp', 'helmetgrp', 'hairaccessarygrp')

def descriptor_links(descriptor_bytes):
    root = ElementTree.fromstring(descriptor_bytes)
    return [(link.get('pattern'), link.get('file')) for link in root.iter('link')]

def classify_table(file_name, links):
    matched = [layout for pattern, layout in links if re.fullmatch(pattern, file_name, re.IGNORECASE)]
    if len(matched) > 1:
        raise ValueError('Descriptor matches more than one layout: ' + file_name)
    layout = matched[0] if matched else None
    if layout in LOCAL_DECODED_TABLES:
        route = 'local-decoded'
    elif layout is not None:
        route = 'local-layout-only'
    elif file_name.removesuffix('.dat') in ELBERA_CANDIDATE_TABLES:
        route = 'elbera'
    else:
        route = 'none'
    return {'table': file_name.removesuffix('.dat'), 'descriptorLayout': layout is not None, 'layout': layout, 'route': route}
```
`TABLES` in `tables.py:30` is `('skillgrp', 'skillsoundgrp', 'mobskillanimgrp', 'chargrp', 'armorgrp', 'weapongrp', 'npcgrp', 'npcname')` [VERIFIED]; import it rather than re-listing. Expected tally: 8 local-decoded + 29 local-layout-only + 3 elbera = 40, 0 none. Record counts: the 8 local tables from a run of the existing decoder over the hash-pinned snapshot `C:/laragon/www/l2-browser-client/artifacts/native-parity/inputs/IMPORTA-PC/system/*.dat` (all 8 present, verified by listing; read-only; verify against `recipes/native-inputs.lock.json` first). Elbera evidence counts quoted verbatim from `docs/PORT_SCOPE.md:156-166`: `npcgrp, npcname-e | 6,519`, `itemname-e | 9,238`, `etcitemgrp | 6,911`, `weapongrp | 1,313`, `armorgrp | 1,014`, `skillgrp, skillname-e | 29,812`, `sysstring-e | 2,083`, `systemmsg-e | 2,083`, `actionname-e | 102`. Everything else `"unknown"`.

### Process files (FOUND-01)

`.planning/lanes.json` sketch (globs restricted to `<dir>/**` and exact paths):
```json
{
  "schemaVersion": 1,
  "lanes": {
    "integration": { "owns": ["package.json", "pnpm-lock.yaml", "STATUS.md", "DECISIONS.md", "README.md", ".planning/ROADMAP.md", ".planning/STATE.md", ".planning/lanes.json", "src/runtime/**", "scripts/stage_native_runtime.py"], "parts": ["sandbox"] },
    "world": { "owns": [], "parts": ["world", "minimap", "movement-geodata"] },
    "actors": { "owns": [], "parts": ["player-characters", "npcs", "items", "skills-effects", "audio"] },
    "data-ui": { "owns": ["src/ui/**"], "parts": ["decoders", "ui"] }
  }
}
```
The planner fills `owns` per lane from PORT_SCOPE parts; part slugs above are suggestions derived from PORT_SCOPE section 5 rows 1-11 (stage A parts). Parts 12-19 (adapter, server windows) get slugs and STATUS lines now but no EVIDENCE.md until their phase. The check script: `git diff --name-only <base>...HEAD`, every path must be owned by the branch's lane (branch prefix `<part>/` maps to a lane through `parts`).

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| Inspector v1 (`scene.debugLayer.show`, UMD bundle) | Inspector v2 ESM (`ShowInspector`), React + Fluent UI peers, from 8.49.0 | Babylon 8.49 [CITED: doc.babylonjs.com/toolsAndResources/inspectorv2] | Heavier peer set; lazy chunk mandatory |
| TypeScript JS compiler API (`typescript` main export) | TypeScript 7 native compiler; JS API only under `typescript/unstable/*` over IPC | TS 7.0 | Import-graph tests use esbuild |
| Editor scene + script lifecycle starts runtime | Router starts runtimes, readiness barrier unchanged | This phase | Removes Editor-tools 133-chunk static closure from every route |

**Deprecated/outdated in this repo after Phase 1:** `?world=courtyard`, `load-missing-model`, Fallback Sentinel, `WorldEntity.modelUrl` fallback, `assets/example.scene`, `src/scripts/world.ts`, `announceReadyToEditorProjectRunner` in `vite.config.ts` (Editor project-runner ready line; keep only if the optional Editor Play still needs it, else delete as dead code).

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | Inspector v2 renders and works on a WebGPU engine with the tree-shaken ES6 core under Vite 7 | Pattern 10 | NOED-04 Playwright check fails; would need Inspector workaround or recorded gap. The chunk contains WebGPU checks (4 matches), but no run was done |
| A2 | Vite's dependency scanner discovers the dynamic `import("@babylonjs/inspector")` and pre-bundles it at server start | Pitfall 5 | Only affects cold-start measurement interpretation |
| A3 | `pnpm add --offline` fails with no tarball in store and `--frozen-lockfile` fails after a `package.json` change | Open question 1 | Low; both are documented pnpm behaviours, not run here (no installs allowed during research) |
| A4 | `expectTypeOf(...).toEqualTypeOf` compiles under TypeScript 7.0.2 `tsc --noEmit` like under TS 5 | Pattern 4 | Contract test would need `assertType` or a conditional-type helper instead |
| A5 | Running `python -I -B -` over the MSYS ssh shell passes `C:/Lineage2-client` unmangled | Pattern 5 | Path rewriting by MSYS; mitigated by passing the root via an environment variable or JSON on argv and asserting `Path(root).resolve()` |
| A6 | Hashing 7.8 GB on each host finishes in minutes at BelowNormal | Pattern 5 | Only scheduling |
| A7 | Equipment slot names beyond `upper` are not available without decoding armorgrp/weapongrp body-part fields | Pattern 9 | Planner might keep `upper` only in Phase 1 |

## Open Questions (answers to the six discuss questions, then remaining gaps)

1. **`@babylonjs/inspector` at 9.27.1, peers, offline install, WebGPU/Vite.**
   - Exists at exactly 9.27.1 [VERIFIED: `pnpm view`]. Peers (verbatim from `pnpm view @babylonjs/inspector@9.27.1 peerDependencies`): `react: '>=16.14.0 <20.0.0'`, `react-dom: '>=16.14.0 <20.0.0'`, `usehooks-ts: '^3.1.1'`, `@babylonjs/gui: '^9.0.0'`, `@babylonjs/core: '^9.0.0'`, `@babylonjs/lite: '^1.27.0'` (optional), `@babylonjs/addons: '^9.0.0'`, `@babylonjs/loaders: '^9.0.0'`, `@babylonjs/materials: '^9.0.0'`, `@babylonjs/gui-editor: '^9.0.0'`, `@fluentui/react-icons: '^2.0.310'`, `@babylonjs/node-editor: '^9.0.0'`, `@babylonjs/serializers: '^9.0.0'`, `@fluentui/react-utilities: '^9.26.2'`, `@fluentui/react-components: '^9.70.0'`, `@babylonjs/node-geometry-editor: '^9.0.0'`, `@babylonjs/node-particle-editor: '^9.0.0'`, `@babylonjs/node-render-graph-editor: '^9.0.0'`, `@fluentui-contrib/react-virtualizer: '^1.0.0'`, `@fluentui-contrib/react-resize-handle: '^0.8.4'`, `@fluentui/react-motion-components-preview: '^0.15.2'`. No `dependencies`. All 7 extra Babylon peers exist at 9.27.1. `gui-editor` and `node-editor` additionally peer `@types/react` and `@types/react-dom`.
   - Not in the local store: `C:\Users\rolan\AppData\Local\pnpm\store\v10\index` holds 196 index files; `@babylonjs/*` entries are only addons, core, gui, loaders (9.27.1); zero react or fluent entries [VERIFIED: find]. So `pnpm install --frozen-lockfile --prefer-offline` after editing `package.json` cannot succeed (lockfile outdated, and the tarballs are not cached).
   - Static imports in the main chunk: `react`, `react-dom/client`, `react/jsx-runtime`, five `@fluentui*` packages, `@babylonjs/core/*`, `@babylonjs/loaders/glTF/*`, `@babylonjs/addons/msdfText/*`, `@babylonjs/materials/grid|sky`. Dynamic imports: `@babylonjs/gui-editor`, the four node editors, `@babylonjs/serializers/glTF/2.0/glTFSerializer.js`, `@babylonjs/materials/normal/normalMaterial.js`, `@babylonjs/gui/2D/adtInstrumentation.js`. It deep-imports ES6 core paths, so it composes with the tree-shaken core.
   - Network: the bridge uses `new WebSocket(\`ws://127.0.0.1:${options.port}\`)` with `DefaultPort = 4400`, but `ShowInspector` starts it with `autoEnable: false`. Some UI features reference `assets.babylonjs.com` (fonts, environment texture) and `cdn.jsdelivr.net` (gif.js) when used.
   - Recommendation: read "cannot be installed offline" as "cannot be installed locally into `node_modules`" (the CDN prohibition is the point) and install online outside relay windows with the checkpoint above. If the executor reads it literally, record NOED-04 as a gap in STATUS.md and STATE.md Needs Human. Log the reading taken in OVERNIGHT-DECISIONS.md either way.

2. **TypeScript 7 compiler API vs esbuild metafiles.** TS 7.0.2's package `exports` map `.` to `./lib/version.cjs` (only `version` and `versionMajorMinor = "7.0"`); the API lives under `./unstable/sync`, `./unstable/async`, `./unstable/ast*`, and `dist/api/sync/api.d.ts` shows a `Client` that spawns the native compiler [VERIFIED]. Use esbuild metafiles (Pattern 3) plus a source-text scan for type-only imports.

3. **Robust IMPORTA-PC manifest.** Pattern 5: one stdlib-only Python script, piped over `ssh -p 2026` to the native Windows Python 3.11.9 (`python -I -B -`), `os.scandir` walk with `FILE_ATTRIBUTE_REPARSE_POINT` rejection, `hashlib.file_digest`, BelowNormal via `SetPriorityClass`, sorted rows, canonical JSON to `sys.stdout.buffer`. Same script runs locally on E: (Python 3.12.6). Listing results: IMPORTA-PC tree 5,629 regular files, 7,814,256,191 bytes, 0 symlinks seen by MSYS, 40 `.dat` in `system/`, `Engine.dll` 30,704,468 bytes; no hashing was run.

4. **Exact current shape** of the named files: documented in Patterns 1, 2, 7, 8 and Pitfalls 9-12 with line references. Summary of the runtime split: composition root, world loader (`:142-246`), audio loaders (`:236-318`), effects (`:375-430`), sheet wiring (`:491-790`, the bulk), diagnostics (`:830-914`).

5. **Tests that break and their replacement coverage.**

   | Test | Why it breaks | Disposition |
   |------|---------------|-------------|
   | `tests/browser/demo.spec.ts` (all 9 cases, `?world=courtyard`) | Courtyard gone | Delete; MockWorldAdapter logic covered by `tests/unit/world.test.ts`; picking, label removal, camera clamps and touch orbit re-pointed at `/` only where the code-built default scene supports them; Fallback cases deleted with the feature |
   | `tests/browser/webgpu.spec.ts:92,107,192` (`?world=courtyard`) | Courtyard gone | Re-point to `/` (code-built scene reaches ready without staging) |
   | `tests/browser/webgpu.spec.ts:126` (`authored` loop, checks `public/scene/native-parity.babylon` exists) | Bootstrap file gone, authored deleted | Keep only the source-world case; drop the `public/scene` existence check |
   | `tests/browser/loadingPanel.spec.ts:28` (`authored=1`), `:59` (`?world=courtyard`) | Routes gone | Re-point to `?world=interlude` and `/` |
   | `tests/browser/assetPackage.spec.ts:85,167` (`?world=courtyard`) | Courtyard gone | Re-point to `/` |
   | `tests/browser/world.spec.ts:136` ("unstaged world retains the courtyard", `environment.mode` `"courtyard"`) | Courtyard gone | Rewrite: unstaged world shows the not-staged diagnostic; `WorldDiagnostics.environment.mode` union changes |
   | `nativeEditor.spec.ts` (whole file), `nativeStartup.spec.ts:8`, `nativeFacing.spec.ts:19`, `nativeReveal.spec.ts:10` (route constant), authored halves of `nativeBsp.spec.ts:16` and `nativeFlame.spec.ts:20,53,104,131` | `authored=1` cases deleted per CONTEXT | Delete authored cases; re-point `nativeReveal`, `nativeFacing`, `nativeStartup` to `?world=interlude` where the behaviour is route-independent |
   | `nativeSlice.spec.ts:38-67` (reads `assets/native-parity.scene`) | Values move to typed config | Import the typed config |
   | `tests/unit/environmentLoading.test.ts`, `appStartup.test.ts` (import `loadEnvironment`/`App`) | `loadEnvironment` no longer calls `loadScene` | Rewrite for the router (routes, dynamic import of authored module mocked) |
   | `tests/unit/nativeParityScript.test.ts` | Uses `applyScriptOnObject` from editor-tools | Move to `test:editor` |
   | `tests/unit/nativeSliceRuntime.test.ts` | Builds a scene with a "World camera" by name; signature change | Update to pass camera and world source |
   | `tests/unit/world.test.ts:57-62`, `worldInterfaceSheet.test.ts:38,50` | `load-missing-model` deleted | Update |
   | `entityGroundClearance.test.ts:26`, `entityReadiness.test.ts:26`, `worldInterfaceSheet.test.ts:17` (adapter literals / `as unknown as`) | Contract additions may require new members on test doubles | Update the doubles; keep them typed against `GameWorldAdapter` |
   | Editor-path unit tests (Pitfall 11 list) | NOED-05 | Move to `test:editor` |
   | `editorScript.test.ts` (bundles `src/scripts.ts`, expects `WorldScript` and `scripts/world.ts` in output) | `world.ts` deleted | Update expectations, in `test:editor` |

   New coverage: adapter contract (type + runtime), import boundaries (metafile + text scan), router routes, presentation config parity, catalog reader + index, sandbox commands in both adapters, missing-asset marker, inspector lazy load (metafile + Playwright), v1/v2 asset.json acceptance, pipeline guard/lock/inventory/fixture-lock tests.

6. **Dev cold-start re-measure method.** Baseline (`artifacts/native-parity/research/editor-dev-startup/README.md`, main checkout, read-only): route `?world=courtyard`, 262 and 288 script requests, 7,537,124 and 8,748,728 completed bytes, first runtime-module request at 38.56 s and 39.25 s, longest completion gap 22.984 s and 21.528 s, Editor-tools static closure 134 files / 5,188,834 bytes, warm `.vite/deps` cache (browserHash `4ae0703e`), Playwright trace via `trace: "retain-on-failure"`, analysed by `analyze.py` from `trace.zip` network rows. Re-measure: a separate tracked Playwright config (like `playwright.terrain.config.ts`) with `trace: "on"`, one worker, fresh `pnpm dev` server on a free port, two navigations (`/` and `?world=interlude`), warm deps cache recorded by `_metadata.json` browserHash, plus one run after the optimizer re-ran (log line captured). Record per run: script request count, completed bytes, time to first `src/runtime/` module request, longest completion gap, time to `body[data-world-state="ready"]`, presence of any `babylonjs-editor-tools` request (must be zero). Write the numbers into `docs/parts/sandbox/EVIDENCE.md` (or the integration part) with the trace location; do not raise timeouts or change `waitUntil` (baseline README forbids it).

### Remaining gaps

- **Default route empty-scene presentation:** with Talking Island unstaged, should the default route show MockWorldAdapter actors (procedural characters, no ground) or only the diagnostic? Recommendation: diagnostic plus actors at y=0 so WebGPU and picking checks still have content; this is the non-native route, so ARCH-03's stand-in rule does not apply, but log it in OVERNIGHT-DECISIONS.md.
- **Lane assignment of shared folders** (`src/assets/native/**`, `src/scene/world/**`, `scripts/native_*`) between world and actors lanes: planner's discretion; the check script makes overlaps visible.
- **E: guard granularity:** CONTEXT says "refuses E: when the lock is missing or stale" plus "read an E: file only when its path is equal". Entry-level refusal is simple; per-file enforcement needs hooks at read sites (`Converter.source`, `Converter.package`, table readers). Recommend both: entry check, plus a `require_equal_reference_file(relative_path)` called at the three central read helpers.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All TS tooling | Yes | v24.15.0 (engines `>=22.12.0`) | - |
| pnpm | Installs, scripts | Yes | 10.32.1 | - |
| Python (DATABASE-PC) | Pipeline, local E: hashing | Yes | 3.12.6 | - |
| ssh to IMPORTA-PC (tailnet, port 2026) | FOUND-03 | Yes (listing ran) | MSYS bash, `MINGW64_NT-10.0-26300` | LAN alias `fleet-importa-pc` |
| Python on IMPORTA-PC | Remote hashing | Yes | 3.11.9 (native Windows) | `pwsh` 7 at `/c/Program Files/PowerShell/7/pwsh`, `sha256sum` |
| `E:/Lineage2-client` | FOUND-03 | Yes | 9,737 files | - |
| `06_interlude.xml` schema root | FOUND-04 | Yes (at planning time outside the repo; moves to `.assets/native-tools/dat-schema`) | 239 entries in `dats/` | - |
| open-l2encdec `src/l2encdec.cpp` (at planning time outside the repo; moves to `.assets/native-tools/`) | Decoding 8 local tables | Yes | hash-pinned in `tables.py` | - |
| Locked `.dat` inputs | FOUND-04 counts | Yes, main checkout `artifacts/native-parity/inputs/IMPORTA-PC/system/` (8 files), read-only | - | E: after lock |
| `@babylonjs/inspector` + peers | NOED-04 | No (not installed, not in store) | registry 9.27.1 | Record gap if online install not allowed |
| Port 5173 free | `pnpm test:e2e` | Check at run time | - | Wait; never kill by image name |

**Missing with no fallback:** none blocking, except NOED-04 if online install is disallowed.
**Missing with fallback:** inspector (gap record).

## Validation Architecture

### Test framework

| Property | Value |
|----------|-------|
| Framework | Vitest 5.1.0 (unit, `tests/unit/**/*.test.ts`), Python unittest via `scripts/test_pipeline.py` (`tests/pipeline` + `scripts/native_catalog`), Playwright 1.64.1 (`tests/browser`, port 5173) |
| Config files | `vitest.config.ts`, `playwright.config.ts`; new `vitest.editor.config.ts` (Wave 0) |
| Quick run | `pnpm typecheck && pnpm vitest run tests/unit/<file>.test.ts` |
| Full suite | `pnpm typecheck && pnpm test:unit` (GSD gate), plus `pnpm test:pipeline`, plus `pnpm test:e2e` when 5173 is free |

### Phase requirements to test map

| Req ID | Behaviour | Test type | Automated command | File exists? |
|--------|-----------|-----------|-------------------|--------------|
| FOUND-01 | lanes.json valid, globs only `dir/**`/exact, every part has one lane, check script flags foreign paths; STATUS.md one line per part; EVIDENCE.md size under 30 KB | unit (Vitest or pytest) | `pnpm vitest run tests/unit/laneOwnership.test.ts` | No, Wave 0 |
| FOUND-02 | Reader accepts v1 and v2 asset.json, rejects bad `coordinates`; writer emits v2 with derived handedness; fixture lock hashes match | unit + pytest | `pnpm vitest run tests/unit/assetPackageContract.test.ts`; `python -B -m unittest discover -s tests/pipeline -p test_asset_manifest_v2.py` | No |
| FOUND-02 | One catalog reader, index keys `npc:`/`item:`/`skill:`/`tile:`/`window:` from v1 catalog fixture | unit | `pnpm vitest run tests/unit/nativeCatalogIndex.test.ts` | No |
| FOUND-03 | Walker rejects reparse points, sorts deterministically; lock classifier (equal, E-only, IMPORTA-only, differing, volatile-config); guard refuses E: when lock missing/stale, allows equal paths only; every `--client` script calls guard | pytest | `python -B -m unittest discover -s tests/pipeline -p test_reference_client_*.py` | No |
| FOUND-04 | Inventory has 40 rows, tally 8/29/3/0, counts only from pinned decode or Elbera evidence | pytest + Vitest on committed JSON | `python -B -m unittest discover -s tests/pipeline -p test_dat_table_inventory.py` | No |
| ARCH-01 | `src/ui/**` imports no decoded weapongrp/armorgrp/skillgrp module | unit (text scan) | `pnpm vitest run tests/unit/architectureInvariants.test.ts` | No |
| ARCH-02 | Five frozen methods (type), both adapters conform (runtime), no `@babylonjs` in `src/world/**`, concrete adapters only in `src/runtime/**` | typecheck + unit | `pnpm typecheck && pnpm vitest run tests/unit/gameWorldAdapterContract.test.ts tests/unit/importBoundaries.test.ts` | No |
| ARCH-03 | Missing ID keeps entity, shows label marker + sheet note, no mesh; readiness barrier still gates reveal | unit + e2e | `pnpm vitest run tests/unit/sandboxMissingAsset.test.ts`; Playwright `tests/browser/sandbox.spec.ts` | No |
| ARCH-04 | Asset resolution outside adapters (covered by boundary test) | unit | as ARCH-02 | No |
| SAND-01 | spawn-npc / equip-item / cast-skill handled by both adapters with L2 IDs; open window by ID reports not in catalog; sheet controls exist | unit + e2e | `pnpm vitest run tests/unit/sandboxCommands.test.ts`; `pnpm test:e2e tests/browser/sandbox.spec.ts` | No |
| NOED-01 | Native route builds scene in code; config equals saved Editor JSON; `authored=1` only via dynamic import | unit + e2e | `pnpm vitest run tests/unit/presentationConfiguration.test.ts tests/unit/environmentRouting.test.ts`; `pnpm test:e2e tests/browser/nativeSlice.spec.ts` (staged only) | Partly (rewrite) |
| NOED-02 | dev/build scripts contain no Editor step; static graph of `src/main.ts` excludes editor-tools and `src/scripts.ts` | unit | `pnpm vitest run tests/unit/defaultEntryImportGraph.test.ts` | No |
| NOED-03 | No `example.scene`/`?world=courtyard` path; default route ready without staging | unit + e2e | `pnpm vitest run tests/unit/environmentRouting.test.ts`; `pnpm test:e2e tests/browser/webgpu.spec.ts` | Rewrite |
| NOED-04 | Inspector absent from static graph; `?inspect=1` opens it | unit + e2e | `pnpm vitest run tests/unit/defaultEntryImportGraph.test.ts`; `pnpm test:e2e tests/browser/inspector.spec.ts` | No |
| NOED-05 | `test:unit` includes no Editor-path test; `package.json` dev/build do not reference `generate:editor` | unit | `pnpm vitest run tests/unit/editorIndependence.test.ts` | No |

### Sampling rate
- **Per task commit:** `pnpm typecheck && pnpm vitest run <touched test files>`; pipeline tasks also run their pytest module.
- **Per wave merge:** `pnpm typecheck && pnpm test:unit` and `pnpm test:pipeline`.
- **Phase gate:** both full suites green, `pnpm build` green once (BelowNormal, outside relay windows), `pnpm test:e2e` green with port 5173 free, cold-start re-measure recorded, then `/gsd-verify-work`.

### Wave 0 gaps
- [ ] `vitest.editor.config.ts` + `test:editor` script; move Editor-path tests out of `test:unit`
- [ ] Shared esbuild static-graph helper for tests (`tests/support/staticImportGraph.ts` or similar)
- [ ] Golden fixture generator + fixture lock + `.gitattributes` rules
- [ ] `tests/pipeline/test_reference_client_*.py`, `test_dat_table_inventory.py`, `test_asset_manifest_v2.py`
- [ ] `tests/unit/gameWorldAdapterContract.test.ts`, `importBoundaries.test.ts`, `defaultEntryImportGraph.test.ts`, `laneOwnership.test.ts`, `architectureInvariants.test.ts`
- [ ] `tests/browser/sandbox.spec.ts`, `tests/browser/inspector.spec.ts`; startup measurement Playwright config

## Security Domain

`security_enforcement` is not set in `.planning/config.json` (treated as enabled).

### Applicable ASVS categories

| ASVS category | Applies | Standard control |
|---------------|---------|------------------|
| V2 Authentication | No | No auth in Phase 1 |
| V3 Session management | No | - |
| V4 Access control | No (local dev tool) | - |
| V5 Input validation | Yes | Guard clauses at trust boundaries: catalog JSON, asset.json v1/v2, URL params (`world`, `authored`, `inspect`, `character`), sandbox ID input (`Number.isSafeInteger`, non-negative), lock JSON, remote manifest JSON, descriptor XML |
| V6 Cryptography | Yes (integrity only) | `crypto.subtle.digest("SHA-256")` in browser, `hashlib` in Python; never hand-rolled |
| V10 Malicious code / supply chain | Yes | Exact pins, lockfile committed, `pnpm view ... scripts.postinstall` empty for inspector, legitimacy audit above |
| V12 Files and resources | Yes | Reparse-point rejection, path confinement (`native_source_stage.confined` pattern), `nativeResourceUrl` bounded `/l2/` paths |

### Known threat patterns for this stack

| Pattern | STRIDE | Standard mitigation |
|---------|--------|---------------------|
| Path traversal / junction escape while hashing or reading E: | Tampering | `os.scandir` with reparse rejection; resolve and confine to root |
| Remote command injection over ssh | Elevation | Script on stdin, root as data, no shell interpolation of paths |
| Tampered staged asset | Tampering | Per-file SHA-256 in asset.json and catalog `archiveSha256` (existing) |
| Inspector opening a local WebSocket bridge | Information disclosure | `ShowInspector` uses `autoEnable: false`; only behind `?inspect=1` |
| Malicious npm dependency | Tampering | Exact pins, lockfile, no postinstall, same-vendor packages |
| Sandbox ID input abuse (huge or non-integer IDs) | DoS | Integer validation before dispatch; index lookup only |

## Sources

### Primary (HIGH confidence)
- Repo files read this session: `.planning/phases/01-foundations/01-CONTEXT.md`, `REQUIREMENTS.md`, `STATE.md`, `PROJECT.md`, `ROADMAP.md`, `OVERNIGHT-DECISIONS.md`, `config.json`, `AGENTS.md`, `package.json`, `pnpm-lock.yaml` header, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `index.html`, `src/main.ts`, `src/App.ts`, `src/scene/loadEnvironment.ts`, `src/scene/prepareSceneForReveal.ts`, `src/scene/environmentContext.ts`, `src/scripts.ts`, `src/scripts/nativeParity.ts`, `src/scripts/world.ts`, `src/runtime/createNativeSliceRuntime.ts` (all 914 lines), `src/runtime/createWorldRuntime.ts`, `src/world/GameWorldAdapter.ts`, `worldTypes.ts`, `MockWorldAdapter.ts`, `NativeSliceAdapter.ts`, `src/assets/native/loadNativeCatalog.ts`, `nativeResourceUrl.ts`, `src/assets/package/readAssetPackage.ts`, `src/camera/WorldCamera.ts`, `src/ui/devSheet/types.ts`, `scripts/native_assets.py:60-160,545-700`, `scripts/native_source_stage.py`, `scripts/native_catalog/tables.py:1-80,225-251`, `scripts/stage_native_runtime.py:265-350`, `scripts/preserve-native-editor-fog.mjs`, `scripts/ensure-webgpu-project.mjs`, `scripts/stage-webgpu-compilers.mjs`, `scripts/test_pipeline.py`, `tests/unit/editorScript.test.ts`, `tests/fixtures/assetPackageFixture.ts`, `assets/native-parity.scene/*.json`, `assets/example.scene/*.json`, `docs/PORT_SCOPE.md` sections 2, 5, 7, `recipes/native-inputs.lock.json` header, main-checkout `artifacts/native-parity/research/editor-dev-startup/{README.md,analysis.json,analyze.py}`
- `node_modules`: `typescript/package.json` exports, `typescript/dist/api/sync/api.d.ts`, `esbuild/lib/main.d.ts`, `vitest/dist/index.d.ts`, `babylonjs-editor-cli/build/index.node.js`
- npm registry via `pnpm view`: `@babylonjs/inspector@9.27.1` and the 7 Babylon peers, React and Fluent versions
- `@babylonjs/inspector@9.27.1` published files on unpkg: `readme.md`, `lib/index.d.ts`, `lib/inspector.d.ts`, `lib/inspector.common.d.ts`, `lib/inspectable.d.ts`, `lib/index-CZ1-Y-Rv.js` (grepped for imports, bridge defaults)
- Listings: pnpm store index, `E:/Lineage2-client`, IMPORTA-PC `C:/Lineage2-client` over `ssh -p 2026`, schema root

### Secondary (MEDIUM confidence)
- https://doc.babylonjs.com/toolsAndResources/inspectorv2/ (ESM package from 8.49.0 is Inspector v2; `ShowInspector` API; legacy compatibility layer)
- Khronos glTF 2.0 specification, coordinate system (right-handed, +Y up, metres) [CITED from knowledge of the spec, not fetched this session]

### Tertiary (LOW confidence)
- Vite dependency scanner behaviour for dynamic imports (A2), pnpm offline/frozen failure modes (A3), TS 7 `expectTypeOf` compatibility (A4)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for installed tools (versions read from `node_modules`); MEDIUM for inspector integration (metadata verified, no run).
- Architecture: HIGH; every coupling point cited with line numbers from files read this session.
- Pitfalls: HIGH for repo facts (fog mode, CRLF, path regex, tree differences, test list); MEDIUM for Vite pre-bundle behaviour.

**Research date:** 2026-11-08
**Valid until:** 2026-12-08 for repo facts (re-check after any merge to `main`); 7 days for npm registry facts (Babylon ships weekly).
