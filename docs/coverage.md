# Coverage

Store root `artifacts/lane-store/integration/l2`, catalog SHA-256 `e25d005ea7d2a3fe6275c4fe02bb8719f190cbeaaaca831ad341a10126012baf`, generated at 2026-11-14T06:18:28+02:00 (Riga) by `pnpm report:coverage`. Converted keys and load checks also come from the census lane stores `artifacts/lane-store/actors/l2`, `artifacts/lane-store/data-ui/l2`, `artifacts/lane-store/integration/l2`, `artifacts/lane-store/world/l2`.

| Part | Denominator | Converted | Loads pass | Loads failed | Loads unverified | Gap | Pending | Denominator source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| data | 40 | 40 | 24 | 0 | 16 | 0 | 0 | docs/parts/data/dat-table-inventory.json rows (descriptorSha256 5df8b7af1b510daa26008fa4fe91e100253f40161f1f1f9560e3569d539cdef6) |
| sandbox | unknown | 0 | 0 | 0 | 0 | 0 | unknown | the sandbox is the checking tool and has no key space (Phase 3 P15) |
| world | 163 | 0 | 25 | 0 | 118 | 163 | 0 | recipes/reference-client-tree.lock.json maps/XX_YY.unr (153 tiles) and docs/parts/world/tile-census.json non-tile rows (10 maps) |
| player-characters | 15 | 0 | 0 | 0 | 0 | 15 | 0 | docs/parts/npcs/actor-unit-census.json chargrp rowCount (system/chargrp.dat) |
| ui | 248 | 46 | 248 | 0 | 0 | 202 | 0 | docs/parts/ui/interface-window-census.json rootWindowCount and windows[].windowId |
| npcs | 6519 | 5177 | 25 | 0 | 5152 | 1341 | 1 | docs/parts/npcs/actor-unit-census.json npcgrp rowCount (system/npcgrp.dat) |
| items | 9238 | 0 | 25 | 0 | 1560 | 9238 | 0 | docs/parts/data/dat-table-inventory.json itemname-e recordCount (countSource: scripts/data/convert_tables.py decode_table on lock-equal E:/Lineage2-client/system/itemname-e.dat) |
| skills-effects | 29812 | 591 | 25 | 0 | 10624 | 29221 | 0 | docs/parts/data/dat-table-inventory.json skillgrp recordCount (countSource: scripts/data/convert_tables.py decode_table on lock-equal E:/Lineage2-client/system/skillgrp.dat) |
| audio | 8046 | 5311 | 0 | 0 | 5318 | 1329 | 1406 | recipes/reference-client-tree.lock.json maps/XX_YY.unr (153 tiles as tile-audio:XX_YY keys); data-ui lane decoded system/npcgrp.dat (sha256 8ac7ce502769e25e503047e3a477da54703fc4e7f92aeb4c8c621e2729688d57) rows naming a sound in an npcgrp sound column (6495 npc-sounds:<id> keys); docs/parts/npcs/actor-unit-census.json skill-sound-row units (1398 keys) |
| minimap | 153 | 0 | 0 | 0 | 0 | 146 | 7 | recipes/reference-client-tree.lock.json maps/XX_YY.unr (153 tiles as minimap:XX_YY keys) |
| movement-geodata | 153 | 58 | 0 | 0 | 143 | 88 | 7 | recipes/reference-client-tree.lock.json maps/XX_YY.unr (153 tiles as tile-collision:XX_YY keys) |

Every denominator key has exactly one census status: the failed or gap row of its latest step when it has one, else converted when a catalog lists it, else the pending row of its latest step. Converted counts pass rows and gap counts rows with status gap or failed, including catalog-listed keys with a failed or gap step, so converted, gap and pending add up to the denominator. Loads counts only recorded load checks; everything else is unverified.

Converted keys that carry a named emitter gap (`emitter-class-unported:<class>` or `emitter-feature-unported:<property>`), counted per part and reason:

- skills-effects: `emitter-class-unported:Engine.BeamEmitter` 1235, `emitter-class-unported:Engine.VertMeshEmitter` 410, `emitter-feature-unported:BlendBetweenSubdivisions` 1945, `emitter-feature-unported:UseDirectionAs` 6468

Lobby (`map:Lobby`) has the census status gap `object-gaps:2`.
