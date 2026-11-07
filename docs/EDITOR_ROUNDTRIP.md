# Actual Editor authoring verification

## Editor Play session recovery — 2026-11-06

The [bounded follow-up](../artifacts/native-parity/editor/play-viewport-20261106/REPORT.md) recovered actual visible Editor 5.5.3 Play by
normal project-close → Dashboard → reopen, without changing code or authored
assets. Terrain, fighter and Musveren render; another Play/Stop cycle and one
same-window project reload also succeeded. All 2,248 current asset/project files
remain byte-identical. Final build and the two authored desktop/mobile browser
regressions pass; saved/public/dist retain corrected 549a… geometry and exact UV2.

This supersedes earlier statements that the current Play viewport is blank,
but does not establish a permanent lifecycle repair: the original cause remains
unknown. Raw Editor Play still omits UV2 and reports scene.isReady() false in
retained diagnostics despite visible output. Authoring and final project-built
exports preserve UV2. No readiness tolerance, asset, runtime or installed Editor
code was changed. Visible native parity, original audio and performance remain
outside this recovery claim. Historical failure evidence is retained.

The desktop Editor's generated script entry includes optional plugin imports
that CLI packing omits. A reproduced Vite failure after regeneration is fixed
by pinning the installed Editor's Babylon Addons 9.27.1 and Recast 0.43.0
dependencies in the client. A browser compiler regression checks that generated
plugin set. [The dependency evidence](../artifacts/native-parity/research/editor-plugin-dependencies/README.md)
records the differing generators and unchanged-entry before/after optimization.
This does not resolve the separate cold-load delay documented below.

## Native flame timing authoring — 2026-11-05

The actual Editor 5.5.3 UI now verifies the bounded **Flame replay** controls on
`native-world.scene`: **Scene → Inspector → Scripts → scripts/nativeParity.ts**.
Preview was saved enabled, with texture/fade starts **0.25 / 0.75 seconds** and
rates **0.5 / 1.5**. Typed and reopened UI readbacks match exactly. These values
remain as a labeled authored demonstration; the ordinary source route retains
its normal starts and rates.

The save retained all 151 source-placement records, the existing tree offset,
414 materials, 193 PNGs and all geometry channels except the known terrain UV2
loss. It also removed the thumbnail and serialized empty/null config defaults.
The normal project build recovered the exact UV2 channel and binary. After a
normal project-close/Dashboard-reopen, the world viewport recovered from its
blank state and actual Play showed the native actors, textured world and a
visible animated flame/glow. Play is stopped. No further save occurred during
reopening or Play; all **2,244 files / 53,057,535 bytes** in the recovered baseline
remained identical. The earlier 2,245-file backup retains the removed thumbnail.

Evidence is under `artifacts/native-parity/editor/flame-authoring/`:
[save audit](../artifacts/native-parity/editor/flame-authoring/SAVE_PROOF.md),
[reopened values and Play proof](../artifacts/native-parity/editor/flame-authoring/REOPEN_PLAY_PROOF.md),
and `reopen-play-preservation.json`. Final validation passes **435 unit tests /
39 files**, generation/typecheck/build, and **6/6 rebuilt browser cases** in
5.3 minutes. Final browser and repeat-import audits preserve the same 2,244-file
recovered baseline exactly. [VERIFICATION.md](VERIFICATION.md) records the exact run scope.
Flame timing authoring is proven; full skill effects, Power Strike sequencing,
native shader/lighting fidelity and matched visual acceptance remain open.

## Native world authoring — 2026-11-05

The newer `native-world.scene` stores the imported terrain/scenery as editable
resources. The actual Editor saved and reopened a **+0.75 m X** tree edit.
The save audit discovered terrain UV2 loss in Editor 5.5.3; a source-checked
project prepack step restores only that missing channel. A second real save
and build verified repeatable recovery and the external record's survival.
See [NATIVE_EDITOR_WORLD.md](NATIVE_EDITOR_WORLD.md) for commands, captures,
channel hashes and limitations. The runtime-only world discussion below
describes the earlier `native-parity.scene` checkpoint, not the new scene.
The authored route's rebuilt desktop/mobile checks now pass **2/2**; repeat
import and both browser cases preserve **2,245 authored files**. Final receipts
and captures are under `editor/world-import/` in the native-parity evidence root.

## Native actor material authoring — 2026-11-05

The actual Editor 5.5.3 scene inspector now exposes an optional material override
by exact entity ID and retained qualified source material name. The demonstrated
target is `local-player` / `MFighter.UpBody.MFighter_m001_t04_u`. Typed linear RGB
multipliers `[0.45, 1, 0.6]` and roughness `0.45` were saved through the UI,
reopened, and rendered as a green leather shirt in Editor Play. This is an
intentional authoring demonstration, not a native-material parity correction.

`nativeMaterialOverrides.ts` clones the selected actor's existing PBR material.
Textures, alpha mode, UV transforms and other material settings survive; original
materials and converted payloads remain unchanged. Equipment replacement is
resolved by identity after asynchronous loads. Removing the part releases its
override; stopping restores source materials before the model owner disposes.
Runtime diagnostics expose matching counts and actual applied color/roughness.
Eight focused tests cover isolation, source preservation, ownership and rollback.

The first actual save exposed an Editor defect: its script Color3 numeric fields
showed the new values while serializing `[1,1,1]`. Read-only installed-source
inspection and callback reproduction identify the missing finish callback.
The client uses the supported Vector3 text fields for this RGB tuple; type the
values and finish by clicking another field or pressing Enter. Vector dragging
and inspector range enforcement are not established in this Editor version;
the runtime validates the finite `[0,1]` values. No installed Editor code changed.
See [the source investigation](../artifacts/native-parity/research/editor-color-authoring/README.md).

The first save also replaced the inspection environment's 18 Tree bark material
records with `ProxyMaterial`. The failed save is retained. Those unrelated mesh
files were restored from the immediately preceding backup and the scene reopened.
The subsequent accepted material save changes only `config.json` and the preview
thumbnail; all other authored file hashes match. This repeats the earlier
in-memory proxy-material risk and is not counted as a successful preservation
result for that first save. Installed-source reproduction establishes an ID
collision: internal clustered-light `ProxyMaterial` and imported Tree bark both
have unique ID 8; Editor deduplicates solely on that number, disposes Tree bark,
and later serializes the proxy. Play timing alone does not establish causation.
[The collision evidence and smallest upstream repair](../artifacts/native-parity/research/editor-proxy-material/README.md)
retain the actual loader/serializer/CLI reproduction. Source records were
restored; the installed Editor is not patched.

`pnpm generate` now runs `scripts/validate-editor-materials.mjs` before the
official packer. The read-only guard rejects the exact referenced internal
ShaderMaterial/lightProxy signature and names the affected file and mesh.
It follows cross-record, numeric-only and MultiMaterial references, including
LODs; names such as `ProxyMaterial` alone are accepted. Six tests cover rejection,
accepted authored materials and unchanged file bytes. A failed check requires
restoring the affected records from a verified copy and reopening the scene;
the guard cannot reconstruct the lost material. This material-only checkpoint
passed two scenes / 238 mesh files. The later world import passes three scenes
/ 1,226 mesh files.

After the enabled-override browser proof passed (three cases), the override was
disabled in the actual UI and saved. Its authored RGB and roughness remain.
The rebuilt normal preview passed the same three cases, with zero active material
copies and empty browser error lists. Normal source colors are restored.

Evidence: `artifacts/native-parity/editor/material-authoring-20261105/` contains
the before/failed-save snapshots, typed controls, saved and reopened settings,
actual Play PNG, logs and preservation receipts. Rebuilt browser results are
recorded separately in [VERIFICATION.md](VERIFICATION.md). Full native shader
authoring and skill-effect timing remain unfinished; the later flame timing
proof is above. Persistent world-object editing
is now verified for the separate `native-world.scene` described above.

## Scope — 2026-11-05

Babylon Editor **5.5.3** on DATABASE-PC opened the existing project and its
`assets/native-parity.scene`. Equipment, animation selection, camera and fog
settings were edited through the actual UI, saved, and reopened. The native
world, fighter and Greater Musveren subsequently rendered in Editor Play.
This earlier checkpoint is a partial authoring result. The later actor-material
override proof is above; full skill-effect timing and combat/native visual parity
remain incomplete.

The rebuilt application subsequently passed **12/12 browser cases** in 4.4
minutes, including desktop/mobile checks of those saved properties. The prior
development-server run passed 17/18; its initial courtyard navigation exceeded
the unchanged 45-second limit, also on rerun. The same production case passed
in 5.4 seconds. The dev startup failure remains open. Production captures and a
fresh 243/243 native, 123/123 example-file preservation audit are retained in
`browser/editor-roundtrip-production-20261105/` under the evidence root.

The native world is loaded at runtime. The 119 meshes stored in the editable
scene are the inspection environment, separate from the 61 source models and
151 placements loaded from the staged map section. Editing runtime objects in
Editor Play does not persist them; the Editor explicitly labels those changes
temporary. No claim of a fully editable imported world or effect library is made.

## Saved changes and preservation

| Authored setting | Before | Saved value |
| --- | --- | --- |
| Start with Leather Shirt, item 22 | false | true |
| Fighter idle clip | `Wait_Hand_MFighter` | `Wait_1HS_MFighter` |
| World camera radius | 2.6 | 4.25 |
| Fog | disabled, Linear mode 3 | None, mode 0 |

These are presentation edits, not inferred native combat rules. The chosen
one-handed idle clip does not establish sword attachment or full attack motion.
The native rig, source weights, clips and converted asset bytes were unchanged.

Editor saving renamed resources and moved inline geometry into
`.babylonbinarymeshdata` files. Audits match intrinsic identities and decode
the declared binary layout instead of assuming filenames or inline arrays.
The native scene retains all 119 meshes, seven materials and two lights;
geometry matches the earlier arrays exactly at float32 precision, with exact
indices and submesh assignments. The second save retains all 119 geometry
binary hashes; recomputed bounds reflect the loaded float32 values.

An initial save of the example scene persisted missing Meadow/Sunlight and a
pine-material replacement from its in-memory state. The cause was not proven.
That save was retained as evidence; the original example scene was restored
and verified **123/123 files identical**. Those changes were not accepted.
Later native saves did not reproduce that loss. Native scene binary geometry
and thumbnails remain local and ignored, along with converted assets/captures.
Keep the local authored geometry when moving this working project.

Evidence under `artifacts/native-parity/editor/`:

- `save-audit-20261105-142811/` and `save-audit-20261105-144515/`: field,
  identity, geometry, material and hash comparisons.
- `20261105-example-restoration.json`: original example restoration receipt.
- `20261105-native-reopen-done.png` and `20261105-reopened-camera.png`:
  actual reopened equipment/clip and camera controls.
- `20261105-post-generate-preservation.json`: 243/243 native files and
  123/123 example files unchanged after generation; project file unchanged.
  The receipt distinguishes CLI output from a subsequent Editor Play export.

## Client adaptations demonstrated by actual Play

1. **Loader registration.** Editor rewrites Babylon loader imports to its UMD
   root. `registerGLTFExtension` is under `GLTF2` there. Using that namespace
   supports the pinned browser ESM and Editor UMD while retaining exact native
   weight restoration. The actual installed module probe and original failure
   are retained under `research/weapon-attachment/editor-loader-registration/`.
2. **Resource paths.** Editor's documented-by-source Play override resolves
   relative fetches under the open project's `public` directory. `/l2/...`
   mistakenly addresses the filesystem root on its file page. The client
   adapts validated paths at the fetch boundary; HTTP browser URLs, catalog
   identities, hashes and dependency validation remain unchanged.
3. **Displayed canvas.** Editor renders through a detached working canvas and
   registers a separate visible canvas. Input, HUD bounds and label projection
   now use Babylon's public input element when it is a canvas. The HUD reserves
   the measured overlaid toolbar strip without moving the label projection
   origin. Browser layout remains derived from its own canvas.
4. **Fog.** Editor's in-process Play export bypasses the CLI post-pack fog fix
   and drops the disabled switch. The actual wide view reproduced missing
   distant buildings. Selecting **None** in the authoring UI preserves the
   intended fog-free view through both exports. Enabled fog remains an authored
   choice; the runtime does not override it.

Read-only installed-source extracts/hashes are under
`artifacts/native-parity/research/editor-viewport/`. No installed Editor code,
native client files, source conversion workspace or protected INI was changed.
No official Babylon MCP invocation is claimed; input used ordinary UI
Automation/guarded Win32 interaction in the foreground Editor window.

## Playback evidence and limitation

`20261105-editor-recovered-play.png` shows the real native actors, terrain and
buildings. `20261105-controls-now.png` shows the wide section with scenery after
loading. The native run control visibly changed the fighter pose. The death
command was invoked, but the resulting monster was no longer visible above
terrain; that capture does not establish native death visual parity.

The exact runtime CPU-skinning probe confirmed the original burial: at the final death
key (3.033333 seconds), all 1,591 vertices lie below the fixed idle support plane,
from -0.281986 to -0.063171 metres. Both primitives remain enabled; the actor
does not despawn. `deathwait` reaches the same buried pose. Native reference
footage shows a hovering idle pose and a visible corpse. Native viewer code
subsequently confirmed collision-height support independent of visual scale.
The initial support-only repair used its 0.36 m native height; at unit actor
scale, 76 vertices still intersected terrain by up to 0.039502 m. The later exact
NPC 21622 profile establishes scale 1.2 and retains the independent 0.36 m
height. Its current browser pose intersects 660 vertices by up to 0.119400 m.
These later profile checks were performed in the browser, separately from the
earlier actual Editor session; no new Editor playback parity is claimed.
[NATIVE_ACTOR_PLACEMENT.md](NATIVE_ACTOR_PLACEMENT.md) records its scope.
No animation keys, GLB bytes or per-frame grounding were changed. See
`research/musveren-death/probe.{mjs,json}` under the evidence root.

Repeated Play/Stop and source changes during the session eventually produced a
blank viewport, including in authoring mode. Reopening the scene did not fix it.
Closing the project window normally, returning to Dashboard and reopening the
project restored rendering with the same saved data and code. The cause remains
unproven. Blank captures are retained; do not count them as passing evidence.
Stop Play before source edits, CLI generation and browser checks. If it recurs,
retain console/capture evidence and reopen the project window. No forced
process termination or native/service restart was used.

Visible Editor FPS is a diagnostic reading only. These captures do not provide
the controlled GTX 1060 baseline, measured optimization gains or a 120 FPS pass.

## Reproduction

Open `project.bjseditor` in Editor 5.5.3, open `native-parity.scene`, select Scene,
and inspect `scripts/nativeParity.ts` for equipment and exact clip settings.
Select World camera for camera changes. Save and reopen before Play; retain
fog mode None for the current inspection scene. Use the runtime controls to
inspect equipment, clips and the world. Stop Play before rebuilding:

```powershell
pnpm build
pnpm test:unit
pnpm exec playwright test tests/browser/nativeSlice.spec.ts tests/browser/nativeSection.spec.ts tests/browser/nativeTexture.spec.ts tests/browser/demo.spec.ts tests/browser/world.spec.ts
```

`nativeSlice.spec.ts` reads the saved scene properties by identity and compares
them to actual runtime equipment, clip and camera state. It waits for the
asynchronous armor replacement, retains exact rig/skin assertions, and records
authored file hashes beside browser evidence. Browser results and the final
saved-value verification are recorded separately in [VERIFICATION.md](VERIFICATION.md).

The tracked asset goal remains active. Native shader/world-material and full skill-effect timing authoring,
Power Strike sequencing and full attack reference, attachment fidelity, matched
videos/diffs, hardware baseline and optimization remain open. Phase 2 networking
remains planned at the unchanged `GameWorldAdapter` boundary.
