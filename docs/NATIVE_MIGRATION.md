# Repeatable native migration

`pnpm assets:migrate` converts the pinned native inputs into source-preserving
`.l2asset` packages and bundles. Output follows the project contract: `.l2asset`
packages plus the runtime catalog. `recipes/native-inputs.lock.json` describes
inputs only; it never lists outputs.

A successful migration is conversion and reproducibility evidence. It is not
visual, playable or performance acceptance. Native comparison gaps are tracked in
[NATIVE_PARITY.md](NATIVE_PARITY.md). Status and work order are in
[.planning/STATE.md](../.planning/STATE.md) and
[.planning/ROADMAP.md](../.planning/ROADMAP.md). The Babylon.js Editor is an
optional viewer outside migration and build; see
[EDITOR_VIEWER.md](EDITOR_VIEWER.md).

## One command

From the project root, after `pnpm install --frozen-lockfile`:

```powershell
pnpm assets:migrate --prove-rebuild --stage-runtime
```

The command:

- hashes the pinned staged inputs and inventories native formats and classes;
- runs the recipe's character, equipment, monster, NPC-profile, map, texture and effect jobs;
- builds the bounded terrain/static-mesh section from the raw map job;
- verifies source dependencies and archives;
- runs pinned Khronos glTF validation;
- stages verified local browser products into `public/l2`;
- replays the unchanged cache;
- rebuilds into an empty retained output directory and compares every product.

It exits nonzero for a failed requested job, a validation failure or a differing
rebuild product. Unsupported formats and unimplemented runtime behaviors stay
explicit in `coverage.json`. Omit `--stage-runtime` when only migration products
are needed.

The entry point is `scripts/native_migration.py`. The default recipe is
`recipes/native-migration.json`. Output stays in ignored
`artifacts/native-parity/migration/`. Models stay independently inspectable
`.l2asset` files with native identities and original parts and rigs.

## Inputs and tools

Reference client: **IMPORTA-PC `C:/Lineage2-client`**.
`recipes/native-inputs.lock.json` pins **143 files / 2,511,063,181 bytes**: 133
native packages, eight DAT tables, one localization INT and `system/Engine.dll`
kept as evidence. This is the declared dependency closure, not the whole
installed client. Staged inputs live under
`artifacts/native-parity/inputs/IMPORTA-PC/` on DATABASE-PC.
`artifacts/native-parity/source-audit/source-manifest.json` covers the first
140-file snapshot; the lock and `migration/inventory.json` cover the current set.

Named inputs outside the packages:

| File | Bytes | SHA-256 | Use |
| --- | --- | --- | --- |
| `system/LineageWarrior.int` | 193,542 | `8d951cbccd010a849f05df827d7065ec5f9372245953e71f3e88344cf8189485` | Fighter animation-family definitions |
| `system/npcname-e.dat` | 51,248 | `84c79b73a97e489b455f44f21d8c8cba0f4df401ccb1d56887a1eacc62285b9a` | NPC profile names |
| `system/Engine.dll` | 30,704,468 | `4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08` | Power Strike dispatch evidence |

`Engine.dll` is inventoried as `binary-evidence-preserved-not-executed`. It is
never loaded or run. Its hash check, copy provenance and protected INI
before/after checks are in
`artifacts/native-parity/source-audit/power-strike-engine-staging-20261105T151212Z.json`.

Protected `system/l2.ini` is hashed only and never copied or edited. No native
executable, script, launcher or service runs during staging. Jump Fluid stays
active.

To recreate missing staged inputs from IMPORTA-PC over `fleet-importa-pc`
SSH/SCP:

```powershell
pnpm assets:migrate --fleet-stage --prove-rebuild
```

A differing source or staged file fails without replacing it. The command also
accepts `--local-candidate <path>`, which copies a local file only when its bytes
equal the freshly hashed IMPORTA-PC input. `E:/Lineage2-client` becomes a
conversion source only after the one-time full-tree hash lock (FOUND-03).

Tools: Python 3.12+, Node 22.12+, pnpm 10.32.1, and the pinned UModel build1590,
UELib and Interlude format definitions described in
[ASSET_PIPELINE.md](ASSET_PIPELINE.md). Environment overrides:

- `L2_UMODEL` for the orchestrator;
- `L2_UELIB` and `L2_POWERSHELL` for effect and NPC-profile extraction;
- `L2_SCHEMA_ROOT` and `L2_CRYPTO_SOURCE` to relocate definitions; their required hashes still apply.

Migration never downloads or upgrades a tool. The Khronos validator is pinned to
`2.0.0-dev.3.10` in the project lockfile and checked at runtime. Receipts record
implementation, dependency, format and tool hashes. Map, effect and profile
receipts also record runtime versions.

## Recipes

| Recipe | Raw result | Remaining integration |
| --- | --- | --- |
| `native-mfighter.json` | Seven-part Human male fighter, 114 native clips, 63 notification sounds, original part palettes and explicit head attachments | Equipment changes, attack states, native attachment and pose comparison |
| `native-equipment.json` | Armor item 22 upper part and weapon item 1 small sword with pinned table-field bindings | Runtime replacement and sword attachment transform |
| `native-musveren.json` | `LineageMonsters.field_stalker_m00`, 49 bones, nine clips including death/deathwait, 24 events, 12 sounds, original selected float influence slots | Death and material parity, native choice between redundant weight streams |
| `native-npc-profiles.json` | NPC 21622 name and presentation join, qualified actor inheritance, DrawScale 1.2, radius 18, height 36, full row and class provenance | Actor placement and deformation parity, generic PrePivot initialization, broader NPC coverage |
| `native-map-20_20.json` | Raw map exports, actor properties and transforms, exact G16 heightmap PNG/RAW, terrain layers and topology arrays | Full-map reconstruction, terrain material behavior, BSP and collision |
| `native-terrain-textures.json` | Nine diffuse textures and nine masks from the pinned closure, editable mip-0 PNGs, native mips and property provenance | Palette and mip equivalence, terrain sampling and blending |
| `native-map-debug-location.json` | Nine source sectors around PlayerStart10, 151 placements and 61 models in the base selection; the additive selection has 157 placements / 62 models plus BSP and sky | Live location and camera check, terrain material behavior, flame execution, collision |
| `native-map-section.json` | Inspection recipe: one source sector, seven placements, six static meshes | Inspection only; not the main section or a verified spawn |
| `native-power-strike.json` | `Engine.dll` dispatch to `s_u002_a` / `p_u004_a`, exact actor defaults, six emitters, inherited defaults, raw exports, 17 converted dependencies | Live conditional timing, attachment and lifecycle, particle and blend behavior, synchronized attack |

### Fighter and localization

The fighter archive includes `animation-families.json`, original encoded and
decoded localization bytes, and the pinned `Engine.Pawn` class script and
defaults. The reader keeps all 380 MFighter assignments. It identifies 62 direct
base-class getters and 243 assignments selected by them; 137 other selection
paths stay explicit. All 326 name-typed assignments resolve against the 114
exported clips: 193 exact and 133 unique case-insensitive matches. Original case
is kept. No aliases or missing values are synthesized. Rate strings stay source
data, not playback formulas.

Ver111 `.int` decoding requires the footer `[0,8,71,CRC32(header+encrypted text),0]`.
The decoded `LineageWarrior.int` plaintext is 193,494 bytes with SHA-256
`a2e5f8e2121d0c32c7e540d04fdac17c725da8c4aac36facccec24586d71b0b9`.
`ALAudio.int` uses a different footer, `(0,10,90,CRC,0)`. Its adapter accepts only
the exact whole-file hash, footer and CRC. Encrypted `.int` bytes are copied
unchanged. Evidence: `artifacts/native-parity/research/weapon-attachment/README.md`
and `artifacts/native-parity/research/weapon-attachment/animation-family-source-staging.json`.

`native-weights-source.json` keeps each part's exact `AttachAliases`,
`AttachBoneNames` and `AttachCoords`, including serialized count prefixes and
empty arrays. The glove's `e_Hand` record names `Weapon_R_Bone` and an original
FCoords offset; that does not prove the sword's attachment formula. Hand bone
indices differ by body part, so consumers resolve native identities. The sword's
nonidentity root bind is kept.

API: `scripts/native_animation_families.py` exports `build_animation_families(...)`
and `resolve_animation_references(...)`. `recipes/native-mfighter.json` declares
the localization and class pins.

### Skinned meshes

The converter has a bounded UE123 licensee 28 and 30 skeletal reader with verified
vertex and bone mapping. It keeps the exact selected float32 influence slots as
`_L2_NATIVE_WEIGHTS` and `_L2_NATIVE_JOINTS`, including duplicate joint slots,
plus `native-weights-source.json`. Original exporter BIN bytes stay intact.
Evidence: `artifacts/native-parity/research/native-weight-repair/{summary,validation-summary}.json`.

Standard glTF needs distinct positive joint indices and near-unit weight sums.
The portable attributes combine duplicate same-bone weights in float32 and keep a
quantized derivative where native sums break those rules. The package declares
`nativeSkinAdapter: "L2NativeSkinWeights/1"`; the Babylon adapter applies the
custom slots before loading resolves. **No source-weight normalization is
applied.**

Selection follows UEViewer `ConvertMesh/RestoreLineageMesh`.
`selectedSourceRepresentation`, `sourceRepresentations` and
`normalizationApplied: false` stay in provenance. Musveren's alternate stream
differs at **684 vertices**, maximum per-bone difference
**0.000030517578125**. Both streams are kept; coverage keeps
`native-redundant-weight-source-selection` open.

UModel's own export quantizes weights. The source audit matched all **1,591**
Musveren vertices to native positions, UVs and bone names and found **681** weight
vectors changed by byte quantization, maximum per-bone change **0.00260929448**.
Musveren's key comparison against an independent PSA covers **10,769 keys** with
zero translation or quaternion error. Evidence:
`artifacts/native-parity/research/musveren-equipment/native-weight-audit.json`.

### Static meshes and materials

StaticMesh slots come from exact native object indices in the `Materials`
ArrayProperty. Authored order, repeated references, collision and shadow flags,
null and omitted entries and raw property bytes are kept. In
`field_deco_artifact_s.elf_ruin.world_obj14`, index `-14` selects
`Field_Deco_Artifact_T.sk_ruins.stone_033`, not the same-suffix local StaticMesh.
Evidence: `artifacts/native-parity/research/static-materials-{validation,integration}.json`.

Material slot rules:

- Multiline LOD0 entries are parsed; parsing stops before later LODs.
- Exact qualified native identities win over omitted-group DAT references (`Engine.DefaultTexture`, not `Engine.LevelInfo.DefaultTexture`).
- The UModel same-class leaf collision guard stays enforced.
- Effect properties kept as opaque raw bytes replace inherited values as opaque data.

The exporter emits an empty first primitive for `elf_ruin02`. The bounded repair
removes zero-count primitives, accessors and views without changing BIN bytes or
material identities. The nine native slots remain; the eight primitives reference
native section indices **1-8**, recorded in `staticSectionBindings`.

Native Shader and FinalBlend graphs, texture animation, particle integration and
C++ behavior are kept as data or reported as gaps. They are never shown as
equivalent metallic-roughness materials.

### Map and section

The raw map route decodes all **5,303 stack-bearing actors**, including **4,183
StaticMeshActors**, and keeps all **13,248 export payloads**. An independent Java
reader agrees on all static-mesh identities and positions (maximum difference
0.00005 source units). Its G16 height samples are byte-identical. The broad
PlayerStart0 source-XY inventory keeps **2,000 static placements / 128 unique
models**. Tile-general conversion of all 153 tiles is stage A world work; see
[.planning/ROADMAP.md](../.planning/ROADMAP.md).

The main section recipe selects native XY `[8192,92160]..[14336,98176]` around
Sector229 and keeps the shorter final native sector row. PlayerStart10's authored
position `[10536,95034,-3374.786376953125]` is recorded apart from the terrain
support sample at the same XY, Z `-3455.286376953125`. This is a startup
candidate, not the live pawn or camera position. All 151 actor origins remain.

The `map-20-20-section` job runs the `map-section` adapter after `map-20-20`.
It writes under `artifacts/native-parity/migration/sections/map-20-20-section/`:

- `map-section/` holds reconstruction evidence;
- `map-section-models/` holds converted packages;
- `map-section-runtime/manifest.json` lists runtime payloads with paths, byte counts and hashes.

`nativeSpawnVerified` and `collisionVerified` stay false. Generated terrain keeps a
neutral material; the browser can apply the labeled source-texture candidate in
[NATIVE_WORLD.md](NATIVE_WORLD.md). The section also carries original
mask-transform tags and serialized bytes.

The flame request uses `materialPolicy="preserve-native-graph"` through the
section recipe's `staticModelPolicies`. Both mesh sections keep buffers and the
source graph; named diagnostic slots mark the unsupported runtime state.
`unsupportedRuntimeMaterials` lists the model, all 12 placement IDs and pending
behavior. Malformed graphs, unknown classes and undeclared policies fail. Flame
rendering is in [NATIVE_FLAMES.md](NATIVE_FLAMES.md). Evidence:
`artifacts/native-parity/research/world-debug-location/README.md`.

Terrain material review: `artifacts/native-parity/research/terrain-materials/README.md`
and `source-metadata.json`. All nine diffuse layers are exact native Texture
objects. Eight masks use DXT1 and one inherits P8. The generic UE2 alpha reader
has no DXT1 branch, and Lineage adds per-mask transforms and `bUseAlpha`.
Channel choice, sampling phase and final blend stay open.

### Textures

Standalone texture archives keep editable PNGs, native exports, palettes, every
authored mip and, for DXT1 and DXT5, DDS wrappers around the original blocks. No
recompression and no generated mips. [NATIVE_TEXTURES.md](NATIVE_TEXTURES.md)
holds the product contract and consumer limits.

The DXT5 candidate for `FX_E_T.Flameset.de_fire_glow` lives in
`artifacts/native-parity/migration-dxt5/` and is not runtime-staged:

```powershell
pnpm assets:migrate --output artifacts/native-parity/migration-dxt5 --prove-rebuild
pnpm test:pipeline --migration-output artifacts/native-parity/migration-dxt5
```

Its pipeline suite passes **313 tests**. Receipts:
`artifacts/native-parity/migration-dxt5/{reproducibility,validation}.json` and
`artifacts/native-parity/research/flame-runtime/texture-dxt5/`.

### Power Strike and NPC profiles

Power Strike's skill 3 / level 1 row keeps animation `S`, an empty description
and hit time `1.0800000429153442`. The binary dispatch associates init with
`LineageEffect.s_u002_a` (DrawScale **0.05**) and conditional shot with
`LineageEffect.p_u004_a` (DrawScale **0.02**). Both extend `Engine.Emitter`
directly. The bundle keeps six emitters, 12 class definitions with inherited
defaults and 17 converted assets (four models, 11 textures, two sounds). Ten
`Engine.dll` byte anchors and authored-default hashes back the association. Both
actors author `AutoReplay=true`. `lineageeffect.at_power_strike_cs` is not the
dispatched class. Only `effects/power-strike-source-dispatch/` is in the job
catalog. The bundle does not play particles. See
[NATIVE_POWER_STRIKE.md](NATIVE_POWER_STRIKE.md).

Name-table ID **21622** selects Greater Musveren's
`LineageMonster.field_stalker_20_bi` actor class and the
`LineageMonsters.field_stalker_m00` mesh. DrawScale **1.2**, radius **18**,
height **36** and inherited DrawScale3D **(1,1,1)** stay in native units. Runtime
staging adds the hashed NPC profile manifest and its sidecars to the same
`/l2/catalog.json` snapshot as the models. See
[NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md).

## Inspect and verify

```powershell
pnpm assets:migrate --inventory-only
pnpm assets:migrate --verify-only
pnpm test:pipeline
```

`--client` selects another pinned snapshot, `--output` a separate subdirectory of
`artifacts/`, and `--recipe` another reviewed job list. Single adapters accept
`--client`, `--recipe`, `--output` and `--verify`:

```powershell
python scripts/native_map.py --client artifacts/native-parity/inputs/IMPORTA-PC --recipe recipes/native-map-20_20.json --output artifacts/native-parity/map-20_20
python scripts/native_effect_bundle.py --client artifacts/native-parity/inputs/IMPORTA-PC --recipe recipes/native-power-strike.json --output artifacts/native-parity/effect-bundle/power-strike-source-dispatch
python scripts/native_actor_profiles.py --client artifacts/native-parity/inputs/IMPORTA-PC --recipe recipes/native-npc-profiles.json --output artifacts/native-parity/npc-profiles-inspection
```

`scripts/audit_musveren_weights.py` is a read-only probe for a **pre-repair**
Musveren asset directory. It accepts only the audited source hash and serializer
offsets and writes only its report. Do not run it on a restored package:

```powershell
python scripts/audit_musveren_weights.py --client artifacts/native-parity/inputs/IMPORTA-PC --asset-directory <pre-repair-musveren-directory> --output artifacts/native-parity/historical-weight-audit.json
```

### Output layout

The output holds `inventory.json`, `coverage.json`, `validation.json`,
`products.json`, `run.json` and, with `--prove-rebuild`, `reproducibility.json`.

- Character and equipment archives: `assets/<sha256>/`.
- Map and effect bundles: `maps/` and `effects/`.
- NPC metadata bundles: `npc-profiles/`.
- Bounded sections: `sections/`.

Validation compares unpacked payloads against the verified archive, not a mutable
sidecar. The current recipe's catalog alone defines active products. `run.json`
carries cache results. Validator timestamps and export diagnostics are run
evidence, not product contents. The clean comparison checks package bytes and
every declared bundle product, manifest and receipt.

## Latest result

The main `--prove-rebuild --stage-runtime` run passes:

- **381/381** byte-identical products;
- **26/26** cache hits and zero hits in the empty `migration-clean-1to9688v/`;
- **100 archives**: 69 models, 29 textures, two audio;
- **70 GLBs**, terrain included, with zero Khronos errors or warnings;
- **302** pipeline tests with zero skips.

`--verify-only` also passes. Receipts:
`artifacts/native-parity/migration/{reproducibility,validation}.json` and
`artifacts/native-parity/migration-power-strike-dispatch-verify.log`. The browser
evidence index is [VERIFICATION.md](VERIFICATION.md).

## Open

Covered by requirements:

- Full-tree hash lock before `E:/Lineage2-client` is a conversion source (FOUND-03).
- All-tile reconstruction, BSP, water, decorations and collision (WORLD-01, WORLD-03).
- GPU texture compression and compressed P8 derivatives (PERF-02).
- Native choice between redundant weight streams and rendered deformation parity (POL-01).
- Generic PrePivot initialization and broader NPC coverage (ACT-02).
- Equipment-to-CurWeaponType, sword attachment transform and full native attack (ACT-03, POL-01).
- Power Strike live timing, attachment, particle and blend behavior (ACT-06).

Not covered by a requirement:

- The package index reports **UE118/0 `textures/l2_skies.utx`** as unsupported by the typed package adapter. Its source bytes stay staged.
