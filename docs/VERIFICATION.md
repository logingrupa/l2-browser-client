# Verification evidence index

This file lists, per part, what passes now, what is open and where the evidence
is. Each entry gives the date of its latest check. Detailed receipts live in the
`REPORT.md` files under `artifacts/`; those paths are local, ignored and
unpublished.

Status and work order: [.planning/STATE.md](../.planning/STATE.md) and
[.planning/ROADMAP.md](../.planning/ROADMAP.md). Requirement IDs refer to
[.planning/REQUIREMENTS.md](../.planning/REQUIREMENTS.md).

## How to read this index

- The stage A bar per part is: converted, loads in the offline sandbox, and
  passes a side-by-side screenshot or listen check against L2.exe on IMPORTA-PC
  (DEC-OWN-3, CHECK-01, CHECK-02). Unverified is never a pass.
- No entry below records a side-by-side screenshot or listen verdict against
  L2.exe yet. Every "passes" below is a browser, pipeline or byte check.
- Fixed native-parity thresholds stay unchanged and are the polish-stage goal
  (DEC-PARITY-1, POL-01, POL-02). The fixed acceptance contract SHA-256 is
  `7a0ae70c593dbdad30637fa1de7bfd446d7091cbe0f31bb97eab31c130ea2df5`.
- The reference client is IMPORTA-PC `C:/Lineage2-client`. `E:/Lineage2-client`
  is a conversion source only after the full-tree hash lock (DEC-OWN-2,
  FOUND-03).
- "Mobile" means desktop hardware with viewport and touch emulation, never a
  physical phone. Software-WebGL or SwiftShader FPS is not a performance result.
- The Babylon.js Editor is an optional viewer, not a gate (DEC-OWN-8). Editor
  checks are listed once, in [Editor viewer](#editor-viewer-optional).
- Outputs are `.l2asset` packages plus the runtime catalog.
  `recipes/native-inputs.lock.json` is input-only (DEC-OWN-5).

## Summary

| Part | Passes now (latest) | Main open items |
| --- | --- | --- |
| World section | 157 placements / 62 models, 4,992 terrain triangles, both routes on WebGPU (2026-11-06) | Not tile-general (genericity audit); eager loading, no streaming or LOD |
| Terrain | Scoped 20_20 UV correction, 44/44 GPU reference cases, Sector247 added (2026-11-06) | Native mask blend, `bUseAlpha`, CPU pruning, tile-general UV branch |
| BSP | Brush397 floor slab, indoor stairs and walls in navigation (2026-11-06) | Full BSP, native collision and geodata |
| Sky | Source sky room and 20 environment tables converted (2026-11-07) | Hard colour boundary, native tint and time policy |
| Audio | Music, ambience, footsteps and combat audible in 20_20; 4,773 Sounds exported (2026-11-08) | Listen check; other voices, actions and UI audio |
| Actors and NPCs | Four native humans at native scale; Musveren NPC 21622 (2026-11-07) | Musveren burial at scale 1.2, weapon attachment, stride matching |
| Power Strike and effects | Six source components and timed init preview on hardware WebGPU; 12 flames (2026-11-07) | Native emission and lifetime, conditional shot, table-sound policy |
| Textures | 26 standalone textures keep 141 native mips; DDS for 23 DXT1 (2026-11-05) | Native sampling and blending; model textures are PNG derivatives |
| Migration and catalog | 381/381 identical products, 100 archives, 70 valid GLBs (2026-11-05) | 20_20 cannot be rebuilt from committed code |
| UI and dev sheet | Dev sheet only; loading panel review: ship (2026-11-06) | `interface.xdat` windows (UI-01, UI-02) |
| Startup | Reveal waits for native readiness, 5/5 Chromium and 5/5 WebKit (2026-11-06) | Staged only, not on the live preview |
| Private preview | 29 external checks, 45-check gate (2026-11-05) | No reboot persistence |
| Tests and tooling | 479/479 unit, 313 pipeline tests (latest full runs) | Dev cold-load timeout unattributed |

## World

**Passes now (2026-11-06).**

- The selected section is 157 placements / 62 models plus the BSP floor and
  sky, with 4,992 terrain triangles. The base recipe is 61 models / 151
  placements with 2,352 terrain vertices and 4,512 triangles. These are
  different checkpoints; do not mix them when measuring a baseline.
- Overlap selection restores five source trees omitted by actor-origin
  selection. Report: `artifacts/native-parity/research/map-overlap-20261106/REPORT.md`.
- Actor3703 (eight triangles cross the section) is added with an exact native
  normal repair. Eight normal-repair and five derivation cases, 75 unit checks,
  four browser regressions and build pass. Repeats write nothing. Report:
  `artifacts/native-parity/research/map-overlap-expansion-20261106/tree-integration/REPORT.md`.
- Removing exact duplicate export materials reduces authored-route material
  objects 873 to 872 and texture objects 896 to 884. These are object counts,
  not measured VRAM or frame time.
- The native map oracle matches all 4,183 static-mesh identities and positions
  with the independent Java output to four decimals.

**Open.**

- The genericity audit ([genericity-audit-20261108.md](research/genericity-audit-20261108.md))
  confirms Warning 7: of 115 steps only 9 are script-only and generic; 18
  scripts fail on 20_21. The proposed `pnpm world:build` design is in that
  report (WORLD-01, WORLD-03).
- `loadNativeSection` eagerly loads the section and clones placements. There is
  no native streaming or LOD (WORLD-04). See [RENDERING.md](RENDERING.md).
- Native visible pixels and native collision for scenery.

Canonical doc: [NATIVE_WORLD.md](NATIVE_WORLD.md).

## Terrain

**Passes now (2026-11-06).**

- Scoped UV correction for the retained 20_20 section: exactly 735 V fields /
  1,078 geometry bytes change. Primary UV hash `d549356f…`; saved and public
  geometry hash `549a7fef…`. All U, V at Y<=240, diffuse UV2 and other bytes
  stay unchanged. The correction is in geometry, not in the shader.
- Checks: 27 converter + 8 runtime-bridge Python tests; 49 Vitest + 6
  `terrainLegacyReference` tests; 44/44 synthetic GPU cases on SwiftShader and
  on GTX 1060, maximum byte error 1 within the unchanged allowance; 5/5 browser
  regressions; glTF validation with zero errors and zero warnings. Report and
  commands: `artifacts/native-parity/research/terrain-uv-migration-20261106/implementation/REPORT.md`.
- The native packet behind the correction is offscreen submission evidence,
  not a visible native reference.
- TerrainSector247 is on both routes: 272 vertices / 480 triangles, 10
  extractor + 11 derivation checks, 102 unit checks, six export-sharing cases,
  seven hardware WebGPU browser cases. All 16 shared-edge rows match. Report:
  `artifacts/native-parity/research/terrain-extension-20261106/REPORT.md`.
- All 18 terrain PNGs match their independently decoded RGBA hashes. The nine
  diffuse textures have 81 hash-verified BC1 mips, 786,429 in-bounds texels and
  zero transparency.
- The staged section keeps the exact `Scale`, `ToWorld`, `ToMaskmap` and
  `bUseAlpha` tags with their serialized bytes. Evidence:
  `artifacts/native-parity/research/world-conversion-review/`.

**Commands.**

- GPU reference: `pnpm exec playwright test --config playwright.terrain.config.ts`
  (20 ordered-pass cases and 44 UV cases; it runs its own loopback fixture
  server).
- Mask branch audit: `pnpm exec node scripts/audit-terrain-uv-branches.mjs`.
  Seven of the nine retained masks differ between the two formulas, only at
  Y>240.

**Open.**

- The tile-general UV rule must pick the ordinary or stretched branch per tile
  (WORLD-01). See [NATIVE_WORLD.md](NATIVE_WORLD.md).
- Lineage DXT1 channel selection, per-mask sampling transforms, native mask
  blend, `bUseAlpha` behaviour and CPU geometry pruning (WORLD-01, POL-01).

## BSP

**Passes now (2026-11-06).** The qualified import restores the original
Brush397 floor slab (48 vertices / 28 triangles) omitted by static-mesh-only
loading. Extraction, derivation and packing checks, build, seven browser cases
and two exported-route regressions pass. Stairs, floor support and building
walls join bounded browser navigation. Repeated staging makes no changes.
Report: `artifacts/native-parity/research/native-building-floor-20261106/REPORT.md`.

**Open.** Full BSP support, native lighting, native collision and geodata.
Automatic stair routing and upper-landing roof occlusion are POL-03.

Canonical doc: [NATIVE_BSP_FLOOR.md](NATIVE_BSP_FLOOR.md). Doors and gates:
[NATIVE_DOOR_MOVERS.md](NATIVE_DOOR_MOVERS.md).

## Sky

**Passes now.**

- 2026-11-06: the source sky room (182 vertices / 76 triangles, three original
  texture and material chains) renders on both routes. Seven sky extraction,
  13 staging, 69 runtime and sky, 52 audio, actor and visual, and 14 mixer tests
  pass (148 unit cases in these selections). Report:
  `artifacts/native-parity/research/native-sky-audio-integration-20261106/REPORT.md`.
- Original texture alpha reaches the actual browser draws on both routes.
- 2026-11-07: environment conversion passes 11 focused checks. Five original
  files give 1,681 ordered properties, 20 tables and 500 exact colour rows. Two
  clean 18-file outputs match; repeat and verify-only keep hashes and mtimes.
  Report: `artifacts/native-parity/research/sky-environment-conversion-20261107/REPORT.md`.

**Open.** The frozen source colours show a hard yellow/blue boundary. Native
tint, time-of-day and composition policy are unresolved (WORLD-02, POL-01). No
gradient or recolouring is applied.

Canonical doc: [NATIVE_SKY.md](NATIVE_SKY.md).

## Audio

**Passes now (2026-11-08).** In the 20_20 slice one trusted tap unlocks one
`WorldAudioMixer`. Music, map ambience, gait-driven footsteps and combat sounds
play. Each rule is marked as native evidence or as a labelled presentation
choice. Details and recipes: [NATIVE_AUDIO.md](NATIVE_AUDIO.md).

- Footsteps use the 93-clip stepsound package with all 16 surfaces and follow
  the native support order. The deco-grass approximation, the random seed and
  the spatial listener are presentation choices.
- Gait speeds come from aCis server data: walk 0.80 m/s, run 1.15 m/s, and a run
  starts at walk speed for 0.4 s.
- All four humans have their own `chargrp` combat rows. The mystic combat routes
  are unit-tested against the staged bundle and need the next hardware browser
  run.
- Round-1 hardware evidence (headless Chromium, analyser and RMS only, nothing
  judged by ear): `artifacts/native-parity/research/dev-sheet-audio-20261107/round1/`.

**Conversion checks.**

| Check | Latest result | Evidence |
| --- | --- | --- |
| Sound corpus (2026-11-06) | All 4,773 Sounds from 18 packages export. 29 passes, two Windows symlink skips. Clean and seeded builds match, 38,188 files. Repeat gives 4,773 cache hits. The validator accepts the native name `sd_horror-04` without renaming. | `artifacts/native-parity/research/native-world-audio-20261106/sound-batch-integration/REPORT.md` |
| Browser decode | Every WAV decodes with exact channels, rates, frames and durations. All 232,411,790 signed16 samples are recoverable. Strict float equality stays FAIL_RETAINED: maximum absolute difference 0.000030517578125. This is a measured decoder normalization difference, not an accepted tolerance. | same report |
| Ambient export (2026-11-06) | All 106 Sound dependencies of the 2,620 20_20 declarations export, 21,664,812 WAV bytes. Two clean builds match (1,383 files). Two omitted Sound fields stay unresolved. 22 passes, one symlink skip. | `artifacts/native-parity/research/native-world-audio-20261106/ambient-export-integration/REPORT.md` |
| PointRegion parser (2026-11-06) | All 7,925 Region records and 23,775 child spans match the source oracle. Map suite 17 passes; audio export 22 passes, one skip. | `artifacts/native-parity/research/native-world-audio-20261106/pointregion-integration/REPORT.md` |
| Ambient backend (2026-11-06) | The 33-instruction distance graph and the 28-instruction type-gate slice pass 12 finite controls and 4,096 synthetic combinations. Conditional source checks, not native execution. | `artifacts/native-parity/research/native-world-audio-20261106/backend-closure/ambient-dispatch/REPORT.md` |
| RIFF framing (2026-11-06) | Nine audio tests pass. All 75 actor payloads join original UAX bytes. | `artifacts/native-parity/research/native-world-audio-20261106/riff-validation/REPORT.md` |
| Footstep config (2026-11-06) | 13 tests pass. All 24 keys decode; zero full-object joins, because the literals omit native groups. | `artifacts/native-parity/research/native-world-audio-20261106/backend-closure/footstep-config/REPORT.md` |
| Placement audio (2026-11-07) | Eight placements, 24 ordered slots, three WAVs, 149 explicit omissions. 26 passes, one symlink skip. Converted, not staged for playback. | `artifacts/native-parity/research/native-placement-audio-20261107/REPORT.md` |
| Skill audio (2026-11-07) | 35 pipeline tests. 29,812 skill rows and 1,398 sound rows; the recipe packages skill 3 / level 1 only. | `artifacts/native-parity/research/native-human-skill-audio-20261107/REPORT.md` |

The additive audio contract is `recipes/native-audio.acceptance.json`.
Numerical audio tolerances are not set; native audio parity cannot pass yet.

**Open.**

- Listen check against L2.exe (CHECK-02) and audio parity (POL-02).
- Other voices and actions, UI audio, and the nine UAX packages plus standalone
  voice outside the 4,773 batch (ACT-05, WORLD-02).
- Placement-audio slots are not staged for playback (WORLD-02).
- Six specialized events per Hand clip and two per special clip have no sound
  (POL-02). Female special-action mixed float peaks above 1 (POL-02).

## Actors and NPCs

**Passes now.**

- The four Human player models (MFighter, FFighter, MMagic, FMagic) are native
  Interlude exports at native scale. `pnpm assets:stage` runs
  `scripts/stage_native_players.py`. `pnpm build` excludes
  `public/assets/characters/`. Every model binds 45 of 46 animation aliases;
  `damage` has no source clip because Interlude has none. See
  [README.md](../README.md).
- 2026-11-07 locomotion: four hardware Chromium WebGPU cases (source and
  authored, male and female, desktop and mobile) walk, switch to run, return,
  pause, swap equipment and die with original event times and recorded
  post-gain output. 12 new cases pass; the regression selection has 155 unique
  passes. Report: `artifacts/native-parity/research/native-human-locomotion-20261107/REPORT.md`.
- 2026-11-07 ground contact: all eight doorway and stair waypoints match their
  baselines exactly; 298 footstep rows keep source clocks and contacts. 212
  unique tests and build pass. Report:
  `artifacts/native-parity/research/native-ground-contact-20261107/REPORT.md`.
- 2026-11-07 hand anchor: the exact upper-part, skin and joint binding for both
  fighters. 19 actor tests and 163 integration tests pass (182 unique). Four
  hardware cases: 6,739 pose samples, maximum matrix error below 4.55e-13
  against the unchanged 1e-5 bound. Report:
  `artifacts/native-parity/research/native-human-hand-anchor-20261107/REPORT.md`.
- 2026-11-07 special attack: source-animation preview for both fighters; eight
  direct cues reuse seven WAVs. 131 + 79 tests pass (210 unique). Report:
  `artifacts/native-parity/research/native-human-special-attack-20261107/REPORT.md`.
- Fighter facing: the source forward axis is +X and client heading zero is +Z,
  so a -pi/2 presentation-parent rotation aligns the whole assembly. 21 focused
  unit passes. Evidence: `artifacts/native-parity/research/movement-facing/forward-evidence.json`.
- Greater Musveren is NPC 21622: `LineageMonster.field_stalker_20_bi` with mesh
  `LineageMonsters.field_stalker_m00`. DrawScale 1.2 wraps the mesh; collision
  height 0.36 m stays independent. All 10,769 animation keys match independent
  PSA samples with zero error. See [NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md).
- Native skin weights: `_L2_NATIVE_WEIGHTS` and `_L2_NATIVE_JOINTS` keep the
  original float slots (adapter `L2NativeSkinWeights/1`). Nine objects, 3,254
  vertices, zero custom-slot error, zero Khronos errors.
- The fighter archive keeps its animation-family localizations: all 326 name
  fields resolve to the 114 exported clips; 133 case-only matches are recorded.

**Open.**

- At scale 1.2, 660 of 1,591 Musveren final-death vertices sit below terrain,
  maximum depth 0.119400140 m. No fitted offset is applied; PrePivot is
  unverified (ACT-02, CHECK-01, POL-01). Probe:
  `artifacts/native-parity/research/musveren-death/probe-npc-profile.json`.
- Weapon attachment: `Fighter.MFighter_m001_g` holds `e_Hand → Weapon_R_Bone`.
  The native hand-mesh formula is unknown, so no sword offset is guessed
  (ACT-03). Evidence: `artifacts/native-parity/research/weapon-attachment/README.md`.
- Musveren's alternate serialized weight stream differs at 684 vertices
  (maximum 0.000030517578125). Which stream native code selects is open.
- Native loop, one-shot and retrigger rules per clip; today's values are
  presentation choices (ACT-04).
- Mystic movement uses the fighter speeds as a presentation choice; mystic
  server speeds are not staged.

## Power Strike and effects

**Passes now (2026-11-07).**

- Source dispatch: init `LineageEffect.s_u002_a` (DrawScale 0.05) and shot
  `LineageEffect.p_u004_a` (0.02), both direct `Engine.Emitter` subclasses. All
  six emitter payloads and actor defaults are kept. See
  [NATIVE_POWER_STRIKE.md](NATIVE_POWER_STRIKE.md).
- Component viewer: six original components, 134 affected checks and build
  pass. Four hardware WebGPU cases (fallback=false): 10,127 source-pose samples,
  maximum matrix error 4.55e-13, six effect pipelines per case, no validation
  errors or device loss. All 64 captures inspected. Report:
  `artifacts/native-parity/research/native-power-strike-components-20261107/REPORT.md`.
- Timed init preview: three init components, 19 pooled particles. The 288-check
  selection and build pass; four hardware cases pass with 6,636 timed samples,
  10,561 source-pose samples and 28 inspected images. A late mobile particle is
  faint. Two warmed repeat cycles show zero tracked GPU resource-creation
  deltas; this is bounded reuse evidence, not a performance result. Report:
  `artifacts/native-parity/research/native-power-strike-init-20261107/REPORT.md`.
- Flames (2026-11-05): both routes render 12 flame placements / 24 material
  slots with 17 verified textures and two shared shader materials. It is an
  unlit formula preview. Controls: **Dev > World > Flames**. See
  [NATIVE_FLAMES.md](NATIVE_FLAMES.md). Evidence:
  `artifacts/native-parity/research/flame-runtime/`.

**Open.** Native emission and lifetime, the conditional shot, table-sound
policy, attachment and particle simulation (ACT-06, POL-01). Native flame
lighting.

## Textures

**Passes now (2026-11-05).**

- All 26 requested standalone textures keep 141 native mip payloads / 4,458,013
  bytes. 23 DXT1 textures also keep their blocks in DDS. Three P8 textures keep
  native indices, palettes and editable PNGs. No pixel is recompressed and no
  mip is generated.
- Real DDS browser case 1/1: nine full-chain uploads and one partial mip-0
  upload match their source hashes.
- DXT5 candidate (`migration-dxt5/`): `FX_E_T.Flameset.de_fire_glow` keeps seven
  mips, 10,944 block bytes in an 11,072-byte DDS. The flame archive has 250
  entries. 381 identical products, 100 valid archives, 313 pipeline tests with
  zero skips. The default migration keeps the earlier snapshot.

Evidence: `artifacts/native-parity/research/compressed-textures/`,
`artifacts/native-parity/research/terrain-materials/`,
`artifacts/native-parity/research/flame-runtime/texture-dxt5/`. Canonical doc:
[NATIVE_TEXTURES.md](NATIVE_TEXTURES.md).

**Open.** Native mip sampling and blending. Model GLB embedded textures are PNG
derivatives; general P8 GPU compression and mobile transcoding are not
implemented (PERF-02).

## Migration and catalog

**Passes now (2026-11-05).**

- `pnpm assets:migrate --prove-rebuild --stage-runtime`: 381 identical
  products, 26/26 cache hits, zero hits in the clean directory, 100 archives (69
  models, 29 textures, two audio), 70 GLBs with zero Khronos errors and
  warnings. `pnpm assets:migrate --verify-only` passes. Logs:
  `artifacts/native-parity/migration-power-strike-dispatch-{proof,verify}.log`.
- Source lock: 143 files / 2,511,063,181 bytes from IMPORTA-PC, including
  read-only Engine.dll evidence. The protected INI stays unchanged and is never
  copied.
- StaticMesh materials use native object indices: `world_obj14` index `-14`
  resolves to `Field_Deco_Artifact_T.sk_ruins.stone_033`; six section models keep
  28 exact slots.
- Preservation (2026-11-07): all 2,315 authored files and 143 original inputs
  are unchanged; 10,767 public files match `dist`; all 30 terrain-channel
  slices pass.

Commands and output contract: [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md) and
[ASSET_PIPELINE.md](ASSET_PIPELINE.md).

**Open.** The genericity audit finds that 20_20 cannot be rebuilt from
committed code: retained receipts record implementation hashes that match no
commit (WORLD-01, EDIT-02). See [genericity-audit-20261108.md](research/genericity-audit-20261108.md).

## UI and dev sheet

**Passes now.**

- The only UI is the developer sheet: pinnable, tabbed, filterable, with
  hover-cards that show each control's live variables and native-or-presentation
  status. See [README.md](../README.md) and [DESIGN.md](../DESIGN.md).
- 2026-11-06 loading panel: four ordered steps with measured progress. 4/4
  loading UI cases, 1/1 geometry-502 case, 1/1 module-failure reload. Retry
  pressed-state contrast 4.96:1; finish review disposition: ship. Evidence:
  `artifacts/private-preview/startup-loader-change/`,
  `artifacts/private-preview/loading-panel/finish-review.md`.

**Open.** `interface.xdat` windows built from decoded layouts (UI-01, UI-02).
Assistive-technology announcement delivery is not demonstrated.

## Startup

**Passes now (2026-11-06).** Native visuals allocate no procedural stand-ins.
Startup waits for native assembly, initial equipment, terrain and enabled
flames, then for a ready frame before and after drawing. Missing or failed
native packages reject startup (ARCH-03).

- 479/479 unit tests in 42 files; production build passes.
- 5/5 reveal cases in Chromium and 5/5 in WebKit. Each first reveal has ready
  terrain, equipment and HUD, two native actors, zero fallbacks and zero early
  exposures.
- Facing case 1/1 with unobstructed ground input and unchanged thresholds.

Evidence: `artifacts/private-preview/native-reveal/browser-verification.json`.

**Open.** The correction is staged only in
`artifacts/private-preview/native-reveal/dist-stage/`; the live preview keeps an
older build.

## Private preview

**Passes now (2026-11-05).** `l2.kingdom.lv` serves the local production build
behind a private invitation gate, from DATABASE-PC loopback port 8189. The local
gate checker passes 45 checks. External desktop and mobile runs pass 29 checks
with 630/630 and 629/629 requests completed. nginx runs with
`worker_connections` 1024 and listen backlog 1024; a backlog change needs a stop
and start. Evidence: `artifacts/private-preview/webkit-backlog-1024/`,
`artifacts/private-preview/origin-burst-after-capacity/`.

**Open.** No reboot persistence. HEAD burst checks do not measure GET transfer
or rendering. Canonical doc: [PRIVATE_PREVIEW.md](PRIVATE_PREVIEW.md).

## Native reference captures

- IMPORTA-PC `ANIMPLAY ANIM=Atk01_Hand_MFighter` shows the full attack loop
  visually. Its recording decodes 33 frames over 7.97 s (4.142 FPS). Evidence:
  `artifacts/native-parity/reference-current/animplay-20261105-20261105-200102/`.
- `gfxcapture` reaches 8.320 FPS. Both fail the fixed 30 FPS reference gate
  (POL-01).
- Native captures run windowed with the unchanged protected Debug INI.
- IMPORTA-PC's active display is 2560x1440 at 59 Hz; a 120 Hz mode is enumerated
  but not selected. DATABASE-PC has no 120 Hz display.

See [NATIVE_PARITY.md](NATIVE_PARITY.md).

## Tests and tooling

| Command | Latest recorded result |
| --- | --- |
| `pnpm test:unit` | 479/479 tests, 42 files (2026-11-06) |
| `pnpm test:pipeline` | 313 tests, zero skips (2026-11-05, DXT5 output) |
| `pnpm build` | Passes; main chunk 3,922.10 kB / 975.64 kB gzip with the large-chunk warning (2026-11-05) |
| `pnpm assets:migrate --verify-only` | Passes (2026-11-05) |
| `pnpm exec playwright test --config playwright.terrain.config.ts` | 1/1 test covering the GPU reference cases (2026-11-06) |

- `pnpm test:setup` installs Playwright Chromium once. `pnpm test` runs Vitest,
  then Playwright, which starts its own `pnpm dev` on port 5173 or on `DEV_PORT`
  from `.env`.
- Chromium uses SwiftShader WebGPU unless `WORLD_HARDWARE_TEST=1` selects the
  normal GPU.
- Run `pnpm assets:stage` and `pnpm assets:migrate --stage-runtime` before the
  native browser suites; checks without staged packages skip explicitly.
- The Vite watcher excludes only `**/artifacts/**`.
- Babylon Addons 9.27.1 and Recast 0.43.0 are pinned because the Editor's
  generated script entry imports plugins that CLI pack omits. Evidence:
  `artifacts/native-parity/research/editor-plugin-dependencies/`.

The Phase 1 procedural foundation shipped in commit
`3b16f1c317e20ee636a3b3f83bddafc15096740a` (37 unit tests, 9 Playwright tests).

## Editor viewer (optional)

The Editor is an optional viewer and gates nothing (DEC-OWN-8, NOED-05,
VIEW-01). Its save, reopen, Play, UV2 and material checks and their evidence are
in [EDITOR_VIEWER.md](EDITOR_VIEWER.md). Evidence roots:
`artifacts/native-parity/editor/`.

## Open

Items that no requirement covers:

- Physical-phone, real Safari and iPhone validation, including the original
  flicker report.
- Deploying the staged native-reveal correction to the private preview.
- The development-server cold-load timeout: a 21-23 s gap in the module
  waterfall stays unattributed. Evidence:
  `artifacts/native-parity/research/editor-dev-startup/README.md`.
- Collision for static meshes and added scenery (WORLD-05 covers terrain only).
- Stride-to-distance matching for walk and run.
