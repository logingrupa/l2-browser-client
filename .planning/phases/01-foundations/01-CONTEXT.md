# Phase 1: Foundations - Context

**Gathered:** 2026-11-08 (smart discuss, autonomous; answers taken from an assumptions-analyzer agent's recommendations, owner away, every choice logged in `.planning/OVERNIGHT-DECISIONS.md` and marked owner review)
**Status:** Ready for planning

<domain>
## Phase Boundary

Three lanes can start in parallel against frozen contracts, a locked reference tree and a table inventory, with a sandbox shell ready to receive content, and Babylon.js Editor is off the build and runtime path. Requirements: FOUND-01..04, ARCH-01..04, SAND-01, NOED-01..05. Nothing here converts new content; Phase 2 does.

Execution constraints for this run (owner rules, binding on every plan):
- Work only in this worktree `C:\Users\rolan\.t3\worktrees\l2-browser-client\autonomous-roadmap` (branch `plan/autonomous-roadmap`). `public\l2` is a read-only junction to the main checkout's 2.4 GB native store. Never run `assets:*`, `world:stage`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*` or preview scripts against the main checkout or `public\l2`. Never `git worktree remove` this tree.
- Dev server: `pnpm dev --port 5175`. `pnpm test:e2e` uses port 5173; run it only while nothing listens on 5173.
- DATABASE-PC relays a livestream Sun 10:00-14:00 and Thu 19:00-21:30 Riga: no builds, dev servers, tests, installs, hashing or conversions then. Heavy commands at BelowNormal priority.
- After every plan and verification, stop the dev servers, browsers, e2e runners and Vitest workers you started, by PID or by a command line holding this worktree path or port, never by image name.
- IMPORTA-PC: `ssh -p 2026 rolan@importa-pc.tail40ecb2.ts.net` (bash shell, `sha256sum`, `pwsh`, Python 3.11 available). Both client trees are read-only.
- Commit only on this branch; no push, no merge.

</domain>

<decisions>
## Implementation Decisions

### A. Output contract (FOUND-02)
- `asset.json` gets schemaVersion 2 with `source.path` (host plus absolute path), `clientBuild`, `converterVersion` (the existing `implementation_hash()` of `scripts/native_assets.py`) and `coordinates {unit, sourceUnitsPerMetre, handedness, upAxis, sourceToGltf}`. `provenance.json` inside the archive stays as detailed evidence.
- `clientBuild` = SHA-256 of the committed full-tree lock file plus the Engine.dll SHA-256 (`4dd2f63c...`); both derived, nothing invented.
- The written contract names two entry kinds: `.l2asset` packages, and hash-pinned JSON manifests (sections, movers, profiles, audio, effect components) that reference only hash-addressed files under `/l2/<kind>/<sha>/` and carry the same provenance block. World tiles are not repacked into `.l2asset` (128 MiB limit).
- The existing store in `public\l2` is v1 and cannot be restaged from this worktree (owner rule). Converters write v2 from now on; the browser reader accepts v1 packages until the integration thread restages the store from the main checkout. That restage, and deleting v1 acceptance afterwards, go under Needs Human in STATE.md. (Deviation from the analyzer, which assumed an immediate restage; logged.)
- One validated catalog reader replaces the six separate catalog fetch sites (`loadNativeCatalog.ts`, `loadNativeSection.ts`, `loadNativeWorldAudio.ts`, `nativeEffectComponents.ts`, `loadNativeMovers.ts`, `captureNativeWorld.ts`) and exposes an L2-ID index: `npc:<id>`, `item:<id>`, `skill:<id>:<level>`, `window:<name>`, `tile:<XX_YY>`.
- Golden fixtures: a committed script generates synthetic, format-correct fixtures with no L2 bytes; their SHA-256 values are pinned in a fixture lock and checked by Vitest and pytest. Tests that need the private client stay local and skip when it is absent. Converted L2 binaries never enter git.

### B. Reference tree lock (FOUND-03)
- Hash every file of both trees (`E:/Lineage2-client` on DATABASE-PC, `C:/Lineage2-client` on IMPORTA-PC) and classify each path: equal, E-only, IMPORTA-only, differing. Conversion may read an E: file only when its path is "equal".
- Volatile files (`l2.ini`, `user.ini`, logs, `.bak`) are listed as differences of class volatile-config that conversion never reads.
- One shared Python guard, called by every `--client` entry point, refuses E: when the lock is missing or stale. Stale = lock missing, or a file's size or mtime differs from the lock record (then re-hash that file), or a re-lock is ordered when Engine.dll or the IMPORTA-PC tree changes.
- The lock is a separate committed `recipes/reference-client-tree.lock.json` (hashes and sizes only). `recipes/native-inputs.lock.json` stays input-only (DEC-OWN-5).
- IMPORTA-PC is hashed by one remote run over the tailnet ssh endpoint above (walk the tree, reject reparse points, as `scripts/native_source_stage.py:106-139` does), at BelowNormal priority, outside the relay windows. The hashing script is tracked so the lock is reproducible.

### C. `.dat` inventory (FOUND-04)
- Two columns for route: `descriptorLayout` (yes for the 37 tables in `06_interlude.xml`), and `route` = local-decoded (the 8 tables in `scripts/native_catalog/tables.py`), local-layout-only (29), elbera (hairgrp, helmetgrp, hairaccessarygrp, once their parser is confirmed), or none.
- Record counts only from a pinned decode: the 8 local tables now; PORT_SCOPE's Elbera counts shown as Elbera evidence; everything else "unknown". The inventory exists before any further decoding.
- The 8 locked tables are read now; the other 32 are read from E: only after the lock passes.
- Generated JSON plus a table in `docs/parts/data/EVIDENCE.md`, with a test that asserts 40 rows.

### D. Adapter contract and sandbox commands (ARCH-01..04, SAND-01)
- Contract test: a type-level `expectTypeOf` check that the `GameWorldAdapter` keys are exactly the five method names with their signatures, plus a runtime check that both adapters conform. `WorldEvent` and `WorldCommand` unions are not frozen, but a change to them merges first as a contract branch.
- Spawn NPC, equip item and cast skill become `WorldCommand` variants; both adapters handle them and emit records carrying L2 IDs (`npcId`, equipment by slot, a cast event). Presentation resolves them through the catalog index. Open window is a sheet action only, outside the adapter.
- Missing-asset diagnostic: the entity record still exists, and the scene shows a labelled in-world marker plus a sheet note with the ID and reason. `load-missing-model` and the Fallback Sentinel are deleted.
- Phase 1 distinguishes only "converted" vs "not in catalog"; "unknown ID" arrives with DATA-01.
- Import boundaries: a Vitest check that only runtime composition roots import concrete adapters, and that adapter files and `worldTypes` do not import `@babylonjs`. `src/world/meshNavigation.ts` (presentation-side, imports Babylon) moves out of `src/world`. The frame is metres, Y up, right-handed; the wrong "left-handed" comment goes with the comment cleanup.
- ARCH-01 (no gameplay math, tooltips from server data) and ARCH-04 (presentation-only client behaviour) are recorded as invariants with a check where one is mechanical (for example no import of `.dat` stat fields into tooltip code); they are not new features.

### E. Native scene built in code (NOED-01..05)
- Camera, lights, clear colour and fog values move from the Editor scene into typed config with identical values (camera alpha -1.8, beta 1.15, radius 4.25, maxZ 100; two lights at 0.65; clear colour [0.49,0.59,0.56]; fog 32-85), each shown on the sheet with status "presentation, formerly Editor-authored, not L2".
- Editor inspector fields in `src/scripts/nativeParity.ts` become typed config carrying the saved values exactly (`Wait_1HS_MFighter`, `leatherShirt` true); the tint and roughness override stays behind `materialOverrideEnabled=false`.
- Default route: the Editor courtyard (`assets/example.scene`, `loadScene` in `src/scene/loadEnvironment.ts`) is retired. The default view keeps its non-Editor content (the reference Talking Island world from `/assets/world/manifest.json` and the converted characters in `public/assets/characters`) on a scene built in code with the same presentation config. `?world=interlude` boots the native catalog sandbox and shows an explicit "store not staged" diagnostic when the catalog is missing. (Deviation from the analyzer's recommendation to delete the Talking Island route and procedural characters: that deletes recent owner-directed work and the analyzer flagged it for owner confirmation, so the reversible choice was taken; logged.)
- `authored=1` lives in one dynamically imported module that alone imports `babylonjs-editor-tools` and `src/scripts.ts`. Courtyard and `authored=1` e2e cases are deleted. A Vitest check on an esbuild metafile proves the static graph of `src/main.ts` excludes them.
- `pnpm dev` and `pnpm build` run `stage-webgpu-compilers` only; `ensure-webgpu-project`, `validate-editor-materials`, `preserve-native-editor-uv2`, `babylonjs-editor-cli pack`, `preserve-native-editor-fog` and `share-native-terrain-export-materials` move to `pnpm generate:editor`. `project.bjseditor` and `pnpm assets:editor` stay, nothing depends on them.
- Babylon Inspector: `@babylonjs/inspector` pinned exactly to the `@babylonjs/core` version, loaded by dynamic import under `?inspect=1`; a metafile test proves it is not statically imported and a Playwright check opens it. If the exact version or its peers cannot be installed offline, record the gap rather than loading it from a CDN.
- Re-measure dev cold start after the Editor pack is removed (ROADMAP verification note); a removed suspect cause is not proof the gap is gone.

### F. Process files (FOUND-01)
- `STATUS.md` and `DECISIONS.md` at the repo root (AGENTS.md names them bare); `.planning/lanes.json` for ownership.
- `DECISIONS.md`: one dated line per decision ID (DEC-OWN-1..8, DEC-PORT-1..3 and the carried ones), linking to the full text in `.planning/PROJECT.md`, which stays the text GSD reads.
- Ownership by lane, not by role: L1 world, L2 actors, L3 data + UI, integration. Integration owns `package.json`, the catalog writer, `src/runtime/**` and the status files. A check script compares a branch's diff against its lane's globs. (Role globs from PORT_SCOPE would overlap `scripts/**` between L1 and L2.)
- Parts = PORT_SCOPE section 5 parts as slugs, each owned by one lane, one `docs/parts/<part>/EVIDENCE.md` per part.

### Claude's Discretion
- Plan split, wave order and file layout, within AGENTS.md code rules (no comments, full-word names, files under about 400 lines, Vitest per behaviour change, Playwright for UI, no dead code).
- Whether the hash lock JSON is one file or a compact per-folder layout, as long as it is committed, deterministic and under a sensible size.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/world/GameWorldAdapter.ts:8-15` five methods; `MockWorldAdapter.ts`, `NativeSliceAdapter.ts` (adds `subscribeCommands` used by `nativePowerStrikePreview.ts:19` and `createNativeSliceRuntime.ts:365,424`, plus getters `isPaused`, `currentSpeed`, `groundContact`). No contract test; three tests build adapters as literals or with `as unknown as` (`entityGroundClearance.test.ts:26`, `entityReadiness.test.ts:26`, `worldInterfaceSheet.test.ts:17`).
- `src/world/worldTypes.ts`: `spawn`/`update`/`despawn` events (`:39-46`), a `spawn` command without ID (`:55`), `equip-upper` (`:59`); no `npc` kind, no skill-cast event.
- `src/assets/package/readAssetPackage.ts:2-16`: asset.json schemaVersion 1, `source {edition, package, object, sha256}`, `model {unit, sourceUnitsPerMetre, sourceToGltf}`, size limits. `provenance.json` per archive holds converterSha256, UModel build1590 pin, formatDefinitionPins, request sourceHost/sourcePath. Writer/verifier `scripts/native_assets.py:83,113`, `implementation_hash()` at `:134`.
- Catalog: `catalog.json` schemaVersion 1 written by `scripts/stage_native_runtime.py:273-336`, then extended by about 10 `stage_*` scripts; keys models(8), textures(18), sections, movers, npcProfiles, playerProfiles, animationAudio, combatAudio, worldAudio, effectComponents. Only models and textures point to `.l2asset`. Catalog IDs are pipeline IDs (`human-male-fighter:0`, `musveren:0`); NPC profile `npc:21622` (`src/runtime/createNativeSliceRuntime.ts:111`).
- `scripts/native_source_stage.py:106-203`: remote hashing on IMPORTA-PC over ssh with an encoded PowerShell command, reparse-point rejection, 24 files per call; local copy only after hash equality. `~/.ssh/config` alias `fleet-importa-pc` points at 192.168.1.79; this run uses the tailnet endpoint on port 2026.
- `recipes/native-inputs.lock.json`: 143 files, 2.51 GB, sourceHost IMPORTA-PC, scope note "not the entire native client"; `system/l2.ini` is hash-only and changed once.
- `.dat`: 40 files in `E:/Lineage2-client/system`. Local decoder `scripts/native_catalog/tables.py:16-30` decodes 8 tables (skillgrp, skillsoundgrp, mobskillanimgrp, chargrp, armorgrp, weapongrp, npcgrp, npcname) with hash pins; schema root defaults to a lineagen `dat_engine/data/structure` path; crypto from `E:/linegen/.../l2encdec.cpp`. `06_interlude.xml` lists 37 tables; no hairgrp, hairaccessarygrp, helmetgrp. Elbera on E: has `tools/dat/extract_gamedata.py` (11 parsers), `extract_charcreate.parse_hairgrp`, helmetgrp/hairaccessarygrp handling in `build_hair.py:542`.
- `E:/Lineage2-client`: 9,737 files, 7.84 GB, 8,220 of them in `L2FileEdit-master/`; likely E-only: `L2FileEdit-master.zip`, `Start-*.cmd`, `connection-profiles/`, `l2text/` (184), `system/l2.ini.bak-20261104-111916`. IMPORTA-PC top level has `READ-ME.txt`, `Start-Client.ps1`, `Start-Debug.cmd` that E: lacks.
- `--client` defaults differ: `E:/lineage2-client` in `native_assets.py:762`, `native_catalog/cli.py:208`, `native_effects.py:12`, `native_catalog/test_effects.py:14`; `artifacts/native-parity/inputs/IMPORTA-PC` in `native_migration.py:370` and others (that folder does not exist in this worktree).
- Dev sheet: `src/ui/devSheet/types.ts` (VariableInfo status native, presentation or unverified), `DevSheet.ts` (734 lines). Runtime sheet groups in `createNativeSliceRuntime.ts:498-520`. Staged content: 8 models, NPC 21622 only, item 22 only as an upper (`:720`), Power Strike (skill 3) preview only, no windows.
- Readiness barrier: `src/scene/prepareSceneForReveal.ts:16-29`.
- `src/engine/createWebGPUEngine.ts:7` loads glslang/twgsl from `/vendor/babylon/9.27.1`.

### Established Patterns
- Python pipeline under `scripts/` with `tests/pipeline` (unittest; `pnpm test:pipeline`, not in the GSD test command); 29 pipeline tests skip when the private client is absent (for example `tests/pipeline/test_native_presentations.py:157`).
- Vitest unit tests in `tests/unit` (112 files), Playwright in `tests/browser` (26 files; webServer runs `pnpm dev`, which currently includes `generate`, on port 5173). `tests/fixtures/assetPackageFixture.ts` builds a synthetic ZIP in memory.
- esbuild 0.28.2 is installed and `editorScript.test.ts` already uses it (metafile import-graph tests). ESLint is not installed. TypeScript 7.0.2 may not expose a JS compiler API.
- 121 of 143 `src/*.ts` files still contain comments; AGENTS.md requires removing all comments in any file a plan touches.

### Integration Points
- `package.json:15-17`: `dev` and `build` run `generate` = `ensure-webgpu-project`, `stage-webgpu-compilers`, `validate-editor-materials`, `preserve-native-editor-uv2`, `babylonjs-editor-cli pack`, `preserve-native-editor-fog`, `share-native-terrain-export-materials`.
- `src/scene/loadEnvironment.ts:34-36` statically imports `loadScene` and `scriptsMap`; `:48-61` loads `native-parity.babylon` for `?world=interlude` or `native-world.babylon` with `authored=1`; `:63-87` loads `example.babylon` then the reference Talking Island (`loadImportedWorld.ts:60-76`, `/assets/world/manifest.json`).
- `src/scripts/nativeParity.ts:10-30` Editor inspector fields; saved values in `assets/native-parity.scene/config.json` differ from code defaults (`Wait_1HS_MFighter` vs `Wait_Hand_MFighter`, `leatherShirt` true, tint [0.45,1,0.6], roughness 0.45).
- `src/runtime/createNativeSliceRuntime.ts` (914 lines) depends on the Editor scene: `:96` requires an authored "World camera", `:174` `restoreEditorAuthoredMaterials`, `:176` `attachAuthoredNativeSection`, `:205-207` hides 119 courtyard meshes. It must be split while touched (400-line rule).
- Default route procedural stand-ins: `createWorldRuntime.ts:17,37`, `nativeOrProceduralCharacter.ts:55-78`, `CharacterVisual.ts:6-8`; `MockWorldAdapter.ts:151-166` spawns a Fallback Sentinel with `/assets/missing-character.glb`.
- `vite.config.ts:17-27` prints the Editor runner's ready line; `tsconfig` keeps `experimentalDecorators` for Editor decorators.
- 11 of 15 browser specs reference the courtyard, `authored=1` or Editor routes.
- `@babylonjs/inspector` is not installed (`node_modules/@babylonjs`: addons, core, gui, loaders).

</code_context>

<specifics>
## Specific Ideas

- Owner UX preference: sandbox and dev controls are a pinnable sheet with hover-cards showing variables, never a cramped toggle scroll list. The by-ID actions (spawn, equip, cast, open window) go on that sheet.
- All staged media comes from our recipes and scripts; prefer audible, labelled results over more research.
- Merge order for Phase 2 readiness: the NOED work and the contract work (worldTypes additions, catalog reader and index, asset.json v2, lanes.json) land before any Phase 2 lane; the hash lock lands before any read from E:.
- Heavy steps (hashing about 8 GB per machine, `pnpm build`, e2e rewrite, dev cold-start re-measure) run at BelowNormal, outside the relay windows, with started processes stopped afterwards.

</specifics>

<deferred>
## Deferred Ideas

- Restaging `public\l2` to asset.json v2 and deleting v1 reader acceptance: integration thread in the main checkout (Needs Human).
- Removing `NativeSliceAdapter.subscribeCommands` by moving the Power Strike trigger onto `WorldEvent`: only if the contract work makes it free; otherwise Phase 2 integration.
- Rejecting unknown IDs (vs not converted): DATA-01, Phase 2.
- Decoding the 29 layout-only tables and the Elbera-only tables: DATA-01, DATA-02, Phase 2.
- Deleting the reference Talking Island route and the procedural characters: owner decision (logged).

</deferred>
