# Installed native client audit

**2026-11-05 source update:** the current authority is IMPORTA-PC's `C:/Lineage2-client`. `recipes/native-inputs.lock.json` pins the **143-file / 2,511,063,181-byte** staged closure used by [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md), including `LineageWarrior.int`, `npcname-e.dat` and the exact `system/Engine.dll` read only as binary evidence for Power Strike dispatch. The E: inventory below is historical and cannot establish equality without the recorded fleet hash checks. The typed adapters cover reviewed UE123/28 Musveren tracks alongside UE123/30, armorgrp (1,014 rows), weapongrp (1,313), npcgrp (6,519) and npcname (6,519 unique IDs). The mesh `field_stalker_m00` occurs in 22 NPC rows, so its name alone cannot select an actor profile. The separate [NPC profile adapter](NATIVE_NPC_PROFILES.md) now proves the exact Greater Musveren join: **ID 21622**, class `LineageMonster.field_stalker_20_bi`, authored **DrawScale 1.2 / CollisionRadius 18 / CollisionHeight 36**. This is client presentation metadata, not authoritative gameplay or full NPC coverage.

Inspected on 2026-11-04. Source: `E:/lineage2-client`. The installed native dataset is an **Interlude-era, modified third-party client**, distinct from the current Classic Unity-reference world and the separately retained H5 inputs. Its models, animations, sounds, effects and skill bindings are present in native formats; they cannot be made faithfully browser-ready by renaming or copying their package files into the client.

The audit read original files and produced local evidence under `artifacts/native-client-audit/`. It also produced the reusable `scripts/native_catalog.py` and `scripts/native_effects.py` tools and bounded native metadata readers. It did not run the game client, alter native packages, change launchers, or connect to servers. The separate [asset pipeline](ASSET_PIPELINE.md) now converts selected native assets, including an assembled fighter; its conversion evidence is recorded separately.

## Reusable catalog and native metadata

The native client is the source of truth for new assets. Current commands inspect the hash-pinned staged subset, whose inventory is distinct from the historical full installation below:

```powershell
python scripts/native_catalog.py --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-client-audit/catalog.json

# Add exact packages and/or native presentation tables to that catalog.
python scripts/native_catalog.py --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-client-audit/catalog.json --package animations/Fighter.ukx --package animations/Magic.ukx --table skillgrp --table skillsoundgrp --table mobskillanimgrp --table chargrp --table npcgrp --table npcname --table-source npcname=npcname-e.dat

# Rehash original files and declared output artifacts without running UModel.
python scripts/native_catalog.py --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-client-audit/catalog.json --verify

python -m unittest discover -s scripts/native_catalog -p 'test_*.py' -v
```

The catalog hashes every original file, records wrapper/package versions and explicit unsupported states, and writes a separate `catalog.receipt.json`. Source output paths are rejected, redirected paths are resolved before use, and original filenames are retained for Ver121. Optional package listing executes only the hash-pinned installed UModel. Its export index, offsets, sizes, class names and object names are independently compared with the Python reader before typed metadata is accepted. Other native versions retain their raw listing with an explicit adapter limitation.

The first full source inventory SHA-256 is `902524a54c1164096142b2db3d692bb0bebc57200ae9ed1ba0da17df779be4c1`, covering **all 1,515 files**, including configuration bytes by hash only. This supplements the earlier bounded audit described below, which hashed only selected samples. The inventory digest excludes run timestamps and repeats for unchanged sources.

The typed animation adapter recovered **651 notify objects / 655 timed events / 340 sequences** from `Fighter.ukx`, and **430 notify objects / 430 timed events / 258 sequences** from `Magic.ukx`, with zero unsupported records in these two packages. These include all animation sets in each package, so a character converter must select its exact set. Each sidecar preserves raw authored properties, original package-qualified references, native clip names, frame counts, rates, normalized event time, and `timeSeconds = normalizedTime * NumFrames / Rate`. Every animation export and every notify payload is consumed to its exact declared boundary; motion tracks remain the responsibility of the geometry/animation converter.

For example, `Fighter.MFighter_anim` / `Run_Hand_MFighter` has 13 frames at 15 fps. Its events occur at approximately 0.133333 s, 0.133333 s and 0.533333 s. The first references `ChrSound.MHFighter_Basic_Action.MHFighter_Breath_1`; the other two retain the original surface-dependent StepSound arrays. The original `Volume=250`, `Radius=30` and `Random` values are retained, without claiming they are Web Audio gain units or inventing a selection policy. Attack-item/shot events whose native objects contain no authored properties remain empty; defaults or sounds are not fabricated.

The public helper APIs in `scripts/native_catalog/ue2.py` are `read_package_index(path)` and `read_animation_events(path)`. The former exposes original import/export object paths and bounds; the latter exposes `animationEvents` containing `animationSet`, `clip`, `timeSeconds`, `normalizedTime`, `type`, `object`, `properties`, `sound`, `sourceFrames` and `sourceRate`. This permits conversion packages to retain notifications that GLB/PSA alone would otherwise omit. Runtime dispatch and audio playback are separate from extraction.

The original four DAT adapters select schemas through the **pinned `06_interlude.xml` descriptor**, which maps those table layouts to `ScionsOfDestiny`. The later NPC name adapter also uses `ScionsOfDestiny`; npcgrp, armorgrp and weapongrp use their descriptor-selected `Interlude` layouts. No H5 table bytes or guessed later-client layouts are reused. Native input hashes, schema hashes and decoded hashes are retained. All rows and the exact 13-byte `SafePackage` trailer must parse; unexplained trailing data is rejected. The original four counts remain **29,812 skill presentation rows, 1,398 skill sound rows, 5,463 NPC skill animation rows and 15 character rows**. Repeated count/array fields in `chargrp` retain their original count under `_counts`. The original field names, references and numeric values remain unchanged. They are client presentation data, not an implementation of server combat.

The locale-aware name API is `decode_table(client, 'npcname', source_filename='npcname-e.dat')`. An omitted filename is accepted only when one exact matching native language file exists; duplicate NPC IDs fail. Its pinned Rust RGBA reader preserves source-order bytes as hexadecimal without assigning CSS channel semantics. The profile adapter joins ID 21622 across both tables, independently resolves the exact skeletal export, and follows native qualified superclass references through `LineageWarrior.LineagePawn`, `Engine.Pawn`, `Engine.Actor` and `Core.Object`. It retains raw selected rows, primitive field offsets, UClass exports, decompiled sources and inherited defaults. Earlier analysis of the different base `LineageMonster.field_stalker` does not describe Greater Musveren's class. `PrePivot` initialization remains explicitly unverified; source meshes and animation keys are unchanged.

The original audit checkpoint passed twenty-five catalog/effect tests, covering bounded/truncated input, filename-sensitive decoding, source/output containment, changed-source/artifact detection, deterministic catalogs/sidecars, exact native clip timing and sound references, omitted defaults, complete source event coverage, exact Interlude table consumption, native skill action linkage, qualified class checks, nested emitter dependencies, recovered inheritance and native actor mesh/head-bone bindings. Later pipeline and runtime results are recorded in [VERIFICATION.md](VERIFICATION.md). Real-source tests explicitly skip when their local native inputs or pinned external resources are unavailable.

## Source-backed character appearance

Native `chargrp` row 0 binds the male fighter's upper body, lower body, gloves and boots to `Fighter.MFighter_m001_u/l/g/b` and the corresponding `MFighter_m001_t02_u/l/g/b` materials. Face choice 0 binds `Fighter.MFighter_m000_f` to `MFighter_m000_t00_f`. These DAT references omit package groups; the converter resolves them only when the leaf is unique within that package and retains the full export identity.

The lower-body material is a native `Shader`: its Diffuse and SpecularityMask reference `MFighter.LowBody.MFighter_m001_t02_l_sp`; Specular references `MFighter.LowBody.TexEnvMap14`; TwoSided is true. The other four chosen bindings resolve to native textures. The reusable `recipes/native-mfighter.json` checks the exact DAT hash and each mesh/material field before conversion or cache reuse. Its assembled result retains 114 native clips and 63 direct notification sound payloads. The separate converter documents which material operations its browser preview supports.

This installation's initial `chargrp` rows repeat unrelated female-dark-elf hair placeholders. A separate native class probe recovered `LineageWarrior.MFighter`: its `Mesh` is `Fighter.MFighter_m000_f`, `HeadBone` is `Bip01_head`, `bFaceRotation` is true, and `SubMeshes[4]`/`[5]` name `Fighter.MFighter_m000_m00_ah`/`_bh`. The class export is index 52, offset 21839, size 222, in `system/LineageWarrior.u` with SHA-256 `747b1e7c3045c748c08b03b54893dc2d29cf7103379f19804ccbeb7764224558`. These are authored actor fields, not an inferred bone or mesh name.

The reusable API `native_catalog.effects.read_class_defaults(client, reference, work_directory)` verifies the pinned UELib parser, decompiles a destination-only copy, rechecks the native package hash, rejects unsupported default syntax and returns `properties` plus `source` export/hash metadata. `mfighter-class/defaults.json` and its `.uc` preserve the evidence. It exposes complete UClass export bounds rather than claiming individual serialized property offsets. It returns authored properties only; absence of `DrawScale` does not fabricate an actor scale.

Hair texture selection and native C++ face/hair attachment formulas remain separate questions. The pinned Interlude descriptor comments out `hairgrp` as `cant write data` and `helmetgrp` as `no struct`; the available hair schema has only four unnamed byte fields per record. It does not prove a native texture join. Candidate texture identities/material properties remain in `mfighter-appearance-candidates.json` and `mfighter-material-graph.json`. A texture-0 recipe choice or explicit attachment using the recovered HeadBone must remain labeled as a supported preview decision until native runtime behavior is established.

## Native skill actions and effect definitions

The reusable extractor reads exact Interlude skill and sound rows, parses the nested `Skill.usk` action arrays, and recovers authored effect/class defaults with the hash-pinned UELib parser. It uses decoded copies outside the selected client and does not execute UnrealScript or game code:

```powershell
python scripts/native_effects.py --client E:/lineage2-client --skill 1011 --level 1 --output artifacts/native-effects/heal.json
python scripts/native_effects.py --client E:/lineage2-client --output artifacts/native-effects/heal.json --verify
```

The selected row explicitly references `Skill.wh.1011`. `CastingActions[0]` contains `Skill.wh.SkillAction_LocateEffect11`, referencing `LineageEffect.wh_heal_ca`; `ShotActions[0]` contains `Skill.wh.SkillAction_LocateEffect14`, referencing `LineageEffect.wh_heal_ta`. No numeric-ID/name guessing or different-level fallback is used. Both retain `SpecificStage=0`, `AttachOn=5`, offset `(0,0,-1)`, and `bSizeScale=true`; the shot also retains `bSpawnOnTarget` and `bOnMultiTarget`. Recovered Engine defaults provide `bRelativeToCylinder=true`. The native enum labels AttachOn 5 as `EAM_Trail`, without revealing its C++ attachment formula.

The casting class has three MeshEmitters using `LineageEffectsStaticmeshes.magiccircle.magiccirclewhite00/01`, with actor `DrawScale=0.1`. The shot class has a BeamEmitter and SpriteEmitter using `LineageEffectsTextures.Particles.fx_m_t0004/0005`, with actor `DrawScale=0.25`. The sprite retains its 4 by 4 subdivisions, selected frames 6 through 8, and random-subdivision flag. Authored ranges, colors, fade/lifetime/delay values and recovered parent defaults remain in the graph. Sound-table references `SkillSound.heal_cast/heal_shot` resolve uniquely to full native identities `skillsound.heal.heal_cast/heal_shot`; authored volume 250, radius 40 and race-voice columns remain unchanged.

The graph contains **two source actions, two effect classes, five child emitters, 52 resolved dependency references, zero unresolved references and zero unparsed fields** for this selection. Dependency rows include their owning property, exact object/class identity, package SHA-256, export index, offset and size. References repeated across authored/effective properties are retained as distinct uses. The receipt hashes selected original packages/tables, decoded copies, decompiled class sources, the graph, format schemas and parser implementation. Verification rehashes sources and declared outputs. Repeated extraction to the same destination produces the same graph hash.

Extraction is not native runtime equivalence. The graph reports seven explicit unsupported categories: native skill dispatch, attachment formulas, particle integration, blend equations, audio gain/randomization, omitted constructor values and transitive asset conversion. `Engine.Emitter`, particle integration and skill dispatch depend on native C++ implementations absent from the recovered class declarations. `PTDS_Translucent` and `PTDS_Brighten` are native enum labels, not proven blend equations. A renderer can implement a documented preview subset using these assets and authored values, but this metadata does not prove faithful effects, skills or spatial audio.

## Source identity

`E:/Lineage2-client-support/client-downloads/CLIENT-STATUS.md` records the download as `Lineage II Mobius Interlude.zip` from `https://interlude.l2mobius.net/downloads/Lineage%20II%20Mobius%20Interlude.zip`. The retained `Interlude.zip` is recorded as 3,564,298,489 bytes with SHA-256 `c44698923eac4bcbb6f15fb575915c78d11a9996559cd08a28115fe90d8ec8fc`. This audit did not rehash the entire archive.

Independent binary-string inspection of installed `system/L2.bin` and `system/engine.dll` found build paths including `d:\work\interlude\2007_05_23\warfare2110\...`. The installed `L2.exe` reports product/file version `1.0.0.0`, but is the replacement launcher, not evidence of the engine revision. Its SHA-256 is `e8eb4c27ac41269d8cf0d7136d4186105f02a62dc084cbac9ab4b54dc3cbfb1c`.

The retained archive member inventory contains **1,504 files / 7,795,130,402 bytes**. All listed paths are present in the installation. Three listed files have changed size: `system/L2.exe`, `system/Option.ini`, and `system/WindowsInfo.ini`. The installation has 11 additional files. The client includes `clmods.dll`, `nosleep.dll`, and custom interface files, so it must not be described as an untouched official distribution.

The initial bounded audit recomputed SHA-256 and archive CRC/size comparisons for 12 selected installed files. Eleven match the retained archive CRC and size, including Fighter/Magic packages, effect meshes, the two sampled maps, all three sampled skill DATs, `L2.bin` and `engine.dll`. The replacement launcher is the expected mismatch. The subsequent catalog hashes all 1,515 installed files; it does not compare every file's CRC with the archive. Path/size equality alone does not prove unchanged content.

## Installed inventory

There are **1,515 regular files / 7,796,355,051 bytes**. No symlinks/junctions or read errors were observed by the inventory pass. Connection-profile contents were not inspected.

| Directory | Files | Bytes |
| --- | ---: | ---: |
| `animations` | 20 | 784,785,386 |
| `maps` | 163 | 961,810,899 |
| `music` | 250 | 250,482,069 |
| `sounds` | 26 | 571,459,858 |
| `staticmeshes` | 212 | 1,600,051,795 |
| `systextures` | 70 | 1,930,545,018 |
| `textures` | 387 | 1,517,850,935 |
| `voice` | 46 | 29,934,344 |
| `system` | 147 | 148,524,086 |
| `l2text` | 184 | 576,234 |
| Other directories and launch scripts | 10 | 334,427 |

| Format | Count | Role and observed container |
| --- | ---: | --- |
| `.unr` | 163 | Maps; 153 `Lineage2Ver111`, 10 plain Unreal packages |
| `.usx` | 212 | Static mesh packages; 208 Ver111, four plain |
| `.utx` | 435 | Texture/material packages; all Ver121 |
| `.ukx` | 19 | Character/animation/mesh packages; 18 Ver111, one plain |
| `.usk` | 1 | `animations/Skill.usk`; Ver111 |
| `.uax` | 27 | Sound packages; 25 Ver111, two plain; one is outside `sounds/` |
| `.u` | 25 | Classes, effects and other assets; 22 Ver111, three plain |
| `.dat` | 41 | 40 Ver413 system tables plus one unrelated unrecognized file under `iwo/` |
| `.ogg` | 295 | 42 standard Ogg containers; **253 L2SD containers**, including all 250 music files |

Every one of the 882 native package headers was readable after bounded, in-memory Ver111/121 unwrapping. Version111 uses the known constant XOR; version121 uses the **original lowercase filename** to derive its XOR key. Renaming wrapped texture packages before decoding changes that key.

The corpus contains multiple historical Unreal package/licensee versions. Most packages use Unreal version 123, with licensee versions from 0 through 31; some use 118 and one uses 126. Examples: `Fighter.ukx`, `Magic.ukx`, `17_25.unr` and `lineageeffect.u` are 123/30, `FFighter.utx` is 123/28, and `skillsound.uax` is 123/25. The existing specialized native scanner's123/37-only contract cannot be applied unchanged to this dataset. The wrapper version and Unreal package version are separate fields.

## Tool probes that succeeded

The installed UModel executable at `C:/laragon/www/lineagen/.assets/skill-assets/work/native/tools/umodel/umodel.exe` successfully listed these packages with `-list -game=l2 -path=E:/lineage2-client`:

| Package | Verified contents |
| --- | --- |
| `Fighter.ukx` | 797 exports: 143 SkeletalMesh parts, three MeshAnimation sets, 413 AnimNotify_Sound, 107 AnimNotify_AttackShot, 89 AnimNotify_AttackItem, 30 AnimNotify_AttackVoice, eight AnimNotify_AttackPreShot, two swim-sound and two channeling notifies |
| `FFighter.utx` | 759 exports; Ver121 decoded successfully; includes texture/material classes such as TexEnvMap |
| `skillsound.uax` | 110 exports: 74 Sound objects and 36 package/group objects; source names include aqua-swirl casting and shot sounds |
| `lineageeffect.u` | 5,490 exports, including 2,411 SpriteEmitter, 1,232 MeshEmitter, 864 Class, 864 TextBuffer, 36 VertMeshEmitter, 29 BeamEmitter and one RibbonEmitter |

These are actual export-class observations. They do not establish successful geometry export, correct emitter simulation, or sound/animation timing. Original notifies are present and must be retained separately when an exchange format omits them.

The installed Java map analyzer also successfully read `maps/17_25.unr`. It reported 4,208 exports, including 987 StaticMeshActor, 1,484 AmbientSoundObject, 151 Brush, 256 TerrainSector, 12 MusicVolume, 13 SpriteEmitter, five MeshEmitter and nine Emitter records. Its terrain properties include `TerrainScale=(128,128,76)`, `Location=(-81920,245760,160.65128)` and `DrawScale=10`. These are source fields to preserve and validate together; no world-unit conversion formula is established by reading their values alone.

The existing `E:/linegen/tools/inspect_l2ini.py` decoder successfully decrypted three Ver413 inputs **in memory** with its standard `modern` key family:

| Input | Decoded bytes |
| --- | ---: |
| `system/skillgrp.dat` | 3,249,455 |
| `system/skillsoundgrp.dat` | 1,034,821 |
| `system/mobskillanimgrp.dat` | 498,687 |

The outputs are binary tables, not ready-made JSON or tab-separated text. The subsequent reusable parser described above now decodes them with the descriptor-selected Interlude layouts. Native identifiers and source references are preserved; runtime action dispatch, effect equivalence and dependency export remain separate checks. No skill-table records are interpreted as authoritative server gameplay rules.

FFmpeg 7.0 `ffprobe` recognizes `voice/tutorial_voice_001a-e.ogg` as mono Vorbis at 44,100 Hz, duration 21.781859 s. It fails on the original `music/b01_f.ogg` with `End of file`; that file has the L2SD header. The separate asset pipeline now handles the native L2SD wrapper, validating Ogg page checksums, sequencing, serials and Vorbis headers after restoration. This adapter enables selected browser-audio exports; the initial audit did not decode all 253 wrapped files.

## Reproducible read-only entry points

Run package tools with the working directory set to this project's ignored `artifacts/native-client-audit` directory: UModel may create its own log there. These commands read the original packages.

```powershell
& 'C:/laragon/www/lineagen/.assets/skill-assets/work/native/tools/umodel/umodel.exe' -list -game=l2 -path=E:/lineage2-client Fighter.ukx
& 'C:/laragon/www/lineagen/.assets/skill-assets/work/native/tools/umodel/umodel.exe' -list -game=l2 -path=E:/lineage2-client skillsound.uax
& 'C:/laragon/www/lineagen/.assets/skill-assets/work/native/tools/umodel/umodel.exe' -list -game=l2 -path=E:/lineage2-client lineageeffect.u

& 'E:/linegen/tools/jdk-27.0.1.0.3/bin/java.exe' -cp 'C:/laragon/www/lineagen/.assets/tools/l2-terrain-classic/e91cab80dbd9c9cedb4c4eda1ff2d927e5e71a3e/classes;C:/laragon/www/lineagen/.assets/tools/l2-terrain-classic/e91cab80dbd9c9cedb4c4eda1ff2d927e5e71a3e/jars/*' io.github.l2terrain.tools.MapAnalyzer E:/lineage2-client/maps/17_25.unr
```

The audit helper can be rerun from the browser-client workspace with `python artifacts/native-client-audit/inspect.py`; it rewrites only its evidence inventory. Other installed candidates include portable Blender 5.0.1, FFmpeg 7.0, the source-only `E:/linegen/tools/open-l2encdec-source`, and UELib/UE Explorer tools beside the retained native skill toolchain. The separate [conversion tooling audit](CONVERSION_TOOLING_AUDIT.md) records exporter/importer findings and the [current asset pipeline](ASSET_PIPELINE.md) documents repairs and supported conversion paths.

## Requirements for faithful client-ready packages

Use this Interlude corpus as its own source profile, with original file/object names, hashes, package versions and dependency closure. Do not silently combine its skill tables or native meshes with Classic/H5 world assumptions. Preserve source-relative character/world scale and source animation tracks. The native pipeline retains authored mesh transforms and original skeletal keys without height normalization; native actor-class placement/scale still requires its own evidence.

A drag-and-drop bundle needs more than a GLB: geometry/materials, original clip names and timing, bone/socket bindings, notification/event sidecars, audio, effect definitions, source skill-to-effect/sound mappings, world transforms and collision/support metadata must travel together in a validated manifest. Import should verify every dependency and report unsupported native features explicitly. Source skills describe presentation bindings here; server-authoritative combat remains a separate integration.

The immediately reusable pieces include native package indexes, known 111/121 wrappers, the 413 decoder, exact Interlude presentation/appearance table adapters, typed 123/30 animation-notify extraction, selected skill/effect dependency graphs, and the separate geometry/animation/audio/package converter. The converter handles selected original meshes, authored skeletal keys, native sound exports and L2SD audio. Remaining work includes full map conversion, complete appearance selection, source-correct native event/skill dispatch, particle simulation and unimplemented native material operations. This audit and tooling do not claim complete 1:1 behavior.

## Local evidence

- `artifacts/native-client-audit/inventory.json`: every file's size/category, all observed native headers, original archive inventory comparison, 12 sample hashes/CRCs and independent build strings.
- `fighter-umodel-list.txt`, `ffighter-textures-list.txt`, `skillsound-umodel-list.txt`, `effects-umodel-list.txt`: complete read-only package listings in the same artifact directory.
- `export-class-counts.json`: class-count summary for the three semantic package probes.
- `map-17_25-analysis.txt`: full native map property/class probe.
- `dat-decode-probe.json`: three successful in-memory table decoding observations.
- `catalog.json`, `catalog.receipt.json`, `catalog-packages/`, `catalog-tables/`: repeatable full source hash inventory, declared output receipts, independently validated native indexes, animation-event sidecars and original Interlude presentation tables.
- `reader-umodel-parity.json`: four representative packages with every export independently matched (Fighter 797, FFighter texture 759, skillsound 110, speaking1f static 61).
- `chargrp-interlude.json`, `mfighter-appearance-candidates.json`, `mfighter-material-graph.json`: character-table bindings, explicitly unselected hair candidates and source material properties.
- `mfighter-class/defaults.json`, `mfighter-class/scripts/LineageWarrior.MFighter.uc`, `character-class-probe/`: verified actor head-bone/face/hair mesh defaults and parent class declarations; native attachment formulas are not recovered.
- `artifacts/native-effects/heal.json`, `heal.receipt.json`, `heal-source/`, `validation.json`: exact skill 1011/1 actions, class/child defaults, resolved references, pinned parser receipts and verification/repeatability evidence.

No physical-device test, browser import, full-corpus extraction or original-game comparison was performed by this native-source audit/catalog task. The separate asset converter's evidence is recorded with its own outputs.
