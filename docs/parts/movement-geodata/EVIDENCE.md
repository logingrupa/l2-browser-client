# Movement display and geodata evidence

Part `movement-geodata`, lane `world`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: Synthetic movement over `WorldNavigation`.

Cell-aware collision world (02-48, WORLD-04 and MOVE-01 mechanism, unit level):

- The MOVE-01 collision world (`createCollisionWorld` in `src/scene/world/movement/core/collisionWorld.ts`) holds decoded collision per streaming cell. `requireCell(cellId, footprint)` declares a cell the loader expects, `addCell(cellId, cell)` makes it resident, `removeCell(cellId)` drops its primitives and its requirement in one revision, and `isReady(position)` is false at any point inside the closed footprint of a required cell that is not resident. A footprint edge shared by two cells belongs to both. `inspection()` returns `{requiredCellCount, residentCellCount, missingCellIds, revision}` with `missingCellIds` sorted.
- Cells come only from the 02-30 native-tile-collision resources: the per-chunk `VOLS`, `SMSH`, `PLAC`, `MOVR` and `TERR` groups and the per-map `BSPT` group, read through `src/shared/typedPayload.ts` and decoded by `decodeNativeTileCollisionCell` and `decodeNativeTileBspTree`. Every count, index and code is guarded with a `CollisionWorldError` that names the cell or tile, the group and the field. No mesh, visual LOD level or visibility flag reaches the collision world.
- Footprints, positions and every decoded primitive stay in float32 source units on the UE2 axes inside the core. The player focus is converted from metres with `worldPositionToSource` in `src/world/sourceFrame.ts` at the binding (`collisionFocusSourcePosition`).
- The per-map BSP tree is fetched once per tile, shared by every chunk cell of that tile and released with the tile's last resident cell.
- `loadCollisionCell` in `src/scene/world/movement/loadCollisionCells.ts` fetches the chunk and tile `asset.json` by their SHA-256 pins (and the tile byte count), then `payload.bin` by the payload pin inside `asset.json`, refuses units other than `source`, axes other than `ue2-z-up` and any path outside `/l2/`, and adds the cell to the world with `addCell` in the same tick as the tile tree.
- `provideCollisionCellContext(scene, context)` and `collisionCellContextFor(scene)` hand the world and the player focus to the world loader through a scene-keyed WeakMap; a second provider is refused and the context withdraws on scene dispose.
- `src/scene/world/movement/core/**` imports nothing outside itself except `src/shared/**`, no package, and type-checks against the ES2022 library alone, so no DOM global is reachable.
- No recast, navmesh, Babylon collisions or physics plugin in `src/scene/world/movement` (DEC-OWN-12 D7).

Proof: `pnpm vitest run tests/unit/decodeNativeTileCollision.test.ts tests/unit/collisionWorldCells.test.ts tests/unit/loadCollisionCells.test.ts tests/unit/importBoundaries.movement.test.ts` passes on synthetic payloads written by `tests/support/nativeTileCollisionFixture.ts` (DEC-OWN-12 D3, never client bytes).

Collision traces and MoveActor (02-65, MOVE-01 core over WORLD-08 collision, unit level):

- `moveActor(world, actor, delta, rules, surroundings)` ports ULevel::MoveActor: a float32-rounded delta with every component under `collision.nearZeroDelta` moves without a sweep; otherwise the actor box `(R, R, H)` sweeps the delta lengthened by `collision.moveActorExtension` (2 units), the hit distance minus 2 converts back to the delta, a converted time over 1 is no hit, and the location, time and normal are rounded to float32. The hit carries the primitive (BSP tile, volume, placement, mover, terrain quad or pawn) and its declared source (`bsp-collision-tree`, `blocking-volume`, `static-mesh-slots`, the MOVR `static-slot-enable-collision`, `terrain-heightmap`, `pawn-cylinder`).
- `singleLineCheck(world, query, rules)` is the same sweep without the extension; each primitive backs off by its recipe row (BSP ray 0.5, BSP box `clamp(0.1 L', 0.1, 4)`, static mesh `clamp(0.1 L', 0.1, 1)`, terrain 0.5, pawn 0), the smallest backed-off time wins and ties go to the primitive listed first (tile trees, then per cell volumes, placements, movers, terrain, then pawns).
- BSP trees (BSPT) and brush volumes (VOLS, in world space through the UE2 actor transform) share one tree walk that carries the bRootOutside outside bit. Rays split at node planes and enter the first solid region with the last splitter's normal facing the start; box sweeps collect the hull of the node just left (LeafHulls with the 0x40000000 flip bit and the hull box for BSPT, the path planes and the brush box for volumes) and clip against hull, box and bevel planes.
- Static mesh placements and movers clip triangles against the triangle bounds, both face planes and the edge planes; rays take the double-sided plane hit. Movers collide at the closed matrix unless `moverStates` marks them open. Terrain runs in heightmap space from Location and TerrainScale (the converter's CalcCoords), with lifted triangles, the EdgeTurnBitmap split and QuadVisibilityBitmap 0 dropping the quad (our rule, row `collision.terrainHoles`).
- `pointCheck(world, query, rules)` goes front only when `d > 0` (a point on a plane is back) and stays separate from the visibility zone locate; box point checks walk hulls with the 1.1 push-out. `volumesContaining(world, point, rules)` returns the PhysicsVolumes around a point for the camera environment (02-64) and swimming (02-66).
- Every numeric rule is a row of `recipes/world/movement-native-rules.json` (`{id, value, provenance, status, interludeEvidence, runtimeDefault}`), unconfirmed, ue2-data or unknown, none confirmed; `movement.maxStepHeight` and `movement.minFloorZ` live there for 02-66. POL-04 re-derives each against Interlude Engine.dll `4dd2f63c` before it counts as native.
- Golden traces: `tests/fixtures/movement/move-actor-bsp-wall.golden.json` (five declared moves against a synthetic BSP wall, for example a 300-unit move stopping at x = 241 = 256 - 9 - 4 - 2) and `tests/fixtures/movement/line-check-mixed-primitives.golden.json` (seven declared line checks) compare at 0 float32 ulp; `MOVEMENT_GOLDEN_WRITE=1` rewrites them. All fixtures are synthetic (D3).
- No recast, navmesh, Babylon collisions, physics plugin or rapier: the traces are our own port.

Proof: `pnpm vitest run tests/unit/moveActor.test.ts tests/unit/movementLineCheck.test.ts tests/unit/movementPointCheck.test.ts tests/unit/importBoundaries.movement.test.ts`.

## Open

Geodata and 547 doors. No geodata files exist on DATABASE-PC; real geodata-backed movement is GEO-01 (v2). Walking converted tiles with terrain collision is WORLD-05. MoveActor and APawn port (MOVE-01) over converted collision, Babylon-free, Lineage2JS as behavioural reference.

- The collision world is not wired into the runtime yet. 02-67 provides the context from the runtime, adds the native slice snapshot field `collisionCells {requiredCellCount, residentCellCount, missingCellIds, revision}` and retires `meshNavigation.ts`, `WorldNavigation.ts` and `syntheticMovement.ts`.
- 02-49 plans the collision ring in metres, converts it through `sourceFrame`, requires and removes cells and feeds `loadCollisionCell`.
- Nothing in the runtime calls the traces yet; 02-66 builds the pawn physics and camera on them and 02-67 wires the world.
- Every rules row is unconfirmed until POL-04 reads Interlude Engine.dll `4dd2f63c` (MoveActor, the backoffs, the BSP tolerances and hull offsets, the cylinder and terrain rules).
- Open in the port: the per-tile clip of each BSP tree to its tile rectangle (row `collision.tileClip` in the reference notes, our rule), MoveActor touches and the bStatic, bMovable and trace-filter flags (the converted cells carry no actor flags yet), static mesh kDOP and CollisionModel routing (SMSH carries triangles only), and the water flag, Priority, Gravity and ZoneVelocity of PhysicsVolumes (VOLS does not carry them, so `volumesContaining` returns every containing PhysicsVolume).
- Reference overlap: `node tools/reference-overlap/referenceOverlap.mjs --area movement --reference-root C:/laragon/www/l2-browser-client` reports 83 blocking runs and 2,727 unreviewed reviewer runs in the 02-65 files (2026-11-10 07:13 Riga); no reviewer has signed them off yet.

## Evidence

Code: `src/scene/world/movement/core/collisionWorld.ts`, `src/scene/world/movement/core/collisionCell.ts`, `src/scene/world/movement/core/decodeNativeTileCollision.ts`, `src/scene/world/movement/loadCollisionCells.ts`, `src/scene/world/movement/collisionCellContext.ts`, `src/scene/world/movement/core/moveActor.ts`, `lineCheck.ts`, `pointCheck.ts`, `volumeContainment.ts`, `residentPrimitives.ts`, `bspCollisionTrace.ts`, `convexHullClip.ts`, `volumeTrace.ts`, `staticMeshTrace.ts`, `terrainTrace.ts`, `cylinderTrace.ts`, `collisionTrace.ts`, `movementRules.ts`, `recipes/world/movement-native-rules.json`, `src/world/WorldNavigation.ts`, `src/world/syntheticMovement.ts`.

Tests: `tests/unit/decodeNativeTileCollision.test.ts`, `tests/unit/collisionWorldCells.test.ts`, `tests/unit/loadCollisionCells.test.ts`, `tests/unit/importBoundaries.movement.test.ts`, `tests/unit/moveActor.test.ts`, `tests/unit/movementLineCheck.test.ts`, `tests/unit/movementPointCheck.test.ts`, `tests/fixtures/movement/`.
