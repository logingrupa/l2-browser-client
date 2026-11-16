---
quick: 261117-hl7
status: complete
branch: world/day-night-cycle
plan_head_before: 4ace6ec
commits: 11
completed: 2026-11-17
---

# Quick task 261117-hl7: hourly lighting from DB-7 - summary

Ports the verified DB-7 hourly lighting rules (claim audit 42 supported, 7 partly, 0 refuted; 32 of 32 fixtures recompute). Decision: DEC-ENV-2 (owner review).

## Commits

- Stage 1, converter: `a15af76` tile lighting inputs (LMSC.sunAffect, LMPG footer, TINT, SMIC), `a87750a` BSP sections keyed by native render section, `005f467` terrain sample keys, `c0b5d66` static mesh colour stream sidecars.
- Stage 2, model: `b802826` the 32 DB-7 fixtures, `d7e8378` the model in `src/environment/model/`.
- Stage 3, runtime: `73de1aa` BSP slot by sun affect, revision gate and D3D colour op; `019929c` terrain vertex colour on the dirty flag, static mesh and actor terms; `2c01965` Hourly lighting in the Time of day group; `053cdd6` hourly browser check; `1f12cde` dirty flag read before sampling.
- This SUMMARY, the docs, DEC-ENV-2 and the STATE row.

## Gate

- `pnpm typecheck` passes.
- Unit: 3,568 passed, 100 skipped; `nativeEffectRetained` does not load (lane lacks research data).
- Pipeline: 2,936 run, 74 skipped, the 5 known lane errors (unsealed 20_20 and 20_21 raw units, data-ui catalog without npcgrp).
- Browser: `world-tile-lighting.spec.ts` lists and skips here (3 skipped) until 20_21 is restaged.

## Open

- Integration thread: restage 20_21 bsp, lighting, terrain, meshes and manifest, then run `world-tile-lighting.spec.ts` and `world-static-mesh-materials.spec.ts`.
- Still gaps: the 13 DB-7 items, the final shader colour, the live device state, the terrain refresh threshold, the static mesh colour selector, the terrain layer draw, TLIT sector origins, BC1 upload, and PROJECT.md D5.
