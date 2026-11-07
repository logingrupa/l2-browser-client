# Synthesis summary

Mode: new. Revision 2 (2026-11-08). Entry point for gsd-roadmapper. Synthesized: 17 of 17 documents. Status: no blockers; AWAITING USER on 7 warnings, led by the work-order competing variants (unresolved). Detail: C:/laragon/www/l2-browser-client-plan/.planning/INGEST-CONFLICTS.md

The three cross-reference cycles found in revision 1 (RENDERING <-> NATIVE_PARITY, ASSET_PIPELINE <-> ASSET_BATCHING, ASSET_PIPELINE <-> NATIVE_CLIENT_AUDIT) were waived by the owner on 2026-11-08 as see-also links. All five previously withheld documents are now included.

## Document counts by type
- PRD: 3 (PRODUCT.md precedence 0, docs/PORT_SCOPE.md 1, .planning/goal.md 2)
- SPEC: 5 (docs/ARCHITECTURE.md 3, docs/NATIVE_PARITY.md 4, docs/ASSET_PIPELINE.md 5, docs/RENDERING.md 6, docs/NATIVE_AUDIO.md 7)
- DOC: 9 (docs/ROADMAP.md 8; unnumbered: DESIGN.md, README.md, docs/UI_DIRECTION.md, docs/SOURCE_REUSE.md, docs/LINEAGE2ELBERA_REUSE_AUDIT.md, docs/NATIVE_CLIENT_AUDIT.md, docs/NATIVE_WORLD.md, docs/ASSET_BATCHING.md)
- ADR: 0. UNKNOWN: 0.

## Decisions (15)
- Locked: 0 (no ADRs; all classifications locked=false). All 15 are status proposed.
- Owner decisions 2026-11-07 from docs/PORT_SCOPE.md: DEC-PORT-1 (full converted client first), DEC-PORT-2 (server replaceable, stock L2J Mobius first, SpacetimeDB possible), DEC-PORT-3 (client never computes gameplay outcomes). Annotated owner-declared.
- Others: DEC-PORT-4 (dumb WebSocket relay, recommendation), DEC-PORT-5 (polish-list deferral), DEC-PORT-6 (Elbera reuse), DEC-SRC-1, DEC-SRC-2, DEC-ARCH-1, DEC-ARCH-2, and added in revision 2: DEC-PARITY-1 (acceptance thresholds never relaxed), DEC-PARITY-2 (optimize the supported slice now), DEC-PIPE-1 (independent per-system scripts), DEC-PIPE-2 (source-preserving conversion, pinned tools), DEC-ASSET-1 (one runtime scene, bounded cells).
- File: C:/laragon/www/l2-browser-client-plan/.planning/intel/decisions.md

## Requirements (26)
- Work order, preserved as separate competing variants and not merged: REQ-work-order-v1-breadth-first (docs/PORT_SCOPE.md section 6), REQ-work-order-v2-depth-first (docs/ROADMAP.md, corroborated by ASSET_PIPELINE, NATIVE_AUDIO, ASSET_BATCHING; goal.md only contributes the scope boundary).
- Port scope: REQ-full-converted-client, REQ-dat-tables-decoded, REQ-world-tiles-batch, REQ-player-characters, REQ-npcs-items-skills-audio, REQ-ui-windows-from-decoded-layout, REQ-offline-sandbox, REQ-client-displays-server-outcomes, REQ-gameworldadapter-sole-entry, REQ-stage-b-mobius-adapter, REQ-spacetimedb-fallback-adapter, REQ-relay-limits, REQ-multi-agent-workflow, REQ-client-side-behaviors.
- Product: REQ-modern-webgpu-rendering, REQ-original-audio-1to1, REQ-asset-structure-preserved, REQ-native-route-no-stand-ins, REQ-editor-authoring-preserved, REQ-mobile-first-hud.
- Phase 1 history: REQ-phase1-foundation, REQ-phase1-scope-boundary.
- Added in revision 2: REQ-parity-and-performance-acceptance, REQ-independent-system-scripts.
- Most PRD requirements have no acceptance criteria in the source and say "absent in source".
- File: C:/laragon/www/l2-browser-client-plan/.planning/intel/requirements.md

## Constraints (29)
- By type: api-contract 2, schema 5, nfr 14, protocol 8.
- Revision 1 (15): GameWorldAdapter contract, real-adapter obligations, frame timing, coordinates and units, startup readiness barrier, native visual and asset ownership, rendering policy and limits, shutdown, audio runtime ownership, audio acceptance gate, audio ships with each system bundle, client file protection formats, Mobius protocol surface, relay per-IP limits, parallel-work contracts.
- Added in revision 2 (14): native parity fixed acceptance contract, native parity visual evidence rules, performance protocol and target (GTX 1060, 1920x1080, 120 FPS, 32 actors and eight Power Strike effects), native parity reference host and capture status, Editor round trip and reproducibility acceptance, rendering implementation status, rendering implementation sequence, `.l2asset` package contract (128 MiB / 96 MiB / 256 entries), pinned converter tools (UModel build1590), coordinate/skeleton/animation conversion rules, material and texture binding rules, audio and notification export rules, skill and effect extraction boundary, independent per-system conversion scripts.
- The numeric visual tolerances are in `recipes/native-parity.acceptance.json`, not in the Markdown sources, so they are referenced rather than restated.
- File: C:/laragon/www/l2-browser-client-plan/.planning/intel/constraints.md

## Context topics (11)
Project status 2026-11-07, ROADMAP historical checkpoints, Phase 1 and Phase 2 per ROADMAP, README overview, design tokens, mobile scene direction, source provenance and licensing, Elbera reuse audit, native world preview status, and added in revision 2: conversion system coverage and next work (ASSET_BATCHING), installed native client audit (NATIVE_CLIENT_AUDIT).
- File: C:/laragon/www/l2-browser-client-plan/.planning/intel/context.md

## Conflicts
- 0 blockers, 7 warnings, 11 info.
- Warnings in order: (1) work-order competing variants, depth-first versus breadth-first, unresolved; (2) reference client and host; (3) stage A acceptance standard and feasibility of the L2.exe comparison; (4) two .dat decoder routes; (5) asset manifest contract; (6) PORT_SCOPE internal lane and UI inconsistencies; (7) new in revision 2: "one pipeline run over every tile" versus a 20_20 path of tile-specific steps.
- Info: three waived cross-reference cycles, plus auto-resolved scope-exclusion and Phase 2 notes and six observation notes.
- Report: C:/laragon/www/l2-browser-client-plan/.planning/INGEST-CONFLICTS.md

## Note for the roadmapper
Do not route until the owner has answered the work-order warning. Precedence favors docs/PORT_SCOPE.md section 6 (breadth-first, precedence 1) over the depth-first text in ROADMAP.md (8), NATIVE_AUDIO.md (7), ASSET_PIPELINE.md (5) and ASSET_BATCHING.md, but that was deliberately not applied as an auto-resolution. Warnings 2, 3 and 7 shape how large stage A is and how it is accepted, so they should be answered together with the work order.
