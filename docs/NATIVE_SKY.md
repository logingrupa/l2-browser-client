# Native sky

The original `20_20` sky and its environment color tables. The browser shows a frozen source snapshot, not a matched native sky. Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- The sky is a separate final-BSP sky room. `scripts/world/convert_tile.py --map XX_YY --step sky` builds any tile's sky from its one SkyZoneInfo zone into `skies/<hash>/` of the world lane store (20_20: 53 polygons, 182 vertices, 76 triangles, three material chains; its `sky.glb` BIN chunk equals the served sky). Serialized FColor is RGBA.
- `src/scene/world/nativeSkyPresentation.ts` loads the frozen `public/l2/skies/<hash>` 20_20 sky on `/` and the tile sky resource on `/?map=XX_YY`.
- Interim browser policy until VIS-01 and MAT-01 (provisional, owner review): the sky follows the camera, draws first, writes no depth, keeps texture alpha and skips fog. Target: draw the sky zone from SkyZoneInfo when the visibility walk reaches a PF_FakeBackdrop surface.
- `scripts/export-native-environment.py --input-dir <copies> --output <dir>` converts `Env.int` and `timeenv0..3`: 1,681 properties, 20 sky, haze and cloud tables, 500 color rows, anomalies kept. `scripts/stage-native-environment.mjs` stages them for `/l2/environments/<hash>/`.
- The World sheet Sky group can **Load sky color tables**, **Compare selected sky row** and **Restore stored sky**: a reversible row comparison, not time of day.
- `Env.int` sets `IsClock=true`, `StartTime=12`, `TimeRatio=6`. The `timeenv` files are environment types (default, dusk, dawn, cursed sword), not moon phases.
- Tests: `tests/pipeline/test_world_sky_step.py`, `test_native_environment.py`, `tests/unit/nativeSky*.test.ts`, `nativeEnvironment*.test.ts`.

## Open

- Sky for all 153 tiles (WORLD-02): the tile step runs on 20_20 and 20_21 so far.
- Yellow sky and hard blue horizon against L2.exe (CHECK-01, then POL-04). Needs the native writer for color exports 76/77/78 and native draw state.
- Game time, Seven Signs and cursed-weapon red sky come as server packets in emulators; the native consumer is unknown. LATE-01 covers Seven Signs windows only.
- Interpolation, the T=24 wrap, timeenv3 `NUM=1` against 25 rows, duplicate `[HSVTerrainLight]`, sun and moon assets. Interpolation and wrap: MAT-02, anomaly rule recorded as an owner decision; constants confirmed in POL-04.

## Pointers

- Evidence in `artifacts/native-parity/research/`: `native-sky-20261106/`, `sky-environment-conversion-20261107/`, `sky-literal-comparison-20261107/`, `sky-time-events-20261107/`.
- Related: [world](NATIVE_WORLD.md), [asset pipeline](ASSET_PIPELINE.md).
