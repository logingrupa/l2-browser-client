# Babylon.js Editor viewer

Babylon.js Editor 5.5.3 is an optional viewer for converted scenes (DEC-OWN-8, NOED-05, VIEW-01 in v2). No test, build step, lane or phase gate depends on it, and an Editor hand edit is never a source of truth. Decisions and work order: [PROJECT.md](../.planning/PROJECT.md) and [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- `pnpm dev` and `pnpm build` run no Editor step; of the old chain they keep only `stage-webgpu-compilers` (NOED-02). The optional `pnpm generate:editor` runs the Editor repair scripts and `babylonjs-editor-cli pack`, which writes `public/scene/*.babylon` and regenerates `src/scripts.ts`.
- `pnpm test:editor` runs `tests/editor/`. `pnpm test:unit` does not.
- `pnpm assets:editor` (`--snapshot-only`, `--from-snapshot`) writes the ignored `assets/native-world.scene`. Same source manifest keeps the scene; a changed one is refused.
- Open `project.bjseditor` through Import project in the Dashboard. Tracked scene: `assets/native-parity.scene`.
- A save drops `isWebGPU`. Run `pnpm renderer:ensure` before reopening.
- `tools/editor-webgpu-compat/` fixes GLSL compiler setup and UV2 at Save and Play. It throws unless Babylon is 9.27.1 and the Editor is 5.5.3 with the pinned writer hash.
- Browser route: `/?authored=1` ([ARCHITECTURE.md](ARCHITECTURE.md)).
- Known Editor defects: blank Play viewport (reopen the project from the Dashboard), Play drops every `BABYLON.ShaderMaterial`, relative texture paths give checkerboard terrain on WebGPU, raw Play reports `scene.isReady()` false while visible. A blank capture is never evidence.

## Open

- `@babylonjs/addons` 9.27.1 and `@recast-navigation/*` 0.43.0 stay only for the Editor's generated script entry. Removing them is an owner decision.
- `assets/native-world.scene` cannot be regenerated from the catalog, so reconversion leaves it stale (VIEW-01).

## Pointers

`tools/editor-webgpu-compat/README.md`, `scripts/ensure-webgpu-project.mjs`, `scripts/native_editor_import.mjs`, `src/scene/authoredNativeWorld.ts`, `src/editor/`, `src/scripts/nativeParity.ts`. Evidence: `artifacts/native-parity/editor/`. Research ratings: [research/INDEX.md](research/INDEX.md).
