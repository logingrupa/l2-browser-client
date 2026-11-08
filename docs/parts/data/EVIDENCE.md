# Asset and .dat decoders evidence

Part `data`, lane `data-ui`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: The UE Viewer route works on a pinned input snapshot. 11 of 40 `.dat` tables are decoded to JSON, by Elbera's tools.

Working on 2026-11-08 (plan 02-17, DATA-01 tracer): `scripts/data/convert_tables.py` decodes a descriptor-linked table through one case-insensitive source resolver and writes a hash-pinned `native-table` manifest plus a `tables` catalog record into the data-ui lane store, one sealed ledger unit per table. All 37 linked layouts are pinned in `scripts/native_catalog/table_layout_pins.py`. 13 tables are sealed decodes: armorgrp, chargrp, classinfo-e, etcitemgrp, itemname-e, mobskillanimgrp, npcgrp, npcname-e, skillgrp, skillname-e, skillsoundgrp, systemmsg-e, weapongrp. sysstring-e is a sealed `decode-failed:FormatError` gap row.

## Open

40 `.dat` tables, 25 `.u`, 435 `.utx`, 212 `.usx`, 20 `.ukx` and 163 `.unr` packages. The combined table inventory (FOUND-04) is below. Open for DATA-01: the 23 linked tables not yet decoded (plan 02-27) and the sysstring-e decode failure. Open for DATA-02: the three hair tables. DATA-03 stays open: the strict decode of sysstring-e fails, so its count is unresolved (see below). The lane store is not restaged into the shared store yet.

## Reference client lock

Recorded 2026-11-08 (FOUND-03) in `recipes/reference-client-tree.lock.json`, checked by `tests/pipeline/test_reference_client_lock.py`. The tracked walker `scripts/hash_reference_client_tree.py` hashed IMPORTA-PC `C:/Lineage2-client` (5,629 files, 7,814,256,191 bytes, run over ssh with nothing written remotely) and DATABASE-PC `E:/Lineage2-client` (9,737 files, 7,839,082,362 bytes). `scripts/build_reference_client_lock.py` joined them.

| Class | Paths |
|---|---|
| equal | 5,602 |
| differing | 4 |
| importa-only | 4 |
| e-only | 4,111 |
| volatile-config | 22 |
| unreadable | 0 |

- Differing: `Start-LAN.cmd`, `Start-Tailscale.cmd`, `iwo/135206150202151192151196144_1.dat`, `system/nwindow.dll`.
- IMPORTA-PC only: `READ-ME.txt`, `Start-Client.ps1`, `Start-Debug.cmd`, `system/l2.zip`.
- E: only: the nested `L2FileEdit-master/L2FileEdit-master/` copy (4,108 files with its siblings), `L2FileEdit-master.zip`, `Start-Kingdom.cmd`, `Start-Local.cmd`.
- Volatile config: every `*.ini`, `*.log`, `*.bak` and `*.bak-*` path, for example `system/l2.ini` and `system/l2.ini.bak-20261104-111916`.
- `system/Engine.dll` (spelled `system/engine.dll` on both disks) is equal, SHA-256 `4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`, the same as `recipes/native-inputs.lock.json`. All 40 `system/*.dat` files are equal.
- The guard (`scripts/reference_client_guard.py`) reads a client file only when its lock class is equal, for every root except the lock's exact reference root on its reference host. It accepts `system/Engine.dll` and refuses `system/l2.ini` on the real tree.

## Dat table inventory

Generated 2026-11-08 (FOUND-04) by `scripts/build_dat_table_inventory.py --client E:/Lineage2-client` into `docs/parts/data/dat-table-inventory.json`, checked by `tests/pipeline/test_dat_table_inventory.py`. Table names come from the lock's `system/*.dat` entries. Layouts come from the pinned descriptor `06_interlude.xml` (SHA-256 `5df8b7af...cdef6`). Local counts come only from sealed `scripts/data/convert_tables.py` records in `artifacts/lane-store/data-ui/l2/catalog.json` whose `sourceSha256` equals the lock eSha256 of a checked lock-equal E: file. A decode-failed gap row puts its reason in the status. Counts marked Elbera are copied from PORT_SCOPE section 2. Every other count is unknown.

Tally: 13 local-decoded, 24 local-layout-only, 3 elbera, 0 none. The nine local decodes that Elbera also counted (armorgrp, etcitemgrp, itemname-e, npcgrp, npcname-e, skillgrp, skillname-e, systemmsg-e, weapongrp) match Elbera's counts.

| Table | Route | Layout | Records | Status |
|---|---|---|---|---|
| actionname-e | local-layout-only | actionname | 102 (Elbera) | layout pinned, not decoded |
| armorgrp | local-decoded | armorgrp | 1,014 | decoded, matches Elbera evidence |
| castlename-e | local-layout-only | castlename | unknown | layout pinned, not decoded |
| chargrp | local-decoded | chargrp | 15 | decoded |
| classinfo-e | local-decoded | classinfo | 10 | decoded |
| clientdata | local-layout-only | clientdata | unknown | layout pinned, not decoded |
| commandname-e | local-layout-only | commandname | unknown | layout pinned, not decoded |
| creditgrp-e | local-layout-only | credit | unknown | layout pinned, not decoded |
| entereventgrp | local-layout-only | entereventgrp | unknown | layout pinned, not decoded |
| etcitemgrp | local-decoded | etcitemgrp | 6,911 | decoded, matches Elbera evidence |
| eula-e | local-layout-only | eula | unknown | layout pinned, not decoded |
| gametip-e | local-layout-only | gametip | unknown | layout pinned, not decoded |
| hairaccessarygrp | elbera | - | unknown | Elbera parser present, unverified |
| hairaccessorylocgrp | local-layout-only | hairaccessorylocgrp | unknown | layout pinned, not decoded |
| hairgrp | elbera | - | unknown | Elbera parser present, unverified |
| helmetgrp | elbera | - | unknown | Elbera parser present, unverified |
| hennagrp-e | local-layout-only | hennagrp | unknown | layout pinned, not decoded |
| huntingzone-e | local-layout-only | huntingzone | unknown | layout pinned, not decoded |
| itemname-e | local-decoded | itemname | 9,238 | decoded, matches Elbera evidence |
| logongrp | local-layout-only | logongrp | unknown | layout pinned, not decoded |
| mobskillanimgrp | local-decoded | mobskillanimgrp | 5,463 | decoded |
| musicinfo | local-layout-only | musicinfo | unknown | layout pinned, not decoded |
| npcgrp | local-decoded | npcgrp | 6,519 | decoded, matches Elbera evidence |
| npcname-e | local-decoded | npcname | 6,519 | decoded, matches Elbera evidence |
| obscene-e | local-layout-only | obscene | unknown | layout pinned, not decoded |
| optiondata_client-e | local-layout-only | optiondata_client | unknown | layout pinned, not decoded |
| questname-e | local-layout-only | questname | unknown | layout pinned, not decoded |
| raiddata-e | local-layout-only | raiddata | unknown | layout pinned, not decoded |
| recipe-c | local-layout-only | recipe-c | unknown | layout pinned, not decoded |
| servername-e | local-layout-only | servername | unknown | layout pinned, not decoded |
| skillgrp | local-decoded | skillgrp | 29,812 | decoded, matches Elbera evidence |
| skillname-e | local-decoded | skillname | 29,812 | decoded, matches Elbera evidence |
| skillsoundgrp | local-decoded | skillsoundgrp | 1,398 | decoded |
| staticobject-e | local-layout-only | staticobject | unknown | layout pinned, not decoded |
| symbolname-e | local-layout-only | symbolname | unknown | layout pinned, not decoded |
| sysstring-e | local-layout-only | sysstring | 2,083 (Elbera) | decode-failed:FormatError |
| systemmsg-e | local-decoded | systemmsg | 2,083 | decoded, matches Elbera evidence |
| variationeffectgrp-e | local-layout-only | variationeffectgrp | unknown | layout pinned, not decoded |
| weapongrp | local-decoded | weapongrp | 1,313 | decoded, matches Elbera evidence |
| zonename-e | local-layout-only | zonename | unknown | layout pinned, not decoded |

## Sysstring and systemmsg count (DATA-03)

Written 2026-11-08 by `scripts/data/sysstring_systemmsg_counts.py --client E:/Lineage2-client` into `docs/parts/data/sysstring-systemmsg-counts.json`, checked by `tests/pipeline/test_sysstring_systemmsg_counts.py`. Both tables go through the same `decode_table` and lock guard as every other table.

- systemmsg-e: header count 2,083, strict decode 2,083 records, exact end (233,702 consumed bytes plus the 13-byte SafePackage trailer equal 233,715 decoded bytes). Identifier field `id`: 2,083 distinct values from 0 to 2,153, no duplicates, 71 missing in that range.
- sysstring-e: header count 2,083. The strict decode fails with `FormatError: Unterminated Unreal string`, so it has no decoded count, exact end or id set. The table is a `decode-failed:FormatError` gap row in the lane store.
- Id-set comparison: not computed, because sysstring-e has no strict decode.
- Verdict: `count-unresolved`. The 2,083 Elbera evidence count of systemmsg-e is confirmed by strict decode. For sysstring-e only the header count is known.

## Evidence

Decoder code: `scripts/native_catalog/`. Input pin: `recipes/native-inputs.lock.json`. Reference tree lock: `recipes/reference-client-tree.lock.json`. Inventory: `docs/parts/data/dat-table-inventory.json`. DATA-03 report: `docs/parts/data/sysstring-systemmsg-counts.json`. Lane store (ignored): `artifacts/lane-store/data-ui/l2/` with `tables/<manifestSha256>/<table>.json`, receipts under `artifacts/lane-store/data-ui/work/table__<table>/decode/` and gap rows in `artifacts/lane-store/data-ui/gap-rows/decode.json`.
