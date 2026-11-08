# Source review and provenance

This doc records where code and data come from and under which licence. `NOTICE` points here. Status and work order live in [.planning/STATE.md](../.planning/STATE.md) and [.planning/ROADMAP.md](../.planning/ROADMAP.md).

## Native reference client

The native reference is **IMPORTA-PC, `C:/Lineage2-client`**, a modified third-party Interlude client (Engine.dll SHA-256 `4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`). All L2.exe comparisons run there (DEC-OWN-2). DATABASE-PC `E:/Lineage2-client` is a conversion source only after a one-time full-tree hash lock proves it equal to IMPORTA-PC. That lock is done before stage A conversion starts (FOUND-03). [NATIVE_CLIENT_AUDIT.md](NATIVE_CLIENT_AUDIT.md) records the client identity and source formats.

The current migration closure has **143 files / 2,511,063,181 bytes**. A file is copied from the E: candidate only after a fresh hash match with IMPORTA-PC, and all 143 pass local hash and length checks. `system/Engine.dll` (30,704,468 bytes) is in the closure only as read-only dispatch evidence; no native binary is loaded or executed. Protected `l2.ini` is hashed and never copied or modified. Receipts are under `artifacts/native-parity/source-audit/`, including `artifacts/native-parity/source-audit/power-strike-engine-staging-20261105T151212Z.json`. [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md) describes staging, recipes and outputs.

Native files stay read-only. Conversion outputs, native audio, extracted metadata and captures stay under ignored `artifacts/` and `public/l2/`. Outputs are `.l2asset` packages plus the runtime catalog; `recipes/native-inputs.lock.json` describes inputs only (DEC-OWN-5).

## Lineage2Elbera

Lineage2Elbera is a source of reusable decoders and conversion code under the MIT licence. The reference clone is pinned at commit `12c9656e2f053b233ec3fd87056491a6a6da8b0c`. The [reuse audit](LINEAGE2ELBERA_REUSE_AUDIT.md) compares its 22 tool entries with this client's implementations; consult it before adding another decoder or exporter. Prefer selected upstream functions and fixtures with minimal adapters, retained MIT notices and source hashes, and document incompatible assumptions. For `.dat` tables the local hash-pinned descriptor is authoritative where it covers a table, and Elbera fills gaps behind an adapter (DEC-OWN-4).

Selected Elbera BSP reader functions are vendored under `scripts/vendor/lineage2elbera_bsp`, pinned at the same commit, with source hashes and the MIT licence retained. [NATIVE_BSP_FLOOR.md](NATIVE_BSP_FLOOR.md) describes what they convert.

Elbera's three.js runtime, its native verifiers pinned to Engine.dll `07b24af4...`, `elbera-acis.patch` and its deviceId auto login are not reused.

## Lineagen-adapted world code

Five modules under `src/scene/world/` adapt the audited local `C:/laragon/www/lineagen/terrain-previews/` implementations: surfaces, grass, visibility, foliage cutout and collider policy. `pnpm world:stage` copies hash-pinned lineagen world binaries and manifests into ignored `public/assets/world/`; `pnpm build` never ships them. The source workspace is read only. No redistribution grant is asserted for this code or data. [WORLD_ASSETS.md](WORLD_ASSETS.md) records what each module adapts and the open owner review against DEC-SRC-1.

## Foundation source review

The procedural foundation reviewed all seven requested rendering files in
[`logingrupa/linegen`](https://github.com/logingrupa/linegen) at commit
[`05296faf6cba7bf0bb0840349dc38e669d8b532d`](https://github.com/logingrupa/linegen/tree/05296faf6cba7bf0bb0840349dc38e669d8b532d).
The review on 2026-11-04 used read-only Git object inspection and GitHub
repository metadata. Every source read selected the commit above explicitly. No
source working files were changed, and no source application, server, lab,
database, conversion, build or deployment command was run.

**No redistribution licence was found for `linegen`.** At the inspected revision:

- The tracked tree contained no `LICENSE`, `LICENCE`, `COPYING` or `NOTICE` file.
- None of the seven files contained a licence or permission header.
- `package.json` declared `private: true` and had no license field.
- GitHub's repository metadata reported `visibility: private` and `license: null`.
- The README, repository documentation and character documentation did not grant
  source or asset redistribution rights.

Access to a repository does not establish a redistribution grant. Therefore
**the published procedural foundation contains no copied `linegen` source,
models, textures, animation clips or source manifests** (DEC-SRC-1). Its code
served for behavioural review and pitfall identification. The foundation
implements the requested behaviours independently with Babylon.js public APIs.
Do not describe these replacements as licensed source adaptations or as a
clean-room implementation.

## Seven-file inventory

Source paths are relative to `linegen` at the pinned revision. Destination paths are responsibilities in this repository.

| Inspected source | Behaviour and coupling observed | Decision and destination |
| --- | --- | --- |
| `src/browser/positionInterpolator.ts` | Bounded timestamped position history, delayed interpolation, distance snapping, angular interpolation and an adaptive server playout clock. | **Independent replacement** in `src/interpolation/`. Keep smooth presentation and explicit teleport handling as requirements; use a deterministic local timeline. Do not carry over source code, its adaptive network clock or server-time assumptions. |
| `src/browser/entityLabels.ts` | DOM names and health bars projected through the active camera; content updates, clipping and removal keyed by entity identifier. | **Independent replacement** in `src/ui/`. Use Babylon.js projection APIs and ordinary DOM elements, clamp health display and remove labels with entity visuals. Source classes, styles and identifiers are not copied. |
| `src/browser/playerCharacters.ts` | Scene-local asynchronous GLB caching, per-character model and animation instances, pose roots, one-shot presentation and disposal. Coupled to source character manifests, class and skill definitions and playback settings. | **Independent replacement** in `src/assets/`, `src/entities/` and `src/animation/`. Use a recoverable model-load boundary. Avoid source manifests, proprietary rigs and class or skill mappings. Handle late loads after entity removal and scene disposal. |
| `src/browser/characterAnimationMap.ts` | Manifest-specific clip selection for four character variants, weapons, classes, skills, casting and lifecycle actions. | **Independent replacement** in `src/animation/`. Implement explicit state transitions. No source clip names, class rules or combat timing policy is used. |
| `src/browser/arenaView.ts` | One large view combines camera, lights, generated arena geometry, snapshot reconciliation, interpolated entities, model loading, labels, effects and diagnostics, plus prediction, collision, server clocks, skill lookups and replicated gameplay dependencies. | **Independent replacement**, split among `src/engine/`, `src/scene/`, `src/camera/`, `src/entities/`, `src/ui/` and `src/world/`. Static world content comes from the converter and the `.l2asset` catalog; dynamic changes arrive through `GameWorldAdapter`. No arena layout, collision code, predicted dash, server clock, source snapshot types or simulation is ported. |
| `src/browser/combatEffects.ts` | Pooled cosmetic beams, projectiles and floating text driven by combat events, without computing authoritative outcomes. | **Not needed as a subsystem.** Do not import damage or heal events, projectile logic, combat arithmetic or a pooled combat-effects framework. |
| `src/browser/domHelpers.ts` | DOM construction, text caching and formatting mixed with source class, skill and item lookups and specialized touch combat-button handling. | **Independent replacement** using local DOM construction in `src/ui/`. Use `textContent` for entity names and native button behaviour. Do not keep source game lookups, HTML-generating health helpers or combat input conventions. |

## Refactoring and dependency boundary

With no identified redistribution grant, there is no copied implementation to rename. Project-owned names use clear English instead of the source's Hungarian prefixes. Babylon.js API names keep their required spelling.

The world boundary carries stable identifiers, explicit entity state and typed lifecycle events. Rendering does not import `MockWorldAdapter` directly. Synthetic movement and action-state changes are adapter responsibilities; interpolation, targeting and animation playback are presentation concerns.

The source's SpacetimeDB bindings, Evenfall data model, shared simulation, session epochs, server clock synchronization, progression, loot, classes, skills, predicted dashes, collision rules, projectiles and lab bootstrap are excluded. A later server adapter supplies the same view contract without bringing those systems in.

## Assets, licensing and attribution

No original Lineage II maps, characters, textures, audio or converted binaries are committed or published. Local staging is separate from the tracked source distribution. Loading a model is a runtime capability, not a grant to redistribute that model. Any committed external model needs its own documented licence and attribution.

The inspected `linegen` character documentation describes converted external character GLBs and hundreds of clips, but gives no redistribution licence for them. The client's player models are the native Interlude Human exports staged by `pnpm assets:stage` (`scripts/stage_native_players.py`) into ignored `public/l2/`; no lineagen GLB is used. `pnpm build` excludes `public/assets/characters/` and `public/assets/world/`.

`linegen` is acknowledged as an inspected behavioural reference. There are no copied `linegen` copyright notices to preserve, because no code or assets from it are redistributed. Babylon.js and the Editor template are separate upstream dependencies; their upstream notices stay with the template and any retained template assets. This doc grants no new licence to either.

The foundation starts from the official **Babylon.js Editor v5.5.3 Vanilla template**, revision `e3fce2cea68c6a32fdbacbb4c5aa4e6a0f154db7`, at `templates/vanillajs/`. Its Apache-2.0 licence is retained in `LICENSE` and `docs/licenses/BabylonJS-Editor.txt`; changes are identified in `NOTICE`. Native entry names, project metadata, scene directory conventions, Vite and the official packer and loader remain. Package management, strict checking, application lifecycle and the example scene are changed; sample bitmap assets, example box behaviour and unneeded physics initialization are removed. The Editor itself is an optional viewer (DEC-OWN-8, [EDITOR_VIEWER.md](EDITOR_VIEWER.md)); the template provenance stays true either way.

`tests/editor/editorScript.test.ts` adapts the official Editor compiler settings and import-replacement rules from `editor/src/tools/compile.ts` at the same release under Apache-2.0.

Cormorant Garamond is self-hosted through `@fontsource-variable/cormorant-garamond@5.3.0` under SIL Open Font License 1.1; its copyright and licence are in `docs/licenses/Cormorant-Garamond.txt`. Babylon.js's Apache-2.0 notice is in `docs/licenses/BabylonJS.txt`. UI icons, synthetic GLB test fixtures, procedural character geometry and the procedural environment geometry are original project assets. The user-supplied UI screenshot is a visual reference only; its pixels and proprietary artwork are not shipped.
