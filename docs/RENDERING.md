# Modern world rendering direction

This is the current rendering and performance direction. Work order is
breadth-first (DEC-OWN-1): the WORLD-04 baseline lands in Phase 2 and measured
optimization (PERF-02) in Phase 6. Status and order live in
[.planning/STATE.md](../.planning/STATE.md) and
[.planning/ROADMAP.md](../.planning/ROADMAP.md).
[NATIVE_PARITY.md](NATIVE_PARITY.md) holds the visual and performance acceptance
contract. [VERIFICATION.md](VERIFICATION.md) indexes the evidence.

## Preserve the game, modernize the renderer

Use Babylon.js WebGPU to preserve Lineage II's visual identity, world scale,
character motion, material intent and gameplay behaviour. The original client on
IMPORTA-PC plus the converter is the source of truth for the world. Translate the
required results into modern materials, geometry and resource management.

Babylon.js Editor is not on the build or runtime path (DEC-OWN-8). The native
world loads directly from the `.l2asset` catalog through `loadNativeSection`. The
Editor-authored route (`authored=1`) is optional and is not a gate. Editor topics
are in [EDITOR_VIEWER.md](EDITOR_VIEWER.md).

Legacy Direct3D state, fixed-function passes, CPU classification and
floating-point quirks are reference evidence. Reproduce a particular behaviour
only when it explains a meaningful visible difference or a required game rule.
Further reverse engineering should name the observed defect, the missing fact and
the browser change it would enable. An unresolved legacy detail need not block
unrelated world rendering improvements. Keep uncertain material behaviour
labelled, and keep the existing fidelity tolerances.

## Implementation checkpoint

This table describes source code inspected on 2026-11-07. It is not a benchmark.

| Area | Current implementation | Remaining work |
| --- | --- | --- |
| Backend | Shared `createWebGPUEngine` requires WebGPU, enables camera-relative rendering and initializes local shader compilers. | Profile and improve the world on the existing backend. |
| Native Interlude world | `loadNativeSection` loads the selected terrain, patches and model templates from the `.l2asset` catalog, then clones placements with `doNotInstantiate: true`. Source clones share geometry and materials. | Spatial loading and residency, shared static draw instances and terrain/mesh LOD. Existing sector boundaries alone are not streaming. |
| Older Talking Island world | `loadImportedWorld` loads nearby scenery on demand, instances ordinary placements and applies distance visibility with hysteresis. Mirrored placements use clones; loaded models stay resident until disposal. | Reuse proven pieces for native content; add bounded residency. Its four terrain tiles load together. |
| Grass | The older route uses cell-based thin instances and a bounded batch cache. | Apply compatible batching to native repeated scenery, with correct bounds and materials. |
| Visibility | Babylon performs ordinary mesh frustum culling. The older route also has distance visibility. | A rendering spatial index and chunk-level visibility; evaluate occlusion only if measurements justify its cost. The collision index is not a rendering index. |
| Textures | The pipeline preserves original mips and supported DDS blocks. Native terrain and flame paths decode and upload RGBA textures. | Integrate GPU compressed textures and capability-based format selection. DDS export or an isolated probe does not establish application memory savings. |

Relevant code: [engine factory](../src/engine/createWebGPUEngine.ts),
[native section loader](../src/scene/world/loadNativeSection.ts),
[older world loader](../src/scene/world/loadImportedWorld.ts),
[grass batches](../src/scene/world/grassInstances.ts),
[distance visibility](../src/scene/world/worldVisibility.ts),
[terrain texture upload](../src/scene/world/nativeTerrainPreview.ts) and
[flame texture upload](../src/scene/world/nativeFlameMaterials.ts).

## Performance probe and WebGPU pilot

The opt-in probe is `window.__nativeSlice.performance()`. It loads lazily on
request and adds no default per-frame work. It is the tool for the WORLD-04
"baseline measured first" step.

The pilot ran both the source and authored WebGPU routes. Evidence:
artifacts/native-parity/research/webgpu-performance-20261107/REPORT.md and
FINAL_RECEIPT.json in the same folder.

| Setting | Value |
| --- | --- |
| GPU | GTX 1060 (Pascal), no software fallback |
| Resolution | 1920x1080, DPR 1 |
| Sampling | 5 s warmup, 15 s sample, separate 10 s CPU profile, no recording |
| Display | 60 Hz, about 60 FPS cadence |
| GPU timestamps | Unavailable |

| Measure | Source route | Authored route |
| --- | --- | --- |
| JS frame median | 6.9 ms | 9.7 ms |
| Active-mesh evaluation | 2.5 ms | 5.1 ms |
| Draws / active meshes | 98 / 102 | 98 / 102 |

These are sequential single-camera leads. They are not causal performance gains
or acceptance. No optimization is applied.

Instancing audit (PERF-02 input): 103 compatible candidate placements across 27
repeated models. 12 flames and 8 mirrored placements are excluded. This is a
candidate list, not an optimization result. Copy native metadata if instances are
tested later.

Object counts from the functional sky run (WORLD-04 baseline lead): 556 materials
and 55 texture wrappers on the source route, 872 materials and 884 texture
wrappers on the authored route. These are object counts, not GPU allocations,
memory or timing. Investigate them in the hardware baseline before claiming a
resource optimization. Evidence:
artifacts/native-parity/research/sky-literal-comparison-20261107/REPORT.md.

## Baseline checkpoints

The selected world has 62 models, 157 placements and 4,992 terrain triangles. The
base recipe has 61 models, 151 placements and 4,512 terrain triangles. These are
different checkpoints. A baseline names which one it measures and never mixes
them.

## Next implementation sequence

1. **Measure the supported slice.** Use the probe on the native catalog route.
   Record reproducible camera and input paths, CPU and frame timings, available
   GPU timings, draw calls, triangles, load time, transfer bytes and resident
   memory, with the GPU, browser, DPR and refresh rate. Label absent actors and
   effects; this workload is not the final acceptance workload.
2. **Instance compatible static scenery.** Group by geometry, material and render
   state. Preserve mirrored winding, alpha behaviour, transformed bounds, picking,
   collision and placement identity. Keep animated actors separate until a
   skinning and animation strategy is measured.
3. **Partition and stream the world.** Use spatial chunks with explicit load,
   visibility and unload ranges, bounded concurrent work and a resident cache.
   Shared resources need clear ownership and cancellation. Required terrain and
   actors are ready before reveal; farther content streams afterward. Hidden or
   unloaded visuals never remove nearby collision. One runtime scene with
   streaming cells is the target, not eager full-map loading.
4. **Add terrain and mesh LOD.** Generate traceable derivatives and retain the
   original source geometry. Use projected size or error, stable transitions and
   crack-free terrain boundaries. Navigation and collision stay independent of
   visual LOD. Validate silhouettes, foliage and material coverage at transitions.
5. **Use GPU texture compression.** Select supported BC, ETC2 or ASTC formats from
   device capabilities, with an explicit uncompressed path where needed. Preserve
   colour space, alpha and mip behaviour; validate partial native mip chains. Keep
   original textures. Measure GPU residency separately from download size.
   [NATIVE_TEXTURES.md](NATIVE_TEXTURES.md) records current limits.
6. **Cull before submitting work.** Combine chunk and mesh bounds with frustum and
   distance checks. Verify instance-batch bounds. Add occlusion only for a
   demonstrated bottleneck, with conservative behaviour around moving cameras.

The order after measurement follows the measured bottleneck. Each change needs a
bounded before/after comparison on the same workload and regression checks on the
native catalog route, including startup, movement and cleanup. Do not claim an
optimization from enabling a flag alone.

## Optimization preservation rule

Instancing, chunking, LOD and culling must preserve picking, material and alpha
behaviour, and placement identity. WORLD-04 covers reveal readiness and collision,
and PERF-02 covers startup, movement and cleanup; this rule covers the rest. An
optimization that changes any of these is a regression, not a gain.

## Acceptance boundaries

Set explicit frame-time, memory and loading budgets for each target device after
the baseline. The GTX 1060, 1080p, DPR 1, 120 FPS acceptance workload and its
display requirements are in [NATIVE_PARITY.md](NATIVE_PARITY.md) (PERF-01). A
smaller slice is development evidence; software rendering or a faster GPU cannot
pass that target. Separate CPU work, GPU work and presentation limits.

Remaining visual differences need their own evidence. Preserve completed
conversion outputs, TerrainSector247, the closed 735-V correction and UV2. Keep
`GameWorldAdapter` intact for the server adapter phase. This direction adds no
deployment or native-runtime capture authorization.

## Open

- **Fewer-pass terrain shader.** A packed-mask or cached-weight terrain shader
  could reduce the terrain pass count. No requirement names it; PERF-02
  lists only instancing, compression and culling. Before adopting it: count
  textures and samplers for the nine-layer section against the device limit,
  and measure cost, since fewer draw calls alone do not prove faster rendering.
  Precision caveat: filtering precomputed (multiplied) weights differs from
  multiplying filtered masks, and native intermediate framebuffer rounding can
  change the result. Preserve layer order, UVs, transparency and animation.
- **Authored route instancing.** The source route clones already share geometry
  and materials; the optional authored route needs its own safe approach if it is
  ever measured again.
