# Requirements: l2-browser-client

**Defined:** 2026-11-08
**Core Value:** A fully converted Lineage II Interlude client that runs in the browser and matches L2.exe side by side, driven only by what a server sends.

Source intel: `.planning/intel/requirements.md`, `constraints.md`, `decisions.md` at commit `9c64e61` (removed from the tree on 2026-11-08). Locked owner decisions DEC-OWN-1..12 and DEC-PORT-1..3 override any conflicting variant. Stage A "passes" means the DEC-OWN-3 bar (converted, loads in the sandbox, side-by-side screenshot / listen check against L2.exe on IMPORTA-PC). Fixed thresholds apply only to POL and PERF requirements.

## v1 Requirements

### Foundations (Phase 1)

- [x] **FOUND-01**: Shared process files exist and are used: `STATUS.md` (one line per part, rewritten in place), append-only `DECISIONS.md` seeded with DEC-OWN/DEC-PORT, `.planning/lanes.json` folder ownership by lane (world, actors, data-ui, integration; each part belongs to one lane, integration owns `package.json`, the catalog writer, `src/runtime/**`, the native-store writers and the status files, and `scripts/check-lane-ownership.mjs` compares a branch diff with its lane), and `docs/parts/<part>/EVIDENCE.md` (under about 30 KB). Rules: one part per branch `<part>/<slug>`, at most 3 lanes, native-store scripts only in the main checkout, merge one branch at a time with contract changes first.
- [x] **FOUND-02**: Output contract written and testable: `.l2asset` + runtime catalog stay the contract; each `asset.json` records source path and SHA-256, client build, converter version, and units and handedness for its route; `recipes/native-inputs.lock.json` stays input-only; the client loads assets only through the catalog. Small hash-pinned golden fixtures let portable tests run without the private client.
- [x] **FOUND-03**: IMPORTA-PC `C:/Lineage2-client` is recorded as the reference for all L2.exe comparisons. A one-time full-tree hash lock (file count, bytes, per-file SHA-256; beyond the 143-file closure) proves `E:/Lineage2-client` equal before any stage A conversion reads from E:.
- [x] **FOUND-04**: Combined decoded-table inventory for all 40 `.dat` tables (table, route = local descriptor / Elbera / none, record count, status), written before more tables are decoded.

### Architecture invariants (Phase 1)

- [x] **ARCH-01**: The client never computes gameplay outcomes; it displays what a server sends. Tooltips read server-side stats, not the `.dat` display copies in `weapongrp`, `armorgrp`, `skillgrp`. Move requests and position reports sent the way L2.exe sends them (MOVE-02) are protocol inputs, not client-computed outcomes; the server decides (behaviour delivered under MOVE-02; the boundary rule is what is complete).
- [x] **ARCH-02**: `GameWorldAdapter` is the only way gameplay state enters the client; its five methods stay frozen (a contract test fails on change); adapters emit typed records with no Babylon types. Account login, the server list and character selection run before a world exists, through the typed pre-world `AccountSession` in `src/world` (lands with the D6 contract commit, 02-58), which yields the `GameWorldAdapter`. No gameplay state enters through it. New record types land in one integration contract commit before adapter code.
- [x] **ARCH-03**: The native route reports missing or failed resources visibly and never presents procedural stand-ins; the startup readiness barrier is kept. Inherited by every later phase.
- [x] **ARCH-04**: Client-owned behaviour stays in presentation: animation, camera, UI, choosing which footstep or hit sound plays, effect timing and particle emitter simulation (FX-01), moving pawns between server updates through the MoveActor and APawn port (MOVE-01), corrected by server positions, and advancing time-of-day lighting between server clock updates at the Env.int TimeRatio (MAT-02). Asset resolution and audio playback stay outside the adapter. The behaviours are delivered under FX-01, MOVE-01 and MAT-02; the boundary rule is what is complete.

### Editor off the build and runtime path (Phase 1, integration thread, before Phase 2 lanes start; DEC-OWN-8)

- [x] **NOED-01**: The native route boots without an Editor scene. `/` builds its scene (camera, lights, readiness barrier) in code and loads the world from the `.l2asset` catalog through `loadNativeSection`. The `native-parity.babylon` bootstrap goes away, and the settings now held as Editor inspector fields in `src/scripts/nativeParity.ts` (player profile, clips, material override) become typed config shown on the sandbox sheet. `?authored=1` stays optional and is reached only by a dynamic import.
- [x] **NOED-02**: `pnpm dev` and `pnpm build` no longer run `babylonjs-editor-cli pack`, `ensure-webgpu-project`, `validate-editor-materials`, `preserve-native-editor-uv2`, `preserve-native-editor-fog` or `share-native-terrain-export-materials`, and do not need the l2-editor-webgpu-compat plugin. These move to an optional `pnpm generate:editor`. `stage-webgpu-compilers` stays in dev and build, because `src/engine/createWebGPUEngine.ts` loads glslang and twgsl from `/vendor/babylon/9.27.1/` at runtime. A test fails if the default entry statically imports `babylonjs-editor-tools` or the generated `src/scripts.ts`.
- [x] **NOED-03**: The legacy courtyard demo (`assets/example.scene`) is retired (2026-11-08, DEC-OWN-11). A clean checkout's default view loads no Editor scene.
- [x] **NOED-04**: Babylon Inspector opens in the sandbox with `?inspect=1`, lazy-loaded by dynamic import and absent from the default bundle; `@babylonjs/inspector` is pinned to the same exact version as `@babylonjs/core`.
- [x] **NOED-05**: The Editor stays an optional viewer: `project.bjseditor` and `pnpm assets:editor` remain, and no test, build step, lane or phase gate depends on them. Revisit only if the SpacetimeDB route starts authoring new, non-L2 content.

### Sandbox

- [x] **SAND-01** (Phase 1): Offline sandbox shell with no server: spawn NPC by ID, equip item by ID, cast skill by ID, open window by ID, on `NativeSliceAdapter`. An ID without a converted asset shows an explicit missing-asset diagnostic.
- [x] **SAND-02** (Phase 2): Sandbox controls are a pinnable developer sheet with hover-cards showing variables (tile picker and walk, spawn, equip, cast, open window, audio mute/volume), not a cramped toggle list.

### Data lane L3 (Phase 2)

- [ ] **DATA-01**: All 40 `.dat` tables decoded to JSON once per client build; where the local hash-pinned descriptor (`06_interlude.xml`) covers a table it is authoritative; the inventory is updated per table.
- [x] **DATA-02**: Tables the local route lacks (`hairgrp`, `helmetgrp`, others) are decoded by Elbera code behind an adapter; Elbera verifiers pinned to Engine.dll `07b24af4...` are not used.
- [ ] **DATA-03**: The identical sysstring-e / systemmsg-e count (2,083) is investigated and fixed or explained.

### UI lane L3 (Phase 2)

- [x] **UI-01**: `interface.xdat` (lock-equal, SHA-256 `b5b37678...1b641`; 165 declared windows, 248 root records and 2,638 records decoded by the pinned Elbera parser) is decoded to a layout tree with a source-hash pin.
- [x] **UI-02**: Windows are built from the decoded layout and filled with sandbox data; no hardcoded control names (this client uses `StatusLeftTex`, `CPBarTex`, `HPBarTex`, `MPBarTex`); each window opens by ID in the sandbox.
- [x] **UI-03**: Only the original Interlude interface: window layout from `interface.xdat`, and skin, fonts and icons from the client's converted UI textures. No custom HUD styling (DEC-OWN-10).

### World lane L1 (Phase 2)

- [ ] **WORLD-01**: All 153 tiles (`XX_YY` grid) converted by tile-general converter steps: terrain, static meshes and BSP with the tile-general UV rule, and placed Emitter actors (played through FX-01). Each 20_20 hand step (nine-sector terrain selection, TerrainSector247, model append, Brush397 BSP slab, Brush610 command-hall BSP) becomes a tile-general step.
- [ ] **WORLD-02**: Sky, ambient (PointRegion) and placement audio converted for all 153 tiles through recipes and scripts, original audio bytes preserved.
- [ ] **WORLD-03**: A coverage manifest records pass or gap per tile per step; failing tiles are listed as gaps and never hand-fixed. The 10 non-tile maps (`Lobby`, `entry`, `skylevel`, `ship_position`, `Auto0` to `Auto5`) are classified; `Lobby` status is known before Phase 4.
- [ ] **WORLD-04**: One persistent runtime scene with bounded cells: baseline measured first, then residency cache and terrain/mesh LOD with traceable derivatives; reveal readiness and nearby collision preserved; visual LOD never redefines collision.
- [ ] **WORLD-05**: The sandbox can walk any converted tile with its terrain, BSP, static mesh and volume collision through the MOVE-01 port.
- [ ] **WORLD-06**: Minimap and world map from `MinimapCtrl`, `zonename`, `huntingzone`.
- [ ] **WORLD-07** (provisional, owner review): The unreviewed 74-file post-migration terrain packet (`artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/post-migration-visibility-20261106`, manifest fileCount 74) gets the independent review that never ran, by a reviewer that did not write it, after its manifest hashes are re-verified. Each finding gets one verdict (adopted, rejected or polish) recorded in `docs/parts/world/EVIDENCE.md`. Adopted findings become tile-general converter or runtime steps with tests: the layer-sequence fixtures and `DISCRIMINATING_CASES.json` test terrain layer ordering (no pruning rule and no `bUseAlpha` behaviour inferred), and the MusicVolume to `musicinfo` join becomes the per-tile music step of WORLD-02. Y>240 visibility, `bUseAlpha` and alpha-test precision stay open under POL-01. No native launch or capture.
- [ ] **WORLD-08** (provisional, owner review): Static meshes and BSP of every converted tile carry collision taken from source declarations only: for static meshes the actor collision flags (`bCollideActors`, `bBlockActors`, `bBlockPlayers`, resolved through class defaults), material-slot `EnableCollision` and the mesh's serialized collision data; for BSP the Level.Model collision tree as stored (node planes, children, NodeFlags, NumVertices, iCollisionBound with LeafHulls, bRootOutside), PolyFlags kept for diagnostics only; BlockingVolumes and PhysicsVolumes with their full transform; terrain from the TerrainInfo heightmap, QuadVisibilityBitmap and EdgeTurnBitmap. An object whose collision cannot be read is a per-object gap in the coverage manifest; nothing is inferred from appearance or names. Collision is produced by converters into the native-tile-collision resource, kept apart from visual LOD (WORLD-04), and feeds the client's own MoveActor and APawn port (MOVE-01). It is not geodata (GEO-01) and never movement authority (MOVE-02).
- [ ] **MAT-02** (provisional, owner review): Tile converters export the lighting data that materials need into a per-tile `lighting` `.l2asset`: BSP multi-lightmaps with lightmap UVs, L2FogInfo actors, Light actors, LevelInfo brightness, StaticMeshActor light lists with visibility bits, and terrain sector shadow maps and light bits. ZoneInfo ambient and distance fog come from the shared zone table, and water volumes from the movement volume export. The environment program types Env.int and timeenv0..3 for all four environment types. Each frame the runtime applies lightmaps by hour, vertex lighting, terrain layer blending, Modulate2X and fog. The adapter `environment` event drives the game clock, or the environment program StartTime when no server time exists.
- [x] **VIS-01** (provisional, owner review): Each converted tile carries a hash-pinned BSP visibility resource (`.l2asset` with `asset.json`) read from its final ULevel.Model: node planes and links, subtree zone masks, leaves with zone and PVS masks, zones with connectivity and outdoor or sky class, portal nodes, render bounds, node-to-primitive index ranges, and the leaf and zone membership of static mesh and map emitter placements. BSP sections split by material, PF_Unlit, lightmap texture and outdoor class. Our own Babylon-free walk computes, per frame, the camera zone, the visible zones, BSP sections and placements, and the back-to-front order of translucent BSP surfaces; Babylon only draws the result. The binding changes render visibility only, so collision and navigation do not change, and picking changes only where a ray hits geometry that is not drawn. Reference rules run as unconfirmed defaults, and a limit with no Interlude source runs at its most-visible value until POL-04 re-derives it. Translucent order is on; zone and portal culling stays off by default until PERF-02 measures it. A tile whose model or resource cannot be read is a visible per-tile gap that draws everything.
- [ ] **MOVE-01** (provisional, owner review): Part movement-geodata. Pawns move by our own port of the UE2 and L2 native movement rules over converted collision: ULevel::MoveActor with its 2-unit test extension and per-primitive backoff; SingleLineCheck and PointCheck over BSP trees, brush volumes, static mesh collision, terrain heightmaps and pawn cylinders; APawn walking with the floor probe and floor gap band; stepUp with wall slide and twoWallAdjust; falling, swimming and flying; calcVelocity with no acceleration ramp; GetCurSpeed with the MoveTimer run start; fixed-rate yaw turning. The follow camera ports CalcBehindView with its hit check, and click-to-move uses a zero-extent trace through the same collision world. The core runs in source units and imports no Babylon code, no package and nothing outside `src/shared`. Phase 2 runs reference values as unconfirmed defaults, and each numeric rule is re-derived against Interlude Engine.dll `4dd2f63c...` under POL-04 before it counts as native. A pawn whose surrounding collision has not loaded is held and reported (ARCH-03).

### Actors lane L2 (Phase 2)

- [ ] **ACT-01**: All player characters from `chargrp`, every race, gender and class (row count derived from the decoded table, 15 rows on this client). Missing hair/helmet layouts are explicit gaps; no guessed hair selection.
- [ ] **ACT-02**: NPCs and monsters from `npcgrp` (6,519 rows, about 554 meshes), spawnable by NPC ID; a mesh name alone never selects a profile (`field_stalker_m00` occurs in 22 rows).
- [ ] **ACT-03**: Items and equipment (about 390 weapon and 1,355 armor meshes; 9,238 items) equip by item ID on any character with sockets and attachments preserved.
- [x] **ACT-04**: Animation clips with original names, timing and notification events travel with each actor bundle; the sandbox plays any clip.
- [ ] **ACT-05**: Sounds bound per actor, animation, skill and enemy bundle (voices, combat, skill, music) with exact source identities; unresolved events stay "unresolved", never invented. Native surface/footstep rules are POL-02.
- [ ] **ACT-06**: Skill visuals and effects (about 2,700 skills, 864 effect classes, 3,709 emitters) bound through `skillgrp`, `skillsoundgrp`, `npcgrp`; cast by skill ID and level. Emitter simulation is our own port of the UE2 emitter classes (FX-01), deterministic under a declared seed (`docs/NATIVE_PARITY.md:11`). An effect is a gap only while its emitter class, an emitter feature or an L2-specific effect handler is unported, with reason `emitter-class-unported:<class>` or `emitter-feature-unported:<property>`.
- [ ] **FX-01** (provisional, owner review): Emitter simulation is our own deterministic, seedable port of the UE2 emitter classes in plain TypeScript, with no Babylon types and no third-party runtime dependency. It runs Interlude SpriteEmitter, MeshEmitter and RibbonEmitter records with the Interlude class defaults, the Emitter actor rules (GlobalOffset, initial delay, warmup, AutoReset, AutoDestroy, SpeedRate, bRotEmitter) and the L2 emitter natives that skills call (AdjustparticleLife, SetSizeScale, SetDelayed, Kill, Trigger). Golden traces at a declared seed and step pin synthetic emitter fixtures, and hash-only traces pin the Power Strike emitters when the client is given. BeamEmitter, VertMeshEmitter, SparkEmitter, TrailEmitter and unported features (collision, actor forces, mesh and skeletal spawning, weather, PTRS_Normal, PTCS_RelativeRotation) are explicit gaps with reason `emitter-class-unported:<class>` or `emitter-feature-unported:<property>` until ported. Every rule has a constants row. Phase 2 runs reference rules as unconfirmed defaults, and POL-04 re-derives them statically against Interlude Engine.dll, Core.dll or D3DDrv.dll.

### Integration and conversion rules (Phase 2)

- [ ] **INT-01**: The integration lane stages lane output in the main checkout and publishes one coverage report from the catalog (per part: converted, loads, gap); the sandbox marks IDs as available or gap.
- [ ] **CONV-01**: Conversion is independent per-system scripts sharing readers and packaging helpers; one character, skill or tile converts without running all extraction; `assets:pipeline` stays optional.
- [ ] **CONV-02**: Source-preserving conversion: UModel build1590 pinned (SHA-256 `13502e5a...364a0`); no 1.8 m normalization, ground fitting, root-drift removal or weight normalization; unbound material slots become a visible magenta diagnostic; repairs only for a demonstrated defect; `.l2asset` limits respected. Material graphs are preserved, never flattened; a typed program derived next to the raw graph records which values are authored and which are class defaults.
- [ ] **MAT-01** (provisional, owner review): Native materials render through one UE2 material library. The converter keeps each material graph source-preserving (`native-materials/graph.json`) for any root owner: static mesh slot, BSP surface, terrain layer, skeletal slot, emitter or sky surface. Beside it the converter writes a typed `native-materials/program.json` that records per field whether the value is authored, a class default or a UE zero. Every class in the Interlude material census is either reviewed or recorded with gap reason `material-class-unported:<class>`, which renders as a named magenta diagnostic. The runtime evaluates Shader, Combiner with all colour and alpha operations, FinalBlend (FB_Add once its factors are confirmed), ColorModifier, FadeColor, ConstantColor, TexPanner, TexRotator, TexOscillator, TexScaler, TexEnvMap, TexCoordSource, MaterialSequence and AnimNext textures. Triggered modifiers stay unported until a typed server record supplies the trigger. Colour stays in the byte domain with no sRGB step, and the L2 fog targets and the display gamma ramp apply. `src/materials/ue2/model/**` imports no Babylon code and nothing outside itself except `src/shared/**`. A swatch route renders any material id at a given level time, hour and environment type.

### Stage A checks (Phase 3)

- [ ] **CHECK-01**: For world, characters/NPCs/items, skills and UI, paired screenshots (sandbox vs L2.exe on IMPORTA-PC at the same location or ID) are captured per part.
- [ ] **CHECK-02**: Audio (world, actor, skill) gets a listen check against L2.exe with labelled audible results; extraction or decoding alone is not a pass.
- [ ] **CHECK-03**: Each part's verdict (pass, mismatch, unverified) is recorded in `docs/parts/<part>/EVIDENCE.md`; missing or uncertain evidence is unverified, never a pass.
- [ ] **CHECK-04**: Defects found are fixed in the shared converter step and re-run, never hand-patched per tile; unfixable ones join the gap list.
- [ ] **CHECK-05**: A stage A exit report states per part converted, loads, checked, and pass / mismatch / unverified / gap counts, referencing the IMPORTA-PC hash lock.

### Stage B adapter (Phase 4)

- [ ] **NET-01**: Transport decision recorded first (recommendation: dumb relay). The browser runs L2 crypto and packet code in TypeScript inside the Mobius adapter; the relay forwards bytes between one WebSocket and one TCP connection and connects only to the configured Mobius ports (2106, 7777). The relay never alters, reorders or injects bytes. The game route comes from relay configuration, never from the IP or port in ServerList. The relay is our own RFC 6455 server on node:http, node:net and node:crypto, with no WebSocket package.
- [ ] **NET-02**: The relay keeps per-address connection caps and login-failure blocks, and logs which account came from which address. It reads, never modifies, the login stream (Init key exchange, then LoginFail and LoginOk) and the game AuthLogin account name with the shared `src/net` code. The first failures from an address still reach Mobius, and the relay blocks the later ones. Mobius counts LoginTryBeforeBan against the relay address with no decay, so its login config raises that threshold far above the relay limit, and each capture's provenance records the config. Mobius flood protection guards only the game-server registration port, so it does not limit players.
- [ ] **NET-03**: Authentication, character selection and entry into a stock Mobius world work from the browser; synthetic demos and placeholder login screens do not count. Login and game crypto and framing are our own (NET-09). Elbera `gateway/` and Lineage2JS `src/network` are read-only behaviour references, and crypto is verified against stock Mobius captures replayed through the harness.
- [ ] **NET-04**: Server packets decode into typed records and map to `GameWorldAdapter` events one packet type at a time. `WorldEntity` positions stay metres through `src/world/sourceFrame.ts`. Movement events and the report-position and cannot-move intents carry source units, wire integers inbound and float32 Location outbound, so truncation and rounding match L2.exe. Committed fixtures are synthetic, or indices and hashes only. Cases that need real Mobius captures read them at test time and skip with a reason when they are absent. Replay through the real adapter reproduces the golden event sequence and the recorded client packets outside listed masks. Real-adapter duties: snapshot and subscription ordering, seconds, explicit teleports, and unsupported sandbox intents rejected or disabled.
- [ ] **NET-05**: Combat and stats display from `Attack`, `StatusUpdate`, `UserInfo`, `MagicSkillUse`; the client shows server-resolved damage, flags, HP/MP and casts without computing them.
- [ ] **NET-06**: NPC dialogs and shop windows (buy, sell, multisell) show server data in the Phase 2 windows.
- [ ] **NET-07**: Social (party, clan, chat, friends) and quest/tutorial windows show server data.
- [ ] **NET-08**: Conditional: if Mobius does not fit the gameplay loop, a SpacetimeDB adapter emits the same adapter events from table subscriptions, seeded from the Mobius datapack XML export.
- [ ] **NET-09** (provisional, owner review): `src/net` holds framing, the packet reader and writer, login and game crypto, the Interlude opcode tables, packet decoders and builders, and the capture and replay channel as plain TypeScript that imports nothing outside itself: no packages, no Babylon, and no DOM outside `src/net/transport/webSocketTransport.ts`. Only `src/world/mobius/**`, `src/runtime/**` (transport and clock construction), `tools/net-relay/**` and tests import it. `tools/reference-overlap/` finds no shared run of 20 or more normalised tokens outside the constant allowlist, and a reviewer who did not write the code signs off every run of 12 or more.
- [ ] **NET-10** (provisional, owner review): The relay has a TCP tee mode, so the original L2.exe can be captured against the same Mobius build. These captures are the truth for client packet layouts (ProtocolVersion value, EnterWorld, GameGuardReply, RequestAuthLogin length), for whether L2.exe obeys the KeyPacket encryption flag, and for movement report rounding and cadence (MOVE-02). Raw captures stay out of commits.
- [ ] **MOVE-02** (provisional, owner review): Integration lane, part adapter-dispatch; the reporter and record application are world-lane code. The client exchanges movement with the server the way L2.exe does. A click sends MoveToLocation 0x01 (Lineage2JS MoveBackwardToLocation) with target, origin and the move mode, and the local pawn moves only on the server's CharMoveToLocation or MoveToPawn. While the pawn moves, and once after it stops, the client sends ValidatePosition at the native cadence. A pawn that stops making progress stops locally and sends CannotMoveAnymore. StopMove, ValidateLocation and TeleportToLocation correct local and remote pawns with the native thresholds. Opcodes, cadence, thresholds and coordinate rounding are confirmed against L2.exe captures on Mobius before they are called native.

### Native-parity polish (Phase 5)

- [ ] **POL-01**: The four fixed visual cases pass the thresholds in `recipes/native-parity.acceptance.json` (Human male fighter equipment/animation, Greater Musveren including death, Power Strike skill 3 with coordinated motion/effect, a declared section of `20_20.unr`). Each result records the file's SHA-256; thresholds are never relaxed. The native reference capture first meets the fixed reference cadence (currently 4.1 FPS, fails). Particles are compared with the `visual.particles` and `reference` blocks of `recipes/native-parity.acceptance.json`: at least five independent native repetitions against declared browser seeds.
- [ ] **POL-02**: Audio parity per `recipes/native-audio.acceptance.json`: tolerances and one alignment method defined before comparison; surface- and equipment-aware footsteps from the ALAudio.dll rules; specialized attack sounds; matched native/browser recordings retained.
- [ ] **POL-03**: Human traversal on 20_20 matches L2.exe for the same clicks, for male and female: stair turns are walked by the MOVE-01 stepUp and wall slide, server routes are followed, and the upper-landing camera is pulled in front of the roof by the CalcBehindView hit check. The client adds no routing of its own.
- [ ] **POL-04**: Stage A gap list burned down: each gap (tiles, hair/helmet, unported emitter classes and features) is converted or stays listed with a stated reason. Before a value counts as native, every constant or reference rule that MAT-01, MAT-02, VIS-01, MOVE-01, MOVE-02 or FX-01 runs as unconfirmed or unknown is re-derived statically against Interlude Engine.dll `4dd2f63c...`, Core.dll `9462f87a...` or D3DDrv.dll `05622dde...`, or against Mobius captures, and recorded with its interludeEvidence; each stays listed with a reason until it is confirmed-interlude or corrected-interlude. Binaries are read, never run.

### Performance and build reproducibility (Phase 6)

- [ ] **PERF-01**: GTX 1060 on DATABASE-PC, 1920 x 1080, DPR 1, 32 actors and eight Power Strike effects every 2 s, three trials (15 s warmup, 90 s measure): sustained 120 FPS (1000/120 ms) on an active display of at least 120 Hz. Without such a display, report separately labelled workload timings and the presentation limit, no estimated pass.
- [ ] **PERF-02**: Instancing, GPU texture compression and culling applied in measured order, each with before/after numbers on the same workload and regression checks on the native catalog route (startup, movement, cleanup). BSP zone and portal culling (VIS-01) becomes the default only after this measurement shows a gain with no startup, movement or cleanup regression.
- [ ] **EDIT-02**: One documented command covers inventory, conversion, validation and benchmark; a clean repeat build reproduces matching outputs with conversion cache hits.

## v2 Requirements (deferred)

- **GEO-01**: Real geodata-backed movement display (PORT_SCOPE part 11); no geodata files exist on DATABASE-PC and geodata is server data. Revisit when the adapter needs it. Client collision (WORLD-08) and the pawn port (MOVE-01) are not geodata and do not depend on it.
- **VIEW-01**: Optional viewer work only, not a gate (DEC-OWN-8): open converted tiles in Babylon.js Editor through `pnpm generate:editor` / `pnpm assets:editor`. Replaces the former EDIT-01 per-tile Editor scenes requirement.
- **LATE-01**: Windows for sieges, Olympiad, bosses, Seven Signs, GM tools and boats (PORT_SCOPE part 19, layer 4); not in the stage B list.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Production deployment | Excluded in every source |
| Client-side gameplay math, quests logic, progression, gacha | DEC-PORT-3: client displays server outcomes |
| Publishing converted Lineage II binaries or audio | Stay untracked and local |
| Copying source or assets from other workspaces or unlicensed projects | No redistribution licence |
| Elbera three.js runtime, pinned verifiers, smart JSON gateway | DEC-PORT-6 / DEC-PORT-4 |
| Legacy Direct3D internals for their own sake. UE2 material, blend and distance-fog math is required behaviour (MAT-01); D3D state caching, device caps and driver workarounds are not. | DEC-ARCH-1 |

## Superseded

- REQ-work-order-v2-depth-first (human slice and 20_20 first): rejected by DEC-OWN-1; its open items are POL-03, POL-02 and ACT-01.
- EDIT-01 (per-tile Babylon.js Editor scenes with an Editor 5.5.3 round trip) and PRODUCT.md "Static environment stays editable in Babylon.js Editor": superseded by DEC-OWN-8; optional viewer work is VIEW-01.
- REQ-phase1-foundation: delivered (commit `3b16f1c3`); REQ-phase1-scope-boundary: history, partly superseded by PORT_SCOPE.
- REQ-work-order-v1-breadth-first: realised as the phase order in ROADMAP.md, not a separate requirement.

## Intel requirement to ID map

| Intel requirement | IDs |
|---|---|
| REQ-full-converted-client | DATA-01, WORLD-01, ACT-01..06, FX-01, UI-02 |
| REQ-dat-tables-decoded | FOUND-04, DATA-01..03 |
| REQ-world-tiles-batch | WORLD-01, WORLD-03, WORLD-05 |
| REQ-player-characters | ACT-01 |
| REQ-npcs-items-skills-audio | ACT-02..06, FX-01 |
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
| DEC-OWN-12 (own implementations of five areas, Lineage2JS as reference) | MAT-01, MAT-02, VIS-01, MOVE-01, MOVE-02, FX-01, NET-09, NET-10 |
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
| ARCH-04 | Phase 1 | Complete |
| SAND-01 | Phase 1 | Complete |
| NOED-01 | Phase 1 | Complete |
| NOED-02 | Phase 1 | Complete |
| NOED-03 | Phase 1 | Complete |
| NOED-04 | Phase 1 | Complete |
| NOED-05 | Phase 1 | Complete |
| SAND-02 | Phase 2 | Complete |
| DATA-01 | Phase 2 | Pending |
| DATA-02 | Phase 2 | Complete |
| DATA-03 | Phase 2 | Pending |
| UI-01 | Phase 2 | Complete |
| UI-02 | Phase 2 | Complete |
| UI-03 | Phase 2 | Complete |
| WORLD-01 | Phase 2 | Pending |
| WORLD-02 | Phase 2 | Pending |
| WORLD-03 | Phase 2 | Pending |
| WORLD-04 | Phase 2 | Pending |
| WORLD-05 | Phase 2 | Pending |
| WORLD-06 | Phase 2 | Pending |
| WORLD-07 | Phase 2 | Pending (provisional, owner review) |
| WORLD-08 | Phase 2 | Pending (provisional, owner review) |
| MAT-02 | Phase 2 | Pending (provisional, owner review) |
| VIS-01 | Phase 2 | Complete (provisional, owner review) |
| MOVE-01 | Phase 2 | Pending (provisional, owner review) |
| ACT-01 | Phase 2 | Pending |
| ACT-02 | Phase 2 | Pending |
| ACT-03 | Phase 2 | Pending |
| ACT-04 | Phase 2 | Complete |
| ACT-05 | Phase 2 | Pending |
| ACT-06 | Phase 2 | Pending |
| FX-01 | Phase 2 | Pending (provisional, owner review) |
| INT-01 | Phase 2 | Pending |
| CONV-01 | Phase 2 | Pending |
| CONV-02 | Phase 2 | Pending |
| MAT-01 | Phase 2 | Pending (provisional, owner review) |
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
| NET-09 | Phase 4 | Pending (provisional, owner review) |
| NET-10 | Phase 4 | Pending (provisional, owner review) |
| MOVE-02 | Phase 4 | Pending (provisional, owner review) |
| POL-01 | Phase 5 | Pending |
| POL-02 | Phase 5 | Pending |
| POL-03 | Phase 5 | Pending |
| POL-04 | Phase 5 | Pending |
| PERF-01 | Phase 6 | Pending |
| PERF-02 | Phase 6 | Pending |
| EDIT-02 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 66 total (WORLD-07, WORLD-08, MAT-01, MAT-02, VIS-01, MOVE-01, MOVE-02, FX-01, NET-09 and NET-10 provisional, owner review)
- Mapped to phases: 66
- Unmapped: 0

---
*Requirements defined: 2026-11-08*
*Last updated: 2026-11-08 after DEC-OWN-12 (own implementations of five areas, Lineage2JS as reference)*
