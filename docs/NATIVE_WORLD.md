# Native world converter

This is the canonical doc for converting Interlude world tiles into the browser.
It covers terrain, static meshes, section selection, terrain decorations and the
runtime section loader. BSP, sky, audio, doors and flames have their own docs,
linked below.

## Scope and coverage

- Current coverage: one section of tile `20_20` around `20_20.PlayerStart10`.
- Stage A target: all 153 tiles, through tile-general converter steps
  (DEC-OWN-7, WORLD-01). Each step records pass or gap per tile (WORLD-03). A
  failing tile is listed as a gap, never hand-fixed (CHECK-04).
- Status and work order: [.planning/STATE.md](../.planning/STATE.md) and
  [.planning/ROADMAP.md](../.planning/ROADMAP.md).
- Reference client: IMPORTA-PC `C:/Lineage2-client`. `E:/Lineage2-client` is a
  conversion source only after the full-tree hash lock (DEC-OWN-2).
- Output: `.l2asset` packages plus the runtime catalog. The input lock
  `recipes/native-inputs.lock.json` is input-only (DEC-OWN-5).
- The Babylon.js Editor is an optional viewer, not part of the world path
  (DEC-OWN-8). See [EDITOR_VIEWER.md](EDITOR_VIEWER.md).

The current 20_20 section holds **157 placements / 62 models / 4,992 terrain
triangles**, plus the Brush397 floor slab, the Brush610 command hall and the
sky. The base migration recipe holds **61 models / 151 placements / 4,512
terrain triangles**. These are different checkpoints. Do not mix them when
measuring a baseline.

## How 20_20 is built today

The [genericity audit](research/genericity-audit-20261108.md) is the evidence
for this section. Of 115 distinct steps that build 20_20, only **9 are both
scripted and tile-general**. 45 are tile-specific and need code edits for
another tile. 37 carry hand-qualified pins. 15 need a hand-written per-tile
recipe. 33 are hand or interactive changes that no script reproduces.

The live catalog section `map-20-20-section` points at manifest `2e73654e`. It
is the end of a seven-link chain. Each link pins its predecessor's hash and
rewrites `public/l2/catalog.json` in place:

`062218e6` -> `migrate-native-terrain-runtime.py` (`9841a8fa`) ->
`derive-native-map-overlap.py` (`fdee1286`) -> `derive-native-map-bsp.py`
(`93139ab0`) -> `derive-native-map-model.py` (`e006306d`) ->
`derive-native-map-terrain.py` (`cbddefef`) -> `derive-native-map-building.py`
(`2e73654e`).

The live terrain descends from a research raw map
(`research/audio-world-20261106/map-correction-first`) and a hand-typed
geometry command, not from `pnpm assets:migrate`. The retained receipts record
implementation hashes that match no commit, so 20_20 cannot be rebuilt from
committed code today.

The second-tile probe on 20_21 ran 9 scripts, 1 partly and 18 failed. Failures
come from hard-coded `maps/20_20.unr` paths, the pinned map hash `1beddad2`,
pinned base-bundle hashes and pinned actor, brush and sector names.

The audit proposes one orchestrator, `pnpm world:build --map <tile>`, backed by
`scripts/world_build.py`. It computes every per-tile input from map data and
replaces the derive, append and migrate chain. The design, stages and first
steps are in sections 8 and 9 of the audit. The owner decisions it needs are in
section 10.

## Converter steps

Each row is one converter step. The rule column is what the step must do for
every tile. The 20_20 column is current coverage. The other-tiles column is the
current gap, from the audit's 20_21 probe and census.

| Step | Tile-general rule | 20_20 | Other tiles |
| --- | --- | --- | --- |
| Raw map extraction (`scripts/native_map.py`) | Read the whole level from the map package | pass | Reader accepts only UE123 / licensee 28: 67 of 153 tile maps. Ran on 20_21. |
| Start anchor | GameInfo NavigationPointList rule on the startup map | pass (PlayerStart10, chosen by hand) | gap: no script implements the rule |
| Section selection | Computed sector cut around the anchor | pass (nine-sector recipe) | gap: per-tile recipe written by hand |
| Terrain geometry (`scripts/native_map_geometry.py`) | Whole TerrainInfo per sector, original heights | pass | Ran on 20_21: 2,401 vertices / 4,608 triangles / 9 layers |
| Cached Z bounds | Keep cached bounds, reconstruct original samples | pass (6 of 9 sectors differ) | 20_21: 238 of 256 sectors differ |
| Mask UV rule | One rule keyed on the native branch predicate | pass (735 V fields) | gap: rule is pinned to the 20_20 hash and does not fire on 20_21 |
| Adjacent terrain sector | Part of whole-TerrainInfo terrain | pass (TerrainSector247, hand choice) | gap: scripts pin sector 247 |
| Static-mesh selection | Triangle intersection, not actor origin | pass (+5 trees, then +1) | Core `native_map_overlap.py` ran on 20_21; derive script fails |
| Model conversion | Shared store, unsupported formats become gap records | pass (62 models) | Material reader rejects 56 of 212 `.usx` packages; 599 of 3,205 20_21 placements use rejected layouts |
| Normal restoration | Repair only a demonstrated defect | pass (Actor3703 tree) | gap: pinned to one tree proof |
| BSP | Whole level by PolyFlags | pass (Brush397, Brush610) | gap: pinned brushes and nodes |
| Terrain decorations | Native DecoLayers reconstruction | gap | gap |
| Sky, audio, doors, flames | See linked docs | pass | gap: pinned to 20_20 |

### Raw extraction and terrain

The map, heightmap and terrain readers accept only UE123 / licensee 28
(`scripts/native_map.py:94-95, :209-210, :306-307`;
`scripts/native_map_geometry.py:115-116`). 39 tiles also have a licensee-28
`T_<tile>.utx`. The texture mip converter accepts P8, DXT1 and DXT5 only, and
licensee 20, 28 and 30 only; 56 of 152 tile texture packages pass. On 20_21,
`native_migration.py --prove-rebuild` rebuilt all 52 products identically. That
layer is the base for the generic pipeline.

### Static-mesh selection by triangle intersection

A static actor belongs to a section when one of its indexed triangles has a
positive-area projection inside the section rectangle. The actor origin alone
does not decide. Zero-area vertical faces and edge or point contacts do not
qualify. The tree mesh is never clipped, rescaled or moved. The rule replaces
origin-only selection; the section rectangle and source Z window stay as
declared. `native_map_overlap.select_overlaps` / `audit_overlap` is
tile-general and is one of the 9 generic steps.

20_20 numbers:

- Source map SHA-256
  `1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4`.
- XY rectangle `[8192,92160]..[14336,98176]`, actor-origin Z window
  `[-4000,-2500]`.
- 4,183 static actor transforms and references checked against source tags.
  Within the Z window, 151 origins are inside the rectangle and 2,055 outside.
- Of the 261 outside-origin actors with converted meshes, five have
  positive-area triangles inside; 256 do not. The report records the first
  clipped triangle and the source hashes for each addition, not bounding-box
  overlap.
- The five added actors are `20_20.StaticMeshActor3701`, `3978`, `3258`, `2218`
  and `3261`. They use `Oren_tree_S.Elf_Colors.Oren_elf_tree03`, `08` and `09`.
- That addition keeps 937 of 939 base files unchanged; only the runtime
  manifest and receipt change, plus a new audit.

`native_map_overlap.py` also runs as a read-only audit. Supply `--client`,
`--raw`, `--runtime-manifest`, `--runtime-sha256`, `--class-evidence` and
optionally `--recipe`. It writes JSON to stdout. `--output` creates a new
scratch report and refuses to overwrite.

Evidence: `artifacts/native-parity/research/map-overlap-20261106/REPORT.md`.

The audit's design drops the hand Z window and adds no window in the select
stage. It notes this will probably add placements beyond the current 157. That
policy is owner decision 5 in the audit.

### Models outside the converted set

A bounds scout screened **1,794 outside-origin actors across 193 model
identities** that had no converted mesh. One candidate passed full
indexed-triangle inspection: `20_20.StaticMeshActor3703`, using
`Dion_tree_S.red_mt.dion_excute_tree1`, with eight positive-area triangles
inside the rectangle. It stays at its original transform. 103 licensee-12 cases
keep bounds-only limits; this is not full geometry or material support for the
193 identities. The scout's producer is not retained (audit E02), and the Dion
tree comes from a hand-written `request.json` (audit E03).

Reproduce the derived section from retained inputs:

```powershell
python scripts/derive-native-map-model.py --archive artifacts/native-parity/research/map-overlap-expansion-20261106/source-normal-correction/derived/4a800ae694cbf210835e14a3684763de8c0bc3258bdbce316f0bb7bda995ded3/asset.l2asset --sha256 4a800ae694cbf210835e14a3684763de8c0bc3258bdbce316f0bb7bda995ded3 --output artifacts/native-parity/research/map-overlap-expansion-20261106/tree-integration/runtime --stage
```

Omit `--stage` to prepare source data only. The script rejects conflicting
source identities, unsupported graph changes and overwrites. A repeated run
makes no change. It is tile-specific: on 20_21 it fails with "Wrong model
archive".

Evidence:
`artifacts/native-parity/research/map-overlap-expansion-20261106/tree-integration/REPORT.md`.
The prepared derivative passes five pipeline tests and normal restoration
passes eight.

### Normal restoration rule

A repair runs only for a defect the native source demonstrates (CONV-02). For
the Dion tree the converted normals differ from the native source. The repair
restores **533 original normals: 1,599 float fields / 4,120 GLB bytes**, with no
normalization. Every other GLB byte is unchanged: positions, UVs, indices,
material assignments and the three embedded PNGs stay exact. It admits only the
qualified source layout and does not broaden format support by guessing.
`scripts/restore-native-static-normals.py` with
`native_assets_lib/static_normals.py` pins one tree proof (`56fa4c10`, version
`[123,22]`), so other identities need their own layout qualification.

## Terrain decorations (gap)

Upright grass is missing on every tile. The pipeline does not reconstruct
`TerrainInfo.DecoLayers`, which is a mesh placement system separate from the
ground texture layers.

Where the pipeline stops:

1. `scripts/native_map.py` decodes `DecoLayers` and keeps the four layers in
   `terrain.json` (`decoLayers`).
2. `scripts/native_map_geometry.py` emits mesh requests and placements only for
   `StaticMeshActor` records. Its output lists terrain decorations as
   unreconstructed.
3. `src/scene/world/loadNativeSection.ts` has no decoration manifest or instance
   path.
4. `src/scene/world/grassInstances.ts` serves only the legacy imported world's
   placement JSON, which does not give native Interlude positions.

20_20 source: `20_20.TerrainInfo0`, map SHA-256 as above. Meshes are in
`field_deco_S.grass_oren_S`; density maps are in `L2DecoLayer.Oren`.

| Layer | Mesh | Density map | XYZ scale | Density | Max per quad | Fade (native units) |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `Elf_grass_001` | `20_20_Deco01` | 1-3 | 0-50 | 20 | 300-1500 |
| 1 | `Oren_elf_grass0055` | `20_20_Deco02` | 0.6-1.5 | 5-25 | 8 | 1300-2400 |
| 2 | `elf_grass002` | `20_20_Deco03` | 1-2 | 5-30 | 8 | 1500-2500 |
| 3 | `Oren_elf_grass0011` | `20_20_Deco04` | 0.7-1.5 | 5-30 | 10 | 1400-2400 |

- Each layer serializes `Seed=0`, `RandomYaw=1`, `ShowOnTerrain=1`,
  `ShowOnInvisibleTerrain=0`, `AlignToTerrain=0` and null scale and color maps.
- Density maps are DXT1, 512x512, ten mips. The native texture reader reads each
  one. This proves availability and layout, not the density channel or native
  sampling.
- Grass shaders (`field_deco_T`) assign one texture to `Diffuse` and `Opacity`
  with `TwoSided=true`, `ZWrite=true`, `AlphaTest=true`, `AlphaRef=10`. A grass
  product must keep these.
- The four material textures are native format **7 (DXT3)**.
  `scripts/native_assets_lib/texture_mips.py` accepts only P8 (0), DXT1 (3) and
  DXT5 (8) and reports `Native texture source format is unreviewed: 7`. Its DDS
  wrapper supports only DXT1 and DXT5. The pinned UEViewer revision
  `a0bfb468d42be831b126632fd8a0ae6b3614f981` defines `TEXF_DXT3=7`
  (`Unreal/UnrealMaterial/UnMaterial2.h:290`), maps it to `TPF_DXT3`
  (`UnTexture2.cpp:504`) and declares 4x4, 16-byte blocks (`UnTexture.cpp:63`).
  The UModel-to-PNG path is separate and not shown to fail.
- The TerrainInfo native tail decodes fully as sector references, coordinates,
  dimensions and vertex colors, with no baked grass instance list. Sector
  payloads still hold uninterpreted bytes.

Reference only: UT2004 commit `deda0fb464371b661b616b4e58ff4d53f6f011f1`,
`Engine/Src/UnTerrain.cpp:3781` (`UpdateDecorations`) has a seeded generator.
Its `GetLayerAlpha` (lines 1473-1521) handles L8, P8 and RGBA8 and returns zero
for DXT1, so copied unchanged it gives zero grass. Interlude's handling needs
its own evidence. A generic random scatter does not recover the source layout.

The converter step needs: a decoration product carrying the declarations and
mesh, material and density dependencies; DXT3 support in the mip and DDS
adapters; instance reconstruction using native density sampling, seed and RNG,
sector order, quad visibility and diagonal, height, scale and yaw; and instanced
browser loading that respects fade and visibility.

Census:
`artifacts/native-parity/research/native-terrain-decorations-20261107/audit.json`
(SHA-256 `b862d9a3373c451f6b3ee3a2adcaab5628a7ff7e50e45d084fb096d971efe94e`,
209019 bytes). The adjacent `collect.py` rechecks the sources; it hard-codes
20_20. Deco-grass footstep surfaces are an approximation because the browser
does not render the DecoLayers; see [NATIVE_AUDIO.md](NATIVE_AUDIO.md).

## 20_20 section facts

### Source location

`20_20.PlayerStart10` sits at native XYZ `[10536, 95034, -3374.786376953125]`.
The map's navigation chain visits it first. The GameInfo startup gives the
three enabled starts equal ratings and keeps the first. The custom player
controller adds no override. This is source-backed startup selection, not an
observation of the live pawn or camera.

`recipes/native-map-debug-location.json` selects nine terrain sectors around
Sector229, native XY `[8192, 92160]..[14336, 98176]`. The final map row is
shorter and stays unchanged. The rectangle holds 2,352 vertices and 4,512
visible triangles before the adjacent sector.

The terrain triangle under PlayerStart10 XY has Z `-3455.286376953125`. The
PlayerStart Z stays separate, with its 80.5-unit clearance. Actor placement,
collision and camera are not inferred from it. MFighter's native class
collision height is 23 units; its source mesh and pivot stay intact.

Six of the nine sectors have cached Z bounds that differ from the source height
samples. The adapter requires native XY agreement, keeps all cached bounds and
discrepancies at the 0.001-unit tolerance and reconstructs the original
samples. It never fits geometry to stale bounds. The older one-sector recipe
keeps its stricter bounds policy.

Location and class evidence: `artifacts/native-parity/research/native-location/`.

### Adjacent sector TerrainSector247

TerrainSector247 fills the gap under Actor3703's tree: **272 vertices / 480
visible triangles**, derived from TerrainInfo0 and the original G16 samples. All
16 shared-edge positions, normals and diffuse UV2 match the section. Ordinary
mask UVs would disagree at 15 shared-edge vertices, so the patch uses the
retained native mask-coordinate qualification once. Heights and topology are
original; the 735 corrected V values and diffuse UV2 stay unchanged.

The source-height handoff
`artifacts/native-parity/research/terrain-extension-20261106/source-audit/SOURCE_JOIN_HANDOFF.md`
holds all 272 native XYZ records and the source identities. Keep diffuse stage0
CAMERASPACEPOSITION/COUNT2 distinct from mask stage1 TC0/DISABLE. No production
UV rule widens from that receipt.

Evidence: `artifacts/native-parity/research/terrain-extension-20261106/REPORT.md`.

### Terrain mask UV rule

The 20_20 production mask UV is
`(grid + 0.5)/256 - max(grid - 240, 0)/4096`. It corrects **735 V fields**,
which all agree with the native-coordinate oracle. All U values, diffuse UV2,
texture and material identities stay unchanged. The rule is natively evidenced
only for grid X64..112 / Y224..255. The U term for x>240 has no evidence.

The native branch predicate is what the tile-general step evaluates per tile:

- The ordinary `(grid + 0.5)/H` applies only when
  `(GIsL2Seamless == 0 || GIsEditor != 0) && gbStretchTerrainMask == 0`.
- Otherwise the alternative subtracts `max(grid - 240, 0)/4096`. 20_20
  production uses the alternative.
- Generated floats reach FLOAT2 TEXCOORD0 at offset 28, stride 36.
- Pass transfer can override the coordinate index to 1, and the cache guard can
  keep earlier state.
- Image defaults are not generation-time values.

Today `scripts/native_map_geometry.py:41-54, 325-361, 641-647` bakes the rule
behind the 20_20 hash, so on other tiles UVs stay "inspection-candidate".
Whether to ship other tiles with UVs marked extrapolated is owner decision 6 in
the audit.

Both routes pass desktop and mobile readiness and five behaviour regressions.
All 44 synthetic GPU cases pass on SwiftShader and GTX 1060 with the unchanged
one-byte allowance. The native draws behind the rule are offscreen submissions.
They prove indexed geometry, submitted UVs, resource bindings and fixed-function
coordinates, not visible native pixels.

Evidence:
`artifacts/native-parity/research/terrain-uv-migration-20261106/implementation/REPORT.md`.

## Runtime section loader

`/?world=interlude` loads the staged section, the Human male fighter and Greater
Musveren, with the existing controls and live FPS. The legacy Talking Island
route at `/` is separate. The required native route rejects a missing world or
actor asset instead of showing a stand-in ([VERIFICATION.md](VERIFICATION.md)).

`src/scene/world/loadNativeSection.ts` validates the catalog, content hashes,
byte lengths, native identities and placement matrices before exposing a
section. glTF mesh extras match by exact loader primitive pointer and merge with
existing metadata. One catalog snapshot supplies both section and texture
references.

Limits that bear on whole-tile conversion:

- A section needs at least one model (`loadNativeSection.ts:73`). A terrain-only
  section needs an aligned empty-model contract: the converter allows it, the
  runtime rejects it.
- A section holds at most 128 models and 4,096 placements
  (`loadNativeSection.ts:73-74`), and at most 4 BSP resources from a whitelist
  (`:97-108`, `nativeBspResources.ts`).
- 20_20 alone has 4,183 StaticMeshActors and 285 meshes, so a whole tile needs
  several cells or a raised, tested limit. The audit's design streams 4x4-sector
  chunks (16 per tile) in a ring.
- The default section identity is `map-20-20-section` and there is no `?map=`
  parameter (`loadNativeSection.ts:221`).

The loader still eagerly loads the selected section and clones scenery
placements. Instancing, chunking, LOD, texture compression and visibility are in
[RENDERING.md](RENDERING.md).

### Coordinates and fog

Coordinates are meters with `glTF XYZ = .01 * native XZY`. The native scene is
right-handed, set after parsing and before any native GLB load. No model is
mirrored to compensate.

Native scene fog is off. The pinned Editor packer writes fog mode 3 without
`fogEnabled: false`, and Babylon 9.27.1 then enables linear fog at 32-85 m,
which hides distant buildings. `scripts/preserve-native-editor-fog.mjs` writes
mode 0 after the pack when saved fog is disabled. When NOED-02 moves it to
`pnpm generate:editor`, the code-built native scene (NOED-01) sets fog off
explicitly, because Babylon defaults to `fogEnabled=true`.

### Navigation, actors and camera

The local navigation policy supplies terrain support and rejects unsupported
edges and holes. The BSP floor slab and Actor940's collision-enabled building
sections join it ([NATIVE_BSP_FLOOR.md](NATIVE_BSP_FLOOR.md)). Other scenery
collision and native geodata stay unverified. Adapter positions stay support
points. Original meshes, origins, rigs and animation keys are unchanged. This is
a local preview policy, not the native collision sweep.

Greater Musveren uses the source 0.36 m collision half-height and NPC 21622
scale 1.2. Residual terrain intersection is 660 of 1,591 vertices, up to
0.119400140 m. See [NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md).

The Human male fighter faces its tap-to-move direction. Its source +X forward
is aligned to the adapter's +Z heading with a -pi/2 rotation on the assembly's
presentation parent. Two perpendicular ground-click moves pass with
model-forward alignment >0.995. Evidence:
`artifacts/native-parity/research/movement-facing/forward-evidence.json`. This
does not establish native action or camera parity.

The camera keeps authored orbit angles when moving its target into world
coordinates. **Frame world** shows the section and **Follow fighter** restores
tracking. Equipment, death and revival, targeting and lifecycle go through
`GameWorldAdapter`. A failed section keeps the inspection area and a persistent
`worldFailure` diagnostic. Disposal releases the section.

Startup shows four named steps with per-step progress; unknown work stays
indeterminate. Failed downloads offer a reload
([PRIVATE_PREVIEW.md](PRIVATE_PREVIEW.md)).

## Terrain material preview

`nativeTerrainPreview.ts` supplies a clearly labelled candidate material. It
loads the nine diffuse PNGs and nine masks from the hash-checked catalog.
Diffuse UV matrices keep their source-world phase. Direct PNG decoding keeps RGB
under alpha zero, with no premultiplication or color conversion. All 18 images
match the independent PNG audit.

The seven 1024-square masks pack byte-for-byte into two RGBA textures; the
512-square mask stays separate and the constant-white base mask is checked. No
mask is resized. Nine diffuse plus three mask samplers fit 16 samplers. The
**Neutral terrain** and **Source textures** controls switch material without
reloading. A missing texture or failed shader keeps neutral terrain and a
`materialFailure` diagnostic. The builder pins 9 layers and mask sizes by index;
20_21 has 256 at layer 6 and 512 at layer 8, which fail
`nativeTerrainPreview.ts:187`.

Ordered composition, unlit encoded color and bilinear mip-0 filtering are
preview candidates, not native `bUseAlpha`, sampling, lighting, gamma or
framebuffer output.

Native findings to keep apart:

- Engine's CPU `GetLayerAlpha` uses packed-word DXT1 interpolation and a channel
  mean, P8 palette byte +2, or RGBA8 alpha. Its mixed value 100 is a
  classification sentinel, not a GPU weight. Ordinary BC1 decoding is a
  different operation.
- A conditional D3D method-2 path samples mask alpha, uses ONE/ZERO for the
  first pass, then SRCALPHA/INVSRCALPHA. It multiplies diffuse alpha only when
  IsTransparent (`texture+0x5c0 & 3`).
- The positive `bUseAlpha` anchor is a read at `layer+0xe4`
  (`TerrainInfo+0x4b4 + layerIndex*0xe8`), mask 1.
- High-nibble truncation is proved only for the conditional A4R4G4B4 upload.
- A failed URL or L2Shader lookup keeps its previous output. Missing shader
  files prove neither a fallback nor a fatal error.

Evidence: `artifacts/native-parity/research/terrain-mask-native-rea/REPORT.md`.

### Final terrain color

784 final terrain COLOR0 colors are still missing, and no material fix follows.
This affects every tile's stage A terrain look (WORLD-01, CHECK-01), not only
POL-01. StaticLight copies stream COLOR0 byte 24 / stride 36 into
`actor+0x21d8` with a width+1 stride; this writer does not recover the 784
colors. The packets under
`artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/`
hold the evidence:

- `color-producer-20261106/REPORT.md` and `native-color-reader-20261106`.
- `intensity-direct-helper-20261106` (97 files, manifest
  `38f0e01bbfcd079c09fd20d927872c7d80ef8f63f48f575e7b6a31f872d0fb48`).
- `color-initial-fill-20261106` (188 files, manifest
  `aaeb14873c5f2c6b3f19022df173fe75bbd8d1669f1927ef1e9f3cfac66c7ea0`). It
  records the final colors, actor and generator state, shader and `bUseAlpha`
  and visible pixels as unresolved.

### Remaining native terrain research

A qualifying native UV packet is a 20_20 draw with a mapped vertex above Y240,
its actual bytes, declaration and stride, the effective mask TEXCOORDINDEX and
TEXTURETRANSFORMFLAGS, the material route, the active shader objects and the
bound mask identity. It selects UVs, not final pixels. The six direct
`GetLayerAlpha` callers and the reviewed geometry chain are exhausted. The
`TerrainMaterial.hlsl` program, the `bUseAlpha` consumer, CPU pruning and final
visible output stay open (POL-01).

Canonical research directory:
`artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/`
with `REPORT.md`, `COORDINATE_BINDING_ADDENDUM.md`, `EVIDENCE_DEPENDENCIES.md`,
`DRAW_PACKET.md`, `BABYLON_RECOMMENDATIONS.md`,
`review/RETAINED_UV_VERIFICATION.md` and `native/batch3/GEOMETRY_GATE.md`.

## Related world parts

- BSP slabs and halls: [NATIVE_BSP_FLOOR.md](NATIVE_BSP_FLOOR.md).
- Sky: [NATIVE_SKY.md](NATIVE_SKY.md). Its hard color boundary and native
  animation stay unresolved.
- Music, ambience, footsteps and combat sounds: [NATIVE_AUDIO.md](NATIVE_AUDIO.md).
  Audio is on the developer sheet (**Dev -> Audio**).
- Doors and gates: [NATIVE_DOOR_MOVERS.md](NATIVE_DOOR_MOVERS.md).
- Flames: twelve placements use `FX_E_S.Flameset.Default_Flame01`, shown as
  **flame preview** ([NATIVE_FLAMES.md](NATIVE_FLAMES.md)).
- Packaging and staging: [ASSET_PIPELINE.md](ASSET_PIPELINE.md).
- Run counts and captures: [VERIFICATION.md](VERIFICATION.md).

## Open

Items here are not covered by any requirement.

- Terrain decorations: WORLD-01 names terrain, static meshes and BSP only, not
  DecoLayers grass.
- DXT3 (native format 7) support in the source-mip and DDS adapters: CONV-02
  does not cover texture formats.
- Collision for static meshes and BSP scenery: WORLD-05 covers terrain only.
- Triangle-intersection selection is not in WORLD-01's list of 20_20 hand
  steps, although the converter needs it.
- The audit's owner decisions (section 10): oracle versus byte equality,
  shipping scope and gap budget, reader order, section policy, Z window, mask
  UV extrapolation, the authored layer, non-client values, external tools and
  cutover.
