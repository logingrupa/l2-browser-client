# Continue native assets — world authoring checkpoint, 2026-11-05

## Latest completion — approximately 19:55 Riga

The browser check and preservation continuation is now complete. Read this
section before the older work history below. Parent goal remains ACTIVE.

- Final authored desktop/mobile run **2/2 PASS**, 1.4min (38.7s / 40.4s),
  `world-import/browser-authored-final.log`. Final built runtime unchanged;
  typecheck after test-only edits PASS (`typecheck-browser-fixture.log`).
- The prior five-case run was **4 PASS / 1 FAIL**, not all-pass: authored mobile
  timed out while explicit context.close forced trace ZIP creation before
  pass status was known. DEBUG rerun reproduced it and truncated ZIP. Keep
  `browser-complete.log`, `browser-mobile-diagnostic.log` and
  `browser-first-complete-run/`; its mobile hash receipt is stale and invalid
  as completion evidence. Final mobile uses a fixture-managed page; file hash
  preservation runs before teardown. Same conditions/tolerances/timeouts;
  pure bulk captured-data comparisons use Node strict assert instead of
  thousands of runner trace steps. No runtime or installed Playwright patch.
- All three ordinary native cases passed in the preceding combined run.
  Do not needlessly repeat them or the completed 283-unit/build checkpoint.
- Repeat `pnpm assets:editor --from-snapshot` PASS, status `preserved` for
  existing manifest (`repeat-import-preservation.log`). Authored scope:
  **2,245 files / 53,609,808 bytes**, unchanged from `before-repeat-import`.
  Includes all three scenes,193PNGs,externalUV2 record and project.
- Independent first receipt: `final-preservation-receipt.{md,json}`.
  Final accepted evidence: `browser-final-accepted/` and
  `completion-receipt.{md,json}`. Docs/README/PRODUCT updated with this result
  and historical scope. No pipeline reconversion was necessary in this resume.
- Real desktop/mobile screenshots shown inline through HTML tools. Software
  WebGL FPS only; no hardware performance claim. User can inspect built route
  `http://127.0.0.1:5173/?world=interlude&authored=1` while server is running.
  Owned preview is exec session **55146**, `pnpm serve --port 5173 --strictPort`;
  fresh authored-route HTTP200. Stop this owned server before any new browser
  suite needing5173. Editor Play remains stopped; do not resave during packing.

Next is a bounded native attack-loop recording using the supported ANIMPLAY
commands documented below. CharacterSelect need not be exposed for this direct
clip test. Loop playback is not coordinated Power Strike or matched parity.

Native capture delegated on IMPORTA after local completion:
task `node:delegated-task:command%3Amcp%3Acd560e39-23d5-4a03-a85c-285c5e04f4ef%3Aremote-delegate%3A2a8262de-bd44-4f1b-b2de-e499ede08a81`.
Thread link: <t3-thread://v2/20b54a96-ad0d-46e3-9eec-9f7158c0978f/mcp:launch:a60828eb6c5b65991c25681f314e2c72bc38e0a4ed0f614e46c24d9a8ea9860d>
Scope: observed ANIMPLAY unarmed attack loop and explicit idle, real video/PTS,
protected-source preservation and copied/hash-verified DATABASE evidence.
Follow returned next: completion wakes parent; do not poll or start competing input.

Attack capture above COMPLETED: visible Atk01_Hand_MFighter cycles +explicit idle,
48protected files unchanged,82copied/hashverified evidence files in
`reference-current/animplay-20261105-20261105-200102/`. Video33frames/7.966667s
=4.142capturedFPS; below fixed30FPS reference requirement. Not timing parity.
New cadence diagnosis/capture helper task delegated; do not compete for input:
`node:delegated-task:command%3Amcp%3Acd560e39-23d5-4a03-a85c-285c5e04f4ef%3Aremote-delegate%3A2420b518-388a-419f-a458-1eb4355cf27c`
<t3-thread://v2/20b54a96-ad0d-46e3-9eec-9f7158c0978f/mcp:launch:67fca37e522ceac6dcf30ef3c3d958998cda9c22ba79724a89b4a9e2992dcd05>
Bounded existing-backend diagnosis; new isolated helper allowed, shared
controller/native files/display unchanged. No polling before completion.

Keep the existing tracked parent goal ACTIVE. It is incomplete. Preserve this
dirty workspace at `C:/laragon/www/l2-browser-client` on DATABASE-PC; no new
goal, reset, binary publication or Phase 2 networking. User authorizes GUI/input
on both DATABASE-PC and IMPORTA-PC; do not ask again. Keep Jump Fluid/native
files/protected l2.ini/source lineagen unchanged. Raw reusable migration and
visible world/assets precede optimization. No AGENTS.md was found in project
or ancestors. /fleet and /lane were already read; fleet status passed, DATABASE
is SSH-only by design; lane does not support this project.

This supersedes active implementation details in
`native-material-dispatch-continuation.md`; retain its raw migration counts and
source/native limitations. Read `docs/NATIVE_EDITOR_WORLD.md`, updated
`docs/VERIFICATION.md`, `docs/ASSET_AUDIT.md` and `docs/NATIVE_PARITY.md`.

## Current authored world

- New repeatable `pnpm assets:editor`: production-loader capture → pinned
  installed Editor 5.5.3 geometry writer → separate ignored
  `assets/native-world.scene`. 276 nodes, 988 mesh records, 414 distinct
  geometries, 193 editable PNGs; same source 61 models/151 placements/4512
  terrain triangles. Manifest `062218e6dc1c887e5018489f69b1faaed571b519d937cc0d7c7c9b8c1474e2c2`.
- Authored browser route `/?world=interlude&authored=1`; ordinary
  `/?world=interlude` still loads source GLBs. The new route attaches saved
  scene objects without importing duplicate map GLBs. Source metadata retained.
- Editor LH derivative: dedicated root Z=-1, opposite mesh face orientation,
  reflected camera. Runtime adapts/reverts only these coordinate terms.
  `removedZReflection` prevents reflecting an already-RH root's camera. Child
  authored placement/material edits and scene ownership remain intact.
- Actual UI edited tree `interlude:20_20.StaticMeshActor1771`, stable ID
  `native-1601d53f5ccd4772a5aadab6`, position X **0.75**. Original local/source
  matrix unchanged. Saved, reopened from Dashboard, inspector visibly confirms
  0.75 with textured world. Two actual UI saves retained it.
- Same-manifest import preserves existing files; different manifest refuses.
  No automatic merge for changed source. Deleting/duplicating required placement
  identities fails validation. Binaries/scenes/generated textures stay ignored.

## Demonstrated Editor defects and narrow adaptations

1. Editor saver reads `uv2s` while Babylon serializes `uvs2`. Actual save removed
   terrain UV2: 4704 floats/18816 bytes, SHA256
   `4c6a9644e0f1f71293741b8bf835576efa68808548c63613e7ce9ec80efc7ab2`.
   Every other position/normal/UV0/index/submesh buffer remained byte-identical;
   193 PNGs and all151 placement metadata unchanged. Editor rewrites material
   maxSimultaneousLights4→8 and cache metadata; recorded, not claimed lossless.
2. `scripts/preserve-native-editor-uv2.mjs` prepack verifies exact source/scene
   identity plus all other geometry signatures, then appends exact UV2 into a
   new binary. Existing authored UV2 unchanged; changed geometry/invalid input/
   inline geometry refuses. First and second actual saves recovered correctly.
   External sidecar **assets/native-world.scene.native-editor-channels.json**
   survives Editor's recursive scene cleanup. Do NOT put it inside *.scene:
   actual second save deleted the old inside copy. New import writes sibling
   automatically; current old import was upgraded once from verified capture.
3. Editor Play exporter drops ALL ShaderMaterial definitions. CLI preserves them.
   `src/editor/restoreEditorAuthoredMaterials.ts` recovers omitted terrain shader
   only in file: Play from matching live authoring scene on same engine;
   serialize/parse owned copy preserves unsaved edits. Match scene/manifest/root/
   mesh/provenance; existing material objects untouched. Actual numeric missing
   material resolves to **undefined**, not null: real parser regression proves
   it, adapter handles both and restores exact prior value. Actual corrected
   Play textured terrain+actors screenshot exists. No installed Editor patch.
4. CLI authored world defers offscreen binary geometry by default, causing real
   `Authored native placement has no source geometry` failure. loadEnvironment
   scopes public SceneLoaderFlags.ForceFullSceneLoadingForIncremental=true to
   authored loadScene, restores finally. Validation not weakened. Ten unit
   cases cover async loading, errors, prior flag and ordinary routes.

Editor Play bypasses CLI UV2 prepack. After save use pnpm generate with Play
stopped, then reopen to reload repaired data. Stop Play before generation/build/
browser checks. Do not save concurrently with recovery. Blank viewport recurred
after search/scene switching; normal project close→Dashboard→double-click card
recovered it. Actual saved visibility flags were unchanged; cause unproven.

## Evidence and checks

Root `artifacts/native-parity/editor/world-import/` has immutable before/after
save copies, compare_saved_world.py + saved-world-audit.md/json, captured-world,
import receipts, source-checked recovery, logs and actual screenshots.
Key PNGs: corrected-scene-loaded, reopened-tree-position,
material-nullish-play-current (textured actual Play), editor-final-stopped.
Browser output is `world-import/browser/` (desktop/mobile/wide and diagnostics).
Earlier regular-route current PNGs are `artifacts/native-parity/browser/`.

- Final unit **283/34 files PASS**,10.30s: unit-complete.log.
- Final build/typecheck PASS: build-complete.log, main JS3877.31kB /
  959.74kBgzip, existing chunk-size warning.
- Earlier ordinary native browser **3/3 PASS** in browser-first.log; its two
  new authored cases stopped pre-navigation on JSON -0 vs0 comparison. Test
  now compares normal JSON roundtrip values while hashing original source bytes.
- Next authored run failed real deferred geometry; trace proved worldFailure.
  Retained browser-delayed-geometry-failures and browser-authored-rerun.log.
- Final five-case run uses production-playwright.config.ts and recorded
  4 PASS / 1 mobile cleanup FAIL in browser-complete.log. The later corrected
  authored-only run passed2/2; see the latest completion section above.
- Raw migration previous381products/26cachehits/100archives/70validGLBs unchanged
  by authoring work. Prior302 pipeline PASS is historical, not rerun here.
- Acceptance file unchanged:
  7a0ae70c593dbdad30637fa1de7bfd446d7091cbe0f31bb97eab31c130ea2df5.

Normal browser screenshots use SwiftShader, not GTX1060 performance. No120FPS
certification. DATABASE max75Hz; IMPORTA reported144Hz capability requires fresh
active-mode check. Preserve fixed visual/performance thresholds.

## Native reference next — important new supported command

Local offline agent completed `research/native-ui-playback/README.md` and
findings.json,14 byte anchors, source hashes checked. Supported public console:

```
ANIMPLAY ANIM=Atk01_Hand_MFighter
ANIMPLAY ANIM=Wait_Hand_MFighter
```

First requests LOOPING unarmed attack (43frames/30Hz source; live rate unknown).
Second requests explicit unarmed idle, not restoration of unknown prior state.
`ANIMPLAY REFRESH ANIM=...` bypasses same-name skip, tween.2 instead of.1; no
one-shot/rate flag. Do NOT use CHANGEANIM: mutates animation mappings. Attack
button only changes wait mode; Hit sends victim feedback; Combo requires an
already selected clip. `pv` shows/resets PawnViewer, does not hide it.

Latest native completed task proves literal pv receipt and Enter; full motion
unverified. Evidence reference-current/console-text-20261105 plus prior
resume-1755-20261105. Previous video decoded only ~4.18FPS, don't reuse cadence
claim. Current native PID must be rechecked. Read IMPORTA CONTROL/CODEC/DISPLAY/
PLAYBACK/HANDOFF and verificationJSON. Use supported Control-L2, fresh screenshot
at each open/type/Enter step. Preserve native files/INI/Jump/display.

T3 IMPORTA environment20b54a96-ad0d-46e3-9eec-9f7158c0978f; native project
127893ff-4129-478c-9841-f36a4c9b3405. Capabilities already called this thread.
Delegate a bounded real attack-loop capture next; returned next instructs
ending turn, no polling. Record real frames/timestamps, stop to idle, verify
hashes, copy evidence to DATABASE. Looping clip is not a certified coordinated
PowerStrike action. Exact live location/camera still unverified.

Full PowerStrike/weapon attachment, matched native/browser video/diffs, native
shader/collision fidelity, Musveren death residual .119400140m, remaining
effect authoring and hardware baseline/optimization remain open. Goal ACTIVE;
Phase2 networking remains planned.
