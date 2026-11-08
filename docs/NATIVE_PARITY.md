# Native parity

The fixed parity contract, the GTX 1060 performance protocol and the L2.exe capture rules. It is the polish-stage goal (POL-01, POL-02, PERF-01); stage A uses the lighter DEC-OWN-3 check. Thresholds are never relaxed (DEC-PARITY-1). Decisions and order: [.planning/PROJECT.md](../.planning/PROJECT.md), [.planning/ROADMAP.md](../.planning/ROADMAP.md).

## Fixed contract

Source: [`recipes/native-parity.acceptance.json`](../recipes/native-parity.acceptance.json), committed SHA-256 `7a0ae70c593dbdad30637fa1de7bfd446d7091cbe0f31bb97eab31c130ea2df5` (a CRLF checkout hashes differently). It holds every rule and numeric threshold, and every result records its SHA-256. Do not relax a threshold in response to a failure. Missing or uncertain evidence is unverified, never a pass.

- `cases`: Human male fighter equipment and animation from source; Greater Musveren (`LineageMonsters.field_stalker_m00`) including death; Power Strike skill 3 with coordinated motion and effect; a declared section of `20_20.unr`. Full native attack motion comes first; skill-viewer VFX on an idle avatar is not enough.
- `reference`: at least 30 captured FPS, one frozen camera calibration per case and one measured timeline offset per recording, no frame warping, no mismatch masking. A requested or nominal recording rate never stands in for decoded cadence.
- `visual`: pixel tolerances scale with viewport height against 1080 pixels; source geometry and key tolerances do not. Particles compare timing and spatial distributions over at least five native repetitions and declared browser seeds.
- `performance`: the PERF-01 workload and 120 FPS target. Run the same scene, camera, seed and input before and after; record no video during a trial; report unavailable GPU timing instead of estimating it. Software-rendered results never qualify, RTX 4090 results describe IMPORTA-PC only, and native and browser speed are compared only on one machine under the same conditions.
- Audio: [`recipes/native-audio.acceptance.json`](../recipes/native-audio.acceptance.json) supplements this contract (POL-02). Exports and decoding alone never pass.
- The JSON's `editor` block (Editor 5.5.3 round trip) is superseded by DEC-OWN-8 and gates nothing (NOED-05).

## Now

Capture evidence sits under `artifacts/native-parity/reference-current/`.

- DATABASE-PC's AOC display runs 1920 x 1080 at 60 Hz, no mode above 75 Hz. IMPORTA-PC's 144 Hz display ran 2560 x 1440 at 59 Hz on 2026-11-05, with a 120 Hz mode enumerated but not selected (`display-cadence-20261105-20261105-204351/`).
- `ANIMPLAY ANIM=Atk01_Hand_MFighter` shows the full attack loop, but its recording decodes at 4.142 FPS (`animplay-20261105-20261105-200102/`) and `gfxcapture` reaches 8.320 FPS (`cadence-repair-20261105-20261105-201418/`). Both fail the 30 FPS gate.
- `ANIMPLAY ANIM=Wait_Hand_MFighter` requests explicit idle. Never use `CHANGEANIM`; it mutates animation mappings.
- Captures (CHECK-01) use `C:/Lineage2-client-support/debug-control/Control-L2.ps1` on IMPORTA-PC; read `CONTROL.md` there first. Launch `L2.exe` directly, windowed, with RunAsInvoker and the Debug INI. Start-Client rewrites the INI; exclusive fullscreen crashes.
- The Debug INI hashes `e0e4a52e...` (`recipes/native-inputs.lock.json`). `recipes/reference-client-tree.lock.json` (2026-11-08) records it as `connection-profiles/l2-Debug.ini`, while `system/l2.ini` held the LAN profile (`0809edc9...`). Check `system/l2.ini` before a capture.

## Open

- A 30 FPS reference capture, then the four cases against the thresholds (POL-01).
- Audio tolerances and one alignment method (POL-02); a 120 Hz display for the GTX 1060 (PERF-01).
- Native movement speed, stride and per-clip loop rules are not established; ACT-04 covers timing and notify events only.

## Pointers

- `artifacts/native-parity/research/native-ui-playback/` (ANIMPLAY byte anchors), `artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/` (terrain anchors for polish).
- [RENDERING.md](RENDERING.md), [NATIVE_AUDIO.md](NATIVE_AUDIO.md), [VERIFICATION.md](VERIFICATION.md).
