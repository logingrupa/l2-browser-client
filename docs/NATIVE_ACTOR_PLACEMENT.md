# Native actor placement — 2026-11-05

The Greater Musveren profile now resolves exact **NPC 21622** from native names,
presentation tables and class defaults. `LineageMonster.field_stalker_20_bi`
supplies **DrawScale 1.2**, **CollisionRadius 18**, **CollisionHeight 36**;
inherited DrawScale3D is `(1,1,1)`. Scale wraps the entire preserved mesh
transform. The fixed nominal support offset is independently **0.36 m**.
This replaces idle-vertex placement and unbound unit scale without changing
converted geometry, skeletons, weights or keys. The remaining corpse/terrain
intersection does not pass native visual acceptance.

## Evidence and scope

The verified native video identifies Greater Musveren,
`LineageMonsters.field_stalker_m00`, and viewer fields CollH 36, CollR 18,
Scale 1.2 in the same view. It hovers in idle and has a visible corpse. Exact
NPC name/group rows now select `field_stalker_20_bi`, directly extending
`LineageWarrior.LineagePawn`. Previously inspected `field_stalker` is a different
class, not its ancestor; its radius 16/unit scale are not this NPC's defaults.
Mesh identity is shared by 22 npcgrp rows; selection is by ID 21622, not mesh.
[NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md) records the reusable extraction,
source hashes and preserved evidence.

Read-only disassembly uses binaries matched to IMPORTA-PC's source hashes:

- Engine.dll: `4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`.
- The authoritative NWindow.dll and its full hash are recorded in
  `artifacts/native-parity/research/musveren-death/viewer-placement/`; the
  unmatched local E: copy was not used for these claims.

NpcViewer selection (`0x10191910` onward) sweeps with extent
`(CollisionRadius, CollisionRadius, CollisionHeight)` and moves the actor to
the resulting hit location. The control callback (`0x10192a90`) writes height
and DrawScale independently before repeating support placement. Engine
`SetCollisionSize` (`0x1052d650`) and `SetDrawScale` (`0x1052d780`) corroborate
that changing visual scale does not multiply the collision height.

The selection path also contains a bounded hit-time-dependent Z adjustment.
Its exact sweep result and contact margin are not reproduced by the browser's
point-based terrain support. The 0.36 m offset is the nominal source datum;
this change does not implement native collision.

## Preserved data and remaining differences

The exact runtime probe initially found all **1,591 vertices** below the staged
terrain at the final death key, 3.033333 seconds. Both primitives were still
enabled. Source auditing found all nine clips, 10,769 translation/rotation keys
and every timestamp unchanged from the staged native decode. `deathwait`
produces the same final pose; replacing the clip would not fix placement.

The earlier support correction at **unit scale** put the corpse between
**-0.039502 and +0.179313 m**, with **76/1,591** vertices below terrain. That
measurement is historical. At source scale **1.2**, the actual corpse spans
**-0.119400140 to +0.143178566 m** relative to terrain, with **660/1,591** vertices
below it. No fitted offset or per-frame floor adjustment is applied.

`probe-npc-profile.mjs` executes the exact production character factory, profile
parser, playback and skin adapter in NullEngine, skipping only material loading.
It uses the frozen browser profile, supported world position and actual terrain.
Idle bounds match within 1e-7 m; final-pose rotations match exactly, maximum
error 0. Both primitives remain enabled. This validates the browser measurement,
not the native reference's support location.

PrePivot is not authored/inherited by this class; its constructor/default value
remains explicitly unresolved. Native sweep/contact support and live actor
pivot/location are not reproduced by point-based terrain support. Material,
camera, lighting and timing matching remain required. The smallest next repair
must follow placement/transform evidence, not an animation rebake or a fitted
+0.1194 m displacement.

The bounded [follow-up](../artifacts/native-parity/research/musveren-death/viewer-placement/scale-residual-notes.md)
finds at most 0.0215 m from the viewer's initial Hit.Time adjustment and 0.005 m
from the descending terrain trace's contact backoff. Their sum is **not a bound
on total native placement**: `FarMoveActor` can call `FindSpot` and commit a
different location. Required next evidence is the effective native PrePivot,
hit location and actor location after that move, at the matched death state.

`NativeCharacterProfile.collisionHalfHeight` carries the optional fixed datum;
`actorScale` applies through a separate parent around all native model nodes.
The exact Musveren profile sets both; profiles without verified native support
retain the earlier idle-based preview policy. Invalid heights retain the usable
fallback. `EntityRegistry` still receives terrain support points through the
existing presentation boundary; `GameWorldAdapter` and network plans are unchanged.

Evidence, reproducible offline probes, frozen original browser captures and
binary/source audits are under `artifacts/native-parity/research/musveren-death/`.
The earlier `probe-after-profile-support.json` uses that rebuilt browser's
fixed offset/position from its frozen `browser-after-profile-support.json` and
recomputes every skinned vertex against the staged terrain. It confirms the
unit-scale residual; baseline `probe.json` remains unchanged. Current
`probe-npc-profile.json` uses `browser/npc-profiles-20261105/native-desktop.json`
and records the larger source-scale residual. Reproduce from the project root:
`node artifacts/native-parity/research/musveren-death/probe-npc-profile.mjs`.
[VERIFICATION.md](VERIFICATION.md) records actual browser verification and
screenshots separately from the numerical probe and native parity requirements.
