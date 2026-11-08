# UE2 pawn movement and collision

> Reference notes, not decisions. `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md` win where they differ. IDs marked "(proposed)" belong to `plan/autonomous-roadmap` and are not in force until that branch adopts them. Constants with status `unconfirmed` come from C4 binaries and only become native rules after they are re-derived against Interlude. The clean-room, no-vendor and shared-module rules are in [README.md](README.md).

Reference notes for our own port of the client half of Lineage II movement: the UE2 collision queries behind ULevel::MoveActor (BSP trees, brush volumes, static mesh triangles, terrain heightmaps, pawn cylinders), the APawn physics that walk, step, fall, swim and fly a pawn toward a server goal, the CalcBehindView camera hit check, the click trace, and the client's move requests and position reports. Lineage2JS is a behavioural reference. It runs the chain as plain math over its own collision world and never queries its Rapier world. Our Babylon-free core runs in source units under `src/scene/world/movement/core/`, fed by the native-tile-collision resource, and the server stays authoritative. Lineage2JS constants come from the C4 Engine.dll (`fa3f0f2a...`). Phase 2 runs them as unconfirmed defaults, and Phase 5 (POL-04) re-derives them against the Interlude Engine.dll (`4dd2f63c...`).

## Where it fits

- Requirements: MOVE-01 (proposed), MOVE-02 (proposed), `WORLD-03`, `WORLD-04`, `WORLD-05`, WORLD-08 (plan/autonomous-roadmap, provisional), `ARCH-01`, `ARCH-02`, `ARCH-03`, `ARCH-04`, `NET-04`, NET-10 (proposed, 05-network.md), `CHECK-01`, `CHECK-03`, `POL-03`, `POL-04`, GEO-01 (v2, deferred)
- Phase: Phase 2: the collision resource, the core and sandbox walking (MOVE-01, WORLD-05, WORLD-08) on unconfirmed reference values. Phase 3: side-by-side traversal and camera checks against L2.exe on IMPORTA-PC (CHECK-01, CHECK-03). Phase 4: MOVE-02 packets and corrections on Mobius (NET-04). Phase 5: static re-derivation of every movement constant (POL-04) and POL-03 parity on 20_20.
- Lane: World lane, part movement-geodata: the core, its Babylon glue, the collision converter steps, the rules file, the collision gap reasons, the evidence, and the MOVE-02 reporter and record application. Integration: the shared modules, `src/world/worldTypes.ts`, `src/world/NativeSliceAdapter.ts`, `src/runtime/**`, `src/entities/EntityRegistry.ts`, `src/camera/WorldCamera.ts`, package.json and, in Phase 4, the movement packet mapping in `src/world/mobius/**` ([05-network.md](05-network.md)). Actors: the footstep consumer in `src/audio/**`.

Owned paths:

- `src/scene/world/movement/core/** (Babylon-free core)`
- `src/scene/world/movement/*.ts (Babylon glue)`
- `scripts/world/collision_step.py`
- `scripts/world/collision_bsp.py`
- `scripts/world/collision_static.py`
- `scripts/world/collision_terrain.py`
- `recipes/world/movement-native-rules.json`
- `recipes/world/collision-declaration-rules.json`
- `recipes/world/gap-reasons.json (collision-* rows)`
- `docs/parts/movement-geodata/**`
- `tests/unit/movement/** (shared tests folder)`
- `tests/unit/importBoundaries.movement.test.ts (shared tests folder)`
- `tests/fixtures/movement/** (shared tests folder, synthetic only)`
- `tests/pipeline/test_world_collision_*.py (shared tests folder)`
- `tests/browser/world-movement.spec.ts (shared tests folder)`

## What the reference shows

| Topic | Where | What it shows |
|---|---|---|
| MoveActor and SingleLineCheck | `lineage2js/src/physics/collision-world.ts:39-48, 348-370, 893-907, 1024-1084, 1109-1191, 1502-1511`, `lineage2js/src/physics/physics-manager.ts:195-266` | Near-zero skip, 2-unit extension, backoff per kind, tie order, bStatic refusal. |
| Skip and blocking filters | `lineage2js/src/physics/collision-world.ts:678-696, 1295-1385`, `lineage2js/src/physics/components/pawn-movement-component.ts:1192-1238` | ShouldTrace, IsBlockedBy (touches only, 678), TRACE_World, ignore-pawns. |
| BSP collision model | `lineage2js/src/physics/collision-model.ts:5-55`, `lineage2js/src/assets/unreal/bsp/un-bsp-node.ts:25-34, 122-128`, `lineage2js/src/assets/unreal/model/un-model.ts:156-165, 337-374` | IsCsg, LeafHulls runs, the 64-plane limit, hull box planes. |
| BSP queries | `lineage2js/src/physics/collision-primitive.ts:80-131, 871-910, 962-1137, 1180-1246` | Outside-bit walk, ray split, push-out, hull clipping, bevels. |
| Brush volumes | `lineage2js/src/assets/unreal/un-volume.ts:47-94`, `lineage2js/src/physics/collision-primitive.ts:912-953` | Transformed planes and hull boxes, simple collision routing. |
| Static mesh collision | `lineage2js/src/physics/collision-primitive.ts:133-235, 390-607, 840-869, 1154-1178, 1248-1255`, `lineage2js/src/assets/unreal/static-mesh/un-static-mesh-collision.ts:3-104`, `lineage2js/src/assets/unreal/static-mesh/un-static-mesh.ts:166-185`, `lineage2js/src/assets/unreal/static-mesh/un-static-mesh-actor.ts:175-188` | kDOP walk, triangle tests, record layout, both serialization layouts. |
| Terrain | `lineage2js/src/physics/collision-primitive.ts:237-283, 609-671`, `lineage2js/src/assets/unreal/un-terrain-info.ts:299-309, 670-705`, `lineage2js/src/objects/terrain.ts:105-127` | Diagonal choice, lifted triangle test, render-geometry triangles. |
| Pawn cylinder | `lineage2js/src/physics/collision-primitive.ts:703-804, 1139-1152`, `lineage2js/src/physics/components/pawn-movement-component.ts:225-238` | Widened cylinder, inward rule, offset, centre at foot plus H. |
| APawn tick and modes | `lineage2js/src/physics/components/pawn-movement-component.ts:70-96, 252-290, 348-481, 569-666, 754-889, 921-1190, 1240-1286, 1975-2006` | Constants, substeps, walking, stepUp, falling, swimming, flying, yaw. |
| Speed and corrections | `lineage2js/src/physics/components/pawn-movement-component.ts:1598-1676, 1739-1833`, `lineage2js/src/network/network-movement.ts:56-242` | GetCurSpeed, correction terms, ValidateLocation, teleport, floor search. |
| Placement, volumes and touches | `lineage2js/src/physics/physics-manager.ts:310-389`, `lineage2js/src/physics/collision-world.ts:372-474`, `lineage2js/src/physics/volume-bsp.ts:9-81`, `lineage2js/src/physics/components/pawn-movement-component.ts:508-542` | findSpot, encroachment, based actors, volume Priority, water crossing. |
| Client reports and opcodes | `lineage2js/src/network/network-manager.ts:30-36, 313-322, 1372-1407`, `lineage2js/src/network/game-client.ts:233-243`, `lineage2js/src/network/game-packets.ts:46, 80, 99, 123-126, 300-352`, `mobius/gameserver/network/clientpackets/MoveToLocation.java:49-55` | Report cadence, stuck rule, field rounding, opcodes, move mode. |
| Click trace and camera | `lineage2js/src/game/input-manager.ts:150-160, 357-392, 512-533, 704-773, 812-819, 877-910`, `lineage2js/src/rendering/camera/behind-view-camera.ts:16-77`, `lineage2js/src/player.ts:18-23`, `lineage2js/src/assets/unreal/utils/rotator.ts:72-77`, `lineage2js/src/assets/unreal/conf-files/un-conf-system.ts:50-54, 141-185` | Click order, both CalcBehindView branches, sine table, zoom, l2.ini keys. |
| Rapier and readiness | `lineage2js/src/physics/physics-manager.ts:61, 76-102, 618-630`, `lineage2js/src/objects/bsp-collider.ts:40-89`, `lineage2js/src/rendering/render-manager.ts:1133-1137`, `lineage2js/src/physics/components/pawn-movement-component.ts:201-211` | Rapier never queried; pawns hold until sector collision is ready. |

## Behaviour to implement

### Frame, units and precision

Collision and pawn state use source units (about 1 cm) on UE2 axes, Z up. Only `src/world/sourceFrame.ts` converts to the browser frame (metres, right-handed, Y up): `world = (x, z, y) * 0.01`, `source = (X, Z, Y) * 100`, rotations conjugated by the same reflection.

Location is the cylinder centre, with radius `R` (CollisionRadius) and half-height `H` (CollisionHeight), so the feet sit at `z - H`. Lineage2JS stores feet, adds `H` for queries, the camera pivot and the waterline probe, and reads protocol positions as feet (unconfirmed).

Location, Velocity, Acceleration, speeds, MoveTimer and the correction timers are float32: `Math.fround` on every write, float64 in between, mismatches logged by rule id. Rotators are integers masked to 65536 per turn. A heading is `round(atan2(dy, dx) * 32768 / pi) & 65535`, 0 along +X and 16384 along +Y.

### Query contract and world filter

Primitives answer a line check `(start, end, extent) -> first hit {t in [0, 1], normal, item}` and a point check `(centre, extent) -> overlap or none`. Pawn boxes have extent `(R, R, H)` and rays zero. World geometry tests the axis-aligned box; pawns are cylinders.

Our own broad phase gathers candidates and skips one that:
1. is the source, is in its ignore set (actors it spawned inside, released once clear) or, for non-level actors, is in its Owner chain;
2. is pending deletion, a pawn without bCollideActors or with a dead controller, the source's controller, or a loading pawn;
3. is a CanBeIngnoredCollision pawn and the source has CanIngnoreCollision;
4. is a non-pawn facing a bOnlyAffectPawns source, or has bOnlyAffectPawns and faces a non-pawn source;
5. is a mover with DamageGrade 6;
6. is a pawn without bAsTreatWorld in a query that ignores pawns. Lineage2JS ignores pawns for every pawn except the local player.

Survivors need bBlockZeroExtentTraces for rays or bBlockNonZeroExtentTraces for boxes, and StaticMeshActors also need bCollideActors. World geometry (level BSP, terrain, bWorldGeometry actors) blocks bCollideWorld sources. Other actors block when both have bCollideActors and each blocks the other's kind (bBlockPlayers for pawns, else bBlockActors). Under TRACE_World a pawn blocks only with bAsTreatWorld, movers always block, and other actors block only as world geometry. AActor::IsBlockedBy, with its player-pawn and Projectile cases, filters touches only.

Hits back off to `t' = max(0, t - b / L')`, with `L'` the test distance. The smallest `t'` wins, and ties go to the entry registered first.

| Primitive | Ray `b` | Box `b` |
|---|---|---|
| BSP and simple collision model | 0.5 | `clamp(0.1 L', 0.1, 4)` |
| Static mesh triangles | `clamp(0.1 L', 0.1, 1)` | same |
| Terrain | 0.5 | 0.5 |
| Pawn cylinder | 0 | 0 |

### MoveActor

1. Refuse bStatic or non-bMovable actors.
2. Add the float32-rounded delta without a sweep when each component is under `1e-4` after rounding, when the caller ignores collision, or when the source lacks both bCollideActors and bCollideWorld.
3. Otherwise sweep the delta lengthened by 2 along itself, so `L' = L + 2`.
4. Convert the best time: `d = t' L'`, then `t = (d - 2) / L` when `d > 2`, else 0. A converted `t > 1` is no hit.
5. Move to `start + delta t`, or by the whole delta when nothing blocks.
6. Non-world actors and volumes hit before the blocking time become touches. Afterwards, end touches that no longer overlap and refresh the physics and head volumes.

SingleLineCheck is the same sweep with `L' = L`, and it moves nothing.

### BSP solidity

Each Level.Model node has its stored FPlane (`d(p) = n . p - w`), front and back children (-1 for none) and a csg bit: `NumVertices > 0` and NodeFlags without NF_NotCsg (0x01) or NF_IsNew (0x20). iPlane is the coplanar link, not the plane. A walk carries an outside bit `o` that starts at bRootOutside. The front child sets `o = o or csg`, and the back child sets `o = o and not csg`. A missing child reached with `o` false is solid. PolyFlags stay diagnostic.

### BSP ray check

At each node the segment is in front when both endpoint distances exceed -0.001, behind when both are below 0.001, and otherwise splits at the plane. The start's side resolves first. The far part is walked only if the near part is clear, and that node becomes the last splitter. The hit is the entry into the first solid region, with the last splitter's normal facing the start and `t = (hit - s) . (e - s) / |e - s|^2`.

### BSP box sweep and leaf hulls

Walks widen each plane by `p = 1.1 (|n_x e_x| + |n_y e_y| + |n_z e_z|)`. They visit the front child if either endpoint has `d >= -p` and the back child if either has `d <= p`, the start's side first. A missing child in solid space yields the hull of the node just left (its iCollisionBound); a node without one adds nothing.

At iCollisionBound, LeafHulls lists plane references (a node index; bit 0x40000000 flips the plane) up to a negative terminator, then six int32 words holding the hull box floats (min x, y, z, then max). A hull has fewer than 64 planes.

Clip the swept box, in order, against:
1. the hull planes;
2. six box planes, with z min, z max, x min and y min out by 0.1 and x max and y max in by 0.1, as in Lineage2JS;
3. bevels for hull plane pairs `a`, `b` with opposite normal signs on an axis A, kept when `(A x n_a) . (A x n_b) > 0.001` and `|n_a x n_b|^2 >= 1e-6`. A bevel passes through the `a`-`b` line with normal `normalize(A x (n_a x n_b))`, flipped to a non-negative dot with `n_a`.

Clipping uses the unscaled push-out `q`. Per plane `a = d(s) - q`, zeroed when the segment moves toward the plane (`d(s) > d(e)`) from inside its band (`0 <= d(s) < q`). Entering planes raise `t_in` to `a / (d(s) - d(e))` and set the normal; leaving planes lower `t_out` to that ratio. A parallel segment (`|d(s) - d(e)| <= 1e-5`) with both distances above `q` misses. Starting from `t_in = -1` and `t_out` at the best time, a hull hits when `-1 < t_in < t_out` and `t_out > 0`. The smallest `t_in` wins.

### BSP point checks and volumes

Box point checks walk with the 1.1 push-out: front if `d > -p`, always the back child, and stop after the front if `d > p`. A solid region overlaps when every hull, box and bevel plane gives `q - d > 0`. The zero-extent check is one descent, front if `d > 0`, and ending in solid space is an overlap. Volume containment uses it.

This PointCheck and the zone locate in [02-bsp-visibility.md](02-bsp-visibility.md) (`PlaneDot >= 0` goes front) are separate native routines with separate fixtures, never merged without Interlude evidence. The S1 census there writes a gap row where they disagree.

BlockingVolumes, PhysicsVolumes and static mesh CollisionModels use the same tree code with world-space planes. Normals go through the inverse-transpose of localToWorld (Location, Rotation, DrawScale, DrawScale3D, PrePivot) and are renormalised, and plane constants come from transformed plane points. Hull boxes come from 8 transformed corners, and box planes are built locally, then transformed. UseSimpleLineCollision routes rays to the CollisionModel; UseSimpleBoxCollision routes box sweeps and box point checks.

### Static mesh collision

A collision triangle holds a 64-byte block (likely the face plane and three side planes), three compact vertex indices and a compact material index. Lineage2JS reverses the indices to (v2, v1, v0), saying this matches the stored plane. A kDOP node holds compact triangle, coplanar, child 0 and child 1 indices, a float AABB and a valid byte.

A query moves the segment to mesh space with extent `|M^-1| e`. From node 0 it skips nodes whose grown AABB the segment misses within `[0, best t]`. Against the node triangle's plane with push-out, wholly behind goes to child 0 and wholly in front to child 1. A straddle visits the start's child, the coplanar chain, the node's triangle, then the other child.

Candidates are tested in world space with the world extent. A box clips against up to 17 planes: the 6 planes of the triangle's bounds, the triangle plane both ways, and per edge one plane per axis the edge is not parallel to (through the edge, along the axis, facing inward). It needs `0 <= t_in <= best t`, so a start inside misses. A ray takes the exact plane hit and three edge-side tests; it is double-sided, with the normal facing the ray. Box point checks test every triangle with the same planes. A mesh without kDOP nodes needs the same answers by another walk.

### Terrain

Vertices are `toWorld(x, y, height(x, y))` in float32. A quad's bitmap bit is `x + y * heightmapX` at its low corner. EdgeTurnBitmap set gives the triangles (c00, c10, c01) and (c01, c10, c11); clear gives (c00, c10, c11) and (c00, c11, c01). QuadVisibilityBitmap 0 dropping collision is our rule.

Queries run in terrain local space with a transformed extent. Triangles are lifted by `e_z` with normals turned up, and only motion with `n . d < -0.0001` hits. A ray accepts the plane point with 2D edge tests. A box accepts it when every edge gives `(edge x n) . (p - v) <= e_x` with the unnormalised edge, a slack of `e_x / |edge|`. A box point check is a vertical segment from `z + e_z` to `z - e_z` with extent `(e_x, e_y, 0)`. Cells are walked nearest first until the next one starts after the best hit.

### Pawn cylinder

Widen the radius by `e_x` and the half-height by `e_z`; the AABB reject uses `e_y` on Y. Clip `t` by the caps, then solve `|s_xy + t d_xy - c_xy|^2 = r^2` for the side, with a radial normal. A start inside (`|s_xy - c_xy|^2 - r^2 < 1`, between the caps) returns `t = 0` with a radial normal only when it moves inward (`d_xy . (s_xy - c_xy) < -0.1`), and misses otherwise. Return `clamp(t - 0.001, 0, 1)`. The point check is a plain widened overlap.

### Pawn tick

Frame `dt` comes from `src/shared/presentationClock.ts`, capped at 0.4 s, with at most 8 iterations. After the first tick walking takes the whole remainder; other modes take it if it is at most 0.05 s, else `min(0.05, rest / 2)`. Inside walking the local player splits again into `min(0.05, rest / 2)` while over 0.05 s remains, sharing the budget. Falling and swimming stop below 0.0003 s or after 7 nested calls.

Each iteration updates the correction timer, rides a moving base, releases ignored actors it no longer overlaps, applies a pending floor adjustment, computes velocity, runs the mode, checks arrival, turns and refreshes the volumes. Physics is skipped with bIgnorePhysics, without a PhysicsVolume, in observer mode, or while the pawn's cell is not ready.

Velocity is `dir min(speed, max(0, (distance - offset) / dt))`, with no ramp. Distance is 2D when walking and 3D when swimming or flying. AccelRate only sets the direction. Arrival is within `offset + 0.01`.

### Walking

Each substep:
1. Move by `v_xy tick` with MoveActor; on a hit, run stepUp with the rest.
2. Probe the floor with a SingleLineCheck of the pawn box 12 units down (MAXSTEPHEIGHT + 2), without the MoveActor extension.
3. On a walkable hit (`n_z >= 0.7`) the gap is `f = 12 t`. Move down by `f - 2.15` if `f > 2.4` and up by `2.15 - f` if `0 < f < 1.9`. In the band on the same base, set bPhysicInit so later zero-velocity substeps return early. The hit becomes the base.
4. On a steep hit while moving into it (`delta_xy . n_xy < 0`), move by `-10 (up - n_z n)`, of length `10 sqrt(1 - n_z^2)`. A walkable hit there becomes the base.
5. With no walkable floor, return the unused time `tick (1 - min(1, actual / desired))`, drop the base unless it is a vehicle, set `v_z = 0` and fall for the rest.

Then `v = (end - start) / dt` with `v_z = 0`, which feeds animation. Lineage2JS never calls its CheckForLedges.

### stepUp, slide and twoWallAdjust

stepUp takes the desired direction, the remaining delta and the hit.
1. If `|n_z| < MAX_STEP_SIDE_Z` or `n_z >= MINFLOORZ`, move up 10, then by the delta. At 0.7 each, that is every face except ceilings with `n_z <= -0.7`. Outside walking, other faces move by the delta plus `|delta| n_z` on Z.
2. With no hit, step down 10 and finish.
3. A hit after the lift calls HitWallNotify, which acts only on vehicles.
4. A near-vertical new hit with `|delta|^2 t > 144` steps down 10 and recurses with `delta (1 - t_down)` and the down hit.
5. Otherwise run processHitWall (the controller's MinHitWall gate and NotifyHitWall hook, which may switch to falling and end the step). Slide: remove the delta's component along the wall's horizontal normal and scale by `1 - t`, skipping a slide against the desired direction. A second hit runs processHitWall, twoWallAdjust and one more move.
6. Step down 10.

twoWallAdjust takes the desired direction, the delta, the new and old normals and the hit time. Facing walls (`n_old . n_new <= 0`) move along `normalize(n_new x n_old)` by `(delta . dir)(1 - t)`, flipped to agree with the desired direction. Otherwise remove the delta's component along `n_new`, scale by `1 - t`, and drop it unless its dot with the desired direction is positive.

### Falling, swimming, flying and volumes

Falling sets `v_z = max(-2500, v_z - 1500 dt)` and moves by `(v_old + v_new) dt / 2`. Lineage2JS hardcodes these PhysicsVolume defaults; UE2 reads the pawn volume's Gravity and TerminalVelocity. If the waterline probe enters water before the hit time, move to the crossing, set `v_z = -80 - 0.7 |v_xy|` when `-160 < v_z < 0`, and swim the rest if over 0.01 s remains. A walkable hit switches to walking with `v_z = 0` and the leftover time. Other hits slide along the plane, with twoWallAdjust on a second hit. Velocity becomes displacement over time.

Swimming uses water speed in 3D, moves by `(v + 25 dt ZoneVelocity) dt` and slides once with twoWallAdjust. A pawn leaving water without a hit steps down toward its start Z. Still out of water, it falls with `v_z = 40 + 0.4 |v_xy|` when `0 < v_z < 160`.

Flying uses air speed in 3D plus ZoneVelocity, which non-local pawns ignore when `|v|^2 <= 90000`. A near-vertical hit (`|n_z| < 0.2`) at near-level velocity (dot with the gravity direction in (-0.2, 0.5)) steps 10 against gravity, moves, slides and steps back. Other hits slide with twoWallAdjust. The gravity direction is the sign of the volume's Gravity.Z.

A point's physics volume is the containing PhysicsVolume with the highest Priority; only a strictly greater Priority replaces the level default or an earlier pick. Water is a PhysicsVolume with bL2WaterVolume. The waterline probe is `centre + 13` on Z, and its crossing time comes from walking the water volume's tree along the probe segment.

### Speed and yaw

GetCurSpeed picks walk (Min) or run (Max) speed for ground, water or air, and bNotRotationMoving gives `GroundMinSpeed * 2/3`. Run needs the controller's MoveType PMT_FAST. A pawn that is not EntityKind npc, on the ground and with a walk clip, runs only once `MoveTimer > WalkAnimFrameInMove / 30` (0.4 s at walkanimframe 12). The working speed per environment is `GetCurSpeed * NonAttackSpeedRate + correction`, and the correction resets when its timer ends. Pawns without class data use their plain walk, run, water or air speed plus the correction.

Yaw turns toward the movement heading by at most `rate dt` per tick, the shorter way. Lineage2JS uses 90000 per s for the local player (45000 doubled, rounded) and 65000 per s for other pawns (truncated).

### Placement, floor search and FarMoveActor

On its first tick a pawn swims if it starts in water. Otherwise it probes 1000 units down with its box, then with `(0, 0, H)` if that hit is not walkable. A walkable hit places it at the hit plus 2.15, walking; anything else falls. A spawn rise moves 5/9 of the offset per second.

FarMoveActor refuses bStatic or non-bMovable actors, clears bPhysicInit, runs findSpot with the cylinder box for bCollideWorld actors, refuses on encroachment, carries based actors and updates the zone. findSpot accepts a clear spot, else tries 1-unit-tall slices and four quarter-size probes at 0.55 of the extent, nudging by 1.1 of the probe offset.

The teleport and ValidateLocation floor search runs up to 30 box probes. Teleport probe `i` starts `30 (i + 1)` above and sweeps `60 (i + 1)` down. Adjust and validate probes start `H + 20 + 30 i` above and sweep `50 + H + 60 i` (adjust) or `30 + H + 60 i` (validate) down. The first hit with a non-zero Z is the floor; after 30 misses the position stays and nothing is raised. The gap is `12 t` whatever the probe length. A gap under 1.9 rises to 2.15, and the teleport and validate paths compute `t`, 1.9 and `(2.4 + 1.9) / 2` in float32.

### Server records

- CharMoveToLocation 0x01 carries the destination, then the origin. Dead pawns ignore it, and it stands a sitting or fake-dead pawn up and stops its skill. A remote living pawn over 200 units (3D) from the origin snaps there (AdjustPawnLocation, not on vehicles, with a dead controller or with a reserved move point). A remote pawn then gets the timer `T = rate |origin - dest|_xy / speed` and the correction `c = (|cur - dest|_xy - |origin - dest|_xy) / T`, with `rate` = NonAttackSpeedRate, and walks to the destination. With speed, distance or rate at 0, `T` and `c` stay 0, and at speed 0 the pawn does not walk. The local pawn only gets the new goal.
- MoveToPawn 0x60 snaps the same way and follows the target each tick to the server's distance, with `T = |origin - target|_xy / speed` and no rate. With the target not loaded, the pawn walks to the destination.
- StopMove 0x47 snaps a remote pawn beyond 200 units and stops it.
- ValidateLocation 0x61 applies only to a live pawn in WaitType STP_STAND. The local player snaps with the floor search and takes the heading. A moving remote pawn sets its environment's working speed to `speed rate + (|cur - goal|_xy - |server - goal|_xy) / 3` for 3 s. An idle remote pawn with no action or attack walks there when `2 < d_xy < 200`, clearing timer and correction, and snaps with the floor search at `d_xy >= 200` once collision there is ready.
- TeleportToLocation 0x28 raises Z by `H + 10`. The local player then runs the floor search, after a 1000 ms fade unless the teleport is fast, and a remote pawn moves there with FarMoveActor.
- A moving base carries its pawn by its motion and yaw change through MoveActor with the base ignored, and a hit drops the base.

0x60 and 0x61 are the C4 values (`lineage2js/src/network/game-packets.ts:123-124`); [05-network.md](05-network.md) adds their Mobius rows.

### Reports

- While the local pawn moves, or was moving at the last report, send ValidatePosition 0x48 once 1000 ms have passed since the last one: `trunc(x), trunc(y), trunc(z), heading, vehicleId`, boat-relative on a boat. One report follows the stop.
- While moving and ready, anchor the position and time. After 600 ms with under 2 units (3D) of progress, stop locally and send CannotMoveAnymore 0x36 with `round(x, y, z)` and the heading; otherwise re-anchor. Not moving clears the anchor.
- A click sends MoveToLocation 0x01 (Lineage2JS MoveBackwardToLocation) with `round(target)`, `round(origin)` and move mode 1. Mobius reads 1 as mouse and 0 as keys. A Lineage2JS comment says omitting the mode flags the client as L2Walker.
- Lineage2JS rounds with `Math.round`, which takes negative halves toward +infinity. Phase 4 captures confirm the native mode.
- The core emits `move-local`, `report-position` and `cannot-move` in float32 source units, and the network builder truncates or rounds. 0x36 is the C4 value; [05-network.md](05-network.md) adds its Mobius row.
- The test server has no geodata and walks pawns through walls. CannotMoveAnymore makes it adopt our stop point, so client collision plus the stuck rule is the native way to stop at walls.

### Follow camera

The pivot is `centre + (0, 0, CameraViewHeightAdjust)` and `D = CurZoomingDist + 250`. Pitch `p` and yaw `y` give `f = (cos p cos y, cos p sin y, sin p)` from the float32 sine table, and the camera sits at `pivot - f distance`, float32 per component.

With bUseHitCheckCamera, trace a 0.1 box from the pivot to `pivot - f (D + 30)` lowered by 10 on Z. On a hit, `h = (pivot - hit) . f` and `D = min(D, h)`. The camera sits at `pivot - f (D - 30)`.

Without it, the camera starts at `D - 30`, and a zero-extent trace repeats from the point at `D` back to the pivot:
1. No hit ends the loop.
2. A terrain hit sets `D = min(D, h)`, puts the camera at `D - 30` and ends the loop.
3. A hit farther than HitCheckCameraMinDist from the camera ends the loop.
4. Otherwise `D = min(D, h - 30)` and the camera moves to `D - 30`.

A last trace from the pivot out to `D` clamps the camera to `min(D, h) - 30` on a terrain hit. Only actor hits count. Lineage2JS traces ignore pawns, use a non-player source and skip the world-only flag, so any blocking non-pawn actor stops the camera.

Zoom steps by 2.5 while `MinZoomingDist + 2H > zoom` and by 20 otherwise, clamped to MinZoomingDist and MaxZoomingDist. It does nothing while the camera is locked or with bDisableZoom, bCameraSpecialMove or bCameraMovingToSpecial.

### Click to move

A zero-extent ray runs from the camera through the pixel into the same collision world, with the player controller as the source and the pawn excluded. It reaches the far side of the loaded tiles' bounds, or 10000 units while swimming or flying. Try a ground item pickup first, then an action or target request on a hit actor, then `move-local` to the hit point. With no hit while swimming or flying, move to `origin + 10000 dir`. The pawn moves on the server's echo, not on the click.

## Data inputs

| Input | Produced today by | Gap |
|---|---|---|
| BSP tree per map: node FPlane, iFront, iBack, NodeFlags, NumVertices, iCollisionBound, iZone, iLeaf, LeafHulls, Leaves, bRootOutside, zones | The vendored reader `scripts/vendor/lineage2elbera_bsp/__init__.py` (in-repo, world-owned) parses every field, and 02-30 wraps it as `scripts/world/level_model.py`. `validate_graph` checks i_front, i_back and i_plane; `validate_model` checks i_surf, the vertex pool, i_leaf and i_zone. `scripts/native_bsp_floor.py:108,117` admits only 123/28 on 20_20. | No step writes the tree. Both payload writers range-check i_collision_bound, i_render_bound and the LeafHulls runs. Other Interlude licensees and version-118 maps are admitted or reported as gaps. |
| Brush volumes: BlockingVolume and PhysicsVolume trees, Location, Rotation, DrawScale, DrawScale3D, PrePivot, flags, Priority, Gravity, TerminalVelocity, ZoneVelocity, water flag | `scripts/native_assets_lib/world_music.py:163-189` reads MusicVolume trees, translation only. | Full transform, records from `scripts/world/level_zones.py`, properties from `scripts/native_assets_lib/class_defaults.py`, the VOLS group. |
| Static mesh: triangles, kDOP nodes, CollisionModel, UseSimpleLineCollision, UseSimpleBoxCollision; per placement localToWorld and flags | `scripts/native_map.py:48-50` COLLISION tuple (bCollideActors, bBlockActors, bBlockPlayers, bBlockKarma, trace flags, bUseCylinderCollision, radius, height). EnableCollision comes from `scripts/native_assets_lib/static_materials.py`, read by `src/scene/world/nativeBspSupport.ts:37-41`. | Our own collision tail decoder (both layouts, compact indices, the 64-byte block for the winding check). The tuple lacks bCollideWorld, bWorldGeometry, bStatic and bMovable. |
| Terrain: G16 heightmap, size, TerrainScale, Location (toWorld), QuadVisibilityBitmap, EdgeTurnBitmap | `scripts/extract-native-terrain-patch.py` reads the bitmaps (83-94, 193-202) and toWorld (237) for the 20_20 patch. | A tile-general field from the heightmap, not render triangles. |
| Movers and doors: static mesh collision, keyframes, current pose | `scripts/native_map_movers.py`, `scripts/derive-native-map-movers.py`, `scripts/stage-native-movers.py`, plan 02-31. | Each mover's SMSH link and a door state source: a local toggle in the sandbox, server state in Phase 4. |
| Pawn cylinders, speeds, NonAttackSpeedRate, EntityKind | Server data in Phase 4 (UserInfo, CharInfo, NpcInfo). The sandbox uses `src/assets/native/loadNativePlayerProfiles.ts:38` (radius 9, half-height 23, 100 units per m) and aCis humanFighter.xml speeds (`src/world/NativeSliceAdapter.ts:19-24`). | The `move` event carries cylinder and speeds. chargrp walkanimframe for the run start comes from the data lane. |
| Camera configuration: MinZoomingDist, MaxZoomingDist, CameraViewHeightAdjust, bUseHitCheckCamera, HitCheckCameraMinDist | None. The reference client's l2.ini is Lineage2Ver413 encrypted. | An l2.ini [Engine.LineagePlayerController] decoder plus LineagePlayerController class defaults, into a typed config resource. |
| Class rules: RotationRate, AccelRate, CanIngnoreCollision, CanBeIngnoredCollision, bAsTreatWorld, DamageGrade, bL2WaterVolume | None. | An export through `scripts/native_assets_lib/class_defaults.py`. |

## Constants

| ID | Value | Provenance | Status | Runtime default |
|---|---|---|---|---|
| movement.maxStepHeight | 10 units | `lineage2js/src/physics/components/pawn-movement-component.ts:74` | unconfirmed | reference |
| movement.floorProbe | 12 units | `lineage2js/src/physics/components/pawn-movement-component.ts:75` | unconfirmed | reference |
| movement.floorBand | 1.9 to 2.4, target 2.15 | `lineage2js/src/physics/components/pawn-movement-component.ts:76-78, 607-614` | unconfirmed | reference |
| movement.minFloorZ | 0.7 | `lineage2js/src/physics/components/pawn-movement-component.ts:79`; Engine.u UConst cross-check | unconfirmed | reference |
| movement.maxStepSideZ | 0.7 | `lineage2js/src/physics/components/pawn-movement-component.ts:80` | unconfirmed | reference |
| movement.stepUpRecursion | `\|delta\|^2 t > 144` | `lineage2js/src/physics/components/pawn-movement-component.ts:81, 780` | unconfirmed | reference |
| movement.steepSlide | `-10 (up - n_z n)` | `lineage2js/src/physics/components/pawn-movement-component.ts:620-623` | unconfirmed | reference |
| movement.volumeGravity | Gravity.Z -1500, TerminalVelocity 2500 | `lineage2js/src/physics/components/pawn-movement-component.ts:89, 93, 927` | ue2-data | constants; differing VOLS values logged |
| movement.fallingReadsVolume | volume values versus constants | `lineage2js/src/physics/components/pawn-movement-component.ts:927, 1046` | unknown | constants |
| movement.accelRate | 2048, direction only | `lineage2js/src/physics/components/pawn-movement-component.ts:88, 418-420` | ue2-data | class default |
| movement.calcVelocity | no acceleration ramp | `lineage2js/src/physics/components/pawn-movement-component.ts:461-481`; `src/world/NativeSliceAdapter.ts:6-7` cites APawn::calcVelocity 0x10639950 | unconfirmed | reference |
| movement.runStart | `MoveTimer > WalkAnimFrameInMove / 30` | `lineage2js/src/physics/components/pawn-movement-component.ts:1744-1751`; `src/world/NativeSliceAdapter.ts:11-12` cites APawn::GetCurSpeed 0x1061eaf0 | unconfirmed | reference |
| movement.notRotationMovingSpeed | `GroundMinSpeed * 2/3` | `lineage2js/src/physics/components/pawn-movement-component.ts:1741` | unconfirmed | reference |
| movement.yawRate | 90000/s rounded (local), 65000/s truncated | `lineage2js/src/physics/components/pawn-movement-component.ts:90-91, 1280` | unconfirmed | reference |
| movement.waterlineProbe | `centre + 13` | `lineage2js/src/physics/components/pawn-movement-component.ts:94, 1146, 1186` | unconfirmed | reference |
| movement.waterEntryExit | entry -80, 0.7, -160; exit 40, 0.4, 160; swim 25 | `lineage2js/src/physics/components/pawn-movement-component.ts:939-940, 998, 1028-1029` | unconfirmed | reference |
| movement.flying | ZoneVelocity 90000; step-up 0.2 and (-0.2, 0.5) | `lineage2js/src/physics/components/pawn-movement-component.ts:1050, 1076` | unconfirmed | reference |
| movement.substeps | 0.4 s, 8 iterations, 0.05 s, 0.0003 s, 7 nested | `lineage2js/src/physics/components/pawn-movement-component.ts:278-286, 587, 922, 981` | unconfirmed | reference |
| collision.moveActorExtension | 2 units | `lineage2js/src/physics/collision-world.ts:45-46, 1077-1081` | unconfirmed | reference |
| collision.nearZeroDelta | `1e-4` per component | `lineage2js/src/physics/collision-world.ts:350-362` | unconfirmed | reference |
| collision.backoff | query section table | `lineage2js/src/physics/collision-world.ts:1174, 1502-1511` | unconfirmed | reference |
| collision.ignorePawns | all pawns but the local player; bAsTreatWorld still blocks | `lineage2js/src/physics/collision-world.ts:1295-1385`; `lineage2js/src/physics/components/pawn-movement-component.ts:1192-1238` | unconfirmed | reference |
| collision.cylinder | offset 0.001, inside `< 1`, inward `< -0.1` | `lineage2js/src/physics/collision-primitive.ts:753-754, 796` | unconfirmed | reference |
| collision.bspPushOut | 1.1 in walks, unscaled in clipping | `lineage2js/src/physics/collision-primitive.ts:107-131, 1015, 1086` | unconfirmed | reference |
| collision.bspTolerances | 0.001 side, 1e-5 parallel, 0.001 and 1e-6 bevel | `lineage2js/src/physics/collision-primitive.ts:116-128, 975-978, 1191, 1212` | unconfirmed | reference |
| collision.hullBoxOffsets | 0.1 out on four faces, in on x max and y max | `lineage2js/src/physics/collision-model.ts:35`; `lineage2js/src/assets/unreal/un-volume.ts:78` | unconfirmed | reference |
| collision.hullPlaneLimit | fewer than 64 | `lineage2js/src/physics/collision-model.ts:25` | unconfirmed | larger hulls are gap rows |
| collision.leafHullsEncoding | flip bit 0x40000000, negative terminator, 6 int32 box words | `lineage2js/src/physics/collision-model.ts:5, 38-42`; `lineage2js/src/assets/unreal/model/un-model.ts:156-165` | ue2-data | read from packages |
| collision.isCsg | `NumVertices > 0`, not `NodeFlags & (0x01 \| 0x20)` | `lineage2js/src/assets/unreal/bsp/un-bsp-node.ts:25-34, 126` | ue2-data | read from packages |
| collision.staticMeshRecords | 64-byte block, compact indices, winding (v2, v1, v0) | `lineage2js/src/assets/unreal/static-mesh/un-static-mesh-collision.ts:3-104` | ue2-data | read from packages; winding checked against the stored plane |
| collision.staticMeshLayout | licensee < 17 inline; licensee >= 17 and archive >= 62 with an int32 absolute end offset before each array; else unsupported | `lineage2js/src/assets/unreal/static-mesh/un-static-mesh.ts:166-185`; `lineage2js/src/assets/unreal/static-mesh/un-static-mesh-collision.ts:46-58` | unconfirmed | reference; other layouts are gap rows |
| collision.terrainTriangle | lift `e_z`, `n . d < -0.0001`, slack `e_x / \|edge\|` | `lineage2js/src/physics/collision-primitive.ts:237-283` | unconfirmed | reference |
| collision.terrainDiagonal | bit `x + y * heightmapX` | `lineage2js/src/assets/unreal/un-terrain-info.ts:299-309, 680-690` | ue2-data | read from packages |
| collision.terrainHoles | QuadVisibilityBitmap 0 drops collision | our rule; `lineage2js/src/objects/terrain.ts:105-127` uses render geometry | unknown | on |
| collision.tileClip | each tile's tree answers inside its rectangle | our rule | unknown | on |
| movement.spawnFloorProbe | 1000 units | `lineage2js/src/physics/components/pawn-movement-component.ts:92, 374-391` | unknown | reference |
| movement.spawnRise | 5/9 of the offset per s | `lineage2js/src/physics/components/pawn-movement-component.ts:95-96` | unconfirmed | reference |
| movement.floorSearch | 30 probes, gap `12 t` | `lineage2js/src/physics/components/pawn-movement-component.ts:1658-1672` | unconfirmed | reference |
| movement.snapThresholds | 200 (3D); idle walk 2 to 200; 3 s | `lineage2js/src/network/network-movement.ts:75-76`; `lineage2js/src/physics/components/pawn-movement-component.ts:1604-1636` | unconfirmed | reference |
| movement.correctionTimers | `rate d_xy / speed`, `d_xy / speed` | `lineage2js/src/physics/components/pawn-movement-component.ts:1754-1787` | unconfirmed | reference |
| movement.teleportRaise | `H + 10` | `lineage2js/src/network/network-movement.ts:222` | unconfirmed | reference |
| report.validatePositionCadence | 1000 ms, plus one after the stop | `lineage2js/src/network/network-manager.ts:30, 1375-1385` | unconfirmed | reference |
| report.stuckRule | 600 ms, under 2 units | `lineage2js/src/network/network-manager.ts:32-34, 1387-1397` | unconfirmed | reference |
| report.fields | trunc for ValidatePosition, round elsewhere, mode 1 | `lineage2js/src/network/game-client.ts:233-243` | unconfirmed | reference |
| report.opcodes | client 0x01, 0x36, 0x48; server 0x01, 0x28, 0x47, 0x60, 0x61 | `lineage2js/src/network/game-packets.ts:46, 80, 99, 123-124, 302, 341, 351`; `mobius/gameserver/network/ClientPackets.java:37-193`; `mobius/gameserver/network/ServerPackets.java:32-188` | unconfirmed | reference |
| camera.distance | `CurZoomingDist + 250`, 0.1 box, 30, 10 | `lineage2js/src/rendering/camera/behind-view-camera.ts:42-53` | unconfirmed | reference |
| camera.traceFilter | ignore pawns, non-player source, no TRACE_World | `lineage2js/src/rendering/camera/behind-view-camera.ts:27` | unconfirmed | reference |
| camera.pivot | `centre + CameraViewHeightAdjust` | `lineage2js/src/player.ts:18-22` | unconfirmed | reference |
| camera.direction | 16384-entry float32 sine table, index `(r >> 2) & 0x3fff`, half-turn entry 1.2246063538223773e-16 | `lineage2js/src/assets/unreal/utils/rotator.ts:72-77`; `lineage2js/src/rendering/camera/behind-view-camera.ts:43-47` | unconfirmed | table via `src/shared/math/rotator.ts` |
| camera.settings | zoom limits, view height, hit-check flag and distance | `lineage2js/src/assets/unreal/conf-files/un-conf-system.ts:50-54, 141-185` | ue2-data | class defaults; CameraViewHeightAdjust 0 without l2.ini |
| camera.zoomStep | 2.5 near the minimum, else 20 | `lineage2js/src/game/input-manager.ts:150-160` | unconfirmed | reference |
| camera.pitchClamp | -15000 to 16384 (replay path only) | `lineage2js/src/game/input-manager.ts:384-388` | unconfirmed | reference |
| click.pickLength | 10000 swimming or flying, else the loaded far bound | `lineage2js/src/game/input-manager.ts:877-910` | unconfirmed | reference |

## Interlude differences

| Item | Detail | How to confirm |
|---|---|---|
| Addresses and numeric rules | Lineage2JS cites C4 Engine.dll `fa3f0f2a` addresses in two image ranges (0x10607517 APawn::performPhysics, 0x105ff0e9 the camera-walking branch of calcVelocity); our repo cites APawn::calcVelocity 0x10639950 and GetCurSpeed 0x1061eaf0. MAXSTEPHEIGHT, MAX_STEP_SIDE_Z, MINFLOORZ and the floor band are C4 readings, with Engine.u UConst values as a cross-check only. UE2 falls by the PhysicsVolume, Lineage2JS by constants. | Phase 5 (POL-04): read Engine.dll `4dd2f63c` statically with the tools under `.assets/native-tools`: MoveActor, stepUp and physWalking immediates first, then physFalling. Each row records interludeEvidence. |
| Static mesh collision layout | Interlude packages are file version 123 with several licensees, plus a few version-118 maps. The C4 switch keys on licensee 17 and archive 62. | Phase 2 package census: decode each layout and check every winding against its stored plane. Unknown layouts are per-object gap rows. |
| Protocol | Opcodes, the move mode, and the server packets CharMoveToLocation, MoveToPawn, StopMove, ValidateLocation, TeleportToLocation, ChangeMoveType, BeginRotation and StopRotation; some Interlude opcodes differ from C4. | Mobius sources and L2.exe captures through the relay tee (NET-10, [05-network.md](05-network.md)). |
| L2 fields and C4-only features | bAsTreatWorld, CanIngnoreCollision, CanBeIngnoredCollision, Mover DamageGrade, bL2WaterVolume, NonAttackSpeedRate and WalkAnimFrameInMove may be C4 or later. FlyToLocation, NMover, the CameraWalking branch, keyboard rotation and vehicle get-on and get-off are C4 era; Interlude has boats and wyverns. | Check fields in the Interlude class defaults export. Keep C4-only paths out until binary or capture evidence shows them. |
| Camera, terrain and rotator table | Which CalcBehindView branch runs, its trace filter, and `D + 30` versus `D + 60`; whether QuadVisibilityBitmap holes drop collision and how the terrain edge test scales; the C4 Core.dll SinTab behind camera directions. | Decode the bUseHitCheckCamera default from l2.ini and class defaults. In Phase 5 read CalcBehindView and the terrain checks, and re-derive FGlobalMath SinTab from Core.dll `9462f87a` before fixing the table-or-exact choice in `src/shared/math/rotator.ts`. |

## Do not copy

- The Rapier world, colliders and kinematic bodies, stepped once and never queried (`lineage2js/src/physics/physics-manager.ts:61, 76-81, 618-630`).
- The 3D uniform grid (1024 static cells, 64 pawn cells, 256 mover margin, 4096 and 16384 fallbacks) and the tile broad-phase clamp (`lineage2js/src/physics/collision-world.ts:39-44, 239-247, 1031-1056`): performance choices, while the tree walk covers the whole Level.Model.
- Terrain triangles from render geometry (`lineage2js/src/objects/terrain.ts:105-118`). Build them from the heightmap.
- Hardcoded cylinders 7.5 / 23 and wyvern 60 / 80, and speeds from an l2j-lisvus Archmage template (`lineage2js/src/physics/components/pawn-movement-component.ts:70-87`). Use server data.
- The `?? true` actor flag fallbacks (`lineage2js/src/assets/unreal/static-mesh/un-static-mesh-actor.ts:175-188`). Resolve class defaults.
- checkForLedges, never called, and STOP_SNAP_DISTANCE 32, never used (`lineage2js/src/network/network-manager.ts:36`).
- The 20 Hz mouse retrace and the 2D triangle grid for meshes without kDOP nodes: performance choices.
- Skipping the whole pawn grid when ignoring pawns, which also drops bAsTreatWorld pawns.
- The second hit-check variant tracing `D + 60` (`lineage2js/src/game/input-manager.ts:512-533`, another image range). The behind-view path stays the default until Interlude evidence picks one.
- UE2 header names in reference comments (UnPhysic.h, EngineClasses.h at `lineage2js/src/physics/components/pawn-movement-component.ts:74-80`). Do not seek or use UE2 engine source or headers; read the Interlude binary.
- `debugger` statements and 'not implemented' throws (AI wall adjustment, StaticMeshActor MoveActor): reference gaps, not behaviour.
- uuid v5 static mesh ids (`lineage2js/src/assets/unreal/static-mesh/un-static-mesh.ts:1`).
- The Lineage2Elbera gateway and its terrain-collision.js, cylinder-collision.js and moveactor-arithmetic.js: behaviour references only, never port sources.

## Our code today

Code truth is native-world-slice (22de53a); implementers work against the newer layout on plan/autonomous-roadmap (56bf9f7).

Plan 01-15 (ba9925b) moved `src/world/meshNavigation.ts`, which imports @babylonjs inside src/world on native-world-slice, to `src/scene/navigation/meshNavigation.ts`, and added `tests/unit/importBoundaries.test.ts`, which keeps every src/world closure inside src/world with no packages. It is a Babylon triangle-capsule navigator in metres (`maxStep = 0.3`, 45 degree slope, 8 m cells) behind the Babylon-free `src/world/WorldNavigation.ts`.

`src/world/NativeSliceAdapter.ts` is sandbox server and mover: destinations through navigation (120-127), `moveTowards` (129-148), aCis humanFighter speeds (walk 80, run 115 units/s, run start 12/30 s; 19-24) and the calcVelocity and GetCurSpeed addresses (6-12). `src/interpolation/PositionInterpolator.ts` smooths at 12/s and snaps beyond 8 m. `src/entities/EntityRegistry.ts:159-167` re-grounds positions through navigation. `src/scene/world/nativeGroundContact.ts:157-186` gives footsteps a nine-sample support. `src/camera/WorldCamera.ts:6-35` drives an ArcRotateCamera with no hit check. `src/scene/world/nativeBspSupport.ts` marks walk-support meshes from glTF EnableCollision extras; `src/scene/world/sourceColliderPolicy.ts` is a legacy exception list. Doors toggle locally (`src/runtime/createNativeSliceRuntime.ts:199-201`).

The capsule is radius 9, half-height 23 at 100 units per m (`src/assets/native/loadNativePlayerProfiles.ts:38`), passed as height 2 * 23 (167-168). Scenes set `useRightHandedSystem = true` (`src/scene/buildPresentationScene.ts:44` on plan/autonomous-roadmap), `docs/ARCHITECTURE.md:20` says right-handed and Y up, and `src/runtime/nativeSliceDebug.ts:36` says native = (X, Z, Y) x 100. The 'left-handed' comment at `src/world/worldTypes.ts:1` exists only on native-world-slice. package.json lists @recast-navigation/core and generators 0.43.0 as runtime dependencies, used only by the Editor test.

recipes/world and scripts/world are empty on both refs. The untracked 02-30 plan would write position-only collision GLBs from PolyFlags, cross-checked by Elbera exporters run from outside the repo. No code yet does extent sweeps, hull, kDOP or heightmap collision, volume, water or falling physics, a camera hit check, a collision click trace, or movement records and reports.

## Design

### Module layout

`src/scene/world/movement/core/**` is Babylon-free and imports only `src/shared/**` from outside itself. It holds:
- `collision/`: resource views, bspTree, meshTree, terrainField, cylinder, flags, and collisionWorld with addCell, removeCell and isReady;
- `pawn/`: pawnState, pawnPhysics, stepUp, speed;
- `control/`: applies typed movement records;
- `report/`: a pure reporter that turns `(now, pawn state)` into report-position and cannot-move intents;
- `view/`: behindView and clickTrace over an injected trace;
- `nativeRules.ts`: every constant under its rule id.

`src/scene/world/movement/*.ts` is the only Babylon glue:
- `loadCollisionCells.ts` fetches pinned collision groups per chunk into the collision ring (WORLD-04).
- `movementPresenter.ts` runs one pawn simulation per entity from movement events, writes root position and yaw through `src/world/sourceFrame.ts`, and exposes each pawn's base (terrain, BSP node, placement, mover) for footsteps.
- `cameraDriver.ts` maps ArcRotateCamera angles and zoom to yaw, pitch and CurZoomingDist, runs behindView, and writes the PhysicsVolume holding the camera, with its water flag, to `src/scene/world/cameraEnvironment.ts` for MAT-01 fog.
- `pointerMove.ts` turns `scene.createPickingRay` into a source-space ray and dispatches `move-local` or a target intent.
- `collisionDebugOverlay.ts` draws hulls, cylinders and hits with LinesMesh behind `?debug=collision`, loaded by dynamic import.

### Collision resource

`native-tile-collision` is an `.l2asset` whose `asset.json` records source paths and SHA-256, client build, converter version, units `source` and axes UE2 Z up (`.planning/PROJECT.md:66`). Its named, typed, 4-byte aligned little-endian arrays are written by `scripts/world/typed_payload.py` and read by `src/shared/typedPayload.ts`, as for bsp-visibility and lighting. The reader rejects truncated or inconsistent groups with named errors.
- BSPT, per map: node planes, children, csg bits, iCollisionBound, LeafHulls, bRootOutside.
- VOLS, per chunk and the only water and physics volume export: BlockingVolume and PhysicsVolume trees, localToWorld, Priority, Gravity, TerminalVelocity, ZoneVelocity, water flag.
- SMSH, per chunk: collision triangles, kDOP nodes, CollisionModel trees.
- PLAC, per chunk: placements with resolved flags and localToWorld.
- TERR, per chunk: heightmap field, toWorld, both bitmaps.
- MOVR, per chunk: movers with their SMSH link, keyframes and initial pose.

The steps read the Level.Model through `scripts/world/level_model.py`, volume records from `scripts/world/level_zones.py`, and flags and class rules with provenance from `scripts/native_assets_lib/class_defaults.py`. bsp-visibility shares the loader but keeps its own resource, and one cross-language golden covers both. Placement matrices state their rotator rule, pinned against `src/shared/math/rotator.ts` by a fixture. No Phase 2 movement step needs binary reading, because reference values already give visible walking.

### Fixtures and test seams

Committed fixtures are synthetic, or indices and hashes only (`.planning/PROJECT.md:34`). The `tests/pipeline/support/` builder emits the synthetic test room (nodes, leaves, zones, LeafHulls, bounds); the collision step converts it, and the core tests read the output. Real-client cases read the client through `--client` and skip with a reason when it is absent. Property tests seed `src/shared/random.ts` with the `test` domain tag through one helper, golden traces use `tests/support/goldenTrace.ts`, and pawnPhysics takes a CollisionQueries interface so tests run on analytic worlds with explicit `dt` and `now`.

### Multi-tile BSP

Each tile's Level.Model tree answers only for the part of a query segment inside its own tile rectangle, because a neighbour tree with bRootOutside false would report solid space outside its tile. This is our rule until the Interlude border behaviour is read.

### Authority and the sandbox stand-in

The server decides destinations, stops, corrections, speeds and cylinders. Presentation moves pawns between records (ARCH-04) and sends only the native intents and reports; the local pawn waits for the server echo. NativeSliceAdapter becomes a stand-in for a server without geodata: it keeps its own straight-line position, echoes `move-local` as `move`, adopts a `cannot-move` stop point, and answers a report that drifts past a declared threshold with `correct`. It never adopts every report, which would hide the desync that POL-03 and Phase 4 must see. Mobius thresholds arrive in Phase 4.

The world lane owns the reporter, record application and their tests. Integration (adapter-dispatch) owns the `src/world/mobius/**` mapping, the capture fixtures and Phase 4 parity.

### Records and units

The core cannot import `src/world`, so it defines its own record types and the presenter maps them. One integration contract commit adds these records before any adapter code; the five GameWorldAdapter methods stay unchanged.

| Record | Kind | Fields |
|---|---|---|
| `move` | WorldEvent | entityId, origin, destination, targetId?, offset?, moveType, speeds, collision {radius, height} |
| `stop` | WorldEvent | entityId, position, heading |
| `correct` | WorldEvent | entityId, position, heading |
| `teleport` | WorldEvent | entityId, position |
| `move-local` | WorldCommand (existing) | destination, plus a new origin |
| `report-position` | WorldCommand | position, heading |
| `cannot-move` | WorldCommand | position, heading |

The same commit adds EntityKind `npc` for the run start. Movement events and the three intents carry source units, wire integers inbound and float32 Location outbound, so truncation and rounding match L2.exe. WorldEntity positions stay metres through `src/world/sourceFrame.ts`. A metres round trip can move a coordinate by one ulp, which ValidatePosition truncation turns into a 1-unit error.

### Time and readiness

`src/shared/presentationClock.ts` supplies `dt` and `now`, with pause and seek. Movement uses raw `dt` with its own substeps and never `src/shared/fixedStep.ts` live; replays drive the presentation clock at a fixed `dt`, and NetClock stays separate for protocol timeouts. collisionWorld tracks readiness per cell. A pawn whose cell, or whose pending snap target's cell, is not ready holds in place and shows in the ARCH-03 diagnostics. Babylon supplies transforms, the camera, picking rays and the overlay, with no checkCollisions, moveWithCollisions, physics plugin or navmesh.

### Rules file and gap reasons

`recipes/world/movement-native-rules.json` holds one row per constant, `{id, value, provenance, status, interludeEvidence, runtimeDefault}`, with `interludeEvidence` as `{binary SHA-256, export or VA, offset}`. Status is ue2-data, unconfirmed, confirmed-interlude, corrected-interlude or unknown, shared by all five areas. Every row runs its runtimeDefault in Phase 2.

Collision gap reasons go in `recipes/world/gap-reasons.json` with a listVersion bump: `collision-class-unported:<class>`, `collision-feature-unported:<property>`, `collision-layout-unsupported:<version>/<licensee>`, `collision-index-out-of-range:<field>` and `collision-cross-check-disagreement`. The world step that owns the part writes the rows.

### Retirement

The world lane retires `src/scene/world/sourceColliderPolicy.ts` and `src/scene/world/nativeGroundContact.ts` once no caller remains. Integration retires `src/scene/navigation/meshNavigation.ts`, `src/world/WorldNavigation.ts` and `syntheticMovement.ts`, and moves @recast-navigation/* out of the runtime dependencies; the import-boundary test then forbids @recast-navigation/*, @babylonjs/materials and @babylonjs/node-particle-editor in `src/**` outside the lazy inspector entry. Once MOVE-01 lands, the navigation invariance test in [02-bsp-visibility.md](02-bsp-visibility.md) checks collisionWorld queries, and picking invariance stays for door hover, door activation and targeting.

## No vendor dependencies

| Reference uses | For | We use |
|---|---|---|
| three (Vector3, Box3, Matrix3, Matrix4, Quaternion, Euler, Object3D) | Collision and pawn math, transforms, storage | `src/shared/math/` and `src/shared/math/rotator.ts` |
| three Raycaster | Click ray (`lineage2js/src/game/input-manager.ts:2`) | `scene.createPickingRay` in source space, then clickTrace |
| three EventDispatcher, Spherical, MOUSE (ZUpOrbitControls) | Camera input (`lineage2js/src/rendering/camera/controllers/zup-orbit-controls.ts:1`) | ArcRotateCamera inputs read by cameraDriver.ts |
| @dimforge/rapier3d | Vestigial colliders, kinematic bodies, debug overlay | Nothing; collisionWorld queries and a LinesMesh overlay |
| @l2js/core and @l2js/engine | Runtime decoding of BSP, LeafHulls, static mesh tails, volumes, terrain bitmaps | Offline Python steps on the vendored BSP reader via `scripts/world/level_model.py`, plus our static mesh tail decoder |
| uuid v5 | Static mesh ids | Converter content hashes |
| @recast-navigation/core and generators 0.43.0 (our package.json) | Nothing at runtime | The MOVE-01 port and server routes; the packages leave the runtime dependencies |
| Babylon collisions and physics plugins | Not used by the reference | collisionWorld queries |
| Lineage2Elbera gateway and its collision, terrain and MoveActor modules | Proposed Stage A imports; the gateway is a Node server on ws, Node crypto and net | None; read-only behaviour cross-checks from the pinned copy under `.assets/reference/`. The vendored `scripts/vendor/lineage2elbera_bsp/` is in-repo, world-owned converter code |

## Shared modules

- `src/shared/math/`
- `src/shared/math/rotator.ts`
- `src/shared/random.ts`
- `src/shared/presentationClock.ts`
- `src/shared/fixedStep.ts`
- `src/shared/typedPayload.ts`
- `scripts/world/typed_payload.py`
- `src/world/sourceFrame.ts`
- `scripts/world/level_model.py`
- `scripts/world/level_zones.py`
- `scripts/native_assets_lib/class_defaults.py`
- `src/scene/world/cameraEnvironment.ts`
- `tests/pipeline/support/`
- `tests/support/goldenTrace.ts`
- tests/support/staticImportGraph.ts and tests/unit/importBoundaries*.test.ts
- `tools/reference-overlap/`
- src/net/channel/replayChannel.ts and tools/net-relay/
- scripts/native_store/gap_reasons.json plus recipes/world|actors|data/gap-reasons.json

## Acceptance

- Unit, BSP on the synthetic room: a wall ray returns the analytic time within 1e-4 and the wall normal; a point inside the room is clear and one inside a wall is solid; a box sweep stops at the plane distance minus the box support minus the backoff; at extent 0 the box sweep matches the ray within 1e-3.
- Unit, transformed brush: a BlockingVolume rotated 30 degrees and scaled 2x blocks a ray at the analytic point.
- Pipeline, `--client` on 20_20: every LeafHulls reference masks below the node count, iCollisionBound and iRenderBound are in range, hull boxes are finite, the PlayerStart10 centre is clear, and a 2000-unit down trace from it hits `n_z >= 0.7`. Only the map hash and node indices are committed.
- Pipeline, static mesh: a synthetic mesh round-trips in each layout. With `--client`, every winding plane matches its stored plane within 1e-3 and every collision material slot has EnableCollision, or the object gets a collision-cross-check-disagreement row.
- Golden: the Python writer and the TS reader agree on every synthetic room array, beside the bsp-visibility golden.
- Unit, terrain: a vertical ray hits each quad at the height of the triangle EdgeTurnBitmap picks and passes a QuadVisibilityBitmap 0 quad (our rule).
- Unit, cylinder: analytic side and cap hits, inside-moving-inward at `t = 0`, and the 0.001 offset.
- Unit, MoveActor: a near-zero delta applies without a sweep; the 2-unit conversion and each backoff kind match hand-computed values; ties go to the entry registered first.
- Unit, pawn on analytic worlds at fixed `dt = 1/60`: walking at 80 units/s for 1 s covers 80 +- 0.05; walk 80, run 115 and a 0.4 s run start cover `0.4 * 80 + 0.6 * 115 = 101` +- 0.5 in 1 s; the climbable step limit (about MAXSTEPHEIGHT plus the 2.15 gap, minus backoff) is derived from the port and written in the rules file first, then a step just under it climbs and one just over it blocks; `n_z` 0.69 is not walkable and 0.71 is; a 45 degree wall slides; a corner applies twoWallAdjust; a 300-unit fall lands with the gap in [1.9, 2.4].
- Unit, reporter: a scripted 5 s walk emits report-position every 1000 ms plus one after the stop; 600 ms blocked with under 2 units of progress emits one cannot-move and stops locally; a stop record clears the anchor.
- Unit, corrections: both timers with their zero speed, distance and rate cases, the ValidateLocation 2 and 200 thresholds, and the floor search match hand-computed fixtures.
- Unit, camera: a wall 200 units behind the pivot puts the camera at `min(D, h) - 30` along the view direction; with no hit it sits at `D - 30`.
- Unit, frame (`--client`): PlayerStart10 round-trips through `src/world/sourceFrame.ts` and the presenter within 1e-4 units.
- Unit, boundaries (`tests/unit/importBoundaries.movement.test.ts`): the core imports nothing outside itself except `src/shared/**`, with no @babylonjs or package; src/world never imports the core; `src/**` imports no @recast-navigation/*, @babylonjs/materials or @babylonjs/node-particle-editor outside the lazy inspector entry.
- Unit, constants: every nativeRules.ts id has a rules row with a citation, a runtimeDefault and a shared status, and every confirmed-interlude or corrected-interlude row carries interludeEvidence.
- Browser (Playwright, sandbox, PlayerStart10 and a 20_21 tile): a click into a wall stops the pawn there and the stand-in logs the cannot-move; the Brush397 stairs are climbed and descended; walking off a ledge falls and lands; the camera beside a wall stays in front of it; collision holds across a tile border; withheld collision holds the pawn with a diagnostic (ARCH-03).
- Phase 3, IMPORTA-PC: the same 20_20 clicks end at matching positions in L2.exe and the sandbox within a tolerance written beforehand, and paired upper-landing camera screenshots get a verdict in `docs/parts/movement-geodata/EVIDENCE.md`.
- Phase 4, Mobius: L2.exe captures of MoveToLocation 0x01, ValidatePosition 0x48 and CannotMoveAnymore 0x36 match ours on cadence (+- 50 ms), field layout with the move mode, rounding mode, and positions within a pre-written tolerance.
- Replay: recorded server movement packets drive the adapter and movementPresenter offline at fixed `dt` to a hashed trajectory, and port changes show as reviewed trajectory diffs.
- Overlap: `tools/reference-overlap/` checks `src/scene/world/movement/**` and the collision steps against the reference physics, camera and network-movement files, with identifiers as placeholders, comments stripped and numbers kept. Shared runs of 12 or more tokens go to a reviewer who did not write the code, runs of 20 or more outside the constant allowlist block the merge, and the reviewer signs off in `docs/parts/movement-geodata/EVIDENCE.md`.

## Implementation steps

1. Integration lands the shared modules, `tools/reference-overlap/` and `scripts/native_assets_lib/class_defaults.py`. Requirement: MOVE-01, ARCH-04. Output: Shared modules with tests Check: Their tests pass.
2. Integration lands the contract commit (records and units). Requirement: ARCH-02, NET-04. Output: Record types in `src/world/worldTypes.ts` Check: `gameWorldAdapterContract.test.ts` passes; the five adapter methods are unchanged.
3. World seeds the rules file, the collision gap reasons and `docs/parts/movement-geodata/EVIDENCE.md` with the reference pins (lineage2js 854f629, l2js-core 4aac1bd) and the overlap rule. Requirement: MOVE-01, CHECK-03. Output: Rules file, gap reasons, evidence section Check: The constants test passes with no confirmed row.
4. World: BSPT and VOLS in `scripts/world/collision_bsp.py` through `scripts/world/collision_step.py`, with the three range checks. Requirement: WORLD-08, WORLD-03. Output: `tests/pipeline/test_world_collision_bsp.py` on builder scenarios Check: BSP pipeline and golden acceptance pass; unreadable objects are gap rows.
5. World: SMSH, PLAC and MOVR in `scripts/world/collision_static.py`, with both layouts, the winding check, class-default flags and the EnableCollision cross-check. Requirement: WORLD-08. Output: Static mesh pipeline tests Check: Static mesh acceptance passes.
6. World: TERR in `scripts/world/collision_terrain.py`. Requirement: WORLD-08. Output: Terrain pipeline test Check: Sampled heights match the heightmap through toWorld (`--client`).
7. World registers native-tile-collision in the tile manifest step. Requirement: WORLD-08. Output: Catalog kind Check: A converted tile lists the resource with its hash.
8. World: core collision and MoveActor. Requirement: MOVE-01. Output: `core/collision/` Check: BSP, brush, terrain, cylinder, MoveActor and boundary acceptance pass.
9. World: pawn, control, report and view. Requirement: MOVE-01, MOVE-02. Output: The four core folders Check: Pawn, reporter, correction and camera acceptance pass.
10. World: the Babylon glue with the camera-environment write. Requirement: MOVE-01, WORLD-04. Output: `src/scene/world/movement/*.ts` Check: Frame acceptance passes; the overlay loads only behind `?debug=collision`.
11. Integration: the NativeSliceAdapter stand-in, an EntityRegistry hook so PositionInterpolator serves only entities without movement records, WorldCamera through cameraDriver, and a runtime switch. Requirement: MOVE-01, ARCH-04. Output: Edits behind the switch Check: The switch defaults on after the browser spec passes.
12. Actors read the footstep base from movementPresenter in `src/audio`. Requirement: ARCH-04. Output: Footsteps from the native base Check: Footstep tests pass on terrain, BSP and static mesh bases.
13. World: `tests/browser/world-movement.spec.ts` on a free fleet host. Requirement: WORLD-05, ARCH-03. Output: Browser spec Check: Browser acceptance passes.
14. World and integration: the retirement in the design. Requirement: MOVE-01. Output: Deletions and the package.json edit Check: No `src` import of a retired module remains; boundary acceptance passes.
15. World with a second reviewer runs `tools/reference-overlap/`. Requirement: MOVE-01. Output: EVIDENCE.md sign-off Check: Every flagged run has a verdict; no blocking run remains.
16. Phase 3: side-by-side checks on IMPORTA-PC. Requirement: CHECK-01, CHECK-03. Output: Verdicts in EVIDENCE.md Check: Phase 3 acceptance passes.
17. Phase 4, integration: the packet mapping in `src/world/mobius/**`, with relay-tee captures read at test time and only their hashes committed. Requirement: MOVE-02, NET-04, NET-10. Output: Mapping and capture tests Check: Phase 4 and replay acceptance pass.
18. Phase 5: re-derive every rules row against Engine.dll `4dd2f63c` and Core.dll `9462f87a` with the tools under `.assets/native-tools` (read, never run), MoveActor, stepUp and physWalking first, then falling, backoffs, the trace filter and CalcBehindView. Then run POL-03 on 20_20 for male and female humans. Requirement: POL-04, POL-03. Output: interludeEvidence rows, deviations in EVIDENCE.md, the parity report Check: Confirmed rows cite binary locations; POL-03 passes against a tolerance written before the run.

## Open questions

- Do protocol Z values carry the feet or the cylinder centre? Lineage2JS treats them as feet but adds `H + 10` on teleport, which looks like a centre conversion. Compare a Mobius capture with the floor height.
- Does Interlude L2.exe start moving on click before the CharMoveToLocation echo?
- Does Interlude snap the local player on ValidateLocation, as Lineage2JS does, or correct it smoothly?
- How does Interlude confine each tile's Level BSP near borders when several tiles are loaded and bRootOutside is false?
- Do pawns block the player in Interlude, and do remote players ignore pawns the way NPCs do?
- Should sandbox speeds and cylinders switch from aCis humanFighter.xml to Mobius templates?
- Will the target Mobius server run geodata later? It would then send path segments.
- What is the layout of the 64-byte static mesh triangle block?
- Is the 1000-unit spawn floor probe native? Lineage2JS cites no address for it.
- Is the floor search gap really `12 t` whatever the probe length, and are the hull box offsets really asymmetric?
