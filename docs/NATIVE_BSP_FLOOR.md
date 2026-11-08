# Source BSP geometry on 20_20

Part of each map's visible geometry lives in the saved level BSP, not in its static meshes. On `20_20` two BSP pieces are converted: the building floor slab (`Brush397`) and the command hall (`Brush610`). Both come from the final `ULevel.Model` of `maps/20_20.unr`.

These are the 20_20 cases of the BSP converter step. Under DEC-OWN-7 the same extraction, UV rule and staging run as a tile-general step for all 153 tiles (WORLD-01). A tile that fails is listed as a gap, not hand-fixed. Status and order live in [.planning/STATE.md](../.planning/STATE.md) and [.planning/ROADMAP.md](../.planning/ROADMAP.md).

## Source identity

The source map is pinned to SHA-256 `1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4`. `20_20.myLevel.Model` resolves to `20_20.Model798` (export reference 9184). The selected final model is pinned independently.

### Floor slab (Brush397)

`20_20.StaticMeshActor940` uses `L2fortress_01_S.Fort01_deffense`, a hollow building shell. Its floor is not in that StaticMesh. Ten final nodes associated with `20_20.Brush397` form the slab: 48 vertices / 28 triangles. Its top is node 620 / surface 2297 at native Z=-3426, browser Y=-34.26 m. The texture is `L2fortress_01_T.Fort01_command_planw`.

### Command hall (Brush610)

The command hall's lower wood panels, floor and ceiling belong to `20_20.Brush610`, associated with `20_20.StaticMeshActor1913`. They are separate from the `L2fortress_01_S.fort01_command_in` static mesh. That mesh's own sections and textures are present. Changing texture alpha or making its sections two-sided does not restore the missing faces.

The hall spans native X=10937..12137, Y=94387..95587 and Z=-3453..-3135.

| Fragment | Final model nodes | Vertices / triangles | Original material |
| --- | --- | --- | --- |
| Walls | 1448, 1449, 1451, 1452, 1454, 1455, 1458, 1459 | 36 / 20 | `L2fortress_01_T.Fort01_deffense_wall01` |
| Floor | 1457 | 8 / 6 | `L2fortress_01_T.Fort01_command_planw` |
| Ceiling | 1456 | 8 / 6 | `L2fortress_01_T.fort_wsquare_bwall` |

All ten nodes keep their 52 vertices and produce 32 nondegenerate triangles. Exact convex triangulation keeps collinear boundary vertices and the original doorway openings.

## Converter rules

These rules hold for every BSP fragment the step converts:

- Keep the source polygons, normals, texture projection axes and original texture. Never draw an invented replacement plane or all original brushes.
- Coordinates map native XYZ to browser XZY x 0.01. Source normals are kept. Triangle winding is reflected once.
- UVs come from the stored BSP texture base and projection vectors, divided by the original texture dimensions. This is the tile-general BSP UV rule.
- Embedded PNG bytes reuse hash-pinned texture conversions, checked against the native texture package and export identities.
- Every stage refuses changed inputs or conflicting outputs. Immutable outputs must be identical on reuse.
- Staging changes only the selected section pointer, after checking that the catalog still selects the expected base or the already-staged result. A repeated stage leaves the catalog unchanged.

The runtime loads BSP resources from the `.l2asset` catalog with the section. The Babylon.js Editor is an optional viewer and is not part of this step; see [EDITOR_VIEWER.md](EDITOR_VIEWER.md).

## Reproduce

Run from the project root with the retained IMPORTA-PC inputs present. These commands do not launch the native client. Omit `--stage` to prepare and inspect without changing the catalog.

Floor slab:

```powershell
python -B scripts/native_bsp_floor.py --output artifacts/native-parity/research/map-overlap-expansion-20261106/bounds-scout/floor-extraction-pinned
python -B scripts/derive-native-map-bsp.py --bsp artifacts/native-parity/research/map-overlap-expansion-20261106/bounds-scout/floor-extraction-pinned --bsp-sha256 f66424a2a35473a4696f198cd47ec1c066f6247535576b58af67ad54fe0b3c69 --output artifacts/native-parity/research/native-building-floor-20261106/runtime --stage
```

The floor step outputs section manifest `93139ab0f6751ef3ea5f639876e862900d3767c711754ef2af9e2a0907e97a66`. It keeps 156 static placements / 61 models and adds one BSP resource. Of 940 base bundle files, 938 stay identical; only the runtime manifest and receipt change, plus four added BSP files. Terrain primary UV and UV2 stay intact.

Command hall:

```powershell
python -B scripts/native_bsp_building.py --client artifacts/native-parity/inputs/IMPORTA-PC --source-bundle public/l2/maps/cbddefef4bd6f2b74b17a8640db143d8e22ce11265766fb81ca51215c38798c6 --output artifacts/native-parity/research/native-building-walls-20261107/extracted

python -B scripts/derive-native-map-building.py --base-bundle public/l2/maps/cbddefef4bd6f2b74b17a8640db143d8e22ce11265766fb81ca51215c38798c6 --base-sha256 cbddefef4bd6f2b74b17a8640db143d8e22ce11265766fb81ca51215c38798c6 --extracted artifacts/native-parity/research/native-building-walls-20261107/extracted --extracted-sha256 ae2ab6453c2f50982609183190b2e76e5c858cd77ec9b69cdabbc8bcbeea6a25 --output artifacts/native-parity/research/native-building-walls-20261107/runtime --stage
```

The command-hall step outputs runtime manifest `2e73654e644bfe983021fbe5fdce01a907ac94c288702b4b7df77b4f74ee8d8a`. The bundle grows from 954 to 964 files. 952 base files stay byte-identical; only the manifest and receipt change. Terrain primary UVs, UV2, the terrain extension, other BSP geometry and audio assets are preserved.

## Movement

The floor slab and the source collision-enabled sections of its associated building join local triangle navigation. Static sections whose source material slots explicitly enable collision are also admitted, which supports the Actor1914 indoor staircase. The local BSP association is not a global scenery-support whitelist. Strict BSP checks stay in place.

Section placement transforms and explicit collision or walking exclusions are used. Temporary support and picking metadata is restored on disposal. Runtime effects, animated geometry and unknown source collision declarations stay excluded.

The male fighter sweep uses MFighter radius 9 / half-height 23 native units (0.09 / 0.23 m). The capsule shape, 0.3 m step and 45-degree slope are browser policies.

The Actor940 wall control also contacts an original Actor1046 furnishing. Its expected height uses the pinned source triangle at the actual capsule footprint. The floor-entry height, wall range and tolerances are unchanged. The indoor route uses supplied waypoints, not automatic pathfinding.

## Verification

Command hall:

- 60 TypeScript tests, seven pipeline tests with the retained private inputs, and `pnpm build` pass.
- Pipeline regression: `python -B -m unittest discover -s tests/pipeline -p test_native_bsp_building.py -v`. It checks source identities, geometry counts, nondegenerate triangulation, unchanged inputs, exact GLB and JSON channels and PNG hashes.
- A ray at browser X=115.37, Y=-34 passes through the original doorway at Z=955.87. A parallel ray at X=112 hits the recovered wall.
- The production WebGPU section loader passes the doorway and eight indoor stair waypoints with four BSP meshes / 60 BSP triangles, without GPU validation errors or device loss. Diagnostic views show the wooden wall backing and floor.
- All three new GLBs pass the pinned Khronos validator with zero errors and warnings.

Floor slab:

- The extractor's 10 tests pass. The deriver's 12 tests pass, with one Windows symlink-creation skip.
- In the browser the slab shows, and the stairs, walls, floor and exit checks pass.

Evidence:

- `artifacts/native-parity/research/native-building-floor-20261106/REPORT.md`
- `artifacts/native-parity/research/native-building-walls-20261107/REPORT.md`
- `artifacts/native-parity/research/native-building-walls-20261107/PRESERVATION.json`
- `artifacts/native-parity/research/native-stair-traversal-20261107/IMPLEMENTATION.md`

The evidence index is [VERIFICATION.md](VERIFICATION.md).

## Open

- Tile-general BSP converter step for all 153 tiles (WORLD-01). WORLD-01 names the Brush397 slab as a 20_20 hand step; Brush610 is a second one.
- Complete BSP coverage beyond these two pieces (WORLD-01).
- Native lightmaps. No requirement covers them.
- Native submitted render UVs. No requirement covers them.
- Lighting, material and visible native pixel parity (CHECK-01, POL-01).
- Native geodata and cylinder collision (GEO-01).
- Automatic stair routing and upper-landing roof camera occlusion (POL-03).
- Doors are a separate step; see [NATIVE_DOOR_MOVERS.md](NATIVE_DOOR_MOVERS.md).
- This geometry work establishes no audio parity.
