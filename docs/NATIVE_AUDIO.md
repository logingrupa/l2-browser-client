# Interlude audio acceptance and implementation

The user's 2026-11-06 clarification makes **audio mandatory for 1:1**. This is
part of the existing world/actor/rendering goal, not an optional enhancement.
The browser implementation owner owns end-to-end integration and coordinates
source research. Terrain work and its existing protections remain in force.

## Current world audio in the 20_20 slice — 2026-11-08

This section supersedes the older checkpoint statements below wherever they
say music, ambience, footsteps or combat sounds are disconnected, that both
gaits use a synthetic 0.7 m/s, or that controls live under "Demo controls".
Native facts come from
[native-sound-answers REPORT.md](../artifacts/native-parity/research/native-sound-answers-20261107/REPORT.md);
browser choices follow its
[BROWSER_RECOMMENDATIONS.md](../artifacts/native-parity/research/native-sound-answers-20261107/BROWSER_RECOMMENDATIONS.md)
and are labelled "presentation choice" in each hover-card. Nothing here is a
native-parity claim.

- **Start.** One `WorldAudioMixer` (master, music, ambience, effects buses and
  a −3 dB headroom limiter) unlocks on the first trusted tap, click or key
  press; a "Tap anywhere for sound" chip shows while locked. Levels are in
  **Dev → Audio**.
- **Music** (`scripts/export-native-music.py`, `recipes/native-music-20_20.json`).
  PlayerStart10 is inside `MusicVolume1` (ID 202002, bForcePlayMusic). Six
  tracks (F09_F, F09_S01, F10_F, F10_S01, F04_F, F04_S01), uniform random, no
  loop or fade-in, 30 s silence after each track, then a new pick; a volume
  change fades the old track out linearly over 2.5 s. Gain is l2.ini
  MusicVolume 0.1. Tracks are about 30 s long, so music plays about half the
  time; the Audio tab shows the gap countdown and the pre-rolled next track.
- **Ambience** (`scripts/bundle-native-ambience.py`). The 20_20
  AmbientSoundObject emitters use the native range (SoundRadius × 50), class
  defaults, Day/Night gate, loop/one-shot rules, gain and pitch formula and 16
  slots. The listener point (local pawn) is a presentation choice.
- **Footsteps** (93-clip stepsound package, all 16 surfaces). Gait comes from
  the movement state. Auto follows the native support order: boots (additive),
  the support StaticMeshActor's own StepSound, water/step volumes (none in
  20_20), ACTOR = Stone_Hard walk set on other support, then GRASS/LAND on
  terrain. The deco-grass count is an approximation because the browser does
  not render the DecoLayers. Manual mode offers every surface and its actual
  clip variations.
- **Speed.** aCis server data `humanFighter.xml`: walk 80, run 115 source
  units/s (0.80 / 1.15 m/s at 100 units per metre); a run starts at walk speed
  for 0.4 s. The same fighter values are applied to the mystic profiles
  (presentation choice; mystic server speeds are not staged).
- **Mystic footsteps** (`recipes/native-human-mystic-footstep-events.json` →
  `scripts/inventory-native-footstep-events.py` →
  `recipes/native-human-mystic-footstep-audio.json` →
  `scripts/bundle-native-animation-audio.py` →
  `scripts/stage_native_animation_audio.py --id human-mystic-footsteps`).
  MMagic and FMagic walk and run with their own `Walk_Hand_*`/`Run_Hand_*`
  notify times from their native archives, and the same 20 StepSound
  dependencies (240 ordered slots) as the fighters. The Random 5 breath notify
  on each run clip stays a direct cue.
- **Combat** (`recipes/native-combat-audio.json`). All four humans have their
  own chargrp row (MFighter row 0, FFighter row 1, MMagic row 8, FMagic row 9,
  selected by body mesh). Attacks play AttackItem (fist or 1HS lists, 250/30 or
  250/40), AttackVoice (`voice_snd_hand`, e.g. MHMagician_1H_Atk_1..5,
  p = 16728/32768) and, at each AttackShot on Greater Musveren, the defense
  sound then `field_stalker_dmg_*` with p = 23285/32768 at volume 250, radius
  50. When Musveren hits the player, the player's own `damage_sound`
  (e.g. FHMagician_Dmg_1..3) plays. The mystic routes are covered by unit tests
  against the staged bundle; they still need the next hardware browser run.

Round-1 hardware evidence (headless Chromium, analyser/RMS only, nothing
judged by ear) is under
`artifacts/native-parity/research/dev-sheet-audio-20261107/round1/`.

## Current sequencing and system bundles — 2026-11-07

Finish human male/female, their class skills and usable 20_20 traversal before
more races or tiles. Audio is part of each actor, animation, skill and enemy
dependency bundle, not a later optional project. Small dedicated conversion
scripts must run independently; a single actor/skill job must not require bulk
sound extraction or the optional cross-system orchestrator.

Export the source-resolvable payloads together with exact source identities and
timing/events, reusing verified shared products where possible. Keep specialized
events, conditional arrays and unresolved native lookup rules explicit. A
specialized event without a resolved Sound reference is neither an invented
sound nor evidence that the native event is silent. Current direct-reference
embedding covers only part of this contract. One fighter recipe and a few
demonstrated cues do not cover all human classes, skills or walking/running.

The world playback consumer remains a separate required stage of the same
system's acceptance: export/decoding, event binding, audible output and native
behavior comparison are distinct. Preserve the completed 4,773-sound corpus
receipts; do not repeat that batch to connect a selected actor or skill.

The [human coverage inventory](../artifacts/native-parity/research/native-ffighter-world-20261107/HUMAN_NEXT.md)
now establishes 20 distinct exact StepSound dependencies in the selected
fighter Walk/Run notification arrays. All already have verified corpus exports;
none are embedded in either fighter package. Their ordered arrays/events are
retained. Bundling these dependencies does not require solving the separate
group-less ALAudio configuration lookup first. World loop/surface selection,
effective native configuration and random/spatial policy remain separate work.

The newer [dedicated dependency bundle](../artifacts/native-parity/research/native-footstep-audio-20261107/BUNDLE_REPORT.md)
now packages those 20 unchanged WAVs beside both fighters' original animation
events. All ten selected events retain their arrays (240 ordered slots); two
also carry conditional breath sounds, leaving eight surface-only notifications.
The original actor archives are unchanged. Separate additive staging and a
loop-aware world consumer now pass four hardware WebGPU source/authored
male/female cases at desktop/mobile viewport sizes. At that checkpoint the
surface preview defaulted to Off; it now lives in **Dev → Movement ›
Footsteps** (Surface and Variation chips) and defaults to Auto. The [final report and recordings](../artifacts/native-parity/research/native-footstep-audio-20261107/REPORT.md)
verify actual post-gain output, mute/volume, repeated original event times,
movement, interruption and cleanup. Raw silent WebM segments are not treated
as playback evidence; actual PCM frames establish silence. Automatic surface
detection and effective native config/random/spatial selection remain open.
Mobile is desktop-hardware viewport/touch emulation, not a physical-phone or
native-audio parity result.

The later [locomotion checkpoint](../artifacts/native-parity/research/native-human-locomotion-20261107/REPORT.md)
connects both original Walk and Run clips to actual move-to travel. Arm Walk
or Run (HUD gait button, or **Dev → Movement › Walk / run**), then tap the
ground. Changing gait
preserves the destination; each clip drives its own original footstep events.
Four hardware WebGPU source/authored male/female cases pass with recorded
post-gain output, arrival, pause, equipment, death and cleanup checks. At that
checkpoint both gaits used a synthetic 0.7 m/s; they now use the aCis server
speeds (walk 0.80, run 1.15 m/s, 0.4 s run start; see the current section
above). Stride-to-distance matching remains unverified. This reuses the same twenty WAVs
without a new corpus export or actor conversion. Footstep surface/sample
selection remains explicit and defaults Off.

The [accepted-ground-contact checkpoint](../artifacts/native-parity/research/native-ground-contact-20261107/REPORT.md)
now retains each accepted movement support decision: the original nine capsule
samples, controlling mesh/triangle and query/result positions. Footstep dispatch
copies that contact, and on-demand diagnostics resolve live material and source
placement metadata. This avoids inventing support by re-querying at the raised
position. It is dispatch-time contact correlation, not animated foot contact or
automatic native surface selection. Existing sound arrays, event clocks, mixer
controls, default Off and synthetic movement speed are unchanged.

The [placement-audio bundle](../artifacts/native-parity/research/native-placement-audio-20261107/REPORT.md)
now preserves an additional actor-level source association: eight current
20_20 placements declare 24 StepSound slots referencing three original Wood
WAVs already exported in the corpus. The dedicated command copies verified
payloads and retains exact raw tags, source ordinals and all 149 omitted actors.
The indoor stair and building absence controls have no inferred default.
This bundle is not yet staged or connected to automatic world playback.
The retained support-object dispatch, boots/water/custom-resource precedence
and terrain decoration-based selection still need applicable evidence.

## Human special-attack source preview — 2026-11-07

The [runtime checkpoint](../artifacts/native-parity/research/native-human-special-attack-20261107/REPORT.md)
connects four direct original cues to each fighter's existing `SpAtk01_1HS`
animation. Tap once to unlock audio, then choose **Dev → Combat › Actions →
Special attack preview**. The clip runs once and returns visually to idle. Original Hand
attack mappings and equipment remain unchanged. Source-clock timing, mute,
volume, retrigger, interruption and cleanup use the existing preview consumer.

This adds eight cue definitions using seven already embedded WAVs; no corpus or
actor conversion is repeated. Each human-plus-Musveren route now admits thirteen
action cues/twelve distinct action payloads. Both humans together with Musveren
define twenty-one cues/sixteen payloads. Counts exclude the separate footstep
bundle and overlap existing exported sounds. Actual hardware browser/audio
evidence and preservation are in the linked report; 210 focused tests and
build/typecheck pass.

The male Hand diagnostic now matches the female's six uncovered specialized
events. Each special clip retains two uncovered AttackItem/AttackShot events.
The preview does not establish native equipped-family selection, effective
skill rate, target/particle/table-sound dispatch or gain/radius/random/spatial
policy. Native audio parity and complete skills remain open.

## Selected human skill audio dependencies — 2026-11-07

The [selected-skill report](../artifacts/native-parity/research/native-human-skill-audio-20261107/REPORT.md)
adds `scripts/bundle-native-skill-audio.py`, an independent recipe-driven
dependency bundler. Power Strike 3/1 reuses two original stereo PCM16 WAVs;
35 focused checks and clean/repeat/verify comparisons pass. The manifest
preserves original rows, global order, duplicates, all nine sound slots and
thirty voice fields. This is packaging, with no new world sound dispatch.

Both nonempty references are `spelleffect_sound_1/2`, even though the filenames
end in `_cast` and `_shot`. Their group-less table strings resolve only to
candidates in the pinned corpus; source identity, lookup and trigger timing are
separate. The bundler selects no candidate, phase, native gain/radius or random
policy. Existing full-object WAV products remain unchanged and no sound corpus
export is repeated.

The [attack-source audit](../artifacts/native-parity/research/native-human-skill-audio-20261107/attack-source/REPORT.md)
also verifies four direct cues in each existing male/female `SpAtk01_1HS`
animation: eight events, seven original WAVs, with exact source clocks. These
are ready for a labeled source-animation preview, not a replacement for the
current Hand attack or proof of complete Power Strike behavior. Each special
clip also retains two unresolved specialized events. Both basic Hand attacks
have six specialized events with no direct Sound binding; native table/weapon
selection remains open. At that source-audit checkpoint the male Hand diagnostic
was absent; the later special-preview integration above adds symmetric coverage.

## Female world action cues — 2026-11-07

The [frozen implementation receipt](../artifacts/native-parity/research/native-ffighter-world-20261107/audio/REPORT.md)
independently matches ten female animation events and four death WAV payloads
to the original packages. Four `Death_FFighter` cues are admitted by the
coordinator. All six `Atk01_Hand_FFighter` specialized events remain uncovered:
two AttackVoice, two AttackItem and two AttackShot, without direct Sound
references. Their selection rules and eventual playback remain open.

The focused coordinator suite passes 46 unit checks and typecheck. Explicit
actor selection supports a female-plus-Musveren route without missing-male
diagnostics; omitted selection preserves the historical nine-cue behavior.
Those frozen checks establish source/code behavior. The later
[female-world report](../artifacts/native-parity/research/native-ffighter-world-20261107/REPORT.md)
adds four passing source/authored desktop and mobile viewport/touch receipts
on hardware WebGPU, including post-gain browser audio output, mute/volume and
lifecycle checks. The female route selects four female death plus five Musveren
cues, nine total. Both player variants together define thirteen cues; this is
not thirteen new sound exports or complete human audio coverage.

Mobile evidence uses desktop NVIDIA hardware with viewport/touch emulation;
physical-phone/Safari behavior and physical-speaker/native-reference parity
remain unproved. Other human bases/classes/skills, footsteps, specialized attack
selection and a new interactive Editor save remain unfinished.

## Female package preview — 2026-11-07

The [female fighter package](../artifacts/native-parity/research/native-ffighter-expansion-20261107/REPORT.md)
now embeds 61 original direct Sound dependencies with its 323 animation events.
Both native routes at desktop/mobile viewport sizes decode all 61 in the
production inspector and schedule the four original death notifications with
nonzero buffers connected to the audio destination. This is linked package
preview, not new world gameplay dispatch, physical-speaker verification or
native audio parity. At that package-only checkpoint, world cues remained nine
and the staged actor WAV count was 75. These overlapping source/export/runtime counts must not be
summed or mistaken for complete audio coverage.

## World action preview — 2026-11-07

The world now connects **nine original preview cues**: the existing six death
cues plus three direct Musveren `atk01` sound events. Tap once to unlock audio
and select **Dev → Combat › Actions → Musveren attack**. Source identities, original WAV bytes and
animation-clock event times are pinned. The separate `AttackShot310` event stays
explicitly unresolved; no substitute sound or silence is inferred. See the
[action-audio report](../artifacts/native-parity/research/native-action-audio-20261107/REPORT.md)
for validation and limitations.

The reusable coordinator admits multiple clips per asset. Targeted NPC actions
preserve player movement; revival no longer replays a consumed or interrupted
attack. The existing mixer policies are unchanged: gesture unlock, one-shot
playback, mute/volume, interruption and disposal. Attack completion returns to
idle and cuts its remaining preview tail; the `walk_loop` filename is not a
native loop rule. Native selection/random/spatial/backend behavior and audible
reference equality remain unverified.

Keep **4,773 converted Sound exports**, this male/Musveren checkpoint's **75
embedded actor WAVs** and its **nine connected world preview cues** as separate
coverage counts. Music, ambience,
surface footsteps, UI and other action/weapon/skill events remain unfinished.
The dated death-only checkpoints below describe their original scope.

## Staged Sound export and browser decoding — 2026-11-06

The [independent original-source inventory](../artifacts/native-parity/research/native-world-audio-20261106/sound-batch-source/REPORT.md)
now checks all **4,773 exact Engine.Sound exports in 18 locked UAX packages**.
They contain **465,772,120 original WAV bytes**, all PCM16, with 4,602 distinct
payload hashes. Duplicate payloads retain separate object identities. Every
serialized/native/RIFF span matches the original encrypted and unwrapped
source; two inventory runs reproduce exactly. There are zero unsupported
Sound layouts or containers in this selected source corpus.

All four rate/channel combinations are retained: mono/stereo at 22,050 or
44,100 Hz. Original ancillary metadata includes 43 `smpl` chunks; their presence
does not establish native loop rules. The new `assets:sounds` command batches
these source identities with explicit unsupported/integrity reporting.
The [completed integration](../artifacts/native-parity/research/native-world-audio-20261106/sound-batch-integration/REPORT.md)
exports all 4,773 sounds with zero unsupported records. The local wrapper's
hyphen restriction was corrected without renaming native objects. A fresh clean
build matches the corrected seeded build across 38,188 files; the repeat has
4,773 cache hits, and repeat/verify-only preserve all file hashes and timestamps.
All 106 earlier ambient archive/WAV pairs and 4,835 protected files remain intact.

Shared Chromium decoded every WAV with original dimensions and rates. All
232,411,790 signed16 samples are recoverable, with zero mismatches against the
previously characterized decoder formula. Strict symmetric float equality
remains FAIL_RETAINED; no native tolerance is weakened. This checks source/export
and browser decoding, not audible world behavior or native audio parity.

Nine UAX packages in the dated remote file census remain outside the local
source lock, including `interfacesound.uax` and `voice/systemmsg_e.uax`.
Standalone music/voice files are also outside this batch. Do not describe the
staged inventory as complete native audio or connect files to guessed events.
At that checkpoint, world integration was the six verified death-preview cues;
the later action preview above adds three.

## Saved PointRegion metadata and conditional backend joins — 2026-11-06

The [reader correction](../artifacts/native-parity/research/native-world-audio-20261106/pointregion-integration/REPORT.md)
now decodes all 2,622 ambient and 5,303 actor PointRegion structs. Their variable
13/14-byte tagged payloads retain Zone object identity, signed iLeaf, ZoneNumber
and exact source spans. All ambient rows serialize LevelInfo0/-1/0; actor rows
contain 681 distinct tuples and 42 Zone-reference/ZoneNumber pairs. These saved
values do not establish runtime zone membership, occlusion or audibility.
Every field matches the independently enumerated pre-edit tag oracle.

Fresh map and ambient outputs preserve original source/geometry/audio bytes.
The shared reader's implementation identity changes, so historical export trees
remain frozen and the corrected inventories use fresh destinations. No browser
runtime, catalog, listener policy, WebGPU code or acceptance tolerance changes.

The [emitter constructor packet](../artifacts/native-parity/research/native-world-audio-20261106/backend-closure/emitter-layout/REPORT.md)
joins its installed vtable slots to IsAAmbientSoundObject and GetAmbientVolume.
It supplies no property-name-to-object-offset mapping. The separate
[47-instruction interval helper](../artifacts/native-parity/research/native-world-audio-20261106/backend-closure/interval-conversion/REPORT.md)
has two conditional truncation paths, not floor: a binary64 spill/SSE path and
an x87 int64/residual-correction path. All 172 synthetic arithmetic checks pass;
live selector, floating-point state, exceptional inputs and actual timings are
unobserved. Neither packet establishes native playback. The next continuation
is `.planning/native-pointregion-continuation-20261106.md`.

## Ambient backend evidence — 2026-11-06

The [retained dispatch comparison](../artifacts/native-parity/research/native-world-audio-20261106/backend-closure/ambient-dispatch/REPORT.md)
now joins the main ALAudio caller to its separate LevelObject PlaySoundW overload,
the resource-flag merge and the exact `alSourcei` lookup destination. Conditional
type/context gates, range/dedup and interval/random branches are retained.
The caller writes different flag words for its direct and random paths; zero
in the tested integer field takes the direct path, not a proved disable path.
A null environment manager bypasses the type gate. Exact property names and
selected runtime state remain unjoined, so these are not a browser policy.

All 4,096 synthetic combinations of the retained type-gate slice and 12 bounded
distance/range controls pass. Exact constants include byte divisor255 and pitch-like
multiplier1/64; the source stores and conditional meaning remain explicit.
Resident registration writes its resource flag word to zero, whereas the stream
path copies Sound flags. No global smpl/loop rule or successful API initialization
is established. The two child evidence packets and local Engine getter reads
are hash-pinned; no native code executes.

At that checkpoint the browser connected only the verified death preview. Its mixer
uses one-shot sources and master gain, with no map-emitter consumer. This missing
consumer/behavior evidence is independent of WebGPU. Next: prove source property
offsets and collection membership, then selected interval/resource/listener state and
audible native comparison. No runtime or acceptance changes follow from this
static checkpoint. See `.planning/native-ambient-backend-continuation-20261106.md`.

## Original map ambient exports — 2026-11-06

`pnpm assets:ambient --output <fresh-destination>` now exports all **106 exact
Sound dependencies** of the original `20_20` map, preserving **21,664,812 WAV
bytes**. All 2,622 declarations and 2,620 authored references are retained;
`AmbientSoundObject4093` and `AmbientSoundObject6250` omit Sound fields and stay
unresolved. No leaf-name substitution, spatial filtering or playback rule is
added. Original serialized Sound records, ancillary WAV chunks (including one
`smpl`), source hashes and converter settings remain available.

The [verified export report](../artifacts/native-parity/research/native-world-audio-20261106/ambient-export-integration/REPORT.md)
records two clean builds with 1,383 identical files, 106 unchanged cache hits,
read-only verification and 4,835 protected files unchanged. There are 22 passing
focused tests and one Windows symlink test skipped. These 106 scratch exports
are separate from the historical 77 exported payloads and 75 active actor cues;
the runtime catalog has not grown and ambient world playback is unconnected.

The shared Chromium/Electron browser decodes all 106 with exact frame counts,
rates, channels and durations. Strict equality to symmetric `int16/32768`
normalization **fails** and is retained: an exhaustive 65,536-value control
characterizes this browser's positive-sample float32 reciprocal of 32767.
All 10,827,440 original integer samples are exactly recoverable. Maximum
observed difference from symmetric normalization is 0.000021636486053466797;
no audio tolerance is relaxed and no audible/native playback pass is claimed.

The [bounded ALAudio inspection](../artifacts/native-parity/research/native-world-audio-20261106/backend-closure/receiver-binding/REPORT.md)
joins the candidate class's constructor/vtable to its actor `PlaySoundW` body.
Caller flags merge with resource flags, so zero caller flags cannot establish
non-looping. The actual receiver, resource flags and dynamic API binding remain
unproved; the separate LevelObject overload was not inspected. This is not a
runtime policy for ambient objects or proof of a live backend.

## Required coverage

Backend source collection: the approved Fleet proxy retry delivered seven original
backend/config files, with all eight checked source identities unchanged during
collection. Parent independently verified all 11 delivered payload/receipt entries.
`l2.ini` and `Option.ini` differ from historical pins; their observed bytes are
retained privately, with no source/config restoration. `ALAudio.u` is absent.
Copying the backend does not prove which backend the native process selected.

The [repeatable footstep audit](../artifacts/native-parity/research/native-world-audio-20261106/backend-closure/footstep-config/REPORT.md)
now decodes the exact received `ALAudio.int` and records all 24 keys/20 literal
values. Its distinct Ver111 footer is admitted only by the exact input hash;
the shared decoder is unchanged. Literal package.leaf names do not equal the
grouped export paths. Zero exact joins or new payloads are claimed; diagnostic
leaf candidates remain unselected. `GrassRunSound3` really repeats
`StepSound.grass_run_02`. Thirteen tests pass and two actual runs reproduce exact
outputs. Native LoadSound nested-group lookup/selection is the next missing
source observation; no group insertion or invented surface policy was added.
World playback at that checkpoint was the six-cue death preview below.

Use the current hash-identified Interlude client on IMPORTA-PC. Retain source
host/path, package/object or media identity, dependency and payload hashes,
conversion settings and original metadata for every export. Older H5 assets
may be used only when exact source equality is demonstrated; filenames alone
do not establish identity.

Required categories wherever present in that source:

- Background and region music, including region entry/exit and transitions.
- Environmental ambience and positioned or looping emitters.
- Footsteps with the correct surface and character/equipment selection.
- Character, NPC and monster voices/actions, including death.
- Combat, weapon, skill cast/impact and effect sounds.
- UI sounds and their actual interaction triggers.

For each class establish native trigger timing, conditions, random selection,
loop/transition rules, gain/volume, attenuation and spatial/listener behavior.
Preserve unresolved properties; do not promote an audition policy or a filename
such as `walk_loop` into a native playback rule. Absent serialized properties
require class-default resolution, not an assumed zero or unconditional event.

## World source-cue preview — 2026-11-06

This checkpoint connected **six exact original death cues**: four from
`Death_MFighter`, and two simultaneous cues from Musveren `death`. Source object,
package, notify/time, provenance and WAV hashes are checked before registration.
The surprising silenos-named fighter cue is preserved because it is authored in
the source. Equipment does not duplicate base-body notifications.

Tap once to unlock audio (**Dev → Audio → Enable audio** retries), then use
**Dev → Combat › Actions → Musveren death** or **Combat › Life → Fighter
death**. Mute, volume, revive and pause are usable in the world. One world-owned
Web Audio mixer stops interrupted/despawned actors, permits natural death tails,
and closes on disposal. Locked or muted events are consumed without late replay.
The animation clock dispatches crossings with recorded catch-up offsets; its
0.1-second step cap is a browser policy, not a native timing tolerance.

Both source and authored/exported routes passed actual post-gain recording,
event timing and cleanup checks. Eight retained WebM recordings contain original
death output or measured silence. Quarter-volume amplitude ratios were 0.2498
and 0.2509; maximum observed source-clock dispatch offsets were 21.43 and 34.23ms.
Muted decoded PCM peaked around 2.03e-34 (effectively silent). This proves output
from the browser graph, not physical speaker or native-reference equality.
See the [integration report](../artifacts/native-parity/research/native-sky-audio-integration-20261106/REPORT.md)
and its linked audio receipts, recordings and coverage inventory.

This is explicitly an opt-in **source-cue preview**. Native gain/radius/listener,
looping and dispatch backend remain unresolved. At this checkpoint music,
ambience, footsteps, combat/Power Strike, other voices/actions and UI audio were
disconnected from world behavior; music, ambience, footsteps and fighter combat
are now connected (current section above), while other voices/actions and UI
audio remain open. Original audio remains mandatory for overall 1:1; these six
cues do not complete acceptance.

## Historical extraction/inspector boundary

The [RIFF validation checkpoint](../artifacts/native-parity/research/native-world-audio-20261106/riff-validation/REPORT.md)
byte-joins all 75 current actor WAVs to native UAX payloads: 52 LIST/INFO
annotations, four PAD chunks and no top-level sampler/cue/playlist chunks in
this set. The decoder now records chunk IDs, offsets, lengths, padding and hashes,
and rejects malformed top-level framing after PCM. Audio bytes and prior PCM
measurements remain identical. Ancillary semantics stay uninterpreted; absence
of loop metadata does not establish backend behavior. No new world playback
category is connected by this parser change.

The later [retained backend audit](../artifacts/native-parity/research/native-world-audio-20261106/backend-closure/REPORT.md)
joins a historical decoded configuration to `ALAudio.ALAudioSubsystem` and pins
the original backend/dependency identities. This is configured state, not a live
backend observation. Its missing ALAudio.dll/ALAudio.int/Option.ini collection
was subsequently completed, as recorded above. Three Musveren attack cue
payloads/times have exact source
joins, but looping, specialized AttackShot dispatch and backend rules remain
unresolved. No additional faithful playback category follows from that audit.

At the earlier acceptance checkpoint, playback in `src` was confined to
`PackagePreview` / `nativeEventAudio`; the world had no connected audio. The
inspector deliberately auditions linked references without resolving
native random, surface, conditional or spatial semantics. It is not a native
audio policy and must not be connected unchanged as one.

Published actor packages contain 63 fighter and 12 monster sounds. Standalone
skill/music samples also exist. `artifacts/native-audio/native-audio-audit.json`
checks 295 Ogg inputs (250 music, 45 voice) in its historical source scope. These
counts establish neither complete Interlude export nor audible world playback.
The later 106-sound map export is documented above; ambient world playback and
native policy remain unverified.

The first [repeatable source/export census](../artifacts/native-parity/research/audio-world-20261106/inventory/README.md)
now makes those gaps concrete. Run `pnpm exec node scripts/audit-native-audio-coverage.mjs`:

| Census stage | Measured scope |
| --- | --- |
| Retained IMPORTA file list | 27 UAX and 295 Ogg names; dated filesystem census, not current content hashes. |
| Pinned local sound packages | 18 UAX, 4,773 indexed Sound exports with source/package/payload hashes; nine listed UAX remain unstaged. |
| Verified current migration | 100 archives validated; 77 distinct exported sound payloads: 63 fighter, 12 Musveren and two Power Strike. |
| Active actor catalog | 75 embedded sound payloads; 356 distinct notifications. The raw 688 rows repeat fighter notifications in equipment and must not be counted as separate source events. |
| Full raw map | 2,622 AmbientSoundObject exports, zero decoded ambient records; two MusicVolumes with IDs 202001/202002. These are declarations, not 2,622 audible emitters in the visible section. |
| World/native comparison | Zero observed world playback cases; no native audio parity pass. |

The census's zero decoded ambient/world-playback rows describe its historical
state, before the declaration fix, six-cue world preview and ambient export
above. Its two runs reproduce JSON/Markdown byte-for-byte and verify 211 input
hashes unchanged. `coverage.json` retains all source identities,
notification fields and category-specific gaps. The raw filesystem list has no
content hashes for the unstaged files; no whole-client export percentage follows.

The [reviewed census](../artifacts/native-parity/research/audio-world-20261106/inventory-reviewed/README.md)
enforces converter source-hash/object/file joins for all 77 payloads and retains
the actual MusicVolume source transforms. Two reviewed runs reproduce exactly;
the initial census remains historical.

The [ambient migration correction](../artifacts/native-parity/research/audio-world-20261106/REPORT.md)
now exports all 2,622 AmbientSoundObject declarations to `ambient-sounds.json`.
An Actor-only filter had skipped these LevelObjects. Scratch builds retain all
25,326 property ranges and reproduce 16 files byte-for-byte, preserving all 13
prior non-manifest map outputs. **51 focused Python tests pass.** No world
playback or runtime staging follows from this raw-data fix; the active catalog
and saved scene remain unchanged.

[Static native notification analysis](../artifacts/native-parity/research/audio-world-20261106/native-notify-static.md)
has narrowed the dispatch dependency: Notify contains RNG/scalar/radius rules,
and PostLoad can replace 24 footstep references from `ALAudio.int`. Native
member/property identification and the concrete audio backend's loop,
attenuation and listener rules are still unresolved. Serialized surface arrays
alone cannot select the final footstep sounds. No native client code ran and
these findings do not pass playback acceptance.

The source/export/runtime audit lives under
`artifacts/native-parity/research/audio-world-20261106/`. Record separately:
source-inventoried, locally staged, metadata-decoded, exported, hash-validated,
referenced by an action/region, connected to world behavior, observed audible,
and compared against native. An unknown source universe must remain unknown;
a percentage over a partial staged set is not whole-client coverage.

## Runtime ownership and delivery

Keep source resolution and playback in presentation; `GameWorldAdapter` carries
semantic world state/events and remains suitable for later networking. One
world-owned audio mixer must unlock from a real browser gesture, offer usable
mute/volume controls and expose load/unlock errors and retry. Readiness must
distinguish a browser gesture requirement from missing or failed content.

Use the same source-duration action clock as the animated actor. Distinguish
one-shot, loop, seek, retrigger and pause; a one-shot end must not emit the next
loop's time-zero cue. Equipment parts must not duplicate actor notifications.
Despawn, scene disposal and loading cancellation release sources and resources;
pending decode must never play after ownership ends. Browser interruption rules
are explicit presentation behavior, not claimed native semantics.

Keep native-source audio metadata and authored overrides separate. Any Editor
audio authoring must survive save/reopen/rebuild and regeneration. Existing
authored scene files, source assets and acceptance thresholds remain protected.
No service changes, deployment, publication or new native runtime/capture action
is authorized by this clarification alone.

The separate terrain-pilot owner subsequently received one supervised apitrace
14.0 win32 graphics-pilot authorization on IMPORTA-PC. That owner retains it;
it adds no audio capture, engine observer or native configuration permission.
Graphics-only apitrace cannot establish audio parity.

## Evidence required to pass

Extraction, successful decoding, a running AudioContext, an inspector Play
button, or a silent screen recording cannot pass world-audio acceptance.
Use real world gestures/actions and record exact source/event identity, actor
clock, scheduled and observed onset, duration, output measurements, errors and
cleanup. Verify mute/volume, browser unlock, repeated actions, interruption,
surface/region changes and positional/listener behavior where applicable.

Retain matched native/browser audio recordings with their actual sample rate,
channels and capture latency. Define timing/amplitude/spatial tolerances and a
single measured alignment method **before** parity implementation/comparison;
do not tune thresholds to a result. Compare distributions for native random
selection instead of demanding identical random draws. Numerical audio
tolerances are currently **unestablished**, so native audio parity cannot pass.
Video and performance acceptance retains its existing independent thresholds.

The supplemental machine-readable gate is
[`native-audio.acceptance.json`](../recipes/native-audio.acceptance.json).
It adds mandatory coverage without rewriting the earlier visual/performance
contract. Overall 1:1 remains incomplete while world audio or any required
category is missing or unverified. Phase 2 networking remains planned.
