# Short asset-integration handoff

Copy the block below into the tooling-equipped session. The detailed requirements are in [asset-integration-details.md](asset-integration-details.md); current status is in [docs/ROADMAP.md](../docs/ROADMAP.md). The block must remain under 4,000 characters.

```text
Work in C:\laragon\www\l2-browser-client.

First read:
- .planning/asset-integration-details.md — full task and acceptance requirements
- docs/ROADMAP.md — current state and phase boundaries
- docs/ARCHITECTURE.md — runtime ownership and known prototype assumptions
- docs/SOURCE_REUSE.md — actual asset inventory and provenance
- docs/VERIFICATION.md — historical checks and remaining gaps
- README.md and PRODUCT.md — commands and project constraints

Before editing, briefly state what you understand and your first concrete step.

GOAL
Integrate the existing converted character assets by adapting this client's code to their structure. Preserve native rigs, names, character parts, equipment/attachments, materials, proportions and animation relationships. Refactor loading, assembly, mappings and presentation behavior around the supplied assets. Conversion repairs require demonstrated defects; prototype incompatibility is a client adaptation task.

CURRENT STATE
The procedural Phase 1 foundation works: six synthetic entities, mobile HUD, editable scene and GameWorldAdapter. Its baseline passed 37 Vitest and 9 Playwright tests. Four converted GLBs exist and passed structural inspection, but have not been rendered or integrated in this destination. Current blockers include generic clip aliases, forced 1.8 m normalization and a narrow single-container model contract. Inspect current files before changing them.

INPUTS
Converted assets: C:\laragon\www\lineagen\.assets\converted
Conversion tools/docs: C:\laragon\www\lineagen\.assets\conversion
Prior evidence: C:\laragon\www\lineagen\.assets\evidence

Use existing outputs and tooling first. Keep the source workspace unchanged and write any repair outputs/logs to destination scratch space. Follow the detailed brief for safe offline tool use.

DELIVER
Working local model integration with verified skinning/animation, preserved entity behavior, cleanup and fallback. Send real progress screenshots, including mobile and desktop views. Run the required checks and update docs/ASSET_AUDIT.md and other stale Markdown with actual findings. This is not a stylesheet overhaul. Keep binaries local; do not push or publish them.

PHASE 2
Real M0 networking remains planned: Interlude authentication, character selection and world entry against stock Mobius. Preserve GameWorldAdapter for that integration, but do not implement networking or claim Phase 2 is complete during this asset task.

Complete the detailed brief; report any remaining defect with evidence and the smallest repair needed.
```
