---
phase: 02-stage-a-breadth
plan: 98
subsystem: world
status: complete
tags: [struct-properties, core-dll, tag-rules, lighting, zone-fog, map-emitters, tile-batch]

requires:
  - phase: 02-88
    provides: the world lane batch, the lighting, emitters and bsp-visibility steps and the unit ledger
  - phase: 02-97
    provides: lane catalog 43a5132d and the pinned recipe reader pattern with its eol=lf pin
provides:
  - recipes/world/struct-property-tag-rules.json, the pinned verified Core.dll struct tag rules and the two 20_21 oracles
  - scripts/world/struct_property_tag_rules.py (read_struct_property_tag_rules)
  - scripts/world/declared_property_types.py (DeclaredPropertyTypes, struct_member_declarations, declared_property_types)
  - scripts/world/struct_property_values.py (decode_property_tags), the one struct and array value reader
  - structPropertyRulesSha256 in the lighting, bsp-visibility and Emitter-tile emitters unit configs
  - world lane catalog ba87e45c with decoded light, fog, zone and emitter values
affects: [02-89, world lane restage, tileLightingRecords.ts consumers, map emitter playback]

estimate:
  tokens: 100000
  tasks: 3
actuals:
  tokens: 20061
  tasks: 3
  commits: 4
plan_head_before: aff628d29eb2f9d96b8009d34e60cfb56755f79b
plan_head_after: cadd784ddc4a3a2221c5e919043898cb5fddcc50

tech-stack:
  added: []
  patterns:
    - "Struct and array values decode on top of the frozen tag reader and object_values: only struct and array entries are replaced at their paths, so scalar and object values stay byte-identical"
    - "A value the rules or declarations cannot resolve, or one holding a non-finite number, stays its unparsed record at its path and gaps by its dotted path"

key-files:
  created:
    - recipes/world/struct-property-tag-rules.json
    - scripts/world/struct_property_tag_rules.py
    - scripts/world/declared_property_types.py
    - scripts/world/struct_property_values.py
    - tests/pipeline/test_struct_property_tag_rules.py
    - tests/pipeline/test_struct_property_values.py
  modified:
    - .gitattributes
    - scripts/world/actor_field_values.py
    - scripts/world/map_emitter_records.py
    - scripts/world/map_emitter_step.py
    - scripts/world/lighting_step.py
    - scripts/world/bsp_visibility_step.py
    - tests/pipeline/test_level_zones.py
    - tests/pipeline/test_world_lighting_step.py
    - tests/pipeline/test_world_map_emitter_step.py
    - tests/pipeline/test_world_bsp_visibility_step.py
    - docs/parts/world/EVIDENCE.md
    - docs/parts/world/bsp-visibility-census.json
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "One reader, struct_property_values.py, on the frozen Package.properties tag reader and object_values; map_actor_properties.decode_property and the raw step stay byte-identical (row 1092)"
  - "structPropertyRulesSha256 on every lighting and bsp-visibility unit and on emitters units only where the raw manifest counts an Emitter export; no algorithm version changes (row 1093)"
  - "Field types from read_class_field_declarations, struct member types from the verified decompiled scripts on disk, each checked against defaults.json and the cached definition, never decompiled again; Range is declared in Core.Object (system/Core.u) (row 1094)"
  - "An array inner type that no declaration or rule resolves stays the unparsed record at its path (row 1095)"
  - "A non-finite number keeps its nearest struct or array tag unparsed instead of failing the tile; 20_17 resealed by one retry process (row 1096)"

metrics:
  duration: 95min
  completed: 2026-11-14
---

# Phase 2 Plan 98: Struct property values by the verified Core.dll tag rules Summary

Every light Rotation, the L2FogInfo AffectRange, FogRange1 to 5 and Colors, the zone and water volume DistanceFogColor (now B, G, R, A) and the emitter ranges, scales and colour scales decode to values through one reader driven by a pinned Core.dll rules recipe: 0 struct-unparsed emitter rows (7,077 before) and 0 unparsed lighting values (45,792 before) on world lane catalog `ba87e45c...`.

## What was built

- `recipes/world/struct-property-tag-rules.json` (schemaVersion 1, `eol=lf` in `.gitattributes`): Core.dll `system/Core.dll`, 1,372,180 bytes, SHA-256 `9462f87a...e919bf`, image base 0x10100000, equal to the lock entry; verification wf_c74f1a43-96a (154/154 instructions, 117/117 data rows), decision row P1153, facts SHA-256 `5910698900707c74...4144`; the tagged dispatch (vtable +0x88, Ver >= 118, package load), the binary dispatch (vtable +0x84) for 0x57 Vector, 0x58 Rotator and 0x5a Color with member orders; the tag, array index, bool, nested struct and dynamic array rules; Engine.L2FogInfo with Info and Actor; the 20_21 oracles (export 9236 L2FogInfo46, export 11402 SpriteEmitter0). Nothing read from the IMPORTA-PC answer file; the facts give vtable offsets, not function VAs, so the dispatch `address` fields hold the vtable offsets (`addressKind` `vtable-offset`).
- `struct_property_tag_rules.py`: strict reader (duplicate keys, non-finite numbers, Core.dll pin against the casefolded lock entry through `process_reference_client_lock`, rules without address, FName id or condition), cached per process.
- `declared_property_types.py`: top-level types from `read_class_field_declarations` (through `kept_read`), struct bodies with modifiers, comments and `extends` parents from the chain's decompiled scripts in `work/class-defaults/decompiled/<class>/`, each checked against `sourceScriptSha256` and the cached `scriptSha256`; enums from the chain definitions; object classes through `class_identity`.
- `struct_property_values.py`: `decode_property_tags` starts from `object_values` and replaces struct and array entries; binary structs by exact size, tagged structs through `package.properties` to the payload end with their own None, arrays by their declared inner type (binary or tagged struct, float, int, byte, enum, name, object); depth and count limits; `StructPropertyValueError` with dotted path and offset.
- `actor_field_values.py`: `serialized_actor_values` keeps the tags by field name; `resolved_actor_field` decodes only the requested field; `decoded_serialized_value`, `COLOR_STRUCT_NAME` and `SERIALIZED_COLOR_CHANNEL_ORDER` are deleted. `light_actors.py` and `level_zones.py` signatures are unchanged (no edit needed), so `bsp_step.py` and `sky_step.py` stay untouched.
- `map_emitter_records.py`: record `properties` through `decode_property_tags`, rules through `resolved_actor_field`, and `emitter_record_gap_reason` walks nested values (`ColorScale[1].Color`; a nested object reference is a resource gap).

## Results

- Tracer (Task 1, 20_21, `--retry-tiles 20_21 --limit 1`, exit 0): free bytes 140,661,055,488 to 140,506,918,912 (154,136,576, including the catalog and coverage rewrite). L2FogInfo46 equals the oracle with no unparsed value at any depth, SpriteEmitter0 equals its oracle with 0 trailing bytes; only the 20_21 emitters, bsp-visibility, lighting and manifest units changed.
- Batch (Task 3): pending count 147 (eligible tiles whose lighting, emitters, bsp-visibility or manifest unit was not current; 22_23 and 24_18 hold no seal of these steps because an upstream step is a recorded failure). Projection 147 x 154,136,576 = 22,658,076,672 bytes, and 147 x the largest lighting payload 19,397,232 = 2,851,393,104 bytes, both far inside 142,823,084,032 free minus the 4 GiB floor. One `convert_tile_batch.py --eligible --limit 147` process, no workers, exit 0, attempted 145 tiles in committed census order (each taken when a step is stale, or unsealed with no settling recorded row); every tile with a stale lighting, bsp-visibility or emitters seal at plan start was attempted (146 of 146 with the tracer). It failed 20_17 emitters on `AnimRate[28] holds a non-finite number`; after the fix (d5b1757) one `--retry-tiles 20_17 --limit 1` process resealed it (exit 0). Free bytes after 141,991,137,280. Lane catalog `ba87e45c...`; `write_lane_catalog.py --plan` exit 0.
- Seals: 146 lighting, 146 bsp-visibility, 71 emitters and 143 manifest units resealed; every other seal current at plan start kept its fingerprint; `print_fingerprint_inputs.py` prints the same JSON before and after; no frozen, vendored, raw-step or `src` file differs from `aff628d`.
- Emitters: rows `map-emitter-struct-unparsed:` 7,077 (ColorScale 7,058, StartLocationRange 19) to 0; resource rows 6,984, class rows 114; pass rows 76 to 77. One value stays unparsed in the manifests: 20_17 VertMeshEmitter `AnimRate` (array<float> with a non-finite element), behind its `emitter-class-unported` row.
- Lighting: unparsed values 45,792 (41,557 light Rotation, 605 x 7 L2FogInfo fields) to 0 on 146 products; `lightingUnparsedFieldPaths` is empty.
- bsp-visibility census: `build_bsp_visibility_census` differed from the committed file (last written in 02-61), so it was rewritten: both resource SHA-256 values, 20_20 staticMeshMembers 3,439 to 3,626 and solidityDisagreements 12 to 0 (gap reason gone); 20_21 counts equal.
- Browser: ports 5173 and 5175 were free; tiles sweep slice (`LOAD_CHECK_LIMIT=25`) 25 of 25 pass on `ba87e45c...`, `world-tile-lighting.spec.ts` 2 of 2 pass (headless SwiftShader, no FPS claim).
- Reference overlap: area `bsp-visibility` (covers `scripts/world/bsp_visibility*.py`), 0 blocking and 0 unreviewed runs; report saved as `C:/laragon/l2b-orchestration/autonomous-roadmap/02-98-overlap-bsp-visibility.json`. No other area covers the files of this plan.
- Measurements (ignored): `artifacts/lane-store/world/measurements/struct-property-values-tracer.json`, `struct-property-values-batch.json`, `struct-property-values-batch-stdout.json`, `struct-property-values-retry-stdout.json`.

## Task commits

1. Task 1 (tracer): `7431184` Decode struct and array property values by the verified Core.dll tag rules in one reader
2. Task 2: `ee2eba1` Test the struct tag recipe on the lock-equal client: the Core.dll pin and image base, both 20_21 oracles and the zone inputs of bsp and sky
3. Task 3 fix: `d5b1757` Keep a struct or array value with a non-finite number as its unparsed record instead of failing the tile
4. Task 3: `cadd784` State the 02-98 struct value result (evidence, census, decision rows 1092 to 1099)

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] A non-finite float failed the whole 20_17 emitters step**
- Found during: Task 3 batch
- Issue: VertMeshEmitter `AnimRate` (array<float>) holds a non-finite element, and the reader raised, so 20_17 emitters failed and its bsp-visibility and lighting stayed stale.
- Fix: the nearest struct or array tag holding a non-finite number (from the binary layouts, array elements, or the frozen reader's `Non-finite property` inside a nested stream) stays its unparsed record; element read errors are wrapped once with the array path. Test `test_a_non_finite_number_keeps_its_nearest_struct_or_array_tag_as_the_unparsed_record`. No sealed output changes, since every such case had failed. A second, sequential batch process (`--retry-tiles 20_17 --limit 1`) resealed the tile (row 1096).
- Files: `scripts/world/struct_property_values.py`, `tests/pipeline/test_struct_property_values.py`. Commit: `d5b1757`.

**2. [Rule 2 - Correctness] eol=lf pin for the recipe**
- `structPropertyRulesSha256` hashes the recipe file bytes, so `.gitattributes` pins the recipe `text eol=lf` like the 02-96 and 02-97 recipes; `check-lane-ownership.mjs --base aff628d --part world` lists `.gitattributes` as its one foreign path (row 1098). Commit: `7431184`.

### Other deviations

- `decode_property_tag` (one tag) is not exported: `resolved_actor_field` decodes the requested field through `decode_property_tags` on that field's own tags, which also covers static array fields, so a one-tag export would be dead code.
- `light_actors.py`, `level_zones.py`, the two test support fixtures and `tile_step_current_seals.py` needed no edit: their signatures and fixtures hold no R, G, B, A expectation.
- bsp-visibility: the plan expected 57 equal reseals. All 146 typed payloads hold only zone connectivity, visibility and class bits; 59 products changed (embedded zone DistanceFogColor), 87 resealed equal (row 1097).
- Emitters: 71 units carry the key, not 72; 24_18 has Emitter exports but no emitters seal (meshes failed upstream).
- Checker warning on Range: Range is declared in `Core.Object` (`system/Core.u`), not Engine.u; its Min and Max come from the tags and that declaration, never assumed (row 1094).
- Decision rows first went to the orchestrator pending file, where P1164 was already taken; moved to `.planning/OVERNIGHT-DECISIONS.md` rows 1092 to 1095 (row 1099).
- Plan census numbers were from planning time (133 lighting products, 6,667 ColorScale rows); the plan-start census is in the tracer file (146 products, 7,077 struct rows).

## Open for 02-89

Each item with its unblocking step:
- Struct paths left unparsed: none in lighting; one emitter value, 20_17 VertMeshEmitter `AnimRate` (1, non-finite element), which needs a decision on how a non-finite authored float is carried before VertMeshEmitter is ported.
- `replacedLightingPayloadBytes` 770,309,184 (146 superseded lighting payloads) stay on C: in the lane store: an owner disk decision; nothing was deleted or moved.
- bsp-visibility over-inclusion: 87 units resealed with an equal product (all 146 payloads equal); a narrower key needs a rule that knows which tiles hold authored zone colours.
- Raw actor records keep their own six-struct branch in `map_actor_properties.decode_property` (raw step, byte-identical by design); moving them to the one reader reseals every unit of every tile, so it waits for a planned raw step change.
- The runtime placement inspection (`tileMapEmitterPlacements.ts`) reads only top-level values: a runtime plan teaches it nested values.
- Map emitter playback: resources unconverted (6,984 rows) and class defaults unmerged (row 651), so no placement plays.
- `tileLightingRecords.ts` consumers do not read the decoded fog ranges and colours yet: a runtime plan wires L2FogInfo into zone fog.

## Requirements

- WORLD-01: contributed (placed Emitter actor records and lighting values decode); stays Pending, because emitters do not play and census gaps remain. `requirements.mark-complete` ticked it, and the tick was reverted by hand.
- MAT-02 (provisional, owner review): contributed (L2FogInfo, light and zone values in the lighting records); stays open, the per-frame runtime application is unchanged.
- FX-01 (provisional, owner review): contributed (emitter record ranges, scales and colour scales are values); stays open, no emitter plays.

## Needs Human

None.

## Verification

- Task 1 gate: exit 0 (`True True True`).
- Task 2 gate: exit 0; `test_struct_property_tag_rules.py -v` ran 9 tests, the 4 client cases ran (no skip).
- Task 3 gate: exit 0 (`True True True True 0`), frozen diff empty, `--plan` exit 0, ports free.
- Targeted pipeline tests: `test_struct_property_*`, `test_level_zones`, `test_world_*_step` (205), `test_tile_step_current_seals`, `test_world_seal_inspection_reuse`, `test_convert_tile_batch`, the batch, sky, store and manifest tests all OK. `test_world_tile_general_steps` keeps its pre-existing 02-96 failure on `convert_tile_batch.py:257` (deferred-items.md).
- Process cleanup: no process with this worktree path in its command line runs; nothing listens on 5173 or 5175. The batch, retry, Playwright runs and the waiters exited on their own.

## Self-Check: PASSED
