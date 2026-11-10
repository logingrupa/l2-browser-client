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
- `recipes/actors/emitter-class-coverage.json` lists the classes the simulator runs (`Engine.MeshEmitter`, `Engine.RibbonEmitter`, `Engine.SpriteEmitter`). A key passes only when every emitter class of its root is listed; otherwise it is `emitter-class-unported:<class>` (FX-01).

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
- Rules: every rule is a row in [PARTICLE_SEMANTICS.md](PARTICLE_SEMANTICS.md), mirrored by `PARTICLE_CONSTANTS`; reference rules run as unconfirmed defaults until POL-04 re-derives them. Ten rows carry Interlude evidence now (`confirmed-interlude` or `corrected-interlude`), and `PARTICLE_SIMULATOR_VERSION` is 2.

| Check | Result |
| --- | --- |
| `tests/unit/spriteEmitter.test.ts` | synthetic sprite golden trace at seed 1, step 1/60, 0 ulp (175 rows, regenerated for simulator version 2); seed 2 differs; refusals |
| `tests/unit/meshEmitter.test.ts` | synthetic mesh golden trace with rotators (274 rows, regenerated for simulator version 2); material route; unported features |
| `tests/unit/emitterActor.test.ts` | each actor rule; scheduler step count, cap and pause; another effect spawned between steps leaves a trace unchanged |
| Power Strike hash traces | `POWER_STRIKE_EFFECT_SOURCE=<effect-source.json>` matches `tests/fixtures/particles/power-strike.hashes.json` (source SHA-256 `ce79c8ac...`, seed 1, simulator version 2, two actor trace hashes, no feature gaps); skips with a reason without it. p_u004_a is destroyed after 19 steps, s_u002_a after 101, as before version 2. |
| `tests/unit/particleInterludeRules.test.ts` | the POL-04 corrections below; each case fails on simulator version 1 |
| `tests/unit/importBoundaries.particles.test.ts` | 16 passed |
| `node tools/reference-overlap/referenceOverlap.mjs --area particles` | 110 blocking runs and 2,508 unreviewed reviewer runs, all structural (typed field tables, vector literals); report `artifacts/reference-overlap/02-68-particles.json`. Independent reviewer sign-off pending. |


### Clean-room rewrite of the overlap spans (2026-11-09)

The spans the overlap review could not clear were rewritten from UE2 sources only: the lock-equal Engine.dll `4dd2f63c...` and Core.dll `9462f87a...` (read through `scripts/reference_client_guard.py`, disassembled with capstone) and UELib decompiles of `Engine.ParticleEmitter`, `Engine.SpriteEmitter` and `Engine.Emitter` from Engine.u `9b04ff5c...`. Field offsets follow the decompiled declaration order (UObject is 0x34 bytes in this build; InitialDelay +0x474, TimeTillReset +0x484 and MaxActiveParticles +0x48C match the code). Behaviour is unchanged: the tests and golden traces pass as before, and a temporary old-against-new harness (not committed) matched every column, counter, outcome and atlas cell bit for bit over 600 random two-emitter actors of 220 steps.

- `particleEmitter.ts` step order and outcomes follow the per-emitter loop of `AEmitter::Tick` 0x1060BD00: Disabled skips, Initialize on the first tick, the InitialDelay countdown (a delayed emitter sets the actor's some-delayed flag), warm-up while not WarmedUp, then UpdateParticles when not AllParticlesDead (this clears the actor's all-dead flag), else the dead branch. The outcomes `disabled`, `delayed`, `running` and `dead` are those four states, in that branch order. Storage space follows the CoordinateSystem switch of `UParticleEmitter::SpawnParticle` 0x10604190 (jump table 0x10605608): Independent and Spray add the owner location at spawn.
- Reset follows `UParticleEmitter::Reset` 0x10603B80: clear ActiveParticles, ParticleIndex, OtherIndex, AllParticlesDead and WarmedUp, then draw InitialDelayRange, then AutoResetTimeRange. The dead branch follows the same Tick: emitter AutoReset without actor AutoReset counts TimeTillReset down and at 0 or less redraws it and calls Reset; otherwise emitter AutoDestroy without actor AutoDestroy sets Disabled.
- Warm-up follows the Tick block: one step of 1 / WarmupTicksPerSecond per warm-up tick across LifetimeRange centre times RelativeWarmupTime, then WarmedUp.
- `particleUpdate.ts` spawn loop follows `UParticleEmitter::SpawnParticles` 0x10605B40: spawn into ParticleIndex, then ActiveParticles = max(ActiveParticles, index + 1) and ParticleIndex advances modulo the slot count, each birth 1 / Rate older. The slot loop bound is Min(ActiveParticles, MaxActiveParticles) from `UpdateParticles` 0x10605DC0 (vtable +0x84); an inactive slot counts as dead.
- `particleSpawn.ts` polar start follows SpawnParticle 0x106042D9 to 0x106043E6: (X, Y, Z) = StartLocationPolarRange.GetRand, offset Z * (sin Y cos X, sin Y sin X, cos Y) with degrees * pi / 180; the shape tests (All, or box, sphere, polar) follow the same function.
- `particleRotation.ts` axes follow Core.dll `FCoords::operator/=(FRotator)` 0x10110240 (used by execGetAxes 0x10140C00): roll, pitch and yaw elemental coords composed through `FCoords::operator*=` 0x1010FCE0 and `TransformVectorBy` 0x1010F5B0. The closed-form rows equal that composition (0 difference in double precision over 20,000 rotators).
- `spriteEmitter.ts` blend weight follows `USpriteEmitter::FillVertexBuffer` 0x106EFD60 (0x106F0D47 to 0x106F0DA2): Frac = Pos - appFloor(Pos), byte = trunc(Frac * 255.0).

POL-04 corrections (2026-11-09, simulator version 2). The rewrite found five places where the client differed from our tested behaviour; the binaries win, so each now follows the client, its constants row is `corrected-interlude` with the address as evidence, and the synthetic sprite and mesh golden traces and the Power Strike hashes were regenerated with `PARTICLE_GOLDEN_WRITE=1`:
- First step (`fx.first-step-draws`): `Initialize` 0x10603F50 calls Reset through vtable +0x70, so the first step draws InitialDelayRange and then AutoResetTimeRange, in that stream order.
- Polar start (`fx.polar-start`): the offset uses `FGlobalMath::SinFloat` and `CosFloat` (Core.dll 0x1010F480 and 0x1010F4C0), which index the one `fx.sine-table` in `src/shared/math/rotator.ts` at trunc(a * 65536 / 2pi); `sineOfRadiansFromTable` and `cosineOfRadiansFromTable` sit beside that table. Angles, the drawn polar vector and the three offsets are float32 stores, grouped as SinFloat(q) * (CosFloat(t) * r).
- Gates (`fx.delay-overshoot`, `fx.warmup`, `fx.inactive-gate`): InitialDelay, WarmupTicksPerSecond, RelativeWarmupTime and SecondsBeforeInactive are tested against != 0. InactiveTime counts only while the Inactive flag holds: each running step sets it and `markDrawn` clears it, as `UParticleEmitter::RenderParticles` 0x10603DD0 does.
- Atlas end of blend (`fx.atlas-cells`): `FillVertexBuffer` compares cell + 1 with the count (End - Start, or U * V) and keeps the cell there, otherwise targets cell + 1 unclamped, and writes the blend byte at every cell; r and Pos are float32 stores. No renderer reads `nextCell` yet; a target past the atlas wraps in the client.
- Float grouping (`fx.birth-ages`, `fx.warmup`, `fx.auto-initial-rate`): Leftover, InvRate, Start, each birth age, the Rate, the warm-up time and step and `FRange::GetCenter` (Core.dll 0x1010E670) are float32 stores in the client order. D3DDrv.dll creates its device with D3DCREATE_FPU_PRESERVE (0x1001DC26), so the x87 keeps the CRT default 53-bit precision: JavaScript doubles match its intermediates and `Math.fround` marks the float32 stores. The client sums the start location in float32 while we keep doubles until the column write.
- Spawn refusal (`fx.spawn-refusal`, 2026-11-09): `UParticleEmitter::SpawnParticle` 0x10604190 returns 0 before any draw when MaxParticles is 0, then without an Owner, then when KillPending is set, then when LifetimeRange.Max (float32) is not above 0 (guards 0x106041C3 to 0x106041F7). SpawnParticles 0x10605C40 then leaves ParticleIndex and ActiveParticles alone and moves on to the next birth age; nothing clears AllParticlesDead and the stream is untouched. `spawnParticle` now reports the refusal and the slot only advances on success. Every step here has an owner and Kill is not ported, so only the first and last guards can refuse. The golden traces and Power Strike hashes did not change.
- Sine table (`fx.sine-table`, 2026-11-09): Core.dll `FGlobalMath::FGlobalMath` 0x1014D330 fills SinTab (GMath +0x8C) with 16384 entries f32(appSin(fl(2i * pi) / 16384)), and SqrtTab (+0x1008C) with f32(sqrt(i / 16384)), which our code does not use. appSin 0x1012D720 jumps to the CRT sin 0x1017C430, which takes its SSE2 path 0x10186480: the CRT turns SSE2 math on at 0x1017FFEB from cpuid before the C++ initialisers run (`_cinit` 0x101833C6, then the GMath initialiser at 0x101C0010), and every FPU exception is masked. So the half-turn entry is f32(sin(pi)), not the x87 fsin value 1.2246063538223773e-16 a CPU without SSE2 would store, and our special entry is gone. `tests/unit/sharedMath.test.ts` computes every entry with a 192-bit sine and checks that each lies more than 2^-50 from a float32 rounding midpoint, so any sine accurate to a few ulps gives the same table. `tests/pipeline/test_world_static_placement.py` proves the placement converter table equal to it as well. The golden traces did not change.

## FX-01 playback, natives and ribbons (plan 02-69, 2026-11-10)

Effect playback runs on the simulator and the UE2 material library. The closed-form timelines, the per-slot pool and the preview material (`nativeEffectInitTimeline.ts`, `nativeEffectShotTimeline.ts`, `nativeEffectParticlePool.ts`, `nativeEffectMaterial.ts`) are deleted with their tests.

- Vertex stage: `src/effects/particles/render/particleInstances.ts` writes each live slot as one thin instance (matrix, colour, atlas cell, sprite half extent and roll) in browser axes through `sourcePositionToWorld`. Mesh particles draw T * R * S with the GLB primitive node transforms baked into the vertices; sprites face the camera in the vertex shader. Instance buffers grow with the emitter columns (threat T-02-69-01).
- Fragment stage: `particleMaterialBinding.ts` builds the material from `particleFragmentChain(DrawStyle)` with the record's ZTest, ZWrite, AlphaTest and RenderTwoSided, colour texel * particle colour, and sets `metadata.nativeEmitterOrdinal` on every effect mesh. No effect mesh sets `alphaIndex`. DrawStyle 3 and 6 keep the shipped pairs (`ALPHA_SCREENMODE`, `ALPHA_ONEONE`) until the swatch comparison is recorded; `particleMaterialBinding.test.ts` fails if they flip.
- `loadEffectComponent.ts` loads one emitter's geometry and its texture chain (AnimNext frames follow the library `selectTextureFrame`), and every mesh primitive gets its own material and texture. `emitterActorPlayback.ts` runs an emitter actor on `createEffectScheduler`; the init, shot and component previews play through it, and an AutoDestroy actor ends the preview.
- Natives: `emitterNatives.ts` applies AdjustparticleLife, SetSizeScale, SetDelayed, Kill and Trigger to a live emitter actor from a closed name list; an unknown name is refused (threat T-02-69-02). No module under `src/effects`, `src/ui`, `src/runtime` or `src/scene` calls it: the adapter-event placement layer is the only intended caller (`emitterNatives.test.ts`).
- RibbonEmitter: `ribbonEmitter.ts` samples, interpolates, drops and decays ribbon points from a point source and matches its synthetic golden trace at 0 ulp. `attachWeaponTrail` applies the fx.weapon-trail row and gives an EntityKind npc caster no trail. Ribbons simulate but do not draw yet: the staged manifest binds no RibbonEmitter texture (`ribbon-texture-unstaged`).
- Map emitters: `mapEmitterPlayback.ts` `playTileMapEmitters` spawns each placement on the scheduler and shows it only while `isPlacementVisible` (the 02-63 memberVisible) and the frustum test pass; hidden placements keep simulating.
- Coverage: `recipes/actors/emitter-class-coverage.json` listVersion 2 adds `Engine.RibbonEmitter`; BeamEmitter, VertMeshEmitter, SparkEmitter and TrailEmitter stay `emitter-class-unported:<class>`.
- Skeletal slots (MAT-01): `src/assets/native/nativeSkeletalMaterials.ts` binds a slot whose GLB material extras carry `nativeMaterialProgram` through `createNativeMaterial`; an unported program shows the library magenta diagnostic. No converted actor GLB carries a program id yet, so every slot reports `program-unconverted` and keeps its converted texture material; skinned slots report `library-vertex-stage-unskinned` because the library vertex stage has no skinning.

| Check | Result |
| --- | --- |
| `tests/unit/particleMaterialBinding.test.ts` | shipped DrawStyle 3 and 6 pairs, record depth, culling and alpha test, emitter ordinal metadata, instance matrices, atlas cells and overrides |
| `tests/unit/loadEffectComponent.test.ts`, `nativeEffectRetained.test.ts` | baked primitive geometry, per-primitive library materials, AnimNext frames, refusals and cleanup; all six retained Power Strike components render live particles |
| `tests/unit/ribbonEmitter.test.ts` | synthetic ribbon golden trace at seed 1, step 1/60, 0 ulp (334 rows); NPC caster gets no trail |
| `tests/unit/emitterNatives.test.ts`, `mapEmitterPlayback.test.ts`, `nativeSkeletalMaterials.test.ts` | each native as its row states; visibility gate; library and magenta slots |
| `DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-skill-cast.spec.ts` (shared store) | 4 passed: `?skill=3:1` plays `lineageeffect.s_u002_a` (init) and `lineageeffect.p_u004_a` (shot) to destruction with live particles drawn; screenshots `artifacts/skill-evidence/skill-3-1-cast-1440x900.png` and `skill-3-1-cast-932x430.png`; no horizontal scroll at 430 x 932 |
| `node tools/reference-overlap/referenceOverlap.mjs --area particles` | 547 blocking runs (479 are the GLSL source line array of `particleMaterialBinding.ts`), 2,552 unreviewed reviewer runs, 4 stale sign-offs; report `artifacts/reference-overlap/02-69-particles.json`. Independent reviewer sign-off pending. |

PTDS 3 and 6 stay as shipped until the swatch comparison with L2.exe is recorded here.

## Open

- 223 roots wait for the resume command; 8,539 keys are pending.
- Loads: the actors lane keys have not been rechecked since the loader runs on the simulator (FX-01).
- Ribbons draw once staging binds a RibbonEmitter texture; Beam and VertMesh wait for Phase 5, and VertMesh meshes need a Converter adapter.
- The emitter natives and the weapon trail need the adapter-event placement layer; the Power Strike previews do not call AdjustparticleLife yet.
- Tile map emitters need the 02-64 world binding to merge class defaults into the tile-emitters.json records and call `playTileMapEmitters`.
- Skeletal slot programs need the actor converter to write `nativeMaterialProgram` and the library vertex stage to skin.
- Five roots are refused by the converter; their reasons are in the gap rows.
- Runtime presentation of a converted effect on a `skill-cast` event for skills other than Power Strike is integration wiring (`createNativeSliceEffects.ts`).
- The cast check still runs on the harness page; the dev store switch now serves the actors lane as its restage union, so the native route can start on it.
- Restage: actors lane catalog `7ab1cdcf97c76c81c169ec3f2d41174e4c14ccbbf8440c60b5ec6fe6865d35e7` (113 models, 4 NPC profile packs, 3,064 effect components) passes the mesh join check, and `write_lane_catalog.py --lane actors --plan` prints its merge command. The restage runs from the main checkout (docs/parts/npcs/EVIDENCE.md).

## Evidence

Recipe: `recipes/native-power-strike.json`. Notes: `docs/NATIVE_POWER_STRIKE.md`. Particle rules: `docs/parts/skills-effects/PARTICLE_SEMANTICS.md`. Plan summaries: `.planning/phases/02-stage-a-breadth/02-43-SUMMARY.md`, `02-68-SUMMARY.md`, `02-69-SUMMARY.md`. Decisions: OVERNIGHT-DECISIONS rows 397 to 408, 486 to 497 and 642 to 655.
