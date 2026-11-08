# l2-browser-client

## What This Is

A browser client for Lineage II Interlude on Babylon.js WebGPU (strict TypeScript, pnpm). It converts every asset of the installed native client (40 `.dat` tables, 153 world tiles, characters, NPCs, items, animations, skill visuals, audio, UI) into something the browser loads, proves each part in an offline sandbox, then plugs in a replaceable server through `GameWorldAdapter` (stock L2J Mobius first, SpacetimeDB possible). One owner, Claude as implementer, at most 3 parallel lanes plus an integration thread.

## Core Value

A fully converted Lineage II Interlude client that runs in the browser and matches L2.exe side by side, driven only by what a server sends.

## Target runtime and success metric

- Target runtime: browser, Babylon.js WebGPU.
- Stage A success (per part, DEC-OWN-3): converted, loads in the offline sandbox, and passes a side-by-side screenshot / listen check against L2.exe on IMPORTA-PC. A part that fails is listed as a gap; unverified is never a pass.
- Fixed native-parity thresholds (pixel tolerances, GTX 1060 1080p 120 FPS, audio rules) are unchanged and become the goal of the polish stage (Phases 5 and 6).

## Requirements

Full list with IDs and traceability: `.planning/REQUIREMENTS.md`.

### Validated

- Phase 1 foundation (standalone Babylon.js client, `GameWorldAdapter`, `MockWorldAdapter`, synthetic entities) shipped in commit `3b16f1c317e20ee636a3b3f83bddafc15096740a`. Original brief kept in `.planning/goal.md` as history.
- Current slice (2026-11-07, PORT_SCOPE part 5): human fighters native, 20_20 world and Talking Island bundles, Greater Musveren, Power Strike and 20_20 audio in progress, human mystic export in progress, UI is a development sheet only.

### Active

Stage A breadth-first conversion of the whole client (Phases 1 to 3), stage B server adapter (Phase 4), then native-parity polish and performance (Phases 5 and 6). Babylon.js Editor is off the build and runtime path (DEC-OWN-8); taking it off is Phase 1 integration work, done before the Phase 2 lanes start.

### Out of Scope

- Production deployment (excluded in every source).
- Client-side gameplay math, combat calculation, quest logic or progression (DEC-PORT-3: the client displays server outcomes).
- Committing or publishing converted Lineage II binaries, captures or native audio; they stay under ignored `artifacts/` and `public/l2`.
- Copying `linegen` source or assets (no redistribution licence found).
- Elbera's three.js runtime, native verifiers pinned to Engine.dll `07b24af4...`, `elbera-acis.patch`, deviceId auto login, and a smart JSON gateway (doubles per-packet work, thrown away if SpacetimeDB is chosen).
- Reproducing legacy Direct3D internals unless they explain a visible difference or required behaviour.
- Depth-first work order (human fighters and 20_20 before other races or tiles); DEC-OWN-1 sets breadth-first stage A.

## Context

- Reference: IMPORTA-PC `C:/Lineage2-client` (modified third-party Interlude client, not an untouched official build; Engine.dll SHA-256 `4dd2f63c606d...`). DATABASE-PC `E:/Lineage2-client` is a conversion source only after the full-tree hash lock (DEC-OWN-2). Native client facts on IMPORTA-PC: ssh `fleet-importa-pc`, T3 thread 28fd5fa6 (env 20b54a96).
- Elbera (`C:\laragon\www\Lineage2Elbera` on IMPORTA-PC, `E:\Lineage2Elbera` on DATABASE-PC, commit `12c9656`) is a source of reusable decoders and conversion code, MIT.
- Planning intel: `.planning/intel/SYNTHESIS.md` (entry), conflict resolutions in `.planning/INGEST-CONFLICTS.md`. Primary scope doc: `docs/PORT_SCOPE.md`.
- Resume point: `.planning/STATE.md` for status and `.planning/ROADMAP.md` for order. Continuation and handoff prompts are not kept in `.planning/`; git history has them. Keep status files small (PORT_SCOPE section 10 warns about 271 KB progress files).

## Constraints

- **Stack**: Node 22.12.0+, pnpm 10.32.1, Babylon.js 9.27.1, Editor tools/CLI 5.5.3 (optional viewer only, DEC-OWN-8; not in `pnpm dev` or `pnpm build`), TypeScript 7.0.2, Vite 7.3.7, Vitest 5.1.0, Playwright 1.64.1. Strict TS, no `any`, pnpm only. Code rules: `AGENTS.md`.
- **Adapter boundary**: `GameWorldAdapter` is the only way gameplay state enters the client; its five methods (`getInitialState`, `subscribe`, `dispatch`, `advance`, `dispose`) stay frozen; no Babylon types below it.
- **Output contract**: `.l2asset` packages plus runtime catalog (128 MiB archive, 96 MiB payload, 256 entries). `recipes/native-inputs.lock.json` is input-only. Units and handedness are recorded per route in `asset.json`.
- **Conversion**: independent per-system scripts; UModel build1590 pinned (SHA-256 `13502e5a...364a0`); no normalization, ground fitting or weight changes; unbound materials become visible magenta diagnostics; no procedural stand-ins on the native route.
- **Parallel work**: at most 3 lanes plus integration; one part per branch `<part>/<slug>`; scripts writing the native store (`assets:*`, `world:stage`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*`) run only in the main checkout; `lane new`/`lane rm` refused Thu 19:00-21:30 and Sun 10:00-14:00; merge one branch at a time, contract changes first.
- **Preferences (user memory)**: dev and sandbox controls are a pinnable sheet with hover-cards showing variables, never a cramped toggle scroll list; all staged media comes from our recipes and scripts; prefer audible labelled results over more research.

<decisions>
## Locked (owner decisions; no ADRs exist)

- DEC-PORT-1: First goal is a working browser client with every client asset converted (world, characters, NPCs, items, `.dat` data, skill visuals, sounds, UI). Promoted to locked by DEC-OWN-1.
- DEC-PORT-2: The server is replaceable. Stock L2J Mobius first; if it does not fit, SpacetimeDB with the L2 client and world but a different gameplay loop. Changing servers means writing a second adapter.
- DEC-PORT-3: The client never computes gameplay outcomes; it displays what a server sends. Tooltips read server stats, not the `.dat` display copies.
- DEC-OWN-1: Work order is breadth-first (PORT_SCOPE section 6): stage A (full converted client, offline sandbox) before stage B (server adapter). Human/20_20 slice leftovers (stair routing, upper-landing roof camera, automatic surface footsteps, specialized attack sounds) go to the polish list unless they block the sandbox. Other human classes ship with "all player characters". Depth-first order is superseded; REQ-work-order-v2-depth-first is rejected.
- DEC-OWN-2: IMPORTA-PC `C:/Lineage2-client` is authoritative and all L2.exe comparisons run there. `E:/Lineage2-client` may be a conversion source only after a one-time full-tree hash lock proves equality; the lock is done before stage A conversion starts.
- DEC-OWN-3: Stage A bar per part = converted, loads in the sandbox, passes side-by-side screenshot / listen check against L2.exe on IMPORTA-PC. Fixed thresholds are not relaxed (DEC-PARITY-1 stands) and are the polish-stage goal. Audio is converted and bound per bundle in stage A; native-rule research (ALAudio footsteps) waits for polish.
- DEC-OWN-4: The repo's local hash-pinned descriptor (`06_interlude.xml`) is the authoritative `.dat` decoder where it covers a table; Elbera fills gaps (hairgrp, helmetgrp, others) behind an adapter. The combined decoded-table inventory (table, route, record count, status) is written first.
- DEC-OWN-5: Output contract stays `.l2asset` + catalog; `recipes/native-inputs.lock.json` stays input-only; units and handedness recorded per route in `asset.json`; no new merged manifest.
- DEC-OWN-6: Three lanes plus integration. L1 world (153 tiles, streaming/LOD, minimap). L2 actors (characters, NPCs/monsters, items/equipment, animations, sounds, skill visuals). L3 data + UI (40 `.dat` tables, `interface.xdat` windows, sandbox controls). UI runs in parallel from the start.
- DEC-OWN-7: Stage A world = geometry (terrain, static meshes, BSP) with the tile-general UV rule plus sky, ambient and placement audio, for all 153 tiles. Each 20_20 hand step becomes a tile-general converter step. A failing tile is listed as a gap, not hand-fixed. Per-tile Editor scenes are not planned (DEC-OWN-8).
- DEC-OWN-8 (2026-11-08): Babylon.js Editor leaves the build and runtime path; Babylon.js stays the engine. The native world loads directly from the `.l2asset` catalog (`loadNativeSection`), and the Editor-authored route (`authored=1`) becomes optional. `pnpm dev` and `pnpm build` stop running `babylonjs-editor-cli pack` and the Editor repair scripts, which move to an optional `pnpm generate:editor`. The legacy courtyard demo is retired or kept only behind that step. The sandbox gets Babylon Inspector behind `?inspect=1`, lazy-loaded. `project.bjseditor` and `pnpm assets:editor` stay as an optional viewer that nothing depends on. Revisit only if the SpacetimeDB route starts authoring new, non-L2 content. Reason: the world's source of truth is the original client plus the converter, so an Editor hand edit is lost on reconversion or is an invented change; the Editor path needs repair scripts plus a compat plugin and still shows open defects (blank Play viewport, relative texture path rewriting, `isReady` false while visible). Supersedes PRODUCT.md "Static environment stays editable in Babylon.js Editor".
- DEC-OWN-9 (2026-11-08): The default phone is the iPhone 15 Pro Max held sideways, 932 x 430 CSS px in landscape with touch. Phone screenshots and the primary phone layout use it; portrait 430 x 932 stays a horizontal-scroll check, and desktop screenshots stay 1440 x 900. Reason: the game is played with the phone held sideways.
- DEC-OWN-10 (2026-11-08): The only game interface is the original Interlude interface. Window layout comes from `interface.xdat`; skin, fonts and icons come from the client's converted UI textures. DESIGN.md, `.impeccable/design.json` and the custom HUD direction (dark translucent panels, bronze borders, Cormorant Garamond headings) are removed. The procedural HUD stays only as a stand-in until native windows replace it and gets no design work. Supersedes the mobile-first HUD wording in UI-03 and PRODUCT.md.

## Carried, not locked (proposed in sources, consistent with the locked set)

- DEC-PORT-4: Mobius transport is a dumb WebSocket relay (browser runs L2 crypto and packet code in TypeScript; relay forwards bytes). A recommendation, not decided; confirm at the start of Phase 4.
- DEC-PORT-5: Native-parity research goes to a polish list until stage A is complete (aligned with DEC-OWN-1 and DEC-OWN-3).
- DEC-PORT-6: Elbera reuse ranking; narrowed by DEC-OWN-4 for `.dat` tables.
- DEC-ARCH-1 / DEC-ARCH-2: modern Babylon.js WebGPU preserving the game; asset resolution and playback stay outside the adapter.
- DEC-PARITY-1: acceptance thresholds are never relaxed to fit a result. DEC-PARITY-2: optimize the supported slice now; whole-client parity is not a prerequisite.
- DEC-PIPE-1 / DEC-PIPE-2: independent per-system scripts, orchestrator optional; source-preserving conversion with pinned tools.
- DEC-ASSET-1: one persistent runtime scene with bounded cells. Its "per-tile Editor authoring files stay compatible" clause is superseded by DEC-OWN-8.
- DEC-SRC-1 / DEC-SRC-2: no copied `linegen` source; IMPORTA-PC reference (completed by DEC-OWN-2).
</decisions>

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Breadth-first, stage A before stage B | Owner decision; sandbox is the acceptance tool and a server is replaceable | Pending |
| Lighter stage A bar, fixed thresholds in polish | Capture path fails the 30 FPS gate; DATABASE-PC (GTX 1060 PERF-01 host) has no 120 Hz display, and IMPORTA-PC is 144 Hz-capable with a 120 Hz mode enumerated but not selected (docs/NATIVE_PARITY.md); thresholds stay unrelaxed | Pending |
| Local descriptor first, Elbera behind adapter | Local route is hash-pinned and already decodes 8 tables; Elbera covers gaps | Pending |
| `.l2asset` + catalog as output contract | Already implemented and verified; avoids a third merged manifest | Pending |
| Editor off the build and runtime path | World comes from client plus converter; Editor path needs repair scripts and has open defects | Pending (Phase 1) |
| Dumb WebSocket relay for Mobius | Reusable if server becomes SpacetimeDB | Pending (recommendation) |

---
*Last updated: 2026-11-08 after DEC-OWN-10 (only the original Interlude interface)*
