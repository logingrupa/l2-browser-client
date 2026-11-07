# Continuation after literal sky comparison — 2026-11-07

Broad Interlude/browser/Editor/audio goal remains ACTIVE. This was progress:
reusable environment staging and an actual reversible browser color comparison
now work. Read `artifacts/native-parity/research/sky-literal-comparison-20261107/REPORT.md`,
`docs/NATIVE_SKY.md`, `docs/RENDERING.md`, `docs/ROADMAP.md` and `docs/NATIVE_AUDIO.md`.

New stager `scripts/stage-native-environment.mjs` validates all converted inputs
and stages three immutable files under public/l2/environments/e10827c4... .
It preserves all 20 source tables / 500 physical rows, duplicates, NUM anomalies,
source hashes and offsets. No original or decoded native files are public staged.
The previous converter and 4,773-sound corpus are unchanged; do not rerun them.

World Demo controls now expose Load sky color tables, explicit source/physical
row selection, Compare selected sky row and Restore stored sky. Default is still
stored colors. Data fetch occurs only on explicit load; selecting an option does
not apply. The three exact material identities are matched, and private PBR
copies retain opacity, textures, blend/depth/cull/plugin state. Only albedo RGB
factors change under the existing browser RGB/255 convention. Normal restore,
abort and partial-clone failures release owned allocations; changed/adopted live
assignments are preserved. No native selection or interpolation was invented.

131 relevant tests (18 staging, 44 new comparison, 69 existing runtime) plus
typecheck/build pass. Four source/authored desktop/mobile hardware WebGPU routes
pass: NVIDIA/Pascal, fallback=false, no errors. Explicit timeenv0/COLOR13 gives
visible blue/cloud sky. Selected fixed-camera sky regions restore byte-exactly,
max error 0 on all four routes. Repeated cycles leave no owned materials/wrappers;
actual texture internals are shared. Native pixel matching is not established.
No further tests/captures are running; owned browsers closed and GPU window free.

2,311 protected originals, original 735-V/UV2, TerrainSector247, 62 models/157
placements, both acceptance contracts and the four action-audio modules remain
exact. Both terrains' saved/public/dist binaries/channels match. Actual old/new
source-template JSON comparison closes this build's generated hash delta:
only ten equivalent delayLoadingFile references differ. See SOURCE_SCENE_COMPARISON.

Next practical work must advance the larger goal, not repeat this comparison.
The default yellow sky gap now has a concrete data/consumer discriminator: the
geometry, alpha and table-color application work; native file/type/time selection,
interpolation, positive material-color writer and same-event sky draw/color
transfer remain unproved. Existing research owner has the exact question without
new native query/launch/capture authority. Keep the optional comparison labeled;
do not silently make COLOR13 a native default or overwrite authored colors.

Independent available work: final visible Editor Play proof after the verified
UV2/texture-root repairs, or a measured current WebGPU performance baseline to
choose a real rendering bottleneck. The functional sky run reports 556 materials / 55 texture wrappers on
the source route and 872 / 884 on authored after restoration. These are counts,
not unique GPU allocations, memory usage or timing measurements. Investigate
them in a proper hardware baseline before claiming a resource optimization.
Streaming/LOD/compression remain planned, not blocked by full native parity.
Other music/ambience/footstep/UI/skill
audio integration also remains open; nine source-cue previews are not full audio.
No service/deployment, native runtime, replay, injection or new capture authority.
Keep source read-only, authored work protected, and networking Phase 2 planned.
