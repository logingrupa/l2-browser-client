---
quick: 261115-t7o
status: complete
branch: lane/combiner-db1
plan_head_before: 3d5ec4b
plan_head_after: 69a72e8
commits: 2
completed: 2026-11-15
---

# Quick task 261115-t7o: TexOscillatorTriggered in its untriggered state - summary

Source: DB-2 `tex-oscillator-triggered.json` 053c115e (Engine.dll 4dd2f63c, D3DDrv.dll 05622dde, Engine.u 9b04ff5c, FX_E_T.utx cbc082f0), verified 2026-11-15.

## Commits

- `69a72e8` code, tests, fixtures, docs and the PLAN.
- This SUMMARY and the STATE row.

## What changed

- Converter: `Engine.TexOscillatorTriggered` is in `REVIEWED_MATERIAL_CLASSES`. ocean-s writes the five DB-2 fields and the inherited defaults with provenance (RetriggerAction class-default RTA_Retrigger, TriggeredTime, Reverse, Triggered ue-zero). No trigger gap: RetriggerAction acts only on Trigger. Census row reviewed.
- Runtime: `texOscillatorTriggeredMatrix` is `texOscillatorMatrix` at `tau = TriggeredTime < 0 ? 0 : min(t - TriggeredTime, D)`; a non-positive rate gives `material-feature-unported:StopAfterPeriod`. `TEXTURE_COORDINATE_MODIFIER_CLASSES` in `materialProgram.ts` is the one list for the stage plan and the blend table.
- Mismatch found in the TexOscillator evaluator: an unset (ue-zero) oscillation type was reported unported; DB-2 shows it is OT_Pan. Fixed, with a test. The Pan formula, frac, phase, amplitude and the chain order already matched DB-2.
- Rows: `uv.oscillator-pan`, `uv.oscillation-type-unset`, `uv.chain-order`, `uv.triggered-oscillator-window` confirmed-interlude; `uv.oscillator` (Stretch, nonzero StretchRepeat, Jitter) stays unconfirmed; `uv.triggered-oscillator-start-state` 0 unconfirmed (Reset -1, map-reset-reachability).
- The unported examples in tests move to Engine.GlowModifier. The water swatch wraps oceanS in ocean-s.

## Gate

- Seen failing first: 4 Python tests, 10 of 24 in `ue2Modifiers.test.ts`.
- `pnpm typecheck` passes. Affected suites: 275 tests in 14 files pass.
- Python: `test_material_graph` 18 pass, including the E: reference tests (46 FX_E_T roots, no gap; ocean-s fields equal DB-2). `test_material_census`, `test_static_mesh_materials_step`, `test_actor_material_programs` pass; `test_world_bsp_step` passes except the oracle 20_20 test, which needs a sealed raw unit this lane does not hold.
- Whole unit suite: 2,917 passed, 101 skipped; 3 files do not load because this lane lacks `artifacts/native-parity/research/*`.
- `material-swatch.spec.ts` on 5176 with `NATIVE_STORE_ROOT=fixture`: 4 passed. Nothing left on 5176, no process with the lane path.

## Water and stored programs

- Fresh WaterShader01 (`db2-texosc/fresh-programs/abd93efe...`): no gap reasons, compiles. Frame evaluation stops at `material-feature-unported:TexRotationType`: ocn_rot leaves TexRotationType unset.
- 224 stored programs: 201 compiled, 23 diagnostic, unchanged. They predate the converter change, so 65490c71 and 56fda8fd still stop at TexOscillatorTriggered until a reseal. Frame evaluation: ssq_water_01sh now evaluates (unset oscillation type); oren_ded_t.test now stops at EnvMapType.

## Open

- Trigger, Reset and Reverse: no server or level trigger reaches the client.
- Start state: map-reset-reachability. GL2Shader route, bit-exact libm.
- Unset TexRotationType and ColorFadeType are still read as unported (not covered by DB-2).
