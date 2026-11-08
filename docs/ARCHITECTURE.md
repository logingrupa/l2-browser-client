# Architecture

## Rendering policy — 2026-11-07

The renderer already requires WebGPU through the shared `createWebGPUEngine`
factory. Preserve source assets, visible material intent and gameplay behavior
while using modern rendering/resource management. Legacy Direct3D implementation
details are evidence for specific fidelity problems, not an architectural
requirement. [RENDERING.md](RENDERING.md) owns the current optimization plan.

Native `loadNativeSection` eagerly loads terrain, additive patches and every
model template, then clones placements with `doNotInstantiate: true`. The authored
route attaches existing saved geometry. Neither route currently implements a
bounded world-streaming cache or terrain/mesh LOD. Babylon mesh frustum culling
exists; application-level spatial visibility and occlusion need separate work.

The older Talking Island loader already has on-demand scenery loading, ordinary
placement instancing, distance visibility and cell-based grass thin instances.
Its scenery stays resident until disposal, and those capabilities are not yet
shared by the native loader. Native terrain/flame materials currently upload
decoded RGBA; retained DDS products alone do not provide runtime compression.

Profile the current supported slice and apply bounded improvements alongside
remaining migration/fidelity work. Streaming must preserve initial reveal
readiness, nearby collision, authored placement identity and clear resource
ownership; visual LOD must not redefine collision or the adapter contract.

## Audio ownership

Audio is a required presentation subsystem for 1:1 Interlude behavior.
The world now has nine original preview cues: six death and three Musveren attack
events, with gesture unlock, mute, volume and disposal. Independent clips share
one verified asset and one actor audio owner. Other categories and native playback rules remain
incomplete; the completed 4,773-sound export/decode batch adds no runtime policy.
[NATIVE_AUDIO.md](NATIVE_AUDIO.md) defines its
ownership and acceptance: one world-owned, gesture-unlocked mixer, source-backed
event/region/emitter resolution, independent authored overrides, and lifecycle
cleanup. Native audio selection/timing/spatial policies must be established from
evidence; the inspector's diagnostic player is not that policy. Keep asset and
playback interpretation outside `GameWorldAdapter` and preserve terrain work.

## World and asset ownership

The optional native authoring import creates a separate `native-world.scene`.
Its scene-owned terrain/scenery stays editable; runtime attachment adapts only
the dedicated coordinate wrapper and camera, then restores them on disposal.
It does not dispose saved meshes/materials or load duplicate map GLBs. The
source snapshot and recovery record live separately from authored changes;
prepack restores only demonstrated missing UV2 when other geometry matches.
See [NATIVE_EDITOR_WORLD.md](NATIVE_EDITOR_WORLD.md).

The environment and dynamic world have separate owners. Native Editor resources own the fallback courtyard, lights and initial camera. The browser optionally loads the pinned Talking Island bundles through `scene/world/loadImportedWorld.ts` before the attached scene script starts. `GameWorldAdapter` owns dynamic entity state. Presentation creates and disposes visuals in response to that boundary.

The offline `scripts/native_migration.py` pipeline owns generated source inventories, content-addressed model packages, raw map/effect bundles and a bounded native terrain/scenery section under ignored `artifacts/native-parity/`. It reads recipes and the pinned IMPORTA-PC snapshot; it does not regenerate authored Editor resources. `--stage-runtime` copies verified outputs into ignored `public/l2`. The native section does not replace the legacy island loader. See [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md).

The default section recipe now selects the source-backed PlayerStart10 area
(nine sectors, 61 models, 151 placements). Guarded additive derivatives currently
select 62 models/157 placements plus BSP floor and sky; the [single-model
appender](NATIVE_MAP_MODEL_APPEND.md) adds new source graphs without regenerating
authored records. The base recipe itself is unchanged. Unsupported native material graphs
remain editable source data with explicit diagnostic materials and per-placement
coverage. The flame's 12 instances now use an optional verified-archive
presentation owner on both source and authored routes. It binds only unchanged
diagnostic surfaces, uses separate browser replay clocks and reversible
billboard wrappers, and releases effects before section teardown, including
cancellation. [NATIVE_FLAMES.md](NATIVE_FLAMES.md) records its source formulas
and unresolved native lighting, clock and camera equivalence. Conversion errors remain separate from runtime
material gaps so a raw-data success cannot become a visual acceptance claim.

`pnpm generate` first enforces the WebGPU project settings and stages the pinned
local shader compilers, then runs a read-only authored-material preflight and the
source-checked native-world UV2 recovery, then the official Editor packer
followed by a narrow adapter for
the native scene's fog-enable flag, which Editor 5.5.3 omits. Disabled authored
fog maps to generated Babylon mode 0; enabled fog retains its authored mode.
The final step shares compatible exported native terrain materials. These
adapters preserve saved Editor edits without
overriding the live Editor scene in the runtime script.

The preflight rejects meshes referencing the identified internal
`BABYLON.ShaderMaterial` with both shader stages named `lightProxy`. It follows
direct, numeric-only and MultiMaterial references, including LODs. It reports
the affected authored records and stops before packing; it never repairs or
rewrites them. Generic material names alone do not trigger rejection. This
contains a demonstrated Editor material-ID collision; it does not fix the
installed Editor's loader.

`NativeParityScript` also owns optional persistent actor-material settings:
entity ID, exact converted material identity, linear RGB multiplier and preview
roughness. `createNativeMaterialOverrides` clones only matching actor materials,
tracks asynchronous equipment replacements, preserves source textures/alpha/UVs,
and restores/releases its bindings before model disposal. It is disabled by
default and in the normal authored preview. Settings remain in the Editor scene;
migration never rewrites them. Vector3 text fields provide RGB editing because
Editor 5.5.3's script Color3 numeric inputs omit their persistence callback.
These presentation overrides do not implement native shaders or particle timing.

Actual Editor Play uses a different host contract: its installed loader UMD
exports the glTF extension registry through `GLTF2`, and its fetch override
resolves relative paths under the project's public directory. Native resource
paths adapt only at fetch boundaries on file pages; hash/path validation and
HTTP-browser URLs are unchanged. `getWorldCanvas` uses the public input canvas
for controls/labels because Editor renders through a detached working canvas.
The HUD reserves the measured toolbar strip. The native scene now saves fog
mode None because in-process Play bypasses the CLI fog adapter. These are client
and authoring adaptations, not changes to converted native assets.

`/?world=interlude` loads the separately authored `native-parity.scene`. Its script establishes right-handed coordinates after Editor scene parsing, then loads the verified native map section before creating actors. It composes `NativeSliceAdapter`, the existing `EntityRegistry`/HUD and presentation-owned `NativeActor` instances. Native parts retain separate skeletons, original mesh identities and exact source clocks. The explicit Babylon loader adapter consumes `_L2_NATIVE_WEIGHTS`/`_L2_NATIVE_JOINTS` without normalization; portable glTF weights remain a separately documented derivative. Upper-body replacement is asynchronous and transactional; failed replacements after startup retain the prior appearance. Initial equipment is part of startup readiness. Death plays once and holds, revival restores requested locomotion, and explicit actions retrigger attacks. Scene/cancellation ownership disposes pending assets, controls and observers. Native package failures reject startup; no procedural marker is allocated. App-required worlds reject a missing/failed map or enabled flame preparation. Optional Editor inspection can retain the authored inspection area or world with an explicit world/effect failure diagnostic.

Native terrain supplies local geometric support. Entity positions remain support points; presentation places each native pivot using a verified profile collision half-height when available, otherwise a fixed idle-pose clearance. `loadNativeActorCatalog` reads model and NPC profile declarations from one catalog snapshot. The exact NPC 21622 name/group/class join supplies Musveren's 0.36 m height and scale 1.2. `NativeCharacterProfile.actorScale` applies outside the complete mesh hierarchy, including its native origin transform; it does not multiply collision height or rewrite rig data. Missing, corrupt or incompatible required profiles reject native startup. PrePivot remains explicitly unresolved. This local point-support policy does not reproduce native collision and still intersects the final corpse; see [NATIVE_ACTOR_PLACEMENT.md](NATIVE_ACTOR_PLACEMENT.md) and [NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md). Camera tracking preserves authored orbit angles at native world coordinates. A separate source-texture preview preserves original pixels and UV matrices while labeling its blending/filtering/lighting as candidates; neutral mode and optional inspection diagnostics remain available. App-required startup rejects a terrain material failure. See [NATIVE_WORLD.md](NATIVE_WORLD.md). Native/scenery collision, particles, complete weapon attachments and visual parity remain unfinished. `GameWorldAdapter` remains the semantic state boundary.

## Native browser startup readiness

The Editor loader resolving does not mean its scene-attached runtime is ready:
`onStart` runs during the first render and native world/actor assembly is
asynchronous. Earlier eventual-load tests missed the resulting premature reveal,
which the user's phone captures exposed. [VERIFICATION.md](VERIFICATION.md)
separates that earlier evidence from the current transition checks.

`loadEnvironment` declares the native runtime required before loading the scene.
`NativeParityScript` registers its real runtime promise. `prepareSceneForReveal`
runs the first lifecycle frame with canvas/HUD concealed and input inert, stops
the unnecessary render loop while downloads and assembly settle, and verifies
that every required script registered. The promise includes terrain/camera
attachment, enabled flame setup, the current entity registry and initial
equipment, material overrides and runtime controls.

Once the runtime promise resolves, rendering resumes. The barrier requires a
frame whose geometry, textures and materials are ready before and after drawing.
Only then does `App` reveal the canvas/HUD, enable input and remove the loader in
the same completion step. No fixed extra delay controls reveal. Disposal, abort,
context loss, failed resources, missing scripts, render errors and the bounded
startup deadline reject the barrier and release partial ownership. Optional
Editor Play has no `App` reveal owner; it reports startup failures visibly and
retains only the explicitly supported inspection fallback behavior.

This describes the verified staged implementation in
`artifacts/private-preview/native-reveal/dist-stage/`. The live private preview
still serves the preceding build: the current terrain task explicitly forbids
service changes and deployment. [VERIFICATION.md](VERIFICATION.md) retains the
passing transition checks and the corrected facing-test input history.

The island loader preserves RH source coordinates, instanced scenery, mirrored clones, explicit foliage corrections and terrain source-layer materials. `EngineHost` enables Babylon camera-relative rendering. Runtime composition supplies a geometry-backed `WorldNavigation` to the synthetic adapter and presentation grounding; the adapter interface remains independent of Babylon. Navigation indexes original transformed triangles, checks a finite character footprint, limits slopes/steps, sweeps a capsule against walls/ceilings and blocks movement while nearby colliders load. Hidden scenery retains collision. This local collision policy is not multiplayer authority or pathfinding: clicks move directly toward a destination and stop at obstructions.

## Native template and final layout

The starting point is Babylon.js Editor 5.5.3's `templates/vanillajs` at revision `e3fce2cea68c6a32fdbacbb4c5aa4e6a0f154db7`. Vite is the template's native bundler. The template entry names, metadata, asset paths, and official scene export/loader are retained. pnpm replaces the template's package-manager selection, strict checking and tests are added, and unused example assets/physics are removed.

```text
project.bjseditor              Native Editor project metadata; pnpm selected
assets/
  example.scene/
    config.json               Scene settings and world.ts attachment
    cameras/                  Authored orbit camera and limits
    lights/                   Sunlight and sky fill
    meshes/                   Ground, courtyard, stonework, pillars, trees
public/scene/                 Generated CLI export; ignored by Git
public/l2/                    Staged native packages, profiles and catalog.json; ignored
public/assets/world/          Legacy lineagen Talking Island (dev only, never built); ignored
scripts/stage_native_players.py  Stage native player packages/profiles (pnpm assets:stage)
src/
  main.ts                     Native browser entry; startup errors and shutdown
  App.ts                      Browser application lifecycle
  scripts.ts                  Official CLI-generated script map
  scripts/world.ts            Scene-attached Editor behavior
  runtime/createWorldRuntime.ts  Adapter selection and runtime composition
  engine/                     Engine, render loop, resize, disposal
  scene/                      Official loading, startup guard and ready-frame reveal
  camera/                     Attach orbit/zoom input to the authored camera
  world/                      Adapter contract and synthetic state producer
  entities/                   Entity registry, selection, pointer picking
  interpolation/              Presentation position smoothing and snapping
  animation/                  State facade, procedural poses, model clip blending
  assets/                     Character visuals, model loading and validation
  ui/                         Floating names/health, controls, diagnostics
  ui/worldStyles.ts           Scoped shared HUD styles for browser/Editor
  style.css                   Browser page layout and self-hosted font
tests/unit/                   Vitest behavior tests
tests/browser/                Playwright browser tests
tests/browser/nativeSection.html  Development-only native section inspection
docs/                         Architecture, provenance, Editor/MCP record
```

`assets/` contains authored content; `src/assets/` contains runtime code. `public/scene/` is the template-supported packing output rather than a second authored environment. Extra native scene subdirectories may be created by the CLI or Editor when their corresponding features are used.

## One authored scene, two entry workflows

`pnpm dev` and `pnpm build` begin with `babylonjs-editor-cli pack`. The official packer reads `assets/example.scene/`, exports `public/scene/example.babylon`, and regenerates `src/scripts.ts` from attached script metadata. The original static environment was serialized into editable resources once; there is no bootstrap generator in these commands that can overwrite later Editor edits.

In the browser, `main.ts` creates `App`, which awaits `EngineHost.create` and calls `loadEnvironment` only after WebGPU initializes. The shared `createWebGPUEngine` factory requires WebGPU, retains camera-relative rendering, and initializes the pinned local GLSL-to-WGSL compilers before loading custom materials. Unsupported adapters and failed device creation use the startup error panel. Disposal during initialization releases a late engine without starting a scene. Asset previews and editor capture tools use the same factory.

`loadEnvironment` uses `babylonjs-editor-tools.loadScene` with the generated script map, then selects the authored **World camera**. A missing or incorrectly typed camera produces an explicit startup error. `App` then awaits `prepareSceneForReveal`; loader completion alone no longer reveals the scene. Both GLSL and WGSL built-in shaders are registered before serialized materials are parsed.

The scene's `metadata.scripts` attaches `scripts/world.ts`. Its constructor receives the scene. `onStart` calls `createWorldRuntime`; `onStop` invokes the returned cleanup function. The official Editor's **Play current scene** pipeline uses the same scene export, script map, and attachment lifecycle. **Play project as-is** invokes `pnpm dev`. Actual native-scene Play, UI save/reopen and partial authoring preservation were exercised on 2026-11-05; native material/effect authoring remains incomplete. See [EDITOR_ROUNDTRIP.md](EDITOR_ROUNDTRIP.md) and [EDITOR_MCP.md](EDITOR_MCP.md).

Courtyard camera settings remain in editable JSON. Imported mode follows the local player, starts at radius 8 source units and allows radius 1–50. `WorldCamera.ts` attaches orbit/zoom input and disables panning. Runtime lookup still requires **World camera**; **Courtyard ground** is used only by fallback movement picking.

## Adapter event flow

`GameWorldAdapter` is transport-independent and contains no Babylon types:

| Method | Responsibility |
| --- | --- |
| `getInitialState()` | Return the current complete entity snapshot. |
| `subscribe(listener)` | Deliver ordered `spawn`, `update`, and `despawn` events; return an unsubscribe function. |
| `dispatch(command)` | Receive a typed user intent. The adapter decides how it changes authoritative state. |
| `advance(deltaTimeSeconds)` | Advance the synthetic producer; a future transport-backed adapter may leave this empty. |
| `dispose()` | Release adapter-owned subscriptions and state. |

`EntityRegistry` subscribes and reads the initial snapshot synchronously before the frame loop starts. Each entity has a stable identifier, kind, display name, position, orientation, health, maximum health and animation state. Optional `appearanceId` selects a presentation profile, while `animationSequence` changes for an explicit repeated action so an ordinary snapshot does not restart a completed attack. An optional ad-hoc `modelUrl` remains for independent fixtures and failure demonstrations. Updates carry a complete replacement state, with an optional `shouldSnap` flag. The mock freezes outgoing entities, nested positions, snapshot arrays and event objects to prevent subscribers from altering its state.

The flow is:

```text
UI / ground input -> adapter.dispatch(intent)
frame clock      -> adapter.advance(seconds)
adapter event    -> registry -> visual / animation / label
frame clock      -> interpolation / animation / label projection / diagnostics
```

Every dynamic spawn, state update, appearance/model change and removal crosses this boundary. Camera changes, target selection and interpolation are presentation state and do not need adapter commands. `window.__worldDiagnostics.snapshot()` exposes read-only copies for browser verification, including active model identity, native playback, bounds, parts and skeleton counts; `projectPosition()` projects world coordinates to canvas pixels. Neither exposes command or mutation hooks.

`MockWorldAdapter` supplies exactly six initial entities. It advances on deterministic 0.1-second ticks, publishes remote movement, advances local click-to-move at 4 meters per second, and schedules cosmetic monster animation states. Its spawn, teleport, pause, animation, removal, and missing-model demonstrations use the same event path as normal updates. Pausing stops synthetic ticks while presentation and explicit commands remain usable.

## Coordinates and timing

Native assets from the pinned IMPORTA-PC snapshot enter through a separate `.l2asset` contract, described in [ASSET_PIPELINE.md](ASSET_PIPELINE.md). The offline converter owns native package decoding, dependency resolution, unit/basis conversion and content-addressed receipts. Standalone textures retain native mip/palette sidecars and supported DDS derivatives; the package inspector still uses the editable PNG preview. `readAssetPackage` verifies ZIP structure, paths, CRCs, every file's SHA-256, source edition and self-contained GLB resources before loading. `AssetImportPanel` hosts a separate preview scene; it suspends the world's rendering without changing adapter state. Closing the inspector disposes its resources and restores Babylon's global floating-origin matrix overrides, which disposal of a second engine otherwise resets in 9.27.1.

`PackagePreview` retains source mesh transforms and a scale-one outer root. Native animation playback uses the recorded source duration and original channel keys, including the final-to-first interpolation interval; Babylon's ordinary group loop would end at the last stored key. Optional linked-sound playback previews verified direct native Sound references at notification times. It does not emulate native random selection, volume/radius rules, surface routing or gameplay. Human appearances in the courtyard and Talking Island routes now use the staged native player profiles through `nativeOrProceduralCharacter.ts` (procedural while loading or on failure); other entities keep the procedural or ad-hoc-URL path below.

- The courtyard is Babylon left-handed, **+Y up**, X/Z ground, one unit per meter. Talking Island uses unchanged right-handed source coordinates; these are not asserted to be physical meters. Characters are native Interlude packages with their own recorded coordinate conversion (exporter 0.01 m per source unit, actor DrawScale, class collision data) and no height fitting; the Unity-character height correction (`legacyWorldScale.ts`) has been removed with the lineagen GLBs. Yaw is around +Y in radians.
- Delta values and animation durations are in **seconds**. Runtime engine milliseconds are converted at the composition boundary.
- The frame loop caps elapsed time at **0.1 seconds** after a stall. It intentionally slows the synthetic clock rather than replaying a long hidden-tab backlog; this is not a network clock synchronization scheme.
- `PositionInterpolator` performs exponential convergence with `1 - exp(-12 × elapsedSeconds)`. Equal total elapsed time produces the same position for an unchanged target regardless of frame subdivision. Zero time leaves the position unchanged; negative or non-finite time and non-finite coordinates are rejected.
- An explicit `shouldSnap` update or a positional gap **greater than 8 world units** snaps immediately. A gap of exactly 8 units still smooths unless explicitly marked. Imported presentation projects the interpolated position onto nearby support. No timestamps, prediction, extrapolation, or transport reorder buffer are implemented.
- Orientation uses the shortest angular difference and the same exponential convergence rate. Interpolation never writes back to adapter state.
- The authored camera starts at radius 26 meters, with a 10–38 meter zoom range and vertical orbit limits of 0.35–1.45 radians.

Meter units intentionally differ from the stock Editor template's centimeter conventions. `CharacterModelProfile` (ad-hoc `modelUrl` models only) states `metresPerUnit` and `facingYawRadians`; conversion is applied once at the presentation assembly root. Native player profiles carry their own forward axis and actor scale; the client never fits models to a bounding height or recenters their origins. The retired lineagen GLBs had been normalized to 1.8 m by their earlier conversion; [ASSET_AUDIT.md](ASSET_AUDIT.md) keeps that history.

## Entity and asset ownership

The registry owns one `CharacterVisual`, `PositionInterpolator` and `EntityLabel` per entity, plus a shared selection ring. Spawn creates those resources immediately. Update changes the target transform, animation state and label data; a model URL, appearance identifier or kind change rebuilds the visual while preserving selection. A changed action sequence retriggers the requested clip. Despawn removes the visual and label and clears selected-target state if necessary. Duplicate spawn replaces the prior presentation; an update for an unknown identifier is ignored, so producers must send spawn before update.

The legacy `createCharacterVisual` returns a usable procedural character synchronously. For an explicit `modelUrl` it resolves a profile in `src/assets/characterProfiles.ts` (appearance ids never resolve to a GLB), fetches the GLB with an abort signal, checks HTTP success and the complete glTF v2 header, and loads an asset container with Babylon animation autoplay disabled. Even binary input receives a resource base URL, derived from the response URL, for folder-relative dependencies. `prepareCharacterModel` validates geometry and selected clips, applies the profile's unit/facing transform, and parents only imported top-level nodes to the assembly root. All internal hierarchy and source transforms remain intact. This legacy path retains its placeholder and visible failure status. A late result for a removed entity or disposed scene is disposed rather than reintroduced.

Native visuals use a separate factory: an initially disabled transform and a
mesh-free animation state holder preserve semantic requests while the source
assembly loads. `CharacterVisual.ready` resolves after native parts, clips and
the current initial equipment request are installed; failures reject it.
`EntityRegistry.whenReady()` awaits the current set, repeats if an entity was
replaced, and does not let a removed visual's cancellation reject its replacement.
Registry disposal cancels readiness. This contract prevents native startup from
substituting a procedural character while preserving the legacy demo's fallback.

`CharacterAnimator` preserves the selected state when switching drivers. Procedural animation blends articulated idle breathing, run strides and attack swings. Profile-backed model animation resolves exact native identifiers and per-state loop/transition policies. The current unarmed profiles map idle to `wait_Hand` (0.18 s transition), run to `run_Hand` (0.12 s) and attack to `Atk01_Hand` (0.08 s). These transition durations are client presentation choices; native clip durations remain unchanged. Idle and run loop, while attack plays once and fades visually to idle near its end without changing authoritative semantic state. Another explicit action sequence retriggers it; repeated ordinary snapshots do not. Interrupted blends preserve current contributing weights rather than jumping back to a bind pose.

Ad-hoc model URLs retain the documented case-insensitive generic aliases for independent fixtures. Missing mapped clips retain the procedural fallback and report the incompatibility; that does not alone demonstrate a conversion defect. Models remain local: `pnpm assets:stage` runs `scripts/stage_native_players.py`, which adds the four native Human packages and profiles to ignored `public/l2/` with SHA-256 pins. Initial players select FFighter/MFighter/MMagic (native packages, procedural until loaded or on failure), while three monsters remain procedural; all four Humans are selectable on `/?world=interlude&character=<id>`. The current verification record is in [ASSET_AUDIT.md](ASSET_AUDIT.md) and [VERIFICATION.md](VERIFICATION.md).

### Asset structure guides the client

The observed structure is `<Variant>_Character` → `<Variant>_Rig`, containing seven separate skinned parts and the native `bip01` hierarchy. All seven parts share one canonical exported skeleton. Weapon, shield, cape and sheath helper bones remain, but no weapon meshes or separate attachment objects are supplied. Material names, alpha modes, texture references and imported extras stay unchanged. Mesh picking adds the namespaced `clientEntityId` field without replacing imported metadata; non-object source metadata is retained as `sourceMetadata`. Targeting also supports the procedural visuals' existing `entityId` field.

Every current GLB contains all its animations and embedded images; there are no separate animation files or external texture dependencies in this converted inventory. A profile therefore describes one demonstrated resource plus unit/facing and animation data. No speculative multi-resource assembly or equipment gameplay system is added. If later inputs supply separate resources, extend the presentation descriptors and target resolution to their verified identities instead of requiring asset rebaking or flattening to fit this implementation.

The native root-motion channels are retained. Earlier conversion already removed net horizontal drift and applied sampled vertical floor corrections, so runtime assembly does not repeat those operations. Adapter coordinates drive the outer entity root while animation controls body movement inside it. Conversion repairs require demonstrated defects or lost source relationships and are recorded separately from client changes in the asset audit.

These changes remain in presentation and asset resolution. `GameWorldAdapter` delivers entity lifecycle, semantic state and appearance references without Babylon or asset-format dependencies. Bound measurements provide label height, selection-ring radius and diagnostic picking height; measurements do not modify character size or origin. They are taken before attaching the assembly to the moving entity root, so an asynchronous load cannot incorporate a stale world position into its anchors.

`EntityLabel` projects a point above the interpolated character into the viewport, hides off-screen labels, writes names with `textContent`, and exposes selection buttons and health meters. `WorldInterface` owns the compact HUD and dispatches all entity-changing controls to the adapter. Its health values and cosmetic attacks do not introduce combat calculations.

The HUD injects a scoped stylesheet from TypeScript and removes it on shutdown. This avoids CSS/font imports in the Editor's CommonJS script compiler. Both overlays track the rendering canvas rectangle, including an embedded Editor preview. The Vite page self-hosts the heading font; Editor scene play uses the serif fallback when that browser-page font is absent. The main health/name display also reads adapter state.

## Shutdown and authoring separation

Stopping the scene removes the frame observer, pointer targeting, camera controls, adapter subscription, entity visuals and labels, selection resources, HUD, diagnostic handle, and adapter state. Character cleanup aborts pending loads and disposes animation drivers, asset containers, procedural meshes/materials, and roots. Browser page shutdown and Vite hot replacement dispose `App`; the engine host removes resize handling, stops rendering, and disposes the engine. Scene loading failures dispose partial scene resources before reporting the error.

MCP is an authoring tool outside this runtime. It does not appear in `GameWorldAdapter`, cannot be required for browser startup, and has no runtime service configuration in this repository.

## Phase 2 — future Interlude adapter

`createWorldRuntime` is the single composition point that selects `MockWorldAdapter`. A future adapter can supply the same initial state and ordered entity events without importing transport details into presentation modules. It must establish snapshot/subscription ordering, normalize positions into meters and time into seconds, and mark teleports explicitly.

The current `WorldCommand` union includes synthetic developer intents such as spawn, pause, forced animation, and intentional asset failure. A real adapter must map supported player actions and explicitly reject or disable unsupported demo intents; replacing the constructor alone does not turn those controls into network features. Phase 2's concrete outcome is real Interlude authentication, character selection and world entry against stock Mobius. Protocol and transport design belong to that later task and are absent here. Asset integration remains a Phase 1 follow-up; production deployment is outside the current roadmap scope.
