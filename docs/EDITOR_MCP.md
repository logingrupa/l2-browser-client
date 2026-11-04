# Editor and MCP authoring

This project preserves the native Babylon.js Editor v5 Vanilla workflow. Desktop round-trip compatibility and a live official MCP authoring interaction remain **unverified**. Source inspection, a working browser build, and successful scene packing do not substitute for those checks.

## Versions and sources inspected

Inspection date: 2026-11-04.

| Component | Version / source |
| --- | --- |
| Native template | [BabylonJS/Editor `templates/vanillajs`, v5.5.3](https://github.com/BabylonJS/Editor/tree/v5.5.3/templates/vanillajs) |
| Inspected release revision | `e3fce2cea68c6a32fdbacbb4c5aa4e6a0f154db7` |
| Project format | `project.bjseditor`, serialized format version `5.0.0` |
| Editor runtime tools / packing CLI | `babylonjs-editor-tools@5.5.3` / `babylonjs-editor-cli@5.5.3` |
| Babylon.js | `9.27.1`, matching this template release |
| Native bundler | Vite `7.3.7`; Vite is part of the upstream Vanilla template |
| TypeScript | `7.0.2`, with strict checking added by this project |
| Package manager | `pnpm@10.32.1`, also selected in `project.bjseditor` |
| Automated test tooling | Vitest `5.1.0`, Playwright `1.64.1` |
| Official MCP implementation inspected | [Editor `mcp/`](https://github.com/BabylonJS/Editor/tree/v5.5.3/mcp), package source version `0.1.0`; extension manifest version `1.0.0` |
| Installed desktop Editor | None found in the checked Windows application directories, uninstall registry entries, or running processes |
| Connected Babylon MCP server | None exposed in the available tool inventory |

The CLI and runtime tools are pinned explicitly: the registry's `latest` tag was `5.5.4-alpha.0` during inspection, which would not provide a stable match to the selected desktop release. Use Node.js 22.12 or later; Vite 7.3.7 requires Node `^20.19.0 || >=22.12.0`.

## Editable resources and runtime

Import the root `project.bjseditor` file. Keep `assets/example.scene/`, its `config.json`, and the camera/light/mesh resources in their native locations. Static environment content is stored in these resources and can be changed by the Editor. Dynamic characters are runtime objects supplied through `GameWorldAdapter`.

`pnpm generate` runs the official `babylonjs-editor-cli pack`. It exports `assets/example.scene/` to `public/scene/example.babylon` and regenerates `src/scripts.ts`. The browser loads that export through `babylonjs-editor-tools.loadScene`. Do not edit generated exports or the generated script map as the source of scene changes.

The original static environment was serialized once into the native editable resource files. No environment generator runs during dev/build; these commands pack the current saved resources. The dev server uses **http://127.0.0.1:5173** with a fixed port. The template's port 3000 was changed after Windows rejected that bind with `EACCES` on the implementation machine.

The scene's `metadata.scripts` attaches `src/scripts/world.ts`. The official loader constructs its default class with the scene, calls `onStart` before the first render, calls `onUpdate` on subsequent frames if present, and calls `onStop` when the scene is disposed or the script is removed. This shares the runtime composition between the browser and the Editor's scene-play pipeline. The native template's `src/App.ts`/`src/main.ts` entry points remain the browser engine entry points.

This demo intentionally uses **meters** for both authored geometry and adapter positions. The stock template and many Editor import defaults use centimeters. Keep authored camera clipping planes and navigation speed at this project's meter scale. If importing a model through the Editor, check the resulting scale: the official glTF import workflow may apply a factor of 100. The runtime model loader must not apply that factor again. No physics simulation is required for this phase.

## Open, edit, save, reopen, run

These are reproduction steps, not a claim that they were executed here.

1. Install the official [Babylon.js Editor 5.5.3 release](https://github.com/BabylonJS/Editor/releases/tag/v5.5.3). Install the pinned pnpm version and run `pnpm install` in this repository.
2. In the Editor dashboard choose **Import project**, select `project.bjseditor`, and open the project. Verify that the package manager is pnpm and `assets/example.scene` is the active scene.
3. Inspect the ground, lighting, and camera in the scene graph. Change a visible property, such as the sun's intensity or the ground material color. Record the old and new values.
4. Save the scene, close the project, reopen it, and confirm the value and visible appearance persisted. The Editor may rewrite native JSON and geometry resources; those are the authored source files to review and commit.
5. Use **Play current scene** in the preview toolbar. Confirm six dynamic entities, procedural animations, labels, targeting, demo controls, and diagnostics. Stop play and confirm runtime characters are removed from the editing scene.
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
| Desktop availability discovery | **Performed / passed** | No Babylon Editor installation/process was found in the checked locations; no listener on port 3712 was present. |
| Direct connection probe to `127.0.0.1:3712/get_active_scene` | **Performed / failed** | HTTP probe timed out after two seconds. This was only an availability probe, not an MCP invocation. |
| Desktop import/open | **Not performed** | No installed desktop Editor was available. |
| Desktop environment edit/save/reopen | **Not performed** | Requires the unavailable desktop Editor. |
| Desktop Play current scene / Play project as-is | **Not performed** | Requires the unavailable desktop Editor. |
| Saved desktop edit visible through `pnpm dev` | **Not performed** | No desktop edit/save round trip was performed. |
| Official MCP implementation/configuration inspection | **Performed / passed** | Read official server, transport, manifest, contract, and integrated assistant configuration; verified the fixed-port startup limitation. |
| Live official MCP authoring interaction | **Not performed** | No Babylon MCP tools were connected and no desktop scene was available. Tools actually invoked: **none**. |

Automated runtime/build outcomes are reported separately in the project handoff. Passing them does not change the unperformed desktop or MCP checks above.
