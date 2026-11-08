# Babylon.js Editor viewer

The Babylon.js Editor is an optional viewer (DEC-OWN-8, NOED-05, VIEW-01 v2).
Babylon.js stays the engine. The world comes from the original client plus the converter, through the `.l2asset` catalog.
No test, build step, lane or phase gate depends on the Editor.
Status and order live in [.planning/STATE.md](../.planning/STATE.md) and [.planning/ROADMAP.md](../.planning/ROADMAP.md).
The evidence index is [VERIFICATION.md](VERIFICATION.md).

## What it is for

- Looking at converted scenes in Editor 5.5.3 to inspect nodes, materials and transforms.
- Nothing more. An Editor hand edit is lost on reconversion or is an invented change, so it is never a source of truth.
- Sandbox settings (player profile, clips, material override) move to typed config on the sandbox sheet (NOED-01).
- Babylon Inspector behind `?inspect=1` is the in-sandbox inspection tool (NOED-04).

## How to open

1. Open `project.bjseditor` in Babylon.js Editor 5.5.3. It sets `isWebGPU: true` and loads the `l2-editor-webgpu-compat` plugin.
2. Open a scene:
   - `assets/native-world.scene`: the 20_20 map section as saved terrain and scenery. Actors stay runtime objects.
   - `assets/native-parity.scene`: the inspection scene (119 meshes).
3. Stop Play before source edits, CLI generation or browser checks.

Commands that exist today in `package.json`:

- `pnpm assets:editor` runs `scripts/native_editor_import.mjs` and writes `assets/native-world.scene`. `--snapshot-only` and `--from-snapshot` split capture from scene writing.
- `pnpm renderer:ensure` restores the project WebGPU flag, which an Editor save drops.
- `pnpm generate` runs the Editor repair scripts and `babylonjs-editor-cli pack`. Today `pnpm dev` and `pnpm build` call it. NOED-02 moves it to an optional `pnpm generate:editor`, which does not exist yet.

The authored browser route is `/?world=interlude&authored=1`. NOED-01 keeps it reachable only by a dynamic import.

Rules for `pnpm assets:editor`:

- A rerun with the same source manifest preserves the scene. A changed manifest refuses to replace it.
- There is no merge of changed source geometry with authored changes. Do not rerun it over a changed authored scene; use the explicit migration commands in `artifacts/native-parity/research/terrain-uv-migration-20261106/implementation/REPORT.md`.
- Keep `assets/native-world.scene.native-editor-channels.json` beside the scene folder. The Editor deletes unknown files inside scene folders.

## The editor-webgpu-compat plugin

`tools/editor-webgpu-compat/` is a local CommonJS plugin, registered as a `file:` dev dependency and in the `plugins` array of `project.bjseditor`.

- Compiler fix: wraps Babylon's GLSL initializer in `Promise.resolve`, then retries waiting GLSL effects.
- UV2 fix: Babylon 9.27.1 serializes `uvs2`; the Editor 5.5.3 Save/Play binary writer reads `uv2s`. `geometry.cjs` adapts the spelling on a copy. Installed Editor files and Babylon's serializer are not patched.
- `scripts/preserve-native-editor-uv2.mjs` recovers UV2 for older saves and for version or plugin failures.

Version gate. Review on every Babylon or Editor upgrade:

- `index.cjs` throws unless `WebGPUEngine.Version` is `9.27.1`.
- `geometry.cjs` throws unless the Editor is `5.5.3`, Babylon is `9.27.1` and the writer SHA-256 is `1b86dac8db1685491e703a1984b60b923478d551df47ec2a36cd39c648aa5a06`.

## Known defects

- **Blank Play viewport.** Repeated Play/Stop, source changes during a session, hot restart or scene switching can leave the viewport blank, also in authoring mode. The cause is unknown. Reopening the scene does not help. Close the project window normally, return to the Dashboard and reopen the project. Blank captures never count as evidence.
- **Raw Play readiness and UV2.** Raw Play reports `scene.isReady()` false while output is visible. Without the compat plugin, Save and raw Play drop terrain UV2 (4,704 float32 values, 18,816 bytes) and raw Play overwrites public output. With the plugin, Save and raw Play in an isolated copy preserve every channel of both terrain meshes. After direct Play, run `pnpm generate` with Play stopped and check the generated references.
- **Play drops materials and fog.** Play removes every `BABYLON.ShaderMaterial`; the client recovers only an omitted terrain material from the live authoring scene. Play bypasses the post-pack fog fix; keep fog mode None.
- **WebGPU textures.** Relative texture path rewriting and the WebGL-only texture hook give checkerboard terrain on WebGPU. The client uses the absolute authoring texture root.
- **Serialization side effects.** A save changes PBR `maxSimultaneousLights` from 4 to 8 (413 materials), resets 20 inactive overlay settings, removes unused geometry paths and the thumbnail, renames resources and moves geometry into `.babylonbinarymeshdata`. Audits match intrinsic identities, not filenames.
- **Color3 script fields.** They show new values but serialize `[1,1,1]` (missing finish callback). Use Vector3 text fields and finish with Enter or a click on another field.
- **Proxy-material ID collision.** The clustered-light `ProxyMaterial` and imported Tree bark share unique ID 8. The Editor disposes Tree bark and serializes the proxy. `scripts/validate-editor-materials.mjs` rejects the `ShaderMaterial` / `lightProxy` signature; restore affected records from a verified copy.
- **Frozen world scene.** `assets/native-world.scene` holds the 20_20 selection at 157 placements / 62 models. Tile-general reconversion makes it stale, and `pnpm assets:editor` refuses a changed manifest.

## Client code that exists for the Editor

NOED-01 and NOED-02 decide what of this stays.

- `registerGLTFExtension` uses the `GLTF2` namespace, which works under the Editor UMD and the browser ESM.
- `/l2/...` fetches are adapted under the open project's `public` directory during Play.
- Input, HUD and labels use Babylon's input canvas, because the Editor renders through a detached working canvas.
- The authored route reflects Z at the scene root for the Editor's left-handed viewport and keeps source matrices.
- The authored route enables full incremental loading while parsing, then restores it. It does not fetch the map GLBs a second time.
- `package.json` pins `@babylonjs/addons` 9.27.1 and `@recast-navigation/core` / `generators` 0.43.0 only because the desktop Editor's generated script entry imports plugins that CLI pack omits.

## Open

- Upstream Editor reports for the Color3 callback and the proxy-material ID collision are not filed.
- The Addons 9.27.1 / Recast 0.43.0 pins become removable once NOED-02 takes the generated entry out of the default build.
- `native-world.scene` has no regenerate-from-catalog path.
- The serialization side effects are recorded, not corrected.
- An example-scene save lost Meadow/Sunlight and replaced a pine material; the cause is unproven (moot if NOED-03 retires the courtyard).
- A separate dev cold-load delay is open.

## Evidence

- `artifacts/native-parity/editor/uv2-export-20261107/REPORT.md`
- `artifacts/native-parity/editor/play-viewport-20261106/REPORT.md`
- `artifacts/native-parity/editor/sky-save-20261106/REPORT.md`
- `artifacts/native-parity/editor/world-import/`
- `artifacts/native-parity/editor/flame-authoring/`
- `artifacts/native-parity/editor/material-authoring-20261105/`
- `artifacts/native-parity/research/editor-color-authoring/README.md`
- `artifacts/native-parity/research/editor-proxy-material/README.md`
- `artifacts/native-parity/research/editor-plugin-dependencies/README.md`
- `artifacts/native-parity/research/editor-viewport/`
- `artifacts/native-parity/research/weapon-attachment/editor-loader-registration/`
- `artifacts/webgpu-migration/editor-webgpu-diagnostics-readonly.json`
