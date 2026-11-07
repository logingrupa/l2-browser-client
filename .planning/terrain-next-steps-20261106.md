# Terrain next steps — checked 2026-11-06 07:13 Europe/Riga

**Later scope clarification:** the user's 1:1 requirement includes original
Interlude audio. [Audio continuation](native-audio-continuation.md) records the
mandatory categories, current disconnected-world gap and browser ownership.
Continue this terrain task; a terrain result alone cannot establish overall
parity. Preserve any sound/region/emitter identities encountered in research.

Latest [pilot checkpoint](../artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/apitrace-pilot-20261106/BROWSER_HANDOFF.md):
47 synthetic recovery checks pass; the native launch remains unused pending
supervisor readiness. Its existing owner retains the single approved pilot.
The [saved-geometry handoff](../artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/uv-draw-handoff-20261106/BROWSER_FIX_HANDOFF.md)
requires any later qualified UV correction to update primary-UV proof and the
saved binary reference together, preserving diffuse UV2 at byte129428 and other
authored channels. No qualifying draw or production correction exists yet.
The separate ambient raw-data correction preserves those terrain file pins.

This status update supersedes the unresolved constant/static-binding statements
in the earlier `terrain-evidence-continuation.md` and the 01:00-era
`terrain-browser-20261106` reports. Preserve those reports and their hash receipts
as historical evidence; they were accurate at their checkpoint.

## Current research state

The canonical native checkpoint under
`artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing`
was delivered around 04:00 Riga. Seven native batches are complete, their REA
sessions closed, and the research goal was marked blocked after three unchanged
dependency audits. It is not solved.

The existing IMPORTA-PC thread started a new turn after the user's 07:08 reply
permitting broader resource/public-source searches. At the current read it was
running and searching for saved captures outside the research folders and
public sources. No new qualifying draw or changed terrain conclusion was yet
reported. This live thread state is newer than the blocked-status Markdown; it
does not itself remove the evidence dependency or prove a new native session.

Thread:
<t3-thread://v2/20b54a96-ad0d-46e3-9eec-9f7158c0978f/28fd5fa6-471f-4127-aa36-31c7add4bae0>

## What is now proved

Read the consolidated `REPORT.md`, `BABYLON_RECOMMENDATIONS.md`,
`COORDINATE_BINDING_ADDENDUM.md`, `review/RETAINED_UV_VERIFICATION.md`,
`EVIDENCE_DEPENDENCIES.md` and `DRAW_PACKET.md` in that canonical directory.

- Ordinary generated coordinate: `(grid + 0.5) / heightmapDimension`.
- Alternative: ordinary minus `max(grid - 240, 0) / 4096` in the inspected
  nonnegative range. Constants and instruction operands are retained.
- Ordinary requires `(GIsL2Seamless == 0 || GIsEditor != 0) &&
  gbStretchTerrainMask == 0`. Image defaults do not establish generation-time
  values.
- Generated float bytes reach FLOAT2 TEXCOORD0 at offset 28, stride 36. The
  successful legacy method-2 mask modifier requests coordinate 0 with transforms
  disabled. Pass transfer can override the index to 1, and its cache guard can
  retain earlier state. Therefore the static chain is proved conditionally;
  effective current sampling remains unknown.
- Our selected grid X64..112/Y208..255 reaches the conditional edge along Y.
  All 2,352 converted pairs match the ordinary formula. This is not evidence
  that the current native session selected that branch.
- Native CPU geometry pruning is distinct from GPU blending. The opaque source
  diffuse audit makes the alpha product an identity but does not establish the
  transparency predicate used to omit earlier triangles or the retained passes.
- Failed URL/L2Shader lookup preserves its previous output. Missing shader files
  prove neither selected fallback behavior nor an unconditional fatal error.

## Browser follow-up completed after this status check

The [conditional UV report](../artifacts/native-parity/research/terrain-uv-reference-20261106/REPORT.md)
now records **44/44 synthetic GPU cases on the GTX 1060**, including the 24
planned UV cases, strict typecheck, 12 focused unit passes and a passing
Playwright check of all 44 cases. A separate read-only source-mask audit finds
seven of nine masks differ at Y>240 and reproduces 55 outputs byte for byte.
Production terrain, acceptance and 1,684 authored files are preserved. No
production branch choice or native runtime action followed. The native thread
status above remains the 07:13 observation, not a fresh poll.

The retained plan below describes the now-completed fixture work. Next browser
implementation depends on applicable native evidence described in the final
section; do not rerun passing tests or replace production UVs merely to make
progress.

### Original browser plan (completed)

Add named ordinary/corrected UV cases to the existing isolated
`tests/browser/terrainLegacyReference*` fixture. Test grid 240, 241 and 255 with
512/1024 masks, using heightmap dimensions as the denominator. Keep the branch
selection explicit and preserve existing expected-byte and native acceptance
tolerances. The current source/Editor terrain remains unchanged.

At grid 255 on this heightmap the exact source coordinates are 0.998046875 and
0.994384765625. Their difference is 15/4096, corresponding to 1.875 source texels
on a 512 mask or 3.75 on a 1024 mask. These are coordinate calculations, not
measured screen errors. The existing renderer takes UV rows explicitly, so this
test needs no new production renderer or converted asset repair.

At the original status-check checkpoint the reference had 20 passing GPU cases
and 57 focused unit tests. The later 44-case result uses a different 12-test
focused unit selection, documented in the linked report; it is not a rerun of
the full previous selection.

## What unlocks a production choice

An existing qualifying 20_20 draw must identify a mapped vertex above Y240,
vertex bytes/declaration/stride, effective mask-coordinate and transform state,
material route, active shader objects and bound mask identity. Captured vertex
bytes can substitute for generation-time globals. Effective stage state can
substitute for reconstruction of cached transfers. Public documentation or a
different client's shader alone cannot establish these exact-client bindings.

Full pixel comparison additionally needs upload/mip/sampler/blend state, target
format and destination or retained pass sequence. The exact selected shader
and a positive bUseAlpha read/copy followed through both rendering successors
are still missing. Repeating completed broad scans supplies none of these.

After applicability is established, implement the smallest correction in both
the source path and a reviewable Editor material/geometry migration, preserving
authored edits. Then capture before/after at unchanged tolerances. Optimization
and measured performance follow a supported baseline.

The existing browser handoff still prohibits native runtime manipulation,
service changes and production deployment. The startup root-cause fix remains
staged, absent from the private live build. Phase 2 networking remains planned.
