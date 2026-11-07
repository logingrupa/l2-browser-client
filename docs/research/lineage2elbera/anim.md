# Animation tools investigation

Inspected upstream commit `12c9656e2f053b233ec3fd87056491a6a6da8b0c`. Paths under `tools/anim` refer to `C:/laragon/www/Lineage2Elbera-reference`; `scripts/` and `src/` paths refer to this client. Read upstream `AGENTS.md` and `LICENSE`: authored tools are MIT, with attribution required; the license explicitly excludes original game assets and separately licensed bundled components.

## Inventory and purpose

The complete tracked inventory contains 23 files: `.gitignore` plus 22 tool,
inspection and regression files in four groups:

- Source extraction and transport: `build_pawnanim.py`, `export_source_tracks.py`, `pack_source_tracks.py`, `npc_source_tracks.py`, `build_npc_variants.py`, `creature_anim_table.py`.
- Conversion and binding diagnostics: `recover_pawn_clips.py`, `resolve_bindings.py`, `export_psa.sh`, `rebuild_one.py`, `audit_bindings.py`, `audit_castanim.py`.
- Focused verification/inspection: `check_cast_loop_inputs.py`, `check_sitting_native.py`, `check_sitting_sound_refs.py`, `compare.html`.
- Regression files: `test_build_npc_variants.py`, `test_cast_loop_inputs.py`, `test_export_source_tracks.py`, `test_pawnanim_source.py`, `test_recover_pawn_clips.py`, `test_sitting_sound_refs.py`.

The strongest component is the bounded MeshAnimation decoder, `build_pawnanim.py:179`: it accepts UE123/licensee28 or30, traverses declared movement/export boundaries, and optionally retains sparse keys, root tracks, hashes and ordered notifications. `export_source_tracks.py:29` produces fingerprinted catalogs; its default audits without writing, while `:145` exposes explicit write/check/runtime modes. `pack_source_tracks.py:99` packs exact finite Float32 components into authored ELBA transport, not a native format or playback implementation.

NPC recovery follows qualified class inheritance per array element (`build_npc_variants.py:49`), reads the mesh's serialized animation reference (`:165`), and distinguishes missing/empty/None/resolved selectors (`:219`). These are more useful than the older UModel-log cache in `resolve_bindings.py:44`. `npc_source_tracks.py:135` verifies built geometry correspondence; optional stored GPU influence lanes are expressly not a native skinning proof.

## Dependencies and limits

These are predominantly repository pipelines, using `l2lib`, character assembly, DAT/class readers, private UKX/INT/UAX files, and generated manifests. Recovery and PSA export invoke UModel; localized-table recovery invokes `tools/bin/l2encdec`. Paths assume upstream's `assets/interlude` and `editor/characters` layout. The pure packer is portable Python, but its format has no local Babylon consumer. `check_sitting_native.py:42` statically examines a pinned Engine DLL through shared inspection helpers; it is not an executable gameplay test. `compare.html:18` requires upstream Three.js/vendor URLs and generated models, and `:76` normalizes height, making it unsuitable as a scale-fidelity reference. `rebuild_one.py:49` adds guessed clip candidates for an old diagnostic scenario; do not promote that into selection policy.

## Local overlap and recommendation

Local `scripts/native_assets_lib/animation.py:29` already decodes sparse tracks and `:77` emits original timing plus movement metadata; `scripts/native_catalog/skeletal.py:181` already reads the mesh animation reference. `scripts/native_animation_families.py:157` preserves localization/getter evidence, with reference resolution at `:223`. Existing upstream BSP reuse is pinned separately in `scripts/vendor/lineage2elbera_bsp/SOURCE.json`.

**Adapt** the qualified NPC inheritance/selector routines into an evidence adapter around those existing readers. **Reference only** for most converters and inspectors; **defer** ELBA runtime transport. Directly reuse selected synthetic fixtures when adding an independent comparison, retaining MIT attribution.

A substantive disagreement deserves investigation first: upstream `export_source_tracks.py:108` and `pack_source_tracks.py:61` use first matching bone-name links, whereas local `animation.py:48` uses parent/name matching and repairs duplicate Fighter finger names. Neither policy should be substituted solely because it looks plausible. There is also a decoder-domain difference: upstream `build_pawnanim.py:220` permits equal adjacent times but requires time arrays for ordinary tracks; local `animation.py:20` rejects equal times while `:88` supports implicit timing. Broad directory copying would obscure these differences.

## Smallest useful proof and actual execution

Build one read-only comparison receipt for a pinned Fighter animation plus duplicate-name and implicit/equal-time synthetic cases. Acceptance: identical retained source keys, notification ordering, timing and hashes for mutually supported inputs; explicit rejection differences; separately reported bone mappings. Resolve mapping against independently inspected native linkup evidence before runtime changes. Record equality cannot establish interpolation arithmetic, rendered poses, or integrated dispatch; local `src/animation/ModelAnimator.ts:20` currently selects only idle/run/attack.

Executed `python -B -m unittest test_pawnanim_source.SyntheticSourceTests test_sitting_sound_refs` from upstream `tools/anim`: **18 tests passed**. Other conclusions are source inspection. No private-fixture checks, native binaries, browser/server runs, installs or asset writes were performed; private packages/generated fixtures remain prerequisites for the proposed comparison.
