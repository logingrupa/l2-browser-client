# Native doors and gates

The eight `Engine.Mover` actors of `20_20` become a separate bundle, staged as a `catalog.movers` record and attached after the section loads. Under DEC-OWN-7 the tile-general movers step (plan 02-31) now converts every tile; the served 20_20 bundle stays until the restage. Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- Six leaves use `L2fortress_02_s.Fort02_indoor` with opposing quarter-turn yaw keys. Gates `Mover1` and `Mover24` use `fort02_wall_door` and lift 1.36 m (`KeyPos[1]=(0,0,136)`). Each keeps its mesh, placement, hinge, endpoint and `L2ServerObjectRealID`.
- Endpoints follow `Engine.Mover.BeginPlay`: position = BasePos + KeyPos[KeyNum], rotation = BaseRot + KeyRot[KeyNum]. Recovered defaults: `MoveTime=1.0`, `StayOpenTime=4.0`, `bClosed=true`. `SavedPos` and `SavedRot` are sentinels, never placement.
- `scripts/world/mover_step.py` (`convert_tile.py --step movers`) converts every `Engine.Mover` of a tile into a `native-tile-movers` resource; on 20_20 it yields the eight served movers unchanged. The 20_20 derive and stage scripts are retired (plan 02-31); the served `map-20-20-movers` record stays until the restage.
- `src/scene/world/loadNativeMovers.ts` checks hashes and the terrain binding. `nativeMovers.ts` and `nativeDoorInteractions.ts` handle hover, approach and toggle.
- Browser policy, not native data: 2 m reach, 1.5 m vertical tolerance, 0.8 m stand-off (`browserDoorInteractionPolicy`), no auto-close after `StayOpenTime`. Leaves move over the one-second `MoveTime` and block walking.
- Tests: `tests/pipeline/test_world_mover_step.py`, `tests/unit/nativeTileMoverManifest.test.ts`, `tests/unit/nativeMoverLoader.test.ts`, `nativeDoors.test.ts`, `tests/browser/world-tile-movers.spec.ts`.

## Open

- Door interaction for tile movers (open and close through the runtime) is wired by integration (WORLD-01).
- `ItemSound2.Castle` door sounds are kept, not played (WORLD-02, POL-02).
- Doors toggle locally in the sandbox. Server authority and replication through `GameWorldAdapter`: NET-04.
- `MeshGrade` variants, native glide and encroachment, `RangeDelta[0..3]`. No requirement.
- The genericity audit asks whether to keep the 2 / 1.5 / 0.8 m policy.

## Pointers

- Evidence: `artifacts/native-parity/research/native-door-movers-20261107/` (`converted/`, `STAGING.json`, `REPORT.md`, `browser-run-6/RESULTS.json`).
- Related: [NATIVE_WORLD.md](NATIVE_WORLD.md), [NATIVE_BSP_FLOOR.md](NATIVE_BSP_FLOOR.md), [movement-geodata evidence](parts/movement-geodata/EVIDENCE.md).
