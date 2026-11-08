# Requirements: l2-browser-client

**Defined:** 2026-11-08
**Core Value:** A fully converted Lineage II Interlude client that runs in the browser and matches L2.exe side by side, driven only by what a server sends.

Source intel: `.planning/intel/requirements.md`, `constraints.md`, `decisions.md` at commit `9c64e61` (removed from the tree on 2026-11-08). Locked owner decisions DEC-OWN-1..10 and DEC-PORT-1..3 override any conflicting variant. Stage A "passes" means the DEC-OWN-3 bar (converted, loads in the sandbox, side-by-side screenshot / listen check against L2.exe on IMPORTA-PC). Fixed thresholds apply only to POL and PERF requirements.

## v1 Requirements

### Foundations (Phase 1)

- [x] **FOUND-01**: Shared process files exist and are used: `STATUS.md` (one line per part, rewritten in place), append-only `DECISIONS.md` seeded with DEC-OWN/DEC-PORT, `.planning/lanes.json` folder ownership by lane (world, actors, data-ui, integration; each part belongs to one lane, integration owns `package.json`, the catalog writer, `src/runtime/**`, the native-store writers and the status files, and `scripts/check-lane-ownership.mjs` compares a branch diff with its lane), and `docs/parts/<part>/EVIDENCE.md` (under about 30 KB). Rules: one part per branch `<part>/<slug>`, at most 3 lanes, native-store scripts only in the main checkout, merge one branch at a time with contract changes first.
- [x] **FOUND-02**: Output contract written and testable: `.l2asset` + runtime catalog stay the contract; each `asset.json` records source path and SHA-256, client build, converter version, and units and handedness for its route; `recipes/native-inputs.lock.json` stays input-only; the client loads assets only through the catalog. Small hash-pinned golden fixtures let portable tests run without the private client.
- [x] **FOUND-03**: IMPORTA-PC `C:/Lineage2-client` is recorded as the reference for all L2.exe comparisons. A one-time full-tree hash lock (file count, bytes, per-file SHA-256; beyond the 143-file closure) proves `E:/Lineage2-client` equal before any stage A conversion reads from E:.
- [x] **FOUND-04**: Combined decoded-table inventory for all 40 `.dat` tables (table, route = local descriptor / Elbera / none, record count, status), written before more tables are decoded.

### Architecture invariants (Phase 1)

- [x] **ARCH-01**: The client never computes gameplay outcomes; it displays what a server sends. Tooltips read server-side stats, not the `.dat` display copies in `weapongrp`, `armorgrp`, `skillgrp`.
- [x] **ARCH-02**: `GameWorldAdapter` is the only way gameplay state enters the client; its five methods stay frozen (a contract test fails on change); adapters emit typed records with no Babylon types.
- [x] **ARCH-03**: The native route reports missing or failed resources visibly and never presents procedural stand-ins; the startup readiness barrier is kept. Inherited by every later phase.
- [ ] **ARCH-04**: Client-owned behaviour stays in presentation: animation, camera, UI, choosing which footstep or hit sound plays, effect timing, smoothing movement between server updates. Asset resolution and audio playback stay outside the adapter.

### Editor off the build and runtime path (Phase 1, integration thread, before Phase 2 lanes start; DEC-OWN-8)

- [ ] **NOED-01**: The native route boots without an Editor scene. `?world=interlude` builds its scene (camera, lights, readiness barrier) in code and loads the world from the `.l2asset` catalog through `loadNativeSection`. The `native-parity.babylon` bootstrap goes away, and the settings now held as Editor inspector fields in `src/scripts/nativeParity.ts` (player profile, clips, material override) become typed config shown on the sandbox sheet. `authored=1` stays optional and is reached only by a dynamic import.
- [ ] **NOED-02**: `pnpm dev` and `pnpm build` no longer run `babylonjs-editor-cli pack`, `ensure-webgpu-project`, `validate-editor-materials`, `preserve-native-editor-uv2`, `preserve-native-editor-fog` or `share-native-terrain-export-materials`, and do not need the l2-editor-webgpu-compat plugin. These move to an optional `pnpm generate:editor`. `stage-webgpu-compilers` stays in dev and build, because `src/engine/createWebGPUEngine.ts` loads glslang and twgsl from `/vendor/babylon/9.27.1/` at runtime. A test fails if the default entry statically imports `babylonjs-editor-tools` or the generated `src/scripts.ts`.
- [ ] **NOED-03**: The legacy courtyard demo (`assets/example.scene`, loaded through `loadScene` in `src/scene/loadEnvironment.ts`) is retired, or kept only behind `pnpm generate:editor`. A clean checkout's default view no longer loads an Editor scene.
- [ ] **NOED-04**: Babylon Inspector opens in the sandbox with `?inspect=1`, lazy-loaded by dynamic import and absent from the default bundle; `@babylonjs/inspector` is pinned to the same exact version as `@babylonjs/core`.
- [ ] **NOED-05**: The Editor stays an optional viewer: `project.bjseditor` and `pnpm assets:editor` remain, and no test, build step, lane or phase gate depends on them. Revisit only if the SpacetimeDB route starts authoring new, non-L2 content.

### Sandbox

- [x] **SAND-01** (Phase 1): Offline sandbox shell with no server: spawn NPC by ID, equip item by ID, cast skill by ID, open window by ID, on `MockWorldAdapter` / `NativeSliceAdapter`. An ID without a converted asset shows an explicit missing-asset diagnostic.
- [ ] **SAND-02** (Phase 2): Sandbox controls are a pinnable developer sheet with hover-cards showing variables (tile picker and walk, spawn, equip, cast, open window, audio mute/volume), not a cramped toggle list.

### Data lane L3 (Phase 2)

- [ ] **DATA-01**: All 40 `.dat` tables decoded to JSON once per client build; where the local hash-pinned descriptor (`06_interlude.xml`) covers a table it is authoritative; the inventory is updated per table.
- [ ] **DATA-02**: Tables the local route lacks (`hairgrp`, `helmetgrp`, others) are decoded by Elbera code behind an adapter; Elbera verifiers pinned to Engine.dll `07b24af4...` are not used.
- [ ] **DATA-03**: The identical sysstring-e / systemmsg-e count (2,083) is investigated and fixed or explained.

### UI lane L3 (Phase 2)

- [ ] **UI-01**: `interface.xdat` (plain; 248 top-level records, 2,638 controls, about 140 real windows) is decoded to a layout tree with a source-hash pin.
- [ ] **UI-02**: Windows are built from the decoded layout and filled with sandbox data; no hardcoded control names (this client uses `StatusLeftTex`, `CPBarTex`, `HPBarTex`, `MPBarTex`); each window opens by ID in the sandbox.
- [ ] **UI-03**: Only the original Interlude interface: window layout from `interface.xdat`, and skin, fonts and icons from the client's converted UI textures. No custom HUD styling (DEC-OWN-10).

### World lane L1 (Phase 2)

- [ ] **WORLD-01**: All 153 tiles (`XX_YY` grid) converted by tile-general converter steps: terrain, static meshes and BSP with the tile-general UV rule. Each 20_20 hand step (nine-sector terrain selection, TerrainSector247, model append, Brush397 BSP slab, Brush610 command-hall BSP) becomes a tile-general step.
- [ ] **WORLD-02**: Sky, ambient (PointRegion) and placement audio converted for all 153 tiles through recipes and scripts, original audio bytes preserved.
- [ ] **WORLD-03**: A coverage manifest records pass or gap per tile per step; failing tiles are listed as gaps and never hand-fixed. The 10 non-tile maps (`Lobby`, `entry`, `skylevel`, `ship_position`, `Auto0` to `Auto5`) are classified; `Lobby` status is known before Phase 4.
- [ ] **WORLD-04**: One persistent runtime scene with bounded cells: baseline measured first, then residency cache and terrain/mesh LOD with traceable derivatives; reveal readiness and nearby collision preserved; visual LOD never redefines collision.
- [ ] **WORLD-05**: The sandbox can walk any converted tile with terrain collision.
- [ ] **WORLD-06**: Minimap and world map from `MinimapCtrl`, `zonename`, `huntingzone`.
- [ ] **WORLD-07** (provisional, owner review): The unreviewed 74-file post-migration terrain packet (`artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/post-migration-visibility-20261106`, manifest fileCount 74) gets the independent review that never ran, by a reviewer that did not write it, after its manifest hashes are re-verified. Each finding gets one verdict (adopted, rejected or polish) recorded in `docs/parts/world/EVIDENCE.md`. Adopted findings become tile-general converter or runtime steps with tests: the layer-sequence fixtures and `DISCRIMINATING_CASES.json` test terrain layer ordering (no pruning rule and no `bUseAlpha` behaviour inferred), and the MusicVolume to `musicinfo` join becomes the per-tile music step of WORLD-02. Y>240 visibility, `bUseAlpha` and alpha-test precision stay open under POL-01. No native launch or capture.
- [ ] **WORLD-08** (provisional, owner review): Static meshes and BSP of every converted tile carry collision taken from source declarations only: for static meshes the actor collision flags (`bCollideActors`, `bBlockActors`, `bBlockPlayers`, resolved through class defaults), material-slot `EnableCollision` and the mesh's serialized collision data; for BSP the whole-level BSP by source PolyFlags plus BlockingVolumes. An object whose collision cannot be read is a per-object gap in the coverage manifest; nothing is inferred from appearance or names. Collision is produced by converters, kept apart from visual LOD (WORLD-04), and is sandbox and presentation support only, not the native extent sweep or geodata (GEO-01). Server authority over movement is decided in Phase 4.

### Actors lane L2 (Phase 2)

- [ ] **ACT-01**: All player characters from `chargrp`, every race, gender and class (row count derived from the decoded table, 15 rows on this client). Missing hair/helmet layouts are explicit gaps; no guessed hair selection.
- [ ] **ACT-02**: NPCs and monsters from `npcgrp` (6,519 rows, about 554 meshes), spawnable by NPC ID; a mesh name alone never selects a profile (`field_stalker_m00` occurs in 22 rows).
- [ ] **ACT-03**: Items and equipment (about 390 weapon and 1,355 armor meshes; 9,238 items) equip by item ID on any character with sockets and attachments preserved.
- [ ] **ACT-04**: Animation clips with original names, timing and notification events travel with each actor bundle; the sandbox plays any clip.
- [ ] **ACT-05**: Sounds bound per actor, animation, skill and enemy bundle (voices, combat, skill, music) with exact source identities; unresolved events stay "unresolved", never invented. Native surface/footstep rules are POL-02.
- [ ] **ACT-06**: Skill visuals and effects (about 2,700 skills, 864 effect classes, 3,709 emitters) bound through `skillgrp`, `skillsoundgrp`, `npcgrp`; cast by skill ID and level; effects that need missing native C++ behaviour are explicit gaps.

### Integration and conversion rules (Phase 2)

- [ ] **INT-01**: The integration lane stages lane output in the main checkout and publishes one coverage report from the catalog (per part: converted, loads, gap); the sandbox marks IDs as available or gap.
- [ ] **CONV-01**: Conversion is independent per-system scripts sharing readers and packaging helpers; one character, skill or tile converts without running all extraction; `assets:pipeline` stays optional.
- [ ] **CONV-02**: Source-preserving conversion: UModel build1590 pinned (SHA-256 `13502e5a...364a0`); no 1.8 m normalization, ground fitting, root-drift removal or weight normalization; unbound material slots become a visible magenta diagnostic; repairs only for a demonstrated defect; `.l2asset` limits respected.

### Stage A checks (Phase 3)

- [ ] **CHECK-01**: For world, characters/NPCs/items, skills and UI, paired screenshots (sandbox vs L2.exe on IMPORTA-PC at the same location or ID) are captured per part.
- [ ] **CHECK-02**: Audio (world, actor, skill) gets a listen check against L2.exe with labelled audible results; extraction or decoding alone is not a pass.
- [ ] **CHECK-03**: Each part's verdict (pass, mismatch, unverified) is recorded in `docs/parts/<part>/EVIDENCE.md`; missing or uncertain evidence is unverified, never a pass.
- [ ] **CHECK-04**: Defects found are fixed in the shared converter step and re-run, never hand-patched per tile; unfixable ones join the gap list.
- [ ] **CHECK-05**: A stage A exit report states per part converted, loads, checked, and pass / mismatch / unverified / gap counts, referencing the IMPORTA-PC hash lock.

### Stage B adapter (Phase 4)

- [ ] **NET-01**: Transport decision recorded first (recommendation: dumb relay). The browser runs L2 crypto and packet code in TypeScript inside the Mobius adapter; the relay forwards bytes between one WebSocket and one TCP connection and connects only to the configured Mobius ports (2106, 7777).
- [ ] **NET-02**: The relay keeps per-player limits and login-failure bans before Mobius sees traffic and logs which account came from which address (Mobius sees only the relay IP: LoginTryBeforeBan 5 / LoginBlockAfterBan 900 s, flood protection on, MaxConnectionPerIP 50).
- [ ] **NET-03**: Authentication, character selection and entry into a stock Mobius world work from the browser; synthetic demos and placeholder login screens do not count. Elbera `gateway/` and `editor/` are audited before any port; crypto is re-checked against stock Mobius.
- [ ] **NET-04**: Server messages are dispatched one packet type at a time into typed adapter events with golden fixtures from captured Mobius packets. Real-adapter duties: snapshot/subscription ordering, L2 units (about 1 cm, Z up) to metres and Y up, seconds, explicit teleports, unsupported demo intents rejected or disabled.
- [ ] **NET-05**: Combat and stats display from `Attack`, `StatusUpdate`, `UserInfo`, `MagicSkillUse`; the client shows server-resolved damage, flags, HP/MP and casts without computing them.
- [ ] **NET-06**: NPC dialogs and shop windows (buy, sell, multisell) show server data in the Phase 2 windows.
- [ ] **NET-07**: Social (party, clan, chat, friends) and quest/tutorial windows show server data.
- [ ] **NET-08**: Conditional: if Mobius does not fit the gameplay loop, a SpacetimeDB adapter emits the same adapter events from table subscriptions, seeded from the Mobius datapack XML export.

### Native-parity polish (Phase 5)

- [ ] **POL-01**: The four fixed visual cases pass the thresholds in `recipes/native-parity.acceptance.json` (Human male fighter equipment/animation, Greater Musveren including death, Power Strike skill 3 with coordinated motion/effect, a declared section of `20_20.unr`). Each result records the file's SHA-256; thresholds are never relaxed. The native reference capture first meets the fixed reference cadence (currently 4.1 FPS, fails).
- [ ] **POL-02**: Audio parity per `recipes/native-audio.acceptance.json`: tolerances and one alignment method defined before comparison; surface- and equipment-aware footsteps from the ALAudio.dll rules; specialized attack sounds; matched native/browser recordings retained.
- [ ] **POL-03**: Human traversal: automatic stair routing around turns and upper-landing camera roof occlusion fixed on 20_20.
- [ ] **POL-04**: Stage A gap list burned down: each gap (tiles, hair/helmet, effect behaviour) is converted or stays listed with a stated reason.

### Performance and build reproducibility (Phase 6)

- [ ] **PERF-01**: GTX 1060 on DATABASE-PC, 1920 x 1080, DPR 1, 32 actors and eight Power Strike effects every 2 s, three trials (15 s warmup, 90 s measure): sustained 120 FPS (1000/120 ms) on an active display of at least 120 Hz. Without such a display, report separately labelled workload timings and the presentation limit, no estimated pass.
- [ ] **PERF-02**: Instancing, GPU texture compression and culling applied in measured order, each with before/after numbers on the same workload and regression checks on the native catalog route (startup, movement, cleanup).
- [ ] **EDIT-02**: One documented command covers inventory, conversion, validation and benchmark; a clean repeat build reproduces matching outputs with conversion cache hits.

## v2 Requirements (deferred)

- **GEO-01**: Real geodata-backed movement display (PORT_SCOPE part 11); no geodata files exist on DATABASE-PC and geodata is server data. Revisit when the adapter needs it.
- **VIEW-01**: Optional viewer work only, not a gate (DEC-OWN-8): open converted tiles in Babylon.js Editor through `pnpm generate:editor` / `pnpm assets:editor`. Replaces the former EDIT-01 per-tile Editor scenes requirement.
- **LATE-01**: Windows for sieges, Olympiad, bosses, Seven Signs, GM tools and boats (PORT_SCOPE part 19, layer 4); not in the stage B list.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Production deployment | Excluded in every source |
| Client-side gameplay math, quests logic, progression, gacha | DEC-PORT-3: client displays server outcomes |
| Publishing converted Lineage II binaries or audio | Stay untracked and local |
| Copying `linegen` source or assets | No redistribution licence |
| Elbera three.js runtime, pinned verifiers, smart JSON gateway | DEC-PORT-6 / DEC-PORT-4 |
| Legacy Direct3D internals for their own sake | DEC-ARCH-1 |

## Superseded

- REQ-work-order-v2-depth-first (human slice and 20_20 first): rejected by DEC-OWN-1; its open items are POL-03, POL-02 and ACT-01.
- EDIT-01 (per-tile Babylon.js Editor scenes with an Editor 5.5.3 round trip) and PRODUCT.md "Static environment stays editable in Babylon.js Editor": superseded by DEC-OWN-8; optional viewer work is VIEW-01.
- REQ-phase1-foundation: delivered (commit `3b16f1c3`); REQ-phase1-scope-boundary: history, partly superseded by PORT_SCOPE.
- REQ-work-order-v1-breadth-first: realised as the phase order in ROADMAP.md, not a separate requirement.

## Intel requirement to ID map

| Intel requirement | IDs |
|---|---|
| REQ-full-converted-client | DATA-01, WORLD-01, ACT-01..06, UI-02 |
| REQ-dat-tables-decoded | FOUND-04, DATA-01..03 |
| REQ-world-tiles-batch | WORLD-01, WORLD-03, WORLD-05 |
| REQ-player-characters | ACT-01 |
| REQ-npcs-items-skills-audio | ACT-02..06 |
| REQ-ui-windows-from-decoded-layout | UI-01, UI-02 |
| REQ-offline-sandbox | SAND-01, SAND-02, WORLD-05, CHECK-01 |
| REQ-client-displays-server-outcomes | ARCH-01, NET-05 |
| REQ-gameworldadapter-sole-entry | ARCH-02 |
| REQ-stage-b-mobius-adapter | NET-03, NET-04, NET-06, NET-07 |
| REQ-spacetimedb-fallback-adapter | NET-08 |
| REQ-relay-limits | NET-01, NET-02 |
| REQ-multi-agent-workflow | FOUND-01 |
| REQ-client-side-behaviors | ARCH-04 |
| REQ-modern-webgpu-rendering | WORLD-04, PERF-02 |
| REQ-original-audio-1to1 | WORLD-02, ACT-05, POL-02 |
| REQ-asset-structure-preserved | CONV-02 |
| REQ-native-route-no-stand-ins | ARCH-03 |
| REQ-editor-authoring-preserved | EDIT-02 (Editor part superseded by DEC-OWN-8; see VIEW-01) |
| DEC-OWN-8 (Editor off the build and runtime path) | NOED-01..05 |
| REQ-mobile-first-hud | UI-03 |
| REQ-parity-and-performance-acceptance | POL-01, PERF-01 |
| REQ-independent-system-scripts | CONV-01 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| ARCH-01 | Phase 1 | Complete |
| ARCH-02 | Phase 1 | Complete |
| ARCH-03 | Phase 1 | Complete |
| ARCH-04 | Phase 1 | Pending |
| SAND-01 | Phase 1 | Complete |
| NOED-01 | Phase 1 | In progress (later plans carry it) |
| NOED-02 | Phase 1 | Pending |
| NOED-03 | Phase 1 | Pending |
| NOED-04 | Phase 1 | Pending |
| NOED-05 | Phase 1 | Pending |
| SAND-02 | Phase 2 | Pending |
| DATA-01 | Phase 2 | Pending |
| DATA-02 | Phase 2 | Pending |
| DATA-03 | Phase 2 | Pending |
| UI-01 | Phase 2 | Pending |
| UI-02 | Phase 2 | Pending |
| UI-03 | Phase 2 | Pending |
| WORLD-01 | Phase 2 | Pending |
| WORLD-02 | Phase 2 | Pending |
| WORLD-03 | Phase 2 | Pending |
| WORLD-04 | Phase 2 | Pending |
| WORLD-05 | Phase 2 | Pending |
| WORLD-06 | Phase 2 | Pending |
| WORLD-07 | Phase 2 | Pending (provisional, owner review) |
| WORLD-08 | Phase 2 | Pending (provisional, owner review) |
| ACT-01 | Phase 2 | Pending |
| ACT-02 | Phase 2 | Pending |
| ACT-03 | Phase 2 | Pending |
| ACT-04 | Phase 2 | Pending |
| ACT-05 | Phase 2 | Pending |
| ACT-06 | Phase 2 | Pending |
| INT-01 | Phase 2 | Pending |
| CONV-01 | Phase 2 | Pending |
| CONV-02 | Phase 2 | Pending |
| CHECK-01 | Phase 3 | Pending |
| CHECK-02 | Phase 3 | Pending |
| CHECK-03 | Phase 3 | Pending |
| CHECK-04 | Phase 3 | Pending |
| CHECK-05 | Phase 3 | Pending |
| NET-01 | Phase 4 | Pending |
| NET-02 | Phase 4 | Pending |
| NET-03 | Phase 4 | Pending |
| NET-04 | Phase 4 | Pending |
| NET-05 | Phase 4 | Pending |
| NET-06 | Phase 4 | Pending |
| NET-07 | Phase 4 | Pending |
| NET-08 | Phase 4 | Pending |
| POL-01 | Phase 5 | Pending |
| POL-02 | Phase 5 | Pending |
| POL-03 | Phase 5 | Pending |
| POL-04 | Phase 5 | Pending |
| PERF-01 | Phase 6 | Pending |
| PERF-02 | Phase 6 | Pending |
| EDIT-02 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 58 total (WORLD-07 and WORLD-08 provisional, owner review)
- Mapped to phases: 58
- Unmapped: 0

---
*Requirements defined: 2026-11-08*
*Last updated: 2026-11-08 after DEC-OWN-8 (Editor off the build and runtime path)*
