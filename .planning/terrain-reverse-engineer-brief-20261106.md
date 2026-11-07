# Reverse-engineering goal: resolve the native terrain decisions that block a justified browser correction

**2026-11-06 clarification:** 1:1 includes original Interlude audio. Read
[the audio acceptance](../docs/NATIVE_AUDIO.md) and
[continuation](native-audio-continuation.md). Keep terrain moving, preserve
sound/music/region/emitter metadata encountered, and report unresolved audio
rules. The browser owner implements runtime changes. Neither terrain parity
nor audio extraction alone establishes overall 1:1; existing native protection
and capture boundaries remain in force.

Resume the existing terrain goal; do not duplicate it or repeat completed work.
Read the current checkpoint: it may be newer than this morning's snapshot.

## Objective and ownership

Establish the applicable rendering rules for the selected `20_20.unr` section
so the browser agent can choose mask coordinates, retained passes and sampled
pixel behavior without guessing. Separate static conditional behavior from
runtime selection. Hand over an applicable correction as soon as one behavior
is supported; unrelated shader or `bUseAlpha` questions need not all be solved
first. Matching the ordinary formula does not prove the live branch selected it.

The browser project and canonical evidence stay on DATABASE-PC at
`C:\laragon\www\l2-browser-client`. Native reference files remain on IMPORTA-PC
at `C:\Lineage2-client`. Reuse pinned analysis copies and the existing REA/Ghidra
setup under `C:\Users\rolan\l2-research` on PROMINENCE-PC. Preserve the single
REA owner, bounded per-function queries, two logical CPUs, BelowNormal priority,
and existing 1 GiB Node/2 GiB Ghidra heap allowances. These are not total-memory
limits. Check owned processes and receipts before resuming interrupted work.

Babylon may use modern architecture preserving observable results; obsolete
D3D classes/caches/passes are not requirements. Test equivalence explicitly.
Fewer passes do not prove a speedup.

## Read these authoritative references

- [Latest browser coordination](terrain-next-steps-20261106.md).
- [Consolidated native findings](../artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/REPORT.md).
- [Exact remaining dependencies](../artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/EVIDENCE_DEPENDENCIES.md).
- [Minimum draw packet](../artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/DRAW_PACKET.md).
- [Static coordinate binding](../artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/COORDINATE_BINDING_ADDENDUM.md).
- [Independent UV verification](../artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/review/RETAINED_UV_VERIFICATION.md).
- [Separate Babylon recommendations](../artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/BABYLON_RECOMMENDATIONS.md).
- [CPU geometry gate](../artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/native/batch3/GEOMETRY_GATE.md).
- [Browser evidence and validation](../artifacts/native-parity/research/terrain-browser-20261106/REPORT.md), [reference renderer](../tests/browser/terrainLegacyReferenceRenderer.ts), [fixtures](../tests/browser/terrainLegacyReferenceCases.ts), and [unchanged acceptance](../recipes/native-parity.acceptance.json).

Seven native batches were closed at 04:00 Riga; the goal was blocked after three
unchanged audits. A later user reply authorized broader saved-artifact/public
searches. The resumed turn is not evidence of a qualifying capture.

## Retain these proved distinctions

Ordinary UV is `(g + 0.5) / H`. The alternative subtracts
`max(g - 240, 0) / 4096` in the inspected nonnegative range. Ordinary requires
`(GIsL2Seamless == 0 || GIsEditor != 0) && gbStretchTerrainMask == 0`.
Constants and the static FLOAT2 TEXCOORD0 byte-copy chain are proved. The mask
modifier disables transforms, but state overrides and cached pass transfer can
change effective selection. Image defaults are not generation-time values.

The 256x256 section spans X64..112/Y208..255; all 2,352 exported UV pairs match
ordinary. Y crosses the edge. At Y255 the coordinates are 0.998046875 versus
0.994384765625: a source-coordinate difference, not measured screen error. Keep
H as denominator; 512/1024 mask dimensions do not replace it.

All 81 retained diffuse BC1 mips are opaque. That makes diffuse-alpha
multiplication an identity for unchanged source inputs, but does not establish
the separate transparency predicate used for CPU triangle pruning. FirstPass is
the first retained pass. Keep CPU `GetLayerAlpha` classification separate from
GPU mask sampling, preserve ordinary BC1, and apply RGBA4 high-nibble truncation
only for its established upload branch. Equal-channel masks cannot identify
channel selection. Failed configuration lookup preserves the prior Boolean;
missing shader files prove neither active fallback nor unconditional termination.

## Prioritized investigation

1. **Find an existing observation.** Search likely capture/log/cache/export
   locations outside checked research folders on linked machines. Bound the
   filename/metadata search and record roots/filters/exclusions. Reuse negative
   results; avoid dumping personal files or secrets. Hash candidates and qualify
   them against the draw packet. Screenshots/videos do not supply render state.

2. **Find concrete public leads.** Search official tool documentation, source
   implementations and technical research for APIs, cache formats and missing
   read/copy chains. Use Manus for a bounded public question if callable; report
   absence honestly. Preserve URLs, versions, claims and retrieval dates. Other
   L2/UE2 versions remain hypotheses until mapped to our pinned binary. Keep
   private binaries, captures, credentials and invitation keys off external tools.

3. **Qualify the smallest UV packet first.** A native 20_20 draw needs a mapped
   vertex above Y240, actual bytes/declaration/stride, effective mask TEXCOORDINDEX
   and TEXTURETRANSFORMFLAGS, material route/method, active shader objects and
   bound mask identity. Vertex bytes may replace generation-time globals;
   effective state may replace override/cache history. Current globals cannot
   explain an older cached stream. This packet selects UVs, not final pixels.

4. **Extend the applicable branch.** Sampled-pixel evidence needs original and
   uploaded resource IDs, formats/dimensions/mips, sampler/LOD/address/sRGB state,
   blend operation/factors/separate alpha, alpha test/write masks, target format
   and destination/preceding retained passes. If shaders are bound, obtain exact
   program bytes with cache/material/flag/binding provenance. Source files or
   compiler logs alone do not prove selection. A fixed-function draw does not
   require recovering an unselected TerrainMaterial shader first.

5. **Follow a positive `bUseAlpha` anchor.** Require a read of
   `TerrainInfo+0x4b4+layerIndex*0xe8`, mask 1, or a traced copy. Follow both
   successors through reconvergence to rendering behavior. Stored values,
   serialization and scalar-reader calls are not a consumer. The six direct
   GetLayerAlpha callers and reviewed geometry chain are exhausted. No repeated
   scans or speculative helper chase; negative results do not prove non-use.

## If the observation does not exist

Finish authorized discovery/static work, then prepare the smallest concrete
capture proposal: IMPORTA-PC/exact client, tool/version, documented D3D9/x86
support, hook/injection/wrapper/attachment mechanism, required event/resource
fields, storage/overhead, foreground/display needs, file/process changes,
verification and rollback. Do not assume a modern debugger supports this API.

Preparation does not authorize execution. The inherited brief prohibits input,
activation, launch/restart, attachment, injection/hooks, native edits, protected
`l2.ini` content reads, Jump Fluid changes, service/global-runtime changes,
production deployment and browser/Editor modifications. Preserve source/authored
files and workloads. If a necessary step needs a restriction lifted, identify
the exact action and quote/link the controlling brief. New explicit user
direction takes precedence; do not silently broaden permissions.

## Deliverables and completion

Write additive evidence to a named continuation folder on DATABASE-PC, preserving
old reports/pins. Separate native findings from Babylon recommendations. Deliver:

- A decision table: proved rule/branch, hash/VA/file offset or captured event,
  applicability, assumptions, smallest browser consequence and validation case.
- Read-only/repeatable inspection commands, tool versions, host/source paths,
  hashes, original receipts and tiny fixtures. Record failures and exclusions.
- An immediate browser handoff for each supported correction, or why selection
  remains unknown. Source-only edits cannot update the saved Editor material.
  Independent UV fixtures at 240/241/255 remain useful while selection is open.
- A checkpoint with deduplicated bodies and separate discovery/decompilation/
  review/runtime counts; unknown totals stay unknown. Counts alone are no progress.

Complete this research goal only when its required conclusions are supported.
If blocked, report the exact missing artifact and prepared observation proposal,
without calling native parity solved or repeating unchanged searches. Keep
acceptance tolerances, native assets and editor-authored resources unchanged.
No performance gain, 120 FPS, complete-client or Phase 2 networking claim follows.
