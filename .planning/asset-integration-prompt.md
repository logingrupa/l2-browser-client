# Local converted-asset integration handoff

Copy the text below into the session that has access to the conversion tooling. This is a Phase 1 asset follow-up. The current project status and later networking milestone are recorded in [docs/ROADMAP.md](../docs/ROADMAP.md).

```text
Work on the existing browser-based 3D art project. Validate the models already converted locally, integrate working models, and correct stale Markdown documentation.

Destination project:
C:\laragon\www\l2-browser-client

Converted model folder:
C:\laragon\www\lineagen\.assets\converted

Conversion tools and documentation:
C:\laragon\www\lineagen\.assets\conversion

Earlier conversion evidence:
C:\laragon\www\lineagen\.assets\evidence

Begin with a short explanation of what you understand before making changes. Read the destination README.md, PRODUCT.md, docs/ARCHITECTURE.md, docs/ROADMAP.md, and the original Phase 1 brief. The task concerns technical conversion correctness and local integration. Record provenance separately; missing license metadata does not establish a conversion defect.

1. Inspect the existing outputs first

The folder contains MFighter.glb, FFighter.glb, MMagic.glb, FMagic.glb, matching .blend files, and manifests. Check current contents and prior evidence before reconverting anything. A prior structural inspection parsed all four as GLB v2; their visual and animation correctness in this destination remains unverified.

Render candidates using the destination's pinned Babylon.js version. Check geometry, normals, UVs, materials/textures, skeletons, weights, bind pose, animation targets, deformation, scale, orientation, ground contact, root motion, and loading errors. Check independent animation state across multiple instances and actual mobile loading/rendering costs.

Known integration mismatch: the models contain wait_Hand, run_Hand, and Atk01_Hand, while the destination currently recognizes generic clip aliases. Inspect these clips and implement an explicit idle/run/attack mapping. Distinguish loader assumptions from conversion defects. The source evidence references Babylon 9.33.0; this destination pins 9.27.1.

2. Use existing conversion tooling when a repair is needed

Read the conversion README.md, BIND_FIX.md, and relevant scripts before running them. Existing tools include convert.py, run_conversion.ps1, validate_glb.py, validate_browser.cjs, and verify_blend_glb.py. Blender is available at C:\laragon\www\lineagen\.assets\tools\blender\blender-5.0.1-windows-x64\blender.exe.

Keep source assets and tooling unchanged. The wrapper defaults to overwriting outputs and writing logs in the source workspace: do not run it blindly. Use destination scratch copies or verified output/log overrides for targeted repairs. Do not start the source application, server, lab, or database. Do not rebuild an existing conversion pipeline unnecessarily.

3. Integrate and verify

Replace suitable placeholders with verified models. Preserve the six initial synthetic entities, GameWorldAdapter boundary, editable environment, mobile HUD, targeting, labels, health bars, interpolation, teleports, spawn/despawn, cleanup, and missing-asset fallback. Confirm the real model is active before reporting success. Models without a suitable counterpart may retain placeholders.

Keep imported binaries local and outside tracked files for this task. Do not push or publish binaries. Use pnpm exclusively and strict TypeScript without any.

Send actual screenshots during the work: first textured render, animation/skinning inspection, and integrated mobile and desktop views. Run pnpm typecheck, pnpm build, and appropriate Vitest/Playwright checks. Run build/generation and browser tests sequentially. Record browser errors and checks honestly.

4. Correct stale Markdown and preserve Phase 2

Update outdated .md files to match observed results, including docs/ASSET_AUDIT.md with exact file paths, findings, clip mapping, repairs, screenshots, checks, and remaining defects. Preserve historical verification dates and distinguish old evidence from checks you actually run. The user requested stale Markdown fixes, not a CSS/style-file overhaul.

This remains a Phase 1 follow-up. Phase 2 is Real M0 networking: real Interlude authentication, character selection, and world entry against stock Mobius. Keep the replaceable adapter boundary ready for it, but do not implement networking during this asset task. Asset integration does not complete Phase 2.

Deliver working local integration where the assets permit it. For remaining failures, show the specific defect and smallest repair required. Do not stop at a proposal or report a procedural fallback as a successful model import.
```
