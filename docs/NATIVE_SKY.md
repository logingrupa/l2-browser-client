# Native sky

The original `20_20` sky and its environment color tables. The browser shows a frozen source snapshot, not a matched native sky. Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- The sky is a separate final-BSP sky room. `scripts/world/convert_tile.py --map XX_YY --step sky` builds any tile's sky from its one SkyZoneInfo zone into `skies/<hash>/` of the world lane store (20_20: 53 polygons, 182 vertices, 76 triangles, three material chains; its `sky.glb` BIN chunk equals the served sky). Serialized FColor bytes are B, G, R, A (research Q6 binary-member-order, Core.dll 9462f87a), so `SkybackgroundColor` `ce9600ff` is (0, 150, 206); the served 20_20 sky still holds the earlier R, G, B, A factors until the integration thread restages it. Each sky GLB material pins its material program.
- `src/scene/world/nativeSkyPresentation.ts` loads the frozen `public/l2/skies/<hash>` 20_20 sky on `/` and the tile sky resource on `/?map=XX_YY`.
- On `/?map=XX_YY` the sky binds each pinned program that compiles through the UE2 material library (`src/scene/world/nativeSkyMaterialPrograms.ts`), without fog or depth write. Each frame it writes Color R, G, B (never alpha) of the ColorModifier named by Env.int `SKYBOX`, `HAZERING` and `CLOUD1..3` from the DB-4 time of day (`skyEnvironmentColours.ts`); a name matching two materials is an error. Without staged time tables it reports `library-environment-clock-unwired`.
- Time of day (DB-4, `src/environment/model/`): one manager per world (`worldTimeOfDay.ts`) runs UpdateNTime from `performance.now()`, ChangeEnv, OnSSQInfo, OnRedSky and CalcEnvDelta, and samples the timeenv tables; the 336 DB-4 fixtures recompute (`tests/fixtures/environment/day-night-db4-fixtures.json`, report `fe5de165`). The adapter events `server-time`, `environment-ssq-info` and `environment-red-sky` reach it only from sandbox commands. A missing or old-format export is the visible gap `environment-time-tables-unstaged`.
- Interim browser policy until VIS-01 and MAT-01 (provisional, owner review): the sky follows the camera, draws first, writes no depth, keeps texture alpha and skips fog. Target: draw the sky zone from SkyZoneInfo when the visibility walk reaches a PF_FakeBackdrop surface.
- `scripts/export-native-environment.py --input-dir <copies> --output <dir>` converts `Env.int` and `timeenv0..3` into `time-tables.json` with the native ini rules (case-insensitive keys, repeated sections merged with the last key winning, only `Color|Light|Scale 1..NUM`). `scripts/stage-native-environment.mjs` stages them for `/l2/environments/<hash>/`.
- The World sheet **Time of day** group shows the `env.*`, sky RGB, `sun.theta`, `moon.theta` and `moonScale` variables and sends server time (HH:MM), SSQ info (type and immediate flag) and red sky (timeout) through the adapter.
- `Env.int` sets `IsClock=1`, `StartTime=12`, `TimeRatio=6`, `ShadowTick=0.1`. The `timeenv` files are environment types keyed by their own `EnvType`, not moon phases: 0 is the default, 1 and 2 come only from OnSSQInfo and 3 from OnRedSky. The hour never switches tables, so the sheet names them `EnvType 1` to `EnvType 3`.
- Resolved by DB-4: no T=24 wrap (an hour outside the rows leaves the output unchanged, a window past 24 never settles); timeenv3 SkyBoxColor loads only COLOR1, so type 3 sky is black; the second `[HSVTerrainLight]` wins.
- Tests: `tests/pipeline/test_world_sky_step.py`, `test_native_environment.py`, `tests/unit/nativeSky*.test.ts`, `nativeTimeClock`, `nativeEnvironmentManager`, `sampleNativeTimeTables`, `worldTimeOfDay`, `skyEnvironmentColours`, `timeOfDayGroup`; browser `world-day-night-sky.spec.ts` (needs the restaged export).

## Open

- Sky for all 153 tiles (WORLD-02): the tile step runs on 20_20 and 20_21 so far.
- Yellow sky: the step read ColorModifier bytes as R, G, B, A; fixed on lane/combiner-db1, it clears when the integration thread reconverts. Hard blue horizon against L2.exe (CHECK-01, then POL-04). Needs the native writer for color exports 76/77/78 and native draw state.
- Restage: the served export `e10827c4` has no `time-tables.json`; the integration thread restages it and re-pins `nativeEnvironmentSource`.
- Unresolved, shown by reason: `server-packet-unresolved`, `freeze-producer-unresolved`, `env-color-transition-unresolved`, `frame-composite-unresolved`, `static-mesh-plane-term-unresolved`, `dynamic-light-formula-unresolved`, `local-hour-fog-unresolved`, `relight-routine-unresolved`, `authored-sky-channel-order-unresolved`, `time-scale-read-past-table` (MoonScale from hour 6), `sky-layer-start-colour-unresolved`, the sun and moon direction rotation, and the type 1 to 3 names.
- Only the sky colours reach the screen: ambient, HSV lights, sun and moon, terrain and the dynamic-light gate have no Babylon writer (`environment-lighting-composition-unresolved`). LATE-01 covers Seven Signs windows only.

## Pointers

- Evidence in `artifacts/native-parity/research/`: `native-sky-20261106/`, `sky-environment-conversion-20261107/`, `sky-literal-comparison-20261107/`, `sky-time-events-20261107/`.
- Related: [world](NATIVE_WORLD.md), [asset pipeline](ASSET_PIPELINE.md).
