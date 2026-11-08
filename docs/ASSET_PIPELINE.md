# Native Interlude asset pipeline

Canonical conversion doc: commands, package contract, per-system scripts,
staging rules, coverage and open items. Status and work order are in
[.planning/STATE.md](../.planning/STATE.md) and
[.planning/ROADMAP.md](../.planning/ROADMAP.md). Work order is breadth-first
stage A (DEC-OWN-1).

Rules:

- One small, independently runnable script per game system, sharing format
  readers, identity checks and packaging helpers. One character, skill, world
  section or environment dataset converts without running all extraction.
- `pnpm assets:pipeline` is optional. Dedicated commands come first. Do not
  rerun a batch or a completed corpus export to use one system.
- Recipes select variants and source objects; they never copy readers per
  race, building or tile.
- Conversion, staging, runtime behaviour and visible or audible acceptance are
  separate coverage stages.
- Generated artwork stays local and ignored by Git; code and recipes are
  tracked. The tools never edit the client or `C:/laragon/www/lineagen`.

This is a bounded pipeline, not an Unreal runtime: no native effect execution,
gameplay, full shader set or arbitrary package classes. Source evidence:
[NATIVE_CLIENT_AUDIT.md](NATIVE_CLIENT_AUDIT.md).

```text
Read-only Interlude source + source/dependency identities
  -> inventory and recipe selection
  -> type-specific readers/converters
  -> verified GLB, textures, audio and metadata/event sidecars
  -> versioned bundles + coverage manifest + reusable cache
  -> explicit browser staging into the .l2asset catalog
  -> runtime behaviour and source-route verification
```

GLB carries models, rigs and animations; everything else needs sidecars and
browser code.

## Source and tools

- Reference: IMPORTA-PC `C:/Lineage2-client`, pinned at
  `artifacts/native-parity/inputs/IMPORTA-PC`. Pass
  `--client artifacts/native-parity/inputs/IMPORTA-PC`. `native_assets.py` and
  `native_effects.py` default to `E:/lineage2-client`, which is a conversion
  source only after the full-tree hash lock (DEC-OWN-2).
- Default output: `artifacts/native-assets`. Output inside the client fails.
- Python 3.12 and UModel build1590, SHA-256
  `13502e5a4d8f6b5f32252afebd6360f7302ccfaccf6b8dda65beff0be2d364a0`, by
  default under `C:/laragon/www/lineagen/.assets/skill-assets/work/native/tools/umodel`.
  Any other hash is rejected.
- Table definitions and format constants are pinned by
  `scripts/native_catalog/tables.py`.
- Elsewhere set `L2_UMODEL`, `L2_SCHEMA_ROOT` (schema `structure` directory)
  and `L2_CRYPTO_SOURCE` (`l2encdec.cpp`). They change paths only; hashes are
  still checked. Effects also accept `--uelib` and `--powershell`.

## Package contract

Output is `.l2asset` packages plus the runtime catalog (DEC-OWN-5).
`recipes/native-inputs.lock.json` is input-only. There is no merged manifest.

- Deterministic ZIP_STORED, fixed timestamps, safe relative paths, holding
  `asset.json` and exactly its listed payloads. Limits: 128 MiB per archive,
  96 MiB per payload, 256 entries. No encryption, no ZIP64.
- `asset.json`: schema 1, identity, name, kind (`model`, `audio`,
  `texture`); edition, package, object, source SHA-256, package versions;
  coordinate metadata or a payload reference; SHA-256, size and MIME per
  payload; limitations and authored animation events. Units and handedness
  are recorded per route (DEC-OWN-5, FOUND-02).
- Each archive sits in its own SHA-256 directory. `provenance.json` pins the
  request, loaded dependencies, converter, exporter, format definitions,
  material decisions and export-buffer hashes.
- `index/` receipts are reused only after tool pins and all source and product
  hashes pass again. A changed source gets a new address; corrupt immutable
  output fails and is never overwritten. Failed jobs log to `.work/`, UModel
  diagnostics to each result's `evidence/`. No absolute scratch paths ship.

## Staging rules

- Staging is explicit and merge-aware. Stagers (`stage_*`, `stage-native-*`,
  `native_effect_registration.mjs`) take the expected current catalog hash,
  add their own records and never replace other systems' entries. A changed
  catalog or a conflicting identity stops with no files changed. They offer
  write-free plan, verify and repeat modes.
- Native-store writers (`assets:*`, `world:stage`, `assets:stage`, `stage_*`,
  `derive-*`, `migrate-*`) run only in the main checkout. A lane writes to its
  own output folder; the integration thread stages it in the main checkout
  (INT-01).
- Conversion never reimports saved scenes. The Babylon.js Editor is an
  optional viewer outside build and runtime (DEC-OWN-8,
  [EDITOR_VIEWER.md](EDITOR_VIEWER.md)).
- Never stage the legacy `assets:migrate` map output: its 61 models / 151
  placements would replace the current 62 / 157 catalog. The batch entry point
  never supplies staging or Fleet flags.

## Coverage by system

| Area | Scripts | Coverage and gaps |
| --- | --- | --- |
| Shared conversion | `scripts/native_assets.py` (`assets:convert`, `assets:batch`, `assets:verify`) | Model, texture, audio; dependency hashes, validated archives, cache reuse. |
| Batch orchestration | `scripts/native_batch.py`, `native_batch_adapters.py` (`assets:pipeline`) | Optional. Selected assets, legacy migration, environment, sky, sounds, ambient. Staging and benchmarks separate. |
| Legacy migration | `scripts/native_migration.py` (`assets:migrate`) | Eight job groups for the actor, equipment, NPC, map, texture and effect slice. [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md). |
| Characters | Shared converter plus assembly, binding, skin and animation readers in `scripts/native_assets_lib` | Male and female fighters with Walk/Run and footsteps; female: 7 parts, 113 clips, 61 sounds. Mystic footsteps bundled. Other classes and skills open (ACT-01, ACT-06). |
| Player staging | `scripts/stage_native_players.py` | Verifies packages, profiles and catalog hash; adds records without replacing the world. |
| World | `scripts/native_map.py`, `scripts/native_map_geometry.py` | Selected 20_20: 62 models / 157 placements, terrain extension, four BSP resources. Not the whole map (WORLD-01). |
| Placement step sounds | `scripts/bundle-native-placement-audio.py` | 24 slots on eight placements, three WAVs; 149 omissions explicit. Not staged. |
| Animation audio | `scripts/inventory-native-footstep-events.py`, `scripts/bundle-native-animation-audio.py`, `scripts/stage_native_animation_audio.py` | 20 footstep dependencies for fighters and mystics. |
| Combat audio | `scripts/bundle-native-combat-audio.py`, `scripts/stage_native_combat_audio.py` | All four humans. |
| Skill audio | `scripts/bundle-native-skill-audio.py` | Power Strike 3/1: two WAVs. Lookup and timing open (ACT-05, ACT-06). |
| Sounds | `scripts/export-native-sounds.py` (`assets:sounds`) | 4,773 exports from 18 UAX packages. Nine packages and standalone music and voice outside (WORLD-02, ACT-05). |
| Ambient | `scripts/export-native-map-audio.py` (`assets:ambient`) | 106 referenced Sounds for 20_20. Playback not connected (WORLD-02). |
| Sky and environment | `scripts/export-native-environment.py`, `scripts/stage-native-environment.mjs` | Three sky layers; 20 tables / 500 colour rows. [NATIVE_SKY.md](NATIVE_SKY.md). |
| Effects | `scripts/native_effects.py` (`assets:effects`), `scripts/native_effect_bundle.py`, `scripts/stage-native-effect.mjs` | Source graphs; flame preview; special-attack clips with direct cues. Full Power Strike and particles open (ACT-06). [NATIVE_POWER_STRIKE.md](NATIVE_POWER_STRIKE.md). |

## Shared converter

```powershell
pnpm assets:batch recipes/native-starter.json
pnpm assets:batch recipes/native-mfighter.json
pnpm assets:convert --kind model --package Fighter --object MFighter_m000_u --animation MFighter_anim --with-event-audio
pnpm assets:convert --kind model --package speaking1f_s --object wall03
pnpm assets:convert --kind texture --package FFighter --object FFighter_m010_t59_l_ori
pnpm assets:convert --kind audio --package skillsound --object power_strike_cast
pnpm assets:convert --kind audio --media music/b01_f.ogg
pnpm assets:verify artifacts/native-assets/<sha256>/asset.l2asset
```

`--client`, `--output` and `--umodel` change locations. The starter makes a
textured wall, an animated fighter upper body, a texture, a skill sound and
decoded music. `native-mfighter.json` assembles body, face 0 and hair colour 0
with 114 clips and 63 direct sound references. Its five body and face bindings
are verified against exact `chargrp.dat` fields and the table hash; hair
meshes and the head bone against `LineageWarrior.MFighter` defaults, because
this `chargrp` holds unrelated dark-elf hair placeholders. Hair colour 0 is a
recipe choice; `hairgrp` selection is unresolved (ACT-01, DATA-02).

With `pnpm dev`, drop a package
on the world or open **Browse packages**; the inspector shows metadata,
limitations and previews with identity transforms. On a native world route,
**Dev → Debug › Asset inspector → Assets** opens the isolated viewer; the world
suspends while it is open. Importing never replaces an entity or adds an actor.

## Characters

```powershell
pnpm assets:batch recipes/native-ffighter.json --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-assets/ffighter-direct
pnpm assets:pipeline --recipe recipes/native-pipeline-ffighter.json --output artifacts/native-assets/ffighter
pnpm assets:pipeline --recipe recipes/native-pipeline-ffighter.json --output artifacts/native-assets/ffighter --verify-only
```

The female fighter: seven parts, 113 clips, 323 events, 61 linked sounds, with
clean and repeat verification. Identical duplicate localization rows are kept;
conflicting rows fail. Face and hair keep their own head weights. Shared reader
changes use fresh outputs. The female-world profile passes desktop and mobile
viewport/touch hardware WebGPU checks with equipment, actions and post-gain
audio; her four death cues keep source bytes and events.

## Batch orchestration

```powershell
pnpm assets:pipeline --recipe recipes/native-pipeline-slice.json --output artifacts/native-pipeline/slice --plan
pnpm assets:pipeline --recipe recipes/native-pipeline-slice.json --output artifacts/native-pipeline/slice
pnpm assets:pipeline --recipe recipes/native-pipeline-slice.json --output artifacts/native-pipeline/slice --verify-only
```

The slice uses pinned inputs plus a five-file environment lock: one building,
one texture, one skill Sound, sky geometry and environment tables.

- An unchanged rerun is sealed batch reuse after rechecking pins and product
  hashes. It calls no converter, rewrites no mtimes, and is not a cache hit.
- `--verify-only` never runs the legacy migration verifier that writes files.
- Changed settings, implementation or corrupt products need a fresh output.
- `--reuse-from <completed-batch>` copies only hash-verified job products into
  a fresh target, rechecks coverage, leaves the original intact and runs
  adapters only for unmatched jobs. Interrupted or unowned outputs are refused.
- `dependsOn` blocks consumers of incomplete jobs; independent jobs keep
  results.
- Exit 0 = requested coverage complete, 2 = explicit partial, 1 = failure. No
  exit code means gameplay or native acceptance.

## Animation and combat audio

```powershell
python -B scripts/bundle-native-animation-audio.py --recipe recipes/native-human-footstep-audio.json --output artifacts/native-parity/research/native-footstep-audio-20261107/bundle --verify-only
```

The fighter bundle reuses the 20 exported footstep dependencies with complete
raw Walk/Run events, ordinals and ordered arrays, without reconverting a rig.
Omit `--verify-only` for fresh output or exact reuse; `--plan` writes nothing.
`scripts/stage_native_animation_audio.py` needs the manifest hash and current
catalog hash.

The mystics (MMagic, FMagic) have no retained research inventory. A small
step copies their `Walk_Hand_*`/`Run_Hand_*` notify records unchanged from the
staged archives and joins them to the same 20 StepSound rows. Same bundle and
stager; own catalog id:

```powershell
cd scripts
python -B inventory-native-footstep-events.py --recipe ../recipes/native-human-mystic-footstep-events.json --output ../artifacts/native-parity/research/dev-sheet-audio-20261107/footstep-mystics/inventory --verify-only
python -B bundle-native-animation-audio.py --recipe ../recipes/native-human-mystic-footstep-audio.json --output ../artifacts/native-parity/research/dev-sheet-audio-20261107/footstep-mystics/bundle --verify-only
python -B stage_native_animation_audio.py --bundle ../artifacts/native-parity/research/dev-sheet-audio-20261107/footstep-mystics/bundle --manifest-sha256 e83b3ffe980ae67ca8369ea2e2331a5b3c9202806e59c8f30bf5f41a4d26a243 --expected-catalog-sha256 <current catalog sha> --id human-mystic-footsteps --verify-only
```

Combat sounds for all four humans come from `recipes/native-combat-audio.json`
through `scripts/bundle-native-combat-audio.py`, then
`scripts/stage_native_combat_audio.py`. `--replace-manifest-sha256 <old>`
swaps the staged record and removes only the old bundle's verified files.

Footsteps play original Walk/Run clips during travel for both fighters.
Surface and sample selection is explicit and off by default; gaits use the
demo speed. Movement-support mesh and triangle identities sit beside each
dispatch; no surface category is inferred. Preview rules:
[NATIVE_AUDIO.md](NATIVE_AUDIO.md).

## Placement audio

```powershell
python -B scripts/bundle-native-placement-audio.py --recipe recipes/native-20-20-placement-audio.json --output artifacts/native-parity/research/native-placement-audio-20261107/bundle --verify-only
```

Keeps the `StepSound_1/2/3` declarations the geometry projection omits: eight
actors, 24 slots, three Wood WAVs in the 157-placement selection. All 149
omitted actors stay explicit, including the indoor stair; no defaults. Ordinals,
raw tags and slot order are kept. No geometry conversion, staging or playback
policy.

## Skill audio

```powershell
python -B scripts/bundle-native-skill-audio.py --recipe recipes/native-power-strike-audio.json --output artifacts/native-parity/research/native-human-skill-audio-20261107/bundle-verification/build --verify-only
```

Reads explicit skill/level selections from pinned complete `skillgrp` (29,812
rows) and `skillsoundgrp` (1,398 rows) products and reuses verified WAVs. Keeps
global ordinals, duplicates, nine sound slots and thirty voice fields,
including empty and omitted values. Power Strike 3/1 packages two unchanged
stereo WAVs from `spelleffect_sound_*` fields. Neither a `_shot` filename nor
raw fields establish onset, impact or selection. Group-less names stay labelled
candidates. For new inputs, `scripts/native_catalog.py --table skillgrp
--table skillsoundgrp` prepares the tables; pin outputs and identities in the
recipe.

**Dev → Combat › Actions → Special attack preview** plays each fighter's
original `SpAtk01_1HS` clip and four directly bound cues after audio unlock,
from existing archives. It does not implement native skill, effect or
table-sound dispatch.

## Effects

```powershell
pnpm assets:effects --skill 1011 --level 1 --output artifacts/native-effects/heal.json
pnpm assets:effects --output artifacts/native-effects/heal.json --verify
python -B scripts/inspect-native-effect-bundle.py --bundle artifacts/native-parity/migration/effects/power-strike-source-dispatch --output artifacts/native-parity/research/native-power-strike-effect-preview-20261107/EFFECT_READINESS.json
node scripts/stage-native-effect.mjs --bundle artifacts/native-parity/migration/effects/power-strike-source-dispatch --output artifacts/native-assets/effect-components --expected-manifest a79e3d550640f94b2ce682fc0f75c9f0a53e35cc4b3f18f3353d7ac40b1d06e0 --plan
```

- `assets:effects` extracts the skill level, cast and shot actions, effect
  classes, emitter properties, inherited defaults and qualified dependencies.
  Heal: two actions, two effect classes, 52 resolved references. The output is
  an extraction graph, not a playable effect; particles, blends, attachments
  and dispatch need missing C++ behaviour and stay explicit gaps.
- `inspect-native-effect-bundle.py` (add `--verify` to check) compares each
  ordered emitter's source records with the converted GLB materials, without
  the client, converter or a browser. Ready resources are not a playable
  skill; texture animation links get no invented loop.
- `stage-native-effect.mjs` reuses verified GLBs and PNGs and keeps ordered
  actor and emitter records, properties, texture bindings and frame links. It
  chooses no sound or skill timing. Drop `--plan` to stage.
- `native_effect_registration.mjs` is optional. It selects a staged bundle in
  the current catalog without rewriting other entries, inside the shared
  catalog ownership window, with explicit `--catalog`, `--manifest` and hash
  guards.
- The timed init preview reuses that bundle: three init components, a fixed
  pool of 19 particles and the original special-animation clock, with no new
  converter or guessed sound event.

## Environment and sky

`scripts/export-native-environment.py` keeps the five Env/timeenv inputs;
`scripts/stage-native-environment.mjs` stages exact tables under the
conversion-manifest hash. All 20 tables / 500 colour rows, count
discrepancies, duplicate sections and offsets are kept. The browser uses them
only for a selected reversible comparison. The sky command adds the original
sky room (182 vertices / 76 triangles). See [NATIVE_SKY.md](NATIVE_SKY.md).

## Sound corpus

```powershell
pnpm assets:sounds --output artifacts/native-sounds/staged
pnpm assets:sounds --output artifacts/native-sounds/staged
pnpm assets:sounds --output artifacts/native-sounds/staged --verify-only
pnpm assets:sounds --output artifacts/native-sounds/corrected --reuse-from artifacts/native-sounds/staged
```

Inventories every `Engine.Sound` export in the 18 UAX packages pinned by
`recipes/native-sounds-staged.json`, keeping identities, serialized records,
WAV chunks and provenance. Unsupported coverage is reported apart from
integrity errors. The repeat needs real cache hits; verify-only writes
nothing. `--reuse-from` (for wrapper-only changes) imports verified products
into a fresh directory after rechecking the old output, sources and pins.

The source oracle has 4,773 PCM16 WAVs (4,602 distinct hashes). A clean build
matches the seeded build across 38,188 files; repeat gives 4,773 cache hits.

## Ambient, regions and audio audits

```powershell
pnpm assets:ambient --output artifacts/native-ambient/20_20
pnpm assets:ambient --output artifacts/native-ambient/20_20 --verify-only
python -B scripts/native_map.py --client artifacts/native-parity/inputs/IMPORTA-PC --recipe recipes/native-map-20_20.json --output artifacts/native-map-pointregion/20_20
```

- `assets:ambient` (`recipes/native-ambient-20_20.json`) resolves 106 Sound
  objects from 2,620 declarations in `20_20`; two omitted fields stay
  unresolved. A repeat gives 106 cache hits with no rewrites. Declarations,
  unknown spans, Sound objects, WAV bytes and provenance are kept. Output stays
  outside the catalog and runtime.
- `native_map.py` decodes 7,925 PointRegion structs through the strict
  tagged-property parser, keeping references, omitted and unknown fields and
  raw spans. Use a fresh output for this reader version, including
  `assets:ambient`. The recipe's PlayerStart origin does not change the actor
  and ambient census. `ambient-sounds.json` holds 2,622 LevelObjects as
  declarations, not playback.
- `scripts/audit-native-footstep-config.py` inventories ALAudio footstep text
  against Sound identities: 24 keys, group-less names unresolved.
- `pnpm exec node scripts/audit-native-audio-coverage.mjs` audits source,
  export and runtime gaps without changing assets.
- `python -B scripts/native_audio.py <source.wav>` inspects a WAV read-only:
  all RIFF chunks, offsets, lengths, hashes and padding; malformed framing after
  PCM fails. A decoder edit changes the cache key; older products and the
  catalog stay until an explicit reconversion.

## World geometry

20_20 world steps are tile-specific; each becomes a tile-general converter
step (DEC-OWN-7, WORLD-01). See [NATIVE_WORLD.md](NATIVE_WORLD.md) and
[NATIVE_BSP_FLOOR.md](NATIVE_BSP_FLOOR.md).

- Terrain extension stages TerrainSector247 (272 vertices / 480 triangles)
  without replacing geometry or materials; conflicting shared material
  identities stop export.
- The map-model command restores Actor3703 and its tree (157 placements / 62
  models), repairs converted normals with exact native floats and stages an
  immutable derivative. Terrain UVs and UV2 stay unchanged.
- The BSP floor pipeline extracts the Brush397 slab from final `ULevel.Model`
  polygons, then derives an immutable bundle.
- Optional Editor append steps exist for the viewer only
  ([EDITOR_VIEWER.md](EDITOR_VIEWER.md)).

Texture products are in [NATIVE_TEXTURES.md](NATIVE_TEXTURES.md). The optional
`pnpm assets:migrate --prove-rebuild` uses the pinned IMPORTA-PC snapshot and
writes under `artifacts/native-parity/` ([NATIVE_MIGRATION.md](NATIVE_MIGRATION.md)).

## Recipes and materials

- A batch file is a JSON array of requests. A model request may set
  `materials: ["0=Package.Group.Material"]` (zero-based slots). Duplicate
  slots, missing or ambiguous objects and missing assets fail. Group-less DAT
  references resolve only if the leaf is unique in the named package.
- A skeletal assembly has `kind: "model"`, `name`, `animation` and up to 16
  `parts` (`package`, `object`, `materials`). Parts keep geometry, skeleton,
  mesh transform and channels. Same-named clips merge; differing durations or
  event sets fail.
- `sourceBinding` pins a DAT hash and exact field paths; the converter
  re-decodes the table and checks both. Never substitute Classic, H5 or Unity
  assets. Unverified appearance choices stay labelled overrides.
- Rigid face and hair need an explicit `rigidAttachment` bone; assembly rejects
  root-only rigid parts. The male sample checks `HeadBone="Bip01_head"`,
  `Mesh` and `SubMeshes[4/5]`, then uses a single-joint skin with that bone's
  original inverse bind matrix. Native facial aim and submesh attachment
  formulas are not implemented.

Material rules:

- `Texture` slots keep exact references and decoded PNGs.
- `Shader.Diffuse` and `FinalBlend.Material` chains are followed with cycle
  limits; properties, references and trailing bytes are kept.
- Two-sided, alpha-test and alpha-reference values inform the preview.
  Specular, environment maps and framebuffer blending are listed limitations.
- An unbound slot (`Material=None`) becomes a named magenta diagnostic. No
  texture is guessed by name.

StaticMesh slots come from the `Materials` ArrayProperty and tagged
`FStaticMeshMaterial` records. `scripts/native_assets_lib/static_materials.py`
admits reviewed UE123 licensee 16, 19, 20, 22, 23, 25, 28, 30 and 31 only;
other versions fail. 20 objects across 8 packages / 280 slots are verified
against original compact indices, order and slot bytes
(`tests/pipeline/fixtures/static-material-versions.json`). The source object
index resolves the exact identity; order, repeats, flags, raw bytes and
explicit-null versus omitted values stay in `nativeStaticMaterials`. Example:
in `field_deco_artifact_s.elf_ruin.world_obj14`, index `-14` selects
`Field_Deco_Artifact_T.sk_ruins.stone_033`, not the same-named local mesh. The
six section models resolve 28 exact slots, including the Shader
`Oren_tree_T.Elf_Color.oren_tree1_leaf_1`.

Texture archives keep source data for reviewed UE123 licensee 20, 28 and 30
layouts: `native-texture-source.json`, the export, each `native/mipNN.bin` and
same-package Palette bytes. No mip generation, decoding or alpha edit;
`image.file` is the mip-0 PNG. An omitted Format needs the reviewed Engine
class-default hash. Unreviewed formats record
`nativeTextureSource.status = unsupported`.

## Scale, geometry and animation

- Native `(x,y,z)` maps to glTF metres `(.01*x,.01*z,.01*y)`. `asset.json`
  records it; the browser does not apply it again. It is not a height or the
  actor's `DrawScale`.
- `MeshOrigin`, `MeshScale` and `RotOrigin` go on a joint parent using
  UEViewer's `SetMesh`/`RotatorToAxis`. No height normalization, ground fitting
  or root-drift removal.
- All exporter BIN bytes are kept; accessor bounds are recomputed. Zero
  tangents from build1590 drop that optional attribute only. Zero-count
  primitives are removed with index-remap evidence (`elf_ruin02` keeps native
  section indices 1-8); `staticSectionBindings` checks each primitive.
- A UE123 licensee 28 and 30 reader restores float skin influences after exact
  position/UV and bone matching. `_L2_NATIVE_WEIGHTS`/`_L2_NATIVE_JOINTS` keep
  exact values and duplicate slots; `native-weights-source.json` keeps the
  mapping. No normalization. Standard attributes hold a glTF-legal derivative.
  The `L2NativeSkinWeights/1` loader adapter (`model.nativeSkinAdapter`) applies
  the exact attributes. Source selection follows UEViewer
  `ConvertMesh/RestoreLineageMesh`; both representations stay in provenance,
  and which one the native runtime picks is unverified.
- Animation is decoded from `MotionChunk`/`AnalogTrack` (licensee 28 and 30),
  because UModel's CLI glTF export omits it. Quaternions map `(x,y,z,w)` to
  `(x,z,y,w)`, root conjugated, W unchanged. Tracks without times space keys
  across `NumFrames`. No PSA resampling or Blender.
- Bone mapping checks names and parents; the fighter's duplicated finger name
  and reordered weapon/shield siblings resolve by hierarchy.
- `animations[i].extras` holds `nativeFrames`, `nativeRate`,
  `nativeDurationSeconds`; `animation-source.json` keeps motion hashes, bone
  maps and root tracks. No loop endpoint is inserted; the inspector does native
  LERP/SLERP looping.

## Sounds and notification data

Each actor, animation, skill or enemy bundle keeps its resolvable payloads,
identities, notification times and conditional events, reusing verified shared
products. No single bundle needs the 4,773-sound batch. Unresolved selection
stays visible, never a guessed cue or silence (ACT-05). The playback consumer
is a required stage of the same system.

- Sounds are read by exact export identity and bounded offsets, including
  duplicate leaf names. WAV and Ogg stay byte-for-byte. The L2SD wrapper
  restores the Ogg signature and removes only a verified footer; page
  checksums, sequencing, serials and Vorbis headers are checked.
- `--with-event-audio` resolves each direct `animationEvents[].sound` and
  links the payload via `resolvedFile`. Conditional arrays, event functions,
  attack state and footstep selection stay metadata. Preview needs user
  interaction; native volume, radius, randomization and mixing are not
  reproduced.

Counts do not add up: 4,773 Sound exports; 75 embedded actor WAVs (male and
Musveren); nine world preview cues per route (male: four fighter death, two
Musveren death, three Musveren attack; female: four female death, five
Musveren), thirteen definitions across both variants. With special preview on,
each route has thirteen action cues / twelve payloads, both variants 21 / 16.
Uncovered: six events per fighter on Hand attacks, two per special clip, six
specialized female attack events (POL-02). The human class, skill and footstep
gap inventory is
`artifacts/native-parity/research/native-ffighter-world-20261107/HUMAN_COVERAGE.json`,
with `HUMAN_NEXT.md` beside it.

## Verification

```powershell
pnpm test:pipeline
pnpm assets:batch recipes/native-starter.json
pnpm assets:batch recipes/native-starter.json
```

The repeat reports cache hits. Tests cover corruption, path rejection, byte
preservation, part remapping, pivot scale, cache invalidation and track bounds.
Local fixtures compare more than 100,000 source keys with PSA samples and
sound bytes with the pinned export; a native-axis regression checks more than
10,000 keys. Fixtures are not published. The seven-part fighter and wall pass
the Khronos validator with zero errors and warnings (structure, not parity).
The nine-object weight probe shows zero custom-slot error. Stage A acceptance
is the side-by-side check against L2.exe (DEC-OWN-3,
[VERIFICATION.md](VERIFICATION.md)). The WebGPU measurement checkpoint is an
opt-in pilot, not a performance pass (PERF-01, PERF-02).

## Open

No requirement covers these:

- Placement StepSound playback: bundle not staged, no runtime consumer.
- UI sound consumers.
- Physical-phone checks (passes use viewport and touch emulation).
- Native Walk/Run movement rates.

## Evidence

Under `artifacts/native-parity/research/`:

- `native-ffighter-expansion-20261107/REPORT.md`
- `native-ffighter-world-20261107/{REPORT.md,HUMAN_COVERAGE.json,HUMAN_NEXT.md}`
- `native-stair-traversal-20261107/IMPLEMENTATION.md`
- `native-footstep-audio-20261107/{BUNDLE_REPORT.md,REPORT.md}`
- `{native-human-locomotion,native-ground-contact,native-placement-audio,native-human-skill-audio,native-human-special-attack}-20261107/REPORT.md`
- `native-power-strike-components-20261107/IMPLEMENTATION.md`
- `{native-power-strike-init,native-power-strike-effect-preview}-20261107/REPORT.md`
- `sky-literal-comparison-20261107/staging/REPORT.md`
- `native-world-audio-20261106/{sound-batch-source,sound-batch-integration,pointregion-integration,ambient-export-integration,riff-validation}/REPORT.md`
- `native-world-audio-20261106/backend-closure/footstep-config/REPORT.md`
- `audio-world-20261106/REPORT.md`
- `terrain-extension-20261106/REPORT.md`
- `static-materials-{validation,integration}.json`
- `native-weight-repair/{summary,validation-summary}.json`
- `{unified-asset-batch,webgpu-performance}-20261107/REPORT.md`
