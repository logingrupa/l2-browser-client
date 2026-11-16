---
status: awaiting_human_verify
trigger: "Native tile ?map=15_22 shows a bright yellow sky with white clouds and plain grey untextured ground; no map textures."
created: 2026-11-16T00:00:00+02:00
updated: 2026-11-16T00:00:00+02:00
---

## Current Focus

status: fix committed 3e5f8e4; 15_22 sky and manifest resealed (sky 3b38b28c, manifest c9876616, lane catalog 57f98dea); after screenshot shows (13,255,255)
guardrail_verdict: accepted (red before fix, green after; boundary neighbour 01020304; bug reproduced and gone in the browser)
bug_class: Bohrbug (deterministic converter output)
reasoning_checkpoint:
  hypothesis: "scripts/world/sky_step.py builds authoredColorRGBA with list(bytes.fromhex(rawHex)), i.e. R,G,B,A, but Core.dll serializes the binary Color struct as B,G,R,A, so every sky GLB baseColorFactor has red and blue swapped; the 15_22 SkybackgroundColor (0,150,206) blue becomes (206,150,0) orange"
  confirming_evidence:
    - "recipes/world/struct-property-tag-rules.json binary Color members B,G,R,A (verified Core.dll 9462f87a)"
    - "BGRA reading of all three 15_22 sky colours lies 3.6 to 24.4 from Env timeenv rows of the bound sections; RGBA 54.7 to 129.8"
    - "in-page swap of red and blue on the three sky materials turns the rendered sky from (255,255,13) to (13,255,255)"
  falsification_test: "if the red-blue swap had left the sky yellow, the hue would come from elsewhere (texture or post process)"
  fix_rationale: "decode the raw Color bytes through the recipe's binary Color layout, the one verified owner of the member order"
  blind_spots: "brightness: the PBR unlit sRGB encode plus the UE2 display gamma ramp saturate the sky (background-only renders (255,255,13) from albedo 0.808,0.588,0); that is a separate transfer issue, recorded, not fixed here"
  candidate_causes:
    - "code: converter channel order in sky_step.py (confirmed)"
    - "config/pipeline: PBR linear-to-sRGB encode before the UE2 display gamma ramp (contributes saturation, not hue)"
  and_gate: "yes for 'bright yellow (255,255,13)': hue needs the swap, saturation needs the double transfer; the yellow hue alone is the swap"
next_action: owner confirms the 15_22 sky hue on hardware; remaining items are in STATE.md Open follow-ups (sky colour and tile 15_22 ground)

## Symptoms

expected: blue native sky and textured terrain on tile 15_22
actual: bright yellow sky, white clouds, plain grey untextured ground
errors: none reported
reproduction: dev server NATIVE_STORE_ROOT=world, open /?map=15_22
started: since the sky step wrote GLB colours (sky step algorithm version 2)

## Eliminated

## Evidence

- timestamp: 2026-11-16
  checked: recipes/world/struct-property-tag-rules.json binary dispatch 0x5a Color
  found: verified Core.dll member order B, G, R, A
  implication: every tagged Color payload is B,G,R,A on disk

- timestamp: 2026-11-16
  checked: sky.json of skies/691023bb (15_22) parts authoredColorRGBA
  found: SkybackgroundColor [206,150,0,255], HazeRing_Final [149,228,255,255], Cloud_Final [151,192,255,255], read in stored byte order
  implication: background renders orange-yellow (206,150,0); BGRA reading gives blue (0,150,206)

- timestamp: 2026-11-16
  checked: nearest Env timeenv*.int literal rows (named R,G,B) per bound section under both orders
  found: BGRA distances 24.4 (SkyBoxColor), 3.6 (HazeringColor), 11.4 (CloudColor1); RGBA distances 129.8, 54.7, 114.8
  implication: data confirms B,G,R,A independent of the decompiled fact

- timestamp: 2026-11-16
  checked: browser repro, DEV_PORT=5177 NATIVE_STORE_ROOT=world, /?map=15_22, horizon pose
  found: sky pixels (255,255,13), equal to the owner screenshot; sky inspection program-unconverted on all 3 surfaces; terrain material neutral-inspection
  implication: reproduced

- timestamp: 2026-11-16
  checked: per-layer render and in-page red-blue swap
  found: background-only renders (255,255,13); swapped renders (13,255,255)
  implication: hue is the channel order; saturation comes from PBR sRGB encode plus UE2 display gamma ramp (brightness 0.8, contrast 0.7, gamma 1.2 maps 0 to 13)

- timestamp: 2026-11-16
  checked: terrain chunk gaps of 15_22 and scripts/world/tile_manifest_step.py
  found: every chunk carries terrain-material: step-pending:terrain-material; no terrain-material step exists; terrain GLB baseColorFactor [.5,.5,.5,1] neutral
  implication: grey ground is the unimplemented terrain-material step (plan 03-36), not a colour bug

- timestamp: 2026-11-16
  checked: legacy pinned 20_20 sky public/l2/skies/f7a0b5ef (native_sky.py generator)
  found: same swapped factors (206,150,0)
  implication: main store sky needs a restage by the integration thread

## Resolution

root_cause: scripts/world/sky_step.py read the ColorModifier Color payload as R,G,B,A (list(bytes.fromhex(rawHex))); Core.dll serializes Color as B,G,R,A, so every sky GLB swapped red and blue (15_22 background 0,150,206 blue became 206,150,0 orange); the PBR sRGB encode plus the UE2 display gamma ramp then saturate it to (255,255,13)
fix: authored_color_rgba decodes the raw bytes through the recipe's binary Color layout (decoded_binary_struct); sky step algorithm 3 and structPropertyRulesSha256 in the sky unit config; colour.byte-order constant confirmed-interlude with the Core.dll evidence
oracle_type: specified (verified Core.dll member order) plus derived (Env timeenv rows of the bound sections)
verification: red then green unit test (01020304 -> 3,2,1,4; ce9600ff -> 0,150,206,255); real-client 15_22 and 20_20 sky tests; seal test keyed on the struct rules; browser after screenshot
files_changed: [scripts/world/sky_step.py, tests/pipeline/test_world_sky_step.py, tests/pipeline/test_tile_step_current_seals.py, src/materials/ue2/model/constants/combinerConstants.ts, tests/unit/ue2Modifiers.test.ts, docs/parts/adapter-dispatch/EVIDENCE.md]
