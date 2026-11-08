# Native NPC profiles

The profile adapter reads an NPC's name, mesh, class, DrawScale and collision from native tables and class defaults by exact ID. It covers Greater Musveren only; stage A extends it to every `npcgrp` row (ACT-02). Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- NPC 21622 -> Greater Musveren -> `LineageMonster.field_stalker_20_bi` -> `LineageMonsters.field_stalker_m00`: DrawScale 1.2, CollisionRadius 18, CollisionHeight 36 source units.
- `LineageMonster.field_stalker` is not an ancestor; its radius 16 does not apply. 22 rows share the mesh, so a mesh never selects a profile.
- [native-npc-profiles.json](../recipes/native-npc-profiles.json) requires exact ID, name, mesh and class; duplicates and unresolved defaults fail.
- Build: job `native-npc-profiles` of `pnpm assets:migrate --prove-rebuild`, integration thread only; `--stage-runtime` rewrites the whole catalog ([NATIVE_MIGRATION.md](NATIVE_MIGRATION.md)). Alone: `python scripts/native_actor_profiles.py --client artifacts/native-parity/inputs/IMPORTA-PC --recipe recipes/native-npc-profiles.json --output <dir>`, `--verify` checks.
- Runtime reads `npcProfiles` from `/l2/catalog.json` and checks path, bytes and SHA-256. The native slice will not start unless `npc:21622` names the loaded Musveren mesh, and rejects a nonzero pivot.
- DrawScale3D `(X,Y,Z)` maps to Babylon `(X,Z,Y)` times DrawScale on a parent of the whole model. Collision half-height stays 0.36 m, unscaled. CollisionRadius is data only.
- `prePivot` is absent and unverified; no zero pivot is synthesized.

## Open

- Profiles for all 6,519 `npcgrp` rows, spawnable by ID (ACT-02).
- Death pose at scale 1.2: 660 of 1,591 vertices end below terrain, up to 0.1194 m (`artifacts/native-parity/research/musveren-death/`). Clips match the native decode; fix placement from evidence (PrePivot, location after `FarMoveActor`), never by rebake or offset (ACT-02, CHECK-01, POL-01).
- Native constructor values, material, camera, lighting and timing (POL-01).
- Actor collision sweep and contact (MOVE-01).
- Server NPC statistics (NET-05).

## Pointers

- Code: `src/assets/native/loadNativeNpcProfiles.ts`, `src/runtime/createNativeSliceRuntime.ts`.
- Tests: `tests/unit/nativeNpcProfiles.test.ts`, `tests/pipeline/test_native_presentations.py`.
- Evidence `artifacts/native-parity/research/npc-actor-profiles/README.md`. Related: [NPC evidence](parts/npcs/EVIDENCE.md).
