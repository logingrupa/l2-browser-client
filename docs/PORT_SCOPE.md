# Port scope and work split

Measured on 2026-11-07 from the client at `E:\Lineage2-client` on DATABASE-PC
(Engine.dll SHA-256 `4dd2f63c...`), the aCis 409 source at
`E:\Lineage2Elbera\server` and the L2J Mobius CT_0 Interlude source at
`E:\linegen\source\L2J_Mobius\L2J_Mobius_CT_0_Interlude`. Counts are file or
record counts from those trees. Where a line is a judgement rather than a
count, it says so.

The goal this document serves is a browser client that covers everything the
Interlude client does, talking to stock L2J Mobius. The server side already
exists. Every part below is about the client: converting its files and
rebuilding its behavior in the browser.

## 1. What the client contains

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
quirk and needs a check before anything depends on it.

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

All 153 tiles share one file format. Converting the world is one pipeline run
over every tile, not a job per area. Elbera's `tools/world/convert.py 17_25`
converted Talking Island in a few minutes and placed 987 props.

### UI

`interface.xdat` decodes to 248 top-level records and 2,638 controls. About 140
of the records are real windows (StatusWnd, InventoryWnd, ChatWnd, ShopWnd and
so on). The rest are shared fragments such as bar backgrounds.

This client's layout is not the edition Elbera was written against. Its status
window uses `StatusLeftTex`, `CPBarTex`, `HPBarTex` and `MPBarTex` with a
portrait panel, where Elbera expects `StatusWndLeftTex` and `CPBar`. Any code
that hardcodes control names breaks on this client. Read layouts from the
decoded tree instead.

## 2. How the files are scrambled and decoded

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

## 3. The network protocol

The protocol is the exact boundary of what the game does. aCis has 208
client-to-server and 282 server-to-client packet classes. Mobius has 215 and
279. Those are raw `.java` counts, so a few base classes are included
(L2GameClientPacket, DummyPacket and two Abstract* helpers on the client side).

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

Behind those packets the server runs 343 quest scripts, 553 AI, event and boss
scripts, 102 spawn lists, 23 zone files, geodata and about 15,800 NPC dialog
HTML files. Mobius does all of that already. The client only displays what the
server sends.

## 4. Parts, layers and current state

Layer 0 is foundations and 4 is polish. Each layer mostly waits on the one
before it. The state column is this repo on 2026-11-07, taken from the code,
`docs/ROADMAP.md` and the `.planning` continuation files.

| # | Part | Size | Layer | State on 2026-11-07 |
|---|---|---|---|---|
| 1 | Asset decoders | 40 .dat, 25 .u, 435 .utx, 212 .usx, 20 .ukx, 163 .unr | 0 | UE Viewer route works on a pinned input snapshot |
| 2 | Login and character select on Mobius | 5 + 9 login packets, Lobby map | 0 | Not started. `MockWorldAdapter` and `NativeSliceAdapter` only |
| 3 | Game packet dispatch | 215 / 279 packets | 1 | Not started |
| 4 | World: terrain, buildings, props | 153 tiles | 1 | 20_20 and the Talking Island bundles |
| 5 | Player characters | 5 races, 2 genders, fighter and mystic | 1 | Human fighters native. Human mystic export in progress |
| 6 | UI framework and windows | about 140 windows, 2,638 controls | 1 | Development sheet only |
| 7 | Movement and geodata | geoengine, 547 doors | 2 | Synthetic movement over `WorldNavigation`. No geodata files on DATABASE-PC |
| 8 | Items and equipment on the body | 9,238 items, about 390 weapon and 1,355 armor meshes | 2 | Not seen in the code |
| 9 | NPCs and monsters | 6,519 npcgrp rows, about 554 meshes | 2 | 1 (Greater Musveren) |
| 10 | Audio | 5,269 sounds, 250 music files, 45 voice files | 2 | 20_20 footsteps, ambience and music in progress |
| 11 | Minimap and world map | MinimapCtrl, zonename, huntingzone | 2 | Not started |
| 12 | Combat and stats display | server-driven | 3 | Fighter versus Musveren demo |
| 13 | Skills and effects | about 2,700 skills, 864 effect classes, 3,709 emitters | 3 | Power Strike in progress |
| 14 | NPC dialogs | about 15,800 HTML files | 3 | Needs part 3 |
| 15 | Shops, trade, crafting | 687 buy lists, 85 multisells, 871 recipes | 3 | Needs part 3 |
| 16 | Party, clan, chat, friends | systems 12 to 18 above | 4 | Needs part 3 |
| 17 | Quests and tutorial | 343 server scripts | 4 | Needs part 3 |
| 18 | Sieges, Olympiad, bosses, Seven Signs | 9 castles, 44 clan halls | 4 | Needs part 3 |
| 19 | GM tools, boats, misc | 33 admin handlers, 4 boat classes | 4 | Needs part 3 |

## 5. Order of work

My judgement, based on the table above: breadth before depth. Two tracks can
run side by side.

The converter track turns the whole client into browser assets:
1. Batch-convert all 153 tiles with the pipeline that already converts 20_20.
2. All player characters, every race, gender and class.
3. NPCs and monsters from npcgrp.
4. Item and armor meshes.
5. UI windows read from the decoded interface layout.

The protocol track makes it a game:
1. Login, character select and world entry on stock Mobius.
2. Packet dispatch into `GameWorldAdapter`, one packet type at a time.
3. Then the layer 3 and 4 systems, which mostly display server data.

Native-parity research on one detail at a time (the footstep rules recovered
from ALAudio.dll are an example) moves to a polish list. It comes back once the
converter track has every tile and character in the browser.

## 6. Working with several agents at once

Commit first. Parallel agents work from git branches and worktrees, and they
can only start from committed code.

Contracts the integration lane owns:
- Asset manifest. Every converted file records its source path and SHA-256, the
  client build, units (metres, Y up) and the converter version. The client
  loads assets only through the manifest. Extend
  `recipes/native-inputs.lock.json` instead of adding a second lock file.
- Protocol boundary. The five methods of `GameWorldAdapter` stay frozen. Below
  it, one pure decoder per packet type turns bytes into a typed record with no
  Babylon types.
- Golden fixtures. Captured Mobius packets and small hash-pinned asset slices,
  so tests run without the full client. Portable tests run in CI, tests that
  need the private client run locally.
- One evidence doc per part, `docs/parts/<part>/EVIDENCE.md`, kept under about
  30 KB.
- Folder ownership in `.planning/lanes.json`. Protocol agents own
  `src/world/protocol/**`, converter agents own `scripts/**` and `recipes/**`,
  UI agents own `src/ui/**`. Only the integration lane edits README, ROADMAP and
  the status files.

Working rules:
- One part per thread per branch, named `<part>/<slug>`, for example
  `proto/login-crypt`.
- This repo has no nested repositories and no database, so plain
  `git worktree` checkouts are safe here. Point every worktree at the same
  ignored artifact folders (`artifacts/native-parity`, `public/l2`) with a
  junction, so agents do not reconvert gigabytes each.
- Shared memory stays small. `STATUS.md` has one line per part, rewritten in
  place. `DECISIONS.md` is append-only, one dated line per decision. Per-part
  notes live in the part folder.
- New requests wait in `STATUS.md` until the next brief. Redirecting a running
  workflow wastes its work.
- Merge one branch at a time. A contract change is its own branch and merges
  first.

The `lane` tool from the fleet does not support this repo, and DATABASE-PC has
no fleet skills by design (`fleet.json`). Use plain worktrees here, or drive
DATABASE-PC threads from an IMPORTA-PC session that has the skills.

## 7. How many agents

The limit is review and merge speed, not how many agents start. Browser tests
use SwiftShader and are CPU-heavy, so plan on about 3 agents per machine.

| Phase | Agents | Lanes |
|---|---|---|
| 0, now | 2 | Integration (commit, contracts, STATUS.md), Elbera `gateway/` and `editor/` audit |
| 1 | 5 | Integration, converter: all tiles, converter: characters and NPCs, protocol: login and world entry, protocol: packet dispatch |
| 2 | 6 | Integration, converter, protocol, UI windows, items and equipment, movement once geodata exists |
| 3 | 6 | Integration, converter, dialogs and shops, party and clan and chat, skills for other classes, audio and minimap |

Steady state is 6, five workers plus integration, with a ceiling of 7. One
agent per part (19) would produce more branches than one person can review.

## 8. What to take from Elbera

Elbera is a three.js browser port of Interlude against aCis 409
(`C:\laragon\www\Lineage2Elbera` on IMPORTA-PC, `E:\Lineage2Elbera` on
DATABASE-PC, both at `12c9656`).

Ranked by value for the effort:
1. Gateway crypto and framing: `gateway/src/crypt.js`, `blowfish.js` with
   `tables.js`, `l2io.js` and `loginclient.js`. This is the biggest shortcut
   for part 2. Re-check it against stock Mobius before relying on it.
2. Offline protocol tests: `editor/world/mock_gateway.js` and the 48 files in
   `gateway/test`, rebuilt around captured Mobius packets.
3. Packet decoders in `gateway/src/gameclient.js` (90 KB). Port one packet
   type at a time behind a `GatewayWorldAdapter` and convert L2 units (about a
   centimetre, Z up) to metres and Y up at that boundary.
4. Renderer-free modules: `geodata.js`, `terrain-collision.js`,
   `cylinder-collision.js`, `moveactor-arithmetic.js`, `nativecoords.js`.
5. Decoders with no build pins: `tools/l2lib`, `tools/xdat/parse_xdat.py`,
   `tools/dat/export_quests.py`, `tools/world/lightmap.py`, `bsplight.py`.

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

## 9. Why Elbera looked fast

Its public history is 290 commits in about nine weeks, with 75 pull requests
merged in about 56 hours at the end. Most of that burst published work done
earlier on a private branch: public history is quiet from 2026-08-10 to
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
`.planning/` and a 122 KB `docs/VERIFICATION.md`. Section 6 is the fix.
