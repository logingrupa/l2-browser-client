---
phase: 02-stage-a-breadth
plan: 60
subsystem: integration
tags: [materials, ue2, blend-table, fog, display-gamma, swatch, babylon, dec-own-12, mat-01]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-06 NATIVE_STORE_ROOT fixture lane store; 02-56 src/shared rotator, random streams and constants row; 02-57 overlap check; 02-59 program.json"
provides:
  - "src/materials/ue2/model/materialProgram.ts: parseMaterialProgram, MaterialProgram, MaterialProgramError, programNode, programField"
  - "src/materials/ue2/model/blendTable.ts: blendFactorsForMaterial, blendFactorsForParticleDrawStyle"
  - "src/materials/ue2/model/stagePlan.ts: compileMaterialStagePlan"
  - "src/materials/ue2/model/combiner.ts, modifiers.ts, textureFrames.ts (selectTextureFrame), fog.ts (evaluateFogState, FogState, fogFamilyForBlend), displayGamma.ts, materialFrame.ts"
  - "src/materials/ue2/model/constants/: one file per id family, MATERIAL_CONSTANT_TABLES index"
  - "src/materials/ue2/babylon/material.ts: createNativeMaterial, NativeMaterialUniforms, particleFragmentChain, selectTextureFrame"
  - "src/materials/ue2/babylon/loadNativeMaterial.ts: loadNativeMaterial, nativeMaterialProgramPath"
  - "tests/browser/harness/material-swatch.html swatch harness and tests/support/materialProgramFixture.ts"
affects: [02-64, 02-67, 02-69, 02-61, 02-62]

actuals:
  tokens: 50000
  tasks: 3
  commits: 3
plan_head_before: 5d6feba74bb956888d7e295bdfbfbc02f2ad2a5c
plan_head_after: dbf2b25eccd5b8ffe31b6f776e731ff6a9c44d76

tech-stack:
  added: []
  patterns:
    - "Material programs compile to a stage plan (samplers, colour sources, op tree); the GLSL fragment chain and the CPU twin evaluate the same plan"
    - "Every reference rule is a constants row keyed by enum ordinal in src/materials/ue2/model/constants/"
    - "Harness pages under tests/browser/harness/ read guarded query parameters and publish window.__<name> plus data attributes"

key-files:
  created:
    - src/materials/ue2/model/materialProgram.ts
    - src/materials/ue2/model/materialFieldValues.ts
    - src/materials/ue2/model/blendTable.ts
    - src/materials/ue2/model/stagePlan.ts
    - src/materials/ue2/model/combiner.ts
    - src/materials/ue2/model/modifiers.ts
    - src/materials/ue2/model/textureFrames.ts
    - src/materials/ue2/model/fog.ts
    - src/materials/ue2/model/displayGamma.ts
    - src/materials/ue2/model/materialFrame.ts
    - src/materials/ue2/model/constants/materialConstants.ts
    - src/materials/ue2/babylon/material.ts
    - src/materials/ue2/babylon/loadNativeMaterial.ts
    - src/materials/ue2/babylon/fragmentChain.ts
    - src/materials/ue2/babylon/blendState.ts
    - src/materials/ue2/babylon/fogUniforms.ts
    - src/materials/ue2/babylon/particleFragmentChain.ts
    - tests/browser/harness/material-swatch.html
    - tests/browser/harness/materialSwatchHarness.ts
    - tests/browser/harness/materialSwatchParameters.ts
    - tests/browser/material-swatch.spec.ts
    - tests/support/materialProgramFixture.ts
    - tests/unit/materialProgram.test.ts
    - tests/unit/materialSwatchParameters.test.ts
    - tests/unit/ue2BlendTable.test.ts
    - tests/unit/ue2Combiner.test.ts
    - tests/unit/ue2Modifiers.test.ts
    - tests/unit/ue2Fog.test.ts
    - tests/unit/importBoundaries.materials.test.ts
  modified:
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Swatch route is a dev-only harness page; the material id is the program SHA-256 (row 246)"
  - "One blend table keyed by enum ordinal; Babylon preset mapping in blendState.ts; DESTCOLOR, SRCCOLOR is a named diagnostic (row 247)"
  - "OB_Brighten and OB_Translucent rows are confirmed-interlude from docs/NATIVE_FLAMES.md:9, all other reference pairs unconfirmed (row 248)"
  - "GLSL ShaderMaterial over WGSL (row 249)"
  - "Texture nodes carry an image pin {path, sha256, bytes}; real 02-59 programs render texture-image-absent until the converter writes it (row 250)"
  - "Constants split into one file per id family (row 251); open rules are unknown rows (row 252); absent enum fields are unported, never an assumed member (row 253)"
  - "Materials overlap exits 1 with 171 generic blocking runs: docs and cleanup still run, MAT-01 stays Pending, Needs Human (row 254)"
  - "Display gamma PostProcess left to 02-67 (row 255); swatch readback reorders bgra8unorm (row 256); MAT-01 stays Pending (row 257)"

patterns-established:
  - "World (02-64) and actors (02-69) import only src/materials/ue2/babylon/material.ts"

requirements-completed: []

coverage:
  - deliverable: "Program parser with provenance and guard clauses"
    human_judgment: false
    verification:
      - {kind: test, ref: "tests/unit/materialProgram.test.ts", status: pass}
  - deliverable: "Blend table, constants rows and particle draw styles"
    human_judgment: false
    verification:
      - {kind: test, ref: "tests/unit/ue2BlendTable.test.ts", status: pass}
  - deliverable: "Combiner, modifiers, texture frames, fog and display gamma"
    human_judgment: false
    verification:
      - {kind: test, ref: "tests/unit/ue2Combiner.test.ts", status: pass}
      - {kind: test, ref: "tests/unit/ue2Modifiers.test.ts", status: pass}
      - {kind: test, ref: "tests/unit/ue2Fog.test.ts", status: pass}
  - deliverable: "One Babylon factory and the swatch harness"
    human_judgment: false
    verification:
      - {kind: test, ref: "tests/unit/materialProgram.test.ts#createNativeMaterial", status: pass}
      - {kind: browser, ref: "tests/browser/material-swatch.spec.ts", status: pass}
  - deliverable: "Model import boundary"
    human_judgment: false
    verification:
      - {kind: test, ref: "tests/unit/importBoundaries.materials.test.ts", status: pass}
  - deliverable: "Clean-room overlap sign-off"
    human_judgment: true
    verification:
      - {kind: command, ref: "node tools/reference-overlap/referenceOverlap.mjs --area materials --reference-root C:/laragon/www/l2-browser-client", status: fail}

duration: 40min
completed: 2026-11-09
---

# Phase 2 Plan 60: UE2 material runtime library and swatch Summary

**A Babylon-free UE2 material model parses 02-59 programs, compiles them to a stage plan and evaluates Shader, Combiner, FinalBlend, colour sources, UV modifiers, texture frames, one blend table, fog with `fogEnd` and the display gamma ramp in the byte domain; one GLSL `ShaderMaterial` factory renders any served program id on the swatch harness, and unported classes render the named magenta diagnostic.**

## Performance

- Duration: about 40 min (22:03 to 22:45 UTC, 2026-11-08), including three swatch Playwright runs and one full `pnpm test:unit`.
- Tasks: 3 of 3.
- Files: 29 created (plus 3 fixture files), 4 docs modified.

## Accomplishments

- `parseMaterialProgram` refuses an unknown reviewed class, a missing provenance, a dangling node reference, an unported node without its reason and any texture reference that is not a SHA-256 `/l2/` pin; raw Rotator and Color structs decode as 02-59 writes them (colour byte order is the `colour.byte-order` row, B, G, R, A).
- `compileMaterialStagePlan` gives samplers (AnimNext frames, outermost-first coordinate modifiers, clamp modes, texture size), colour sources and an op tree; every gap is a named reason (`material-class-unported:<class>`, `material-feature-unported:<field>`, `texture-image-absent:<node>`, `material-combiner-mask-absent:<node>`).
- `blendTable.ts` is the one table for materials and particles; `fog.ts` applies preset, zone, L2FogInfo and water by precedence and exports `fogEnd`; `displayGamma.ts` builds the 256-entry ramp.
- `combiner.ts` holds every colour and alpha operation plus a CPU twin of the GLSL fragment chain; `modifiers.ts` holds TexPanner, TexRotator, TexOscillator (jitter from `tex-jitter`), TexScaler, TexEnvMap, TexCoordSource and FadeColor (byte-equal to `evaluateNativeFlameFade` at 12 samples); `textureFrames.ts` matches `selectNativeFlameFrame` at frame seams and steps MaterialSequence entries.
- `createNativeMaterial` builds the fragment chain, blend state, fog chunk and uniform layout, updates frames, matrices, colours and fog per frame, and exports `particleFragmentChain` and `selectTextureFrame` for 02-69.
- Swatch harness on the fixture lane store: the synthetic FinalBlend over Shader over Texture reads back `200, 100, 50` at the centre within 2/255 at 1440 x 900 and 932 x 430 (isMobile, hasTouch); the `TexOscillatorTriggered` program renders magenta with `data-unported-class`; portrait 430 x 932 has no horizontal scroll.

## Task commits

1. Task 1 (tracer): `16a5f85` feat(02-60): render a served UE2 material program on the swatch harness through one factory and blend table (MAT-01)
2. Task 2: `e8453a1` feat(02-60): evaluate Combiner, modifiers, texture frames, fog and display gamma in the byte domain and bind them per frame (MAT-01)
3. Task 3: `dbf2b25` test(02-60): keep src/materials/ue2/model free of Babylon, packages, DOM globals and modules outside itself and src/shared (MAT-01)
4. Docs: the commit holding this summary, EVIDENCE, STATUS, STATE, ROADMAP and OVERNIGHT-DECISIONS rows 246 to 257

## Verification

| Check | Result |
|---|---|
| Tracer gate (Task 1 verify re-run end to end) | typecheck clean, `materialProgram.test.ts` pass, swatch spec 3 of 3 |
| `pnpm typecheck` | clean |
| Material unit tests (7 files) | 119 cases pass |
| `NATIVE_STORE_ROOT=fixture DEV_PORT=5175 pnpm test:e2e tests/browser/material-swatch.spec.ts` | 3 of 3 pass (SwiftShader, no FPS claim); 5173 and 5175 were free |
| `pnpm test:unit` | 1751 pass, 82 skipped, 2 fail: the known `nativeNpcProfiles.test.ts` red baseline |
| `grep -rc "@babylonjs" src/materials/ue2/model` | 0 in every file |
| `grep -ric "srgb\|toLinearSpace\|toGammaSpace" src/materials/ue2` | 0 in every file |
| Constants rows | every row has provenance and a shared status (`ue2BlendTable.test.ts`) |
| `grep -c "material library" docs/parts/adapter-dispatch/EVIDENCE.md` | 1 |
| `node scripts/check-lane-ownership.mjs --base 5d6feba --part adapter-dispatch` | lane integration: 0 foreign paths |
| Reference overlap `--area materials` | exit 1, 171 blocking runs (generic shapes, Needs Human) |

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] 02-59 programs carry no texture pixels**
- Found during: Task 1.
- Issue: Texture nodes in `program.json` hold fields only; the loader has no hash-pinned image to fetch.
- Fix: an optional `image: {path, sha256, bytes}` on Texture nodes, refused unless a SHA-256 `/l2/` pin; absent pins render `texture-image-absent:<node>`. Converter half open (row 250).
- Commit: `16a5f85`.

**2. [Rule 1 - Bug] Swatch readback byte order**
- Found during: Task 1 tracer run.
- Issue: WebGPU `readPixels` returned the swap-chain `bgra8unorm` order, so the texture read as `50, 100, 200`.
- Fix: the harness reorders by `navigator.gpu.getPreferredCanvasFormat()` (row 256).
- Commit: `16a5f85`.

**3. [Rule 3 - Blocking] File size**
- `materialConstants.ts` passed 400 lines; split into one file per id family with `materialConstants.ts` as the index (row 251). Commit `16a5f85`.

**4. [Rule 2 - Correctness] Extra modules and guards**
- `materialFieldValues.ts` (typed field readers, struct decode), `stagePlan.ts`, `materialFrame.ts`, `fragmentChain.ts`, `blendState.ts`, `fogUniforms.ts` and `particleFragmentChain.ts` were added beyond the plan's file list to keep each file small and single-purpose; `materialSwatchParameters.ts` guards the query (T-02-60-02) with its own unit test.
- The DOM-global scan in the boundary test ignores hyphenated and dotted text (`mat.self-illumination`); `parseMaterialProgram` names its argument `programDocument`. Commit `dbf2b25`.

### Process deviations

- Tests were written alongside the code rather than strictly before it for Task 1; Task 2 wrote `combiner.ts` before its test and the other three test files before their modules ran green; no RED record exists.
- PowerShell `Get-CimInstance` was refused by the session guard; cleanup was checked with `netstat` and `ps -W`. BelowNormal priority used `nice -n 10`.

**Total deviations:** 4 auto-fixed (1 bug, 2 blocking, 1 correctness). **Impact:** the plan's contracts hold; the texture pin is a new contract item for the converter.

## Known Stubs

None that block the plan goal. Named diagnostics instead of stand-ins: Detail textures, TexEnvMap and TexCoordSource channels above 0 on the GPU, the `DESTCOLOR, SRCCOLOR` pair, typed `MaterialSequence.SequenceItems`, lighting `L = 1` until MAT-02, and the display gamma PostProcess (02-67).

## Threat Flags

None beyond the plan's register. T-02-60-01: guard clauses on class, field, provenance, references and texture hashes. T-02-60-02: id pattern, decimal and bound guards; every fetch goes through `nativeResourceUrl` and is checked by SHA-256. T-02-SC: nothing installed.

## Needs Human

- The materials reference overlap run exits 1 with 171 blocking runs (generic object literals and guard chains matched in unrelated reference files; one match in the reference materials folder). A reviewer who did not write `src/materials/**` signs off, or the owner narrows the normalisation (STATE Needs Human, row 254). MAT-01 stays Pending.

## Process cleanup

This plan started Vitest runs, tsc, the lane check, the overlap tool, three Node scripts under `artifacts/02-60/` and three Playwright runs whose `pnpm dev` web server on 5175 Playwright stopped at exit; every one exited. After the plan `netstat -ano` shows no listener on 5173 or 5175, and `ps -W` shows no node, Vite, Playwright or browser process from this plan (only three `node.exe` from Oct 29, not started here).

## Self-Check: PASSED

- Files: all created files exist (`git diff --stat 5d6feba..dbf2b25`: 42 files, 3,471 insertions).
- Commits: `16a5f85`, `e8453a1` and `dbf2b25` are ancestors of HEAD.
