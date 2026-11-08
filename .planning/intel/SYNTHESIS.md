# Synthesis summary

Mode: new. Revision 2 (2026-11-08). Entry point for gsd-roadmapper. Synthesized: 17 of 17 documents. Status: no blockers; all 7 warnings are answered by owner decisions DEC-OWN-1..7 (2026-11-08), and DEC-OWN-8 takes Babylon.js Editor off the build and runtime path. Detail: .planning/INGEST-CONFLICTS.md

Source citations quote the docs as of the ingest on 2026-11-08. Current homes: docs/ROADMAP.md content is in .planning/ROADMAP.md (order) and .planning/STATE.md (status); docs/ASSET_BATCHING.md is in docs/ASSET_PIPELINE.md; docs/UI_DIRECTION.md is in DESIGN.md; Editor docs are in docs/EDITOR_VIEWER.md.

The three cross-reference cycles found in revision 1 (RENDERING <-> NATIVE_PARITY, ASSET_PIPELINE <-> ASSET_BATCHING, ASSET_PIPELINE <-> NATIVE_CLIENT_AUDIT) were waived by the owner on 2026-11-08 as see-also links. All five previously withheld documents are now included.

## Document counts by type
- PRD: 3 (PRODUCT.md precedence 0, docs/PORT_SCOPE.md 1, .planning/goal.md 2)
- SPEC: 5 (docs/ARCHITECTURE.md 3, docs/NATIVE_PARITY.md 4, docs/ASSET_PIPELINE.md 5, docs/RENDERING.md 6, docs/NATIVE_AUDIO.md 7)
- DOC: 9 (docs/ROADMAP.md 8; unnumbered: DESIGN.md, README.md, docs/UI_DIRECTION.md, docs/SOURCE_REUSE.md, docs/LINEAGE2ELBERA_REUSE_AUDIT.md, docs/NATIVE_CLIENT_AUDIT.md, docs/NATIVE_WORLD.md, docs/ASSET_BATCHING.md)
- ADR: 0. UNKNOWN: 0.

## Decisions (23)
- Locked: 11 by owner decision at the conflict gate: DEC-OWN-1..8 and DEC-PORT-1..3 (promoted by DEC-OWN-1). No ADRs exist. The other 12 are carried as proposed and consistent with the locked set (see PROJECT.md `<decisions>`).
- Owner decisions 2026-11-07 from docs/PORT_SCOPE.md: DEC-PORT-1 (full converted client first), DEC-PORT-2 (server replaceable, stock L2J Mobius first, SpacetimeDB possible), DEC-PORT-3 (client never computes gameplay outcomes). Annotated owner-declared.
- Others: DEC-PORT-4 (dumb WebSocket relay, recommendation), DEC-PORT-5 (polish-list deferral), DEC-PORT-6 (Elbera reuse), DEC-SRC-1, DEC-SRC-2, DEC-ARCH-1, DEC-ARCH-2, and added in revision 2: DEC-PARITY-1 (acceptance thresholds never relaxed), DEC-PARITY-2 (optimize the supported slice now), DEC-PIPE-1 (independent per-system scripts), DEC-PIPE-2 (source-preserving conversion, pinned tools), DEC-ASSET-1 (one runtime scene, bounded cells).
- File: .planning/intel/decisions.md

## Requirements (26)
- Work order: REQ-work-order-v1-breadth-first (docs/PORT_SCOPE.md section 6) is the order (DEC-OWN-1). REQ-work-order-v2-depth-first is rejected by DEC-OWN-1.
- Port scope: REQ-full-converted-client, REQ-dat-tables-decoded, REQ-world-tiles-batch, REQ-player-characters, REQ-npcs-items-skills-audio, REQ-ui-windows-from-decoded-layout, REQ-offline-sandbox, REQ-client-displays-server-outcomes, REQ-gameworldadapter-sole-entry, REQ-stage-b-mobius-adapter, REQ-spacetimedb-fallback-adapter, REQ-relay-limits, REQ-multi-agent-workflow, REQ-client-side-behaviors.
- Product: REQ-modern-webgpu-rendering, REQ-original-audio-1to1, REQ-asset-structure-preserved, REQ-native-route-no-stand-ins, REQ-editor-authoring-preserved (superseded by DEC-OWN-8; see VIEW-01 and EDIT-02), REQ-mobile-first-hud.
- Phase 1 history: REQ-phase1-foundation, REQ-phase1-scope-boundary.
- Added in revision 2: REQ-parity-and-performance-acceptance, REQ-independent-system-scripts.
- Most PRD requirements have no acceptance criteria in the source and say "absent in source".
- File: .planning/intel/requirements.md

## Constraints (29)
- By type: api-contract 2, schema 5, nfr 14, protocol 8.
- Revision 1 (15): GameWorldAdapter contract, real-adapter obligations, frame timing, coordinates and units, startup readiness barrier, native visual and asset ownership, rendering policy and limits, shutdown, audio runtime ownership, audio acceptance gate, audio ships with each system bundle, client file protection formats, Mobius protocol surface, relay per-IP limits, parallel-work contracts.
- Added in revision 2 (14): native parity fixed acceptance contract, native parity visual evidence rules, performance protocol and target (GTX 1060, 1920x1080, 120 FPS, 32 actors and eight Power Strike effects), native parity reference host and capture status, Editor round trip and reproducibility acceptance, rendering implementation status, rendering implementation sequence, `.l2asset` package contract (128 MiB / 96 MiB / 256 entries), pinned converter tools (UModel build1590), coordinate/skeleton/animation conversion rules, material and texture binding rules, audio and notification export rules, skill and effect extraction boundary, independent per-system conversion scripts.
- The numeric visual tolerances are in `recipes/native-parity.acceptance.json`, not in the Markdown sources, so they are referenced rather than restated.
- File: .planning/intel/constraints.md

## Context topics (11)
Project status 2026-11-07, ROADMAP historical checkpoints, Phase 1 and Phase 2 per ROADMAP, README overview, design tokens, mobile scene direction, source provenance and licensing, Elbera reuse audit, native world preview status, and added in revision 2: conversion system coverage and next work (ASSET_BATCHING), installed native client audit (NATIVE_CLIENT_AUDIT).
- File: .planning/intel/context.md

## Conflicts
- 0 blockers, 7 warnings, 11 info.
- Warnings in order, each answered by DEC-OWN-1..7: (1) work-order competing variants, depth-first versus breadth-first (DEC-OWN-1, breadth-first); (2) reference client and host; (3) stage A acceptance standard and feasibility of the L2.exe comparison; (4) two .dat decoder routes; (5) asset manifest contract; (6) PORT_SCOPE internal lane and UI inconsistencies; (7) new in revision 2: "one pipeline run over every tile" versus a 20_20 path of tile-specific steps.
- Info: three waived cross-reference cycles, plus auto-resolved scope-exclusion and Phase 2 notes and six observation notes.
- Report: .planning/INGEST-CONFLICTS.md

## Note for the roadmapper
The roadmap is written: .planning/ROADMAP.md (6 phases) and .planning/REQUIREMENTS.md. Resume from .planning/STATE.md.
