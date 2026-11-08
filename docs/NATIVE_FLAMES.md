# Native flames

Source-formula preview of `FX_E_S.Flameset.Default_Flame01` at its twelve `20_20` placements, loaded from the `.l2asset` catalog on the native route `/?world=interlude`. Output is unlit; native lighting, clock sync and visual parity are unverified. Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- The loader checks the section archive's length and hash, the model identity and the twelve declared placements before binding. Corrupt or unsupported effect data keeps the valid world and original materials and shows a status message.
- Placements bind through retained material `gltf.extras` and source placement metadata, never by mesh name.
- Recovered blend factors: flame `ONE / ONE_MINUS_SRC_COLOR`, glow `ONE / ONE`, depth writes off. Never call the result native lighting.
- Texture and fade clocks start at 0 with rate 1 (`src/runtime/nativeSandboxConfiguration.ts`), advance on the uncapped engine frame delta and pause with the local adapter.
- Dev > World > Flames > Inspect flame cycles the placements; Follow fighter returns. With the adapter paused, `window.__nativeSlice.setFlameReplay({ textureSeconds, fadeSeconds })` seeks each clock.
- `tests/browser/nativeFlame.spec.ts` checks 24 active bindings, 17 textures, unlit output and texture frame 6 at 0.21 s. It skips when `public/l2/catalog.json` is missing. Evidence: `artifacts/native-parity/research/flame-runtime/`.

## Open

- Native lighting: live light eligibility, color branch, level scalar, ambient and dynamic-light inputs, renderer path (POL-04). `flame-runtime/lighting-followup/` recovers point-light radius, intensity and color for the thirty source lights.
- Clock and camera equivalence, filtering, color space, fog, draw order and matched screenshots (CHECK-01, POL-04).
- Flames on tiles other than `20_20` (WORLD-01, ACT-06).
- Performance acceptance (PERF-01).

## Pointers

- Code: `src/scene/world/nativeFlame*.ts`, `src/runtime/loadNativeSliceWorld.ts`.
- Tests: `tests/unit/nativeFlame*.test.ts`, `tests/browser/nativeFlame.spec.ts`.
- Related: [NATIVE_TEXTURES.md](NATIVE_TEXTURES.md), [NATIVE_WORLD.md](NATIVE_WORLD.md), [research index](research/INDEX.md).
