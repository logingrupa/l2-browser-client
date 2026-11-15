---
phase: 02-stage-a-breadth
plan: 43
subsystem: actors
tags: [skills, effects, act-06, fx-01, binding-table, unit-ledger, cast-index, load-check]
status: complete
requires:
  - phase: 02-21
    provides: skill census rows, skill_root_key and the native-skill-dispatch-required reason
  - phase: 02-23
    provides: skills load-check sweep spec, load-check harness and record files
  - phase: 02-34
    provides: effect_bundle_packing (native_class_closure, pack_items_by_class_closure)
  - phase: 02-59
    provides: seed gap reasons without effect-class-unsupported
provides:
  - "scripts/actors/skill_binding_table.py: build_skill_binding_rows, skill_binding_gap_rows, SKILL_BINDING_STATUSES, skill_binding_census and the census CLI"
  - "scripts/actors/skill_effect_conversion.py: one sealed skill-effect-root unit per visual root, staged into the actors lane store"
  - "convert_actors.py --skill <id> --level <n> and --batch skills --limit <n>"
  - "src/effects/castSkillIndex.ts: parseSkillEffectComponentId, buildCastSkillIndex, lookupCastSkill, selectedCastSkill, reviewedPowerStrikeSkill"
  - "loadNativeSkillEffectComponents and simulatedEffectEmitterClasses in src/effects/nativeEffectComponents.ts"
  - "recipes/actors/emitter-class-coverage.json and three actors gap reasons"
  - "docs/parts/skills-effects/skill-binding-census.json"
  - "tests/browser/harness/native-skill-effect.html and tests/browser/sandbox-skill-cast.spec.ts"
affects: [02-44, 02-68, 02-69, 02-70, 02-05 restage]
tech-stack:
  added: []
  patterns:
    - "One conversion unit per visual root; every skill key that names the root gets its own catalog record pointing at the shared manifest through bundleId"
    - "Pass or gap of a converted root is computed when gap rows are written, from the coverage recipe, so extending the simulated list moves keys without reconverting"
key-files:
  created:
    - scripts/actors/skill_binding_table.py
    - scripts/actors/skill_effect_conversion.py
    - src/effects/castSkillIndex.ts
    - recipes/actors/emitter-class-coverage.json
    - docs/parts/skills-effects/skill-binding-census.json
    - tests/pipeline/test_skill_binding_table.py
    - tests/unit/castSkillIndex.test.ts
    - tests/browser/sandbox-skill-cast.spec.ts
    - tests/browser/harness/native-skill-effect.html
    - tests/browser/harness/nativeSkillEffectHarness.ts
  modified:
    - scripts/actors/convert_actors.py
    - scripts/native_effect_bundle.py
    - scripts/native_assets_lib/effect_readiness.py
    - scripts/native_store/gap_census.py
    - recipes/actors/gap-reasons.json
    - src/effects/nativeEffectComponents.ts
    - src/effects/loadEffectComponent.ts
    - src/effects/nativeEffectComponentPreview.ts
    - src/assets/native/nativeCatalogIndex.ts
    - src/runtime/attachSandboxCommandSheet.ts
    - tests/browser/harness/loadCheckHarness.ts
    - tests/pipeline/test_native_effect_bundle.py
    - tests/unit/nativeEffectComponents.test.ts
    - tests/unit/nativeCatalogIndex.test.ts
    - tests/unit/sandboxCommandSheet.test.ts
    - docs/parts/skills-effects/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "02-43: ?skill=<id>:<level> is read only by selectedCastSkill; without it the reviewed Power Strike key loads; the lane check runs on a harness page because the native route cannot start on a lane-only catalog (rows 392, 397)"
  - "02-43: one sealed skill-effect-root unit per visual root from the first key with an exact sound row; per-key records interlude:skill:<id>:level:<level>:native-description-action with bundleId interlude:skill-root:<description> (row 400)"
  - "02-43: actors gap reasons skill-visual-reference-unqualified, effect-bundle-class-limit:<count>, emitter-class-unported:<class>; 96 classes per root allowed, 97 is the gap (row 398)"
  - "02-43: binding rows carry soundRowOrdinal and soundReason apart from the visual status (row 401)"
  - "02-43: small tested changes outside the lane: effect_readiness accepts asset manifest v2, gap_census orders the skills step, the sandbox sheet checks Power Strike through reviewedPowerStrikeSkill (row 402)"
  - "02-43: DefaultReader is not rerouted through read_class_defaults_with_provenance; VertMesh meshes have no Converter adapter (rows 403, 404)"
  - "02-43: effect bundles share the lane converter folder; a simulated component without a converted resource refuses its root (row 405)"
  - "02-43: a skill load-check loads every simulated component; the lane store stays unpinned because write_lane_catalog refuses the staged effect manifests (rows 406, 407)"
  - "02-43: ACT-06 and FX-01 stay Pending (row 408)"
requirements-completed: []
coverage:
  - id: D1
    description: "Every skillgrp row bound to a visual root, reviewed dispatch or listed gap; exact sound rows only"
    requirement: ACT-06
    verification:
      - kind: unit
        ref: "tests/pipeline/test_skill_binding_table.py"
        status: pass
      - kind: other
        ref: "python -B scripts/actors/skill_binding_table.py --client E:/Lineage2-client --check"
        status: pass
    human_judgment: false
  - id: D2
    description: "Skill identity owner, ?skill= selection, lifted cap, catalog index answers"
    requirement: ACT-06
    verification:
      - kind: unit
        ref: "tests/unit/castSkillIndex.test.ts, tests/unit/nativeCatalogIndex.test.ts, tests/unit/nativeEffectComponents.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "skill:1011:1 converted, selected by ?skill= and listed in the harness preview; dispatch-required gap note"
    requirement: ACT-06
    verification:
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-skill-cast.spec.ts (5 passed)"
        status: pass
    human_judgment: false
  - id: D4
    description: "One batch slice and one skills sweep slice"
    requirement: FX-01
    verification:
      - kind: e2e
        ref: "LOAD_CHECK_KIND=skills LOAD_CHECK_LIMIT=20 load-sweep-skills.spec.ts (spec passed; 21 records, all failed on preview-loader limits)"
        status: pass
    human_judgment: true
    rationale: "Every recorded skill load is failed: the preview loader refuses multi-texture mesh emitters and random color multipliers; FX-01 owns that."
actuals:
  tokens: 30000
  tasks: 3
  commits: 4
plan_head_before: 3405a42b0d12c193aecd32c320b36f5f4790792f
plan_head_after: d24fdc8c182350d312a8ce61b8dd64a3177fd999
duration: 50min
completed: 2026-11-09
---

# Phase 2 Plan 43: Skill bindings and cast index Summary

**Every one of the 29,812 skillgrp rows now has one binding (12,236 visual-root rows over 245 roots, 1 reviewed source dispatch, 17,575 native-skill-dispatch-required), sounds bind only from the exact skillsoundgrp row, 22 roots are sealed as converted effect bundles in the actors lane store (3,064 skill keys), and the browser selects any converted skill bundle through one identity owner with `?skill=<id>:<level>`.**

## Performance

- Started 2026-11-09 10:15 Riga, finished 11:05 Riga.
- Tasks: 3 of 3. Commits: 4. Files: 29 changed, 10 of them new.

## Accomplishments

- `skill_binding_table.py` binds each (id, level) key and writes the committed census. `--check` passes. The census totals equal the decoded row count. There are no anomalies on this client.
- `convert_actors.py --skill 1011 --level 1` converts root `skill.wh.1011` into a sealed `skill-effect-root` unit in about 40 s. It stages the root into `artifacts/lane-store/actors/l2/effects/69c92b65.../`, which holds 5 components: 3 Mesh, 1 Beam record and 1 Sprite. It also writes 522 key records.
- The batch slice `--batch skills --limit 20` gave 15 converted roots and 5 gaps:
  - 4 decompiled classes with unsupported default-property syntax.
  - 1 MeshEmitter without a converted mesh.
- A 1-root rerun reported `alreadySealedRoots: 21` and converted the next root.
- Skills gap rows have 29,812 rows: 2,542 pass, 17,575 dispatch-required, 634 converter-refused, 522 `emitter-class-unported:Engine.BeamEmitter` and 8,539 pending.
- In the browser, `castSkillIndex.ts` owns skill identity. Changes:
  - `nativeCatalogIndex.ts` no longer has its private pattern.
  - `loadNativeEffectComponents` has no hard-coded bundle id and no 64-entry cap.
  - The preview snapshot now lists the components and the manifest id.

## Task commits

1. Task 1 (tracer): `a532752` feat(02-43): bind skill 1011 level 1 to its converted root bundle and select it with ?skill=. The tracer gate re-ran the binding test, the conversion, typecheck, the unit tests and the spec before Task 2.
2. Task 2: `1c44fee` feat(02-43): census every skillgrp row to one binding and test the ACT-06 edges
3. Task 3: `008b092` test(02-43): check the dispatch-required gap note and record skill:1011:1 with the sweep check. Docs: `d24fdc8`.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p test_skill_binding_table.py`: 19 tests OK.
- `pnpm test:pipeline`: 1,570 tests, OK (skipped=103).
- `pnpm test:unit`: 150 files, 2,004 tests passed (82 skipped).
- `pnpm typecheck`: exit 0.
- `sandbox-skill-cast.spec.ts` on `NATIVE_STORE_ROOT=actors DEV_PORT=5175`, run with 5173 and 5175 free: 5 passed.
- The `skill:1011:1` load-check record is in `artifacts/lane-store/actors/load-checks/6965638a....json`. Its status is `failed` with "multiple independent primitive texture/frame routes are not supported in one preview". The spec now records this key with the same check the sweep uses.
- Skills sweep slice: the spec passed. It checked 20 keys and skipped 1 already recorded. All 21 records are `failed` (18 on the multi-texture mesh route, 3 on a random `ColorMultiplierRange`).
- Screenshots in `artifacts/skill-evidence/`: `skill-1011-1-1440x900.png`, `skill-1011-1-932x430.png`, `skill-3-2-gap-1440x900.png`. Portrait 430 x 932 has no horizontal scroll. These runs use headless SwiftShader, so there is no FPS claim.
- Acceptance greps:
  - Each of these prints 0: `raw-source-dispatch"`, the `skillgrp` grep in `src`, `skillEffectComponentPattern`, `effectComponents.length <= 64`, `effect-class-unsupported` and the fallback grep.
  - 4 exported cast-index functions.
  - `--skill` appears 2 times.
  - `scrollWidth` appears 1 time, and `844|world=...|authored=1` appears 0 times.
  - The 3 new reasons are listed.
- `node scripts/check-lane-ownership.mjs --base 3405a42 --part skills-effects` was run after the last code commit `008b092` and before the docs commit. It exits 1:

```
lane actors: 3 foreign paths
scripts/native_assets_lib/effect_readiness.py
scripts/native_store/gap_census.py
src/runtime/attachSandboxCommandSheet.ts
```

All three are small tested changes recorded in OVERNIGHT-DECISIONS row 402.

## Deviations from plan

### Auto-fixed issues

1. **[Rule 3 - Blocking] The effect readiness inspector refused asset manifest v2.**
   - The current Converter writes `schemaVersion` 2. `effect_readiness.py` required 1, so no bundle could be staged.
   - It now accepts `SUPPORTED_ASSET_MANIFEST_VERSIONS`. Commit `a532752`, row 402.
2. **[Rule 1 - Bug] UModel exported no payload for static meshes when the converter worked under the long unit folder.**
   - The paths were too long.
   - `migrate_effect_bundle` takes an optional converter folder, and skills use the lane `converter` folder.
   - A simulated component without its resource now refuses the root instead of staging an unloadable manifest. Commit `a532752`, row 405.
3. **[Rule 3 - Blocking] The native route cannot start on the lane-only actors catalog** (same as 02-16, row 392).
   - The browser check runs on `tests/browser/harness/native-skill-effect.html?skill=` with the same loader and preview.
   - The gap note shows the catalog index lookup (lane coverage) instead of the sandbox sheet's `cast-skill` group. Row 397.
4. **[Rule 1 - Bug] The tracer spec first wrote `pass` for `skill:1011:1`, while the sweep check fails that root's keys.**
   - The spec now writes the outcome of `checkHarnessLoadKey`. Commit `008b092`, row 406.
5. **[Rule 3 - Blocking] A new module and three files outside the lane.**
   - `convert_actors.py` would pass 400 lines, so the skill conversion lives in `scripts/actors/skill_effect_conversion.py`.
   - `gap_census.py` must order the `skills` step.
   - `attachSandboxCommandSheet.ts` imported the removed Power Strike id constant. Row 402.

### Not done as written

- **Packing.** One root is one bundle, because `native_effect_bundle` reads one skill row per bundle. `pack_items_by_class_closure` only enforces the 96-class root limit. "97 classes split into two bundles" therefore holds trivially. Row 398.
- **DefaultReader reroute.** `DefaultReader` was not rerouted through `read_class_defaults_with_provenance`. It also feeds NPC profiles and the reviewed Power Strike dispatch digests. Row 403.
- **VertMesh.** VertMesh meshes are not converted, because the Converter has no VertMesh adapter. Row 404.
- **Batch session.** One Converter per bundle replaces one Converter and UELib session per batch. Conversions are shared through the lane converter cache.
- **Root conversion order.** Roots convert in first-key order from the first key with an exact sound row. 14 roots (25 keys) without such a key become `no-exact-skillsound-row` gaps when reached. Row 400.
- **Lane ownership.** The ownership check exits 1 with the three listed paths, not 0.

### Process deviations

- Task 2 behaviour was implemented together with the Task 1 tracer. Its tests were added after the code and passed on their first run, so there is no RED commit.

**Total deviations:** 5 auto-fixed (2 Rule 1, 3 Rule 3) and 6 scope adjustments, each recorded in a decision row.

## TDD gate compliance

There is no RED commit for Task 2 (see above). The binding tests cover every behaviour in the plan's list, and the unit tests cover the cast index, the lifted cap and the catalog index answers.

## Needs Human

- Restage: `write_lane_catalog.py --lane actors --plan` exits 1. It refuses the staged effect manifests' `sourceBundle` pin, `effect-source.json`. The exact error is quoted in the STATE.md line "Needs Human (plan 02-43)".

## Known stubs

None.

## Threat flags

None beyond the plan register:
- T-02-43-01: every client read goes through `require_reference_client` or `require_equal_file` inside `native_effect_bundle`, and the ledger inputs are lock records.
- T-02-43-02: `selectedCastSkill` accepts only canonical unpadded integers with level 1 or more.
- T-02-43-03: the manifest SHA-256 checks stay, the cast index refuses two records for one key, and `bundleId` must name the manifest.
- T-02-43-04: an allowlist test keeps gameplay fields out of binding rows. No `skillgrp` specifier appears in `src`.
- T-02-43-05: the batch preflight runs before each root, with a slice limit and sealed resume.

## Process cleanup

- Started by this plan:
  - Foreground and background Python conversions (exited).
  - The pipeline suite (exited).
  - Vitest (exited).
  - Five Playwright runs, each with its own `pnpm dev` web server on 5175, which Playwright stopped.
- `netstat -ano | grep LISTENING | grep -E ':(5173|5175) '` prints nothing.
- `ps -W` filtered on node, chrome, headless, python, umodel, vite and playwright shows only three `node.exe` processes from Oct 29 and one `python.exe` from Nov 7, which predate this plan. Nothing this plan started remains.
- The scratch probe bundles under `artifacts/scratch/02-43/` were removed.

## Next phase readiness

- Later runs continue with `python -B scripts/actors/convert_actors.py --client E:/Lineage2-client --batch skills --limit 20`. 223 roots remain.
- 02-44 can read `soundRowOrdinal` from the binding rows.
- 02-68 and 02-69 extend `recipes/actors/emitter-class-coverage.json` and `simulatedEffectEmitterClasses` together. A test keeps the two equal.

## Self-Check: PASSED

- FOUND: scripts/actors/skill_binding_table.py, scripts/actors/skill_effect_conversion.py, src/effects/castSkillIndex.ts, recipes/actors/emitter-class-coverage.json, docs/parts/skills-effects/skill-binding-census.json, tests/pipeline/test_skill_binding_table.py, tests/unit/castSkillIndex.test.ts, tests/browser/sandbox-skill-cast.spec.ts
- FOUND on HEAD: a532752, 1c44fee, 008b092, d24fdc8
