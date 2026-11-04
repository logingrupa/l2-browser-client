# Project status and next steps

Updated: 2026-11-04. This document records the current scope; the original Phase 1 requirements remain in `.planning/` as the foundation brief.

## Phase 1 — browser foundation

Implemented and pushed in commit `3b16f1c317e20ee636a3b3f83bddafc15096740a`: the native Babylon.js Editor Vanilla project, editable environment, mobile-first HUD, six synthetic entities, replaceable `GameWorldAdapter`, procedural animation, targeting, interpolation, teleports, lifecycle controls, and diagnostics.

The baseline passed strict typechecking, build, 37 Vitest tests, and nine Playwright tests. Desktop Editor import/edit/save/reopen/play and live official MCP authoring were not performed because those tools were unavailable. See [VERIFICATION.md](VERIFICATION.md) and [EDITOR_MCP.md](EDITOR_MCP.md). These outcomes apply to the procedural foundation, not to subsequently imported models.

## Phase 1 follow-up — converted asset integration

The next asset task is a local 3D art exercise: inspect existing converted models, verify conversion correctness in this browser client, and integrate working models. Here **usable** means technically correct geometry, materials, skinning, animation, scale, and runtime behavior. File availability, structural validity, visual correctness, and publication provenance are separate findings.

The user identified the local source workspace as `C:\laragon\www\lineagen`. Inspection confirmed:

- Converted models: `.assets\converted\MFighter.glb`, `FFighter.glb`, `MMagic.glb`, and `FMagic.glb`, with matching Blender files and manifests.
- Offline tooling and documentation: `.assets\conversion\`.
- Earlier validation evidence: `.assets\evidence\`; this evidence belongs to the source workflow, not this destination's verification.
- Existing Blender executable: `.assets\tools\blender\blender-5.0.1-windows-x64\blender.exe`.

All four files parsed as GLB v2 during read-only structural inspection. They contain `wait_Hand`, `run_Hand`, and `Atk01_Hand`; the destination's generic animation aliases do not currently match these names. Explicit clip mapping is a known integration requirement, not proof of a conversion defect. Visual rendering, deformation, and transitions remain unverified in this project. The source workflow references Babylon 9.33.0; validate against the destination's pinned 9.27.1 before changing dependencies.

Consume the existing outputs first. The tooling-equipped session can make targeted conversion repairs if actual defects are found. Keep the source workspace unchanged and direct repair outputs/logs to a destination scratch directory; the source conversion wrapper defaults to replacing outputs and writing logs in the source workspace.

The task also updates stale **Markdown documentation**. The user's correction does not request a stylesheet overhaul. Retain the mobile HUD and share actual screenshots at visible asset-integration milestones. The [copy-ready handoff](../.planning/asset-integration-prompt.md) supplies the scope and verification requirements. No converted model has been copied into or rendered by this destination during the documentation update.

## Phase 2 — Real M0 networking

**Planned, not implemented:** establish Interlude authentication, character selection, and world entry against stock Mobius.

Keep `GameWorldAdapter` as the integration boundary. A future adapter must deliver real initial state and ordered entity events, normalize coordinates/time, and identify teleports without requiring a renderer rewrite. Synthetic developer commands need an explicit support policy in the real adapter.

Phase 2 evidence must demonstrate actual authentication, character selection, and entry into a stock server's world. The synthetic demo, asset imports, and placeholder login screens do not establish those results. Decide transport, protocol, and test-environment details when that phase is explicitly started.

The asset follow-up must preserve this boundary and must not start networking implementation. Real combat calculations, quests, progression, gacha, original map conversion, and production deployment remain outside the current scope.
