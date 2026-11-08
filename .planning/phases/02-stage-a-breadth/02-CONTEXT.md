# Phase 2: Stage A breadth - Context

**Gathered:** 2026-11-08 (smart discuss, autonomous; answers taken from an assumptions-analyzer agent's recommendations while the owner is away; every choice is logged in `.planning/OVERNIGHT-DECISIONS.md` for owner review)
**Status:** Ready for planning

<domain>
## Phase Boundary

Every part of the native client is converted, or listed as an explicit gap, and loads in the offline sandbox. Requirements: SAND-02, DATA-01..03, UI-01..03, WORLD-01..08 (WORLD-07 and WORLD-08 provisional, owner review), ACT-01..06, INT-01, CONV-01, CONV-02. Lanes (DEC-OWN-6): L1 world, L2 actors, L3 data + UI, integration.

The full client is far larger than one unattended run. This phase delivers converters, contracts, tests and one end-to-end tracer per lane that is real and verified, plus census-based gap records for everything not yet converted. Breadth batches are resumable and continue in later runs. Unverified is never a pass.

Execution constraints for this run (owner rules, binding on every plan):
- Work only in this worktree `C:\Users\rolan\.t3\worktrees\l2-browser-client\autonomous-roadmap` (branch `plan/autonomous-roadmap`). `public\l2` is a read-only junction to the main checkout's 2.4 GB native store. Never run `assets:*`, `world:stage`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*` or preview scripts against the main checkout or `public\l2`. Never `git worktree remove` this tree.
- Converters may read `E:/Lineage2-client` only through the Phase 1 guard and only for lock-equal files; IMPORTA-PC is read-only over `ssh -p 2026 rolan@importa-pc.tail40ecb2.ts.net`.
- Dev server: `pnpm dev --port 5175`. `pnpm test:e2e` uses port 5173; run it only while nothing listens on 5173.
- No builds, dev servers, tests, installs, hashing or conversions Sun 10:00-14:00 and Thu 19:00-21:30 Riga. Heavy commands at BelowNormal. Check free disk space before a batch run.
- After every plan and verification, stop what you started by PID or by a command line holding this worktree path or port, never by image name.
- Commit only on this branch; no push, no merge.

</domain>

<decisions>
## Implementation Decisions

### A. Execution model and staging boundary
- Lane outputs go to `artifacts/lane-store/<lane>/l2/` in this worktree (ignored), in the same `/l2/<kind>/<sha>/` layout as the native store; the shared catalog writer code builds a lane catalog there.
- The sandbox loads lane outputs through a dev-only Vite switch (`NATIVE_STORE_ROOT`) that serves `/l2/*` from a lane store on port 5175. A test proves the switch is absent from `pnpm build` output. `nativeResourceUrl` is unchanged.
- One branch, one sequential executor: every plan stays inside one lane's `.planning/lanes.json` globs and runs `node scripts/check-lane-ownership.mjs --base <plan start> --part <slug>`. Contract plans come first, so each later plan can be cherry-picked onto a `<part>/<slug>` branch.
- Converter commands get names outside the banned prefixes (`convert:tables`, `convert:world`, `convert:actors`, `convert:ui`). Every converter refuses an output path that resolves through the `public\l2` junction. Each needed restage of the shared store goes under Needs Human in STATE.md with the exact main-checkout command.

### B. World lane (WORLD-01..06)
- Build the genericity audit's staged pipeline under `scripts/world/`, driven by `--map`, starting from the generic bottom layer (raw extractor, class defaults, BSP node reader, `native_batch` adapters). The existing derive, append and migrate chain is retired only after an oracle diff; those scripts are integration-owned store writers, so deleting them is integration work.
- 20_20 oracle: freeze hashes and counts (157 placements, Brush397 and Brush610 subsets, 8 movers, sky `f7a0b5ef`) into a committed `expected.json` holding no L2 bytes, read from the junction and pinned to a recorded catalog SHA.
- Tracer on tile 20_21 (probe hashes already verified), then the 39 tiles that pass the map and terrain-height gates. Every other tile gets a census-based gap record at once.
- Unsupported formats become per-object or per-tile gap records and never block a tile. Readers grow one licensee at a time, each with a fixture and an Elbera or UELib cross-check, in census order (map 23, 25, 30; usx 12). Never fit values.
- Whole tiles in 4x4-sector chunks within the manifest limits; anchor = first enabled PlayerStart; mask UVs outside the 20_20 capture use the sector-layout rule labelled "extrapolated".
- WORLD-04: baseline measurement first, then residency cache; collision cells stay resident in a wider ring than visual cells, and LOD never feeds collision.
- WORLD-06: minimap and world map from `MinimapCtrl`, `zonename`, `huntingzone` once decoded (depends on data lane tables).

### C. WORLD-07 and WORLD-08 (provisional, owner review)
- WORLD-07: a separate read-only reviewer subagent (not the author) re-verifies the 74-file packet's manifest hashes, then gives each finding one verdict (adopted, rejected, polish) in `docs/parts/world/EVIDENCE.md`, with the reviewer identity recorded. Adopted findings become tile-general steps with tests.
- WORLD-08: converter-side collision extraction from source declarations; Elbera's static and BSP collision exporters serve as pinned cross-checks behind an adapter, run by path, not vendored. Unreadable collision is a per-object gap.

### D. Data lane (DATA-01..03)
- The generic `decode_table` decodes all 37 descriptor-linked tables (widen `TABLES`, keep the hash pins). Elbera structure parsers behind an adapter decode hairgrp, helmetgrp and hairaccessarygrp, with field meanings labelled "Elbera 07b24 proof, unverified on 4dd2". L2FileEdit `.ddf` files are a cross-check only.
- Source hashes come from the FOUND-03 lock; a run hashes only the files it reads; the whole-tree `inventory()` hash in `native_catalog/cli.py` is not run per decode.
- DATA-03: a strict descriptor decode of sysstring-e and systemmsg-e (header count, id sets, exact end) settles the 2,083 count; the result goes into the inventory.
- Runtime access: hash-pinned table JSON under a catalog `tables` key (a contract change, its own plan, landed first); sheet pickers read names from it.

### E. Actors lane (ACT-01..06)
- Model recipes are generated from decoded rows (chargrp parts, npcgrp mesh, texture and animation, weapongrp and armorgrp) into lane outputs, never typed by hand.
- Conversion unit = unique mesh (about 554 NPC, 390 weapon, 1,355 armor) with a content-addressed cache; JSON profiles per row.
- Tracer: `npc:20001` Gremlin (`LineageMonsters.gremlin_m00`) through row, profile, mesh, animation, sounds and spawn by ID in the sandbox.
- A census of the 20 `.ukx` licensees comes first; packages outside 28/30 are gaps until the skeletal reader grows.
- Skills: a binding table for all skill id and level rows; assets only for effect classes the existing converter supports; everything else an explicit gap.
- Missing hair and helmet layouts are explicit gaps for ACT-01; no guessed hair selection.

### F. UI lane and sandbox (UI-01..03, SAND-02)
- Elbera `parse_xdat` behind an adapter decodes `interface.xdat`; type-dependent record tails are kept as hashed opaque spans; the source hash is pinned.
- Interface (owner decision DEC-OWN-10, 2026-11-08, commit 62741d8): the only game interface is the original Interlude interface. The UI lane builds native windows only: window layout from the decoded `interface.xdat`, and skin, fonts and icons from the client's UI textures converted by recipe (lane-local outputs). No custom HUD, no design tokens, no custom styling; DESIGN.md is deleted. The procedural HUD and the developer sheet are stand-ins and development tools only and get no styling or polish. Design skills (impeccable, frontend-design) are never used for game UI.
- Tracer: `window:StatusWnd` with `StatusLeftTex`, `CPBarTex`, `HPBarTex`, `MPBarTex`, filled from `MockWorldAdapter` values.
- SAND-02: `DevSheet.ts` (734 lines) is split when the tile, spawn, equip, cast, window and audio pickers are added; pinnable sheet with hover-cards showing variables (owner preference).

### G. Coverage report and order (INT-01, CONV-01, CONV-02)
- One script reads any catalog root plus denominators from decoded tables and the world census (not PORT_SCOPE estimates) and writes `coverage.json` and an EVIDENCE table. "Loads" comes only from a recorded browser check; otherwise unverified.
- Plan order: contract plans first (lane store and output guard, catalog keys `tables`, `windows`, `tiles`, coverage skeleton); then one tracer per lane (data generic decode plus DATA-03, UI StatusWnd, world 20_21 terrain walk with the other steps as gaps, actors Gremlin); then breadth plans per lane (world meshes, BSP and WORLD-08, audio and sky, eligible-39 batch, streaming baseline, minimap, WORLD-07; actors characters, NPC batch, items, skills, audio; UI window registry).
- Done for this run: the four tracers plus census-based gap coverage for every part, with breadth batches resumable through `native_batch`-style seals.

### H. Recipe audit inputs (owner, 2026-11-08 10:25)
Hand-typed recipe values with no recorded source must first become visibly unresolved (a recorded `unresolved` reason in the recipe and an explicit diagnostic at runtime, never a silent default), then be replaced by recipes generated from decoded rows (decision E) or from source class defaults:
- Hair textures and hair colour in `recipes/native-mfighter.json`, `native-mmagic.json`, `native-fmagic.json` and `native-ffighter.json` (and their `native-pipeline-*` twins): unresolved until hairgrp/helmetgrp decode (DATA-02) and generated chargrp assemblies (ACT-01) provide them.
- Female fighter collision 8 / 23.5 in the ffighter recipes: never checked against the class defaults; unresolved until read from the source class defaults (`CollisionRadius`, `CollisionHeight`) by the generator.
- The role-to-column routing in `recipes/native-combat-audio.json`: unresolved until bound from decoded `npcgrp`/`skillsoundgrp` columns with exact source identities (ACT-05).
- The XY windows in `recipes/native-map-20_20.json` and `native-map-debug-location.json`: replaced by the tile-general chunk planner (decision B, 4x4-sector chunks from TerrainInfo); until then labelled hand-chosen presentation windows, not source values.
- `recipes/native-parity.acceptance.json` still has an Editor round-trip block superseded by DEC-OWN-8: remove that block (POL-01 thresholds otherwise unchanged; never relax them).
- The plans that own these: actors lane (generated recipes, ACT-01, ACT-05), world lane (chunk planner, WORLD-01), integration (acceptance file cleanup, CONV-02). Each marks the old value unresolved in the first task that touches its recipe.

### Claude's Discretion
- Plan split, wave order and file layout within AGENTS.md code rules (no comments, full-word names, files under about 400 lines, Vitest per behaviour change, Playwright for UI, no dead code, never invent L2 values).

</decisions>

<code_context>
## Existing Code Insights

Full analyzer output with file:line evidence: `C:\Users\rolan\AppData\Local\Temp\l2b-autonomous\phase2-analyzer.md` (scratch; the essentials are below).

### Reusable Assets
- `scripts/native_catalog/tables.py`: generic `decode_table` (:207-251) with hash-pinned layout, exact consumed bytes, SafePackage trailer; only 8 tables in `TABLES` (:29). Schemas and UModel read by pinned path from lineagen (:16, `native_assets.py:30`).
- `scripts/native_batch.py` with 6 adapters (`native_batch_adapters.py:20`); `--prove-rebuild` rebuilt 52/52 products on 20_21.
- `scripts/vendor/lineage2elbera_bsp` (BSP node reader, pinned in SOURCE.json); raw extractor; class-defaults reader; `native_map.py:48-50` extracts actor collision flags.
- Elbera: `E:\Lineage2Elbera\tools\xdat\parse_xdat.py` (headers, anchors, children, texture refs; tails not decoded); `tools\ui\check_hair_selection_native.py:23-45` (hair parsers); `tools\world\export_static_collision.py`, `export_bsp_collision.py`; `tools\dat\extract_gamedata.py:420-489` (systemmsg tail scanning).
- Phase 1 delivers: `.planning/lanes.json` and `scripts/check-lane-ownership.mjs`; the reference-client lock and guard (`scripts/reference_client_guard.py`, `require_reference_client`); one catalog reader with an L2-ID index; asset.json v2; sandbox by-ID commands; Editor off the build path; the 40-table inventory.

### Established Patterns
- Python pipeline under `scripts/` with unittest in `tests/pipeline` (`pnpm test:pipeline`), private-client tests skip when inputs are absent; Vitest in `tests/unit`; Playwright in `tests/browser`.
- Census (genericity audit INVENTORY.json): 67/153 maps licensee 28, 39 pass map plus terrain-height gates; static-material reader rejects 56/212 `.usx`; texture reader licensee 20/28/30; map and terrain readers 123/28 only; skeletal reader 28/30.

### Integration Points
- `src/scene/world/loadNativeSection.ts`: default section `map-20-20-section`, no `?map=`, max 128 models (:73), BSP whitelist of 4 resources pinned to 20_20 (:96-113).
- `src/assets/native/nativeResourceUrl.ts:5-9` accepts `/l2/...` only; `vite.config.ts` has no `/l2` middleware.
- `src/ui/devSheet/DevSheet.ts` 734 lines; `src/runtime/createNativeSliceRuntime.ts` split in Phase 1.
- Oversized files to split when touched: `scripts/native_map_geometry.py` (1,070 lines).

</code_context>

<specifics>
## Specific Ideas

- Owner UX preference: pinnable sheet plus hover-cards with variables, never a cramped toggle scroll list.
- Prefer audible, labelled results over more research; all staged media from our recipes and scripts.
- Collision is sandbox and presentation support only; server authority over movement is a Phase 4 decision.

</specifics>

<deferred>
## Deferred Ideas

- Staging lane outputs into the shared store (`public\l2`) and retiring the 20_20 derive/append/migrate chain: integration thread in the main checkout (Needs Human).
- Licensing review for vendoring UModel, UELib, ffmpeg and the l2-editor schema XMLs: owner.
- Native footstep surface rules, specialized attack sounds, stair routing, roof camera: Phase 5 polish (DEC-OWN-1).

</deferred>
