---
status: resolved
trigger: "7 of 143 touched tiles fail the bfd4c648 union sweep with Unable to enter the world at step 2 after plan 03-24"
created: 2026-11-14T21:10:00+02:00
updated: 2026-11-14T21:16:00+02:00
---

## Current Focus

bug_class: Bohrbug (deterministic per tile content)
hypothesis: the shared PNG decoder caps each edge at 1024 (a terrain preview bound); 03-24 static mesh programs pin 2048-edge Interlude textures, loadNativeMaterial throws, bindStaticMeshLibraryMaterials.addChunk rejects and the world load fails at step 2
reasoning_checkpoint:
  hypothesis: "decodeNativePreviewPng rejects every PNG with an edge over 1024; 8 library textures have a 2048 edge; the 7 failing tiles are exactly the tiles whose ported static mesh programs pin one of them"
  confirming_evidence:
    - "all 7 load-check reasons end with the decoder's 1024 message"
    - "IHDR scan: every failing tile pins 1 to 4 textures with a 2048 edge, passing 20_21 and 22_22 pin none"
  falsification_test: "with the cap lifted, the 7 tiles still fail at step 2, or a unit load of a 2048x512 program texture still rejects"
  fix_rationale: "the cap belongs to the terrain preview, which checks its exact mask sizes after decoding; the decoder's own bound becomes the WebGPU guaranteed maxTextureDimension2D (8192), the largest edge every adapter uploads"
  blind_spots: "a second fault on these tiles hidden behind the first throw; WebGPU upload of 2048-edge raw textures on SwiftShader"
  candidate_causes:
    - "code: decoder edge cap sized for terrain masks"
    - "data: converter wrote an out-of-contract PNG (refuted by the census: all RGB/RGBA8 noninterlaced)"
    - "code: binding propagates a load error instead of a named reason (no current texture reaches it once the cap is right; store faults stay loud like BSP)"
  and_gate: "no - with a correct decoder bound no pinned texture throws, so the binding never sees a load error on current data"
test: tests/unit/loadNativeMaterial.test.ts loads a program pinning a 2048x512 texture
expecting: red before the fix with "supports only", green after
next_action: none; resolved by f10993d and the 7-tile world sweep

## Symptoms

expected: every touched tile enters the world; a slot that cannot draw through the library keeps its texture material with a named reason
actual: tile:18_24, 20_16, 21_16, 22_16, 22_19, 22_20, 23_14 fail at step 2 of 4 (meshes and textures)
errors: "Native preview supports only noninterlaced RGB/RGBA8 PNGs up to 1024 pixels."
reproduction: NATIVE_STORE_ROOT=integration LOAD_CHECK_KIND=tiles LOAD_CHECK_KEYS=tile:18_24 LOAD_CHECK_LIMIT=1 pnpm test:e2e tests/browser/load-sweep-tiles.spec.ts
started: union bfd4c648 (after 03-24); 18_24 passed on union bba52c47

## Eliminated

## Evidence

- timestamp: 2026-11-14T21:10:00+02:00
  checked: load-checks/bfd4c648...json records for the 7 tiles
  found: every reason ends with "Native preview supports only noninterlaced RGB/RGBA8 PNGs up to 1024 pixels."
  implication: the throw is the IHDR guard in src/scene/world/nativeTerrainPreview.ts decodeNativePreviewPng, reached through src/materials/ue2/babylon/loadNativeMaterial.ts loadTextureImage

- timestamp: 2026-11-14T21:20:00+02:00
  checked: IHDR of every texture pinned by the ported static mesh programs of the 7 failing tiles and of passing 20_21 and 22_22 (union store, read-only scan)
  found: each failing tile pins 1 to 4 RGB/RGBA8 textures with one edge of 2048 (18_24, 22_19, 22_20 Quest_worldcamp_T.camp_Lizardman.q017 2048x512; 20_16 Rune_Castle_T.runecastle_smain 512x2048; 21_16 Rune_Village_01_T.rune_main 512x2048; 22_16 Rune_stakatonest_T.stakato_spider_M 2048x512; 23_14 four Schtgart waterfall_Wall textures 1024x2048 and 512x2048); 20_21 and 22_22 pin none over 1024
  implication: the failures correlate exactly with a library texture edge over 1024

- timestamp: 2026-11-14T21:22:00+02:00
  checked: header census of all 8429 library textures in the integration and world lane stores
  found: 6687 RGB8 and 1742 RGBA8, all noninterlaced; largest edge 2048; 8 textures exceed 1024 (512x2048 x3, 1024x2048 x3, 2048x512 x2)
  implication: the edge cap is the only decoder rule a library texture breaks; no format case exists

- timestamp: 2026-11-14T21:25:00+02:00
  checked: git log -S on the cap; importers of decodeNativePreviewPng
  found: the 1024 cap came with the terrain preview (6138111, 2026-11-07), whose masks are 256/512/1024 and which checks those exact sizes after decoding; loadNativeMaterial (16a5f85) reused the decoder for every library texture without a reviewed size bound; the app runs WebGPU only (createWebGPUEngine)
  implication: the cap is a terrain-sized bound applied to all native textures; a WebGPU 2D texture takes at least 8192 per edge on every adapter

- timestamp: 2026-11-14T21:05:00+02:00
  checked: tests/unit/loadNativeMaterial.test.ts (2048x512, 512x2048, 1024x2048) and the decoder edge neighbours in nativeTerrainPreview.test.ts, before the fix
  found: 4 failed with "Native preview supports only noninterlaced RGB/RGBA8 PNGs up to 1024 pixels."
  implication: red reproduces the production error at unit level

- timestamp: 2026-11-14T21:06:00+02:00
  checked: non-recording single-tile browser repro of 18_24 on a 5175 dev server over the world lane store (the sweep spec would record or skip the key)
  found: before the fix the same step 2 failure; after the fix route ready, 9149 static mesh slots, 9148 library-compiled, 1 program-gap, Quest_worldcamp_T.camp_Lizardman.q017 library-compiled on 40 meshes
  implication: the cap was the only fault on 18_24; WebGPU on SwiftShader takes the 2048x512 raw texture

- timestamp: 2026-11-14T21:13:33+02:00
  checked: NATIVE_STORE_ROOT=world LOAD_CHECK_KIND=tiles LOAD_CHECK_LIMIT=7 LOAD_CHECK_KEYS=<the 7> pnpm test:e2e tests/browser/load-sweep-tiles.spec.ts, 5173 free
  found: exit 0 in 4.4 min, checked 7, skipped 0, 7 pass; records artifacts/lane-store/world/load-checks/cddfe152...json SHA-256 595f8a2e...; log artifacts/lane-store/world/measurements/static-mesh-texture-edge-7-tile-sweep.log SHA-256 f753eae7...
  implication: no second fault behind the first throw on any of the 7 tiles

## Resolution

root_cause: decodeNativePreviewPng, shared by the terrain preview, the UE2 material library, effects and flames, refused any PNG edge over 1024 pixels, a bound sized for the terrain masks; 03-24 static mesh programs on 7 tiles pin 8 Interlude textures with a 2048 edge, so loadNativeMaterial threw and the world load failed at step 2
fix: the decoder bound is the WebGPU guaranteed maxTextureDimension2D (8192); the terrain preview keeps its exact 256/512/1024 checks after decoding; comments in the touched file removed
oracle_type: specified (decoded width, height and pixel bytes equal the encoded image)
verification:
  red_before_fix: 4 tests failed with the production message
  green_after_fix: tests/unit 240 files passed, 3 skipped (2919 tests passed, 59 skipped); pnpm typecheck clean
  mutation: a 1024 bound fails the 2048 cases and the 1025 neighbour; an 8191 bound fails the 8192 neighbour; a bound over 8192 fails the 8193 refusal
  revert_check: the pre-fix browser repro of 18_24 fails at step 2, the post-fix repro is ready
  regression: 7 of 7 tiles pass under world lane catalog cddfe152
  guardrail_verdict: accepted
files_changed: [src/scene/world/nativeTerrainPreview.ts, tests/unit/nativeTerrainPreview.test.ts, tests/unit/loadNativeMaterial.test.ts]
