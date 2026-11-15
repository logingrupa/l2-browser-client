---
phase: 02-stage-a-breadth
plan: 77
subsystem: world collision, movement-geodata, lighting
tags: [world-lane, collision, vols, water-volume, swimming, lighting, gap-closure]
status: complete
requires:
  - phase: 02-stage-a-breadth
    provides: 02-55 collision step and VOLS group, 02-59 class defaults, 02-62 lighting water links, 02-65 and 02-66 volume containment and swimming
provides:
  - VOLS admission by class chain (Engine.BlockingVolume chain kind blocking, Engine.PhysicsVolume chain kind physics)
  - VOLS.water, VOLS.priority, VOLS.gravity, VOLS.terminalVelocity and VOLS.physicsFieldProvenance arrays with per-volume provenance
  - governingPhysicsVolume and a pawn water test that reads the decoded water flag
affects: [02-81, 02-88, 02-89, MOVE-01 runtime, camera environment]
tech-stack:
  added: []
  patterns: [class-chain admission through light_actors.ClassChains, declared-type check before class-default resolution, unresolved provenance code 3]
key-files:
  created:
    - scripts/world/physics_volume_fields.py
    - tests/pipeline/support/water_volume_fixture.py
    - tests/unit/collisionVolumeKinds.test.ts
  modified:
    - recipes/world/collision-declaration-rules.json
    - scripts/world/static_collision_sources.py
    - scripts/world/collision_payload_groups.py
    - scripts/world/collision_step.py
    - src/scene/world/movement/core/collisionCell.ts
    - src/scene/world/movement/core/decodeNativeTileCollision.ts
    - src/scene/world/movement/core/volumeContainment.ts
    - src/scene/world/movement/core/pawnBody.ts
    - src/scene/world/movement/core/movementRules.ts
    - recipes/world/movement-native-rules.json
    - tests/pipeline/test_world_collision_step.py
    - tests/pipeline/test_world_lighting_step.py
    - tests/fixtures/movement/movementCollisionFixtures.ts
    - tests/fixtures/movement/pawnWorldFixtures.ts
    - tests/support/nativeTileCollisionFixture.ts
    - tests/unit/decodeNativeTileCollision.test.ts
    - tests/unit/cameraEnvironment.test.ts
    - tests/unit/movementPointCheck.test.ts
decisions:
  - "P831: bL2WaterVolume is VOLS.water (GamePlay.WaterVolume defaults set it; nothing sets bWaterVolume); row status unconfirmed until Engine.dll is read"
  - "P832: the governing volume is the containing physics volume with the highest decoded Priority; an unresolved priority ranks lowest"
  - "P833: decoded volume kinds are blocking and physics, matching the recipe volumeKinds and VOLS.kind codes"
  - "P834: stale 20_21 and 20_20 meshes, bsp, movers and terrain seals were re-sealed in the world lane store before collision"
metrics:
  duration: 30min
  completed: 2026-11-11
actuals:
  tokens: 19100
  tasks: 3
  commits: 3
plan_head_before: 3d5fbc4513593b91330d945af1e75ae970eb3fd1
plan_head_after: d36f94c
---

# Phase 2 Plan 77: VOLS water volumes summary

VOLS now admits every placed actor whose class chain reaches Engine.BlockingVolume (kind blocking, code 0) or Engine.PhysicsVolume (kind physics, code 1). Each volume carries bL2WaterVolume, Priority, Gravity and TerminalVelocity with authored, class-default, ue-zero or unresolved provenance. The browser decodes these fields, and the pawn swims only where the governing physics volume's water flag is true. Lighting links every 20_21 and 20_20 water volume.

## Tasks

| Task | Name | Commit | Result |
| ---- | ---- | ------ | ------ |
| 1 | Tracer: one WaterVolume of 20_21 from the map to VOLS to the decoder | c82578b | 20_21 VOLS holds 5 Gameplay.WaterVolume records with kind physics and water true (class-default), plus 3 Engine.DefaultPhysicsVolume, 1 Engine.PhysicsVolume and 7 Engine.BlockingVolume records. Collision algorithm version is 5. |
| 2 | The pawn water test reads VOLS and the rule row goes | 76d66af | `isPawnInWater` reads `governingPhysicsVolume(volumesContaining(...))?.volume.water === true`. `movement.physicsVolumeIsWater` is gone from the recipe, the parser and the type. |
| 3 | Lighting links water volumes through VOLS on 20_21 and 20_20 | d36f94c | The water link tests now take volumes from `volume_records`. The 20_21 and 20_20 lighting rows pass with no `lighting-water-volume-unlinked` row, and their collision rows carry no `collision-volume-class-unadmitted` row. |

## What was built

- The recipe `recipes/world/collision-declaration-rules.json` drops `volumeClasses`. It now has `volumeKinds` (kind plus base class) and `physicsVolumeFields` (payload field, script field, declared type). Three new constants rows cover this: `collision.volume-kind.blocking` and `collision.volume-kind.physics` (ue2-data), and `collision.physics-volume-fields` (unconfirmed). They cite the locked Engine.u `9b04ff5c...` and GamePlay.u `714639cd...` through the pinned UELib `64ebfa8b...`. The Engine.PhysicsVolume declarations read from the class-default cache are `bL2WaterVolume:bool`, `Priority:int`, `Gravity:Vector` and `TerminalVelocity:float`.
- `load_collision_rules` refuses a recipe in these cases:
  - its volume kinds differ from the `VOLUME_KIND_CODE` keys
  - its physics fields differ from `PHYSICS_VOLUME_PAYLOAD_FIELDS`
  - a record is malformed
- `scripts/world/physics_volume_fields.py` resolves each field in this order:
  1. The actor's class chain must declare the field with the recipe type. If it does not, the field is unresolved.
  2. A value serialized on the actor counts as authored.
  3. Otherwise the class default counts as class-default.
  4. A declared field that no class sets is ue-zero.
  5. Anything else stays unresolved and is never defaulted.
- `collision_step.volume_records` admits actors by class chain and records `kind` and `physicsFields` on each product volume record. `vols_arrays` writes `VOLS.water` (uint8), `VOLS.priority` (int32), `VOLS.gravity` (float32 x3), `VOLS.terminalVelocity` (float32) and `VOLS.physicsFieldProvenance` (uint8 x4, code 3 for unresolved).
- The interim path is deleted: `UNADMITTED_VOLUME_CLASS_REASON_PREFIX`, `UNADMITTED_VOLUME_CLASS_EVIDENCE_PREFIX`, `is_unadmitted_volume_subclass`, `unadmitted_volume_records` and their test. This closes independent review slice-06 (`scripts/world/lighting_step.py:119`).
- The `decodeNativeTileCollision.ts` guards reject:
  - array lengths that do not match the volume count
  - unknown provenance codes
  - water flags other than 0 or 1
  - gravity or terminal velocity values that are not finite

  An unresolved field decodes to null. `CollisionVolumeKind` is now `"blocking" | "physics"`.

## Deviations from plan

### Auto-fixed issues

1. [Rule 3 - Blocking] The Task 1 precondition was unmet. The 20_21 meshes, bsp, movers and terrain seals were stale after earlier plans raised their step versions. I re-sealed them with `convert_tile.py` in the world lane store, then ran collision. 20_20 got the same chain before its collision and lighting runs (decision P834).
2. [Rule 3 - Blocking] Files outside the plan list had to change because the payload and the kind names changed:
   - `src/scene/world/movement/core/collisionCell.ts`: new volume fields and kind names
   - `src/scene/world/movement/core/volumeContainment.ts`: kind filter and `governingPhysicsVolume`
   - `scripts/world/static_collision_sources.py`: the recipe loader
   - the new `scripts/world/physics_volume_fields.py`
   - the TS fixtures `movementCollisionFixtures.ts`, `pawnWorldFixtures.ts` and `nativeTileCollisionFixture.ts`, which now carry the VOLS physics arrays and gain a `physicsBox` helper
   - kind strings in `decodeNativeTileCollision.test.ts`, `cameraEnvironment.test.ts` and `movementPointCheck.test.ts`
   - the shared pipeline fixture `tests/pipeline/support/water_volume_fixture.py`, which both the collision and lighting tests use

   The lane ownership check (`--base 3d5fbc4 --part world`) reports 0 foreign paths.
3. Decision rows went to `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md` as P831 to P834, per gap rule G2.

### Golden traces

The golden traces are unchanged. `pawn-swimming.golden.json` uses `waterBox`, which now carries water true and priority 0. No trace depended on the removed rule.

## Left untouched on purpose

- `recipes/world/gap-reasons.json` still lists `collision-volume-class-unadmitted:<class>`. 02-75 edits that recipe in the same wave, and 02-81 removes the row with its own listVersion bump now that no step writes it.
- `movement.volumeGravity` and `movement.terminalVelocity` still drive falls. The plan scoped only the water test to VOLS.

## Open follow-ups

- `src/scene/world/cameraEnvironment.ts` still pushes `camera-volume-water-flag-absent` and `camera-volume-priority-unknown` for any containing volume. Both facts are now decoded (`volume.water`, `governingPhysicsVolume`). The camera environment owner should read them and drop the two stale gaps.
- 20_20 water volumes at exports 375 and 391 have centroids outside the tile's chunk rectangles, so `chunkId` is null. They appear in the collision product and link in lighting, but they are in no chunk's VOLS payload. The rule that assigns a volume to a chunk by centroid (`collision.brush-transform-order`) cannot place a volume that lies across the tile edge.
- An actor whose class chain cannot be read is not admitted to VOLS and gets no collision gap row. Lighting names such classes as `lighting-class-chain-unresolved:<class>`. On 20_21 and 20_20 every volume chain resolved.

## Reference overlap

The movement area run is saved at `artifacts/reference-overlap/movement-02-77.json`:

- 1 blocking run: `volumeContainment.ts:19-22`. It is a 20-token run against `lineage2js/src/objects/components/actor-ownership-component.ts:32-35`, made of the `null); } export function volumesContaining(...)` boundary. The earlier signed-off generic run on that function has shifted.
- 99 unreviewed runs, all in files this plan touched:
  - `decodeNativeTileCollision.ts`: 78
  - `pawnBody.ts`: 9
  - `volumeContainment.ts`: 8
  - `collisionCell.ts`: 4
- 2 stale sign-offs.

No sign-off rows were added. The orchestrator's independent review covers these runs. The `scripts/world` Python files are in no overlap area.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_world_collision_step.py"`: 25 tests OK.
- `python -B -m unittest discover -s tests/pipeline -p "test_world_lighting_step.py"`: 15 tests OK.
- `test_world_*.py`: 300 tests OK, 7 skipped.
- `pnpm vitest run` over the 28 unit files that use the collision fixtures or movement rules passes 311 tests. That set includes `collisionVolumeKinds.test.ts`, `importBoundaries.movement.test.ts`, `goldenTrace.test.ts` and `pawnPhysicsModes.test.ts`.
- `pnpm typecheck`: clean.
- The Task 3 gap-row check prints 0: no `water-volume-unlinked` or `collision-volume-class-unadmitted` rows for tile:20_21 or tile:20_20.
- Lane gap rows:
  - lighting: tile:20_20 pass, tile:20_21 pass
  - collision: tile:20_20 gap `object-gaps:752`, tile:20_21 gap `object-gaps:285`. Both are pre-existing `collision-unreadable` placement objects.
- Requirements WORLD-08, MOVE-01, MAT-02 and WORLD-05 are not marked complete here. Gap rule G9 leaves REQUIREMENTS.md to 02-89, and 02-88 re-runs the full tile set.

## Process cleanup

Every conversion ran in the foreground or in a background shell that exited with code 0. No dev server, Vite preview, Playwright, browser or Vitest worker was started outside those runs. A command-line search for this worktree path shows only the checking shell, and nothing listens on port 5175.

## Self-Check: PASSED

- Files exist: `scripts/world/physics_volume_fields.py`, `tests/pipeline/support/water_volume_fixture.py`, `tests/unit/collisionVolumeKinds.test.ts`.
- Commits c82578b, 76d66af and d36f94c are on `plan/autonomous-roadmap`.
