# Native audio

Original audio is mandatory for a 1:1 client. It is part of the world, actor
and skill work, not an optional extra.

## Work order and acceptance

- Stage A is breadth-first (DEC-OWN-1). Audio is converted and bound per
  bundle in stage A: each actor, animation, skill, enemy and world bundle
  carries its own sounds (DEC-OWN-3, ACT-05, WORLD-02).
- The stage A bar per bundle is a listen check against L2.exe on IMPORTA-PC
  with labelled audible results (CHECK-02). Extraction or decoding alone is
  not a pass.
- Native-rule research waits for the polish stage (POL-02). This covers the
  ALAudio footstep rules, specialized attack sounds, native random, loop,
  gain, attenuation and listener rules, and matched native/browser
  recordings.
- Status lives in [.planning/STATE.md](../.planning/STATE.md). Work order
  lives in [.planning/ROADMAP.md](../.planning/ROADMAP.md).
- The reference client is IMPORTA-PC `C:/Lineage2-client`. `E:/Lineage2-client`
  is a conversion source only after the full-tree hash lock (DEC-OWN-2,
  FOUND-03).
- Scripts and recipes produce all staged audio. Each script runs on its own.
  A single actor or skill job never needs a bulk sound extraction or the
  optional cross-system orchestrator.

## Binding rules

- Keep exact source identity for every export: host and path, package and
  object, dependency and payload hashes, converter settings and original
  metadata. Filenames alone do not prove identity. Older H5 assets are usable
  only with proved source equality.
- An event without a resolved Sound reference stays "unresolved". It is
  neither an invented sound nor proof that the native event is silent.
- Keep conditional arrays, specialized events and unresolved lookup rules
  explicit. Never promote an audition policy or a filename such as
  `walk_loop` into a native rule.
- An absent serialized property needs class-default resolution, not an
  assumed zero or an unconditional event.
- Equipment parts never duplicate base-body notifications.
- Reuse verified shared products. Never repeat the 4,773-sound corpus export
  to bind one actor or skill.
- Each browser rule that is not native evidence is labelled "presentation
  choice" in its dev-sheet hover-card. Nothing in the 20_20 slice is a
  native-parity claim.
- Keep these coverage stages separate: source-inventoried, locally staged,
  metadata-decoded, exported, hash-validated, referenced by an action or
  region, connected to world behaviour, observed audible, compared against
  native. A percentage over a partial staged set is not whole-client
  coverage.

## Current state in the 20_20 slice

Native facts come from
`artifacts/native-parity/research/native-sound-answers-20261107/REPORT.md`.
Browser choices follow
`artifacts/native-parity/research/native-sound-answers-20261107/BROWSER_RECOMMENDATIONS.md`.

### Mixer and start

- One `WorldAudioMixer` has master, music, ambience and effects buses and a
  -3 dB headroom limiter.
- It unlocks on the first trusted tap, click or key press. A "Tap anywhere
  for sound" chip shows while it is locked. **Dev -> Audio -> Enable audio**
  retries.
- Levels and mute are in **Dev -> Audio**.
- The mixer pans with a pan-only `PannerNode`. Distance gain stays with the
  caller (`src/audio/WorldAudioMixer.ts`).
- Round-1 hardware evidence (headless Chromium, analyser/RMS only, nothing
  judged by ear):
  `artifacts/native-parity/research/dev-sheet-audio-20261107/round1/`.

### Music

- Script `scripts/export-native-music.py`, recipe
  `recipes/native-music-20_20.json`.
- PlayerStart10 is inside `MusicVolume1` (ID 202002, bForcePlayMusic). The
  raw map has two MusicVolumes, IDs 202001 and 202002.
- Six tracks: F09_F, F09_S01, F10_F, F10_S01, F04_F, F04_S01.
- Selection is uniform random. No loop and no fade-in. 30 s of silence
  follows each track, then a new pick.
- A volume change fades the old track out linearly over 2.5 s.
- Gain is l2.ini MusicVolume 0.1.
- Tracks are about 30 s long, so music plays about half the time. The Audio
  tab shows the gap countdown and the pre-rolled next track.
- Region entry, exit and transition rules beyond this volume are open.

### World ambient (PointRegion)

- Script `scripts/bundle-native-ambience.py`.
- 20_20 AmbientSoundObject emitters play with the native range
  (SoundRadius x 50), class defaults, the Day/Night gate, loop and one-shot
  rules, the gain and pitch formula and 16 slots.
- The listener point (local pawn) is a presentation choice.
- `pnpm assets:ambient --output <fresh-destination>` exports all 106 exact
  Sound dependencies of the original `20_20` map: 21,664,812 WAV bytes.
- All 2,622 AmbientSoundObject declarations and 2,620 authored references are
  kept. `AmbientSoundObject4093` and `AmbientSoundObject6250` have no Sound
  field and stay unresolved. No leaf-name substitution, spatial filter or
  playback rule is added.
- The export keeps original serialized Sound records, ancillary WAV chunks
  (one `smpl`), source hashes and converter settings. Two clean builds give
  1,383 identical files and 106 unchanged cache hits.
- `ambient-sounds.json` holds all 2,622 declarations with all 25,326
  property ranges.
- The PointRegion reader decodes all 2,622 ambient and 5,303 actor
  PointRegion structs. The 13/14-byte tagged payloads keep Zone object
  identity, signed iLeaf, ZoneNumber and exact source spans. Ambient rows
  serialize LevelInfo0/-1/0. Actor rows hold 681 distinct tuples and 42
  Zone-reference/ZoneNumber pairs. Saved values do not prove runtime zone
  membership, occlusion or audibility.
- Evidence:
  `artifacts/native-parity/research/native-world-audio-20261106/ambient-export-integration/REPORT.md`,
  `artifacts/native-parity/research/native-world-audio-20261106/pointregion-integration/REPORT.md`,
  `artifacts/native-parity/research/audio-world-20261106/REPORT.md`.

### Placement audio

- Script `scripts/bundle-native-placement-audio.py`, recipe
  `recipes/native-20-20-placement-audio.json`.
- Eight 20_20 placements declare 24 StepSound slots that reference three
  original Wood WAVs from the corpus.
- The bundle copies verified payloads and keeps exact raw tags, source
  ordinals and all 149 omitted actors.
- The indoor stair and building absence controls have no inferred default.
- Footstep Auto mode reads the support StaticMeshActor's own StepSound from
  this data.
- Evidence:
  `artifacts/native-parity/research/native-placement-audio-20261107/REPORT.md`.

### Footsteps

- The stepsound package has 93 clips over all 16 surfaces.
- Gait comes from the movement state.
- Auto follows the native support order:
  1. boots (additive);
  2. the support StaticMeshActor's own StepSound;
  3. water and step volumes (none in 20_20);
  4. ACTOR = Stone_Hard walk set on other support;
  5. GRASS/LAND on terrain.
- The deco-grass count is an approximation, because the browser does not
  render the DecoLayers.
- Manual mode offers every surface and its actual clip variations. Controls
  are in **Dev -> Movement > Footsteps** (Surface and Variation chips). The
  default is Auto.
- Fighter Walk/Run arrays hold 20 distinct exact StepSound dependencies. A
  dedicated bundle packages those 20 unchanged WAVs beside both fighters'
  animation events. Ten events keep their arrays (240 ordered slots). Two
  also carry conditional breath sounds, so eight are surface-only. The
  actor archives are unchanged.
- Mystic footsteps run through:
  `recipes/native-human-mystic-footstep-events.json` ->
  `scripts/inventory-native-footstep-events.py` ->
  `recipes/native-human-mystic-footstep-audio.json` ->
  `scripts/bundle-native-animation-audio.py` ->
  `scripts/stage_native_animation_audio.py --id human-mystic-footsteps`.
  MMagic and FMagic walk and run with their own `Walk_Hand_*`/`Run_Hand_*`
  notify times from their native archives, and the same 20 StepSound
  dependencies (240 ordered slots) as the fighters. The Random 5 breath
  notify on each run clip stays a direct cue.
- Each accepted movement support decision is kept: the nine capsule samples,
  the controlling mesh and triangle, and query/result positions. Footstep
  dispatch copies that contact. This is dispatch-time contact correlation,
  not animated foot contact.
- Raw silent WebM segments are not playback evidence. Actual PCM frames
  establish silence.
- Evidence:
  `artifacts/native-parity/research/native-ffighter-world-20261107/HUMAN_NEXT.md`,
  `artifacts/native-parity/research/native-footstep-audio-20261107/BUNDLE_REPORT.md`,
  `artifacts/native-parity/research/native-footstep-audio-20261107/REPORT.md`,
  `artifacts/native-parity/research/native-ground-contact-20261107/REPORT.md`.

### Movement speed

- aCis server data `humanFighter.xml`: walk 80, run 115 source units/s
  (0.80 and 1.15 m/s at 100 units per metre). A run starts at walk speed for
  0.4 s.
- The mystic profiles use the same fighter values (presentation choice;
  mystic server speeds are not staged).
- Arm Walk or Run with the HUD gait button or **Dev -> Movement > Walk /
  run**, then tap the ground. A gait change keeps the destination. Each clip
  drives its own footstep events.
- Stride-to-distance matching is unverified.
- Evidence:
  `artifacts/native-parity/research/native-human-locomotion-20261107/REPORT.md`.

### Combat

- Recipe `recipes/native-combat-audio.json`.
- All four humans have their own chargrp row, selected by body mesh:
  MFighter row 0, FFighter row 1, MMagic row 8, FMagic row 9.
- Attacks play AttackItem (fist or 1HS lists, 250/30 or 250/40) and
  AttackVoice (`voice_snd_hand`, for example MHMagician_1H_Atk_1..5,
  p = 16728/32768).
- At each AttackShot on Greater Musveren the defense sound plays, then
  `field_stalker_dmg_*` with p = 23285/32768 at volume 250, radius 50.
- When Musveren hits the player, the player's own `damage_sound` plays (for
  example FHMagician_Dmg_1..3).
- Unit tests cover the mystic routes against the staged bundle. They still
  need the next hardware browser run.
- Musveren `atk01` has three direct sound events with pinned source
  identities, WAV bytes and animation-clock times. Its `AttackShot310` event
  stays unresolved. No substitute sound or silence is inferred.
- Attack completion returns to idle and cuts the remaining preview tail.
- Evidence:
  `artifacts/native-parity/research/native-action-audio-20261107/REPORT.md`.

### Skill audio

- `scripts/bundle-native-skill-audio.py` is an independent recipe-driven
  dependency bundler. Power Strike 3/1 reuses two original stereo PCM16 WAVs.
  The manifest keeps original rows, global order, duplicates, all nine sound
  slots and thirty voice fields. 35 focused checks and clean, repeat and
  verify comparisons pass.
- Both nonempty references are `spelleffect_sound_1/2`, although the
  filenames end in `_cast` and `_shot`. Their group-less table strings
  resolve only to candidates in the pinned corpus. The bundler selects no
  candidate, phase, native gain, radius or random policy.
- Special attack preview: four direct cues on each fighter's `SpAtk01_1HS`
  clip (eight events, seven embedded WAVs). Use **Dev -> Combat > Actions ->
  Special attack preview**. The clip runs once and returns to idle. Hand
  attack mappings and equipment stay unchanged.
- Each special clip keeps two unresolved AttackItem/AttackShot events.
- See [NATIVE_POWER_STRIKE.md](NATIVE_POWER_STRIKE.md) for the effect side.
- Evidence:
  `artifacts/native-parity/research/native-human-skill-audio-20261107/REPORT.md`,
  `artifacts/native-parity/research/native-human-skill-audio-20261107/attack-source/REPORT.md`,
  `artifacts/native-parity/research/native-human-special-attack-20261107/REPORT.md`.

### Voices and death

- Death cues: four from `Death_MFighter`, four from `Death_FFighter`, and two
  simultaneous cues from Musveren `death`. The silenos-named fighter cue is
  kept because the source authors it.
- Use **Dev -> Combat > Actions -> Musveren death** or **Combat > Life ->
  Fighter death**.
- Locked or muted events are consumed without late replay. The mixer stops
  interrupted or despawned actors and lets natural death tails finish.
- Basic Hand attacks on both fighters keep six specialized events each (two
  AttackVoice, two AttackItem, two AttackShot) with no direct Sound
  reference. The male and female Hand diagnostics are symmetric.
- The female fighter package embeds 61 original direct Sound dependencies
  with its 323 animation events.
- Evidence:
  `artifacts/native-parity/research/native-sky-audio-integration-20261106/REPORT.md`,
  `artifacts/native-parity/research/native-ffighter-world-20261107/audio/REPORT.md`,
  `artifacts/native-parity/research/native-ffighter-world-20261107/REPORT.md`,
  `artifacts/native-parity/research/native-ffighter-expansion-20261107/REPORT.md`.

### UI sounds

- Not converted and not bound. `interfacesound.uax` is outside the local
  source lock. See Open.

## Coverage counts

Keep these counts separate. They overlap and must not be summed.

| Count | Scope |
| --- | --- |
| 4,773 | Engine.Sound exports in 18 locked UAX packages; 465,772,120 WAV bytes, all PCM16, 4,602 distinct payload hashes. |
| 106 | Exact Sound dependencies of the 20_20 map (ambient export). |
| 75 | Embedded actor WAVs in the male/Musveren slice: 63 fighter, 12 monster. |
| 77 | Distinct exported sound payloads in the verified migration: 63 fighter, 12 Musveren, 2 Power Strike. |
| 356 | Distinct actor notifications. The raw 688 rows repeat fighter notifications in equipment. |
| 13 / 12 | Action cues / distinct payloads per human-plus-Musveren route. |
| 21 / 16 | Action cues / payloads for both humans plus Musveren. Excludes the footstep bundle. |
| 20 / 240 | Exact StepSound dependencies / ordered slots in the human Walk/Run arrays. |
| 93 / 16 | Stepsound package clips / surfaces. |
| 295 | Ogg files in the historical census (250 music, 45 voice). |

## Sound corpus and decoding

- `pnpm assets:sounds` exports all 4,773 sounds with zero unsupported records
  or containers. Duplicate payloads keep separate object identities. Every
  serialized, native and RIFF span matches the encrypted and unwrapped source.
- A fresh clean build matches the seeded build across 38,188 files. The
  repeat gives 4,773 cache hits. Repeat and verify-only keep all file hashes
  and timestamps.
- All four rate/channel combinations exist: mono or stereo at 22,050 or
  44,100 Hz. 43 `smpl` chunks exist; their presence does not set loop rules.
- The RIFF decoder records chunk IDs, offsets, lengths, padding and hashes,
  and rejects malformed top-level framing after PCM. The 75 actor WAVs carry
  52 LIST/INFO annotations, four PAD chunks and no top-level sampler, cue or
  playlist chunks. Ancillary semantics stay uninterpreted.
- Chromium decodes every WAV with original dimensions and rates. All
  232,411,790 signed16 samples are recoverable.
- Chromium uses a positive-sample float32 reciprocal of 32767. The maximum
  difference from symmetric `int16/32768` is 0.000021636486053466797. Strict
  symmetric equality is FAIL_RETAINED. No tolerance is relaxed.
- Nine UAX packages in the remote file census are outside the local source
  lock, including `interfacesound.uax` and `voice/systemmsg_e.uax`.
  Standalone music and voice files are outside the batch. They enter after
  the full-tree hash lock (FOUND-03).
- Census command: `pnpm exec node scripts/audit-native-audio-coverage.mjs`.
  Two runs reproduce JSON and Markdown byte-for-byte. `coverage.json` keeps
  all source identities, notification fields and per-category gaps.
- Evidence:
  `artifacts/native-parity/research/native-world-audio-20261106/sound-batch-source/REPORT.md`,
  `artifacts/native-parity/research/native-world-audio-20261106/sound-batch-integration/REPORT.md`,
  `artifacts/native-parity/research/native-world-audio-20261106/riff-validation/REPORT.md`,
  `artifacts/native-parity/research/audio-world-20261106/inventory/README.md`,
  `artifacts/native-parity/research/audio-world-20261106/inventory-reviewed/README.md`,
  `artifacts/native-audio/native-audio-audit.json`.

## Native backend findings (polish inputs)

These are static findings. No native code ran. None is a browser policy.
They feed POL-02.

### Backend configuration

- Seven original backend/config files are collected from IMPORTA-PC. `l2.ini`
  and `Option.ini` differ from historical pins; their bytes are kept
  privately. `ALAudio.u` is absent. Copying the backend does not prove which
  backend the native process selected.
- A decoded configuration joins to `ALAudio.ALAudioSubsystem`. This is
  configured state, not a live backend observation.

### Footstep configuration

- The footstep audit decodes the received `ALAudio.int`: 24 keys, 20 literal
  values. Its Ver111 footer is admitted only by the exact input hash.
- Literal package.leaf names do not equal the grouped export paths. Zero
  exact joins. `GrassRunSound3` repeats `StepSound.grass_run_02`.
- PostLoad can replace 24 footstep references from `ALAudio.int`. Serialized
  surface arrays alone cannot select the final footstep sounds.
- The missing observation is the Engine PostLoad `0x106af480` LoadSound
  nested-group search and selection for the 24 literals (for example
  `StepSound.default_walk_01` against `stepsound.Default.default_walk_01`).
- Evidence:
  `artifacts/native-parity/research/native-world-audio-20261106/backend-closure/footstep-config/REPORT.md`,
  `artifacts/native-parity/research/audio-world-20261106/native-notify-static.md`.

### Notify and random values

- Notify contains RNG, scalar and radius rules.
- Source-authored Random values: fighter run breath Random=5, Musveren wait
  and run Random=30, fist sounds in skill audio Random=50. None is proved to
  be a probability.

### Ambient dispatch

- The main ALAudio caller joins its LevelObject PlaySoundW overload, the
  resource-flag merge and the exact `alSourcei` lookup destination.
- A null environment manager bypasses the type gate. Zero in the tested
  integer field takes the direct path; it is not a proved disable path.
- The caller divides a byte by 255 and multiplies another by 1/64.
- Class-layout offsets O+0x3c/68/6c/70/74/78/7c/7d are not proved to be
  serialized property names.
- The position API scale is binary64 0.03999999910593033 with third
  coordinate sign -1. Never copy visual unit or listener assumptions.
- Resident registration writes its resource flag word to zero. The stream
  path copies Sound flags. Caller flags merge with resource flags, so zero
  caller flags do not prove non-looping.
- All 4,096 synthetic type-gate combinations and 12 distance/range controls
  pass. No global `smpl`/loop rule or successful API initialization is
  established.
- The emitter constructor joins its vtable slots to IsAAmbientSoundObject and
  GetAmbientVolume. It gives no property-name-to-offset mapping.
- The 47-instruction interval helper has two conditional truncation paths,
  not floor: a binary64 spill/SSE path and an x87 int64/residual-correction
  path. All 172 synthetic arithmetic checks pass.
- Evidence:
  `artifacts/native-parity/research/native-world-audio-20261106/backend-closure/REPORT.md`,
  `artifacts/native-parity/research/native-world-audio-20261106/backend-closure/ambient-dispatch/REPORT.md`,
  `artifacts/native-parity/research/native-world-audio-20261106/backend-closure/ambient-update-caller/REPORT.md`,
  `artifacts/native-parity/research/native-world-audio-20261106/backend-closure/resource-flags/REPORT.md`,
  `artifacts/native-parity/research/native-world-audio-20261106/backend-closure/receiver-binding/REPORT.md`,
  `artifacts/native-parity/research/native-world-audio-20261106/backend-closure/emitter-layout/REPORT.md`,
  `artifacts/native-parity/research/native-world-audio-20261106/backend-closure/interval-conversion/REPORT.md`.

## Runtime ownership

- Source resolution and playback stay in presentation. `GameWorldAdapter`
  carries semantic world state and events only.
- One world-owned mixer unlocks from a real gesture, offers mute and volume,
  and exposes load/unlock errors and retry. Readiness tells a gesture
  requirement apart from missing or failed content.
- Actor sounds use the same source-duration action clock as the animation.
  One-shot, loop, seek, retrigger and pause are distinct. A one-shot end never
  emits the next loop's time-zero cue.
- The animation clock dispatches crossings with recorded catch-up offsets.
  Its 0.1 s step cap is a browser policy, not a native timing tolerance.
- Despawn, scene disposal and loading cancellation release sources. A
  pending decode never plays after ownership ends.
- Browser interruption rules are presentation behaviour, not native
  semantics.
- Native-source audio metadata and authored overrides stay separate. The
  Babylon.js Editor is an optional viewer ([EDITOR_VIEWER.md](EDITOR_VIEWER.md),
  DEC-OWN-8); no audio depends on it.
- The package inspector auditions linked references without native random,
  surface, conditional or spatial semantics. It is not a native policy.
- The graphics-only apitrace pilot on IMPORTA-PC adds no audio capture or
  native configuration permission.

## Evidence required to pass

- Extraction, decoding, a running AudioContext, an inspector Play button or
  a silent screen recording never pass world-audio acceptance.
- Use real world gestures and actions. Record source and event identity,
  actor clock, scheduled and observed onset, duration, output measurements,
  errors and cleanup.
- Verify mute, volume, unlock, repeated actions, interruption, surface and
  region changes, and positional/listener behaviour where they apply.
- For polish: keep matched native and browser recordings with their sample
  rate, channels and capture latency. Define timing, amplitude and spatial
  tolerances and one alignment method before comparison. Never tune a
  threshold to a result. Compare distributions for random selection.
- Numerical audio tolerances are unestablished, so native audio parity
  cannot pass yet.
- Mobile evidence so far is desktop hardware with viewport/touch emulation.
  Physical-phone, Safari and physical-speaker results are unproved.
- Machine-readable gate:
  [`native-audio.acceptance.json`](../recipes/native-audio.acceptance.json).
  Overall 1:1 stays incomplete while any required category is missing or
  unverified. See [VERIFICATION.md](VERIFICATION.md) for the wider checks.

## Open

Items covered by a requirement:

- Ambient, placement and sky audio for all 153 tiles (WORLD-02).
- Voices, combat, skill and music bound for every actor, skill and enemy
  bundle (ACT-05).
- Listen check against L2.exe per bundle (CHECK-02).
- The nine UAX packages and standalone music/voice outside the lock
  (FOUND-03, WORLD-02).
- Automatic native footstep selection, ALAudio random/spatial rules,
  specialized attack sounds, Power Strike table-sound lookup and onset, and
  numerical tolerances (POL-02, ACT-06).

Items no requirement names:

- UI sounds and their actual interaction triggers.
- Spatial runtime playback: native attenuation curve, listener placement and
  units. The browser pans only and the listener point is a presentation
  choice.
- Region music entry, exit and transition rules.
- Female special-action preview: mixed float PCM peaks above 1 (clipping and
  headroom risk).
- The mystic combat routes need their hardware browser run.
