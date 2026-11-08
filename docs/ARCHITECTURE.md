# Architecture

How the browser runtime builds scenes, reads converted assets and takes gameplay state. Decisions and work order: [PROJECT.md](../.planning/PROJECT.md) and [ROADMAP.md](../.planning/ROADMAP.md). The Babylon.js Editor is an optional viewer ([EDITOR_VIEWER.md](EDITOR_VIEWER.md)).

## Now

- `src/scene/loadEnvironment.ts` serves only the native sandbox (DEC-OWN-11).
  - `/`: `loadScene` reads the Editor-packed `public/scene/native-parity.babylon`; its script `src/scripts/nativeParity.ts` runs `createNativeSliceRuntime` with `NativeSliceAdapter`, and `loadNativeSection` loads the section from the staged catalog. `?character=<id>` picks a staged player profile.
  - `?authored=1`: the optional Editor export `public/scene/native-world.babylon`.
- `pnpm dev` and `pnpm build` still run the Editor pack (`pnpm generate`) until NOED-01 and NOED-02 land.
- WebGPU only; engine setup in [RENDERING.md](RENDERING.md).
- The `/l2/` store is read only through `readNativeCatalog` (`/l2/catalog.json`); `buildNativeCatalogIndex` keys it by L2 ID. Contract: [OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md).
- `prepareSceneForReveal` hides canvas and HUD until every runtime declared with `requireSceneStartup` resolves and a frame draws with ready materials. Failure, abort, context loss or the 180 s default deadline shows an error, never a stand-in.
- `PositionInterpolator` converges at rate 12/s, snaps on `shouldSnap` or a gap over 8 m, and never writes back to the adapter.
- Developer controls: `src/ui/devSheet/`. The `WorldInterface` HUD is a procedural stand-in (DEC-OWN-10).

## Server boundary and presentation invariants

`GameWorldAdapter` has five frozen methods: `getInitialState`, `subscribe`, `dispatch`, `advance`, `dispose`. The world frame is metres, Y up, right-handed. Mesh navigation (`src/scene/navigation/meshNavigation.ts`) implements the Babylon-free `WorldNavigation`; UI drives the adapter through narrow interfaces such as `NativeLocomotionControlTarget`.

| Invariant | Test in `tests/unit/` |
| --- | --- |
| ARCH-01: no client-computed damage, stats, quest or progression; tooltips never read `weapongrp`, `armorgrp` or `skillgrp` display copies. `src/ui` and `src/runtime` import none of them and nothing from `scripts/`. `skill-cast` carries only `casterId`, `skillId`, `level`, `targetId`. | `architectureInvariants.test.ts` |
| ARCH-02: `GameWorldAdapter` is the only entry for gameplay state. | `gameWorldAdapterContract.test.ts` |
| ARCH-02: `src/world` imports no `@babylonjs` and nothing outside itself; only `src/runtime` imports the concrete adapters. | `importBoundaries.test.ts` |
| ARCH-04: animation, camera, UI, sound choice, effect timing and smoothing stay in presentation; `src/world` imports no presentation or runtime folder. | `importBoundaries.test.ts` |

## Open

- Sandbox by-ID actions and the visible missing-asset marker (SAND-01, ARCH-03, plan 01-14). ARCH-04 stays pending until then.
- Babylon Inspector behind `?inspect=1` is not in `src` yet (NOED-04, plan 01-16).
- Native `interface.xdat` windows replace the stand-in HUD (UI-01 to UI-03).
- A stage B server adapter implements the same interface and maps or rejects the sandbox `WorldCommand` intents (NET-04).

## Pointers

`src/world/`, `src/runtime/`, `src/scene/`, `src/scene/world/`, `src/assets/native/`, `src/audio/WorldAudioMixer.ts`. Related: [RENDERING.md](RENDERING.md), [NATIVE_AUDIO.md](NATIVE_AUDIO.md).
