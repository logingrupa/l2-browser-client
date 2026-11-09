# Coverage

Store root `public/l2`, catalog SHA-256 `55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe`, generated at 2026-11-09T06:27:22+02:00 (Riga) by `pnpm report:coverage`. Converted keys and load checks also come from the census lane stores `artifacts/lane-store/actors/l2`, `artifacts/lane-store/data-ui/l2`, `artifacts/lane-store/world/l2`.

| Part | Denominator | Converted | Loads pass | Loads failed | Loads unverified | Gap | Pending | Denominator source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| data | 40 | 36 | 0 | 0 | 36 | 4 | 0 | docs/parts/data/dat-table-inventory.json rows (descriptorSha256 5df8b7af1b510daa26008fa4fe91e100253f40161f1f1f9560e3569d539cdef6) |
| sandbox | unknown | 0 | 0 | 0 | 0 | 0 | unknown | no committed denominator yet |
| world | 163 | 1 | 0 | 0 | 1 | 124 | 38 | recipes/reference-client-tree.lock.json maps/XX_YY.unr (153 tiles) and docs/parts/world/tile-census.json non-tile rows (10 maps) |
| player-characters | 15 | 0 | 0 | 0 | 0 | 4 | 11 | docs/parts/npcs/actor-unit-census.json chargrp rowCount (system/chargrp.dat) |
| ui | 248 | 248 | 0 | 0 | 248 | 0 | 0 | docs/parts/ui/interface-window-census.json rootWindowCount and windows[].windowId |
| npcs | 6519 | 2 | 1 | 0 | 1 | 5370 | 1147 | docs/parts/npcs/actor-unit-census.json npcgrp rowCount (system/npcgrp.dat) |
| items | 9238 | 1 | 0 | 0 | 1 | 7906 | 1331 | docs/parts/data/dat-table-inventory.json itemname-e recordCount (countSource: scripts/data/convert_tables.py decode_table on lock-equal E:/Lineage2-client/system/itemname-e.dat) |
| skills-effects | 29812 | 1 | 0 | 0 | 1 | 17575 | 12236 | docs/parts/data/dat-table-inventory.json skillgrp recordCount (countSource: scripts/data/convert_tables.py decode_table on lock-equal E:/Lineage2-client/system/skillgrp.dat) |
| audio | unknown | 0 | 0 | 0 | 0 | 0 | unknown | no committed denominator yet |
| minimap | unknown | 0 | 0 | 0 | 0 | 0 | unknown | no committed denominator yet |
| movement-geodata | unknown | 0 | 0 | 0 | 0 | 0 | unknown | no committed denominator yet |

Every denominator key has exactly one census status: converted when a catalog lists it, else the failed, gap or pending row of its latest step. Gap counts rows with status gap or failed. Loads counts only recorded load checks; everything else is unverified.

Lobby (`map:Lobby`) has the census status gap `map-licensee-unsupported:123/30`.
