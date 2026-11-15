# Architecture

How the browser runtime builds scenes, reads converted assets and takes gameplay state. Decisions and work order: [PROJECT.md](../.planning/PROJECT.md) and [ROADMAP.md](../.planning/ROADMAP.md). The Babylon.js Editor is an optional viewer ([EDITOR_VIEWER.md](EDITOR_VIEWER.md)).

## Now

- `src/scene/loadEnvironment.ts` serves only the native sandbox (DEC-OWN-11). Its scene is built in code from `presentationConfiguration.ts`, labelled "presentation, formerly Editor-authored, not L2".
  - `/`: `startNativeSandboxRuntime` runs `createNativeSliceRuntime` with `NativeSliceAdapter`; `loadNativeSection` loads the section from the staged catalog. `?character=<id>` picks a staged player profile.
  - `?authored=1`: the optional Editor export `public/scene/native-world.babylon`, only through a dynamic import of `authoredNativeWorld.ts`.
- `pnpm dev` and `pnpm build` run no Editor step. `tests/unit/defaultEntryImportGraph.test.ts` fails if `src/main.ts` statically reaches Editor code.
- WebGPU only; engine setup in [RENDERING.md](RENDERING.md).
- The `/l2/` store is read only through `readNativeCatalog` (`/l2/catalog.json`); `buildNativeCatalogIndex` keys it by L2 ID. Contract: [OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md).
- `prepareSceneForReveal` hides canvas and HUD until every runtime declared with `requireSceneStartup` resolves and a frame draws with ready materials. Failure, abort, context loss or the 180 s default deadline shows an error, never a stand-in.
- `PositionInterpolator` converges at rate 12/s, snaps on `shouldSnap` or a gap over 8 m, and never writes back to the adapter.
- Developer controls: `src/ui/devSheet/`. The `WorldInterface` HUD is a procedural stand-in (DEC-OWN-10).

## Server boundary and presentation invariants

`GameWorldAdapter` has four frozen methods: `getInitialState`, `subscribe`, `dispatch`, `dispose`; plan 02-67 removed `advance` (d62ef44), and `.planning/PROJECT.md` and ARCH-02 still name five until the owner records that decision (independent review WR-48). The world frame is metres, Y up, right-handed, matching `useRightHandedSystem = true`: `world = (x, z, y) * 0.01` from UE2 source units, through `src/world/sourceFrame.ts` (DEC-OWN-12). `src/runtime/collisionWorldNavigation.ts` implements the Babylon-free `WorldNavigation` for the door interactions; UI drives the adapter through narrow interfaces such as `NativeLocomotionControlTarget`.

| Invariant | Test in `tests/unit/` |
| --- | --- |
| ARCH-01: no client-computed damage, stats, quest or progression; tooltips never read `weapongrp`, `armorgrp` or `skillgrp` display copies. `src/ui` and `src/runtime` import none of them and nothing from `scripts/`. `skill-cast` carries only `casterId`, `skillId`, `level`, `targetId`. | `architectureInvariants.test.ts` |
| ARCH-02: `GameWorldAdapter` is the only entry for gameplay state. | `gameWorldAdapterContract.test.ts` |
| ARCH-02: `src/world` imports no `@babylonjs` and nothing outside itself; only `src/runtime` imports the concrete adapters. | `importBoundaries.test.ts` |
| ARCH-04: animation, camera, UI, sound choice, effect timing, particle emitter simulation, pawn movement between server updates and time-of-day lighting stay in presentation; `src/world` imports no presentation or runtime folder. | `importBoundaries.test.ts` |

## Open

- Native `interface.xdat` windows replace the stand-in HUD (UI-01 to UI-03).
- A stage B server adapter implements the same interface and maps or rejects the sandbox `WorldCommand` intents (NET-04).
- Entities with movement records are moved by the movement presenter (MOVE-01), and position reports leave as `WorldCommand` intents, never as state writes (MOVE-02).
- Babylon-free cores (DEC-OWN-12, provisional, owner review): `src/shared`, `src/materials/ue2/model`, `src/scene/world/bspVisibility/core`, `src/scene/world/movement/core`, and `src/effects/particles/sim` with `effectScheduler.ts` import no `@babylonjs/*`, package or DOM, and nothing outside themselves except `src/shared/**`; `src/net` imports nothing outside itself. Babylon stays in render folders such as `src/effects/particles/render/**`. Each area adds its own `tests/unit/importBoundaries.<area>.test.ts`, for example `importBoundaries.particles.test.ts` for FX-01.

## Pointers

`src/world/`, `src/runtime/`, `src/scene/`, `src/scene/world/`, `src/assets/native/`, `src/audio/WorldAudioMixer.ts`. Related: [RENDERING.md](RENDERING.md), [NATIVE_AUDIO.md](NATIVE_AUDIO.md).
