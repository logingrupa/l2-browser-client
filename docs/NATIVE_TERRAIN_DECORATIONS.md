# Native terrain decorations: missing grass audit

The upright grass in the supplied native screenshot is missing because the
native world pipeline does not reconstruct `TerrainInfo.DecoLayers`. This is an
omitted mesh placement system. The ground texture is a separate terrain layer.

This audit uses the retained `IMPORTA-PC` packages, with no native application,
build, browser or GPU execution. It does not change the staged world, Editor
scene, catalog, audio, or export cache. Grass is **not repaired** by this audit.

## Where the pipeline stops

1. `scripts/native_map.py` decodes the `DecoLayers` array and retains the four
   layers in `terrain.json` (`decode_property`, and the terrain output's
   `decoLayers` field). The raw reader has not lost these declarations.
2. `scripts/native_map_geometry.py` generates mesh requests and placements only
   for `StaticMeshActor` records. Terrain decoration references never enter that
   loop. Its output explicitly lists terrain decorations as unreconstructed.
3. `src/scene/world/loadNativeSection.ts` consumes terrain, terrain patches,
   static model placements and qualified BSP resources. It has no native terrain
   decoration manifest or instance generation/streaming path.
4. `src/scene/world/grassInstances.ts` supports the older imported world's saved
   grass placement JSONs through `loadImportedWorld.ts`. Those placements belong
   to another source world and do not establish native Interlude positions.

## Exact source declarations

Map: `20_20.unr`, SHA256
`1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4`.
Actor: `20_20.TerrainInfo0`. All four meshes are in
`field_deco_S.grass_oren_S`; all four density maps are in `L2DecoLayer.Oren`.

| Layer | Mesh | Density map | XYZ scale range | Density range | Max per quad | Fade range (native units) |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `Elf_grass_001` | `20_20_Deco01` | 1–3 | 0–50 | 20 | 300–1500 |
| 1 | `Oren_elf_grass0055` | `20_20_Deco02` | 0.6–1.5 | 5–25 | 8 | 1300–2400 |
| 2 | `elf_grass002` | `20_20_Deco03` | 1–2 | 5–30 | 8 | 1500–2500 |
| 3 | `Oren_elf_grass0011` | `20_20_Deco04` | 0.7–1.5 | 5–30 | 10 | 1400–2400 |

Each layer explicitly serializes `Seed=0`, `RandomYaw=1`, `ShowOnTerrain=1`,
`ShowOnInvisibleTerrain=0`, `AlignToTerrain=0`, and null scale/color maps.
The JSON audit retains the actual float values and all serialized fields.

All eight mesh/density references resolve by exact qualified object and class.
Every density map is authored DXT1, 512×512, with ten retained mip levels; the
existing native texture reader consumes each complete export successfully.
This establishes source availability and byte layout, not the density channel
or native sampling behavior.

The four mesh material slots point to `field_deco_T` shaders. Each shader
explicitly assigns the same texture to `Diffuse` and `Opacity`, with
`TwoSided=true`, `ZWrite=true`, `AlphaTest=true`, and `AlphaRef=10`. Their exact
texture references also resolve. These authored properties must survive grass
conversion; full native shader parity is not established by reading tags.

All four material textures explicitly serialize native format **7 (DXT3)**. The source
mip reader in `scripts/native_assets_lib/texture_mips.py` currently accepts only
P8 (0), DXT1 (3) and DXT5 (8), and reports
`Native texture source format is unreviewed: 7` for each grass texture. Its DDS
wrapper likewise supports only DXT1/DXT5. This is an additional native
mip-preservation/derivative coverage gap. The existing UModel-to-PNG conversion
path is separate; this audit does not claim that PNG conversion fails. The
primary missing-grass cause remains the absent decoration placement pipeline.
The pinned UEViewer revision already used by the texture adapters,
`a0bfb468d42be831b126632fd8a0ae6b3614f981`, identifies `TEXF_DXT3=7` in
`Unreal/UnrealMaterial/UnMaterial2.h:290`, maps it to `TPF_DXT3` in
`Unreal/UnrealMaterial/UnTexture2.cpp:504`, and declares 4×4, 16-byte DXT3 blocks
in `Unreal/UnrealMaterial/UnTexture.cpp:63`.

## Missing implementation

- Carry the decoration declarations and exact mesh/material/density dependencies
  into a dedicated conversion product, separate from ordinary actor placements.
- Qualify native DXT3 support in the source-mip/DDS adapters if the grass
  product is to retain the original compressed material textures and mip chains.
- Reconstruct instances using the title's density sampling/channel, seed/RNG,
  sector iteration order, quad visibility/diagonal, terrain height, scale and yaw
  rules. Respect serialized fade and visibility settings in presentation.
- Add native section assembly and efficient browser instance loading/streaming,
  preserving the original alpha-tested, two-sided grass materials.

The pinned UT2004 reference at commit
`deda0fb464371b661b616b4e58ff4d53f6f011f1`,
`Engine/Src/UnTerrain.cpp:3781` (`UpdateDecorations`), provides a seeded generation
reference. Its transient `DecoLayerData` serialization condition is at lines
1446–1450. It is another title; no retained evidence in this audit qualifies its
generator or density handling against Interlude. In particular, all four maps
here are DXT1, whereas the reference's `GetLayerAlpha` at lines 1473–1521 handles
only L8, P8 and RGBA8. Its default return is zero for DXT1, which would produce
zero grass if copied unchanged. Interlude's handling needs separate evidence.
Substituting a generic random scatter would not recover the source layout shown
in the screenshot.

The decoded TerrainInfo native tail is fully consumed as sector references,
coordinates, dimensions and vertex colors, with no decoded baked grass instance
list. Terrain sector payloads still contain uninterpreted bytes; this audit does
not claim that every possible native cache has been understood.

Machine-readable source census:
`artifacts/native-parity/research/native-terrain-decorations-20261107/audit.json`.
Its adjacent `collect.py` rechecks the exact sources and produces the same census.
Two runs produced SHA256
`b862d9a3373c451f6b3ee3a2adcaab5628a7ff7e50e45d084fb096d971efe94e`
(209019 bytes), resolving four meshes, four fully parsed density maps, four
material textures and their four explicit source-mip coverage gaps.
