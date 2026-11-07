# Reusable Interlude conversion and expansion

Current direction: 2026-11-07. The end goal remains reusable conversion of the
native characters/races, male/female variants, equipment, animations, effects
and map tiles for Babylon WebGPU and Babylon Editor. The user has explicitly
ordered the next work: finish human male/female, their class skills and usable
20_20 traversal before adding more races or map tiles. The reproduced indoor
stair-support defect now passes on both routes; automatic routing and indoor
camera obstruction remain open, so this does not close all 20_20 traversal.
One fighter recipe does not establish coverage of all human classes or skills.
Audio belongs to each supported system's dependency bundle and acceptance.

## Architecture

Use small, independently runnable scripts for the relevant game systems:
characters/animations, world geometry/placements, materials/textures,
skills/effects, sky/environment and audio dependencies. A selected system or
asset must be convertible without running all extraction or other unrelated
systems. Shared format readers, identity validation and packaging helpers may
be reused; they are not a reason to require a monolithic command.

The existing `pnpm assets:pipeline` orchestrator is optional convenience for
explicit jobs. Dedicated commands remain primary, and orchestration is not a
prerequisite for an individual conversion or the next playable improvement.
Preserve its completed receipts; do not expand or rerun a batch merely to use
one system. Recipes select variants and source objects without copying format
readers for every race, building or tile. Not every desired game-system CLI or
runtime adapter is complete yet; the table below records the actual coverage.

```text
Read-only Interlude source + source/dependency identities
  -> inventory and recipe selection
  -> type-specific readers/converters
  -> verified GLB, textures, audio and metadata/event sidecars
  -> versioned bundles + coverage manifest + reusable cache
  -> explicit browser staging / additive Editor integration
  -> runtime behavior and source/authored-route verification
```

GLB carries models, rigs and supported animations. It cannot carry all native
particle behavior, animation notification logic, skill dispatch, surface sounds
or map streaming rules; those require sidecars and browser implementations.
Original source identities, unsupported records and provenance stay in the output.

## What exists now

| Area | Reused implementation | Current coverage and remaining work |
| --- | --- | --- |
| Shared conversion | `scripts/native_assets.py`, exposed as `assets:convert`, `assets:batch`, `assets:verify` | Common model, texture and audio conversion; dependency hashes, validated archives and cache reuse. Batch requests select source objects and bindings. |
| Optional batch orchestration | `scripts/native_batch.py` and `native_batch_adapters.py`, exposed as `assets:pipeline` | Dispatches explicitly selected assets, legacy migration, environment, sky, sound-batch and ambient jobs. Supports plan, sealed batch reuse, write-free verification and verified product copying into a fresh output. Dedicated scripts can run independently; staging/Editor integration and benchmarks remain separate. |
| Legacy migration adapter | `scripts/native_migration.py`, exposed as `assets:migrate` | Eight recipe-driven job groups for the actor/equipment/NPC/map/texture/effect slice. Its retained61/151 map output is historical; automatically staging it would replace the newer62/157 catalog. The new batch entry point never supplies staging or Fleet flags. |
| Characters/equipment | Shared converter plus assembly, source binding and skin/animation readers in `scripts/native_assets_lib` | Both staged fighters support original Walk/Run clips with explicit original footstep previews. Female fighter has seven parts, 113 clips and 61 linked sounds; selected world profile/equipment/action/audio checks pass both routes on hardware WebGPU. Other human classes/skills, automatic surface selection and full Editor acceptance remain open. |
| World/buildings | `scripts/native_map.py`, `scripts/native_map_geometry.py`, shared model converter and additive packing tools | Current selected 20_20 content has 62 models / 157 placements, terrain extension and four qualified BSP resources including the restored room shell. This is not the whole map or all neighboring tiles. |
| Placement step sounds | `scripts/bundle-native-placement-audio.py` | Dedicated dependency adapter preserves 24 original slots on eight selected placements and copies three existing original WAVs. All 149 omissions remain explicit. It does not reconvert geometry, stage the bundle or establish automatic playback. |
| Selected skill audio | `scripts/bundle-native-skill-audio.py` | Independent skill/level recipes retain complete selected rows, global ordinals, duplicate rows, nine sound slots and thirty voice strings. Power Strike packages two unchanged existing WAVs; group-less names remain candidates, and native lookup/timing/runtime playback remain open. |
| Sounds | `scripts/export-native-sounds.py`, shared audio converter | Completed 4,773 Sound exports from 18 locked UAX packages; nine more packages in the dated census and complete standalone music/voice coverage remain outside this batch. |
| Ambient declarations | Map reader and `scripts/export-native-map-audio.py` | All 106 exact referenced Sound dependencies exported for the selected map inventory; emitter declarations retained. World ambient playback remains unconnected. These sounds overlap broader inventories; do not sum the counts. |
| Sky/environment | Sky extraction/staging and `scripts/export-native-environment.py`, `scripts/stage-native-environment.mjs` | Three original sky layers and 20 tables / 500 physical color rows available. Reversible row comparison works; native default selection, clock/interpolation and live color writer remain unproved. |
| Effects/skills | `scripts/native_effects.py`, `scripts/native_effect_bundle.py`, browser effect adapters | Source action/effect/dependency graphs and selected effects are retained. Native flame preview and explicit male/female special-attack animation/direct-cue playback work. Complete Power Strike presentation, all skills and general particle execution are unfinished. |
| Browser/Editor staging | Dedicated `scripts/stage_native_players.py`, existing stage/import/append tools and normal generate/build | Player staging verifies immutable packages/profiles and a current-catalog hash, adds records without replacing the world, and supports write-free plan/verify/repeat. Existing authored changes must survive; conversion must not automatically reimport saved scenes. |

Relevant commands and source-format limits are in [ASSET_PIPELINE.md](ASSET_PIPELINE.md).
Use the pinned Interlude input directory explicitly with individual historical
commands; some older examples default to a different local client. A `.l2asset`
package can be inspected without silently replacing a world entity.

## Audio travels with each system's dependencies

An actor, animation, skill or enemy conversion bundle must retain its
source-resolvable audio payloads together with timing/events and exact source
identities. Reuse already verified shared payloads instead of requiring a full
sound-corpus run. Preserve unresolved specialized events and lookup dependencies
explicitly; a missing sound selection must not become a guessed cue or a claim
that the event is silent. Current direct-reference embedding is narrower than
complete dependency resolution. Playback consumers remain a separate required
implementation/acceptance stage within the same system, not a detached optional
audio project.

The [selected-skill checkpoint](../artifacts/native-parity/research/native-human-skill-audio-20261107/REPORT.md)
adds reusable dependency packaging without reconverting models, particles or
the sound corpus. Its complete source tables contain 29,812 skill rows and
1,398 sound rows; the current recipe selects Power Strike 3/1 only. Two original
WAVs are packaged and 35 focused checks pass. Both populated fields are
`spelleffect_sound_*`; a filename ending in `_shot` does not establish an impact
phase. No additional world cue is connected by this tooling checkpoint.
Separately, the existing male/female special-attack animations each have four
direct cues, eight events using seven original WAVs. The subsequent
[runtime integration](../artifacts/native-parity/research/native-human-special-attack-20261107/REPORT.md)
connects those existing payloads to an explicit source-animation preview in
the world. No additional extraction is needed. Their native skill dispatch and
remaining specialized notifications still need separate implementation/evidence.

With special preview enabled, each selected human-plus-Musveren world route
has thirteen action-cue definitions/twelve distinct action payloads; both human
variants together define twenty-one cues/sixteen payloads. These overlap the
existing archives/corpus and exclude the separate footstep bundle. The earlier
counts below remain their historical checkpoint scope. Basic Hand attacks
report six uncovered events per fighter; special clips retain two each.

Keep these separate: **4,773 converted Sound exports**, the male/Musveren
checkpoint's **75 embedded actor WAVs**, and its **nine connected world preview
cues**. The latter are four fighter
death, two Musveren death and three direct Musveren attack cues. Their source
identity and animation event timing are verified; complete native playback
policy is not. The three counts describe different coverage and are not additive.
The female package separately contains 61 linked original sounds. The later
[female-world integration](../artifacts/native-parity/research/native-ffighter-world-20261107/REPORT.md)
passes source/authored desktop and mobile viewport/touch checks on hardware
WebGPU, including post-gain audio output. Its selected route has four female
death plus five Musveren cues, nine total; thirteen cue definitions exist across
both player variants. Six specialized female attack events remain uncovered.
Neither these cue counts nor the overlapping package payloads add to the corpus
total. This is a scoped browser pass, not physical-phone, native audio or full
human-class/skill acceptance. The earlier four-cue source/unit receipt remains
historical evidence, separate from the newer world output proof.

The selected fighter walking/running notifications already retain 20 distinct
fully qualified footstep references, all present in the completed export corpus.
The dedicated animation-audio bundle now reuses those WAVs and preserves all
events/ordered slots. Both fighters' Walk/Run world playback passes hardware
source/authored checks with explicit default-Off surface/sample selection; see
the [locomotion report](../artifacts/native-parity/research/native-human-locomotion-20261107/REPORT.md).
The [accepted-contact implementation](../artifacts/native-parity/research/native-ground-contact-20261107/REPORT.md)
also retains actual movement-support mesh/triangle identities beside footstep
dispatches, with live source/material diagnostics. This is the local support
boundary needed for sound integration; it does not infer a surface category.
Automatic native surface selection remains open. The separate group-less
ALAudio configuration lookup remains unresolved; it does not block packaging
these exact authored references. See the [human coverage inventory](../artifacts/native-parity/research/native-ffighter-world-20261107/HUMAN_NEXT.md).
The separate [placement-audio adapter](../artifacts/native-parity/research/native-placement-audio-20261107/REPORT.md)
now retains actor-level StepSound declarations that the geometry projection
previously omitted. Its eight declared placements and three WAVs are dependency
coverage, not newly connected automatic world cues.
Skill audio needs cast/shot/impact
event binding. Music, positioned/looping ambience, remaining voices/weapon/action
sounds and UI need their own runtime consumers and controls. Payload conversion
can proceed independently of missing native playback rules, but those rules
cannot silently be invented and labeled native parity. See [NATIVE_AUDIO.md](NATIVE_AUDIO.md).

## Next work, in the user's order

1. Preserve the now-passing scoped male/female world profiles and selected
   equipment/action/audio bindings. Complete remaining human bases, appearance
   and equipment coverage, footsteps and new interactive Editor save proof.
   Keep source-loaded and authored/exported routes verified; preserve authored
   work and existing terrain UV/UV2.
2. Establish the human class and skill inventory, then complete their
   character/animation/effect/audio dependency bundles and gameplay consumers.
   Report missing classes, skills and specialized sound lookups explicitly;
   the fighter recipe or a Power Strike sample is not all human class coverage.
3. Preserve the [indoor-stair support repair](../artifacts/native-parity/research/native-stair-traversal-20261107/IMPLEMENTATION.md):
   male/female ascent, descent and real ramp clicks pass on both hardware
   WebGPU routes. Original static collision declarations now reach navigation.
   Automatic routing around turns, indoor camera obstruction and complete
   20_20 traversal remain open; the full map is not certified by this route.
4. Only after this human/class-skill/20_20 milestone, extend other races/sexes
   and map tiles through independently runnable system scripts. Preserve exact
   source rigs, terrain seams, placements, dependencies and cross-tile identity;
   derive bounds from complete geometry and keep the qualified UV scope bounded.
5. Keep one persistent runtime Scene with bounded cells and shared resources.
   Add residency/LOD/instancing according to measurements as the supported
   slice requires. Separate Editor authoring files per tile remain compatible.

Conversion, staging, runtime behavior and visible/audible acceptance stay
separate coverage stages. Optional orchestration and future expansion must not
displace the current playable milestone. Do not rerun completed corpus exports.

The [female-fighter conversion and browser proof](../artifacts/native-parity/research/native-ffighter-expansion-20261107/REPORT.md)
now supersedes the earlier candidate-only status. `native-pipeline-ffighter.json`
uses exact female table/default/material inputs. The reader preserves identical
duplicate localization rows; conflicting rows still fail. Female face/hair keep
their existing native head weights instead of applying the male root-only rigid
override. Seven parts, 113 clips, 323 events and 61 sounds reproduce in a clean
build. Both native routes at desktop/mobile sizes pass hardware WebGPU inspector
checks. That receipt establishes package integration; the later female-world
report above establishes the separately verified playable profile.
Hair color 0 is an explicit recipe choice; native representation selection and
face-rotation behavior remain unproved. Shared reader changes use fresh outputs,
leaving historical batches and sound corpus receipts intact.

## Optional batch commands and limits

The checked starter recipe uses pinned Interlude inputs plus a separate five-file
environment lock. It converts one building, one texture, one original skill
Sound, source sky geometry and environment tables into a dedicated offline folder:

```powershell
pnpm assets:pipeline --recipe recipes/native-pipeline-slice.json --output artifacts/native-pipeline/slice --plan
pnpm assets:pipeline --recipe recipes/native-pipeline-slice.json --output artifacts/native-pipeline/slice
pnpm assets:pipeline --recipe recipes/native-pipeline-slice.json --output artifacts/native-pipeline/slice --verify-only
```

The unchanged second command reuses its sealed batch after rechecking current
source/recipe/tool pins and product hashes. It does not call converters again
or rewrite output mtimes. This is **batch reuse**, not a claimed converter-cache
hit. `--verify-only` never invokes the legacy migration verifier that writes
validation files. Changed settings/implementation or corrupted products require
a fresh output; they are not silently rebuilt over historical evidence.

`--reuse-from <completed-batch>` copies only matching, hash-verified job products
into a **fresh** target, recollects their integrity/source coverage and leaves the
original untouched. It executes adapters only for unmatched jobs. Interrupted
or unowned outputs are refused. Jobs may name earlier `dependsOn` IDs; incomplete
dependencies block their consumers while independent jobs retain their results.
Exit0 means requested conversion coverage complete,2 means explicit partial
coverage and1 means failure. None means gameplay or native acceptance complete.

The [actual batch proof](../artifacts/native-parity/research/unified-asset-batch-20261107/REPORT.md)
covers clean/repeat/verify/reuse and62 focused cases (61pass,1Windows symlink
permission skip). The six adapters have contract tests; this checkpoint did not
rerun the legacy full migration, full4773-sound corpus or all106 ambient exports.
GLB structural validation is recorded separately from archive/source integrity.
No browser/Editor assets are automatically replaced and no gameplay policy is
selected. At that batch checkpoint, world audio had nine connected preview cues;
the later female route also selects nine, with thirteen definitions across variants.

The [current WebGPU measurement checkpoint](../artifacts/native-parity/research/webgpu-performance-20261107/REPORT.md)
provides opt-in instrumentation and a bounded pilot, not a performance acceptance
pass. Keep the original fidelity and GTX1060/120FPS workload thresholds unchanged.
Final visible Editor proof, full world/audio integration, complete asset coverage
and Phase2 networking remain open. No new deployment or native-runtime authority
is implied by this expansion plan.
