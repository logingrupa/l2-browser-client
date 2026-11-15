# Source BSP geometry on 20_20

Some visible geometry lives in the level BSP, not in static meshes. Two pieces come from the final `ULevel.Model` of `maps/20_20.unr`; under DEC-OWN-7 they are now part of one tile-general step. Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- `Brush397` is the floor slab: 10 nodes, 48 vertices, 28 triangles. The hollow `StaticMeshActor940` shell has no floor.
- `Brush610` is the command hall walls, floor and ceiling: 10 nodes, 52 vertices, 32 triangles, doorways kept, separate from the `fort01_command_in` mesh. The oracle `recipes/world/oracle/20_20/expected.json` pins both resources.
- Keep source polygons, normals, projection axes and the original texture; never draw an invented plane. Native XYZ maps to browser XZY x 0.01, winding reflected once. UVs: stored BSP texture base and projection vectors over the original texture size.
- Converters: `scripts/world/bsp_step.py` (visual BSP per chunk) and `scripts/world/collision_step.py` (native-tile-collision). The 20_20 extract and derive scripts were retired by plan 02-30.
- Legacy 20_20 section chain: the runtime loads BSP with the section from the `.l2asset` catalog, at most 4 resources, listed in `src/scene/world/nativeBspResources.ts`.
- The slab and the building's collision-enabled sections join local navigation. Capsule: MFighter radius 9, half-height 23 native units; the cylinder comes from server or profile data. Step height and walkable slope come from the MOVE-01 port (`movement.maxStepHeight` and `movement.minFloorZ` in `recipes/world/movement-native-rules.json`); until then the 0.3 m step and 45 degree slope are browser policy.
- Tests: `tests/pipeline/test_world_bsp_step.py` (the generic 20_20 step holds the Brush397 and Brush610 oracle nodes), `test_world_collision_step.py`, `tests/unit/nativeBspSupport.test.ts`. Real-client cases skip without the conversion client.

## Open

- Whole-level BSP and collision for every tile (WORLD-01, WORLD-08, batch 02-47); the browser collision binding is MOVE-01 (02-48). Geodata: GEO-01.
- BSP zone and portal visibility and translucent BSP order from the tile BSP visibility resource (VIS-01, provisional, owner review).
- Stair turns walked as in L2.exe and the upper-landing roof camera (POL-03). One earlier stair WebGPU device loss has no known cause.
- Lighting and native pixels (CHECK-01, POL-01); lightmaps: MAT-02.

## Pointers

- Evidence in `artifacts/native-parity/research/`: `native-building-floor-20261106/`, `native-building-walls-20261107/`, `native-stair-traversal-20261107/`.
- BSP reader: `scripts/vendor/lineage2elbera_bsp`, see [SOURCE_REUSE.md](SOURCE_REUSE.md).
- Related: [NATIVE_WORLD.md](NATIVE_WORLD.md), [doors](NATIVE_DOOR_MOVERS.md).
