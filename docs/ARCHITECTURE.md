# Architecture

This doc describes the runtime: how the native world loads, where gameplay
state enters, and who owns what. Status lives in
[.planning/STATE.md](../.planning/STATE.md). Work order lives in
[.planning/ROADMAP.md](../.planning/ROADMAP.md). The evidence index is
[VERIFICATION.md](VERIFICATION.md).

Babylon.js is the engine. The Babylon.js Editor is an optional viewer
(DEC-OWN-8), described in [EDITOR_VIEWER.md](EDITOR_VIEWER.md). The world's
source of truth is the original client plus the converter.

## Routes

| Route | What loads |
| --- | --- |
| `/?world=interlude` | Native slice: the 20_20 section from the `.l2asset` catalog through `loadNativeSection`, native actors, `NativeSliceAdapter`. |
| `/?world=interlude&character=<id>` | Same slice with a staged native player profile (all four Humans). |
| `/?world=interlude&authored=1` | Optional Editor-authored route. See [Editor-authored route (optional)](#editor-authored-route-optional). |
| `/` | Talking Island bundles through `loadImportedWorld`, `MockWorldAdapter`. |
| `/?world=courtyard` | Legacy courtyard demo from `assets/example.scene`. NOED-03 retires it. |

Today `loadEnvironment` still parses an Editor export as the scene shell
(`native-parity.babylon`, or `example.babylon` for the other routes) through
`babylonjs-editor-tools.loadScene`. The attached `NativeParityScript` then
calls `createNativeSliceRuntime`, which loads the world from the catalog.
NOED-01 builds the native scene (camera, lights, readiness barrier) in code
and turns the script's inspector fields (player profile, clips, material
override) into typed config on the dev sheet.

## Rendering policy

The renderer requires WebGPU through the shared `createWebGPUEngine` factory.
It keeps camera-relative rendering and initializes the pinned local
GLSL-to-WGSL compilers (glslang, twgsl from `/vendor/babylon/9.27.1/`) before
custom materials load. Unsupported adapters and failed device creation show
the startup error panel. Asset previews and capture tools use the same factory.

Preserve source assets, visible material intent and gameplay behaviour while
using modern rendering and resource management. Legacy Direct3D details are
evidence for specific fidelity problems, not an architectural requirement.
[RENDERING.md](RENDERING.md) owns the optimization plan.

- `loadNativeSection` eagerly loads terrain, additive patches and every model
  template, then clones placements with `doNotInstantiate: true`.
- No bounded world-streaming cache or terrain/mesh LOD exists yet (WORLD-04).
  Babylon mesh frustum culling exists; application-level visibility and
  occlusion need separate work.
- The Talking Island loader has on-demand scenery loading, placement
  instancing, distance visibility and cell-based grass thin instances. Its
  scenery stays resident until disposal. The native loader does not share
  these yet.
- Native terrain and flame materials upload decoded RGBA. Retained DDS
  products alone do not give runtime compression.
- Streaming must keep reveal readiness, nearby collision, placement identity
  and clear resource ownership. Visual LOD never redefines collision or the
  adapter contract.

## Native world from the catalog

The offline `scripts/native_migration.py` pipeline owns source inventories,
content-addressed model packages, raw map and effect bundles and a bounded
terrain/scenery section under ignored `artifacts/native-parity/`. It reads
recipes and the pinned IMPORTA-PC snapshot. `--stage-runtime` copies verified
outputs into ignored `public/l2`. See [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md)
and [ASSET_PIPELINE.md](ASSET_PIPELINE.md).

- The output contract is `.l2asset` packages plus the runtime catalog
  (DEC-OWN-5). `recipes/native-inputs.lock.json` is input-only. Units and
  handedness are recorded per route in `asset.json`.
- `readAssetPackage` verifies ZIP structure, paths, CRCs, every file's
  SHA-256, source edition and self-contained GLB resources before loading.
- The default section recipe selects the PlayerStart10 area (nine sectors, 61
  models, 151 placements). Guarded additive derivatives select 62 models / 157
  placements plus BSP floor and sky. See [NATIVE_WORLD.md](NATIVE_WORLD.md) and
  [NATIVE_BSP_FLOOR.md](NATIVE_BSP_FLOOR.md).
- Unsupported native material graphs keep explicit diagnostic materials and
  per-placement coverage. Conversion errors stay separate from runtime
  material gaps, so a raw-data success never becomes a visual acceptance claim.
- The flame's 12 instances use an optional verified-archive presentation owner.
  It binds only unchanged diagnostic surfaces, uses separate browser replay
  clocks and reversible billboard wrappers, and releases effects before
  section teardown, including on cancellation. See
  [NATIVE_FLAMES.md](NATIVE_FLAMES.md).
- The scene establishes right-handed coordinates, then loads the section
  before creating actors.
- App-required startup rejects a missing or failed map, enabled flame
  preparation or terrain material.

### Native actors

`createNativeSliceRuntime` composes `NativeSliceAdapter`, the `EntityRegistry`
and HUD, and presentation-owned `NativeActor` instances.

- Native parts keep separate skeletons, original mesh identities and exact
  source clocks.
- The explicit loader adapter consumes `_L2_NATIVE_WEIGHTS` /
  `_L2_NATIVE_JOINTS` without normalization. Portable glTF weights are a
  separate derivative.
- Upper-body replacement is asynchronous and transactional. A failed
  replacement after startup keeps the prior appearance. Initial equipment is
  part of startup readiness.
- Death plays once and holds. Revival restores the requested locomotion.
  Explicit actions retrigger attacks.
- Native package failures reject startup. No procedural marker is allocated.
- `loadNativeActorCatalog` reads model and NPC profile declarations from one
  catalog snapshot. The exact NPC 21622 join gives Greater Musveren its 0.36 m
  collision height and scale 1.2. See [NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md).
- Entity positions are support points. Presentation places each native pivot
  with a verified profile collision half-height when one exists, otherwise a
  fixed idle-pose clearance.
- `NativeCharacterProfile.actorScale` applies outside the whole mesh
  hierarchy, including its native origin transform. It never multiplies
  collision height or rewrites rig data.
- Missing, corrupt or incompatible required profiles reject native startup.
- Camera tracking keeps the orbit angles at native world coordinates.
- A source-texture preview keeps original pixels and UV matrices and labels
  its blending, filtering and lighting as candidates. Neutral mode and
  inspection diagnostics stay available.

## Audio ownership

Audio is a required presentation subsystem. [NATIVE_AUDIO.md](NATIVE_AUDIO.md)
owns the rules and the current audible inventory.

- One world-owned, gesture-unlocked `WorldAudioMixer` with master, music,
  ambience and effects buses. Mute, volume and disposal go through it.
- Scripts and recipes produce all staged audio.
- Event, region and emitter resolution is source-backed. Independent clips
  share one verified asset and one actor audio owner.
- Native selection, timing and spatial rules come from evidence (POL-02).
  The package inspector's diagnostic player is not that policy.
- Asset and playback interpretation stay outside `GameWorldAdapter`.

## Adapter boundary

`GameWorldAdapter` is the only way gameplay state enters the client. It is
transport-independent, holds no Babylon types, and its five methods stay
frozen:

| Method | Responsibility |
| --- | --- |
| `getInitialState()` | Return the current complete entity snapshot. |
| `subscribe(listener)` | Deliver ordered `spawn`, `update` and `despawn` events; return an unsubscribe function. |
| `dispatch(command)` | Receive a typed user intent. The adapter decides how it changes authoritative state. |
| `advance(deltaTimeSeconds)` | Advance a synthetic producer; a transport-backed adapter may leave this empty. |
| `dispose()` | Release adapter-owned subscriptions and state. |

```text
UI / ground input -> adapter.dispatch(intent)
frame clock      -> adapter.advance(seconds)
adapter event    -> registry -> visual / animation / label
frame clock      -> interpolation / animation / label projection / diagnostics
```

- `EntityRegistry` subscribes and reads the initial snapshot synchronously
  before the frame loop starts.
- Each entity has a stable identifier, kind, display name, position,
  orientation, health, maximum health and animation state. Optional
  `appearanceId` selects a presentation profile. `animationSequence` changes
  for an explicit repeated action, so an ordinary snapshot never restarts a
  finished attack. Optional `modelUrl` serves independent fixtures and failure
  demonstrations.
- Updates carry a complete replacement state with an optional `shouldSnap`.
- Camera, target selection and interpolation are presentation state and need
  no adapter command.
- `window.__worldDiagnostics.snapshot()` returns read-only copies (active
  model identity, native playback, bounds, parts, skeleton counts).
  `projectPosition()` projects world coordinates to canvas pixels. Neither has
  command or mutation hooks.

### Adapters

- `MockWorldAdapter` supplies exactly six initial entities. It advances on
  deterministic 0.1 s ticks, publishes remote movement, moves the local player
  by click at 4 m/s and schedules cosmetic monster animation states. Spawn,
  teleport, pause, animation, removal and missing-model demonstrations use the
  normal event path. Pause stops ticks; presentation and explicit commands
  keep working. It freezes outgoing entities, positions, snapshot arrays and
  events.
- `NativeSliceAdapter` drives the native slice. Local walk and run speeds
  come from a `NativeSliceSpeedProfile`; the aCis human fighter values (walk
  80, run 115 source units/s, run start after 12/30 s) are server data a
  networked client would receive, not client data.
- `createWorldRuntime` is the single composition point that chooses
  `MockWorldAdapter`.

## Startup readiness barrier

Loader completion is not readiness: scene scripts start on the first render
and native world and actor assembly is asynchronous.

1. `loadEnvironment` declares the native runtime required
   (`requireSceneStartup`) before loading the scene.
2. `NativeParityScript` registers its real runtime promise. The promise covers
   terrain and camera attachment, enabled flame setup, the current entity
   registry and initial equipment, material overrides and runtime controls.
3. `prepareSceneForReveal` runs the first lifecycle frame with canvas and HUD
   concealed and input inert. It stops the render loop while downloads and
   assembly settle and checks that every required script registered.
4. After the promise resolves, rendering resumes. The barrier needs a frame
   whose geometry, textures and materials are ready before and after drawing.
5. Only then does `App` reveal canvas and HUD, enable input and remove the
   loader, in one step. No fixed delay controls reveal.

Disposal, abort, context loss, failed resources, missing scripts, render
errors and the bounded startup deadline reject the barrier and release partial
ownership.

`CharacterVisual.ready` resolves after native parts, clips and the current
initial equipment request are installed; failures reject it.
`EntityRegistry.whenReady()` awaits the current set, repeats if an entity is
replaced, and never lets a removed visual's cancellation reject its
replacement. Registry disposal cancels readiness. The native route never
substitutes a procedural character.

## Dev sheet

`src/ui/devSheet/` is the single home for developer and debug controls. It
follows the owner preference: a pinnable sheet with hover-cards that show
variables, never a cramped toggle list (SAND-02).

- Desktop (fine pointer, 760 px or wider) and short landscape: a right-side
  sheet (30% of the stage, 380-520 px). Phones: a bottom sheet with peek, half
  (55%) and full snaps, drag or flick to resize.
- Sticky is on by default. A sticky sheet docks: the canvas shrinks and a
  `resize` event drives `engine.resize()`. Off, it is an overlay that closes
  on a world pointerdown or Escape.
- Sections are tabs; groups collapse. Open, sticky, snap, tab and collapsed
  groups persist in `localStorage` (`l2.devSheet.v1`), and every storage access
  is guarded.
- Keys: backtick toggles the sheet, `/` focuses the filter, Escape closes
  cards, then clears the filter, then closes.
- Every control can carry `VariableInfo` rows (name, value, source, status
  `native`, `presentation` or `unverified`) shown in hover-cards.
- `createNativeSliceRuntime` adds the audio, movement, combat, character,
  world, effects and debug sections, with hover-card helpers from
  `nativeSliceSheet.ts`. `WorldInterface` adds the general section.

## Coordinates and timing

- The native route uses right-handed source coordinates. Characters are native
  Interlude packages with their own recorded conversion (exporter 0.01 m per
  source unit, actor DrawScale, class collision data) and no height fitting.
- Talking Island keeps unchanged right-handed source coordinates; these are
  not asserted to be physical meters.
- The courtyard is Babylon left-handed, +Y up, X/Z ground, one unit per meter.
  Its camera starts at radius 26 m, zooms 10-38 m and limits vertical orbit to
  0.35-1.45 rad. Imported mode follows the local player, starts at radius 8
  source units and allows radius 1-50. `WorldCamera.ts` attaches orbit and
  zoom input and disables panning.
- Yaw is around +Y in radians. Deltas and animation durations are in seconds;
  engine milliseconds convert at the composition boundary.
- The frame loop caps elapsed time at 0.1 s after a stall. This slows the
  synthetic clock instead of replaying a hidden-tab backlog; it is not network
  clock synchronization.
- `PositionInterpolator` converges with `1 - exp(-12 x elapsedSeconds)`.
  Equal total elapsed time gives the same position regardless of frame
  subdivision. Zero time leaves the position unchanged; negative or non-finite
  time and non-finite coordinates are rejected.
- An explicit `shouldSnap` or a gap greater than 8 world units snaps. A gap of
  exactly 8 smooths. Imported presentation projects the interpolated position
  onto nearby support. There are no timestamps, prediction, extrapolation or
  reorder buffer.
- Orientation uses the shortest angular difference at the same rate.
  Interpolation never writes back to adapter state.

`EngineHost` enables camera-relative rendering. Runtime composition gives the
Talking Island adapter and presentation grounding a geometry-backed
`WorldNavigation`; the adapter interface stays independent of Babylon.
Navigation indexes transformed source triangles, checks a finite footprint,
limits slopes and steps, sweeps a capsule against walls and ceilings, and
blocks movement while nearby colliders load. Hidden scenery keeps collision.
This is local collision, not multiplayer authority or pathfinding: a click
moves straight toward the destination and stops at obstructions.

## Entity and asset ownership

The registry owns one `CharacterVisual`, `PositionInterpolator` and
`EntityLabel` per entity, plus one shared selection ring.

- Spawn creates those resources immediately. Update changes the target
  transform, animation state and label. A model URL, appearance or kind change
  rebuilds the visual and keeps selection. A changed action sequence retriggers
  the clip.
- Despawn removes visual and label and clears the selected target.
- A duplicate spawn replaces the prior presentation. An update for an unknown
  identifier is ignored, so producers send spawn before update.

Character paths:

- Native players: `pnpm assets:stage` runs `scripts/stage_native_players.py`,
  which adds the four native Human packages and profiles to ignored
  `public/l2/` with SHA-256 pins. Human appearances on the Talking Island and
  courtyard routes use these profiles through `nativeOrProceduralCharacter.ts`,
  procedural while loading or on failure. Initial players select FFighter,
  MFighter and MMagic; three monsters stay procedural.
- Native visuals use their own factory: an initially disabled transform and a
  mesh-free animation state holder keep semantic requests while the assembly
  loads.
- Ad-hoc `modelUrl`: `createCharacterVisual` returns a procedural character
  synchronously, then resolves a profile in `src/assets/characterProfiles.ts`
  (appearance ids never resolve to a GLB). It fetches the GLB with an abort
  signal, checks HTTP success and the glTF v2 header, and loads an asset
  container with autoplay off. Binary input gets a resource base URL from the
  response URL. `prepareCharacterModel` validates geometry and clips, applies
  the profile's `metresPerUnit` and `facingYawRadians` once at the assembly
  root, and parents only top-level nodes. This path keeps its placeholder and
  visible failure status, and the case-insensitive generic clip aliases.
- A late result for a removed entity or disposed scene is disposed.
- The client never fits models to a bounding height or recenters origins.
  Native player profiles carry their own forward axis and actor scale.

`PackagePreview` keeps source mesh transforms and a scale-one outer root.
Native playback uses the recorded source duration and original channel keys,
including the final-to-first interval. Optional linked-sound playback previews
verified direct Sound references at notification times. It does not emulate
native random selection, volume and radius rules, surface routing or gameplay.
`AssetImportPanel` hosts a separate preview scene and suspends world rendering
without changing adapter state. Closing it disposes its resources and restores
Babylon's global floating-origin matrix overrides, which disposing a second
engine resets in 9.27.1.

`CharacterAnimator` keeps the selected state when switching drivers.
Procedural animation blends idle breathing, run strides and attack swings.
Native player profiles resolve exact native clips through the alias keys in
`nativeAnimationAliases.ts` (required: idle, run, attack, death); the bindings
come from `scripts/prepare-native-player-aliases.py` and are staged by
`scripts/stage_native_players.py`, never written in client code. Model
animation applies per-state loop and transition policies; transition
durations are client presentation choices and native clip durations stay
unchanged. Attack plays once and fades to idle near its end without changing
semantic state. Interrupted blends keep current weights instead of jumping to
a bind pose. A missing mapped clip keeps the procedural fallback and reports
the incompatibility.

- Mesh picking adds the namespaced `clientEntityId` without replacing imported
  metadata. Non-object source metadata is kept as `sourceMetadata`. Targeting
  also supports the procedural visuals' `entityId`.
- Adapter coordinates drive the outer entity root; animation moves the body
  inside it. Native root-motion channels are kept.
- Bound measurements give label height, selection-ring radius and diagnostic
  picking height. They never change size or origin, and are taken before the
  assembly attaches to the moving root.
- `EntityLabel` projects a point above the interpolated character, hides
  off-screen labels, writes names with `textContent`, and shows selection
  buttons and health meters. `WorldInterface` owns the HUD and dispatches
  every entity-changing control to the adapter. Health values and cosmetic
  attacks add no combat calculation (DEC-PORT-3).
- The HUD injects a scoped stylesheet from `src/ui/worldStyles.ts` and removes
  it on shutdown, because the Editor compiles attached scripts as CommonJS and
  loads no CSS bundle. Overlays track the rendering canvas rectangle. The Vite
  page self-hosts the heading font; Editor Play falls back to serif.

## Build and generation today

`pnpm dev` and `pnpm build` both run `pnpm generate`, which today runs, in
order:

1. `ensure-webgpu-project.mjs` (restores `isWebGPU: true` in
   `project.bjseditor`).
2. `stage-webgpu-compilers.mjs` (stages glslang and twgsl).
3. `validate-editor-materials.mjs`: a read-only guard that rejects meshes
   referencing the internal `BABYLON.ShaderMaterial` with both shader stages
   named `lightProxy`. It follows direct, numeric-only and MultiMaterial
   references, including LODs, names the affected file and mesh, and stops
   before packing. Generic names such as `ProxyMaterial` alone pass. On
   failure, restore the affected records from a verified copy; the guard
   cannot rebuild a lost material.
4. `preserve-native-editor-uv2.mjs` (restores demonstrated missing UV2).
5. `babylonjs-editor-cli pack` (exports `public/scene/*.babylon` and
   regenerates `src/scripts.ts`).
6. `preserve-native-editor-fog.mjs`: Editor 5.5.3 drops the native scene's
   fog-enable switch, so disabled fog maps to Babylon mode 0 and enabled fog
   keeps its authored mode.
7. `share-native-terrain-export-materials.mjs`.

NOED-02 moves every step except `stage-webgpu-compilers` to an optional
`pnpm generate:editor`. Then the code-built native scene sets fog explicitly
(`fogEnabled = false` with mode 3; Babylon defaults to `fogEnabled = true`).

`package.json` pins `@babylonjs/addons` 9.27.1 and `@recast-navigation/core` /
`generators` 0.43.0 only because the desktop Editor's generated script entry
imports plugins that CLI pack omits. Evidence:
`artifacts/native-parity/research/editor-plugin-dependencies/README.md`.

## Editor-authored route (optional)

`/?world=interlude&authored=1` loads `native-world.babylon`, the saved
`assets/native-world.scene` from `pnpm assets:editor`. NOED-01 keeps it
reachable only by a dynamic import. Runtime facts in the code today:

- Incremental loading: `loadEnvironment` sets
  `SceneLoaderFlags.ForceFullSceneLoadingForIncremental` while parsing the
  authored scene, then restores the prior value. Offscreen geometry loads
  before placement validation and script startup. Other routes keep their
  loading behaviour.
- Z reflection: `attachAuthoredNativeSection` attaches the parsed world
  without importing a second copy. The dedicated root reflects Z for the
  Editor's left-handed viewport; mesh winding and camera orientation adapt on
  entry to the right-handed runtime and restore on disposal. Source placement
  metadata and authored child edits stay intact; the scene owns every saved
  node, texture and material. Removing or duplicating declared placements
  fails validation.
- No second GLB fetch: the runtime never fetches the map GLBs again on this
  route.
- ShaderMaterial recovery: Editor 5.5.3 Play drops every
  `BABYLON.ShaderMaterial`. `restoreEditorAuthoredMaterials.ts` recovers only
  an omitted terrain material from the live authoring scene on the same
  engine, and requires matching scene, manifest, root and mesh identities. It
  serializes and parses an owned copy, keeping unsaved shader edits, and never
  shares the source material or replaces an existing assignment. Both `null`
  and `undefined` unresolved-material results are handled. Stop, abort or
  failure disposes only the owned copy and restores the original assignment.
  It uses the absolute authoring texture root, because the Editor's relative
  path rewriting gives checkerboard terrain on WebGPU. The CLI export includes
  the authored shader and needs no recovery.

Actor material overrides (`src/assets/native/nativeMaterialOverrides.ts`,
`createNativeMaterialOverrides`):

- Selected by exact entity ID plus qualified source material name, with a
  linear RGB multiplier and preview roughness, each in `[0, 1]`.
- Clones only the matching actor's PBR material. Textures, alpha mode, UV
  transforms and other settings survive; source materials and converted
  payloads stay unchanged.
- Tracks asynchronous equipment replacement by identity. Removing a part
  releases its override; stopping restores source materials before the model
  owner disposes.
- Disabled by default. Diagnostics expose matching counts and the applied
  colour and roughness. Eight focused tests cover isolation, source
  preservation, ownership and rollback.
- These overrides do not implement native shaders or particle timing.
  Settings live today in `NativeParityScript` inspector fields and move to
  typed sandbox config with NOED-01.

Editor Play host adaptations in client code (`GLTF2` loader namespace, `/l2`
fetch-path adaptation, `getWorldCanvas` input canvas, HUD toolbar inset) are
listed in [EDITOR_VIEWER.md](EDITOR_VIEWER.md).

## Shutdown

Stopping the scene removes the frame observer, pointer targeting, camera
controls, adapter subscription, entity visuals and labels, selection
resources, HUD, diagnostic handle and adapter state. Character cleanup aborts
pending loads and disposes animation drivers, asset containers, procedural
meshes and materials, and roots. Page shutdown and Vite hot replacement
dispose `App`; the engine host removes resize handling, stops rendering and
disposes the engine. Scene loading failures dispose partial resources before
reporting the error.

## Stage B adapter

A server adapter (stock L2J Mobius first, DEC-PORT-2) plugs in at
`createWorldRuntime` and supplies the same initial state and ordered events.
Transport details stay out of presentation modules. Its duties (NET-04):
snapshot and subscription ordering, positions in meters, time in seconds,
explicit teleports. The `WorldCommand` union holds synthetic developer
intents (spawn, pause, forced animation, intentional asset failure); a real
adapter maps supported player actions and rejects or disables the rest.
Replacing the constructor alone does not make those controls network features.

## Source layout

```text
project.bjseditor             Optional Editor viewer project (DEC-OWN-8)
assets/                       Editor scenes: example, native-parity, native-world
public/scene/                 Generated CLI export; ignored
public/l2/                    Staged native packages, profiles and catalog.json; ignored
public/assets/world/          Legacy lineagen Talking Island (dev only, never built); ignored
scripts/stage_native_players.py  Stage native player packages/profiles (pnpm assets:stage)
src/
  main.ts, App.ts             Browser entry, startup errors, reveal, shutdown
  scripts.ts, scripts/        CLI-generated script map; nativeParity.ts, world.ts
  runtime/                    createWorldRuntime, createNativeSliceRuntime, sheet wiring
  engine/                     WebGPU engine, render loop, resize, disposal
  scene/                      loadEnvironment, startup guard, ready-frame reveal
  scene/world/                loadNativeSection, authored section, sky, flames, BSP
  world/                      GameWorldAdapter, MockWorldAdapter, NativeSliceAdapter
  entities/                   Entity registry, selection, picking
  interpolation/              Position smoothing and snapping
  animation/                  State facade, procedural poses, clip blending
  assets/, assets/native/     Character visuals, native actors, catalog, overrides
  audio/                      WorldAudioMixer, music, ambience, footsteps, combat
  editor/                     Editor capture and authored-material recovery
  ui/, ui/devSheet/           Labels, HUD, loading screen, dev sheet
tests/unit/                   Vitest behaviour tests
tests/browser/                Playwright browser tests; nativeSection.html inspection page
```

## Known limits

These are covered by requirements; status is in
[.planning/STATE.md](../.planning/STATE.md).

- Musveren's local point-support placement does not reproduce native
  collision; the final corpse still intersects terrain and PrePivot is
  unresolved (POL-01). See [NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md).
- Full weapon attachments (ACT-03), particles and skill effects (ACT-06) and
  visual parity (POL-01) are unfinished.
- The Editor is off the build and runtime path only after NOED-01 to NOED-04
  land.
