---
quick: 261115-c6m
status: complete
branch: lane/combiner-db1
plan_head_before: 062e2cb
plan_head_after: b22a7f2
commits: 2
completed: 2026-11-15
---

# Quick task 261115-c6m: combiner rules follow DB-1 - summary

The UE2 material library builds Combiners by the DB-1 rules (D3DDrv.dll 05622dde, `combiner-stage-semantics` cb9b11ac, replayed 2026-11-15). The stage plan, the CPU evaluator and the GLSL chain agree; the CPU evaluator is the swatch reference.

## Commits

- `b22a7f2` code, tests, fixtures, docs and the PLAN.
- This SUMMARY and the STATE row.

## What changed

- `stagePlan.ts`: `material-combiner-mask-absent` is gone. A combiner expression carries `firstEmittedMaterial`: Material2 when Material1 is a texture expression and Material2 is not, or when both are textures with InvertMask and Mask identical to Material2, else Material1. Review fix: `maskAlphaComplemented` (InvertMask skips a ConstantColor or FadeColor Mask) and `alphaComplementedMaterial` (a Mask identical to F with InvertMask complements F alpha).
- `combiner.ts`: `CombinerOperands` (Material1, Material2, F, routed mask alpha); `routedMaskAlpha` reads alpha; CO4 `M2 - M1`; CO5 `M2 * m + M1 * (1 - m)`, `m = F.a` with Mask=None; CO6 `M2.rgb + M2.a * M1.rgb` with the cap, else `M1 + M2`; CO7 `F.rgb`; AO0 the routed mask alpha, else `F.a`.
- `fragmentChain.ts`: the same forms in GLSL.
- Rows: `combiner.mask-channel` alpha, `combiner.operation-forms` (new) and `combiner.mask-named-operations` corrected-interlude; `combiner.first-emitted-material` (new) and `blend.ob-normal-opacity` confirmed-interlude; `combiner.modulate-alpha-add-colour-cap` (new, true, unconfirmed: no live device caps); `combiner.missing-mask-alpha` deleted; `combiner.result-clamp` and `combiner.absent-material` stay unconfirmed with DB-1 provenance.
- Swatch fixture: 6 Mask=None cases (CO5, CO6, CO7 with Material2 a texture or a nested Combiner) and the WaterShader01 chain under an overwrite FinalBlend; 7 programs and 3 textures added. The spec takes its expectation from the CPU evaluator over each compiled program.
- Docs: `01-materials-fog.md` Combiner table, the mask-channel row and the open question; `docs/parts/adapter-dispatch/EVIDENCE.md` lines 18, 19 and 83, trimmed to stay under 30,720 bytes.

## Gate

- Seen failing first: `ue2Combiner.test.ts` did not load, 9 of 32 in `ue2StagePlan.test.ts` and 1 of 27 in `ue2BlendTable.test.ts` failed.
- `pnpm typecheck` passes. No lint script exists.
- Affected suites: 221 tests in 7 files pass (`ue2Combiner` 57, `ue2StagePlan` 32, `ue2BlendTable` 27, `materialProgram`, `laneOwnership`, `importBoundaries.materials`, `referenceOverlapReviewedRuns`).
- Whole unit suite once: 2,895 passed, 101 skipped, 1 failed (the adapter-dispatch EVIDENCE size, fixed and passing in the rerun above); 3 files do not load because this lane lacks `artifacts/native-parity/research/*` (environmental).
- `material-swatch.spec.ts` on port 5176 with `NATIVE_STORE_ROOT=fixture`: 4 passed, 15 GPU swatches within one 8-bit step of the CPU evaluator. Screenshots: `artifacts/02-92/combiner-swatch/`. Nothing left listening on 5176, no process with the lane path.

## Stored programs

Read only: 224 unique programs from `E:/l2b-speed-proof/present/artifacts/lane-store/world/l2/native-materials` and `C:/laragon/www/l2b-speed/artifacts/lane-store/world/l2/native-materials` (`public/l2` holds none). Before: 201 compiled, 23 diagnostic; 2 hit `material-combiner-mask-absent`, both WaterShader01. After: the same counts. `65490c71` now stops at `material-class-unported:Engine.TexOscillatorTriggered` (ocean-s); `56fda8fd` at `texture-image-absent:FX_E_T.WaterSurfaceSet.ocean011`, then TexOscillatorTriggered. Scripts and outputs: `C:/laragon/l2b-orchestration/autonomous-roadmap/combiner-db1/`.

## Open

- Per-result clamp (DB-1 gpu-clamp-and-precision unresolved).
- Null Material2 stays white.
- Native rejection of two non-bitmap children and of AO1-AO4 with a Mask other than None, Material1 or Material2.
- The Modulate2X compatibility path.
- Alpha test GREATER 0 for OB_Normal with Opacity is not emitted; with SRCALPHA blending and ZWrite off a zero-alpha pixel changes nothing.
- InvertMask with a Mask identical to the appended bitmap that cannot be reordered, for AO1-AO4 (DB-1 weak row).
- CO6 in the swapped order with a separate Mask (DB-1 colour-6, mask-routing).
