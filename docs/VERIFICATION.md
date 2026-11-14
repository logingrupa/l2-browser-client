# Verification

How a done claim is proved and where the evidence lives. No part has passed the stage A check yet. Decisions and order: [.planning/PROJECT.md](../.planning/PROJECT.md), [.planning/ROADMAP.md](../.planning/ROADMAP.md).

## Now

- A done claim needs a passing test or a screenshot, and nothing your run started may still run ([AGENTS.md](../AGENTS.md)). Behaviour changes ship with a Vitest test; UI changes also get a Playwright check.
- Test and build commands: [README.md](../README.md). `pnpm test:pipeline` runs `tests/pipeline` and `scripts/native_catalog`.
- Loads count only from load-check records. A load sweep runs only as a slice: `NATIVE_STORE_ROOT=<lane> LOAD_CHECK_KIND=<tiles|npcs|items|skills|windows|tables> LOAD_CHECK_LIMIT=<n> pnpm test:e2e tests/browser/load-sweep-<kind>.spec.ts`, started only while nothing listens on port 5173. It writes one record per key to `artifacts/lane-store/<lane>/load-checks/<catalogSha256>.json`, and a rerun continues with the keys not yet recorded. The optional `LOAD_CHECK_KEYS=<key,key>` limits the slice to those converted keys, in that order, to re-sweep the keys a converter fix touched. Union loads come only from slices run on the union catalog; lane records are never carried over to it.
- Native browser checks skip when the staged store is absent. Only the integration thread stages it (`pnpm assets:stage`, `pnpm assets:migrate --stage-runtime`).
- Screenshot viewports (DEC-OWN-9) and the SwiftShader FPS rule: [AGENTS.md](../AGENTS.md). Playwright has only a desktop Chromium project, so a phone check sets its own viewport. Mobile means emulation, never a physical phone.
- Stage A bar (DEC-OWN-3, CHECK-01, CHECK-02): converted, loads in the sandbox, passes a side-by-side screenshot or listen check against L2.exe on IMPORTA-PC. Unverified is never a pass. Fixed thresholds: [NATIVE_PARITY.md](NATIVE_PARITY.md).
- Verdicts go in `docs/parts/<part>/EVIDENCE.md` (CHECK-03); [STATUS.md](../STATUS.md) keeps one line per part.
- Receipts under `artifacts/native-parity/research/` record browser, pipeline or byte checks, not stage A verdicts; [research/INDEX.md](research/INDEX.md) rates each folder.

## Open

- Paired screenshots and listen checks per part (CHECK-01, CHECK-02); stage A exit report (CHECK-05).
- The native reference capture fails the 30 FPS gate (POL-01): [NATIVE_PARITY.md](NATIVE_PARITY.md).
- Dev cold start: an unattributed 21-23 s module gap. `pnpm dev` no longer runs the Editor pack; plan 01-17 re-measures and writes the result to [parts/sandbox/EVIDENCE.md](parts/sandbox/EVIDENCE.md) (NOED-02, NOED-03). Removing a suspected cause does not prove the gap is gone. Baseline: `artifacts/native-parity/research/editor-dev-startup/`.

## Pointers

- Terrain GPU check: `pnpm exec playwright test --config playwright.terrain.config.ts`. Output and `REPORT.md` (44/44 GPU cases on the GTX 1060): `artifacts/native-parity/research/terrain-uv-reference-20261106/`.
- Optional Editor-path tests that gate nothing: [EDITOR_VIEWER.md](EDITOR_VIEWER.md).
- Local, ignored evidence: `artifacts/native-parity/`, `artifacts/native-client-audit/`, `artifacts/private-preview/` ([PRIVATE_PREVIEW.md](PRIVATE_PREVIEW.md)); failure traces in `test-results/`.
- World rebuild and collision gaps: [NATIVE_WORLD.md](NATIVE_WORLD.md).
