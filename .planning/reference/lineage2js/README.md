# Lineage2JS as an implementation reference

> Reference notes, not decisions. `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md` win where they differ. IDs marked "(proposed)" belong to `plan/autonomous-roadmap` and are not in force until that branch adopts them.

Lineage2JS is a Chronicle 4 Lineage II client written in TypeScript on three.js. It already runs five things we still have to build: UE2 materials and fog, the BSP zone walk, MoveActor and APawn movement, UE2 particle emitters, and the network layer with replay. These notes say how it does each one, where Interlude differs, and what we write ourselves. We read it. We don't copy it, and we don't take its dependencies.

| File | Area | Requirements (proposed) | Phase | Lane |
|---|---|---|---|---|
| [01-materials-fog.md](01-materials-fog.md) | UE2 materials, lighting and fog | `MAT-01`, `MAT-02` | 2 | integration for the library, world for lighting data |
| [02-bsp-visibility.md](02-bsp-visibility.md) | BSP zone and portal visibility | `VIS-01` | 2 | world |
| [03-movement.md](03-movement.md) | MoveActor and APawn movement | `MOVE-01`, `MOVE-02` | 2 and 4 | world (part movement-geodata), integration for the adapter side |
| [04-particles.md](04-particles.md) | UE2 particle emitters | `FX-01` | 2 | actors |
| [05-network.md](05-network.md) | Framing, packets, crypto and replay | `NET-09`, `NET-10` | 4 | integration |

The files were written on 2026-11-08 against `native-world-slice` at `22de53a` (code) and `plan/autonomous-roadmap` at `56bf9f7` (planning). Paths and line numbers refer to those commits unless a file says otherwise.

## The reference

| Repository | Commit | Where it lives |
|---|---|---|
| Lineage2JS (`github.com/realratchet/Lineage2JS`) | `854f62920319c458f9d339f8463b2ec8ed16fa9a` | `.assets/reference/lineage2js/` |
| l2js-core (`github.com/realratchet/l2js-core`) | `4aac1bd28945746aa2ecddd72c96e473592ee0bd` | `.assets/reference/l2js-core/` |

`.assets/reference/` is gitignored and lives in the main checkout. Lanes and worktrees read the main checkout's copy. To rebuild it, clone each repository into that folder with `git clone --no-checkout <url> <folder>`, then run `git -C <folder> checkout <commit>`.

The clones are downloaded code. Never run `npm install`, a build, its tests or any of its scripts. Read files and use `git show` only.

Two more sources appear in the files:

- L2J Mobius CT_0 Interlude at `417fd3bc` is the server we target. Its files carry MIT headers. Cite protocol facts as `mobius/<path>:<line>` and write our own code. The roadmap owner decides where the repository keeps a pinned copy.
- Lineage2Elbera at `12c9656` is the owner's own project. Its gateway is a Node server (`ws`, Node `crypto`, `net`), so it is a behaviour reference and never a source for browser code. The vendored `scripts/vendor/lineage2elbera_bsp/` is in-repo converter code owned by the world lane, pinned in its `SOURCE.json`.

Lineage2JS is a C4 client. Every constant and address it took from a binary comes from the C4 Engine.dll (`fa3f0f2a...`). A value counts as native only after someone re-derives it against Interlude Engine.dll `4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`, Core.dll `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` or D3DDrv.dll `05622dde...`, or confirms it from a Mobius capture. Binaries are read, never run. Phase 2 runs reference values as `unconfirmed` defaults. The re-derivation belongs to Phase 5 (`POL-04`), unless a Phase 2 result cannot appear without it, and then the step says why.

## Clean-room rules

Lineage2JS and l2js-core declare ISC in `package.json` but ship no LICENSE file. We treat them as all rights reserved.

You may read the code, cite it as `lineage2js/<path>:<line>`, re-derive its formulas and match the same UE2 behaviour. You may not paste it, translate it line by line, or keep its structure under new names.

Don't look for UE2 engine source, engine headers or leaked client source, even where a reference comment names one.

There is one overlap check, `tools/reference-overlap/` (integration builds it first). It strips comments, replaces identifiers with placeholders and keeps numbers. Every run of 12 or more tokens shared with the reference goes to a reviewer. A run of 20 or more outside the constant allowlist (opcodes, key bytes, sine tables, enum ordinals) blocks the merge. A reviewer who did not write the code signs off in the owning part's `EVIDENCE.md`.

## No vendor dependencies

Babylon.js 9.27.1 is our rendering platform. Browser built-ins are fine: WebSocket, BigInt, DecompressionStream and WebCrypto. The L2 and UE2 semantics are ours.

| The reference uses | For | We use |
|---|---|---|
| `@dimforge/rapier3d` | collider registry (vestigial; its own sweep does the work) | our cylinder extent sweep over converted collision data |
| `egoroof-blowfish` | login and game crypto | our own Blowfish in TypeScript |
| `gmp-wasm` | RSA modpow | `BigInt` modpow |
| `three`, `three-wasm` | rendering, matrices, sorted index buffers | Babylon thin instances and ShaderMaterial, our own index sort |
| `pako` | zlib inside file decryption | not needed in the browser; our Python converters decrypt files |

These never supply semantics for this work: `@recast-navigation/*`, `@babylonjs/materials`, `@babylonjs/node-particle-editor`, Babylon ParticleSystem, Babylon collisions and physics plugins. An import-boundary test keeps `@recast-navigation/*`, `@babylonjs/materials` and `@babylonjs/node-particle-editor` out of `src/**` outside the lazy inspector entry.

## Shared modules

Integration lands `src/shared/` first. The materials library comes next, because world and actors build on both.

| Module | Path | Owner | Used by |
|---|---|---|---|
| Presentation clock: level seconds, frame `dt`, pause, seek | `src/shared/presentationClock.ts` | integration | materials, particles, movement, replay |
| Fixed-step accumulator | `src/shared/fixedStep.ts` | integration | particles, movement replays |
| Seeded RNG: splitmix32 seeding, sfc32, domain streams | `src/shared/random.ts` | integration | particles, materials, test suites |
| Vector, matrix and plane math | `src/shared/math/` | integration | materials, BSP, movement, particles |
| Rotator math: 65536 units per turn, float32 sine table | `src/shared/math/rotator.ts` | integration | particles, movement, materials |
| Typed payload reader | `src/shared/typedPayload.ts` | integration | BSP, movement, lighting |
| Typed payload writer (`.l2asset` with `asset.json`) | `scripts/world/typed_payload.py` | world | BSP, movement, lighting |
| Source-to-scene transform and heading | `src/world/sourceFrame.ts` | integration | all five areas |
| Level.Model loader | `scripts/world/level_model.py` | world | BSP, movement, lighting |
| Zone and volume table | `scripts/world/level_zones.py` | world | BSP, materials, movement |
| Point and box leaf queries | `scripts/world/bsp_leaf_membership.py` | world | BSP, lighting, map emitters |
| Class defaults with provenance | `scripts/native_assets_lib/class_defaults.py` | integration | all converter steps |
| Blend table and fog | `src/materials/ue2/model/blendTable.ts`, `fog.ts` | integration | materials, particles, world bindings |
| Texture frame tick | `src/materials/ue2/model/textureFrames.ts` | integration | materials, particles, flames, sky |
| Material factory and particle fragment hook | `src/materials/ue2/babylon/material.ts` | integration | world, particles, actors |
| Transparent sort comparator | `src/runtime/` (`scene.setRenderingOrder`) | integration | particles, BSP, materials |
| Camera environment record | `src/scene/world/cameraEnvironment.ts` | world | materials, BSP, movement |
| Synthetic Level.Model fixture builder | `tests/pipeline/support/` | shared tests | BSP, movement, materials |
| Golden traces and float32 comparison | `tests/support/goldenTrace.ts` | integration | particles, movement, materials, replay |
| Capture and replay channel | `src/net/channel/replayChannel.ts`, `tools/net-relay/` | integration | network, movement |
| Reference overlap check | `tools/reference-overlap/` | integration | all five areas |

## Conventions all five files follow

Source units are UE2 units of about 1 cm with Z up. "Native", "UE" and "L2" units mean the same thing. The browser frame is metres, right-handed, Y up: `world = (x, z, y) * 0.01` and `source = (X, Z, Y) * 100`. `src/world/sourceFrame.ts` is the only converter. The "left-handed" comment at `src/world/worldTypes.ts:1` exists only on `native-world-slice` and is wrong.

Rotators and headings use 65536 units per turn. A heading is measured in source space, 0 along +X and 16384 along +Y, and converted once in `sourceFrame`. Location, velocity and particle columns are float32: round with `Math.fround` at every write and compute in float64.

`presentationClock` is the only source of level seconds and frame `dt`. Particles step it at a fixed 1/60 s through `fixedStep`. Movement uses raw `dt` with its own native substeps. The network keeps a separate monotonic clock for protocol timeouts. Replays drive the presentation clock at a fixed `dt`. Game hour and environment type come from the server and are values, not clocks.

Every constants registry uses one row shape: `{id, value, provenance, status, interludeEvidence, runtimeDefault}`. Status is one of `ue2-data`, `unconfirmed`, `confirmed-interlude`, `corrected-interlude` or `unknown`. A limit without a source runs at its most visible value until someone confirms it.

Six folders stay free of Babylon, packages and the DOM: `src/shared`, `src/materials/ue2/model`, `src/scene/world/bspVisibility/core`, `src/scene/world/movement/core`, `src/effects/particles/sim` with `effectScheduler.ts`, and `src/net`. Each may import `src/shared/**` and nothing else outside itself. `src/net` imports nothing outside itself. `src/world` imports no Babylon and reaches only `src/net`. Each area adds its own block or test file for these rules, so lanes don't edit the same test.

Three new tile resources (`bsp-visibility`, `native-tile-collision` and `lighting`) use `.l2asset` with `asset.json` recording units and axes. `scripts/world/typed_payload.py` writes them and `src/shared/typedPayload.ts` reads them. One contract change registers all three in `docs/OUTPUT_CONTRACT.md`.

Visual and collision BSP solidity stay separate on purpose. Visual skip flags come from `recipes/world/bsp-poly-flags.json`. Collision solidity follows the outside-bit rule, and PolyFlags there are diagnostic only. Zone locate (a point exactly on a plane goes front) and PointCheck (front only when `d > 0`) are two native routines with their own fixtures. The tile census checks that their solid regions agree.

The BSP walk orders blocks inside a mesh. One integration-owned comparator orders meshes by distance, then by per-actor emitter ordinal. No area sets an absolute `alphaIndex`.

Gap reasons live in lane files (`recipes/world/gap-reasons.json`, `recipes/actors/gap-reasons.json`, `recipes/data/gap-reasons.json`). Integration owns the seed list in `scripts/native_store/gap_reasons.json`. Names follow `<domain>-class-unported:<class>` and `<domain>-feature-unported:<property>`. The lane that owns the part writes the row.

Committed fixtures are synthetic, or indices and hashes only. Tests that need the real client read it through `--client` and skip with a reason when it is missing.

Packets use Mobius class names with their opcode. The Lineage2JS name appears once in parentheses, for example client `MoveToLocation` 0x01 (Lineage2JS `MoveBackwardToLocation`).

## Data that crosses areas

- `cameraZone` goes from the BSP walk to materials fog.
- `fogEnd` goes from materials to the camera far plane, which the BSP frustum reads.
- The camera's water or physics volume goes from movement to materials fog.
- Map emitter visibility goes from the BSP walk to the particle scheduler, keyed by placement id.
- The world lane exports map Emitter actors once, for particles and the BSP walk.
- The blend table, fog family and texture frames go from materials to particles and the world bindings.
- Game time and environment type go from the network adapter to materials lighting.
- Movement events go from the network adapter to the movement presenter.
- Triggers reach materials and emitters only through adapter events.

The adapter contract grows by record types only, in one integration commit before any adapter code: `command-rejected`, `AccountSession`, `environment`, the movement events `move`, `stop`, `correct` and `teleport`, the intents `report-position` and `cannot-move`, an origin on `move-local`, and EntityKind `npc`. The five `GameWorldAdapter` methods stay frozen. `WorldEntity` positions stay in metres. Movement events and intents carry source units, so truncation and rounding match L2.exe.

## How to use one of these files

1. Read "Behaviour to implement" and "Design", then open the reference paths the file cites.
2. Write the tests under "Acceptance" first, with synthetic fixtures.
3. Build inside the file's owned paths and keep the import boundaries.
4. Add each constant to the area registry as `unconfirmed`, with its provenance.
5. Run `tools/reference-overlap/` and record the reviewer in the part's `EVIDENCE.md`.
6. Judge the result against L2.exe on IMPORTA-PC in the Phase 3 side-by-side checks. Matching Lineage2JS proves nothing on its own.
