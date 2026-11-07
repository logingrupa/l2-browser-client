# Continue the active asset goal after sky/audio checkpoint

Superseding checkpoint: read `.planning/native-sky-editor-continuation-20261106.md`
first. Actual sky Editor UI save/reopen/build/revert and live opacity checks now
PASS. The sections below retain the earlier integration checkpoint and timings.

Read docs/NATIVE_SKY.md, docs/NATIVE_AUDIO.md, docs/NATIVE_BSP_FLOOR.md and
artifacts/native-parity/research/native-sky-audio-integration-20261106/REPORT.md.
The broader tracked goal stays ACTIVE; do not mark it complete from this checkpoint.

Completed: original fortress slab, five overlap trees, scoped 735-V migration;
now source sky room (182 vertices/76 triangles, three original materials/textures)
and six original death cues connected to world animation on both routes.

Sky source snapshot manifest f7a0b5ef1463d0b5fe47b210585e00d6011be3c3e3bddfec76df0eb08042f80b.
Reusable commands: python scripts/native_sky.py --client
artifacts/native-parity/inputs/IMPORTA-PC --output
artifacts/native-parity/research/native-sky-20261106/source-snapshot-pinned;
then node scripts/stage-native-sky.mjs --source <that directory> --apply; pnpm build.
Do not reimport/regenerate the whole saved scene. Stager repeat preserves edits.
32 additions; all 2280 non-cache baseline files unchanged. Sky is a separate
saved root; source origin offset applied exactly once. Browser follows camera,
renders sky first and restores all presentation state on disposal. Default
glTF sampler and saved sampler match. Original compressed/decoded files retained.

Visible unresolved sky defect: hard yellow/blue boundary in after-wide-authored-desktop.png;
audio-controls-mobile.png shows clouds and the stored yellow background. Exact
source ColorModifier RGBA: background206,150,0; haze149,228,255; clouds151,192,255.
Do not repaint or introduce invented time-of-day. Source IDs/exports77/76/78 and
rawgraph at native-sky-20261106/source-snapshot-pinned/sky.json. Native camera,
live tint writers, opacity/blend/side precedence and cloud panner phase unproved.
RESEARCH_QUESTION.md in that directory's parent is the bounded retained-evidence prompt.

Audio: src/audio/WorldAudioMixer.ts, nativeActionCuePreview.ts, worldAudioControls.ts;
NativeActor clock + NativeCharacterVisual driver hooks; createNativeSliceRuntime
owns coordinator/mixer/UI/teardown. Only six exact death cues are admitted with
allsource hashes. Musveren pair simultaneous; fourfighter cues retain surprising
silenos sound. Single gesture-unlocked context, mute/volume, no queue, pause and
despawn cleanup. These are source-timed nonspatial one-shot previews, not native
backend policy. actual browser post-gain recordings and controls verified.
world-audio-coverage.json links six source tuples, two routes and eightWebMs.
Actual physical-speaker/native playback remains unverified. Other audio categories
(music/ambient/steps/skills/combat/UI/other voices) still disconnected.
Next closure leads: read-only IMPORTA system/ALAudio.dll, ALAudio.int, effective
audio-device config; ALAudio.u existence unknown. No new native action authority.

Verification complete:7Python sky,13stage,69runtime/sky,52audio/actor,14mixer;
148unit cases across selections. Build/typecheckPASS; glTF0errors/warnings,
12optional bufferViewtarget hints. Four ready samecamera desktop/mobile pairs
zeroerrors; terrainprimaryd549356f... and UV24c6a9644... unchanged. Saved/public/dist
skygeometry channels/textures exact; terrain549a7fef... floor2ae802e3... unchanged.
Two actualaudio routesPASS,12snapshotsperroute,8WebMs,17accepted/4intentionallydropped
crossingsperroute. Maxoffset21.43/34.23ms from animationclock; runtimecap100ms not
native tolerance. Quartergain0.2498/0.2509; mutedPCM~2e-34; contextsclosedonce.
Do not rerun completed suites without changes/new concerns.

Actual sky EditorUI edit/save/reopen is now verified by editor/sky-save-20261106.
RawPlay UV2/readiness and unknown lifecycle cause remain. Parent retains all
implementation/EditorUI ownership; see the superseding continuation for receipts.

All three childtasks completed; no active childbrowser remains. Existing owned
devserver127.0.0.1:5184 session80523 remains for continuation. No taskpreview tabs
remain. Sharedpreview failedtwice snapshot15s; localPlaywright fallback disclosed.
Capture scripts and receipts in native-sky-audio-integration-20261106. Images shown
inline via html_preview→html_render; use concise fresh updates and progressscreens.

Latest research coordination: user relayed terrain COLOR0/per-layer clamp evidence,
1568/2352 positions only. No production shader change justified. Saved shader
UV2unbound doesn't prove affineUVwrong. Runtime file: missingmaterial recovery may
clone current authoringShaderMaterial; nativeWorld rootreflect and Source/Neutral
mode affect loadedstate. Future captures must pin loaded material/mode/transforms.
Read latest color-state/color-origin reports under terrain-mask-native-rea-followup.
Research corrected its route to environment20b54a96-ad0d-46e3-9eec-9f7158c0978f,
thread28fd5fa6-471f-4127-aa36-31c7add4bae0. Reads and coordination now succeed.
Its sky-assist and native-color-reader packets are delivered; both are linked
in the superseding continuation. No production material correction follows.

Next priorities: native-evidenced sky correction if available; qualified audio
backend/default closure and further worldaudio;
prepared extra tree normals/materials; broader visual/performance acceptance.
Keep source/workspaces/protectedl2.ini/JumpFluid unchanged. No deployment/service
change/native launch/input/proxy/injection/replay/new capture/binarypublication.
74filepacketunreviewed; separate27filereviewonlycoversitself. Phase2networkingplanned.
