# Native parity acceptance

This doc holds the fixed native-parity acceptance contract and the performance protocol. It also covers the rules for capturing native references on IMPORTA-PC. For status and work order, see [.planning/STATE.md](../.planning/STATE.md) and [.planning/ROADMAP.md](../.planning/ROADMAP.md). For the evidence index, see [VERIFICATION.md](VERIFICATION.md).

## Where this contract applies

Work runs breadth-first (DEC-OWN-1). Stage A (Phases 1 to 3) converts the whole client into the offline sandbox. Stage B (Phase 4) adds the server adapter. Phases 5 and 6 are the polish stage.

- Stage A bar per part (DEC-OWN-3): converted, loads in the offline sandbox, and passes a side-by-side screenshot or listen check against L2.exe on IMPORTA-PC (CHECK-01). A part that fails is listed as a gap.
- The fixed contract and the performance protocol below are the polish-stage goal (POL-01, POL-02, PERF-01, PERF-02, EDIT-02). Their thresholds are never relaxed (DEC-PARITY-1).
- Unverified is never a pass, at any stage.

[RENDERING.md](RENDERING.md) sets the rendering direction. Preserve the required visible and gameplay results with modern Babylon.js WebGPU rendering. Old Direct3D architecture, state machinery and numerical quirks are not requirements unless they have a demonstrated effect on required output.

Profiling and bounded optimization may run on the supported slice now (DEC-PARITY-2). Optimized LOD and texture derivatives must be traceable to their sources and pass the applicable fidelity checks. Development baselines with partial content do not replace the full performance workload below.

## Reference host

IMPORTA-PC `C:/Lineage2-client` is the authoritative reference (DEC-OWN-2). All L2.exe comparisons run there. It is a modified third-party Interlude client, not an untouched official build.

- `E:/Lineage2-client` on DATABASE-PC is a conversion source only after the one-time full-tree hash lock proves it equal (FOUND-03). Package filenames and similar asset names do not establish equality.
- Control the client with `C:/Lineage2-client-support/debug-control/Control-L2.ps1`.
- Keep Jump Fluid active. Preserve native files, especially the protected `system/l2.ini`.
- Native client facts: ssh `fleet-importa-pc`, T3 thread 28fd5fa6 on env 20b54a96. The T3 native project ID is `127893ff-4129-478c-9841-f36a4c9b3405`.

## Fixed acceptance contract

[`recipes/native-parity.acceptance.json`](../recipes/native-parity.acceptance.json) defines the cases, tolerances and performance workload. Every result records this file's SHA-256. Do not relax its thresholds in response to a failure. Missing or uncertain evidence is unverified, never a pass.

The four fixed visual cases:

- Human male fighter equipment and animation, from source.
- Greater Musveren (`LineageMonsters.field_stalker_m00`), including death.
- Power Strike skill 3 with coordinated motion and effect.
- A declared representative section of `20_20.unr`.

Full native attack motion must be established first. Skill-viewer VFX playback on an idle avatar is not enough.

### Recording rules

- Keep raw native and browser recordings and actual frame timestamps.
- Record client viewport, camera, lighting and equipment.
- Record one calibration or time offset. Do not warp individual frames.
- Do not hide mismatches. Do not substitute repeated screenshots for video.
- A recorded operating-system border may be removed using the fixed client rectangle.
- Full-frame metrics stay available, even when silhouette, landmark or stochastic-particle measurements are added.
- Unmatched lighting or obstructed required landmarks prevent visual certification.
- Requested or nominal recording rate never stands in for decoded cadence.

### Tolerances

- Pixel tolerances scale linearly with viewport height relative to 1080 pixels.
- Source geometry and key tolerances do not depend on viewport.
- Particle validation uses at least five native repetitions and declared browser seeds. It compares timing and spatial distributions. Individual native random particles need not coincide.
- Unsupported blend, shader, emitter, animation or actor behaviour must be visible in coverage reports.

### Audio

1:1 includes original Interlude audio. [NATIVE_AUDIO.md](NATIVE_AUDIO.md) defines the required coverage and its current state. The additive [audio contract](../recipes/native-audio.acceptance.json) supplements the visual and performance tolerances here (POL-02). Exports, decoding and inspector playback alone cannot pass overall 1:1.

## Performance protocol

Benchmark the GTX 1060 on DATABASE-PC at 1920 x 1080, DPR 1.

- Run the identical scene, camera, seed and input workload before and after optimization.
- Workload: 32 actors and eight simultaneous Power Strike effects, repeating every two seconds.
- Three trials. Each uses 15 seconds of warmup and 90 seconds of measurement.
- Do not record video during a performance trial.

Record actual frame intervals, median and p95, measured FPS, available CPU and GPU timings, draw calls, triangles, load time, transfer bytes and memory, with measurement source and limitations. Record GPU and driver, browser build and flags, acceleration, foreground state, refresh rate, vsync and throttling.

Software-rendered preview results cannot qualify the GTX 1060 target. Jump stream FPS does not measure rendering performance.

The target is sustained 120 FPS with an exact `1000/120` ms frame budget. Presentation acceptance needs an active supported display of at least 120 Hz. The AOC display on DATABASE-PC runs 1920 x 1080 at 60 Hz, with no advertised mode above 75 Hz and no active virtual display. Until a supported 120+ Hz display is available, collect separately labelled workload timings and report the presentation limit. Do not estimate a pass.

IMPORTA-PC has a 144 Hz display, authorized for tests. Verify the active mode and acceleration when testing. RTX 4090 results characterize IMPORTA-PC only and cannot certify the GTX 1060 target. Compare native and browser speed only on the same machine under the same conditions.

## Reproducibility

- Extend the existing content-addressed pipeline and pinned tools.
- One documented command covers inventory, conversion, validation and benchmark (EDIT-02).
- A clean repeat build reproduces matching outputs with unchanged conversion cache hits.
- Keep source textures and editable data distinct from compressed derivatives.
- Publish coverage and explicit gaps, not a complete-client claim.

Babylon.js Editor is an optional viewer and not a gate (DEC-OWN-8). See [EDITOR_VIEWER.md](EDITOR_VIEWER.md). Commands and coverage for the conversion are in [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md).

## Terrain UV state for 20_20

The terrain UV correction is applied and verified for the retained `20_20` scope. It changes 735 primary V fields once. It preserves every U, the diffuse UV2 and unrelated geometry. Converter, runtime, unit, GPU, browser and build checks pass. [VERIFICATION.md](VERIFICATION.md) records the counts.

The native evidence is offscreen submissions: indexed geometry, corrected UVs, source masks and configured coordinate state. It provides no visible native pixels and no screen comparison. Matched browser before/after images do not fill that gap.

Evidence: `artifacts/native-parity/research/terrain-uv-migration-20261106/implementation/REPORT.md`.

## Native attack observation

The supported console command `ANIMPLAY ANIM=Atk01_Hand_MFighter` has live evidence on IMPORTA-PC. It shows repeated windup, strike and recovery on the visible male fighter, then explicit `Wait_Hand_MFighter` idle. The evidence includes a photo of the literal command text before Enter. All 48 protected source files kept their hashes, lengths and attributes. The 82 evidence files are copied and hash-verified on DATABASE-PC.

- Evidence: `artifacts/native-parity/reference-current/animplay-20261105-20261105-200102/`.
- The recording has 33 decoded frames in 7.966667 seconds, which is 4.142 captured FPS, with 233-267 ms gaps.
- It shows full attack phases but fails the fixed 30 FPS reference requirement.
- Backend diagnostics: GDI near 4 FPS, stalled DXGI duplication, and `gfxcapture` at 25 distinct frames in 3.004787 seconds (8.320 FPS), median/p95 source gaps 124.846 / 125.701 ms. None meets the reference gate. Evidence: `artifacts/native-parity/reference-current/cadence-repair-20261105-20261105-201418/` (150 copied, hash-verified files).
- Display check: IMPORTA-PC ran 2560 x 1440 at 59 Hz. A supported 120 Hz mode exists but is not selected. Evidence: `artifacts/native-parity/reference-current/display-cadence-20261105-20261105-204351/` (41 files).
- Unverified: native playback multiplier, exact onset and impact, equipment IDs, camera and location, and coordinated Power Strike.

A looping clip is not a certified coordinated Power Strike action.

## Native control procedure

Use this for CHECK-01 paired captures and later polish captures on IMPORTA-PC.

### Before input

- Read `C:/Lineage2-client-support/debug-control/{CONTROL,CODEC,DISPLAY,PLAYBACK,HANDOFF}.md`, `controller-verification.json` and `CODEC-VERIFICATION.json`.
- Inspect the running L2 process before any launch, because Start-Debug can rewrite the INI. Recheck the current native PID.
- Take a fresh screenshot at each open, type and Enter step. Blind Tab, End and drag input does not register, so only a fresh visible result confirms input.

### Launch recovery

- Launch `L2.exe` directly with RunAsInvoker and the matching protected Debug INI.
- Avoid Start-Client, because it rewrites the protected INI.
- Use windowed mode. Exclusive fullscreen produces an "Insufficient Memory" native crash (FArray::Realloc / FaceRotation / Actor::Tick). Screenshot: `artifacts/native-parity/reference-current/005-restored-exclusive.png`.
- Verify that the protected INI SHA-256 stays `e0e4a52ee3e539472eeae49cc34852ad8845592995809a69982a2b4f056acfde`.

### Console commands

The native UI playback research is in `artifacts/native-parity/research/native-ui-playback/README.md` and `findings.json` (14 byte anchors).

```
ANIMPLAY ANIM=Atk01_Hand_MFighter
ANIMPLAY ANIM=Wait_Hand_MFighter
```

- The first requests the looping unarmed attack (43 frames at 30 Hz in source; live rate unknown).
- The second requests explicit unarmed idle. It does not restore an unknown prior state.
- `ANIMPLAY REFRESH ANIM=...` bypasses the same-name skip, with tween 0.2 instead of 0.1. It has no one-shot or rate flag.
- Never use `CHANGEANIM`. It mutates animation mappings.
- The FPS console: Tab, confirm the prompt, `stat fps`, Enter. End toggles it.

### PawnViewer

- `pv` shows or resets PawnViewer for the whole viewer. It does not hide it.
- The PawnViewer X button is a source-proven no-op.
- The Attack button only changes wait mode. Hit sends victim feedback. Combo needs an already selected clip.
- An overlapping combo pane may intercept the attack list.

## Reference tools

Static reverse engineering of the native binaries runs on PROMINENCE-PC under `C:\Users\rolan\l2-research`, using REA and Ghidra on pinned analysis copies.

- One REA owner at a time. Bounded per-function queries.
- Two logical CPUs, BelowNormal priority.
- 1 GiB Node heap and 2 GiB Ghidra heap. These are heap allowances, not total-memory limits.
- Check owned processes and receipts before resuming interrupted work.
- Keep private binaries, captures, credentials and invitation keys off external tools.

Terrain anchors and reports live in `artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/` (`REPORT.md`, `EVIDENCE_DEPENDENCIES.md`, `DRAW_PACKET.md`, `COORDINATE_BINDING_ADDENDUM.md`, `BABYLON_RECOMMENDATIONS.md`, `native/batch3/GEOMETRY_GATE.md`). Open anchors for polish:

- `bUseAlpha`: a positive anchor needs a read of `TerrainInfo+0x4b4+layerIndex*0xe8`, mask 1, or a traced copy, followed through to rendering. The six direct `GetLayerAlpha` callers and the reviewed geometry chain are exhausted.
- Minimum native UV draw packet: a mapped vertex above Y240, actual bytes, declaration and stride, effective mask TEXCOORDINDEX and TEXTURETRANSFORMFLAGS, material route, active shader objects and bound mask identity.
- If no observation exists, prepare the smallest D3D9 capture proposal before any capture. Preparation does not authorize execution.

## Open

These items have no full requirement.

- Native movement speed, stride and animation playback-rate matching are not established. Both human gaits use a synthetic 0.7 m/s. Server speed arrives in stage B (NET-04 covers only units and teleports). Stride and playback-rate matching is client presentation work.
- Per-clip looping, one-shot and retrigger behaviour, and transitions, must come from verified native animation semantics. The current profile values in [ARCHITECTURE.md](ARCHITECTURE.md) are client presentation choices. ACT-04 covers only timing and notification events.

Covered elsewhere: native reference cadence, full Power Strike and weapon attachment, Musveren death residual and terrain shader selection (POL-01); audio tolerances (POL-02); a 120 Hz display for the GTX 1060 (PERF-01).
