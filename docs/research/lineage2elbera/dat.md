# DAT tool investigation

Inspected upstream commit `12c9656e2f053b233ec3fd87056491a6a6da8b0c`, including `AGENTS.md` and `LICENSE`. Paths beginning `tools/` refer to upstream; `scripts/` refers to this client. Authored tools are MIT; upstream `LICENSE:29` explicitly excludes NCSoft game data and separately licensed dependencies. Existing BSP reuse already pins this commit (`scripts/vendor/lineage2elbera_bsp/SOURCE.json:3`).

## Complete inventory: 42 files

- Binary/table readers: `l2dat.py`, `extract_gamedata.py`, `extract_charcreate.py`, `parse_chargrp.py`, `parse_skillsoundgrp.py`, `export_quests.py`.
- Appearance/scale: `build_appearance.py`, `build_hair.py`, `export_npc_materials.py`, `export_npc_visuals.py`, `export_player_visuals.py`, `audit_player_transforms.py`, `audit_player_bounds.mjs`.
- Effects: `build_skillanim.py`, `build_skillfx.py`, `build_skillmesh.py`, `build_skillvfx.py`, `dump_emitter_classes.py`, `parse_skillfx.py`, `skill_bindings.py`, `export_markprojector.py`.
- Metadata/equipment/server joins: `build_meta.py`, `build_itemtip.py`, `build_sysmsg_paramtypes.py`, `export_dropmesh.py`, `export_weaponmesh.py`, `export_playerlevels.py`, `export_shots.py`, `export_skillclass.py`, `export_skilltypes.py`, `export_skillweapons.py`.
- Tests: `test_build_appearance.py`, `test_build_appearance.mjs`, `test_build_hair.py`, `test_build_hair.mjs`, `test_export_npc_materials.py`, `test_export_npc_visuals.py`, `test_export_quests.py`, `test_player_visuals.py`, `test_skill_actions.py`, `test_skill_bindings.py`, `test_skilltext.py`.

All names were inventoried and headers sampled; strongest implementations were read more deeply. This directory mixes reusable functions with repository-specific builders, rather than offering one portable DAT library.

## Candidates and limits

**Adapt first: quest decoding.** `tools/dat/export_quests.py:59` parses quest journal records with bounded lists, checked terminators, unique ID/stage keys, complete consumption, per-record offsets/hashes, and raw float bits for nonfinite coordinates. Its `build` function retains encrypted/decrypted provenance (`:99`). This adds a table absent from local `scripts/native_catalog/tables.py:30`. The parser is standard-library Python; its CLI calls upstream `tools/bin/l2encdec` and assumes `assets/interlude/system` (`tools/dat/extract_gamedata.py:37`). Adapt its input/output boundary to existing `decode413`, hashing and immutable receipts, retaining unresolved fields rather than inventing quest rules.

**Reuse directly as a helper candidate: `skill_bindings.build_bindings`.** It preserves exact available levels, empty bindings and qualified paths while rejecting duplicate identities (`tools/dat/skill_bindings.py:22`). Its source-loading wrapper is separately tied to one encrypted file hash (`:8`). Local `scripts/native_catalog/effects.py:311` already selects exact levels and qualified visual objects; this is useful for bulk index compression, not a missing fundamental resolver. Do not copy the complete effect pipeline: `tools/dat/build_skillvfx.py:526` retains name heuristics as diagnostics, while `build_skillanim.py:60` contains distinct sound duplicate/fallback policy requiring separate native verification.

**Adapt as independent checks: visual scale and hair.** `tools/dat/export_npc_visuals.py:150` resolves inherited scale with field owners, rejecting missing parents/cycles. `export_player_visuals.py:47` preserves Float32 multiplication order but applies upstream's native-X/Z/Y axis mapping. Local `scripts/native_actor_profiles.py:152` already preserves actor scale separately from mesh conversion; blindly attaching the upstream root scale risks double application. `tools/dat/build_hair.py:194` bounds version-5 skeletal streams for UE123/licensee28 or 30; `:450` compares source triangles/UVs/skinning to glTF. These are differential-audit candidates alongside existing `scripts/native_catalog/skeletal.py`, not reasons to replace conversion.

**Reference/defer:** NPC material export activates only particular ghost/gold-pig/Angel shapes (`tools/dat/export_npc_materials.py:26`, `:41`, `:58`). Appearance builders require private models, sibling native verifiers/Capstone and sometimes Pillow; Node audits import upstream Three.js (`audit_player_bounds.mjs:8`). Server-derived skills/levels/system-message metadata requires aCis and cannot establish official client gameplay. Generic `l2dat.Reader` also accepts negative Unicode lengths as empty and strips unchecked ASCF terminators (`tools/dat/l2dat.py:64`); retain the stricter local reader.

## Small proof and actual execution

Smallest integration: adapter around quest `parse/build`, with malformed/truncated synthetic records and private byte-level comparison against the selected encrypted source. Acceptance requires identical records, offsets, hashes and trailer consumption through the local receipt system. Rendering and quest runtime behavior require separate evidence.

Executed `python -B -m unittest discover -s tools/dat -p NAME` for `test_export_quests.py`, `test_skill_bindings.py`, and `test_export_npc_visuals.py`: respectively **5/4/4 passed**, **1/1/2 skipped** because private originals/exports were absent. No native binaries, dependency installs, private conversions or browser checks ran. These tests establish synthetic parser/inheritance behavior, not native-data equality or rendered parity.
