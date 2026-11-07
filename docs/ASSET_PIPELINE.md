# Native Interlude asset pipeline

For the system-script architecture, actual per-type coverage and expansion
order, read [ASSET_BATCHING.md](ASSET_BATCHING.md). Use independently runnable
small scripts per game system, sharing format readers and packaging helpers.
Converting one character, skill, world section or environment dataset must not
require all extraction. Existing `assets:pipeline` batching is optional; it is
not a prerequisite for the dedicated commands below or a new monolithic tool.
Not every desired system CLI or runtime consumer is complete.

Power Strike now also has separate [component staging and registration tools](../artifacts/native-parity/research/native-power-strike-components-20261107/IMPLEMENTATION.md).
`stage-native-effect.mjs` reuses verified converted GLBs/PNGs and preserves the
ordered actor/emitter records, original properties, primitive texture bindings
and frame links. It does not repeat extraction or choose sound/skill timing.
The optional `native_effect_registration.mjs` selects an already staged bundle
in the current catalog without rewriting other systems' entries. Keep staging,
registration, browser rendering and complete skill playback as distinct results;
the world offers opt-in component inspection beside Special attack preview.
The later [timed init preview](../artifacts/native-parity/research/native-power-strike-init-20261107/REPORT.md)
reuses that same staged bundle: three retained init components, a fixed pool of
19 particles and the original special-animation clock. It adds no converter,
restaging or guessed sound event. Its named modern scheduling/sampling policies
and verification remain separate from complete native skill timing, shot/impact
placement and sound selection.

```powershell
node scripts/stage-native-effect.mjs --bundle artifacts/native-parity/migration/effects/power-strike-source-dispatch --output artifacts/native-assets/effect-components --expected-manifest a79e3d550640f94b2ce682fc0f75c9f0a53e35cc4b3f18f3353d7ac40b1d06e0 --plan
```

Remove `--plan` to stage into that named destination, or use `--verify` for
existing output. Runtime registration is optional and requires the shared
catalog ownership window; its explicit `--catalog`, `--manifest` and hash
guards are documented in the linked implementation. No global asset batch is required.

The current playable milestone is human male/female, their class skills and
20_20 traversal, including the reported inability to climb stairs. Complete it
before adding more races or map tiles. One fighter assembly/animation recipe
does not cover every human class or skill. Explicit staging and gameplay
integration remain required stages. Actor/animation/skill/enemy bundles must
include source-resolvable audio dependencies plus timing/events, while playback
consumers and audible checks remain separately required within that same work.

The [native female fighter expansion](../artifacts/native-parity/research/native-ffighter-expansion-20261107/REPORT.md)
proves the shared readers on another character: seven parts, 113 clips,
323 events and 61 original linked sounds, with clean/repeat verification.
Exact duplicate animation-table rows are retained losslessly; her face/hair
preserve their own source skinning. The character recipe can run without the
cross-system orchestrator; use the pinned inputs and a fresh destination:

```powershell
pnpm assets:batch recipes/native-ffighter.json --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-assets/ffighter-direct
```

The optional orchestrated recipe and its verification command remain available:

```powershell
pnpm assets:pipeline --recipe recipes/native-pipeline-ffighter.json --output artifacts/native-assets/ffighter
pnpm assets:pipeline --recipe recipes/native-pipeline-ffighter.json --output artifacts/native-assets/ffighter --verify-only
```

Open **Demo controls → Assets** on either native world route to inspect the
resulting `.l2asset`, animations and linked sounds. The existing world is
suspended while the isolated viewer is open and resumes on close. This does not
replace a player or import/save an Editor scene. The separately staged
[female-world profile](../artifacts/native-parity/research/native-ffighter-world-20261107/REPORT.md)
now passes source/authored desktop and mobile viewport/touch hardware WebGPU
checks, including selected equipment/actions and post-gain audio output. Its
four female death cues retain original source bytes/events; six specialized
attack events stay uncovered. This scoped world pass does not complete other
human bases/classes/skills, footsteps, physical-phone/native parity or a new
interactive Editor save. The [indoor-stair support repair](../artifacts/native-parity/research/native-stair-traversal-20261107/IMPLEMENTATION.md)
now passes four hardware route/profile cases; automatic routing and indoor
camera obstruction remain open.

The dedicated [animation-audio bundle](../artifacts/native-parity/research/native-footstep-audio-20261107/BUNDLE_REPORT.md)
reuses the 20 already-exported exact footstep dependencies, retaining complete
raw Walk/Run events, source ordinals and ordered arrays for both fighters.
It does not reconvert a rig or run the full sound corpus:

```powershell
python -B scripts/bundle-native-animation-audio.py --recipe recipes/native-human-footstep-audio.json --output artifacts/native-parity/research/native-footstep-audio-20261107/bundle --verify-only
```

Use the same command without `--verify-only` for a fresh named output or exact
verified reuse, or `--plan` for a write-free plan. The separate
`scripts/stage_native_animation_audio.py` requires the produced manifest hash
and the current catalog hash before adding its immutable dependency record.
Original model archives and Editor scenes remain separate. Runtime preview
and verification limits are recorded in [NATIVE_AUDIO.md](NATIVE_AUDIO.md).
The [completed footstep preview checkpoint](../artifacts/native-parity/research/native-footstep-audio-20261107/REPORT.md)
passes four male/female source/authored hardware WebGPU cases with measured
audio, original loop timing and real movement. Surface/sample selection remains
explicit and defaults off; automatic surface mapping remains open. The later
[human locomotion checkpoint](../artifacts/native-parity/research/native-human-locomotion-20261107/REPORT.md)
uses that same verified bundle to select original Walk/Run clips during actual
travel for both fighters. Four hardware WebGPU cases verify source/authored
routes and recorded output. No asset reconversion, new recipe or catalog
migration was needed. Both gaits retain the existing demo speed; native movement
rates and specialized human skill/attack audio are still unfinished.

The separate [placement-audio adapter](../artifacts/native-parity/research/native-placement-audio-20261107/REPORT.md)
preserves original `StepSound_1/2/3` actor declarations that the geometry
projection omitted. The current 157-placement selection has eight declared
actors, 24 slots and three existing original Wood WAVs. All 149 omitted actors
remain explicit, including the indoor stair; no defaults are inferred.

```powershell
python -B scripts/bundle-native-placement-audio.py --recipe recipes/native-20-20-placement-audio.json --output artifacts/native-parity/research/native-placement-audio-20261107/bundle --verify-only
```

Use `--plan` for a write-free plan, or omit the flag for fresh output/exact
verified reuse. Actor/export/property ordinals, raw tags and slot order are
preserved. Clean/repeat/verify checks pass with unchanged source inputs. This
command is independent of map geometry conversion and has no runtime staging
or playback-policy mode. Automatic native support/slot selection remains open.

The dedicated [selected-skill audio adapter](../artifacts/native-parity/research/native-human-skill-audio-20261107/REPORT.md)
reads explicit skill/level selections from pinned complete `skillgrp` and
`skillsoundgrp` reader products and reuses verified original WAVs. It retains
global row ordinals, duplicate rows, all nine sound slots and thirty voice
fields, including empty/null/omitted values. Power Strike 3/1 packages two
unchanged stereo WAVs; neither their filenames nor raw table fields establish
sound onset or gameplay selection.

```powershell
python -B scripts/bundle-native-skill-audio.py --recipe recipes/native-power-strike-audio.json --output artifacts/native-parity/research/native-human-skill-audio-20261107/bundle-verification/build --verify-only
```

Use `--plan` for a write-free plan or omit the flag for a fresh named output
or exact verified reuse. This script runs without character/effect conversion
or corpus re-export. Group-less names retain separately labeled candidates;
none is silently qualified or selected. Output stays in artifacts/scratch;
runtime staging, skill dispatch and synchronized playback remain separate.
For new copied inputs, the existing `scripts/native_catalog.py --table skillgrp
--table skillsoundgrp` reader prepares the complete tables; pin its outputs and
source identities in the new recipe before bundling.

The subsequent [special-attack integration](../artifacts/native-parity/research/native-human-special-attack-20261107/REPORT.md)
reuses the existing actor archives directly. **Demo controls → Special attack
preview** plays each fighter's original `SpAtk01_1HS` clip and four directly
bound cues after audio unlock. No new extraction, catalog migration or actor
conversion is needed. Normal Hand attacks stay separate; each special clip
still has two uncovered specialized events. This source-animation preview does
not implement native skill/effect/table-sound dispatch. Browser output evidence
and remaining limits are recorded in the linked report.

Original environment data now has a complete bounded conversion-to-browser
path: `scripts/export-native-environment.py` preserves the five Env/timeenv
inputs and `scripts/stage-native-environment.mjs` stages exact source tables
under the conversion-manifest hash. All 20 tables / 500 physical color rows,
declared count discrepancies, duplicate section records and source offsets are
retained. The browser consumes them only for an explicitly selected reversible
comparison; no clock/type/interpolation policy or authored tint is replaced.
See [sky controls and scope](NATIVE_SKY.md) and the
[staging report](../artifacts/native-parity/research/sky-literal-comparison-20261107/staging/REPORT.md).

The staged Sound batch command inventories every exact `Engine.Sound` export in
all 18 UAX packages pinned by `recipes/native-sounds-staged.json`. It uses the
existing converter and preserves full object identities, original serialized
records, WAV chunks and provenance. Run into a fresh destination:

```powershell
pnpm assets:sounds --output artifacts/native-sounds/staged
pnpm assets:sounds --output artifacts/native-sounds/staged
pnpm assets:sounds --output artifacts/native-sounds/staged --verify-only
```

The command reports unsupported coverage separately from fatal integrity errors;
the repeat requires actual converter cache hits and verify-only writes nothing.
If only this batch wrapper changes, `--reuse-from <prior-output>` can import
verified products into a **fresh** output directory. It rechecks the complete
old output and original sources, requires unchanged converter/helper/tool pins,
and refuses mismatches or corruption before writing the new output. The old
tree remains intact. This does not bypass conversion dependency checks:

```powershell
pnpm assets:sounds --output artifacts/native-sounds/corrected --reuse-from artifacts/native-sounds/staged
```

The [source oracle](../artifacts/native-parity/research/native-world-audio-20261106/sound-batch-source/REPORT.md)
establishes 4,773 valid original PCM16 WAV payloads, with 4,602 distinct hashes.
The [completed batch verification](../artifacts/native-parity/research/native-world-audio-20261106/sound-batch-integration/REPORT.md)
exports and verifies every selected sound with zero unsupported records. A
fresh clean build matches the corrected seeded build across 38,188 files;
repeat returns 4,773 actual cache hits, and repeat/verify-only preserve hashes
and timestamps. Shared browser decoding retains all original integer samples;
its measured float normalization difference remains explicit. All 4,835
protected files remain unchanged. Focused tests: 29 passes, two Windows skips.
This selected source scope excludes nine unstaged UAX packages and standalone
music/voice files. It does not connect new world playback or resolve group-less
footstep configuration references.

The [PointRegion reader correction](../artifacts/native-parity/research/native-world-audio-20261106/pointregion-integration/REPORT.md)
decodes the original map's 7,925 saved region structs through the existing strict
tagged-property parser. It preserves compact object references, omitted/unknown
fields and exact raw spans; no fixed-size layout or runtime zone policy is
invented. All 23,775 fields match a pre-edit source oracle. Terrain/placement
products and authored/browser assets are unchanged. Raw extraction command:

```powershell
python -B scripts/native_map.py --client artifacts/native-parity/inputs/IMPORTA-PC --recipe recipes/native-map-20_20.json --output artifacts/native-map-pointregion/20_20
```

This recipe's historical PlayerStart origin selection does not change the
whole-map actor/ambient census or the currently staged browser section. Use a
fresh output for this reader version, including `assets:ambient` below; retain
old exports and their implementation hashes as historical evidence. The audio
wrapper now includes decoded Region metadata while all 106 WAV/archive products
remain byte-identical. This is offline metadata, not new world audio playback.

The [adjacent terrain pipeline](../artifacts/native-parity/research/terrain-extension-20261106/REPORT.md)
now extracts and stages qualified TerrainSector247 and appends it to the saved
Editor world with guarded, repeatable commands. It adds 272 vertices / 480
triangles without replacing existing geometry or authored materials. Build export
also removes exact duplicate definitions of the newly shared terrain material,
preserving its saved Editor records. Separate shader/material edits remain
authoritative; conflicting shared identities stop export rather than losing edits.

The [additive map-model command](NATIVE_MAP_MODEL_APPEND.md) now restores
Actor3703 and its newly supported tree, giving 157 placements/62 models.
It first repairs demonstrated converted-normal differences using exact native
floats, then stages an immutable source derivative and appends only the new
Editor graph. Existing authored geometry/materials, terrain UVs and UV2 remain
unchanged. Both routes pass geometry, preservation and desktop/mobile checks.

The [sky extraction/staging command](NATIVE_SKY.md) adds the original sky room
without rebuilding or replacing authored world assets. Source GLB and saved
Editor channels retain the same 182 vertices / 76 triangles. Original world
death-cue playback uses existing verified actor packages; no extra audio
conversion or duplicate equipment audio is required.

The [bounded BSP floor pipeline](NATIVE_BSP_FLOOR.md) now extracts the original
Brush397 slab from final `ULevel.Model` polygons and appends it to both source and
saved/exported routes without reimporting authored work. Its three guarded stages
are extraction, immutable bundle derivation and additive Editor packing.

Audio is mandatory for 1:1; see [NATIVE_AUDIO.md](NATIVE_AUDIO.md).
The [ambient export command](../artifacts/native-parity/research/native-world-audio-20261106/ambient-export-integration/REPORT.md)
now resolves all 106 exact Sound objects referenced by 2,620 declarations in
the original `20_20` map. Two omitted Sound fields stay unresolved. Run:

```powershell
pnpm assets:ambient --output artifacts/native-ambient/20_20
pnpm assets:ambient --output artifacts/native-ambient/20_20
pnpm assets:ambient --output artifacts/native-ambient/20_20 --verify-only
```

The first run inventories and exports into a fresh destination; the second
reuses verified content-addressed conversions; the third reads without writes.
`recipes/native-ambient-20_20.json` pins the source map and expected inventory.
The command checks tool/source hashes and retains all declarations, unknown
property spans, serialized Sound objects, exact WAV bytes/chunks and provenance.
Two actual clean builds reproduce 1,383 files; an unchanged run has 106 cache
hits without rewritten files. Outputs remain offline, outside the active catalog
and world runtime. This wrapper cleans its own temporary converter job folders
after retaining deterministic evidence; general converter scratch behavior below
is unchanged. Browser decode behavior and its measured float-normalization
difference are recorded separately; no native playback equivalence follows.

`scripts/audit-native-footstep-config.py` now inventories the original ALAudio
footstep text against locked source Sound identities. Its [command and receipts](../artifacts/native-parity/research/native-world-audio-20261106/backend-closure/footstep-config/REPORT.md)
record 24 present keys, unresolved group-less names and deterministic outputs;
it does not guess native lookup behavior or stage world playback.
The raw-map converter now exports `ambient-sounds.json` separately: 2,622 native
LevelObjects were previously skipped by the Actor state-frame filter. The
[correction receipt](../artifacts/native-parity/research/audio-world-20261106/REPORT.md)
records 51 focused test passes, clean repeat builds and unchanged terrain/actor
payloads. These are serialized declarations, not implemented ambient playback.
`pnpm exec node scripts/audit-native-audio-coverage.mjs` audits the bounded
source/export/runtime gaps without changing assets or claiming audible parity.

[Native texture products](NATIVE_TEXTURES.md) documents preserved authored mip
chains and palettes, source-preserving DXT1 DDS derivatives, reusable Python APIs
and the pinned Babylon loader's limits. These products are included in the raw
migration command; PNG remains the texture inspector's primary preview.

The optional combined **`pnpm assets:migrate --prove-rebuild`** command uses the staged,
hash-pinned **IMPORTA-PC `C:/Lineage2-client`** snapshot and writes under
`artifacts/native-parity/`. See [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md) for the
current raw migration milestone. The individual converter examples below retain
their historical `E:/lineage2-client` default; pass `--client artifacts/native-parity/inputs/IMPORTA-PC`
to use the pinned source. Their default output is `artifacts/native-assets`.
The tools never edit the client or the older
`C:/laragon/www/lineagen` project. Generated artwork stays local and ignored by
Git; converter code and recipes are tracked.

This is a bounded native asset pipeline, not a complete Unreal runtime. Models,
native skeletal keys, decoded textures, native sounds, and original animation
notification data are supported. Native effect execution, gameplay, all shader
operations, and arbitrary package classes are not implemented by this converter.
See [NATIVE_CLIENT_AUDIT.md](NATIVE_CLIENT_AUDIT.md) and
[CONVERSION_TOOLING_AUDIT.md](CONVERSION_TOOLING_AUDIT.md) for source evidence.

## Convert and inspect

Run from the repository root with Python 3.12 and the pinned UModel available:

```powershell
pnpm assets:batch recipes/native-starter.json
pnpm assets:batch recipes/native-mfighter.json
```

The first recipe produces a textured static wall, an animated native fighter
upper-body part, a texture, a native skill sound, and decoded background music.
The second assembles the native male fighter body, face choice 0, and hair color
choice 0, with all 114 clips and the 63 direct sound references authored in those
clips' notifications. Its five body/face mesh/material bindings are verified
against exact `chargrp.dat` fields and the source table hash. The two hair meshes
and head-bone identity are verified against native `LineageWarrior.MFighter`
class defaults. Hair texture color 0 is an explicit recipe choice, not a claimed
recovery of the unresolved `hairgrp` selection.

The seven-part recipe includes upper body, lower body, gloves, boots, face, and
two native hair pieces. This client's `chargrp` contains unrelated dark-elf hair
placeholders, so the recipe uses the actor's explicit hair mesh defaults instead.
Additional appearance choices remain labeled as recipe overrides unless their
table binding is verified.

Each result prints the full `asset.l2asset` path. Start the browser with
`pnpm dev`, then drop one package onto the world or open **Browse packages**.
The inspector loads it locally, lists source metadata and limitations, and
previews models, textures, or audio. Model previews use identity outer transforms;
camera framing changes the view, not the asset scale. Importing a package opens
the inspector; it does not silently replace a game entity or add a world actor.

Individual conversions:

```powershell
pnpm assets:convert --kind model --package Fighter --object MFighter_m000_u --animation MFighter_anim --with-event-audio
pnpm assets:convert --kind model --package speaking1f_s --object wall03
pnpm assets:convert --kind texture --package FFighter --object FFighter_m010_t59_l_ori
pnpm assets:convert --kind audio --package skillsound --object power_strike_cast
pnpm assets:convert --kind audio --media music/b01_f.ogg
pnpm assets:verify artifacts/native-assets/<sha256>/asset.l2asset
```

Use `--client`, `--output`, and `--umodel` to change locations. Output is rejected
if it lies inside the source client. An alternate UModel must have the reviewed
build's exact hash; arbitrary exporter versions are rejected.

## Recipes and material bindings

A batch file is a JSON array of requests. A single-model request may supply
`materials: ["0=Package.Group.Material"]`. Slots are zero-based and ordered.
Duplicate slots, missing objects, ambiguous names, and missing referenced assets
fail conversion. DAT references that omit groups resolve only when the leaf is
unique within the explicitly named package; resulting full identities are kept.

For a skeletal assembly, use `kind: "model"`, a `name`, an `animation` set, and
`parts`, each containing `package`, `object`, and `materials`. Each source part
retains its geometry buffer, skeleton, native mesh transform, and animation
channels. Channels with the same clip name are merged into one playable clip.
Different source durations or event sets are rejected. At most 16 parts are
accepted, subject to package size limits.

`recipes/native-mfighter.json` demonstrates `sourceBinding`: a pinned DAT hash
and paths to the exact mesh and texture fields. The converter decodes the audited
Interlude table again and verifies both values; a citation alone is insufficient.
Do not replace these values with similarly named Classic/H5/Unity assets.

Rigid face/hair geometry requires an explicit `rigidAttachment` bone. Native
rigid sections export with every vertex assigned to joint 0; treating them as
ordinary skinned parts makes the face float away during body animation. Assembly
conversion now rejects such parts without an attachment. The sample verifies
`HeadBone="Bip01_head"`, `Mesh`, and `SubMeshes[4/5]` from the pinned native actor
class, then uses a dedicated single-joint skin with that bone's original inverse
bind matrix. Original positions, joint/weight buffers, skeleton nodes, and all
original bind matrices remain intact. Native C++ facial aim/rotation and submesh
attachment formulas are not implemented; that distinction remains visible.

Material behavior is deliberately explicit:

- Native `Texture` slots retain exact texture references and decoded PNG data.
- `Shader.Diffuse` and `FinalBlend.Material` chains are followed with cycle limits.
  Authored properties, object references, and trailing native bytes are retained.
- Authored two-sided flags and explicit alpha-test/alpha-reference values inform
  the preview. Native specular/environment maps and framebuffer blending remain
  documented limitations, not silently claimed glTF equivalents.
- An unbound native slot such as `Material=None` becomes a named **magenta
  diagnostic material**, with a visible limitation. No texture is guessed by name.
- Native StaticMesh section collision/shadow flags are retained as authored
  metadata. Collision simulation, scripted texture effects and gameplay behavior
  are not implemented by material conversion.

Standalone texture archives also preserve original source data for reviewed
UE123/licensee20,28 DXT1/P8 layouts: `native-texture-source.json`, the complete
native export, each authored `native/mipNN.bin`, and exact same-package Palette
export/RGBA bytes when referenced. Dimensions, order, lazy-array offsets, format
origin and hashes remain explicit. No mip generation, decoding or alpha edit is
applied to these sidecars; `image.file` remains the existing mip-0 PNG preview.
An omitted Format requires the reviewed Engine class-default hash as an actual
source dependency. Supported-layout corruption fails; an unreviewed format or
version records `nativeTextureSource.status = unsupported` and a limitation.
Current coverage is **24 textures / 135 mips / 4,456,648 native bytes**.
`Engine.S_Emitter` and `Engine.DefaultTexture` retain PNG previews but have
unreviewed licensee30 sidecars. Browser sampling and material behavior remain
separate from source preservation.

StaticMesh slots are read from the native `Materials` ArrayProperty and tagged
`FStaticMeshMaterial` records for reviewed **UE123/licensee19, 20, 28 and 30**.
The source object index resolves the exact package/group/object identity; array
order, repeated references, authored flags, raw bytes, opaque properties, and
explicit-null versus omitted values remain in `nativeStaticMaterials` metadata.
No exporter short-name matching or same-name texture guess is used. Explicit
recipe overrides still retain the original native reference in provenance.

This fixes the demonstrated `field_deco_artifact_s.elf_ruin.world_obj14` collision:
native index `-14` selects `Field_Deco_Artifact_T.sk_ruins.stone_033`, rather than
the similarly named local StaticMesh export. The six section models now resolve
**28 exact material slots**, including the native Shader
`Oren_tree_T.Elf_Color.oren_tree1_leaf_1`; retaining its graph does not implement
every native shader operation. Evidence is in
`artifacts/native-parity/research/static-materials-{validation,integration}.json`.

## Scale, geometry, and animation

The pinned exporter maps native coordinates `(x,y,z)` to glTF metres
`(.01*x,.01*z,.01*y)`. `asset.json` records that matrix; the browser must not apply
it a second time. This is a coordinate convention, not a height measurement or
proof of the final native actor's class-level `DrawScale`.

For skeletal meshes, authored `MeshOrigin`, `MeshScale`, and `RotOrigin` are
applied to a dedicated joint-hierarchy parent using UEViewer's `SetMesh` and
`RotatorToAxis` convention. There is no 1.8m normalization, ground fitting,
horizontal root-drift removal, or animation root replacement.

Packing retains every original exporter BIN byte, including geometry and
inverse bind matrices. Accessor bounds are recomputed from those bytes because
UModel prints rounded decimal bounds. UModel build1590 also emits zero tangent
vectors: their unusable optional primitive attribute is omitted, while the
original accessor and bytes remain intact. These metadata repairs are recorded.

Demonstrated zero-count exporter primitives and their unused zero-count
accessors/views are removed with explicit index-remap evidence. Nonempty data,
all BIN bytes and the complete material array retain their identity. For
`elf_ruin02`, empty section 0 is removed while the eight surviving primitives
still reference original material/native section indices **1–8**. Unsupported
extension-owned index layouts are rejected rather than remapped speculatively.
`staticSectionBindings` verifies each surviving primitive against its original
section identity.

For skeletal parts, a bounded **UE123/licensee28 and 30** reader restores the
selected serialized float skin influences after exact float32 position/UV and
bone-name/parent-path matching. New accessors are appended; original exporter
bytes are retained. `_L2_NATIVE_WEIGHTS` and `_L2_NATIVE_JOINTS` preserve exact
float32 values and original influence slots, including duplicate joint slots.
`native-weights-source.json` retains the decoded source and mapping evidence.
**No source-weight normalization is applied.**

Standard glTF forbids duplicate positive joint indices and requires near-unit
weight sums. Its standard attributes therefore combine duplicate same-bone
weights in float32; where source sums violate glTF rules, they retain a compatible
quantized derivative. Generic glTF tools use those portable attributes. This
client's `L2NativeSkinWeights/1` Babylon loader adapter applies the exact custom
attributes before loading resolves, without normalization. Packages declare the
adapter in `model.nativeSkinAdapter`.

Source selection follows the reviewed UEViewer `ConvertMesh/RestoreLineageMesh`
path. Both serialized representations and their differences remain in provenance
as `selectedSourceRepresentation` and `sourceRepresentations`. Which representation
the native runtime selects remains unverified. The nine-object restoration probe
reports zero custom-slot weight error, unchanged original BIN prefixes and nine
GLBs with zero Khronos errors/warnings. This establishes conversion preservation,
not native/browser deformation parity. See
`artifacts/native-parity/research/native-weight-repair/{summary,validation-summary}.json`.

The command-line UModel glTF exporter silently omits animation, so animation is
decoded directly from the native `MotionChunk`/`AnalogTrack` records. The typed
track adapter supports reviewed **UE123/licensee28 and 30** and rejects other layouts.
Source quaternion/translation keys and compressed times are retained with the
documented axis/unit transform. Quaternions map `(x,y,z,w)` to `(x,z,y,w)`, with
the root additionally conjugated. The W component is unchanged, matching both
UModel's exported bind nodes and native `CQuat::ToAxis` skinning; adding a W sign
flip rotates the animated body incorrectly despite a structurally valid GLB.
An independent native-axis regression checks more than 10,000 transformed keys.
No PSA frame resampling or Blender conversion is
used. When a track has no time array, keys are spaced across native `NumFrames`,
matching `CAnimTrack::GetBonePosition` instead of UModel's incorrect glTF fallback.

Bone mapping checks names and parents. The fighter source has a duplicated left
finger name on the right hand and reordered weapon/shield siblings; these are
resolved with explicit hierarchy checks and recorded mappings, not global name
replacement or first-match lookup.

Each glTF `animations[i].extras` contains `nativeFrames`, `nativeRate`, and
`nativeDurationSeconds`. `animation-source.json` also retains per-clip source
motion hashes, bone maps, root-speed metadata, and the auxiliary cutscene root
track. No synthetic loop endpoint is inserted into the asset. Native loop
playback requires last-to-first translation LERP/quaternion SLERP over the time
from the last key to `NumFrames/Rate`; ordinary glTF players may instead hold or
loop early. The browser inspector implements the native timing separately.
Auxiliary actor travel/cutscene root tracks are not applied as game movement.

## Sounds and notification data

Audio dependency export belongs to the owning actor, animation, skill or enemy
conversion. Retain its resolvable payloads, original identities, notification
times and conditional/specialized event records together, with a dependency
manifest that can reuse verified shared audio products. Do not require the
4,773-sound batch to run for a single actor or skill. Keep unresolved sound
selection/lookup visible and do not convert it into a guessed unconditional cue.
The runtime playback consumer remains a required separate stage of that same
system; package integrity and inspector audition do not prove world behavior.

Native `Sound` exports are read by exact export identity and bounded lazy-array
offsets. This also supports duplicate leaf names that UModel CLI cannot select
unambiguously. PCM WAV and ordinary Ogg remain encoded byte-for-byte. The native
L2SD wrapper restores the Ogg signature and removes only a verified native
footer; Ogg page checksums, sequencing, serials, and Vorbis headers are checked.

The existing `--with-event-audio` path resolves every direct `animationEvents[].sound` reference to
an exact native Sound object and includes the verified payload. The original
qualified `sound` reference remains unchanged; `resolvedFile` links to its
manifest-listed payload. Conditional arrays, native event functions, attack
state, and environmental footstep selection remain authored metadata. They are
not automatically interpreted as unconditional sounds or executed scripts.
This is current direct-reference coverage, not complete specialized-event or
class-skill dependency resolution. Each system's coverage report must retain
those gaps rather than treating missing payload selections as silence.
Linked sound preview is optional and requires user interaction. It demonstrates
verified audio at the authored event times; native volume/radius/randomization,
attack-state conditions, and full spatial mixing are not reproduced.

## Skill and effect source graphs

This dedicated extraction can run independently of character, map and bulk
sound conversion. Complete the human class/skill inventory and its bundles
before expanding to other races or tiles; the sample below and existing fighter
recipes do not demonstrate all human classes or skills.

```powershell
pnpm assets:effects --skill 1011 --level 1 --output artifacts/native-effects/heal.json
pnpm assets:effects --output artifacts/native-effects/heal.json --verify
```

This extracts the selected native skill level, exact casting/shot actions,
effect classes, emitter properties, inherited authored defaults and qualified
mesh/texture/sound dependencies. The verified Heal example has two actions,
two effect classes and 52 resolved references, with no unparsed fields or
unresolved references. Its source and generated evidence are hash-verified.

The output is an extraction graph for implementing a runtime adapter, **not a
playable `.l2asset` effect**. Native particle integration, blend equations,
attachments and skill dispatch depend on missing C++ behavior. Those gaps
remain explicit in the graph; exporting the referenced meshes and sounds does
not make the original skill executable in the browser.

A separate retained-bundle comparison runs without the native client, converter
or a browser. It verifies the bundle's declared payloads and compares each
ordered emitter's source records with the actual converted GLB material fields:

```powershell
python -B scripts/inspect-native-effect-bundle.py --bundle artifacts/native-parity/migration/effects/power-strike-source-dispatch --output artifacts/native-parity/research/native-power-strike-effect-preview-20261107/EFFECT_READINESS.json
python -B scripts/inspect-native-effect-bundle.py --bundle artifacts/native-parity/migration/effects/power-strike-source-dispatch --output artifacts/native-parity/research/native-power-strike-effect-preview-20261107/EFFECT_READINESS.json --verify
```

This small effects-specific command supplements extraction; it does not rerun
character, map or sound conversion. A resource-ready report is not a playable
skill. The [Power Strike comparison](../artifacts/native-parity/research/native-power-strike-effect-preview-20261107/REPORT.md)
identifies the ordinary GLB materials versus emitter-rendering requirements,
retains texture animation links without inventing a loop, and records the
remaining attachment and dispatch work. Modern Babylon implementation can
proceed in bounded source-preview steps; complete legacy engine reconstruction
is not a prerequisite.

## Package contract and reproducibility

`.l2asset` is deterministic ZIP_STORED with fixed timestamps and safe relative
paths. It contains `asset.json` and exactly the payloads listed by that manifest.
Limits are 128 MiB per archive, 96 MiB per payload, and 256 entries including the
manifest. ZIP encryption and ZIP64 are not used. The manifest records:

- schema version 1, identity, name, and `model`, `audio`, or `texture` kind;
- native edition/package/object/source SHA-256 and package versions where present;
- model coordinate metadata or an image/audio payload reference;
- SHA-256, byte count, and MIME type for each payload;
- explicit limitations and authored animation events.

The archive is stored under its own SHA-256 directory. `provenance.json` pins the
request, actual loaded source dependencies, converter/helper implementation,
exporter, format definitions, material decisions, and export-buffer hashes.
Completed output receipts under `index/` are reused only after all source and
product hashes pass again. Tool/format pins are checked before reuse. A changed
source produces a new content address; corrupt existing immutable output fails
instead of being silently overwritten. Failed-job logs remain under `.work/`.
UModel diagnostics and intermediate evidence are kept under each result's
`evidence/`; absolute scratch paths are not included in packaged provenance.

Pinned UModel: build1590, SHA-256
`13502e5a4d8f6b5f32252afebd6360f7302ccfaccf6b8dda65beff0be2d364a0`.
The default location is the retained read-only native tool bundle under
`C:/laragon/www/lineagen/.assets/skill-assets/work/native/tools/umodel`.
Native table definitions and public format constants are separately hash-pinned
by `scripts/native_catalog/tables.py`.

On another machine, keep those pinned tool/format versions and set
`L2_UMODEL` to the executable, `L2_SCHEMA_ROOT` to the schema `structure`
directory, and `L2_CRYPTO_SOURCE` to the retained `l2encdec.cpp` file. These
environment overrides change paths only; hash validation remains mandatory.
Native effects additionally accept `--uelib` and `--powershell` paths.

## Verification and boundaries

WAV inspection/conversion now records all top-level RIFF chunks (including
LIST/INFO and padding), original offsets/lengths/hashes and exact padding bytes.
`python -B scripts/native_audio.py <source.wav>` inspects without modifying the
source. The decoder rejects malformed framing after valid PCM; output remains
byte-identical. Ancillary payload semantics and native loop behavior are not
inferred. The [75-source verification](../artifacts/native-parity/research/native-world-audio-20261106/riff-validation/REPORT.md)
records real clean-build/cache proof. A decoder edit changes the existing
implementation cache key; older immutable products and the active catalog stay
untouched until an explicit subsequent conversion/staging operation.

```powershell
pnpm test:pipeline
pnpm assets:batch recipes/native-starter.json
pnpm assets:batch recipes/native-starter.json
```

The second unchanged batch reports cache hits. Tests cover archive corruption,
path rejection, exact geometry-byte preservation, part remapping, native pivot
scale, source/output cache invalidation, and native track bounds. When the local
native fixtures are available, more than 100,000 source-key values are compared
against independently exported PSA frame samples; native sound bytes are checked
against the pinned export too. These optional native fixtures are not published.

The assembled seven-part fighter and textured wall have passed the Khronos glTF
validator with **zero errors and zero warnings**. This confirms structural glTF
validity, not correct deformation or pixel-identical native rendering by itself.
The earlier five-part prototype also passed structural validation but revealed
the rigid-face attachment defect during visual inspection. A subsequent idle
pose review caught an extra quaternion W sign flip. Both prototypes are
superseded by the explicit attachment recipe and native-axis/deformation
regression tests. No original-client side-by-side
fidelity acceptance is claimed. Whole map conversion, effect simulation, skills,
runtime appearance selection, actor collision, and native gameplay require their
own source-backed adapters; exporting an effect mesh or texture does not complete
those systems.

The earlier seven-part package was inspected on **2026-11-04** in desktop/mobile idle and
desktop run playback: `artifacts/native-integration/assembled-desktop.png`,
`assembled-mobile.png`, and `assembled-run-desktop.png`. Its CPU-skinned native
bind height is 0.459593m under the recorded unit convention; the first authored
`Wait_Hand_MFighter` pose is 0.464941m tall and upright. Browser skinning measured
0.464954m during playback. These are measurements, not target dimensions or
normalization inputs. `artifacts/native-assets/skin-bounds-audit.json` records
the independent GLB skinning calculation; `assembled-browser-report.json`
records the browser result and successful decoding of all 63 linked sounds.
Those captures precede the **2026-11-05** native float-weight restoration and do
not validate the regenerated packages or the current actor integration.
