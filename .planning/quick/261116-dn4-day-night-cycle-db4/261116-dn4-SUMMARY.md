---
quick: 261116-dn4
status: complete
branch: world/day-night-cycle
plan_head_before: 66279b8
plan_head_after: 39c38a8
commits: 10
completed: 2026-11-16
---

# Quick task 261116-dn4: day/night cycle from DB-4 - summary

Ports the verified DB-4 day/night rules (report `fe5de165`; claim audit 21 supported, 5 partly, 0 refuted; 320 of 336 fixtures recompute bit for bit, 4 SunScale hour-0 rows unwritten, 12 MoonScale rows `time-scale-read-past-table`). Decision: DEC-ENV-1 (owner review).

## Commits

- `75aad08` DB-4 fixtures and effective loaded tables in `tests/fixtures/environment/`.
- `54599ea` environment program out of the per-tile lighting records.
- `2123748` one native ini owner and the effective `time-tables.json`.
- `0d31546` clock, manager and CalcEnvDelta (pure model).
- `d9677eb` table sampling, FGetHSV, getters, sun and moon (336 fixtures checked: 320 bit for bit, 16 scale rows unwritten or a named gap).
- `1655d6e` adapter split: `server-time`, `environment-ssq-info`, `environment-red-sky`.
- `e9c899f` one world manager from the staged tables; tile lighting reads it.
- `84ab687` sky ColorModifier Color R, G, B writer; physical-row comparison deleted.
- `39c38a8` World sheet Time of day group and `world-day-night-sky.spec.ts`.
- This SUMMARY, the docs and the STATE row.

## Gate

- `pnpm typecheck` passes.
- Unit: 3,435 passed, 100 skipped; `nativeEffectRetained` does not load (lane lacks research data).
- Pipeline: 2,886 run, 74 skipped, 5 environment errors (unsealed 20_20 and 20_21 raw units, data-ui catalog without npcgrp).
- Browser: `world-day-night-sky.spec.ts` lists and skips here; it needs the restaged export.

## Open

- Integration thread: restage the environment export and lighting records, re-pin `nativeEnvironmentSource`, run `world-day-night-sky.spec.ts`, `nativeSliceFraming.spec.ts` and `world-tile-lighting.spec.ts`; the converter version raise lands with DB-3.
- Named gaps: see `docs/NATIVE_SKY.md`. Only the sky colours reach the screen (`environment-lighting-composition-unresolved`).
