# Editor WebGPU compiler and UV2 compatibility

Scope: this plugin serves the optional Babylon.js Editor viewer only (DEC-OWN-8, NOED-05). `pnpm dev` and `pnpm build` do not need it (NOED-02); see [docs/EDITOR_VIEWER.md](../../docs/EDITOR_VIEWER.md).

This local CommonJS plugin targets Babylon.js Editor 5.5.3's bundled Babylon
9.27.1. The Editor supplies a resolved GLSL compiler object, but Babylon's
`prepareGlslangAndTintAsync()` calls `.then()` on that option. The plugin wraps
the initializer's return value in `Promise.resolve`, preserving the compiler
objects and options for current and future engines.

Plugin loading occurs after dependency installation and can follow scene shader
compilation. Only the exact raw-compiler `TypeError` permits resetting the cached
preparation promise. Once compilers are ready, the plugin retries the existing
incomplete GLSL effects using their retained shader sources. This keeps material
values, meshes, scene identity and readiness observers intact. Other preparation
errors remain rejected and are reported; shader retry failures/timeouts are also
reported. The version check guards the private engine/effect members used here.

The plugin does not save/reload scenes or modify installed Editor files. Removing
it restores the original initializer and geometry writer. It does not select WebGPU or preserve the
project renderer flag; `project.bjseditor` and `pnpm renderer:ensure` handle that.

The project registers this plugin through a local `file:` dev dependency and
`{"nameOrPath":"l2-editor-webgpu-compat"}` in its `plugins` array. Actual Editor
reopening verified WebGPU, initialized compilers and ready GLSL effects. Evidence
is retained in `artifacts/webgpu-migration/editor-webgpu-diagnostics-readonly.json`.

## UV2 at the Save/Play boundary

Babylon 9.27.1 serializes the second UV channel as `uvs2`; Editor 5.5.3's shared
Save/Play binary writer reads `uv2s`. `geometry.cjs` adapts this one spelling on a
shallow copy passed to the installed writer. It preserves the original geometry,
all channel values, the writer's mesh descriptors and packing of later channels.
It accepts matching aliases and rejects conflicting or malformed channels before
the writer touches files. Geometry without UV2 passes through unchanged.

Installation checks both package versions and the exact installed writer's
SHA-256, then replaces only its shared CommonJS export. Both Save and Play call
that export. Closing the plugin restores its own wrapper without overwriting a
later replacement. Upgrading the Editor requires checking the writer again;
this deliberately does not patch installed application files or Babylon's global
serializer. The prior `preserve-native-editor-uv2.mjs` prepack recovery remains
available for historical saves and version/plugin failures.

Focused tests use the hash-pinned installed writer with Babylon's actual geometry
serializer and temporary binary files. Actual Editor receipts are under
`artifacts/native-parity/editor/uv2-export-20261107/`.
