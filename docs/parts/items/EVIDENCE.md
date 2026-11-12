# Items and equipment on the body evidence

Part `items`, lane `actors`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

ACT-03 breadth started (plan 02-42, 2026-11-10). Items convert from their decoded rows and equip by item id in the sandbox.

- Generator. `scripts/actors/item_requests.py` builds one unit request per weapongrp row and one per non-empty armorgrp race column, from the decoded row only. The mesh and texture paths are cited in `sourceBinding`. Item 1 equals the reviewed `Native-Small-Sword-ClassID1` recipe and item 22 column `m_HumnFigh` equals `MFighter-Leather-Shirt-ClassID22` (cross-check tests on E:, the recipes are read by the tests only).
- Record ids. One catalog `models` record per item and unit: `interlude:item:<itemId>:body-part:<bodyPart>:weapon` or `...:armor:<raceColumnOrdinal>`. Items that share one unit share one export and one archive and keep their own record.
- Conversion. `convert_actors.py --item <id>` and `--batch items --limit <n>` convert census-convertible units on the unit ledger (step `items`) into `artifacts/lane-store/actors/l2`. Weapons convert without an animation, armor with the mesh's serialized animation reference. Every package keeps every file its `asset.json` lists (`verify_archive`), and the item step adds no socket or attachment data. A run hashes the converter once and reads the reference client lock once for all units; `--batch items` skips sealed units before the machine-schedule preflight and writes the store catalog at most once per slice, still republishing sealed records the catalog lacks (8a30d1c).
- Index. `buildNativeCatalogIndex` answers `item:<id>` from the item model records with the slot `equipmentSlotForBodyPart(bodyPart)` builds. The player profile upper record of item 22 keeps its key.
- Presentation. `presentEquippedItem` attaches a weapon at the hand anchor: the reviewed MFighter and FFighter rigs (`Weapon_R_Bone`), or, for a generated character, the `RightHandBone` of its class defaults when that joint is in the model skin. It is labelled `presentation`; the native attachment transform is unverified. Everything else is a labelled gap: armor in a body-part slot is `equipment-slot-meaning-undecoded:<bodyPart>`, an unanchored weapon names its anchor reason.
- Body-part item lookups resolve through the runtime's served catalog and catalog index (`catalogEquippedItemSource` in `createNativeSliceRuntime`), with no second `catalog.json` or `coverage.json` read (d9950d1). The attachment lifecycle is covered for unequip during a pending lookup or model load, a same-slot swap, gap diagnostic order and dispose, with no leaked anchor or mesh (5620800).

### Census

`docs/parts/items/item-census.json` after two slices of 50 units (2026-11-10 04:58 and 05:01 Riga), denominator 9,238 itemname-e ids:

| Status | Items |
|--------|------:|
| converted | 96 |
| pending (`conversion-pending`) | 1,546 |
| gap `etcitem-presentation-unplanned` | 6,911 |
| gap `no-mesh-in-row` | 307 |
| gap `mesh-texture-pairing-undecoded:2/2` | 257 |
| gap `skeletal-licensee-unsupported:123/31` | 121 |

Units: weapon 375 convertible, 19 converted; armor 2,594 convertible, 60 converted, 23 `animation-reference-missing`. 102 units are sealed. A rerun reported the 51 sealed units of the first slice with `cacheHit: true` and converted only the next one. Since 55ff726 the census and the item gap rows count only units sealed under their current fingerprint; other units are pending. A unit that reconverts into a gap drops the model record of each of its items (4fee86f).

The upper-slot item 22 has the decoded `body_part` 10; its body-part records exist, but the index keeps the profile upper record for its key.

### Loads

Actors lane catalog `b070325c...` (161 item records of 282 models):

- `item:1` pass from `tests/browser/sandbox-equip.spec.ts`: equipped by id on the local player, the weapon mesh hangs under the `Weapon_R_Bone` anchor.
- The items sweep slice (`LOAD_CHECK_KIND=items LOAD_CHECK_LIMIT=50`) wrote 50 more pass records. 51 pass, 0 failed in `artifacts/lane-store/actors/load-checks/b070325c295c4583bc23d3f46d50b9c7d09713e808e67591ddaf6501aebb1e9d.json`.
- Lane coverage report: items 96 converted, 8,074 gap, 1,068 pending, loads 51 pass. Coverage counts a census-step gap before an items-step pending row, so its pending count is lower than the item census.

### Catalog size projection (plan 02-79, 2026-11-12 07:21 Riga)

Measured before the item batch with one `python -B -c` command over the actors lane catalog, the integration union catalog and the item census; the limit is `MAXIMUM_CATALOG_BYTES` imported from `scripts/native_store/catalog_writer.py`. Every term is taken at its upper bound:

| Term | Value |
| --- | ---: |
| catalog byte limit | 33,554,432 |
| integration union catalog | 1,810,934 |
| actors lane catalog `064d9ad6...` (skills complete) | 6,333,702 |
| item model record, largest of 161 (mean 2,514) | 2,903 |
| item records per pass unit (sealed units in the census) | 2.038 |
| convertible item units (all, since the converter change reseals the sealed ones) | 2,969 |
| projected item records | 6,051 |
| pending skill keys | 0 |
| projected union, union plus lane catalog plus item records | 25,710,689 |
| headroom | 7,843,743 |

Decision (OVERNIGHT-DECISIONS row 1023): under the limit, so the item record shape stays and the item batch runs to completion.

### Browser checks

`NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-equip.spec.ts`, 4 passed on headless SwiftShader (no FPS claim):

- Item 1 at the hand anchor with its load-check record.
- The first converted armor item outside the profile upper items (item 21, `body_part` 10) on the local player shows `item:21 gap: equipment-slot-meaning-undecoded:10`. Equipping it on a spawned `character:0` keeps that marker at its character gap, because no chargrp row joins a class yet (02-40).
- Screenshots: `artifacts/item-evidence/equip-weapon-armor-1440x900.png` and `artifacts/item-evidence/equip-weapon-armor-932x430.png`. No horizontal scroll at 430 x 932 portrait.

## Open

- Breadth: 1,546 items pending; later slices continue from the sealed units.
- Which body part an armor replaces is undecoded, so armor never replaces a part on a body-part slot.
- Weapons with two meshes and armor columns with two or four meshes are `mesh-texture-pairing-undecoded`; the mesh to texture pairing is not decoded.
- Weapons on generated characters wait on the chargrp class join (02-40, `class-template-mapping-undecoded`).
- The actors lane store is not restaged (STATE.md, Needs Human plan 02-42).

## Evidence

- Code: `scripts/actors/item_requests.py`, `item_conversion.py`, `item_census.py`, `src/assets/native/nativeCatalogIndex.ts`, `nativeEquippedItemPresentation.ts`, `nativeEquippedBodyPartItems.ts`, `nativeHumanHandAnchor.ts`.
- Tests: `tests/pipeline/test_item_requests.py`, `tests/pipeline/test_item_conversion_run.py`, `tests/unit/nativeCatalogIndex.test.ts`, `tests/unit/nativeHumanHandAnchor.test.ts`, `tests/unit/nativeEquippedItemPresentation.test.ts`, `tests/unit/nativeEquippedItemSource.test.ts`, `tests/unit/nativeEquippedBodyPartItems.test.ts`, `tests/browser/sandbox-equip.spec.ts`, `tests/browser/load-sweep-items.spec.ts`.
- Summary: `.planning/phases/02-stage-a-breadth/02-42-SUMMARY.md`. Decisions: OVERNIGHT-DECISIONS rows 603 to 614.
