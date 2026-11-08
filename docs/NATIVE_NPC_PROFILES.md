# Native NPC presentation profiles

The NPC profile adapter loads an actor's presentation data from the native tables and class defaults, separately from its converted model. It selects a profile by exact NPC ID. The reference profile is Greater Musveren.

The exact join is **NPC 21622 -> Greater Musveren -> `LineageMonster.field_stalker_20_bi` -> `LineageMonsters.field_stalker_m00`**. The actor class supplies DrawScale **1.2**, CollisionRadius **18** and CollisionHeight **36** in native units.

This adapter is the per-ID route that stage A generalizes to every `npcgrp` row (ACT-02). Today it covers one reference NPC. It does not claim complete NPC coverage, gameplay correctness or native visual parity. Status and order live in [.planning/STATE.md](../.planning/STATE.md) and [.planning/ROADMAP.md](../.planning/ROADMAP.md).

## Rebuild and stage

From the project root:

```powershell
pnpm assets:migrate --prove-rebuild --stage-runtime
```

The main recipe includes job `native-npc-profiles`, adapter `npc-profiles` and request `recipes/native-npc-profiles.json`. Its source manifest pins IMPORTA-PC inputs staged under `artifacts/native-parity/inputs/IMPORTA-PC/`. The input lock is input-only. It holds **143 files / 2,511,063,181 bytes**, including `system/LineageWarrior.int` and the 51,248-byte `system/npcname-e.dat`.

The profile can also be regenerated or checked on its own:

```powershell
python scripts/native_actor_profiles.py --client artifacts/native-parity/inputs/IMPORTA-PC --recipe recipes/native-npc-profiles.json --output artifacts/native-parity/npc-profiles-inspection
python scripts/native_actor_profiles.py --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-parity/npc-profiles-inspection --verify
```

All outputs stay outside the native client. Native packages, protected configuration, source textures, animation keys and converted model payloads are unchanged by this adapter.

## Source selection and inheritance

`npcname-e.dat` and `npcgrp.dat` each contain 6,519 unique NPC IDs. The recipe requires an exact ID, expected name, qualified mesh and qualified actor class. Duplicate IDs, missing rows, mismatched expectations and unresolved required defaults fail extraction. 22 NPC rows share this mesh, so the mesh never selects a name, class or scale.

The table decoder uses the pinned Interlude descriptor. `npcname` selects the `ScionsOfDestiny` layout and `npcgrp` selects `Interlude`. It consumes the complete bounded table and the exact SafePackage trailer. Name colors stay four source-order bytes written as uppercase hexadecimal. The selected row records include raw bytes and every primitive field's decoded offsets, sizes and typed values.

| Selection | Zero-based row | Decoded byte range |
| --- | ---: | --- |
| `npcname-e.dat`, ID 21622 | 1431 | `[36805,36832)` |
| `npcgrp.dat`, ID 21622 | 1431 | `[1192444,1193316)` |

The mesh resolves to `Engine.SkeletalMesh` export 6580 in `animations/LineageMonsters.ukx`, at unwrapped offset 93292997 with size 542525. The class chain is resolved through native package `superIndex` references and checked against decompiled declarations:

```text
LineageMonster.field_stalker_20_bi
  -> LineageWarrior.LineagePawn
  -> Engine.Pawn
  -> Engine.Actor
  -> Core.Object
```

The subclass authors scale 1.2, radius 18 and height 36. `Engine.Actor` provides inherited DrawScale3D `(1,1,1)`. **`LineageMonster.field_stalker` is a different class and is not this NPC's ancestor.** Its radius 16 and unit scale are not this NPC's defaults.

## Product and cache contract

The main product is `artifacts/native-parity/migration/npc-profiles/native-npc-profiles/manifest.json`, with kind `native-npc-profiles`, schema version 1 and support `source-profile-fields-ready`. Its profile contains:

```json
{
  "id": "npc:21622",
  "npcId": 21622,
  "name": "Greater Musveren",
  "mesh": "LineageMonsters.field_stalker_m00",
  "actorClass": "LineageMonster.field_stalker_20_bi",
  "drawScale": 1.2,
  "drawScale3D": [1, 1, 1],
  "collisionRadius": 18,
  "collisionHeight": 36,
  "sourceUnitsPerMetre": 100
}
```

This excerpt omits the profile's `unsupportedFields` metadata. **`prePivot` is absent and explicitly unverified.** No authored or inherited value exists, and the adapter does not establish the native constructor's zero-initialization. It does not synthesize a zero pivot or an extra skeletal offset. Required scale and collision values and partial or malformed vectors cannot use prototype defaults.

`source/npc-selections.json` keeps the table and schema provenance, selected rows and fields, exact mesh export and class chain. Each class has a JSON definition, original UClass bytes and decompiled `.uc`. Seven source-file hashes bind the two DATs, the mesh package and four class packages. The receipt also pins the parser and helper implementation, UELib, PowerShell, Python and external format definitions.

Unchanged sources and tools reuse the validated bundle. Changed inputs invalidate the cache. Modified or corrupt products are rejected, not silently overwritten. Clean builds compare every declared product, manifest and receipt. `.work` diagnostics are not reproducible product data.

## Runtime consumption

Runtime staging copies the manifest, receipt and all declared source sidecars to `/l2/npc-profiles/<manifest SHA-256>/`. It then adds an `npcProfiles` record to the same `/l2/catalog.json` snapshot that identifies the model archives. The client validates the profile manifest's path, byte count and SHA-256 before accepting it. It rejects duplicate identities and checks that `npc:21622` names the loaded Musveren model exactly.

The actor's scale is applied to an outer parent around the **entire converted hierarchy**, including the native MeshOrigin, rotation and scale parent. This keeps the native mesh offset, bind structure, proportions and animated vertical motion. The axis conversion maps DrawScale3D `(X,Y,Z)` to Babylon `(X,Z,Y)` before multiplying by DrawScale. Collision half-height stays `36 / 100 = 0.36 m`. It is not multiplied by 1.2 or inferred from the idle silhouette. CollisionRadius is kept as source data, not as native collision simulation.

Missing, invalid or mismatched profile or model data keeps the animated fallback and reports the load failure. Async loading, cancellation and disposal go through the existing character and runtime boundaries. `recipes/native-musveren.json` does not infer NPC identity or actor scale from the mesh export; this exact-ID adapter supplies them.

## Placement and support

### Native viewer evidence

The verified native video shows Greater Musveren, `LineageMonsters.field_stalker_m00`, and viewer fields CollH 36, CollR 18 and Scale 1.2 in the same view. The NPC hovers in idle and has a visible corpse.

Read-only disassembly uses binaries matched to IMPORTA-PC source hashes:

- Engine.dll: `4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`.
- The authoritative NWindow.dll and its full hash are recorded in `artifacts/native-parity/research/musveren-death/viewer-placement/`. The E: copy does not match IMPORTA-PC and is not used for these claims.

NpcViewer selection (`0x10191910` onward) sweeps with extent `(CollisionRadius, CollisionRadius, CollisionHeight)` and moves the actor to the hit location. The control callback (`0x10192a90`) writes height and DrawScale independently, then repeats support placement. Engine `SetCollisionSize` (`0x1052d650`) and `SetDrawScale` (`0x1052d780`) show that visual scale does not multiply collision height.

The selection path also has a bounded hit-time-dependent Z adjustment. The browser's point-based terrain support does not reproduce its sweep result or contact margin. The 0.36 m offset is the nominal source datum. The client does not implement native collision.

### Browser rule

`NativeCharacterProfile.collisionHalfHeight` carries the optional fixed datum. `actorScale` applies through a separate parent around all native model nodes. The Musveren profile sets both. Profiles without verified native support keep the idle-based preview policy. Invalid heights keep the usable fallback. The client rejects a supplied nonzero actor pivot because applying it is not implemented.

`EntityRegistry` receives terrain support points through the existing presentation boundary. The support position plus 0.36 m is a bounded presentation rule. `GameWorldAdapter` ownership is unchanged. The rule does not reproduce native slope and contact tolerances or runtime resource overrides.

### Death-pose residual

All nine clips, 10,769 translation and rotation keys and every timestamp match the staged native decode. `deathwait` gives the same final pose as the death clip. Replacing or rebaking a clip does not fix placement.

At source scale **1.2**, the final death pose (3.033333 seconds) has **660 of 1,591 vertices below the sampled terrain**. The corpse spans **-0.119400140 to +0.143178566 m** relative to terrain. No fitted offset or per-frame floor adjustment is applied.

`probe-npc-profile.mjs` runs the production character factory, profile parser, playback and skin adapter in NullEngine, skipping only material loading. It uses the frozen browser profile, the supported world position and the actual terrain. Idle bounds match within 1e-7 m. Final-pose rotations match exactly, maximum error 0. Both primitives stay enabled. This validates the browser measurement, not the native support location.

Reproduce from the project root:

```powershell
node artifacts/native-parity/research/musveren-death/probe-npc-profile.mjs
```

The follow-up in `artifacts/native-parity/research/musveren-death/viewer-placement/scale-residual-notes.md` finds at most 0.0215 m from the viewer's initial Hit.Time adjustment and 0.005 m from the descending terrain trace's contact backoff. Their sum is **not a bound on total native placement**. `FarMoveActor` can call `FindSpot` and commit a different location.

### Evidence

Under `artifacts/native-parity/research/musveren-death/`:

- `probe-npc-profile.json` uses `browser/npc-profiles-20261105/native-desktop.json` and records the scale 1.2 residual.
- `probe.json` is the frozen baseline.
- `probe-after-profile-support.json` recomputes every skinned vertex at unit scale from the frozen `browser-after-profile-support.json`.
- `viewer-placement/` holds the binary and source audits and the NWindow.dll hash.

The source research, native resource-path evidence and hashes are in `artifacts/native-parity/research/npc-actor-profiles/README.md`.

## Verification

The main migration produces **381 byte-identical products / 100 archives**; see [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md). The isolated profile proof compares all **18 profile products**. NPC-profile evidence is in `artifacts/native-parity/browser/npc-profiles-20261105/migration-receipts/reproducibility.json` and `artifacts/native-parity/migration-npc-profiles-proof.log`.

The pipeline suite passes 302 tests. The profile adapter's 12 tests and staging checks pass. Runtime unit checks cover full nested-transform preservation, profile hash and identity rejection and unchanged collision height. The three production browser functional cases pass, including the NPC 21622 profile and actor scale 1.2 assertions. These checks are not native visual parity. The evidence index is [VERIFICATION.md](VERIFICATION.md).

## Open

- General NPC profiles for all `npcgrp` rows, spawnable by ID (ACT-02).
- Native constructor values, including effective `prePivot` (POL-01).
- Corpse-into-terrain residual at scale 1.2. It shows in the stage A side-by-side screenshot of Greater Musveren (ACT-02, CHECK-01) and blocks the polish threshold (POL-01). The fix must follow placement and transform evidence, not an animation rebake or a fitted +0.1194 m displacement.
- Next evidence for the residual: effective native PrePivot, hit location and actor location after `FarMoveActor`, at the matched death state.
- Actor collision sweep and contact. CollisionRadius is data only, and support is point-based terrain sampling. No requirement covers actor collision placement.
- Material, camera, lighting and timing matching for Musveren (POL-01).
- Server statistics for NPCs (NET-05).
