# Phase 2 deferred items

Out-of-scope problems found while executing a plan. Each is left for its owning plan.

## Found during 02-10

- `pnpm test:unit` on DATABASE-PC at BelowNormal, 2026-11-08 14:35 and 14:37 Riga, at commit c6b2e3f: 23 and then 26 failing cases. All but the 2 known `nativeNpcProfiles.test.ts` cases ("Native player body source identity mismatch") are 5000 ms timeouts, and the failing set changes between runs: nativeEffectStage, nativeEffectRegistration, nativeTerrainPreview, nativeMaterialGraph, nativePowerStrikeSource, nativeDeathCuePreview, nativeEffectRetained, nativeEnvironmentStage, nativeFlameMaterials, nativeCombatAudio and laneOwnership. Run alone, the first 8 files fail only on the 2 nativeNpcProfiles cases. None of these files depends on `src/world` behaviour (nativeDeathCuePreview imports only the `WorldEntity` type). Owner: 02-01, which records the real red baseline; a fix must remove the load contention, not raise the timeouts.
  - 02-01 measured it (see 02-01-SUMMARY.md "Known red baseline"): three `pnpm test:unit` runs at BelowNormal with no other test or build running, 2026-11-08 15:33 to 15:35 Riga, at commit 3bfee36. Runs 1 and 3: only the 2 nativeNpcProfiles cases fail. Run 2: those 2 plus one 5000 ms timeout in `nativeEffectRegistration.test.ts` ("refuses a stale plan and preserves a newer door-owner catalog edit"); that file alone passes 17 of 17 in 3.4 s. So the timeouts come from parallel load, and the 14:35 runs were heavier than an idle machine. 02-01 decision (OVERNIGHT-DECISIONS row 77): no timeout or worker count is changed. The item stays open for the integration thread. A fix makes the slow fixtures cheaper (for example nativeEffectRegistration copies and hashes real Power Strike resources per case) and never adds a longer timeout.

## Found during 02-12

- `pnpm vitest run tests/unit/laneOwnership.test.ts`, 2026-11-09 01:06 Riga, at commit 7ee97ad: 1 of 36 fails, "has an evidence doc for adapter-dispatch under 30 KB": `docs/parts/adapter-dispatch/EVIDENCE.md` is 33,680 bytes. Plan 02-12 did not touch that file (lane integration). Owner: the adapter-dispatch evidence writer (02-57, 02-59, 02-60), which must shorten the doc to its current facts.
