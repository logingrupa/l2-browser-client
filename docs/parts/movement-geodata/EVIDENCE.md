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

## Open

Geodata and 547 doors. No geodata files exist on DATABASE-PC; real geodata-backed movement is GEO-01 (v2). Walking converted tiles with terrain collision is WORLD-05. MoveActor and APawn port (MOVE-01) over converted collision, Babylon-free, Lineage2JS as behavioural reference.

- The collision world is not wired into the runtime yet. 02-67 provides the context from the runtime, adds the native slice snapshot field `collisionCells {requiredCellCount, residentCellCount, missingCellIds, revision}` and retires `meshNavigation.ts`, `WorldNavigation.ts` and `syntheticMovement.ts`.
- 02-49 plans the collision ring in metres, converts it through `sourceFrame`, requires and removes cells and feeds `loadCollisionCell`. 02-65 adds the traces over this world.
- No query beyond readiness exists yet; the decoded volumes, triangles, placements, movers and terrain are held for 02-65.

## Evidence

Code: `src/scene/world/movement/core/collisionWorld.ts`, `src/scene/world/movement/core/collisionCell.ts`, `src/scene/world/movement/core/decodeNativeTileCollision.ts`, `src/scene/world/movement/loadCollisionCells.ts`, `src/scene/world/movement/collisionCellContext.ts`, `src/world/WorldNavigation.ts`, `src/world/syntheticMovement.ts`.

Tests: `tests/unit/decodeNativeTileCollision.test.ts`, `tests/unit/collisionWorldCells.test.ts`, `tests/unit/loadCollisionCells.test.ts`, `tests/unit/importBoundaries.movement.test.ts`.
