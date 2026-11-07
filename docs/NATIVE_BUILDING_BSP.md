# Command-hall BSP recovery

The apparent windows in the command hall were omitted map geometry. The lower
wood panels are stored in the saved `20_20.myLevel.Model` BSP, separately from
the imported `L2fortress_01_S.fort01_command_in` static mesh. Its existing static
sections and textures were present; changing texture alpha or making those
sections two-sided would not restore the missing faces.

The recovered room belongs to `20_20.Brush610` in `20_20.Model798`, associated
with `20_20.StaticMeshActor1913`. The hall spans native X=10937..12137,
Y=94387..95587 and Z=-3453..-3135. Browser coordinates use XYZ → XZY × 0.01;
source normals are preserved and triangle winding is reflected once.

| Fragment | Final model nodes | Vertices / triangles | Original material |
| --- | --- | --- | --- |
| Walls | 1448, 1449, 1451, 1452, 1454, 1455, 1458, 1459 | 36 / 20 | `L2fortress_01_T.Fort01_deffense_wall01` |
| Floor | 1457 | 8 / 6 | `L2fortress_01_T.Fort01_command_planw` |
| Ceiling | 1456 | 8 / 6 | `L2fortress_01_T.fort_wsquare_bwall` |

All ten source nodes retain their 52 vertices and produce 32 nondegenerate
triangles. Exact convex triangulation retains collinear boundary vertices and
the original doorway openings. UVs come from the stored BSP texture base and
projection vectors, divided by the original texture dimensions. Embedded PNG
bytes are reused from hash-pinned conversions and checked against the original
native texture package/export identities.

## Reproduce the local extraction and immutable bundle

Run from the project root with the retained private inputs present. The source
map is pinned to SHA-256
`1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4`;
the selected final model is pinned independently. These commands use the
existing original texture conversions and do not launch the native client.

```powershell
python -B scripts/native_bsp_building.py --client artifacts/native-parity/inputs/IMPORTA-PC --source-bundle public/l2/maps/cbddefef4bd6f2b74b17a8640db143d8e22ce11265766fb81ca51215c38798c6 --output artifacts/native-parity/research/native-building-walls-20261107/extracted

python -B scripts/derive-native-map-building.py --base-bundle public/l2/maps/cbddefef4bd6f2b74b17a8640db143d8e22ce11265766fb81ca51215c38798c6 --base-sha256 cbddefef4bd6f2b74b17a8640db143d8e22ce11265766fb81ca51215c38798c6 --extracted artifacts/native-parity/research/native-building-walls-20261107/extracted --extracted-sha256 ae2ab6453c2f50982609183190b2e76e5c858cd77ec9b69cdabbc8bcbeea6a25 --output artifacts/native-parity/research/native-building-walls-20261107/runtime --stage
```

Omit `--stage` to prepare the derived bundle without changing the catalog.
Immutable outputs must be identical on reuse; conflicting files are refused.
Staging changes only the selected section pointer after checking that the
catalog still selects the expected base or the already-staged result.

The resulting runtime manifest is
`2e73654e644bfe983021fbe5fdce01a907ac94c288702b4b7df77b4f74ee8d8a`.
The derived runtime directory contains `bundle.json`, its complete `bundle/`
payload, and three successive Editor snapshot/manifest pairs:

1. `editor-walls.json` / `manifest-walls.json`
2. `editor-floor.json` / `manifest-floor.json`
3. `editor-ceiling.json` / `manifest-ceiling.json`

Each snapshot pins its existing authored material record and its preceding
manifest. The following recipe replays them **only onto the matching saved
base scene**, in that order. The current local scene already contains all
three additions; replaying an earlier step against its final manifest is
correctly refused as stale.

```powershell
$buildingRuntime = 'artifacts/native-parity/research/native-building-walls-20261107/runtime'
$buildingRecipe = Get-Content "$buildingRuntime/bundle.json" -Raw | ConvertFrom-Json
foreach ($buildingAppend in $buildingRecipe.editorAppends) {
    node scripts/append-native-editor-bsp.mjs --snapshot "$buildingRuntime/$($buildingAppend.snapshot)" --snapshot-sha256 $buildingAppend.snapshotSha256 --manifest "$buildingRuntime/$($buildingAppend.manifest)" --sha256 $buildingAppend.manifestSha256 --apply
    if ($LASTEXITCODE -ne 0) { throw 'BSP append stopped; preserve the current scene and inspect the conflict.' }
}
pnpm build
```

Omit `--apply` to inspect an individual append plan at its matching base state.
The appender preserves existing BSP entries and authored meshes, adds exactly
one fragment per operation, and checks source/material hashes and concurrent
edits before committing. Repeating the latest applied snapshot preserves later
authored geometry, material and transform edits.

## Preservation and verification

Of 1,742 existing saved scene files, 1,739 remain byte-identical. Only the world
root manifest, scene config manifest identity and channel-proof manifest
identity change; three mesh records and three geometry binaries are added.
The runtime bundle grows from 954 to 964 files, retaining 952 original files
byte-for-byte and changing only its manifest and receipt.

Existing terrain primary UVs, UV2, the terrain extension, other BSP geometry,
scene authoring and audio assets remain preserved. This repair has no audio
source or playback changes. Native lightmaps, native submitted render UVs,
complete lighting/material parity, native doors and complete-map BSP coverage
remain separate work.

The focused checks pass: 60 TypeScript tests, seven pipeline tests with the
retained private inputs, and `pnpm build`. The pipeline regression command is:

```powershell
python -B -m unittest discover -s tests/pipeline -p test_native_bsp_building.py -v
```

Those tests verify source identities, geometry counts, nondegenerate
triangulation, unchanged original inputs, exact GLB/JSON channels and PNG
hashes. A ray at browser X=115.37, Y=-34 passes through the original doorway
at Z=955.87; a parallel ray at X=112 hits the adjacent recovered wall.

Both production WebGPU loading routes pass the original doorway and eight
indoor stair waypoints with four BSP meshes / 60 total BSP triangles, without
GPU validation errors or device loss. Matched diagnostic views through the
production section loader show the restored wooden wall backing and floor.
All three new GLBs pass the pinned Khronos validator with zero errors/warnings.
The audio owner's build/GPU window has been released with exact receipts.
See the
[repair report and evidence](../artifacts/native-parity/research/native-building-walls-20261107/REPORT.md)
and [preservation receipt](../artifacts/native-parity/research/native-building-walls-20261107/PRESERVATION.json).
