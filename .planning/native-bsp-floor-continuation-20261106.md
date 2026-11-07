# Continue the active asset goal: sky and original audio

Superseded continuation: read
[native-sky-audio-continuation-20261106.md](native-sky-audio-continuation-20261106.md).
The floor remains complete; sky geometry and six world death cues are now
integrated and verified. Native sky/audio parity and the broader goal stay open.
The older checkpoint below is retained as history, including its earlier gaps.

The user's latest steering is **"also sky and audio, continue with goal"**.
The broader tracked goal remains ACTIVE. Do not mark it complete from the floor
checkpoint. Continue sky and world audio before the prepared extra tree.

## Completed floor checkpoint

Read docs/NATIVE_BSP_FLOOR.md and
artifacts/native-parity/research/native-building-floor-20261106/REPORT.md,
final-verification.json, editor-repeat.json and stage-repeat.log.

Root cause: StaticMesh Actor940 is a hollow building shell. The missing floor
is final Level.Model798/Brush397 BSP,10nodes/48vertices/28triangles;topY=-34.26m.
Extractor scripts/native_bsp_floor.py (vendored selected MIT reader), immutable
derive-native-map-bsp.py and append-native-editor-bsp.mjs are implemented.
Both source and authored routes show it; stairs, walls, floor and exit pass.

Current section manifest93139ab0f6751ef3ea5f639876e862900d3767c711754ef2af9e2a0907e97a66.
156staticplacements/61models plus1BSP. Source944files;938oldfilesunchanged.
Saved/public/dist floor binary2ae802e39a9c4a98cabcaa5f9e1b724cdb1a98c7da23002175e8689898d7429a.
All position/normal/UV/index bytes equal source. Initial a7fd49e2... binary remains
historical: signed-zero normals were corrected by guarded56-byte fix, no numeric
change. Writer now structuredClone preserves those bits; metadata comparison
accounts for JSON zero canonicalization. Repeat append/stage makes zero changes.

All7479baselinefiles accounted:7474unchanged;only root/config/channelmanifest,
catalog and generatedexportcache changed. Every pre-existing authored mesh,
material and geometry unchanged. Terrain549a7fef...,primaryUVd549356f...,UV24c6a9644...
remain exact. Never restore an older bundle, reimport scene or repeat735-V migration.

Checks: extractor10pass;deriver12pass+1Windows symlinkcreation skip;runtime suite113pass;
authored BSP28pass(includes26old);Editor append10pass. Seven browser cases pass;
after finalnormalfix two authored desktop/mobile cases passagain. Finalbuild/typecheck
pass. Four fixed-camera before/after captures ready/noerrors onGTX1060/D3D11.
No native-pixel/lighting/collision/audio/performance-parity or new EditorUI-save claim.

Owned Vite development server is still running for ongoing work:
http://127.0.0.1:5184, execsession80523. No task browser left open. Preview failed
twice on snapshot with15s timeout; localPlaywright used afterquotingerror. New browser
steps should follow current preview instructions. No deployment/servicechanges.

## Active parallel ownership at handoff

- /root/missing_mesh_bounds: read-only sky audit, output
  artifacts/native-parity/research/native-sky-20261106; no runtime edits.
- /root/new_model_authoring_plan: read-only audio evidence and optional bounded
  offline member-layout investigation, output native-world-audio-20261106; no code.
- /root/reuse_extra_models: completed isolated tree conversion below.
- Parent owns all sky/audio/runtime/UI implementation and integration.

## Sky source lead

Actor940/Brush397 PointRegion names ZoneInfo1/zone1; floor node620 zones(0,1).
Final Level.Model has skyzone28→SkyZoneInfo0 at native
[292.202758789,264403.15625,24503.01953125].53skyroom nodes use HazeRing_Final(47),
SkybackgroundColor(5),Cloud_Final(1);218fakebackdrop nodes referenceT_texture.Texture.Base.
Sky package l2_skies.utx is UE118/licensee0; current production reader correctly
rejects it. Pinned external reader can inspect exacttables/tags read-only. Do not
broaden gates or invent gradient/skybox/time-of-day. Await qualified source chain.

## Audio starting point

Read docs/NATIVE_AUDIO.md, .planning/native-audio-continuation.md,
recipes/native-audio.acceptance.json, audio-world-20261106/native-notify-static.md.
World is still silent; package inspector audio is diagnostic, not reusable native
policy. Source audio acceptance includes music,ambient,steps,voices/combat/skills/UI.
Direct Musveren death cues have exactsource/time0.03333333417152365s,Random100default;
native offset names and backendloop/gain/radius/listener remain unproved. Existing
src/assets/package/nativeEventAudio.ts playsalllinked events asauditions: do not wire
it unchanged or claimparity. First useful integration may be explicitly labeled
original-source cue preview with sourceclock,oneworldmixer,trustedgestureunlock,
mute/volume,disposal/pause/retriggerandactualoutput evidence;nativepolicy staysopen.
No audio implementation edits yet. Parent read NativeActor/NativeCharacterVisual
and nativeClipPlayback; best callback is native-driverplay/update before idle-return
so events don'tduplicate equipment or wrap one-shot timezero.

## Prepared tree

artifacts/native-parity/research/map-overlap-expansion-20261106/new-tree-conversion/REPORT.md.
Dion_tree_S.red_mt.dion_excute_tree1 / StaticMeshActor3703: sourcebounds/indexed
overlap proven8triangles. Conversionarchive3333e47c.../GLBbc10ab9c...;cleanrebuild
identical,cachehit,Khronos0errors/0warnings,520sourceindices/UVs/exactfloatpositions.
UModel already changes normals by up to0.00471324component/0.3360967degrees;
leafShader TreatAsTwoSided/native lighting unverified. NOT staged. Preserveoutputs;
attribute native-normal relationship before integrating/fixing. Source/toolsunchanged.

Restrictions unchanged: source read-only,destination scratch,binarieslocal,protected
l2.ini/JumpFluid/native pilotownership. No native launch/input/injection/replay/new
capture permission. The74file terrainpacket remainsunreviewed;separate27file review
onlycoversitself. Native researchthread601a15f1... read returnedthread_not_found;
don'tpretendcoordination succeeded. Audio1:1mandatory;networkingPhase2planned.
