---
phase: 02-stage-a-breadth
plan: 92
subsystem: materials
tags: [mat-01, world-08, adapter-dispatch, diagnostic-slots, combiner, display-gamma, gap-closure]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-73 converter state of scripts/native_assets.py; 02-60 material library, swatch harness and displayGamma.ts"
provides:
  - "scripts/native_assets.py UnsupportedMaterialAdapter(class_name, object_name) and the diagnostic slot UNSUPPORTED_MATERIAL_ADAPTER_SLOT_<n> (magenta, nativeRuntimeStatus unsupported-diagnostic, unsupportedMaterialAdapter {class, object}, nativeSlotProperties kept) with the model limitation material-adapter-unsupported:<class>:<object>"
  - "emitCombiner clamps with COMBINER_CONSTANTS.resultClamp.runtimeDefault"
  - "tests/support/materialProgramFixture.ts combinerSwatchCases, combinerSwatchInputRgba, syntheticCombinerSwatchProgram and materialSwatchFixtureFiles().combinerSwatches"
  - "src/materials/ue2/babylon/displayGammaPostProcess.ts attachDisplayGammaPostProcess(camera) returning { postProcess, lookupTexture, lookupTexels, inspect(), dispose() }"
  - "World tab sheet note sandbox-display-gamma-note"
affects: [02-88, 02-78, 02-79, 02-83, 02-85, 03-17]

tech-stack:
  added: []
  patterns: ["an unsupported material class becomes a named diagnostic slot, never a refused model", "CPU evaluators are the pixel oracle of the GPU swatch", "one final camera post-process for the display ramp"]

key-files:
  created:
    - tests/pipeline/test_native_assets_diagnostic_slots.py
    - src/materials/ue2/babylon/displayGammaPostProcess.ts
    - tests/unit/displayGammaPostProcess.test.ts
    - tests/browser/native-display-gamma.spec.ts
    - tests/fixtures/lane-store/l2/native-materials/<8 combiner swatch programs>/program.json
    - tests/fixtures/lane-store/l2/native-material-textures/<3 synthetic 1 x 1 inputs>/texture.png
  modified:
    - scripts/native_assets.py
    - src/materials/ue2/babylon/fragmentChain.ts
    - tests/support/materialProgramFixture.ts
    - tests/unit/ue2Combiner.test.ts
    - tests/browser/material-swatch.spec.ts
    - src/runtime/createNativeSliceRuntime.ts
    - src/runtime/attachNativeSliceSheet.ts
    - src/runtime/attachNativeSliceWorldSheet.ts
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "988: the 20_21 meshes product holds no no-adapter row (its 6 Combiner and 14 TexPanner rows are bsp rows); the tracer converts FX_E_S.Flameset.Default_Flame01 (2,539 of 2,545 meshes refusals) and rhion_orc_dungeon_s.rhion_orc_dungeon48 (20_14)"
  - "989: diagnostic slot UNSUPPORTED_MATERIAL_ADAPTER_SLOT_<n> with nativeRuntimeStatus unsupported-diagnostic; UnsupportedMaterialAdapter keeps the old message, so the BSP surface refusal is unchanged"
  - "990: combiner swatch programs and inputs are committed fixture store files checked by materialProgram.test.ts; eight programs pair colour operation i with alpha operation i mod 5, Modulate2X on operation 2"
  - "991: 256 x 1 r32float nearest lookup texture, GLSL post-process entry floor(c * 255 + 0.5); NativeSliceSheetContext gains displayGamma"

requirements-completed: []

duration: 25min
completed: 2026-11-11
plan_head_before: 80f3804d63482cceb8a661645bc21437552ca3b3
plan_head_after: be2acde056ef8de2881d1e7080281868c7b0fd8a
commits: 3

actuals:
  tokens: 39800
  tasks: 3
  commits: 3
---

# Phase 2 Plan 92: Diagnostic slots, combiner pixel oracle and display gamma Summary

Models whose slot material has no diffuse adapter now convert with a named magenta diagnostic slot that keeps geometry and `nativeSlotProperties`, the GPU combiner clamps from its constants row and is checked pixel by pixel against the CPU combiner on the swatch harness, and the native world camera passes through the UpdateGamma ramp as one final post-process.

## Tasks

| Task | Name | Commit | Key files |
| ---- | ---- | ------ | --------- |
| 1 | Tracer: a Combiner static mesh converts with a diagnostic slot collision reads | f4040bf | scripts/native_assets.py, tests/pipeline/test_native_assets_diagnostic_slots.py |
| 2 | GPU combiner clamp from the constants row, CPU evaluators as pixel oracle | 0914b47 | fragmentChain.ts, materialProgramFixture.ts, ue2Combiner.test.ts, material-swatch.spec.ts, 11 fixture store files |
| 3 | Display gamma post-process, sheet note, evidence | be2acde | displayGammaPostProcess.ts, createNativeSliceRuntime.ts, attachNativeSliceSheet.ts, attachNativeSliceWorldSheet.ts, native-display-gamma.spec.ts, adapter-dispatch EVIDENCE |

## Task 1: diagnostic slots (WORLD-08, decision row P807)

- `Converter.material_texture` raises `UnsupportedMaterialAdapter` (a `ValueError` with the unchanged message) for a class outside Texture, Shader and FinalBlend. `Converter.materials` catches only that error per slot and writes `UNSUPPORTED_MATERIAL_ADAPTER_SLOT_<n>`; missing, ambiguous and cyclic references and every other refusal still fail the model. `bsp_surface_materials.py` sees the same message, so BSP is unchanged.
- Synthetic cases (4) pass: the error carries class and object, the diagnostic slot keeps `nativeSlotProperties` and lists `material-adapter-unsupported:Combiner:<object>`, a Texture slot beside it gives the exact pre-change material dict, and a cyclic refusal still raises.
- Real conversions through `Converter.convert({'kind': 'model', ...})` the way `convert_static_mesh` calls it, into `artifacts/lane-store/integration/work/diagnostic-slots/` (E:/Lineage2-client passes `require_reference_client`):

| Package | Object | Archive SHA-256 | GLB SHA-256 | Slots | EnableCollision | Collision triangles | Limitation |
| ------- | ------ | --------------- | ----------- | ----- | --------------- | ------------------- | ---------- |
| staticmeshes/FX_E_S.usx | FX_E_S.Flameset.Default_Flame01 | 97862dee38add95777de4545e3d7e7ccaaa3671dc070eb2ea5513c62378e802e | 41d659579ef88de7c5e1daf850f7ffcff12983bf2804729773f432f73b8f10ec | 2 | true, true | 4 | material-adapter-unsupported:Combiner:FX_E_T.Flameset.de_fire_glow_s |
| staticmeshes/rhion_orc_dungeon_s.usx | rhion_orc_dungeon_s.rhion_orc_dungeon48 | 7301e7abcb197bf22a0dd17a56c91b7315bbc78a2417b28e88faa8be2a8454f5 | 5cf72d47406daed0b8b67d6bc7e578c4dfe196a0c4829e57963809a18a4b4d26 | 1 | true | 18 | material-adapter-unsupported:Combiner:FX_E_T.WaterSurfaceShaderSet.reflection |

- Converter implementation hash after this plan (rule G6): `c4bf8e6cf5f61bddf65a35e6fb65f6af34199e0589b978930aeb92d2f15a2bd8`. Every converter-cached unit reseals on its next run; the meshes and collision re-run of every tile is 02-88's batch.
- Before counts across the world lane meshes products: 2,545 no-adapter refusals (2,543 Combiner, 1 TexPanner, 1 TexOscillator) over 6 distinct meshes.

## Task 2: combiner clamp and pixel oracle (MAT-01, P808, P817)

- `emitCombiner` takes its clamp bounds from `COMBINER_CONSTANTS.resultClamp.runtimeDefault`, the row `combiner.ts` already reads (one owner for the clamp).
- Eight committed fixture programs (FinalBlend FB_Overwrite over a Combiner of three synthetic 1 x 1 PNG inputs, no Lineage II bytes) cover colour operations 0 to 7 and alpha operations 0 to 4. `ue2Combiner.test.ts` checks each compiles and `evaluateColourExpression` equals `combineColour` and `combineAlpha`; `materialProgram.test.ts` checks the committed files equal the writer.
- `material-swatch.spec.ts` renders each program and compares the centre readback, all four channels, with `combineColour` and `combineAlpha` within one 8-bit step; the cases include channels clamped at both `resultClamp` bounds (operations 2 with Modulate2X, 3 and 4). `NATIVE_STORE_ROOT=fixture DEV_PORT=5175 pnpm test:e2e tests/browser/material-swatch.spec.ts`: 4 of 4 on SwiftShader. Screenshots: `artifacts/02-92/combiner-swatch/colour-<n>-alpha-<m>.png`. No performance claim.

## Task 3: display gamma (MAT-01, P809)

- `attachDisplayGammaPostProcess(camera)` builds a 256 x 1 r32float lookup texture equal to `buildDisplayGammaTable(defaultDisplayGammaSettings())` and a GLSL post-process mapping red, green and blue through it (alpha unchanged); every number comes from `DISPLAY_GAMMA_ENTRY_COUNT` and the constants rows. `createNativeSliceRuntime` attaches it to the native world camera after every other camera setup and releases it with the runtime. DOM windows, the developer sheet and harness pages are outside it.
- The World tab group Display gamma writes `sandbox-display-gamma-note`: gamma.ramp (corrected-interlude), gamma.setting 1.2 (ue2-data), gamma.brightness-contrast brightness 0.8, contrast 0.7 (unconfirmed), with provenance in the hover variables.
- `displayGammaPostProcess.test.ts` 4 cases pass. `DEV_PORT=5175 pnpm test:e2e tests/browser/native-display-gamma.spec.ts`: 2 of 2 (desktop 1440 x 900, landscape phone 932 x 430 with touch, no horizontal scroll at 430 x 932, no page or console errors). Screenshots: `artifacts/02-92/display-gamma/display-gamma-desktop.png` and `display-gamma-landscape-phone.png`.
- `docs/parts/adapter-dispatch/EVIDENCE.md` no longer says no runtime path applies the ramp nor hands it to 02-67; it names 02-92 and P809 (31,066 bytes).

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_native_assets_diagnostic_slots.py" -v`: 6 of 6 (2 real-client). `test_native_assets*.py`: 54, 4 skipped. Also passing: world static mesh, collision, bsp, source preservation, presentations, material graph, batch adapters and static materials pipeline tests.
- `pnpm vitest run` on displayGammaPostProcess, ue2Combiner, ue2Fog, importBoundaries.materials, materialProgram, ue2StagePlan, ue2BlendTable, ue2Modifiers, ue2Lighting, nativeSkeletalMaterials, fogViewDepth, decodeTileLighting: 164 of 164; native slice runtime files (7): 81 of 81. `pnpm typecheck` clean.
- `node scripts/check-lane-ownership.mjs --base 80f3804 --part adapter-dispatch`: 0 foreign paths.
- Reference overlap, area materials (`--reference-root C:/laragon/www/l2-browser-client`): after task 2, 0 blocking and 2 unreviewed (the re-keyed `emitCombiner`/`emitShader` boundary runs at fragmentChain.ts 97, 14 tokens). After task 3, 28 blocking and 221 unreviewed: 28 blocking and 219 unreviewed in `displayGammaPostProcess.ts` (the GLSL post-process boilerplate at lines 35 to 38 and the row mapping at line 53), 2 unreviewed in fragmentChain.ts. Report: `artifacts/scratch/02-92/overlap-materials-task3.json`. Left for the orchestrator's independent overlap review; no sign-off rows written.

## Deviations from Plan

1. **[Rule 3 - Blocking] Tracer mesh outside 20_21.** The 20_21 meshes product holds no no-adapter row; its 20 such rows are bsp rows. The tracer uses the mesh behind 2,539 of the 2,545 refusals and a second non-effect Combiner mesh (decision row 988). Commit f4040bf.
2. **[Rule 3 - Blocking] Swatch inputs as committed fixtures.** The harness loads programs from the served fixture store, so the swatch programs and PNGs are written by `materialProgramFixture.ts` into `tests/fixtures/lane-store` and checked by the existing writer test instead of being written at spec run time; `materialSwatchParameters.ts` needed no change (decision row 990). Commit 0914b47.
3. **[Rule 3 - Blocking] Sheet context.** The note needs the inspection in `NativeSliceSheetContext`, so `src/runtime/attachNativeSliceSheet.ts` (not in the plan file list) gains `displayGamma` (decision row 991). Commit be2acde.
4. The browser checks ran on port 5175 (`DEV_PORT=5175`, the run rules' dev port) after confirming nothing listened on 5173 or 5175.

## Known Stubs

None.

## Open follow-ups

- The display gamma pass has no pixel-level browser check (the spec checks the note, errors and screenshots); the ramp texels are checked in Vitest.
- 02-88 re-runs meshes and collision of every tile under the new converter hash and records the before and after counts.

## Process cleanup

Playwright started and stopped its own web server on 5175 for both browser runs. After the runs, no listener on 5173 or 5175 and no process with this worktree path in its command line remained besides the checking shell. No dev server, Vite preview, browser or Vitest worker of this plan still runs.

## Self-Check: PASSED

- Files: tests/pipeline/test_native_assets_diagnostic_slots.py, src/materials/ue2/babylon/displayGammaPostProcess.ts, tests/unit/displayGammaPostProcess.test.ts, tests/browser/native-display-gamma.spec.ts exist.
- Commits f4040bf, 0914b47 and be2acde are ancestors of HEAD.
