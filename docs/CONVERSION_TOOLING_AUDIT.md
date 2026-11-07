# Native client conversion tooling audit

Date: 2026-11-04. This audit inspects retained tools under
`C:/laragon/www/lineagen` and the native client analysis of
`E:/lineage2-client`. The source repositories and client files were read-only.
This document records available building blocks and required changes; it does
not certify a complete native-client conversion.

## Decision

Reuse the installed native exporters, package readers, validation code and
content-addressed job design. Introduce an **Interlude/native-preserving**
conversion profile with its own source identity, units and output namespace.
The current Unity-reference world and normalized human GLBs are useful
integration fixtures, but cannot serve as evidence of 1:1 Interlude recovery.

The native inventory agent successfully listed `Animations/Fighter.ukx` using
the retained UE Viewer: package version **123 / licensee 30**, 797 exports,
including `MFighter_anim`, `FFighter_anim`, modular skeletal meshes and
`AnimNotify_Sound`, `AnimNotify_AttackItem`, `AnimNotify_PreShot` and
`AnimNotify_Shot`. The existing skill package reader accepts **123 / 37** only.
It needs a deliberately tested 123/30 adapter rather than removal of its
version check. The local retained client-support documentation identifies the
E: installation as a modified Mobius Interlude client; launcher version alone
does not identify the asset revision.

## Installed tools and code worth reusing

Paths in this table are relative to `C:/laragon/www/lineagen`.

| Building block | Present capability | Required boundary or change |
| --- | --- | --- |
| `.assets/skill-assets/work/native/tools/umodel/umodel.exe` | UE Viewer build 1590; actual E: Fighter package listing succeeds. Retained H5 recovery exported textures, static meshes and PCM sounds. CLI supports grouped exports, glTF, PSK/PSA, explicit animation sets and package roots. | Pin the executable and keep stdout, exit code and object identities for each job. Listing proves container readability, not complete mesh/animation/material fidelity. |
| `.assets/skill-assets/work/native/tools/ue-explorer/Eliot.UELib.dll` | UELib 1.13.0.0 bundled with UE Explorer 1.6.2; existing PowerShell adapters recover native class defaults and script text. | Test 123/30 deserialization and inherited Engine property schemas. Treat recovered scripts as data, never browser-executable native code. |
| `.assets/skill-assets/work/native/tools/L2crypt-d60e879a704937d427a17a669396b7da5d597937` and `Decode.java` | Existing Java wrapper decoding, including historical Ver413 DAT decoding with an explicit key profile. | Header compatibility is insufficient to choose a DAT row schema or encryption-key profile. Retain originals and decode to a separate output. |
| `.assets/skill-assets/work/native/index_packages.py` | Qualified import/export tables; retains package/group/object identity and native references. | Currently assumes wrappers 111/121 and UE123/37, lacks general table graph/range validation, and derives output paths relative to its fixed workspace. Refactor before applying it to arbitrary dropped packages. |
| `.assets/skill-assets/work/native/decode_tables.py` | Bounded binary reader and XML-driven DAT parsing with consumed-byte/trailer evidence. | Existing schemas mix HighFive/Epilogue/ScionsOfDestiny to match old retained bytes. Add independently verified Interlude schemas and semantic checks. Successful EOF parsing alone is not a skill-binding proof. |
| `.assets/tools/blender/blender-5.0.1-windows-x64/blender.exe` | Verified present and runnable; `--version` reports 5.0.1, build `a3db93c5b259`. Current Unity FBX converter uses its action-slot APIs and glTF exporter. | Use Blender where geometry or assembly needs it. Direct UE Viewer glTF can preserve native normals and avoid an unnecessary FBX round trip. |
| `.assets/vendor/Blender-Unity-Anim-Utils-946abd8089bb51817491d9ee2d5251cf53fcc191` | Proven modular Unity FBX + YAML animation importer with full-path bone matching. | This reads the Unity-derived source, not native UKX. Preserve its audited `skin_bind_mode='FBX'`; its default Unity bind stripping damaged this source. |
| `.assets/extra-assets/importer/import_assets.py` and `blender_adapter.py` | Plan/check/apply, exact source/tool fingerprints, reusable outputs, explicit joints/motion roles and confined new jobs. | Currently hard-requires 1.8 m normalization, 24 fps, horizontal drift removal and upward grounding. A new native-preserving profile and adapter are necessary; editing a JSON profile alone cannot change this policy. |
| `tools/world_pipeline/ue2_assets.py` | Safe archive inventory, hash receipts, wrapper/header observations, category plans and unchanged exchange-file staging. | It explicitly performs **zero conversions** and does not resolve native import/export tables. Extend its orchestration or reuse its validation, without presenting its current catalog as an importer. |
| `tools/world_pipeline/native_terrain.py` plus `.assets/tools/l2-terrain-classic/e91cab80dbd9c9cedb4c4eda1ff2d927e5e71a3e` | Pinned Java extraction of native RAW heights, blend masks, actor records and source metadata. | Existing profile is Classic research, not an Interlude scene converter. Native height/axis/topology/material reconstruction remains to be proved for the selected client. |
| `.assets/extra-assets/recover_presentation.py`, `prepare_audio.py`, `prepare_catalog.py` | Qualified incremental texture/mesh/audio recovery, source-specific material joins, per-ID/level presentation coverage and explicit missing dependencies. | Existing inputs/routes are H5-specific and several runtime policies are adaptations. Reuse mechanisms, not unverified H5-to-Interlude joins. |

The inspected executable hashes match the retained pins:

| Tool | SHA-256 |
| --- | --- |
| UE Viewer `umodel.exe` | `13502e5a4d8f6b5f32252afebd6360f7302ccfaccf6b8dda65beff0be2d364a0` |
| `Eliot.UELib.dll` | `64ebfa8b290429b9d5b5e81f5018734c03ded27bb814c69b904cc269268f7bbc` |
| Blender executable, retained toolchain pin | `310aa060203252a10269ff86310d2660fd91d8d6af6dbbe20cfe1752b3349565` |

`tools-pins.json` beside the native scripts records source revisions and
download hashes. The UE Viewer source snapshot is
`a0bfb468d42be831b126632fd8a0ae6b3614f981`; it is an audit reference, while the
running executable is independently pinned. No new tools were installed for
this audit.

## Scale and animation fidelity

The current `.assets/conversion/convert.py` applies several deliberate demo
adaptations:

1. Restores Unity animation translations and Hermite slopes by dividing by the
   supplied importer scale `0.019`.
2. Excludes constant model-root import-axis/unit tracks already represented by
   the retained FBX bind transforms.
3. Samples source motion at 24 fps with linear playback between samples.
4. Removes net horizontal root displacement while retaining sway and vertical
   movement.
5. Fits each entire rig separately to **1.8 m idle height** and moves its feet
   to ground.
6. Adds per-frame upward root compensation when evaluated skin penetrates the
   artificial ground by more than 2 mm.

These are not a native-preserving conversion policy. The last three also
cannot all be undone by changing one visual scale in the browser. Retained
source animation files, baseline outputs and correction manifests exist, so
a separate unchanged-motion export is feasible without guessing corrections.

The manifests contain different normalization factors for the four humans:

| Variant | Existing fit factor | Unity-reference visual multiplier to undo fitting and apply the retained importer-unit ratio | Recovered Unity-reference idle height |
| --- | ---: | ---: | ---: |
| MFighter | 3.98760320843914 | 0.476476695569646 | 0.8576580520 |
| FFighter | 4.091118798583783 | 0.464420637371303 | 0.8359571473 |
| MMagic | 4.262465417026271 | 0.44575141710487914 | 0.8023525508 |
| FMagic | 4.4287981137014585 | 0.4290102983294572 | 0.7722185370 |

The arithmetic is `(0.019 / 0.01) / fitFactor`. The older terrain preview's
`.476476695569646` calibration was measured for MFighter; applying it to all
four fitted rigs gives equal idle heights and loses their relative source
stature. The other multipliers above follow the retained manifests and common
importer-unit premise; they are **not independently validated native
Interlude proportions**. They also leave earlier motion and grounding edits
in place. Do not use them as a substitute for the native baseline.

The retained UE Viewer `Exporters/ExportGLTF.cpp` explicitly converts native
positions to `(0.01*x, 0.01*z, 0.01*y)`, swaps Y/Z for directions and converts
quaternions. Its skeletal export can include translation/rotation tracks and
original per-track key times when the intended animation set is attached.
The CLI has `-anim=<set>` for this association. Do not apply a second 0.01
conversion downstream. Preserve this known exporter transform and its
inverse in the job receipt; an exporter comment calling native units
centimetres does not alone prove all game actors' composed world scale.

For a native-preserving profile, keep source geometry, bind matrices,
per-object DrawScale/DrawScale3D, root paths and notify times. Apply only one
explicit, tested source-to-runtime basis/unit transform across characters,
weapons, scenery, emitter positions and sounds. Keep any in-place locomotion
or grounding corrections in a separate optional runtime adaptation. Never
replace original animation data with that adaptation.

## Intermediates and material gaps

Prefer direct native glTF/BIN + separately exported original PNG textures for
a first skeletal/static proof. The pinned glTF exporter preserves normals
and can export animations, but **its materials are diagnostic colored
placeholders** (`ExportMaterial` near the start of `ExportGLTF.cpp`). Existing
`prepare_browser_assets.py` demonstrates replacing placeholders from exact
ordered material imports. Its unlit/BLEND/two-sided settings are explicitly
particle-preview policy and must not be applied to every character/building.

Keep ordered material slots, UV channels/transforms, texture format/alpha,
two-sided and masked/translucent/additive settings, native Shader/Combiner/
FinalBlend/TexPanner dependencies, and source properties alongside geometry.
An unsupported shader property must remain listed; successful PNG and GLB
export does not reproduce a native material by itself.

PSK/PSKX + PSA remain useful editable and skeleton/animation cross-check
formats. The retained toolkit includes `io_scene_psk_psa` **6.2.1**, targeting
Blender **4.0**. Its sample `batch_fbx_to_glb.py` was tested on 4.0.2 and
deliberately rejects Blender 4.4+ action-slot behavior. It is not a ready
Blender-5.0.1 native-import adapter. Its retained tests use synthetic assets,
not this native client. PSK also lacks an explicit unit declaration and may
lose source normals because UE Viewer does not reconstruct smoothing groups.
Do not silently route native characters through that older sample batch.

## Sounds, effects and skills

The E: inventory contains 27 UAX packages, including skill, character and
footstep sounds. Existing `prepare_audio.py` retains package-qualified
identity and export ordinal, checks exact native RIFF bytes against exported
WAV, and records rate/channels/duration. Reuse those checks. Browser playback
then needs gesture-based audio unlock, listener/position routing, original
pitch/gain policy, cancellation, and lifecycle disposal.

Of the native `.ogg` files inspected by the inventory agent, **253 start with
`L2SD`, not `OggS`**; 42 have ordinary Ogg headers. A filename-based copy would
produce unplayable browser music. No L2SD decoder was found in the inspected
retained UE Viewer/open-l2encdec sources. Add a separately verified wrapper
adapter and validate resulting Ogg pages/decoder output before registering
music. Preserve original compressed audio where possible rather than adding
lossy re-encoding by default.

The existing H5 supplemental preview reports 467 character clips, 171 VFX
GLBs, 247 PNGs and 2,607 audio audition choices. Those are valuable previous
outputs, not native Interlude completion counts. Its documentation explicitly
leaves `VertMeshEmitter`, `BeamEmitter`, `RibbonEmitter` and `TrailEmitter`
unsupported, and lists unresolved native blending, polar/damping formulas,
DrawScale propagation and exact native action dispatch. Reported supported
skill rows include deliberate motion and higher-level audio adaptations.

GLB has no standard representation for native particle scripts or animation
notifies. Recover an event/effect sidecar carrying exact sequence names,
times, native notify classes/properties, sockets/bones, attachment spaces,
cast/release/impact phases, sound object references and unsupported fields.
The E: Fighter package's notify exports mean original event data may be
available; inspect their payloads and sequence references instead of guessing
sound/attack timing from clip duration.

For skill joins, use this client's exact DAT rows and qualified effect roots,
retaining skill ID, level, action code, visual reference and sound fields
separately. Existing H5 parser EOF success, server XML and similarly named
animations do not prove native Interlude action dispatch. Presentation
conversion remains separate from server-authoritative skill mechanics.

## Recommended reusable import contract

A desktop/local conversion worker should handle dropped client folders or
packages; the browser game should consume the verified bundle. Dropping an
isolated package must still resolve its dependency closure from the selected
client root. Native executables and Blender are local worker dependencies,
not browser libraries.

Use an explicit job sequence:

1. **Inspect:** detect wrapper and actual UE version/licensee, hash inputs,
   inventory qualified exports/imports and classify each object by its native
   class. Keep editions separate even when filenames match.
2. **Plan:** select the tested adapter by source profile/object class, resolve
   exact package dependencies, record omissions and compute a fingerprint from
   source/dependency hashes, tool hashes and conversion policy.
3. **Convert:** write a new isolated job directory; reuse unchanged jobs by
   fingerprint. Native glTF/PSK/PSA/PNG/WAV and raw property dumps remain
   inspectable intermediates. Preserve the original files.
4. **Validate:** enforce geometry/winding/UV/material-slot counts, skin/bind
   matrices, per-clip time/key coverage and deformation, root trajectories,
   notify coverage, decoded media and source-to-runtime landmark transforms.
   Check native terrain edges, topology holes and placement transforms before
   registering an entire region.
5. **Package:** write `manifest.json` last with asset identity, coordinate
   transform/inverse, animations/events, materials, audio/effects, dependencies,
   source/tool/output hashes, warnings and per-component status. An incomplete
   dependency graph must not be labeled ready.
6. **Register:** client loads the versioned bundle through `GameWorldAdapter`
   and existing rendering/animation ownership, with explicit unsupported
   components. Registration should not publish files or connect native
   executable code to the page.

The first end-to-end proof should be one complete native human assembly with
idle/run/attack, source root paths and matching notifies, one exact sound, one
material-rich static mesh, and one source-backed skill effect chain. Compare
geometry, scale and moving playback against the same original client.
Then broaden the object coverage through the same manifest contract.

## Evidence inspected

- `.assets/conversion/convert.py`, `README.md`, `BIND_FIX.md`, and
  `.assets/converted/manifest.json`.
- `terrain-previews/audit_character_scale.py` and `previewCharacterScale.ts`.
- `.assets/extra-assets/importer/{import_assets.py,blender_adapter.py,toolchain.json}`
  and its four human profiles.
- `.assets/skill-assets/work/native/{README.md,tools-pins.json,index_packages.py,decode_tables.py,export_assets.py,prepare_browser_assets.py}`.
- Retained UE Viewer `ExportGLTF.cpp`, `Main.cpp`, readme and executable hash;
  retained UELib DLL hash.
- `.assets/extra-assets/{RESULTS.md,recover_presentation.py,prepare_audio.py}`.
- `tools/world_pipeline/{ue2_assets.py,native_terrain.py}` and their guides.
- Retained toolkit character/animation README, PSK/PSA add-on version and
  synthetic test limitations.

This audit ran Blender's version command and independently hashed the retained
UE Viewer/UELib binaries. Native listing/count/header observations above come
from the parallel E: client inventory. No full native mesh conversion,
original-client visual comparison, sound playback, or 1:1 fidelity acceptance
was performed by the initial tooling-audit task.

## Native converter follow-through

The subsequent destination-only implementation is documented in
[ASSET_PIPELINE.md](ASSET_PIPELINE.md). It addresses the confirmed exporter gaps:
native animation keys are read directly because UModel CLI glTF omits them;
source-qualified textures replace diagnostic exporter materials; original
exporter buffers remain byte-identical; rounded bounds and invalid zero-tangent
metadata are repaired; native mesh origin/scale/rotation are retained; direct
native sounds and authored notification times are packaged with source hashes.

The native seven-part fighter uses five body/face bindings from exact `chargrp.dat`
fields and two hair mesh bindings from native actor defaults. Hair texture
color0 is an explicit recipe choice. It preserves 114 clips plus 63 direct
notification sounds. It and the
textured static wall pass Khronos glTF validation with zero errors/warnings.
More than 100,000 native animation key values match independent UModel PSA
original-frame samples. Visual inspection then exposed a separate rigid-face
problem: native rigid sections export all weights on joint0, so the face floated
away when the body moved. The corrected recipe verifies the actor's HeadBone and
face/hair mesh defaults, and uses dedicated rigid skin palettes with unchanged
original head inverse bind matrices. Geometry and original accessor bytes remain
intact. Assembly conversion now rejects unresolved root-only rigid parts.

An idle-pose visual check also exposed an extra animation quaternion W sign flip
that structural validation and raw-key/PSA parity cannot detect. The correction
uses the exact exporter convention `(x,z,y,w)` plus root conjugation, consistent
with the existing bind nodes. An independent native `CQuat::ToAxis` basis test
now verifies more than 10,000 transformed source keys; the W-flipped prototype
is superseded.

Shader approximation, unresolved native hair-selection semantics, facial
aim/rotation and native C++ attachment formulas, native
actor DrawScale, conditional events, effect execution, and gameplay remain
explicit limitations; these checks are not original-client visual equivalence.
