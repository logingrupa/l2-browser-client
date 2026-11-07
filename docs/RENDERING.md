# Modern world rendering direction

Updated: 2026-11-07. This is the current rendering direction; older migration-first
handoffs describe earlier sequencing. [NATIVE_PARITY.md](NATIVE_PARITY.md) retains
the existing visual and performance acceptance contract.

## Preserve the game, modernize the renderer

Use Babylon.js WebGPU to preserve Lineage II's visual identity, world scale,
character motion, material intent and gameplay behavior. Source assets and
authored Editor edits remain authoritative. Translate the required results into
modern materials, geometry and resource management.

Legacy Direct3D state, fixed-function passes, CPU classification and floating-point
quirks are reference evidence. Reproduce a particular behavior only when it
explains a meaningful visible difference or a required game rule. Further reverse
engineering should identify the observed defect, the missing fact and the browser
change it would enable. An unresolved legacy detail need not block unrelated
world rendering improvements. Keep uncertain material behavior labeled, and keep
the existing fidelity tolerances.

## Implementation checkpoint

This table describes source code inspected on 2026-11-07, not a new benchmark.

| Area | Current implementation | Remaining work |
| --- | --- | --- |
| Backend | Shared `createWebGPUEngine` requires WebGPU, enables camera-relative rendering and initializes local shader compilers. | Profile and improve the world on the existing backend. |
| Native Interlude world | `loadNativeSection` eagerly loads the selected terrain, patches and model templates, then clones placements with `doNotInstantiate: true`. The authored route attaches saved scene geometry. | Spatial loading/residency, shared static draw instances and terrain/mesh LOD. Existing sector boundaries alone are not streaming. |
| Older Talking Island world | `loadImportedWorld` loads nearby scenery on demand, instances ordinary placements and applies distance visibility with hysteresis. Mirrored placements use clones; loaded models stay resident until disposal. | Reuse proven pieces for native content; add bounded residency. Its four terrain tiles still load together. |
| Grass | The older route uses cell-based thin instances and a bounded batch cache. | Apply compatible batching to native repeated scenery, with correct bounds and materials. |
| Visibility | Babylon performs ordinary mesh frustum culling. The older route also has distance visibility. | A rendering spatial index and chunk-level visibility; evaluate occlusion only if measurements justify its cost. The collision index is not a rendering index. |
| Textures | The pipeline preserves original mips and supported DDS blocks. Native terrain/flame paths decode and upload RGBA textures. | Integrate GPU compressed textures and capability-based format selection. DDS export or an isolated probe does not establish application memory savings. |

Relevant code: [engine factory](../src/engine/createWebGPUEngine.ts),
[native section loader](../src/scene/world/loadNativeSection.ts),
[older world loader](../src/scene/world/loadImportedWorld.ts),
[grass batches](../src/scene/world/grassInstances.ts),
[distance visibility](../src/scene/world/worldVisibility.ts),
[terrain texture upload](../src/scene/world/nativeTerrainPreview.ts) and
[flame texture upload](../src/scene/world/nativeFlameMaterials.ts).

## Next implementation sequence

1. **Measure the current supported slice.** Record reproducible camera/input
   paths, CPU/frame timings, available GPU timings, draw calls, triangles, load
   time, transfer bytes and resident memory, with the GPU/browser/DPR and refresh
   rate. Start now with implemented content; label absent actors/effects rather
   than substituting it for the final acceptance workload.
2. **Instance compatible static scenery.** Group by geometry, material and render
   state. Preserve mirrored winding, alpha behavior, transformed bounds, picking,
   collision and editable placement identity. Keep animated actors separate until
   a suitable skinning/animation strategy is measured.
3. **Partition and stream the world.** Use spatial chunks with explicit load,
   visibility and unload ranges, bounded concurrent work and a resident cache.
   Shared resources need clear ownership and cancellation. Initial required
   terrain and actors must still be ready before reveal; stream farther content
   afterward. Hidden or unloaded visuals must not silently remove nearby collision.
4. **Add terrain and mesh LOD.** Generate traceable derivatives while retaining
   original source geometry. Use projected size/error, stable transitions and
   crack-free terrain boundaries. Keep navigation/collision independent of visual
   LOD and validate silhouettes, foliage and material coverage at transitions.
5. **Use GPU texture compression.** Select supported BC/ETC2/ASTC formats from
   device capabilities, with an explicit uncompressed resource path where needed.
   Preserve correct color space, alpha and mip behavior; validate partial native
   mip chains. Keep original textures and measure actual GPU residency separately
   from download size. [NATIVE_TEXTURES.md](NATIVE_TEXTURES.md) records current limits.
6. **Cull before submitting work.** Combine chunk and mesh bounds with frustum
   and distance checks. Verify instance-batch bounds. Add occlusion only for a
   demonstrated bottleneck, with conservative behavior around moving cameras.

The order after measurement can change with the measured bottleneck. Each change
needs a bounded before/after comparison and regression checks on the source-loaded
and authored/exported routes it affects, including startup, movement and cleanup.
Do not wait for whole-client visual parity to begin these improvements, and do
not claim an optimization from enabling a flag alone.

## Acceptance boundaries

Set explicit frame-time, memory and loading budgets for each target device after
the baseline. Keep the existing GTX 1060, 1080p/DPR 1, 120 FPS acceptance workload
and its display requirements in [NATIVE_PARITY.md](NATIVE_PARITY.md). A smaller
slice is development evidence; software rendering or a faster GPU cannot pass
that target. Separate CPU work, GPU work and presentation limits.

Original world audio, full Editor acceptance and remaining visual differences
still need their own evidence. Preserve completed conversion outputs, the closed
735-V correction, UV2 and authored edits. Keep `GameWorldAdapter` intact for the
planned networking phase. This direction adds no deployment or native-runtime
capture authorization.
