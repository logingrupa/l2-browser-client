# Native sky

The original `20_20` sky and its environment color tables. The browser shows a frozen source snapshot, not a matched native sky. Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- The sky is a separate final-BSP sky room: 53 polygons, 182 vertices, 76 triangles, three material chains. `scripts/native_sky.py --client <inputs> --output <dir>` reads it from hash-pinned `20_20.unr`, `Engine.u` and `l2_skies.utx`. Serialized FColor is RGBA.
- `scripts/stage-native-sky.mjs --source <snapshot> --apply` writes immutable `public/l2/skies/<hash>`; without `--apply` it is a dry run. `src/scene/world/nativeSkyPresentation.ts` loads it on `/?world=interlude`.
- Browser policy, not native rules: the sky follows the camera, draws first, writes no depth, keeps texture alpha and skips fog.
- `scripts/export-native-environment.py --input-dir <copies> --output <dir>` converts `Env.int` and `timeenv0..3`: 1,681 properties, 20 sky, haze and cloud tables, 500 color rows, anomalies kept. `scripts/stage-native-environment.mjs` stages them for `/l2/environments/<hash>/`.
- The World sheet Sky group can **Load sky color tables**, **Compare selected sky row** and **Restore stored sky**: a reversible row comparison, not time of day.
- `Env.int` sets `IsClock=true`, `StartTime=12`, `TimeRatio=6`. The `timeenv` files are environment types (default, dusk, dawn, cursed sword), not moon phases.
- Tests: `tests/pipeline/test_native_sky.py`, `test_native_environment.py`, `tests/unit/nativeSky*.test.ts`, `nativeEnvironment*.test.ts`.

## Open

- Sky for all 153 tiles (WORLD-02); `native_sky.py` pins the 20_20 map.
- Yellow sky and hard blue horizon against L2.exe (CHECK-01, then POL-04). Needs the native writer for color exports 76/77/78 and native draw state.
- `stage-native-sky.mjs` reads and writes the generated Editor scene `assets/native-world.scene` (NOED-05).
- Game time, Seven Signs and cursed-weapon red sky come as server packets in emulators; the native consumer is unknown. LATE-01 covers Seven Signs windows only.
- Interpolation, the T=24 wrap, timeenv3 `NUM=1` against 25 rows, duplicate `[HSVTerrainLight]`, sun and moon assets. No requirement.

## Pointers

- Evidence in `artifacts/native-parity/research/`: `native-sky-20261106/`, `sky-environment-conversion-20261107/`, `sky-literal-comparison-20261107/`, `sky-time-events-20261107/`.
- Related: [world](NATIVE_WORLD.md), [asset pipeline](ASSET_PIPELINE.md).
