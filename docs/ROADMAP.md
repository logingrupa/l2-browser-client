# Project status and next steps

Updated: 2026-11-04. This document records the current scope; the original Phase 1 requirements remain in `.planning/` as the foundation brief.

## Phase 1 - browser foundation

Implemented and pushed in commit `3b16f1c317e20ee636a3b3f83bddafc15096740a`: the native Babylon.js Editor Vanilla project, editable environment, mobile-first HUD, six synthetic entities, replaceable `GameWorldAdapter`, procedural animation, targeting, interpolation, teleports, lifecycle controls, and diagnostics.

The baseline passed strict typechecking, build, 37 Vitest tests, and nine Playwright tests. Desktop Editor import/edit/save/reopen/play and live official MCP authoring were not performed because those tools were unavailable. See [VERIFICATION.md](VERIFICATION.md) and [EDITOR_MCP.md](EDITOR_MCP.md). These outcomes apply to the procedural foundation, not to subsequently imported models.

## Phase 1 follow-up - converted asset integration

The next asset task is a local 3D art exercise: inspect existing converted models, verify conversion correctness in this browser client, and integrate working models. Here **usable** means technically correct geometry, materials, skinning, animation, scale, and runtime behavior. File availability, structural validity, visual correctness, and publication provenance are separate findings.

**The client must adapt to the asset structure.** Preserve the original character, equipment, skeleton, attachment, material and animation relationships represented by the assets and manifests. Refactor loading, character assembly, animation resolution and scale handling to match those inputs. The current generic clip aliases, single-container expectation, uniform height normalization and blanket animation looping are prototype assumptions to audit. Map client states to native clip names and preserve authored proportions and resource boundaries. Change converted content only for demonstrated defects or lost source relationships, not to make valid assets fit the prototype.

The task also updates stale **Markdown documentation**. The user's correction does not request a stylesheet overhaul. Retain the mobile HUD and share actual screenshots at visible asset-integration milestones. No converted model has been copied into or rendered by this destination during the documentation update.

## Phase 2 - Real M0 networking

**Planned, not implemented:** establish Interlude authentication, character selection, and world entry against stock Mobius.

Keep `GameWorldAdapter` as the integration boundary. A future adapter must deliver real initial state and ordered entity events, normalize coordinates/time, and identify teleports without requiring a renderer rewrite. Synthetic developer commands need an explicit support policy in the real adapter.

Phase 2 evidence must demonstrate actual authentication, character selection, and entry into a stock server's world. The synthetic demo, asset imports, and placeholder login screens do not establish those results. Decide transport, protocol, and test-environment details when that phase is explicitly started.

The asset follow-up must preserve this boundary and must not start networking implementation. Real combat calculations, quests, progression, gacha, original map conversion, and production deployment remain outside the current scope.
