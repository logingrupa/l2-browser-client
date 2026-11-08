# Coverage

Store root `public/l2`, catalog SHA-256 `55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe`, generated at 2026-11-08T22:33:38+02:00 (Riga) by `pnpm report:coverage`.

| Part | Denominator | Converted | Loads pass | Loads failed | Loads unverified | Gap | Pending | Denominator source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| data | 40 | 0 | 0 | 0 | 0 | 40 | 0 | docs/parts/data/dat-table-inventory.json rows (descriptorSha256 5df8b7af1b510daa26008fa4fe91e100253f40161f1f1f9560e3569d539cdef6) |
| sandbox | unknown | 0 | 0 | 0 | 0 | 0 | unknown | no committed denominator yet |
| world | 163 | 1 | 0 | 0 | 1 | 162 | 0 | recipes/reference-client-tree.lock.json maps/*.unr (153 tiles maps/XX_YY.unr, 10 non-tile maps) |
| player-characters | 15 | 0 | 0 | 0 | 0 | 4 | 11 | docs/parts/data/dat-table-inventory.json chargrp recordCount (countSource: scripts/native_catalog/tables.py decode_table on lock-equal E:/Lineage2-client/system/chargrp.dat) |
| ui | unknown | 0 | 0 | 0 | 0 | 0 | unknown | no committed window census yet (UI-01, plan 02-19) |
| npcs | 6519 | 1 | 0 | 0 | 1 | 5371 | 1148 | docs/parts/data/dat-table-inventory.json npcgrp recordCount (countSource: scripts/native_catalog/tables.py decode_table on lock-equal E:/Lineage2-client/system/npcgrp.dat) |
| items | 9238 | 1 | 0 | 0 | 1 | 996 | 8242 | docs/parts/data/dat-table-inventory.json itemname-e recordCount (countSource: docs/PORT_SCOPE.md section 2 (Elbera extract_gamedata.py)) |
| skills-effects | 29812 | 1 | 0 | 0 | 1 | 17576 | 12236 | docs/parts/data/dat-table-inventory.json skillgrp recordCount (countSource: scripts/native_catalog/tables.py decode_table on lock-equal E:/Lineage2-client/system/skillgrp.dat) |
| audio | unknown | 0 | 0 | 0 | 0 | 0 | unknown | no committed denominator yet |
| minimap | unknown | 0 | 0 | 0 | 0 | 0 | unknown | no committed denominator yet |
| movement-geodata | unknown | 0 | 0 | 0 | 0 | 0 | unknown | no committed denominator yet |

Loads counts only recorded load checks; everything else is unverified. Gap counts rows with status gap or failed. Pending counts pending rows plus the keys of a counted denominator that no row lists yet.
