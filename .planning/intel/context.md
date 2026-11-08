# Context

Running notes keyed by topic. Each block cites its source; quoted text is verbatim. DOC-type sources included: docs/ROADMAP.md, README.md, DESIGN.md, docs/UI_DIRECTION.md, docs/SOURCE_REUSE.md, docs/LINEAGE2ELBERA_REUSE_AUDIT.md, docs/NATIVE_WORLD.md, docs/ASSET_BATCHING.md, docs/NATIVE_CLIENT_AUDIT.md. The two cross-reference cycles involving ASSET_BATCHING and NATIVE_CLIENT_AUDIT were waived by the owner on 2026-11-08.

Source citations quote the docs as of the ingest on 2026-11-08. Current homes: docs/ROADMAP.md content is in .planning/ROADMAP.md (order) and .planning/STATE.md (status); docs/ASSET_BATCHING.md is in docs/ASSET_PIPELINE.md; docs/UI_DIRECTION.md is in DESIGN.md; Editor docs are in docs/EDITOR_VIEWER.md. Current decisions are in .planning/PROJECT.md `<decisions>`.

## Topic: Project status and work sequence as of 2026-11-07
- source: docs/ROADMAP.md, "Current direction and next work - 2026-11-07" (DOC, precedence 8)
- "The end goal is reusable conversion of native characters/races, male/female variants, equipment, animations/effects and map blocks, with original audio connected to gameplay. The user's latest sequencing is explicit: **finish human male/female, their class skills and usable 20_20 traversal before expanding to other races or map tiles**." [Superseded by DEC-OWN-1: the work order is breadth-first stage A.]
- "Use independently runnable small scripts per game system with shared readers and packaging helpers. Running one system must not require all extraction."
- Female fighter recipe: seven parts, 113 clips, 323 events, 61 linked sounds; female-world integration passes source/authored desktop and mobile hardware WebGPU checks; six specialized female attack events unresolved.
- Indoor-stair repair passes male/female source/authored hardware WebGPU ascent/descent; "Automatic routing around turns and upper-landing camera roof occlusion remain open. ... No complete 20_20 or all-human acceptance is claimed."
- "The selected **4,773-sound** export/decode, clean-build, cache-repeat and verify-only checkpoint is complete ... Do not repeat it on resume."
- Rendering: "The native loader still eagerly loads the section and clones placements; no optimization gain or 120 FPS acceptance is claimed."
- Note: the document footer reads "Updated: 2026-11-06" while headings are dated 2026-11-07.

## Topic: ROADMAP historical checkpoints (2026-11-05 to 2026-11-06)
- source: docs/ROADMAP.md (precedence 8)
- TerrainSector247 integrated: 157 placements, 62 models, 4,992 terrain triangles; 735-value V correction for `20_20`. BSP floor (Brush397 slab) restored; sky room loaded as editable geometry; six death cues then nine cues with gesture unlock. Editor Play recovered after project-close/Dashboard/reopen with all 2,248 files unchanged; "the original cause remains unknown." Native-world scene `native-world.scene` passes 2/2 authored desktop/mobile checks; 2,245 authored files survive repeat import. Migration proof: 381 identical products, 26/26 cache hits, 100 archives (69 models, 29 textures, two audio), 70 GLBs with zero Khronos errors/warnings.

## Topic: Phase 1 and Phase 2 as written in ROADMAP
- source: docs/ROADMAP.md, "Phase 1 - browser foundation", "Phase 1 follow-up - converted asset integration", "Phase 2 - Real M0 networking"
- Phase 1 implemented and pushed in commit `3b16f1c317e20ee636a3b3f83bddafc15096740a`; baseline passed strict typecheck, build, 37 Vitest tests, nine Playwright tests; "Desktop Editor import/edit/save/reopen/play and live official MCP authoring were not performed because those tools were unavailable."
- "**Planned, not implemented:** establish Interlude authentication, character selection, and world entry against stock Mobius. Keep `GameWorldAdapter` as the integration boundary."
- "The asset follow-up preserves this boundary. Real combat calculations, quests, progression, gacha, broad map reconversion and production deployment remain outside the current scope." (Superseded: broad map reconversion is in scope per docs/PORT_SCOPE.md and DEC-OWN-7; see INFO in .planning/INGEST-CONFLICTS.md.)

## Topic: README overview and run instructions
- source: README.md (DOC, no precedence)
- A standalone Babylon.js browser client; "It does not connect to a game server."
- Stack pins: Node 22.12.0+, pnpm 10.32.1, Babylon.js 9.27.1, Editor tools/CLI 5.5.3, TypeScript 7.0.2, Vite 7.3.7, Vitest 5.1.0, Playwright 1.64.1. Commands: `pnpm install`, `pnpm dev` (port 5173), `pnpm build`, `pnpm serve`, `pnpm test`, `pnpm typecheck`, `pnpm assets:migrate --prove-rebuild`, `pnpm assets:stage`, `pnpm assets:editor`.
- Routes (DEC-OWN-11): `/` (native sandbox), `/?authored=1` (optional Editor export), `/?character=<id>` (staged player profile).
- Private preview: l2.kingdom.lv serves the authored native world after invitation entry; DATABASE-PC hosts the build "and must stay running". Live URL "retains the earlier build" while the readiness fix is staged.
- "Phase 1 excludes Mobius networking, authentication, character selection against a server, Interlude packets, relay services, SpacetimeDB, combat calculations, quests, progression and gacha."
- Native reference: "**IMPORTA-PC's `C:/Lineage2-client` is the authoritative native reference.** ... `E:/Lineage2-client` is a reusable local copy only after fresh source-hash equality."

## Topic: Design system tokens
- source: DESIGN.md (DOC, no precedence)
- Creative north star "The Classic Fantasy HUD": flat dark panels, bronze borders, warm ivory text. Normative tokens: primary `#edcd88`, bronze `#a58c59`, panel `rgb(24 28 26 / 94%)`, border `rgb(191 167 111 / 55%)`, backdrop `#202522`, text `#f5ecd8`, muted `#d0c6af`, button `#303b35`, attack `#654430`, hover `#4b574a`, pressed `#79704a`, health-player `#a33d2e`, health-friendly `#87bea4`, health-monster `#d59472`, focus `#ffe0a3`. Display font Cormorant Garamond Variable; body Segoe UI; diagnostics monospace. Square corners (0 px), 44 px minimum touch targets, 2 px Focus Gold outline.
- Do: keep bronze/green-charcoal/ivory relationship, 44 px controls, icons paired with labels, "keep synthetic data identified". Don't: copy proprietary artwork or reference pixels, add decorative material effects.
- "There are no text-entry fields or primary navigation components in this phase." This is the reviewed procedural foundation's interface and says nothing about the 140-window native UI in docs/PORT_SCOPE.md part 5.

## Topic: Mobile scene interface direction
- source: docs/UI_DIRECTION.md (DOC, no precedence)
- "MODE: Operate. The primary task is inspecting and interacting with a synthetic 3D world." Primary layout portrait 390 x 844; health upper left, five large actions at bottom, collapsible secondary controls. "Preserve this HUD direction while updating stale Markdown; a stylesheet overhaul was not requested."

## Topic: Source provenance and licensing
- source: docs/SOURCE_REUSE.md (DOC, no precedence)
- No source copied from other workspaces or unlicensed projects. Babylon.js Editor Vanilla template revision `e3fce2cea68c6a32fdbacbb4c5aa4e6a0f154db7` (Apache-2.0, retained in `docs/licenses/BabylonJS-Editor.txt`). Cormorant Garamond via Fontsource under SIL OFL 1.1.
- Lineage2Elbera pinned at `12c9656e2f053b233ec3fd87056491a6a6da8b0c` (MIT), with ten BSP reader symbols vendored in `scripts/vendor/lineage2elbera_bsp`.
- Authoritative fleet snapshot 2026-11-05: "**143 files / 2,511,063,181 bytes**", including `system/Engine.dll` (30,704,468 bytes, SHA-256 `4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`) read only as dispatch evidence. "Fresh IMPORTA-PC hash equality preceded the E: candidate copy."
- Superseded statement, 2026-11-04 (DEC-OWN-2 replaces it): "The user selected `E:/Lineage2-client` as the source of truth for new assets." Later text: "The current native reference is **IMPORTA-PC, `C:/Lineage2-client`**."
- Converted binaries, native audio, captures stay under ignored `artifacts/`; "No original Lineage II maps, characters, textures, audio or converted binaries are committed or published by this task."

## Topic: Lineage2Elbera reuse audit
- source: docs/LINEAGE2ELBERA_REUSE_AUDIT.md (DOC, no precedence), dated 2026-11-07
- "Use Lineage2Elbera as a source of reusable implementations, fixtures and format knowledge before writing another decoder." 22 entries, 406 files; MIT root license excluding game content; nested character-pipeline package declares ISC (metadata inconsistency to resolve before redistribution).
- Per-entry conclusions include: `dat` "Adapt strict quest-journal parsing ... Existing local tables already overlap extensively"; `world` "Strong candidate: reuse BSP render-section/lightmap parsing with export-boundary fixes"; `ui`/`xdat` "Adapt native UI extraction behind source hashes and stronger boundary checks ... Most files are native verifiers, not ready-made interface components"; `audio` "upstream defaults downmix WAVs to lossy mono Opus. Keep existing original-byte conversion"; `playtest` "Adapt injected-clock/transport regression patterns when networking is implemented."
- Strongest proposal: baked BSP lighting (`tools/world/lightmap.py:160`, `bsplight.py:388`) with export-bounded reads; refuter reproduced a lightmap export overread with a two-byte synthetic package.
- "Several native verifiers pin Engine SHA-256 `07b24af4ab55...`; this client's recorded Engine.dll is `4dd2f63c606d...`. Do not remove gates or assume equivalent instruction addresses."
- Reuse rule: "Before adding a decoder, exporter or evidence harness, check this inventory, the upstream implementation, and the local equivalent. Prefer pinned upstream functions plus a small adapter when they preserve the required data."

## Topic: Native Interlude world preview status
- source: docs/NATIVE_WORLD.md (DOC, no precedence)
- `/` loads the staged native map section (PlayerStart10 area, 62 models / 157 placements / 4,992 terrain triangles), Human male fighter and Greater Musveren, with live FPS. Startup location: `20_20.PlayerStart10` at native XYZ `[10536, 95034, -3374.786376953125]` is "source-backed startup selection, not observation of the current live pawn or camera."
- Coordinates: "glTF XYZ = .01 * native XZY"; the Editor packer serializes left-handed by default (an Editor route detail; NOED-01 builds the native scene in code) and the native scene script "establishes right-handed coordinates after parsing and before any native GLB load."
- Terrain: 735 V fields corrected by `(grid + 0.5)/256 - max(grid - 240, 0)/4096` for the proved `20_20` route. Native draws are "**offscreen submissions**"; they do not establish visible native pixels.
- Open: native shader/particle execution, live camera/location alignment, full attack and Power Strike parity, sword attachment, effect-timing authoring, hardware performance acceptance. Musveren death pose still intersects terrain by up to 0.119400140 m (660/1,591 vertices).

## Topic: Conversion system coverage and next work (ASSET_BATCHING)
- source: docs/ASSET_BATCHING.md (DOC, no precedence), "Current direction: 2026-11-07"
- "The user has explicitly ordered the next work: finish human male/female, their class skills and usable 20_20 traversal before adding more races or map tiles. The reproduced indoor stair-support defect now passes on both routes; automatic routing and indoor camera obstruction remain open ... One fighter recipe does not establish coverage of all human classes or skills."
- Pipeline shape: read-only Interlude source + identities -> inventory and recipe selection -> type-specific readers/converters -> verified GLB, textures, audio and metadata/event sidecars -> versioned bundles + coverage manifest + reusable cache -> explicit browser staging / additive Editor integration -> runtime behavior and source/authored-route verification.
- Coverage table (verbatim limits): world/buildings "Current selected 20_20 content has 62 models / 157 placements, terrain extension and four qualified BSP resources including the restored room shell. This is not the whole map or all neighboring tiles." Sounds: 4,773 exports from 18 locked UAX packages; "nine more packages in the dated census and complete standalone music/voice coverage remain outside this batch." Effects/skills: "Complete Power Strike presentation, all skills and general particle execution are unfinished." Legacy migration adapter: "Its retained 61/151 map output is historical; automatically staging it would replace the newer 62/157 catalog."
- Skill tables: 29,812 skill rows and 1,398 sound rows; current recipe selects Power Strike 3/1 only (two original WAVs). Counts are non-additive: 4,773 sound exports, 75 embedded actor WAVs, nine connected world cues (female route nine, thirteen definitions across both variants, twenty-one including both special previews).
- Orchestrator proof: clean/repeat/verify/reuse with 62 focused cases (61 pass, 1 Windows symlink skip). WebGPU measurement checkpoint "provides opt-in instrumentation and a bounded pilot, not a performance acceptance pass."
- Next work in the user's order [superseded by DEC-OWN-1 breadth-first order and DEC-OWN-8 Editor removal; kept as ingest quote]: (1) preserve scoped male/female profiles and complete remaining human bases, appearance, equipment, footsteps, interactive Editor save; (2) human class and skill inventory and bundles; (3) preserve the stair repair, with routing, camera obstruction and full 20_20 traversal open; (4) only then other races/sexes and tiles; (5) one persistent Scene with bounded cells. Item 4 adds: "Preserve exact source rigs, terrain seams, placements, dependencies and cross-tile identity; derive bounds from complete geometry and keep the qualified UV scope bounded."

## Topic: Installed native client audit (NATIVE_CLIENT_AUDIT)
- source: docs/NATIVE_CLIENT_AUDIT.md (DOC, no precedence)
- Authority banner (2026-11-05): "the current authority is IMPORTA-PC's `C:/Lineage2-client`. `recipes/native-inputs.lock.json` pins the **143-file / 2,511,063,181-byte** staged closure ... The E: inventory below is historical and cannot establish equality without the recorded fleet hash checks."
- Inventory (E:, 2026-11-04): 1,515 regular files / 7,796,355,051 bytes. Directory counts: animations 20, maps 163, music 250, sounds 26, staticmeshes 212, systextures 70, textures 387, voice 46, system 147, l2text 184. Formats: `.unr` 163 (153 `Lineage2Ver111`, 10 plain), `.usx` 212, `.utx` 435 (all Ver121), `.ukx` 19 (18 Ver111, one plain) plus `.usk` 1 (`animations/Skill.usk`), `.uax` 27, `.u` 25, `.dat` 41 (40 Ver413 system tables plus one unrelated file under `iwo/`), `.ogg` 295 (42 standard, 253 L2SD including all 250 music files). Version111 uses a constant XOR; version121 derives its key from the original lowercase filename.
- Package versions: most are Unreal 123 with licensee versions 0 to 31; some 118, one 126; "The wrapper version and Unreal package version are separate fields."
- Client identity: modified third-party Interlude client downloaded as `Lineage II Mobius Interlude.zip` (3,564,298,489 bytes, SHA-256 `c44698923eac4bcbb6f15fb575915c78d11a9996559cd08a28115fe90d8ec8fc`); "it must not be described as an untouched official distribution" (includes `clmods.dll`, `nosleep.dll`, custom interface files; `L2.exe` is a replacement launcher).
- Table adapters: typed readers select layouts through the pinned `06_interlude.xml` descriptor; 29,812 skill presentation rows, 1,398 skill sound rows, 5,463 NPC skill animation rows, 15 character rows (`chargrp`), armorgrp 1,014, weapongrp 1,313, npcgrp 6,519, npcname 6,519 unique IDs. `hairgrp` is commented out in the descriptor as "cant write data" and `helmetgrp` as "no struct". `mesh field_stalker_m00` occurs in 22 NPC rows, so a name alone cannot select an actor profile; Greater Musveren is NPC 21622, class `LineageMonster.field_stalker_20_bi`, DrawScale 1.2, CollisionRadius 18, CollisionHeight 36.
- Animation notifies: 651 notify objects / 655 timed events / 340 sequences from `Fighter.ukx`; 430 / 430 / 258 from `Magic.ukx`.
- Requirements stated for client-ready packages: "A drag-and-drop bundle needs more than a GLB: geometry/materials, original clip names and timing, bone/socket bindings, notification/event sidecars, audio, effect definitions, source skill-to-effect/sound mappings, world transforms and collision/support metadata must travel together in a validated manifest. Import should verify every dependency and report unsupported native features explicitly." "Source skills describe presentation bindings here; server-authoritative combat remains a separate integration."
- Not done by the audit: "No physical-device test, browser import, full-corpus extraction or original-game comparison was performed."
