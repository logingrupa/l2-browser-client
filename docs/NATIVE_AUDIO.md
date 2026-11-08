# Native audio

Original Interlude audio: conversion, per-bundle binding and browser playback. Stage A binds sounds per bundle and checks them by ear against L2.exe; native-rule research waits for polish (DEC-OWN-3). Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- Nothing has passed the stage A listen check ([audio evidence](parts/audio/EVIDENCE.md)). Extraction, decoding, a running AudioContext or a silent recording never pass.
- Exports keep exact source identity: package, object, hashes, converter settings. A filename proves nothing. An event with no resolved Sound stays "unresolved", never invented or assumed silent.
- A browser rule without native evidence is labelled "presentation choice" on the dev sheet. Native facts: `artifacts/native-parity/research/native-sound-answers-20261107/REPORT.md`.
- Playback stays in presentation, outside `GameWorldAdapter` (ARCH-04). `src/audio/WorldAudioMixer.ts` unlocks on the first trusted gesture; controls in Dev > Audio.
- `pnpm assets:sounds` exports the 4,773 sounds of the 18 locked UAX packages (`artifacts/native-parity/research/native-world-audio-20261106/sound-batch-integration/REPORT.md`). Never rerun it to bind one actor or skill.
- Bundlers in `scripts/`: `export-native-music.py`, `bundle-native-ambience.py`, `bundle-native-placement-audio.py`, `bundle-native-animation-audio.py`, `bundle-native-skill-audio.py`; plus `pnpm assets:ambient`. Every `assets:*` run is integration thread only.

## Open

- Ambient, placement, sky and music audio for all 153 tiles (WORLD-02). Nine UAX packages, `interfacesound.uax` among them, and standalone music and voice files are outside `recipes/native-inputs.lock.json`.
- Voices, combat, skill and music for every bundle (ACT-05), each with a listen check (CHECK-02).
- POL-02: ALAudio footstep selection (grass is approximate, DecoLayers are not rendered), specialized attack sounds, native random, gain and attenuation rules, tolerances, matched recordings. Static findings: `artifacts/native-parity/research/native-world-audio-20261106/backend-closure/`.
- No requirement ID: UI sounds, region music transitions, native listener placement.

## Pointers

- Code `src/audio/`. Census `pnpm exec node scripts/audit-native-audio-coverage.mjs`. Gate [native-audio.acceptance.json](../recipes/native-audio.acceptance.json).
- Related: [NATIVE_POWER_STRIKE.md](NATIVE_POWER_STRIKE.md), [research index](research/INDEX.md).
