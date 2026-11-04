# Architecture

The authored environment and dynamic world have separate owners. Native Editor resources own the courtyard, props, lights, and initial camera settings. `GameWorldAdapter` owns dynamic entity state. Presentation code creates and disposes visuals in response to that boundary; it never invents authoritative movement or imports the mock implementation.

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
src/
  main.ts                     Native browser entry; startup errors and shutdown
  App.ts                      Browser application lifecycle
  scripts.ts                  Official CLI-generated script map
  scripts/world.ts            Scene-attached Editor behavior
  runtime/createWorldRuntime.ts  Adapter selection and runtime composition
  engine/                     Engine, render loop, resize, disposal
  scene/                      Load the authored export with Editor tools
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
docs/                         Architecture, provenance, Editor/MCP record
```

`assets/` contains authored content; `src/assets/` contains runtime code. `public/scene/` is the template-supported packing output rather than a second authored environment. Extra native scene subdirectories may be created by the CLI or Editor when their corresponding features are used.

## One authored scene, two entry workflows

`pnpm dev` and `pnpm build` begin with `babylonjs-editor-cli pack`. The official packer reads `assets/example.scene/`, exports `public/scene/example.babylon`, and regenerates `src/scripts.ts` from attached script metadata. The original static environment was serialized into editable resources once; there is no bootstrap generator in these commands that can overwrite later Editor edits.

In the browser, `main.ts` creates `App`, which creates `EngineHost` and calls `loadEnvironment`. That loader uses `babylonjs-editor-tools.loadScene` with the generated script map, then selects the authored **World camera**. A missing or incorrectly typed camera produces an explicit startup error.

The scene's `metadata.scripts` attaches `scripts/world.ts`. Its constructor receives the scene. `onStart` calls `createWorldRuntime`; `onStop` invokes the returned cleanup function. The official Editor's **Play current scene** pipeline uses the same scene export, script map, and attachment lifecycle. **Play project as-is** invokes `pnpm dev`. Desktop execution of these paths remains unverified; see [EDITOR_MCP.md](EDITOR_MCP.md).

The camera's framing and orbit/zoom limits remain in editable JSON. `WorldCamera.ts` attaches input, disables panning, and preserves those values. Runtime lookup depends on the **World camera** and **Courtyard ground** names; renaming either requires updating its corresponding lookup.

## Adapter event flow

`GameWorldAdapter` is transport-independent and contains no Babylon types:

| Method | Responsibility |
| --- | --- |
| `getInitialState()` | Return the current complete entity snapshot. |
| `subscribe(listener)` | Deliver ordered `spawn`, `update`, and `despawn` events; return an unsubscribe function. |
| `dispatch(command)` | Receive a typed user intent. The adapter decides how it changes authoritative state. |
| `advance(deltaTimeSeconds)` | Advance the synthetic producer; a future transport-backed adapter may leave this empty. |
| `dispose()` | Release adapter-owned subscriptions and state. |

`EntityRegistry` subscribes and reads the initial snapshot synchronously before the frame loop starts. Each entity has a stable identifier, kind, display name, position, orientation, health, maximum health, animation state, and optional model URL. Updates carry a complete replacement state, with an optional `shouldSnap` flag. The mock freezes outgoing entities, nested positions, snapshot arrays, and event objects to prevent subscribers from altering its state.

The flow is:

```text
UI / ground input -> adapter.dispatch(intent)
frame clock      -> adapter.advance(seconds)
adapter event    -> registry -> visual / animation / label
frame clock      -> interpolation / animation / label projection / diagnostics
```

Every dynamic spawn, state update, model change, and removal crosses this boundary. Camera changes, target selection, and interpolation are presentation state and do not need adapter commands. `window.__worldDiagnostics.snapshot()` exposes read-only copies for browser verification; `projectPosition()` projects world coordinates to canvas pixels. Neither exposes command or mutation hooks.

`MockWorldAdapter` supplies exactly six initial entities. It advances on deterministic 0.1-second ticks, publishes remote movement, advances local click-to-move at 4 meters per second, and schedules cosmetic monster animation states. Its spawn, teleport, pause, animation, removal, and missing-model demonstrations use the same event path as normal updates. Pausing stops synthetic ticks while presentation and explicit commands remain usable.

## Coordinates and timing

- The world is Babylon's left-handed system: **+Y up**, X/Z on the ground. One authored/runtime unit is **one meter**. Orientation is yaw around +Y in radians.
- Delta values and animation durations are in **seconds**. Runtime engine milliseconds are converted at the composition boundary.
- The frame loop caps elapsed time at **0.1 seconds** after a stall. It intentionally slows the synthetic clock rather than replaying a long hidden-tab backlog; this is not a network clock synchronization scheme.
- `PositionInterpolator` performs exponential convergence with `1 - exp(-12 × elapsedSeconds)`. Equal total elapsed time produces the same position for an unchanged target regardless of frame subdivision. Zero time leaves the position unchanged; negative or non-finite time and non-finite coordinates are rejected.
- An explicit `shouldSnap` update or a positional gap **greater than 8 meters** snaps immediately. A gap of exactly 8 meters still smooths unless explicitly marked. No timestamps, prediction, extrapolation, or transport reorder buffer are implemented.
- Orientation uses the shortest angular difference and the same exponential convergence rate. Interpolation never writes back to adapter state.
- The authored camera starts at radius 26 meters, with a 10–38 meter zoom range and vertical orbit limits of 0.35–1.45 radians.

Meter units intentionally differ from the stock Editor template's centimeter conventions. Inspect import scaling when bringing assets through the Editor. The foundation's optional model loader currently normalizes a model to 1.8 meters high and recenters its bounds. These are prototype assumptions to replace in the asset follow-up: derive unit/orientation handling from the observed asset structure, apply it at the assembly root, and preserve authored proportions, origins and attachment alignment while keeping world coordinates in meters.

## Entity and asset ownership

The registry owns one `CharacterVisual`, `PositionInterpolator`, and `EntityLabel` per entity, plus a shared selection ring. Spawn creates those resources immediately. Update changes the target transform, animation state, and label data; a model URL or kind change rebuilds the visual while preserving selection. Despawn removes the visual and label and clears selected-target state if necessary. Duplicate spawn replaces the prior presentation; an update for an unknown identifier is ignored, so producers must send spawn before update.

`CharacterVisual` returns a usable procedural character synchronously. If an optional model URL exists, it fetches with an abort signal, checks HTTP success and the binary glTF header, and asks Babylon to load an asset container. `prepareCharacterModel` verifies usable geometry and required clips, normalizes scale/origin, assigns picking metadata, and attaches the container. Failure retains the placeholder and reports a visible status message. A late result for a removed entity or disposed scene is disposed rather than reintroduced.

`CharacterAnimator` preserves the selected state when switching drivers. Procedural animation blends articulated idle breathing, run strides, and attack swings. Model animation accepts documented case-insensitive idle/run/attack aliases and crossfades groups over 0.16 seconds. Models without recognized required clips retain the procedural fallback; this can indicate a mapping mismatch rather than a conversion defect. No external character GLB is bundled; model-driver tests use synthetic fixtures, not a claim of compatibility with arbitrary rigs.

The local asset follow-up found `wait_Hand`, `run_Hand` and `Atk01_Hand` in four converted candidates. Explicit mapping and actual destination rendering remain pending. Model and animation import work belongs in the asset/animation modules and must preserve the adapter boundary. See [ROADMAP.md](ROADMAP.md).

### Asset structure guides the client

The user's requirement for the follow-up is to adapt the client to the original asset organization and relationships represented by the converted files and manifests. Current loader contracts are implementation details, not requirements imposed on valid source content. Inspect the actual character parts, skeletons, attachments, equipment variants, material references and animation families before defining the client-side model descriptors and assembly rules.

Preserve native asset and clip identifiers, bone hierarchy, bind poses and useful resource separation. Resolve semantic animation states to the correct existing clips in client data; do not rename source clips to generic aliases. Separate animation resources or equipment parts must remain supportable where the supplied structure uses them. Adapt looping, root motion, origins and unit conversion to observed behavior rather than automatically rebaking files or forcing every model to one height.

The initial loader currently assumes one asset container with all required animation states, and its animation driver loops every selected clip. Audit and replace those assumptions where they conflict with the actual assets. Conversion repairs are appropriate for demonstrated defects or loss of required source relationships, with evidence recorded separately from client compatibility work. Build only the assembly features needed by available assets; this is not an instruction to add speculative equipment gameplay.

These changes remain in presentation and asset resolution. `GameWorldAdapter` continues to deliver entity lifecycle and semantic state, so a future network adapter can supply appearance references without importing rendering or asset-format details into transport code. This section describes the required follow-up direction; the refactor has not been implemented by this documentation change.

`EntityLabel` projects a point above the interpolated character into the viewport, hides off-screen labels, writes names with `textContent`, and exposes selection buttons and health meters. `WorldInterface` owns the compact HUD and dispatches all entity-changing controls to the adapter. Its health values and cosmetic attacks do not introduce combat calculations.

The HUD injects a scoped stylesheet from TypeScript and removes it on shutdown. This avoids CSS/font imports in the Editor's CommonJS script compiler. Both overlays track the rendering canvas rectangle, including an embedded Editor preview. The Vite page self-hosts the heading font; Editor scene play uses the serif fallback when that browser-page font is absent. The main health/name display also reads adapter state.

## Shutdown and authoring separation

Stopping the scene removes the frame observer, pointer targeting, camera controls, adapter subscription, entity visuals and labels, selection resources, HUD, diagnostic handle, and adapter state. Character cleanup aborts pending loads and disposes animation drivers, asset containers, procedural meshes/materials, and roots. Browser page shutdown and Vite hot replacement dispose `App`; the engine host removes resize handling, stops rendering, and disposes the engine. Scene loading failures dispose partial scene resources before reporting the error.

MCP is an authoring tool outside this runtime. It does not appear in `GameWorldAdapter`, cannot be required for browser startup, and has no runtime service configuration in this repository.

## Phase 2 — future Interlude adapter

`createWorldRuntime` is the single composition point that selects `MockWorldAdapter`. A future adapter can supply the same initial state and ordered entity events without importing transport details into presentation modules. It must establish snapshot/subscription ordering, normalize positions into meters and time into seconds, and mark teleports explicitly.

The current `WorldCommand` union includes synthetic developer intents such as spawn, pause, forced animation, and intentional asset failure. A real adapter must map supported player actions and explicitly reject or disable unsupported demo intents; replacing the constructor alone does not turn those controls into network features. Phase 2's concrete outcome is real Interlude authentication, character selection and world entry against stock Mobius. Protocol and transport design belong to that later task and are absent here. Asset integration remains a Phase 1 follow-up; production deployment is outside the current roadmap scope.
