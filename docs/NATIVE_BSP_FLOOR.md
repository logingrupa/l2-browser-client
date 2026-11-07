# Source BSP floor integration

The reported grass floor inside `20_20.StaticMeshActor940` was a missing map
component. `L2fortress_01_S.Fort01_deffense` is the building shell; the floor is
stored separately in the final `ULevel.Model`, not in that StaticMesh.

The pinned map resolves `20_20.myLevel.Model` to `20_20.Model798` (export reference
9184). Ten final nodes associated with `20_20.Brush397` form the original slab:
48 vertices / 28 triangles. Its top is node 620 / surface 2297 at native Z=-3426,
or browser Y=-34.26 metres. The importer retains these polygons, source normals,
texture projection axes and the original `L2fortress_01_T.Fort01_command_planw`
texture. It does not draw an invented replacement plane or all original brushes.

## Reproduce the qualified import

Run from the project root. Inputs are the retained read-only IMPORTA snapshot,
the existing verified building GLB and the pinned repository reader. Outputs stay
in destination scratch until the explicitly selected local stage/apply steps.

```powershell
python -B scripts/native_bsp_floor.py --output artifacts/native-parity/research/map-overlap-expansion-20261106/bounds-scout/floor-extraction-pinned
python -B scripts/derive-native-map-bsp.py --bsp artifacts/native-parity/research/map-overlap-expansion-20261106/bounds-scout/floor-extraction-pinned --bsp-sha256 f66424a2a35473a4696f198cd47ec1c066f6247535576b58af67ad54fe0b3c69 --output artifacts/native-parity/research/native-building-floor-20261106/runtime --stage
node scripts/append-native-editor-bsp.mjs --snapshot artifacts/native-parity/research/native-building-floor-20261106/editor-snapshot.json --snapshot-sha256 58c002110ea04270858127723d4d7c4570b3d3d258664e9ef05c7cd05f96d40b --manifest artifacts/native-parity/research/native-building-floor-20261106/runtime/bundle/map-section-runtime/manifest.json --sha256 93139ab0f6751ef3ea5f639876e862900d3767c711754ef2af9e2a0907e97a66 --apply
pnpm build
```

Omit `--stage` and `--apply` to prepare/inspect. All three import stages refuse
changed inputs or conflicting outputs. Repeated staging leaves the catalog
unchanged; repeated Editor append preserves subsequent authored edits. The
frozen Editor snapshot contains the exact extracted channels and the hash-pinned
existing material record. The installed Editor 5.5.3 geometry writer packs the
new resource. It preserves signed-zero normal bits; JSON metadata comparisons
account for the Editor's canonical zero serialization.

The new section manifest is `93139ab0f6751ef3ea5f639876e862900d3767c711754ef2af9e2a0907e97a66`.
It retains 156 static placements / 61 models and adds one BSP resource. Of 940
previous bundle files, 938 remain identical; only the runtime manifest/receipt
change, plus four added BSP files. Existing authored meshes, materials, geometry,
terrain primary UV and UV2 remain intact. Only the world manifest, config identity
and channel-proof manifest identity change among authored metadata.

## Movement and limits

The original floor checkpoint attached the slab and the explicitly associated
building's source collision-enabled sections to local triangle navigation.
The later [indoor-stair repair](../artifacts/native-parity/research/native-stair-traversal-20261107/IMPLEMENTATION.md)
separately admits static sections whose source material slots explicitly enable
collision. The local BSP association is not a global scenery-support whitelist.
This restores support for the existing Actor1914 indoor staircase while retaining
the original strict BSP checks. Current authored transforms and explicit
collision/walking exclusions are used. Temporary support/picking metadata is
restored on disposal; runtime effects, animated geometry and unknown source
collision declarations remain excluded. The male fighter sweep uses
the retained MFighter radius 9 / half-height 23 native units (0.09 / 0.23 metres).
The capsule shape, 0.3-metre step and 45-degree slope remain browser policies.
Static support geometry is sampled for the current loaded scene; saved Editor
changes take effect on reload/rebuild.

The later historical Actor940 wall control also contacts an original Actor1046
furnishing. Its expected height now uses the independently pinned source
triangle at the actual capsule footprint; the original floor-entry height,
wall range and tolerances remain unchanged. The indoor route uses supplied
waypoints, not automatic pathfinding. Roof occlusion of the follow camera at
the upper landing remains separate from walking support.

Native geodata/cylinder behavior, final lightmaps, captured native render UVs and
visible native pixels are unverified. This is one qualified slab, not complete
BSP coverage. Original audio remains included in overall acceptance and open;
this graphics work establishes no audio parity. The older 74-file terrain packet
remains unreviewed; no substitute review or new native action was performed.

Checks, before/after captures, source identities and exact preservation receipts:
[floor report](../artifacts/native-parity/research/native-building-floor-20261106/REPORT.md).
