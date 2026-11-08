# Native doors and gates

The eight `Engine.Mover` actors in the retained `20_20` map have a dedicated
source conversion bundle and a shared browser runtime loader. Each leaf or gate
keeps its original mesh, placement, hinge and open endpoint. Hover selects one
leaf; a click approaches it when necessary, then toggles it after the player
reaches proximity. A second nearby click closes the same leaf.

The bundle is staged as a separate `catalog.movers` entry. The runtime attaches
it after section loading from the `.l2asset` catalog. Additive staging preserves
existing section manifests, terrain, BSP and audio. Conversion regressions, the
production build and the desktop hardware WebGPU interaction cases pass.

## Scope

Current coverage is the eight movers of `20_20`. The stage A target is every
tile: under DEC-OWN-7 the mover extraction, conversion and staging below run as
a tile-general converter step for all 153 tiles (WORLD-01). PORT_SCOPE part 11
counts 547 doors. A tile that fails is listed as a gap, not hand-fixed. Status
and order live in [.planning/STATE.md](../.planning/STATE.md) and
[.planning/ROADMAP.md](../.planning/ROADMAP.md).

## Source evidence

The retained `maps/20_20.unr` has SHA256
`1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4`.
It contains eight `Engine.Mover` actors with two distinct static mesh references.
All eight actor property blocks and both exact mesh references are checked
directly against the package, independently of the raw JSON output.

The command hall entries match the entrance coordinates. The first six actors
below use the original `L2fortress_02_s.Fort02_indoor` mesh; the last two are
lifting gates with the separate wall-door mesh.

| Entry | Actor | Server object ID (`L2ServerObjectRealID`) | Native XYZ | Authored key 1 |
| --- | --- | --- | --- | --- |
| South | `20_20.Mover195` | 20200002 | 11459, 94386, -3454 | yaw -16384 |
| South | `20_20.Mover194` | 20200003 | 11615, 94386, -3454 | yaw +16384 |
| North | `20_20.Mover193` | 20200006 | 11459, 95587, -3454 | yaw +16384 |
| North | `20_20.Mover192` | 20200007 | 11615, 95587, -3454 | yaw -16384 |
| West pair | `20_20.Mover61` | 20200005 | 10128, 95094, -3426 | yaw +16384 |
| West pair | `20_20.Mover60` | 20200004 | 10128, 94938, -3426 | yaw -16384 |
| Gate | `20_20.Mover1` | 20200008 | 10493, 96565, -3475 | position (0, 0, 136) |
| Gate | `20_20.Mover24` | 20200001 | 12503, 93513, -3475 | position (0, 0, 136) |

These yaw keys are opposing quarter turns in native rotator units. `BasePos`
matches `Location`; actors 195/193 explicitly serialize base yaw -32768, whereas
194/192 omit `BaseRot` and `Rotation`. Declaration-qualified zero initialization
resolves those omitted rotations. Serialized `SavedPos` (-12345 on each axis)
and `SavedRot` (123,456,789) remain state/sentinel data and never supply authored
placement transforms.

The mesh resolves to `staticmeshes/l2fortress_02_s.usx`, SHA256
`1049a1075c90cdd3ecb9d739eb1828ffead45b3ad52661079552e60fe3b608b6`;
its export SHA256 is
`06a0b2b234479d518adb2d0670f92aba54f67d671e8a122dbcb1db898663f044`.
`MeshGrade` arrays also reference B/Z variants; conversion does not infer grade
selection rules from their names.

The first six actors use the indoor mesh; movers 1/24 use
`L2fortress_02_s.fort02_wall_door`. Their `KeyPos[1]=(0,0,136)` lifts each gate
1.36 metres along browser Y. Their omitted base rotations resolve to zero.
Leaves 61/60 retain base yaw -49152/-16384 respectively. Server short IDs 1
through 8 and object type 1 are retained separately from the real IDs.

The four hall leaves retain original opening/opened/closing/closed sound
references under `ItemSound2.Castle`. Their presence does not establish when the
native server or client dispatches those cues. Original opening, opened,
closing, closed and damage sound data remain source evidence; this feature does
not play them.

## Defaults and endpoint derivation

`scripts/native_map_movers.py` resolves the exact native superclass chain
`Engine.Mover -> Engine.Actor -> Core.Object` with the existing pinned offline
UELib extractor. This Interlude Mover directly extends Actor. Native export
`superIndex`, decompiled class declarations, original class bytes and authored
defaults must agree. Script and parser hashes are retained.

Recovered Mover defaults include `NumKeys=2`, `MoveTime=1.0`,
`StayOpenTime=4.0` and `bClosed=true`. Actor defaults provide `DrawScale=1.0` and
`DrawScale3D=(1,1,1)`. Omitted numeric fields such as `PrePivot`, `Rotation`,
`BaseRot`, `KeyNum` and untouched key elements resolve to zero only after their
exact class declarations and absence of inherited overrides are checked.
Indented members of Core.Object structs are excluded from class field lookup.

The retained `Engine.Mover.BeginPlay` establishes these endpoints:

```text
position = BasePos + KeyPos[KeyNum]
rotation = BaseRot + KeyRot[KeyNum]
```

The extractor verifies decompiled calls against native function identities:
Core.Object 215 is vector addition, 216 vector subtraction, and 316 rotator
addition; Engine.Actor 266 is `Move`, and 299 is `SetRotation`. Opening selects
key 1. Closing decrements the key, bounded below by zero. Every exported actor
must start closed at key 0, and that endpoint must match its saved placement.

All eight indexed key elements are preserved, with the first two marked active.
Matrices preserve native `PrePivot` and scale before rotation and translation.
The existing matrix adapter applies the single X,Z,Y basis conversion and
converts translation from centimetres to metres. UModel mesh-local vertices
already use that basis and unit; they are not centred, rebased or scaled again.

## Conversion and additive loading

`scripts/derive-native-map-movers.py` prepares an isolated immutable bundle using
the existing pinned `native_assets.Converter`. The StaticMeshActor-only paths in
`native_map.py` and `native_map_geometry.py` retain their original class contract.
No filter is widened to treat a Mover as a StaticMeshActor.

The current extraction is under
`artifacts/native-parity/research/native-door-movers-20261107/converted/`:

- `movers.json`: schema 1, kind `native-map-movers`; original map identity, two
  model resources, eight actors, endpoints, timing evidence, indexed keys,
  source tags and class evidence.
- `models/<archiveSHA>/model.glb` and `asset.l2asset`: resources relative to the
  descriptor, with SHA256 and byte counts.
- `source/` and `class-evidence.json`: raw map/mesh/class data and retained class
  scripts/defaults. Converter work and UModel evidence stay under `.work/`.
- `bundle.json`: complete resource pin inventory, implementation pins and source
  dependency hashes. Repeated extraction returns identical descriptor bytes.

The descriptor SHA256 is
`0de5d0831dd80866ccdef5084b0d658691ce81d9351222fba55257dc43b6e2e8`.
The bundle SHA256 is
`30ac72ee7ad874999444636302ac9235cc7d65d83f30c2e309aebb40a4edd50d`.
Original geometry buffers and embedded PNG bytes are unchanged from the pinned
UModel exports. No alpha or two-sided override is applied; generated
materials remain opaque and single-sided. Per-export offsets, lengths and
hashes for both meshes and all actors are retained with the raw property data.

`scripts/stage-native-movers.py` verifies the bundle, models and archives, then
copies immutable resources to `/l2/movers/<descriptorSHA>/`. It appends a
`map-20-20-movers` catalog record bound to the selected section's terrain SHA.
It preserves existing catalog records, rejects a different owner of that mover
ID, and refuses to replace a catalog changed during copying. The staging receipt
is `artifacts/native-parity/research/native-door-movers-20261107/STAGING.json`.

`src/scene/world/loadNativeMovers.ts` matches the terrain binding, verifies the
descriptor and GLB hashes, and creates independent mutable actor roots from
shared model templates. Unexpected skeletal or animation resources are rejected.
`createNativeSliceRuntime.ts` attaches the result after section loading.
Mover roots and meshes are excluded from scene serialization.
Cancellation, partial load failure and disposal release owned resources.

To reproduce extraction and additive staging:

```powershell
python -B scripts/derive-native-map-movers.py --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-parity/research/native-door-movers-20261107/converted
python -B scripts/stage-native-movers.py --bundle artifacts/native-parity/research/native-door-movers-20261107/converted
```

## Browser interaction policy

`nativeDoorInteractions.ts` and `nativeMovers.ts` implement independent leaf
state and targeting. Hover uses a per-mesh overlay and restores its previous
appearance; shared materials are unchanged. Moving leaves remain pickable.

The browser policy is explicit: a 2 metre horizontal interaction distance from
the leaf's current projected geometry, a 1.5 metre vertical tolerance from its
closed foot height, and a 0.8 metre approach stand-off. These values are local
policy, not recovered native proximity rules. Existing navigation must accept a
direct approach; automatic routing around walls is outside this path. A distant
click waits for actual player proximity before toggling. Blocked travel,
replacement commands or targets, death and disposal cancel pending interaction.
Pausing suspends motion and pending activation updates.

The browser interpolates rigid poses with quaternion slerp and linear
translation over the recovered `MoveTime` of one second. It does not
automatically close after the retained `StayOpenTime` of four seconds: each leaf
stays at its requested endpoint until toggled again. This interpolation and
toggle policy do not establish the native glide/encroachment implementation.

Navigation reads current mover bounds and invalidates cached obstacle geometry
when its world matrix changes. Leaves block walking at their current pose and
never act as walking-support surfaces. A sampled local motion guard pauses a
leaf before its projected geometry sweeps through the player and permits motion
to resume after the player moves away. This is not a claim of native continuous
collision or server permission/replication parity.

## Verification

The 12 tests in `tests/pipeline/test_native_map_movers.py` pass with the actual
retained client and extracted bundle present. They cover the complete actor and
server ID census, original yaw signs and fixed hinges, gate lift, defaults,
preserved indexed/raw data, state sentinels, operator/default tampering, all
source/resource hashes, archive validation, original geometry buffer and PNG
byte identity, and material flags.

Additional focused regression coverage is in:

- `tests/pipeline/test_native_mover_stage.py`: actual bundle staging,
  idempotence, preservation of unrelated assets/catalog records, conflicting
  ownership and concurrent catalog changes.
- `tests/unit/nativeMoverLoader.test.ts`: independent mutable leaves, shared
  original materials, scene serialization exclusion, terrain bindings,
  resource tampering, unexpected animation rollback and cancellation cleanup.
- `tests/unit/nativeDoors.test.ts`: manifest validation, independent hover and
  toggles, approach-before-activation, blocked/replaced approaches, death/action
  cancellation, pause/resume, player obstruction and translating gates.

The production build, including global typecheck, passes. The focused runtime,
adapter, navigation and hand-anchor suite passes 149 tests. Retained
`GLB_VALIDATION.json` records zero errors and zero warnings for both models;
unused source accessors and one material produce informational messages only.

The final `browser-run-6/RESULTS.json` records passing desktop cases on
NVIDIA/Pascal hardware WebGPU. Trusted pointer input verifies
hover, walking into proximity before opening, independent leaves, clicking an
open leaf closed, closed collision/open passage, swing obstruction/resume,
replacement cancellation and the translating gate's original 1.36 m lift and
closing click. Existing hand-anchor readiness and runtime/registry/audio cleanup
pass, with no unexpected GPU error or device loss. Captures are visually
inspected. This does not certify every entrance or physical mobile devices.
Failed harness runs are kept as evidence. Exact receipts, preservation
attribution and tested-build limits are in
`artifacts/native-parity/research/native-door-movers-20261107/` (`REPORT.md`,
`FINAL_RECEIPT.json` and `FINAL_IDENTITIES.json`). No native client is launched
for this conversion. The audit and collector in that research directory are
source evidence only. The evidence index is [VERIFICATION.md](VERIFICATION.md).

## Open

- Tile-general mover conversion for all 153 tiles (WORLD-01). Real
  geodata-backed movement stays deferred (GEO-01).
- Original sound dispatch. The `ItemSound2.Castle` references are preserved
  and not played (WORLD-02, POL-02).
- Native server authority, request packets, permissions and replication (NET-04).
- Damage and grade selection from `MeshGrade` variants.
- Exact native interpolation, glide and encroachment. No requirement covers them.
- `RangeDelta[0..3]` is preserved source data. Its meaning as a selection,
  footprint or interaction boundary is not qualified. No requirement covers it.
