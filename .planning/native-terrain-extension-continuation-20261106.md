# Continue after adjacent ground integration — 2026-11-06

The broad tracked goal remains ACTIVE: repeatable source-faithful Interlude
asset pipeline, playable Babylon client, actual Editor authoring, original audio,
native/browser visual evidence and measured performance. Do not mark complete.

Read first:
- artifacts/native-parity/research/terrain-extension-20261106/REPORT.md
- its integration/COMMANDS.md and integration/preservation/FINAL_REPORT.md
- artifacts/native-parity/research/map-repository-review-20261106/BROWSER_GOAL_REFERENCE.md
- docs/NATIVE_AUDIO.md and docs/ASSET_PIPELINE.md
- artifacts/webgpu-migration/README.md

## Completed current checkpoint

TerrainSector247 is now permanently integrated in source and saved/exported
routes, not just scratch.272vertices480triangles. Current62models157placements,
4992terrain triangles. Selected manifest:
cbddefef4bd6f2b74b17a8640db143d8e22ce11265766fb81ca51215c38798c6.
Qualified source GLBcee7f0f6..., saved16660byte binary9dc00459...;
patchUV467a709a..., UV29788b418.... Full hashes in report.

The original terrain remains exactly549a7fef..., primaryd549356f...,
UV24c6a9644.... Do not repeat735-V migration or restore old snapshots.
The scoped native source/draw join covers272points323records, X112..128/Y240..255,
with corrected V formula once. Stage1maskTC0/DISABLE differs from stage0diffuse
CAMERASPACEPOSITION/COUNT2. Offscreen submissions do not prove native pixels.

Both source and saved/exported routes pass four permanent desktop/mobile WebGPU
captures with identical camera/viewport/geometry channels,16exact shared-edge
rows, shared12-sampler material, correct ground and local movement, no GPU errors.
Final captures: integration/hardware-20261106-shared-material/.
Original baseline/ordinary/qualified comparison:
browser-comparison/hardware-20261106-2023/.
Initial integrated captures before export sharing:
integration/hardware-20261106-final/.

Editor packer duplicated an identical shared terrain material, adding one unused
material and12texture objects. scripts/share-native-terrain-export-materials.mjs
now removes only that exact exported duplicate; saved authored records stay intact.
It runs at end of pnpm generate. Conflicting shared IDs fail; distinct materials
are preserved. Six regression cases pass. Do not broaden to all materials.

## Checks and history

-102relevant unit cases passed before append (includes14appender checks),6new
 export-sharing cases pass;10extractor/11qualification cases and GLB validator
 pass. Final pnpm build/typecheck pass.
-Seven affected hardware WebGPU browser cases pass. Initial batch6/7: source
 inspector only failed favicon404. Added inline favicon to fixture; sole case
 rerun passed. Both logs/traces retained. Do not hide console/GPU errors.
-All2309baseline files checked:2304unchanged;three intended metadata updates,
 catalog selection and generated export cache. Exactlytwo added authored files.
 Saved/public/dist original and new terrain channels match; all954source bundle
 payloads match in both outputs. No unintended delta. Final receipt3a582734...
-Stage repeat publicChanged:false; Editor repeat preserved/changes:[].
-No new interactive Editor save/Play claim for this append. Existing raw Play
 UV2 omission remains; finish any future Play with normal generate/build.

## Environment/ownership

DATABASE-PC C:/laragon/www/l2-browser-client. Large dirty tree is intentional.
No root AGENTS.md found. Existing dev server5184 stays; no restart/service/deploy.
WebGPU required. Full Playwright Chromium channel:'chromium', headless:true,
no GPU override flags, WORLD_HARDWARE_TEST=1. Assert actual engine, adapter and
uncapturederror. Legacy WebGL reference fixtures are separate historical evidence.
Renderer owner completed/released testing; no active ownership lock:
<t3-thread://v2/589393e7-17b9-4b11-9012-d00f8c24c089/6f362fbb-02ae-4659-bfc8-5dfe2aa7fda5>.
Native research owner:
<t3-thread://v2/20b54a96-ad0d-46e3-9eec-9f7158c0978f/28fd5fa6-471f-4127-aa36-31c7add4bae0>.

No native launch/capture/query/injection/proxy/replay authority is added.
Do not access/control native runtime or infer new permissions from evidence.
Keep original source packages read-only and binaries local. No publish/deploy.
No /lane or /fleet skill available in current skill catalog; do not claim usage.
Children tree_normal_source/new_tree_integration_map completed; use their files,
not duplicate work. They have no running GPU/UI/native task.

## Next concrete work and limits

Latest continuation: read `native-ambient-export-continuation-20261106.md`.
The 106-sound ambient export and clean/cache/decoder verification are now complete.
Do not repeat them as pending work. Ambient world policy remains unresolved.

1. Read latest root report and final resource/diagnostic receipts. Do not repeat
 completed migration or browser cases without changes or a new concern.
2. Choose the next bounded map/source completeness gap with existing data, or
 continue original-audio lookup from backend-closure/footstep-config/REPORT.md.
 New UI work needs real Editor save/rebuild evidence, preserving current scene.
3. Keep no-native-pixel/material parity explicit. Hard yellow/blue sky boundary
 remains. Sky-assist note proves builders already carry opacity; missing native
 runtime ColorModifier writer/draw join prevents guessed tint/time-of-day fix.
4. Audio is REQUIRED in1:1. Only six original death cues are verified in world.
 All24footstep keys decoded;zero exact source-object joins because literals omit
 groups. Do not choose same-leaf candidates or invent random/loop/spatial rules.
 Music/ambience/footsteps/combat/UI coverage and native timing remain incomplete.
5. No120FPS claim: monitor max75Hz; current overlays are captures, not benchmarks.
 Duplicate export removal proves object-count reduction, not VRAM/time gains.
6. Newer74-file native packet remains unreviewed; later reviewed addenda apply
 only to themselves. Latest color-fallback/shader-consumer notes justify no
 production material change. Preserve separate CPU/GPU classifications.

Continue the user's full goal, keeping GameWorldAdapter and Phase2 planned.
