---
phase: 02-stage-a-breadth
plan: 30
subsystem: world
tags: [world-01, world-08, vis-01, move-01, bsp, collision, typed-payload, dec-own-12, legacy-cut]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-29 meshes step and chunk rectangles; 02-56 typed payload reader and golden; 02-59 class-default reader, material graph and program; 02-71 bsp_reader_binding; 02-01 to 02-04 ledger, gap rows, store writer and tile manifest validators"
provides:
  - "scripts/world/level_model.py: read_level_model, sky_zone_indices, LevelModelRangeError, LevelModelLayoutError"
  - "scripts/world/bsp_chunk_geometry.py, bsp_surface_materials.py, bsp_step.py: run_bsp_step, BSP_STEP_ALGORITHM_VERSION 1, sealed_bsp_chunks; chunk GLB extras nativeBspSections and nativeBspNodeRanges"
  - "scripts/world/typed_payload.py: write_typed_payload_asset, typed_payload_asset, TypedPayloadArray"
  - "scripts/world/collision_step.py, collision_payload_groups.py, static_collision_sources.py, blocking_volume_geometry.py, terrain_collision_source.py: run_collision_step, COLLISION_STEP_ALGORITHM_VERSION 1, decide_placement_collision, read_volume, read_terrain_collision"
  - "convert_tile.py --step bsp and --step collision; manifest step version 4 fills chunk bsp and collision and the tile resource native-tile-collision"
  - "src/scene/world/nativeBspResources.ts parseNativeTileBspResource, parseNativeBspSectionExtras; loadNativeTileChunks loads chunk BSP and reports bspMeshes, bspSections, bspResources"
  - "tests/pipeline/support/level_model_fixture.py build_synthetic_level_model; support/actor_class_defaults.py"
  - "recipes/world/bsp-poly-flags.json, collision-declaration-rules.json; world gap reasons listVersion 5; vocabulary listVersion 2"
affects: [02-31, 02-45, 02-47, 02-48, 02-61, 02-62, 02-63, 02-65, 02-67]

estimate:
  tokens: 130000
  tasks: 4
actuals:
  tokens: 87000
  tasks: 4
  commits: 4
plan_head_before: a0a98ce2a4837d14247204b7f54691d70f361091
plan_head_after: 8414254f9168cccac7f27ecd9866a9d63d37d945

tech-stack:
  added: []
  patterns:
    - "A step whose inputs depend on decoded content (bsp) proves currency for the manifest step from its sealed receipt: same algorithm version and config, and every input still equal to the lock"
    - "Typed payload containers sit in a hash-addressed folder; asset.json pins payload.bin so the catalog walk carries both"

key-files:
  created:
    - scripts/world/level_model.py
    - scripts/world/bsp_chunk_geometry.py
    - scripts/world/bsp_surface_materials.py
    - scripts/world/bsp_step.py
    - scripts/world/typed_payload.py
    - scripts/world/collision_step.py
    - scripts/world/collision_payload_groups.py
    - scripts/world/static_collision_sources.py
    - scripts/world/blocking_volume_geometry.py
    - scripts/world/terrain_collision_source.py
    - recipes/world/bsp-poly-flags.json
    - recipes/world/collision-declaration-rules.json
    - tests/pipeline/support/level_model_fixture.py
    - tests/pipeline/support/actor_class_defaults.py
    - tests/pipeline/test_world_bsp_step.py
    - tests/pipeline/test_typed_payload_writer.py
    - tests/pipeline/test_world_collision_step.py
    - tests/unit/nativeBspResources.test.ts
  modified:
    - .gitattributes
    - scripts/world/convert_tile.py
    - scripts/world/tile_manifest_step.py
    - scripts/world/gltf_builder.py
    - scripts/world/static_placement.py
    - scripts/world/static_mesh_step.py
    - scripts/world/terrain_chunk_step.py
    - scripts/native_bsp_floor.py
    - recipes/world/gap-reasons.json
    - recipes/world/tile-manifest-vocabulary.json
    - src/scene/world/nativeBspResources.ts
    - src/scene/world/loadNativeTileChunks.ts
    - src/scene/world/loadNativeSection.ts
    - src/scene/world/nativeTileChunkManifest.ts
    - src/scene/world/nativeTileManifest.ts
    - tests/browser/world-tile-meshes.spec.ts
    - tests/unit/loadNativeTileChunks.test.ts
    - tests/unit/nativeTileChunkManifest.test.ts
    - tests/pipeline/test_tile_manifest_step.py
    - tests/pipeline/test_world_static_mesh_step.py
    - tests/pipeline/test_world_static_placement.py
    - tests/pipeline/test_world_map_sources_lock.py
    - tests/pipeline/test_client_entry_points.py
    - docs/NATIVE_BSP_FLOOR.md
    - docs/research/INDEX.md
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/lanes.json
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
  deleted:
    - scripts/derive-native-map-bsp.py
    - scripts/derive-native-map-building.py
    - scripts/native_bsp_building.py
    - tests/pipeline/test_native_bsp_floor.py
    - tests/pipeline/test_native_map_bsp.py
    - tests/pipeline/test_native_bsp_building.py
    - tests/pipeline/glb_document_fixture.py

key-decisions:
  - "PolyFlags rows cite the pinned Elbera ue2package.py:898-903 and bsp.py:96, read by repository and commit (row 515)"
  - "D5 key with lightmap page null until 02-62, outdoor by zone 0 or bSunAffect, translucent by program blend ordinal (row 516)"
  - "Whole-polygon Newell winding check instead of per-triangle (row 517)"
  - "Typed payload stored as a hash-addressed folder with a payload pin, not a zip (row 518)"
  - "static_placement class defaults through 02-59; old reused class-evidence path deleted (row 519)"
  - "StaticMesh selectors unknown (intrinsic class); SMSH from LOD0 EnableCollision slots (row 520)"
  - "Blocking rule with Elbera cross-check; disagreement is collision-unreadable (row 521)"
  - "Chunk assignment: placements by meshes-step origin, volumes by brush bounds centroid (row 522)"
  - "bsp-chunk-without-nodes and collision-transform-field-unreadable gap reasons (row 523)"
  - "scripts/vendor checks out byte-exact (row 524); Task 3 foreign paths accepted (row 525)"
  - "WORLD-01, WORLD-08, VIS-01, MOVE-01 stay Pending (row 528)"

requirements-completed: []

coverage:
  - id: D1
    description: "Whole-level BSP of a tile per chunk in D5 sections with node ranges, rendered on ?map=20_21"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_world_bsp_step.py (16 tests)"
        status: pass
      - kind: unit
        ref: "pnpm vitest run tests/unit/nativeBspResources.test.ts tests/unit/loadNativeTileChunks.test.ts"
        status: pass
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-meshes.spec.ts (2 passed, load-check tile:20_21 pass on lane catalog 89e27bd5)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Generic 20_20 BSP holds the Brush397 and Brush610 oracle nodes at identical native positions"
    requirement: WORLD-01
    verification:
      - kind: integration
        ref: "tests/pipeline/test_world_bsp_step.py#OracleBrushSubsetTests (conversion client, ran)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Declared-source native-tile-collision resource (BSPT per map; VOLS, SMSH, PLAC, TERR per chunk) in source units"
    requirement: WORLD-08
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_typed_payload_writer.py; -p test_world_collision_step.py; -p test_world_tile_general_steps.py"
        status: pass
      - kind: integration
        ref: "python -B scripts/world/convert_tile.py --client E:/Lineage2-client --map 20_21 --step collision"
        status: pass
    human_judgment: true
    rationale: "WORLD-08 is provisional for owner review; the blocking, transform, IsCsg, triangle and selector rules run as unconfirmed or unknown defaults"
  - id: D4
    description: "Legacy 20_20 BSP floor and building chain deleted with its tests and citations"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "python scripts/test_pipeline.py (1675 tests, 75 skipped, OK); test_native_sky.py OK"
        status: pass
    human_judgment: false

duration: 66min
completed: 2026-11-09
---

# Phase 2 Plan 30: BSP and collision Summary

**`convert_tile.py --step bsp` turns the whole serialized Level.Model of a tile into one GLB per chunk with D5 sections and per-node index ranges (20_21: 4,222 nodes, 97 sections, 11,595 triangles; two magenta surface materials with named gaps), `--step collision` writes the declared-source native-tile-collision resource (one BSPT tree per map plus VOLS, SMSH, PLAC and TERR per chunk, in source units through a typed payload writer byte-equal to the 02-56 golden), `/?map=20_21` renders the BSP, and the generic 20_20 step reproduces the Brush397 and Brush610 oracle nodes, so the 20_20 BSP chain is deleted.**

## Performance

- Duration: about 66 min (18:50 to 19:56 UTC), including a 10 min background reconversion of the 20_21 meshes unit and a 6 min `python scripts/test_pipeline.py`.
- Tasks: 4 of 4. Files: 55 changed (18 created, 30 modified, 7 deleted).

## Accomplishments

- `level_model.py`: one loader (123/28 only, gap-ready layout refusal) with range checks for iRenderBound, iCollisionBound and every LeafHulls run (negative terminator plus six bound words); `sky_zone_indices` from SkyZoneInfo zone actors.
- BSP: nodes skipped by the sourced `visual: skip` flags or in a sky zone leave the mesh; nodes go to chunks by polygon centroid in the half-open chunk rectangles; sections keyed by material, PF_UNLIT, lightmap texture and front-zone outdoor class, ordered by casefold material; each node's triangles contiguous. 20_21: 16 chunk GLBs (19.5 MB), 82 sections lit with an undecoded page (`null`), 39 outdoor sections, gaps: `bsp-node-outside-chunk-grid` (Brush335), two `decode-failed` diffuse adapters, one `material-class-unported:Engine.TexOscillatorTriggered`. 20_20: 14 of 16 chunks, 103 sections, oracle 20 of 20 nodes identical.
- Surface materials: each root through 02-59 `read_material_graph` and `derive_material_program`, written as `native-materials/<sha>/`; textures through the converter's diffuse chain; unconverted roots magenta `[1, 0, 1, 1]` with `extras.unboundSourceMaterial`.
- Collision 20_21: BSPT 4,493 nodes and 20,987 LeafHulls words; 3,205 placements (2,272 slots, 52 declared-none, 881 `collision-unreadable`); 7 BlockingVolumes blocking with full transforms and brush trees, PhysicsVolume4 declared-none; TERR heightmap rectangles and both bitmaps per chunk.
- Browser: chunk manifests accept pinned `bsp` and `collision`, the tile manifest accepts the `native-tile-collision` resource; the tile loader loads chunk BSP GLBs pinned by SHA-256 and keeps sections and node ranges for 02-63.
- `static_placement.py` reads class defaults only through 02-59 (`ClassDefaults`); the old class-chain walk and reused evidence folder are gone.

## Task commits

1. Task 1 (tracer): `cccbc14` feat(02-30): convert the whole Level.Model of a tile into per-chunk BSP with D5 sections and node ranges
2. Task 2: `3d30273` feat(02-30): write a declared-source native-tile-collision resource per tile and chunk in source units
3. Task 3: `02b436c` refactor(02-30): delete the 20_20 BSP floor and building chain now that the tile-general bsp step holds the oracle nodes
4. Task 4: `8414254` docs(02-30): record the BSP and collision evidence, the world status, the restage handoff and the retired lane rows

Tracer gate: the Task 1 verify (bsp unittest with the oracle case, typecheck, Vitest, browser) passed end to end before Task 2.

## Verification

- `test_world_bsp_step.py` 16 OK (oracle ran); `test_typed_payload_writer.py` 4 OK; `test_world_collision_step.py` 14 OK; `test_world_tile_general_steps.py` OK; manifest, static mesh, placement and map-source tests 62 OK including the real-client 20_20 placement oracle.
- `python scripts/test_pipeline.py`: 1675 tests, 75 skipped, OK. `pnpm typecheck` clean. `pnpm test:unit`: 2264 passed, 72 skipped, 0 failed. `laneOwnership.test.ts` 36 passed.
- Browser, 5173 free: `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-meshes.spec.ts` 2 passed after Task 1 and again after Task 2 (lane catalog `89e27bd5`, load-check pass 21:43 Riga). Headless SwiftShader: no FPS claim.
- Acceptance: `bsp/complete.json` and `collision/complete.json` present; every flag row has `sourceLine` and no `collision` key; `nodeRanges` 1 and lightmap 10 in `bsp_chunk_geometry.py`; every collision rule has provenance and a shared status; the collision gap-row file validates; `native-tile-collision` once in the vocabulary; each deleted file name greps empty outside `.planning`; `native_bsp_floor.py` has 0 of the four defs; `git diff --stat a0a98ce -- scripts/vendor` empty; EVIDENCE has one "BSP and collision (02-30)" (29.3 KB); STATE has one `Needs Human (plan 02-30)`.
- Lane ownership: `check-lane-ownership.mjs --base a0a98ce --part world` lists exactly `artifacts/plan-checks/02-30/foreign-paths.txt` (`.gitattributes`, `docs/NATIVE_BSP_FLOOR.md`, `docs/research/INDEX.md`, the two derive scripts, and `scripts/native_bsp_building.py` once its lane row left lanes.json).
- Restage plan: the lane catalog pins 243 files including 16 chunk BSP GLBs and 17 collision `asset.json` with their `payload.bin`.
- Reference overlap: no DEC-OWN-12 area glob covers the files this plan wrote (scripts/world Python, `nativeBspResources.ts`, `nativeTileChunkManifest.ts`, `nativeTileManifest.ts`, `loadNativeTileChunks.ts`), so no run applies.

## Deviations from plan

### Auto-fixed issues

1. **[Rule 3 - Blocking] Vendored reader hash failed in this worktree.** `core.autocrlf` checked `scripts/vendor/**` out with CRLF; `.gitattributes` adds `scripts/vendor/** -text` and the files are re-checked out byte-exact (row 524). Commit `cccbc14`.
2. **[Rule 1 - Bug] Per-triangle fan check refused 566 valid polygons** with collinear vertices; the whole-polygon Newell check replaces it (row 517).
3. **[Rule 3 - Blocking] No PF constants in the vendored copy.** The flag recipe cites the pinned Elbera files by repository and commit, with `ue2package.py` hash equal to SOURCE.json (row 515).
4. **[Rule 3 - Blocking] Lightmap page undecoded.** Section key carries `null` for a lit node until 02-62 (row 516).
5. **[Rule 3 - Blocking] `.l2asset` zip would fail the lane merge;** the typed payload is a hash-addressed folder whose `asset.json` pins `payload.bin` (row 518).
6. **[Rule 3 - Blocking] Engine.StaticMesh is intrinsic,** so its selectors are unknown; recorded as `unresolved-intrinsic` evidence, SMSH from LOD0 EnableCollision slots (row 520).
7. **[Rule 1 - Bug] Duplicate and undeclared flag fields voided every class default** (one batch call); flags now resolve per field (found on the first 20_21 run).
8. **[Rule 3 - Blocking] Stale 20_21 meshes unit** after later converter changes; reconverted (row 526).
9. **[Contract] Per-chunk records live in the sealed products** `bsp-chunks.json` and `collision.json` beside the receipts, because a receipt holds only config, inputs, outputs and gapRows (as 02-29).
10. **[Contract] Chunk assignment of placements** uses the meshes-step origin, not a bounds centroid (row 522); `nativeTileChunkManifest.ts`, `nativeTileManifest.ts` and `loadNativeSection.ts` (inspection type) changed beyond the file list to accept the new fields.
11. **[Tests touched outside the list]** `test_world_static_mesh_step.py`, `test_world_static_placement.py`, `test_world_map_sources_lock.py` (reused class-evidence case deleted with its path), `test_tile_manifest_step.py`, `nativeTileChunkManifest.test.ts`, `loadNativeTileChunks.test.ts`.
12. **[Acceptance] The Task 2 `git grep ... export_bsp_collision` prints the vendored SOURCE.json provenance lines** (pre-existing; vendor is never edited; row 527).

**Total deviations:** 12 (2 bugs, 6 blocking, 4 contract or scope notes). **Impact:** the plan's truths hold; the unresolved values (lightmap pages, StaticMesh selectors) stay visible.

## Known stubs

- `PLAC.matrix` is zero for a placement whose transform did not resolve; its decision is `gap`, so the matrix is never read (documented in `collision_payload_groups.py` use and EVIDENCE).

## Threat flags

None beyond the register: T-02-301 (range checks, gap rows), T-02-302 (golden byte compare), T-02-303 (no Elbera checkout path or script; the pinned files were read by commit for citation only), T-02-304 (parser guards, SHA-256 and 128 MiB cap), T-02-305 (vendored validation, per-object gaps), T-02-306 (declared source on every record; EVIDENCE scope line).

## Needs Human

- `Needs Human (plan 02-30):` the restage command printed by `write_lane_catalog.py --lane world --plan` (STATE.md).

## Open follow-ups

- BSP surface material files `native-materials/<sha>/` are not pinned by any store manifest yet (STATE Open follow-ups, row 518).
- 20_20 collision waits for its meshes unit in the 02-47 batch.

## Process cleanup

- Started: the 20_21 meshes, bsp, collision and manifest runs, the 20_20 bsp run, lane catalog and coverage runs, unittest runs, the full pipeline suite, Vitest and the full unit suite, two Playwright runs (each started and stopped `pnpm dev` on 5173), and scratch scripts under the ignored `artifacts/scratch-02-30/`.
- Check at 21:56 Riga: no listener on 5173 or 5175; `ps -W` shows only node.exe from Oct 29 and python.exe from Nov 7, none started by this plan; no chrome, headless shell or Playwright process. Nothing started by this plan remains.

## Self-Check: PASSED

- FOUND: all 18 created files exist; the 7 deleted files are gone.
- FOUND commits on plan/autonomous-roadmap: cccbc14, 3d30273, 02b436c, 8414254.
