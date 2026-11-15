---
phase: 02-stage-a-breadth
plan: 46
subsystem: audio
tags: [world-audio, music, ambience, placement-audio, tile-route, actors-lane]
requires:
  - phase: 02-stage-a-breadth
    provides: "02-16 selectedNativeTileIdentity and readNativeTileManifest; 02-45 world-audio tile resources (ambience, placement audio, music)"
provides:
  - "readSelectedTileWorldAudioRecords: the ?map= tile's world-audio resources as loader records"
  - "loadNativeWorldAudio tile dispatch by fetched manifest kind, placementAudio and silentReason"
  - "tile-general world audio sheet cards and a placement audio card"
  - "tests/browser/world-tile-audio.spec.ts audible labelled report for tile:20_20"
affects: [02-47, 02-55, 02-64, 02-67, 02-70]
actuals:
  tokens: 26000
  tasks: 3
  commits: 3
plan_head_before: eafb2620936821ae374b76793690506e6f174908
plan_head_after: 68b76b2c11bed6b62c3ac32dedbdff3e92455181
tech-stack:
  added: []
  patterns:
    - "Loader input { tileId, records }: tile records dispatch by manifest kind, catalog records keep strict kind equality"
    - "worldAudioSourceTexts.ts owns the tile-general source texts of the world audio sheet"
key-files:
  created:
    - src/assets/native/readSelectedTileWorldAudio.ts
    - src/audio/worldAudioSourceTexts.ts
    - tests/unit/tileWorldAudio.test.ts
    - tests/unit/minimalFakeDomElement.ts
    - tests/browser/world-tile-audio.spec.ts
  modified:
    - src/assets/native/loadNativeWorldAudio.ts
    - src/audio/worldAudioControls.ts
    - src/audio/worldMusic.ts
    - src/audio/worldAmbience.ts
    - tests/unit/loadNativeWorldAudio.test.ts
    - tests/unit/worldAudioControls.test.ts
    - tests/unit/worldMusic.test.ts
    - tests/unit/worldAmbience.test.ts
    - docs/parts/audio/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "Tile world-audio records dispatch by fetched manifest kind; the loader input is { tileId, records } and a silent tile names no tile audio resources (row 656)"
  - "The audible report is the only record this actors-lane check writes (row 657)"
  - "The spec enters MusicVolume0 with the server stop command plus set-animation idle, because move-local cannot ground a target under the terrain (row 658)"
  - "placementAudio and silentReason reach the sheet only after the integration pass-through (index rule 14, row 659)"
  - "Music pick, looping, silence outside volumes, volume selection and ambient gain are labelled unverified (row 660)"
requirements-completed: []
coverage:
  - id: D1
    description: "With ?map=20_20 the runtime loads the tile's own music and ambience and plays an original Ogg track and an ambience loop after a trusted gesture"
    requirement: WORLD-02
    verification:
      - kind: e2e
        ref: "tests/browser/world-tile-audio.spec.ts (932 x 430 touch tap, 1440 x 900 click, 430 x 932 scroll)"
        status: pass
    human_judgment: true
  - id: D2
    description: "Tile records dispatch by manifest kind, placement audio parses with bound keys and pinned WAVs, an empty tile is silent, unknown kinds throw"
    requirement: WORLD-02
    verification:
      - kind: unit
        ref: "tests/unit/tileWorldAudio.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Sheet cards describe the selected tile from its manifests; on-plane MusicVolume counts as inside"
    requirement: WORLD-02
    verification:
      - kind: unit
        ref: "tests/unit/worldAudioControls.test.ts#describes the selected tile; tests/unit/worldMusic.test.ts#on a plane"
        status: pass
    human_judgment: false
duration: 36min
completed: 2026-11-10
status: complete
---

# Phase 2 Plan 46: Tile audio runtime Summary

**`?map=XX_YY` now loads the tile's own world-audio resources (ambience, music and StepSound placement audio) dispatched by manifest kind, and on tile 20_20 an original Ogg track and an ambience loop play after a phone tap and a desktop click, with a labelled actors-lane report.**

## Performance

- **Duration:** about 36 min
- **Started:** 2026-11-10T07:13:55Z
- **Completed:** 2026-11-10T07:50Z
- **Tasks:** 3
- **Files modified:** 16 code and test files, 3 docs

## Accomplishments

- `readSelectedTileWorldAudioRecords` reads the `?map=` tile manifest (02-16 reader, pinned SHA-256 and length) and returns its `world-audio` resources; `readNativeWorldAudioRecords` returns `{tileId, records}` and falls back to the catalog slice only without a selected tile. The runtime call in `loadNativeSliceAudio.ts` is unchanged.
- `loadNativeWorldAudio` checks each tile manifest's `tileId`, dispatches `native-map-ambience`, `native-map-music` and `native-tile-placement-audio`, keeps `MAX_PAYLOAD`, the path check and every list bound (placements 20000, sounds 4096), shares one WAV sound table parser between ambience and placement audio, and returns `placementAudio` and `silentReason`.
- Music and ambience inspections carry `sourceMap`, music volumes with `boundsNative`, and track names; the sheet cards are tile-general (`grep -c "20_20" src/audio/worldAudioControls.ts` prints 0) and a new placement audio card lists bound StepSound references and labels footstep playback as polish.
- Report `artifacts/lane-store/actors/reports/world-tile-audio-f60ce2d8....json`: tile:20_20 `music:D03_F` in `20_20.MusicVolume0` played (music bus peak 0.0000877) and `ambsound.dungeon.d_wind_loop_21` played (ambience bus peak 0.0442).

## Task Commits

1. **Task 1: Selected tile world audio end to end, audible on 20_20** - `6c8e97a` (feat)
2. **Task 2: Tile-general sheet texts and edge cases** - `7d2ae24` (feat)
3. **Task 3: Audio evidence, tracking lines and process cleanup** - `68b76b2` (docs)

## Files Created/Modified

- `src/assets/native/readSelectedTileWorldAudio.ts` - selected tile world-audio records.
- `src/assets/native/loadNativeWorldAudio.ts` - tile dispatch, placement audio parse, silent reason.
- `src/audio/worldAudioSourceTexts.ts` - tile-general source texts for the sheet.
- `src/audio/worldAudioControls.ts`, `worldMusic.ts`, `worldAmbience.ts` - cards, inspections, comment-free.
- `tests/browser/world-tile-audio.spec.ts` - phone and desktop audible runs and the report.
- `tests/unit/tileWorldAudio.test.ts`, `minimalFakeDomElement.ts` (shared fake DOM moved out of `worldAudioControls.test.ts`).

## Decisions Made

OVERNIGHT-DECISIONS rows 656 to 660 (see key-decisions above).

## Deviations from Plan

**1. [Rule 3 - Blocking] `move-local` cannot enter MusicVolume0 of 20_20**
- **Found during:** Task 1
- **Issue:** MusicVolume0 (the volume that holds the tile anchor's XY) lies under the terrain; navigation grounds a `move-local` target only within 0.8 m below it, so the command was ignored. `cannot-move` alone changes only the adapter entity, because no registry consumer reads `stop` or `teleport` events yet.
- **Fix:** the spec sends `cannot-move` at the volume centre, then `set-animation idle`, whose `update` event publishes the stopped position. The trusted gesture now runs before the placement so the click-to-move it causes cannot pull the player out. Row 658.
- **Files modified:** tests/browser/world-tile-audio.spec.ts
- **Commit:** 6c8e97a

**2. [Rule 3 - Blocking] `hashServedLaneCatalog` does not exist**
- The support module exports `servedLaneCatalogSha256`; the spec uses it. The spec reads the tile manifests over HTTP from the served union rather than from the world lane folder, so it names no world lane path.

**3. [Rule 2 - Missing critical] Loader input carries the tile id**
- The plan's behaviour "a selected tile with zero resources yields silentReason" needs the loader to know a tile was selected. `loadNativeWorldAudio` takes `{tileId, records}` and also refuses a tile manifest whose `tileId` differs (T-02-461). Row 656.

**4. [Rule 2 - Missing critical] Sheet statuses relabelled unverified**
- "Music rule", "Music region" and "Ambient gain rule" claimed native ("Proved from bytes"), which the plan prohibition forbids for selection, looping, silence outside volumes and gain. Row 660.

**5. Index rule 14 limits the sheet pass-through**
- `placementAudio` and `silentReason` are accepted by `attachWorldAudioControls` and unit-tested, but the runtime does not pass them yet. Recorded as an Open follow-up and in EVIDENCE as a known false presentation. Row 659.

**6. Inspections and `worldAmbience.ts` touched in Task 1**
- The spec reads music volumes from the snapshot, so `WorldMusicInspection` gained `sourceMap`, `volumes` and `trackNames` in Task 1; `worldAmbience.ts` gained `sourceMap` and lost its comments (named ambient sound type constants).

Tests were written with the code inside each task commit, not as separate RED commits.

## Issues Encountered

- The music bus peak right after the track starts is small (0.0000877 and 0.000277 in two runs): the track opens quietly and plays at the pinned l2.ini MusicVolume 0.1. It is above 0 as the check requires; owner listening is the open audible check.
- Reference overlap: none of the five DEC-OWN-12 areas (materials, bsp-visibility, movement, particles, network) covers `src/audio/**`, `src/assets/native/**` or the tests, so no overlap run applies.

## Verification

- `pnpm typecheck` clean.
- `pnpm vitest run tests/unit/tileWorldAudio.test.ts tests/unit/loadNativeWorldAudio.test.ts tests/unit/worldAudioControls.test.ts tests/unit/worldMusic.test.ts` pass; `pnpm test:unit` 187 files passed, 3 skipped, 2,451 tests passed, 59 skipped, no red.
- `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-audio.spec.ts` 2 passed (twice, after each code commit), port 5173 free before each run.
- `node scripts/check-lane-ownership.mjs --base eafb262 --part audio`: lane actors, 0 foreign paths.
- Acceptance greps: `readSelectedTileWorldAudioRecords` in the loader 2; `hasTouch` and `430` in the spec present; `writeLoadCheckRecord` and `lane-store/world` in the spec 0; `Tile world audio (02-46)` in EVIDENCE 1; EVIDENCE 9,872 bytes.
- Process cleanup: Playwright stopped its own dev server and browser after each run; nothing listens on 5173 or 5175, and `ps -W` shows no node or chrome process started today (only three node.exe from Oct 29 that this plan did not start).

## Known Stubs

- `src/audio/worldAudioControls.ts`: `placementAudio` and `silentReason` default to null in the live runtime until integration passes them (Open follow-up, row 659). Unit tests cover both values.

## Next Phase Readiness

- WORLD-02 stays Pending: all tiles, the owner listening round and the runtime pass-through remain.
- 02-70 (tiles load sweep) and 02-55 (integration union) can rely on tile world audio loading through `?map=`.

---
*Phase: 02-stage-a-breadth*
*Completed: 2026-11-10*

## Self-Check: PASSED

All five created files exist; commits 6c8e97a, 7d2ae24 and 68b76b2 are on plan/autonomous-roadmap.
