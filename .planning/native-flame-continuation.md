# Continue current native materials and reference work

Latest checkpoint: [native-flame-authoring-handoff.md](native-flame-authoring-handoff.md).
It supersedes active commands and pending flame-authoring acceptance below.

Updated 2026-11-05 about20:20Riga. Preserve existing dirty project at
`C:/laragon/www/l2-browser-client`, parent goal ACTIVE. Do not create a newgoal,
reset files, publish binaries or implement Phase2. Read the previous
`native-world-authoring-continuation.md` for completed authoring acceptance.

## Completed before this continuation

- Editor5.5.3 actual world placement save/reopen/Play;283unit/build pass;
  final authored desktop/mobile2/2 pass. All2245authoredfiles/53609808bytes
  preserved after repeat import. Frozen evidence
  `artifacts/native-parity/editor/world-import/browser-final-accepted/`
  and `completion-receipt.{md,json}`. Earlier mobile trace cleanup failure
  retained; fixture fix passed. Do not repeat these without changed runtime.
- Owned preview exec55146 on5173, built authored route HTTP200. Stop only this
  owned server before browser tests. Editor Play stopped; no current GUI work.
- All source/native/lineagen files remain unchanged. User permits GUI/input
  bothPCs; keep Jump/native running. Fleet/lane alreadyread; lane unsupported.

## Native reference status

`reference-current/animplay-20261105-20261105-200102/`: observed supported
ANIMPLAY unarmed Atk01_Hand_MFighter loop with windup/strike/recovery; exact
literal text beforeEnter and explicit Wait_Hand_MFighter idle verified.48source
hashes/attributes unchanged;82copied evidencefiles verified. Original video
33frames/7.966667s=4.142capturedFPS,233–267msPTS gaps. Fails fixed30FPSgate.
Native1366x768@60Hz, rendereradapter/rate/equipment/camera/location unknown.
Not coordinated PowerStrike or matched parity. Contactsheet shown inline.

New remote cadence diagnosis is active; do not poll it or send competing input:
task`node:delegated-task:command%3Amcp%3Acd560e39-23d5-4a03-a85c-285c5e04f4ef%3Aremote-delegate%3A2420b518-388a-419f-a458-1eb4355cf27c`
<t3-thread://v2/20b54a96-ad0d-46e3-9eec-9f7158c0978f/mcp:launch:67fca37e522ceac6dcf30ef3c3d958998cda9c22ba79724a89b4a9e2992dcd05>
Scope bounded existingFFmpeg backend diagnosis, new isolated recording helper
allowed, native/shared controller/INI/display/Jump unchanged. Copies evidence
to`reference-current/cadence-repair-20261105-<timestamp>`. Completion wakesroot.

That cadence task COMPLETED without a qualifying repair: GDI4FPS, DXGI stalled,
gfxcapture8.32FPS with25distinct losslessframes/3.004787s. Source48unchanged.
Evidence150files copied to cadence-repair-20261105-20261105-201418. FinalL2
minimized; desktop2560x1440@59, finalforeground unmet. No competingtaskleft.
New different-condition task uses documented prior1440p@120 capture success:
`node:delegated-task:command%3Amcp%3Acd560e39-23d5-4a03-a85c-285c5e04f4ef%3Aremote-delegate%3A1e333c48-2d22-4a79-8a6d-b2997baeed66`
<t3-thread://v2/20b54a96-ad0d-46e3-9eec-9f7158c0978f/mcp:launch:afd652a29cde77b862ecfdc94d6c750379681c2df29151053f53a246720d8140>
Normal OS restore +fresh supported modes, exact documentedsetres ifsupported,
at most2short diagnostics then8sreference onlyif>=30realFPS. Native/config/
sharedtools preserved; runtime supporteddisplay mode change explicitlyallowed.
Do not poll or send competinginput before this task completes.

## Current local flame work — agents own separate files

1. `powerstrike_integration_audit`: read-only source semantics under
   `artifacts/native-parity/research/flame-runtime/`. Proven enums:
   Shader5Brighten,3Translucent; Combiner2Multiply; Fade1Sinusoidal.
   Nativefade q=(time+phase)/period,w=.5+.5*cos(q*pi*.5),BGRA→RGBA/255,
   interpolate then floor/clamp*255. Period.4 means fullcycle1.6s.
   TextureTick uses MaxRate clamped.1..100,16frame chain/absolute inputtime;
   Min25unused in these paths. Native texture time and fade time are distinct
   renderer inputs; clock origins still unresolved. Billboard path replaces
   yaw with actor→viewportActor directionYaw+16384, retainspitch/roll.
   D3Dblend TranslucentONE/ONE, BrightenONE/INVSRCCOLOR, depthWritefalse;
   Combiner capability downgrade/lighting/alpha details still being traced.
   Await final source-semantics.md and evidence before implementing equations.

   Root staged D3DDrv.dll as DATA only under flame-runtime/inputs, after fresh
   fleetIMPORTA hash equality withE:/candidate. SHA256
   05622ddea5d96aec5618bc1ae064af9d27d83178f78d9631b5448377502e1323,
   1277972bytes. renderer-source-before.json+renderer-staging.json. Main143file
   lock unchanged. Rehash authoritative renderer/INI after work; never loadDLL.

2. `native_world_editor_research`: completed editor-runtime-integration.md:
   all240archivefiles staged and239inventoryhashesverified;12placements/24slots.
   Now implementing ONLY `src/scene/world/nativeMaterialGraph.ts` and
   `tests/unit/nativeMaterialGraph.test.ts`: typed verified declarative plan
   from existingAssetPackage, exact graph/classes/resources/native identities;
   noGPU/fetch/runtimeowner yet. API prepareNativeFlameGraph(asset) returns
   graph/provenance, shaders,16frames/rates,glow,fadeBGRA/colors/period/phase,
   Combiner enums/flags, billboardtag and resources. Root owns later runtime.
   Use reversible per-scene owner after either sectionroute; preserve authored
   material edits and source transforms. Release owner before section even in
   nestedstartupcatch. EditorPlay stripsShaderMaterial, so reconstruct from
   serializable recipe after parsing; don't bake transientframes into scene.

3. `editor_material_adapter`: confirmed nativeFormat8=DXT5 using pinnedUEViewer
   headers/source +exactFX_E_T source hash. Implemented source mip/DDS helpers
   and narrow native_assets.py derivative-format guard. Owns thosefiles plus
   tests/pipeline/test_texture_{mips,dds}.py and test_native_texture_validation.py.
   Actual glow has7authoredmips ending1x2; preservepartial chain. Babylon9.27.1
   DDS proof uploads onlymip0 exactblocks(enum33779), all7retainedinDDS.
   Isolated fullflamearchive250files/247graphfiles, below256/248limits;
   standaloneglow14files. Initial38+8focused tests passed. Root requested
   correction of staleP8gap text('supportsDXT1only') to accurateformatagnostic
   wording; agent refreshingproof and noting ONLYP8reasonmetadata changes.
   NativeP8/DXT1 bytes, PNGs, rigs/GLB stay unchanged. Evidence at
   flame-runtime/texture-dxt5/. Await final changedfiles/test/proof handoff.

## Root next

- Review final agent changes/evidence, run full pipeline once and reproducible
  migration with `--output artifacts/native-parity/migration-dxt5 --prove-rebuild`
  (check currentpaths first). DO NOTstage over currentauthoredsnapshot blindly:
  newconverterfingerprints change manifests, authoredimportrefusesdifferenthash.
  Existing source143lock,publicl2,authoredscenes should remain intact until
  deliberate upgrade handling. Preserve old381product/302test evidence ashistory.
- Implement actual flame presentation owner once source equations supported;
  retain explicit unverified native lighting/clock/visual gaps. Runtimecurrently
  stillrenders12diagnostics. No fittedrate/blend/billboard guesses. Use source
  graph via verifiedarchive and preserve names,mesh,parts,units,metadata.
- Root updated NATIVE_WORLD staleEditor/scale text and added actual lowcadence
  attack observation to VERIFICATION/NATIVE_PARITY; fixedrecipe unchanged.
- Continue to fullslice/PowerStrike/attachments/nativecomparison andGTX1060
  baseline/optimization. Nativefullmotionreference needs adequatecadence;
  actorLight/StaticMeshInstance data also remains outside currentmaterialpreview.
  No120FPSclaim (DATABASEmax75Hz),noPhase2completion,nooverallgoalcompletion.
