# Editable native world

## Save/Play UV2 writer and WebGPU texture fix — 2026-11-07

The [new checkpoint](../artifacts/native-parity/editor/uv2-export-20261107/REPORT.md)
repairs the Editor 5.5.3 `uv2s` / Babylon 9.27.1 `uvs2` writer mismatch through
the version/hash-guarded project plugin. Actual installed Save and raw Play in
an isolated copy preserve every channel of both terrain meshes, including UV2;
normal build preserves them too. All 2,311 protected original files remain exact.
Historical missing-UV2 reports below describe earlier sessions.

Live authored-material recovery also uses the proven absolute authoring texture
root on WebGPU. Editor's relative path rewriting and WebGL-only texture hook
caused checkerboard terrain; final observations have zero texture failures.
Nineteen writer, 32 existing compatibility/recovery and 20 material checks pass,
as do typecheck/build and the retained source/authored browser checks. Fresh
Editor Play is ready on hardware WebGPU with valid textures and no GPU errors,
but the final screenshot timed out and foreground access was declined. Earlier
dark captures remain failures. Final visible Play acceptance and the broader
lifecycle issue remain open; this is not full Editor/native parity.

## Actual sky material save/rebuild — 2026-11-06

The [sky checkpoint](../artifacts/native-parity/editor/sky-save-20261106/REPORT.md)
verifies actual Editor 5.5.3 cloud opacity 1 → 0.5 → 1, save/reopen, unchanged
repeat staging and rebuilt source/authored desktop/mobile routes. Actual draw
uniforms followed the authored edit; the source route stayed at 1. The final
50,700-pixel mobile cloud region exactly matches its baseline. Actual Play
visibly renders terrain, actors and sky. The native yellow/blue boundary remains
unresolved; this is an authoring checkpoint, not native visual parity.

All 974 geometry-bearing mesh payloads and authored transforms/assignments remain
intact; saved/public/dist terrain retains corrected primary UVs and UV2. Editor
reset 20 inactive overlay settings and removed unused original geometry paths;
the report records exact guarded preservation from the fresh task baseline.
Normal sky defaults, geometry aliases and sRGB/alphaMode serialization remain.
Raw Play UV2/readiness and transient blank-viewport lifecycle limits still apply;
the normal Dashboard reopen recovered the viewport again. No installed Editor
or production material patch was inferred from these observations.

Boundary update, 2026-11-06: after the five [existing-model overlap placements](NATIVE_MAP_OVERLAP.md), the [new-model appender](NATIVE_MAP_MODEL_APPEND.md) adds Actor3703 with original source normals, three materials/textures and exact source placement. The saved/exported world now has **157 placements / 62 models**. It preserves existing authored geometry/materials/transforms and updates only the world manifest and matching config/channel-sidecar identities. Both repeat operations make zero changes. This addition has saved/export/browser proof, not a new interactive Editor save claim; normal reopen refreshes an already-open scene. Earlier proof counts and import hashes remain historical. Do not restore old snapshots or reimport over this scene.


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

The native map section now has a separate local authoring scene,
`assets/native-world.scene`, created by `pnpm assets:editor`. Open that scene
in Babylon Editor **5.5.3**. The imported terrain and scenery are saved scene
objects; actors and their existing equipment/animation controls remain runtime
objects. The original `native-parity.scene` inspection scene remains available.

For a first import after staging the raw migration, the sequence is:

```powershell
pnpm assets:migrate --stage-runtime
pnpm assets:editor
pnpm build
pnpm serve --port 5173
```

The authored browser route is `http://127.0.0.1:5173/?world=interlude&authored=1`.
The ordinary `/?world=interlude` route continues to load the staged source
section. Both retain `GameWorldAdapter`; neither implements networking.

## Corrected UV save/rebuild checkpoint — 2026-11-06

The [scoped migration report](../artifacts/native-parity/research/terrain-uv-migration-20261106/implementation/REPORT.md)
records the saved geometry/reference/channel-proof migration for the retained
`20_20` section. Exactly **735 primary V fields / 1,078 geometry bytes** changed.
The corrected saved and public binary is `549a7fef…`, with primary UV hash
`d549356f…`; diffuse UV2 and every other geometry channel are preserved.
Only the saved mesh reference and matching primary-UV proof changed among the
1,684 baseline authored files. Original `bc541…` and historical `native-10fc…`
bytes remain retained, with save intermediates recorded separately.

Actual Editor **5.5.3 Ctrl+S** retained corrected primary UVs and repeated its
known UV2 omission. `pnpm generate` recovered UV2 from the updated proof and
exported the expected corrected geometry. The successful build alone was not
used as proof: channel hashes, saved/public references and non-UV bytes were
checked explicitly. Current Editor Play is blank; this checkpoint proves
save/rebuild preservation, not a successful current Editor viewport or Play.

The additional Play attempt also emitted raw public/built scene data without
UV2, bypassing the project's prepack recovery. A final `pnpm generate` and
`pnpm build` restored the expected geometry; both desktop/mobile authored-route
regressions passed again. After direct Editor Play, regenerate through the
project workflow and verify the generated references before treating public or
built output as final. The saved authored geometry remained correct throughout.
Earlier successful Play observations below remain historical.

The rebuilt source and authored browser routes pass desktop/mobile checks and
five behavior regressions. Native comparison remains limited to offscreen
submitted coordinates, not visible native pixels or full parity. Original audio
remains required and unresolved and was not re-audited here. No native action,
deployment, networking or performance test was performed.

For an existing authored scene, use the report's explicit migration commands;
do not rerun `pnpm assets:editor` to replace changed geometry. Keep original
import provenance and resources. The source runtime derivative preserves old
model archives instead of reconverting them with unrelated pending changes.

## Import and ownership

The import uses the pinned production loader, Babylon 9.27.1, Editor 5.5.3's
hash-checked binary geometry writer and PNGJS 7.0.0. It retains native source
identities and matrices, creates deterministic Editor identities, and exports
276 transform nodes, 988 mesh records, 414 distinct geometry buffers and 193
editable PNG resources for the 61-model / 151-placement section. PNG pixels
and reused source PNG bytes are checked during export. Local binaries and the
imported scene remain ignored and unpublished.

The dedicated scene root reflects Z for Editor's left-handed viewport; saved
child source matrices remain unchanged. Mesh winding and camera orientation
are adapted on entering the right-handed runtime and restored on disposal.
The runtime attaches the saved world without fetching another copy of the map
GLBs, and retains authored transforms, materials, visibility and ownership.

Rerunning import with the same source manifest preserves the existing scene.
A changed source manifest refuses to replace it. There is no automatic merge
of changed source geometry with authored changes. Edit placement descendants;
keep the dedicated root and source identity metadata intact. Removing or
duplicating declared source placements fails validation rather than silently
loading a replacement map. `--snapshot-only` and `--from-snapshot` separate
capture from scene writing for diagnosis.

## Actual save findings — 2026-11-05

The corrected scene opened in the actual Editor and displayed the textured
section. The UI changed tree `interlude:20_20.StaticMeshActor1771` by **+0.75 m
on X** and saved it. Its original source matrix remains unchanged; the edit
is a separate presentation transform.

An audit of the save compared resources by intrinsic identity and decoded
geometry channels instead of relying on filenames. All 836 geometry-bearing
mesh records preserved positions, normals, UV0, indices and submesh records
exactly. All 151 placement metadata records, 276 nodes, enabled/visibility
flags and 193 PNGs were retained. The only node transform change was the
requested tree offset. Editor changed PBR `maxSimultaneousLights` from 4 to 8
on 413 materials and refreshed texture/cache metadata; these are recorded
Editor serialization changes, not native material-parity findings.

The save exposed a concrete **Editor 5.5.3 UV2 defect**. Babylon serializes
`uvs2`, while the installed binary saver reads `uv2s`. The terrain lost its
4,704 float32 UV2 values (**18,816 bytes**). Source conversion output was
unaffected. The original failed save and its complete before/after snapshots
are retained; this failure cannot count as a successful preservation check.

A project-owned prepack step now restores that channel from
`assets/native-world.scene.native-editor-channels.json`. The record lives
beside the scene because Editor deletes unknown files inside scene folders.
New imports write the record automatically. The earlier local scene was
upgraded once from its verified capture snapshot, without regenerating saved
objects. Keep this sibling file with the scene when moving the project.

Recovery requires the scene/source manifest, stable mesh identity, positions,
normals, UV0 and indices to match exactly. It appends the preserved UV2 to a
new binary and updates only that mesh's binary reference and UV2 descriptor.
Existing authored UV2 remains authoritative. Changed geometry, malformed data
and unsupported inline geometry fail explicitly; no guessed mapping is used.
The original failed-save binary remains available. A second actual UI save
again removed UV2, retained the external record and the tree offset, and
`pnpm build` automatically recovered the same channel hash before packing.

The reopened Editor inspector displayed the saved **0.75** X position with
the world visible. Editor's own in-process Play export bypasses the CLI
prepack step. After a save, run `pnpm generate` with Play stopped and reopen
the scene to load repaired data into Editor. Do not save or run Play during
generation, since both write the same resources. Search/scene switching once
produced a blank viewport; normal project closure and Dashboard reopening
restored it with the same saved data. This Editor lifecycle defect remains
unresolved.

Editor Play also removes every `BABYLON.ShaderMaterial` from its exported
material list. The actual first Play showed white terrain. The client now
recovers only an omitted terrain material from the live authoring scene on
the same engine, requiring matching scene/manifest/root/mesh identities. It
serializes and parses an owned copy, preserving current unsaved shader edits;
it does not share the source material or replace an existing assignment.
Both `null` and the actual parser's `undefined` unresolved-material result
are handled. Stop/abort/failure cleans up only the owned copy and restores
the original assignment. The actual corrected Play displays textured terrain
and both actors (`material-nullish-play-current.png`). The installed Editor
and native files are unchanged.

The browser's authored route enables Babylon's full incremental-loading flag
while parsing the bounded scene, then restores its prior value. This loads
offscreen geometry before placement validation and script startup. The first
browser attempt exposed missing deferred geometry; weakening that validation
would have concealed the incomplete load. Other routes retain their prior
loading behavior. The CLI includes the authored shader and needs no live-scene
material recovery.

Evidence is under `artifacts/native-parity/editor/world-import/`: original and
corrected import receipts, `corrected-scene-loaded.png`,
`tree-edit-before-save.png`, `before-world-edit/`, `after-world-edit/` and
`saved-world-audit.json`, `reopened-tree-position.png`,
`second-save-channel-state.json`, `uv2-first-recovery.json` and
`build-second-save.log`. Final authored desktop/mobile production checks pass
**2/2** in 1.4 minutes, with no browser errors or duplicate map GLB requests.
All **2,245 authored files / 53,609,808 bytes** match the preservation baseline,
including after repeat import. Accepted captures, per-test hash receipts and
the completion audit are in `browser-final-accepted/` and
`completion-receipt.{md,json}`. [VERIFICATION.md](VERIFICATION.md) retains the
earlier mobile trace-cleanup timeout and its test-fixture correction.

Native shader fidelity, exact live camera/location, unsupported flame effects,
Power Strike timing/full attack reference and measured GTX 1060 performance
remain separate open requirements. See [NATIVE_WORLD.md](NATIVE_WORLD.md),
[EDITOR_ROUNDTRIP.md](EDITOR_ROUNDTRIP.md) and [NATIVE_PARITY.md](NATIVE_PARITY.md).
The tracked goal remains active; Phase 2 networking remains planned.
