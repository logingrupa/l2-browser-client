---
status: awaiting_human_verify
trigger: "after the sky colour order fix (3e5f8e4) tile 15_22's sky renders saturated cyan (13,255,255) instead of its authored colour (0,150,206)"
created: 2026-11-16T00:00:00+02:00
updated: 2026-11-16T16:50:00+02:00
---

## Current Focus

status: verified in SwiftShader; owner hardware look pending
guardrail_verdict: accepted (red unit test before the binding, green after; browser sky pixel (13,255,255) before, (13,209,255) after = ramp of the authored bytes; full unit suite 2977 pass)
bug_class: Bohrbug (deterministic render path)
reasoning_checkpoint:
  hypothesis: "tile sky meshes keep the glTF PBR material because nativeSkyPresentation only reads a GLB program pin the sky step never writes (the programs sit in sky.json materials); Babylon PBR treats the byte colour factor as linear and applyImageProcessing encodes toGammaSpace, then the UE2 display ramp runs again, so (0,150,206) reaches the screen as (13,255,255)"
  confirming_evidence:
    - "browser 15_22 and 20_21 (lifted camera): librarySurfaces all program-unconverted, clear sky (13,255,255)"
    - "Babylon 9.27.1 pbrBlockImageProcessing -> applyImageProcessing -> toGammaSpaceVec3"
    - "ramp(pow((0,150,206)/255, 1/2.2)) = (13,255,255); ramp((0,150,206)/255) = (13,209,255)"
    - "the three sky programs compile in the UE2 library with colour source = authored colour"
  falsification_test: "if the sky drawn through the library still reads (13,255,255), the extra transfer is elsewhere (post process chain or canvas)"
  fix_rationale: "the library writes texture x colour in bytes like UE2 modulate; the display ramp is then the only transfer; the join uses the programs the sky step already pins in sky.json"
  blind_spots: "library culling/depth on sky meshes (presentation keeps disableDepthWrite and fog off); panners stay at level time 0 as before; legacy pinned 20_20 sky and authored roots have no programs"
  candidate_causes:
    - "code: sky presentation never binds the library (confirmed)"
    - "data/converter: sky GLB stores colour as a linear PBR factor (contributes only through the PBR path)"
    - "config: display gamma settings (eliminated: ramp alone gives the single-transfer value)"
  and_gate: "yes: PBR sky route plus the display ramp; removing the PBR route leaves the one client transfer"
tdd_checkpoint:
  test_file: tests/unit/nativeSkyPresentation.test.ts
  test_name: "draws a tile sky surface through the UE2 library program its sky snapshot lists, not the glTF PBR material"
  status: green
  failure_output: "AssertionError: expected PBRMaterial{ ... } to be an instance of ShaderMaterial (artifacts/tdd-red/sky-library-surface-red.txt)"
next_action: owner looks at /?map=15_22 on hardware; the integration thread re-points the pinned 20_20 sky after its restage

## Symptoms

expected: 15_22 sky background reaches the screen as (0,150,206) through the client's display gamma only
actual: (13,255,255) saturated cyan
errors: none
reproduction: DEV_PORT=5177 NATIVE_STORE_ROOT=world, /?map=15_22 camera tilted up; /?map=20_21
started: visible since 3e5f8e4 fixed the hue; the saturation predates it

## Eliminated

## Evidence

- timestamp: 2026-11-16
  checked: scripts/world/sky_geometry.py sky_part_material and nativeSkyPresentation.ts
  found: sky GLB materials are KHR_materials_unlit with baseColorFactor = authored bytes / 255 and no nativeMaterialProgram extras; the presentation reads readNativeMaterialProgramPin, gets null, keeps the glTF PBR material (status program-unconverted)
  implication: every tile sky draws through Babylon PBR, never through the UE2 library

- timestamp: 2026-11-16
  checked: Babylon 9.27.1 ShadersWGSL pbrBlockImageProcessing, imageProcessingFunctions, pbrBlockAlbedoOpacity
  found: without IMAGEPROCESSINGPOSTPROCESS the PBR output runs applyImageProcessing, which ends in toGammaSpaceVec3; GAMMAALBEDO linearises the texture first
  implication: PBR output = gamma(linear(texture) x factor); UE2 modulate is texture x factor in bytes; for a white texture the factor gets pow(1/2.2) before the display ramp

- timestamp: 2026-11-16
  checked: sky.json of skies/aca5be0f (15_22) materials and the three programs compiled with the UE2 library (parseMaterialProgram, compileMaterialStagePlan, evaluateMaterialFrame)
  found: HazeRing_Final 75d527ec, SkybackgroundColor 50da02b1, Cloud_Final da6a1259 all compile; SkybackgroundColor = WhiteChip modulated by colour source [0, 150/255, 206/255, 1], opaque; the others OB_Normal alpha blend
  implication: the sky step already writes library programs; only the browser join is missing

- timestamp: 2026-11-16
  checked: display ramp arithmetic (C 0.7, B 0.8, G 1.2): ramp(x) = 1.2 x^(1/1.2) + 0.05
  found: bytes (0,150,206) -> (13,209,255); after the PBR encode (0, 0.786, 0.908) -> (13,255,255)
  implication: the observed cyan is exactly two transfers; one transfer gives (13,209,255)

- timestamp: 2026-11-16
  checked: before probe, dev server 5177 NATIVE_STORE_ROOT=world (PID 15144 cmd, listener 21076), 1440 x 900 SwiftShader
  found: 15_22 sky aca5be0f horizon pose clear sky (13,255,255), 3 surfaces program-unconverted; 20_21 sky 0d199f6c (same authored colours) with camera lifted 120 m, clear sky (13,255,255), haze white
  implication: reproduced on both tiles; artifacts/ui-evidence/sky-colour-{15_22,20_21}-before-horizon-desktop.png

- timestamp: 2026-11-16
  checked: after probe, same server and poses, and tests/browser/world-sky-library.spec.ts (Playwright webServer on 5177)
  found: 15_22 and 20_21 surfaces library-compiled (75d527ec, 50da02b1, da6a1259); clear sky (13,209,255), haze ring band (255,255,208) = ramp(255,228,149), was (255,255,255); spec measured (13,209,255) = expected from buildDisplayGammaTable
  implication: one transfer; artifacts/ui-evidence/sky-colour-*-after-*.png, world-sky-library-15_22-horizon-desktop.png

- timestamp: 2026-11-16
  checked: every GLB JSON chunk in the world, actors and shared stores for baseColorFactor channels outside {0,1}, emissive factors and COLOR_0
  found: authored factors only on sky GLBs; 3,165 world terrain chunks and 15 shared map sections carry the neutral lit [.5,.5,.5] placeholder; 4 Valakas static meshes (Godard_Valakas_T.lavastone.*) carry COLOR_0; no effect or actor GLB has a non-identity factor; all 143 world tile skies join 429 parts to 3 compiling programs
  implication: textures in glTF fallback materials pass PBR unchanged (GAMMAALBEDO linearise, then encode); the double transfer hits only colour factors and vertex colours

## Resolution

root_cause: "tile sky meshes kept their glTF PBR material because nativeSkyPresentation only read a GLB program pin the sky step never writes (the programs are listed in sky.json); Babylon PBR treats the byte colour factor as linear and its image processing encodes it with toGammaSpace, then the UE2 display gamma ramp runs, so (0,150,206) showed as (13,255,255)"
fix: "nativeSkyLibraryMaterials.ts joins each sky surface's nativeSourceReference to the program sky.json lists and draws it through createNativeMaterial; nativeTileSkySource pins sky.json; the literal row comparison overrides the library ColorModifier colour source (NativeMaterial.overrideColourSourceRgb) and its PBR clone route is deleted; readNativeSourceReference is shared with the static mesh join"
oracle_type: derived (the client's own display gamma table applied once to the authored bytes)
verification: "red then green unit test; nativeSkyLibraryMaterials join, refusal and abort tests; comparison tests on library materials; world-sky-library.spec.ts pixel equals the ramp of the authored colour; tsc clean; full Vitest 248 files pass"
other_materials: "the same fault (factor or vertex colour encoded by PBR before the ramp) remains on: the pinned 20_20 sky on / (no listed programs, swapped colours, needs the integration restage and a re-pointed pin); the neutral [.5,.5,.5] lit terrain placeholder on tiles whose terrain-material step failed (18_17, 19_16, 19_17) and on shared map sections; COLOR_0 on 4 Valakas static meshes when their slot falls back to PBR. The library route covers each once it binds them; textured fallbacks are not affected"
files_changed: [src/scene/world/nativeSkyLibraryMaterials.ts, src/scene/world/nativeSourceReference.ts, src/scene/world/nativeSkyPresentation.ts, src/scene/world/nativeTileSkySource.ts, src/scene/world/nativeSkyLiteralComparison.ts, src/scene/world/staticMeshLibraryMaterials.ts, src/scene/world/lighting/bindStaticMeshLibraryMaterials.ts, src/materials/ue2/babylon/material.ts, src/materials/ue2/model/materialFieldValues.ts, tests/unit/nativeSkyPresentation.test.ts, tests/unit/nativeSkyLibraryMaterials.test.ts, tests/unit/nativeSkyLiteralComparison.test.ts, tests/unit/staticMeshLibraryMaterials.test.ts, tests/support/materialProgramFixture.ts, tests/browser/world-sky-library.spec.ts]
