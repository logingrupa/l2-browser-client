# Offline sandbox evidence

Part `sandbox`, lane `data-ui`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

- SAND-01: the sandbox sheet on `/` spawns an NPC, equips an item and opens a window by ID on `NativeSliceAdapter`, and an ID without a converted asset shows the missing-asset marker with no stand-in (browser check `tests/browser/sandbox.spec.ts`). Cast by ID and the command rules are covered by the unit tests `tests/unit/sandboxCommands.test.ts`, `tests/unit/sandboxCommandSheet.test.ts`, `tests/unit/sandboxMissingAsset.test.ts`.
- NOED-01 and NOED-03: every browser check opens `/` (the code-built native sandbox, `?world=interlude` before DEC-OWN-11) or a test harness page; no spec uses the `world` query parameter, `authored=1` or `public/scene`. A missing `/l2/catalog.json` shows "Native asset store not staged" (`tests/browser/nativeStartup.spec.ts`). Full `pnpm test:e2e` on PROMINENCE-PC, 2026-11-08 11:03 Riga, port 5173 free: 36 tests, 31 passed, 5 skipped, 0 failed. The 5 skips need local artifacts this machine does not have: three `assetPackage.spec.ts` cases (converted native packages), `nativeTexture.spec.ts` (migration coverage) and one `nativeBsp.spec.ts` case (Actor940 contact oracle).
- NOED-04: `?inspect=1` lazy-loads Babylon Inspector over the sandbox (`tests/browser/inspector.spec.ts`, plan 01-16).
- Private preview: the five preview scripts open `/` from `scripts/private-preview-targets.mjs`, pinned by `tests/unit/privatePreviewTargets.test.ts`. `preview:private` itself was not run.

## Dev cold start after the Editor pack left `pnpm dev`

Re-measured with `pnpm exec playwright test --config playwright.startup.config.ts` (`tests/startup/devStartup.spec.ts`, fresh Vite on 127.0.0.1:5175, one worker, trace on), route `?world=interlude` (now `/`), warm `.vite/deps` cache (browserHash `c9433f75` before both runs). The Vite log printed no "new dependencies optimized" line in either run.

PROMINENCE-PC, Ryzen 7 7800X3D, not comparable to the DATABASE-PC baseline.

| Run | Script requests | Script bytes | All requests | All bytes | First `src/runtime/` request | Longest completion gap | Ready | `babylonjs-editor-tools` requests |
|-----|-----------------|--------------|--------------|-----------|------------------------------|------------------------|-------|-----------------------------------|
| 1 | 630 | 13,648,199 | 930 | 134,324,765 | 0.551 s | 1.225 s | 10.234 s | 0 |
| 2 | 630 | 13,648,183 | 930 | 134,287,358 | 0.577 s | 0.822 s | 10.222 s | 0 |

Baseline (DATABASE-PC, route `?world=courtyard`, Editor pack in dev): 262 and 288 script requests, 7,537,124 and 8,748,728 bytes, first runtime module at 38.56 s and 39.25 s, longest gap 22.984 s and 21.528 s, Editor-tools closure 134 files.

Traces and JSON: `artifacts/dev-startup/prominence-run-1/` and `artifacts/dev-startup/prominence-run-2/` (`trace.zip`, `dev-startup-native-sandbox.json`).

DATABASE-PC, same machine as the baseline, 2026-11-08 14:25 Riga, same config and spec, two runs back to back:

| Run | Script requests | Script bytes | All requests | All bytes | First `src/runtime/` request | Longest completion gap | Ready | `babylonjs-editor-tools` requests |
|-----|-----------------|--------------|--------------|-----------|------------------------------|------------------------|-------|-----------------------------------|
| 1 | 633 | 13,542,594 | 929 | 133,516,754 | 6.116 s | 41.857 s | 64.635 s | 0 |
| 2 | 633 | 13,542,594 | 929 | 133,516,423 | 4.192 s | 8.939 s | 37.530 s | 0 |

Same machine, different route: the baseline route `?world=courtyard` is retired, so `?world=interlude` (which also loads about 133 MB of native assets) is the only comparable route. The wait before the first runtime module fell from about 39 s to 4 to 6 s, and no Editor tools are requested. The longest completion gap is not gone: 8.9 s on the second run, 41.9 s on the first. Its cause is not established; the first run's gap falls while the native assets load, which the courtyard baseline never did. Removing the Editor pack is not claimed to have fixed it.

## Open

- Dev cold start: the 41.9 s first-run completion gap on DATABASE-PC has no established cause (open observation, not a NOED-02 failure).
- SAND-02: pinnable developer sheet with hover-cards (Phase 2).
- UI-01: `interface.xdat` decoded to a layout tree, so native Interlude windows can replace the procedural HUD stand-in.
- The 5 e2e cases that skip on PROMINENCE-PC run only where their artifacts exist.

## Evidence

Adapter: `src/world/NativeSliceAdapter.ts`. Sandbox config: `src/runtime/nativeSandboxConfiguration.ts`.
