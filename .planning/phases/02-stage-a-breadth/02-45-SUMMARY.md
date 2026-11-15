---
phase: 02-stage-a-breadth
plan: 45
subsystem: world
tags: [sky, world-audio, music, ambience, tile-steps, native-store]
requires:
  - phase: 02-stage-a-breadth
    provides: "02-11 WORLD-07 music join fixture, 02-14 MapSources, 02-16 tile manifest step and reader, 02-30 level_model and level_zones, 02-31 vocabulary file, 02-59 material graph and program"
provides:
  - "convert_tile.py --step sky: any tile's sky from its one SkyZoneInfo zone (skies/<sha>/, kind sky)"
  - "convert_tile.py --step audio: ambience, placement audio and music as world-audio tile resources from exact references with original bytes"
  - "readSelectedTileSkySource and the tile sky path of createNativeSkyPresentation"
  - "deletion of the legacy 20_20 sky and audio chain, batch sky and ambient adapters and assets:ambient"
affects: [02-46, 02-47, 02-50, 02-63, 02-64]
actuals:
  tokens: 114000
  tasks: 5
  commits: 6
plan_head_before: 158e398e85aa822e5d2ef6236186fac6811ced2c
plan_head_after: 398035b8b3ca3a6b9127df62eac1585cfb7f8e1f
tech-stack:
  added: []
  patterns:
    - "TileStepGapRows and write_tile_resource_bundle shared by the sky and audio steps"
    - "tile steps fingerprint the raw unit and the lock eSha256 of every package they read; sealed receipts re-check lock-equal inputs"
key-files:
  created:
    - scripts/world/sky_materials.py
    - scripts/world/sky_geometry.py
    - scripts/world/sky_step.py
    - scripts/world/exact_sound_sources.py
    - scripts/world/ambient_sound_inventory.py
    - scripts/world/placement_audio_inventory.py
    - scripts/world/music_volume_join.py
    - scripts/world/tile_music.py
    - scripts/world/world_audio_step.py
    - scripts/world/tile_step_gap_rows.py
    - recipes/world/ambience-radius-symbols.json
    - recipes/world/music-derivative-encoder.json
    - src/scene/world/nativeTileSkySource.ts
    - tests/pipeline/test_world_sky_step.py
    - tests/pipeline/test_world_audio_step.py
    - tests/browser/world-tile-sky.spec.ts
  modified:
    - scripts/world/convert_tile.py
    - scripts/world/tile_manifest_step.py
    - scripts/world/tile_json_resource.py
    - recipes/world/gap-reasons.json
    - recipes/world/tile-manifest-vocabulary.json
    - src/scene/world/nativeSkyPresentation.ts
    - src/scene/world/nativeTileManifest.ts
    - src/scene/world/loadNativeTileChunks.ts
    - scripts/native_batch_adapters.py
    - scripts/native_assets_lib/world_music.py
    - scripts/native_assets_lib/world_ambience.py
    - src/audio/worldAudioControls.ts
    - src/audio/worldMusic.ts
    - src/audio/worldAmbience.ts
    - src/materials/ue2/model/constants/combinerConstants.ts
key-decisions:
  - "Sky roots come in first-node order of the sky zone and read through the 02-59 graph and program; a 118/0 sky package reads through SkyLayoutPackage"
  - "Emitter rows keep null for omitted fields; the runtime applies its sourced class defaults"
  - "A music_volumes refusal is one tile-level music-volume-unreadable gap with its text in the step product"
  - "native-tile-placement-audio v1 lists only StaticMeshActors that declare a StepSound property"
  - "Vocabulary sky at listVersion 6 and world-audio at 7; world-audio repeats once per written audio manifest"
  - "The two 20_20 recipe pins live in recipes/world/ with commit and block provenance instead of the deleted file name"
  - "New reasons sky-material-texture-count:<count> and sound-payload-unverified:<check>"
  - "Task 4 foreign paths accepted under OVERNIGHT-DECISIONS rows 373 and 380"
requirements-completed: []
coverage:
  - id: D1
    description: "Generic 20_20 sky.glb BIN chunk equals the served sky and the JSON chunk differs only in asset.generator; tile 20_21 builds its own sky"
    requirement: WORLD-02
    verification:
      - kind: integration
        ref: "tests/pipeline/test_world_sky_step.py#RealClientSkyTests"
        status: pass
    human_judgment: false
  - id: D2
    description: "Tile 20_21 presents its sky resource on /?map=20_21 with one mesh per material root and textures ready"
    requirement: WORLD-02
    verification:
      - kind: e2e
        ref: "tests/browser/world-tile-sky.spec.ts (1440 x 900, 932 x 430 touch, 430 x 932 scroll)"
        status: pass
      - kind: unit
        ref: "tests/unit/nativeSkyPresentation.test.ts#selected tile sky presentation"
        status: pass
    human_judgment: false
  - id: D3
    description: "Ambient and placement audio from exact references with original bytes; 20_20 equals the staged ambience"
    requirement: WORLD-02
    verification:
      - kind: integration
        ref: "tests/pipeline/test_world_audio_step.py#RealClientAudioTests.test_the_20_20_ambient_counts_equal_the_staged_ambience"
        status: pass
    human_judgment: false
  - id: D4
    description: "Music join as a tile step; 20_20 equals the WORLD-07 fixture and the staged music tracks and derivatives"
    requirement: WORLD-02
    verification:
      - kind: integration
        ref: "tests/pipeline/test_world_audio_step.py#RealClientAudioTests.test_the_20_20_music_join_equals_the_world_07_fixture"
        status: pass
    human_judgment: false
  - id: D5
    description: "Sky surfaces keep their source-preserving material graph and program (MAT-01 input)"
    requirement: MAT-01
    verification:
      - kind: integration
        ref: "convert_tile.py --map 20_20 --step sky writes native-materials/<sha>/graph.json and program.json per root"
        status: pass
    human_judgment: false
  - id: D6
    description: "Legacy 20_20 sky and audio chain deleted with every citer"
    verification:
      - kind: other
        ref: "git grep -n -w -F <each deleted file name> -- . ':!.planning' ':!scripts/vendor' (empty); python scripts/test_pipeline.py 1,782 tests OK"
        status: pass
    human_judgment: false
duration: 55min
completed: 2026-11-10
status: complete
---

# Phase 2 Plan 45: Tile sky and world audio steps Summary

**Any tile's sky now comes from its one SkyZoneInfo zone through the 02-59 material graph (the generic 20_20 sky.glb BIN chunk equals the served sky), and ambience, StepSound placement audio and MusicVolume music convert per tile from exact references with original bytes as world-audio tile resources; the legacy 20_20 sky and audio chain is deleted.**

## Performance

- **Duration:** about 55 min
- **Started:** 2026-11-10T03:26Z
- **Completed:** 2026-11-10T04:21Z
- **Tasks:** 5
- **Files modified:** 65

## Accomplishments

- `convert_tile.py --step sky`: roots in first-node order of the one sky zone, read with `read_material_graph` and written as `native-materials/` graph and program, every original mip kept, mip 0 decoded with the pinned Pillow. 20_20: BIN chunk byte-identical to `skies/f7a0b5ef.../sky.glb`, JSON equal except `asset.generator`, 53 nodes, 182 vertices, 76 triangles. 20_21: `interlude:20_21.Model327.SkyZoneInfo0`, 3 roots.
- `convert_tile.py --step audio`: exact sound identity (one lock-equal `.uax`, one Sound export by casefold full name), WAV kept only when `encodedAudioUnchanged` and equal to the native payload. 20_20: 2,622 emitters, 106 sounds, emitter rows and WAV hashes equal the staged ambience; 543 placements and 15 step sounds; 2 volumes and 9 tracks whose restored Ogg and AAC hashes equal the staged music. 20_21: 2,875 emitters, 132 sounds, 2 placements, 3 volumes, 13 tracks. No gap rows on either tile.
- Tile manifests of 20_20 and 20_21 list one `sky` and three `world-audio` resources each; vocabulary listVersion 7; the browser tile manifest reader accepts them and `/?map=20_21` presents the tile sky (three viewports).
- Deleted: the 20_20 sky converter and stager, BSP floor helpers, map ambient exporter, music and ambience bundlers, world audio stager, four 20_20 audio recipes, batch `sky` and `ambient` adapters, `assets:ambient`, their tests and citers.

## Task Commits

1. **Task 1: Tile sky step and selected tile sky** - `95a748c` (feat)
2. **Task 2: Ambient and placement audio** - `43767b5` (feat)
3. **Task 3: Music join and world-audio resources** - `1f69beb` (feat)
4. **Task 4: Delete the legacy 20_20 sky and audio chain** - `c07760f` (refactor)
5. **Task 5: Evidence, restage handoff, decisions** - `767365b` (docs)
6. **Unit suite follow-up** - `398035b` (test)

## Files Created/Modified

- `scripts/world/sky_materials.py`, `sky_geometry.py`, `sky_step.py` - sky reader, geometry and GLB, step.
- `scripts/world/exact_sound_sources.py`, `ambient_sound_inventory.py`, `placement_audio_inventory.py`, `music_volume_join.py`, `tile_music.py`, `world_audio_step.py` - audio step.
- `scripts/world/tile_step_gap_rows.py`, `tile_json_resource.py` - shared gap rows and bundle writer.
- `recipes/world/ambience-radius-symbols.json`, `music-derivative-encoder.json` - the two pins moved from the deleted 20_20 recipes.
- `src/scene/world/nativeTileSkySource.ts`, `nativeSkyPresentation.ts`, `nativeTileManifest.ts` - tile sky reader and presentation, shared `readNativeTileManifest`.

## Decisions Made

OVERNIGHT-DECISIONS rows 615 to 624 (see key-decisions above).

## Deviations from Plan

**1. [Rule 3 - Blocking] Vocabulary baseline was listVersion 5, not 1**
- The file already held four kinds; `sky` made listVersion 6 and `world-audio` 7 (acceptance text printed 2 and 3). Row 619.

**2. [Rule 3 - Blocking] l2_skies.utx is version 118/0, which the generic Package refuses**
- `SkyLayoutPackage` in `sky_materials.py` carries the table reader of the deleted converter without its SHA and count pins; 123 packages keep the generic reader.

**3. [Rule 1 - Bug] The browser parser refused a second resource of one kind**
- `world-audio` repeats once per audio manifest; the parser now allows that kind to repeat but refuses one manifest twice. `readNativeTileManifest` became shared by the tile loader and the sky reader.

**4. [Rule 2 - Missing critical] Two gap reasons beyond the plan list**
- `sky-material-texture-count:<count>` and `sound-payload-unverified:<check>`. Row 621.

**5. [Rule 3 - Blocking] Deletion grep and recipe provenance**
- The moved recipe blocks name commit `158e398` and their block instead of the deleted file names, so the deletion grep stays empty. Row 620.

**6. [Rule 3 - Blocking] Ownership check after the lanes.json edit**
- Removing the 8 deleted world-owned rows makes them unclaimed; `foreign-paths.txt` holds the final 22 paths. Row 624.

**7. [Rule 1 - Bug] `nativeTileChunkManifest.test.ts` used `sky` as an unreadable kind** - now `unlisted-kind` (`398035b`).

**8. Music split into `scripts/world/tile_music.py`** to keep `world_audio_step.py` under 400 lines; `TileStepGapRows` and `write_tile_resource_bundle` shared with the sky step (DRY).

Tests were written after the code inside each task commit, not as separate RED commits.

## Issues Encountered

- Reference overlap (materials area): editing the colour byte-order provenance in `combinerConstants.ts` re-tokenises reviewed runs: 0 blocking, 4 unreviewed, 4 stale reviewed, report `artifacts/plan-checks/02-45/materials-overlap-after.json` (before the edit: 0 unreviewed, 4,265 reviewed). Left for the orchestrator's independent review (row 623). None of the five overlap areas covers the new world code.
- The sky browser screenshot frames the ground; the sky is proven by the inspection (source id, 3 meshes, textures ready).

## Verification

- `test_world_sky_step.py` 14 OK, `test_world_audio_step.py` 22 OK, `test_music_volume_join.py` OK, `test_tile_manifest_step.py` OK, `python scripts/test_pipeline.py` 1,782 tests OK (57 skipped).
- `pnpm typecheck` clean; `pnpm test:unit` 2,469 pass, 59 skipped after `398035b`.
- `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-sky.spec.ts` 2 passed (lane catalog f60ce2d8, load-check tile:20_21 pass 06:15 Riga).
- Coverage report: world 2/163 converted, 124 gap, 37 pending, loads 1 pass, 1 unverified.
- Process cleanup: Playwright stopped its own dev server and browser; no listener on 5173 or 5175 and no node, chrome, python or ffmpeg process started today remains (`ps -W`; PowerShell CIM queries are blocked in this session).

## Next Phase Readiness

- 02-46 plays the world-audio resources; restage of the world lane store is Needs Human (plan 02-45) in STATE.md.

---
*Phase: 02-stage-a-breadth*
*Completed: 2026-11-10*

## Self-Check: PASSED

All created files exist; commits 95a748c, 43767b5, 1f69beb, c07760f, 767365b and 398035b are on plan/autonomous-roadmap.
