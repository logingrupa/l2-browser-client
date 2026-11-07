# Current rendering handoff — 2026-11-07

Read [docs/RENDERING.md](../docs/RENDERING.md),
[the roadmap](../docs/ROADMAP.md), [architecture](../docs/ARCHITECTURE.md) and
[verification](../docs/VERIFICATION.md) before choosing the next implementation.
This direction supersedes older blanket instructions to defer profiling and
optimization until all native migration or visual parity is complete.

WebGPU is already required. Preserve Lineage II's visible identity and gameplay;
use modern rendering and resource management. Old Direct3D implementation details
need reproduction only when evidence links them to a meaningful visible defect
or required behavior. Keep source facts distinct from approximate presentation.

Finish a bounded in-flight fix before changing workstreams. The later
`artifacts/native-parity/editor/uv2-export-20261107/REPORT.md` verifies the UV2
writer repair through installed Save/Play/build and the WebGPU material texture
root correction. Final visible Editor proof remains open after capture failures;
do not treat ready telemetry as a screenshot pass. The user now prioritizes sky
appearance and SFX integration. Original environment tables are converted at
`artifacts/native-parity/research/sky-environment-conversion-20261107/REPORT.md`;
native table/time/interpolation selection remains unproved.

Next, capture a reproducible hardware baseline for the supported native-world
slice, then choose a measured bottleneck. Native placements currently use clones;
candidate work is static instancing, spatial chunking/streaming with bounded
residency, terrain/mesh LOD, GPU compressed texture integration and visibility
culling. Reuse suitable older-world code without assuming it already applies to
the native route. Record before/after timings and resource use, plus affected
source/authored-route regressions. Preserve picking, collision, material behavior,
startup readiness, cleanup and Editor placement identity.

The selected 4,773-sound export/clean-build/cache/browser-decode checkpoint is
complete. Do not repeat it on resume. Only six original death-preview cues are
currently wired into the world; other audio categories and native playback rules
remain open in [NATIVE_AUDIO.md](../docs/NATIVE_AUDIO.md). Further source research
should name the user-visible issue and the concrete implementation it enables.

Preserve authored work, original assets, TerrainSector247, the closed 735-V
correction, UV2 and existing fixed acceptance thresholds. The current selected
world has 62 models / 157 placements / 4,992 terrain triangles; the base recipe's
61 / 151 / 4,512 remains a different checkpoint. Overall parity, full Editor
acceptance, hardware performance and Phase 2 networking remain unfinished.
No service/deployment change or new native-runtime action is added by this handoff.
