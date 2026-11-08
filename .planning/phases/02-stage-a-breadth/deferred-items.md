# Phase 2 deferred items

Out-of-scope problems found while executing a plan. Each is left for its owning plan.

## Found during 02-10

- `pnpm test:unit` on DATABASE-PC at BelowNormal, 2026-11-08 14:35 and 14:37 Riga, at commit c6b2e3f: 23 and then 26 failing cases. All but the 2 known `nativeNpcProfiles.test.ts` cases ("Native player body source identity mismatch") are 5000 ms timeouts, and the failing set changes between runs: nativeEffectStage, nativeEffectRegistration, nativeTerrainPreview, nativeMaterialGraph, nativePowerStrikeSource, nativeDeathCuePreview, nativeEffectRetained, nativeEnvironmentStage, nativeFlameMaterials, nativeCombatAudio and laneOwnership. Run alone, the first 8 files fail only on the 2 nativeNpcProfiles cases. None of these files depends on `src/world` behaviour (nativeDeathCuePreview imports only the `WorldEntity` type). Owner: 02-01, which records the real red baseline; a fix must remove the load contention, not raise the timeouts.
