# Native doors and gates

The eight `Engine.Mover` actors of `20_20` become a separate bundle, staged as a `catalog.movers` record and attached after the section loads. Under DEC-OWN-7 this becomes a tile-general step. Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- Six leaves use `L2fortress_02_s.Fort02_indoor` with opposing quarter-turn yaw keys. Gates `Mover1` and `Mover24` use `fort02_wall_door` and lift 1.36 m (`KeyPos[1]=(0,0,136)`). Each keeps its mesh, placement, hinge, endpoint and `L2ServerObjectRealID`.
- Endpoints follow `Engine.Mover.BeginPlay`: position = BasePos + KeyPos[KeyNum], rotation = BaseRot + KeyRot[KeyNum]. Recovered defaults: `MoveTime=1.0`, `StayOpenTime=4.0`, `bClosed=true`. `SavedPos` and `SavedRot` are sentinels, never placement.
- `scripts/derive-native-map-movers.py --client <inputs> --output <dir>` builds the bundle with `native_map_movers.py`. `scripts/stage-native-movers.py --bundle <dir>` copies it to `public/l2/movers/<descriptorSHA>/` and adds `map-20-20-movers`, bound to the section's terrain hash. Both pin the 20_20 map; main checkout only.
- `src/scene/world/loadNativeMovers.ts` checks hashes and the terrain binding. `nativeMovers.ts` and `nativeDoorInteractions.ts` handle hover, approach and toggle.
- Browser policy, not native data: 2 m reach, 1.5 m vertical tolerance, 0.8 m stand-off (`browserDoorInteractionPolicy`), no auto-close after `StayOpenTime`. Leaves move over the one-second `MoveTime` and block walking.
- Tests: `tests/pipeline/test_native_map_movers.py`, `test_native_mover_stage.py`, `tests/unit/nativeMoverLoader.test.ts`, `nativeDoors.test.ts`. Retained-input cases skip without the private bundle.

## Open

- Movers on every tile (WORLD-01).
- `ItemSound2.Castle` door sounds are kept, not played (WORLD-02, POL-02).
- Doors toggle locally in the sandbox. Server authority and replication through `GameWorldAdapter`: NET-04.
- `MeshGrade` variants, native glide and encroachment, `RangeDelta[0..3]`. No requirement.
- The genericity audit asks whether to keep the 2 / 1.5 / 0.8 m policy.

## Pointers

- Evidence: `artifacts/native-parity/research/native-door-movers-20261107/` (`converted/`, `STAGING.json`, `REPORT.md`, `browser-run-6/RESULTS.json`).
- Related: [NATIVE_WORLD.md](NATIVE_WORLD.md), [NATIVE_BSP_FLOOR.md](NATIVE_BSP_FLOOR.md), [movement-geodata evidence](parts/movement-geodata/EVIDENCE.md).
