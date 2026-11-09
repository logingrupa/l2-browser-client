# Asset and .dat decoders evidence

Part `data`, lane `data-ui`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: The UE Viewer route works on a pinned input snapshot. 11 of 40 `.dat` tables are decoded to JSON, by Elbera's tools.

Working on 2026-11-08 (plan 02-17, DATA-01 tracer): `scripts/data/convert_tables.py` decodes a descriptor-linked table through one case-insensitive source resolver and writes a hash-pinned `native-table` manifest plus a `tables` catalog record into the data-ui lane store, one sealed ledger unit per table. Every linked layout is pinned in `scripts/native_catalog/table_layout_pins.py`.

Working on 2026-11-09 (plan 02-27, DATA-01 breadth): `convert_tables.py --batch tables --limit 40` sealed every one of the 37 descriptor-linked tables on lock-equal `E:/Lineage2-client`; a second batch run skipped all 37 units and left `catalog.json` byte-identical. 33 decoded then; eula-e, questname-e, servername-e and sysstring-e were sealed `decode-failed:FormatError` gap rows.

Working on 2026-11-09 (client reading of the four gap tables, IR-08, OVERNIGHT-DECISIONS rows 227, 294, 295 and 373 to 376): all 37 descriptor-linked tables now decode. Two analysts per table derived the client's own reading from the lock-equal Engine.dll `4dd2f63c...5405b08` and Core.dll `9462f87a...4e919bf` (capstone 5.0.7 disassembly) and the decrypted bytes; where they differed the checker's reading was taken. Their capstone and walker scripts lived in the run's temporary folder, which was cleared on 2026-11-09; they were never committed, and the addresses and hashes recorded here are enough to repeat the check with any disassembler.

| Table | Fault | Client reading now in the repo | Records |
|---|---|---|---|
| sysstring-e | the ASCF reader demanded a closing NUL, which ids 1551 (`01 20`) and 1574 (`11` "Player settings" `00 2c`) lack | `read_core_fstring_text` (below) | 2,083 |
| eula-e | the dat_engine Interlude layout reads four strings; the fourth swallows the SafePackage trailer | `recipes/data/table-layouts/eula.xml`: one record of three FStrings | 1 |
| servername-e | the header counts in-use slots, not records; 730 bytes of unused slots were left before the trailer | `recipes/data/table-layouts/servername.xml`: 200 slots, guarded | 200 slots, 127 in use |
| questname-e | three float32 words are `0xFFFFFFFF`, which canonical JSON refuses | a non-finite float32 keeps its source bytes | 2,050 |

String rule (sysstring-e, row 227). `read_core_fstring_text` in `scripts/native_catalog/tables.py` is the one owner of the table ASCF rule, from Core.dll `operator<<(FArchive&, FString&)` at `0x10155360`: the length is a UE2 compact index (FCompactIndex `0x1015cfb0`); a length of 0 or more reads that many bytes and widens each to the code point of the same value (`movzx`, Latin-1, no code page, 1-byte serializer `0x101307e0`); a negative length reads that many UTF-16LE units (2-byte serializer `0x10130800`); every counted unit is consumed; a one-unit string is emptied (`Num()==1 -> Empty()`); the visible text is the units before the first NUL unit, as `FString::operator*` (`0x101150b0`) and `appStrcpy` (Engine.dll `0x10414b13..0x10414b36`) read it. The client has no terminator check, but a counted string of two or more units with no NUL unit stays `FormatError: Unterminated Unreal string`, because the client would read past its buffer there (checker's correction; no string in any linked table has this). The dat_engine `read_ascf` rule of row 227 (drop the last byte) does not match the client. Engine.dll `SysStringLoad` (`0x10455430`) reads the count, then per record a UINT id and one FString; the slot is `this+0x6a8dc+index*12` by record position, not by id (checker's correction). Every non-empty string has index equal to id (index 2048 is the first that differs, holding id 2051, and every id above 1717 is empty), so a catalog keyed by `stringID` matches the client. Id 1551 reads as empty and id 1574 as "Player settings"; the comma after its NUL is consumed and never shown. UE2 package readers keep `ue2.Reader.string()`.

Eula layout. Engine.dll `FL2Eula::Serialize` (`0x10445ff0`) makes three Core FString calls on `this+0x0`, `+0xC` and `+0x18`. `FL2GameData::EulaLoad` (`0x1044fe20`) runs `CheckSafePackage` (`0x10448d10`, 12-byte compare of "SafePackage\0" at `0x10894640` against TotalSize-12) and then that Serialize once on `this+0x7cb94`, with no count; its text branch names the fields `eula`, `eulatestserver` and `eulachinaspecialmessage`. `EulaSave` (`0x10450360`) and `MakeSafePackage` (`0x10448c90`) write the same. The file decodes to one record: a 29,971-unit UTF-16 agreement and two "\r\n" strings, 59,955 bytes plus the 13-byte trailer of 59,968. The layout is pinned by SHA-256 `2cc418ae...7e22` in `CLIENT_DERIVED_LAYOUTS` with that evidence, and `.gitattributes` keeps `recipes/data/table-layouts/*.xml` LF so a `core.autocrlf` checkout cannot break the raw-bytes pin (checker's correction). The third-party `dats/eula.xml` stays untouched and its pin is removed.

Servername layout. Engine.dll `FL2GameData::ServerNameSave` (`0x10454a10`) writes the count of slots `0..0xc7` whose FL2ServerName in-use INT (`this+0x67708`, stride 28) is set, then a UINT slot id and an FL2ServerName for every slot whose SystemMsg in-use INT (`this+0x240e8`, stride `0x5c`, `FL2SystemMsg::Serialize` `0x10446a20`) is set; systemmsg-e sets it for ids 0..199, so the file holds all 200 slots. `ServerNameLoad` (`0x10454410`) reads only the first count records; `FL2ServerName::Serialize` (`0x10446b60`) reads the INT and two FStrings; `ServerNameClear` (`0x10447b50`) walks `0xc8` slots. The layout (SHA-256 `1ecd0a74...fe84`) reads 200 slots; `require_in_use_slot_prefix` refuses the file unless the slot ids are 0..199 in order and the in-use slots are exactly the first header-count slots (checker's correction: a moved, repeated or out-of-range slot fails, not only a count mismatch). Result: slots 0..126 in use (71 ANSI names such as Bartz, 55 "N번 서버" and "방송용"), slots 127..199 empty.

Float rule (questname-e, row 294). Engine.dll `FL2QuestData::Serialize` (`0x104659c0`) copies `target_loc` (`+0x50`) and `start_npc_loc` (`+0x7C`) through helper `0x103301d0` (three ByteOrderSerialize calls) with no check, so the NaN words are the client's own values: quest 422 at records 730 (`start_npc_loc_z`), 735 and 736 (`start_npc_loc_y`). `read_float32` writes a NaN or infinite float32 as `{"nonFiniteFloat32SourceBytes": "FFFFFFFF"}` (four source bytes, uppercase hex; `docs/OUTPUT_CONTRACT.md`); every finite float stays a JSON number. The `native_table_manifest_bytes` ValueError wrapper, whose only trigger was this NaN, is deleted.

Capacity (row 295). The tables slice capacity of 40 was the inventory table count and ignored the three name index records in the same slice, so the 41st record would have been refused. `TABLES_CATALOG_CAPACITY` is now `EXPECTED_DAT_TABLE_COUNT` (the 40 `system/*.dat` files of the lock) plus `len(NAME_INDEX_SOURCES)` (3), 43, used by both `convert_tables.py` and `table_name_indexes.py`. The 128 MiB archive, 96 MiB payload and 256-entry limits of `docs/OUTPUT_CONTRACT.md` govern `.l2asset` archives, not catalog slices; each table manifest stays under its own 32 MiB bound (questname-e, the largest new one, is 2,181,994 bytes).

Regeneration proof (2026-11-09, in a scratch `git archive` of this branch plus a copy of the integration worktree's data-ui lane store, catalog `41439f5c...`; repeated in the integration worktree itself, which reached catalog `e6579363...` with an inventory byte-identical to the committed one). `convert_tables.py --batch tables --limit 40` re-ran all 37 units at algorithm version 3, `--table hairgrp --table helmetgrp --table hairaccessarygrp` re-ran the hair units, and `table_name_indexes.py` skipped all three indexes as sealed. All 39 earlier records (33 tables, 3 hair tables, 3 name indexes) are identical records with byte-identical manifests; the four new records are appended and the four gap rows are gone (`manifest-comparison.json`). A second batch run skipped all 37 units and left the catalog at `e6579363...`. The inventory and DATA-03 report below were written by their own scripts in that copy.

| Record | Manifest SHA-256 | Manifest bytes | Records |
|---|---|---|---|
| eula-e | `f7d46322...7b1` | 30,736 | 1 |
| questname-e | `8ccfd4c1...0887` | 2,181,994 | 2,050 |
| servername-e | `9f747383...175a` | 9,642 | 200 |
| sysstring-e | `4eb588f0...f160` | 82,674 | 2,083 |

Tests: `tests/pipeline/test_table_ascf_reader.py` (the string rule), `tests/pipeline/test_client_derived_table_layouts.py` (pins, LF bytes, Engine.dll lock match, the eula and servername layouts and every servername guard break), `tests/pipeline/test_convert_tables.py` (an unpaired UTF-16 surrogate is a gap row, a NaN float seals a decoded unit, the 43-record capacity), `tests/pipeline/test_native_presentations.py` (the float reader), `tests/pipeline/test_dat_table_inventory.py` (the slot status), and `scripts/native_catalog/test_catalog.py` `ClientReadingTableTests`, which decodes the four real tables through the guard.

Name indexes for the sandbox pickers (`scripts/data/table_name_indexes.py`, checked by `tests/pipeline/test_table_name_indexes.py`): one `native-table-name-index` v1 manifest per table, built only from the sealed source manifest after its bytes match the catalog `manifestSha256`. Entries keep the identifier and name fields as decoded, sorted by identifier with ties in source order. The `tables` record ids are `<table with - as _>_names`, because the 02-04 id rule refuses `npcname-e-names`; coverage keeps these derived ids outside the data denominator. The sources live in `scripts/data/table_name_index_sources.py`.

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

Evidence: two analyses of the same binaries. The first used capstone 5.0.7 with 120 instruction anchors across Engine.dll, Core.dll and the lock-equal L2.bin `790d9068...`; the second used its own PE reader and its own decoder built from the L2.bin codec, and found 0 mismatches against the first. Their scripts lived in the run's temporary folder, which was cleared on 2026-11-09; they were never committed, and the addresses and hashes recorded here are enough to repeat the check with any disassembler.

## Open

40 `.dat` tables, 25 `.u`, 435 `.utx`, 212 `.usx`, 20 `.ukx` and 163 `.unr` packages. The combined table inventory (FOUND-04) is below. DATA-01: every descriptor-linked table decodes, with the client reading of each layout (eula-e, questname-e, servername-e and sysstring-e included). Open for DATA-02: the code does not name the hair row, style and texture-number fields (`[User+0x204]+0x698`, `User+0x240`, `User+0x244`). The servername `tag_?` field keeps the dat_engine name although the binary shows it is the slot in-use INT. The lane store is not restaged into the shared store yet.

Regeneration in the integration worktree, at BelowNormal: `python -B scripts/data/convert_tables.py --client E:/Lineage2-client --batch tables --limit 40`, then `python -B scripts/data/convert_tables.py --client E:/Lineage2-client --table hairgrp --table helmetgrp --table hairaccessarygrp` (the hair units reseal with the 4dd2 field proof), then `python -B scripts/data/table_name_indexes.py --table itemname-e --table npcname-e --table skillname-e` (all three skip as sealed). Rerunning `scripts/build_dat_table_inventory.py --client E:/Lineage2-client` and `scripts/data/sysstring_systemmsg_counts.py --client E:/Lineage2-client` there must leave the committed inventory and DATA-03 report byte-identical.

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

Generated by `scripts/build_dat_table_inventory.py --client E:/Lineage2-client` into `docs/parts/data/dat-table-inventory.json` (last on 2026-11-09 in the scratch copy above), checked by `tests/pipeline/test_dat_table_inventory.py`. Table names come from the lock's `system/*.dat` entries. Layouts come from the pinned descriptor `06_interlude.xml` (SHA-256 `5df8b7af...cdef6`). Local counts come only from sealed `scripts/data/convert_tables.py` records in `artifacts/lane-store/data-ui/l2/catalog.json` whose `sourceSha256` equals the lock eSha256 of a checked lock-equal E: file. A slot table (servername-e) states its slots and in-use slots, counted from its hash-checked manifest. A decode-failed gap row would put its reason in the status. Counts marked Elbera are copied from PORT_SCOPE section 2.

Tally: 37 local-decoded, 0 local-layout-only, 3 elbera, 0 none. The three elbera rows take their counts from sealed `elbera-adapter` records and carry the status `decoded by Elbera adapter, ` followed by `HAIR_TABLE_FIELD_PROOF`. The eleven local decodes that Elbera also counted (actionname-e, armorgrp, etcitemgrp, itemname-e, npcgrp, npcname-e, skillgrp, skillname-e, sysstring-e, systemmsg-e, weapongrp) match Elbera's counts. The test derives the tally from the rows and `TABLES`: no row keeps `layout pinned, not decoded`.

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
| eula-e | local-decoded | eula (client-derived) | 1 | decoded |
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
| questname-e | local-decoded | questname | 2,050 | decoded |
| raiddata-e | local-decoded | raiddata | 220 | decoded |
| recipe-c | local-decoded | recipe-c | 871 | decoded |
| servername-e | local-decoded | servername (client-derived) | 200 | decoded, 200 slots, 127 in use |
| skillgrp | local-decoded | skillgrp | 29,812 | decoded, matches Elbera evidence |
| skillname-e | local-decoded | skillname | 29,812 | decoded, matches Elbera evidence |
| skillsoundgrp | local-decoded | skillsoundgrp | 1,398 | decoded |
| staticobject-e | local-decoded | staticobject | 577 | decoded |
| symbolname-e | local-decoded | symbolname | 11 | decoded |
| sysstring-e | local-decoded | sysstring | 2,083 | decoded, matches Elbera evidence |
| systemmsg-e | local-decoded | systemmsg | 2,083 | decoded, matches Elbera evidence |
| variationeffectgrp-e | local-decoded | variationeffectgrp | 288 | decoded |
| weapongrp | local-decoded | weapongrp | 1,313 | decoded, matches Elbera evidence |
| zonename-e | local-decoded | zonename | 369 | decoded |

## Sysstring and systemmsg count (DATA-03)

Written 2026-11-09 by `scripts/data/sysstring_systemmsg_counts.py --client E:/Lineage2-client` into `docs/parts/data/sysstring-systemmsg-counts.json`, checked by `tests/pipeline/test_sysstring_systemmsg_counts.py`. Both tables go through the same `decode_table` and lock guard as every other table.

- systemmsg-e: header count 2,083, strict decode 2,083 records, exact end (233,702 consumed bytes plus the 13-byte SafePackage trailer equal 233,715 decoded bytes). Identifier field `id`: 2,083 distinct values from 0 to 2,153, no duplicates, 71 missing in that range.
- sysstring-e: header count 2,083, strict decode 2,083 records under the Core.dll string rule, exact end (33,218 consumed bytes plus the trailer equal 33,231). Identifier field `stringID`: 2,083 distinct values from 0 to 2,153, no duplicates, 71 missing (2048-2050, 2058-2085, 2087-2090, 2096-2107, 2111-2114, 2129-2131, 2136-2152). 1,701 strings are non-empty; the last non-empty id is 1717.
- Id-set comparison: equal, 2,083 shared ids, none on one side only.
- Verdict: `count-confirmed`. IR-08 is settled: both headers declare 2,083 and both tables decode to 2,083 records, so the Elbera count is confirmed, not a copy error. Engine.dll `SysStringSave` (`0x10455990`) counts and writes over the same SystemMsg in-use flag (`this+0x240e8`, stride `0x5c`, `0xbb8` slots) as `SystemMsgFormatSave` (`0x10454200`), which is why the counts agree.

## Evidence

Decoder code: `scripts/native_catalog/` and the Elbera hair adapter `scripts/data/hair_table_adapter.py`. Client-derived layout pins: `recipes/data/table-layouts/` with their SHA-256 and Engine.dll evidence in `CLIENT_DERIVED_LAYOUTS`. Input pin: `recipes/native-inputs.lock.json`. Reference tree lock: `recipes/reference-client-tree.lock.json`. Inventory: `docs/parts/data/dat-table-inventory.json`. DATA-03 report: `docs/parts/data/sysstring-systemmsg-counts.json`. Lane store (ignored): `artifacts/lane-store/data-ui/l2/` with `tables/<manifestSha256>/<table>.json` and `tables/<manifestSha256>/<table>_names.json`, receipts under `artifacts/lane-store/data-ui/work/table__<table>/decode/` and `.../name-index/` and gap rows in `artifacts/lane-store/data-ui/gap-rows/decode.json`.
