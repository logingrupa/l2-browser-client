# Native sky

This doc covers the original 20_20 sky: source geometry, environment color
tables, time of day and world events, and the measured browser draw state.
Status and work order are in [STATE](../.planning/STATE.md) and
[ROADMAP](../.planning/ROADMAP.md). The sky is a frozen authored source snapshot.
It is not a matched native sky.

## Source sky geometry

The sky is a separate final-BSP sky room. The static-mesh map loader omits it,
so a dedicated extractor reads it. The source has 53 polygons, 182 vertices,
76 triangles and three original material and texture chains.

`scripts/native_sky.py` reads the exact hash-pinned `20_20.unr`, `Engine.u` and
the UE118/licensee0 `l2_skies.utx` branch. It does not relax the generic package
reader or change the BSP reader. The source report records native identities,
offsets, normals, UV projection, the material graph and the original BC1/BC3
blocks.

UE1/2 FColor archive order is RGBA, not BGRA. This is verified against the
retained pinned UEViewer archive. The stored background is RGBA
`(206,150,0,255)`. Saved ColorModifier exports 76/77/78 hold haze 149/228/255,
background 206/150/0 and clouds 151/192/255.

The source manifest is
`f7a0b5ef1463d0b5fe47b210585e00d6011be3c3e3bddfec76df0eb08042f80b`.
The source route `/?world=interlude` verifies and loads its self-contained GLB.
Live time-of-day tint replacement is unobserved.

## Coordinates and presentation

- Native XYZ converts to XZY metres. Original positions stay in the vertex
  buffers. One child transform subtracts the SkyZoneInfo0 position. The origin
  is never subtracted twice.
- A wrapper follows the browser camera. On the optional Editor route
  (`authored=1`) it also adapts the Z reflection; see
  [EDITOR_VIEWER](EDITOR_VIEWER.md).
- Sky draws before world geometry and writes no depth. World render groups are
  separated while the sky is live and restored on disposal. The sky is not part
  of world navigation or map bounds.
- Fog is off only for sky materials.
- Babylon's ordinary unlit glTF color and alpha and trilinear GPU mip sampling
  are used. Original compressed mip blocks are retained.
- Runtime adaptations restore authored state on teardown.

These are explicit browser background policies, not reconstructed native draw
rules.

The sky material serializes `gammaSpace=false` with `_useSRGBBuffer=true` and
`_alphaMode[2]`. Live GPU sRGB is true on the tested GTX 1060 (WebGL2), and the
shader has no GAMMAALBEDO. The unsupported-sRGB fallback is untested.

## Measured browser draw state

Original texture alpha survives and takes part in the draws on desktop and
mobile. WhiteRing alpha spans 0 to 255 and WhiteCloud 0 to 208. Active shaders
multiply sampled albedo alpha, and the bound GPU textures keep those alpha
histograms. A separate opacityTexture is not needed for this representation.

Measured browser states:

- Order: background, haze, clouds, then a depth/stencil clear before the world.
- Haze and cloud RGB blending: SRC_ALPHA / ONE_MINUS_SRC_ALPHA, FUNC_ADD. Alpha
  factors: ONE / ONE.
- Depth test LEQUAL, depth writes off, culling BACK/CCW.
- All four views ready, zero page or GL errors, terrain primary UV and UV2
  hashes unchanged.

These are browser states, not native blend rules. No missing-opacity or tint
repair follows from them. Saved root alpha 255 alone does not establish opaque
sampled layers. No gradient, recoloring, guessed time-of-day policy or duplicate
opacity binding is applied.

All three sky meshes draw on desktop and mobile WebGPU. The yellow sky, cloud
bands and hard blue horizon are an appearance gap, not missing geometry.

## Environment source tables

The offline converter exports the exact `Env.int` and `timeenv0..3` inputs,
decoded bytes, 1,681 ordered properties and 20 sky, haze and cloud tables with
500 physical color rows. Eleven tests pass. Clean, repeat and verify-only runs
keep identities and output. Duplicate sections and declared-versus-physical
count mismatches stay explicit. This is conversion, not a selected runtime sky
policy.

`scripts/stage-native-environment.mjs` stages the exact converted tables and
manifests as immutable local browser resources. It keeps all 20 tables, 500
rows and source anomalies.

### Row comparison

The dev sheet has a reversible comparison under **Dev → World › Sky → Load sky
color tables**. Choose a file and a physical color row, then **Compare selected
sky row**. Loading or selecting data leaves the stored colors active. **Restore
stored sky** reinstates the original material references.

The runtime verifies the table hash and matches exact source material
identities. It uses private PBR copies and changes only their RGB factor under
the existing browser convention. Authored colors, alpha, textures,
blend/depth/cull state and disk assets stay intact.

This is a source-data comparison, not a native time-of-day system.
`timeenv0.int` / `COLOR13` holds T=12 with background 66/124/176, haze
188/203/224 and cloud 255/255/255. It is not established as the native default.
CloudColor2/3 have no drawn counterpart in the three-part sky. No native policy
or parity is inferred from a selected row's appearance.

## Time of day and world events

The sky has evidence for a daily clock and for world-event environments.
`COLOR13 / T=12` is a time key inside a preset. The four `timeenv` files are
named environment types, not four moon phases. No regular lunar-phase calendar
is established.

The evidence below separates retained client data, historical descriptions and
public emulator behavior. None of it establishes the executing environment
consumer in the pinned native client.

### Retained client data

Each time file starts with `[EnvType]`, `EnvType=N`, then an original Korean
comment. The declaration is at line 2, original-file offset 39. The comment
starts at line 3, offset 50.

| File | Type | Comment | Meaning | Comment bytes |
|------|------|---------|---------|---------------|
| `timeenv0.int` | 0 | `기본` | default | `3bb1e2babb` |
| `timeenv1.int` | 1 | `황혼` | dusk | `3bc8b2c8a5` |
| `timeenv2.int` | 2 | `새벽` | dawn | `3bbbf5baae` |
| `timeenv3.int` | 3 | `저주받은 검` | cursed sword | `3bc0fac1d6b9dec0ba20b0cb` |

These comments decode as CP949. Raw bytes stay authoritative; this reading does
not change the converter's byte-preserving encoding policy. The Dawn and Dusk
names align with Seven Signs and the public packet states below. The exact
packet-to-file mapping needs the native consumer.

`Env.int` declares `IsClock=true`, `StartTime=12` and `TimeRatio=6` at
original-file offsets 40, 54 and 68. It lists the four time files at offsets
506, 537, 568 and 599.

Default sky rows run from T=0 to T=24. Korean comments mark night, dawn,
morning, midday and sunset. Default T=0 and T=24 sky RGB are both 40/49/70;
T=12 is 66/124/176. This supports hourly daily keys and an end-of-day boundary.
It does not prove interpolation or clock synchronization.

Source anomalies to preserve, not normalize:

- The cursed-sword table starts red, RGB 255/5/5.
- Its `[SkyBoxColor]` declares `NUM=1` but holds 25 physical rows. Interpolating
  all physical rows may disagree with the original loader.
- Its T=24 value differs from T=0.
- Types 1 and 3 have duplicate `[HSVTerrainLight]` sections. This is a separate
  loader question.

### Moon

All four presets have identical `[MoonColor]` and `[MoonScale]` tuples keyed at
T=0, 2, 3, 4 and 6. The scale values are 4.5, 3.5, 2.5, 3.5 and 4.5. They give
time-keyed color and apparent size, not a monthly phase. No lunar-calendar or
phase driver is in these files. One could exist elsewhere. The Seven Signs eye
and eclipse are not a basis for a waxing and waning simulation.

### Historical world events

The sources are fan-hosted copies of historical patch notes on Lineage II
Legacy, not a current NCsoft host.

[Chronicle 3, Seven Signs](https://legacy-lineage2.com/news/chronicle3_02.html),
section "5) Change in the Environment":

> If Dawn wins, a solar eclipse occurs and the sky turns violet; if Dusk wins,
> an eye is created in the moon and the sky turns green.

The same notes describe the two-week competition and the seal-effect cycle.

[Chronicle 5, Zariche](https://legacy-lineage2.com/news/chronicle5_08.html),
"Drop Rate and Possession Rules":

> When Zariche is dropped in the world, the entire world becomes dark for a
> short period of time, the ground shakes, and a system message notifies all
> players that the demonic sword has been found.

This says dark and temporary. It gives no red color and no exact duration. The
client preset and the emulator packet are separate evidence for the red effect.

[Interlude, Blood Sword Akamanah](https://legacy-lineage2.com/news/interlude_07.html)
adds Akamanah with creation, expiration and PvP rules identical to Zariche's.
These pages set the C3, C5 and Interlude context. They do not settle rendering,
event priority or duration units.

### Public Interlude emulator behavior

These L2jTesla links are pinned to commit
`adf72fe67c814122e9b2246d4ca1c38f6fd56bfc`. This is public emulator evidence,
not NCsoft client source. Its
[protocol admission](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/network/clientpackets/ProtocolVersion.java#L19-L25)
accepts 737/740/744/746, an Interlude-era scope.

- [GameTimeTaskManager](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/taskmanager/GameTimeTaskManager.java#L26-L31)
  defines a four-real-hour game day: one game minute every ten real seconds.
  Its server-side night predicate is game time below 360 minutes (00:00 to
  06:00). This gameplay threshold does not define all visual transitions.
- [ClientSetTime](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/network/serverpackets/ClientSetTime.java#L5-L13)
  writes opcode `0xEC`, game-time minutes and rate `6`.
- [SSQInfo](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/network/serverpackets/SSQInfo.java#L6-L38)
  writes opcode `0xF8` plus a 16-bit state: 256 regular, 257 Dusk, 258 Dawn,
  259 red. `sendSky()` selects the winning cabal's Dawn or Dusk state only
  during seal validation and regular otherwise. A red constant alone does not
  prove its caller or a link to `timeenv3`.
- [SevenSignsManager](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/data/manager/SevenSignsManager.java#L1003-L1102)
  broadcasts the selected sky after period transitions. Ending validation
  resets to recruiting and sends the regular state through `SSQInfo.sendSky()`.
- [ExRedSky](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/network/serverpackets/ExRedSky.java#L7-L21)
  is a separate temporary-effect packet: `0xFE`, subcode `0x0040`, duration.
  [CursedWeapon.dropFromMob](https://github.com/Elfocrash/L2jTesla/blob/adf72fe67c814122e9b2246d4ca1c38f6fd56bfc/src/main/java/dev/l2j/tesla/gameserver/model/entity/CursedWeapon.java#L417-L444)
  broadcasts `ExRedSky(10)` and an earthquake to every online player when the
  weapon drops. The duration value is exact; its native units and restoration
  are unverified. The brief spawn effect is distinct from the weapon's
  possession lifetime.

A separate Interlude fork corroborates initial state delivery:
[EnterWorld](https://github.com/Hl4p3x/L2JServer_C6_Interlude/blob/f3d3b329657c0f031dab107e6d4ceb5ddad0bea6/java/org/l2jserver/gameserver/network/clientpackets/EnterWorld.java#L185-L188)
sends the Seven Signs sky during validation and
[then ClientSetTime](https://github.com/Hl4p3x/L2JServer_C6_Interlude/blob/f3d3b329657c0f031dab107e6d4ceb5ddad0bea6/java/org/l2jserver/gameserver/network/clientpackets/EnterWorld.java#L278-L284).
Its SignsSky default serialization has commented-out output, so it is not the
regular-state contract.

### Implementation boundary

The client keeps three inputs separate:

1. Game time. The sandbox uses an explicit offline clock input; a server-time
   input follows in stage B. Local wall time stays separate from game time.
   Emulator reference: rate 6, one game day per four real hours.
2. Persistent event environment: the Seven Signs sky state (regular, Dawn
   validation, Dusk validation, reset at validation end), kept when entering
   the world.
3. Temporary sky effect: the cursed-weapon red sky, restored to the underlying
   Seven Signs state at the current game time, not to a fixed daytime row.

Native symbol leads: `UL2NEnvManager::ChangeEnv`, `SetNTime`, `SetNTimeRatio`,
`CalcEnvDelta`, `GetMoonColor`, `GetMoonScale`, `GetMoonModifierInfo` and
`ANMoon::Tick`. Export names and addresses do not establish executing behavior.

## Commands

From the project root in PowerShell:

```powershell
python scripts/native_sky.py --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-parity/research/native-sky-20261106/source-snapshot-pinned
if ($LASTEXITCODE -eq 0) { node scripts/stage-native-sky.mjs --source artifacts/native-parity/research/native-sky-20261106/source-snapshot-pinned --apply }
```

The extractor reproduces 21 files exactly and skips identical outputs. The
stager checks every source hash and writes an immutable `public/l2/skies/<hash>`
bundle. Remove `--apply` to inspect the plan without changing the project.
Editor scene staging belongs to the optional viewer; see
[EDITOR_VIEWER](EDITOR_VIEWER.md).

Environment tables:

```powershell
python -B scripts/export-native-environment.py --input-dir <copies> --output <fresh-dir>
```

The conversion report gives the exact retained input and output paths.

## Gaps tracked by requirements

- Sky conversion for all 153 tiles: WORLD-02.
- Yellow sky and hard blue horizon against L2.exe: CHECK-01, then POL-04. This
  needs a positive runtime color writer joined to exports 76/77/78, with
  conditions, time source and evaluated values, plus a native sky draw and
  resource join for color and alpha operations, blend/depth/cull state and
  order.

## Open

No requirement covers these items.

- Native consumers of ClientSetTime, SSQInfo and ExRedSky: time units,
  environment selection, duration units and restoration. The packet-to-timeenv
  mapping needs client evidence.
- Native table consumption and interpolation, the T=24 midnight wrap and
  transition behavior. Resolve timeenv3 `NUM=1` against 25 physical rows and
  the duplicate `[HSVTerrainLight]` sections before choosing a loader policy.
- The three separate inputs above (game time with a sandbox clock, Seven Signs
  sky state, temporary cursed-weapon effect), including overlap, retrigger and
  priority rules.
- Seven Signs sky state display. LATE-01 covers Seven Signs windows only.
- Original sun, moon, star, eclipse and eye assets: visibility, movement, color
  and scale. Investigate any lunar-phase driver before adding a lunar calendar.
- Native sky projection, fake-backdrop masking, blend and sidedness precedence,
  color-space behavior, cloud phase and lens flares.
- Channel order of the live color writer. The RGBA reading covers serialized
  archive bytes only.
- Unsupported-sRGB fallback for the sky material on the native route.
- Verification of dawn, dusk, night, noon and midnight continuity, Seven Signs
  changes, entry during an event and cursed-weapon start, end and overlap, on
  desktop and mobile. Keep the literal-row comparison available.

No native launch or capture is performed. Source extraction and browser
visibility cannot certify native pixel parity.

## Evidence

- Source sky: `artifacts/native-parity/research/native-sky-20261106/REPORT.md`
- Research question:
  `artifacts/native-parity/research/native-sky-20261106/RESEARCH_QUESTION.md`
- Opacity audit:
  `artifacts/native-parity/research/native-sky-20261106/opacity-audit/REPORT.md`
- Live opacity:
  `artifacts/native-parity/research/native-sky-20261106/live-opacity/2026-11-06T16-13-25-773Z/REPORT.md`
- Native sky note:
  `artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/sky-assist-20261106/REPORT.md`
- Environment source packet:
  `artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/sky-environment-source-20261107/NATIVE_EVIDENCE.md`
- Environment conversion:
  `artifacts/native-parity/research/sky-environment-conversion-20261107/REPORT.md`
- Row comparison:
  `artifacts/native-parity/research/sky-literal-comparison-20261107/REPORT.md`
- Browser sky draw:
  `artifacts/native-parity/editor/uv2-export-20261107/browser/REPORT.md`
- Time and events receipts:
  `artifacts/native-parity/research/sky-time-events-20261107/evidence.json`.
  It keeps source URLs, response hashes, excerpts and local source offsets.
  Public pages were fetched with `User-Agent: Mozilla/5.0`; the Legacy mirror
  returns HTTP 403 to the default Python user agent.
- Cloud opacity round trip on the optional Editor route:
  `artifacts/native-parity/editor/sky-save-20261106/REPORT.md`. Cloud alpha
  1 to 0.5 to 1; of the 50,700 pixels in the mobile sky region, zero differ
  from baseline after restore. The source-loaded sky stays unchanged.
