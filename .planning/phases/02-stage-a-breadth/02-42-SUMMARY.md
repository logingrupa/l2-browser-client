---
phase: 02-stage-a-breadth
plan: 42
subsystem: actors
tags: [act-03, items, weapongrp, armorgrp, unit-ledger, lane-store, catalog-index, hand-anchor, playwright]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-21 actor unit census (weapon-mesh and armor-mesh units); 02-23 load-check sweep runner and load-sweep-items.spec.ts; 02-40 class-defaults profile evidence shape and the character batch pattern; 02-41 EquipmentSlot body-part:<value> and equipmentSlotForBodyPart"
provides:
  - "scripts/actors/item_requests.py: build_weapon_unit_request, build_armor_unit_requests, item_gap_rows, item_model_record_id, grouped_item_status, ungrouped_item_reason"
  - "scripts/actors/item_conversion.py: ItemSources, read_item_sources, grouped_item_entries, conversion_units, ItemConversionRun"
  - "scripts/actors/item_census.py: run_item_conversion, run_item_batch, write_item_census_and_gap_rows, ITEM_BATCH_NAME"
  - "convert_actors.py --item <id> and --batch items --limit <n>"
  - "actor_unit_inventory.model_record_capacity (replaces convertible_model_unit_count)"
  - "catalog models record ids interlude:item:<itemId>:body-part:<bodyPart>:weapon and ...:armor:<raceColumnOrdinal>"
  - "nativeCatalogIndex: parseItemModelRecordId, NativeItemCatalogRecord.slot widened to EquipmentSlot"
  - "nativeEquippedItemPresentation.presentEquippedItem and EquippedItemPresentation; nativeEquippedBodyPartItems; nativeEquippedItemSource"
  - "nativeHumanHandAnchor.resolveNativeCharacterHandAnchor; nativeGlbBoneIdentity.readRetainedGlbBoneIdentity"
  - "NativeBoneAnchorInspection.attachedMeshNames"
  - "docs/parts/items/item-census.json"
affects: [ACT-03, INT-01, integration restage, 02-26 gap census]

actuals:
  tokens: 30000
  tasks: 3
  commits: 4
plan_head_before: 3a0dcb3ffe511bafaf1872f95a0a46fd57059d89
plan_head_after: de4262a7b1f49f157edca49a75b3e26a458c5199

tech-stack:
  added: []
  patterns:
    - "An item unit is the actor unit census unit; only census-convertible units are ledger units, and the request cites the first item row that names the unit"
    - "One model record per item and unit, all records of a shared unit point at one archive"
    - "A body-part slot presentation is attached (weapon at a sourced hand anchor, status presentation) or a labelled gap shown through missingAssetDiagnostic and the status line"

key-files:
  created:
    - scripts/actors/item_requests.py
    - scripts/actors/item_conversion.py
    - scripts/actors/item_census.py
    - src/assets/native/nativeEquippedItemPresentation.ts
    - src/assets/native/nativeEquippedBodyPartItems.ts
    - src/assets/native/nativeEquippedItemSource.ts
    - src/assets/native/nativeGlbBoneIdentity.ts
    - tests/pipeline/test_item_requests.py
    - tests/unit/nativeEquippedItemPresentation.test.ts
    - tests/browser/sandbox-equip.spec.ts
    - docs/parts/items/item-census.json
  modified:
    - scripts/actors/convert_actors.py
    - scripts/actors/actor_unit_inventory.py
    - scripts/actors/item_unit_inventory.py
    - scripts/actors/character_conversion.py
    - scripts/actors/npc_batch.py
    - scripts/native_store/catalog_index_keys.py
    - scripts/native_store/gap_census.py
    - recipes/actors/gap-reasons.json
    - src/assets/native/nativeCatalogIndex.ts
    - src/assets/native/nativeHumanHandAnchor.ts
    - src/assets/native/NativeCharacterVisual.ts
    - src/assets/native/NativeActor.ts
    - tests/unit/nativeCatalogIndex.test.ts
    - tests/unit/nativeHumanHandAnchor.test.ts
    - tests/pipeline/test_catalog_index_keys.py
    - tests/pipeline/test_gap_census.py
    - docs/parts/items/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Item model record id form interlude:item:<itemId>:body-part:<bodyPart>:weapon|armor:<raceColumnOrdinal> (row 603)"
  - "Sockets and sidecars preserved = every converter-written file stays, the item step adds no socket data (row 604)"
  - "Armor in a body-part slot is the gap equipment-slot-meaning-undecoded:<bodyPart> (row 605)"
  - "The actors items step writes rows only for weapon and armor ids; the integration join keeps etcitem and ungrouped ids (row 606)"
  - "gap_census items step and catalog_index_keys item keys as a lane confirmation (row 607)"
  - "A profile upper record keeps its item key over item model records (row 608)"
  - "New reason mesh-texture-pairing-undecoded:<meshes>/<textures>, actors list version 8 (row 609)"
  - "Bare reference = no Package.Object qualifier (row 610)"
  - "Item units are the census units; census and request gaps are decided from rows (row 611)"
  - "model_record_capacity covers NPC, chargrp and item records (row 612)"
  - "Generated characters are markers, so armor is checked on the local player and the marker keeps its character gap (row 613)"
  - "ACT-03 stays Pending (row 614)"

requirements-completed: []

coverage:
  - id: D1
    description: "Weapon and armor unit requests generated from decoded rows with every ACT-03 edge (empty, adjacency, encoding, ordering, concurrency) and the item 1 and item 22 recipe cross-checks"
    requirement: ACT-03
    verification:
      - kind: unit
        ref: "tests/pipeline/test_item_requests.py"
        status: pass
    human_judgment: false
  - id: D2
    description: "Index answers item:<id> from item model records with a body-part slot; upper profile record keeps its key"
    requirement: ACT-03
    verification:
      - kind: unit
        ref: "tests/unit/nativeCatalogIndex.test.ts#answers item keys from item model records with the body-part slot built from the record id"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_catalog_index_keys.py#test_item_model_records_give_item_keys_like_the_browser_catalog_index"
        status: pass
    human_judgment: false
  - id: D3
    description: "Hand anchor from class defaults or reviewed rigs, presentation gaps, weapon attached under the anchor on a native character visual"
    requirement: ACT-03
    verification:
      - kind: unit
        ref: "tests/unit/nativeHumanHandAnchor.test.ts"
        status: pass
      - kind: unit
        ref: "tests/unit/nativeEquippedItemPresentation.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Item 1 equipped by id on the local player with its weapon under the Weapon_R_Bone anchor; converted armor shows its slot meaning gap; screenshots and portrait scroll check"
    requirement: ACT-03
    verification:
      - kind: e2e
        ref: "tests/browser/sandbox-equip.spec.ts (4 passed, NATIVE_STORE_ROOT=actors DEV_PORT=5175)"
        status: pass
      - kind: automated_ui
        ref: "playwright:artifacts/item-evidence/equip-weapon-armor-1440x900.png"
        status: pass
    human_judgment: true
    rationale: "Presentation of the weapon at the hand is labelled unverified against the native attachment transform; a side-by-side with L2.exe is the owner's judgment."
  - id: D5
    description: "Two batch slices of 50 units sealed, census for every item key, items sweep slice of 50 keys"
    requirement: ACT-03
    verification:
      - kind: other
        ref: "python -B scripts/actors/convert_actors.py --client E:/Lineage2-client --batch items --limit 50 (twice) and --limit 1 rerun"
        status: pass
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=actors DEV_PORT=5175 LOAD_CHECK_KIND=items LOAD_CHECK_LIMIT=50 pnpm test:e2e tests/browser/load-sweep-items.spec.ts"
        status: pass
    human_judgment: false

duration: 61min
completed: 2026-11-10
---

# Phase 2 Plan 42: items convert from their decoded rows and equip by item id summary

**Weapongrp rows and armorgrp race columns now generate unit requests from the decoded rows. They convert on the unit ledger into the actors lane store as one `interlude:item:<id>:body-part:<bodyPart>:weapon|armor:<ordinal>` record per item. The catalog index answers `item:<id>` with its body-part slot. Item 1 equipped by id hangs its sword under the reviewed `Weapon_R_Bone` anchor, and armor in a body-part slot shows the labelled gap `equipment-slot-meaning-undecoded:<bodyPart>`. Two slices sealed 102 units: 96 of 9,238 items are converted and every key has one status.**

## Performance

- Started 2026-11-10T02:24Z (04:24 Riga), completed 2026-11-10T03:25Z (05:25 Riga), about 61 minutes.
- Tasks: 3 of 3. Commits: 4. Files: 11 created, 20 modified.

## Accomplishments

- **Generator** (`scripts/actors/item_requests.py`). It builds one request per weapongrp row and one per non-empty armorgrp race column, in source column order.
  - `sourceBinding` cites the mesh and texture paths. One mesh with several textures binds texture index i to material slot i.
  - Empty meshes are `no-mesh-in-row`. Several meshes are `mesh-texture-pairing-undecoded:<m>/<t>`. A bare reference is `actor-default-unresolved:<field>`.
  - Item 1 equals `Native-Small-Sword-ClassID1`, and item 22 column `m_HumnFigh` equals `MFighter-Leather-Shirt-ClassID22` (E: cross-check tests). The recipe is read only by the tests.
- **Conversion** (`item_conversion.py`, `item_census.py`, `convert_actors.py --item` and `--batch items`).
  - Census-convertible units run in ascending item id order on the ledger step `items`. Weapons convert without an animation, and armor with its serialized animation reference.
  - Records for every item a unit serves share one archive.
  - The `items` gap rows give every weapon and armor key one status. Etcitem and ungrouped ids stay in the integration join (row 606).
  - `docs/parts/items/item-census.json` counts all 9,238 keys.
- **Index** (`nativeCatalogIndex.ts`). `parseItemModelRecordId` and the item model lookups use `equipmentSlotForBodyPart`. The upper-slot profile record keeps item 22.
- **Presentation**.
  - `presentEquippedItem` attaches a weapon at the hand anchor: the reviewed MFighter/FFighter rigs, or `resolveNativeCharacterHandAnchor` from the class defaults `RightHandBone` when that joint is in the model skin. Status is `presentation`. Everything else is a labelled gap.
  - `NativeCharacterVisual` presents `body-part:` slots through `NativeEquippedBodyPartItems`. The weapon `NativeActor` is parented under a bone anchor, and gaps show through `missingAssetDiagnostic` and the status line. The upper path is unchanged.
  - `nativeHumanHandAnchor.ts` is comment-free, with the reviewed rigs in a named constant whose rows carry their evidence file name. The GLB bone identity reader moves to `nativeGlbBoneIdentity.ts`, shared by the actor and the resolver.
- **Batch and sweep**.
  - Slice 1 (`--limit 50`, 04:58 Riga) sealed 50 units: 42 pass and 8 `animation-reference-missing`.
  - A `--limit 1` rerun reported the 51 sealed units with `cacheHit: true` and converted only the next unit.
  - Slice 2 (`--limit 50`, 05:01 Riga) sealed 50 more units: 36 pass and 14 `animation-reference-missing`.
  - Lane catalog `b070325c...` holds 282 models, 161 of them item records.
  - Load checks: `item:1` pass from the equip spec, then the items sweep slice added 50 pass records. 51 pass in `artifacts/lane-store/actors/load-checks/b070325c...json`.

## Task commits

1. Task 1 (tracer): `80c7aa8` feat(02-42): item 1 tracer from its weapongrp row to a weapon at the local player's hand anchor
2. Task 2: `f57635c` feat(02-42): armor race-column units, class-default hand anchors and labelled presentation gaps for every ACT-03 edge
3. Task 3:
   - `9e3ee90` test(02-42): equip converted armor as its slot meaning gap, keep the generated character marker, and check both phone layouts
   - `de4262a` docs(02-42): record the ACT-03 item census, the equip and sweep checks, the restage handoff and decision rows 603 to 614

Tracer gate: before Task 2 started, Task 1's verify ran end to end. That covered the unittest file, `--item 1`, `write_lane_catalog --lane actors`, typecheck, the catalog index vitest and the e2e spec (1 passed). The `--item 1` rerun reported `cacheHit: true`.

## Verification

- `test_item_requests.py`: 16 OK, including both E: cross-checks and the converted-package test on the lane store.
- `pnpm vitest run` on `nativeHumanHandAnchor`, `nativeEquippedItemPresentation`, `nativeCharacterVisual`, `nativeCatalogIndex` and `nativeActor`: 136 passed.
- `pnpm typecheck`: clean.
- `pnpm test:unit` (05:11 Riga): 178 files passed and 4 skipped; 2,464 tests passed and 72 skipped. Log: `artifacts/scratch/02-42/unit-final.log`.
- `pnpm test:pipeline` at nice 10: `Ran 1784 tests`, `OK (skipped=60)`. Log: `artifacts/scratch/02-42/pipeline-final.log`.
- `NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-equip.spec.ts`: 4 passed, on headless SwiftShader, so there is no FPS claim.
  - The spec is passed, with the `item:1` load-check record.
  - Screenshots: `artifacts/item-evidence/equip-weapon-armor-1440x900.png` and `artifacts/item-evidence/equip-weapon-armor-932x430.png`. The 1440 x 900 shot shows the sword in the fighter's hand and the status line `item:21 gap: equipment-slot-meaning-undecoded:10`.
  - No horizontal scroll at 430 x 932 portrait.
- Items sweep slice (`LOAD_CHECK_KIND=items LOAD_CHECK_LIMIT=50`): 1 passed. It checked 50 keys and skipped `item:1` as already recorded.
  - Before the sweep, `netstat` listed a `LISTENING` row with PID 0 on 5175, left over from the Playwright server that had just stopped.
  - `curl` to 5175 was refused (exit 7) and the Playwright config has `reuseExistingServer: false`, so the sweep ran on its own server. The served catalog SHA `b070325c` matches this worktree's lane catalog.
  - The row was gone at the final check.
- Acceptance greps:
  - `def item_model_record_id`: 1. `--item` in convert_actors: 1. `equipmentSlotForBodyPart(` in the index: 1. Recipe paths in the generator and convert_actors: 0.
  - Comment lines in `nativeHumanHandAnchor.ts`: 0, down from 5. `export function resolveNativeCharacterHandAnchor`: 1. The `_u/_l/_g/_b` and `endswith(` pattern in `item_requests.py`: 0.
  - `presentEquippedItem(` in NativeCharacterVisual: 1. NativeCharacterVisual is 281 lines.
  - `scrollWidth` in the spec: 1. `844`, `world=` or `authored=1`: 0.
  - Census items add up to 9,238. `Needs Human (plan 02-42)` appears in STATE.md. EVIDENCE.md is 5,539 bytes.
- `node scripts/check-lane-ownership.mjs --base 3a0dcb3ffe511bafaf1872f95a0a46fd57059d89 --part items`, run after the last code commit (`9e3ee90`) and before the docs commit:

```
lane actors: 2 foreign paths
scripts/native_store/catalog_index_keys.py
scripts/native_store/gap_census.py
exit=1
```

  Both foreign paths are small tested integration edits, accepted as a lane confirmation (row 607, the precedent of rows 580 and 598).
- Reference overlap: the DEC-OWN-12 areas (materials, bsp-visibility, movement, particles, network) cover neither `scripts/actors` nor `src/assets/native`, so no run applies.
- The self-contained repo name check (DEC-OWN-11) is empty for everything written. Every `check-machine-schedule` call printed `activeWindow: null`.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The integration gap census refused the actors items rows.** The 02-26 join already gives etcitem and ungrouped ids their rows, and it read every actors `items` part row as a weapon or armor row. The `items` step now writes only weapongrp and armorgrp keys. `items` is in `GAP_CENSUS_STEP_ORDER`, and `catalog_index_keys` counts item model keys. Rows 606 and 607. Commit `80c7aa8`.

**2. [Rule 1 - Bug] The models capacity counted only NPC and chargrp units.** Item records would have made the NPC and character writers refuse. `model_record_capacity(census)` replaces `convertible_model_unit_count` in all three writers (row 612). Commit `80c7aa8`.

**3. [Rule 1 - Bug] Qualified names with `'` or `-` read as bare.** Five weapons, such as `knife_o'_silenus`, failed the strict object-name pattern. A bare reference is now one without a package qualifier (row 610). Commit `80c7aa8`.

### Other adjustments

- The armor builder, gap rows and census landed with the tracer, because the items gap rows need a status for every armor key. Task 2 added the edge tests. Those passed on their first run, so Task 2 has no separate RED commit, the same as 02-40.
- Plan step 3.2 asked to equip armor on a generated character. Every generated character is a marker (no class join, 02-40). The spec checks the armor gap on the local player, and checks that the `character:0` marker keeps its character gap (row 613).
- The entity snapshot has no `equipment` field, and `EntityRegistry` is integration code. The specs check the hand anchor (`attachedMeshNames`, added to `NativeBoneAnchorInspection`) and the gap text instead.
- `presentEquippedItem(slot, lookup, character)` and the `attached` variant also carry `catalogId` and `sourceObject`, which the visual needs to load and anchor the model.
- `nativeCharacterFactory` takes an optional fifth argument, `NativeEquippedItemSource`. The default reads the served catalog lazily, so `src/runtime` is unchanged.
- Two batch slices ran instead of one, plus a `--limit 1` rerun that proves sealed units are skipped. The census records the limit of the last run (50).

**Total deviations:** 3 auto-fixed (1 blocking, 2 bugs). **Impact:** each fix was needed for correctness, with no scope creep.

## Requirements

- ACT-03: Pending (row 614). Items convert and equip by id, weapons attach at a sourced hand anchor and every unresolved presentation is labelled. Of 9,238 items, 96 are converted and 1,546 are pending, and armor presentation is a gap by design.

## Known stubs

None. Every non-converted key has a listed reason or `conversion-pending`. `NativeCharacterProfile.generatedProfile` has no runtime caller yet, because no generated character profile loads before the class join (02-40). It is covered by unit tests.

## Needs Human

- `Needs Human (plan 02-42)`: the actors lane merge command printed by `write_lane_catalog.py --lane actors --plan` (lane catalog `b070325c...`, 161 item records).

## Open follow-ups

- Item breadth: continue `--batch items --limit 50` slices from the 102 sealed units (STATE.md).
- Item catalog size: at about 3.6 KB per record, the full breadth would pass the 32 MB catalog limit (STATE.md).
- Weapons on generated characters wait on the chargrp class join (02-40).

## Threat flags

None beyond the register.
- T-02-42-01: client reads go through `decode_table` and `locked_input_records`, with one Converter per run.
- T-02-42-02: output goes through `require_converter_output` and the lane store only.
- T-02-42-03: record ids are parsed by an anchored canonical pattern in TS and Python.
- T-02-42-04: the anchor comes only from the reviewed rig pins or class defaults with the joint in the skin.
- T-02-42-05: preflight runs before every unit, with slice limit 50 at BelowNormal.

## Process cleanup

- Started: foreground Python conversions and unittest runs, `pnpm test:unit`, `pnpm test:pipeline`, tsc and Vitest runs, and three Playwright runs whose `pnpm dev` server on 5175 Playwright stopped at exit.
- Final check at 05:23 Riga: `netstat` shows no `LISTENING` row on 5173 or 5175, and `curl` to 5175 is refused.
- `ps -W` filtered for node, chrome, python, umodel, playwright and esbuild shows only processes from Oct 29 and Nov 7, which predate this run. Nothing started by this plan remains.

## Self-Check: PASSED

- Created files exist: `scripts/actors/item_requests.py`, `item_conversion.py`, `item_census.py`, `src/assets/native/nativeEquippedItemPresentation.ts`, `nativeEquippedBodyPartItems.ts`, `nativeEquippedItemSource.ts`, `nativeGlbBoneIdentity.ts`, `tests/pipeline/test_item_requests.py`, `tests/unit/nativeEquippedItemPresentation.test.ts`, `tests/browser/sandbox-equip.spec.ts`, `docs/parts/items/item-census.json`.
- Commits `80c7aa8`, `f57635c`, `9e3ee90` and `de4262a` are ancestors of HEAD.
