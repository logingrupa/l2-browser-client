# Decisions

No document in this ingest set is an ADR. Classification `locked` is false for all 17 documents, so nothing below is ADR-locked. The first three entries are the owner decisions of 2026-11-07 recorded at the top of docs/PORT_SCOPE.md (PRD, precedence 1). They are marked `proposed` only because the classification carries `locked: false` and no ADR status field exists. They are owner-declared and are not contradicted by any higher-precedence source. The roadmapper should treat them as owner-authoritative and may promote them to locked at the conflict gate.

Current lock state: DEC-PORT-1..3 and the DEC-OWN-1..8 block below are locked by owner decision at the conflict gate (2026-11-08); the other entries stay proposed. Source citations quote the docs as of the ingest on 2026-11-08: docs/ROADMAP.md content is in .planning/ROADMAP.md and .planning/STATE.md, docs/ASSET_BATCHING.md is in docs/ASSET_PIPELINE.md, and Editor docs are in docs/EDITOR_VIEWER.md.

## DEC-PORT-1: First goal is a working browser client with every client asset converted
- source: docs/PORT_SCOPE.md, section "Owner decisions, 2026-11-07", item 1 (precedence 1)
- status: proposed (owner decision 2026-11-07; classification locked=false, not an ADR)
- decision: "First goal: a working browser client with every client asset converted. That means the world, characters, NPCs, items, `.dat` data, skill visuals, sounds and UI."
- scope: overall project goal and ordering (full converted client before server adapter). Operationalised in docs/PORT_SCOPE.md section 6 as stage A (convert everything, prove in offline sandbox) then stage B (plug in a server). Breadth-first order is the work order (DEC-OWN-1); REQ-work-order-v2 depth-first is rejected.

## DEC-PORT-2: The server is replaceable; stock L2J Mobius first, SpacetimeDB possible
- source: docs/PORT_SCOPE.md, section "Owner decisions, 2026-11-07", item 2 (precedence 1)
- status: proposed (owner decision 2026-11-07; classification locked=false, not an ADR)
- decision: "The server is replaceable. Stock L2J Mobius is the first target. If it does not work out, the game moves to SpacetimeDB with the L2 client and the L2 world but a different gameplay loop."
- scope: server target and adapter strategy. Section 1 consequence: "Changing servers means writing a second adapter." A Mobius adapter turns packets into adapter events; a SpacetimeDB adapter turns table subscriptions into the same events. Section 6 stage B item 3: Mobius "stays useful as the reference for which events exist, their order and their timing."

## DEC-PORT-3: The client never computes gameplay outcomes; it displays what a server sends
- source: docs/PORT_SCOPE.md, section "Owner decisions, 2026-11-07", item 3 (precedence 1)
- status: proposed (owner decision 2026-11-07; classification locked=false, not an ADR)
- decision: "Because of 2, the client never computes gameplay outcomes. It displays what a server sends."
- scope: client/server responsibility split. Gameplay state enters the client only through `GameWorldAdapter` (docs/PORT_SCOPE.md section 1). Tooltips must read stats from the server side, not from the `.dat` display copies in `weapongrp`, `armorgrp`, `skillgrp`. Behaviour that stays in the client whatever the server: animation, camera, UI, choosing which footstep or hit sound plays, effect timing, smoothing movement between server updates.

## DEC-PORT-4: Transport for a Mobius adapter is a dumb WebSocket relay (recommendation, not yet decided)
- source: docs/PORT_SCOPE.md, section 6 "Transport for a Mobius adapter" (precedence 1)
- status: proposed
- decision: "The recommendation (not yet decided) is a dumb relay: the browser runs the L2 crypto and packet code in TypeScript inside the Mobius adapter, and the relay only forwards bytes between one WebSocket and one TCP connection." A smart gateway that translates packets to JSON (as Elbera does) is rejected in the source because it "doubles the work for every packet type and is thrown away if the server becomes SpacetimeDB."
- scope: stage B networking. Relay must keep its own per-player limits and login-failure bans, log which account came from which address, and only connect to the configured Mobius ports. Aligns with docs/ROADMAP.md Phase 2 text "Decide transport, protocol, and test-environment details when that phase is explicitly started."

## DEC-PORT-5: Native-parity detail research goes to a polish list until stage A is complete
- source: docs/PORT_SCOPE.md, section 6, closing paragraph (precedence 1)
- status: proposed
- decision: "Native-parity research on one detail at a time goes to a polish list, for example the footstep rules recovered from ALAudio.dll. It comes back once stage A has every tile and character in the sandbox."
- scope: sequencing of fidelity research versus breadth conversion. Audio is converted and bound per bundle in stage A; native-rule audio research waits for polish (DEC-OWN-3).

## DEC-PORT-6: Elbera is a source of reusable decoders and conversion code; leave its pinned verifiers and three.js runtime behind
- source: docs/PORT_SCOPE.md, section 9 (precedence 1); corroborated by docs/LINEAGE2ELBERA_REUSE_AUDIT.md "Decision" (DOC, no precedence)
- status: proposed
- decision: Stage A takes, ranked: (1) decoders with no build pins (`tools/l2lib`, `tools/dat/*.py`, `tools/xdat/parse_xdat.py`, `tools/dat/export_quests.py`); (2) world conversion (`tools/world/convert.py`, `bsp.py`, `lightmap.py`, `bsplight.py`); (3) renderer-free modules (`geodata.js`, `terrain-collision.js`, `cylinder-collision.js`, `moveactor-arithmetic.js`, `nativecoords.js`). Stage B takes gateway crypto/framing, packet decoders behind a `GatewayWorldAdapter`, and offline protocol tests, with an audit of `gateway/` and `editor/` first. Leave behind: Elbera native verifiers pinned to Engine.dll `07b24af4...` (this client is `4dd2f63c...`), `deploy/server-mods/elbera-acis.patch`, deviceId auto login, the three.js runtime, and UI code that hardcodes control names.
- scope: code reuse. docs/LINEAGE2ELBERA_REUSE_AUDIT.md "Decision": "Use Lineage2Elbera as a source of reusable implementations, fixtures and format knowledge before writing another decoder." Both sources agree on direction. Decoder-route priority is set by DEC-OWN-4: local descriptor first, Elbera fills gaps behind an adapter.

## DEC-SRC-1: Published foundation contains no copied linegen source or assets
- source: docs/SOURCE_REUSE.md, "Foundation source-review outcome" (DOC, no precedence)
- status: proposed
- decision: "No redistribution license was found for `linegen`." "The published procedural foundation contains no copied `linegen` source, models, textures, animation clips or source manifests." Replacements "must not be described as licensed source adaptations or a clean-room implementation."
- scope: Phase 1 foundation provenance only. The same document states the local world integration is a separate provenance case and "no additional redistribution grant is asserted." Converted binaries and captures stay untracked and local (also PRODUCT.md, "Capabilities and constraints").

## DEC-SRC-2: IMPORTA-PC `C:/Lineage2-client` is the authoritative native reference
- source: README.md "Convert new assets from the native client"; docs/SOURCE_REUSE.md "Authoritative fleet snapshot - 2026-11-05"; docs/NATIVE_AUDIO.md "Required coverage" (DOC and SPEC, mixed). Same position stated in docs/NATIVE_PARITY.md ("The authoritative reference is IMPORTA-PC's `C:/Lineage2-client`") and docs/NATIVE_CLIENT_AUDIT.md ("the current authority is IMPORTA-PC's `C:/Lineage2-client`").
- status: proposed
- decision: README.md: "IMPORTA-PC's `C:/Lineage2-client` is the authoritative native reference. ... `E:/Lineage2-client` is a reusable local copy only after fresh source-hash equality." docs/NATIVE_AUDIO.md: "Use the current hash-identified Interlude client on IMPORTA-PC."
- scope: source of truth for conversion and parity comparison. docs/SOURCE_REUSE.md also records an earlier 2026-11-04 statement that "The user selected `E:/Lineage2-client` as the source of truth for new assets", superseded by the 2026-11-05 snapshot. DEC-OWN-2 keeps IMPORTA-PC as the reference; `E:\Lineage2-client` (where docs/PORT_SCOPE.md measured) is a conversion source only after the full-tree hash lock.

## DEC-ARCH-1: Rendering policy is modern Babylon.js WebGPU preserving the game, not Direct3D internals
- source: docs/ARCHITECTURE.md "Rendering policy - 2026-11-07"; PRODUCT.md "Rendering direction - 2026-11-07" (precedence 0)
- status: proposed
- decision: PRODUCT.md: "Use modern Babylon.js WebGPU rendering, preserving Lineage II's visual identity, source asset relationships and gameplay behavior. Reproduce old Direct3D details only when they explain a meaningful visible difference or required behavior." docs/ARCHITECTURE.md: "Legacy Direct3D implementation details are evidence for specific fidelity problems, not an architectural requirement."
- scope: renderer. PRODUCT.md: "Existing fidelity and hardware acceptance thresholds remain unchanged."

## DEC-ARCH-2: Gameplay-adjacent playback and asset interpretation stay outside GameWorldAdapter
- source: docs/ARCHITECTURE.md "Audio ownership" and "Entity and asset ownership"; PRODUCT.md "Capabilities and constraints"
- status: proposed
- decision: "Keep asset and playback interpretation outside `GameWorldAdapter` and preserve terrain work." "Keep asset resolution separate from the world adapter and future networking." The adapter carries lifecycle, semantic state and `appearanceId` / `animationSequence`; native asset names and file-format handling stay in presentation.
- scope: adapter boundary. Compatible with DEC-PORT-3.

## DEC-PARITY-1: The native parity acceptance thresholds are fixed and are never relaxed to fit a result
- source: docs/NATIVE_PARITY.md, "Fixed acceptance contract" (SPEC, precedence 4); echoed in docs/NATIVE_AUDIO.md "Evidence required to pass" and docs/RENDERING.md "Acceptance boundaries"
- status: proposed
- decision: "Every result must record this file's SHA-256. Do not relax its thresholds in response to a failure. Missing or uncertain evidence is **unverified**, never a pass." For audio: "Define timing/amplitude/spatial tolerances and a single measured alignment method **before** parity implementation/comparison; do not tune thresholds to a result."
- scope: visual, performance and audio acceptance. Fixed thresholds apply to the polish stage (Phases 5 and 6); stage A uses the lighter per-part check (DEC-OWN-3).

## DEC-PARITY-2: Rendering optimization proceeds now on the supported slice; whole-client parity is not a prerequisite
- source: docs/NATIVE_PARITY.md "Rendering direction clarification - 2026-11-07"; docs/RENDERING.md; PRODUCT.md "Rendering direction - 2026-11-07" (precedence 0)
- status: proposed
- decision: "Begin profiling and bounded optimization on the currently supported slice while remaining migration and native-reference work continues. Keep source assets and authored work intact; optimized LOD/texture derivatives must be traceable and must pass the applicable fidelity checks. Development baselines with partial content do not replace the complete performance workload below."
- scope: rendering and performance work sequencing. Measure first, then instancing, chunk streaming, LOD, GPU texture compression, culling (constraints.md "Rendering implementation sequence").

## DEC-PIPE-1: Small independent per-system conversion scripts; the orchestrator stays optional
- source: docs/ASSET_PIPELINE.md opening (SPEC, 5); docs/ASSET_BATCHING.md "Architecture" (DOC); docs/ROADMAP.md (DOC, 8)
- status: proposed
- decision: "Use independently runnable small scripts per game system, sharing format readers and packaging helpers. ... Existing `assets:pipeline` batching is optional; it is not a prerequisite for the dedicated commands below or a new monolithic tool." Audio payloads and events belong to each actor/skill/enemy bundle (ROADMAP.md).
- scope: converter architecture. GLB carries models, rigs and supported animations; it "cannot carry all native particle behavior, animation notification logic, skill dispatch, surface sounds or map streaming rules; those require sidecars and browser implementations" (ASSET_BATCHING.md).

## DEC-PIPE-2: Source-preserving conversion with pinned tools and no fitting
- source: docs/ASSET_PIPELINE.md "Scale, geometry, and animation" and "Package contract and reproducibility" (SPEC, 5); PRODUCT.md "Capabilities and constraints" (precedence 0)
- status: proposed
- decision: Converter is pinned to UModel build1590 (SHA-256 `13502e5a...364a0`) and rejects other exporter hashes; "There is no 1.8m normalization, ground fitting, horizontal root-drift removal, or animation root replacement"; "**No source-weight normalization is applied**"; unbound material slots become a visible magenta diagnostic, never a guessed texture; conversion repairs require a demonstrated defect or lost source relationship.
- scope: all native asset conversion. Note the legacy Unity-derived GLBs already carry a 1.8 m normalization the new pipeline does not repeat (docs/ARCHITECTURE.md, docs/ROADMAP.md).

## DEC-ASSET-1: One persistent runtime scene with bounded cells; Editor authoring files may be per tile
- current: the per-tile Editor authoring clause is superseded by DEC-OWN-8 (Editor is an optional viewer).
- source: docs/ASSET_BATCHING.md "Next work, in the user's order" item 5 (DOC, unnumbered)
- status: proposed
- decision: "Keep one persistent runtime Scene with bounded cells and shared resources. Add residency/LOD/instancing according to measurements as the supported slice requires. Separate Editor authoring files per tile remain compatible."
- scope: world scaling beyond 20_20. Depends on RENDERING.md steps 2 to 4.

---

# Owner resolutions at the ingest conflict gate, 2026-11-08

The owner answered every WARNING in .planning/INGEST-CONFLICTS.md in this ingest thread. These entries are **locked** (owner-declared at the gate). Where they narrow an earlier `proposed` entry above, they win. DEC-PORT-1, DEC-PORT-2 and DEC-PORT-3 are promoted to locked by DEC-OWN-1.

## DEC-OWN-1: Work order is breadth-first (PORT_SCOPE section 6)
- source: owner, ingest conflict gate 2026-11-08 (resolves WARNING "Competing work-order variants")
- status: locked
- decision: Stage A is breadth-first as written in docs/PORT_SCOPE.md section 6; stage B (server through GameWorldAdapter) follows. The open human/20_20 slice items (stair routing, upper-landing roof camera occlusion, automatic surface footsteps, specialized attack sounds) go to the polish list unless they block the sandbox. Other human classes are delivered with "all player characters", not before stage A. DEC-PORT-1, DEC-PORT-2 and DEC-PORT-3 are locked. The depth-first order in docs/ROADMAP.md, docs/ASSET_PIPELINE.md, docs/NATIVE_AUDIO.md and docs/ASSET_BATCHING.md is superseded (REQ-work-order-v1-breadth-first wins, v2 is rejected).

## DEC-OWN-2: IMPORTA-PC is the reference; E: tree needs a full-tree hash lock before stage A
- source: owner, ingest conflict gate 2026-11-08 (resolves WARNING "Which client and host is the reference")
- status: locked
- decision: IMPORTA-PC `C:/Lineage2-client` is authoritative and all L2.exe comparisons run there. DATABASE-PC `E:/Lineage2-client` may be used as a conversion source only after a one-time full-tree hash lock proves it equal to IMPORTA-PC. That lock is done before stage A conversion starts.

## DEC-OWN-3: Stage A uses a lighter per-part acceptance bar; fixed thresholds become the polish-stage goal
- source: owner, ingest conflict gate 2026-11-08 (resolves WARNING "Stage A acceptance standard")
- status: locked
- decision: Stage A acceptance per part = converted, loads in the offline sandbox, and passes a side-by-side screenshot / listen check against L2.exe on IMPORTA-PC. The fixed thresholds (pixel tolerances in recipes/native-parity.acceptance.json, GTX 1060 1080p 120 FPS workload, audio rules) are unchanged and are not relaxed (DEC-PARITY-1 stands); they are the goal of a later polish stage, not a stage A gate. Audio is converted and bound per bundle in stage A; native-rule research (e.g. ALAudio footstep rules) waits for the polish stage.

## DEC-OWN-4: Local pinned descriptor is the authoritative .dat decoder; Elbera fills gaps behind an adapter
- source: owner, ingest conflict gate 2026-11-08 (resolves WARNING "Two routes for decoding the 40 .dat tables")
- status: locked
- decision: Where the repo's local hash-pinned descriptor route covers a table, it is authoritative. Elbera decoders are used only for tables the local route lacks (hairgrp, helmetgrp and others), behind an adapter. The decoder work writes the combined decoded-table inventory (table, route, record count, status) first, before decoding more tables.

## DEC-OWN-5: Output contract stays .l2asset + catalog; input lock stays input-only
- source: owner, ingest conflict gate 2026-11-08 (resolves WARNING "Asset manifest contract")
- status: locked
- decision: Keep the existing `.l2asset` package plus runtime catalog as the output contract. `recipes/native-inputs.lock.json` stays input-only. Units and handedness are recorded per route in each package's `asset.json`. No new merged manifest file. This narrows docs/PORT_SCOPE.md section 7 "Extend recipes/native-inputs.lock.json".

## DEC-OWN-6: Three lanes plus integration; UI runs in parallel from the start
- source: owner, ingest conflict gate 2026-11-08 (resolves WARNING "lane cap versus per-area lanes, and UI ordering")
- status: locked
- decision: At most 3 lanes plus the integration thread in the main checkout.
  - L1 world: all 153 tiles, streaming/LOD, minimap.
  - L2 actors: all characters, NPCs/monsters, items/equipment, their animations, sounds and skill visuals.
  - L3 data + UI: all 40 .dat tables, UI windows from interface.xdat, sandbox controls.
  UI runs in parallel from the start: the layer table (docs/PORT_SCOPE.md section 5, UI at layer 1) wins over the stage A list order (section 6, UI last).

## DEC-OWN-7: Stage A world = geometry with the tile-general UV rule plus sky, ambient and placement audio, for all 153 tiles
- source: owner, ingest conflict gate 2026-11-08 (resolves WARNING "One pipeline run over every tile")
- status: locked
- decision: Stage A converts, for all 153 tiles, geometry (terrain, static meshes, BSP) with the tile-general UV rule, plus sky, ambient and placement audio. Each 20_20 hand step becomes a tile-general converter step. A tile that fails a step is listed as a gap, not hand-fixed. Per-tile Babylon.js Editor scenes come later (not stage A). [Superseded by DEC-OWN-8: per-tile Editor scenes are not planned.]

## DEC-OWN-8: Babylon.js Editor leaves the build and runtime path; Babylon.js stays the engine
- source: owner, 2026-11-08, relayed from the IMPORTA-PC session after the ingest
- status: locked
- decision:
  1. The native world loads directly from the `.l2asset` catalog (`loadNativeSection`). The Editor-authored route (`authored=1`) becomes optional.
  2. `pnpm dev` and `pnpm build` stop running `babylonjs-editor-cli pack` and the Editor repair scripts. Those move to an optional `pnpm generate:editor`. The legacy courtyard demo, which loads an Editor scene, is retired or kept only behind that optional step.
  3. The sandbox gets Babylon Inspector behind `?inspect=1`, lazy-loaded, for day-to-day inspection.
  4. The Editor remains an optional viewer: `project.bjseditor` and `pnpm assets:editor` stay, nothing depends on them.
  5. Revisit the Editor only if the SpacetimeDB route starts authoring new, non-L2 content.
- evidence (owner): `package.json` `generate` (run by dev and build) is `babylonjs-editor-cli pack` wrapped in repair scripts for Editor 5.5.3 behaviour (ensure-webgpu-project, preserve-native-editor-uv2, preserve-native-editor-fog, share-native-terrain-export-materials, validate-editor-materials, stage-webgpu-compilers) plus the l2-editor-webgpu-compat plugin. docs/EDITOR_ROUNDTRIP.md, EDITOR_MCP.md and NATIVE_EDITOR_WORLD.md record a blank Play viewport with unknown cause, checkerboard terrain from relative texture path rewriting, `isReady` false while visible and a cold-load delay. `native-world.scene` is 21.6 MB for one tile. The world's source of truth is the original client plus the converter; an Editor hand edit is lost on reconversion or is an invented change.
- found while recording (2026-11-08, from this repo):
  - `scripts/stage-webgpu-compilers.mjs` is not an Editor repair. It copies glslang and twgsl from `@babylonjs/core` into `public/vendor/babylon/9.27.1/`, and `src/engine/createWebGPUEngine.ts` loads them at runtime. It stays in `pnpm dev` and `pnpm build`.
  - The default native route (`?world=interlude` without `authored=1`) also boots through an Editor-packed scene, `native-parity.babylon`, via `loadScene` from `babylonjs-editor-tools` (`src/scene/loadEnvironment.ts`). Its settings (player profile, clips, material override) are Editor inspector fields in `src/scripts/nativeParity.ts`. Taking the Editor off the path therefore includes building that scene in code.
- supersedes: PRODUCT.md "Static environment stays editable in Babylon.js Editor"; the "per-tile Editor authoring files stay compatible" clause of DEC-ASSET-1; "Per-tile Editor scenes come later" in DEC-OWN-7; the Editor-authoring requirement REQ-editor-authoring-preserved.
