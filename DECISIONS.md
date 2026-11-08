# Decisions

Append-only, one dated line per decision. The full text of each decision lives in .planning/PROJECT.md, which stays the text GSD reads. Overnight choices made while the owner was away are owner-review items, not decisions, and are listed in .planning/OVERNIGHT-DECISIONS.md.

- 2026-11-07 DEC-PORT-1: The first goal is a working browser client with every client asset converted (world, characters, NPCs, items, .dat data, skill visuals, sounds, UI). Full text: .planning/PROJECT.md
- 2026-11-07 DEC-PORT-2: The server is replaceable, stock L2J Mobius first and SpacetimeDB if it does not fit, and changing servers means writing a second adapter. Full text: .planning/PROJECT.md
- 2026-11-07 DEC-PORT-3: The client never computes gameplay outcomes and displays what a server sends, with tooltips reading server stats. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-OWN-1: Work order is breadth-first, stage A (full converted client in an offline sandbox) before stage B (server adapter), and depth-first order is superseded. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-OWN-2: IMPORTA-PC C:/Lineage2-client is authoritative for all L2.exe comparisons, and E:/Lineage2-client is a conversion source only after a full-tree hash lock proves equality. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-OWN-3: The stage A bar per part is converted, loads in the sandbox and passes a side-by-side screenshot or listen check against L2.exe, with fixed thresholds kept for polish. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-OWN-4: The local hash-pinned descriptor 06_interlude.xml is the authoritative .dat decoder where it covers a table, and Elbera fills gaps behind an adapter after the inventory is written. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-OWN-5: The output contract stays .l2asset plus catalog, native-inputs.lock.json stays input-only, and units and handedness are recorded per route in asset.json. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-OWN-6: Work runs in three lanes plus integration: L1 world, L2 actors, L3 data and UI, with UI in parallel from the start. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-OWN-7: Stage A world is geometry with the tile-general UV rule plus sky, ambient and placement audio for all 153 tiles, and a failing tile is a gap, not a hand fix. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-OWN-8: Babylon.js Editor leaves the build and runtime path, the native world loads from the .l2asset catalog, and the Editor stays an optional viewer. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-PORT-4: Carried, not locked: the Mobius transport is a dumb WebSocket relay with L2 crypto and packet code in the browser, to be confirmed at the start of Phase 4. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-PORT-5: Carried, not locked: native-parity research goes to a polish list until stage A is complete. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-PORT-6: Carried, not locked: the Elbera reuse ranking applies, narrowed by DEC-OWN-4 for .dat tables. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-ARCH-1: Carried, not locked: modern Babylon.js WebGPU rendering preserves the game. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-ARCH-2: Carried, not locked: asset resolution and playback stay outside the adapter. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-PARITY-1: Carried, not locked: acceptance thresholds are never relaxed to fit a result. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-PARITY-2: Carried, not locked: optimize the supported slice now, whole-client parity is not a prerequisite. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-PIPE-1: Carried, not locked: conversion uses independent per-system scripts with an optional orchestrator. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-PIPE-2: Carried, not locked: conversion is source-preserving with pinned tools. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-ASSET-1: Carried, not locked: one persistent runtime scene with bounded cells, its per-tile Editor clause superseded by DEC-OWN-8. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-SRC-1: Carried, not locked: no copied linegen source. Full text: .planning/PROJECT.md
- 2026-11-08 DEC-SRC-2: Carried, not locked: IMPORTA-PC is the reference client, completed by DEC-OWN-2. Full text: .planning/PROJECT.md
- 2026-11-08 Owner: phone screenshots and the primary phone layout are landscape 844 x 390; portrait 390 x 844 stays a horizontal-scroll check. Full text: AGENTS.md, DESIGN.md
- 2026-11-08 Owner: the default phone is the iPhone 15 Pro Max, 932 x 430 landscape, with a 430 x 932 portrait horizontal-scroll check. Replaces the 844 x 390 line above. Full text: AGENTS.md, DESIGN.md
