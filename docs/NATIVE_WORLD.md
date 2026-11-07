# Native Interlude world preview

Rendering direction, 2026-11-07: WebGPU is already required. The current native
loader still eagerly loads the selected section and clones scenery placements.
[RENDERING.md](RENDERING.md) records the next work on measured static instancing,
chunking/streaming, terrain/mesh LOD, GPU texture compression and visibility.
Supported-slice profiling can proceed alongside remaining visual/audio work;
legacy Direct3D details need reproduction only where they affect required output.

Adjacent ground update, 2026-11-06: [TerrainSector247](../artifacts/native-parity/research/terrain-extension-20261106/REPORT.md)
now fills the bounded gap beneath Actor3703's tree through source and saved/exported
routes. The current selection contains **157 placements / 62 models / 4,992 terrain
triangles**. The new 272-vertex patch preserves original heights/topology and uses
the retained native mask-coordinate qualification once. The original terrain,
735 corrected V values and diffuse UV2 are unchanged. Both desktop/mobile routes
pass WebGPU rendering and local navigation checks; the retained screenshots show
the still-unresolved sky boundary. This update is local, without deployment.

Sky/audio update, 2026-11-06: both routes now include the
[original sky room](NATIVE_SKY.md) as a frozen source preview, plus six
[original death cues](NATIVE_AUDIO.md) with gesture unlock, mute and volume in
Demo controls. The sky's hard color boundary and native animation/composition
remain unresolved. Other audio categories and native playback matching are
still incomplete. This does not claim overall 1:1 or complete the active goal.

Boundary completeness update, 2026-11-06: the five [Oren tree additions](NATIVE_MAP_OVERLAP.md) are followed by [Actor3703 and its newly supported Dion tree model](NATIVE_MAP_MODEL_APPEND.md). Current source and saved/exported routes contain **157 placements / 62 models**, plus BSP floor and sky. The 193-model/1,794-actor bounds screen is complete; only one candidate needed the additional model conversion. Terrain, corrected mask UVs, UV2 and existing authored placements remain unchanged. Surrounding terrain, full geometry/material coverage and native visibility remain incomplete; earlier 151/156-placement receipts are historical.

Editor follow-up, 2026-11-06: [actual Play is visibly recovered](../artifacts/native-parity/editor/play-viewport-20261106/REPORT.md)
after normal project-close/Dashboard/reopen, with all 2,248 asset/project files
unchanged. Final build and affected desktop/mobile checks pass. This supersedes
blank-current-viewport statements below, but not the unresolved lifecycle cause,
raw Play UV2 omission/readiness, native parity or original-audio requirements.
No code repair or terrain remigration was performed in that follow-up.

For persistent terrain/scenery editing, `pnpm assets:editor` creates the
separate local `native-world.scene`. Its saved world is available at
`/?world=interlude&authored=1`; the ordinary route below continues to consume
the staged source section. [NATIVE_EDITOR_WORLD.md](NATIVE_EDITOR_WORLD.md)
records the actual Editor save/reopen/Play proof and export adaptations.

The local `/?world=interlude` route loads the staged native map section, Human
male fighter and Greater Musveren together, with the existing controls and live
FPS. This is separate from the reused Unity-reference Talking Island at `/`.
For a fresh raw migration, run `pnpm assets:migrate --stage-runtime`, then
`pnpm dev`. The current scoped UV derivative uses the separate migration
commands in the implementation report below so it does not restage unrelated
converter changes. Keep local binaries and evidence untracked. Networking
remains outside this work.

The default migration now stages the PlayerStart10 surroundings: **61 source
models, 151 placements and 4,512 terrain triangles**. Desktop and mobile browser
checks pass with both native actors, equipment changes, death hold/revival,
movement, source texture preview and exact resource cleanup. Historical
inspection checks also covered missing-asset fallback; the staged required native
game route now rejects missing world/actor assets instead of revealing stand-ins,
as recorded in [VERIFICATION.md](VERIFICATION.md). Earlier captures are under
`artifacts/native-parity/editor/world-import/browser-final-accepted/` for the
authored route, and `editor/material-authoring-20261105/browser-final/` under
the same evidence root for the preceding ordinary route. These
also verify saved Editor equipment, clip and camera properties in the rebuilt
application. Native viewer evidence now supplies Musveren's 0.36 m collision
half-height support, replacing idle-minimum grounding that buried its corpse.
The corpse is visible again. Exact NPC 21622 supplies actor scale **1.2**.
Residual terrain intersection (**660/1,591 vertices**, up to **0.119400140 m**),
exact native collision and visual parity remain unresolved; see
[NATIVE_ACTOR_PLACEMENT.md](NATIVE_ACTOR_PLACEMENT.md). Native camera, materials
and performance acceptance also remain open.

Startup now displays four named steps with actual per-step progress and short
puns; unknown work remains indeterminate. Failed module or scene downloads
offer an actionable reload. [Private preview operation](PRIVATE_PREVIEW.md) and
[verification](VERIFICATION.md) record the loading captures and current delivery
status.

The Human male fighter now faces its tap-to-move direction. Its source +X
forward basis is aligned to the adapter's +Z heading with a -pi/2 rotation around
the complete assembly's presentation parent. Source mesh/rig/animation and
equipment assets are unchanged. Two perpendicular ground-click moves pass with
actual model-forward alignment >0.995 after correcting the test's horizontal-FOV
projection. [Source measurements](../artifacts/native-parity/research/movement-facing/forward-evidence.json)
record the basis; this does not establish native action or camera parity.

## Scoped terrain correction — 2026-11-06

The [implemented UV migration](../artifacts/native-parity/research/terrain-uv-migration-20261106/implementation/REPORT.md)
now uses `(grid + 0.5)/256 - max(grid - 240, 0)/4096` for the proved `20_20`
source/section/route. All **735 affected V fields** agree with the submitted
native-coordinate oracle. Source GLB, saved Editor geometry and public export
apply the correction once; all U values, diffuse UV2, texture/material identities
and unrelated authored data remain unchanged. Old resources and conversion
provenance are retained. This supersedes the earlier research-only checkpoint.

Source and authored browser routes pass desktop/mobile before/after readiness
checks and five behavior regressions. All 44 synthetic GPU cases pass on both
SwiftShader and GTX 1060 with the unchanged one-byte allowance. Actual Editor
save/rebuild retains the corrected data and repairs known UV2 loss; current
Editor Play remains blank and adds no visual proof.

The native draws are **offscreen submissions**. They establish indexed geometry,
submitted UVs, source-resource bindings and configured fixed-function coordinates,
not visible native pixels or screen improvement. Final composition, lighting,
CPU pruning, bUseAlpha and visible native comparison remain open. Original audio
is still required and unresolved; this graphics checkpoint did not re-audit it.
No deployment, native action, networking or performance claim accompanies it.

## Source location

The earlier TerrainSector106 inspection section was selected near PlayerStart0;
it was not the debug client's verified location. Source investigation now points
to **20_20.PlayerStart10** at native XYZ
`[10536, 95034, -3374.786376953125]`. The map's navigation chain visits it first;
the reviewed GameInfo startup gives the three enabled starts equal ratings and
retains the first. The custom player controller supplies no startup override.
This is source-backed startup selection, not observation of the current live
pawn or camera.

`recipes/native-map-debug-location.json` selects nine source terrain sectors
around Sector229, native XY `[8192, 92160]..[14336, 98176]`. The final map row is
shorter and remains unchanged. The declared rectangle contains 2,352 vertices,
4,512 visible triangles and 151 static placements using 61 mesh identities.
The source Z window `[-4000, -2500]` excludes none of those actor origins.
Selection uses actor origins; scenery extending across the region boundary,
The later [qualified BSP floor import](NATIVE_BSP_FLOOR.md) adds the final
Brush397 slab omitted by this original terrain/static-mesh job. Other BSP,
water, decorations and server collision remain outside its verified coverage.

The original terrain triangle under PlayerStart10 XY has Z
`-3455.286376953125`. The source PlayerStart's Z is retained separately, including
its 80.5-unit clearance. Native actor placement, collision and camera are not
inferred from that number. MFighter's own native class collision height is
23 units; its source mesh and native pivot remain intact.

Twelve placements use `FX_E_S.Flameset.Default_Flame01`. Its archive retains the
original mesh, 23-node native material graph, nine class definitions, 18 editable
PNGs and 16 DDS derivatives in the currently staged archive. Both world routes
now have a reversible preview of recovered billboard, texture animation, fade,
combiner and blend formulas. A separate DXT5 migration candidate also preserves
the glow DDS. [NATIVE_FLAMES.md](NATIVE_FLAMES.md) records exact resource binding,
authored-edit preservation and failure behavior. The main view labels this
**flame preview**; native lighting, clock/camera equivalence and visual acceptance
remain unverified. Archived conversion coverage is not rewritten as a visual pass.

Six of the nine selected sectors have cached Z bounds differing from the current
source height samples. The adapter requires native XY agreement, preserves all
cached bounds and discrepancies at the unchanged 0.001-unit tolerance, and
reconstructs the original samples. It does not fit geometry to stale cached
bounds or claim a visual pass. The older one-sector recipe retains its original
stricter bounds policy.

Location and class evidence are in
`artifacts/native-parity/research/native-location/`. The focused next investigation
is documented in `artifacts/native-parity/research/REVERSE_ENGINEERING_HANDOFF.md`.

## Browser ownership and presentation

The wide-camera check found an Editor 5.5.3 export defect: the saved native scene
then had `fogEnabled: false`, but the packer wrote fog mode 3 without that switch.
Babylon 9.27.1 consequently enabled linear fog at 32–85 m, hiding the distant
buildings while the candidate terrain shader stayed unfogged. The narrow
`scripts/preserve-native-editor-fog.mjs` adapter runs after the official pack in
`pnpm generate`. It writes mode 0 to the generated native scene when saved fog
is disabled, and retains the saved mode when enabled. It leaves other fields,
source assets and authored settings unchanged; live unsaved Editor settings
are not overridden by a runtime script. This fixes presentation, not native
lighting parity. Before/diagnostic captures are retained with the current views.
The later actual Editor round trip saved fog mode **None** because in-process
Play bypasses that CLI adapter. Both export paths now retain the intended
fog-free rendering; see [EDITOR_ROUNDTRIP.md](EDITOR_ROUNDTRIP.md).

`loadNativeSection.ts` validates the catalog, content hashes, byte lengths,
native identities and placement matrices before exposing a section. glTF mesh
extras are associated using exact loader primitive pointers and merged with
existing metadata. Materials and geometry keep their original relationships.
One catalog snapshot supplies both section and texture references.

The Editor's pinned packer serializes a left-handed scene by default. The native
scene script establishes right-handed coordinates after parsing and before any
native GLB load. This fixes an observed world-load rejection; no model is mirrored
to compensate. Coordinates are meters using the documented source mapping
`glTF XYZ = .01 * native XZY`.

The local navigation policy supplies terrain support and rejects unsupported
edges/holes. The [qualified BSP branch](NATIVE_BSP_FLOOR.md) additionally uses
the Brush397 slab and Actor940's source collision-enabled building sections;
other scenery and native collision/geodata remain unverified. Adapter positions
remain support points. Presentation uses the explicit Musveren reference's
0.36 m collision half-height; profiles without verified native support retain
a clearance measured once in idle. Original meshes, origins, rigs and animation
keys are unchanged; animated vertical motion is not cancelled every frame.
With no ground hook, no placement clearance is applied. This remains a local
preview policy, not a reproduction of the native collision sweep.

The camera preserves authored orbit angles when moving its target into native
world coordinates. **Frame world** shows the section; **Follow fighter** restores
tracking. Equipment changes, one-shot death/revival, targeting and lifecycle
continue through `GameWorldAdapter`. A failed section retains the authored
inspection area and a persistent `worldFailure` diagnostic. Disposal releases
the section and restores authored mesh visibility.

## Source texture preview

`nativeTerrainPreview.ts` supplies a clearly identified candidate material.
It loads the nine original diffuse PNGs and nine masks from the hash-checked
local catalog. Native diffuse UV matrices retain their source-world phase.
Direct PNG decoding preserves RGB under alpha zero and does not apply canvas
premultiplication or color conversion. All 18 decoded images were checked
against the independent PNG audit.

The seven 1024-square masks are packed byte-for-byte into two GPU RGBA textures;
the 512-square mask remains separate and the constant-white base mask is checked.
No mask is resized. Nine diffuse samplers plus three mask samplers fit a
16-sampler WebGL implementation. Original archives, PNGs and native mips remain
unchanged. **Neutral terrain** and **Source textures** switch the material without
reloading the world.

Ordered composition, unlit encoded-color output and bilinear mip-0 filtering
remain **preview candidates**. The selected geometry mask UVs now match the
qualified submitted-coordinate route above, but this does not establish native
`bUseAlpha`, full sampling/mip behavior, lighting, gamma or framebuffer output.
A missing texture or failed shader retains neutral terrain and a
`materialFailure` diagnostic; it cannot become a silent material pass.

The exact-client [terrain mask research](../artifacts/native-parity/research/terrain-mask-native-rea/REPORT.md)
narrows those gaps. Engine's CPU `GetLayerAlpha` uses packed-word DXT1
interpolation and a channel mean, P8 palette byte +2, or RGBA8 alpha. Its mixed
region value 100 is a classification sentinel, not a demonstrated GPU weight.
Ordinary BC1 texture decoding and this terrain CPU classifier are different
operations; the PNG/DDS products must not be rewritten to conflate them.

A conditional D3D method-2 path selects sampled mask alpha and uses ONE/ZERO
for the first pass, then SRCALPHA/INVSRCALPHA for later passes. The later retained
capture establishes a configured fixed-function route for the scoped offscreen
draws: supplied TEXCOORD0, disabled mask transforms and source-bound masks.
This is not a universal shader/material rule. The `TerrainMaterial.hlsl` program,
native `bUseAlpha` consumer, CPU pruning and final visible output remain unresolved.
The current ordered preview still does not establish complete composition or
lighting parity; no texture repair follows from the UV correction.

## Evidence and remaining work

Earlier adjacent-sector source work (2026-11-06) identified TerrainSector247 beneath
the appended Actor3703 tree: 272 vertices / 480 visible triangles, independently
derived from TerrainInfo0 and original G16 samples. All 16 shared-edge positions,
normals and diffuse UV2 match the current section exactly. Ordinary new mask UVs
would disagree at 15 shared-edge vertices. Two **offline comparison** GLBs retain
the same geometry/topology/UV2 and differ only in 255 primary V fields (374 BIN
bytes). Ten focused tests and both GLB validators passed; clean/repeated extraction
outputs were byte-identical. Those offline candidates were not staged at that
checkpoint. The later integrated derivative is recorded at the top of this page.

The [source-height handoff](../artifacts/native-parity/research/terrain-extension-20261106/source-audit/SOURCE_JOIN_HANDOFF.md)
supplies all 272 native XYZ records and source-property/package identities to the
existing research owner. Parent checks verify every row and 23 input pins; the
full retained draw/mask qualification remains with that owner. Keep diffuse
stage0 CAMERASPACEPOSITION/COUNT2 distinct from mask stage1 TC0/DISABLE. No
production UV rule is widened from this source-only receipt. The completed
735-value correction and authored geometry remain unchanged. The earlier wait
for WebGPU migration readiness is superseded: both routes now pass the affected
hardware WebGPU checks in [VERIFICATION.md](VERIFICATION.md). Prior WebGL captures
remain historical evidence; these later checks do not certify native pixel parity.

The first integrated textured capture is
`artifacts/native-parity/browser/world-first-textured.png`. It shows the earlier
Sector106 section while the startup-area export is developed. Its approximately
5 FPS is from ANGLE SwiftShader software rendering, not GTX 1060 hardware.
Updated run counts and final captures belong in [VERIFICATION.md](VERIFICATION.md).

Native shader/particle execution, live camera/location alignment, full attack and
Power Strike parity, sword attachment, effect-timing authoring and hardware
performance acceptance remain open. Earlier actual Editor save/reopen/rebuild
checks verified equipment, clips, camera, actor-material overrides and world
placement. Source conversion coverage,
functional browser tests and native visual acceptance remain separate results.
