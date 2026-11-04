# Converted-asset integration requirements

This is the detailed scope for the [short handoff prompt](asset-integration-prompt.md). Read [the current roadmap](../docs/ROADMAP.md) for implementation state and the later Phase 2 milestone. These requirements describe pending work; the converted models have not yet been visually verified or integrated in this destination.

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

PRIMARY ARCHITECTURAL REQUIREMENT: Adapt the client code to the existing asset structure. Preserve the original character, equipment, skeleton, attachment, material and animation relationships represented by the source assets and manifests. The prototype loader's current assumptions are replaceable; valid assets are the reference for how the client loads, assembles and animates characters.

## 1. Inspect the existing outputs first

The folder contains MFighter.glb, FFighter.glb, MMagic.glb, FMagic.glb, matching .blend files, and manifests. Check current contents and prior evidence before reconverting anything. A prior structural inspection parsed all four as GLB v2; their visual and animation correctness in this destination remains unverified.

Render candidates using the destination's pinned Babylon.js version. Check geometry, normals, UVs, materials/textures, skeletons, weights, bind pose, animation targets, deformation, scale, orientation, ground contact, root motion, and loading errors. Check independent animation state across multiple instances and actual mobile loading/rendering costs.

Known integration mismatch: the models contain wait_Hand, run_Hand, and Atk01_Hand, while the destination currently recognizes generic clip aliases. Inspect these clips and map the client's idle/run/attack states to the existing names without renaming the asset clips. These names are candidates for the corresponding unarmed states, not a universal mapping for every character or equipment set. Distinguish loader assumptions from conversion defects. The source evidence references Babylon 9.33.0; this destination pins 9.27.1.

## 2. Adapt the client to the asset structure

Document the observed asset layout and assembly rules, then refactor the loader, model descriptors, animation resolver and character assembly around that evidence. Preserve native identifiers, hierarchy, bone names, bind poses, material/texture references, and body/equipment/attachment boundaries where provided. Support separate model and animation resources when the supplied structure uses them; do not require every asset to match the prototype's single-container character contract.

Audit the foundation's forced 1.8-meter height normalization, bounds-based recentering, generic clip aliases, requirement for all three clips in one container, and blanket animation looping. Apply documented coordinate/unit conversion at the assembly root, preserving authored relative proportions, origins, attachment alignment and intended animation behavior. Keep world coordinates in meters. Resolve character/equipment-specific animation families from data where present.

Do not rename or rebake valid clips, rebuild working rigs, flatten useful hierarchy, merge separate equipment into one mesh, or resize every character uniformly just to satisfy existing code. If the converted representation lost required source relationships, document the evidence before requesting a targeted conversion repair. Implement only structures supported by the actual inputs; do not invent a complete equipment/gameplay system.

Keep asset-specific loading and resolution in the presentation layer, with entity lifecycle and semantic state delivered through GameWorldAdapter. Preserve that separation for later real networking.

Additional prototype assumptions identified by read-only source inspection:

- The loader reads one GLB from bytes without an explicit resource base URL. Support the actual folder-relative dependencies and resource organization where present.
- The visual descriptor has a single modelUrl. Extend asset-layer descriptors only as needed to assemble demonstrated parts, equipment, materials and separate animation sources.
- prepareCharacterModel currently replaces mesh metadata with picking data. Preserve imported extras/metadata and add entity picking information without destroying source data.
- The animation driver loops every clip, cannot retrigger the same semantic state and uses one fixed crossfade duration. Derive looping, one-shot/retrigger behavior and transitions from verified native animation semantics.
- Label height, selection-ring size and diagnostic picking points are fixed around placeholder proportions. Derive suitable anchors and bounds from the loaded asset or profile.
- The existing presentation-root parenting preserves internal node hierarchy. Retain that behavior while correcting normalization and assembly assumptions.

## 3. Use existing conversion tooling for demonstrated defects

Read the conversion README.md, BIND_FIX.md, and relevant scripts before running them. Existing tools include convert.py, run_conversion.ps1, validate_glb.py, validate_browser.cjs, and verify_blend_glb.py. Blender is available at C:\laragon\www\lineagen\.assets\tools\blender\blender-5.0.1-windows-x64\blender.exe.

Keep source assets and tooling unchanged. The wrapper defaults to overwriting outputs and writing logs in the source workspace: do not run it blindly. Use destination scratch copies or verified output/log overrides for targeted repairs. Do not start the source application, server, lab, or database. Do not rebuild an existing conversion pipeline unnecessarily.

## 4. Integrate and verify

Replace suitable placeholders with verified models. Preserve the six initial synthetic entities, GameWorldAdapter boundary, editable environment, mobile HUD, targeting, labels, health bars, interpolation, teleports, spawn/despawn, cleanup, and missing-asset fallback. Confirm the real model is active before reporting success. Models without a suitable counterpart may retain placeholders.

Keep imported binaries local and outside tracked files for this task. Do not push or publish binaries. Use pnpm exclusively and strict TypeScript without any.

Send actual screenshots during the work: first textured render, animation/skinning inspection, and integrated mobile and desktop views. Verify preserved proportions, part/attachment alignment and correct native clip selection in addition to the existing behavior checks. Run pnpm typecheck, pnpm build, and appropriate Vitest/Playwright checks. Run build/generation and browser tests sequentially. Record browser errors and checks honestly.

## 5. Correct stale Markdown and preserve Phase 2

Update outdated .md files to match observed results, including docs/ASSET_AUDIT.md with the observed asset structure, exact file paths, client adaptations, clip mapping, conversion repairs, screenshots, checks, and remaining defects. Distinguish client compatibility changes from actual conversion fixes. Preserve historical verification dates and distinguish old evidence from checks you actually run. The user requested stale Markdown fixes, not a CSS/style-file overhaul.

This remains a Phase 1 follow-up. Phase 2 is Real M0 networking: real Interlude authentication, character selection, and world entry against stock Mobius. Keep the replaceable adapter boundary ready for it, but do not implement networking during this asset task. Asset integration does not complete Phase 2.

Deliver working local integration where the assets permit it. For remaining failures, show the specific defect and smallest repair required. Do not stop at a proposal or report a procedural fallback as a successful model import.
