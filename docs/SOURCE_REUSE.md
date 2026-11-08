# Source review and provenance

## Source-reuse rule

No source or assets are copied from other workspaces or from projects without a redistribution license. The Phase 1 review of an earlier rendering repository found no such license, so it served only as a behavioral reference. No code, models, textures, animation clips or manifests from that earlier repository are in the published foundation; Phase 1 implements the behaviors independently with Babylon.js public APIs.

## Refactoring and dependency boundary

Because that repository has no identified redistribution grant, there is no
copied implementation to rename mechanically. New project-owned names use clear
English instead of its Hungarian prefixes. Babylon.js API names and
the native Editor's serialized contracts retain their required spelling.

The new world boundary carries stable identifiers, explicit entity state and
typed lifecycle events. Rendering does not import `MockWorldAdapter` directly.
Synthetic movement and action-state changes are adapter responsibilities;
interpolation, targeting and animation playback are presentation concerns.

That repository's SpacetimeDB bindings, Evenfall data model, shared simulation,
session epochs, server clock synchronization, progression, loot, classes,
skills, predicted dashes, collision rules, projectiles and lab bootstrap are
excluded. A later Interlude adapter can supply the same view contract without
bringing those systems into Phase 1.

## Assets, licensing and attribution

The character documentation of that repository describes converted external
character GLBs and hundreds of supplied clips, but provides no redistribution
license for those inputs. No original Lineage II maps, characters, textures,
audio or converted assets are included here.

The Phase 1 characters and environment are procedural project assets. Loading
an optional model is a runtime capability, not a grant to redistribute that
model: any subsequently committed external model needs its own documented
license and attribution.

That repository has no copyright notices to preserve here because no code or
assets from it are redistributed. Babylon.js and the official Editor template
are separate upstream dependencies; their actual upstream notices must remain
with the template and any retained template assets. This document does not
grant a new license to either upstream project.

The foundation starts from the official **Babylon.js Editor v5.5.3 Vanilla template**, revision `e3fce2cea68c6a32fdbacbb4c5aa4e6a0f154db7`, at `templates/vanillajs/`. Its Apache-2.0 license is retained in `LICENSE` and `docs/licenses/BabylonJS-Editor.txt`; changes are identified in `NOTICE`. Native entry names, project metadata, scene directory conventions, Vite and the official packer/loader remain. Package management, strict checking, application lifecycle and the example scene were changed; sample bitmap assets, example box behavior and unnecessary physics initialization were removed.

`tests/unit/editorScript.test.ts` adapts the official Editor compiler settings and import-replacement rules from `editor/src/tools/compile.ts` at the same release under Apache-2.0. This permits a real compiler regression check without claiming a desktop Editor session.

Cormorant Garamond is self-hosted through `@fontsource-variable/cormorant-garamond@5.3.0`, under SIL Open Font License 1.1; its copyright and license are retained in `docs/licenses/Cormorant-Garamond.txt`. Babylon.js's Apache-2.0 notice is retained in `docs/licenses/BabylonJS.txt`. UI icons, synthetic GLB test fixtures, character geometry and native environment geometry are original project assets. The user-supplied UI screenshot is a visual reference only; its pixels and proprietary artwork are not shipped.
