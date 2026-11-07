# Audio tool investigation

Inspected upstream commit `12c9656e2f053b233ec3fd87056491a6a6da8b0c`. Paths beginning `tools/` refer to upstream; other paths refer to this client. Read upstream `AGENTS.md` and `LICENSE`: authored tools are MIT; original NCSoft audio is explicitly excluded. Existing selected BSP reuse already pins this commit in `scripts/vendor/lineage2elbera_bsp/SOURCE.json:3`.

## Inventory and actual behavior

All 13 filenames were inventoried: `build_audio.py`, `build_steps.py`, `build_stepnotify.py`, `export_quest_sounds.py`, `export_tutorial_voice.py`, `native_audio_profile.py`, `sound_reference_aliases.py`, `verify_falloff.py`, and five tests: `test_quest_sounds.py`, `test_tutorial_voice.py`, `test_native_audio_profile.py`, `test_sound_reference_aliases.py`, `test_skill_sound_rows.py`.

These are Python offline converters, source auditors and synthetic regressions; there is no browser inspector in this directory. `build_audio.py:71` replaces the music capture signature or copies clean Oggs; `:105` invokes repository-local umodel, and `:119` invokes ffmpeg to downmix WAVs to mono, lossy 48-kbit Opus. Its DAT-JSON bindings retain ordered skill rows and fifteen voice slots (`:175`), although NPC gains/radii are rounded (`:244`). Manifest generation assumes upstream asset directories.

`build_steps.py:163` decodes map StaticMeshActor step banks, then joins mesh names and rounded positions to upstream `scene.json` (`:199`). `build_stepnotify.py:294` scans UKX sequence records against umodel PSA names/frame counts/rates; authored plausibility limits and tolerances are explicit (`:248`, `:261`, `:283`). It selects sound-less AnimNotify_Sound records, expects two locomotion footsteps and rounds exported timeline positions (`:385`, `:420`). These depend on `l2lib`, world conversion helpers and upstream character/scene products, not merely Python.

`sound_reference_aliases.py:48` reconstructs nested source identities; `:65` admits flat output mappings only for unique package/basename pairs, recording ambiguity and hashes. It proves identity correspondence, not equivalent decoded sound or native group-less lookup. Quest export preserves stereo WAV bytes using `tools/ui/check_playsound_native.py` helpers (`export_quest_sounds.py:15`, `:28`). Tutorial export copies a hash-pinned English catalog unchanged, including opaque post-EOS trailers (`export_tutorial_voice.py:69`).

`native_audio_profile.py:51` reads hash-pinned config/DLL inputs and checks disassembled instructions through UI helpers and Capstone, emitting selected configuration and missing-option defaults. It explicitly disclaims authenticated retail defaults (`:120`). `verify_falloff.py:208` reads PE globals/imports and byte patterns without executing DLLs. Its final checks require particular upstream JavaScript panner settings (`:243`); they do not independently derive or demonstrate the complete native attenuation curve.

## Local overlap and reuse verdict

**Keep local audio conversion.** `scripts/native_audio.py:43` already validates Ogg page CRCs, sequence, duration and native footer; `:114` inventories complete RIFF framing. It is stricter than upstream signature replacement/framing inspection. Local `scripts/export-native-sounds.py:121` preserves source records, and `docs/NATIVE_AUDIO.md:39` distinguishes 4,773 exports from nine connected preview cues. Copying the mono Opus pipeline would lose established source-byte/channel fidelity.

**Adapt narrowly:** `skill_sound_rows` and its fixtures provide a useful all-row preservation oracle. Local `scripts/native_effect_bundle.py:348` already decodes skillsoundgrp and retains selected source rows (`:351`); an adapter should compare existing decoding, not replace it. Alias ambiguity fixtures are useful for coverage audits, but must not relax exact local joins in `scripts/native_assets_lib/footstep_config.py:129`.

**Reference only/defer:** step builders require different scene/animation contracts and heuristic admission. Profile extraction offers reusable evidence patterns after matching actual input hashes; do not transplant upstream supplied settings. Falloff verification needs independent formula evidence. `src/audio/WorldAudioMixer.ts:143` implements bounded one-shot preview playback, with no spatial/ambient policy; these exporters cannot close that runtime gap.

## Smallest proof and execution

Adapt only `skill_sound_rows` into an offline comparison using existing decoded local records. Acceptance: retain every ordered duplicate/empty row, all 3×3 sound slots, fifteen voice slots, zeros and fractional gains; reject incomplete/nonfinite fields; compare original selected rows before/after adaptation. This establishes record preservation, not event dispatch, arithmetic equivalence, audible appearance or integrated playback.

Executed `python -B -m unittest test_skill_sound_rows test_sound_reference_aliases test_native_audio_profile test_tutorial_voice` in upstream `tools/audio`: **14 tests passed**. Read all five test files first. Capstone and upstream private `ALAudio.dll`/`ItemSound.uax` fixtures are absent; quest/native extraction was not run. No native binaries, converters, servers, installs or private-asset mutations were performed.
