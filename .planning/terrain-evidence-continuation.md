# Continue terrain evidence and browser validation

Current Editor follow-up: [visible Play recovered](../artifacts/native-parity/editor/play-viewport-20261106/REPORT.md)
by full Dashboard reopen. All 2,248 current authored files unchanged; final build
and two affected browser checks pass. Original lifecycle cause, raw Play UV2
omission and raw Editor readiness remain explicit limits. Earlier blank-current-
viewport statements below are historical; no terrain migration was repeated.

Goal: establish the native terrain's observable rendering rules, apply only
demonstrated corrections to `l2-browser-client`, and measure modern alternatives
against a supported reference. Native pass organization is evidence, not a
requirement to retain obsolete architecture in the final client.

Project: `C:\laragon\www\l2-browser-client` on DATABASE-PC.

## Current implementation checkpoint — 2026-11-06

The final primary packet and all 54 payloads were verified. The narrow correction
is implemented and validated locally in source GLB, saved Editor geometry/proof
and public export. Read the [implementation report](../artifacts/native-parity/research/terrain-uv-migration-20261106/implementation/REPORT.md),
its final-state receipt and reproduction commands. This supersedes the earlier
awaiting-evidence, ordinary-only and no-production-migration checkpoints below.

Exactly 735 V scalars / 1,078 bytes change once. Corrected primary UV is
`d549356ff531e4271099c2097807eec899cc45eb96d512be04b03855d558963d`;
saved/export geometry is
`549a7fef8316ed66b718f907ad2837a78e818d1e6740d9690200d1d5cd15ab05`.
All U, V at Y<=240, UV2 and other bytes remain unchanged. Only the mesh reference
and primary-UV proof differ among 1,684 original authored files; original and
historical intermediate binaries remain. Source staging retains 931 of 939
files identically, with eight intended terrain/metadata differences. No shader
correction, decoder change or CPU/GPU-policy conflation was introduced.

Required 44 GPU cases and focused12 units pass, along with broader relevant
49+6 units, 27+8 pipeline cases, five browser regressions and build/typecheck.
Source/saved desktop/mobile before/after pairs have identical camera/viewport/
renderer, ready visible terrain and no errors. Current Editor5.5.3 save/rebuild
preserves the correction with existing UV2 recovery, but its additional Play
viewport was blank. Direct Play also emitted public data without UV2; final
project generate/build restores the reviewed export. Do not mistake successful
save/rebuild for a passed current Editor visual check.

The native submissions are OFFSCREEN. Submitted coordinates/resources/configured
state are qualified; visible native pixels, screen improvement and full parity
are not. bUseAlpha, CPU pruning, composition and lighting remain open. Audio is
mandatory and was not re-certified by this graphics correction. Continue it
from `.planning/native-audio-continuation.md` with native policy gaps explicit.
The single native pilot is consumed and the client closed; no retry/replay/
observer/supervision request follows. See the updated next-prompt file for
remaining work. Do not reapply the migration or repeat completed evidence work.

## Earlier owner-reported checkpoint — 2026-11-06

The user relayed new native trace evidence: 100 exact XYZ matches across all
five retained 20_20 target positions above Y240, among 5,761 vertex-buffer copies
through call 650000. Candidate TEXCOORD0 at byte +28 matches the alternative
formula for Y241, Y248 and Y255. Upload 649 targets VB `0x12afc480`; call 654
explicitly binds stride 36, offset 0, with draws from call 655 onward. These are
owner-reported observations, not independently qualified browser-side findings.

Production correction remains gated: actual declaration, indexed vertex
references, effective sampled coordinates and bound-mask qualification are still
being established by the sole trace owner. Preserve current ordinary UVs,
ordinary BC1 decoding and the separation of CPU GetLayerAlpha from GPU sampling.
Do not infer effective mask sampling from matching uploaded bytes alone.

The one approved native pilot is consumed and the client is closed. Earlier
unused-launch/supervision-pending notes are superseded. Do not launch a retry,
ask for supervision again, or duplicate the owner's trace analysis. This changes
no browser-owner runtime restrictions and grants no audio observation permission.

The conditional geometry and saved-primary-UV-proof migration remains in
`artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/uv-draw-handoff-20261106/BROWSER_FIX_HANDOFF.md`.
Apply it only after a qualifying packet; preserve diffuse UV2 and all unrelated
authored channels. Do not edit the retained research packet to rewrite its
historical checkpoint. Audio remains mandatory and unresolved; continue from
`.planning/native-audio-continuation.md` independently of this graphics gate.

Read these before changing terrain:

- `artifacts/native-parity/research/terrain-mask-native-rea-followup/coverage-20261106/PROMPT_BROWSER.md`
- Its five linked native reports/proposals.
- `artifacts/native-parity/research/terrain-browser-20261106/EVIDENCE_TO_CODE.md`
- The current `REPORT.md` in that last directory, when present.
- `docs/ASSET_AUDIT.md`, `docs/VERIFICATION.md`, and `docs/ARCHITECTURE.md`.

The latest handoff explicitly prohibits native runtime manipulation, service
changes and production deployment. Preserve unrelated dirty files, source assets,
protected INI, Jump Fluid, Editor edits and acceptance tolerances. Local isolated
test processes must stop after verification. Do not deploy the staged startup
fix while this restriction applies.

## What the handoff already established

- CPU `GetLayerAlpha` classifies retained regions/layers. Its DXT white scalar
  249 and mixed-region sentinel 100 are not GPU blend weights. Ordinary BC1 stays.
- The successful legacy method-2 bitmap branch samples mask alpha and multiplies
  diffuse alpha only when `IsTransparent` (`texture+0x5c0 & 3`) is true.
- FirstPass is the first retained layer, not necessarily authored layer zero.
- Later passes use SRCALPHA/INVSRCALPHA and GREATER-zero alpha test. Actual
  BLENDOP, separate-alpha state and target precision remain unknown.
- High-nibble truncation is proved only for the conditional A4R4G4B4 upload.
- Exact selected shader, current renderer branch/draw state, mask UV phase and
  `bUseAlpha` consumer remain unresolved. Equal-channel inputs cannot identify
  which native channel was selected.

## Browser audit and ownership

`nativeTerrainPreview.ts` is an explicitly unverified fused candidate. It keeps
CPU classification separate, decodes source PNG without premultiplication and
packs only equal RGBA masks of compatible dimensions. It uses bilinear mip0,
geometry mask UV, ordered RGB mixing and fixed output alpha 1.

The `authored=1` route uses the saved Editor ShaderMaterial. Editing the source
candidate alone does not update it. Any supported future correction requires a
reviewable material migration preserving unrelated authored edits.

All nine retained diffuse BC1 textures are opaque across all 81 authored mips:
786,429 in-bounds texels, zero transparent selectors. Source mip hashes were
verified. Conditional diffuse-alpha multiplication is an identity for these
inputs; different runtime resources or upload transformations remain unproved.

Baseline screenshots/hashes are in `terrain-browser-20261106/baseline`. These
are staged browser WebKit captures, not matched native parity. Existing terrain
and upload calculators reproduced their pinned results; 51 focused terrain and
authored-material unit tests passed before the isolated reference experiment.

The reference is now implemented under `tests/browser/terrainLegacyReference*`:
20 GPU cases passed in the shared browser on the real GTX 1060, with physical
RGBA8 passes and actual conditional RGBA4 upload. A standalone Playwright run
passes 1/1 test covering the same 20 cases using SwiftShader. Focused units now
pass 57/57; strict typecheck passes. Results, actual per-pass GL state/readbacks,
desktop/mobile screenshots and cleanup are in the report/validation directory.
Expected bytes and a one-byte synthetic UNORM allowance were fixed before GPU
execution, unchanged afterward; native acceptance tolerances were not edited.
No current game material was changed. All 13 baseline and 1,684 authored files
still match; the temporary fixture server was stopped and shared tab closed.

New source-specific UV evidence is in `terrain-uv-inputs.json`: X64..112,
Y208..255 on a 256x256 heightmap, all 2,352 exported pairs match the candidate
formula. There are 49 vertices at Y240 and 735 beyond it. The ongoing native
report at `continuation-20261106-ongoing/coordinates/COORDINATE_RETAINED_FINDINGS.md`
locates GenerateTriangles vertex writes and conditional corrections from 240.
Global values, constant bytes and stream/state joins remain unresolved at this
checkpoint. Do not infer false globals from absent TerrainInfo property tags.

## Focused prompt for the reverse-engineering agent

Continue your existing research goal and reuse completed receipts, pinned
PROMINENCE-PC tools and resource limits. Prioritize the smallest packet that
unlocks a justified terrain correction:

1. Prove mask-coordinate generation/phase for the 512x512 P8 and 1024x1024 BC1
   masks. Preserve ToMaskmap/ToWorld/Scale. The browser currently uses
   `(gridXY + 0.5) / heightmapDimensions`; determine whether this differs from
   the applicable native branch. Give tiny cases at centers, edges and halves.
2. Identify an existing qualifying terrain draw/resource packet selecting the
   route, material method, retained layers/FirstPass and bound resources. Include
   BLENDOP 171, factors 19/20, separate-alpha 206..209, alpha test, target format,
   upload dimensions/formats/mips, MIN/MAG/MIP/address/LOD/sRGB states. Historical
   L2Shader OFF and config values are not a current observation. If no packet
   exists, state precisely what is missing; do not obtain it through new hooks,
   injection, input, attachment, restarts or other runtime manipulation.
3. Recover the exact selected shader/cache program and bindings if that route
   applies. Follow already identified file-manager/cache joins, not repeated
   broad scans. Missing HLSL files do not establish active fallback behavior.
4. Find a verified read of bUseAlpha at layer+0xe4, mask 1, stride 0xe8, and both
   successors to a rendering decision. Do not invent channel semantics.

Diffuse-flag/default provenance remains useful but is lower priority for this
dataset because every retained diffuse mip is opaque. Preserve CPU/GPU separation.
Deliver additive evidence with binary hashes, instruction anchors, exact branch
predicates, reproducible tiny fixtures, and a separate Babylon recommendation.
No native renderer parity or speedup claim without qualifying measurements.

The user authorized direct coordination with the existing IMPORTA-PC thread:
<t3-thread://v2/20b54a96-ad0d-46e3-9eec-9f7158c0978f/28fd5fa6-471f-4127-aa36-31c7add4bae0>

Three focused messages have already been delivered; read recent activity before
sending another. Do not create duplicate investigations or restart the thread.

## Larger work still open

The startup root-cause fix is verified in
`artifacts/private-preview/native-reveal/dist-stage`; the live private URL still
has the previous build. Native startup allocates no procedural actor stand-ins,
requires real world/actors/equipment and a completed ready frame, and reports
required-resource failures. All 1,684 authored files survived unchanged.

Asset coverage, complete native attack/Power Strike parity, Editor acceptance
and GTX 1060 performance remain separate unfinished requirements. No 120 FPS or
complete-client claim is supported. Phase 2 Mobius networking stays planned.
