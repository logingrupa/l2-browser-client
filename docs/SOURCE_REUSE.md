# Source review and provenance

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
when reuse is not permitted. Accordingly, **no `linegen` source, models,
textures, animation clips, source manifests or other assets are copied into
this repository**. Its implementation was used for behavioral review and
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

All four models contain `wait_Hand`, `run_Hand` and `Atk01_Hand`; the destination's current generic aliases do not recognize those names. Add explicit mapping and inspect actual playback before classifying a conversion as faulty. Structural validity and prior source reports do not verify destination appearance, skin deformation, transitions or mobile performance.

For the follow-up, **usable** means technically converted correctly and working in the destination browser client. Missing publication-license metadata does not establish a technical conversion defect. Keep provenance findings and local technical results distinct. [ROADMAP.md](ROADMAP.md) records the follow-up boundaries and Phase 2; the [handoff prompt](../.planning/asset-integration-prompt.md) gives the actual folders and tooling cautions.

## Seven-file inventory

All source paths below are relative to `linegen` at the pinned revision.
Destination paths identify responsibilities in this repository.

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
textures, audio or converted assets are included here.

The Phase 1 characters and environment are procedural project assets. Loading
an optional model is a runtime capability, not a grant to redistribute that
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

Cormorant Garamond is self-hosted through `@fontsource-variable/cormorant-garamond@5.3.0`, under SIL Open Font License 1.1; its copyright and license are retained in `docs/licenses/Cormorant-Garamond.txt`. Babylon.js's Apache-2.0 notice is retained in `docs/licenses/BabylonJS.txt`. UI icons, synthetic GLB test fixtures, character geometry and native environment geometry are original project assets. The user-supplied UI screenshot is a visual reference only; its pixels and proprietary artwork are not shipped.
