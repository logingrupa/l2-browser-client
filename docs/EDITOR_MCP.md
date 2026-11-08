# Editor and MCP authoring

## WebGPU selection — 2026-11-06

This project requires WebGPU. The root `project.bjseditor` now sets
`"isWebGPU": true`. Editor 5.5.3 reads this flag when creating the project
window; its editing viewport and **Play current scene** share that engine.
Apply a changed flag by fully closing the project and reopening it from the
Dashboard. Reloading only the scene does not change the engine.

The installed 5.5.3 `project/save/save.js` reconstructs the project JSON without
`isWebGPU`, so saving in the Editor removes the flag. Run `pnpm renderer:ensure`
after an Editor save and before reopening the project. The same restoration
runs automatically at the start of `pnpm generate`, including dev and build.
It preserves the other configuration values and leaves an already-correct file
untouched. It does not switch an already-open Editor window.

The local `l2-editor-webgpu-compat` project plugin fixes the bundled Babylon
9.27.1 compiler's raw-object/promise mismatch. It initializes the compilers and
can retry the specifically identified stalled GLSL effects without changing
materials, saving scenes or modifying installed Editor files. Its version gate
must be reviewed when upgrading Babylon. See [the plugin](../tools/editor-webgpu-compat/README.md).

The project was closed normally without saving and reopened with
`?isWebGPU=true`. The live Editor reports `engine.name === "WebGPU"`,
`isWebGPU === true`, initialized compilers and all 14 initial effects ready,
including the authored GLSL material. The installed Editor can still fall back
to WebGL on an unsupported device, so the flag alone is not proof of the backend.
Actual **Play current scene** also passed on the same NVIDIA/Pascal WebGPU
adapter: 62 models, 157 placements, two native actors and 12 active flames, with
all 43 effects ready and no shader/GPU validation errors. Play was stopped.
Its existing UV2 omission affected only the generated public export; normal
generation restored that export from the unchanged saved scene afterward.
Current evidence is in the [migration receipt](../artifacts/webgpu-migration/README.md).

## Editor Play session recovery — 2026-11-06

The [bounded follow-up](../artifacts/native-parity/editor/play-viewport-20261106/REPORT.md) recovered actual visible Editor 5.5.3 Play by
normal project-close → Dashboard → reopen, without changing code or authored
assets. Terrain, fighter and Musveren render; another Play/Stop cycle and one
same-window project reload also succeeded. All 2,248 current asset/project files
remain byte-identical. Final build and the two authored desktop/mobile browser
regressions pass; saved/public/dist retain corrected 549a… geometry and exact UV2.

This supersedes earlier statements that the current Play viewport is blank,
but does not establish a permanent lifecycle repair: the original cause remains
unknown. Raw Editor Play still omits UV2 and reports scene.isReady() false in
retained diagnostics despite visible output. Authoring and final project-built
exports preserve UV2. No readiness tolerance, asset, runtime or installed Editor
code was changed. Visible native parity, original audio and performance remain
outside this recovery claim. Historical failure evidence is retained.

Babylon.js Editor **5.5.3** now opens this project, saves and reopens native
equipment/animation/camera edits, and renders the imported world, fighter and
Greater Musveren in **Play current scene**. This is partial desktop proof:
saved equipment, animation, camera, no-fog settings and exact actor-material tint/
roughness edits also pass rebuilt-browser checks. Full native shader/world
authoring and effect timing remain unfinished. No official
MCP tools were invoked.
[EDITOR_ROUNDTRIP.md](EDITOR_ROUNDTRIP.md) records the actual UI evidence,
integration fixes, retained failures and remaining acceptance steps.

## Versions and sources inspected

Inspection dates: 2026-11-04 foundation; 2026-11-05 desktop checkpoint.

Editor **5.5.3** is installed under `C:/Users/rolan/AppData/Local/Programs/BabylonJS Editor/`. The official release API checked on 2026-11-05 lists it as the latest stable release, published 2026-10-29. Its Dashboard/native file chooser imported `project.bjseditor`, and the editing viewport opened the courtyard and later `assets/native-parity.scene`. The initial Dashboard-only checkpoint (`handoff.json`, `checkpoint-hashes.json`) retained all 129 baseline hashes; that checkpoint and the earlier foreground-input refusal are historical. The unavailable-desktop entries below describe 2026-11-04.

| Component | Version / source |
| --- | --- |
| Native template | [BabylonJS/Editor `templates/vanillajs`, v5.5.3](https://github.com/BabylonJS/Editor/tree/v5.5.3/templates/vanillajs) |
| Inspected release revision | `e3fce2cea68c6a32fdbacbb4c5aa4e6a0f154db7` |
| Project format | `project.bjseditor`, saved version `5.5.3`; initial template file declared `5.0.0` |
| Editor runtime tools / packing CLI | `babylonjs-editor-tools@5.5.3` / `babylonjs-editor-cli@5.5.3` |
| Babylon.js | `9.27.1`, matching this template release |
| Native bundler | Vite `7.3.7`; Vite is part of the upstream Vanilla template |
| TypeScript | `7.0.2`, with strict checking added by this project |
| Package manager | `pnpm@10.32.1`, also selected in `project.bjseditor` |
| Automated test tooling | Vitest `5.1.0`, Playwright `1.64.1` |
| Official MCP implementation inspected | [Editor `mcp/`](https://github.com/BabylonJS/Editor/tree/v5.5.3/mcp), package source version `0.1.0`; extension manifest version `1.0.0` |
| Installed desktop Editor | 5.5.3; native scene open/edit/save/reopen, recovered scene Play and saved-value production-browser checks passed on 2026-11-05, including exact actor-material tint/roughness. Full native shader/world authoring and effect timing remain pending. |
| Connected Babylon MCP server | None exposed in the available tool inventory |

The CLI and runtime tools are pinned explicitly: the registry's `latest` tag was `5.5.4-alpha.0` during inspection, which would not provide a stable match to the selected desktop release. Use Node.js 22.12 or later; Vite 7.3.7 requires Node `^20.19.0 || >=22.12.0`.

## Actor-material authoring checkpoint — 2026-11-05

The actual inspector saved and reopened an override for `local-player` and exact
material `MFighter.UpBody.MFighter_m001_t04_u`: linear RGB multiplier
`[0.45,1,0.6]` and roughness `0.45`. Editor Play rendered the green shirt. The
enabled override passed three production browser cases in **3.6 minutes**.
After disabling the override through the UI and rebuilding, the normal preview
passed three cases in **3.5 minutes**, with zero active material clones and no
browser errors. The saved tint/roughness values remain available while the
override is disabled.

An initial Color3 numeric-input save failed to commit its values; supported
Vector3 text fields provided the verified RGB-editing workaround. An unrelated
Tree bark/proxy-material replacement from the first save was restored before
the accepted save. Evidence and retained failures are in
[material-authoring-20261105](../artifacts/native-parity/editor/material-authoring-20261105/README.md)
and [EDITOR_ROUNDTRIP.md](EDITOR_ROUNDTRIP.md). This is bounded presentation
authoring; native shader equivalence, persistent world-object editing and
effect timing remain open.

## Actual desktop checkpoint — 2026-11-05

The earlier actual UI checkpoint saved and reopened these values in `native-parity.scene`:

| Property | Saved value |
| --- | --- |
| Start with Leather Shirt | `leatherShirt: true` |
| Fighter idle clip | `Wait_1HS_MFighter` |
| World camera radius | `4.25` |
| Fog | Enabled with **None** (`fogEnabled:true`, `fogMode:0`) |

The fog choice preserves the intended no-fog view in both browser packing and
the Editor's in-process Play export. Earlier disabled/Linear settings exposed
the packer's lost enable switch; the in-process export bypasses the project's
post-pack adapter.

`artifacts/native-parity/editor/20261105-editor-recovered-play.png`,
`20261105-editor-recovered-wide.png` and `20261105-controls-now.png` show the real
native world, actors and controls in Editor Play. Loader registration now uses
the `GLTF2` namespace available in the Editor's UMD modules. Local `/l2` resources
resolve relative to the Editor's file context, and input/HUD placement uses the
visible preview canvas with its measured toolbar inset.

Repeated Play and source hot restarts produced blank viewports. Reopening only
the scene did not recover that session; closing the project window normally,
returning to Dashboard and double-clicking the project did. No process kill was
needed. The cause remains unproven, and the failed screenshots/console evidence
are retained. `20261105-editor-death-confirmed.png` is a historical filename for
a command capture in which the monster is not visible; it does not prove death
animation or native visual parity.

The second-save audit preserves all 119 native authored meshes, seven materials
and two lights, with unchanged binary geometry. The earlier unexpected example
save was retained separately, then its 123 original files were restored exactly.
The after-generation receipt matches all **243 native files, 123 example files
and project configuration**. That receipt also records later generated-output
rewrites; source preservation alone is not an uninterrupted build or browser
acceptance result. See `save-audit-20261105-144515/` and
`20261105-post-generate-preservation.json` under the same evidence directory.

The subsequent build/typecheck passed (main chunk 3,858.38 kB, 955.05 kB gzip;
existing size warning), and **163 unit tests in 26 files** passed. The
production-browser run passed **12/12 cases in 4.4 minutes** using the temporary
`production-playwright.config.ts`, with the existing 45-second navigation limit
and assertions unchanged. It verifies the saved equipment, exact idle clip,
camera radius and fog None settings above after UI save/reopen, generation and
build, including native desktop/mobile checks. The log is
`artifacts/native-parity/editor/browser-production-roundtrip.log`.

The dev-server run passed **17/18 cases**: the first courtyard navigation timed
out at 45 seconds and failed the same way on rerun. All native desktop/mobile
saved-value checks passed. Against the built application, that courtyard case
passed in 5.4 seconds. The dev cold-load failure remains open; production success
does not erase it. [VERIFICATION.md](VERIFICATION.md) records both runs. These
checks established the equipment/animation/camera authoring subset. The later
actor-material proof is above; full native shader/world authoring, effect timing
and native visual/performance acceptance remain unfinished.

The subsequent Musveren placement repair passed a new build/typecheck,
**168 unit tests / 26 files** and **3/3 native browser cases in 2.9 minutes**.
The main chunk is 3,858.62 kB / 953.84 kB gzip. The fresh
[capture and preservation record](../artifacts/native-parity/browser/musveren-support-20261105/README.md)
retains all 243 native authored files, 123 example files and the project, plus
unchanged actor/world/source-package hashes. This is a separate runtime check;
it does not replace the 12-case Editor proof or claim another desktop UI session.
At that support-only checkpoint, the fixed **0.36 m** native support datum made
the corpse visible, while **76/1,591 vertices** remained below terrain by up to
**4 cm** and native viewer **Scale 1.2** was unmatched. The later exact NPC
profile supplies scale 1.2; its measured residual is **660/1,591 vertices** below
terrain, maximum depth **0.119400140 m**.
[NATIVE_ACTOR_PLACEMENT.md](NATIVE_ACTOR_PLACEMENT.md) records why the client
placement changed and why visual parity remains open.

The retained dev failure also has a
[read-only module-waterfall analysis](../artifacts/native-parity/research/editor-dev-startup/README.md).
Both traces expire before scene/asset loading, but the largest 21–23-second gap
has no attribution. No proposed warmup or other guessed fix has been applied;
the original timeout and assertions remain intact.

## Editable resources and runtime

Import the root `project.bjseditor` file. Keep `assets/example.scene/` and
`assets/native-parity.scene/`, their config files and camera/light/mesh resources
in their native locations. Editor saves can rename resource files to node names
and externalize geometry; intrinsic node identities remain the binding contract.
Static environment content is editable in these resources. Dynamic characters
are runtime objects supplied through `GameWorldAdapter`; the native scene's
script exposes equipment, exact clip and optional actor-material settings.

`pnpm generate` runs the official `babylonjs-editor-cli pack`. It exports both
saved scenes to `public/scene/{example,native-parity}.babylon` and regenerates
`src/scripts.ts`. The browser loads the selected export through
`babylonjs-editor-tools.loadScene`. Do not edit generated exports or the generated
script map as the source of scene changes. Stop Editor Play before coordinated
generation/browser checks: its in-process export can also rewrite these outputs.

Generation then applies `scripts/preserve-native-editor-fog.mjs` to the native
scene only. Editor 5.5.3 drops its saved fog-enable switch, so the adapter maps
disabled fog to Babylon mode0 and keeps the authored mode when enabled. Saved
scene settings and other packed fields remain unchanged. This fixes the
demonstrated distant-building fog failure without overriding unsaved live Editor
settings. The native script separately establishes right-handed coordinates
after parsing, before loading native GLBs.

The original static environment was serialized once into the native editable resource files. No environment generator runs during dev/build; these commands pack the current saved resources. The dev server uses **http://127.0.0.1:5173** with a fixed port. The template's port 3000 was changed after Windows rejected that bind with `EACCES` on the implementation machine.

The scene's `metadata.scripts` attaches `src/scripts/world.ts`. The official loader constructs its default class with the scene, calls `onStart` before the first render, calls `onUpdate` on subsequent frames if present, and calls `onStop` when the scene is disposed or the script is removed. This shares the runtime composition between the browser and the Editor's scene-play pipeline. The native template's `src/App.ts`/`src/main.ts` entry points remain the browser engine entry points.

This demo intentionally uses **meters** for both authored geometry and adapter positions. The stock template and many Editor import defaults use centimeters. Keep authored camera clipping planes and navigation speed at this project's meter scale. If importing a model through the Editor, check the resulting scale: the official glTF import workflow may apply a factor of 100. The runtime model loader must not apply that factor again. No physics simulation is required for this phase.

## Open, edit, save, reopen, run

The native equipment/animation/camera subset has the partial evidence above.
The following courtyard/material sequence remains a separate reproduction and
verification procedure; its complete acceptance is not implied by native Play.

1. Install the official [Babylon.js Editor 5.5.3 release](https://github.com/BabylonJS/Editor/releases/tag/v5.5.3). Install the pinned pnpm version and run `pnpm install` in this repository.
2. In the Editor dashboard choose **Import project**, select `project.bjseditor`, and open the project. Verify that the package manager is pnpm and `assets/example.scene` is the active scene.
3. Inspect the ground, lighting, and camera in the scene graph. Change a visible property, such as the sun's intensity or the ground material color. Record the old and new values.
4. Save the scene, close the project, reopen it, and confirm the value and visible appearance persisted. The Editor may rewrite native JSON and geometry resources; those are the authored source files to review and commit.
5. Use **Play current scene** in the preview toolbar. Confirm six dynamic entities, procedural animations, labels, targeting, the Dev sheet (Dev button), and diagnostics. Stop play and confirm runtime characters are removed from the editing scene.
6. Use **Play project as-is** to run the project's `pnpm dev` command. Alternatively run `pnpm dev` in a terminal. Confirm the saved environment edit is also visible there; both paths export and load the same authored scene.
7. Restore the original value if the edit was only a verification exercise, save again, and rerun the checks.

The official Editor can update `babylonjs-editor-tools` and `babylonjs-editor-cli` to match its own version on project open. Use the matching Editor release and review changes to `package.json` and `pnpm-lock.yaml` after upgrading. The upstream 5.5.3 project runner looks for a capitalized `Ready` output after detecting a localhost URL; the Vite configuration prints that marker after listening. Automatic launch in the desktop Editor remains unverified.

The Editor compiles attached scripts as CommonJS and does not load a generated CSS bundle. HUD styles are therefore injected from `src/ui/worldStyles.ts`, scoped to overlays positioned inside the rendering canvas rectangle, and removed on stop. The Vite page loads the self-hosted heading font; the embedded Editor preview can use the serif fallback. No font or CSS imports enter the attached script bundle.

Official workflow references: [importing a project](https://editor.babylonjs.com/documentation/basics/creating-project), [playing scenes and projects](https://editor.babylonjs.com/documentation/basics/running-project), and [packing scenes with the CLI](https://editor.babylonjs.com/documentation/deploying/babylonjs-editor-cli).

## Official MCP setup

Use the **AI assistant panel included in the matching desktop Editor**. Open this project, select an agent supported by that Editor build, and point the panel at its locally installed executable if necessary. The Editor starts the official bundled MCP implementation and supplies the connection configuration itself. Account authentication belongs in that agent's own sign-in flow; no credentials or machine-specific connection secrets belong in this repository.

This setup is backed by the inspected official [assistant implementation](https://github.com/BabylonJS/Editor/blob/v5.5.3/editor/src/editor/layout/assistant.tsx): it starts a loopback server on an available port with a random token and passes `BABYLONJS_EDITOR_MCP_URL` and `BABYLONJS_EDITOR_MCP_TOKEN` to the bundled stdio MCP server. The runtime browser client does not import, start, or depend on this service.

There are two details that prevent a misleading generic configuration:

- The source package is named `babylonjs-editor-mcp-server`, but its registry lookup returned HTTP 404 during inspection. No package-install or `pnpm dlx` command for that name is recommended.
- The standalone source configuration uses `node mcp/build/src/index.mjs` after an official source build, and defaults to `localhost:3712`. However, the fixed-port initialization is commented out in the inspected Editor 5.5.3 application entry point. Merely writing a localhost configuration does **not** enable an Editor connection. Prefer the built-in assistant's supported configuration instead of assuming that port exists.

Once connected, perform this small authoring verification using actual official tools:

1. Call `get_instructions`, then `get_active_scene` and `get_scene_hierarchy`; record the scene path and authored node names.
2. Call `get_scene_settings`, then use `set_scene_settings` or `set_node_properties` to make the same reversible visible edit described above. Read the changed setting back and inspect the Editor preview.
3. Save using the Editor UI or explicitly request `save_scene`; the official tool presents its own confirmation in the Editor. Reopen and verify persistence.
4. Call `play_scene`, inspect its compile/runtime results, then `inspect_play_scene` and `get_console_logs`. Stop with `stop_scene` before editing again.

The exact tool names and arguments are defined by the official [MCP contract](https://github.com/BabylonJS/Editor/blob/v5.5.3/mcp/mcp-tools-contract.md). No MCP mutation or successful tool invocation is claimed by this document.

## Verification record

| Check | Status | Observed result / reason |
| --- | --- | --- |
| Native Vanilla template, Vite compatibility, pnpm selection, and export paths | **Performed / passed** | Read the upstream template, CLI packer, Editor project loader, runner, and pnpm installer branches at the pinned revision. |
| Scene attachment and native mesh loading path | **Performed / passed (source inspection only)** | Loader handles scene-level script metadata; desktop mesh loader uses Babylon's `.babylon` importer, including normal inline geometry. This is not a desktop round-trip test. |
| Native scene export and saved-property preservation | **Performed / passed** | Two Vitest tests run the real official `pack()` API in temporary fixtures; verify ground geometry, camera/light settings, script attachment, and a Sunlight change to 0.42 surviving repack without changing repository assets. |
| Editor script compiler contract | **Performed / passed (emulation)** | A regression test uses the inspected Editor 5.5.3 esbuild settings/import replacements against the real scene script map, producing only in-memory CommonJS and source-map outputs. An initial CSS/font bundling failure was found and fixed. This is not desktop execution. |
| Desktop availability discovery | **Historical, 2026-11-04** | No installation/process was found then. Editor 5.5.3 was installed and opened on 2026-11-05. |
| Direct connection probe to `127.0.0.1:3712/get_active_scene` | **Performed / failed** | HTTP probe timed out after two seconds. This was only an availability probe, not an MCP invocation. |
| Desktop import/open | **Performed, 2026-11-05** | Actual Dashboard import, courtyard and native-scene editing viewports opened; native project window reopened through Dashboard. |
| Desktop native edit/save/reopen | **Partial / performed, 2026-11-05** | Equipment, exact idle clip, camera radius, no-fog settings and exact actor-material tint/roughness saved and reopened through the UI. Full native shader/world authoring and effect timing remain incomplete. |
| Desktop Play current scene | **Partial / performed, 2026-11-05** | Imported native world, fighter, Musveren and controls rendered after ordinary project-window reopening. Earlier blank repeated-Play/hot-restart failures remain unresolved. |
| Desktop Play project as-is | **Incomplete** | Earlier Dashboard Run regenerated scripts/reloaded the page; this does not establish the separate runner's acceptance. Historical receipt: `artifacts/native-parity/editor/dashboard-run-misclick.json`. |
| Saved desktop edit visible in rebuilt browser | **Performed / passed for the authored subset** | Earlier production run 12/12 passed for saved equipment true, `Wait_1HS_MFighter`, camera radius 4.25 and fog None. Separate later material runs passed 3/3 with the override enabled and 3/3 after disabling it through the UI and rebuilding. The older dev run remains 17/18 because initial courtyard navigation times out at 45 seconds; see the retained logs and verification record. |
| Official MCP implementation/configuration inspection | **Performed / passed** | Read official server, transport, manifest, contract, and integrated assistant configuration; verified the fixed-port startup limitation. |
| Live official MCP authoring interaction | **Not performed** | No Babylon MCP tools are connected. Desktop inspection uses ordinary UI Automation/Win32; official MCP tools invoked: **none**. |

Automated outcomes are recorded in [VERIFICATION.md](VERIFICATION.md); the
desktop sequence and unresolved failures are recorded in
[EDITOR_ROUNDTRIP.md](EDITOR_ROUNDTRIP.md). The passing authored-subset browser
checks do not complete material/effect authoring, resolve the dev cold-load
failure or establish official MCP acceptance.
