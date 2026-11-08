# Phase 2: Stage A breadth - Research

**Researched:** 2026-11-08 (read-only synthesis of four lane researchers plus spot checks; nothing was built, tested, hashed or converted)
**Domain:** Lineage II Interlude client conversion pipeline (Python, UModel, UE2 package readers) and Babylon.js WebGPU sandbox runtime (strict TypeScript, Vite, Vitest, Playwright)
**Confidence:** HIGH for code facts with file:line, MEDIUM for table counts taken from research JSONs whose source hashes match the lock, LOW for anything marked [INF]
**Second pass (same day, HEAD `62741d8`):** section 11 closes 18 review gaps (load-check sweeps, browser and audible checks, the WorldCommand contract, the restage path and v1/v2 mixing, sky and movers, the terrain-height gate, texture licensees, `.ddf` path, LOD, UI-01 counts, notifies, single-lane splits, gap census, the WORLD-07 packet, DEC-OWN-9/10, logged departures, CONV checks, stale facts). Where section 11 and earlier text disagree, section 11 wins.

**Evidence tags used below**
- `[V]` verified by the synthesizer this session (file opened or grepped).
- `[L-world]`, `[L-actors]`, `[L-data]`, `[L-int]`: read this session by that lane researcher, with the file:line given.
- `[INF]`: inference. It needs confirmation by the executor or the owner before it becomes a locked choice.

<user_constraints>
## User constraints (from 02-CONTEXT.md)

### Locked decisions

Copied from 02-CONTEXT.md `<decisions>`:

**A. Execution model and staging boundary**
- Lane outputs go to `artifacts/lane-store/<lane>/l2/` in this worktree (ignored), in the same `/l2/<kind>/<sha>/` layout as the native store; the shared catalog writer code builds a lane catalog there.
- The sandbox loads lane outputs through a dev-only Vite switch (`NATIVE_STORE_ROOT`) that serves `/l2/*` from a lane store on port 5175. A test proves the switch is absent from `pnpm build` output. `nativeResourceUrl` is unchanged.
- One branch, one sequential executor: every plan stays inside one lane's `.planning/lanes.json` globs and runs `node scripts/check-lane-ownership.mjs --base <plan start> --part <slug>`. Contract plans come first, so each later plan can be cherry-picked onto a `<part>/<slug>` branch.
- Converter commands get names outside the banned prefixes (`convert:tables`, `convert:world`, `convert:actors`, `convert:ui`). Every converter refuses an output path that resolves through the `public\l2` junction. Each needed restage of the shared store goes under Needs Human in STATE.md with the exact main-checkout command.

**B. World lane (WORLD-01..06)**
- Build the genericity audit's staged pipeline under `scripts/world/`, driven by `--map`, starting from the generic bottom layer (raw extractor, class defaults, BSP node reader, `native_batch` adapters). The existing derive, append and migrate chain is retired only after an oracle diff; those scripts are integration-owned store writers, so deleting them is integration work.
- 20_20 oracle: freeze hashes and counts (157 placements, Brush397 and Brush610 subsets, 8 movers, sky `f7a0b5ef`) into a committed `expected.json` holding no L2 bytes, read from the junction and pinned to a recorded catalog SHA.
- Tracer on tile 20_21 (probe hashes already verified), then the 39 tiles that pass the map and terrain-height gates. Every other tile gets a census-based gap record at once.
- Unsupported formats become per-object or per-tile gap records and never block a tile. Readers grow one licensee at a time, each with a fixture and an Elbera or UELib cross-check, in census order (map 23, 25, 30; usx 12). Never fit values.
- Whole tiles in 4x4-sector chunks within the manifest limits; anchor = first enabled PlayerStart; mask UVs outside the 20_20 capture use the sector-layout rule labelled "extrapolated".
- WORLD-04: baseline measurement first, then residency cache; collision cells stay resident in a wider ring than visual cells, and LOD never feeds collision.
- WORLD-06: minimap and world map from `MinimapCtrl`, `zonename`, `huntingzone` once decoded (depends on data lane tables).

**C. WORLD-07 and WORLD-08 (provisional, owner review)**
- WORLD-07: a separate read-only reviewer subagent (not the author) re-verifies the 74-file packet's manifest hashes, then gives each finding one verdict (adopted, rejected, polish) in `docs/parts/world/EVIDENCE.md`, with the reviewer identity recorded. Adopted findings become tile-general steps with tests.
- WORLD-08: converter-side collision extraction from source declarations; Elbera's static and BSP collision exporters serve as pinned cross-checks behind an adapter, run by path, not vendored. Unreadable collision is a per-object gap.

**D. Data lane (DATA-01..03)**
- The generic `decode_table` decodes all 37 descriptor-linked tables (widen `TABLES`, keep the hash pins). Elbera structure parsers behind an adapter decode hairgrp, helmetgrp and hairaccessarygrp, with field meanings labelled "Elbera 07b24 proof, unverified on 4dd2". L2FileEdit `.ddf` files are a cross-check only.
- Source hashes come from the FOUND-03 lock; a run hashes only the files it reads; the whole-tree `inventory()` hash in `native_catalog/cli.py` is not run per decode.
- DATA-03: a strict descriptor decode of sysstring-e and systemmsg-e (header count, id sets, exact end) settles the 2,083 count; the result goes into the inventory.
- Runtime access: hash-pinned table JSON under a catalog `tables` key (a contract change, its own plan, landed first); sheet pickers read names from it.

**E. Actors lane (ACT-01..06)**
- Model recipes are generated from decoded rows (chargrp parts, npcgrp mesh, texture and animation, weapongrp and armorgrp) into lane outputs, never typed by hand.
- Conversion unit = unique mesh (about 554 NPC, 390 weapon, 1,355 armor) with a content-addressed cache; JSON profiles per row.
- Tracer: `npc:20001` Gremlin (`LineageMonsters.gremlin_m00`) through row, profile, mesh, animation, sounds and spawn by ID in the sandbox.
- A census of the 20 `.ukx` licensees comes first; packages outside 28/30 are gaps until the skeletal reader grows.
- Skills: a binding table for all skill id and level rows; assets only for effect classes the existing converter supports; everything else an explicit gap.
- Missing hair and helmet layouts are explicit gaps for ACT-01; no guessed hair selection.

**F. UI lane and sandbox (UI-01..03, SAND-02)**
- Elbera `parse_xdat` behind an adapter decodes `interface.xdat`; type-dependent record tails are kept as hashed opaque spans; the source hash is pinned.
- Interface (DEC-OWN-10, commit 62741d8): the only game interface is the original Interlude interface; the UI lane builds native windows only, layout from the decoded `interface.xdat`, skin, fonts and icons from UI textures converted by recipe (lane-local outputs). No custom HUD, no design tokens; DESIGN.md is deleted; the procedural HUD and developer sheet are unstyled stand-ins; design skills are never used for game UI.
- Tracer: `window:StatusWnd` with `StatusLeftTex`, `CPBarTex`, `HPBarTex`, `MPBarTex`, filled from `MockWorldAdapter` values.
- SAND-02: `DevSheet.ts` (734 lines) is split when the tile, spawn, equip, cast, window and audio pickers are added; pinnable sheet with hover-cards showing variables (owner preference).

**G. Coverage report and order (INT-01, CONV-01, CONV-02)**
- One script reads any catalog root plus denominators from decoded tables and the world census (not PORT_SCOPE estimates) and writes `coverage.json` and an EVIDENCE table. "Loads" comes only from a recorded browser check; otherwise unverified.
- Plan order: contract plans first (lane store and output guard, catalog keys `tables`, `windows`, `tiles`, coverage skeleton); then one tracer per lane (data generic decode plus DATA-03, UI StatusWnd, world 20_21 terrain walk with the other steps as gaps, actors Gremlin); then breadth plans per lane (world meshes, BSP and WORLD-08, audio and sky, eligible-39 batch, streaming baseline, minimap, WORLD-07; actors characters, NPC batch, items, skills, audio; UI window registry).
- Done for this run: the four tracers plus census-based gap coverage for every part, with breadth batches resumable through `native_batch`-style seals.

**Execution constraints** (from 02-CONTEXT.md `<domain>`): work only in this worktree on `plan/autonomous-roadmap`. `public\l2` is a read-only junction. Never run `assets:*`, `world:stage`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*` or preview scripts. E: is read only through the guard and only for lock-equal files. Dev runs on `pnpm dev --port 5175`. `pnpm test:e2e` uses 5173 and runs only while nothing listens there. No builds, dev servers, tests, installs, hashing or conversions Sun 10:00-14:00 or Thu 19:00-21:30 Riga. Heavy commands run at BelowNormal. Check free disk before a batch. Stop processes by PID or by worktree path or port, never by image name. Commit only on this branch: no push, no merge.

### Claude's discretion
- Plan split, wave order and file layout within AGENTS.md code rules (no comments, full-word names, files under about 400 lines, Vitest per behaviour change, Playwright for UI, no dead code, never invent L2 values).

### Deferred ideas (out of scope)
- Staging lane outputs into the shared store (`public\l2`) and retiring the 20_20 derive/append/migrate chain: integration thread in the main checkout (Needs Human).
- Licensing review for vendoring UModel, UELib, ffmpeg and the l2-editor schema XMLs: owner.
- Native footstep surface rules, specialized attack sounds, stair routing, roof camera: Phase 5 polish (DEC-OWN-1).
</user_constraints>

<phase_requirements>
## Phase requirements

| ID | Description (short, REQUIREMENTS.md) | Research | Plans |
|----|------|------|------|
| SAND-02 | Pinnable sheet with hover-cards: tile, spawn, equip, cast, window, audio | 5.4 | 02-22 |
| DATA-01 | All 40 tables to JSON, local descriptor authoritative, inventory per table | 5.3 | 02-10, 02-20 |
| DATA-02 | hairgrp, helmetgrp, others via Elbera adapter; no `07b24af4` verifiers | 5.3 | 02-21 |
| DATA-03 | sysstring-e / systemmsg-e 2,083 count fixed or explained | 5.3 | 02-10 |
| UI-01 | `interface.xdat` layout tree with source-hash pin | 5.4 | 02-11 |
| UI-02 | Windows from decoded layout, no hard-coded names, open by ID | 5.4 | 02-12, 02-23 |
| UI-03 | Only the original Interlude interface (DEC-OWN-10): native windows from `interface.xdat` with converted UI textures, checked at 932 x 430 and 430 x 932 (DEC-OWN-9) | 5.4, 11.15 | 02-23 |
| WORLD-01 | 153 tiles through tile-general terrain, mesh and BSP steps | 5.1 | 02-13..16, 02-25, 02-26, 02-28, 02-33 |
| WORLD-02 | Sky, ambient and placement audio per tile, original bytes | 5.1 | 02-27 |
| WORLD-03 | Coverage per tile per step; 10 non-tile maps classified; Lobby known | 5.1 | 02-13 |
| WORLD-04 | Bounded cells: baseline, residency, LOD, wider collision ring | 5.1 | 02-29, 02-30 |
| WORLD-05 | Walk any converted tile with terrain collision | 5.1 | 02-16 |
| WORLD-06 | Minimap and world map from `MinimapCtrl`, `zonename`, `huntingzone` | 5.1 | 02-31 |
| WORLD-07 | Independent review of the 74-file packet, one verdict each | 5.1 | 02-24 |
| WORLD-08 | Collision from source declarations only; per-object gaps | 5.1 | 02-26 |
| ACT-01 | All chargrp characters; hair and helmet gaps | 5.2 | 02-37 |
| ACT-02 | npcgrp NPCs by ID; mesh name never selects a profile | 5.2 | 02-18, 02-35, 02-36 |
| ACT-03 | Items equip by ID, sockets preserved | 5.2 | 02-38, 02-39 |
| ACT-04 | Clips with names, timing, notifies; play any clip | 5.2 | 02-41 |
| ACT-05 | Sounds bound with exact identities; unresolved stays unresolved | 5.2 | 02-42 |
| ACT-06 | Skill visuals via skillgrp, skillsoundgrp, npcgrp; native-dispatch gaps | 5.2 | 02-40 |
| INT-01 | Coverage per part (converted, loads, gap); sandbox available/gap; restage handoff | 4, 5.5 | 02-01..07, 02-19, 02-43 |
| CONV-01 | Independent per-system scripts; one item converts alone | 5.5 | 02-08 |
| CONV-02 | UModel pin, no normalisation, magenta slots, `.l2asset` limits | 5.5 | 02-08 |
</phase_requirements>

## 1. Summary

Within each lane, Phase 2 is mostly **new orchestration around readers that already exist**. The world raw extractor, terrain maths, BSP reader and class-defaults reader already run on any tile, while everything above them is pinned to 20_20. `native_assets.Converter`, `native_actor_profiles`, `native_effect_bundle` and the skeletal reader already handle a single actor. `decode_table` already supports every field type the 37 Interlude layouts use. Elbera's `parse_xdat` can be imported as a library.

Breadth is blocked by three things, not by reader code. First, missing contracts: lane store, output guard, catalog keys, chunk manifest kind, a shared seal ledger and a gap schema. Second, ownership: many needed files belong to another lane or to integration. Third, machine limits: low free disk on C: (figure unverified, see pitfall 1) and the relay windows. **Done for this run** means four tracers (data decode plus DATA-03, UI StatusWnd, world 20_21 terrain walk, actors Gremlin) plus census-based gap rows for every part. Breadth then continues in later runs from sealed units.

**Primary recommendation:** run the integration contract wave first (02-01..02-09), then one tracer per lane, then breadth. Lane plans import integration code and never edit it. A change in a foreign file becomes its own small contract plan ahead of the lane plan.

## 2. Architectural responsibility

Guarded Python readers own client bytes. Lane converters (`scripts/<lane>/`) orchestrate the shared readers. The filesystem lane store mirrors `public/l2` prefixes. A dev-only Vite plugin serves it. The browser owns catalog validation, the ID index, streaming and the collision ring. `GameWorldAdapter`/`MockWorldAdapter` owns HP, CP and MP, and the client never computes them. Coverage is a Python report fed by browser load-check records.

## 3. Standard stack and reuse

No new packages are needed. **No installs** (relay rule) and **no Package Legitimacy Audit** are required, because this phase installs nothing. capstone is absent, which is why Elbera `--native-binding-check` is excluded.

| Piece | Where | Use |
|---|---|---|
| Reference guard | `reference_client_guard.py` `require_equal_file`; stat-first, re-hash only on size/mtime change (`:78-81`) [L-world] | Every E: read, incl. Elbera inputs |
| Raw map extractor | `native_map.py` (512 lines [V]) `build_map :293-410`, `COLLISION :49-51` [L-world] | World raw step |
| Terrain maths | `native_map_geometry.py` (1,043 lines [V]) `select_terrain_sectors :196-245`, `build_section_runtime :933` | Chunk terrain; split on touch |
| BSP reader | `scripts/vendor/lineage2elbera_bsp` (`SOURCE.json` pins, licensee ≥23 `:267-268`) | Whole-level BSP; untouched |
| Converter | `native_assets.py` `Converter` (795 lines; UModel pin `:31-32`; `convert` CLI `:761-772`) [L-actors][L-int] | Imported only |
| NPC profiles, effects | `native_actor_profiles.py` (`:46`, `:156-159`); `native_effect_bundle.py` (`MAX_CLASSES = 96` `:29`) | Actors-owned |
| Table decoder | `native_catalog/tables.py` (241 lines): `TABLES` `:27`, `table_source_path` `:176`, `decode_table` `:198` [V] | Widen to 37 layouts |
| Elbera tools | `parse_xdat.py` `scan :514`, `build_tree :561`; `check_hair_selection_native.py:23-45`; `export_static_collision.py`, `export_bsp_collision.py` [L-data][L-world] | Pinned-path adapters |
| Seal pattern | `native_batch.py` (`:148-150, :180, :238, :251-261, :296-297`) | Shape copied once into the shared ledger |
| Catalog reader and index | `readNativeCatalog.ts` (`:12-24`, `:47-57` drops unknown keys), `nativeCatalogIndex.ts` (`:22-26`, `:87-96`) | Extend with new keys |
| Ownership check | `check-lane-ownership.mjs`: `git diff --name-only <base>...HEAD` (`:133`), options `--base`/`--part` only (`:110`) [V] | Every plan |
| Shared tests | lanes.json `sharedByAllLanes`: `tests/browser/**`, `tests/fixtures/**`, `tests/pipeline/**`, `tests/unit/**` [V] | Any lane may add tests |
| Scripts | `"test:unit": "vitest run"`, `"test:e2e": "playwright test"`, `"test:pipeline": "python scripts/test_pipeline.py"`, `"assets:convert": "python scripts/native_assets.py convert"` [V package.json] | Validation |

### Don't hand-roll

| Problem | Do not build | Use instead |
|---|---|---|
| Reparse and junction refusal | a third `checked`/`child` copy | Extract the one in `native_batch.py:54-67` / `stage_native_players.py:61-84` into the store-paths module (02-01) |
| Resumable batches | a per-lane seal driver each | One shared ledger module (02-02) used by world, actors and data |
| Catalog writes | per-lane catalog JSON writers | The catalog writer library extracted from `stage_native_runtime.py:273-339` (02-03) |
| Table decoding | new dat readers | `decode_table` plus pins; Elbera only for the 3 hair tables |
| xdat parsing | a fresh xdat reader | `parse_xdat.scan` / `build_tree` by pinned import |
| BSP and collision readers | new BSP code | The vendored reader; Elbera exporters as cross-check |
| Hashing client files | `native_catalog/cli.py inventory()` (whole 7.84 GB tree) | Lock `eSha256` plus the guard's stat check |

## 4. Architecture and contracts

### 4.1 Data flow

```
E:/Lineage2-client --(require_equal_file)--> lane converter step (scripts/<lane>/...)
      |                                               |
      |                                    per-unit ledger row (sealed, fingerprinted)
      |                                               |
      v                                               v
 lock eSha256 (no re-hash)            artifacts/lane-store/<lane>/l2/<prefix>/<sha>/...
                                                      |
                                  catalog writer library (lane catalog.json, sourceCatalogSha256)
                                                      |
                     +--------------------------------+------------------------------+
                     v                                                               v
   coverage report (denominators: inventory, lock, census)       Vite dev plugin (NATIVE_STORE_ROOT, 5175)
                     |                                                               |
                     v                                                               v
      coverage.json + EVIDENCE table  <-- load-check records <-- Playwright / sandbox by-ID commands
```

### 4.2 Lane store layout (contradiction resolved)

CONTEXT A says "`/l2/<kind>/<sha>/` layout". The real store is mixed [L-int][L-actors]:

| Item | Path | Source |
|---|---|---|
| Models and textures | `/l2/<archiveSha>/asset.l2asset` and `model.glb`, **no kind prefix** | `stage_native_runtime.py:304-318`; `loadNativeCatalog.ts:12` |
| Sections | `maps/<manifestSha>/map-section-runtime/manifest.json` | `:99-100, :151` |
| NPC profiles | `npc-profiles/<sha>/` | `:264` |
| World audio | `world-audio/<sha>/` | `stage_native_world_audio.py:44` |

**Resolution:** lane stores reuse these exact prefixes. Only new kinds get new prefixes: `tables/<sha>/`, `windows/<sha>/`, `tiles/<sha>/`, and a new chunk kind under `maps/<sha>/<kind>/`. The world researcher's `/l2/models/<sha>/` is wrong and must not be used. This keeps CONTEXT's intent, which is that a lane catalog merges into `public/l2` unchanged.

Browser path rule: `nativeResourceUrl.ts:6` `^\/l2\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$` [L-int]. All new names must satisfy it.

### 4.3 Output guard (contract 02-01)

`public/l2` in this worktree is a junction to the main store. `Converter.__init__` (`native_assets.py:143-149`) uses `Path(output).resolve()` and refuses only output under the client, so `--output public/l2/...` would write into the main store [L-int][INF]. Recommended `scripts/native_store/store_paths.py` (unclaimed, so integration):
- `refuse_reparse_points(path)`, moved from `native_batch.py:54-67` and `stage_native_players.py:61-84` (same logic).
- `lane_store_root(project_root, lane_name)`, validating against lanes.json lane keys [INF: confirm exact keys].
- `require_converter_output(project_root, output)`: realpath under `<project>/artifacts/` (allowlist), not under `realpath(public/l2)`, no reparse ancestor.

Bind it at `Converter.__init__`, `native_catalog/cli.py --output` (`:209`), `native_batch.run` and every new `scripts/<lane>/` entry point, enforced by a scan test (01-08 pattern).

### 4.4 Shared unit ledger and gap schema (contract 02-02; reconciles three lane proposals)

World, actors and data each proposed their own `native_batch`-style seal driver; DRY requires one owner. `native_batch.run` itself is unfit for breadth: all-or-nothing, interrupted output never reused (`:180, :223-229`); at most 256 jobs (`:117`); `verify_lock` re-hashes every locked file each run (`:102`); source roots must be inside the project with no junctions (`:54-68, :125`); no map, table or window adapters (`native_batch_adapters.py:20`).

Recommended `scripts/native_store/unit_ledger.py` [INF]:
- Layout `work/<unit>/<step>/{owner.json, .running.json, receipt.json, complete.json}`; rerun skips a verified seal, redoes `.running.json` without a seal.
- Fingerprint = lock SHA-256 of inputs + step `algorithmVersion` + config. Never implementation self-hashes (today `native_bsp_floor.py:299`, `native_bsp_building.py:176`, `native_map_overlap.py:422-433` embed them, so a comment edit rehashes the chain).
- Preflight: refuse inside relay windows (Riga time), below a configured free-disk floor, or through `public/l2`; run at BelowNormal.

Gap row, shared by all lanes and read by coverage: `{key, part, step, status: "pass"|"gap"|"pending"|"failed", reason, sourceIdentity, evidence}` with `key` one of `tile:XX_YY`, `npc:<id>`, `item:<id>`, `skill:<id>:<level>`, `table:<name>`, `window:<name>`. Reasons are a closed, versioned list extended by lane plans. Seed: `map-licensee-unsupported:<v>/<lic>`, `terrain-height-package-missing`, `skeletal-licensee-unsupported:<v>/<lic>`, `no-mesh-in-row`, `animation-reference-missing`, `actor-default-unresolved:<field>`, `multi-slot-binding-unsupported`, `hair-layout-undecoded`, `helmet-layout-undecoded`, `native-skill-dispatch-required`, `no-exact-skillsound-row`, `effect-class-unsupported:<class>`, `sound-identity-unresolved`, `decode-failed:<error>`, `control-type-unsupported:<type>`, `collision-unreadable`, `adapter-field-absent:<field>`.

### 4.5 Catalog writer and lane catalog (contract 02-03)

No single writer exists: about 8 `stage_*` scripts patch `public/l2/catalog.json` behind `--expected-catalog-sha256` and hard-code `public/l2` (`stage_native_runtime.py:273-276`, `stage_native_world_audio.py:30-31`, `stage_native_players.py:204-205`) [L-int]. `stage_runtime` already separates pure build (`:281-324`), pre-verify (`:327-330`) and write (`:331-335`); `immutable_write`/`replace_file` at `:40-59`.

Extract `scripts/native_store/catalog_writer.py` (`build_runtime_store_files`, `merge_catalog_slice(catalog, slice_name, record, capacity)`, `write_store(store_root, files, before, after)`); stagers keep their CLIs and are never run. Add `scripts/native_store/write_lane_catalog.py`: writes `artifacts/lane-store/<lane>/l2/catalog.json` with `sourceCatalogSha256`, unions lane stores refusing duplicate ids, and `--plan` prints the main-checkout restage commands for Needs Human.

**20_20 baseline:** the plugin serves `catalog.json` only from the lane store and falls back to `public/l2` read-only for other (hash-addressed) paths; the lane catalog pins the base `sourceCatalogSha256` [INF]. Copying base records would duplicate the 20_20 chain.

Size bounds: `native_batch.MAX_JSON` 32 MiB; stagers decode at most 8,000,000 B; world audio `MAX_FILE, MAX_TOTAL, MAX_RECORDS = 8_000_000, 96_000_000, 8`. `skillgrp.json` is 14.5 MB, `npcgrp.json` 16.3 MB, so table manifests need their own bound and lazy fetch, never inlined.

### 4.6 Catalog keys and chunk manifest kind (contracts 02-04, 02-05)

`validateNativeCatalog` copies only known slices, so unknown keys are **silently dropped** (`readNativeCatalog.ts:47-57`); land both halves back to back. Index statuses are only `"converted" | "not-in-catalog"` (`nativeCatalogIndex.ts:13-15`); `window:` always answers "not converted yet (UI-01)" (`:26`); `tile:` comes from `^map-(\d{2})-(\d{2})-section$` (`:25`) [L-int].
- **02-04 (integration):** shapes in `docs/OUTPUT_CONTRACT.md`, writer validation, golden regeneration via `scripts/generate_golden_fixtures.py`.
- **02-05 (actors files, `--part npcs`):** `NativeCatalog` slices, `table:`/`window:`/`tile:` keys from the slices, a `gap` status.

Shapes [INF]: keep `{id, manifest, manifestSha256, manifestBytes}`, add `tables` `{id, recordCount, sourceSha256}`, `windows` `{id}` (duplicate names need a disambiguating scheme), `tiles` `{id:"XX_YY"}` whose manifest lists chunk manifests. New kind **`native-tile-chunk-runtime` v1** [INF]: zero or more models, chunk and tile ids, terrain resource, separate collision resource, gaps list. The old parser rejects 0 or more than 128 models (`loadNativeSection.ts:71` [V]) and BSP with `sourceModel !== "20_20.Model798"` (`:99` [V]); add the new kind, keep the old one until the 20_20 chain retires.

### 4.7 `NATIVE_STORE_ROOT` dev plugin (contract 02-06)

`vite.config.ts` has no `/l2` middleware; port `DEV_PORT || 5173` with `strictPort` (`:45-46`); `:1` is an Apache-2.0 attribution comment (open question 1) [L-int]. `configureServer` middlewares run before internal ones and `apply: "serve"` limits a plugin to dev [CITED: vite.dev/guide/api-plugin].

Shape: new `vite/nativeStoreRootPlugin.ts` (`apply: "serve"`); root must resolve under `artifacts/lane-store/<lane>/l2` and not to `public/l2`'s realpath; request paths checked against a copy of the `nativeResourceUrl.ts` regex with an agreement test (that file stays untouched); content types for `.json`, `.glb`, `.png`, `.ogg`, `.wav`, `.l2asset` (`application/zip`); single-range support or `Accept-Ranges: none`, since music uses `<audio>` (`src/audio/worldMusic.ts:147`) [INF]. Start after 01-09 and 01-16, which also edit `vite.config.ts` and `package.json`.

### 4.8 Coverage (contract 02-07, INT-01)

Denominators come only from committed data [L-int]:

| Part | Denominator source |
|---|---|
| Tables | 40, from `docs/parts/data/dat-table-inventory.json`, using its `recordCount`; the literal `"unknown"` stays unknown |
| Tiles | 153, from `recipes/reference-client-tree.lock.json` (`maps/\d{2}_\d{2}.unr`, all `equal`) |
| NPCs | npcgrp 6,519 |
| Items | 9,238 (itemname-e; etcitemgrp 6,911 still undecoded) |
| Skills | skillgrp 29,812 rows |
| Characters | chargrp 15 rows, 14 real plus 1 padding; do not count padding [INF] |
| Windows | `unknown` until UI-01; never PORT_SCOPE's "about 140" |

Rules:
- The tile census used for gap reasons must be the **committed** world census (02-13), not the ignored `INVENTORY.json`. Until 02-13 lands, every tile is `gap: census pending`.
- "Loads" counts only from load-check records, for example `artifacts/lane-store/<lane>/load-checks/<catalogSha>.json` written by Playwright and pinned to the catalog SHA. Everything else is `unverified`.
- `coverage.json` goes into the measured store root, served as `/l2/coverage.json`, so the sandbox reads it through the catalog path (DEC-OWN-5 forbids a second merged manifest).
- The committed table should be one integration-owned doc (open question 3).

## 5. Per-lane findings

### 5.1 World lane (WORLD-01..08)

**Runs for any tile today** (20_21 probe) [L-world]: raw extractor in about 7 s (11,424 exports, 3,205 StaticMeshActors, 518 Model, 256 TerrainSector, 7 BlockingVolume, 4 PlayerStart, 2,875 AmbientSoundObjects); terrain maths (3x3 rectangle: 2,401 vertices, 4,608 triangles, 9 layers); BSP reader (`Model327`, 4,493 nodes, 495 brushes).

**Pinned to 20_20** (each becomes a per-tile step or is bypassed by the new manifest kind):
- Format gates 123/28 only: `native_map.py:94-95, :202-203, :298-299`, `native_map_geometry.py:110-112`; mandatory section box `native_map.py:248-255, :324`.
- Mask UV: `qualified_mask_uv_rule` (`native_map_geometry.py:312-340`) answers only for `maps/20_20.unr`, formula `'(gridXY + 0.5) / heightmapDimensions - max(gridXY - 240, 0) / 4096'` (`:325`); `MASK_UV_LAYER_PAIRS` (`:42-51`).
- Runtime: `loadNativeSection.ts:69, :71-72, :95-104, :149`; `nativeTerrainPatch.ts:15-16,34-38,58-88` (sector 247, Y origin 65536); `nativeTerrainPreview.ts:187,191`; `nativeBspResources.ts`; `nativeSkyPresentation.ts:15`; `nativeMoverManifest.ts:48`; `createNativeSliceRuntime.ts:155`.
- Converters: `native_sky.py:27,146-155,252` (`exports[389]`); `export-native-map-audio.py:449-451` (self-copied `expectedInventory`); `world_music.py:231,244`; `world_ambience.py:1`. Audio runtime `worldAudioControls.ts:174,240,261,285` is actors-owned.

**Census** (INVENTORY `fleetCensus`, IMPORTA headers): 163 maps = 153 tiles + 10 non-tile. Tile licensees 28: 67, 23: 38, 25: 17, 30: 15, 18: 6, 31: 6, 16: 2, 19: 1, 20: 1. **39 eligible:** 16_25, 17_12, 18_10, 18_11, 18_12, 18_17, 18_20, 18_22, 19_10, 19_16, 19_17, 19_22, 19_24, 20_10, 20_14, 20_17, 20_20, 20_21, 20_23, 21_15, 21_16, 21_22, 21_24, 22_14, 22_15, 22_16, 22_18, 22_20, 22_23, 23_13, 23_14, 23_16, 23_17, 23_21, 23_22, 24_15, 24_19, 24_22, 25_19 (assumes heightmaps in `T_<tile>.utx`). Non-tile: `Auto0..5` 118/0, `entry` Ver111 123/0, `Lobby` 123/30, `ship_position` Ver111 118/6, `skylevel` 118/0. Lobby is a "map reader licensee 30" gap until the reader grows [INF], which satisfies "status known". 56 of 212 `.usx` are outside `REVIEWED_VERSIONS` (`static_materials.py:16`); on 20_21, 599 of 3,205 placements use rejected layouts.

**20_20 oracle state** (junction catalog): `map-20-20-section` manifest `2e73654e…8d8a`, 62 models, 157 placements, BSP `Brush397` and `Brush610`, 1 terrain patch, 1 `unsupportedRuntimeMaterials`; no `skies` key (sky and movers: 11.5). Diff a generic rebuild as a subset, since dropping the Z window may add placements [INF].

**Steps under `scripts/world/`:** `tile_census.py` (committed `docs/parts/world/tile-census.json`, no L2 bytes), `raw_map_step.py` (wraps `build_map`, optional section box), `tile_chunk_plan.py` (frame from TerrainInfo `Location`/`TerrainScale`, 4x4 chunks via `select_terrain_sectors`, first enabled PlayerStart in source order), per-chunk terrain (label `extrapolated`; policy `'require-xy-preserve-z-discrepancies'`, since 238/256 sectors on 20_21 have a cached Z mismatch), `world_coverage.py`. The probe's `(x-20)*32768` frame and hand-picked `PlayerStart4` are cross-checks only.

**WORLD-04/05:** `createWorldNavigation` (moved by 01-15 commit `ba9925b` to `src/scene/navigation/meshNavigation.ts:142` [V]; unclaimed path, so integration) builds terrain once and appends obstacles forever. The 20_21 tracer passes terrain at construction, so **WORLD-05 needs no navigation change**; WORLD-04 needs cell add/remove and `isReady` false while cells are missing (contract 02-29). Baseline is headless counts, bytes and load time; FPS only with `WORLD_HARDWARE_TEST=1` (`measure-native-world.mjs:19`), which serves built `dist`, so run after 01-09.

**WORLD-06:** last; needs DATA-01 `zonename-e`/`huntingzone-e`, UI-01 `MinimapCtrl`, and `systextures/L2_RadarMap.utx`, `town_map.utx`, `l2zonename.utx` (licensees unchecked).

**WORLD-07:** packet of 74 files plus `SHA256_MANIFEST.json` and `DELIVERY_VERIFICATION.json`, 1,083,894 B; review never ran. Path, fixtures and reviewer: 11.14. `bUseAlpha`, Y>240 and alpha precision stay POL-01.

**WORLD-08:** sources are actor flags (`native_map.py:49-51`, defaults via `native_map_geometry.py:416-466`), slot `EnableCollision` (`nativeBspSupport.ts:35-43`), serialized mesh collision (Elbera reads it at `export_static_collision.py:173-211,1525`), BSP PolyFlags plus BlockingVolumes. Elbera adapter: resolve map plus `.usx` closure, `require_equal_file` each, run only `--audit`, `--check` or `--sweep-output <lane path>` at BelowNormal, record commit 12c9656 and script SHA. Never `--emit` (writes Elbera `assets/world/`, `:1873-1879`) or `--stage`; skip `--native-binding-check` (no capstone). `E:/Lineage2Elbera/assets/interlude` is a junction to the client, so Elbera reads E: unguarded.

**Ownership:** world owns `scripts/world/**`, `recipes/world/**`, `src/scene/world/**`, its part docs, and by path `native_map*.py`, `native_sky.py`, `native_bsp_*.py`, `extract-native-terrain-patch.py`, `bundle-native-*.py`, `export-native-music.py`, `native_environment.py`, `measure-native-world.mjs`, the vendored BSP. Foreign: `src/world/**`, `src/runtime/**`, `package.json`, `vite.config.ts`, `native_assets_lib/**`, `export-native-map-audio.py` (integration); `src/audio/**` (actors).

### 5.2 Actors lane (ACT-01..06)

**Ownership:** actors owns `scripts/actors/**`, `native_actor_profiles.py`, `native_effect_bundle.py`, `native_animation_families.py`, `src/assets/native/**`, `src/audio/**`, `src/effects/**`, `src/animation/**`, `recipes/actors/**`. It imports but never edits `native_assets.py`, `native_catalog/**` (data-ui), `src/world/**` and `src/runtime/**`. The 8 actor tables are already in `TABLES`; only `itemname-e`, `classinfo-e`, `hairgrp`, `helmetgrp` wait on data.

**Table facts** (MEDIUM, source SHA equals lock) [L-actors]:
- npcgrp 6,519 rows: 554 unique `mesh_name` incl. `''` on 94 rows; 634 (mesh, texture list) combinations; 819 classes; 5,199 rows with more than one texture.
- weapongrp 1,313 rows, 391 `wp_mesh`; `body_part` values 14/7/8/0 have no decoded meaning (no invented slot names).
- armorgrp 1,014 rows, 1,348 unique `mtx_mesh_` (PORT_SCOPE 1,355 probably counts `_add` [INF]).
- chargrp 15 rows; existing recipes use index 0 MFighter, 1 FFighter, 8 MMagic, 9 FMagic.
- skillgrp 29,812 rows, 2,694 IDs; `description` empty on 17,576 rows (native dispatch, ACT-06 gaps); 245 visual roots. Power Strike (skill 3) has an empty description and exists only through a hand-reviewed `sourceDispatch`.
- skillsoundgrp 1,398 rows, mostly level 1; selectors raise unless exactly one row (`native_effect_bundle.py:219-227`, `native_catalog/effects.py:303-311`). Record `no-exact-skillsound-row`, no fallback.
- npcgrp `sound_vol`/`sound_radius` labels are swapped (`combat_audio_bundle.py:11-13`).

**Gremlin row** (verbatim excerpt): `"npc_id": 20001, "class_name": "LineageMonster.gremlin", "mesh_name": "LineageMonsters.gremlin_m00", "texture_name": [{"param_texture_name": "LineageMonstersTex.gremlin_t00"}]`; one texture slot, empty attack sound, defense `MonSound.Hit_*`, damage `MonSound.gremlin_dmg_1..3`, attack effect `LineageEffect.p_u002_a`.

**Hard limits:** profiles 16 records × 128 = 2,048 (`loadNativeNpcProfiles.ts:36,54`; `native_actor_profiles.py:46`; `stage_native_runtime.py:215`) vs 6,519 rows; `MAX_CLASSES = 96` per bundle (`native_effect_bundle.py:29, 281-282`); `verify_binding` one slot (`native_assets.py:486-506`); animation only from the mesh package (`:410-416`); assemblies 16 parts (`:580-603`); skeletal gate `(123, 28), (123, 30)` (`skeletal.py:32`).

**Reconciliation, conversion unit:** CONTEXT E says unique mesh, but runtime overrides only tint (`nativeMaterialOverrides.ts`), and two records sharing one `source.object` break the `npc:` join (`nativeCatalogIndex.ts:87-96`). **Resolution:** share the UModel export per mesh through the converter's request-key cache, make a model record per (mesh, ordered textures) (at most 634 NPC units minus 94 empty), and join profiles to a model catalog id. A refinement of CONTEXT E [INF]; log it in OVERNIGHT-DECISIONS.

**Cost:** `Converter.source` hashes every touched source (`native_assets.py:161-171`) and a cache hit re-hashes all dependencies (`:544`; `LineageMonsters.ukx` is 206,730,178 B). `Converter.__init__` walks the tree with `rglob('*')` (`:151-153`), so build one per batch. `shutil.copytree(work, target / 'evidence')` (`:712`) copies UModel work into every output; breadth will not fit in 16 GB [INF]. Fix in integration plan 02-09. UELib decompile is PowerShell per class, 120 s timeout (`native_catalog/effects.py:386-387`); seal often.

**Gremlin tracer:** rows from `decode_table`; generated request with `sourceBinding` paths (`verify_binding` walks them); animation from the serialized `Animation` reference (`skeletal.py:181`), never a synthesized `gremlin_anim`, else `animation-reference-missing`; profile via `native_actor_profiles` with raises turned into gap rows; exact `MonSound.*` labelled `unique-package-leaf-candidate` (`combat_audio_bundle.py:30-33`); effect as binding record only; lane catalog `models[]` plus `npcProfiles[]`; spawn through 01-14's `sandboxNpcVisual.ts` on 5175 with Playwright for render, clips and the `npc:20002` missing marker.

**Hard-codes to remove when touched:** `loadNativeCatalog.ts:8,50` (`musveren:0`); `nativeHumanHandAnchor.ts:13-17` (two rigs, `Weapon_R_Bone`); `src/world/worldTypes.ts:11` `export type EquipmentSlot = "upper";` (integration); `nativeEffectInitTimeline.ts:12-16`; `loadEffectComponent.ts:149` (Sprite and Mesh emitters only).

**Census first:** only Fighter/Magic (123/30) and LineageMonsters/LineageWeapons (123/28) licensees are known; census the other 15 `.ukx` plus `Skill.usk` with header-only `inspect_header` (`native_catalog/cli.py:85-92`) through the guard. All 20 `animations/` files are lock-equal.

### 5.3 Data lane (DATA-01..03)

**Ownership:** data-ui owns `docs/parts/{data,sandbox,ui}/**`, `recipes/data/**`, `scripts/data/**`, `scripts/native_catalog/**`, `src/ui/**`. Foreign: `scripts/build_dat_table_inventory.py` (unclaimed, integration; 02-01 proposes moving it to data-ui as an owner-review lanes.json change), `src/assets/native/**` (actors), `src/runtime/**` incl. `attachNativeSliceSheet.ts:251-257`, `src/world/worldTypes.ts`, `vite.config.ts`, `package.json`, `DESIGN.md`, `DECISIONS.md`, `STATUS.md` (integration), `src/audio/WorldAudioMixer.ts:362` (actors).

**DATA-01:** all 37 linked layouts in `06_interlude.xml` exist and are `isSafePackage="true"`; their field types (UINT 293, UNICODE 140, FLOAT 110, ASCF 63, MTX 32, INT 14, CNTR 7, UBYTE 2, RGBA 2, UCHAR 1) are all handled by `read_value` [L-data]. Changes:
1. Pin 29 more layouts: actionname, castlename, classinfo, clientdata, commandname, credit, entereventgrp, etcitemgrp, eula, gametip, hairaccessorylocgrp, hennagrp, huntingzone, itemname, logongrp, musicinfo, obscene, optiondata_client, questname, raiddata, recipe-c, servername, skillname, staticobject, symbolname, sysstring, systemmsg, variationeffectgrp, zonename (hashing them is an executor step outside relay windows).
2. Generalise `table_source_path` (`:176` [V]): mixed-case patterns vs lower-case files, `credit` → `creditgrp-e.dat`; one case-insensitive matcher shared with the inventory (`build_dat_table_inventory.py:62`).
3. Fix hard-coded `source` (`:234`); make uniqueness data-driven (`:222-226`), never invent keys; move pins to their own module.
4. New runner `scripts/data/convert_tables.py` on the ledger; never `cli.py main` (it hashes 7.84 GB via `inventory()`).

A cp1252 `UnicodeDecodeError` (`ue2.py:71-78`) escapes `except FormatError`; catch it as a decode failure row, not a tolerance. `tests/pipeline/test_dat_table_inventory.py:100-106` hard-codes `local-layout-only == 29`; update it with the inventory. Synthetic Ver413 ciphertext is impractical (private exponent) [INF]: unit-test `read_nodes`/`read_value` on decoded bytes, `decode413` on skip-if-absent real cases.

**DATA-02:** hairgrp 304 B, helmetgrp 432 B, hairaccessarygrp 432 B, all lock-equal. `dats/hairgrp.xml` has an unsized `for`; helmet and accessory layouts do not exist. Adapter: `decode413`, then `importlib.util.spec_from_file_location` on `check_hair_selection_native.py` by pinned path and SHA with `sys.dont_write_bytecode = True`, call `hair_pairs` (1,800 + 13 B) and `keyed_hair_pairs`, label "Elbera 07b24 proof, unverified on 4dd2", never `verify`/`--check`. Cross-check UCHAR vs int32 readings [INF].

**DATA-03:** both 2,083 counts come from Elbera `extract_gamedata.py`. sysstring's descriptor (`stringID:UINT, string:ASCF`) matches Elbera; systemmsg's Interlude descriptor (`id, UNK_0, message, group, color, sound, voice, win, font, lftime, bkg, anim, scrnmsg, type`) disagrees with Elbera's `id, group, message, unk_0, color` plus tail scan (IDs 2048-2050 missing per Elbera). Strict decode reports header count, exact end, ID sets, max ID and gaps.

### 5.4 UI lane and sandbox (UI-01..03, SAND-02)

**UI-01:** `system/interface.xdat` is lock-equal, 725,233 B, SHA `b5b37678…1b641`, first u32 = 165. Elbera pins a different `Interface.xdat` (`a7969a86…`) and NWindow (`af6c3437…`); our `nwindow.dll` is `differing`. So: anchors labelled "Elbera NWindow af6c3437 proof, unverified on IMPORTA 7c12fb6b"; never `parse_xdat main --check` (edition guards `:770-773`); set module `data_g` before `build_tree` (`:584, :610-622`) or drop tail fields; keep headers plus hashed `[off, end)` tails. Elbera's local `interface.json` (248 roots, 2,638 nodes, 165 declared) is a cross-check target only. Names repeat (`btnClose`, `CPBar`×4, `PartyStatusWnd0`×3), so window ids need a duplicate rule.

**UI-02 StatusWnd:** 256×92; `StatusLeftTex` 4×72 at (79,11); `CPBarTex` at (81,13) with `CPTex_*` and `CPBarName`/`CPBarValue`; `HPBarTex` anchor 7 to `CPBarTex` (0,3); `MPBarTex` to `HPBarTex` (0,1). `WorldEntity` has only `health`/`maximumHealth` (`worldTypes.ts:13-30`; `MockWorldAdapter.ts:197-198` sets 100/100), so **CP and MP are `adapter-field-absent` gaps**; tail labels unresolved; gauge fill a labelled unverified presentation rule. DOM renderer under `src/ui/nativeWindows/`, with a zero-literal-names test. UI `.utx` are Ver121, lock-equal (`L2UI_CH3.utx` 209 MB), licensee vs the 20/28/30 gate unchecked; convert through guarded `native_assets.py convert --kind texture` with lane output [INF], else per-control texture gaps.

**UI-03 (superseded, see 11.15):** DESIGN.md and its tokens were deleted by DEC-OWN-10 (commit `62741d8`); UI-03 now reads "Only the original Interlude interface: window layout from `interface.xdat`, and skin, fonts and icons from the client's converted UI textures. No custom HUD styling (DEC-OWN-10)." [V REQUIREMENTS.md:47]. Phone size is DEC-OWN-9: 932 x 430 landscape, 430 x 932 portrait horizontal-scroll check [V PROJECT.md:70].

**SAND-02:** `DevSheet.ts` 734 lines [V], 92 comment lines; other comment counts: `hoverCards.ts` 35, `sheetGeometry.ts` 27, `devSheetFilter.ts` 17, `types.ts` 13, `devSheetState.ts` 9, `devSheetParts.ts` 8, `WorldInterface.ts` 28. The split is its own task. Reuse `VariableInfo` (`"native" | "presentation" | "unverified"`, `types.ts:5-19`) and `describe(element, info)` (`DevSheet.ts:318`). Sheet sections are wired in integration-owned `attachNativeSliceSheet.ts:251-257`; 01-14 adds `devSheetIdEntry.ts`.

### 5.5 Integration (INT-01, CONV-01, CONV-02)

**CONV-02 exists in code, untested as a contract** [L-int]: `UMODEL_SHA256 = '13502e5a4d8f6b5f32252afebd6360f7302ccfaccf6b8dda65beff0be2d364a0'` (`native_assets.py:32`, refusal `:147-148`); `MAX_ARCHIVE = 128 * 1024 * 1024`, `MAX_PAYLOAD = 96 * 1024 * 1024` (`:34-35`), at most 256 `ZIP_STORED` entries (`:114`); magenta `UNBOUND_SOURCE_SLOT_{index}` with `'baseColorFactor': [1, 0, 1, 1]` (`:337-339`, asserted at `tests/pipeline/test_static_materials.py:178`); `'no height normalization'` basis (`:754`); `restore_native_weights` (`native_assets_lib/weights.py:225`). Add a contract test, a source scan banning normalisation, ground-fit, root-drift and weight-renormalisation (allow-list `restore_native_weights` and `audit_musveren_weights.py`), and an OUTPUT_CONTRACT "Source preservation" section.

**CONV-01:** `native_assets.py convert` already converts one object (`:761-772`). Tests: one target converts with UModel patched (pattern `test_native_assets.py:123`) and no other adapter runs; no `convert:*` entry uses `native_batch` or a banned prefix.

**Part slug** [V]: without `--part`, the check throws on `plan/autonomous-roadmap` (`check-lane-ownership.mjs:128`). Integration parts are `adapter-login`, `adapter-dispatch`, `combat-display`, `npc-dialogs`, `shops-trade`, `social`, `quests`, `late-systems` (lanes.json:131). Contract plans use `--part adapter-dispatch` (same globs) and log it.

**Planning docs trip the check** [V]: it diffs `<base>...HEAD` (`:133`) and `.planning/**` is integration-owned (lanes.json:133). **Run the check after the last code commit, before the SUMMARY/STATE docs commit.**

**Restage handoff:** `STATE.md:115-118` holds "Needs Human (plan 01-12)" lines; each plan producing lane output appends one line from `write_lane_catalog.py --plan` and never runs it.

## 6. Candidate plans, dependencies and waves (one sequential executor)

"Wave" here means order of execution, because one executor runs plans sequentially. Plans within a wave are independent and may run in any order.

- **Wave 0** is a prerequisite: Phase 1 complete. ROADMAP now says "14/17 plans executed"; outstanding are 01-14 (sandbox by-ID visuals, `sandboxNpcVisual.ts`, `devSheetIdEntry.ts`, `tests/browser/sandbox.spec.ts`), 01-16 (Inspector, `vite.config.ts`) and 01-17 (Editor-free route browser checks) [V ROADMAP.md:48 and :73-78, re-read at `62741d8`]. 01-09, 01-11 and 01-15 are done.
- Each plan below has 2-3 tasks. Every plan ends by running `node scripts/check-lane-ownership.mjs --base <plan start> --part <slug>` before its docs commit.

### Wave 1: contracts (integration, `--part adapter-dispatch` unless noted)

| Plan | Requirements | Tasks | Depends on |
|---|---|---|---|
| 02-01 Store paths and output guard | INT-01, CONV-01 | 1. `scripts/native_store/store_paths.py` (reparse refusal deduped from `native_batch.py` and `stage_native_players.py`, lane root, artifacts allowlist, `public/l2` realpath denial) plus pytest with a temp junction (`_winapi.CreateJunction`, skip with reason if unavailable). 2. Bind it in `Converter`, `native_catalog/cli.py --output` and `native_batch.run`, plus a scan test. 3. lanes.json amendments (`build_dat_table_inventory.py` → data-ui) and the OUTPUT_CONTRACT lane-store note with the real mixed prefixes | Phase 1 |
| 02-02 Unit ledger and gap-row schema | INT-01, WORLD-03 | 1. `scripts/native_store/unit_ledger.py` (owner, running, receipt, seal, fingerprint without self-hash, skip-if-sealed). 2. Batch preflight (relay window in Riga time, free-disk floor from config, junction refusal, BelowNormal) plus the gap-row schema and reason list. Pytest: interrupted vs sealed, fingerprint change, preflight refusals with an injected clock and disk | 02-01 |
| 02-03 Catalog writer library and lane catalog | INT-01 | 1. Extract the build, merge and write functions from `stage_native_runtime.py` and `stage_native_world_audio.py`; stagers keep their CLIs; remove their comments. 2. `write_lane_catalog.py` (union, duplicate refusal, `sourceCatalogSha256`, `--plan` Needs Human). Pytest on golden fixtures, byte-identical twice | 02-01 |
| 02-04 Catalog keys, writer half, and chunk manifest kind | INT-01, WORLD-01, UI-01, DATA-01 | 1. `tables`/`windows`/`tiles` record shapes plus `native-tile-chunk-runtime` v1 in OUTPUT_CONTRACT, with Python validation. 2. Golden fixture regeneration (`generate_golden_fixtures.py`, `fixtures.lock.json`) | 02-03 |
| 02-05 Catalog keys, reader half (`--part npcs`) | same | 1. `readNativeCatalog` slices plus validation. 2. Index `table:`/`window:`/`tile:` from the slices, a `gap` status, and npc lookup by model catalog id. Vitest | 02-04 |
| 02-06 Dev-only `NATIVE_STORE_ROOT` plugin | INT-01, WORLD-05 | 1. Plugin plus Vitest (refusals, content types, ranges, overlay fallback). 2. A Vitest that resolves the build config without the plugin, plus a post-build grep of `dist/` outside relay windows. 3. Playwright on 5175 against a fixture lane store | 02-01, 01-09, 01-16 |
| 02-07 Coverage skeleton | INT-01, WORLD-03 | 1. `scripts/native_store/build_coverage_report.py` (denominators from inventory, lock and committed census; loads only from load-check records). 2. `report:coverage` in package.json plus the rendered table and STATUS lines | 02-02, 02-04 |
| 02-08 CONV-01/02 contract tests | CONV-01, CONV-02 | 1. Constants, magenta and scan test plus the OUTPUT_CONTRACT "Source preservation" section. 2. Single-target independence and the naming test (no banned prefix, no `native_batch` in `convert:*`) | 02-01 |
| 02-09 Converter cost fix | ACT-02, CONV-01 | 1. `Converter.source`/cache hit trust lock `eSha256` on size and mtime match, with a per-batch memo. 2. `evidence/` copy policy per the owner answer (default: keep the log and manifest, drop the intermediate glTF copy) [INF]. Tests in `test_native_assets*.py` | 02-01 |

### Wave 2: tracers (one per lane, plus WORLD-03 census and WORLD-07)

| Plan | Lane, part | Tasks | Depends on |
|---|---|---|---|
| 02-10 Data tracer: generic decode plus DATA-03 | data-ui, `data` | 1. 29 pins (split into a pins module), case-insensitive pattern resolver shared with the inventory, real `source`, data-driven uniqueness. 2. `scripts/data/convert_tables.py` with ledger seals into `lane-store/data-ui/l2/tables/<sha>/`. 3. Strict sysstring-e and systemmsg-e decode; DATA-03 verdict into inventory and EVIDENCE; update `test_dat_table_inventory.py` tallies | 02-01, 02-02, 02-04 |
| 02-11 UI-01 layout tree | data-ui, `ui` | 1. Pinned-path adapter for `scan`/`build_tree` (`data_g` set, no bytecode, SHA pin, commit 12c9656), header fields plus hashed opaque tails, window-id duplicate rule. 2. Synthetic xdat fixtures (Elbera test style) plus a validator. 3. Tree into the lane store; counts cross-checked against Elbera `interface.json` as evidence only | 02-01, 02-02 |
| 02-12 UI tracer `window:StatusWnd` | data-ui, `ui` | 1. DOM renderer from the tree plus the anchor resolver labelled unverified, with a zero-literal-names test. 2. HP from `MockWorldAdapter`; CP and MP `adapter-field-absent`; labels unresolved. 3. UI textures by recipe through the guarded converter, or per-control texture gaps; Playwright screenshot | 02-11, 02-05, 02-06, 01-14 |
| 02-13 World oracle and census (WORLD-03) | world, `world` | 1. `freeze_world_oracle.py` reads the junction read-only into `recipes/world/oracle/20_20/expected.json` (counts, hashes, catalog SHA; no L2 bytes). 2. `tile_census.py` (153 tiles plus 10 non-tile, licensee, wrapper, gate results, Lobby status) into `docs/parts/world/tile-census.json`. 3. World gap rows for every ineligible tile into coverage | 02-02, 02-07 |
| 02-14 World raw step | world | 1. Split `native_map.py` under 400 lines and make the section box optional. 2. `raw_map_step.py --map` on the ledger. 3. Synthetic pytest plus a real-client 20_21 run that skips when E: is absent | 02-13 |
| 02-15 Chunk planner and terrain step | world | 1. `tile_chunk_plan.py` (frame from TerrainInfo, 4x4 chunks, first enabled PlayerStart). 2. Per-chunk terrain with the `extrapolated` mask-UV label. 3. Split `native_map_geometry.py` (1,043 lines) | 02-14 |
| 02-16 World tracer 20_21 walk (WORLD-05) | world | 1. Chunk manifest loader and parser in `src/scene/world/` (Vitest). 2. Tile selection by `?map=20_21` plus terrain-collision navigation built at construction. 3. Playwright walk through `NATIVE_STORE_ROOT` writing a load-check record; meshes, BSP, sky and audio as `pending` | 02-15, 02-04, 02-05, 02-06 |
| 02-17 Actors census and unit inventory | actors, `npcs` | 1. `.ukx`/`Skill.usk` header census via `inspect_header` behind the guard. 2. Unit inventory from the 8 tables (NPC (mesh, textures), weapon, armor per race column, skill roots, sound rows), each convertible or gap with a reason. 3. Census JSON plus EVIDENCE rows | 02-02 |
| 02-18 Actors tracer `npc:20001` Gremlin | actors, `npcs` | 1. Row to request generator (single slot, animation from skeletal decode, gap rows). 2. Profile generation with unresolved-field gaps instead of raises. 3. Convert into the lane store, lane catalog, Playwright spawn plus clips plus the `npc:20002` missing marker on 5175 | 02-17, 02-03, 02-05, 02-06, 02-09 (or accepted hashing cost), 01-14 |
| 02-19 Integration tracer: sandbox available/gap and command names | integration | 1. Runtime reads the `coverage` record; the sheet note shows gap reasons (Vitest). 2. `convert:tables`/`convert:world`/`convert:actors`/`convert:ui` in package.json now that the entries exist. 3. Playwright screenshot on 5175 | 02-07, 02-10, 02-12, 02-16, 02-18 |
| 02-24 WORLD-07 review | world | 1. Read-only Claude subagent re-hashes the 74 files and gives verdicts (11.14). 2. Fixture copy and tests | none; before 02-15 |

`convert:*` names land in 02-19 rather than in 02-01, because a script entry pointing at a missing file is dead config (AGENTS.md). Until 02-19, lanes run `python -B scripts/<lane>/...` directly.

### Wave 3+: breadth (resumable; continues in later runs)

| Plan | Lane | Tasks (summary) | Depends on |
|---|---|---|---|
| 02-20 Remaining tables plus name indexes (DATA-01) | data-ui | Run all 37 with seals, regenerate the inventory and its test tallies, small name indexes (npcname, itemname, skillname) | 02-10 |
| 02-21 Hair tables (DATA-02) | data-ui | Pinned importer, `hair_pairs`/`keyed_hair_pairs`, UCHAR cross-check, inventory rows | 02-10 |
| 02-22 DevSheet split and pickers (SAND-02) | data-ui plus integration wiring | Split `DevSheet.ts` and remove all comments; spawn, equip, cast, window and audio pickers with hover-card variables; tile picker from `tiles`. Wiring in `attachNativeSliceSheet.ts` goes in a separate integration micro-plan 02-22b | 02-20, 02-11, 02-16, 01-14 |
| 02-23 Window registry plus UI-03 | data-ui | Render every root, gap rows per unsupported control type or texture, open any window by id, Playwright at 844×390 and 390×844 | 02-12, 02-22 |
| 02-25 Static meshes per chunk | world | No Z window, convert through `Converter`, per-object gaps for unreviewed `.usx`, oracle subset diff on 20_20 | 02-16, 02-13 |
| 02-26 BSP and collision (WORLD-08) | world | Whole-level BSP by PolyFlags plus BlockingVolumes, collision manifest per chunk from flags, `EnableCollision` and serialized data, Elbera adapter with allowlisted flags, Brush397/Brush610 oracle subsets | 02-25 |
| 02-27a/b Sky and audio (WORLD-02) | world + actors | Split per 11.12; music join from 02-24 | 02-14, 02-20, 02-24 |
| 02-28 Eligible-39 batch | world | Resumable driver on the ledger with preflight; slices run outside relay windows; coverage per tile | 02-25, 02-26, 02-27 |
| 02-29 Cell-aware collision source | integration | `meshNavigation.ts` add and remove cells, `isReady` false when cells are missing, Vitest | 02-16 |
| 02-30 Streaming baseline and residency (WORLD-04) | world | Headless baseline counts and bytes; ring calculator plus dispose; collision ring wider than visual; LOD off navigation; Playwright across a border | 02-28, 02-29 |
| 02-31a/b Minimap and world map (WORLD-06) | world + data-ui | Split per 11.12; needs 02-45 | 02-20, 02-11, 02-28, 02-45 |
| 02-32w/i Reader widening | world + integration | Split per 11.12; order per 11.6 | 02-14, 02-50 |
| 02-33 Licensee-23 tiles (then 25, 30) | world | Re-run census-gap tiles after each reader step; Lobby moves from gap when 30 lands | 02-32 |
| 02-34 Multi-slot `verify_binding` | integration | Accept a list of slot bindings; tests | 02-09 |
| 02-35 NPC contract widening | actors | Profile to model join by catalog id; lift the 16×128 caps (with the matching integration staging line in Needs Human); drop the `musveren:0` hard-code; Vitest | 02-18 |
| 02-36 NPC breadth (ACT-02) | actors | Ledger driver, one Converter per batch, bundles under 96 classes, LineageMonsters 123/28 first, other licensees gaps | 02-35, 02-34, 02-17 |
| 02-37 Player characters (ACT-01) | actors | chargrp assemblies (body parts plus face, `rigidAttachment` from defaults); hair and helmet gaps; class to template mapping a gap until `classinfo-e` | 02-36, 02-20 |
| 02-38 `EquipmentSlot` widening | integration | Slots from source `body_part` values once decoded meanings exist, else a gap; no invented names | 02-20 |
| 02-39 Items (ACT-03) | actors | 391 weapon units, armor per race column, socket sidecars kept, hand anchor from class defaults or a gap | 02-37, 02-38 |
| 02-40 Skill binding table (ACT-06) | actors | All 29,812 rows to root, `native-skill-dispatch-required` or gap; exact sound row or unresolved; bundles for Sprite/Mesh emitters only | 02-17 |
| 02-41a/b Clip playback (ACT-04) | actors + data-ui | Split per 11.12; events per 11.11 | 02-18, 02-22, 02-44 |
| 02-42 Audio bindings (ACT-05) | actors | Per-bundle sound manifest, exact vs leaf-candidate labels, unresolved records, inputs via the guard, audible labelled browser check | 02-36, 02-40 |
| 02-43 Integration lane store and restage handoff | integration | Union the lane stores, re-run coverage, append Needs Human commands | the tracers, then each breadth slice |

**Recommended run order:** superseded by 11.13 (adds 02-44..02-50 and ends at the gap census, not at 02-19).

## 7. Pitfalls

1. **Disk:** "C: 16 GB free at 97%" came from a lane researcher with no recorded command or time [unverified]; the preflight must measure free space itself (`shutil.disk_usage(<lane store root>)`) and log value plus Riga time in the ledger receipt. `Converter` copies UModel work into every output (`native_assets.py:712`). Free-disk floor in the shared preflight plus a per-unit size estimate.
2. **Junction writes:** `Path.resolve()` follows `public/l2` into the main store. Check unresolved ancestors for reparse points and compare realpaths; test with a real junction.
3. **Relay windows:** Sun 10:00-14:00 and Thu 19:00-21:30 Riga (today is Sunday). Clock check before every test, build, hash or conversion; pinning 29 layout hashes and re-hashing the 74-file packet count as hashing.
4. **Hidden whole-tree hashing:** never `native_catalog/cli.py main`/`inventory()`; never a tile `native_batch` recipe; fix `Converter.source` (02-09) before breadth.
5. **Ownership:** split cross-lane work into contract plans; run the check before the docs commit; integration `--part` for contract plans.
6. **Silent catalog drops and the old manifest parser:** see 4.6; land writer and reader halves back to back and use the new chunk kind.
7. **Silent neutral terrain:** a preview failure is caught (`loadNativeSection.ts:278-285`); record a gap, never a pass.
8. **Exact identity:** no mesh-name selection, no synthesized animation names, qualified names only (`select()` falls back to bare names, `native_assets.py:200-201`), npcgrp `sound_vol`/`sound_radius` swapped, no skillsound level-1 fallback.
9. **Elbera hazards:** `--emit` writes into Elbera; E: read unguarded; `__pycache__` writes (use `-B`); `--check` guards fail here; anchors proven on another `NWindow.dll`.
10. **Touch rules:** over 400 lines: `native_map.py` 512, `native_map_geometry.py` 1,043, `native_assets.py` 795, `native_effect_bundle.py` 630, `DevSheet.ts` 734; new logic in new modules; strip all comments of a touched file (incl. `vite.config.ts:1` licence line).
11. **Test discovery:** `scripts/test_pipeline.py:21-22` runs unittest over `tests/pipeline` and `scripts/native_catalog` only.
12. **FPS:** headless is SwiftShader; baseline is counts and bytes; FPS only with `WORLD_HARDWARE_TEST=1` on the GTX 1060.
13. **Known red baseline:** 2 cases in `nativeNpcProfiles.test.ts`, flaky `nativeEffectStage.test.ts`; not regressions; fix `nativeNpcProfiles` in 02-35. `editorGeometryCompat.test.ts` now lives in `tests/editor/` and runs only under `"test:editor": "vitest run --config vitest.editor.config.ts"` (`package.json:24` [V]); `vitest.config.ts` includes only `tests/unit/**/*.test.ts` [V], so it is not part of `test:unit` and not part of this phase's baseline. Re-run `test:unit` once outside a relay window before the first Phase 2 plan and record the actual red list in the plan, instead of trusting this list.
14. **Denominators:** never PORT_SCOPE estimates; decoded counts or `"unknown"`.
15. **Stale CONTEXT line numbers:** CONTEXT cites `tables.py :207-251`/`:29`, `loadNativeSection.ts :73`/`:96-113`, `native_map_geometry.py` 1,070 lines; the tree has `:198`/`:27`, `:71`/`:99`, 1,043 lines [V]. Cite fresh lines.

## 8. Open questions with recommended answers

| # | Question | Recommendation |
|---|---|---|
| 1 | `vite.config.ts:1` is an Apache-2.0 attribution comment that the no-comments rule would strip | Move it to a `THIRD_PARTY_NOTICES.md` (integration) in 02-06; log it in OVERNIGHT-DECISIONS |
| 2 | Contract plans have no integration part slug | Use `--part adapter-dispatch` now; propose adding a `conversion` part later (changes the 19-part test, owner) |
| 3 | Where the committed coverage table lives | `docs/coverage.md` (unclaimed, so integration) plus STATUS lines; lanes do not edit other lanes' EVIDENCE |
| 4 | 20_20 baseline in lane stores | Plugin overlay: `catalog.json` from the lane store, other hash paths fall back to `public/l2` read-only; record `sourceCatalogSha256` |
| 5 | Free-disk floor, and lane store on E: | Floor in config, value owner-set; default refuse below a conservative 25% of current free space, about 4 GB [INF]. Keep the store in the worktree per CONTEXT A; lane store on E: is an owner decision |
| 6 | `evidence/` copy per output | Keep logs and the export manifest; drop the copied glTF intermediates (they are reproducible from the pinned UModel) [INF]; owner confirms in 02-09 |
| 7 | CP and MP fields | Stay `adapter-field-absent` gaps in Phase 2; widening `WorldEntity` is a Phase 4 adapter decision |
| 8 | Conversion unit (CONTEXT E "unique mesh") | Shared UModel export per mesh, model record per (mesh, ordered textures), profile joins by model catalog id; log it as a refinement |
| 9 | Playwright port | `pnpm test:e2e` only when 5173 is free. Otherwise `DEV_PORT=5175` is acceptable only when nothing listens on 5175 (Playwright starts its own server, `reuseExistingServer: false`, `strictPort`); log it as a deviation, as 01-10 did |
| 10 | Non-tile maps of version 118 | Gap "map version 118 unsupported" for now; classified, not permanent |
| 11 | Does `gremlin_m00` serialise a non-null in-package `Animation`? | Unknown; the 02-18 tracer checks and records `animation-reference-missing` if not |

## 9. Environment availability

- **Available:**
  - `E:/Lineage2-client`, with lock-equal content folders (01-13).
  - Pinned UModel build1590 (`native_assets.py:31`). It is read-only, with no redistribution licence.
  - UELib DLL plus PowerShell (`native_catalog/effects.py:13,15`).
  - Elbera 12c9656 at `E:/Lineage2Elbera`.
- **Missing:**
  - capstone. Skip Elbera `--native-binding-check`; it is not needed.
  - GTX 1060 hardware runs. These only matter for FPS and need the owner's machine.
- **Constrained:**
  - C: free space is unmeasured here (pitfall 1); the preflight measures it; storage on E: is an owner decision.
  - Ports 5173 and 5175 are checked at run time (open question 9).

## 10. Security domain and project constraints

- **Trust boundaries:** guard clauses at decode boundaries (exact lengths, trailers, hash pins); `store_paths.py` allowlist plus realpath denial for writes; the dev plugin validates `/l2/` request paths and serves only under the lane root; Elbera code only by pinned path plus SHA-256 with allowlisted flags and pre-guarded inputs; build-absence test for `NATIVE_STORE_ROOT`; no installs.
- **AGENTS.md (binding):** never invent L2 values, record every source, unresolved stays visible; client never computes gameplay outcomes; lanes never run banned store writers; no Editor in build; one EVIDENCE.md per part under about 30 KB, STATUS one line, DECISIONS append-only; no dead code, DRY, no shims, **no comments** (strip the whole file on touch), full-word names, files under about 400 lines, TS strict, no `any`, pnpm only; Vitest per behaviour change, Playwright for UI, test or screenshot behind "done"; TODO only with a requirement ID; plain hyphens; commit on the branch only.

## 11. Second-pass findings (gap closure)

**11.1 Load-check sweeps (INT-01, SC 1-4).** [V] `playwright.config.ts`: `workers: 1`, `timeout: 45_000`, `webServer: { command: "pnpm dev", url: baseURL, reuseExistingServer: false }`, port `DEV_PORT || 5173`. Specs drive `window.__nativeSlice.snapshot()`/`.dispatch()` (`nativeSlice.spec.ts:10-11, :273`); `assetPackage.spec.ts:148` already writes a JSON report. **New 02-46 (integration):** `tests/browser/support/loadCheckRecords.ts` hashes the served lane `catalog.json`, reads `artifacts/lane-store/<lane>/load-checks/<catalogSha256>.json`, skips recorded keys, visits pending keys in slices (`LOAD_CHECK_KIND`, `LOAD_CHECK_LIMIT`) and writes `{key, status, reason, atRiga}` atomically per key; specs `load-sweep-{tiles,npcs,items,skills,windows}.spec.ts`; a new catalog SHA starts a new file. Run with `DEV_PORT=5175 NATIVE_STORE_ROOT=<lane>` only while 5175 is free. 02-23, 02-28, 02-36, 02-39, 02-40 end with one sweep slice.

**11.2 Browser and audible checks.** Specs are in the test map. They reuse `nativeSection.spec.ts:55` and `nativeBsp.spec.ts:16-49` (placements, `move-local` walls and stairs), `assetPackage.spec.ts:113-148` (real Ogg playback plus a JSON report), the mixer unlock and inspection (`WorldAudioMixer.ts:108-128, :337`) and the snapshot audio and effect fields (`nativeSliceDiagnostics.ts:64-82`). A labelled report `{key, sourceIdentity, played, peak}` plus owner listening counts as "audible labelled" [INF].

**11.3 WorldCommand contract.** [V] `gameWorldAdapterContract.test.ts:17` pins only `dispatch: (command: WorldCommand) => void`; 01-14 does not modify `worldTypes.ts` (`01-14-PLAN.md:7-21`); `MockWorldAdapter.ts:52-116` has no `default`/`never`, so a new member is silently ignored. Tile and audio are presentation: the mixer has `setMuted`/`setVolume`/`setBusVolume`/`setBusMuted` (`WorldAudioMixer.ts:362-385`), and 01-14 makes "open window" a sheet action (`01-14-PLAN.md:80`). **New 02-44 (integration) [INF]:** add only `{ type: "spawn-character"; characterTemplateIndex: number }` and `{ type: "play-clip"; entityId: string; clipName: string }`, exhaustive `never` in both adapters, contract test enumerates the set. Tile = `?map=` reload; audio = mixer actions. Before 02-22, 02-37, 02-41a.

**11.4 Restage, INT-01, v1/v2.** **New 02-47 (integration):** `scripts/native_store/merge_lane_store.py` on the 02-03 library (verify-before-copy, `stage_native_runtime.py:327-335`); refuses differing immutable files, duplicate ids, a wrong base `sourceCatalogSha256` and v1 lane archives; tested on temp dirs, never run here; `write_lane_catalog.py --plan` prints it into Needs Human. **INT-01 stays "partial: staging Needs Human".** [V] Store catalog `schemaVersion: 1` (`stage_native_runtime.py:320`), archives asset.json v1 (`STATE.md:125`); `readAssetPackage.ts:108-116` accepts both until the v1 removal (`STATE.md:126`, `OUTPUT_CONTRACT.md:109-116`). Overlay A2 mixes v1 20_20 and v2 lane archives, valid only while dual acceptance stays; load-check records note `schemaVersion`; the v1 removal follows the restage that includes lane output.

**11.5 Sky and movers.** [V] Sky `public/l2/skies/f7a0b5ef…/` (21 files incl. `manifest.json`, `sky.glb`) is not in the catalog; pinned in `nativeSkyPresentation.ts:13-19` (`sourceId: "interlude:20_20.Model798.SkyZoneInfo0"`), staged by `stage-native-sky.mjs:11-14`. Environment `environments/e10827c4…` (`nativeEnvironmentTables.ts:7, :78`). Movers: catalog `movers` record `map-20-20-movers`, `/l2/movers/0de5d083…/movers.json` (8 movers, 2 models); hand-listed `ACTORS = ('Mover1','Mover61','Mover60','Mover195','Mover194','Mover193','Mover192','Mover24')` and `MAP_SHA` at `native_map_movers.py:26-34, :183`; runtime regex `^interlude:20_20\.Mover\d+$` (`nativeMoverManifest.ts:48`). 02-13 also freezes these SHAs and ids. **New 02-49 (world):** `scripts/world/mover_step.py` over every `Engine.Mover` export, gap `mover-unsupported:<reason>`, 20_20 as superset; tile-general ids only in the new chunk kind. After 02-14.

**11.6 Terrain-height gate.** [V] `read_g16` refuses non-123/28 `T_` packages (`native_map.py:201-203`, reached via `TerrainMap` `:353-355`); `native_terrain` refuses non-123/28 maps (`native_map_geometry.py:110-112`); `texture_mips.py:15` gates layer textures only. From `map-extraction-refuter/fleet_{map,terraintextures}_headers.json`: the 152 `T_` files are lock-equal but mixed-licensee. The 28 failing licensee-28 maps have T licensee 25 (13), 23 (8), 12 (2), none (2: `19_11`, `20_11`), 20, 22, 19 (1 each). Top (map, T) pairs: (28,28) 39, (23,12) 15, (28,25) 13, (23,23) 13, (25,25) 10, (30,28) 8, (28,23) 8. Growth order [INF]: G16 T-25 (+13), T-23 (+8), map 30 (+8), map 23 with T-23 (+13); map licensees 18, 31, 16, 19, 20 (16 tiles) last. **New 02-50 (world):** record each failing tile's `TerrainMap` package in the census (proves A11); reasons `terrain-height-licensee-unsupported:123/<lic>` or `terrain-height-package-missing`. Before 02-32w.

**11.7 Texture package census.** [V lock] `Icon`, `L2UI_CH3`, `l2ui`, `L2_RadarMap`, `town_map`, `l2zonename` `.utx` under `systextures/` are `equal`. `inspect_header` reads 128 B (`cli.py:85-92`), `summary` unwraps Ver111/121 (`ue2.py:81-101`), `.utx` is in `NATIVE` (`cli.py:16`). **New 02-45 (data-ui):** header-only census of `systextures/*.utx` via `require_equal_file` against `REVIEWED_VERSIONS`, into `docs/parts/ui/texture-package-census.json`. Before 02-12 and 02-31a.

**11.8 `.ddf` cross-check.** [V lock] The nested `L2FileEdit-master/L2FileEdit-master/…` copies (4,069) are `e-only`; the flat `L2FileEdit-master/data/l2asm-disasm/DAT_defs/…` copies (4,069) are `equal` (`…/Interlude/hairgrp.ddf`, 1,729 B). Read the flat copy through the guard. Interlude has only `hairgrp.ddf` and `hairaccessorylocgrp.ddf`, so only hairgrp is cross-checked.

**11.9 WORLD-04 LOD (Babylon 9.27.1).** [V typings] `Mesh.addLODLevel(distanceOrScreenCoverage, mesh: Nullable<Mesh>)` (`mesh.pure.d.ts:492`), `removeLODLevel` `:506`, `getLOD` `:514`; `AssetContainer` add/remove/dispose (`assetContainer.d.ts:223-248`). No LOD in `src/`; radius load and dispose in `loadImportedWorld.ts:24, :111-133`. [INF] One container per chunk, add and remove at the ring edge, dispose beyond a wider ring; Phase 2 visual LOD = `addLODLevel(distance, null)` culling (distance a `presentation` variable); a simplified mesh is a derivative recorded `{fromSha256, algorithm, algorithmVersion}` or a `lod-derivative-unplanned` gap; navigation takes collision resources only.

**11.10 UI-01 count verdict.** [V] Elbera `assets/gamedata/interface.json`: `declaredWindows: 165`, `windows` 248, `controlRefs` 134. The local header also declares 165, so 248 is Elbera's parsed list from another file. 02-11 task 3 records declared, root and control counts of `b5b37678` (DATA-03 style); the test asserts 165; the REQUIREMENTS.md UI-01 text fix goes in its docs commit.

**11.11 ACT-04 notifies.** [V] `ue2.py` decodes `FMeshAnimNotify` for 123/28 and 123/30 (`:1-30, :247-249`); `notification_sidecar` (`:277-329`) emits `animationEvents` with `normalizedTime`, `type`, `properties`, `sound`, `timingBasis`. `native_assets.py:414` keeps them per animation set in asset.json (`asset_manifest.py:69`). Consumers: `footstep_event_inventory.py:78`, `animation_audio_bundle.py:146-184`, `combat_audio_bundle.py:300`, `readAssetPackage.ts:113` (untyped), `loadNativeAnimationAudio.ts:98`. 02-41a adds no decoder: a typed parse in `src/assets/native/`, then clips joined by sequence.

**11.12 Single-lane splits.** 02-27 → 27a world (sky, ambient, placement, music join) + 27b actors (`src/audio/**` per tile, audio spec). 02-41 → 41a actors (events, clip API) + 41b data-ui (picker). 02-31 → 31a world (radar and town join) + 31b data-ui (map view). 02-32 → 32w world (`native_map.py`/`native_map_geometry.py` readers) + 32i integration (`static_materials.py` licensees). All `src/runtime/**` wiring goes in 02-22b.

**11.13 Gap census and run order.** 02-10 task 2 decodes gap-key tables first (`itemname-e`, `etcitemgrp`, `classinfo-e`, `npcname-e`, `skillname-e`). 6,911 etcitem rows get `etcitem-presentation-unplanned` [INF, owner]. Key `character:<chargrp index>` joins 02-02; 02-17 inventories 15 chargrp rows. Window rows come from the 02-11 tree. **New 02-48 (integration):** one status per denominator row in every part; test fails on a missing row or unlisted reason. **Run order:** (1) 02-01..02-09, 02-44; (2) 02-24, 02-13, 02-50, 02-14..02-16; (3) 02-10, 02-45, 02-11, 02-12; (4) 02-17, 02-18; (5) 02-46, 02-47, 02-19; (6) 02-48. Then breadth: 02-20, 02-21, 02-25, 02-26, 02-49, 02-34, 02-35, 02-36, …, each to a seal plus a sweep slice.

**11.14 WORLD-07 packet.** [V] Only in the main checkout: `C:/laragon/www/l2-browser-client/artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/post-migration-visibility-20261106` (read-only; absent from the worktree). `SHA256_MANIFEST.json` has 74 rows. Layer-sequence fixtures: `composition-submission/BROWSER_TEST_CASES.md` (6 cases) and `DISCRIMINATING_CASES.json` (`adjacent`, `sparseOverlay`, `sevenLayers`, `splitGroups`); `COMPOSITION_SUMMARY.json` holds absolute `.codex-proxy` `inputPins`, so adopt derived index lists only. No base64 or hex run over 128 chars in these JSONs or `MUSIC_ID_JOIN.json` [V]; the copy task repeats the scan, drops paths and copies into `tests/fixtures/world-07/` with the manifest SHA. `review/REVIEW_STATUS.json`: `"status": "not_performed"`, `"model": "gpt-6.1-sol"`; author likely a Codex session [INF], so the reviewer is a read-only Claude subagent (not the AGENTS.md Codex review); EVIDENCE.md records agent type, model id, time and re-hash result.

**11.15 DEC-OWN-9/10 and UI-03.** DEC-OWN-10 (`PROJECT.md:71`, commit `62741d8`) decides the skin and deletes DESIGN.md, so no plan writes a skin DECISIONS line; DESIGN.md tokens and "health top left, actions at the bottom" are obsolete. UI-03 now: "Only the original Interlude interface … No custom HUD styling (DEC-OWN-10)." [V REQUIREMENTS.md:47]. 02-23 checks: Vitest scan of `src/ui/nativeWindows/**` (no colour literal, `font-family` or non-`/l2/` image) and `native-window-layout.spec.ts` at 932 x 430 and 430 x 932 (DEC-OWN-9, `PROJECT.md:70`).

**11.16 Departures to log in OVERNIGHT-DECISIONS:** WORLD-07 before tracers (02-24); CP and MP as gaps (02-12); `unit_ledger` over `native_batch` adapters (02-02); `docs/coverage.md` over an EVIDENCE table (02-07); model per (mesh, textures) (02-18); `--part adapter-dispatch` (02-01); two-member WorldCommand (02-44); flat `.ddf`, hairgrp only (02-21); CONTEXT F DESIGN.md parts obsolete (02-12); null-level LOD (02-30).

**11.17 CONV additions (02-08).** Only `assets:pipeline` may reach `native_batch`. One skill (`--skill <id> --level <n>`) and one tile (`--map 20_21 --step raw`) leave receipts for that key only. Every `repair*`/`restore*`/`preserve*` step (`restore_native_weights`, `restore-native-static-normals.py`, `fnRepairFoliageCutouts`, `preserve-native-editor-*`) must appear in OUTPUT_CONTRACT "Source preservation" with defect evidence [INF on the pattern].

**11.18 Re-verified.** No relay-window check exists [V grep]. Python here lacks a tz database: `zoneinfo.ZoneInfo('Europe/Riga')` raises `ZoneInfoNotFoundError` (3.12.6) [V]; Node `Intl` works [V]. Single owner `scripts/check-machine-schedule.mjs` (02-02) exits non-zero inside Sun 10:00-14:00 or Thu 19:00-21:30 Riga; the ledger calls it by `subprocess`, Playwright by `globalSetup`, executors as a prefix. No `tzdata` install.

## Validation Architecture

### Test framework

| Property | Value |
|---|---|
| TS unit | Vitest, `vitest.config.ts` (`tests/unit/**/*.test.ts`) |
| Pipeline | Python unittest via `scripts/test_pipeline.py` (discovers `tests/pipeline` and `scripts/native_catalog`); called "pytest" in plans, but it is unittest |
| Browser | Playwright, `playwright.config.ts` (`DEV_PORT` default 5173, `webServer: pnpm dev`, `reuseExistingServer: false`) |
| Quick run | `pnpm typecheck && pnpm test:unit` (config `workflow.test_command`) |
| Pipeline run | `pnpm test:pipeline` |
| Browser run | `pnpm test:e2e tests/browser/<spec>` when 5173 is free (see open question 9 for 5175) |
| Full suite | `pnpm typecheck && pnpm test:unit && pnpm test:pipeline`, plus the e2e specs touched |

Every run starts with a relay-window check. Private-client cases use `skipUnless(... is_file())` and skip when E: is absent.

### Phase requirements to test map

**P** = `pnpm test:pipeline` (unittest under `tests/pipeline/`), **U** = `pnpm test:unit -- tests/unit/<file>`, **E** = `pnpm test:e2e tests/browser/<spec>` (port rule). All files are new unless marked; each is written test-first by its plan. `hud-mobile-layout.spec.ts` is withdrawn under DEC-OWN-10.

| Req | Behaviour | Check | Plan |
|---|---|---|---|
| SAND-02 | Pickers with hover-card variables; split files; `?map=` reload; mute and volume reach the mixer | U `devSheetPickers.test.ts`, `sandboxRuntimeActions.test.ts`; E `sandbox-sheet-pickers.spec.ts` | 02-22, 02-22b |
| DATA-01 | 37 pins, case-insensitive resolver, per-table seal, inventory tallies | P `test_table_source_resolver.py`, `test_convert_tables.py`, `test_dat_table_inventory.py` (exists, update) | 02-10, 02-20 |
| DATA-02 | Pinned importer (SHA, no bytecode, no `verify`); hair pairs; UCHAR vs int32; flat `equal` `.ddf` via guard | P `test_hair_table_adapter.py` | 02-21 |
| DATA-03 | Header count, exact end, ID sets; verdict in inventory | P `test_sysstring_systemmsg_counts.py` | 02-10 |
| UI-01 | Header fields, hashed tails, SHA pin, duplicate rule; header 165, measured counts recorded (never asserted as 248) | P `test_interface_layout_adapter.py`; U `nativeWindowLayoutTree.test.ts` | 02-11 |
| UI-02 | Zero literal names; HP bound; CP/MP gap; open by id; texture package licensees | U `nativeWindowRenderer.test.ts`; E `native-window-statuswnd.spec.ts`; P `test_texture_package_census.py` | 02-12, 02-45 |
| UI-03 | No colour literal, `font-family` or non-`/l2/` image; 932 x 430 and 430 x 932 no horizontal scroll; StatusWnd rectangle | U `nativeWindowStyleSources.test.ts`; E `native-window-layout.spec.ts` | 02-23 |
| WORLD-01 | Raw step, chunk planner, extrapolated label, oracle subsets (incl. sky, environment, movers), mover superset, TerrainMap package per tile; placements and BSP in browser | P `test_world_raw_step.py`, `test_tile_chunk_plan.py`, `test_world_oracle.py`, `test_world_mover_step.py`, `test_tile_census.py`; U `nativeTileChunkManifest.test.ts`; E `world-tile-meshes.spec.ts` | 02-13..16, 02-25/26, 02-49, 02-50 |
| WORLD-02 | Sky from SkyZoneInfo; no self-copied inventory; music join; byte equality; music and ambience after unlock with labelled report | P `test_world_sky_step.py`, `test_world_audio_step.py`; E `world-tile-audio.spec.ts` | 02-27a/b |
| WORLD-03 | Census schema (153 + 10, Lobby); tile x step rows | P `test_tile_census.py`, `test_coverage_report.py` | 02-13, 02-07 |
| WORLD-04 | Ring maths; add, remove, dispose; null LOD only; collision ring wider; navigation inputs collision-only; `isReady` | U `worldResidencyRing.test.ts`, `meshNavigationCells.test.ts`, `navigationInputsCollisionOnly.test.ts`; E `world-tile-border.spec.ts` | 02-29, 02-30 |
| WORLD-05 | Walk 20_21 through `NATIVE_STORE_ROOT`; load-check written | E `world-tile-walk.spec.ts` | 02-16 |
| WORLD-06 | Minimap join; map view | U `minimapJoin.test.ts`; E `world-minimap.spec.ts` | 02-31a/b |
| WORLD-07 | Manifest re-verify; fixture copy (manifest SHA, no binary field); layer order; music join | P `test_world07_fixture_copy.py`, `test_terrain_layer_order_fixtures.py`, `test_music_volume_join.py` | 02-24 |
| WORLD-08 | Declared sources only; unreadable is a gap; Elbera flags allowlisted, inputs pre-guarded | P `test_world_collision_step.py`, `test_elbera_collision_adapter.py` | 02-26 |
| ACT-01 | chargrp requests; hair and helmet gaps; `spawn-character` | P `test_character_requests.py`; E `sandbox-characters.spec.ts`; U contract test | 02-37, 02-44 |
| ACT-02 | Multi-texture requests; no mesh-name selection; gap not raise; over 2,048 profiles; Gremlin spawn and missing marker | P `test_npc_requests.py`; U `nativeNpcProfiles.test.ts` (exists, 2 red), `nativeCatalogIndex.test.ts`; E `sandbox-npc-gremlin.spec.ts` | 02-18, 02-35, 02-36 |
| ACT-03 | Slots from source only; sockets kept; equip by id | P `test_item_requests.py`; U `equipItemSlots.test.ts`; E `sandbox-equip.spec.ts` | 02-38, 02-39 |
| ACT-04 | Typed events; clip list by sequence; `play-clip` | U `actorClipEvents.test.ts`, `actorClipPlayback.test.ts`, contract test; Gremlin spec | 02-41a/b, 02-44 |
| ACT-05 | Exact vs leaf-candidate; unresolved rows; swapped volume/radius; labelled report | P `test_actor_sound_bindings.py`; E `sandbox-actor-audio.spec.ts` | 02-42 |
| ACT-06 | All rows bound or gap; no level-1 fallback; under 96 classes; cast shows effect or named gap, sound played | P `test_skill_binding_table.py`, `test_effect_bundle_packing.py`; U `castSkillIndex.test.ts`; E `sandbox-skill-cast.spec.ts` | 02-40 |
| INT-01 | Store guard; ledger resume; schedule check; writer union; key round trip; loads only from records; sweeps; merge on temp dirs; gap census; plugin refusals and build absence | P `test_store_paths.py`, `test_unit_ledger.py`, `test_lane_catalog_writer.py`, `test_coverage_report.py`, `test_merge_lane_store.py`, `test_gap_census.py`; U `checkMachineSchedule.test.ts`, `loadCheckRecords.test.ts`, `nativeStoreRootPlugin.test.ts`, `readNativeCatalog.test.ts`; E `lane-store-switch.spec.ts`, `load-sweep-*.spec.ts` | 02-01..07, 02-46..48 |
| CONV-01 | One target, one skill, one tile alone; `assets:pipeline` optional; no banned prefix | P `test_converter_independence.py` | 02-08 |
| CONV-02 | UModel pin; limits; magenta `[1, 0, 1, 1]`; normalisation scan; repair list with defect evidence | P `test_source_preservation_contract.py`, `test_static_materials.py` (exists) | 02-08 |

### Sampling rate
- **Every run** starts with `node scripts/check-machine-schedule.mjs &&` once 02-02 lands; until then, check Riga time by hand with `node -e` and `Intl` (not Python `zoneinfo`, which is missing here).
- **Per task commit:** `pnpm typecheck && pnpm test:unit` for TS tasks; `pnpm test:pipeline` for Python tasks. Both only outside relay windows.
- **Per plan:** the full suite plus that plan's Playwright spec when the port rule allows, plus the ownership check before the docs commit.
- **Phase gate:** full suite green except the known red baseline, plus each tracer's recorded load-check and screenshot.

### Wave 0 gaps
- `tests/pipeline/test_store_paths.py`: needs a junction fixture helper (`_winapi.CreateJunction`, skip with reason).
- `tests/pipeline/test_unit_ledger.py`: injected clock and disk probes for the preflight.
- `tests/fixtures/lane-store/`: a tiny synthetic lane store (catalog plus one chunk manifest plus one model from golden fixtures) for the plugin and e2e specs.
- Synthetic xdat header builder in `tests/fixtures` (Elbera `test_parse_xdat.py:9-27` style, no client bytes).
- Synthetic decoded-table bytes for `read_nodes`/`read_value`.
- A Playwright helper that writes load-check records (`artifacts/lane-store/<lane>/load-checks/<catalogSha>.json`).
- `recipes/world/oracle/20_20/expected.json`, frozen in 02-13 before any world diff test, now including the sky, environment and movers SHAs (11.5).
- `scripts/check-machine-schedule.mjs` plus Playwright `globalSetup` (02-02), before any later plan runs tests.
- `tests/browser/support/loadCheckRecords.ts` (02-46), before any breadth sweep.
- `tests/fixtures/world-07/` copied from the main-checkout packet after the binary-field scan (02-24).
- Every other row above marked "Wave 0 gap" is created by its owning plan's first task (test first).

## Assumptions log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | Shared `unit_ledger.py` replaces per-lane seal drivers | 4.4 | Rework if the owner wants `native_batch` itself extended |
| A2 | Plugin overlay fallback to `public/l2` for non-catalog paths | 4.5 | Lane sandbox misses 20_20 baseline content |
| A3 | Record shapes for `tables`/`windows`/`tiles` and `native-tile-chunk-runtime` v1 | 4.6 | Contract rework |
| A4 | Lobby is classified as a "map reader licensee 30" gap | 5.1 | WORLD-03 wording |
| A5 | Model record per (mesh, textures) refines CONTEXT E | 5.2 | Index join breaks or duplicate conversions |
| A6 | UI textures convert through the guarded `native_assets.py convert` with lane output | 5.4 | UI tracer falls back to texture gaps |
| A7 | `--part adapter-dispatch` is acceptable for contract plans | 5.5 | Ownership-check friction |
| A8 | Synthetic Ver413 ciphertext is impractical | 5.3 | Fewer offline tests for `decode413` |
| A9 | Range support is needed for music in the dev plugin | 4.7 | Music seek fails on 5175 |
| A10 | `evidence/` intermediates can be dropped | 8 | Loses debugging material; owner decides |
| A11 | 39 eligible tiles rely on heightmaps living in `T_<tile>.utx` | 5.1 | The eligible list changes after the committed census; 02-50 turns it into evidence |
| A12 | Only `spawn-character` and `play-clip` join `WorldCommand`; tile and audio are runtime actions | 11.3 | Contract rework if the owner wants all sandbox actions as commands |
| A13 | The WORLD-07 packet was written by a Codex session, so a Claude subagent counts as non-author | 11.14 | Review independence questioned; owner confirms |
| A14 | `etcitem-presentation-unplanned` is an acceptable gap reason for 6,911 etcitem rows | 11.13 | Gap rows rewritten after owner review |
| A15 | Phase 2 visual LOD is null-level culling only | 11.9 | WORLD-04 "terrain/mesh LOD" stays partly open |
| A16 | Labelled report plus owner listening counts as "audible labelled" | 11.2 | Extra manual listening round |
| A17 | Growth order T-25, T-23, map 30, map 23 maximises unlocked tiles | 11.6 | Order changes after 02-50 evidence |

## Sources

- **Primary (HIGH):** worktree code, `.planning/lanes.json`, `package.json`, `playwright.config.ts`, the reference lock, the 40-table inventory, Babylon 9.27.1 typings in `node_modules`, the junction store listing.
- **Secondary (MEDIUM):** genericity audit `INVENTORY.json` and fleet header JSONs, research JSONs whose source SHA equals the lock, the WORLD-07 packet, Elbera 12c9656, vite.dev plugin docs.
- **Tertiary (LOW):** everything tagged [INF].

**Confidence:** stack and reuse HIGH; contracts MEDIUM (proposed shapes are inferences); pitfalls HIGH. Valid about 14 days or until 01-14, 01-16 and 01-17 land; then re-check line numbers.

