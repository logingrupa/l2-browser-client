# Port scope and work split

Size of the Interlude port and how the work splits into parts and lanes. [.planning/PROJECT.md](../.planning/PROJECT.md) wins where this doc differs; order is in [ROADMAP.md](../.planning/ROADMAP.md), live status in [STATUS.md](../STATUS.md).

Counts: DATABASE-PC, 2026-11-07, `E:\Lineage2-client`, aCis 409 (`E:\Lineage2Elbera\server`), Mobius CT_0 (the `L2J_Mobius_CT_0_Interlude` source tree on DATABASE-PC `E:`). Converters read an E: file only when `recipes/reference-client-tree.lock.json` lists it equal to the IMPORTA-PC `C:\Lineage2-client` reference (DEC-OWN-2).

## 1. Client data versus server data

The client holds looks, sounds and display copies of some numbers. Outcomes (`Attack`, `UserInfo`, `StatusUpdate`, `MagicSkillUse`) arrive resolved through `GameWorldAdapter`, and tooltips read server stats, not `.dat` copies (ARCH-01, ARCH-02). The client owns presentation (ARCH-04).

## 2. What the client contains

- `system/`: 40 `.dat` (1.7 MB), `interface.xdat`, 25 `.u` (79.5 MB), 23 `.int`, 29 `.dll`, 5 `.gly` fonts (0.5 MB). Route and count per table: [dat-table-inventory.json](parts/data/dat-table-inventory.json).
- Folders (files, MB): textures 387, 1,448; systextures 70, 1,841; staticmeshes 212, 1,526; animations 20, 748; sounds 26, 545; music 250, 239; voice 46, 29. Exporting every `.utx` with UE Viewer gives 33,410 textures in 433 packages.
- `maps/`: 163 `.unr`: 153 `XX_YY` tiles (X 15 to 26, Y 10 to 26) plus 10 non-tile maps (WORLD-03). Each 20_20 hand step becomes a tile-general step (DEC-OWN-7). Today's map readers accept 67 of the 153 tiles ([NATIVE_WORLD.md](NATIVE_WORLD.md)).
- `interface.xdat`: 248 records, 2,638 controls, about 140 windows. Control names differ from Elbera's edition, so layouts come from the decoded tree (UI-02); skin, fonts and icons from converted UI textures (DEC-OWN-10).

Record counts from Elbera's `tools/dat/extract_gamedata.py` on this client, kept as inventory evidence:

| Table | Records |
|---|---|
| npcgrp, npcname-e | 6,519 |
| itemname-e | 9,238 |
| etcitemgrp | 6,911 |
| weapongrp | 1,313 |
| armorgrp | 1,014 |
| skillgrp, skillname-e | 29,812 |
| sysstring-e | 2,083 |
| systemmsg-e | 2,083 |
| actionname-e | 102 |

## 3. How the files are scrambled and decoded

- A 28-byte UTF-16 header `Lineage2VerNNN` names the method. Ver413 (`.dat`, `l2.ini`): one RSA exponentiation per 128-byte block, byte 3 is the payload length (max 124), then a 4-byte size and zlib. Ver111 (`.unr`, `.ukx`): XOR `0xAC`. Ver121 (`.utx`): XOR with a byte derived from the file name. `interface.xdat` is plain.
- Modded clients use a community RSA key next to NCSoft's, so try both. `scripts/native_catalog/tables.py` tries the two Ver413 key blocks of open-l2encdec `src/l2encdec.cpp` (commit `6f335782`), hash-pinned and kept in `.assets/native-tools/open-l2encdec/`.
- Strip the 20-byte CRC32 tail only when the CRC matches. Re-saved files such as `maps/17_25.unr` have none.

## 4. The network protocol

Packet classes (raw `.java` counts): aCis 208 client and 282 server, Mobius 215 and 279. The 32 request systems: 1 login, 2 movement, 3 boats, 4 combat, 5 skills, 6 inventory, 7 NPC dialogs, 8 NPC shops, 9 trade, 10 private stores, 11 crafting, 12 chat and friends, 13 party, 14 party matching, 15 command channel, 16 clan, 17 clan wars, 18 alliance, 19 sieges, 20 manor, 21 pets, 22 quests, 23 shortcuts, 24 henna, 25 Olympiad, 26 Seven Signs, 27 fishing, 28 cursed weapons and raid bosses, 29 community board, 30 minimap, 31 petitions and GM tools, 32 PC cafe.

## 5. Parts

Layers run from 0 (foundations) to 4. States are the 2026-11-07 snapshot; live state per part is in [STATUS.md](../STATUS.md).

| # | Part (slug) | Layer | State |
|---|---|---|---|
| 1 | Decoders (data) | 0 | UE Viewer route on a pinned snapshot; 11 of 40 tables as JSON via Elbera |
| 2 | Offline sandbox (sandbox) | 0 | `NativeSliceAdapter`; no by-ID spawning |
| 3 | World, 153 tiles (world) | 1 | 20_20 section |
| 4 | Player characters (player-characters) | 1 | Human fighters native, mystic in progress |
| 5 | UI windows (ui) | 1 | Development sheet only |
| 6 | NPCs, monsters (npcs) | 2 | Greater Musveren |
| 7 | Items, equipment (items) | 2 | Not seen in the code |
| 8 | Skill visuals, effects (skills-effects) | 2 | Power Strike in progress |
| 9 | Audio (audio) | 2 | 20_20 footsteps, ambience, music in progress |
| 10 | Minimap, world map (minimap) | 2 | Not started |
| 11 | Movement, geodata, 547 doors (movement-geodata) | 2 | Synthetic movement; no geodata on DATABASE-PC |
| 12 | Adapter login, world entry (adapter-login) | 3 | Not started |
| 13 | Adapter event dispatch (adapter-dispatch) | 3 | Not started |
| 14 | Combat and stats display (combat-display) | 3 | Fighter versus Musveren demo |
| 15 | NPC dialogs (npc-dialogs) | 4 | Needs part 13 |
| 16 | Shops, trade, crafting (shops-trade) | 4 | Needs part 13 |
| 17 | Party, clan, chat, friends (social) | 4 | Needs part 13 |
| 18 | Quests, tutorial (quests) | 4 | Needs part 13 |
| 19 | Sieges, Olympiad, bosses, Seven Signs, GM tools, boats (late-systems) | 4 | Needs part 13 |

## 6. Order of work

Breadth first (DEC-OWN-1). Lanes start after the Editor leaves the build path (NOED-01 to NOED-05).

- Stage A converts the whole client into the offline sandbox, lanes in parallel, UI from day one. Each part is checked there against L2.exe on IMPORTA-PC (DEC-OWN-3). A failing tile or step is a listed gap. Parity research waits for the polish list (POL-02, POL-03).
- Stage B: Mobius login and entry, then one packet type at a time, then server-driven windows. Browsers cannot open TCP to 2106 and 7777; a dumb WebSocket relay is recommended, not decided (DEC-PORT-4, NET-01).

## 7. Working with several agents at once

Rules: [AGENTS.md](../AGENTS.md), [OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md). One part per `<part>/<slug>` branch from committed code, merged one at a time, contract changes first. Ownership is by lane in `.planning/lanes.json`, checked by `scripts/check-lane-ownership.mjs`. Integration owns native-store writers, `package.json`, `.planning/`, STATUS.md and DECISIONS.md.

## 8. How many agents

Review and merge speed is the limit, so each phase runs integration plus at most 3 lanes. GSD phase = this phase + 1.

- 0: contracts, Editor off the build path, sandbox shell, `.dat` inventory, hash lock.
- 1, stage A breadth: L1 world, L2 actors, L3 data and UI (DEC-OWN-6).
- 2, stage A checks: one checker per lane against L2.exe; fixes go into shared converters.
- 3, stage B: adapter login, dispatch, combat display, then server-driven dialog, shop, social and quest windows (NET-01 to NET-08).

## 9. What to take from Elbera

Elbera (three.js, aCis 409, MIT, commit `12c9656`): `C:\laragon\www\Lineage2Elbera` on IMPORTA-PC, `E:\Lineage2Elbera` on DATABASE-PC.

- Stage A: `tools/l2lib` and `tools/dat/*.py` for tables the local route lacks (DEC-OWN-4), `tools/xdat/parse_xdat.py` (UI-01). From `tools/world/` only pinned functions behind an adapter, as in `scripts/vendor/lineage2elbera_bsp/`, never the `convert.py` or `bsp.py` pipelines (CONV-02). `lightmap.py` and `bsplight.py` wait for polish (DEC-PORT-5). Renderer-free `editor/world/js/` modules (`geodata.js`, `terrain-collision.js`, `nativecoords.js`) only after the `editor/` audit (NET-03).
- Stage B: after the `gateway/` audit (NET-03), `gateway/src/` crypto, framing and `gameclient.js` packet decoders, re-checked against stock Mobius, one packet type at a time.
- Leave behind: verifiers pinned to Engine.dll `07b24af4...` (this client is `4dd2f63c...`), `elbera-acis.patch`, deviceId auto login, the three.js runtime.

Per-tool verdicts for `tools/`: [LINEAGE2ELBERA_REUSE_AUDIT.md](LINEAGE2ELBERA_REUSE_AUDIT.md).

## 10. Why Elbera looked fast

Worth copying: one branch shape (module, test, verifier, evidence doc) and `tools/audit/unsourced.py --check` against unsourced literals. Cost: `progress.md`, touched by 74 of 75 pull requests, grew to 271 KB, and verified collision modules are imported by nothing. Keep shared files small.

## Open

- DATA-03: sysstring-e and systemmsg-e report the same count.
- WORLD-03: what `Auto0` to `Auto5` are; `Lobby` status before Phase 4.
- unverified: 435 `.utx` files versus 433 exported packages (STATE.md).
