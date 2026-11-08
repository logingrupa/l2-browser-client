# Lineage2Elbera reuse audit

Audit date: 2026-11-07. Scope: the 22 entries under upstream `tools/` (18 directories, four root files), plus one independent refutation. Status and work order live in [.planning/STATE.md](../.planning/STATE.md) and [.planning/ROADMAP.md](../.planning/ROADMAP.md). Evidence index: [VERIFICATION.md](VERIFICATION.md).

## Decision

Lineage2Elbera is a source of reusable decoders, fixtures and format knowledge. Check it before writing another decoder. Fit bounded components into the existing pipeline. Do not adopt upstream pipelines that discard data this client preserves.

- Repository: [Lineage2Elbera](https://github.com/elberacasa/Lineage2Elbera), commit [`12c9656e2f053b233ec3fd87056491a6a6da8b0c`](https://github.com/elberacasa/Lineage2Elbera/tree/12c9656e2f053b233ec3fd87056491a6a6da8b0c).
- Checkouts: `C:/laragon/www/Lineage2Elbera` on IMPORTA-PC and `E:/Lineage2Elbera` on DATABASE-PC, both at `12c9656`.
- All `file:line` references below are upstream paths at that commit unless they start with `scripts/`, `src/` or `recipes/` (this client).
- Licence: the root licence grants MIT to Elbera-authored source and docs, with notice retention. It excludes native game content and separately licensed dependencies (UEViewer, SDL2 zlib, sse2neon MIT, open-l2encdec MIT, Real-ESRGAN BSD-3-Clause). The nested `tools/src/char_pipeline/package.json:11` declares ISC; resolve that before redistributing that component.
- Elbera's three.js runtime, deviceId auto login, `elbera-acis.patch` and a smart JSON gateway are out of scope (see `.planning/PROJECT.md`).

### DEC-OWN-4: `.dat` decoder order

- The repo's local hash-pinned descriptor (`06_interlude.xml`) is the authoritative `.dat` decoder wherever it covers a table (DATA-01).
- Elbera code fills gaps only, behind an adapter (DATA-02). The named gaps are `hairgrp` and `helmetgrp`.
- No Elbera decoder for `hairgrp` or `helmetgrp` is identified yet. `tools/dat/build_hair.py:194` bounds hair skeletal mesh streams; it does not decode the `hairgrp` table. The Elbera route may lack these layouts too, which blocks source-backed hair for ACT-01.
- The combined decoded-table inventory (table, route, record count, status) comes first.
- Elbera native verifiers pinned to Engine.dll `07b24af4...` are not used (see "Engine hash gates").

### Unaudited areas

- Elbera `gateway/` and `editor/` are unaudited. NET-03 requires an audit of both before any port.
- This audit covers `tools/` only. Its file inventory (406 tracked files) is the JSON at `docs/research/lineage2elbera/inventory.json`.
- Elbera `editor/` is an upstream world server directory (for example `tools/dev/keepalive_server.py` imports `editor/world/server.py`). It is unrelated to the Babylon.js Editor; for that, see [EDITOR_VIEWER.md](EDITOR_VIEWER.md).

## Existing reuse

`scripts/vendor/lineage2elbera_bsp/SOURCE.json` vendors ten reader and validation symbols from commit `12c9656` (UModel reader, `level_model_binding`, validators). Both upstream file hashes and the local module hash match that receipt. The five local `BspPolygonTests` pass. New reuse extends this approach.

## Verdict per entry

"Adapt" means keep the upstream code behind a small, explicit integration boundary. It does not mean rewrite the algorithm. "Reference" means useful evidence with no demonstrated direct fit. "Feeds" names the requirement the candidate serves.

**`dat`** - Adapt selected functions. Feeds DATA-01, DATA-02, ACT-01.
- Quest decoder: `tools/dat/export_quests.py:59` (bounded lists, checked terminators, unique id/stage keys, full consumption, per-record offsets and hashes, raw float bits); `build` at `:99` keeps encrypted/decrypted provenance. `questname-e` is absent from `scripts/native_catalog/tables.py:30`. Wrap it with local `decode413`, hashing and receipts.
- Helper: `skill_bindings.build_bindings` (`tools/dat/skill_bindings.py:22`) for exact-level skill index compression. Do not copy the `build_skillvfx.py:526` / `build_skillanim.py:60` heuristics.
- Double-scale risk: `export_player_visuals.py:47` applies a root scale with native X/Z/Y mapping; `scripts/native_actor_profiles.py:152` already holds actor scale. `export_npc_visuals.py:150` (inherited scale with cycle rejection) is an independent scale check.
- `build_hair.py:194/:450` is a differential-audit candidate for hair meshes, not `hairgrp` decoding.
- Keep the local DAT reader: `tools/dat/l2dat.py:64` accepts negative Unicode lengths as empty and strips unchecked terminators.

**`xdat`** - Adapt `parse_xdat.py` behind a pinned wrapper. Feeds UI-01.
- `parse_xdat.py` decodes plain `Interface.xdat` to a JSON hierarchy (sizing, anchors, texture refs, grids, drawers: `:125`, `:255`, `:429`, `:481`).
- `scan()` (`:514`) finds header signatures and ends each record at the next header (`:531`, `:686`). Its byte-coverage figure is not decode completeness.
- Unchecked early integer reads (`:182`, `:196`, `:516`); the grid scan misses a candidate at `end - 28` (`:260`); normal export writes even when `--check` guards fail (`:852`, `:856`).
- Texture lookup flattens package groups to package/leaf PNG paths (`:653`) and needs an adapter to local asset identities. Output has no source hash or schema version (`:858`).
- `recipes/native-inputs.lock.json` has no `Interface.xdat`; register the input separately (FOUND-02 input lock).

**`ui`** - Adapt selected miners and the notify reference. Feeds UI-01, UI-02, ACT-04.
- 175 files (75 `check_*`, 60 `test_*`, 16 `mine_*`, 24 others). Most are native-code verifiers, not UI components.
- Layout: `mine_windowsinfo.py:39-117` separates saved INI coordinates from XDAT defaults and rejects conflicting defaults.
- Fonts: `build_font.py:60-138` makes a single-page bitmap-font manifest; no source-hash receipts, no multipage support.
- Notify reference: `check_anim_notify_native.py:24-150` (float32 crossing, serialized order, null-object clock split, loop, four-advance cap). Its limits (`:351-361`) exclude callback mutation, negative rates, AnimEnd and x87 parity. Local `src/assets/package/nativeEventAudio.ts:8-21` sorts events and caps catch-up by design.
- `mine_atlas.py:235-239` deletes output-dir contents and its PNG reader assumes RGBA8 without CRC checks. `mine_native_colors.py` is build-specific. `check_tutorial_quest_native.py:21-29` requires Engine `07b24af4...`.

**`maps`** - Adapt `build_minimap.py`. Feeds WORLD-06 (stage A, lane L1).
- `tools/maps/build_minimap.py` (`:81`, `:119`, `:176`) stitches six retail PNGs into 256-px tiles plus a georeferenced manifest. It needs Pillow, parameterised paths and source hashes.
- Anchor pixels come from the same fitted transform (`:193`), so alignment needs independently measured retail anchors.
- `tilemap.py` labels are manual, aCis-derived interpretations and it runs I/O on import. `unrparse.py`, `propscan.py` and `unrmap.py` are weaker than `scripts/native_map.py`. Local `src` and `scripts` have no minimap or world map implementation.

**`world`** - Adapt selected decoders and checks; do not copy the converter. Feeds WORLD-01, WORLD-03, WORLD-05.
- 38 files. Candidates named in PORT_SCOPE section 9: `convert.py`, `bsp.py`, `lightmap.py`, `bsplight.py`.
- Do not inherit `bsp.py` wholesale: 4,800-unit buckets (`:114`), skips materials/zones (`:308`), forces double-sided (`:477`), alpha-histogram fallback (`:450`), custom glTF extras for lightmaps (`:495`). `convert.py` looks up materials by basename (`:1163`), maps blend modes to plain BLEND (`:1138`) and falls back to a G16 marker scan (`:424`).
- Tile coverage checks: `terrain_topology.py:281` (sector-table visibility cross-check) and `terrain_edges.py:114` (neighbour samples) fit the per-tile coverage manifest (WORLD-03).
- Collision exporters: `export_bsp_collision.py:310`; `export_static_collision.py:77` needs `tools/dat` and `tools/ui` siblings and native verification (`:1461`); terrain collision is gated to exact Engine/Core hashes (`:362`) and finite 256-square data (`:205`); zone export accepts two map hashes (`export_terrain_zones.py:199`).
- `light_extract.py:102` picks one fog-enabled zone. `geodata.py` decodes L2OFF geodata, which is server data (see GEO-01).
- Lightmaps (`lightmap.py:160`, `bsplight.py:388`) are polish work (DEC-PORT-5), not stage A; see "Lightmap decoder" below.

**`anim`** - Adapt the NPC selector helpers; keep local sparse-key conversion. Feeds ACT-02, ACT-04.
- `tools/anim/build_npc_variants.py:49/:165/:219`: qualified inheritance and selector states missing/empty/None/resolved. Prefer it over the `resolve_bindings.py:44` UModel-log cache.
- Binding disagreement: `export_source_tracks.py:108` and `pack_source_tracks.py:61` bind by first matching bone name; `scripts/native_assets_lib/animation.py:48` uses parent/name matching and repairs duplicate Fighter finger names. Resolve against native linkup evidence before any runtime change.
- Timing disagreement: `build_pawnanim.py:220` allows equal adjacent key times; local `animation.py:20` rejects them and supports implicit timing at `:88`.
- `compare.html:76` normalizes height, so it is not a scale reference. `rebuild_one.py:49` guessed clips are not selection policy.
- Smallest proof: a read-only comparison receipt on one pinned Fighter animation plus duplicate-name and implicit/equal-time synthetic cases.

**`audio`** - Adapt `skill_sound_rows` as a comparison; keep local conversion. Feeds ACT-05.
- Do not adopt `tools/audio/build_audio.py`: `:119` downmixes WAVs via ffmpeg to mono 48-kbit Opus; `:244` rounds NPC gains and radii. `scripts/native_audio.py:43/:114` is stricter (Ogg CRC, sequence, footer, full RIFF framing).
- `skill_sound_rows` acceptance: keep every ordered duplicate and empty row, all 3x3 sound slots, 15 voice slots, zeros and fractional gains; reject incomplete or nonfinite fields. Compare against `scripts/native_effect_bundle.py:348`.
- Alias fixtures (`sound_reference_aliases.py:65`) must not relax the exact joins in `scripts/native_assets_lib/footstep_config.py:129`.
- `verify_falloff.py:243` checks upstream JS panner settings, not the native attenuation curve. `native_audio_profile.py` needs Capstone and a matching ALAudio.dll hash.
- Do not copy `build_stepnotify.py`'s two-step locomotion expectation or its rounded timeline positions (`:385`, `:420`).

**`mesh`** - Adapt table and coverage logic; reference only for geometry. Feeds ACT-03.
- Adapt `tools/mesh/build_armor.py` `collect()` (`:406`), slot-suffix checks (`:179`) and refusal accounting (`:792`).
- Defect: `strip_to_mesh()` (`:455`, `:488`, `:498`) keeps only primitive 0 and skin 0, discarding distinct inverse binds. Use a multi-primitive, distinct-bind fixture first.
- Geometry recomputes normals and top-4 normalizes weights, which conflicts with CONV-02. Stage dirs are reused when present (`:512`); textures are compared by size only (`:673`).

**`src`** - Adapt selected diagnostics; keep local assembly. Feeds ACT-03.
- `tools/src/char_pipeline/assemble.py` (`:487`, `:596`, `:810`) recomputes normals and inverse binds, truncates and normalizes to four influences, rigidly attaches hair, rewrites head weights, regenerates PSA timing and uses an `(x,z,-y)` basis. All of this conflicts with CONV-02.
- Adapt `winding_check.py:77` as an independent triangle-normal diagnostic; consider `audit_prop_materials.py:212`.
- `build_weapons.py:141/:516` socket decoding and transform rejection are comparison evidence for ACT-03 (static unskinned output; multiple bones only trigger a note at `:535`).
- Browser inspectors need three.js and Puppeteer with macOS Chrome paths (`render_check.js:13`); they prove nothing about Babylon.js WebGPU.

**`l2lib`** - Keep existing BSP reuse; adapt bounded class and string helpers.
- String semantics differ: `tools/l2lib/stringproperty.py:13` widens byte `0x80` to code unit 128; `scripts/native_catalog/ue2.py:69/:203` decodes cp1252 to U+20AC (synthetic check). Property-string semantics are unqualified.
- `read_properties` (`ue2package.py:444/:482`) overwrites repeated tags by name and drops array/struct metadata; its `body_reader` is not export-bounded (`:371`). Local `Package.properties` (`ue2.py:168`) keeps them. Do not replace it.
- `textures.py:197` G16-to-RGBA drops the low byte; `scripts/native_map.py:207` keeps 16-bit heights.
- Encrypted protocols other than 121 (including 111) call repo-relative `tools/bin/l2encdec` with no Windows discovery.
- Candidates: `classdata.py:152` and `declarations.py:141` for class-prefix and declaration evidence; `read_polys` (`ue2package.py:1147/:1164`) when brush-local polygons are needed.

**`uscript`** - Adapt narrowly as an optional evidence reader.
- `extract_uscript.py` recovers embedded TextBuffer source only (Latin-1, class-declaration regex). It does not decompile bytecode or produce class defaults.
- It cannot replace `scripts/native_catalog/effects.py:264` `read_class_defaults` (UELib).
- Its thresholds (at least 142 `Interface.u` and 87 `NWindow.u` classes) are edition-specific.

**`utx`** - Reference only; defer editing.
- `utxedit.py` accepts only package version 117 (`:192`). `scripts/native_assets_lib/texture_mips.py` supports UE123/licensee 20, 28, 30 with original P8/DXT payloads.
- `replace` regenerates box-filtered mips and recompresses DXT (DXT1 drops alpha). `parse_texture` does not reject an unexpected body end (`:339`).

**`audit`** - Adapt the gap-inventory idea only. Feeds INT-01.
- A source-record-without-runtime-consumer inventory joined to receipts fits the INT-01 coverage report. Acceptance: a deliberately disconnected consumer raises the gap count, a missing fixture reports "unavailable", unchanged receipts stay unchanged.
- `unsourced.py` marks a literal SOURCED because of a nearby comment (memory-only experiment: `0x123456` flipped after adding `// decoded from native data`). Literal counts are not provenance.
- The `retail_gaps.py` gate rejects decreases too; its selftest needs real repo data and is not portable.
- `probe_sky.py:110` and `probe_skydome.py:84` swap red/blue assuming BGRA, which conflicts with the RGBA reading in `scripts/native_sky.py:33/:39`. See "Open".

**`playtest`** - Adapt regression patterns for stage B. Feeds NET-04.
- `tools/playtest/session.test.mjs` patterns: injected clock and transport (`:6`), ordered entry buffering with overflow/mismatch rejection (`:74`), reported origin vs requested destination (`:36`), cancellation of overlapping moves (`:326`, `:339`).
- Proof acceptance: ordered complete snapshots, no destination-as-arrival, no events after close, no deferred attack after a failed move.
- Login-server account autocreation can happen despite `noAutoCreate` (upstream `tools/playtest/README.md:39`).

**`dev`** - Reference only.
- `seed_test_char.py` puts names into SQL unescaped (`:148`), its ".sql backup" is SELECT output (`:192`), and apply deletes skills. Never run it against a Mobius database.
- `db_cli.cjs` `dbArgs` is adaptable only once a MariaDB integration exists (stage B).

**`release`** - Reference; keep local asset packaging.
- `build_source_archive` (`tools/release/build_core.py:35/:57`) is a reusable allowlist ZIP builder if tooling is ever distributed. It needs explicit UTF-8 reads and complete manifest membership checks.
- `tools/release/smoke_bsp.py:79` calls `read_text()` without `encoding='utf-8'` and fails on Windows cp1252.

**`patches`** - Reference only.
- The render patch adds env-controlled camera and screenshot hooks to UEViewer. UEViewer captures are not L2.exe evidence (CHECK-01).
- The reviewed UEViewer source revision `a0bfb468d42be831b126632fd8a0ae6b3614f981` is pinned in `scripts/native_assets_lib/static_materials.py:20`.

**`upscale`** - Defer AI upscaling.
- `batch_world.sh` checks only for nonzero output and its `cd` at `:12` breaks direct invocation. `world_manifest.py` ignores scene membership and mask channels.

**`README.md`** - Use the catalog to find tools; verify claims against code.
- Upstream `--check` is not read-only: `export_quest_sounds.py` still writes a receipt; `extract_uscript --check` decrypts to temp files.

**`battery.sh`** - Reference only.
- 233 suite rows. An unmatched filter exits 0 with zero suites; retries hide flakes as exit 0; it deletes its log dir and kills processes by name, including all headless Chrome.
- A combined runner extends `package.json` test entry points with an explicit suite inventory and fails on an empty selection. No shell port.

**`build-tools.sh`** - Reference only on Windows.
- macOS ARM64 only, no download checksums, unpinned shallow clones of UEViewer and open-l2encdec; `--force` inherits the render-patched checkout.
- Keep the pinned Windows UModel build1590 (SHA-256 `13502e5a...364a0`, `scripts/native_assets.py:30`); the installed binary re-hashes to that value.

**`test_battery.js`** - Reference only.
- Hardcodes `/bin/bash`, is CommonJS against this client's ESM `package.json`, and stubs `nc`/`pkill`. It proves neither Windows execution nor runner isolation.

## Skill and audio alignment rules

The later Elbera alignment checks live in `artifacts/native-parity/research/elbera-alignment-20261107/REPORT.md`, `ALIGNMENT_ASSETS.md` and `ALIGNMENT_REFUTER.md`. Rules (feed DATA-02, ACT-05, ACT-06):

- Reuse Elbera selectors only while keeping the original global row ordinals and raw references beside per-skill groups or lowercased derivatives.
- Per-ID order is not global order; the alignment refuter rejects that equation.
- Do not copy `build_stepnotify`'s two-step expectation or its rounded timing.

## Recommended proofs

Order follows stage A lanes (DEC-OWN-6); the phase order is in [.planning/ROADMAP.md](../.planning/ROADMAP.md).

1. **Data (L3).** Write the decoded-table inventory first (DEC-OWN-4). Wrap `export_quests.py:59` with local `decode413` and receipts; prove it on malformed and truncated synthetic records, then byte-compare against the pinned encrypted source.
2. **UI (L3).** A pinned `Interface.xdat` wrapper with a registered source hash, explicit texture index and unresolved-field diagnostics. Compare selected raw field offsets and values against the JSON; exercise malformed headers and end-boundary grids; preserve ambiguous parents. Adapt `mine_windowsinfo.py` and `build_font.py` behind source hashes.
3. **World (L1).** Use `terrain_topology.py` and `terrain_edges.py` cross-checks in the per-tile coverage manifest. Adapt `build_minimap.py` with parameterised paths, source hashes and measured retail anchors.
4. **Actors (L2).** Adapt NPC selectors, `skill_sound_rows`, notify fixtures and armor `collect()` as comparisons against existing local decoding. Report bone-binding, key-time, notify-order, null-callback and loop-boundary differences. These are disagreements, not demonstrated local bugs; qualification needs the locally pinned build and an observed behaviour worth reproducing.
5. **Reflection evidence.** When default-property evidence is needed (consumer ACT-06), extend the local package adapter with names, imports, class identity and `super_index`, then qualify one file-123 class from `classdata.py:152` / `declarations.py:141` against UELib authored defaults. Validate tags against inherited declarations and types; keep unsupported tokens and nonfinite values explicit.
6. **Verification methods.** Reuse synthetic fixtures and isolated source-kit testing. Keep local asset hashing, qualified references, original mips, deterministic receipts and source-preserving GLB processing. Do not build a parallel converter or test framework to mirror upstream layout.

## Refuter objections that hold

### Lightmap decoder

Lightmaps are polish work (DEC-PORT-5). Before any reuse of `tools/world/lightmap.py:160` and `bsplight.py:388`:

- Overread counterexample: package bytes `00 00`, a Model export at offset 0 with length 1, `lightmap_tail=1`, empty nodes and surfaces. `bsplight.py` `decode_model` builds its reader over the whole package (`:391`), its zero-record early return (`:396`) skips the final cursor check, and it reads past the export end and returns success.
- Required fixes: export-bounded reads; raw float bits instead of six-decimal rounding (`:497`); mask spans (`:465`); all mip spans for every variant (`:556`); section and node vertex-range checks in `_section_vertex_offsets` (`:671`) and UV reads (`:630`); promote UV (`:639`, checked only by the CLI at `:772`) and polygon (`lightmap.py:232`) counters to failures. Preserve unexplained bytes and report unwalked atlas regions.
- The local `PackageAdapter` lacks `ref_name`, which `lightmap.py:211` needs (`scripts/native_bsp_floor.py:73`). `scripts/native_bsp_floor.py:309` leaves the lightmap tail undecoded.
- Variant meaning and runtime selection are unresolved (`bsplight.py:191`); do not pick variants by assumed time of day. A Babylon comparison must show a visible benefit.
- The 66 passing world tests do not exercise the lightmap decoder.

### Class defaults

Local `Package.properties` (`scripts/native_catalog/ue2.py:162`) does not join the declaration chain and rejects nonfinite typed floats. `read_class_defaults` returns authored defaults without inherited values. A serialized prefix is not a loaded default object.

### Local preservation limits

- `scripts/native_assets_lib/weights.py:321` merges duplicate same-bone lanes and may store a quantized standard derivative beside exact custom attributes. Buffer equality is not native deformation proof.
- `nativeEventAudio.ts:8` sorts preview events and caps catch-up, unlike upstream serialized order.
- Keep these limits visible in acceptance results.

### Engine hash gates

Several native verifiers pin Engine SHA-256 `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`. This client's Engine.dll is `4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`. Do not weaken the gates or assume equal instruction addresses. Portable fixtures stay useful; native-verifier success on another build proves nothing here. Three.js inspectors, macOS launchers, aCis-derived metadata and fixed source directories need explicit adapters.

## Executed checks (2026-11-07)

- `l2lib`: 56 passed, plus two synthetic differential assertions; the refuter reran the same five modules with 56 passed.
- `world`: 66 passed (BSP 12, terrain collision 12, terrain zones 12, prop identity 15, topology 7, edges 8). `test_static_collision` needs absent `capstone`.
- `ui` notify fixtures 23; `anim` 18; `audio` 14; `dat` 13 passed with 4 private-fixture skips; `uscript` 6; `xdat` 17; `playtest` 22.
- Release kits: Core 84 passed, NPC Source 95 passed (43 manifest files). These reuse suites above.
- BSP release check fails before Node runs (`smoke_bsp.py:79` cp1252).
- The refuter reproduced the synthetic lightmap overread.

The audit ran no full battery, installed no dependencies, executed no game binaries, launched no services and modified no private assets. A passing synthetic check proves its fixture contract, not client parity.

## Reuse rule

Before adding a decoder, exporter or evidence harness:

- Check the inventory, the upstream implementation and the local equivalent.
- Prefer a pinned upstream function plus a small adapter when it preserves the required data.
- Carry the licence and source hashes, reuse relevant fixtures, add an independent acceptance check.
- Document any incompatible assumption that needs a local extension. Keep unknowns as explicit results.
- Legacy details must justify their cost through required behaviour or a visible difference.

## Open

No requirement covers these items. They stay here until one does.

- Sky channel order: `probe_sky.py:110` / `probe_skydome.py:84` assume BGRA; `scripts/native_sky.py:33/:39` reads RGBA. Unadjudicated. Closest owners: WORLD-02, CHECK-01.
- Bone-binding policy (first-name vs parent/name with duplicate repair). ACT-04 covers only the timing part.
- Property-string decoding (`0x80` widening vs cp1252) needs qualification on a real native record.
- Class-prefix and declaration adapter (`classdata.py:152`, `declarations.py:141`); its consumer is ACT-06.
- Independent NPC and player scale check (`export_npc_visuals.py:150`) against local actor scale.
- BSP and static-mesh collision from native source records. WORLD-05 names terrain collision only; STATE.md tracks client collision vs server authority.
- Lightmap decoder fixes, a pinned lit-node proof, Babylon integration and variant selection (polish, DEC-PORT-5).
- Native `.gly` font conversion (PORT_SCOPE lists five `.gly` fonts, 0.5 MB). UI-01 and UI-02 cover layout and windows only.
- Runtime spatial and ambient playback policy. `src/audio/WorldAudioMixer.ts:143` plays bounded one-shot previews; WORLD-02 covers conversion only.
- Native distance falloff curve. POL-02 names footstep rules, not attenuation.
- Account autocreation despite `noAutoCreate` on the stock Mobius login path (NET-03 does not state it).
