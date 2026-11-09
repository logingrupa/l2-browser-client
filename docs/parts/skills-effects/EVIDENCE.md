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

Lane catalog `7ab1cdcf97c76c81c169ec3f2d41174e4c14ccbbf8440c60b5ec6fe6865d35e7` (2026-11-09: 113 models, 4 NPC profile packs, 3,064 effect components; passes the NPC mesh join check, see docs/parts/npcs/EVIDENCE.md): 3,064 skill records over 17 staged manifests. Lane coverage pinned to it (`build_coverage_report.py --lane actors`): skills-effects 3,064 converted, 18,210 gap, 8,538 pending, loads 3,064 unverified.

### Browser

- `src/effects/castSkillIndex.ts` owns skill effect identity: `parseSkillEffectComponentId` (used by the catalog index), `buildCastSkillIndex` (refuses two records for one key), `lookupCastSkill` and `selectedCastSkill` (`?skill=<id>:<level>`).
- `loadNativeEffectComponents` loads the selected key, or Power Strike when nothing is selected. The 64-entry catalog cap is gone; the catalog byte limit of `readNativeCatalog` bounds it.
- Unsimulated emitter components parse as records without resources; the loader refuses them.

### Browser checks (headless SwiftShader, no FPS claims)

- `NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-skill-cast.spec.ts`: 5 passed. `tests/browser/harness/native-skill-effect.html?skill=1011:1` lists the 5 components of `interlude:skill-root:skill.wh.1011` (3 Mesh, 1 Beam record, 1 Sprite) and draws the first component the preview loader accepts. `?skill=3:2` shows `skill:3:2 gap: native-skill-dispatch-required` with no component. Portrait 430 x 932 has no horizontal scroll.
- Screenshots: `artifacts/skill-evidence/skill-1011-1-1440x900.png`, `skill-1011-1-932x430.png`, `skill-3-2-gap-1440x900.png`.
- Skills sweep slice (`LOAD_CHECK_KIND=skills LOAD_CHECK_LIMIT=20`), records in `artifacts/lane-store/actors/load-checks/6965638a....json`, 21 records, all `failed`: 18 `skill.wh.1011` keys on `multiple independent primitive texture/frame routes are not supported in one preview`, 3 `skill.wh.1012` keys on `only constant finite nonnegative ColorMultiplierRange is supported`.

## FX-01 emitter simulation core (plan 02-68, 2026-11-09)

Our own deterministic port of the UE2 emitter classes in plain TypeScript under `src/effects/particles/sim`, with Lineage2JS read only as a behaviour reference (DEC-OWN-12). No Babylon type, package, DOM or `src/runtime` import (`tests/unit/importBoundaries.particles.test.ts`); no Interlude binary was read (D4).

- Records: `parseEmitterRecord` and `parseEmitterActorRecord` read the bundle `effectiveProperties` (Interlude class defaults merged by the converter) and keep per-field provenance (`authored`, `class-default`, `ue-zero`). They refuse a wrong field type, a missing class default, an unsimulated class and MaxParticles outside 0 to 16384 with named `EmitterRecordError`s.
- Simulation: `SpriteEmitter` and `MeshEmitter` spawn, age, respawn, move, revolve, scale, colour, fade and lose velocity on float32 columns, one `src/shared/random.ts` emitter stream per emitter. Sprites report roll and column-major atlas cells; meshes report spin rotators and the material route (`UseMeshBlendMode=false` takes the DrawStyle particle material and `RenderTwoSided` from the record).
- Emitter actor: GlobalOffset, initial delay, warmup, AutoReset, AutoDestroy (with the bNoDelete and bStatic refusal), SpeedRate, bRotEmitter and LifeSpan over the emitters in array order. AutoReplay, VisibleLimit, non-unit DrawScale3D and CoordinateSystem=Absolute are listed as unresolved. Actor DrawScale is not applied to particles.
- Scheduler: `createEffectScheduler` steps every live effect through `createFixedStepAccumulator` at 1/60 s, at most 8 steps per frame with the backlog dropped, on the presentation clock frame delta.
- Gaps: collision, collision planes, actor forces, MeshSpawning, UseSkeletalLocationAs, SpawnFromOtherEmitter, UseRotationFrom=Normal, CoordinateSystem=RelativeRotation and WeatherEffect report `emitter-feature-unported:<property>` (actors gap reasons listVersion 6) and the rest of the emitter simulates.
- Rules: every rule is a row in [PARTICLE_SEMANTICS.md](PARTICLE_SEMANTICS.md), mirrored by `PARTICLE_CONSTANTS`; all reference rules run as unconfirmed defaults until POL-04.

| Check | Result |
| --- | --- |
| `tests/unit/spriteEmitter.test.ts` | synthetic sprite golden trace at seed 1, step 1/60, 0 ulp (168 rows); seed 2 differs; refusals |
| `tests/unit/meshEmitter.test.ts` | synthetic mesh golden trace with rotators; material route; unported features |
| `tests/unit/emitterActor.test.ts` | each actor rule; scheduler step count, cap and pause; another effect spawned between steps leaves a trace unchanged |
| Power Strike hash traces | `POWER_STRIKE_EFFECT_SOURCE=<effect-source.json>` matches `tests/fixtures/particles/power-strike.hashes.json` (source SHA-256 `ce79c8ac...`, seed 1, two actor trace hashes, no feature gaps); skips with a reason without it. p_u004_a is destroyed after 19 steps, s_u002_a after 101. |
| `tests/unit/importBoundaries.particles.test.ts` | 16 passed |
| `node tools/reference-overlap/referenceOverlap.mjs --area particles` | 110 blocking runs and 2,508 unreviewed reviewer runs, all structural (typed field tables, vector literals); report `artifacts/reference-overlap/02-68-particles.json`. Independent reviewer sign-off pending. |

Open for FX-01: RibbonEmitter, the L2 emitter natives (AdjustparticleLife, SetSizeScale, SetDelayed, Kill, Trigger), rendering through the material library and the Power Strike preview switch follow in 02-69. The closed-form preview modules stay until then.

### Clean-room rewrite of the overlap spans (2026-11-09)

The spans the overlap review could not clear were rewritten from UE2 sources only: the lock-equal Engine.dll `4dd2f63c...` and Core.dll `9462f87a...` (read through `scripts/reference_client_guard.py`, disassembled with capstone) and UELib decompiles of `Engine.ParticleEmitter`, `Engine.SpriteEmitter` and `Engine.Emitter` from Engine.u `9b04ff5c...`. Field offsets follow the decompiled declaration order (UObject is 0x34 bytes in this build; InitialDelay +0x474, TimeTillReset +0x484 and MaxActiveParticles +0x48C match the code). Behaviour is unchanged: the tests and golden traces pass as before, and a temporary old-against-new harness (not committed) matched every column, counter, outcome and atlas cell bit for bit over 600 random two-emitter actors of 220 steps.

- `particleEmitter.ts` step order and outcomes follow the per-emitter loop of `AEmitter::Tick` 0x1060BD00: Disabled skips, Initialize on the first tick, the InitialDelay countdown (a delayed emitter sets the actor's some-delayed flag), warm-up while not WarmedUp, then UpdateParticles when not AllParticlesDead (this clears the actor's all-dead flag), else the dead branch. The outcomes `disabled`, `delayed`, `running` and `dead` are those four states, in that branch order. Storage space follows the CoordinateSystem switch of `UParticleEmitter::SpawnParticle` 0x10604190 (jump table 0x10605608): Independent and Spray add the owner location at spawn.
- Reset follows `UParticleEmitter::Reset` 0x10603B80: clear ActiveParticles, ParticleIndex, OtherIndex, AllParticlesDead and WarmedUp, then draw InitialDelayRange, then AutoResetTimeRange. The dead branch follows the same Tick: emitter AutoReset without actor AutoReset counts TimeTillReset down and at 0 or less redraws it and calls Reset; otherwise emitter AutoDestroy without actor AutoDestroy sets Disabled.
- Warm-up follows the Tick block: one step of 1 / WarmupTicksPerSecond per warm-up tick across LifetimeRange centre times RelativeWarmupTime, then WarmedUp.
- `particleUpdate.ts` spawn loop follows `UParticleEmitter::SpawnParticles` 0x10605B40: spawn into ParticleIndex, then ActiveParticles = max(ActiveParticles, index + 1) and ParticleIndex advances modulo the slot count, each birth 1 / Rate older. The slot loop bound is Min(ActiveParticles, MaxActiveParticles) from `UpdateParticles` 0x10605DC0 (vtable +0x84); an inactive slot counts as dead.
- `particleSpawn.ts` polar start follows SpawnParticle 0x106042D9 to 0x106043E6: (X, Y, Z) = StartLocationPolarRange.GetRand, offset Z * (sin Y cos X, sin Y sin X, cos Y) with degrees * pi / 180; the shape tests (All, or box, sphere, polar) follow the same function.
- `particleRotation.ts` axes follow Core.dll `FCoords::operator/=(FRotator)` 0x10110240 (used by execGetAxes 0x10140C00): roll, pitch and yaw elemental coords composed through `FCoords::operator*=` 0x1010FCE0 and `TransformVectorBy` 0x1010F5B0. The closed-form rows equal that composition (0 difference in double precision over 20,000 rotators).
- `spriteEmitter.ts` blend weight follows `USpriteEmitter::FillVertexBuffer` 0x106EFD60 (0x106F0D47 to 0x106F0DA2): Frac = Pos - appFloor(Pos), byte = trunc(Frac * 255.0).

Where the binary differs and a test pins our behaviour, it is kept and reported, not changed:
- First tick: `Initialize` 0x10603F50 calls Reset (vtable +0x70), so Interlude draws AutoResetTimeRange right after InitialDelayRange; our first step draws only InitialDelayRange. The golden traces pin our draw sequence.
- Polar start: the binary uses `GMath.SinFloat` and `CosFloat`, which are 16384-entry table lookups (Core.dll 0x1010F480 and 0x1010F4C0); we use exact sin and cos. The synthetic sprite golden trace (Polar start) pins ours.
- Gates: the binary tests InitialDelay, WarmupTicksPerSecond, RelativeWarmupTime and SecondsBeforeInactive against != 0; we keep > 0, which differs only for negative authored values. The binary counts InactiveTime while its Inactive flag holds; we count seconds since `markDrawn`.
- Atlas blend: the binary stops the blend target when cell + 1 equals the cell count (End - Start, or U * V) and still writes the byte at the last cell; we hold the next cell at min(End, U * V - 1) and zero the weight there. The sprite test (cells 2 to 3) agrees with both.
- Float grouping: SpawnParticles computes the first birth age as (1 / Rate * OldLeftover + DeltaTime) - 1 / Rate in x87 precision, and the warm-up count as WarmupTicksPerSecond * (centre * RelativeWarmupTime); we keep DeltaTime - (1 - OldLeftover) * (1 / Rate) and (WarmupTicksPerSecond * centre) * RelativeWarmupTime in doubles.

## Open

- 223 roots wait for the resume command; 8,539 keys are pending.
- Loads: no skill key loads every simulated component yet; the preview loader refuses multi-texture mesh emitters and random color multipliers (FX-01).
- Beam, Ribbon and VertMesh wait for the FX-01 simulator kinds (Ribbon in 02-69, Beam and VertMesh in Phase 5); VertMesh meshes need a Converter adapter.
- Five roots are refused by the converter; their reasons are in the gap rows.
- Runtime presentation of a converted effect on a `skill-cast` event for skills other than Power Strike is integration wiring (`createNativeSliceEffects.ts`).
- The cast check still runs on the harness page; the dev store switch now serves the actors lane as its restage union, so the native route can start on it.
- Restage: actors lane catalog `7ab1cdcf97c76c81c169ec3f2d41174e4c14ccbbf8440c60b5ec6fe6865d35e7` (113 models, 4 NPC profile packs, 3,064 effect components) passes the mesh join check, and `write_lane_catalog.py --lane actors --plan` prints its merge command. The restage runs from the main checkout (docs/parts/npcs/EVIDENCE.md).

## Evidence

Recipe: `recipes/native-power-strike.json`. Notes: `docs/NATIVE_POWER_STRIKE.md`. Particle rules: `docs/parts/skills-effects/PARTICLE_SEMANTICS.md`. Plan summaries: `.planning/phases/02-stage-a-breadth/02-43-SUMMARY.md`, `02-68-SUMMARY.md`. Decisions: OVERNIGHT-DECISIONS rows 397 to 408 and 486 to 497.
