# Skill visuals and effects evidence

Part `skills-effects`, lane `actors`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Power Strike (skill 3 level 1) is the reviewed source-dispatch bundle in the shared store.

## ACT-06 skill bindings (plan 02-43, 2026-11-09)

Every decoded skillgrp row has one binding, built by `scripts/actors/skill_binding_table.py` and committed as counts only in `skill-binding-census.json` (`--check` recomputes it):

| Binding | Rows |
| --- | --- |
| `visual-root` (qualified description, 245 roots) | 12,236 |
| `reviewed-source-dispatch` (skill 3 level 1, `recipes/native-power-strike.json`) | 1 |
| gap `native-skill-dispatch-required` | 17,575 |
| anomalies (level below 1) | 0 |
| Total, equal to the decoded row count | 29,812 |

- 2,694 skill ids. Sounds bind only from the one skillsoundgrp row of the same id and level: 1,371 keys have it, 28,441 keys have `no-exact-skillsound-row`. There is no level 1 or nearest-level fallback.
- Binding rows and the census hold identity only (key, skill id, level, root, sound row ordinal, reasons); no skillgrp gameplay field reaches them (test `GameplayFieldProhibitionTests`).

### Conversion

- One sealed ledger unit per visual root (`skill-root:<description>`, step `skill-effect-root`), converted through `native_effect_bundle` from the first key with an exact sound row, staged with `scripts/stage-native-effect.mjs` and written to the actors lane store under `l2/effects/<sha>/`.
- The staged folder holds every file its manifest pins: the resources and, since 2026-11-09, the source bundle manifest and graph as `source-bundle/<sha256>.json`, so `write_lane_catalog.py --lane actors` pins the effect records (`tests/pipeline/test_skill_effect_store_pins.py`). The 22 sealed roots were reconverted with that stage: the same 17 converted and 5 gap roots, and the same gap-row counts.
- Every key that names a converted root gets the record `interlude:skill:<id>:level:<level>:native-description-action` with `bundleId` `interlude:skill-root:<description>`.
- Sprite, Mesh, Beam, Ribbon and VertMesh emitter records and their texture and static mesh references convert. Spark, Trail and other classes keep their records and convert nothing. VertMesh objects stay raw native data: the Converter has no VertMesh adapter.
- `recipes/actors/emitter-class-coverage.json` lists the classes the browser runs (`Engine.MeshEmitter`, `Engine.SpriteEmitter`). A key passes only when every emitter class of its root is listed; otherwise it is `emitter-class-unported:<class>` (FX-01).

Resume command: `python -B scripts/actors/convert_actors.py --client E:/Lineage2-client --batch skills --limit 20`. A rerun skips sealed roots (`alreadySealedRoots`).

Roots sealed so far: 22 of 245 (tracer `skill.wh.1011`, one 20-root slice, one 1-root resume check).

| Root outcome | Roots |
| --- | --- |
| converted, all classes simulated | 16 |
| converted, `emitter-class-unported:Engine.BeamEmitter` (`skill.wh.1011`) | 1 |
| `converter-refused`: unsupported default-property syntax in the decompiled class (`skill.at.100`, `skill.at.260`, `skill.at.92`, `skill.moment.110`) | 4 |
| `converter-refused`: `lineageeffect.mo_rapid_shot_ta.MeshEmitter3 has no converted resource` (`skill.mo.99`) | 1 |

Gap rows `artifacts/lane-store/actors/gap-rows/skills.json`, one per key (29,812): 2,542 pass, 17,575 `native-skill-dispatch-required`, 634 `converter-refused`, 522 `emitter-class-unported:Engine.BeamEmitter`, 8,539 `conversion-pending`.

Lane catalog `d942b12174a2dd48df6a44d1febba0c7dddddc7e32459873a2e0d74b99011b60` (pinned, 2026-11-09): 3,064 skill records over 17 staged manifests. Lane coverage (`build_coverage_report.py --lane actors`): skills-effects 3,064 converted, 18,210 gap, 8,538 pending.

### Browser

- `src/effects/castSkillIndex.ts` owns skill effect identity: `parseSkillEffectComponentId` (used by the catalog index), `buildCastSkillIndex` (refuses two records for one key), `lookupCastSkill` and `selectedCastSkill` (`?skill=<id>:<level>`).
- `loadNativeEffectComponents` loads the selected key, or Power Strike when nothing is selected. The 64-entry catalog cap is gone; the catalog byte limit of `readNativeCatalog` bounds it.
- Unsimulated emitter components parse as records without resources; the loader refuses them.

### Browser checks (headless SwiftShader, no FPS claims)

- `NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-skill-cast.spec.ts`: 5 passed. `tests/browser/harness/native-skill-effect.html?skill=1011:1` lists the 5 components of `interlude:skill-root:skill.wh.1011` (3 Mesh, 1 Beam record, 1 Sprite) and draws the first component the preview loader accepts. `?skill=3:2` shows `skill:3:2 gap: native-skill-dispatch-required` with no component. Portrait 430 x 932 has no horizontal scroll.
- Screenshots: `artifacts/skill-evidence/skill-1011-1-1440x900.png`, `skill-1011-1-932x430.png`, `skill-3-2-gap-1440x900.png`.
- Skills sweep slice (`LOAD_CHECK_KIND=skills LOAD_CHECK_LIMIT=20`), records in `artifacts/lane-store/actors/load-checks/6965638a....json`, 21 records, all `failed`: 18 `skill.wh.1011` keys on `multiple independent primitive texture/frame routes are not supported in one preview`, 3 `skill.wh.1012` keys on `only constant finite nonnegative ColorMultiplierRange is supported`.

## Open

- 223 roots wait for the resume command; 8,539 keys are pending.
- Loads: no skill key loads every simulated component yet; the preview loader refuses multi-texture mesh emitters and random color multipliers (FX-01).
- Beam, Ribbon and VertMesh run only after the FX-01 simulator (02-68, 02-69); VertMesh meshes need a Converter adapter.
- Five roots are refused by the converter; their reasons are in the gap rows.
- Runtime presentation of a converted effect on a `skill-cast` event for skills other than Power Strike is integration wiring (`createNativeSliceEffects.ts`).
- The cast check still runs on the harness page; the dev store switch now serves the actors lane as its restage union, so the native route can start on it.
- Restage: the actors lane catalog pins and `write_lane_catalog.py --lane actors --plan` prints the merge command; the merge into `public/l2` is the integration thread's restage.

## Evidence

Recipe: `recipes/native-power-strike.json`. Notes: `docs/NATIVE_POWER_STRIKE.md`. Plan summary: `.planning/phases/02-stage-a-breadth/02-43-SUMMARY.md`. Decisions: OVERNIGHT-DECISIONS rows 397 to 408.
