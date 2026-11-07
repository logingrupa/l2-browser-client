# Repeatable native migration

After runtime staging, `pnpm assets:editor` creates an optional local editable
world scene. Repeat import preserves an existing scene with the same source
manifest and refuses a conflicting one. `pnpm build` packs saved edits and
recovers the demonstrated Editor UV2 channel loss with exact geometry checks.
This is separate from the raw migration products and their clean-build counts.
See [NATIVE_EDITOR_WORLD.md](NATIVE_EDITOR_WORLD.md).

The current milestone combines source-preserving programmatic migration with a bounded `20_20` terrain/static-mesh section. It retains verified source data and exported payloads for Babylon integration. A converted section is not yet an accepted playable slice: native visual comparison, full attack reference, full Editor authoring and performance goals remain open in [NATIVE_PARITY.md](NATIVE_PARITY.md). The partial actual Editor save/reopen/Play checkpoint is recorded in [EDITOR_ROUNDTRIP.md](EDITOR_ROUNDTRIP.md).

The earlier 26-texture set preserves all requested native source textures,
including Engine licensee30. It additionally packages 23 DXT1 textures into DDS
using original compressed blocks, with no recompression or generated mips.
[NATIVE_TEXTURES.md](NATIVE_TEXTURES.md) describes exact products, API and consumer
limits. The bounded section now also carries original mask-transform tags and
serialized bytes, so material authors do not need the raw map directory to
inspect that source data. Generated terrain retains a neutral material; the
browser can apply the separately labeled source-texture candidate described in
[NATIVE_WORLD.md](NATIVE_WORLD.md). Native rendering semantics remain unverified.

## Latest DXT5 migration proof — 2026-11-05

The separate `artifacts/native-parity/migration-dxt5/` candidate adds the
original DXT5 blocks for `FX_E_T.Flameset.de_fire_glow` to the existing flame
model. Its **seven authored mips / 10,944 bytes** end at **1×2**; the
**11,072-byte DDS** preserves that partial chain without inventing a 1×1 level.
The model archive contains **250 entries**, including **247 native-material
files**, within the unchanged 256/248 limits. Its graph now retains 17 DDS
textures; P8 compressed derivatives remain unsupported.

```powershell
pnpm assets:migrate --output artifacts/native-parity/migration-dxt5 --prove-rebuild
pnpm test:pipeline --migration-output artifacts/native-parity/migration-dxt5
```

The rebuild passed **381/381 byte-identical products**, **26/26 cache hits**,
zero clean hits in the initially empty `migration-clean-261bn7jd/`, and
**100 valid archives**. The full pipeline suite passed **313 tests with zero
skips** in 45.218 seconds. The prior invocation against the older default
fixture failed its converter-fingerprint check; that failure remains in
`research/flame-runtime/texture-dxt5/pipeline-all.log`, alongside the passing
`pipeline-current.log` and `migration-proof.log`. Rebuild and validation
receipts are `migration-dxt5/{reproducibility,validation}.json` under
`artifacts/native-parity/`.

All **69 preceding model GLBs and terrain GLB** remain byte-identical. The
26-texture regression also preserves all **257 source/DDS product files**;
only three P8 coverage messages intentionally change. Exact comparisons are
`research/flame-runtime/texture-dxt5/{migration-glb-preservation,authored-preservation,legacy-comparison}.json`.
The authored receipt confirms **2,245 files / 53,609,808 bytes** unchanged.

This candidate was **not runtime-staged**. The default `migration/`, current
`public/l2` manifests and saved authored scene retain their preceding snapshot.
The runtime now supports a reversible source-formula preview on both world
routes; [NATIVE_FLAMES.md](NATIVE_FLAMES.md) records rendering checks and limits.
Source preservation and runtime checks do not establish native clock
synchronization, camera equivalence, lighting or visual acceptance. See
[NATIVE_TEXTURES.md](NATIVE_TEXTURES.md) for the block/consumer contract.

## Earlier staged Power Strike dispatch proof — 2026-11-05

The main `power-strike-source-dispatch` job now exports the two classes selected
by the reviewed native skill 3 handlers: `LineageEffect.s_u002_a` at init and
`LineageEffect.p_u004_a` conditionally at shot. Both directly extend
`Engine.Emitter`; authored DrawScale values are **0.05** and **0.02**. The bundle
retains **six emitters, 12 class definitions with inherited defaults and 17 converted assets**
(four models, 11 textures, two sounds), with zero unresolved dependencies.
Ten checked Engine.dll byte anchors and exact authored-default hashes support
these associations. [NATIVE_POWER_STRIKE.md](NATIVE_POWER_STRIKE.md) records the
validation scope and remaining timing, attachment and runtime gaps.

The completed `--prove-rebuild --stage-runtime` run passed **381/381
byte-identical products**, **26/26 cache hits**, zero clean hits in
`migration-clean-1to9688v/`, and **100 archives**: 69 models, 29 textures and two
audio assets. All **70 GLBs**, including terrain, have zero Khronos
errors/warnings. The pipeline suite passed **302 tests with zero skips**.
Current receipts are `artifacts/native-parity/migration/{reproducibility,validation}.json`;
frozen copies and `pipeline-all.log` are under
`artifacts/native-parity/editor/material-authoring-20261105/`.
The subsequent `--verify-only` also passed; its log is
`artifacts/native-parity/migration-power-strike-dispatch-verify.log`.

That directory's `preservation.json` verifies all **67 previous model GLBs plus
terrain unchanged**, with two new impact models and all original source inputs
preserved. Archive and manifest hashes may change with implementation pins.
The old `effects/power-strike/` candidate remains retained; only
`effects/power-strike-source-dispatch/` belongs to the current job catalog.
The raw bundle does not implement browser particle playback, and runtime staging
does not add effect simulation.

## Earlier NPC profile proof — 2026-11-05

The source-backed `npc-profiles` adapter was added in the preceding run, which
passed **315/315 byte-identical products**, **26/26 cache hits**,
and zero clean hits in the initially empty `migration-clean-4z5m6k_n/`. Its
**95 archives** remain separate from the new metadata bundle. Evidence:
`artifacts/native-parity/migration-clean-4z5m6k_n/` and
`artifacts/native-parity/migration-npc-profiles-proof.log`.

The exact name-table ID **21622** selects Greater Musveren's
`LineageMonster.field_stalker_20_bi` actor class and
`LineageMonsters.field_stalker_m00` mesh. Authored DrawScale **1.2**, radius
**18**, height **36**, and inherited DrawScale3D **(1,1,1)** are retained in
native units. Generic PrePivot initialization remains unverified. This adapter
adds provenance and runtime profile metadata without changing the source or
converted model payloads. [NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md)
documents selection, inheritance, cache, staging and browser/Editor consumption.

The pipeline runner at that checkpoint reported **291 tests passing with zero skips** in
47.643 seconds. Evidence is
`artifacts/native-parity/research/material-policy-current/pipeline-tests.log`
and `receipt.json`. The earlier 288-test run's stale optional flame-fixture
skip is resolved: the test selects the exact current production archive through
validated IDs/hashes, and all six focused checks pass. All 238 nonmanifest
payloads match the historical archive, including the GLB; conversion and runtime
code were unchanged by this test repair. Reproducible conversion and profile
loading do not establish native visual parity. Current runtime and visual checks
remain in [VERIFICATION.md](VERIFICATION.md).

## Earlier expanded-section proof — 2026-11-05

Client-only checks following this earlier run established a partial actual
Editor save/reopen/build/browser round trip and a source-backed Musveren support
correction. The later NPC metadata job above is a separate migration addition. See
[EDITOR_ROUNDTRIP.md](EDITOR_ROUNDTRIP.md),
[NATIVE_ACTOR_PLACEMENT.md](NATIVE_ACTOR_PLACEMENT.md) and
[VERIFICATION.md](VERIFICATION.md) for current evidence and remaining gaps.

The main `map-20-20-section` job now selects
`recipes/native-map-debug-location.json`: nine sectors around the source-backed
PlayerStart10 startup candidate, with **61 models / 151 static placements**.
The completed proof passed **297/297 byte-identical products**, **25/25 cache
hits**, and zero clean hits in the initially empty `migration-clean-k77ohz4i/`.
Its **95 archives** contain **67 models, 26 textures and two audio assets**.
All **68 GLBs**, including the terrain, have zero Khronos errors/warnings.

At that raw migration checkpoint, one flame model across **12 placements** used
diagnostic runtime materials. Its original geometry and native graph retain
**23 raw graph nodes, nine class definitions, 18 PNGs and 16 source-preserving
DDS files**. Successful raw migration does not verify the flame's native
billboarding, animation, FadeColor, Combiner or blending behavior. Live native
pawn/camera matching and visual parity remain unverified.

Evidence remains in the retained `artifacts/native-parity/migration-clean-k77ohz4i/`
receipts and `artifacts/native-parity/migration-debug-location-proof.log`.
The primary `migration/` receipts now describe the Power Strike dispatch run above. This is the
completed conversion/clean-build proof; it does not claim success for the
subsequent browser regression run. [VERIFICATION.md](VERIFICATION.md) records
browser results separately.

## Earlier DDS and section-metadata proof — 2026-11-05

The DDS and section-metadata run passed **242/242 byte-identical products**,
**25/25 cache hits**, zero clean hits in `migration-clean-s9jpeig4`, and
**13 GLBs with zero Khronos errors/warnings**. Forty archives contain 12 models,
26 textures and two audio assets. All 40 primary GLB/PNG/audio payloads match the
preceding clean build. The section's `terrain.bin` also matches; its glTF differs
only in native layer extras. Those extras retain **90 property records / 1,377
serialized bytes**. Historical counts below remain scoped to earlier runs.

Evidence: `migration-native-dds-proof.log`, retained `migration-clean-s9jpeig4/`
receipts and `research/compressed-textures/migration-integration.json` under
`artifacts/native-parity/`. [VERIFICATION.md](VERIFICATION.md) records follow-up
checks. This is source preservation and reproducibility, not visual acceptance.

## One command

The fighter recipe retains native skeletal attachment arrays and the
authoritative `system/LineageWarrior.int` animation-family definitions. That
addition produced the earlier **141-file / 2,480,307,465-byte** snapshot; all
preceding 140 inputs were freshly rehashed against IMPORTA-PC. Its
encrypted bytes match the local candidate and are copied unchanged. The source
lock now records the already-observed current protected Debug INI hash, retaining
the previous profile hash as history; staging did not edit or copy the INI.
Source receipt: `research/weapon-attachment/animation-family-source-staging.json`.
Adding the authoritative 51,248-byte `system/npcname-e.dat` for NPC profiles
produced the **142-file / 2,480,358,713-byte** snapshot. The current addition of
30,704,468-byte `system/Engine.dll` brings the lock to **143 files /
2,511,063,181 bytes**. It is staged only as read-only dispatch evidence after
fresh IMPORTA-PC hash equality; it is never loaded or executed. Native-source
hashes and the exact staged dependency closure remain in
`recipes/native-inputs.lock.json`; no native configuration or package was edited.

From `C:/laragon/www/l2-browser-client`, after `pnpm install --frozen-lockfile`:

```powershell
pnpm assets:migrate --prove-rebuild --stage-runtime
```

This hashes the pinned staged inputs, inventories native formats/classes, migrates the recipe's character/equipment/monster/NPC-profile/map/effect jobs, builds the bounded terrain/static-mesh section from the raw map job, verifies source dependencies and archives, runs pinned Khronos glTF validation, stages verified local browser/Editor products, replays the unchanged cache, and rebuilds into a genuinely empty retained output directory. It exits nonzero for failed requested jobs, validation failures or differing rebuild products. Unsupported inventory formats and unimplemented runtime behaviors remain explicit in coverage; a successful migration is not visual/playable acceptance. Omit `--stage-runtime` when only generated migration products are needed.

The entry point is `scripts/native_migration.py`; its default recipe is `recipes/native-migration.json`. Generated output stays in ignored `artifacts/native-parity/migration/`. Authored Editor resources and the existing browser scene are not regeneration targets. Models remain independently inspectable `.l2asset` files with native identities and original parts/rigs, not replacement synthetic characters.

The initial raw-migration run on **2026-11-05**, using Python **3.12.6** and Node **24.15.0**, verified six jobs, **16 archives** (six models, eight textures, two sounds), **119 byte-identical product files**, **6/6 cache hits**, and six GLBs with zero Khronos errors/warnings. Its pipeline suite passed **117 tests**. These are historical run totals, not acceptance of the later weight/material repairs or section integration. Current run receipts are `artifacts/native-parity/migration/reproducibility.json` and `validation.json`; the initial suite log is `artifacts/native-parity/pipeline-tests-final.log`.

The subsequent full run on **2026-11-05**, including the weight/material repairs
and bounded map section, passed with **7 job rows**, **22 archives** (12 models,
eight textures and two sounds), and **13 GLBs** including terrain with zero
Khronos errors/warnings. Cache replay hit **7/7 jobs**, including section geometry
and all six static models. The retained empty-directory rebuild at
`artifacts/native-parity/migration-clean-s9ew4rzo/` had zero cache hits and
**141/141 byte-identical product files**, with no mismatches. Evidence remains
in that retained clean directory and
`artifacts/native-parity/research/migration-section-proof.log`; the main
`migration/` receipts now describe the latest dispatch run. These remain
conversion/reproducibility results, not visual or performance acceptance.

The next 2026-11-05 run adds the exact nine terrain diffuse textures and nine
masks through `native-terrain-textures.json` and the existing texture adapter.
It passed with **25 job rows**, **40 archives** (12 models, 26 textures, two
sounds), **159/159 byte-identical products**, **25/25 cache hits** and zero hits
in `migration-clean-lwb6k2hx/`. All 13 GLBs still report zero Khronos
errors/warnings. `--verify-only` also passed. That run's retained clean directory
and logs preserve its receipts; the previous section-only proof remains in its retained
clean directory and `research/migration-section-proof.log`. New logs:
`artifacts/native-parity/migration-terrain-textures-{proof,verify}.log`.
Decoded PNGs retain the exporter's RGBA output without selecting a scalar mask.
Pinned UModel exports **mip 0 only**; the later native reader below adds the
original mip chains from the pinned packages. Supplementary `research/terrain-materials/texture-channel-audit.json`
records channel hashes/histograms, native property tags and five exact Palette
export payloads. Native palette-to-exporter equivalence, `bUseAlpha`, mip sampling
and renderer blending remain unverified. Texture extraction does not change the
section's neutral inspection material.

The following source-preservation run appends original native mip/palette data
to **24 of the 26 standalone texture archives**. It retains **135 mip payloads /
4,456,648 bytes**, full native export bytes and source metadata. The bounded
reader supports reviewed UE123/licensee20,28 DXT1/P8 layouts; the two licensee30
Engine textures explicitly report unsupported native sidecars while retaining
their existing PNG previews. Supported-layout corruption fails conversion.
Omitted Format values also require the actual pinned Engine package hash before
accepting the recorded native default. No pixel or mip data is regenerated.

This run passed **216/216 byte-identical products**, **25/25 cache hits**, zero
clean hits in `migration-clean-74urbedn`, and the same 40 archives / 13 valid
GLBs. All **40 primary GLB/PNG/audio payloads are byte-identical** to the previous
clean build; only source sidecars/provenance were added. Evidence:
`artifacts/native-parity/migration-native-mips-proof.log`, retained
`migration-clean-74urbedn/` receipts, and
`research/terrain-materials/mip-integration.json`.

## Inputs and tools

The dependency closure additionally includes `system/LineageWarrior.int`
(193,542 bytes, SHA-256
`8d951cbccd010a849f05df827d7065ec5f9372245953e71f3e88344cf8189485`)
and `system/npcname-e.dat` (51,248 bytes, SHA-256
`84c79b73a97e489b455f44f21d8c8cba0f4df401ccb1d56887a1eacc62285b9a`).

The dispatch addition is `system/Engine.dll` (30,704,468 bytes, SHA-256
`4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`). Fresh
authoritative hash verification, local-copy provenance and protected INI
before/after checks are retained in
`artifacts/native-parity/source-audit/power-strike-engine-staging-20261105T151212Z.json`.
The staging adapter allows this exact binary path and inventories it as
`binary-evidence-preserved-not-executed`.

Authoritative source: **IMPORTA-PC, `C:/Lineage2-client`**. `recipes/native-inputs.lock.json` pins **143 files / 2,511,063,181 bytes**: 133 native packages, eight DAT tables, one localization INT and one DLL retained as evidence. This is the declared dependency closure, not the whole installed client. Staged inputs live under `artifacts/native-parity/inputs/IMPORTA-PC/` on DATABASE-PC. The initial `artifacts/native-parity/source-audit/source-manifest.json` covers the historical 140-file snapshot; the current lock and `migration/inventory.json` include the later additions.

To recreate missing staged inputs from the fleet:

```powershell
pnpm assets:migrate --fleet-stage --local-candidate E:/Lineage2-client --prove-rebuild
```

The optional local candidate saves transfer only after its bytes equal freshly hashed IMPORTA-PC inputs. Without it, files transfer over `fleet-importa-pc` SSH/SCP. A differing source or staged file fails without replacing it. Protected `system/l2.ini` is integrity-hashed only and never copied. No native executables, scripts, launchers or services are run during staging. Jump Fluid stays active.

Use Python 3.12+, Node 22.12+, pnpm 10.32.1 and the retained, pinned UModel build1590, UELib and Interlude format definitions described in [ASSET_PIPELINE.md](ASSET_PIPELINE.md). The orchestrator accepts `L2_UMODEL`; effect and NPC-profile extraction accept `L2_UELIB` and `L2_POWERSHELL`. `L2_SCHEMA_ROOT` and `L2_CRYPTO_SOURCE` relocate definitions without changing their required hashes. No tool is downloaded or upgraded by migration. Khronos validator is pinned to `2.0.0-dev.3.10` in the project lockfile and checked at runtime. Receipts record implementation, dependency, format and tool hashes; map/effect/profile receipts also record runtime versions.

## Recipes and outputs

The fighter archive includes `animation-families.json`, original encoded and
decoded localization bytes, and the pinned Engine.Pawn class script/defaults.
The bounded reader retains all 380 MFighter assignments. It identifies 62 direct
base-class getters and 243 assignments selected by them, leaving 137 other
selection paths explicit. All 326 name-typed assignments resolve against the
114 exported clips: 193 exact and 133 unique case-insensitive matches. Original
case is retained; no aliases or missing values are synthesized. Rate strings
remain source data, not applied playback formulas.

`native-weights-source.json` now also retains each part's exact `AttachAliases`,
`AttachBoneNames` and `AttachCoords`, including serialized count prefixes and
empty arrays. The glove's `e_Hand` record names `Weapon_R_Bone` and an original
FCoords offset. This does not prove that it is the sword's attachment formula.
Hand bone indices differ by body part; consumers must resolve native identities.
The sword's nonidentity root bind is preserved. Source details and the smallest
remaining validation are in `research/weapon-attachment/README.md`.

Reusable API: `scripts/native_animation_families.py` exports
`build_animation_families(...)` and `resolve_animation_references(...)`.
`recipes/native-mfighter.json` declares the localization/class pins; converter
receipts include those dependencies and reader/tool hashes. Actual derived/native
dispatch beyond the separately reviewed Power Strike handlers,
equipment-to-CurWeaponType assignment, attack rates and full native attack remain
unverified. Runtime clips/behavior are not
changed by these source-preservation additions.

| Recipe | Raw result | Remaining integration |
| --- | --- | --- |
| `native-mfighter.json` | Seven-part Human male fighter, 114 native clips and 63 notification sounds; original part palettes and explicit head attachments | Equipment changes, attack states, native attachment/pose comparisons |
| `native-equipment.json` | Armor item 22 upper part and weapon item 1 small sword; pinned table-field bindings | Runtime replacement and sword attachment transform |
| `native-musveren.json` | `LineageMonsters.field_stalker_m00`, 49 bones, nine clips including death/deathwait, 24 events and 12 sounds; original selected float influence slots retained | Native/browser death and material parity, native selection between redundant weight streams; actor dimensions come from the separate profile below |
| `native-npc-profiles.json` | Exact NPC 21622 name/presentation join, qualified actor inheritance, scale 1.2, radius 18 and height 36; complete selected row/class provenance | Native/browser actor placement and deformation parity, generic PrePivot initialization, broader NPC coverage |
| `native-map-20_20.json` | Raw map exports, actor properties/transforms, exact G16 heightmap PNG/RAW, terrain layers and topology arrays | Full-map reconstruction, native terrain material behavior, BSP and collision |
| `native-terrain-textures.json` | Nine diffuse textures and nine masks from the existing pinned source closure; editable mip-0 PNGs and native property provenance | Native palette/mip equivalence, terrain sampling and blending |
| `native-map-debug-location.json` | Base recipe selection: nine source sectors around PlayerStart10, 151 placements and 61 models; current [additive selection](NATIVE_MAP_MODEL_APPEND.md) has 157/62 plus BSP/sky, without replacing authored work | Live location/camera verification, native terrain/material behavior, flame execution and collision |
| `native-map-section.json` | Retained earlier inspection recipe: one source sector, seven placements and six static meshes | Historical inspection selection; not the main migration section or verified native debug spawn |
| `native-power-strike.json` | Pinned Engine.dll dispatch to `s_u002_a`/`p_u004_a`, exact actor defaults, six emitters, inherited defaults, raw exports and 17 converted dependencies | Live conditional timing/attachment/lifecycle, particle/blend behavior and synchronized full character attack |

Musveren's original key comparison against an independent PSA covers **10,769 keys with zero translation/quaternion component error**. This does not verify rendering. The original bounded source audit matched all **1,591** exported vertices to native positions, UVs and bone names and demonstrated **681 weight vectors changed by UModel's byte quantization**, with maximum absolute per-bone change **0.00260929448**. The exporter's misleading "Renormalized bone weights for 109 vertices" message counts duplicate-influence cleanup; that audit found 86 packed weight sums normalized. Original float sums were already within about 1.05e-7 of one. This historical defect evidence remains in `artifacts/native-parity/research/musveren-equipment/native-weight-audit.json` and its retained research script.

The production converter now includes a bounded **UE123/licensee28 and 30** skeletal reader and verified vertex/bone mapping. It retains the exact selected float32 influence slots as `_L2_NATIVE_WEIGHTS` and `_L2_NATIVE_JOINTS`, including duplicate joint slots, plus `native-weights-source.json`. All original exporter BIN bytes remain intact. The nine-object restoration probe reports zero custom-slot weight error and nine GLBs with zero Khronos errors/warnings; reports are in `artifacts/native-parity/research/native-weight-repair/{summary,validation-summary}.json`.

Standard glTF requires distinct positive joint indices and near-unit weight sums. Its portable attributes combine duplicate same-bone weights in float32 and retain a quantized derivative where native source sums violate those rules. The package declares `nativeSkinAdapter: "L2NativeSkinWeights/1"`; the Babylon adapter applies the custom source slots before loading resolves. **No source-weight normalization is applied.** This preserves the selected serialized data without pretending every generic glTF viewer uses it.

Selection follows reviewed UEViewer `ConvertMesh/RestoreLineageMesh` behavior. `selectedSourceRepresentation`, `sourceRepresentations` and `normalizationApplied: false` remain in provenance. Musveren's alternate stream differs at **684 vertices**, with maximum per-bone difference **0.000030517578125**. Both source representations are retained; the native runtime's selection and rendered deformation parity remain unverified. Coverage therefore keeps `native-redundant-weight-source-selection` open rather than reporting the original quantization loss as an unrepaired conversion defect.

The second native material slot previously picked LOD1's first slot because a multiline LOD0 section was skipped; the parser now accepts multiline entries and stops before later LODs, with a regression test. Exact qualified native identities now take precedence over omitted-group DAT references, fixing `Engine.DefaultTexture` versus `Engine.LevelInfo.DefaultTexture`. The UModel same-class leaf collision guard remains enforced. Effect properties that remain opaque raw bytes replace inherited values as opaque data; they no longer inherit misleading decoded component values.

StaticMesh slots now come from exact native object indices in the `Materials` ArrayProperty, preserving authored order, repeated references, collision/shadow flags, null/omitted distinctions and raw property bytes. This repairs `field_deco_artifact_s.elf_ruin.world_obj14`: index `-14` selects `Field_Deco_Artifact_T.sk_ruins.stone_033`, avoiding the same-suffix local StaticMesh. The earlier six-model section converted with **28 exact slots**. Native Shader/FinalBlend graphs remain explicit and do not imply equivalent Babylon material execution. Evidence: `artifacts/native-parity/research/static-materials-{validation,integration}.json`.

The exporter also emitted an empty first primitive for `elf_ruin02`. The bounded repair removes zero-count primitives/accessors/views without changing BIN bytes or material identities. The nine native material slots remain; the eight surviving primitives still reference original material/native section indices **1–8**. `staticSectionBindings` records and verifies this mapping.

The raw map route decodes all **5,303 stack-bearing actors**, including **4,183 StaticMeshActors**, and retains all **13,248 export payloads**. An independent Java reader agrees on all static-mesh identities and positions (maximum difference 0.00005 source units from its four-decimal text output). Its G16 height samples are byte-identical to the independent export. The broad PlayerStart0 source-XY selection retains **2,000 static placements / 128 unique model requests**; this inventory is distinct from the bounded section below. Full batch world conversion still awaits the accepted vertical slice.

The initial bounded section reconstructed `20_20.TerrainInfo0.TerrainSector106` with **289 vertices / 512 triangles**, nine layers with UV data, and seven placements using six unique converted models. Source PlayerStart0 is below that sampled surface. This historical selection was an inspection candidate, not a verified native debug spawn. The subsequent [native world work](NATIVE_WORLD.md) identifies PlayerStart10/Sector229 and adds explicit rectangular sector recipes. Generated geometry retains a neutral material; the browser adds an optional source-texture candidate. Native rendering and collision remain unverified. BSP, underground geometry, water and decorations are not reconstructed by the terrain job.

The current main recipe selects native XY `[8192,92160]..[14336,98176]` around
Sector229 and preserves the shorter final native sector row. PlayerStart10's
authored position `[10536,95034,-3374.786376953125]` is recorded separately from
the terrain support sample at the same XY, Z `-3455.286376953125`. The reviewed
startup selection establishes a candidate, not the live pawn/camera position.
All 151 selected actor origins remain; no flame placement is omitted.

The exact flame request opts into `materialPolicy="preserve-native-graph"`
through the section recipe's `staticModelPolicies`. The two original mesh
sections keep their buffers and source graph; named diagnostic material slots
make the unsupported runtime state explicit. `unsupportedRuntimeMaterials`
lists the model, all 12 placement IDs and pending behavior. Malformed graphs,
unknown classes and undeclared policies still fail. The separate DXT5 candidate
above closes native glow format 8 mip preservation and DDS packaging; inherited
P8 DDS remains a gap. The previously staged snapshot retains its earlier glow
coverage report. Raw source bytes and PNGs remain available in both snapshots.
See `artifacts/native-parity/research/world-debug-location/README.md` for the
earlier graph proof and `research/flame-runtime/texture-dxt5/README.md` under
`artifacts/native-parity/` for the DXT5 extension.

The `map-20-20-section` recipe job uses the `map-section` adapter after its
`map-20-20` dependency. It writes under
`artifacts/native-parity/migration/sections/map-20-20-section/`: `map-section/`
contains reconstruction evidence, `map-section-models/` contains converted
packages, and `map-section-runtime/manifest.json` lists runtime payloads with
exact file paths, byte counts and hashes. The current surface candidate uses the
source reference actor's exact XY; its authored Z is preserved separately.
`nativeSpawnVerified` and `collisionVerified` remain false.

A read-only material review is retained in
`artifacts/native-parity/research/terrain-materials/README.md` and
`source-metadata.json`. All nine diffuse layers are exact native Texture objects;
eight masks use DXT1 and one inherits P8. The retained generic UE2 alpha reader
has no DXT1 branch, while Lineage adds per-mask transforms and `bUseAlpha` absent
from that reference. Compressed-mask channel choice, sampling phase and final
blend therefore remain evidence gaps. The report distinguishes confirmed UV,
layer-order and hole/diagonal rules from those unresolved title-specific rules.

Power Strike's native skill 3 / level 1 row retains animation `S`, an empty
description and hit time `1.0800000429153442`. The independently checked binary
dispatch associates init with `LineageEffect.s_u002_a` and conditional shot with
`LineageEffect.p_u004_a`; it does not populate the empty table description or
infer a playback timeline. The older `lineageeffect.at_power_strike_cs` candidate
is historical: equal init emitter payloads do not make its actor identity or
defaults interchangeable with the actual dispatched class.

The current two-class bundle preserves six authored emitters, texture-animation
references, material graphs and inherited Engine defaults. Palette objects and
undecoded property ranges retain exact native bytes. Both actors author
`AutoReplay=true`; their complete defaults remain intact rather than being
replaced with assumed one-shot behavior. See
[NATIVE_POWER_STRIKE.md](NATIVE_POWER_STRIKE.md) for bounded source validation,
dynamic lifetime adjustments and unverified runtime behavior.

The package index identifies the older **UE118/0 `textures/l2_skies.utx`** as unsupported by the typed package adapter. Its exact source bytes remain staged. Native Shader/FinalBlend graphs, texture animation, particle integration and C++ behavior are retained or reported as gaps, not silently represented as equivalent metallic-roughness materials.

## Inspect and verify

```powershell
pnpm assets:migrate --inventory-only
pnpm assets:migrate --verify-only
pnpm test:pipeline
```

`--client` selects another already pinned snapshot, `--output` selects a separate subdirectory of this project's `artifacts/`, and `--recipe` selects another reviewed job list. Individual adapters also accept `--client`, `--recipe`, `--output` and `--verify`:

```powershell
python scripts/native_map.py --client artifacts/native-parity/inputs/IMPORTA-PC --recipe recipes/native-map-20_20.json --output artifacts/native-parity/map-20_20
python scripts/native_effect_bundle.py --client artifacts/native-parity/inputs/IMPORTA-PC --recipe recipes/native-power-strike.json --output artifacts/native-parity/effect-bundle/power-strike-source-dispatch
python scripts/native_actor_profiles.py --client artifacts/native-parity/inputs/IMPORTA-PC --recipe recipes/native-npc-profiles.json --output artifacts/native-parity/npc-profiles-inspection
```

The original read-only research probe can inspect a retained **pre-repair** Musveren asset directory. Its fixed offsets and quantized-export checks deliberately differ from the production skeletal reader; do not use a restored package to reproduce the historical byte-weight defect:

```powershell
python scripts/audit_musveren_weights.py --client artifacts/native-parity/inputs/IMPORTA-PC --asset-directory <pre-repair-musveren-directory> --output artifacts/native-parity/historical-weight-audit.json
```

The probe accepts only the audited source hash and serializer offsets. It verifies lazy-array boundaries and every exported position/UV/bone/weight mapping, rejecting another native version. It writes only its report outside the client and does not change source weights or converted assets. The retained original report is `artifacts/native-parity/migration-weight-audit.json`; current preservation evidence is packaged in each model's `nativeWeights` provenance and `native-weights-source.json`.

The combined output includes `inventory.json`, `coverage.json`, `validation.json`, `products.json`, `run.json` and, with `--prove-rebuild`, `reproducibility.json`. Character/equipment archives are under `assets/<sha256>/`; map/effect bundles are under `maps/` and `effects/`, NPC metadata bundles under `npc-profiles/`, and bounded reconstructed sections under `sections/`. Runtime staging adds the hashed NPC profile manifest and its complete declared sidecars to the same `/l2/catalog.json` snapshot as the models. Editable PNGs, native mips/palettes/material properties and supported source-preserving DDS derivatives remain available; general compressed P8/mobile derivatives remain unsupported. Validation compares unpacked payloads against the verified archive, not just against a mutable sidecar. Cache history is retained, but the current recipe's catalog alone defines active products.

`run.json` carries cache results. Validator timestamps and export diagnostics are run evidence rather than reproducible product contents. Clean comparison checks package bytes and every declared bundle product, manifest and receipt. No browser baseline, native/browser parity, Editor save/rebuild or 120 FPS claim follows from these checks. Those are later stages; no fake benchmark stage is supplied by this raw migration command.
