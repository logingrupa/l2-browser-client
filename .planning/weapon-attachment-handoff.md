# Child continuation: /root/weapon_attachment

**Latest root checkpoint: [editor-roundtrip-continuation.md](editor-roundtrip-continuation.md).**
This child also finished read-only Musveren key/placement research; evidence is
`artifacts/native-parity/research/musveren-death/README.md`. Root implemented and
verified the narrow support repair. Older ownership/process statements below
are historical; coordinate with root before editing.

Report to `/root`. Do not manage goal, use native/Editor input, or spawn agents.
Root currently owns browser integration; world_conversion_audit owns runtime.

## Latest checkpoint — child complete, all code frozen

The in-progress instructions below are historical. The raw material adapter,
exact model policy routing and runtime gap coverage are now IMPLEMENTED.
Final isolated PlayerStart10 manifest:
`artifacts/native-parity/research/world-debug-location/map-section-runtime/manifest.json`
SHA25667a9ba819cf63a87801b7600ed4edb0392e5382061073f35da665c2cbb73d22d.
61models/151placements/errors[];62GLBs zeroerrors/warnings; geometrycachetrue,
61modelcachehits;13legacy single-sector products byte-identical.91targetedtests
pass(24geometry/21material/6graph/10rawmap/16asset/14migration). No owned processes.

New helper `scripts/native_assets_lib/material_graph.py`, explicit converter
`materialPolicy=preserve-native-graph` on exact StaticMesh requests and map recipe
`staticModelPolicies` map. Unknown/malformed still fail. Converter fingerprint
includes native_effect_bundle.py, which supplies existing DefaultReader and
object_values. ModelPart accepts optional extra_files/extra_mime to add sidecars.
1flame model/12placements remain explicitly unsupported-runtime diagnostic.
240-file archive preservesoriginal2sections/all exporterbufferhashes,23rawnodes
(21authored+Engine.DefaultTexture/Palette135),9classdefs,18PNGs,16exactDDS.
Texture format8/glow native-mip+P8 defaultDDS gaps explicit; originalraw retained.
Section unsupportedRuntimeMaterials+coverage+gaps expose IDs and five pending
features. No native shader flattening, source writes or sourceimage synthesis.

See research/world-debug-location/README.md for currentcommands/evidence and
testlog names. Root may now integrate `recipes/native-map-debug-location.json`
in main map-20-20-section and stage. Child did NOT edit mainmigration/default
recipe, publicruntime, browsercode or user desktops. Root owns remaining docs
and source-coordinate/native visual verification. No fullclean61model rebuild
was independently run here; root's next main migration proof supplies that.

## Current task (2026-11-05 continuation)

Root authorized extending the raw migration pipeline so native PlayerStart10
world section can load. Latest authorization: implement explicit opt-in raw
material-graph preservation for one unsupported flame model, retaining original
geometry and graph instead of flattening/baking it. Own needed native_assets.py
integration/tests now. No main migration/default/staging edits; root owns them.

Proposed API sent to root (not yet implemented): exact qualified StaticMesh
request `materialPolicy="preserve-native-graph"`; reject overrides/assemblies.
Map recipe `staticModelPolicies` maps exact selected source object to policy,
reject unused entries. New native_assets_lib helper captures exact raw graph,
verified class defaults/inheritance, texture native source/PNG/DDS where existing
reader supports it; diagnostic material slots have explicit pending-runtime
status and graph reference. Unknown classes/malformed graphs still fail.
Reuse native_effect_bundle.object_values and DefaultReader lazily to avoid
circular imports; add native_effect_bundle.py to converter implementation hash.
Need integrate helper-generated archive files through model_part (optional
extra_files/extra_mime) without changing its six-result contract. Archive has
256-entry hard limit: avoid duplicate raw Texture export files by referencing
native/texture-export.bin when native mip sidecars exist. Flame is small enough.

## Completed source/geometry work

- `scripts/native_map_geometry.py`: explicit rectangular contiguous sector-origin
  selection via terrainSectorRectangle {minOffset,maxOffset}; legacy terrainSector
  stays strict and original products byte-identical. Rectangles can explicitly
  request cachedSectorBoundsPolicy=require-xy-preserve-z-discrepancies; unchanged
  source points, tolerance0.001 and all cached discrepancies retained.
- selectedRegion + selectedSectors in multi geometry manifest; runtime contract
  unchanged. Native last row15quads stays15. No seam padding/resampling/fitting.
- maxStaticModels declaration default16, bound1..1024; exact unique request set.
- sourceSpawnReferenceActor:true samples exact referenceXY on original native
  diagonal and retains authored XYZ/height offset; native/collision false.
- `recipes/native-map-section-3x3-candidate.json`: around106,61.44m square,
  XY18432,75776..24576,81920,oldZ[-3350,-2400],24actors/12models,958origins excluded.
  Initial isolated export research/world-expanded passed13GLBs zeroerrors/warnings,
  second12/12modelcache hits;13old single-sector products byte-identical. Receipts
  now stale after subsequent code changes; no need treat that as corruption.
- `recipes/native-map-debug-location.json`: around PlayerStart10 Sector229,
  min[64,208],max[96,240],XY8192,92160..14336,98176;61.44x60.16m;
  Z[-4000,-2500] includes151actors/61models,zeroexcluded.2352vertices/4512triangles,
  6/9cachedZ mismatches retained. Exact referenceXY10536,95034,source terrainZ
  -3455.286376953125; authoredPlayerStartZ-3374.786376953125,offset80.5uu.
- Root/nativeagent confirmed source startupchain: NavigationPointList starts10,
  enabled/singleplayer defaults true, equal ratings1000 retain first. Live pawn
  and dynamic camera still not observed. Native MFighter collisionHeight23uu;
  root handles local idle-foot display clearance separately, preserving rig.
-24mapgeometrytests pass (geometry-tests.log under research/world-debug-location),
  14native_migrationtests passed previously under research/world-expanded.

## Static material reader expansion

- `scripts/native_assets_lib/static_materials.py` now admits exact UE123 licensee
  16/19/20/22/23/25/28/30/31 only. No layout change: inspected tagged material
  structs independently before enabling5new versions.
-20objects across8packages/280slots verified original Material compact indices,
  source ordering, complete slotbytes/hashes/terminators, no source mutation.
  Pinned UEViewer FStaticMeshMaterial source hashes verified.21tests pass.
- New tracked fixture tests/pipeline/fixtures/static-material-versions.json;
  tests/pipeline/test_static_materials.py tests all20real local objects and unknown
  version rejection. Independent vectors research/world-debug-location/
  {review-static-materials.py,static-material-layout-review.json,
   static-layout-source-provenance.json,static-material-tests.log}.
- Initial debug-location export failed20models. After exact-version support,
  **60/61models succeed; one flame model remains unsupported**,12placements.
  Latest log export-reviewed-versions.log; full manifest retains151placements
  and explicit error. CLI returned1 correctly. No missing model filtered.
- `validate-debug-location.py --allow-partial` validated current60modelGLBs plus
  terrain and13legacyproducts (see verification-partial.json/log). Do not claim
  all61converted or final runtime complete. Default command requires no errors.

## Exact flame graph, already inspected

Source model `FX_E_S.Flameset.Default_Flame01` has2native slots and
`bUseBillBoard=true` in mesh property tags. Current failure:
No diffuse material adapter for Combiner: FX_E_T.Flameset.de_fire_glow_s.

Evidence research/world-debug-location/flame-material/graph.json,21complete raw
exports, class-defaults/{Engine.Combiner,Engine.FadeColor,Engine.Shader} scripts/
defaults; reproduce inspect-flame-material.py. Do not use generic tagged_values
alone on textures (fixed-array index0 omission); existing object_values handles
that while preserving original tags. No production adapter implemented yet.

- Slot0 Shader Default_Flame_Final: Diffuse de_fire_0000,
  OutputBlending5=OB_Brighten,TwoSidedtrue. AnimNext chain0000..0015 (16textures),
  firstMinFrameRate25/Max30,last no authoredNext. Do not invent loop dispatch.
- Slot1 Shader de_fire_glow_shader: OutputBlending3=OB_Translucent→Combiner
  de_fire_glow_s: CombineOperation2=CO_Multiply,Material1 de_fire_glow texture,
  Material2 FadeColor0,Modulate2Xtrue.
- FadeColor0: rawBGRA151b3100→2e437c00,FadePeriod0.4000000059604645,
  FadePhase1,ColorFadeType1=FC_Sinusoidal,explicitFallbackMaterial glowtexture.
- FX_E_T.utx is UE123/licensee28,Ver121,sourceSHA
  cbc082f0f042dbd57f7bd3e1410e6afa05e6b08ef40b9891efbf70e69a2db78c.
  Flame framesFormat3DXT1; glowFormat8(currentnative mip adapter unsupported).
  Preserve original glow raw export plus PNG; report DDS/native-mip gap.
- Native blending/time/gamma/billboard semantics remain unsupported. Root requests
  raw graph + originalmesh + explicit diagnostic materials, no genericdiffuse.

## Earlier completed weapon/localization work

`native_catalog/skeletal.py` attachments repair and6tests frozen. Native glove
e_Hand socket is preserved, purpose unverified; never apply guessed swordoffset.
`native_animation_families.py` +14tests frozen;380MFighterrows,62directbasegetters,
243mapped/137unverified,326name refs allresolve114clips(193exact/133case-only).
Proper111footer decoding now requires[0,8,71,CRC32(header+encryptedtext),0].
True193494byteplaintextSHAa2e5f8e2121d0c32c7e540d04fdac17c725da8c4aac36facccec24586d71b0b9,
byte-identical updatedcodec; oldbad193514derivative retained separately.
All evidence research/weapon-attachment/README.md; root integrated pipeline.

No running child command sessions at this checkpoint. No browsers/native input.
No binaries published or source workspaces modified. Preserve dirty shared tree.
