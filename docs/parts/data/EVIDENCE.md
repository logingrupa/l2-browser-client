# Asset and .dat decoders evidence

Part `data`, lane `data-ui`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: The UE Viewer route works on a pinned input snapshot. 11 of 40 `.dat` tables are decoded to JSON, by Elbera's tools.

Working on 2026-11-08 (plan 02-17, DATA-01 tracer): `scripts/data/convert_tables.py` decodes a descriptor-linked table through one case-insensitive source resolver and writes a hash-pinned `native-table` manifest plus a `tables` catalog record into the data-ui lane store, one sealed ledger unit per table. All 37 linked layouts are pinned in `scripts/native_catalog/table_layout_pins.py`. 13 tables are sealed decodes: armorgrp, chargrp, classinfo-e, etcitemgrp, itemname-e, mobskillanimgrp, npcgrp, npcname-e, skillgrp, skillname-e, skillsoundgrp, systemmsg-e, weapongrp. sysstring-e is a sealed `decode-failed:FormatError` gap row.

Working on 2026-11-09 (plan 02-27, DATA-01 breadth): `convert_tables.py --batch tables --limit 40` sealed every one of the 37 descriptor-linked tables on lock-equal `E:/Lineage2-client`. 33 are decodes with a `tables` record; a second batch run skipped all 37 units and left `catalog.json` byte-identical. The four decode failures are sealed gap rows with the error in `work/table__<table>/decode/decode-error.json`:

| Table | Reason | Decode error |
|---|---|---|
| eula-e | decode-failed:FormatError | `Unexpected safe-package trailer: eula: ` (the pinned layout reads past the payload, nothing is left for the trailer) |
| questname-e | decode-failed:FormatError | `native table questname-e holds a value JSON cannot carry: Out of range float values are not JSON compliant: nan` (a FLOAT field decodes to NaN) |
| servername-e | decode-failed:FormatError | `Unexpected safe-package trailer: servername: 7f00...` (730 unread bytes sit before the 13-byte SafePackage trailer after the header count of rows is read) |
| sysstring-e | decode-failed:FormatError | `Unterminated Unreal string` (02-17) |

Name indexes for the sandbox pickers (`scripts/data/table_name_indexes.py`, checked by `tests/pipeline/test_table_name_indexes.py`): one `native-table-name-index` v1 manifest per table, built only from the sealed source manifest after its bytes match the catalog `manifestSha256`. Entries keep the identifier and name fields as decoded, sorted by identifier with ties in source order. The `tables` record ids are `<table with - as _>_names`, because the 02-04 id rule refuses `npcname-e-names`; coverage keeps these derived ids outside the data denominator.

| Record | Source | Identifier fields | Entries | Duplicate identifiers | Manifest bytes |
|---|---|---|---|---|---|
| itemname_e_names | itemname-e | id | 9,238 | 0 | 407,150 |
| npcname_e_names | npcname-e | id | 6,519 | 0 | 239,341 |
| skillname_e_names | skillname-e | skill_id, skill_level | 29,812 | 0 | 1,755,442 |

Working on 2026-11-09 (plan 02-28, DATA-02): the three tables the local descriptor has no layout for decode through `scripts/data/hair_table_adapter.py`. It reads each lock-equal `system/<table>.dat` through the guard, decrypts it with the crypto-pinned `decode413`, and hands only those decoded bytes to Elbera's `hair_pairs` or `keyed_hair_pairs` in `tools/ui/check_hair_selection_native.py`, loaded by `load_pinned_elbera_module` at SHA-256 `d21095f2...a701590` (Elbera commit 12c9656). No other Elbera function runs: an AST scan in `tests/pipeline/test_hair_table_adapter.py` checks that the module is used only through those two names and that `verify`, `verify_material_native`, `audit_assets`, `main` and `--check` never appear. `convert_tables.py` writes each one as a `native-table` manifest on route `elbera-adapter`, with `descriptorSha256` holding the Elbera script SHA-256 and the layout evidence `HAIR_TABLE_FIELD_PROOF` in the unit receipt (`fieldProof`). A parser refusal would seal a `hair-layout-undecoded` (hairgrp, hairaccessarygrp) or `helmet-layout-undecoded` (helmetgrp) gap row.

| Table | Source bytes | Elbera parser | Records | Manifest |
|---|---|---|---|---|
| hairgrp | 304 | hair_pairs | 15 rows of 15 pairs | `/l2/tables/f4c71595.../hairgrp.json` |
| helmetgrp | 432 | keyed_hair_pairs | 3 (keys 1, 2, 3) | `/l2/tables/83283aaa.../helmetgrp.json` |
| hairaccessarygrp | 432 | keyed_hair_pairs | 4 (keys 0, 1, 2, 3) | `/l2/tables/f58d5c4a.../hairaccessarygrp.json` |

Layout on this client (OVERNIGHT-DECISIONS rows 320, 321, 375): the lock-equal `system/Engine.dll` (SHA-256 `4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`) loads the three files in `FL2GameData::HairDataLoad` (0x10451720), `HelmHairDataLoad` (0x10466140) and `AccessaryHairDataLoad` (0x104675f0). All three read through the shared 15 x 15 x 2 table reader at 0x104460c0, which reads every element with `FArchive::ByteOrderSerialize(ptr, 4)` from Core.dll `9462f87a...`. Every word is a little-endian signed int32, and -1 is the no-part sentinel that the mesh selector compares against. hairgrp is 15 rows of 15 (a, b) pairs, 1,800 bytes with no header. helmetgrp and hairaccessarygrp are an int32 count, then per record an int32 key and the same 1,800-byte block. Each file ends with the SafePackage trailer. The adapter, the unit receipts (`fieldProof`) and the inventory status cite this as `HAIR_TABLE_FIELD_PROOF`.

On the lock-equal files, Elbera's `hair_pairs` and `keyed_hair_pairs` output equals the client reading. hairgrp decodes to 1,813 bytes: 258 of its 450 words are -1, the values run from -1 to 9, and row 14 is all 0. helmetgrp decodes to 5,429 bytes (keys 1, 2, 3) and hairaccessarygrp to 7,233 bytes (keys 0, 1, 2, 3). `tests/pipeline/test_hair_table_adapter.py` re-reads the decoded bytes in the client layout and compares them with the parser output (`RealHairTableClientLayoutTests`). It also checks that synthetic words land at word `2*(row*15+style)` for a and the next word for b, with -1 kept as -1.

Field meanings, only where the analysts show them: a is the PMS_Hair1 (`_ah`) mesh number and b the PMS_Hair2 (`_bh`) mesh number. The helmetgrp key is `GetHairMeshType(PMS_Helm = 6)`. The hairaccessarygrp key is `GetHairMeshType(PMS_HairAcce1 = 7)` or `GetHairMeshType(PMS_HairAcce2 = 8)`. The enum names come from the lock-equal Engine.u. Records keep file order and duplicate keys; no overwrite rule is applied.

The client never reads these tables one byte at a time. The community `hairgrp.ddf` (120 `CHAR` fields per row) and the local `dats/hairgrp.xml` `UCHAR` reader therefore do not describe this client, and the adapter does not compare against them.

Evidence: two analyses of the same binaries. The first is in `C:/Users/rolan/AppData/Local/Temp/l2b-autonomous/owner-followups/hair-layout/` (`verify_hair_table_layout.py`, capstone 5.0.7, 120 instruction anchors across Engine.dll, Core.dll and the lock-equal L2.bin `790d9068...`). The second, in `hair-layout-independent/`, uses its own PE reader and its own decoder built from the L2.bin codec, and finds 0 mismatches. Both are summarised in `C:/Users/rolan/AppData/Local/Temp/l2b-autonomous/owner-followups/analysis-result.json` (keys `hair` and `hairCheck`). The analysis scripts are not committed.

## Open

40 `.dat` tables, 25 `.u`, 435 `.utx`, 212 `.usx`, 20 `.ukx` and 163 `.unr` packages. The combined table inventory (FOUND-04) is below. Open for DATA-01: the decode failures of eula-e, questname-e, servername-e and sysstring-e. Open for DATA-02: the code does not name the hair row, style and texture-number fields (`[User+0x204]+0x698`, `User+0x240`, `User+0x244`). The three hair receipts in the lane store carry the earlier field proof until `convert_tables.py` reruns those units. DATA-03 stays open: the strict decode of sysstring-e fails, so its count is unresolved (see below). The lane store is not restaged into the shared store yet.

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

Tally: 33 local-decoded, 4 local-layout-only (each a decode-failed gap), 3 elbera, 0 none. The three elbera rows take their counts from sealed `elbera-adapter` records and carry the status `decoded by Elbera adapter, ` followed by `HAIR_TABLE_FIELD_PROOF`. The ten local decodes that Elbera also counted (actionname-e, armorgrp, etcitemgrp, itemname-e, npcgrp, npcname-e, skillgrp, skillname-e, systemmsg-e, weapongrp) match Elbera's counts. The test derives the tally from the rows and `TABLES`: no row keeps `layout pinned, not decoded`, and every layout-only row names its decode failure.

| Table | Route | Layout | Records | Status |
|---|---|---|---|---|
| actionname-e | local-decoded | actionname | 102 | decoded, matches Elbera evidence |
| armorgrp | local-decoded | armorgrp | 1,014 | decoded, matches Elbera evidence |
| castlename-e | local-decoded | castlename | 53 | decoded |
| chargrp | local-decoded | chargrp | 15 | decoded |
| classinfo-e | local-decoded | classinfo | 10 | decoded |
| clientdata | local-decoded | clientdata | 15 | decoded |
| commandname-e | local-decoded | commandname | 114 | decoded |
| creditgrp-e | local-decoded | credit | 62 | decoded |
| entereventgrp | local-decoded | entereventgrp | 1,152 | decoded |
| etcitemgrp | local-decoded | etcitemgrp | 6,911 | decoded, matches Elbera evidence |
| eula-e | local-layout-only | eula | unknown | decode-failed:FormatError |
| gametip-e | local-decoded | gametip | 182 | decoded |
| hairaccessarygrp | elbera | - | 4 | decoded by Elbera adapter, client int32 layout of system/Engine.dll 4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08: FL2GameData::HairDataLoad 0x10451720, HelmHairDataLoad 0x10466140, AccessaryHairDataLoad 0x104675f0 |
| hairaccessorylocgrp | local-decoded | hairaccessorylocgrp | 112 | decoded |
| hairgrp | elbera | - | 15 | decoded by Elbera adapter, client int32 layout of system/Engine.dll 4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08: FL2GameData::HairDataLoad 0x10451720, HelmHairDataLoad 0x10466140, AccessaryHairDataLoad 0x104675f0 |
| helmetgrp | elbera | - | 3 | decoded by Elbera adapter, client int32 layout of system/Engine.dll 4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08: FL2GameData::HairDataLoad 0x10451720, HelmHairDataLoad 0x10466140, AccessaryHairDataLoad 0x104675f0 |
| hennagrp-e | local-decoded | hennagrp | 180 | decoded |
| huntingzone-e | local-decoded | huntingzone | 220 | decoded |
| itemname-e | local-decoded | itemname | 9,238 | decoded, matches Elbera evidence |
| logongrp | local-decoded | logongrp | 26 | decoded |
| mobskillanimgrp | local-decoded | mobskillanimgrp | 5,463 | decoded |
| musicinfo | local-decoded | musicinfo | 358 | decoded |
| npcgrp | local-decoded | npcgrp | 6,519 | decoded, matches Elbera evidence |
| npcname-e | local-decoded | npcname | 6,519 | decoded, matches Elbera evidence |
| obscene-e | local-decoded | obscene | 13 | decoded |
| optiondata_client-e | local-decoded | optiondata_client | 16,380 | decoded |
| questname-e | local-layout-only | questname | unknown | decode-failed:FormatError |
| raiddata-e | local-decoded | raiddata | 220 | decoded |
| recipe-c | local-decoded | recipe-c | 871 | decoded |
| servername-e | local-layout-only | servername | unknown | decode-failed:FormatError |
| skillgrp | local-decoded | skillgrp | 29,812 | decoded, matches Elbera evidence |
| skillname-e | local-decoded | skillname | 29,812 | decoded, matches Elbera evidence |
| skillsoundgrp | local-decoded | skillsoundgrp | 1,398 | decoded |
| staticobject-e | local-decoded | staticobject | 577 | decoded |
| symbolname-e | local-decoded | symbolname | 11 | decoded |
| sysstring-e | local-layout-only | sysstring | 2,083 (Elbera) | decode-failed:FormatError |
| systemmsg-e | local-decoded | systemmsg | 2,083 | decoded, matches Elbera evidence |
| variationeffectgrp-e | local-decoded | variationeffectgrp | 288 | decoded |
| weapongrp | local-decoded | weapongrp | 1,313 | decoded, matches Elbera evidence |
| zonename-e | local-decoded | zonename | 369 | decoded |

## Sysstring and systemmsg count (DATA-03)

Written 2026-11-08 by `scripts/data/sysstring_systemmsg_counts.py --client E:/Lineage2-client` into `docs/parts/data/sysstring-systemmsg-counts.json`, checked by `tests/pipeline/test_sysstring_systemmsg_counts.py`. Both tables go through the same `decode_table` and lock guard as every other table.

- systemmsg-e: header count 2,083, strict decode 2,083 records, exact end (233,702 consumed bytes plus the 13-byte SafePackage trailer equal 233,715 decoded bytes). Identifier field `id`: 2,083 distinct values from 0 to 2,153, no duplicates, 71 missing in that range.
- sysstring-e: header count 2,083. The strict decode fails with `FormatError: Unterminated Unreal string`, so it has no decoded count, exact end or id set. The table is a `decode-failed:FormatError` gap row in the lane store.
- Id-set comparison: not computed, because sysstring-e has no strict decode.
- Verdict: `count-unresolved`. The 2,083 Elbera evidence count of systemmsg-e is confirmed by strict decode. For sysstring-e only the header count is known.

## Evidence

Decoder code: `scripts/native_catalog/` and the Elbera hair adapter `scripts/data/hair_table_adapter.py`. Input pin: `recipes/native-inputs.lock.json`. Reference tree lock: `recipes/reference-client-tree.lock.json`. Inventory: `docs/parts/data/dat-table-inventory.json`. DATA-03 report: `docs/parts/data/sysstring-systemmsg-counts.json`. Lane store (ignored): `artifacts/lane-store/data-ui/l2/` with `tables/<manifestSha256>/<table>.json` and `tables/<manifestSha256>/<table>_names.json`, receipts under `artifacts/lane-store/data-ui/work/table__<table>/decode/` and `.../name-index/` and gap rows in `artifacts/lane-store/data-ui/gap-rows/decode.json`.
