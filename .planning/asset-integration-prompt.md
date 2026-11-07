# Short asset-integration handoff

**Historical character-integration prompt:** for current native-world work use
[rendering-direction-20261107.md](rendering-direction-20261107.md) and
[docs/RENDERING.md](../docs/RENDERING.md). The retained block describes the earlier
four-GLB task, not the current world or latest test totals. Do not repeat completed
integration/conversion checks merely to resume work.

The block below is a continuation handoff. The detailed acceptance requirements remain in [asset-integration-details.md](asset-integration-details.md); actual current results are in [docs/ASSET_AUDIT.md](../docs/ASSET_AUDIT.md) and [docs/VERIFICATION.md](../docs/VERIFICATION.md). Read those before repeating completed work. The block must remain under 4,000 characters.

```text
Work in C:\laragon\www\l2-browser-client.

First read:
- .planning/asset-integration-details.md — full task and acceptance requirements
- docs/ROADMAP.md — current state and phase boundaries
- docs/ARCHITECTURE.md — runtime ownership and known prototype assumptions
- docs/SOURCE_REUSE.md — actual asset inventory and provenance
- docs/VERIFICATION.md — historical checks and remaining gaps
- docs/ASSET_AUDIT.md — observed structure, current evidence and defects
- README.md and PRODUCT.md — commands and project constraints

Before editing, briefly state what you understand and your first concrete step.

GOAL
Integrate the existing converted character assets by adapting this client's code to their structure. Preserve native rigs, names, character parts, equipment/attachments, materials, proportions and animation relationships. Refactor loading, assembly, mappings and presentation behavior around the supplied assets. Conversion repairs require demonstrated defects; prototype incompatibility is a client adaptation task.

CURRENT STATE
The six-entity Phase 1 foundation and GameWorldAdapter remain. Three players select FFighter/MFighter/MMagic; three monsters retain placeholders. All four profiles are at /tests/browser/assetInspection.html during pnpm dev. Profiles use native Hand clips, one-shot/retriggered attacks, identity assembly transforms, preserved metadata and bounds-based UI anchors. The GLBs embed parts, textures and animations. Confirmed grounding dips were repaired locally in seven root-translation channels, with matching copied Blender Actions; all other payload is preserved. Current files were staged with pnpm assets:stage artifacts/asset-integration/repair/converted. Plain pnpm assets:stage restores source-original baselines. All binaries/captures remain ignored; clean clones retain fallback. Baseline: 37 Vitest/9 Playwright. Current typecheck/build/44 unit tests passed; final browser results and defects are in ASSET_AUDIT/VERIFICATION. Inspect actual files before changing them.

INPUTS
Converted assets: C:\laragon\www\lineagen\.assets\converted
Conversion tools/docs: C:\laragon\www\lineagen\.assets\conversion
Prior evidence: C:\laragon\www\lineagen\.assets\evidence

Use existing outputs and tooling first. Keep the source workspace unchanged and write any repair outputs/logs to destination scratch space. Follow the detailed brief for safe offline tool use.

DELIVER
Complete any outstanding acceptance checks from the audit: real skinning/animation, entity behavior, cleanup and fallback. Send actual progress screenshots, including mobile and desktop views. Run required checks sequentially with build/generation, and update Markdown with actual findings. Preserve historical evidence and note that existing conversions already normalized each variant to 1.8 m. This is not a stylesheet overhaul. Keep binaries and asset captures local; do not push or publish them.

PHASE 2
Real M0 networking remains planned: Interlude authentication, character selection and world entry against stock Mobius. Preserve GameWorldAdapter for that integration, but do not implement networking or claim Phase 2 is complete during this asset task.

Complete the detailed brief; report any remaining defect with evidence and the smallest repair needed.
```
