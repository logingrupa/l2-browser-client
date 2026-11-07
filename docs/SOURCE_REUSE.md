# Source review and provenance

## Lineage2Elbera toolkit review — 2026-11-07

The [tool-by-tool reuse audit](LINEAGE2ELBERA_REUSE_AUDIT.md) compares all 22
listed tool entries against this client's implementations. The reference clone
is pinned at `12c9656e2f053b233ec3fd87056491a6a6da8b0c`, matching the existing
BSP vendor receipt. Consult its inventory before adding another decoder or
exporter. Prefer selected upstream functions and fixtures with minimal adapters,
retained MIT notices and source hashes; document incompatible assumptions.
The audit identifies BSP lighting and bounded class readers as useful additions,
while retaining existing native-byte, mip, animation and material preservation.

## Existing source and integration evidence

The [original sky snapshot](NATIVE_SKY.md) preserves final map sky geometry,
three material chains and exact original texture payloads. Its narrow UE118
reader is hash-gated separately from the generic converter. World death-cue
preview now consumes six verified original WAV payloads from the existing actor
packages; [NATIVE_AUDIO.md](NATIVE_AUDIO.md) retains remaining native-policy gaps.

The [bounded BSP floor import](NATIVE_BSP_FLOOR.md) uses final `20_20.Model798`
polygons bound by the saved `ULevel.Model` reference. Selected MIT-licensed
Lineage2Elbera reader functions are pinned at commit
`12c9656e2f053b233ec3fd87056491a6a6da8b0c` under
`scripts/vendor/lineage2elbera_bsp`, with source hashes and license retained.
Only the exact map/Brush397 branch is supported. Source texture bytes are reused
from the verified building GLB; no source workspace or native installation was edited.

The new Editor world is a local derivative of the same hash-verified native
section, not a new source dataset. Stable Editor identities retain native
placement/model references; the original matrices and texture inputs remain
available. The actual save audit isolates Editor UV2 loss from conversion and
records the exact recovery channel hash. See
[NATIVE_EDITOR_WORLD.md](NATIVE_EDITOR_WORLD.md). The installed Editor's
ShaderMaterial filter was inspected read-only; the client adapts Play without
patching the installation.

The native world continuation now uses source startup-location evidence from
the exact map navigation chain and extracted GameInfo/PlayerStart/controller
classes. `artifacts/native-parity/research/native-location/` retains package and
binary hashes, scripts and live configuration observations. The additionally
copied Interface.u remains isolated research input, outside the main
143-file migration lock. Native files and protected INI remain unchanged. See
[NATIVE_WORLD.md](NATIVE_WORLD.md) for the source-backed PlayerStart10 candidate
and the remaining distinction from live pawn/camera verification.

The main section now selects `recipes/native-map-debug-location.json`: nine
sectors around PlayerStart10/Sector229 with **61 native model identities and
151 static placements**. The source-backed startup selection does not establish
the current live pawn or camera. Geometry, native transforms and the authored
reference Z remain separate from the sampled terrain support point.

The latest receipts, including exact NPC profiles and Power Strike source
dispatch, report **381 byte-identical products**, **26/26 cache hits**, zero clean
hits, **100 archives** (69 models, 29 textures, two audio assets) and **70 GLBs
with zero Khronos errors/warnings**. The pipeline suite passed **302 tests with
zero skips**. Evidence is
`artifacts/native-parity/migration/{reproducibility,validation}.json` and the
retained `migration-clean-1to9688v/` build. Frozen receipts, `pipeline-all.log`
and `preservation.json` are under
`artifacts/native-parity/editor/material-authoring-20261105/`. All **67 previous
model GLBs and terrain remain unchanged**; two impact models are added. Original
source inputs are preserved. Archive/manifest hashes can change with tool pins.
The earlier **315-product / 95-archive / 68-GLB** NPC checkpoint remains under
`migration-clean-4z5m6k_n/`; the preceding 297-product/25-job build remains under
`migration-clean-k77ohz4i/`. These are preservation/reproducibility results, not
native visual parity or a browser performance result.

## Authoritative fleet snapshot — 2026-11-05

The current closure has **143 files / 2,511,063,181 bytes**. It adds the exact
30,704,468-byte `system/Engine.dll`, SHA-256
`4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`, solely as
read-only dispatch evidence. Fresh IMPORTA-PC hash equality preceded the E:
candidate copy; protected INI checks passed before and after without copying it.
The receipt is
`artifacts/native-parity/source-audit/power-strike-engine-staging-20261105T151212Z.json`.
All 143 staged inputs passed local hash/length verification. No native binary
was loaded or executed.

The preceding **142-file / 2,480,358,713-byte** snapshot added
`system/npcname-e.dat`, 51,248 bytes, SHA-256
`84c79b73a97e489b455f44f21d8c8cba0f4df401ccb1d56887a1eacc62285b9a`.
Its 6,519 names join `npcgrp.dat` by exact ID; Greater Musveren is NPC 21622,
class `LineageMonster.field_stalker_20_bi`, scale 1.2, radius 18, height 36.
[NATIVE_NPC_PROFILES.md](NATIVE_NPC_PROFILES.md) records source staging and row
provenance. All 142 local staged inputs were rehashed at that checkpoint.

The preceding closure had **141 files / 2,480,307,465 bytes**. Its addition,
`system/LineageWarrior.int`, matched IMPORTA-PC and the local candidate byte for
byte before staging; all prior inputs were freshly rehashed. The protected INI
lock was updated to the already-observed Debug profile hash with its prior value
retained as history. The INI itself was neither copied nor modified. Evidence:
`artifacts/native-parity/research/weapon-attachment/animation-family-source-staging.json`.

The localization file supplies original MFighter weapon-family assignments. Original
encrypted/decoded bytes, pinned Engine.Pawn class evidence, exact clip references
and unresolved dispatch paths travel in the fighter archive. Its source sidecar
also retains native attachment arrays previously consumed but discarded. These
are preservation repairs; no weapon transform, animation rate or native combat
rule is inferred from them.

Power Strike's source association is now separately established by ten checked
Engine.dll byte anchors: `LineageEffect.s_u002_a` at init and
`LineageEffect.p_u004_a` conditionally at shot. Both directly extend
`Engine.Emitter`, author `AutoReplay=true`, and retain DrawScale **0.05** and
**0.02** respectively. The two exact actor definitions preserve **six emitters,
12 class definitions with inherited defaults and 17 converted assets**, with no unresolved
dependencies. The old `at_power_strike_cs` candidate remains historical; equal
init emitter payloads do not establish equal actor defaults or dispatch.
[NATIVE_POWER_STRIKE.md](NATIVE_POWER_STRIKE.md) records the source pins,
conditional lifetime/attachment evidence and remaining live timing, full motion
and Babylon particle-runtime gaps. No combat behavior is inferred from the
retained skill table's empty description or static hit-time field.

The current native reference is **IMPORTA-PC, `C:/Lineage2-client`**. The initial migration lock pinned 140 files / 2,480,113,923 bytes before the localization addition above; detailed fleet hashes and staging methods are under `artifacts/native-parity/source-audit/`. The existing E: copy was reused only after fresh authoritative hash equality. Protected `l2.ini` was hashed without copying; native files and the `lineagen` source workspace remain unchanged. [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md) describes reusable staging and extraction. These outputs remain local; this does not change the legacy island's provenance or establish native world parity.

The current native conversions also retain decoded source-weight records and
exact float influence slots in custom glTF attributes. Standard glTF attributes
are a portable derivative where format rules require it; the declared Babylon
adapter consumes the native slots without normalization. Provenance records the
selected serialized representation, alternate source streams and their measured
differences. The selection follows reviewed exporter behavior; the native
runtime's choice and rendered parity remain unverified.

StaticMesh materials now resolve through native object indices, including the
source package and group, instead of exporter short-name matching. Authored
slot order, repeated references, collision/shadow flags, null/omitted values and
raw bytes survive conversion. The earlier six-model `20_20` section has
**28 exact source material slots**. The empty `elf_ruin02` section is removed
without shifting material identities. Reports remain local under
`artifacts/native-parity/research/static-materials-*.json`; these source-backed
repairs do not establish native shader, terrain or gameplay equivalence.

The expanded section additionally preserves
`FX_E_S.Flameset.Default_Flame01` through an exact opt-in raw graph policy. Its
archive retains both original mesh sections, **23 raw graph nodes, nine class
definitions, 18 PNGs and 16 DDS derivatives** with original compressed blocks.
The graph includes authored objects and inherited Engine defaults; original
tags, export bytes, links and source hashes remain available. The original glow
format 8 payload is retained despite unsupported mip decoding, and inherited
P8 DDS remains an explicit gap.

This is **one model across 12 diagnostic placements**. The section manifest
lists their source IDs and the unimplemented billboard, texture-animation,
FadeColor, Combiner and Shader blending behavior. No graph is flattened and no
missing placement is silently dropped. Research and source/layout receipts are
under `artifacts/native-parity/research/world-debug-location/`; the resulting
archive and runtime manifest are in the main migration's section products.

The terrain texture recipe uses only the already pinned `T_texture.utx`,
`t_oren.utx` and `T_20_20.utx`: nine diffuse textures and nine masks. All 18
archives retain native identities and editable mip-0 PNGs. The channel audit
also records five exact Palette export payloads, original property tags and
source/export hashes. Case-insensitive native references are resolved uniquely;
both the actual `interlude:t_oren.*` IDs and original `T_oren.*` layer references
remain recorded. Palette-to-exporter equivalence and native mip/filter/blend
behavior remain unverified; the pinned original packages retain all mip data.
Evidence: `artifacts/native-parity/research/terrain-materials/TEXTURE_EXTRACTION.md`.

The later reviewed reader appends complete native exports, original mip payloads
and exact indexed Palette bytes to supported standalone texture packages.
The initial 24 supported textures preserve 135 authored mips. The subsequently
reviewed Engine licensee30 prefix extends this to all 26 requested textures and
141 mips, with the original 24 sidecars and payloads unchanged. Source hashes,
unwrapped offsets, native defaults and
palette alpha remain recorded. No mip is regenerated. The selected P8 terrain
mask's native palette expansion matches its decoded PNG exactly; this does not
settle native filtering or blending. See `TEXTURE_MIP_READER.md` beside the
extraction report for the pinned source layout and tests.

Twenty-three DXT1 textures additionally have deterministic DDS containers with
the original compressed blocks; P8 indices/palettes are retained without lossy
compression. No new compressor or downloaded tool is used. The native section's
layer metadata now includes the exact authored mask-transform tags and serialized
bytes, preserving source map/object identities. [NATIVE_TEXTURES.md](NATIVE_TEXTURES.md)
and the local `research/world-conversion-review/` report describe these bounded
source-preservation additions and unresolved runtime semantics.

## Native Interlude pipeline — 2026-11-04

The user selected `E:/Lineage2-client` as the source of truth for new assets. [NATIVE_CLIENT_AUDIT.md](NATIVE_CLIENT_AUDIT.md) records its modified Interlude identity and complete source hash inventory. [ASSET_PIPELINE.md](ASSET_PIPELINE.md) describes the new local converters, pinned exporter and dependency receipts. Conversion outputs, native audio, extracted metadata and captures remain under ignored `artifacts/`; the original installation remains read-only. Existing Classic/Unity world and character assets keep their separate provenance. Historical foundation statements below do not describe these later local conversions.

## Local world integration — 2026-11-04

The later world task explicitly reuses the audited local `C:/laragon/www/lineagen/terrain-previews/` surface, grass, visibility, foliage and collider policies in `src/scene/world/`. Hash-pinned world binaries/manifests are staged separately under ignored `public/assets/world/`. [WORLD_ASSETS.md](WORLD_ASSETS.md) records exact inputs, runtime changes and remaining limits. Source services, networking and converters were not run or modified. The historical no-copied-source statement below applies to the published foundation, not this local world integration; no additional redistribution grant is asserted.

## Foundation source-review outcome

This section records the provenance decision for the published procedural foundation. The later local asset inventory below is a separate technical investigation; the original Git-tree inspection did not establish that local converted binaries were absent or incorrectly converted.

The Phase 1 implementation reviewed all seven requested rendering files in
[`logingrupa/linegen`](https://github.com/logingrupa/linegen) at commit
[`05296faf6cba7bf0bb0840349dc38e669d8b532d`](https://github.com/logingrupa/linegen/tree/05296faf6cba7bf0bb0840349dc38e669d8b532d).
The review was performed on 2026-11-04 using read-only Git object inspection
and GitHub repository metadata. The existing local checkout had a different
working revision, so every source read explicitly selected the commit above.
No source working files were changed, and no source application, server, lab,
database, asset conversion, build or deployment commands were run.

**No redistribution license was found for `linegen`.** At the inspected
revision:

- The tracked tree contained no `LICENSE`, `LICENCE`, `COPYING` or `NOTICE` file.
- None of the seven files contained a license or permission header.
- `package.json` declared `private: true` and supplied no license field.
- GitHub's repository metadata reported `visibility: private` and `license: null`.
- The reviewed README, repository documentation and character documentation
  did not grant source or asset redistribution rights.

Access to a repository and permission to inspect it do not establish a public
redistribution grant. The task explicitly allows independent replacements
when reuse is not permitted. Accordingly, **the published procedural foundation
contains no copied `linegen` source, models, textures, animation clips or source
manifests**. Its implementation was used for behavioral review and
pitfall identification; Phase 1 implements the requested behaviors
independently with Babylon.js public APIs. These replacements must not be
described as licensed source adaptations or a clean-room implementation.

## Subsequent local asset inventory

The user identified `C:\laragon\www\lineagen` as the workspace used by a separate session with conversion tooling. Read-only filesystem and GLB-structure inspection on 2026-11-04 confirmed these files in `.assets\converted\`:

| File | Bytes | Animation clips |
| --- | ---: | ---: |
| `MFighter.glb` | 16,393,204 | 121 |
| `FFighter.glb` | 17,366,848 | 123 |
| `MMagic.glb` | 16,565,352 | 114 |
| `FMagic.glb` | 15,377,048 | 109 |

Each parsed as GLB v2 with seven meshes, one skin and seven embedded images. Matching `.blend` files, per-model manifests and `manifest.json` also exist. The workspace contains offline tools in `.assets\conversion\` and prior reports/captures in `.assets\evidence\`. No model was copied or rendered in this destination during this inventory, and no converter or source application was run.

All four models contain `wait_Hand`, `run_Hand` and `Atk01_Hand`. The subsequent local integration adds exact presentation-profile mappings for these names, using the native looping idle/run and one-shot attack semantics. Generic aliases remain only for ad-hoc URL fixtures. Structural validity and prior source reports do not by themselves verify destination appearance, skin deformation, transitions or mobile performance.

For the follow-up, **usable** means technically converted correctly and working in the destination browser client. Missing publication-license metadata does not establish a technical conversion defect. `pnpm assets:stage` copies the four existing GLBs unchanged into ignored `public/assets/characters/` for baseline inspection. After measured grounding defects were confirmed, the current integration stages corrected destination-only copies with `pnpm assets:stage artifacts/asset-integration/repair/converted`. These local binaries and captures are not part of the tracked or published foundation.

The repair reuses a destination copy of `apply_grounding.py` to change seven native `bip01` translation channels and the corresponding copied Blender location curves. It does not reconvert meshes, rebuild rigs or rebake other animation channels. Original BIN data, hierarchy, materials and textures are preserved, with the new root samples appended. No source files or tools were modified, and no source application/service or conversion pipeline was started. Blender ran offline with output, configuration, temporary files and logs directed to destination scratch space. Before/after hashes, tool refinements and preservation checks are recorded in [ASSET_AUDIT.md](ASSET_AUDIT.md).

The reused offline validator freshly passed both the source-original and repaired four-file sets and all 467 clips on 2026-11-04. [ASSET_AUDIT.md](ASSET_AUDIT.md) records hashes, native hierarchy/materials, prior conversion policies and actual destination evidence separately. [ROADMAP.md](ROADMAP.md) preserves the follow-up boundaries and planned Phase 2. The runtime retains each supplied seven-part rig rather than copying the source application's loader or animation implementation.

## Seven-file inventory — foundation decisions

All source paths below are relative to `linegen` at the pinned revision.
Destination paths identify responsibilities in this repository. These are the
original procedural-foundation reuse decisions, not a claim that the later
local integration uses no native asset identifiers. The asset follow-up adds
profile mappings based on the inspected files while retaining independently
implemented client code.

| Inspected source | Behavior and coupling observed | Decision and destination |
| --- | --- | --- |
| `src/browser/positionInterpolator.ts` | Bounded timestamped position history, delayed interpolation, distance snapping, angular interpolation and an adaptive server playout clock. | **Independent replacement** in `src/interpolation/`. Preserve smooth presentation and explicit teleport handling as requirements; use a deterministic local timeline. Do not carry over source code, its adaptive network clock or server-time assumptions. |
| `src/browser/entityLabels.ts` | DOM names and health bars projected through the active camera; content updates, clipping and removal keyed by entity identifier. | **Independent replacement** in `src/ui/`. Use Babylon.js projection APIs and ordinary DOM elements, clamp health display and remove labels with entity visuals. Source classes, styles and identifiers are not copied. |
| `src/browser/playerCharacters.ts` | Scene-local asynchronous GLB caching, per-character model/animation instances, pose roots, one-shot presentation and disposal. Coupled to source character manifests, class/skill definitions and playback settings. | **Independent replacement** in `src/assets/`, `src/entities/` and `src/animation/`. Use procedural animated characters by default and a recoverable model-load boundary. Avoid source manifests, proprietary rigs and class/skill mappings. Handle late loads after entity removal and scene disposal. |
| `src/browser/characterAnimationMap.ts` | Manifest-specific clip selection for four character variants, weapons, classes, skills, casting and lifecycle actions. | **Independent replacement** in `src/animation/`. Restrict the Phase 1 contract to idle, run and attack; implement procedural poses and explicit state transitions. No source clip names, class rules or combat timing policy is needed. |
| `src/browser/arenaView.ts` | A large view combines camera, lights, generated arena geometry, snapshot reconciliation, interpolated entities, model loading, labels, effects and diagnostics. It also contains prediction, collision, server clocks, skill lookups and replicated gameplay dependencies. | **Independent replacement**, split among `src/engine/`, `src/scene/`, `src/camera/`, `src/entities/`, `src/ui/` and `src/world/`. Static content belongs to Editor resources; dynamic changes arrive through `GameWorldAdapter`. No arena layout, collision code, predicted dash, server clock, source snapshot types or simulation is ported. |
| `src/browser/combatEffects.ts` | Pooled cosmetic beams, projectiles and floating text driven by combat events, without computing authoritative outcomes itself. | **Not needed as a subsystem.** The synthetic attack animation provides cosmetic feedback in `src/animation/`. Do not import damage/heal events, projectile logic, combat arithmetic or a pooled combat-effects framework for this scope. |
| `src/browser/domHelpers.ts` | DOM construction, text caching and formatting mixed with source class/skill/item lookups and specialized touch combat-button handling. | **Independent replacement** using local DOM construction in `src/ui/`. Use `textContent` for entity names and native button behavior. Do not retain source game lookups, HTML-generating health helpers or combat input conventions. |

## Refactoring and dependency boundary

Because the source has no identified redistribution grant, there is no copied
implementation to rename mechanically. New project-owned names use clear
English instead of the source's Hungarian prefixes. Babylon.js API names and
the native Editor's serialized contracts retain their required spelling.

The new world boundary carries stable identifiers, explicit entity state and
typed lifecycle events. Rendering does not import `MockWorldAdapter` directly.
Synthetic movement and action-state changes are adapter responsibilities;
interpolation, targeting and animation playback are presentation concerns.

The source's SpacetimeDB bindings, Evenfall data model, shared simulation,
session epochs, server clock synchronization, progression, loot, classes,
skills, predicted dashes, collision rules, projectiles and lab bootstrap are
excluded. A later Interlude adapter can supply the same view contract without
bringing those systems into Phase 1.

## Assets, licensing and attribution

The inspected source's character documentation describes converted external
character GLBs and hundreds of supplied clips, but provides no redistribution
license for those inputs. The inspected tracked revision does not itself include the
required character binaries; the later local inventory above confirms converted binaries outside that tracked tree. No original Lineage II maps, characters,
textures, audio or converted binaries are committed or published by this task.
Local staging is separate from that tracked source distribution.

The foundation's procedural characters and environment are project assets.
The asset follow-up uses local external player models with that separate provenance.
Loading a model is a runtime capability, not a grant to redistribute that
model: any subsequently committed external model needs its own documented
license and attribution.

`linegen` is acknowledged above as an inspected behavioral reference. There
are no copied `linegen` copyright notices to preserve because no code or
assets from it are redistributed. Babylon.js and the official Editor template
are separate upstream dependencies; their actual upstream notices must remain
with the template and any retained template assets. This document does not
grant a new license to either upstream project.

The foundation starts from the official **Babylon.js Editor v5.5.3 Vanilla template**, revision `e3fce2cea68c6a32fdbacbb4c5aa4e6a0f154db7`, at `templates/vanillajs/`. Its Apache-2.0 license is retained in `LICENSE` and `docs/licenses/BabylonJS-Editor.txt`; changes are identified in `NOTICE`. Native entry names, project metadata, scene directory conventions, Vite and the official packer/loader remain. Package management, strict checking, application lifecycle and the example scene were changed; sample bitmap assets, example box behavior and unnecessary physics initialization were removed.

`tests/unit/editorScript.test.ts` adapts the official Editor compiler settings and import-replacement rules from `editor/src/tools/compile.ts` at the same release under Apache-2.0. This permits a real compiler regression check without claiming a desktop Editor session.

Cormorant Garamond is self-hosted through `@fontsource-variable/cormorant-garamond@5.3.0`, under SIL Open Font License 1.1; its copyright and license are retained in `docs/licenses/Cormorant-Garamond.txt`. Babylon.js's Apache-2.0 notice is retained in `docs/licenses/BabylonJS.txt`. UI icons, synthetic GLB test fixtures, procedural character geometry and native environment geometry are original project assets. Locally staged converted character geometry has the separate provenance above. The user-supplied UI screenshot is a visual reference only; its pixels and proprietary artwork are not shipped.
