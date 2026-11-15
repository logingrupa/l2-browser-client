# Rendering direction

How the converted world renders on Babylon.js WebGPU and how it gets faster: the WORLD-04 baseline in Phase 2, measured optimization (PERF-02) in Phase 6. Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- Keep the game's look, scale, motion and material intent (DEC-ARCH-1). Reproduce Direct3D internals only where they explain a visible difference or a required behaviour ([PROJECT.md](../.planning/PROJECT.md), out of scope). UE2 material semantics (blend factor pairs, Modulate2X lighting, fog targets, combiner operations) are required behaviour and live in `src/materials/ue2` (MAT-01).
- `createWebGPUEngine` requires WebGPU, uses large-world rendering and loads glslang and twgsl from `/vendor/babylon/9.27.1/`, which `scripts/stage-webgpu-compilers.mjs` stages in `pnpm dev` and `pnpm build`.
- `/`: `loadNativeSection` loads the section eagerly from the catalog and clones placements with `doNotInstantiate: true` (shared geometry and materials); no streaming or LOD yet.
- The pipeline keeps original mips and supported DDS blocks; terrain and flames upload decoded RGBA ([NATIVE_TEXTURES.md](NATIVE_TEXTURES.md)).
- `window.__nativeSlice.performance()` lazy-loads the probe. `WORLD_HARDWARE_TEST=1 node scripts/measure-native-world.mjs --label=<id> --route=source` measures built `dist`, as development evidence only.
- Pilot lead, not PERF-01: GTX 1060, 1080p, DPR 1, 60 Hz, no GPU timestamps, source route 6.9 ms JS frame median, 98 draws (`artifacts/native-parity/research/webgpu-performance-20261107/REPORT.md`).

## Open

- WORLD-04: measure first (camera path, CPU, frame and GPU timings, draws, triangles, load time, memory; GPU, browser, DPR, refresh rate). Then bounded cells with a resident cache, terrain and actors ready before reveal, traceable LOD. Visual LOD never changes nearby collision.
- PERF-02: instancing, GPU texture compression (BC, ETC2 or ASTC by device capability, an uncompressed path, colour space, alpha and partial mips kept, residency measured apart from download size) and culling, in the order the bottleneck sets. Each keeps picking, alpha, mirrored winding and placement identity, with before and after numbers on one workload and startup, movement and cleanup checks.
- PERF-01: protocol and display status in [NATIVE_PARITY.md](NATIVE_PARITY.md).
- VIS-01 (provisional, owner review): the tile BSP visibility resource and walk land in Phase 2 with translucent BSP order on inside each mesh. One integration comparator orders meshes by distance and then per-actor emitter ordinal, and no area sets an absolute alphaIndex. Zone and portal culling stays off until PERF-02 measures it. The visibility resource is a rendering index kept apart from WORLD-08 collision resources.

## Pointers

`src/engine/createWebGPUEngine.ts`, `src/engine/worldPerformanceProbe.ts`, `src/scene/world/` (loaders, `nativeTerrainPreview.ts`, `nativeFlameMaterials.ts`), [research/INDEX.md](research/INDEX.md).
