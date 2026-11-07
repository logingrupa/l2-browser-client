# Native NPC presentation profiles

The native slice now loads Greater Musveren's actor dimensions from a repeatable source profile, separately from its converted model. The exact join is **NPC 21622 → Greater Musveren → `LineageMonster.field_stalker_20_bi` → `LineageMonsters.field_stalker_m00`**. The actor class supplies DrawScale **1.2**, CollisionRadius **18** and CollisionHeight **36** in native units. This selects one supported reference NPC; it does not claim complete NPC coverage, gameplay correctness or native visual parity.

## Rebuild and stage

From `C:/laragon/www/l2-browser-client`:

```powershell
pnpm assets:migrate --prove-rebuild --stage-runtime
```

The main recipe includes job `native-npc-profiles`, adapter `npc-profiles`, and request `recipes/native-npc-profiles.json`. Its source manifest pins IMPORTA-PC inputs staged under `artifacts/native-parity/inputs/IMPORTA-PC/`. The complete lock now contains **143 files / 2,511,063,181 bytes**, including the later Power Strike binary evidence. At the NPC-profile checkpoint it held 142 files / 2,480,358,713 bytes, including `system/LineageWarrior.int` and the newly added 51,248-byte `system/npcname-e.dat`; the preceding 141-file snapshot already included the localization file.

The profile can also be regenerated or checked independently:

```powershell
python scripts/native_actor_profiles.py --client artifacts/native-parity/inputs/IMPORTA-PC --recipe recipes/native-npc-profiles.json --output artifacts/native-parity/npc-profiles-inspection
python scripts/native_actor_profiles.py --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-parity/npc-profiles-inspection --verify
```

All outputs stay outside the native client. Native packages, protected configuration, source textures, animation keys and converted model payloads are unchanged by this adapter. Authored Editor resources are not regeneration targets.

## Source selection and inheritance

`npcname-e.dat` and `npcgrp.dat` each contain 6,519 unique NPC IDs. The recipe requires an exact ID and expected name, qualified mesh and qualified actor class. Duplicate IDs, missing rows, mismatched expectations and unresolved required defaults fail extraction. The fact that 22 NPC rows share this mesh is not used to choose a name, class or scale.

The table decoder uses the pinned Interlude descriptor: `npcname` selects the `ScionsOfDestiny` layout and `npcgrp` selects `Interlude`. It consumes the complete bounded table and exact SafePackage trailer. Name colors remain four source-order bytes expressed as uppercase hexadecimal. The selected row records include raw bytes and every primitive field's decoded offsets, sizes and typed values.

| Selection | Zero-based row | Decoded byte range |
| --- | ---: | --- |
| `npcname-e.dat`, ID 21622 | 1431 | `[36805,36832)` |
| `npcgrp.dat`, ID 21622 | 1431 | `[1192444,1193316)` |

The mesh independently resolves to `Engine.SkeletalMesh` export 6580 in `animations/LineageMonsters.ukx`, at unwrapped offset 93292997 with size 542525. The actual class chain is resolved through native package `superIndex` references and checked against decompiled declarations:

```text
LineageMonster.field_stalker_20_bi
  -> LineageWarrior.LineagePawn
  -> Engine.Pawn
  -> Engine.Actor
  -> Core.Object
```

The subclass authors scale 1.2, radius 18 and height 36. `Engine.Actor` provides inherited DrawScale3D `(1,1,1)`. **`LineageMonster.field_stalker` is a different class and is not this NPC's ancestor.** Its earlier radius 16 and inherited scale 1 explain the prior audit's mismatch; they do not override the exact Greater Musveren class or prove that the native viewer was manually changed.

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

This excerpt omits the actual profile's `unsupportedFields` metadata: **`prePivot` is absent and explicitly unverified**. No authored/inherited value was recovered, and this adapter does not establish the native constructor's zero-initialization behavior. It does not synthesize a zero pivot or an additional skeletal offset. Required scale/collision values and partial/malformed vectors cannot use prototype defaults.

`source/npc-selections.json` preserves the table/schema provenance, selected rows and fields, exact mesh export and class chain. Each class has a JSON definition, original UClass bytes and decompiled `.uc`. Seven source-file hashes bind the two DATs, mesh package and four class packages. The receipt also pins the parser/helper implementation, UELib, PowerShell, Python and external format definitions.

Unchanged sources and tools reuse the validated bundle. Changed inputs invalidate the cache. Modified or corrupt products are rejected instead of silently overwriting edits. Clean builds compare every declared product, manifest and receipt; `.work` diagnostics are not reproducible product data.

## Browser and Editor consumption

Runtime staging copies the manifest, receipt and all declared source sidecars to `/l2/npc-profiles/<manifest SHA-256>/`, then adds an `npcProfiles` record to the same `/l2/catalog.json` snapshot that identifies the model archives. The client validates the profile manifest's path, byte count and SHA-256 before accepting it, rejects duplicate identities and checks that `npc:21622` names the loaded Musveren model exactly.

The actor's scale is applied to an outer parent around the **entire converted hierarchy**, including its existing native MeshOrigin/rotation/scale parent. This preserves the native mesh offset, bind structure, original proportions and animated vertical motion. The native axis conversion maps DrawScale3D `(X,Y,Z)` to Babylon `(X,Z,Y)` before multiplying by DrawScale. Collision half-height remains independently `36 / 100 = 0.36 m`; it is not multiplied by 1.2 or inferred from the idle silhouette. CollisionRadius is retained as source data, not proof of native collision simulation.

The native source uses a collision sweep to place the actor. The local client's terrain-support position plus 0.36 m remains a bounded presentation rule, with `GameWorldAdapter` ownership preserved. It does not reproduce all native slope/contact tolerances or runtime resource overrides. The current slice rejects a supplied nonzero actor pivot because applying that transform is not implemented. A missing pivot remains an explicit source gap rather than a parity claim.

Missing, invalid or mismatched profile/model data retains the animated fallback and reports the load failure. Async loading, cancellation and disposal continue through the existing character/runtime boundaries. Browser and Editor Play use the same catalog and runtime; Editor-relative URL handling is documented in [EDITOR_ROUNDTRIP.md](EDITOR_ROUNDTRIP.md). Model export limitations in `recipes/native-musveren.json` remain correct: NPC identity and actor scale are not inferred from the mesh export; this separate exact-ID adapter supplies them.

## Verification and remaining work

The NPC-profile checkpoint produced **315 byte-identical products**, **26/26 replay cache hits**, zero clean cache hits and **95 archives**. The empty clean destination was `artifacts/native-parity/migration-clean-4z5m6k_n/`. Frozen evidence is `artifacts/native-parity/browser/npc-profiles-20261105/migration-receipts/reproducibility.json` and `artifacts/native-parity/migration-npc-profiles-proof.log`. The isolated profile proof independently compared all **18 profile products**. The later Power Strike checkpoint expands the main migration to **381 products / 100 archives**; see [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md).

The NPC-profile pipeline runner reported **291 tests passing, zero skips**, in 47.643 seconds. Evidence: `artifacts/native-parity/research/material-policy-current/pipeline-tests.log` and `receipt.json`. The earlier 288-test run skipped the optional flame graph fixture because its converter pin was stale. That check now selects the exact active production archive through validated IDs and hashes; all six focused checks pass. Its 238 nonmanifest payloads, including the GLB, match the historical archive exactly. This fixes validation coverage without changing conversion or runtime rendering. The later full suite passes 302 tests; [VERIFICATION.md](VERIFICATION.md) records separate invocations.

The profile adapter's 12 tests and staging checks pass. Runtime unit checks include full nested-transform preservation, profile hash/identity rejection and unchanged collision height. The three production browser functional cases pass, including the exact NPC 21622 profile and actor scale 1.2 assertions. These checks are distinct from native visual parity. Current screenshots and Editor evidence are tracked in [VERIFICATION.md](VERIFICATION.md) and [NATIVE_ACTOR_PLACEMENT.md](NATIVE_ACTOR_PLACEMENT.md).

The production death-pose probe at actor scale 1.2 still finds **660 of 1,591 vertices below the sampled terrain**, with maximum depth **0.119400140 m** and maximum height above terrain **0.143178566 m**. No fitted offset was added to hide this residual. Exact native/browser deformation, materials and contact placement remain visual-validation work. General NPC profiles, native constructor values, server statistics, full skill dispatch and networking are not completed by this change. The source research, native resource-path evidence and hashes are retained in `artifacts/native-parity/research/npc-actor-profiles/README.md`.
