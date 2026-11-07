# Native asset pipeline acceptance

## Rendering direction clarification — 2026-11-07

[RENDERING.md](RENDERING.md) is the current implementation direction: preserve
the required visible/gameplay results with modern Babylon.js WebGPU rendering.
The fixed acceptance contract below remains unchanged. It does not require
recreating old Direct3D architecture, state machinery or numerical quirks when
they have no demonstrated effect on required output.

Begin profiling and bounded optimization on the currently supported slice while
remaining migration and native-reference work continues. Keep source assets and
authored work intact; optimized LOD/texture derivatives must be traceable and
must pass the applicable fidelity checks. Development baselines with partial
content do not replace the complete performance workload below. Whole-client
parity is not a prerequisite for improving the current renderer.

Editor follow-up, 2026-11-06: [actual Play is visibly recovered](../artifacts/native-parity/editor/play-viewport-20261106/REPORT.md)
after normal project-close/Dashboard/reopen, with all 2,248 asset/project files
unchanged. Final build and affected desktop/mobile checks pass. This supersedes
blank-current-viewport statements below, but not the unresolved lifecycle cause,
raw Play UV2 omission/readiness, native parity or original-audio requirements.
No code repair or terrain remigration was performed in that follow-up.

**Scope clarification, 2026-11-06: 1:1 includes original Interlude audio.**
[NATIVE_AUDIO.md](NATIVE_AUDIO.md) defines mandatory music, ambience, footsteps,
voices/actions, combat/skill/weapon and UI coverage with native timing,
selection, mixing and spatial evidence. The additive
[audio contract](../recipes/native-audio.acceptance.json) supplements the
unchanged visual/performance tolerances below. The world source-cue preview now
contains six death and three Musveren attack cues; [its report](../artifacts/native-parity/research/native-action-audio-20261107/REPORT.md)
records current output validation. One specialized attack event and other audio
categories and native playback rules remain incomplete; exports/decoding and
inspector playback cannot pass overall 1:1. See NATIVE_AUDIO.md for current scope.

## Scoped submitted-coordinate milestone — 2026-11-06

The [terrain UV implementation](../artifacts/native-parity/research/terrain-uv-migration-20261106/implementation/REPORT.md)
is locally applied and verified across the source GLB, saved Editor and exported
public routes. It changes **735 primary V fields** once while preserving every
U, diffuse UV2 and unrelated authored geometry. Converter/runtime, unit, GPU,
browser and build checks pass; [VERIFICATION.md](VERIFICATION.md) records counts.
This supersedes the pending UV decision for the retained `20_20` scope only.

The native evidence consists of **offscreen submissions**: indexed geometry,
corrected UVs, source masks and configured coordinate state. It does not provide
visible native pixels, a screen-improvement comparison or full visual parity.
Matched browser before/after images do not fill that native-reference gap.
The pilot's unresolved descendant-path check and unestablished writer count
remain limitations; this implementation performed no native action.
The single approved pilot is consumed; this checkpoint grants no new launch,
replay or observer permission.

Actual Editor 5.5.3 save/rebuild preserved the correction and recovered known
UV2 loss. Play was blank at that checkpoint; the later recovery above establishes
visible Play after reopening, while its lifecycle cause and raw UV2 loss remain
open. Final composition, CPU pruning, bUseAlpha, full Editor
acceptance, mandatory original audio and performance remain unresolved. Audio
was not re-audited in this graphics checkpoint. No acceptance tolerance changed,
and no deployment, networking completion, 120 FPS or overall 1:1 claim follows.

The tracked goal started on 2026-11-05 extends the existing native pipeline in `scripts/`, its `recipes/`, and the Babylon Editor Vanilla project. Existing character, world, package-inspector and synthetic adapter work must be preserved. No `AGENTS.md` was found in the project or its `C:/`, `C:/laragon/`, and `C:/laragon/www/` ancestors at initial inspection.

The earlier **raw, reusable programmatic migration first** priority established
the conversion foundation. `pnpm assets:migrate` covers that milestone and can
continue while a complete native attack reference is missing. Under the current
rendering direction it does not defer baseline measurement or bounded optimization
of supported content. Fixed visual tolerances and the full tracked goal remain
unchanged. See [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md) for commands and coverage.

The authoritative reference is IMPORTA-PC's `C:/Lineage2-client`, controlled with `C:/Lineage2-client-support/debug-control/Control-L2.ps1`. Keep Jump Fluid active and preserve native files, especially protected `system/l2.ini`. The previously catalogued `E:/Lineage2-client` on DATABASE-PC is a reusable input only after its dependencies are compared with the reference host and that provenance is recorded. Package filenames and similarly named assets do not establish equality.

## Fixed acceptance contract

[`recipes/native-parity.acceptance.json`](../recipes/native-parity.acceptance.json) defines the cases, tolerances and performance workload before new implementation. Every result must record this file's SHA-256. Do not relax its thresholds in response to a failure. Missing or uncertain evidence is **unverified**, never a pass.

Complete source-backed Human male fighter equipment/animation, Greater Musveren (`LineageMonsters.field_stalker_m00`) including death, Power Strike skill 3 with coordinated motion/effect, and a declared representative section of `20_20.unr`. Full native attack motion must be established first. Prior skill-viewer VFX playback with an idle avatar is insufficient.

Keep raw native and browser recordings, actual frame timestamps, client viewport/camera/lighting/equipment information, and the single recorded calibration/time offset. Do not warp individual frames, hide mismatches, or substitute repeated screenshots for video. A recorded operating-system border may be removed using the fixed client rectangle. Full-frame metrics remain available even when additional silhouette, landmark or stochastic-particle measurements are used. Unmatched lighting or obstructed required landmarks prevent visual certification.

The pixel tolerances scale linearly with viewport height relative to 1080 pixels. Source geometry/key tolerances are independent of viewport. Particle validation uses at least five native repetitions and declared browser seeds to compare timing and spatial distributions; individual native random particles need not coincide. Unsupported blend, shader, emitter, animation or actor behavior must be visible in coverage reports.

## Performance protocol

Benchmark DATABASE-PC's GTX 1060 at 1920 x 1080, DPR 1. Run the identical scene/camera/seed/input workload before and after optimization, with 32 actors and eight simultaneous Power Strike effects repeating every two seconds. Each of three trials uses 15 seconds of warmup and 90 seconds of measurement. Do not record video during a performance trial.

Record actual frame intervals, median/p95, measured FPS, available CPU/GPU timings, draw calls, triangles, load time, transfer bytes and memory (with measurement source and limitations). Record GPU/driver, browser build/flags, acceleration, foreground state, refresh rate, vsync and throttling. Software-rendered preview results cannot qualify the GTX 1060 target. Jump stream FPS does not measure rendering performance.

The target is sustained 120 FPS with an exact `1000/120` ms frame budget. Normal presentation acceptance requires an active supported display of at least 120 Hz. Initial inspection found the current AOC display at 1920 x 1080/60 Hz, with no advertised mode above 75 Hz and no active virtual display. Until a supported 120+ Hz display is available, collect separately labeled workload timings and report the presentation limit without estimating a pass. Compare native/browser speed only on the same machine under the same conditions.

The user reports IMPORTA-PC has a 144 Hz display and authorizes its use for later tests. Verify the active mode and acceleration when testing. RTX 4090 results characterize IMPORTA-PC only; they cannot certify the GTX 1060 target. No display configuration was changed during raw migration.

## Editor and reproducibility

Use the actual Babylon Editor 5.5.3 desktop application. Verify opening the existing project, changing equipment, animation, effect timing, material and camera, saving/reopening, rebuilding, and observing those saved changes in the browser. An automated packer test or a hand-edited JSON file alone is not an Editor round trip. Generated assets must not overwrite authored edits.

Extend the existing content-addressed pipeline and pinned tools. Provide one documented command covering inventory, conversion, validation and benchmark stages. Demonstrate a clean repeat build with matching outputs and unchanged conversion cache hits. Keep source textures/editable data and compressed derivatives distinct. Batch only supported asset routes after the slice works; publish coverage and explicit gaps, not a complete-client claim.

Networking remains outside this asset goal. Preserve `GameWorldAdapter` for the planned Interlude authentication/selection/world-entry work.

## Current native attack observation — 2026-11-05

The supported console command `ANIMPLAY ANIM=Atk01_Hand_MFighter` now has live
evidence: repeated windup, strike and recovery on the visible male fighter,
followed by verified explicit `Wait_Hand_MFighter` idle. Literal command text
was photographed before Enter. Evidence is in
`artifacts/native-parity/reference-current/animplay-20261105-20261105-200102/`.
All 48 protected source files retained their hashes, lengths and attributes;
82 evidence files were copied and hash-verified on DATABASE-PC.

The recording contains **33 decoded frames / 7.966667 seconds = 4.142 captured
FPS**, with 233–267 ms gaps. It establishes visible full attack phases but
**fails the fixed 30 FPS reference requirement**. Native playback multiplier,
exact onset/impact, equipment IDs, camera/location and coordinated Power Strike
remain unverified. Follow-up backend diagnostics found GDI near 4 FPS, stalled
DXGI duplication, and `gfxcapture` at **25 distinct frames / 3.004787 seconds =
8.320 FPS**, with median/p95 source gaps **124.846 / 125.701 ms**. These do not
meet the fixed reference gate. The 150 copied/hash-verified files remain in
`reference-current/cadence-repair-20261105-20261105-201418/` beneath the evidence root.

The subsequent display check found L2 absent and a spreadsheet foreground on
IMPORTA-PC. It stopped before input. The active mode was **2560×1440 at 59 Hz**;
a supported 120 Hz mode was found but never selected. No recording or cadence
measurement was attempted. All 48 protected files and Jump remained preserved;
41 evidence files were copied/hash-verified into
`artifacts/native-parity/reference-current/display-cadence-20261105-20261105-204351/`.
No capture task remains active. Requested/nominal recording rate is never
substituted for decoded cadence.
