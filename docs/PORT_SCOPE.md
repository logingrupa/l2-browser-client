# Port scope and work split

Measured on 2026-11-07 from the client at `E:\Lineage2-client` on DATABASE-PC
(Engine.dll SHA-256 `4dd2f63c...`), the aCis 409 source at
`E:\Lineage2Elbera\server` and the L2J Mobius CT_0 Interlude source at
`E:\linegen\source\L2J_Mobius\L2J_Mobius_CT_0_Interlude`. Counts are file or
record counts from those trees. Where a line is a judgement rather than a
count, it says so.

The measurements come from the DATABASE-PC copy. The authoritative reference
is IMPORTA-PC `C:\Lineage2-client`, and every L2.exe comparison runs there.
See decision 5 below.

## Owner decisions, 2026-11-07

1. First goal: a working browser client with every client asset converted.
   That means the world, characters, NPCs, items, `.dat` data, skill visuals,
   sounds and UI.
2. The server is replaceable. Stock L2J Mobius is the first target. If it does
   not work out, the game moves to SpacetimeDB with the L2 client and the L2
   world but a different gameplay loop.
3. Because of 2, the client never computes gameplay outcomes. It displays what
   a server sends.

## Owner decisions, 2026-11-08

These were answered at the planning ingest gate and after it. They narrow
the sections below, and `.planning/PROJECT.md` holds them as DEC-OWN-1 to
DEC-OWN-8.

4. Work order is breadth first, as in section 6. The open items of the human
   and 20_20 slice (stair routing, the upper-landing roof camera, surface
   footsteps, specialized attack sounds) go to the polish list unless they
   block the sandbox. The other human classes come with "all player
   characters".
5. IMPORTA-PC `C:\Lineage2-client` is authoritative and L2.exe comparisons run
   there. DATABASE-PC `E:\Lineage2-client` may be used for conversion only
   after a one-time full-tree hash lock proves it equal to IMPORTA-PC. The
   lock is done before stage A.
6. Stage A uses a lighter bar per part: converted, loads in the sandbox, and a
   side-by-side screenshot or listen check against L2.exe. The fixed
   thresholds (pixel tolerances, GTX 1060 at 120 FPS, audio rules) stay
   unchanged as the goal of a later polish stage. Audio is converted and bound
   per bundle in stage A. Research into native audio rules waits.
7. The repo's local pinned descriptor route is the authoritative `.dat`
   decoder where it covers a table. Elbera decoders are used only for tables
   it lacks (hairgrp, helmetgrp and others), behind an adapter. The decoder
   work writes the combined inventory first.
8. The output contract stays the existing `.l2asset` packages plus the
   catalog. `recipes/native-inputs.lock.json` stays input-only. Units and
   handedness are recorded per route in `asset.json`. There is no new merged
   file.
9. At most 3 lanes plus integration in the main checkout. L1 world: 153 tiles,
   streaming and LOD, minimap. L2 actors: all characters, NPCs and monsters,
   items and equipment, their animations, sounds and skill visuals. L3 data
   and UI: all 40 `.dat` tables, UI windows from `interface.xdat`, sandbox
   controls. UI runs in parallel from the start.
10. Stage A world scope: for all 153 tiles, geometry (terrain, static meshes,
    BSP) with the tile-general UV rule, plus sky, ambient and placement audio.
    Each 20_20 hand step becomes a tile-general converter step. A tile that
    fails a step is listed as a gap, not hand-fixed.
11. Babylon.js Editor leaves the build and runtime path. Babylon.js stays the
    engine. The native world loads directly from the `.l2asset` catalog
    (`loadNativeSection`), and the Editor-authored route (`authored=1`)
    becomes optional. `pnpm dev` and `pnpm build` stop running
    `babylonjs-editor-cli pack` and the Editor repair scripts, which move to
    an optional `pnpm generate:editor`. The legacy courtyard demo is retired
    or kept only behind that step. The sandbox gets Babylon Inspector behind
    `?inspect=1`, lazy-loaded. `project.bjseditor` and `pnpm assets:editor`
    stay as an optional viewer that nothing depends on. Per-tile Editor scenes
    are not planned. Revisit the Editor only if the SpacetimeDB route starts
    authoring new, non-L2 content. The reason: the world's source of truth is
    the original client plus the converter, so a hand edit in an Editor scene
    is either lost on reconversion or an invented change.

## 1. Client data versus server data

The Interlude client is a display terminal. Every number that decides an
outcome lives on the server. The client files hold how things look and sound,
plus display copies of some numbers for tooltips.

The same monster from both sides, Gremlin (NPC 20001):

| | Client `npcgrp.dat` | Mobius `dist/game/data/stats/npcs/*.xml` |
|---|---|---|
| Holds | mesh `LineageMonsters.gremlin_m00`, texture, hit and hurt sounds, attack effect `p_u002_a`, speed multiplier 1.0 | level 1, HP 39.7, MP 40, physical attack 8.47, magic attack 5.79, physical defence 44.4, critical 4, attack speed 253, walk 20, run 50, aggro range 1000, exp 29, sp 2, skill list, collision radius 10 and height 15 |
| HP, level, attack | no | yes |

| Data | Client has | Server has (Mobius) |
|---|---|---|
| NPC and monster stats | nothing, only looks and sounds | `stats/npcs`, 97 XML files |
| Skill power and effects | icon, animation, visual effect, cast range, cast time, MP cost (display copy) | `stats/skills`, 37 XML files. Power Strike has power 25 to 70 over 9 levels, MP cost and a 720 ms cooldown |
| Weapon and armor stats | `weapongrp` patt, matt, speed, critical; `armorgrp` pdef, mdef (display copies) | `stats/items`, 97 XML files |
| Player stats | nothing | `stats/players`, 190 XML files, computed in `mechanics/stats/Formulas.java` (2,028 lines) |
| Damage | nothing | computed per hit and sent as a finished number |
| Spawns, drops, AI, quests | nothing | datapack plus scripts |

Other Mobius `stats/` folders: armorsets 7, augmentation 166, cubics 9,
fishing 3, pets 12.

What the server sends is already resolved:
- `Attack` carries the target, the damage, a flags byte (critical, miss,
  shield, soulshot) and positions. The client plays the swing and shows the
  number.
- `UserInfo` carries the player's STR, DEX, CON, INT, WIT and MEN, max and
  current HP and MP, level, exp, sp, load and the item ID in every paperdoll
  slot.
- `StatusUpdate` carries an object ID and a list of attribute and value pairs.
  This is how a target's HP bar moves.
- `MagicSkillUse` carries caster, target, skill ID and level, cast time and
  reuse. The client looks up the visuals in `skillgrp.dat`.

Consequences for this client:
- The converted client is the same whether the server is Mobius or SpacetimeDB.
- `GameWorldAdapter` is the only way gameplay state enters the client. A
  Mobius adapter turns packets into adapter events. A SpacetimeDB adapter turns
  table subscriptions into the same events. Changing servers means writing a
  second adapter.
- Tooltips must read stats from the server side, not from the `.dat` display
  copies. With different rules, the copies in `weapongrp`, `armorgrp` and
  `skillgrp` would show wrong numbers.
- A SpacetimeDB server needs its own data. The Mobius datapack is plain XML and
  can be exported once into its tables as starting values (NPC templates,
  skills, items, spawns, the XP table). `Formulas.java` only needs porting if
  the L2 combat math stays.
- Some behavior stays in the client whatever the server: animation, camera, UI,
  choosing which footstep or hit sound plays, effect timing, and smoothing
  movement between server updates.

## 2. What the client contains

### system/

| Type | Files | Size |
|---|---|---|
| `.dat` tables | 40 | 1.7 MB |
| `interface.xdat` (UI layout) | 1 | 0.7 MB |
| `.u` script packages | 25 | 79.5 MB |
| `.int` text files | 23 | 1.2 MB |
| `.dll` | 29 | 54.3 MB |
| `.gly` fonts | 5 | 0.5 MB |

### The 40 data tables

| Area | Tables |
|---|---|
| Items | itemname-e, weapongrp, armorgrp, etcitemgrp, optiondata_client-e (augment options), variationeffectgrp-e |
| NPCs and monsters | npcgrp, npcname-e, mobskillanimgrp, raiddata-e |
| Skills | skillgrp, skillname-e, skillsoundgrp |
| Characters and appearance | chargrp, classinfo-e, hairgrp, hairaccessarygrp, hairaccessorylocgrp, helmetgrp |
| Quests, crafting, dyes | questname-e, recipe-c, hennagrp-e, symbolname-e |
| World and places | zonename-e, huntingzone-e, castlename-e, staticobject-e, musicinfo, entereventgrp |
| Text | sysstring-e, systemmsg-e, actionname-e, commandname-e, gametip-e, eula-e, obscene-e, creditgrp-e |
| Login and servers | servername-e, logongrp, clientdata |

Record counts from Elbera's `tools/dat/extract_gamedata.py` run on this client:

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

sysstring-e and systemmsg-e report the same count. That looks like a parser
quirk and needs a check before anything depends on it. The other 29 tables
have not been decoded to JSON yet.

### Content folders

| Folder | Files | Size |
|---|---|---|
| textures | 387 | 1,448 MB |
| systextures | 70 | 1,841 MB |
| staticmeshes | 212 | 1,526 MB |
| animations | 20 | 748 MB |
| sounds | 26 | 545 MB |
| music | 250 | 239 MB |
| voice | 46 | 29 MB |

Exporting every `.utx` package with UE Viewer gives 33,410 textures in 433
packages.

### Maps

`maps/` holds 163 `.unr` files. 153 are world tiles named `XX_YY` on a grid of
X 15 to 26 and Y 10 to 26, so 153 of the 204 cells exist. The other 10 are
`Lobby` (the character select scene), `entry`, `skylevel`, `ship_position` and
`Auto0` to `Auto5`. Nobody has checked yet what the Auto maps are.

All 153 tiles share one file format, so the world converts with one set of
tile-general converter steps, not a job per area. This repo's 20_20 result is
not that yet. It is a chain of hand-qualified steps, and several of them are
limited to 20_20 today: the terrain UV rule, the Brush397 BSP floor and the
surrounding terrain coverage. Each becomes a tile-general step (decision 10).
Starting input for the world lane:
[research/genericity-audit-20261108.md](research/genericity-audit-20261108.md)
(warning 7).
Elbera's `tools/world/convert.py 17_25`, a different pipeline, converted
Talking Island in a few minutes and placed 987 props.

### UI

`interface.xdat` decodes to 248 top-level records and 2,638 controls. About 140
of the records are real windows (StatusWnd, InventoryWnd, ChatWnd, ShopWnd and
so on). The rest are shared fragments such as bar backgrounds.

This client's layout is not the edition Elbera was written against. Its status
window uses `StatusLeftTex`, `CPBarTex`, `HPBarTex` and `MPBarTex` with a
portrait panel, where Elbera expects `StatusWndLeftTex` and `CPBar`. Code that
hardcodes control names breaks on this client. Read layouts from the decoded
tree instead.

## 3. How the files are scrambled and decoded

Each protected file starts with a 28-byte UTF-16 header `Lineage2VerNNN`. The
number says which method was used.

| Header | Used for | Method |
|---|---|---|
| 413 | `system/*.dat`, `l2.ini` | RSA blocks, then zlib |
| 111 | maps `.unr`, animations `.ukx` | every byte XOR `0xAC` |
| 121 | textures `.utx` | XOR with one byte derived from the file name |
| none | `interface.xdat` | plain |

For a 413 file the steps are these. Skip the header. Read the body as 128-byte
blocks. Run each block through one RSA modular exponentiation with the known
key; byte 3 of the result says how many payload bytes it carries (at most 124).
Join the payloads, read the first 4 bytes as the uncompressed size and inflate
the rest with zlib. The output is the raw table, which still needs a parser that
knows each table's record layout. Elbera's `tools/l2lib/l2dat.py` and
`tools/dat/*.py` know the Interlude layouts.

The key is not a secret. The client decrypts these files every time it starts,
so the key ships inside it, and the modding community published it long ago.
There are two known keys, NCSoft's original and a community key that modded
clients use so tools like L2FileEdit can re-save edited files. This client is a
modded Mobius build, so decoders should try both.

Sources for the keys and the method:
- open-l2encdec at `E:\linegen\tools\open-l2encdec-source`, commit
  `6f33578252389dfac2824c0132ce1d015cff04e5`, file `src/l2encdec.cpp`.
- A decode-only Python stand-in at `E:\Lineage2Elbera\tools\bin\l2encdec.py`.
  It decodes `npcname-e.dat` to 186,592 bytes, the same result as the
  reference.

Most files end with a 20-byte tail that carries a CRC32. Some files that modding
tools re-saved have no tail; `maps/17_25.unr` in this client is one. Strip the
tail only when its CRC matches the data before it, otherwise the last 20 bytes
of real data are lost.

The tables matter because the server sends numbers, not content. A system
message arrives as an ID and the text comes from `systemmsg-e.dat`. An NPC
spawn names an NPC ID, and `npcgrp.dat` says which mesh, textures and
animations to use. A skill cast names a skill ID, and `skillgrp.dat` gives the
icon, animation and effect. Decode the tables once per client build into JSON
and let the browser load the JSON.

## 4. The network protocol

This is what a Mobius adapter has to speak. A SpacetimeDB adapter needs events
with the same meaning, not the same bytes. aCis has 208 client-to-server and
282 server-to-client packet classes. Mobius has 215 and 279. Those are raw
`.java` counts, so a few base classes are included (L2GameClientPacket,
DummyPacket and two Abstract* helpers on the client side).

Every client request, grouped by system:

| # | System | Client requests | n |
|---|---|---|---|
| 1 | Login, character select, session | AuthLogin, SendProtocolVersion, RequestNewCharacter, RequestCharacterCreate, RequestCharacterDelete, CharacterRestore, RequestGameStart, EnterWorld, RequestRestart, Logout, GameGuardReply, SendTimeCheck. Login server: RequestAuthLogin, RequestServerList, RequestServerLogin, AuthGameGuard | 12+4 |
| 2 | Movement | MoveBackwardToLocation, ValidatePosition, StartRotating, FinishRotating, CannotMoveAnymore, RequestChangeMoveType, RequestChangeWaitType, Appearing | 8 |
| 3 | Boats | RequestGetOnVehicle, RequestGetOffVehicle, RequestMoveToLocationInVehicle, CannotMoveAnymoreInVehicle | 4 |
| 4 | Targeting, combat, death, duels | Action, AttackRequest, RequestTargetCancel, RequestActionUse, RequestRestartPoint, RequestDuelStart, RequestDuelAnswerStart, RequestDuelSurrender | 8 |
| 5 | Skills, learning, skill enchant, shots | RequestMagicSkillUse, RequestExMagicSkillUseGround, RequestSkillList, RequestAcquireSkill, RequestAcquireSkillInfo, RequestExEnchantSkill, RequestExEnchantSkillInfo, RequestAutoSoulShot | 8 |
| 6 | Inventory, enchanting, augmentation | RequestItemList, UseItem, RequestUnEquipItem, RequestDropItem, RequestDestroyItem, RequestCrystallizeItem, RequestEnchantItem, RequestConfirmTargetItem, RequestConfirmRefinerItem, RequestConfirmGemStone, RequestRefine, RequestConfirmCancelItem, RequestRefineCancel | 13 |
| 7 | NPC dialogs (HTML) | RequestBypassToServer, RequestLinkHtml, DlgAnswer | 3 |
| 8 | NPC shops, multisell, warehouse, freight | RequestBuyItem, RequestSellItem, RequestPreviewItem, MultiSellChoose, SendWarehouseDepositList, SendWarehouseWithdrawList, RequestPackageSend, RequestPackageSendableItemList | 8 |
| 9 | Player trade | TradeRequest, AnswerTradeRequest, AddTradeItem, TradeDone | 4 |
| 10 | Private stores | SetPrivateStoreListSell, SetPrivateStoreListBuy, SetPrivateStoreMsgSell, SetPrivateStoreMsgBuy, RequestPrivateStoreSell, RequestPrivateStoreBuy, RequestPrivateStoreManageSell, RequestPrivateStoreManageBuy, RequestPrivateStoreQuitSell, RequestPrivateStoreQuitBuy | 10 |
| 11 | Crafting and craft shops | RequestRecipeBookOpen, RequestRecipeBookDestroy, RequestRecipeItemMakeInfo, RequestRecipeItemMakeSelf, RequestRecipeShopListSet, RequestRecipeShopMakeInfo, RequestRecipeShopMakeItem, RequestRecipeShopManageList, RequestRecipeShopManagePrev, RequestRecipeShopManageQuit, RequestRecipeShopMessageSet | 11 |
| 12 | Chat, social, friends, commands | Say2, RequestSocialAction, RequestFriendInvite, RequestAnswerFriendInvite, RequestFriendList, RequestFriendDel, RequestSendL2FriendSay, RequestBlock, RequestEvaluate, RequestGiveNickName, RequestRecordInfo, RequestUserCommand | 12 |
| 13 | Party | RequestJoinParty, RequestAnswerJoinParty, RequestWithdrawParty, RequestOustPartyMember, RequestChangePartyLeader | 5 |
| 14 | Party matching rooms | RequestListPartyWaiting, RequestJoinPartyRoom, AnswerJoinPartyRoom, RequestAskJoinPartyRoom, RequestManagePartyRoom, RequestDismissPartyRoom, RequestOustFromPartyRoom, RequestWithdrawPartyRoom, RequestListPartyMatchingWaitingRoom, RequestExitPartyMatchingWaitingRoom | 10 |
| 15 | Command channel | RequestExAskJoinMPCC, RequestExAcceptJoinMPCC, RequestExOustFromMPCC, RequestExMPCCShowPartyMembersInfo | 4 |
| 16 | Clan | RequestJoinPledge, RequestAnswerJoinPledge, RequestWithdrawPledge, RequestOustPledgeMember, RequestPledgeInfo, RequestPledgeMemberList, RequestPledgeMemberInfo, RequestPledgeMemberPowerInfo, RequestPledgePower, RequestPledgePowerGradeList, RequestPledgeReorganizeMember, RequestPledgeSetAcademyMaster, RequestPledgeSetMemberPowerGrade, RequestPledgeCrest, RequestSetPledgeCrest, RequestExPledgeCrestLarge, RequestExSetPledgeCrestLarge | 17 |
| 17 | Clan wars | RequestStartPledgeWar, RequestReplyStartPledgeWar, RequestStopPledgeWar, RequestReplyStopPledgeWar, RequestSurrenderPledgeWar, RequestReplySurrenderPledgeWar, RequestSurrenderPersonally, RequestPledgeWarList | 8 |
| 18 | Alliance | RequestJoinAlly, RequestAnswerJoinAlly, AllyLeave, AllyDismiss, RequestDismissAlly, RequestAllyInfo, RequestAllyCrest, RequestSetAllyCrest | 8 |
| 19 | Sieges, castles, clan halls | RequestJoinSiege, RequestConfirmSiegeWaitingList, RequestSiegeAttackerList, RequestSiegeDefenderList | 4 |
| 20 | Manor | RequestManorList, RequestBuySeed, RequestBuyProcure, RequestSetSeed, RequestSetCrop, RequestProcureCropList | 6 |
| 21 | Pets, summons, mounts | RequestPetUseItem, RequestGiveItemToPet, RequestGetItemFromPet, RequestPetGetItem, RequestChangePetName | 5 |
| 22 | Quests and tutorial | RequestQuestList, RequestQuestAbort, RequestTutorialClientEvent, RequestTutorialLinkHtml, RequestTutorialPassCmdToServer, RequestTutorialQuestionMark | 6 |
| 23 | Shortcuts and macros | RequestShortCutReg, RequestShortCutDel, RequestMakeMacro, RequestDeleteMacro | 4 |
| 24 | Henna | RequestHennaEquip, RequestHennaUnequip, RequestHennaItemList, RequestHennaItemInfo, RequestHennaUnequipList, RequestHennaUnequipInfo | 6 |
| 25 | Olympiad, heroes, observer | RequestOlympiadMatchList, RequestOlympiadObserverEnd, ObserverReturn, RequestWriteHeroWords | 4 |
| 26 | Seven Signs | RequestSSQStatus | 1 |
| 27 | Fishing | RequestExFishRanking. The rest is server-pushed (ExFishingStart, ExFishingStartCombat, ExFishingHpRegen, ExFishingEnd) | 1 |
| 28 | Cursed weapons, raid bosses | RequestCursedWeaponList, RequestCursedWeaponLocation, RequestGetBossRecord | 3 |
| 29 | Community board | RequestShowBoard, RequestBBSwrite | 2 |
| 30 | Minimap and radar | RequestShowMiniMap | 1 |
| 31 | Petitions and GM tools | RequestPetition, RequestPetitionCancel, PetitionVote, RequestGMCommand, RequestGmList, SendBypassBuildCmd, SnoopQuit | 7 |
| 32 | PC cafe | RequestPCCafeCouponUse | 1 |

The server-to-client packets mirror these groups. Some exist only server-side:
camera (SpecialCamera, CameraMode, NormalCamera), environment (Earthquake,
ExRedSky, SunRise, SunSet), doors, static objects and the monster race
(MonRaceInfo).

Behind those packets Mobius runs 343 quest scripts, 553 AI, event and boss
scripts, 102 spawn lists, 23 zone files, geodata and about 15,800 NPC dialog
HTML files.

## 5. Parts, layers and current state

Layer 0 is foundations and 4 is polish. The side column says where the work
sits: Cv converter, Cl client runtime, Ad server adapter. The state column is
this repo on 2026-11-07, taken from the code, `docs/ROADMAP.md` and the
`.planning` continuation files.

| # | Part | Size | Layer | Side | State on 2026-11-07 |
|---|---|---|---|---|---|
| 1 | Asset and `.dat` decoders | 40 .dat, 25 .u, 435 .utx, 212 .usx, 20 .ukx, 163 .unr | 0 | Cv | UE Viewer route works on a pinned input snapshot. 11 of 40 tables decoded to JSON (by Elbera's tools) |
| 2 | Offline sandbox | spawn, equip, cast, open any window without a server | 0 | Cl | `MockWorldAdapter` and `NativeSliceAdapter` exist; no by-ID spawning yet |
| 3 | World: terrain, buildings, props | 153 tiles | 1 | Cv+Cl | 20_20 and the Talking Island bundles |
| 4 | Player characters | 5 races, 2 genders, fighter and mystic | 1 | Cv+Cl | Human fighters native. Human mystic export in progress |
| 5 | UI framework and windows | about 140 windows, 2,638 controls | 1 | Cv+Cl | Development sheet only |
| 6 | NPCs and monsters | 6,519 npcgrp rows, about 554 meshes | 2 | Cv+Cl | 1 (Greater Musveren) |
| 7 | Items and equipment on the body | 9,238 items, about 390 weapon and 1,355 armor meshes | 2 | Cv+Cl | Not seen in the code |
| 8 | Skill visuals and effects | about 2,700 skills, 864 effect classes, 3,709 emitters | 2 | Cv+Cl | Power Strike in progress |
| 9 | Audio | 5,269 sounds, 250 music files, 45 voice files | 2 | Cv+Cl | 20_20 footsteps, ambience and music in progress |
| 10 | Minimap and world map | MinimapCtrl, zonename, huntingzone | 2 | Cv+Cl | Not started |
| 11 | Movement display and geodata | geoengine, 547 doors | 2 | Cl | Synthetic movement over `WorldNavigation`. No geodata files on DATABASE-PC |
| 12 | Server adapter: login and world entry | 5 + 9 login packets, Lobby map | 3 | Ad | Not started |
| 13 | Server adapter: event dispatch | 215 / 279 packets on Mobius | 3 | Ad | Not started |
| 14 | Combat and stats display | `Attack`, `StatusUpdate`, `UserInfo` | 3 | Cl+Ad | Fighter versus Musveren demo |
| 15 | NPC dialogs | about 15,800 HTML files | 4 | Cl+Ad | Needs part 13 |
| 16 | Shops, trade, crafting | 687 buy lists, 85 multisells, 871 recipes | 4 | Cl+Ad | Needs part 13 |
| 17 | Party, clan, chat, friends | systems 12 to 18 in section 4 | 4 | Cl+Ad | Needs part 13 |
| 18 | Quests and tutorial windows | 343 server scripts | 4 | Cl+Ad | Needs part 13 |
| 19 | Sieges, Olympiad, bosses, Seven Signs, GM tools, boats | 9 castles, 44 clan halls, 33 admin handlers | 4 | Cl+Ad | Needs part 13 |

## 6. Order of work

This follows the owner decision above: the full converted client first, the
server adapter after.

Before stage A, the integration thread takes Babylon.js Editor off the build
and runtime path (decision 11) and the full-tree hash lock proves the E: copy
equal to IMPORTA-PC (decision 5). Lanes start only after both.

Stage A converts the whole client and proves it in the offline sandbox. The
items are grouped by lane in section 8 and run in parallel. UI starts on day
one, not after skills.
1. Write the combined inventory of all 40 `.dat` tables (table, route, record
   count, status), then decode the rest to JSON and fix the sysstring/systemmsg
   count. The local pinned descriptor route wins where it covers a table, and
   Elbera decoders fill the rest behind an adapter (decision 7).
2. Convert all 153 tiles: geometry (terrain, static meshes, BSP) with the
   tile-general UV rule, plus sky, ambient and placement audio. A tile that
   fails a step is listed as a gap (decision 10). Start from
   [research/genericity-audit-20261108.md](research/genericity-audit-20261108.md)
   (warning 7).
3. All player characters, every race, gender and class.
4. NPCs and monsters from npcgrp, item and armor meshes.
5. Skill visuals and sounds bound through skillgrp, skillsoundgrp and npcgrp.
6. UI windows read from the decoded interface layout, filled with sandbox data.

The sandbox is the acceptance tool for stage A. It can walk any tile, spawn any
NPC by ID, equip any item, play any skill's visual and sound and open any
window. Each part is checked there against the real L2.exe on IMPORTA-PC.
The stage A bar per part is: converted, loads in the sandbox, and passes a
side-by-side screenshot or listen check. The fixed thresholds wait for the
polish stage (decision 6).

Stage B plugs in a server through `GameWorldAdapter`:
1. Mobius adapter: login, character select, world entry, then event dispatch
   one packet type at a time.
2. Combat, dialogs, shops, social and quest windows, which mostly display
   server data.
3. If Mobius does not fit the gameplay loop, a SpacetimeDB adapter emits the
   same adapter events from its tables. Mobius stays useful as the reference for
   which events exist, their order and their timing.

### Transport for a Mobius adapter

A browser cannot open raw TCP to ports 2106 and 7777, so stage B needs a
WebSocket hop on a server. The recommendation (not yet decided) is a dumb
relay: the browser runs the L2 crypto and packet code in TypeScript inside the
Mobius adapter, and the relay only forwards bytes between one WebSocket and one
TCP connection. A smart gateway that translates packets to JSON, as Elbera
does, doubles the work for every packet type and is thrown away if the server
becomes SpacetimeDB. Latency is about the same either way.

Mobius sees the relay's IP address, never the player's. The relay gets the
player's address from the WebSocket connection, or from `CF-Connecting-IP`
when the page is served through Cloudflare. Mobius has no PROXY protocol
support (no match in its Java source), so passing the real address on would
need a small server patch. Per-IP settings in this Mobius build:

| File | Setting | Value | Effect behind a relay |
|---|---|---|---|
| login `Server.ini` | LoginTryBeforeBan, LoginBlockAfterBan | 5, 900 s | 5 wrong passwords from any player block the relay address, so every player, for 15 minutes |
| login `Server.ini` | EnableFloodProtection, FastConnectionLimit, FastConnectionTime, NormalConnectionTime, MaxConnectionPerIP | True, 15, 350, 700, 50 | Many players logging in at once count as one address |
| game `DualboxCheck.ini` | DualboxCheckMaxPlayersPerIP | 0 (off) | No effect while off |

So the relay must keep its own per-player limits and login-failure bans before
Mobius sees anything, log which account came from which address, and only
connect to the configured Mobius ports.

Native-parity research on one detail at a time goes to a polish list, for
example the footstep rules recovered from ALAudio.dll. The open slice items go
there too: stair routing, the upper-landing roof camera, surface footsteps and
specialized attack sounds, unless one blocks the sandbox. The list comes back
once stage A has every tile and character in the sandbox, together with the
fixed thresholds.

## 7. Working with several agents at once

Commit first. Parallel agents work from git branches and worktrees, and they
can only start from committed code.

Contracts the integration lane owns:
- Output contract. Converted assets stay `.l2asset` packages plus the runtime
  catalog (decision 8). Each package's `asset.json` records its source path
  and SHA-256, the client build, the converter version, and the units and
  handedness of its route. The client loads assets only through the catalog.
  `recipes/native-inputs.lock.json` stays a lock of input files only.
- Build path. `pnpm dev` and `pnpm build` do not run Babylon.js Editor
  packing or its repair scripts, and the native world loads from the catalog
  with no Editor scene (decision 11). `stage-webgpu-compilers` stays in the
  build, because the WebGPU engine loads glslang and twgsl from it at runtime.
- Adapter boundary. The five methods of `GameWorldAdapter` stay frozen, and
  gameplay state enters the client only through it. Below it, each adapter
  turns its server's messages into typed records with no Babylon types.
- Golden fixtures. Small hash-pinned asset slices now, captured Mobius packets
  in stage B, so tests run without the full client. Portable tests run in CI,
  tests that need the private client run locally.
- One evidence doc per part, `docs/parts/<part>/EVIDENCE.md`, kept under about
  30 KB.
- Folder ownership in `.planning/lanes.json`. Converter agents own
  `scripts/**` and `recipes/**`, UI agents own `src/ui/**`, adapter agents own
  `src/world/protocol/**`. Only the integration lane edits README,
  `.planning/ROADMAP.md`, `.planning/STATE.md` and the status files.

Working rules:
- One part per thread per branch, named `<part>/<slug>`, for example
  `world/batch-tiles`.
- Parallel work runs in lanes on DATABASE-PC, next to the main checkout.
  `lane.ps1 new l2-browser-client <slug>` creates `C:\laragon\www\l2b-<slug>`
  on branch `lane/<slug>` from the main checkout's HEAD, so only committed work
  reaches a lane. Each lane has its own `node_modules` and dev server port, and
  `public\l2` is a junction to the main checkout's native store. At most 3
  lanes exist at once, and `lane new` and `lane rm` refuse Thu 19:00-21:30 and
  Sun 10:00-14:00 because DATABASE-PC carries the livestream relay.
- Scripts that write the native store run only in the main checkout:
  `assets:*`, `world:stage`, `assets:stage`, `stage_*`, `derive-*`,
  `migrate-*`. A converter lane writes to its own output folder, and the
  integration lane stages the result in the main checkout.
- Shared memory stays small. `STATUS.md` has one line per part, rewritten in
  place. `DECISIONS.md` is append-only, one dated line per decision. Per-part
  notes live in the part folder.
- New requests wait in `STATUS.md` until the next brief. Redirecting a running
  workflow wastes its work.
- Merge one branch at a time. A contract change is its own branch and merges
  first.

Lane support for this repo was still uncommitted in the fleet repo on
2026-11-08, so DATABASE-PC could not run `lane` yet. Until it can, a plain
`git worktree` is safe for this repo, which has no nested repositories and no
database.

## 8. How many agents

The limit is review and merge speed, not how many agents start. Browser tests
use SwiftShader and are CPU-heavy. The lane tool allows 3 lanes per repo, so
the shape is the integration thread in the main checkout plus up to 3 lane
threads. Each lane thread can fan out its own subagents, for example GSD's wave
parallelism, so the agent counts below are totals across those threads.

| Phase | Threads | Work |
|---|---|---|
| 0, now | Integration plus up to 3 lanes | Integration: commit, contracts, STATUS.md, Editor off the build path, sandbox shell. Lanes: `.dat` inventory, full-tree hash lock |
| 1, stage A breadth | Integration plus 3 lanes | L1 world: 153 tiles, streaming and LOD, minimap. L2 actors: characters, NPCs and monsters, items and equipment, animations, sounds, skill visuals. L3 data and UI: 40 `.dat` tables, `interface.xdat` windows, sandbox controls |
| 2, stage A checks | Integration plus 3 lanes | One checker per lane (world, actors, data and UI) comparing the sandbox with L2.exe on IMPORTA-PC. Fixes go back into the shared converters |
| 3, stage B | Integration plus up to 3 lanes | Adapter login and world entry, adapter event dispatch, combat and stats display with dialogs and shops |

That is 4 threads at most, integration plus 3 lanes, in every phase (decision
9). Each lane thread can fan out its own subagents, so the number of agents
can be higher than the number of threads. The number of open branches cannot.
One agent per part (19) would produce more branches than one person can
review.

## 9. What to take from Elbera

Elbera is a three.js browser port of Interlude against aCis 409
(`C:\laragon\www\Lineage2Elbera` on IMPORTA-PC, `E:\Lineage2Elbera` on
DATABASE-PC, both at `12c9656`).

For stage A, ranked by value for the effort:
1. Decoders with no build pins, for the tables the local descriptor route
   lacks (decision 7): `tools/l2lib`, `tools/dat/*.py` (the table
   layouts), `tools/xdat/parse_xdat.py`, `tools/dat/export_quests.py`.
2. World conversion: `tools/world/convert.py`, `bsp.py`, `lightmap.py`,
   `bsplight.py`.
3. Renderer-free modules: `geodata.js`, `terrain-collision.js`,
   `cylinder-collision.js`, `moveactor-arithmetic.js`, `nativecoords.js`.

For stage B:
1. Gateway crypto and framing: `gateway/src/crypt.js`, `blowfish.js` with
   `tables.js`, `l2io.js` and `loginclient.js`. Re-check against stock Mobius
   before relying on it.
2. Packet decoders in `gateway/src/gameclient.js` (90 KB). Port one packet type
   at a time behind a `GatewayWorldAdapter` and convert L2 units (about a
   centimetre, Z up) to metres and Y up at that boundary.
3. Offline protocol tests: `editor/world/mock_gateway.js` and the 48 files in
   `gateway/test`, rebuilt around captured Mobius packets.

`docs/LINEAGE2ELBERA_REUSE_AUDIT.md` covered 406 paths under `tools/` and none
under `gateway/` or `editor/`. Audit those two folders before porting from them.

Leave these behind:
- Elbera's native verifiers. They check instruction addresses in Engine.dll
  `07b24af4...`, and this client's Engine.dll is `4dd2f63c...`. 62 tool files
  carry such pins, and on this client they refuse to run. The method is worth
  copying, re-pinned to this build.
- `deploy/server-mods/elbera-acis.patch` and the gateway features that depend
  on it, plus the deviceId-based auto login in `gateway/src/bridge.js`.
- The three.js runtime and any UI code that hardcodes control names.

## 10. Why Elbera looked fast

Its public history is 290 commits in about nine weeks, with 75 pull requests
merged in about 56 hours at the end. Most of that burst published work done
earlier on a private branch. Public history is quiet from 2026-08-10 to
2026-09-26, then one commit adds 1,108 files.

What worked:
- Every branch has the same shape: a runtime module, its test, a verifier and
  an evidence doc. Done means the same thing every time.
- `tools/audit/unsourced.py --check` fails when the count of unsourced literals
  rises above a baseline, so invented values cannot creep in.
- Tests are split by input. CI runs synthetic fixtures only and anything that
  needs the private client runs locally.

What it cost:
- Hub files serialized the work. `progress.md` was touched by 74 of 75 pull
  requests and `tools/README.md` by 71, so two branches at once always
  conflicted.
- About 1.3 MB of prose, with `progress.md` alone at 271 KB.
- Verified is not the same as wired in. Its 19 collision modules pass their
  checks, but nothing in the running game imports them yet.

This repo has the same risk in a different shape: 48 continuation prompts in
`.planning/` and a 122 KB `docs/VERIFICATION.md`. Section 7 is the fix.
