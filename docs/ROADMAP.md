# Project status and next steps

## Current direction and next work — 2026-11-07

The end goal is reusable conversion of native characters/races, male/female
variants, equipment, animations/effects and map blocks, with original audio
connected to gameplay. The user's latest sequencing is explicit: **finish human
male/female, their class skills and usable 20_20 traversal before expanding to
other races or map tiles**. The user's indoor stair-support defect is now
reproduced and fixed; the scoped route proof and remaining camera/routing gaps
are recorded below rather than treating older floor checks as full traversal.

Use independently runnable small scripts per game system with shared readers
and packaging helpers. Running one system must not require all extraction.
[ASSET_BATCHING.md](ASSET_BATCHING.md) records these dedicated commands and the
existing optional `assets:pipeline` orchestrator. Further orchestration is not
the next milestone. Runtime staging/Editor integration remain separate required
steps, and audio payloads plus events belong to each actor/skill/enemy bundle.
The working continuation is
[native-power-strike-init-continuation-20261107.md](../.planning/native-power-strike-init-continuation-20261107.md).

The [female fighter expansion](../artifacts/native-parity/research/native-ffighter-expansion-20261107/REPORT.md)
now demonstrates a second character recipe: seven parts, 113 clips, 323 events
and 61 linked sounds. Its conversion and both native-route inspectors pass.
The later [female-world integration](../artifacts/native-parity/research/native-ffighter-world-20261107/REPORT.md)
now passes source/authored desktop and mobile viewport/touch checks on hardware
WebGPU, including selected equipment, movement/actions and post-gain audio.
Four female death cues plus five Musveren cues are connected on that route;
six specialized female attack events remain unresolved. The earlier unit-only
receipt stays separate from this newer browser proof. Other human bases/classes,
skills, automatic surface footsteps and a new interactive Editor save remain open. Next establish
that coverage beyond this fighter recipe while preserving authored work.
The [indoor-stair repair](../artifacts/native-parity/research/native-stair-traversal-20261107/IMPLEMENTATION.md)
passes male/female source/authored hardware WebGPU ascent/descent and real
lower-ramp clicks, with 59 focused support checks, build/typecheck and exact
asset preservation. Original collision-enabled static sections were omitted
from navigation; no new ramp, source edit or tolerance change was required.
Automatic routing around turns and upper-landing camera roof occlusion remain
open. One earlier device-loss failure is retained without a claimed fix; the
four final cases report no GPU errors/loss. No complete 20_20 or all-human
acceptance is claimed. The later
[footstep bundle and playback checkpoint](../artifacts/native-parity/research/native-footstep-audio-20261107/REPORT.md)
is complete for explicit surface/sample selection using twenty original WAVs.
The [locomotion checkpoint](../artifacts/native-parity/research/native-human-locomotion-20261107/REPORT.md)
now connects both fighters' original Walk/Run clips and events to move-to travel,
with four passing hardware WebGPU route/profile cases. Gait changes preserve
the destination; both retain the existing synthetic 0.7 m/s. The new
[ground-contact checkpoint](../artifacts/native-parity/research/native-ground-contact-20261107/REPORT.md)
now retains accepted mesh/triangle support beside footstep events. Source male
desktop and authored female mobile traverse all eight indoor waypoints with
zero before/after position delta, original event timing and clean hardware
WebGPU. The dedicated placement-audio tool also preserves 24 declared slots
from eight placements and three original WAVs; it is not yet staged for playback.
The [selected-skill dependency adapter](../artifacts/native-parity/research/native-human-skill-audio-20261107/REPORT.md)
now packages explicit skill/level selections independently; Power Strike 3/1
reuses two original WAVs with complete source rows and candidate-only lookup.
That tooling checkpoint adds no world playback. The later
[special-attack integration](../artifacts/native-parity/research/native-human-special-attack-20261107/REPORT.md)
connects an explicitly selected male/female source-animation preview with four
directly authored cues per clip and honest specialized-event coverage. It
preserves the basic attack, equipment and original source data. Native skill
family/target/effect dispatch and remaining sound selectors still need their
own implementation/evidence; do not assign table sounds guessed cast/impact times.
The later [component renderer](../artifacts/native-parity/research/native-power-strike-components-20261107/REPORT.md)
adds opt-in inspection of all six retained Power Strike components on the human
source hand, with manual original texture frames/colors and separate dedicated
staging/registration tools. Special attack motion/direct cues remain independent.
Equipment retagging now uses owned actor meshes so attached effects keep their
own picking policy. The later
[timed init sequence](../artifacts/native-parity/research/native-power-strike-init-20261107/REPORT.md)
adds three retained init emitters with 19 reusable particle slots, synchronized
to that same source animation clock. Its finite scheduling and interpolation
are explicit modern preview choices. Full native particle execution, shot/impact
placement and table-sound selection are still unfinished; the reports separate
hardware checks from native fidelity and performance acceptance.
Continue justified automatic surface consumers and broader human skill bindings
separately, without repeating completed conversion.
Native speed, automatic surface/config/random selection and full human coverage
remain open. Do not repeat the corpus export.

Use the existing WebGPU renderer to preserve Lineage II's appearance and
behavior with modern world rendering. Legacy Direct3D internals need reproduction
only where they explain a meaningful visible defect or required behavior.
[RENDERING.md](RENDERING.md) records implemented capabilities and the plan for
chunking/streaming, LOD, static instancing, GPU texture compression and culling.
Earlier migration-first sequencing below is historical; profiling and bounded
optimization can proceed on supported content while fidelity work continues.

The [Editor UV2 writer fix](../artifacts/native-parity/editor/uv2-export-20261107/REPORT.md)
now passes installed Save/Play/build channel checks; a WebGPU texture-root fix
also removes observed texture failures. Final visible Editor proof remains open
because screenshot capture failed. The original
[environment tables are now converted](../artifacts/native-parity/research/sky-environment-conversion-20261107/REPORT.md)
without selecting a runtime tint. An [explicit row comparison](../artifacts/native-parity/research/sky-literal-comparison-20261107/REPORT.md)
now stages those tables and applies temporary material copies with restore;
the native default/time/consumer is still unresolved. Prioritize sky appearance and SFX
integration gaps, with source identity and policy limits explicit. Obtain a
reproducible hardware baseline before choosing a performance change. The native
loader still eagerly loads the section and clones placements; no optimization
gain or 120 FPS acceptance is claimed.
Use [.planning/rendering-direction-20261107.md](../.planning/rendering-direction-20261107.md)
as the current handoff; older continuations remain evidence for their checkpoints.

The selected **4,773-sound** export/decode, clean-build, cache-repeat and verify-only
checkpoint is complete ([verification](VERIFICATION.md)). Do not repeat it on
resume. Each current player-variant route admits thirteen action cues: four player
death, two Musveren death, three Musveren attack and four direct special-preview
cues. Explicit footstep selections are a separate event set. The original male
[checkpoint](../artifacts/native-parity/research/native-action-audio-20261107/REPORT.md)
and newer female report above are separate evidence; the death/basic-attack union
has thirteen definitions, and including both special previews gives twenty-one
action cues over sixteen payloads. These reuse existing exports. Remaining audio
categories/native playback rules, visible fidelity, full Editor acceptance,
hardware performance and Phase 2 networking remain unfinished.

## Current map checkpoint — 2026-11-06

[Adjacent TerrainSector247 is integrated](../artifacts/native-parity/research/terrain-extension-20261106/REPORT.md)
in the source and saved/exported WebGPU routes: 157 placements, 62 models and
4,992 terrain triangles. The completed 735-value UV migration remains unchanged.
Map-specific commands/evidence remain in
`.planning/native-terrain-extension-continuation-20261106.md`; use the current
rendering handoff above to select new work.
The broader goal remains active: map coverage, visible native material/sky
matching, original audio, full Editor acceptance and measured performance are
incomplete. Native coordinate submissions do not prove native visible pixels.
Phase 2 networking remains planned.

## Original sky and bounded world audio — 2026-11-06

The [source sky room](NATIVE_SKY.md) now loads on both routes and is saved as
editable geometry/materials. Native time-of-day and composition remain open;
the frozen source preview has an unresolved hard color boundary. Six original
death cues now play through the world with verified controls, timing and cleanup
([audio scope](NATIVE_AUDIO.md)). Full audio categories, native visual/audio
parity, actual new sky UI-save proof and performance acceptance remain open.
The broader goal is ACTIVE. Continue from
`.planning/native-sky-audio-continuation-20261106.md`.

## Source building floor restored — 2026-11-06

The [BSP floor pipeline](NATIVE_BSP_FLOOR.md) restores the missing final-map slab
inside Actor940, preserving existing Editor geometry/materials and both terrain
UV channels. At that checkpoint, local source and authored/exported routes
rendered it and passed bounded stairs, floor walking and wall-blocking checks.
The newer user report of failed stair climbing reopens current traversal
verification; it does not undo the source slab restoration or establish the
new failure's cause. That restoration closes its specific missing-floor omission;
full BSP, native lighting/collision, original audio and Phase 2 networking remain
open. The broader asset goal is active. Continue from
`.planning/native-bsp-floor-continuation-20261106.md`.

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

**2026-11-06 acceptance clarification:** 1:1 includes all applicable original
Interlude audio. Six death cues now have a verified world preview; extraction
and other world playback remain partial. [NATIVE_AUDIO.md](NATIVE_AUDIO.md) records required coverage and evidence;
the browser owner owns end-to-end audio alongside ongoing terrain work. Music,
ambient emitters, footsteps, voices/actions, combat/skills and UI must not be
omitted from completion. Phase 2 networking remains planned.

Updated: 2026-11-06. This document records the current scope; the original Phase 1 requirements remain in `.planning/` as the foundation brief.

## Current terrain milestone and next work — 2026-11-06

The [scoped terrain UV correction](../artifacts/native-parity/research/terrain-uv-migration-20261106/implementation/REPORT.md)
is implemented in source conversion, saved Editor geometry and public export.
Exactly **735 V fields** change; U, diffuse UV2 and other authored bytes remain
preserved. Source runtime staging retains original model conversion provenance
and old resources. This replaces the earlier wait for a qualified UV decision.

Verification passes **27 + 8 Python tests**, **49 + 6 relevant unit tests**,
**44 GPU cases on each of SwiftShader and GTX 1060**, five desktop/mobile native
Editor/slice browser regressions, typecheck/build and zero-error/warning glTF
validation. Browser before/after views have ready scenes and zero errors.
Actual Editor 5.5.3 save/rebuild retains the correction and restores known UV2
loss. Play was blank at that checkpoint; the later recovery above establishes
visible output after reopening, with its lifecycle cause and raw UV2 loss open.

Next work remains visible native comparison and unresolved composition/lighting,
CPU pruning and bUseAlpha where they affect visible output; durable Editor
Save/Play behavior; original-source world audio and audible verification; and
measured performance under the current rendering plan.
The native capture is **offscreen submission evidence**, so it does not prove
visible pixels, screen improvement or overall 1:1. Audio was not re-audited here.
This local milestone included no native action or deployment and does not
complete the broader client goal or Phase 2 networking.

## Earlier actual Editor checkpoints

The separate `native-world.scene` now contains editable native terrain and
scenery. An actual tree-placement edit survives UI save and reopening; a
project-owned prepack adapter repairs the demonstrated Editor 5.5.3 UV2 loss.
[NATIVE_EDITOR_WORLD.md](NATIVE_EDITOR_WORLD.md) records this newer world
authoring checkpoint. Earlier statements below about runtime-only world
objects apply to `native-parity.scene`, which remains available.
That world-authoring checkpoint passed **2/2** authored desktop/mobile checks;
all **2,245 authored files** survived browser checks and repeat import. Its
unit/build checkpoint passed **283 tests / 34 files**.

The later actual UI flame timing save/reopen/Play proof retains enabled preview,
starts **0.25 / 0.75 seconds** and rates **0.5 / 1.5** in the authored world.
That checkpoint passed **435 unit tests / 39 files**, generation/typecheck/
build and **6/6 browser cases**. All **2,244 recovered files / 53,057,535 bytes**
survive Play, browser checks and repeat import unchanged; the earlier pre-save
backup retains the deleted thumbnail. [NATIVE_FLAMES.md](NATIVE_FLAMES.md) records
this bounded authoring result. Native visual/performance acceptance remains open.

Earlier Editor 5.5.3 checks saved and reopened native-scene equipment, exact clip
selection and camera changes, and rendered the imported world/actors in Play. Client
adaptations address its UMD imports, local resource resolution and displayed
canvas. Authored fog mode None avoids its disabled-switch export omission.
[EDITOR_ROUNDTRIP.md](EDITOR_ROUNDTRIP.md) records saved values, preservation
audits and recovery from a blank preview by reopening the project window.
Saved properties also pass rebuilt desktop/mobile browser checks. A subsequent
source-backed Musveren support correction restores its visible corpse without
changing model payloads. The exact NPC 21622 profile now supplies scale 1.2;
residual death intersection and remaining placement differences are documented in
[NATIVE_ACTOR_PLACEMENT.md](NATIVE_ACTOR_PLACEMENT.md).
Exact actor-material tint/roughness now also survive actual UI save/reopen/build
and desktop/mobile checks. The demonstration override is disabled in the normal
preview. Native shader and full skill-effect timing authoring, and full Editor acceptance, remain open;
this does not complete the asset goal or Phase 2.

## Current visible-world priority

The latest user request brings native world/actor integration forward. The main
`/?world=interlude` route now renders source terrain/scenery with the fighter,
Musveren, local terrain movement and live FPS. Source investigation identifies
PlayerStart10/Sector229 as the startup candidate. The base migration exports
its nine-sector surroundings: **61 models / 151 static placements**, replacing
the earlier Sector106 inspection selection. The currently selected [additive
section](NATIVE_MAP_MODEL_APPEND.md) has **62 models / 157 placements**, BSP floor
and frozen source sky, preserving authored work and terrain UV2. One flame model across **12
placements** retains its source graph and now has a reversible source-formula
preview with independent texture/fade clocks. Native lighting and synchronized
visual parity remain open; see [NATIVE_FLAMES.md](NATIVE_FLAMES.md).
[NATIVE_WORLD.md](NATIVE_WORLD.md)
records the coordinate, camera, material and collision boundaries. Candidate
terrain texturing is functional, but native rendering and the live debug view
are not certified. Optimization and hardware performance measurement can proceed
on this supported slice; this work still does not complete the larger tracked
goal or Phase 2.

## Earlier priority — repeatable raw native migration

The earlier migration-first priority established reusable conversion before
playable integration. It does not block profiling or optimization of supported
content under the current direction. `pnpm assets:migrate --prove-rebuild`
orchestrates the pinned IMPORTA-PC snapshot, fighter/equipment/Musveren exports,
raw map/effect extraction and product validation. [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md)
documents coverage and limitations; [NATIVE_PARITY.md](NATIVE_PARITY.md) retains
the fixed acceptance contract. The complete four-case slice and GTX 1060/120 FPS
goal remain unfinished. IMPORTA-PC's reportedly 144 Hz display was last observed
at 59 Hz; verify its active mode and label its GPU results separately.

The main `map-20-20-section` job now uses `native-map-debug-location.json`.
With the new exact-ID NPC profile job, the clean-build proof reports
**381 identical products**, **26/26
cache hits**, zero clean hits, **100 archives** (69 models, 29 textures, two
audio assets), and **70 GLBs with zero Khronos errors/warnings**. Exact source
Power Strike dispatch now preserves `LineageEffect.s_u002_a` and
`LineageEffect.p_u004_a`, their six emitters and authored actor defaults.
Live timing/attachment and synchronized full character motion remain unverified. Earlier
TerrainSector106/six-model results remain historical evidence. These totals
prove conversion and reproducibility; the subsequent browser run is recorded
separately in [VERIFICATION.md](VERIFICATION.md).

[NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md) records the source name/table/
class join and inherited fields. Actor scale wraps the full preserved hierarchy;
collision height stays independent. Unresolved PrePivot and native support
placement remain explicit. The current final death pose intersects terrain by
up to 0.119400 m; it does not pass native visual acceptance.

Exact source weight restoration, empty-section repair and native StaticMesh
material-index resolution address demonstrated exporter/adapter defects. The
`/?world=interlude` scene exercises native fighter parts, item 22 replacement
and one-shot Musveren death through `GameWorldAdapter`. Native terrain/material
execution and collision, live location/camera alignment, sword attachment,
complete attack/Power Strike parity, remaining Editor authoring and performance
remain open. The flame formula preview does not complete native rendering fidelity.

Raw texture migration now preserves all requested native mip/palette layouts and
offers source-preserving DDS derivatives for 23 DXT1 textures. The section also
retains authored mask-transform tags/bytes. These additions prepare later native
materials and compressed-texture integration; they do not establish those runtime
behaviors or performance gains. See [NATIVE_TEXTURES.md](NATIVE_TEXTURES.md).

## Phase 1 — browser foundation

Implemented and pushed in commit `3b16f1c317e20ee636a3b3f83bddafc15096740a`: the native Babylon.js Editor Vanilla project, editable environment, mobile-first HUD, six synthetic entities, replaceable `GameWorldAdapter`, procedural animation, targeting, interpolation, teleports, lifecycle controls, and diagnostics.

The baseline passed strict typechecking, build, 37 Vitest tests, and nine Playwright tests. Desktop Editor import/edit/save/reopen/play and live official MCP authoring were not performed because those tools were unavailable. See [VERIFICATION.md](VERIFICATION.md) and [EDITOR_MCP.md](EDITOR_MCP.md). These outcomes apply to the procedural foundation, not to subsequently imported models.

## Phase 1 follow-up — converted asset integration

The local asset follow-up adapts the client to four existing converted character GLBs. The implementation now has presentation-owned character profiles, native clip resolution, asset-derived UI anchors and recoverable asynchronous loading. [ASSET_AUDIT.md](ASSET_AUDIT.md) records exact asset findings, screenshots and outstanding defects; [VERIFICATION.md](VERIFICATION.md) records actual checks. File availability, structural validity, visual correctness and publication provenance remain separate findings.

**The client adapts to the asset structure.** Profiles use the exact `wait_Hand`, `run_Hand` and `Atk01_Hand` names, with looping idle/run and a one-shot, retriggerable attack. Assembly preserves the seven separate parts, native skeleton/helper hierarchy, material references and imported metadata. Exported meter units and origins are retained at an identity presentation root; bounds inform labels, selection and picking instead of resizing the rig. The supplied GLBs already contain their animation and texture resources, so no unsupported equipment or separate-animation subsystem is introduced.

The user identified the local source workspace as `C:\laragon\www\lineagen`. Inspection confirmed:

- Converted models: `.assets\converted\MFighter.glb`, `FFighter.glb`, `MMagic.glb`, and `FMagic.glb`, with matching Blender files and manifests.
- Offline tooling and documentation: `.assets\conversion\`.
- Earlier validation evidence: `.assets\evidence\`; this evidence belongs to the source workflow, not this destination's verification.
- Existing Blender executable: `.assets\tools\blender\blender-5.0.1-windows-x64\blender.exe`.

`pnpm assets:stage` copies the four source-original GLBs unchanged into ignored `public/assets/characters/`. The current local integration instead stages the verified corrected copies with `pnpm assets:stage artifacts/asset-integration/repair/converted`; rerunning the plain command restores the original grounding defects. Elyra uses FFighter, Orin uses MFighter and Seren uses MMagic; the three monsters remain procedural. The fourth profile, FMagic, is included in `/tests/browser/assetInspection.html` alongside the other candidates. A clean clone without local binaries retains animated fallbacks. Neither staged artwork nor asset screenshots are published by this task.

The reused offline validator freshly passed both the original and repaired four-file sets and all 467 clips with zero errors. Current strict typecheck, build, **44 unit tests** and **14 browser tests** passed; one opt-in repair-measurement test is intentionally skipped in ordinary runs. Dense post-repair skinning, native one-shots/retrigger, independent instances, cleanup, all nine baseline behaviors and desktop/mobile captures are verified. Eleven unused equipment-family clips retain measured floor defects, documented with the smallest repair in the audit. The destination remains pinned to Babylon 9.27.1; earlier source browser evidence used 9.33.0. Physical-device performance and desktop Editor/MCP checks remain unverified.

The earlier conversion independently normalized whole rigs to 1.8 m and corrected root motion/grounding at 24 Hz. The client does not repeat those operations. Destination measurements demonstrated residual floor penetration between those keys: a targeted local repair appends 192 Hz root-translation corrections to `run_Hand` in all four variants and `Atk01_Hand` in MFighter, FFighter and FMagic. All original binary payload, rigs, parts, textures and other channels remain unchanged, and matching copied Blender Actions were corrected. Reports and repaired files remain under ignored `artifacts/asset-integration/repair/`; the source workspace is unchanged. The audit distinguishes this proven defect repair from client compatibility changes and from the preexisting limit on original cross-variant stature claims.

`GameWorldAdapter` continues to deliver lifecycle and semantic state. `appearanceId` selects presentation data, and `animationSequence` distinguishes repeated explicit actions from ordinary snapshots. Native asset names and file-format handling remain outside the adapter. The mobile HUD and editable environment remain in scope; this work does not call for a stylesheet overhaul. The [handoff](../.planning/asset-integration-prompt.md) and [detailed requirements](../.planning/asset-integration-details.md) preserve the acceptance contract.

## Phase 2 — Real M0 networking

The subsequent native conversion work uses the hash-pinned IMPORTA-PC snapshot as the source of truth and adds repeatable model/texture/audio recipes plus an isolated drag-and-drop package inspector. Original skeletal keys, clip durations, mesh transforms and notification references are retained. Exact native skill/effect records are extracted separately; native particle/shader simulation, complete equipment selection and skill execution remain unsupported runtime features, not inferred from successful export. See [ASSET_PIPELINE.md](ASSET_PIPELINE.md) for the supported contract and [NATIVE_CLIENT_AUDIT.md](NATIVE_CLIENT_AUDIT.md) for the source evidence. This does not replace the legacy world with an Interlude map conversion.

The additional local Talking Island integration reuses hash-pinned converted terrain/scenery/surfaces and adapts the six-entity client to supported floors, terrain and collision. Camera-relative rendering, foliage fixes, mirrored placements and RGB terrain masks are retained. See [WORLD_ASSETS.md](WORLD_ASSETS.md) for the dataset and verification. This expands local asset integration without changing the networking milestone below.

**Planned, not implemented:** establish Interlude authentication, character selection, and world entry against stock Mobius.

Keep `GameWorldAdapter` as the integration boundary. A future adapter must deliver real initial state and ordered entity events, normalize coordinates/time, and identify teleports without requiring a renderer rewrite. Synthetic developer commands need an explicit support policy in the real adapter.

Phase 2 evidence must demonstrate actual authentication, character selection, and entry into a stock server's world. The synthetic demo, asset imports, and placeholder login screens do not establish those results. Decide transport, protocol, and test-environment details when that phase is explicitly started.

The asset follow-up preserves this boundary. Real combat calculations, quests, progression, gacha, broad map reconversion and production deployment remain outside the current scope.
