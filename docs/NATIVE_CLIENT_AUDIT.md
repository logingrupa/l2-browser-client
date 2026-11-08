# Native client audit

This doc records the source formats, package versions, decoders and conversion tool facts of the Interlude client. File counts per folder and the list of the 40 `.dat` tables live in [PORT_SCOPE.md section 2](PORT_SCOPE.md#2-what-the-client-contains). Status and work order live in [.planning/STATE.md](../.planning/STATE.md) and [.planning/ROADMAP.md](../.planning/ROADMAP.md). The evidence index is [VERIFICATION.md](VERIFICATION.md).

## Reference client

- The reference is IMPORTA-PC `C:/Lineage2-client` (DEC-OWN-2). All L2.exe comparisons run there.
- DATABASE-PC `E:/Lineage2-client` is a conversion source only after a one-time full-tree hash lock proves it equal (FOUND-03).
- `recipes/native-inputs.lock.json` pins the **143-file / 2,511,063,181-byte** staged closure under `artifacts/native-parity/inputs/IMPORTA-PC`. It includes `LineageWarrior.int`, `npcname-e.dat` and `system/Engine.dll` (read only as binary evidence for Power Strike dispatch). The lock is input-only (DEC-OWN-5). Converted output goes to `.l2asset` packages plus the runtime catalog.
- The client is a modified third-party Mobius Interlude build, not an untouched official distribution.
- No `linegen` source or assets are copied into this repo (DEC-SRC-1). External tools are named below only as facts about pinned binaries.

The inventory, package listings and map probe under `artifacts/native-client-audit/` were read from the DATABASE-PC `E:` tree. Until the hash lock exists they describe that tree, not the reference. The catalog commands below read the IMPORTA-PC staged inputs.

## Reusable catalog and native metadata

```powershell
python scripts/native_catalog.py --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-client-audit/catalog.json

# Add exact packages and/or native presentation tables to that catalog.
python scripts/native_catalog.py --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-client-audit/catalog.json --package animations/Fighter.ukx --package animations/Magic.ukx --table skillgrp --table skillsoundgrp --table mobskillanimgrp --table chargrp --table npcgrp --table npcname --table-source npcname=npcname-e.dat

# Rehash original files and declared output artifacts without running UModel.
python scripts/native_catalog.py --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-client-audit/catalog.json --verify

python -m unittest discover -s scripts/native_catalog -p 'test_*.py' -v
```

The catalog hashes every original file, records wrapper and package versions and explicit unsupported states, and writes a separate `catalog.receipt.json`. It rejects source output paths and resolves redirected paths before use. It keeps original filenames for Ver121. Optional package listing runs only the hash-pinned UModel. The Python reader independently checks its export index, offsets, sizes, class names and object names before typed metadata is accepted. Other native versions keep their raw listing with an explicit adapter limitation.

The full source inventory SHA-256 is `902524a54c1164096142b2db3d692bb0bebc57200ae9ed1ba0da17df779be4c1`, covering **1,515 files**, configuration bytes by hash only. The digest excludes run timestamps and repeats for unchanged sources.

### Animation notifies

The typed animation adapter recovers **651 notify objects / 655 timed events / 340 sequences** from `Fighter.ukx` and **430 / 430 / 258** from `Magic.ukx`, with zero unsupported records. These cover every animation set in each package, so a character converter selects its exact set. Each sidecar keeps raw authored properties, package-qualified references, native clip names, frame counts, rates, normalized event time and `timeSeconds = normalizedTime * NumFrames / Rate`. Every animation export and notify payload is consumed to its declared boundary. Motion tracks belong to the geometry and animation converter.

Example: `Fighter.MFighter_anim` / `Run_Hand_MFighter` has 13 frames at 15 fps. Its events occur at about 0.133333 s, 0.133333 s and 0.533333 s. The first references `ChrSound.MHFighter_Basic_Action.MHFighter_Breath_1`; the other two keep the surface-dependent StepSound arrays. `Volume=250`, `Radius=30` and `Random` are kept as authored. They are not Web Audio gain units, and no selection policy is invented. Attack-item and shot events with no authored properties stay empty.

`scripts/native_catalog/ue2.py` exposes `read_package_index(path)` and `read_animation_events(path)`. The first returns import and export object paths and bounds. The second returns `animationEvents` with `animationSet`, `clip`, `timeSeconds`, `normalizedTime`, `type`, `object`, `properties`, `sound`, `sourceFrames` and `sourceRate`. Packages keep notifications that GLB or PSA alone would drop. Runtime dispatch and audio playback are separate from extraction.

### DAT tables

The repo's hash-pinned `06_interlude.xml` descriptor is the authoritative `.dat` decoder where it covers a table (DEC-OWN-4). Elbera code fills gaps behind an adapter (DATA-02). The combined table inventory is FOUND-04.

- skillgrp, skillsoundgrp, mobskillanimgrp and chargrp use the `ScionsOfDestiny` layouts the descriptor selects. npcname also uses `ScionsOfDestiny`. npcgrp, armorgrp and weapongrp use the descriptor's `Interlude` layouts.
- No H5 table bytes or guessed later-client layouts are reused.
- Native input hashes, schema hashes and decoded hashes are kept.
- All rows and the exact 13-byte `SafePackage` trailer must parse. Unexplained trailing data is rejected.
- Counts: **29,812 skill presentation rows, 1,398 skill sound rows, 5,463 NPC skill animation rows, 15 character rows**, armorgrp 1,014, weapongrp 1,313, npcgrp 6,519, npcname 6,519 unique IDs.
- Repeated count and array fields in `chargrp` keep their original count under `_counts`. Field names, references and values are unchanged.
- These are client presentation data, not server combat.
- The descriptor comments out `hairgrp` as `cant write data` and `helmetgrp` as `no struct`.

The locale-aware name API is `decode_table(client, 'npcname', source_filename='npcname-e.dat')`. An omitted filename works only when exactly one matching language file exists. Duplicate NPC IDs fail. The pinned Rust RGBA reader keeps source-order bytes as hexadecimal without assigning CSS channels.

### NPC profile join

The mesh `field_stalker_m00` occurs in 22 NPC rows, so its name alone cannot select an actor profile. The [NPC profile adapter](NATIVE_NPC_PROFILES.md) proves the Greater Musveren join: **ID 21622**, class `LineageMonster.field_stalker_20_bi`, authored **DrawScale 1.2 / CollisionRadius 18 / CollisionHeight 36**. It resolves the exact skeletal export and follows qualified superclasses through `LineageWarrior.LineagePawn`, `Engine.Pawn`, `Engine.Actor` and `Core.Object`. It keeps raw rows, primitive field offsets, UClass exports, decompiled sources and inherited defaults. The base `LineageMonster.field_stalker` is a different class. `PrePivot` initialization is unverified. This is presentation metadata, not gameplay or full NPC coverage. UE123/28 Musveren tracks are reviewed alongside UE123/30.

### Tests

Twenty-five catalog and effect tests cover bounded and truncated input, filename-sensitive decoding, source/output containment, changed-source detection, deterministic catalogs and sidecars, clip timing and sound references, omitted defaults, event coverage, exact Interlude table consumption, skill action linkage, qualified class checks, nested emitter dependencies, recovered inheritance and actor mesh/head-bone bindings. Real-source tests skip when their native inputs or pinned resources are missing.

## Source-backed character appearance

`chargrp` row 0 binds the male fighter's upper body, lower body, gloves and boots to `Fighter.MFighter_m001_u/l/g/b` with the `MFighter_m001_t02_u/l/g/b` materials. Face choice 0 binds `Fighter.MFighter_m000_f` to `MFighter_m000_t00_f`. These references omit package groups. The converter resolves a leaf only when it is unique in the package and keeps the full export identity.

The lower-body material is a native `Shader`. Diffuse and SpecularityMask reference `MFighter.LowBody.MFighter_m001_t02_l_sp`, Specular references `MFighter.LowBody.TexEnvMap14`, and TwoSided is true. The other four bindings are plain textures. `recipes/native-mfighter.json` checks the DAT hash and each mesh and material field before conversion or cache reuse. The assembled fighter keeps 114 native clips and 63 direct notification sound payloads.

The initial `chargrp` rows repeat unrelated female dark elf hair placeholders. The class probe of `LineageWarrior.MFighter` gives `Mesh` `Fighter.MFighter_m000_f`, `HeadBone` `Bip01_head`, `bFaceRotation` true, and `SubMeshes[4]`/`[5]` `Fighter.MFighter_m000_m00_ah`/`_bh`. The class export is index 52, offset 21839, size 222, in `system/LineageWarrior.u` (SHA-256 `747b1e7c3045c748c08b03b54893dc2d29cf7103379f19804ccbeb7764224558`). These are authored actor fields.

`native_catalog.effects.read_class_defaults(client, reference, work_directory)` verifies the pinned UELib parser, decompiles a destination-only copy, rechecks the package hash, rejects unsupported default syntax and returns `properties` plus `source` export and hash metadata. It exposes UClass export bounds, not per-property offsets. It returns authored properties only; a missing `DrawScale` does not produce an actor scale.

The hair schema has four unnamed byte fields per record and does not prove a texture join. Candidate textures and material properties stay in `mfighter-appearance-candidates.json` and `mfighter-material-graph.json`. A texture-0 recipe choice or a HeadBone attachment stays labelled as a preview decision until native runtime behaviour is established (ACT-01).

## Native skill actions and effect definitions

The extractor reads Interlude skill and sound rows, parses the nested `Skill.usk` action arrays and recovers authored effect and class defaults with the pinned UELib parser. It decodes copies outside the client and never runs UnrealScript or game code. `--client` points at the IMPORTA-PC tree or its staged inputs; E: only after the hash lock.

```powershell
python scripts/native_effects.py --client <client-root> --skill 1011 --level 1 --output artifacts/native-effects/heal.json
python scripts/native_effects.py --client <client-root> --output artifacts/native-effects/heal.json --verify
```

The row references `Skill.wh.1011`. `CastingActions[0]` holds `Skill.wh.SkillAction_LocateEffect11` referencing `LineageEffect.wh_heal_ca`. `ShotActions[0]` holds `Skill.wh.SkillAction_LocateEffect14` referencing `LineageEffect.wh_heal_ta`. No ID or name guessing or level fallback is used. Both keep `SpecificStage=0`, `AttachOn=5`, offset `(0,0,-1)` and `bSizeScale=true`; the shot also keeps `bSpawnOnTarget` and `bOnMultiTarget`. Engine defaults give `bRelativeToCylinder=true`. The enum labels AttachOn 5 as `EAM_Trail` without revealing its C++ formula.

The casting class has three MeshEmitters using `LineageEffectsStaticmeshes.magiccircle.magiccirclewhite00/01`, actor `DrawScale=0.1`. The shot class has a BeamEmitter and a SpriteEmitter using `LineageEffectsTextures.Particles.fx_m_t0004/0005`, actor `DrawScale=0.25`. The sprite keeps 4 by 4 subdivisions, frames 6 to 8 and the random-subdivision flag. Sound references `SkillSound.heal_cast/heal_shot` resolve to `skillsound.heal.heal_cast/heal_shot` with authored volume 250, radius 40 and race-voice columns unchanged.

The graph has **2 source actions, 2 effect classes, 5 child emitters, 52 resolved references, 0 unresolved references, 0 unparsed fields**. Each dependency row has its owning property, object and class identity, package SHA-256, export index, offset and size. The receipt hashes source packages and tables, decoded copies, decompiled sources, the graph, schemas and parser. Verification rehashes sources and outputs. Repeated extraction gives the same graph hash.

Extraction is not runtime equivalence. The graph lists seven unsupported categories: skill dispatch, attachment formulas, particle integration, blend equations, audio gain and randomization, omitted constructor values and transitive asset conversion (ACT-06). `PTDS_Translucent` and `PTDS_Brighten` are enum labels, not proven blend equations.

## Source identity

- `E:/Lineage2-client-support/client-downloads/CLIENT-STATUS.md` records the download as `Lineage II Mobius Interlude.zip` from `https://interlude.l2mobius.net/downloads/Lineage%20II%20Mobius%20Interlude.zip`. The retained `Interlude.zip` is 3,564,298,489 bytes, SHA-256 `c44698923eac4bcbb6f15fb575915c78d11a9996559cd08a28115fe90d8ec8fc`. The archive itself is not rehashed.
- `system/L2.bin` and `system/engine.dll` contain build paths such as `d:\work\interlude\2007_05_23\warfare2110\...`.
- `L2.exe` reports version `1.0.0.0` but is a replacement launcher (SHA-256 `e8eb4c27ac41269d8cf0d7136d4186105f02a62dc084cbac9ab4b54dc3cbfb1c`). Launcher version does not identify the asset revision.
- The archive member list has **1,504 files / 7,795,130,402 bytes**, all present in the E: tree. `system/L2.exe`, `system/Option.ini` and `system/WindowsInfo.ini` differ in size, and 11 extra files exist, including `clmods.dll`, `nosleep.dll` and custom interface files.
- 12 sampled files were checked against the archive CRC and size. Eleven match (Fighter and Magic packages, effect meshes, two maps, three skill DATs, `L2.bin`, `engine.dll`); the launcher is the expected mismatch. Path and size equality alone does not prove unchanged content.

## Formats and package versions

The E: tree has **1,515 regular files / 7,796,355,051 bytes**, no symlinks, junctions or read errors. Per-folder counts are in [PORT_SCOPE.md section 2](PORT_SCOPE.md#2-what-the-client-contains).

| Format | Count | Role and container |
| --- | ---: | --- |
| `.unr` | 163 | Maps; 153 `Lineage2Ver111`, 10 plain |
| `.usx` | 212 | Static meshes; 208 Ver111, 4 plain |
| `.utx` | 435 | Textures and materials; all Ver121 |
| `.ukx` | 19 | Characters, animations, meshes; 18 Ver111, 1 plain |
| `.usk` | 1 | `animations/Skill.usk`; Ver111 |
| `.uax` | 27 | Sounds; 25 Ver111, 2 plain; one outside `sounds/` |
| `.u` | 25 | Classes, effects, other assets; 22 Ver111, 3 plain |
| `.dat` | 41 | 40 Ver413 tables plus one unrelated file under `iwo/` |
| `.ogg` | 295 | 42 standard Ogg; **253 L2SD**, including all 250 music files |

All 882 package headers read after in-memory Ver111/121 unwrapping. Ver111 uses a constant XOR. Ver121 derives its XOR key from the **original lowercase filename**, so renaming a texture package before decoding breaks it.

Unreal package versions vary: mostly 123 with licensee 0 to 31, some 118, one 126. `Fighter.ukx`, `Magic.ukx`, `17_25.unr` and `lineageeffect.u` are 123/30, `FFighter.utx` is 123/28 and `skillsound.uax` is 123/25. Wrapper version and Unreal package version are separate fields.

## Package and map probes

UModel listings with `-list -game=l2`:

| Package | Contents |
| --- | --- |
| `Fighter.ukx` | 797 exports: 143 SkeletalMesh, 3 MeshAnimation, 413 AnimNotify_Sound, 107 AnimNotify_AttackShot, 89 AnimNotify_AttackItem, 30 AnimNotify_AttackVoice, 8 AnimNotify_AttackPreShot, 2 swim-sound and 2 channeling notifies |
| `FFighter.utx` | 759 exports; Ver121 decoded; includes TexEnvMap |
| `skillsound.uax` | 110 exports: 74 Sound, 36 package and group objects |
| `lineageeffect.u` | 5,490 exports: 2,411 SpriteEmitter, 1,232 MeshEmitter, 864 Class, 864 TextBuffer, 36 VertMeshEmitter, 29 BeamEmitter, 1 RibbonEmitter |

These are export-class observations. They do not prove geometry export, emitter simulation or sound and animation timing.

The map analyzer read `maps/17_25.unr`: 4,208 exports, including 987 StaticMeshActor, 1,484 AmbientSoundObject, 151 Brush, 256 TerrainSector, 12 MusicVolume, 13 SpriteEmitter, 5 MeshEmitter and 9 Emitter. Terrain fields include `TerrainScale=(128,128,76)`, `Location=(-81920,245760,160.65128)` and `DrawScale=10`. These values alone do not establish a world-unit formula.

The Ver413 decoder decrypted three tables in memory: `skillgrp.dat` 3,249,455 bytes, `skillsoundgrp.dat` 1,034,821 bytes, `mobskillanimgrp.dat` 498,687 bytes. The output is binary; the parser above decodes it with the descriptor layouts.

`ffprobe` (FFmpeg 7.0) reads `voice/tutorial_voice_001a-e.ogg` as mono Vorbis 44,100 Hz, 21.781859 s, and fails on `music/b01_f.ogg` (L2SD header) with `End of file`. The asset pipeline unwraps L2SD and validates Ogg page checksums, sequencing, serials and Vorbis headers.

## Conversion tool facts

- UModel (UE Viewer) build1590 is pinned: SHA-256 `13502e5a4d8f6b5f32252afebd6360f7302ccfaccf6b8dda65beff0be2d364a0`, source snapshot `a0bfb468d42be831b126632fd8a0ae6b3614f981`. Run listings with `-list -game=l2 -path=<client-root> <package>` from `artifacts/native-client-audit`, where it writes its log. Listing proves container readability, not mesh, animation or material fidelity.
- UModel `ExportGLTF.cpp` converts positions to `(0.01*x, 0.01*z, 0.01*y)`, swaps Y and Z for directions and converts quaternions. Do not apply a second 0.01 downstream. Record the transform and its inverse per route in `asset.json`.
- UModel glTF materials are diagnostic coloured placeholders (`ExportMaterial` in `ExportGLTF.cpp`), and the CLI glTF export omits animation keys. The asset pipeline reads keys directly and binds source-qualified textures.
- UELib 1.13.0.0 (bundled with UE Explorer 1.6.2), SHA-256 `64ebfa8b290429b9d5b5e81f5018734c03ded27bb814c69b904cc269268f7bbc`, also pinned as `UELIB_SHA256` in `scripts/native_catalog/effects.py`. Recovered scripts are data, never browser code.
- Blender 5.0.1, build `a3db93c5b259`, executable SHA-256 `310aa060203252a10269ff86310d2660fd91d8d6af6dbbe20cfe1752b3349565`.
- `io_scene_psk_psa` 6.2.1 targets Blender 4.0 and rejects 4.4+ action slots, so it is not a Blender 5.0.1 import route. PSK has no unit declaration and may lose source normals.
- lineagen `decode_tables.py` schemas mix HighFive, Epilogue and ScionsOfDestiny. An EOF-clean parse is not schema or skill-binding proof, so those schemas are not reused.
- lineagen `import_assets.py` hard-requires 1.8 m normalization, 24 fps, drift removal and grounding. It is not a native-preserving route (CONV-02).
- The legacy Unity-derived rigs use fit factors MFighter 3.98760320843914, FFighter 4.091118798583783, MMagic 4.262465417026271, FMagic 4.4287981137014585. `src/assets/legacyWorldScale.ts` undoes them with `(0.019 / 0.01) / fitFactor`. These are not validated native proportions; native `.l2asset` models keep their source transforms.

## Packaging rule

Use this Interlude corpus as its own source profile with original names, hashes, package versions and dependency closure. Do not mix its tables or meshes with Classic or H5 assumptions. Keep source-relative scale and source animation tracks without height normalization.

A converted part ships as an `.l2asset` package registered in the runtime catalog (DEC-OWN-5). It carries geometry and materials, clip names and timing, bone and socket bindings, notify sidecars, audio, effect definitions, skill-to-effect and sound mappings, world transforms and collision metadata, with units and handedness in `asset.json`. Import verifies every dependency and lists unsupported native features. Asset resolution stays outside `GameWorldAdapter`.

Remaining work is tracked in [.planning/ROADMAP.md](../.planning/ROADMAP.md): full map conversion (WORLD-01), complete appearance selection (ACT-01), native event and skill dispatch and particle simulation (ACT-06), and native material operations (POL-01).

## Open

- Actor DrawScale application has no explicit requirement; ACT-02's profile join implies it.
- Conditional notify events are only partly covered by ACT-04.
- Browser audio needs gesture unlock, listener and position routing, original pitch and gain policy, cancellation and disposal. No requirement names the pitch and gain policy.
- Facial aim and rotation (`bFaceRotation`) and the native C++ attachment formulas are not recovered.

## Local evidence

- `artifacts/native-client-audit/inventory.json`: per-file size and category, native headers, archive comparison, 12 sample hashes and CRCs, build strings.
- `artifacts/native-client-audit/fighter-umodel-list.txt`, `ffighter-textures-list.txt`, `skillsound-umodel-list.txt`, `effects-umodel-list.txt`: package listings.
- `artifacts/native-client-audit/export-class-counts.json`: class counts for the three semantic probes.
- `artifacts/native-client-audit/map-17_25-analysis.txt`: map property and class probe.
- `artifacts/native-client-audit/dat-decode-probe.json`: three in-memory table decodes.
- `artifacts/native-client-audit/catalog.json`, `catalog.receipt.json`, `catalog-packages/`, `catalog-tables/`: hash inventory, receipts, native indexes, animation-event sidecars and presentation tables.
- `artifacts/native-client-audit/reader-umodel-parity.json`: four packages with every export matched (Fighter 797, FFighter 759, skillsound 110, speaking1f static 61).
- `artifacts/native-client-audit/chargrp-interlude.json`, `mfighter-appearance-candidates.json`, `mfighter-material-graph.json`: character bindings, unselected hair candidates, material properties.
- `artifacts/native-client-audit/mfighter-class/defaults.json`, `mfighter-class/scripts/LineageWarrior.MFighter.uc`, `character-class-probe/`: actor head-bone, face and hair mesh defaults and parent classes.
- `artifacts/native-effects/heal.json`, `heal.receipt.json`, `heal-source/`, `validation.json`: skill 1011/1 actions, defaults, references, parser receipts and repeatability.

This audit ran no game client, browser import, full-corpus extraction or L2.exe comparison. Pipeline results are in [VERIFICATION.md](VERIFICATION.md).
