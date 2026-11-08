# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Babylon.js WebGPU, strict TypeScript, pnpm, Vite, Vitest and Playwright. Babylon.js Editor 5.5.3 is an optional viewer only (DEC-OWN-8, [docs/EDITOR_VIEWER.md](docs/EDITOR_VIEWER.md)); nothing in the build or runtime depends on it.

## Users and purpose
Developers building a browser client for Lineage II Interlude with a replaceable world adapter. The client converts every asset of the native client into `.l2asset` packages plus the runtime catalog, proves each part in an offline sandbox, then plugs in a server through `GameWorldAdapter`. The client never computes gameplay outcomes; it displays what a server sends. Scope, decisions and work order: [.planning/PROJECT.md](.planning/PROJECT.md), [.planning/ROADMAP.md](.planning/ROADMAP.md) and [.planning/STATE.md](.planning/STATE.md).

## Rendering direction

Use modern Babylon.js WebGPU rendering that keeps Lineage II's visual identity, source asset relationships and gameplay behaviour. Reproduce old Direct3D details only when they explain a meaningful visible difference or required behaviour. World chunking and streaming, terrain and mesh LOD, compatible static instancing, GPU texture compression and visibility culling are measured engineering work. [docs/RENDERING.md](docs/RENDERING.md) records route-specific capabilities and gaps. Bounded rendering improvements do not wait for overall native parity. Fidelity and hardware acceptance thresholds stay fixed (DEC-PARITY-1).

## Capabilities and constraints

1:1 includes original Interlude audio, with native timing, selection, looping, volume and spatial and listener behaviour. Decoding a sound or playing it in the asset inspector does not satisfy this. Each rule is marked as native evidence or as a labelled presentation choice. [docs/NATIVE_AUDIO.md](docs/NATIVE_AUDIO.md) records acceptance, coverage and gaps.

The world's source of truth is the original client plus the converter. The native world loads directly from the `.l2asset` catalog. The Editor can open converted content as an optional viewer, and an Editor hand edit is never a source of world content (DEC-OWN-8).

The asset structure guides the client. Keep the original character-part, equipment, skeleton, attachment, material and animation relationships that the source files and manifests carry. Adapt loaders, assembly rules, animation mapping and unit handling to that evidence. Do not rename, flatten, rebake or uniformly resize valid content to fit prototype assumptions. A conversion change needs a demonstrated defect or a loss of required source structure. Keep asset resolution separate from the world adapter and networking.

Native player profiles come from the four native Interlude Human exports (MFighter, FFighter, MMagic, FMagic), staged by `pnpm assets:stage` (`scripts/stage_native_players.py`) into ignored `public/l2/`. Nothing comes from lineagen. They keep native scale (exporter 0.01, actor DrawScale and class collision; no height fitting). They bind 45 of 46 animation aliases to exact package clips; `damage` has no native clip. They add one-shot and retrigger behaviour without changing the assets. Semantic `appearanceId` and `animationSequence` fields stay on the adapter boundary; format-specific choices stay in presentation.

The native route requires its real actor packages and world. Its startup reports missing or failed resources and never presents procedural stand-ins. Geometry, skinning, animation and runtime correctness decide technical usability; provenance is recorded separately in [docs/SOURCE_REUSE.md](docs/SOURCE_REUSE.md). Converted binaries and captures stay untracked and local. `pnpm build` excludes the lineagen-derived `public/assets/characters/` and `public/assets/world/` trees.

Performance results are labelled by machine. IMPORTA-PC has a 144 Hz display with a 120 Hz mode that must be selected before presentation tests; its RTX 4090 cannot certify the GTX 1060 target ([docs/NATIVE_PARITY.md](docs/NATIVE_PARITY.md)).

## Interface commitment
A game-like scene with compact controls. The developer and sandbox controls live in the pinnable Dev sheet with hover-cards that show each control's live variables, values, source and native-or-presentation status; never a cramped toggle scroll list. The offline sandbox spawns converted NPCs, items, skills and windows by ID; an ID without a converted asset shows an explicit missing-asset diagnostic (SAND-01).

The game interface is the original Interlude interface only (DEC-OWN-10): window layout from `interface.xdat`, and skin, fonts and icons from the client's converted UI textures. The procedural HUD is a stand-in until native windows replace it. Show actual screenshots at visible implementation milestones.

## Server boundary

`GameWorldAdapter` is the only way gameplay state enters the client. A server adapter (stage B, Phase 4; stock L2J Mobius first) must deliver real initial state and ordered entity events, normalize coordinates and time, and identify teleports without a renderer rewrite. Synthetic developer commands need an explicit support policy in a real adapter. Acceptance needs actual authentication, character selection and entry into a stock server's world; the synthetic sandbox, asset imports and placeholder login screens do not count. Combat calculation, quests, progression and production deployment stay out of scope.
