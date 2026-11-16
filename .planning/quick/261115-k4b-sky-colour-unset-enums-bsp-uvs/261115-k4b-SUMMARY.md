---
quick: 261115-k4b
status: complete
branch: lane/combiner-db1
plan_head_before: dde6fae
plan_head_after: ce3ffd2
commits: 4
completed: 2026-11-15
---

# Quick task 261115-k4b: sky colour order, unset enums, BSP UVs - summary

## Commits

- `3962690` sky Color read B, G, R, A; sky programs pinned and bound on the tile clock; sky step 3.
- `db39b0a` unset enums written as member 0; runtime OT_Pan fallback removed.
- `ce3ffd2` BSP UVs from the source texture size; BSP step 6; converter output version raised once.
- This SUMMARY and the STATE row.

## What changed

- Sky: `authored_colour_rgba` decodes through the recipe Color layout (Q6, Core.dll 9462f87a). Integration program 50da02b1 `SkybackgroundColor` `ce9600ff` is (0, 150, 206). Before, `sky.glb` was the frozen PBR snapshot and `librarySurfaces` only read pins, which the sky GLB never had: no sky program was bound. Now each pinned program that compiles is bound on the tile lighting clock (fog off, no depth write); without a lighting resource the status stays `library-environment-clock-unwired`. The three 18_14 integration sky programs compile and evaluate on the lane runtime.
- Enums: `class_default_field_value` writes `{ordinal 0, name}` for ue-zero enums from the decompiled Engine.u order (`class_defaults.py` enums; E: real-client tests pin ocn_rot TR_FixedRotation, ocean-s OT_Pan, EColorFadeType FC_Linear). A side effect matches the runtime: a Shader with unset OutputBlending (OB_Normal) and an Opacity input is translucent in the BSP section table.
- TR_FixedRotation is in `modifiers.ts` (angle = Rotation, about UOffset/VOffset); `uv.rotator-component` (Yaw) is still `unknown`. The authored ocn_rot M is a 22.5 degree rotation, matching Yaw 4096.
- BSP: `Converter.material_texture_export` resolves Shader Diffuse, FinalBlend Material and Texture without UModel; `source_texture_size` reads USize and VSize; TEXCOORD_0 follows the known size.
- Version: `CONVERTER_OUTPUT_VERSION_RAISED_BY_HAND_ONLY_WHEN_OUTPUTS_CHANGE` c4bf8e6c... to ecbc0590... (the source digest before the raise), `RECORDED_CONVERTER_SOURCE_DIGEST` a2321966... to 88d6c25b..., two version goldens updated.

## Gate

- `pnpm typecheck` passes. Whole unit suite: 2,926 passed, 101 skipped; 3 files do not load (lane lacks research data).
- Pipeline suite: 2,839 run, 74 skipped; 5 environment errors that also fail at dde6fae (unsealed 20_20 and 20_21 raw units, data-ui lane catalog without npcgrp), everything else passes after the fixes.
- `material-swatch.spec.ts` on 5176 with the fixture store: 4 passed. Nothing left on 5176.
- Fresh WaterShader01 (graph of abd93efe, re-derived read-only): program f1932162 evaluates at t 0 and t 1. The old abd93efe now stops at `UOscillationType` (TexOscillator0, unset) because the runtime fallback is gone; the reconvert replaces it.

## Open

- Superseded: DB-3 answered the per-class mapping size; 261116-d3m (7da6f85) replaced the source texture size path.
- No Playwright check of a bound sky: the lane cannot stage a store with pinned sky GLBs.
- The served 20_20 sky on `/` keeps the old colour until the integration thread restages it.
