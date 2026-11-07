# Continuation after measured WebGPU pilot and asset-scaling clarification

Broad Interlude asset/browser/Editor/original-audio goal remains ACTIVE.
Latest user asks how conversion scales to all races, male/female variants and
remaining map blocks, and whether walking/skill/all audio remain included.
They do. Read docs/ASSET_BATCHING.md, docs/ASSET_PIPELINE.md, docs/NATIVE_AUDIO.md,
docs/RENDERING.md and current ROADMAP. Do not conflate exported/staged/runtime
coverage or turn another bounded checkpoint into complete-client acceptance.

New opt-in performance probe and contained hardware runner are complete.
Read artifacts/native-parity/research/webgpu-performance-20261107/REPORT.md and
FINAL_RECEIPT.json for actual code/bundle/preservation/tests/browser paths.
Pilot: both source/authored WebGPU routes, GTX1060/Pascal fallback=false,
1920x1080 DPR1,5s warmup/15s sample, separate10s CPU profile. No recording during
measurement. About60FPS cadence; current display60Hz. GPU timestamps unavailable.
Source/authored JS frame medians6.9/9.7ms; active-mesh evaluation2.5/5.1ms,
both98 draws/102 active meshes. These are sequential single-camera leads,
not causal performance gains or full acceptance. No optimization applied.

Existing normal app rendering is unchanged. Probe dynamically loads only when
window.__nativeSlice.performance() is requested; no default per-frame sample
work.88 tests pass, including concurrent import/disposal cases. Final browser
smoke tests the latest built probe. Owned browsers closed, GPU window released.
Protected2311 assets, audio implementation, source manifests, terrain/UV2 and
acceptance remain exact; preserve original735-V correction and TerrainSector247.

Instancing audit finds103 compatible candidate placements/27 repeated models;
not an optimization result.12 flames/eight mirrored placements excluded.
Source clones already share geometry/materials; copy native metadata if later
testing instances. Authored route needs its own safe runtime approach.
Do not duplicate the audit or claim GPU memory from texture-wrapper counts.

Next main engineering direction: consolidate existing adapters behind the
recipe/orchestrator and common coverage report, reusing existing verified outputs;
then prove another native character variant and adjacent map tile. Existing
assets:migrate has8 job groups; newer sky/environment, sound/ambient and map
append commands are not yet all in that front door. Retain source hashes,
unsupported records, animation/notifies, material/rig/equipment identities,
tile seams/bounds/shared dependencies and authored edits. One runtime scene with
streaming cells remains intended; full-map eager loading is not the target.

Sound:4773 converted Sound objects in18 locked packages,75 embedded actor WAVs,
9 connected preview cues (4 fighter death,2 Musveren death,3 Musveren attack).
Do not sum these counts. Nine other UAX packages and complete standalone
music/voice remain outside that batch. Walking/surface footsteps, cast/impact
skills, region music, ambient emitters and UI are open runtime categories.
Do not repeat sound-corpus verification or source collection merely to add
orchestration. Native exact selection/timing rules remain separate evidence.

The reversible source-table sky comparison is complete; default yellow color
selection remains unresolved. Original timeenv0/COLOR13 is an optional explicit
comparison, not a proved native default. Final visible Editor screenshot proof
after verified UV2 repairs remains open. No service/deployment or new native
runtime/query/capture/replay/injection permission. Networking stays Phase2.
