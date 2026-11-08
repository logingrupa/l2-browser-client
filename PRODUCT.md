# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User specified Babylon.js Editor v5 native Vanilla, strict TypeScript, pnpm, Vitest and Playwright. Vite is the native build tool.

## Users and purpose
Developers building a browser-based Lineage II client with an editable Babylon
world and a replaceable world adapter. The local native Interlude route now has
terrain, scenery, original actors and limited audio; the earlier six-entity
synthetic foundation remains available. Verification records what is working
and which fidelity, performance and networking requirements remain open.

## Rendering direction — 2026-11-07

Use modern Babylon.js WebGPU rendering, preserving Lineage II's visual identity,
source asset relationships and gameplay behavior. Reproduce old Direct3D details
only when they explain a meaningful visible difference or required behavior.
Use world chunking/streaming, terrain and mesh LOD, compatible static instancing,
GPU texture compression and visibility culling as measured engineering work.
[The rendering plan](docs/RENDERING.md) records current route-specific capabilities
and gaps. Begin a representative baseline now; overall native parity is not a
prerequisite for bounded rendering improvements. Existing fidelity and hardware
acceptance thresholds remain unchanged.

## Capabilities and constraints
The user's 2026-11-06 1:1 requirement includes original Interlude audio, with
native timing, selection, looping, volume and spatial/listener behavior.
Nine original preview cues (six death, three Musveren attack) are connected to the
world with gesture unlock, mute and volume. One specialized attack event remains
unresolved. The selected 4,773-sound export/decode checkpoint is complete;
other world audio categories and native playback rules remain incomplete.
Decoding or asset-inspector playback does not satisfy them.
[Audio acceptance](docs/NATIVE_AUDIO.md) supplements the ongoing
world/rendering task and preserves the existing networking boundary.

The legacy demo has exactly six initial characters, animation, interpolation, camera, targeting and lifecycle demonstrations. Static environment stays editable in Babylon.js Editor. With locally staged assets, the three players use FFighter, MFighter and MMagic; the three monsters retain procedural visuals. Four profiles, including FMagic, are available in the development inspection harness. Missing local files in that legacy demo retain animated fallbacks. The native Interlude route requires its real actor packages and world; its startup must report missing/failed resources rather than present procedural stand-ins. Converted binaries and captures remain untracked and local. Geometry, skinning, animation and runtime correctness determine technical usability; provenance is recorded separately. Networking, progression and deployment are absent from Phase 1.

The asset structure guides the client implementation. Preserve the original character-part, equipment, skeleton, attachment, material and animation relationships represented by the supplied files and manifests. Adapt loaders, assembly rules, animation mapping and unit handling to that evidence; valid content must not be renamed, flattened, rebaked or uniformly resized to satisfy prototype assumptions. Conversion changes require a demonstrated defect or loss of required source structure. Keep asset resolution separate from the world adapter and future networking.

## Interface commitment
The user selected a game-like scene with compact controls. Diagnostics and demonstration controls remain visible. All entity data is synthetic.

Mobile first. The user supplied a classic fantasy HUD reference: dark translucent panels, bronze borders, top-left health and bottom action controls. Preserve the original touch-friendly interface and do not copy reference screenshot pixels. Show actual screenshots at visible implementation milestones.

## Current documentation and asset work

The 2026-11-06 phone report exposed premature native-world reveal and procedural
stand-ins after the previous eventual-load checks passed. The current correction
waits for real terrain/camera attachment, native actor assembly, initial
equipment, enabled flames and a ready frame before revealing canvas/HUD. It
allocates no native dummy meshes and uses no fixed extra loading delay. The
source change passes 479 unit tests, staged build, five reveal cases each in
Chromium and WebKit, and the corrected facing test. It remains staged; the live
preview retains the earlier build because the subsequent terrain task expressly
forbids service changes and production deployment. [VERIFICATION.md](docs/VERIFICATION.md)
preserves the earlier results and their corrected scope. Optional Editor world
inspection keeps its bounded fallback behavior; the required browser world
does not silently substitute it for successful startup.

Persistent world editing now uses the separate `native-world.scene`, imported
with `pnpm assets:editor`. Actual Editor save/reopen retains a tree placement
edit; targeted client adapters address UV2 save loss and omitted terrain
materials in Play. The authored browser route is
`/?world=interlude&authored=1`. See [NATIVE_EDITOR_WORLD.md](docs/NATIVE_EDITOR_WORLD.md).
The earlier `native-parity.scene` still loads its world only at runtime.

The user's latest priority is the visible native world with actors and FPS.
`/?world=interlude` now integrates staged terrain/scenery and a source-texture
preview with the native actors. PlayerStart10/Sector229 is the source-backed
startup candidate; live camera/location matching and native material behavior
remain unverified. [docs/NATIVE_WORLD.md](docs/NATIVE_WORLD.md) describes this
follow-up. Raw reusable migration and the adapter boundary remain foundational.
Profile and optimize supported content while unresolved source/fidelity work
continues, preserving its evidence and acceptance criteria.

The current selected section includes 62 source models, 157 placements and 4,992
terrain triangles, plus BSP floor and sky. The unchanged base recipe produces
61 models / 151 placements / 4,512 terrain triangles.
Twelve flame placements preserve their raw source graph and now replay the
recovered texture/fade/blend formulas through a reversible presentation layer.
Saved material edits remain authoritative. Native lighting, camera and clock
equivalence remain unverified; see [NATIVE_FLAMES.md](docs/NATIVE_FLAMES.md). The migration
can rebuild the expanded dataset byte-identically; it does not certify native
visual parity or a complete client.

Actual Babylon Editor 5.5.3 now saves/reopens equipment, clip and camera edits
and renders this world/actor slice in Play. Optional exact-identity actor-material
tint and roughness controls also persist through UI save/reopen/build. The saved
demonstration override is disabled to retain normal source colors. Full native
shader authoring and effect timing remain unfinished. Saved world placement
editing is verified in `native-world.scene`; transient runtime object edits
are not persisted.
[docs/EDITOR_ROUNDTRIP.md](docs/EDITOR_ROUNDTRIP.md) records the partial authoring
proof and recovered blank-preview limitation.

Greater Musveren uses exact NPC 21622 source metadata: actor scale 1.2 around
the intact mesh hierarchy, with independent 0.36 m collision support. Source
PrePivot and native sweep/contact placement remain unresolved; the current death
pose still intersects terrain. This profile is part of repeatable migration,
not a fitted mesh/animation repair. See [docs/NATIVE_NPC_PROFILES.md](docs/NATIVE_NPC_PROFILES.md).

The earlier 2026-11-05 priority established reusable raw native migration before
playable assembly. It does not defer baseline/optimization work on supported
content under the current rendering direction. `pnpm assets:migrate --prove-rebuild`
uses the pinned IMPORTA-PC source snapshot; [docs/NATIVE_MIGRATION.md](docs/NATIVE_MIGRATION.md)
records coverage and gaps. IMPORTA-PC's display is reported capable of 144 Hz,
but the last observed active mode was 59 Hz and needs rechecking before
presentation tests. Its RTX 4090 cannot certify the GTX 1060 target. The broader
tracked goal remains active.

The local native actor inspection scene at `/?world=interlude` demonstrates original rigs/parts, exact weight consumption, upper-body equipment replacement and one-shot death. The pipeline also reconstructs a bounded native map section. These additions preserve the synthetic adapter boundary and authored Editor resources; they do not certify native combat, a complete world, Editor round-trip acceptance or Phase 2 networking.

The user's request to fix stale files refers to **Markdown (.md)**, not stylesheets. `pnpm assets:stage` runs `scripts/stage_native_players.py`, staging the four native Interlude Human exports (MFighter, FFighter, MMagic, FMagic) into ignored `public/l2/`; nothing comes from lineagen, and `pnpm build` excludes the legacy `public/assets/characters/` and `public/assets/world/` trees. Native player profiles keep native scale (exporter 0.01 + actor DrawScale + class collision; no height fitting), bind 45 of 46 animation aliases to exact package clips (`damage` has no native clip), and add one-shot/retrigger behavior without changing the assets. Semantic `appearanceId` and `animationSequence` fields remain on the adapter boundary; format-specific choices stay in presentation. [docs/ASSET_AUDIT.md](docs/ASSET_AUDIT.md), [docs/VERIFICATION.md](docs/VERIFICATION.md) and [docs/ROADMAP.md](docs/ROADMAP.md) record evidence, limitations and phase boundaries.

## Phase 2

The local world follow-up now loads hash-pinned Talking Island terrain, scenery and surfaces when staged. It preserves source transforms and adapts character presentation, movement, picking and collision to those source units; the native courtyard remains available. [docs/WORLD_ASSETS.md](docs/WORLD_ASSETS.md) records the dataset, exact runtime policies and source limitations. This does not change the networking boundary.

**Real M0 networking**, still planned: establish Interlude authentication, character selection and world entry against stock Mobius. Preserve `GameWorldAdapter` as the future integration boundary. The asset follow-up remains synthetic and does not implement or complete Phase 2.
