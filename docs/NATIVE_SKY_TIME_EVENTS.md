# Sky time, Seven Signs and cursed-weapon research

Research date: 2026-11-07. Follow-up to the user's sky-table screenshot.
Implementation tasks are in [`.todo`](../.todo).

The sky has evidence for both a daily clock and world-event environments.
`COLOR13 / T=12` is a time key within a preset. The four `timeenv` files are
named environment types, not four moon phases. A regular lunar-phase calendar
has not been established.

The evidence below distinguishes retained client data, historical descriptions
and public emulator behavior. It does not establish the exact executing
environment consumer in the pinned native client.

## Retained original client data

The [source packet](../artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/sky-environment-source-20261107/NATIVE_EVIDENCE.md)
and [converted inputs](../artifacts/native-parity/research/sky-environment-conversion-20261107/REPORT.md)
preserve the original bytes and offsets. Each time file starts with `[EnvType]`,
`EnvType=N`, then an original Korean comment. The declaration is at line 2,
original-file offset 39; the comment starts at line 3, offset 50.

- `timeenv0.int`, type 0: `기본` — default. Comment bytes: `3bb1e2babb`.
- `timeenv1.int`, type 1: `황혼` — dusk/twilight. Bytes: `3bc8b2c8a5`.
- `timeenv2.int`, type 2: `새벽` — dawn. Bytes: `3bbbf5baae`.
- `timeenv3.int`, type 3: `저주받은 검` — cursed sword.
  Bytes: `3bc0fac1d6b9dec0ba20b0cb`.

These selected comments decode as CP949. Raw bytes remain authoritative; this
interpretation does not change the converter's byte-preserving encoding policy.
The Dawn/Dusk names align with Seven Signs and the public packet states below;
the exact packet-to-file mapping still needs the native consumer.

`Env.int` declares `IsClock=true`, `StartTime=12`, `TimeRatio=6` at original-file
offsets 40, 54 and 68. It lists all four time files at offsets 506, 537, 568 and
599. Default sky rows run from T=0 through T=24 with Korean comments marking
night, dawn, morning, midday and sunset. Default T=0 and T=24 sky RGB are both
40/49/70; T=12 is 66/124/176. This supports hourly daily keys and an end-of-day
boundary, without proving interpolation or clock synchronization.

The cursed-sword table starts red, RGB 255/5/5. Its `[SkyBoxColor]` declares
`NUM=1` despite containing 25 physical rows. Consequently, interpolating all
physical rows may disagree with the original loader. Its T=24 value also differs
from T=0. Duplicate `[HSVTerrainLight]` sections in types 1 and 3 remain an
independent loader question. Preserve these cases rather than normalizing them.

## Historical world-event behavior

The accessible sources are fan-hosted copies of historical patch notes on
Lineage II Legacy, not a current NCsoft host.

[Chronicle 3, Seven Signs](https://legacy-lineage2.com/news/chronicle3_02.html),
section “5) Change in the Environment”:

> If Dawn wins, a solar eclipse occurs and the sky turns violet; if Dusk wins,
> an eye is created in the moon and the sky turns green.

This supplies direct historical support for the remembered moon/sky event.
The same notes describe the two-week competition and seal-effect cycle.

[Chronicle 5, Zariche](https://legacy-lineage2.com/news/chronicle5_08.html),
“Drop Rate and Possession Rules”:

> When Zariche is dropped in the world, the entire world becomes dark for a
> short period of time, the ground shakes, and a system message notifies all
> players that the demonic sword has been found.

This says dark and temporary; it does not specify a red color or exact duration.
The client preset and emulator packet are separate evidence for the red effect.

[Interlude, Blood Sword Akamanah](https://legacy-lineage2.com/news/interlude_07.html)
adds Akamanah and states that its creation, expiration and PvP rules are identical
to Zariche's. These pages establish the historical C3/C5/Interlude context;
they do not settle rendering, event priority or duration units.

## Public Interlude emulator behavior

The following L2jTesla links are pinned to commit
`adf72fe67c814122e9b2246d4ca1c38f6fd56bfc`. This is public emulator evidence,
not NCsoft client source. Its
[protocol admission](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/network/clientpackets/ProtocolVersion.java#L19-L25)
accepts 737/740/744/746, supporting an Interlude-era scope.

- [GameTimeTaskManager](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/taskmanager/GameTimeTaskManager.java#L26-L31)
  defines a four-real-hour game day: one game minute every ten real seconds.
  Its server-side night predicate is game time below 360 minutes, or
  00:00–06:00. This gameplay threshold does not define all visual transitions.
- [ClientSetTime](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/network/serverpackets/ClientSetTime.java#L5-L13)
  writes opcode `0xEC`, game-time minutes and rate `6`.
- [SSQInfo](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/network/serverpackets/SSQInfo.java#L6-L38)
  writes opcode `0xF8` plus a 16-bit state: 256 regular, 257 Dusk, 258 Dawn,
  259 red. `sendSky()` selects the winning cabal's Dawn/Dusk state only during
  seal validation; otherwise it selects regular. The presence of a red constant
  alone does not prove its caller or its connection to `timeenv3`.
- [SevenSignsManager](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/data/manager/SevenSignsManager.java#L1003-L1102)
  broadcasts the selected sky after period transitions. Ending validation resets
  to recruiting and sends the regular state through `SSQInfo.sendSky()`.
- [ExRedSky](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/network/serverpackets/ExRedSky.java#L7-L21)
  is a separate temporary-effect packet: `0xFE`, subcode `0x0040`, duration.
  [CursedWeapon.dropFromMob](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/model/entity/CursedWeapon.java#L417-L444)
  broadcasts `ExRedSky(10)` and an earthquake to every online player when the
  weapon drops. The duration value is exact; its native units and restoration
  behavior remain to be verified. The brief spawn effect is distinct from the
  weapon's possession lifetime.

An independently named Interlude fork corroborates initial state delivery:
[EnterWorld](https://github.com/Hl4p3x/L2JServer_C6_Interlude/blob/f3d3b329657c0f031dab107e6d4ceb5ddad0bea6/java/org/l2jserver/gameserver/network/clientpackets/EnterWorld.java#L185-L188)
sends Seven Signs sky during validation and
[later sends ClientSetTime](https://github.com/Hl4p3x/L2JServer_C6_Interlude/blob/f3d3b329657c0f031dab107e6d4ceb5ddad0bea6/java/org/l2jserver/gameserver/network/clientpackets/EnterWorld.java#L278-L284).
Its SignsSky default serialization contains commented-out output, so it should
not be used as the regular-state implementation contract.

## Moon phases and implementation boundary

All four original presets contain identical `[MoonColor]` and `[MoonScale]`
tuples keyed at T=0, 2, 3, 4 and 6. The scale values are 4.5, 3.5, 2.5, 3.5 and
4.5. They describe time-keyed color and apparent size, not a monthly phase.
No lunar-calendar/phase driver was found in these files. Such a driver could
exist elsewhere; the special Seven Signs eye/eclipse should not be generalized
into a waxing/waning simulation without evidence.

The supported implementation direction is to keep three inputs distinct:
game time, persistent event environment, and temporary sky effect. Native
interpolation, packet-to-file selection, temporary-effect priority/restoration,
and original sun/moon/star asset bindings remain open. Existing symbol leads
include `UL2NEnvManager::ChangeEnv`, `SetNTime`, `SetNTimeRatio`, `CalcEnvDelta`,
`GetMoonColor`, `GetMoonScale`, `GetMoonModifierInfo` and `ANMoon::Tick`; export
names/addresses do not establish their executing behavior.

[Research receipts](../artifacts/native-parity/research/sky-time-events-20261107/evidence.json)
retain source URLs, response hashes, selected excerpts and local source offsets.
Public pages were fetched directly with `User-Agent: Mozilla/5.0`; the Legacy
mirror returns HTTP 403 to the default Python user agent.
