# BSP zone and portal visibility

> Reference notes, not decisions. `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md` win where they differ. IDs marked "(proposed)" belong to `plan/autonomous-roadmap` and are not in force until that branch adopts them. Constants with status `unconfirmed` come from C4 binaries and only become native rules after they are re-derived against Interlude. The clean-room, no-vendor and shared-module rules are in [README.md](README.md).

Reference notes, not decisions: `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md` win. These notes describe how a tile's final ULevel.Model decides which BSP sections, static meshes, map emitters and terrain chunks draw from a camera position, and in what order translucent BSP surfaces draw. Lineage2JS (`lineage2js/src/objects/zone-object.ts`) is a behaviour reference with C4-derived and heuristic limits. We convert a hash-pinned per-tile `bsp-visibility` resource, walk it in our own Babylon-free core, and let Babylon only flip render visibility and rewrite translucent index order. Phase 2 ships translucent order on and zone and portal culling off until PERF-02 measures it. Reference rules run as unconfirmed defaults, and unsourced limits run at their most-visible value until Phase 5 re-derives them. Collision and navigation never change.

## Where it fits

- Requirements: VIS-01 (proposed), `WORLD-01`, `WORLD-04`, `WORLD-08`, `PERF-02`, `CHECK-01`, `CONV-02`, `ARCH-01`, `ARCH-02`, `ARCH-03`, `ARCH-04`, `POL-04`
- Phase: Phase 2 (L1 world): census, recipe and zone table, 02-30 addendum, membership, payload, core and binding, with translucent order on and culling off. No Phase 2 step here reads Interlude binaries, because each Phase 2 deliverable shows a visible result on reference or most-visible defaults. Phase 3: CHECK-01 paired screenshots at the recorded poses. Phase 5 (POL-04): static re-derivation of the C4-derived rows against Interlude binaries. Phase 6: PERF-02 measures culling on and off and only then flips the default.
- Lane: World (L1) owns the converter steps, the zone table, the leaf queries, the core, the binding, the recipe, the census and the evidence. Integration owns `src/shared/**`, `src/world/sourceFrame.ts`, `scripts/native_assets_lib/class_defaults.py`, `tools/reference-overlap/`, the transparent comparator and the camera far policy in `src/runtime/`, the sandbox culling switch in `src/runtime/nativeSandboxConfiguration.ts`, runtime snapshot fields under `src/runtime/**` and the tile resource-kind vocabulary (`docs/OUTPUT_CONTRACT.md`, `scripts/native_store/**`). Actors consumes map-emitter visibility in `src/effects/**` (FX-01).

Owned paths:

- `scripts/world/bsp_visibility_census.py`
- `scripts/world/bsp_leaf_membership.py (shared world module)`
- `scripts/world/level_zones.py (shared world module; materials adds its fields)`
- `scripts/world/bsp_visibility_payload.py`
- `scripts/world/bsp_visibility_step.py`
- `scripts/world/convert_tile.py (register --step bsp-visibility)`
- `scripts/world/bsp_chunk_geometry.py and scripts/world/bsp_step.py (02-30 addendum)`
- `scripts/world/tile_manifest_step.py (resource kind bsp-visibility)`
- `recipes/world/bsp-visibility.json`
- `recipes/world/gap-reasons.json (bsp-visibility-* reasons, listVersion bump)`
- `src/scene/world/bspVisibility/core/**`
- `src/scene/world/bspVisibility/bindBspVisibility.ts`
- `src/scene/world/loadNativeTileChunks.ts (attach the binding)`
- `src/scene/world/nativeTileManifest.ts (parse the bsp-visibility resource)`
- `src/scene/world/cameraEnvironment.ts (cameraZone field; shared world module)`
- `docs/parts/world/EVIDENCE.md`
- `docs/parts/world/bsp-visibility-census.json`
- `tests/unit/bspVisibility*.test.ts (shared)`
- `tests/unit/importBoundaries.bspVisibility.test.ts (shared)`
- `tests/pipeline/test_world_bsp_visibility_step.py (shared)`
- `tests/pipeline/support/ (shared Level.Model builder, bsp scenarios)`
- `tests/fixtures/bsp-visibility/** (shared)`
- `tests/browser/world-bsp-visibility.spec.ts (shared)`

## What the reference shows

| Topic | Where | What it shows |
|---|---|---|
| Camera locate and seed zone set | `lineage2js/src/objects/zone-object.ts:796-874`, `lineage2js/src/objects/zone-object.ts:911-954` | Three locate variants, the other-slot fallback and the PVS seed set. |
| Front-to-back walk with pruning | `lineage2js/src/objects/zone-object.ts:1018-1088`, `lineage2js/src/objects/zone-object.ts:1153-1175` | Far, marker, near pushes, conditional zone pruning and the late leaf filter. |
| Inline portal expansion | `lineage2js/src/objects/zone-object.ts:41-42`, `lineage2js/src/objects/zone-object.ts:1090-1151` | Portal range, depth cap, connectivity, frustum and the door rule. |
| Per-frame driver and distances | `lineage2js/src/rendering/render-manager.ts:98-109`, `lineage2js/src/rendering/render-manager.ts:1815-1897`, `lineage2js/src/objects/zone-object.ts:974-1016`, `lineage2js/src/objects/zone-object.ts:1428-1513` | Fog-end far plane, mesh and emitter ranges, the cached outdoor view and leafOnlyMode. |
| Static mesh, emitter and terrain gates | `lineage2js/src/objects/zone-object.ts:1586-1616`, `lineage2js/src/objects/zone-object.ts:1634-1800`, `lineage2js/src/objects/zone-object.ts:1809-1853` | Leaf candidates, frustum, zone and range tests, the emitter list and the terrain test. |
| Membership at decode time | `lineage2js/src/assets/unreal/static-mesh/un-static-mesh-actor.ts:200-212`, `lineage2js/src/assets/unreal/static-mesh/un-static-mesh-actor.ts:344-368`, `lineage2js/src/assets/unreal/un-emitter.ts:230-276`, `lineage2js/src/assets/unreal/model/un-model.ts:270-335`, `lineage2js/src/assets/unreal/model/un-model.ts:675-677`, `lineage2js/src/assets/unreal/un-aactor.ts:275-306`, `lineage2js/src/assets/unreal/decode-library-builder.ts:466-511`, `lineage2js/src/assets/decoders/batch-data.ts:452-489` | Box-leaf query, margin, forced region, emitter point, sky meshes and batch merges. |
| Translucent BSP order | `lineage2js/src/objects/zone-object.ts:1342-1426`, `lineage2js/src/rendering/translucent-render-list.ts:108-135`, `lineage2js/src/rendering/translucent-draw-list.ts:28-90` | Index blocks, the uncull rank pass, the backface rule and the static-mesh interleave. |
| Outdoor mask, frame cache and door portals | `lineage2js/src/objects/zone-object.ts:726-762`, `lineage2js/src/objects/zone-object.ts:1279-1319`, `lineage2js/src/rendering/door-portals.ts:45-94`, `lineage2js/src/objects/movable-object.ts:155-175` | Zone-1 fallback, cache key and geometric door coverage. |
| Extra passes the reference turns on | `lineage2js/src/rendering/render-manager.ts:326`, `lineage2js/src/rendering/render-manager.ts:389-390`, `lineage2js/src/rendering/render-manager.ts:433-435`, `lineage2js/src/rendering/render-manager.ts:470-495`, `lineage2js/src/rendering/sector-occlusion.ts:21`, `lineage2js/src/rendering/sector-occlusion.ts:115-160`, `lineage2js/src/rendering/portal-visibility.ts:10-108`, `lineage2js/src/rendering/batch-angle-visibility.ts:10-58` | Sector occlusion, portal frusta, batch culling and transparent sorting, all on by default. |
| Decode layout | `lineage2js/src/assets/unreal/bsp/un-bsp-node.ts:66-133`, `lineage2js/src/assets/unreal/un-leaf.ts:19-26`, `lineage2js/src/assets/unreal/un-zone-properties.ts:19-29`, `lineage2js/src/assets/unreal/bsp/un-bsp-surf.ts:26-58`, `lineage2js/src/assets/unreal/model/un-model.ts:186-262`, `lineage2js/src/assets/unreal/un-polys.ts:5-52` | Record layouts and UModel field order; iSection read from version 101, unused. |
| Section build and skip flags | `lineage2js/src/assets/unreal/model/un-model.ts:395-532`, `lineage2js/src/assets/unreal/model/un-model.ts:538-608` | Skip set, section key, PF_AddLast group and zero-vertex nodes. |
| l2js-core and path aliases | `l2js-core/src/buffer-value.ts:17-34`, `l2js-core/src/unreal/un-encoded-file.ts:3`, `l2js-core/src/crypto/decryption/decrypt-rsa.ts:1`, `lineage2js/tsconfig.json:8-16` | A package reader with gmp-wasm and pako. @l2js/engine is a tsconfig alias. |

## Behaviour to implement

### Frames and notation

The walk runs in source units (UE2 units, Z up), as README.md defines them. `src/world/sourceFrame.ts` is the only converter: `world = (x, z, y) * 0.01` and `source = (X, Z, Y) * 100`. Render bounds are raw Z-up values (`lineage2js/src/assets/unreal/un-box.ts:105-116`).

A node plane is `(N, W)` with `PlaneDot(P) = N.P - W`, on the plane type in `src/shared/math/`. Node i has these fields.

| Symbol | Field |
|---|---|
| `F_i`, `B_i` | front and back child, -1 for none |
| `C_i` | next coplanar node (iPlane) |
| `L_i[0]`, `L_i[1]` | back and front leaf slots, -1 for solid |
| `Z_i[0]`, `Z_i[1]` | back and front zones |
| `S_i` | subtree zone set (FBspNode.ZoneMask) |
| `R_i` | render bound index into Model.Bounds |
| `(c_i, r_i)` | exclusive sphere |

Zone z has connectivity `K_z` and a class from the zone table. Leaf l has zone `z_l` and PVS mask `V_l` (VisibleZones). A zone set is 64 bits in two uint32 words, and `M` is the frame's zone set.

The camera position is rounded to float32 once per frame with `Math.fround`, as the reference does before locating and sorting (`lineage2js/src/objects/zone-object.ts:800`, `lineage2js/src/rendering/translucent-render-list.ts:112`). Dot products run in float64 on float32 data.

### Point location

1. Start at node 0. Take the front side when `PlaneDot(P) >= 0`, else the back side.
2. While that side's child is >= 0, move to it and repeat.
3. At the terminal node take `L[side]`. When it is -1, take the other slot, as the reference leaf finder does (`lineage2js/src/objects/zone-object.ts:862-870`).
4. The zone is the found leaf's zone. When both slots are -1, the point is in solid space and the zone is `Z[side]`.

The camera, the tests and the converter all use this rule: `regionLocate.ts` in the core and `point_region` in `scripts/world/bsp_leaf_membership.py`. The reference has three variants with different ties (`lineage2js/src/objects/zone-object.ts:796-874`), and its leaf finder steps into the back child when `PlaneDot` is exactly 0 and the front child is missing. We do not copy that, and F1 pins our tie.

This is zone locate, not PointCheck. [03-movement.md](03-movement.md) keeps the collision PointCheck, which goes front only when `d > 0` and decides solidity by the outside-bit walk from bRootOutside. They are separate native routines with their own fixtures (F1 and F15 here) and stay unmerged without Interlude evidence. The S1 census cross-checks their solid regions.

### Seed zone set

Let z and l be the camera zone and leaf. Start with `M = {z}`. When `V_l` is neither 0 nor all-ones, set `M = (V_l AND K_z) OR {z}`, and use `V_l` alone when `K_z` is 0 (`lineage2js/src/objects/zone-object.ts:926-948`). An invalid PVS never falls back to connectivity, because reachability is not visibility. A tile with no nodes or no leaves shows everything, as the reference returns all zones there (`lineage2js/src/objects/zone-object.ts:912-924`).

### Portal expansion

The converter lists portal nodes: nodes whose surface has PF_Portal (0x04000000) and `Z[0] != Z[1]`. Before the walk:

1. Give every zone in the seed set depth 0.
2. For d = 0, 1, 2 and so on, test every portal j. The camera-side zone c is `Z_j[1]` when `PlaneDot_j(camera) > 0`, else `Z_j[0]`. The far zone o is the other one. The portal opens when all of these hold:
   - c is in M with depth d, and o is not in M;
   - with frustum tests on, the sphere `(c_j, r_j)` passes;
   - `|camera - c_j| <= Rp + r_j`;
   - o is in `K_c`, or `K_c` is 0;
   - `d + 1 < Dmax`.
   Opening adds o with depth d + 1.
3. Stop after a round that adds nothing: at most 64 rounds, each O(portals).

Rp and Dmax default to infinity. The reference uses 5000 and 4 and tests portals inline, only with a valid camera zone, outside leafOnlyMode and for far zones below 64 (`lineage2js/src/objects/zone-object.ts:41-42,1090-1151`). Our pass gives each zone its smallest depth regardless of node order, so it can only show more.

Door occlusion is a later step. The reference closes a portal only when c is outdoor, o is not, the node is blocked and `|PlaneDot(camera)| > r_j` (`lineage2js/src/objects/zone-object.ts:1117`). A blocker is a non-interpolating mover with L2ServerObjectRealID > 0 whose world box meets the portal sphere (`lineage2js/src/objects/movable-object.ts:155-175`). Its visible, opaque, depth-writing, non-alpha-tested triangles within `r_j` of the portal plane are projected onto the dominant axis plane and subtracted from the portal polygon until nothing is left (`lineage2js/src/rendering/door-portals.ts:45-94`). No 'closed' state is read.

### Front-to-back walk

Use an explicit stack with two entry kinds, descend(i) and emit(i), and start with descend(0).

1. descend(i): skip the subtree when `S_i != 0` and `S_i AND M` is 0. With frustum tests on, also skip it when `R_i >= 0`, that bound's valid flag is 1 and the box lies wholly outside one plane.
2. Let `s = PlaneDot_i(camera)`. The near child is `F_i` when `s > 0`, else `B_i`. Push the far side first: descend into it, or collect its leaf slot when the child is -1. Then push emit(i), then the near side the same way. The pops run near subtree, node, far subtree.
3. A collected slot >= 0 marks that leaf reached.
4. emit(i) follows i, `C_i` and so on. Node k is visible when `nodeSection[k] >= 0` and, with frustum tests on, its sphere passes.
5. A leaf is visible when it was reached and `z_l` is in M (`lineage2js/src/objects/zone-object.ts:1167-1171`). A section is visible when any visible node maps to it. As in the reference, visible nodes get no zone filter.

The reference also prunes a subtree whose `S_i` is 0 when its render bound is valid, and prunes by zone only with a valid camera zone (`lineage2js/src/objects/zone-object.ts:1037,1045-1048`). We never prune on an empty mask and record that as a deviation.

### Static mesh members

Conversion, per placement:

1. Transform the 8 corners of the mesh's render bounding box by the placement's source matrix (`lineage2js/src/assets/unreal/static-mesh/un-static-mesh-actor.ts:207`).
2. Grow each side by 5 percent of the half extent (`lineage2js/src/assets/unreal/static-mesh/un-static-mesh-actor.ts:344-346`, half extent per `lineage2js/src/assets/unreal/un-box.ts:20`).
3. Run a box query from node 0 with center p and half extent h. Let `d = PlaneDot(p)` and `e = |N.x h.x| + |N.y h.y| + |N.z h.z|`. When `d < e`, descend into the back child, or collect `L[0]` when that child is -1 and the slot is not -1. When `-d < e`, do the same on the front with `L[1]` (`lineage2js/src/assets/unreal/model/un-model.ts:270-303,675-677`).
4. When ForcedRegionTag is not None, keep the leaves whose zone actor's ZoneTag matches it, ignoring case. Otherwise, when ForcedRegion is not 0, keep the leaves in that zone (`lineage2js/src/assets/unreal/model/un-model.ts:319-335`, `lineage2js/src/assets/unreal/un-aactor.ts:304-306`).
5. The zone set is the OR of the kept leaves' zones.
6. A placement whose own zone is a sky zone is flagged sky and left to the sky step (`lineage2js/src/assets/unreal/decode-library-builder.ts:478`).

At runtime a member flagged sky is always visible. Any other member is visible when all three hold:
- its leaf list is empty, or one listed leaf is visible;
- its zone set is 0 or meets M;
- its range is ignored, or `|center - camera|^2 <= Rsm^2`.

Rsm defaults to infinity (`lineage2js/src/objects/zone-object.ts:1589-1616`), and Babylon's per-mesh culling does the box frustum test. The reference admits leafless unbatched actors only when the camera has no leaf and merges batches (`lineage2js/src/objects/zone-object.ts:1668,1784`, `lineage2js/src/assets/decoders/batch-data.ts:452-489`). We always admit leafless members and keep one entry per placement.

### Map emitters and terrain

Map emitters are the tile's placed Emitter actors from the world-lane export ([04-particles.md](04-particles.md), step 12). Membership runs the box query with half extent 0 at the origin (`lineage2js/src/assets/unreal/un-emitter.ts:250-271`). An origin exactly on a plane or in solid space collects no leaf, so its zone set is 0 and it is never zone gated (`lineage2js/src/objects/zone-object.ts:1819`).

The walk owns zone and range gating of map emitters. An emitter is visible when its zone set is 0 or meets M, and its range is ignored (bIgnoredRange, `lineage2js/src/assets/unreal/un-emitter.ts:237`) or `dx^2 + dy^2 < Rem^2` on the horizontal distance. Rem defaults to infinity. The strict test follows the cited C4 rule (`lineage2js/src/rendering/render-manager.ts:1893`), while the reference zone pass uses `<=` (`lineage2js/src/objects/zone-object.ts:1826`).

Emitters have no leaf gate, since the reference runs them from their own list (`lineage2js/src/objects/zone-object.ts:1593,1809-1850`). The FX-01 scheduler reads `memberVisible` by placement id and adds only the frustum test. Emitters attached to actors are not tile members and are never gated (`lineage2js/src/rendering/render-manager.ts:1881-1895`).

Terrain chunks of the camera tile are visible when M meets the outdoor set (`lineage2js/src/objects/zone-object.ts:1852`).

### Outdoor view and other tiles

The camera tile is the resident tile whose source XY cell contains the camera. Every other resident tile uses the outdoor view, and so does the camera tile while the camera is in solid space. In the outdoor view:
- M is the outdoor set;
- a node is visible when `nodeSection >= 0` and its front zone `Z[1]` is in the outdoor set;
- a leaf is visible when its zone is in the outdoor set;
- members use the rule above with that M;
- terrain is visible.

The outdoor set is the outdoor class plus the zone-1 fallback: when only zone 0 qualifies, zone 1 joins (`lineage2js/src/objects/zone-object.ts:732-738`). The reference section flag uses the same front zone without the fallback (`lineage2js/src/assets/unreal/model/un-model.ts:462,495`). The result is constant per tile, so it is computed once. Babylon's per-mesh frustum culling replaces the reference's neighbour-sector sphere and fog-sphere tests (`lineage2js/src/objects/zone-object.ts:1509-1513`, `lineage2js/src/rendering/render-manager.ts:1849-1877`).

### Translucent BSP order

For each translucent section the converter stores blocks of (section, node, firstIndex, indexCount). Rank every node with a traversal from node 0 that ignores culling. At node i with `PlaneDot_i(camera) > 0`, visit the back subtree, then rank the chain i, `C_i`, ... in reverse chain order, then visit the front subtree. With `PlaneDot_i(camera) <= 0`, mirror this. Draw blocks in ascending rank.

This matches the reference prepend rule (`lineage2js/src/objects/zone-object.ts:1368-1399`). Recompute only when the camera moved and a translucent section of the tile is visible, and rewrite indices only when the order changed (`lineage2js/src/objects/zone-object.ts:1372-1373,1406-1424`).

Between meshes, one integration-owned comparator in `src/runtime/` (`scene.setRenderingOrder`) sorts by distance, then by a per-actor emitter ordinal, and no area sets an absolute `alphaIndex`. The reference interleave of translucent static-mesh parts with BSP blocks stays deferred (`lineage2js/src/rendering/translucent-draw-list.ts:28-90`). The reference backface skip (see constants) waits for Interlude confirmation, so material sidedness decides (`lineage2js/src/rendering/translucent-render-list.ts:119,131`).

### Frustum, cache and the culling switch

The pose gives six source-space planes `(n, d)`, with `n.x + d >= 0` inside. Orient each plane so that a point on the view axis between near and far is inside, which makes the XZY reflection harmless.
- Sphere test: `n.c + d >= -r` for every plane.
- Box test: for each plane take the corner furthest along n. The box is outside when `n.p + d < 0` for any plane.

Far is the camera maxZ, or infinity when maxZ is 0. MAT-01 exports `fogEnd` per frame, and integration code in `src/runtime` or `src/camera` decides whether maxZ follows it ([01-materials-fog.md](01-materials-fog.md)).

The cache skips a frame when the float32 camera position, the six planes, the flags, the resolved constants, the residency generation and the door generation all equal the last frame. The reference's extra environment and time-step keys feed only its lighting (`lineage2js/src/objects/zone-object.ts:1279-1319`).

With culling off, point location still runs for `cameraZone`, and translucent order still runs. Seed, expansion and walk do not run, and every section, member and terrain chunk stays visible. The reference has no matching mode: its frustum switch bypasses the member, emitter and terrain zone gates but still prunes BSP by zone (`lineage2js/src/objects/zone-object.ts:1602-1603,1679-1680,1788-1790,1819,1852`).

## Data inputs

| Input | Produced today by | Gap |
|---|---|---|
| Level.Model arrays: node plane, ZoneMask, iFront, iBack, iPlane, iRenderBound, exclusive sphere, iZone, iLeaf, NumVertices, iVertPool, iSurf, node lightmap index; surf flags; zones (actor, connectivity); Model.Bounds; leaves (zone, VisibleZones); verts and points for portal polygons. | The vendored reader on native-world-slice. 02-30 plans `scripts/world/level_model.py` `read_level_model` around it, the one loader for this step and the collision step. | Only version 123 with licensee >= 23 is admitted, so version-118 maps and other licensees are per-tile gaps. The vendored checks miss iRenderBound, iCollisionBound and the LeafHulls runs. |
| Zone table: outdoor class, bSunAffect provenance, sky class. | None. `scripts/native_map.py` `actor_properties` (:92) and `property_value` (:164) read serialized properties, and 02-30 plans `sky_zone_indices`. | Nothing reads bSunAffect. `scripts/world/level_zones.py` builds the table once for this step, MAT-01 and MAT-02. |
| Node-to-primitive index ranges and the section table. | 02-30 `bsp_chunk_geometry.py` and `bsp_step.py` (planned), grouped by material per chunk. | No per-node range, no section table and no key beyond material. The 02-30 addendum adds all three. |
| Lightmap texture per node (FLightmapIndex.iLightmapTexture). | The vendored reader decodes the node lightmap index but not the lightmap tail. The MAT-02 lightmap decode ([01-materials-fog.md](01-materials-fog.md)) adds FLightmapIndex records. | The section key needs it in Phase 2. |
| Static mesh placements: id, exportIndex, source matrix, render bounding box, ForcedRegionTag, ForcedRegion, bIgnoredRange. | 02-29 `static_mesh_step.py` and `createNativeModelPlacements` (planned); `Placement.matrix` in the 20_20 section manifest (`src/scene/world/loadNativeSection.ts`). | No source box and no forced-region or range-ignored read. The box comes from the serialized UStaticMesh bounds, else from converted positions mapped back to source units. |
| Map emitter placements: id, exportIndex, source origin, bIgnoredRange. | The planned world-lane Emitter actor export ([04-particles.md](04-particles.md), step 12). | Membership consumes that export and reads nothing else. |
| Far distance. | Camera maxZ only. `src/runtime/createNativeSliceRuntime.ts:853` reports `scene.fogEnd`, and no converter reads DistanceFogEnd. | MAT-01 exports `fogEnd`, and integration decides whether maxZ follows it. |
| Door portal coverage: mover geometry and server door state. | The 02-31 mover step (planned). Door state arrives only through the adapter (ARCH-01, ARCH-02). | Deferred step. |
| Camera tile choice: each resident tile's source XY cell. | The tile manifest frame (02-16) and the 4x4-sector chunk planner (02-15). | `asset.json` carries `tileCell`. |
| Recorded 20_20 poses and expected index sets. | `recipes/native-map-debug-location.json` gives the PlayerStart10 context. `scripts/native_bsp_building.py` extracts the Brush610 command hall. | `tests/fixtures/bsp-visibility/20_20-path.json` is still to write: three poses (PlayerStart10 outdoors, the hall interior facing the doorway, the interior facing a wall), indices and hashes only. |

## Constants

| ID | Value | Provenance | Status | Runtime default |
|---|---|---|---|---|
| pf-portal | `0x04000000` | `lineage2js/src/assets/unreal/un-polys.ts:23`; `lineage2js/src/objects/zone-object.ts:1096-1102` | unconfirmed | `0x04000000`, with `Z[0] != Z[1]` |
| visual-skip-set | reference skips PF_Invisible 0x1, PF_Portal, PF_FakeBackdrop 0x80 and PF_Unused2 0x2000, and draws PF_AntiPortal 0x08000000 | `lineage2js/src/assets/unreal/model/un-model.ts:451-457` (Unused2 'seems invisible', AntiPortal from a C4 ToI 23_18 observation) | unconfirmed | the rows of `recipes/world/bsp-poly-flags.json` (02-30) |
| water-sheet-flag | PF_Unused5 `0x00080000` | `lineage2js/src/assets/unreal/model/un-model.ts:58` (C4 L2.water.trace); `lineage2js/src/rendering/translucent-render-list.ts:131` | unconfirmed | not used as a rule |
| translucent-class | reference: surf flags AND PF_AddLast (`PF_Semisolid 0x20 \| PF_NotSolid 0x08 = 0x28`) | `lineage2js/src/assets/unreal/model/un-model.ts:478`; `lineage2js/src/assets/unreal/un-polys.ts:50` | unconfirmed | the material route's blend flag; the census counts disagreements |
| section-key | reference: PF_AddLast group, material, `PF_Unlit \| PF_Selected \| PF_TwoSided`, lightmap texture, outdoor class and sky zone of `Z[1]` | `lineage2js/src/assets/unreal/model/un-model.ts:462-497` | unconfirmed | material, PF_Unlit, lightmap texture, outdoor class of `Z[1]` |
| translucent-backface | with camera zone != 0, skip a block with `PlaneDot(camera) <= 0` unless TwoSided 0x100, Portal or Unused5 | `lineage2js/src/rendering/translucent-render-list.ts:119,131` (cites C4 1064bd0b..1064bd27) | unconfirmed | not applied; material sidedness decides |
| translucent-prepend | translucent nodes prepended during the front-to-back walk, so they draw back to front with coplanar chains reversed | `lineage2js/src/objects/zone-object.ts:1368-1399` (cites C4 0x1064d596, 0x106523ec) | unconfirmed | on |
| max-zones | 64 | NumZones check in `scripts/vendor/lineage2elbera_bsp/__init__.py` (native-world-slice); `lineage2js/src/assets/unreal/model/un-model.ts:54` | ue2-data | 64 |
| index-none | -1 (no child, solid leaf slot, no render bound) | `lineage2js/src/assets/unreal/bsp/un-bsp-node.ts:127`; nullable index checks in `validate_model` | ue2-data | -1 |
| plane-equation | `PlaneDot(P) = N.P - W`, FPlane stored XYZW with unit normals | `lineage2js/src/objects/zone-object.ts:1057`; unit-length checks in `_read_model` and `validate_model` | ue2-data | same |
| locate-tie | `PlaneDot >= 0` goes front; an empty camera-side leaf slot falls back to the other slot | `lineage2js/src/objects/zone-object.ts:805,862-870` | unconfirmed | same |
| walk-near-side | `PlaneDot > 0` makes the front child the near child | `lineage2js/src/objects/zone-object.ts:1058,1392` | unconfirmed | same |
| camera-float32 | camera rounded with `Math.fround` before locating and sorting | `lineage2js/src/objects/zone-object.ts:800`; `lineage2js/src/rendering/translucent-render-list.ts:112`; `lineage2js/src/rendering/translucent-draw-list.ts:36` | unconfirmed | on |
| portal-depth-cap | reference 4 (`newDepth < 4`) | `lineage2js/src/objects/zone-object.ts:41-42,1143` (claims a UE2 match, no address) | unconfirmed | infinity, bounded by 64 zones |
| portal-range | reference 5000 units plus sphere radius, 3D distance | `lineage2js/src/objects/zone-object.ts:1112-1115` (no native source) | unknown | infinity |
| emitter-range | `GL2ActorCR * 32768 * 0.0625 = GL2ActorCR * 2048`, horizontal distance, strict `<` | `lineage2js/src/rendering/render-manager.ts:98-99,1835-1836,1893` (cites C4 AEmitter::Render 0x8a2ae0) | unconfirmed | infinity; the only emitter range row |
| static-mesh-range | reference fog far times 1 (marked TODO) | `lineage2js/src/rendering/render-manager.ts:1830-1833` | unknown | infinity |
| far-plane | fog end replaces the far plane; DEFAULT_FAR 65536 without fog | `lineage2js/src/rendering/render-manager.ts:107,1818-1828` (cites C4 Core.dll FAR_CLIPPING_PLANE 0x101cff8c) | unconfirmed | camera maxZ, infinity when maxZ is 0 |
| default-fov | horizontal 60 degrees (user.ini DefaultFOV) | `lineage2js/src/rendering/render-manager.ts:109` | unconfirmed | the browser camera's fov and fovMode |
| outdoor-class | zone 0 plus zones whose ZoneInfo has bSunAffect (reference property name) | `lineage2js/src/objects/zone-object.ts:732-736`; `lineage2js/src/assets/unreal/un-aactor.ts:279`; `lineage2js/src/assets/unreal/model/un-model.ts:495` | unconfirmed | same; an unresolved zone counts as outdoor and is listed |
| outdoor-zone1-fallback | when only zone 0 qualifies, zone 1 joins the visibility outdoor set | `lineage2js/src/objects/zone-object.ts:738` | unknown | on, visibility outdoor set only |
| static-mesh-margin | 5 percent of the half extent on each side | `lineage2js/src/assets/unreal/static-mesh/un-static-mesh-actor.ts:344-346`; `lineage2js/src/assets/unreal/un-box.ts:20` | unknown | 5 percent |
| emitter-extent | zero-extent box at the origin; an on-plane or solid origin gives an empty, ungated zone set | `lineage2js/src/assets/unreal/un-emitter.ts:250-271` | unconfirmed | same |
| small-batch-angle | visible when `size^2 / 4 >= dist^2 * sin^2(angle / 2)`, run at 5 degrees | `lineage2js/src/rendering/batch-angle-visibility.ts:19-24,51`; `lineage2js/src/rendering/render-manager.ts:434` | unknown | not adopted |
| near-translucent-sort-radius | 8192 units, static-mesh batches only | `lineage2js/src/rendering/sorted-index-buffer.ts:20`; `lineage2js/src/objects/zone-object.ts:1761-1777` | unknown | not adopted |

## Interlude differences

| Item | Detail | How to confirm |
|---|---|---|
| Package layout | The reference reads the same node, leaf and zone bytes. Its licensee >= 23 FBspSurf int32 is our lightmap index, and its two spheres are our exclusive sphere plus the reserved span, which it uses only in a debug visualizer (`lineage2js/src/rendering/visualizer.ts:897,1169`). | Phase 2 census on every eligible tile. Other layouts become `bsp-visibility-layout-unsupported:<ver>/<lic>`. |
| C4-derived rules | Every native citation in the reference points at the C4 Engine.dll (fa3f0f2a...) or C4 Core.dll, as the constants rows show. The depth cap and the 5000 range have no address. | Phase 5 (POL-04): static reading of Interlude Engine.dll 4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08 or Core.dll 9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf. Binaries are read, never run. The address goes in `interludeEvidence` and `docs/parts/world/EVIDENCE.md` before status and runtimeDefault change. |
| PVS masks | If Interlude leaves carry only all-ones masks, the seed set is the camera zone alone and portals do all the work. | The census PVS histogram (zero, all-ones, partial) per tile. |
| PolyFlags meanings | PF_Unused2 invisible, PF_Unused5 water sheet, PF_AntiPortal drawn and the PF_AddLast class come from C4 data only. | A `recipes/world/bsp-poly-flags.json` row with an Interlude source line per flag. An unsourced bit stays a gap row (`bsp-poly-flag-unsourced:<hex>`, 02-30's reason). |
| Client range and actor properties | GL2ActorCR and the static mesh [ClippingRange] come from the C4 option set. The reference reads bSunAffect (not bSunAffected), ForcedRegionTag, ForcedRegion, ZoneTag and bIgnoredRange as serialized properties with no class-default fallback. | The Interlude L2.ini or option tables, and Engine.Actor and ZoneInfo defaults through `class_defaults.py`. The census counts serialized uses. Ranges stay infinite until found. |
| Camera in solid space | The reference uses a leaf-1 heuristic. We use the outdoor view. | A CHECK-01 pair with the camera clipped into a wall. |

## Do not copy

- The leaf-1 heuristic for a camera with no leaf (`lineage2js/src/objects/zone-object.ts:1002-1016`). Use the outdoor view.
- Inline, order-dependent portal expansion and its 5000 and 4 limits as defaults (`lineage2js/src/objects/zone-object.ts:41-42,1090-1151`).
- Sky-zone detection by the zone actor's Tag string (`lineage2js/src/assets/unreal/model/un-model.ts:466`). Use the class.
- The dead paths `updateVisibleBSPSections` (`lineage2js/src/objects/zone-object.ts:1179-1252`) and `updateVisibleStaticMeshActors` (`:1963-2067`). The live pass is `updateVisibility` (`:1428-1854`).
- The stale 'swizzled' bounds comment (`lineage2js/src/assets/unreal/decode-library.ts:141`).
- C4-only PolyFlags readings used as rules (`lineage2js/src/assets/unreal/model/un-model.ts:58,451-457`). `recipes/world/bsp-poly-flags.json` wins.
- Reference output as a culling-free ground truth. Its renderer runs sector occlusion, portal frusta and 5-degree batch culling by default (`lineage2js/src/rendering/sector-occlusion.ts:21`, `lineage2js/src/rendering/render-manager.ts:434-435`).
- Comments that cite UE2 engine source files (`lineage2js/src/objects/zone-object.ts:690,1043`, `lineage2js/src/assets/unreal/model/un-model.ts:57,490`, `lineage2js/src/assets/unreal/un-emitter.ts:247`). Do not seek or use that source.
- The conclusion that iSection is meaningless because the reference ignores it (`lineage2js/src/assets/unreal/bsp/un-bsp-node.ts:110`). Our reader documents it as a measured link.
- Per-frame console logging of zone and leaf changes (`lineage2js/src/objects/zone-object.ts:1460-1471`).

## Our code today

On native-world-slice (22de53a):
- Reader: `scripts/vendor/lineage2elbera_bsp/__init__.py`, in-repo world-owned converter code (MIT, Elbera 12c9656, pinned in `SOURCE.json`). `_read_model` decodes every node field listed under data inputs plus flags, iCollisionBound, a 16-byte reserved span, i_section and i_vert_offset. It also decodes surfs, verts, zones, Model.Bounds (6 floats and a valid byte), leaf hulls, leaves, lights and RootOutside, but not the render-section and lightmap tail.
- Checks: `validate_graph` rejects cycles, range-checks iFront, iBack and iPlane, and counts nodes reachable from 0. `validate_model` checks iSurf, the vertex pool, iLeaf and iZone, not iRenderBound. `level_model_binding` admits file 123 with licensee >= 23, and 20_20 is 123/28.
- Extractors: `scripts/native_bsp_floor.py` (Brush397 of 20_20) and `scripts/native_bsp_building.py` (Brush610 command hall), staged by `scripts/derive-native-map-bsp.py` (integration).
- Runtime: `src/scene/world/nativeBspResources.ts` whitelists 4 resources, Brush397 and three Brush610 parts. `src/scene/world/loadNativeSection.ts:96-113` validates them and `:309-320` loads them. `src/scene/world/nativeBspSupport.ts` adds walking support.
- Visibility is Babylon per-mesh frustum culling only. Nothing models zones, PVS, portals, memberships or translucent order, and nothing uses `setRenderingOrder`, `alphaIndex`, `updateIndices` or occlusion queries.
- `src/entities/attachTargeting.ts` uses the default `scene.pick` for door hover, door activation and click-to-walk on `worldSupportsWalking` meshes.
- `scripts/native_catalog/effects.py:264` `read_class_defaults` (data-ui) returns authored values only, through a pinned UELib binary.
- Navigation is `src/world/meshNavigation.ts` here and imports Babylon. On plan/autonomous-roadmap (56bf9f7) it is `src/scene/navigation/meshNavigation.ts`, with `tests/unit/importBoundaries.test.ts`.
- `scripts/world/` exists on neither ref. 02-30 plans `level_model.py`, `bsp_chunk_geometry.py` and `bsp_step.py`, and 02-16 plans `loadNativeTileChunks.ts`, `nativeTileManifest.ts` and `nativeTileChunkManifest.ts`.
- Existing tests: `tests/pipeline/test_native_bsp_floor.py`, `test_native_map_bsp.py`, `test_native_bsp_building.py` and `tests/unit/nativeBspSupport.test.ts`.

## Design

### Converter (world lane, offline Python)

`scripts/world/bsp_leaf_membership.py` holds `point_region(model, point)` and `box_leaves(model, center, half_extent)`, written fresh with an iterative stack and shared with the MAT-02 lighting step and the map Emitter export. `scripts/world/bsp_visibility_step.py` holds `run_bsp_visibility_step(project_root, client_root, tile_id)` and `BSP_VISIBILITY_STEP_ALGORITHM_VERSION`.

`convert_tile.py --step bsp-visibility` runs after `bsp`, `collision` and the map Emitter export, and before `manifest`. It writes one tile-level resource of kind `bsp-visibility`, because the tree spans the tile while geometry is per chunk. It reads the Level.Model through `scripts/world/level_model.py` `read_level_model` and reaches client bytes only through `client_root` and the raw-step receipts.

The zone table (`level_zones.py`) has one row per zone: outdoor class, bSunAffect with its provenance, sky class, and the ambient and fog fields materials adds. bSunAffect comes from the serialized ZoneInfo property, else from `scripts/native_assets_lib/class_defaults.py`, which walks the class chain and tags each value authored, class-default or ue-zero. An unresolved zone counts as outdoor and is listed. The sky class comes from 02-30's `sky_zone_indices`. The zone-1 fallback lives once, in `recipes/world/bsp-visibility.json`, for the visibility outdoor set only.

The payload is one `.l2asset` with `asset.json`, written by `scripts/world/typed_payload.py`. The container records units (source), axes (UE2 Z up), the source SHA-256, the converter version and the named, typed, 4-byte aligned little-endian arrays. The kind is `native-tile-bsp-visibility` v1, with area fields `{tileId, sourceMap, modelExport, readerSha256, recipeSha256, algorithmVersion, tileCell, counts, sections: [{id, chunkId, primitive, translucent}], members: [{id, kind, exportIndex}], constants, gaps}`.

| Group | Arrays |
|---|---|
| Nodes | `nodePlane` f32x4, `nodeFront`, `nodeBack`, `nodeCoplanar` i32, `nodeLeaf` i32x2, `nodeZone` u8x2, `nodeZoneSet` u32x2, `nodeRenderBound` i32, `nodeSphere` f32x4, `nodeSection` i32 |
| Bounds | `bounds` f32x6, `boundValid` u8 |
| Leaves | `leafZone` u8, `leafPvs` u32x2 |
| Zones | `zoneConnectivity` u32x2, `zoneClass` u8 (outdoor, sky and unresolved bits) |
| Portals | `portalNodes` i32 |
| Members | `memberCenter` f32x3, `memberZoneSet` u32x2, `memberFlags` u8 (range ignored, sky, emitter), `memberLeafStart` u32 (count + 1), `memberLeaves` i32 |
| Translucent | `translucentBlocks` i32x4 (section, node, firstIndex, indexCount), sorted by section then firstIndex |

The writer rejects a zone >= 64, a non-monotonic leaf CSR, and an iRenderBound outside `[-1, boundCount)`, an iCollisionBound or a LeafHulls run out of range. The last three go through one range check in `level_model.py` that the collision writer also calls.

New gap reasons go into `recipes/world/gap-reasons.json` with a `listVersion` bump: `bsp-visibility-model-unreadable`, `bsp-visibility-layout-unsupported:<ver>/<lic>`, `bsp-visibility-render-bound-out-of-range`, `bsp-visibility-section-unmapped`, `bsp-visibility-solid-mismatch`, `bsp-visibility-feature-unported:PF_TwoSided` and `bsp-visibility-payload-invalid:<ErrorName>`. Per member, `bsp-visibility-member-bounds-missing` leaves that member always visible.

`recipes/world/bsp-visibility.json` holds one row per constant in the shared shape `{id, value, provenance, status, interludeEvidence, runtimeDefault}` (README.md), with `interludeEvidence` as `{binarySha256, exportOrVa, offset}` or null. It also holds one row per deviation, with its reference line.

### 02-30 addendum and section key

02-30 groups nodes by material per chunk (`.planning/phases/02-stage-a-breadth/02-30-PLAN.md:160`), excludes skip-flag and sky-zone nodes (`:153`) and records `{resource, sha256, bytes, nodeCount, triangleCount, materials}` per chunk (`:300`). That record cannot address one node, and its sections mix lightmaps and zone classes that MAT-02 lights apart.

The addendum changes `bsp_chunk_geometry.py` and `bsp_step.py`:
1. Group nodes per chunk by the section key: material, the PF_Unlit bit, lightmap texture and outdoor class. Lightmap texture is `Lightmaps[nodeLightmap].iLightmapTexture`, or -1 when the node has none. Outdoor class is the zone-table class of the front zone `Z[1]` (`lineage2js/src/assets/unreal/model/un-model.ts:462,476-482,495`).
2. Keep each node's triangles contiguous.
3. Export `sections: [{primitive, material, unlit, lightmap, outdoor, translucent}]` and `nodeRanges: [{node, primitive, firstIndex, indexCount}]` per chunk.
4. Bump `BSP_STEP_ALGORITHM_VERSION`.

The translucent flag comes from the material route. A node with no range, including a zero-vertex node (`lineage2js/src/assets/unreal/model/un-model.ts:516-517`), gets `nodeSection = -1`. Until the MAT-02 lightmap decode lands, lightmap texture is -1 for every node, and the version bumps again when it lands.

The reference key also splits on PF_Selected, PF_TwoSided, the PF_AddLast group and the sky zone (`lineage2js/src/assets/unreal/model/un-model.ts:478,491-497`). Sky-zone nodes never reach a chunk, and PF_Selected is an editor flag. Sidedness and translucency come from the material route. The census counts sections whose nodes disagree on PF_TwoSided, and any count above 0 gives that tile `bsp-visibility-feature-unported:PF_TwoSided`.

`recipes/world/bsp-poly-flags.json`, built from the pinned Elbera `tools/world/bsp.py` (`02-30-PLAN.md:158`), decides the skip set. The reference set is comparison data only. `i_section` is not the key: the vendored reader documents it as a measured link to the undecoded retail render section table, and the census records its range.

### Runtime core

`src/scene/world/bspVisibility/core/` imports no `@babylonjs/*`, no package and no DOM global. Outside the folder it may import only `src/shared/**`. `tests/unit/importBoundaries.bspVisibility.test.ts` enforces this through `tests/support/staticImportGraph.ts`.

Modules:
- `payload.ts`: wraps `src/shared/typedPayload.ts` and adds area guards on counts, index ranges, root 0, zones < 64, CSR order and SHA, each with a named error;
- `zoneSet.ts`: two-word zone sets;
- `viewFrustum.ts`: six planes from a pose, sphere and box tests, built on `src/shared/math/`;
- `regionLocate.ts`, `zoneExpansion.ts`, `treeWalk.ts`, `outdoorView.ts`, `memberVisibility.ts`, `translucentOrder.ts`: one mechanism each;
- `tileVisibility.ts`: per-tile state and the frame cache.

The input is `ViewPose {position, forward, up, fovY, aspect, near, far}` in source units, with options `{culling, frustum, portalRange, depthCap, staticRange, emitterRange}` from the payload constants. The output is `TileVisibilityFrame {cameraZone, zoneSet, sectionVisible: Uint8Array, memberVisible: Uint8Array, terrainVisible, translucentOrder: Map<section, Int32Array>, changedSections, changedMembers}`. Map emitters are members of kind emitter, so one array serves both. `cameraZone` is the located zone, or -1 when the camera tile has no valid resource.

### Babylon binding

`loadNativeTileChunks.ts` creates `bindBspVisibility.ts` for each resident tile with a valid resource. The binding maps section ids to chunk primitive meshes and member ids to placement roots from 02-29, and registers its own per-frame observer. It builds the pose from `camera.globalPosition`, `getDirection`, `fov` with `fovMode`, `engine.getAspectRatio(camera)`, `minZ` and `maxZ`, converted through `src/world/sourceFrame.ts`. It skips scene matrices, because `useLargeWorldRendering` is on (`src/engine/createWebGPUEngine.ts:63`).

- It applies only deltas, through `isVisible`, and never calls `setEnabled`, which residency owns.
- Collision does not change: meshNavigation filters by vertex count and `metadata.worldCollision` only (`src/scene/navigation/meshNavigation.ts:158,175` on plan/autonomous-roadmap), and MOVE-01's collisionWorld ([03-movement.md](03-movement.md)) queries converted collision resources.
- Picking changes for hidden meshes, since Babylon 9.27.1's default pick needs `isEnabled`, `isVisible` and `isPickable` (`@babylonjs/core/Culling/ray.core.js:701,774`). `src/entities/attachTargeting.ts` uses it for door hover, door activation and targeting. When culling hides nothing on screen, a pick changes only where the ray hits a mesh not drawn at that pixel, and the pick-grid test guards this. A targeting predicate is an integration edit. After MOVE-01, click-to-walk uses clickTrace, not `scene.pick`.
- Translucent order needs an unshared `Mesh`. `AbstractMesh.setIndices` and `updateIndices` are no-op stubs (`@babylonjs/core/Meshes/abstractMesh.pure.js:1169,2291`), while `Mesh.updateIndices` works (`@babylonjs/core/Meshes/mesh.pure.d.ts:811`). `Geometry.updateIndices` makes a non-updatable buffer updatable on first use (`@babylonjs/core/Meshes/geometry.js:438-450`), and clones share Geometry. The binding refuses a translucent section with shared geometry or a non-Mesh, reports it and keeps file order. It never sets `alphaIndex`.
- The camera tile's binding writes `cameraZone` into `src/scene/world/cameraEnvironment.ts` every frame, with culling on or off, and that record carries it to the MAT-01 fog globals.
- Terrain chunk meshes of the camera tile follow `terrainVisible`.
- FX-01 in `src/effects` (actors) reads map-emitter visibility by placement id and owns emitter display, simulation and the frustum test.
- The tile loader's `inspection()` gains `bspVisibility {tileId, culling, cameraZone, zones, portals, finalZoneSet, visibleSections, hiddenSections, cacheHits, translucentOrderErrors, unresolvedConstants}`.
- The `bspCulling` tile loader option defaults to false. The sandbox switch that sets it lives in `src/runtime/nativeSandboxConfiguration.ts` (integration).
- A payload that fails to parse gives a visible tile gap, `bsp-visibility-payload-invalid:<ErrorName>`. The tile shows everything, gets no translucent order and reports cameraZone -1, and the readiness barrier never waits on it (ARCH-03).

### Boundaries

Visibility is presentation (ARCH-04) and computes no gameplay (ARCH-01). It changes neither `GameWorldAdapter` nor `src/world` (ARCH-02), and the binding only imports `src/world/sourceFrame.ts`. Door state reaches the walk only through the mover presentation, in a later step. The walk never reads or writes WORLD-08 collision resources. Integration's import-boundary test forbids `@recast-navigation/*`, `@babylonjs/materials` and `@babylonjs/node-particle-editor` in `src/**` outside the lazy inspector entry. The vendored `scripts/vendor/lineage2elbera_bsp/` is in-repo, world-owned converter code, the Elbera gateway is a behaviour reference only, and no vendor dependency supplies semantics. `src/scene/world/worldVisibility.ts` and the range toggle in `src/scene/world/loadImportedWorld.ts:179` belong to the Talking Island reference route, which the native-world-slice cleanup removes. Do not build on them.

### Test seams

Core functions are pure over typed fixtures. Model scenarios come from the shared synthetic Level.Model builder in `tests/pipeline/support/` (nodes, leaves, zones, LeafHulls, bounds), which also feeds the movement fixtures. A generator writes the bsp scenarios through `typed_payload.py` into `tests/fixtures/bsp-visibility/`, and a test fails when a committed fixture differs from the builder output. Committed fixtures are synthetic, or indices and hashes only. Real-client cases read the client through `--client` and skip with a reason when it is absent.

A BigInt brute-force oracle encodes our rules, so agreement with it is not evidence of reference or Interlude parity. Seeded poses come from `src/shared/random.ts` with the `test` domain tag, through one helper in `tests/support/`. The binding reaches its targets through `{setVisible(visible)}` and `{reorder(indices)}`, so unit tests use plain objects.

## No vendor dependencies

| Reference uses | For | We use |
|---|---|---|
| three (Box3, Sphere, Frustum, Plane, Vector3, Vector4) | Frustum, sphere and box tests, plane dots, bounds | `src/shared/math/` plus `viewFrustum.ts` in the core. Babylon only supplies the camera pose. |
| three BufferGeometry groups, index.needsUpdate, Object3D.visible | Section show and hide, translucent index reorder | Babylon `isVisible`, and `Mesh.updateIndices` on unshared geometry. |
| three-wasm SortedIndexBuffer (private git dependency) | Per-triangle sort of near translucent static-mesh batches | Not adopted. If CHECK-01 shows a need, our own TS centroid-depth sort within the section's index range. |
| WebGL2 occlusion queries through three renderer hooks | Hiding static meshes of non-camera sectors | Babylon occlusion queries (`@babylonjs/core/Engines/WebGPU/Extensions/engine.query`) on tile proxies, only after PERF-02. |
| @l2js/core (ISC in package.json, no LICENSE) with gmp-wasm and pako | Package reading and decryption | The offline Python readers (vendored Elbera reader, `scripts/native_catalog/ue2.py`). The browser reads only our `.l2asset` through `src/shared/typedPayload.ts`. |
| @l2js/engine | UE2 object model imports | Nothing: a tsconfig alias (`lineage2js/tsconfig.json:8-16`). |
| three MathUtils generateUUID | Section, material and batch ids | Deterministic converter ids such as `<chunkId>/<primitive>`. |
| BigInt (built-in) | 64-bit zone masks | Two uint32 words per mask. BigInt only in the test oracle. |
| @dimforge/rapier3d | Mover rigid bodies on the door-portal path | None. Door coverage, when built, uses our own 2D polygon clipping. |

## Shared modules

- `src/shared/math/`
- `src/shared/random.ts`
- `src/shared/typedPayload.ts`
- `scripts/world/typed_payload.py`
- `src/world/sourceFrame.ts`
- `scripts/world/level_model.py`
- `scripts/world/level_zones.py`
- `scripts/world/bsp_leaf_membership.py`
- `scripts/native_assets_lib/class_defaults.py`
- scripts/world/ (tile step registered in convert_tile.py)
- src/runtime/ (scene.setRenderingOrder setup)
- `src/scene/world/cameraEnvironment.ts`
- `tests/pipeline/support/`
- tests/support/staticImportGraph.ts and tests/unit/importBoundaries*.test.ts
- `tools/reference-overlap/`
- scripts/native_store/gap_reasons.json plus recipes/world|actors|data/gap-reasons.json
- documented in README.md; applied in recipes/world/bsp-visibility.json

## Acceptance

- Unit: `pnpm vitest run tests/unit/bspVisibility*.test.ts` passes F1 to F16: - F1: one plane, two leaves. An on-plane point goes front when located and back in the walk. - F2: two rooms and a portal. The far zone shows only when the portal sphere is in the frustum and connectivity allows it. - F3: a five-zone portal chain, with depth cap 4 and with none. - F4: a valid, zero and all-ones PVS. - F5: a coplanar translucent chain reverses when the camera crosses its plane. - F6: a camera with both leaf slots solid uses the outdoor view. - F7: an empty BSP shows everything. - F8: pruning by ZoneMask and by render bound; S = 0 never prunes. - F9: members in two leaves, with no leaves, with a zone set outside M, and flagged sky. - F10: a permuted node order gives identical results. - F11: each malformed payload class throws its named error. - F12: a frustum from a browser pose through sourceFrame classifies points left, right, above, below, near and far. - F13: a solid camera-side slot falls back to the other leaf, with no outdoor view. - F14: an emitter origin on a plane or in solid space is ungated. - F15: a camera within float32 precision of a plane takes the side of its rounded value. - F16: the frame cache hits on an unchanged pose and misses on any key change.
- Oracle: for every fixture and 10,000 seeded poses, the zone set and the visible-node, visible-leaf and member bitsets equal the BigInt oracle.
- Pipeline: `python -B -m unittest discover -s tests/pipeline -p "test_world_bsp_visibility_step.py"` passes. A synthetic model gives exact arrays, and two runs are byte-identical. A malformed model or an out-of-range iRenderBound gives gap rows and no partial output. Box queries pass the S4 cases. The zone table resolves serialized, class-default and unresolved bSunAffect. The real-client 20_20 case matches the `validate_model` counts and maps Brush397 nodes 612, 620, 640, 641, 642, 648, 664, 666, 667, 668 and the Brush610 nodes to sections, and skips with a reason without `--client`.
- Census: on the synthetic builder, a seeded disagreement between zone-locate and outside-bit solidity gives `bsp-visibility-solid-mismatch`, and a section with mixed PF_TwoSided gives `bsp-visibility-feature-unported:PF_TwoSided`.
- Cross-language golden: the synthetic fixture written by `typed_payload.py` parses through `src/shared/typedPayload.ts` and `payload.ts` to identical counts and array contents.
- Import boundary: `tests/unit/importBoundaries.bspVisibility.test.ts` finds no `@babylonjs/*` specifier, no package, no DOM global and no import outside the core folder other than `src/shared/**`.
- Navigation invariance: until MOVE-01 lands, meshNavigation queries along the recorded 20_20 path give identical results with culling on and off. After it lands, the same test runs collisionWorld queries.
- Picking invariance: at the three recorded poses, `scene.pick` for door hover, door activation and targeting on a 16 x 9 screen grid returns the same mesh and point with culling on and off. Any difference blocks making culling the default.
- Camera zone: the camera environment record carries the same `cameraZone` along the recorded path with culling on and off.
- Failure path: a corrupt payload gives a visible tile gap row, every mesh stays visible, and startup completes.
- Sandbox on `?map=20_20`: the inspection reports the bspVisibility fields. With culling on at the wall-facing hall pose, hiddenSections > 0. At all three poses the frame with culling on is pixel-identical to culling off, within the declared tolerance.
- Recorded tile: `tests/fixtures/bsp-visibility/20_20-path.json` matches the core's output for the three poses.
- Phase 3 (CHECK-01): paired L2.exe and sandbox screenshots at the three 20_20 poses, plus one translucent BSP case on a tile with water or glass. Verdicts go in `docs/parts/world/EVIDENCE.md`, and a missing pair stays unverified. Mesh-level order (an effect in front of and behind a water sheet) is the comparator's own browser test.
- Overlap: `tools/reference-overlap/` runs this area's sources (`scripts/world/bsp_visibility*.py`, `scripts/world/bsp_leaf_membership.py`, `scripts/world/level_zones.py`, `src/scene/world/bspVisibility/**`) against `lineage2js/src/objects/zone-object.ts`, `lineage2js/src/rendering/translucent-draw-list.ts`, `lineage2js/src/rendering/translucent-render-list.ts`, `lineage2js/src/rendering/door-portals.ts`, `lineage2js/src/assets/unreal/model/un-model.ts` and `lineage2js/src/assets/unreal/static-mesh/un-static-mesh-actor.ts`. Runs of 12 or more tokens go to the reviewer, and a run of 20 or more outside the constant allowlist blocks the merge. A reviewer who did not write the code signs off in `docs/parts/world/EVIDENCE.md`.
- Phase 6 (PERF-02): walk median and p95 ms per frame, draw calls and frame time along the recorded path, culling off and on. The default flips only with a gain and no startup, movement or cleanup regression.

## Implementation steps

1. S1 Census Requirement: VIS-01 (proposed). Output: `docs/parts/world/bsp-visibility-census.json`, per tile: nodes and nodes reachable from 0, zones by class with serialized bSunAffect, portal nodes, leaves, solid-leaf share, valid render bounds, ZoneMask-0 nodes with a valid bound, sky-zone nodes, the i_section range, forced-region placements, a PVS histogram, PF_AddLast versus material-route disagreements and PF_TwoSided splits. A fixed grid over the model bounds, recorded in the header, compares zone-locate solidity with outside-bit solidity ([03-movement.md](03-movement.md)). Samples exactly on a plane along either descent are skipped. A mismatch is a `bsp-visibility-solid-mismatch` gap row. Check: Synthetic tests pass. The 20_20 and 20_21 counts match `validate_model` (real-client case).
2. S2 Recipe and zone table Requirement: VIS-01 (proposed). Output: `recipes/world/bsp-visibility.json` (constants, deviations, zone-1 rule, most-visible defaults for unsourced rows), `scripts/world/level_zones.py` and the new gap reasons. Check: A test fails on a row missing a field of the shape, a status outside the five-word vocabulary, or a deviation without its reference line.
3. S3 02-30 addendum Requirement: WORLD-01, VIS-01 (proposed). Output: `scripts/world/bsp_chunk_geometry.py` and `scripts/world/bsp_step.py` group by the section key, export per-chunk `sections` and `nodeRanges` and bump `BSP_STEP_ALGORITHM_VERSION`. Check: Every rendered node is in exactly one range, every primitive has a section row, no section mixes key values, and skip-flag and sky-zone nodes have no range.
4. S4 Membership Requirement: VIS-01 (proposed). Output: `scripts/world/bsp_leaf_membership.py` point and box queries. Static mesh members carry box source, margin, forced-region filter and sky flag. Map emitter members come from the world Emitter export. Check: Pipeline tests cover on-plane and solid points, plane-straddling boxes, forced region by tag and by index, and an on-plane emitter origin.
5. S5 Payload and step Requirement: VIS-01 (proposed), CONV-02. Output: The payload writer and step through `scripts/world/typed_payload.py`, the `convert_tile.py` registration, the manifest resource, and the bsp scenarios in `tests/pipeline/support/` with their fixtures. Check: Two runs are byte-identical. A malformed model gives gap rows only. Committed fixtures equal the builder output.
6. S6 Core part 1 Requirement: VIS-01 (proposed), ARCH-03. Output: `payload.ts`, `zoneSet.ts`, `viewFrustum.ts`, `regionLocate.ts` Check: F1, F7, F11, F12, F13 and F15 pass, along with the cross-language golden.
7. S7 Core part 2 Requirement: VIS-01 (proposed). Output: `zoneExpansion.ts`, `treeWalk.ts`, `outdoorView.ts` Check: F2, F3, F4, F6, F8, F10 and the oracle property test pass.
8. S8 Core part 3 Requirement: VIS-01 (proposed). Output: `memberVisibility.ts`, `translucentOrder.ts`, `tileVisibility.ts` Check: F5, F9, F14 and F16 pass.
9. S9 Binding Requirement: VIS-01 (proposed), ARCH-03, ARCH-04. Output: `bindBspVisibility.ts`, attached from `loadNativeTileChunks.ts`, with the resource parsed in `nativeTileManifest.ts` and `cameraZone` written to `src/scene/world/cameraEnvironment.ts`. Check: Binding unit tests pass with plain objects, including the refused shared-geometry case, and so do the boundary, invariance, camera zone and failure tests.
10. S10 Recorded tile and browser spec Requirement: VIS-01 (proposed), CHECK-01. Output: `tests/fixtures/bsp-visibility/20_20-path.json` and `tests/browser/world-bsp-visibility.spec.ts` Check: The spec checks the inspection fields, hiddenSections > 0 at the wall pose, pixel identity and the pick grid.
11. S11 Integration pieces Requirement: VIS-01 (proposed), PERF-02. Output: Integration registers `bsp-visibility` with native-tile-collision and lighting in one resource-kind contract change, adds the sandbox culling switch and lands the transparent comparator in `src/runtime/`. Check: The lane ownership check passes with `--base plan/autonomous-roadmap`.
12. S12 Native re-derivation Requirement: POL-04. Output: Phase 5 static reading of Interlude Engine.dll and Core.dll for every unconfirmed or unknown row. Check: Each changed row carries `interludeEvidence` and a matching EVIDENCE.md entry.
13. S13 Deferred Requirement: VIS-01 (proposed). Output: Each item gets its own plan after an observed need: door-portal coverage, the translucent static-mesh interleave, portal-polygon filtering of other tiles, occlusion queries on tile proxies, submesh toggles, small-batch angle culling, near per-triangle sort, a backdrop-gated sky pass and a tile-level distance hide. Check: Each plan names the observation that motivated it.

## Open questions

- Do Interlude leaves carry usable VisibleZones masks? The S1 census answers this per tile.
- Which Interlude Engine.dll (4dd2f63c...) code runs zone and portal traversal, and does it cap portal depth or distance?
- What are the Interlude names and values of the actor clipping range (C4 GL2ActorCR) and the static mesh [ClippingRange]? Does Interlude Engine.Actor carry bIgnoredRange, ForcedRegionTag, ForcedRegion and bSunAffect?
- Is the translucent BSP class PF_AddLast or the material blend route? Does the C4 backface rule hold on Interlude?
- What is the 16-byte span after the exclusive sphere? The reference calls it an inclusive sphere and our reader calls it reserved.
- What does Interlude draw when the camera is in solid space?
- Under `useLargeWorldRendering` in Babylon 9.27.1, do `camera.globalPosition` and `getDirection` return world values?
- Does `Mesh.updateIndices` on GLB-loaded WebGPU meshes avoid a vertex re-upload?
- Should reached PF_FakeBackdrop nodes gate the sky pass, as the `docs/NATIVE_SKY.md` target describes?
- Are node iZone values on the solid side of a wall meaningful in Interlude data? If so, a stricter per-node zone check becomes possible.
