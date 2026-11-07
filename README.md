# L2 Browser Client

**Rendering direction — 2026-11-07:** WebGPU is already required. Preserve
Lineage II's appearance and behavior with a modern renderer; reproduce legacy
Direct3D details only where they explain a meaningful visible difference.
The [rendering plan](docs/RENDERING.md) distinguishes existing code from planned
chunking/streaming, LOD, static instancing, GPU texture compression and visibility
culling. Measure the supported slice now and optimize from that baseline while
remaining asset and fidelity work continues. Performance acceptance is still open.

**Audio is required for 1:1 and remains incomplete:** the local world now has six
verified original death cues with gesture unlock, mute and volume. Other original
exports and inspector playback cover only part of the task. The selected
4,773-sound export, clean-build, cache and browser-decode checkpoint is complete;
it adds no world playback categories. [Audio acceptance and gaps](docs/NATIVE_AUDIO.md) includes
music, ambience, surface footsteps, voices, combat/skills and UI.

**Latest local map addition:** the source and saved/exported routes now include
the missing TerrainSector247 beneath Actor3703's tree: 272 source vertices and
480 triangles, bringing the selected terrain to 4,992 triangles. The original
735-value UV correction and diffuse UV2 remain unchanged. See the
[integration evidence and repeatable commands](artifacts/native-parity/research/terrain-extension-20261106/REPORT.md).
This local WebGPU result is not deployed to the private URL below.

**Private playable preview:**
[l2.kingdom.lv](https://l2.kingdom.lv/?world=interlude&authored=1) serves the authored
native world after private invitation entry. On IMPORTA-PC, use the desktop
**L2 Browser Preview** shortcut. DATABASE-PC hosts the build and must stay running.
[Access, operation and verification](docs/PRIVATE_PREVIEW.md) include normal
IMPORTA access, repaired origin connection capacity and verified
desktop/mobile asset delivery.

**Native startup correction verified in staging:** later phone captures showed an
early reveal with procedural stand-ins. The new readiness barrier waits for
terrain/camera attachment, native assembly, initial equipment and a complete
frame; it creates no native dummy meshes and adds no fixed delay. **479 unit
tests**, the staged build, **5/5 reveal cases each in Chromium and WebKit**, and
the corrected facing test **1/1** pass. Earlier fixture failures remain recorded.
The fix stays in `artifacts/private-preview/native-reveal/dist-stage/`; the live
URL retains the earlier build because the current terrain task forbids service
changes and production deployment.

**Earlier loading and movement checkpoint:** startup shows four named steps, measured
progress for the current step and phase-specific puns. Download/startup failures
offer **Reload and retry**. The native fighter's whole assembly now faces its
tap-to-move direction without changing source assets. That checkpoint passed
**444 unit tests**, production build and the focused loading/facing browser
cases. The deployed build passed **29 external checks each in Chromium and
WebKit** for eventual rendering/delivery; those checks did not verify the first
visible frame and are superseded as startup acceptance by the phone report.
[Verification and captures](docs/VERIFICATION.md) record the corrected test
projection, accessibility review and exact preservation of 1,684 authored files.

**Editable native world:** `pnpm assets:editor` imports the staged map into
`assets/native-world.scene` for Babylon Editor **5.5.3**. The actual UI saved
and reopened a tree-placement edit. `pnpm build` now recovers a demonstrated
Editor UV2 save defect without replacing saved placement/material edits.
The authored browser route is `/?world=interlude&authored=1`.
The earlier rebuilt desktop/mobile checkpoint passed **2/2**, retaining the saved placement,
camera, materials and native actors. Repeat import preserved all **2,245**
authored files.
[Authoring workflow and evidence](docs/NATIVE_EDITOR_WORLD.md) records the
preservation contract and remaining acceptance checks.

**Flame timing authoring verified:** actual Editor UI save/reopen and Play retain
enabled preview, texture/fade starts **0.25 / 0.75 seconds** and rates **0.5 / 1.5**
in the authored world. The normal source route keeps its defaults. The latest
flame checkpoint passed **435 unit tests**, build/typecheck and **6/6 browser cases**;
all **2,244 recovered authored files** survive Play, browser checks and repeat
import unchanged. The earlier pre-save backup retains the removed thumbnail.
The later Editor plugin-dependency repair passes **436 unit tests** and build/typecheck.
[Flame evidence and limits](docs/NATIVE_FLAMES.md) distinguish this demonstration
from full skill/Power Strike timing and native rendering parity.

**Native world preview:** the local `/?world=interlude` route now loads the
PlayerStart10 startup-area candidate from native `20_20.unr`: 62 models, 157
placements, fighter and Greater Musveren, with live FPS and desktop/mobile
controls. Run `pnpm dev` for the retained local scene. The base migration recipe
produces 61/151; the current selection includes guarded boundary/BSP additions.
Use the [additive pipeline](docs/NATIVE_MAP_MODEL_APPEND.md) to reproduce the latest
tree addition without replacing authored edits. [Native world details](docs/NATIVE_WORLD.md) distinguish
verified source migration from pending live-camera/material parity. The twelve
flame placements now have a reversible [source-formula preview](docs/NATIVE_FLAMES.md),
with native lighting and synchronization still unverified. Networking and hardware performance acceptance
remain unfinished.

**Musveren identity and scale resolved:** NPC **21622** maps to
`LineageMonster.field_stalker_20_bi`, with native actor scale **1.2** and an
independent **0.36 m** collision half-height. The visible final death pose still
has **660/1,591 vertices** below the current terrain by up to **11.94 cm**.
[Placement evidence](docs/NATIVE_ACTOR_PLACEMENT.md) and
[fresh desktop/mobile captures](docs/screenshots/README.md) record the repair.
The world-authoring checkpoint passed **283 unit tests** and **2/2 authored
browser cases**; the ordinary native suite passed **3/3** in its preceding
combined run. The separate migration checkpoint passed **302 pipeline tests
with zero skips**. Clean migration reproduces **381
products** with **26/26 cache replay hits**; original model GLB payloads remain
unchanged. [NPC source profiles](docs/NATIVE_NPC_PROFILES.md) records the join.

**Editor authoring is partially verified:** Babylon.js Editor 5.5.3 saves and
reopens native equipment, clip and camera edits, and its Play view renders the
imported world and actors. The saved edits survive generation/build and pass
desktop/mobile production-browser checks. Exact actor-material tint and roughness
edits also survive the actual UI save/reopen/build cycle; the demonstration
override is disabled in the normal preview. Full skill-effect timing and native shader
fidelity remain incomplete; flame replay authoring is verified above. [The Editor record](docs/EDITOR_ROUNDTRIP.md) includes real captures,
an unresolved repeated-Play blank-viewport failure and the separate dev-server
cold-load timeout; [verification](docs/VERIFICATION.md) records test results.
The [read-only startup analysis](artifacts/native-parity/research/editor-dev-startup/README.md)
identifies a development module-loading delay; its cause and fix remain unproven.

A standalone Babylon.js browser client with a locally staged Talking Island world and six synthetic characters. An editable courtyard remains available as a fallback. It demonstrates the rendering and world-data boundary for a later Interlude adapter. It does not connect to a game server.

The project starts from Babylon.js Editor v5's native **Vanilla** template. Its Vite entry points, `project.bjseditor`, native scene directory, official packing CLI, and scene-attached runtime script are retained. The original static environment is stored as editable resources; runtime TypeScript creates the dynamic characters.

**Current status:** the client loads the audited terrain, scenery, grass and source terrain materials when world assets are staged. Characters use terrain/building support for movement, spawning and teleporting. [docs/WORLD_ASSETS.md](docs/WORLD_ASSETS.md) records pinned world bundles and integration details; [docs/ASSET_AUDIT.md](docs/ASSET_AUDIT.md) covers the character assets. **Phase 2 remains Real M0 networking**: Interlude authentication, character selection, and world entry against stock Mobius. See [docs/ROADMAP.md](docs/ROADMAP.md).

<img src="docs/screenshots/mobile.png" alt="Mobile synthetic courtyard with six characters, selected player and compact action controls" width="260" />

The image above records the original procedural foundation. Current local asset captures are linked from the asset audit and remain outside Git.

## Run locally

Prerequisites:

- Node.js **22.12.0 or later** and a browser with WebGPU support and hardware acceleration enabled. Use HTTPS or localhost; the client requires WebGPU.
- **pnpm 10.32.1**, matching `packageManager` in `package.json`. Use pnpm for all dependency operations and retain `pnpm-lock.yaml`.
- Babylon.js Editor **5.5.3** only for desktop authoring. The browser demo does not need the Editor or an MCP server.

```sh
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5173**. The dev command first exports the authored scene with the official Editor CLI. Port 5173 is fixed; the template's port 3000 was unavailable on the implementation machine because Windows rejected the bind with `EACCES`.

The Editor project also enables WebGPU. Editor 5.5.3 drops this setting when saving: run `pnpm renderer:ensure` and fully close and reopen the project to apply it again. `pnpm dev` and `pnpm build` restore it automatically. See [the Editor renderer notes](docs/EDITOR_MCP.md#webgpu-selection--2026-11-06).

Stage the audited world already present on this machine before starting:

```sh
pnpm world:stage
pnpm world:verify
```

The default page then enters Talking Island. The staging tool verifies and copies the pinned outputs without reconversion. Source coordinates, terrain masks, mirrored placements, foliage cutouts and interior floors are preserved. Without staged world files, the page opens the courtyard; `/?world=courtyard` explicitly selects it. A corrupt staged bundle produces an actionable error. See [the world integration record](docs/WORLD_ASSETS.md) for movement policy and remaining source gaps.

To use the converted characters already present on this machine, stage them before starting the demo:

```sh
pnpm assets:stage
```

This copies the four existing GLBs unchanged from `C:\laragon\www\lineagen\.assets\converted` into ignored `public/assets/characters/` and writes a local hash inventory. An alternate source directory can be passed as the command's first argument. The staging script does not run a converter or modify the source workspace. A clean clone without these local files remains usable with animated procedural fallbacks. Keep staged binaries and builds containing them local; do not push or publish them.

The currently integrated local files include a verified, destination-only grounding repair to seven native root-translation channels. If this task's local repair directory exists, stage those corrected files instead:

```sh
pnpm assets:stage artifacts/asset-integration/repair/converted
```

Running the plain command again restores the source-original baselines, including their measured grounding defects. The corrected GLBs and matching editable Blender files remain in local scratch space; the source files, rigs, materials and other animation channels are unchanged. [docs/ASSET_AUDIT.md](docs/ASSET_AUDIT.md) records the defect evidence, exact repair scope and before/after hashes.

With `pnpm dev` running, **http://127.0.0.1:5173/tests/browser/assetInspection.html** opens the development inspection page for all four profiles, including FMagic. It provides native clip playback, skinning sampling and independent-instance checks. This inspection page is a test harness, not a character-selection or networking screen.

## Convert new assets from the native client

**IMPORTA-PC's `C:/Lineage2-client` is the authoritative native reference.** The repeatable migration command uses its hash-pinned snapshot on DATABASE-PC. `E:/Lineage2-client` is a reusable local copy only after fresh source-hash equality. The existing Talking Island and fitted character GLBs are legacy Classic/Unity references; their earlier grounding and animation repairs are not applied to new native exports.

```powershell
pnpm assets:migrate --prove-rebuild
```

This command verifies the **raw migration milestone**: source inventory, character/equipment/monster exports, raw `20_20.unr` and exact Power Strike source-dispatch data, validation, cache replay and clean rebuild comparison. [The migration guide](docs/NATIVE_MIGRATION.md) covers fleet staging, recipes, outputs and remaining gaps. Local playable integration and partial Editor authoring have separate evidence below; raw extraction does not certify visual parity or performance.

For the local native world, run `pnpm assets:migrate --stage-runtime`, then open **http://127.0.0.1:5173/?world=interlude**. It loads the staged native terrain/scenery with Human male fighter and Greater Musveren at source scale, preserving original part rigs, exact source weight attributes and clip timing. Live FPS remains visible. Demo controls change upper-body item 22, play/hold/revive Musveren's death, frame the world, follow the fighter and switch between source-texture preview and neutral terrain. Required native assets now fail startup visibly instead of substituting procedural actors; the legacy six-character demo retains its separate fallbacks. [NATIVE_WORLD.md](docs/NATIVE_WORLD.md) explains source startup-location evidence, local terrain support and remaining material/camera/collision gaps. Sword attachment and Power Strike are not yet certified. `assets/native-parity.scene` and `src/scripts/nativeParity.ts` expose authored camera/clip/equipment values without making them migration outputs. Actual Editor edit/save/reopen, scene Play and rebuilt-browser checks verify this equipment/animation/camera subset. [EDITOR_ROUNDTRIP.md](docs/EDITOR_ROUNDTRIP.md) records the evidence and remaining authoring steps.

The same staging command preserves the current native section's terrain
GLB/editable glTF, 61 source models, 151 placements, PNG sources and provenance.
**http://127.0.0.1:5173/tests/browser/nativeSection.html** is its isolated
development inspector. Source-texture preview and neutral terrain remain
distinct modes; native terrain shading, collision and the live spawn/camera
match remain unverified. Twelve flame placements now have a source-formula
preview; **Inspect flame** cycles their close-up views. Native lighting and
clock/camera equivalence remain unverified.

Standalone texture archives now retain all requested original mip/palette data,
including the reviewed Engine licensee30 material prefix. DXT1 archives also
provide DDS derivatives containing the exact native compressed blocks; PNG
previews remain available. [Native texture products](docs/NATIVE_TEXTURES.md)
documents coverage, output files and Babylon's partial-mip-chain limits. The
staged section retains authored mask-transform tags/bytes for later material
work; these exports do not establish native terrain blending or speed gains.

The terrain research follow-up includes an isolated ordered-pass GPU reference:
`pnpm exec playwright test --config playwright.terrain.config.ts`. It tests
explicit blend/upload/sampling assumptions without changing the game material
or regenerating Editor resources. [Evidence, commands and remaining native
questions](artifacts/native-parity/research/terrain-browser-20261106/REPORT.md)
include 20 passing diagnostic cases on the GTX 1060; they are not native parity
or a performance benchmark.

The fighter package also retains original attachment records and source-backed
animation-family definitions, with exact references to its 114 exported clips.
The migration guide distinguishes these preserved relationships from the still
unverified native sword placement, attack dispatch and playback rates.

Python **3.12 or later** and the pinned local UE Viewer installation are required for conversion. From this project:

```powershell
pnpm assets:convert --kind model --package speaking1f_s --object wall03
pnpm assets:convert --kind audio --media music/b01_f.ogg
pnpm assets:batch recipes/native-mfighter.json --client artifacts/native-parity/inputs/IMPORTA-PC
pnpm assets:catalog --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-client-audit/catalog.json
```

Each conversion prints the path to a verified, self-contained **`asset.l2asset`**. Open **Demo controls → Assets**, or drop the file onto the client, to inspect it at its recorded scale, play its original clips, or listen to audio. Camera framing does not resize the model. Native mesh origin, rotation, scale and animation keys are preserved; unresolved native materials are visibly identified. The inspector uses a separate scene because the legacy island's units and edition do not establish a valid placement transform for new Interlude assets.

[The asset pipeline guide](docs/ASSET_PIPELINE.md) covers repeatable batch recipes, complete character assemblies, explicit texture bindings, dependency hashes and supported formats. [The native client audit](docs/NATIVE_CLIENT_AUDIT.md) records source identity, animation events and skill tables. Original particle/shader behavior and skill execution need separate runtime adapters; importing their metadata does not reproduce those systems.

```sh
pnpm typecheck
pnpm build
pnpm serve
```

`pnpm build` exports the scene, runs strict TypeScript checking, and creates `dist/`. `pnpm serve` previews that build locally. No production deployment is configured.

The pinned stack is Babylon.js **9.27.1**, Editor runtime tools/CLI **5.5.3**, TypeScript **7.0.2**, Vite **7.3.7**, Vitest **5.1.0**, and Playwright **1.64.1**. The exact dependency graph is in `pnpm-lock.yaml`.

## Explore the demo

The first scene contains exactly one local player (**Elyra**, FFighter), two simulated remote players (**Orin**, MFighter; **Seren**, MMagic), and three procedural monsters (**Moss Golem**, **Amber Wisp**, and **Watcher**). Staged models replace the three players' fallbacks after loading. Remote players receive synthetic movement updates; monsters alternate idle and cosmetic attack states. Floating names and health bars follow every character.

| Control | Behavior |
| --- | --- |
| Click/tap a character or its name | Select it; show the ground ring and target details. |
| Click/tap supported ground or a floor | Clear selection and move Elyra toward that point, stopping at walls or unsupported terrain. |
| Right mouse drag / touch drag | Orbit the authored camera. |
| Mouse wheel / two-finger pinch | Zoom within the authored limits. |
| **Attack**, **Run**, **Idle** | Set Elyra's animation. A loaded model plays attack once and returns visually to idle; pressing Attack again retriggers it. Run demonstrates the pose in place; ground input supplies movement. |
| **Teleport** | Snap Elyra between supported positions near town; the courtyard uses its original fixed positions. |
| **Spawn** | Add a synthetic sentinel through the adapter. |
| **Demo controls → Despawn target** | Remove a selected remote player or monster, its label, and its selection. |
| **Demo controls → Pause / Resume** | Pause/resume synthetic simulation. Camera controls, presentation animation, and manual demo commands remain usable. |
| **Demo controls → Missing model** | Spawn a sentinel with an intentionally unavailable model; retain its animated procedural fallback. |
| **Demo controls → Assets** | Inspect a local `.l2asset` model, texture or sound; close to return to the world. |

FPS, entity count, and interpolated local coordinates are displayed above the action bar. Health values are synthetic presentation data; attacks do not calculate damage. Reloading restores the initial six entities.

The interface follows the requested classic fantasy-game layout: health at upper left, actions along the bottom, bronze borders, and compact target information. The primary compact viewport is 390 × 844. The environment, procedural characters and icons are original; staged character artwork has the separate provenance recorded in the asset audit. No pixels were copied from the supplied UI reference.

## Test

Install the Playwright browser once after installing dependencies:

```sh
pnpm test:setup
```

On Linux, if system browser dependencies are missing:

```sh
pnpm exec playwright install --with-deps chromium
```

Then run:

```sh
pnpm test
```

This runs both Vitest and Playwright. Individual commands are `pnpm test:unit` and `pnpm test:e2e`. Playwright starts and stops its own `pnpm dev` server on port 5173; stop a manually running dev server before the browser suite. Chromium enables WebGPU with SwiftShader for functional checks; set `WORLD_HARDWARE_TEST=1` to use the machine's normal GPU configuration. The legacy WebGL reference fixtures remain separate from the WebGPU application. Failure traces are retained under `test-results/`.

Run `pnpm assets:stage` before the asset-specific browser suite. Those checks explicitly skip when the untracked GLBs are absent; a procedural fallback is not counted as a successful import. Asset reports and screenshots are written under ignored `artifacts/asset-integration/`. Run build/generation and browser tests sequentially.

The suites exercise adapter state and lifecycle, time boundaries and teleport snapping, procedural and model animation drivers, asset validation/fallback, visible entity removal, camera input/limits, mouse targeting, compact touch controls, diagnostics, and browser errors. The deliberately missing-model test allows only its specific expected HTTP 404 console message; uncaught exceptions and other error messages fail the suite. Browser coverage is Chromium; other browsers and physical mobile devices require separate verification.

The unit suite also runs the real official scene packer on editable fixtures and emulates the Editor's script compiler settings. These checks catch export and bundling regressions; desktop Editor operation remains a separate check. See [docs/VERIFICATION.md](docs/VERIFICATION.md) for recorded outcomes.

## Edit the environment

1. Install [Babylon.js Editor 5.5.3](https://github.com/BabylonJS/Editor/releases/tag/v5.5.3), then choose **Import project** in its dashboard and select the root `project.bjseditor`.
2. Open `assets/example.scene` for the courtyard or `assets/native-parity.scene` for the native slice. Keep **World camera** and its `ArcRotateCamera` type. Keep `scripts/world.ts` attached to the courtyard and `scripts/nativeParity.ts` attached to the native scene. The native scene's script settings expose starting equipment and exact animation clips.
3. Save, close, and reopen the scene to check persistence. Use **Play current scene**, or **Play project as-is** to run the project's `pnpm dev` command.
4. Run `pnpm dev` again after a saved environment edit to repack the same resources for the browser. Do not edit `public/scene/` or `src/scripts.ts`: they are generated by `pnpm generate`.

The authored courtyard uses **meters**, whereas the stock template and some
Editor import defaults use centimeters. Talking Island retains its original
right-handed source units; its presentation scale is applied once without
changing GLBs or world transforms. The native scene runtime loads the staged
Interlude world and actors in both Editor **Play current scene** and the browser
`/?world=interlude` route. The courtyard scene retains its separate behavior.
Generated assets do not replace saved Editor resources. Stop Editor Play before
build/browser checks because its export also writes generated scene/script files.
Generation first checks authored material references for the demonstrated
Editor internal lightProxy collision. A failure names the affected records and
stops before packing; restore those records from a verified copy and reopen the
scene. The check changes no files and does not patch the Editor.

**Actual desktop checkpoint, 2026-11-05:** the UI saved and reopened
`leatherShirt:true`, `fighterIdle:Wait_1HS_MFighter`, World camera radius `4.25`
and fog enabled with **None** (mode `0`). The no-fog setting also survives
Editor Play, whose export bypasses the CLI post-pack adapter. Real world/actor
and control captures are linked in [docs/EDITOR_ROUNDTRIP.md](docs/EDITOR_ROUNDTRIP.md).
Repeated Play/hot restarts produced blank views; normal project-window closure
and Dashboard reopening recovered the session, with the cause still unproven.
Build/typecheck and 163 unit tests passed afterward. The production-browser run
passed **12/12 cases in 4.4 minutes**, confirming saved `leatherShirt:true`,
`Wait_1HS_MFighter`, camera radius `4.25` and fog **None** after generation/build.
The dev run passed 17/18 cases: its first courtyard navigation timed out at the
unchanged 45-second limit, including on rerun; all native desktop/mobile checks
passed. The same courtyard case passed in 5.4 seconds against the production
build. [docs/VERIFICATION.md](docs/VERIFICATION.md) retains both outcomes; complete
native-material and full skill-effect timing authoring remain pending; the later
flame replay authoring checkpoint is recorded above.
The earlier Musveren support repair passed **168 unit tests / 26 files** and
**3/3 native browser cases in 2.9 minutes**, with saved scene/project files and
source asset hashes preserved. It is a separate run from the 12-case Editor
proof. [NATIVE_ACTOR_PLACEMENT.md](docs/NATIVE_ACTOR_PLACEMENT.md) records the
visible corpse and residual terrain intersection. The later source-profile
checkpoint resolves scale 1.2 and passes 179 unit tests, 291 pipeline tests and
three native browser cases; these remain separate invocations.
[docs/EDITOR_MCP.md](docs/EDITOR_MCP.md) records version details and the separate
official MCP status.

## MCP authoring

Use the official AI assistant panel bundled with the matching Editor release. It starts and configures the official Babylon.js MCP connection for the open project. There is no runtime MCP dependency and no repository-specific credential configuration.

No Babylon MCP server was connected during implementation, so no successful authoring interaction is claimed. See [docs/EDITOR_MCP.md](docs/EDITOR_MCP.md) for the inspected official setup, the fixed-port limitation in this release, and a concrete verification sequence.

## Architecture, source review, and limits

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes ownership, adapter events, units, timing, and where the future adapter connects. [docs/SOURCE_REUSE.md](docs/SOURCE_REUSE.md) records all seven requested `linegen` inspections and the exact revision.

The original source review found no redistribution license for `linegen` or its character assets, so the published foundation implements its behaviors independently and includes no copied source assets. This is a provenance decision about the published baseline, not a finding that locally converted models are technically unusable. The upstream Editor template is Apache-2.0; its license is retained in `docs/licenses/BabylonJS-Editor.txt`. Cormorant Garamond is distributed through its pinned Fontsource package under the SIL Open Font License. Babylon.js dependencies retain their own licenses.

Character profiles resolve semantic appearance identifiers to local GLBs and exact native `wait_Hand`, `run_Hand` and `Atk01_Hand` clips. Their separate parts, skeletons, materials and helper bones remain intact, including in the targeted grounding repair. The client preserves exported meter units and origins instead of fitting models to a common height. The earlier conversion already normalized each whole character to 1.8 m; the audit records that source policy and its limits on original cross-variant stature claims.

The current inputs contain their animations and textures inside each GLB, so no speculative equipment or separate-animation system is added. Folder-relative resource resolution is supported. Absent, malformed, or unsuitable models retain an animated placeholder; arbitrary third-party rigs remain unverified. See [the asset architecture](docs/ARCHITECTURE.md#asset-structure-guides-the-client) and [asset audit](docs/ASSET_AUDIT.md).

The historical foundation build emitted a Babylon/Editor runtime chunk of approximately 3.6 MB before gzip (0.88 MB gzip), triggering Vite's large-chunk warning. Current build and mobile-cost evidence belongs in [docs/VERIFICATION.md](docs/VERIFICATION.md) and the asset audit. Physical-device performance testing remains separate from Chromium mobile emulation.

Phase 1 excludes Mobius networking, authentication, character selection against a server, Interlude packets, relay services, SpacetimeDB, combat calculations, quests, progression and gacha. The local world integration reuses audited conversions; it does not establish complete original-client fidelity. Future **Real M0 networking** connects at `GameWorldAdapter`; the current developer commands are synthetic intents and need an explicit support policy in a real adapter.
