# Continue native asset work — latest checkpoint 2026-11-05 22:10 Riga

Later dependency repair, 22:20 Riga: delayed old dev exit reproduced against the
current Editor-generated entry. Desktop Editor emits navmesh plugin imports
that CLI pack omits. Added installed-Editor pins @babylonjs/addons9.27.1 and
@recast-navigation/{core,generators}0.43.0, with lockfile. Same generated-entry
Vite optimization now passes; new browser compiler regression included in
436/39 passing units. Build/typecheck pass, main bundle unchanged. All2244
authored files remain exact. Evidence:
`artifacts/native-parity/research/editor-plugin-dependencies/README.md`.
Initial dev exec63196 was stopped after a separate startup stall. Vite's root
watch covered91533artifactfiles. Added only server.watch.ignored for artifacts;
fresh owned `pnpm dev` exec47536 now serves127.0.0.1:5173, log
`dev-watch-excluded.log` in that folder. Page/generated script/navmesh module
HTTP200 checks take0.12–0.25s in this one run; no controlled performance claim.
Recheck ownership/state before browser tests; stop only
this owned server if a new test invocation must claim5173. Separate dev cold-load
delay remains open. No native/Editor input or asset reconversion in this fix.

Preserve the existing dirty project at `C:/laragon/www/l2-browser-client`.
The tracked asset goal is incomplete; do not create a duplicate, reset files,
publish binaries or implement Phase 2. User priority remains reusable migration
and a correct baseline before optimization. Native architecture may be replaced
by an efficient Babylon implementation that preserves evidenced behavior.

## Work completed

- Actual Editor 5.5.3 UI save/reopen/Play proves flame settings On, texture/fade
  starts 0.25/0.75, independent rates 0.5/1.5. Flame and glow visibly render; Play
  stopped. All current 2,244 authored files are preserved after reopening/Play.
- Final build/typecheck passes; full unit run 435/39 passes. Final production
  browser run 6/6 passes in 5.3m: authored world desktop/mobile, source/authored
  flame replay, authored mobile flame and corrupt-effect fallback. Includes
  invalid-seek rejection without disabling good effects. No need to repeat
  these checks absent relevant changes. Test-owned browser/server exited.
- Post-browser and `pnpm assets:editor --from-snapshot` preservation checks pass:
  2,244 files /53,057,535 bytes exact. Prior 2,245-file baseline is historical;
  actual save removed thumbnail and changed intended config, then prepack
  restored exact terrain UV2. See current completion receipt below.
- Root read terrain-mask-native-rea/REPORT.md. CPU GetLayerAlpha classifies
  coverage; its scalar is not established as GPU alpha. Exact shader path and
  bUseAlpha remain unresolved. Refined `.planning/terrain-render-followup-prompt.md`
  is the ready-to-send separate REA-agent task; user plans to supply it. Root
  has not launched a new remote terrain analysis.

## Read before continuing

- `artifacts/native-parity/editor/flame-authoring/COMPLETION_RECEIPT.md`
- `docs/NATIVE_FLAMES.md`, `docs/VERIFICATION.md`, `docs/NATIVE_WORLD.md`
- `artifacts/native-parity/research/terrain-mask-native-rea/REPORT.md`
- `.planning/terrain-render-followup-prompt.md`
- Older `.planning/native-flame-continuation.md` for runtime ownership, original
  native reference evidence, migration and DDS candidate details.

The current staged source snapshot remains unchanged. DXT5 migration candidate
is separate and must not silently overwrite the authored source manifest.
Do not normalize assets or infer shader formulas from CPU mask classification.
Native visible rules are acceptance constraints, not a mandate to copy old D3D
classes, pass counts or caches. Single-pass/cached-weight alternatives require
sampling/rounding/color-space and resource-limit analysis plus later profiling.

## Ownership at handoff

All three agents completed. `powerstrike_integration_audit` froze bounded offline
light-evaluation evidence under
`artifacts/native-parity/research/flame-runtime/lighting-followup/light-evaluation/`.
Read `findings.md` before duplicating it: all 30 source lights have initial
steady/ordinary defaults; native radius, intensity and color equations are
recovered. Two collector runs reproduce identically, six algebra checks and
82 output hashes pass. Selected-draw eligibility/revision, live color branch,
level scalar/environment output and caller transforms remain missing; final
diffuse also needs ambient/dynamic lights and renderer state. No guessed final
lighting multiplier was implemented. `editor_material_adapter` completed the
current Markdown updates; `native_world_editor_research` completed the read-only
prompt review. No agent owns ongoing mutations. Editor remains open, Play stopped.

Last IMPORTA capture task found L2 absent and competing work at 2560x1440@59Hz;
supported 120Hz was enumerated, not selected. That task sent no input. Native
attack loop exists only as low-cadence observation; adequate matched reference,
live location/camera, weapon attachment and full skill sequencing remain open.
Recheck current host state before any future capture. Keep Jump active, native
files/protected INI and shared tools unchanged; outputs stay outside native tree.

## Next useful work

Use the completed isolated research to identify the smallest demonstrated gap
in the four-case slice; integrate only supported data/behavior. Preserve source
and authored edits, cleanup/fallback and GameWorldAdapter. Keep unresolved native
lighting, terrain shader path and full Power Strike parity explicit. Native
reference/cadence and hardware performance cannot be declared passed from these
functional tests. DATABASE display remains at most75Hz; IMPORTA results cannot
certify GTX1060 performance. Keep the fixed acceptance recipe unchanged.
