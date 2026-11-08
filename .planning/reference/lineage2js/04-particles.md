# UE2 particle emitters

> Reference notes, not decisions. `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md` win where they differ. IDs marked "(proposed)" belong to `plan/autonomous-roadmap` and are not in force until that branch adopts them. Constants with status `unconfirmed` come from C4 binaries and only become native rules after they are re-derived against Interlude. The clean-room, no-vendor and shared-module rules are in [README.md](README.md).

A UE2 particle effect is an Emitter actor that holds an ordered list of data-only emitter objects. Native Engine.dll code spawns, ages, moves and colors their particles every tick, and L2 adds natives that skills call to fit an effect to cast timing. Lineage2JS shows that a CPU simulation of this loop runs in a browser, and it records the order of operations. Its constants and addresses come from the C4 Engine.dll (fa3f0f2a...), it draws from unseeded Math.random, and several paths (collision, MeshSpawning, PTRS_Normal, RelativeRotation) are stubs or commented out. Interlude package data from our client confirms the fields, enums and defaults. These notes describe the loop in our words for FX-01 (proposed): a deterministic, seedable simulator in plain TypeScript under `src/effects/particles/sim`, a thin Babylon vertex stage on the MAT-01 fragment chain, golden traces and named gaps for everything unported. Phase 2 runs the reference rules as unconfirmed defaults. POL-04 re-derives them in Phase 5 against Interlude Engine.dll 4dd2f63c..., Core.dll 9462f87a... and D3DDrv.dll 05622dde.... These are reference notes, not decisions. `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md` win.

## Where it fits

- Requirements: `ACT-06`, `ARCH-01`, `ARCH-02`, `ARCH-03`, `ARCH-04`, `CONV-01`, `CONV-02`, `INT-01`, `WORLD-01`, `CHECK-01`, `POL-01`, `POL-04`, `PERF-01`, `PERF-02`, FX-01 (proposed), MAT-01 (proposed, 01-materials-fog.md), VIS-01 (proposed, 02-bsp-visibility.md)
- Phase: Phase 2: shared foundations, census, converter coverage, the FX-01 core with Sprite, Mesh and Ribbon emitters, synthetic golden traces, hash-pinned Power Strike traces, any-skill playback with named gaps, and map emitters through the world lane. Phase 3: CHECK-01 side-by-side, the PTDS 3 and 6 swatch, and semantic fixes. Phase 5: POL-04 static re-derivation against the Interlude binaries, Beam and VertMesh, map-emitter features and weather; POL-01 Power Strike thresholds. Phase 6: PERF-01 and PERF-02 measurements.
- Lane: actors (L2). Actors owns src/effects/** (including src/effects/particles/**), scripts/actors/**, scripts/native_effect_bundle.py, scripts/native_effect_registration.mjs, scripts/inspect-native-effect-bundle.py, scripts/test_effect_readiness.py, recipes/actors/gap-reasons.json and docs/parts/skills-effects/**. Data-ui owns scripts/native_catalog/** (effects.py) and src/ui/**. Integration owns scripts/native_effects.py, scripts/stage-native-effect.mjs, scripts/native_assets_lib/** (effect_readiness.py, class_defaults.py), src/shared/**, src/world/sourceFrame.ts, src/materials/ue2/**, src/runtime/**, tools/reference-overlap/, tests/support/**, the docs/NATIVE_*.md files, docs/ARCHITECTURE.md and .planning/**. World owns the map Emitter actor export in scripts/world/** and its spawning in src/scene/world/**. tests/unit/**, tests/fixtures/**, tests/browser/** and tests/pipeline/** are shared by all lanes.

Owned paths:

- `src/effects/particles/sim/**`
- `src/effects/particles/render/**`
- `src/effects/particles/effectScheduler.ts`
- `src/effects/*.ts (migration of the closed-form preview modules)`
- `scripts/actors/emitter_census.py (new)`
- `scripts/native_effect_bundle.py`
- `scripts/inspect-native-effect-bundle.py`
- `scripts/native_effect_registration.mjs`
- `scripts/test_effect_readiness.py`
- `recipes/actors/gap-reasons.json (emitter reasons)`
- `docs/parts/skills-effects/PARTICLE_SEMANTICS.md (new)`
- `docs/parts/skills-effects/emitter-census.json (new)`
- `docs/parts/skills-effects/EVIDENCE.md (overlap sign-off, swatch result)`
- `tests/unit/particles/** (shared path)`
- `tests/unit/importBoundaries.particles.test.ts (shared path)`
- `tests/fixtures/particles/** (shared path)`
- `tests/browser/particles.spec.ts (shared path)`

## What the reference shows

| Topic | Where | What it shows |
|---|---|---|
| Emitter property decoding | `lineage2js/src/assets/unreal/emitters/un-particle-emitter.ts:357-524`, `lineage2js/src/assets/unreal/emitters/un-particle-emitter.ts:540-612`, `lineage2js/src/assets/unreal/emitters/un-particle-emitter.ts:818-939` | UE property names mapped to config fields, enum tables, the automatic initial rate and the single-key curve rule (591-607). Lines 347-353 declare UT2004 fields that Interlude lacks, and the property map never fills them. |
| Subclass decoding | `lineage2js/src/assets/unreal/emitters/un-sprite-emitter.ts:12-66`, `lineage2js/src/assets/unreal/emitters/un-mesh-emitter.ts:13-41`, `lineage2js/src/assets/unreal/emitters/un-vert-mesh-emitter.ts:5-25`, `lineage2js/src/assets/unreal/emitters/un-beam-emitter.ts:8-113`, `lineage2js/src/assets/unreal/emitters/un-ribbon-emitter.ts:6-64` | UseDirectionAs labels. MeshEmitter StaticMesh, UseMeshBlendMode, RenderTwoSided and UseParticleColor. Beam endpoints and noise. Ribbon fields, including the L2 additions AccDrop, PointsDropRate, ThresholdTime, ThresholdTime2, MinPoints, bUseInterpolation and ScaleRatio. |
| Emitter actor | `lineage2js/src/assets/decoders/object3d-decoder.ts:147-330`, `lineage2js/src/assets/decoders/object3d-decoder.ts:355-367`, `lineage2js/src/assets/unreal/un-emitter.ts:145-216` | GlobalOffset and reset-timer draws, emitter outcome aggregation, destroy gates (261-267), Kill (206-213), AdjustparticleLife (288-305), the rotating emitter clock (307-329) and ascending draw order. The actor scale is DrawScale3D * DrawScale. |
| Particle spawn | `lineage2js/src/objects/emitters/base-emitter.ts:682-998`, `lineage2js/src/objects/emitters/base-emitter.ts:1000-1041`, `lineage2js/src/objects/emitters/base-emitter.ts:639-661` | Spawn step order, the spawn-rate accumulator with spread birth ages, and the velocity-direction rule. |
| Particle update | `lineage2js/src/objects/emitters/base-emitter.ts:1043-1537` | Spray re-basing, rate selection, deferred spawns, aging and respawn, Euler motion, revolution, curves, fades, opacity, velocity clamp and loss, bounds and the dead rule. Collision is a stub (1255-1265). |
| Emitter state and natives | `lineage2js/src/objects/emitters/base-emitter.ts:294-431`, `lineage2js/src/objects/emitters/base-emitter.ts:663-677`, `lineage2js/src/objects/emitters/base-emitter.ts:1553-1637` | Kill, Trigger, Reset, SetDelayed, per-emitter AdjustparticleLife, SetSizeScale, SetSpeedScale, warmup, and the per-step order: delay, warmup, dead handling, SecondsBeforeInactive, update. |
| Sprite orientation, spin and atlas cells | `lineage2js/src/objects/emitters/sprite-emitter.ts:37-50`, `lineage2js/src/objects/emitters/sprite-emitter.ts:87-197`, `lineage2js/src/objects/emitters/base-emitter.ts:1680-1782`, `lineage2js/src/objects/emitters/base-emitter.ts:1832-1880` | UniformSize forced for PTDU_None, the basis per direction mode, the spin gate and axis mapping, column-major cells and byte-truncated blend weights. |
| Instanced sprite rendering | `lineage2js/src/objects/emitters/instanced-sprite-mesh.ts:25-120`, `lineage2js/src/objects/emitters/instanced-sprite-batcher.ts:15-53`, `lineage2js/src/objects/emitters/instanced-sprite-batcher.ts:294-364`, `lineage2js/src/materials/particle-material/shader/shader-particle-instanced.vs:37-104`, `lineage2js/src/materials/particle-material/shader/shader-particle.fs:25-31` | Per-instance attributes, billboarding in the vertex shader, merging across actors only for order-independent ONE/ONE emitters, and the subdivision blend. |
| Blend table and mesh particle materials | `lineage2js/src/materials/particle-material/particle-material.ts:146-201`, `lineage2js/src/materials/mesh-emitter-material/mesh-emitter-material.ts:55-68`, `lineage2js/src/objects/emitters/mesh-emitter.ts:22-56`, `lineage2js/src/objects/emitters/vert-mesh-emitter.ts:7-61` | DrawStyle to blend factors with destination alpha preserved, the particle-color rules for UseMeshBlendMode and UseParticleColor, and vertex-mesh frame stepping. |
| Beam and ribbon | `lineage2js/src/objects/emitters/beam-emitter.ts:39-73`, `lineage2js/src/objects/emitters/beam-emitter.ts:141-313`, `lineage2js/src/objects/emitters/ribbon-emitter.ts:44-285`, `lineage2js/src/objects/components/skill-effect-host.ts:224-246` | Beam endpoint modes, low and high frequency noise and sheets. Ribbon bone sampling, decay, the L2 threshold rules, Hermite interpolation and the weapon-trail attach constants. |
| Fixed tick | `lineage2js/src/physics/physics-manager.ts:50-54`, `lineage2js/src/physics/physics-manager.ts:83-102` | Emitters tick at 30 Hz with at most 8 catch-up ticks. The clock jumps when behind, and render state syncs once after the ticks. |
| Emitter culling | `lineage2js/src/objects/zone-object.ts:1809-1850`, `lineage2js/src/rendering/render-manager.ts:98-99`, `lineage2js/src/assets/unreal/un-package.ts:234` | Zone mask, 2D clip range and frustum test for map emitters with stored bounds. |
| Skill callers of the emitter natives | `lineage2js/src/assets/unreal/skills/skill-effect-placement.ts:146-151`, `lineage2js/src/assets/unreal/skills/skill-effect-placement.ts:344-355`, `lineage2js/src/assets/unreal/skills/skill-effect-placement.ts:505-545`, `lineage2js/src/assets/unreal/skills/skill-visual-effect.ts:157-164`, `lineage2js/src/assets/unreal/skills/skill-visual-effect.ts:427`, `lineage2js/src/assets/unreal/skills/native-effect-recipes.ts:86-87`, `lineage2js/src/objects/components/skill-effect-host.ts:191-208` | How cast timing drives SpeedRate, AdjustparticleLife, SetDelayed and SetSizeScale, and that the C4 Power Strike recipe also spawns LineageEffect.RibbonSet. |
| Rotator math | `lineage2js/src/assets/unreal/utils/rotator.ts:6-77` | Rotator to rotation through a 16384-entry float32 sine table. |
| Vendor dependencies | `lineage2js/package.json:37-48`, `lineage2js/configs/create-config.js:69-75`, `l2js-core/src/unreal/un-array.ts:9`, `l2js-core/src/unreal/un-property/un-property-tag.ts:101-112` | three, three-wasm, rapier, pako, gmp-wasm, blowfish, node-forge, chokidar and uuid, plus the l2js-core readers. The tag reader reads the array index as signed int8, so indices of 128 and above come out negative. |
| Interlude class data and Power Strike records (ours) | `artifacts/native-parity/migration/effects/power-strike-source-dispatch/source/classes/Engine.ParticleEmitter.uc`, `artifacts/native-parity/migration/effects/power-strike-source-dispatch/source/classes/Engine.SpriteEmitter.uc`, `artifacts/native-parity/migration/effects/power-strike-source-dispatch/source/classes/Engine.MeshEmitter.uc`, `artifacts/native-parity/migration/effects/power-strike-source-dispatch/source/classes/Engine.Emitter.uc`, `artifacts/native-parity/migration/effects/power-strike-source-dispatch/effect-source.json` | UELib decompile of Interlude Engine.u (field names, enums, defaults) and the six authored Power Strike emitters. These are working-tree outputs on DATABASE-PC, not committed source. |

## Behaviour to implement

### Notation and status

- `h` is the step the scheduler gives an actor, in seconds, and `h' = h * SpeedRate`.
- `u()` is a uniform draw in [0, 1) from the emitter's own stream.
- `R(r) = r.Max + (r.Min - r.Max) * u()` is the UE2 FRange draw. `RV(v) = (R(v.X), R(v.Y), R(v.Z))`. `LC = (LifetimeRange.Min + LifetimeRange.Max) / 2`.
- Positions are source units, UE2 units of about 1 cm with Z up. Spin and revolution use rotator units.
- Every rule below is Lineage2JS behaviour at the pinned commit unless it says Interlude data, and its addresses are C4. Each rule has a row in `docs/parts/skills-effects/PARTICLE_SEMANTICS.md` that stays unconfirmed until POL-04 re-derives it.
- `lineage2js/src/objects/emitters/base-emitter.ts:666` names a UE2 engine source file in a comment. Do not seek or use UE2 engine source.

### State

An Emitter actor keeps its emitters in array order. They step and draw in that order, and a spawn may read a sibling's particles, so the order is part of the semantics.

Each emitter has `MaxParticles` slots and these counters:
- `Active` is the highest slot used since the last reset, plus one. Only Reset lowers it, so the initial spawn rate applies once per reset.
- `Next` is the next slot to fill. It wraps at `MaxParticles`.
- `Frac` (spawn remainder), `Other` (sibling cursor), `Delay`, `ResetTimer` (drawn from the emitter's AutoResetTimeRange), `SpawnOnTrigger` and `Deferred`.
- The flags Disabled, Dead, WarmedUp and KillPending.

A slot holds Location, OldLocation, StartLocation, Velocity, VelocityMultiplier, Acceleration (Spray only), StartSize, Size, StartSpin, SpinRate, RevolutionCenter, RevolutionRate, RevolutionMultiplier, ColorMultiplier, Color, Time, MaxLifetime, Mass, Subdivision and the flags Active, NoTick and JustSpawned. The reference allocates `2 * MaxParticles` slots but reads only the first `MaxParticles` (`base-emitter.ts:594, 1159`), so `MaxParticles` slots are enough. Capacity grows only through ForcedMaxParticles before the first update.

### Actor tick

From `lineage2js/src/assets/decoders/object3d-decoder.ts:239-286`:
1. On the first tick, draw `GlobalOffset = RV(GlobalOffsetRange)` and `ResetTimer = R(TimeTillResetRange)`.
2. With bRotEmitter, the emitter rotation advances by `RotPerSecond * h'`. It is relative to the actor's initial rotation.
3. Step every emitter in array order. Each step returns disabled, delayed, dead or running.
4. Destroy the actor when AutoDestroy is set, the list is not empty, no emitter returned running, at least one is enabled and none is delayed. bStatic, bNoDelete or bDeleteMe refuses destruction. The reference also refuses when Role is not authority and bNetTemporary is false. Locally spawned effects are authority. The Interlude default bNoDelete=true means map emitters never auto-destroy. Both Power Strike actors set bNoDelete=False.
5. Otherwise, when no emitter returned running, AutoReset is set and AutoDestroy is not, `ResetTimer -= h'`. At zero or below, redraw GlobalOffset and ResetTimer, reset every emitter and re-arm the first-particle SpawnSound.
6. Actor LifeSpan > 0 destroys the actor when it runs out, by the general Actor rule. Whether it counts `h` or `h'` is open.

### Emitter step

From `base-emitter.ts:1566-1637`:
1. A disabled emitter returns disabled.
2. On first entry, draw `Delay = R(InitialDelayRange)`.
3. While `Delay > 0`, subtract `h'`. If it stays positive, return delayed. Otherwise set it to 0 and continue in the same step. The overshoot is dropped.
4. Copy the actor's GlobalOffset.
5. If not WarmedUp, record the owner location. When `RelativeWarmupTime > 0` and `WarmupTicksPerSecond > 0`, run `floor(WarmupTicksPerSecond * LC * RelativeWarmupTime)` updates of `1 / WarmupTicksPerSecond` each. Set WarmedUp. Reset clears the flag, so warmup reruns after every reset. The Interlude default WarmupTicksPerSecond is 0, which skips warmup.
6. If Dead and the emitter's AutoReset is set but the actor's is not, count ResetTimer down by `h'`. At zero, redraw it and Reset, which draws it again. Else, if the emitter's AutoDestroy is set and the actor's is not, set Disabled. Return dead.
7. If `SecondsBeforeInactive > 0` and the emitter has not been drawn for longer than that, skip the update and return running.
8. Run `Update(h')` and return running.

### Spawn scheduling

From `base-emitter.ts:1124-1156` and `1000-1041`, at the start of `Update(dt)`:
1. Rate. While `Active < MaxParticles`, the rate is `MaxParticles / LC` with AutomaticInitialSpawning, else InitialParticlesPerSecond. After that it is ParticlesPerSecond. Add SpawnOnTriggerPPS while `SpawnOnTrigger > 0`.
2. Count, only when `rate > 0` and not KillPending: `a = Frac + dt * rate`, `n = trunc(a)`, `Frac = a - n`, `s = 1 / rate`. Clamp n to `[0, MaxParticles]`. If SpawnOnTrigger is nonzero, also clamp n to it and subtract n from it.
3. Ages. Particle i, counted from 0, is born with age `dt - (1 - Frac_old) * s - i * s`, so births spread evenly across the step. It goes into slot Next with JustSpawned. Then `Active = max(Active, Next + 1)` and `Next = (Next + 1) mod MaxParticles`.
4. Independent path. If the owner moved more than 1 uu since the last update, shift particle i by `(oldOwner - owner) * (1 - (i + 1) / n)`.
5. Deferred. If not KillPending, spawn `min(Deferred, MaxParticles)` particles at age 0 and clear Deferred.

### Spawning one particle

`Spawn(slot, age, flags, offset)` runs these steps in order (`base-emitter.ts:682-998`):
1. Skip when MaxParticles is 0, KillPending is set or `LifetimeRange.Max <= 0`. The actor's first particle since reset plays the actor SpawnSound.
2. `Location = StartLocationOffset` and `Velocity = RV(StartVelocityRange)`. Spray captures the emitter Acceleration. With IndependentSprayAccel the reference maps it through the 3x3 part of the inverse emitter world matrix (world to emitter, inverse scale included), so the vector stays in world axes once the particle is placed.
3. Shape. Box adds `RV(StartLocationRange)`. Sphere adds a random unit vector times `R(SphereRadiusRange)`. Polar draws `(t, q, r) = RV(StartLocationPolarRange)` with t and q in degrees and adds `r * (sin q cos t, sin q sin t, cos q)` about source +Z. All adds box, sphere and polar in that order.
4. MeshSpawning and UseSkeletalLocationAs are gaps.
5. `Other += 1` on every spawn. If `AddLocationFromOtherEmitter >= 0` and that sibling has `Active > 0`, add the sibling's Location at index `Other mod sibling.Active`. Sibling indices clamp to the last emitter.
6. UseRotationFrom. Actor rotates Location by the owner rotation times RotationOffset. Offset rotates it by RotationOffset. Normal is a gap.
7. Draw `RevolutionCenter = RV(RevolutionCenterOffsetRange)` and `RevolutionRate = RV(RevolutionsPerSecondRange)`. Add GlobalOffset unless the caller passes the no-global-offset spawn flag, then add the caller offset. Set `OldLocation = StartLocation = Location`.
8. Draw ColorMultiplier from ColorMultiplierRange, `MaxLifetime = R(LifetimeRange)`, `Time = age + R(InitialTimeRange)` and `Mass = R(StartMassRange)`. Draw `StartSize = RV(StartSizeRange)`. UniformSize copies X into Y and Z. `Size = StartSize`.
9. `Velocity += A * age`. A is the Spray capture, the emitter Acceleration in world axes for Independent, or the emitter Acceleration otherwise. VelocityMultiplier and RevolutionMultiplier start at (1, 1, 1).
10. UseRotationFrom rotates Velocity as in step 6. Spray then rotates Location and Velocity by the actor's emitter rotation.
11. GetVelocityDirectionFrom. `d = normalize(Location)`, negated unless the system is Relative or Spray. StartPositionAndOwner sets `Velocity = -Velocity * d` and OwnerAndStartPosition sets `Velocity = Velocity * d`, both componentwise. AddRadial adds `d * R(StartVelocityRadialRange)`.
12. If `AddVelocityFromOtherEmitter >= 0` and that sibling has `Active > 0`, add `RV(AddVelocityMultiplierRange) * sibling.Velocity[Other mod sibling.Active]` componentwise.
13. Independent with `age > 0`: `Location -= ownerVelocity * age`, where `ownerVelocity = (owner - oldOwner) / clamp(lastStep, 0.001, 1)`. Then every system adds `Location += Velocity * age`.
14. `Mass = 1 / Mass` when nonzero.
15. Draw `StartSpin = RV(StartSpinRange)` and `SpinRate = RV(SpinsPerSecondRange)`. Per axis, negate SpinRate when that SpinCCWorCW component is greater than a fresh draw. Multiply both by 65535.
16. Subdivision. With UseRandomSubdivision it is `trunc(Start + (End - Start) * u())` when SubdivisionEnd is set, else `trunc(u() * U * V)`. Otherwise it is -1 and the cell follows age.
17. If `Time > MaxLifetime > 0`, spawn again into the same slot with age `Time mod MaxLifetime`.
18. Pick the ParticleSound, then clear Dead.

### Aging and respawn

For each slot below `min(MaxParticles, Active)` (`base-emitter.ts:1159-1191`):
1. An inactive slot counts as dead.
2. A slot without JustSpawned ages by `Time += dt`.
3. When `Time > MaxLifetime`, a slot without RespawnDeadParticles deactivates and counts as dead. With RespawnDeadParticles it respawns in place at `(Time - MaxLifetime + R(InitialTimeRange)) mod MaxLifetime`, or 0 when MaxLifetime <= 0, and gets JustSpawned. Spawn then adds a second `R(InitialTimeRange)`, so the reference applies InitialTimeRange twice on respawn. POL-04 checks whether that is native.

### Motion

Per live slot (`base-emitter.ts:1209-1253`):
1. The slot moves unless NoTick is set. Relative slots always move. A JustSpawned slot clears the flag and skips motion this step.
2. `Velocity += A * dt`, with A as in spawn step 9. Spray uses the slot's captured value.
3. Independent: `Location -= ownerDisplacement`, the owner's move since the last update. This keeps the particle fixed in the world while it is stored relative to the owner.
4. `OldLocation = Location`, then `Location += Velocity * VelocityMultiplier * dt` componentwise.
5. With UseRevolution, rotate `Location - RevolutionCenter` about X, then Y, then Z. Each angle starts from `RevolutionRate * RevolutionMultiplier * dt * 65535`, is truncated to an integer and quantized to the sine table (row fx.revolution-angle). The reference then takes the exact sine and cosine of the quantized angle. `src/shared/math/rotator.ts` records which rule this use follows.
6. Collision is a gap. With it, a collided particle slower than MinSquaredVelocity would get NoTick.

### Curves

`r = clamp(Time / MaxLifetime, 0, 1)`, or 0 when MaxLifetime is 0. A curve with `Repeats` uses the phase `p = frac(r * (Repeats + 1))`. Take the first key whose time is `>= p` and interpolate linearly from the previous key. Before the first key, interpolate from an implied key at time 0 with the identity value: size 1, multipliers (1, 1, 1), white. A first key at time 0 gives its own value.
- Size. UseSizeScale with UseRegularSizeScale gives the factor `1 / (1 + Time)`. UseSizeScale with UseRegularSizeScale false takes the SizeScale curve. `Size = StartSize * factor`.
- VelocityScale sets VelocityMultiplier and RevolutionScale sets RevolutionMultiplier. Both need MaxLifetime > 0.
- ColorScale needs MaxLifetime > 0. The interpolated channels are truncated to bytes and divided by 255. Only AlphaBlend takes alpha from the curve. Other styles keep alpha 1.
- Past the last key, size and color fall back to identity, while the velocity and revolution multipliers keep their last value. Authored curves usually end at time 1, so this rarely shows.
- The reference decoder keeps a ColorScale or VelocityScale curve only with two or more keys, but keeps SizeScale and RevolutionScale with one (`un-particle-emitter.ts:591-607`).

UseRegularSizeScale is the first POL-04 item. The Interlude default is true. Four of the five Power Strike emitters that author a SizeScale curve set UseRegularSizeScale=False. MeshEmitter5 sets UseSizeScale with no SizeScale keys, which fits a separate regular mode. The formula has no Interlude citation yet.

### Color, fades and opacity

Start from the curve color, or white without a curve (`base-emitter.ts:1422-1480`):
1. Reference quirk: with RespawnDeadParticles false and both ParticlesPerSecond and InitialParticlesPerSecond at 0, `rgb *= Opacity`. It never fires for Power Strike, whose InitialParticlesPerSecond is nonzero.
2. `rgb *= ColorMultiplier`.
3. Fade-out applies when FadeOut is set, `Time > FadeOutStartTime` and `MaxLifetime != FadeOutStartTime`. Then `f = (Time - FadeOutStartTime) / (MaxLifetime - FadeOutStartTime)` and `F = FadeOutFactor`. Otherwise fade-in applies when FadeIn is set, `FadeInEndTime != 0` and `Time < FadeInEndTime`. Then `f = (FadeInEndTime - Time) / FadeInEndTime` and `F = FadeInFactor`.
4. Modulated sets the color to `(0.5, 0.5, 0.5, 1 - f * F.W)`. AlphaBlend subtracts `f * F.W` from alpha. Other styles subtract `f * F` from RGBA. Clamp to [0, 1].
5. If `Opacity < 1` and the style is not Regular, AlphaBlend, Modulated and AlphaModulate multiply alpha by Opacity. The other styles multiply RGB.
6. Interlude OpacityRatio, set by AEmitter::SetOpacityRatio, has no reference rule and stays unresolved.

### Velocity limits, bounds and death

From `base-emitter.ts:1487-1531`:
1. Grow the emitter box by `Location +- max(Size) * radius`. The radius is the geometry radius: the sprite quad or the mesh bounding sphere.
2. Clamp each velocity axis to `+-MaxAbsVelocity` where that axis limit is nonzero.
3. `Velocity -= Velocity * RV(VelocityLossRange) * dt` componentwise, with a fresh draw per particle per step. This is explicit Euler, not exponential decay.
4. Set Dead when (`dead >= MaxParticles` or `Active - dead <= 0`) and (KillPending or (this step's rate is 0 and RespawnDeadParticles is false)). Otherwise clear it.

### L2 natives and control calls

The Interlude anchors for each native are in the Engine.dll anchor list under Interlude deltas.
- AdjustparticleLife(L): `maxForced = max(0, LifetimeRange.Max over emitters with ForcedLifeTime)`, `delta = L - maxForced`, and the actor's `EL_LifeSpan += delta`. An emitter with ForcedLifeTime shifts LifetimeRange.Min and Max by delta. If it also has ForcedFade, FadeOutStartTime shifts too. ForcedFade alone does nothing. With ForcedMaxParticles, `MaxParticles = trunc(trunc(InitialParticlesPerSecond) * (L - LC))`, using LC after the shift and keeping a negative result. Before the first update this also sets capacity.
- SetSizeScale(s) multiplies Acceleration, StartLocationRange, SphereRadiusRange, all three StartLocationPolarRange components (angles included), StartSizeRange and StartVelocityRange by s. We assume a gate on the actor's bSetSizeScale. The reference has none. Both Power Strike actors set bSetSizeScale=true.
- SetDelayed(t) adds t to InitialDelayRange.Min and Max. The Interlude export takes (float, int, int), and the two ints are unexplained.
- Kill on the actor kills every emitter: RespawnDeadParticles off, both rates 0, the emitter's own AutoReset and AutoDestroy off, KillPending on. It then sets the actor's AutoReset false and AutoDestroy true.
- Trigger acts only on a Disabled emitter. TriggerDisabled enables it, ResetOnTrigger resets it, `SpawnOnTrigger = trunc(SpawnOnTrigger + R(SpawnOnTriggerRange))`, and a nonzero result clears Dead.
- Reset sets Active, Next and Other to 0, clears Dead and WarmedUp, draws Delay and ResetTimer, records the owner location and clears every slot flag.
- SpawnParticle(n) adds n to Deferred.
- SetSpeedScale(s) divides LifetimeRange, FadeInEndTime and FadeOutStartTime by s. It multiplies InitialParticlesPerSecond, MinSquaredVelocity, SpinsPerSecondRange, StartVelocityRange and VelocityLossRange by s and Acceleration by `s^2`, and leaves ParticlesPerSecond alone. The reference also scales MaxAbsVelocity.X by `s^2`, Z by s and Y not at all, and replaces `s <= 0` with 0.001. Its only reference caller is a fishing float, so port it when an Interlude caller appears.

### Skill callers

The placement layer calls the natives. The simulator only exposes them. In the reference:
- Casting with `0 < visualTimeScale < 1` sets `SpeedRate = SpeedRate / visualTimeScale`.
- A casting effect with castStyle != 0 and ShotTime > 0 calls AdjustparticleLife with FixedLifeTime, or with `ShotTime + 0.2` when FixedLifeTime is 0. The native-binding path uses `ShotTime + 0` or `ShotTime + 1` by a recipe flag, and casting sound length can drive it too (`skill-visual-effect.ts:157-164, 427`).
- A negative SpawnDelay means `hitTime + SpawnDelay`. The delay is multiplied by visualTimeScale and applied with SetDelayed.
- Size scale is `CastingEffectScale * (bSizeScale ? CollisionRadius / 9 : 1)`. CastingEffectScale applies only to a pawn host that is not the target. SetSizeScale runs only when `abs(s - 1) > 1e-4`. The native-binding path uses a `radius > 11` threshold and no tolerance.

### Coordinate systems

- Relative particles live in the owner frame and draw with the owner's current transform times the emitter rotation.
- Independent offsets and velocities use world axes, because the emitter rotation is cancelled. The per-step owner displacement keeps the particles fixed in the world.
- Spray particles are born in the emitter frame, rotated by the emitter rotation, and stay fixed in the world afterwards. The reference stores them emitter-local and re-bases live slots through `Mnew^-1 * Mold` whenever the emitter matrix changes (`base-emitter.ts:1064-1087`).
- Absolute has no special path in the reference, so it behaves like Relative there. RelativeRotation has no reference code. Both wait for the census and POL-04.
- Actor DrawScale does not scale particles. The reference cancels it with `1 / DrawScale` on each emitter (`base-emitter.ts:634-636`). DrawScale3D still scales the particle space (`lineage2js/src/assets/unreal/un-emitter.ts:201, 233`). Power Strike uses DrawScale 0.05 and 0.02 with DrawScale3D (1, 1, 1).

### Sprite and mesh presentation

- Sprite basis in source space, before spin. None and Scale use the camera right and up. Up takes `d = normalize(Location - OldLocation)` as Up and `t = normalize(cross(d, Location - ViewLocation))` as Right. Right swaps the two. Forward treats d as the plane normal: Up is the normalized cross of d with a helper axis, and Right is the normalized cross of d with Up. Normal does the same with ProjectionNormal. UpAndNormal uses Up = d and Right = `normalize(cross(d, ProjectionNormal))`. RightAndNormal swaps them. The helper is (1, 0, 0), or (0, 1, 0) when `abs(d.X) >= 0.5`.
- Only PTDU_None forces UniformSize. PTDU_Scale also faces the camera but keeps X and Y separate.
- Spin applies only with SpinParticles. Sprite roll is `StartSpin.Z + Time * SpinRate.Z` in rotator units and turns Right and Up within the sprite plane. Mesh particles map spin X to Yaw, Y to Pitch and Z to Roll, each truncated to an integer.
- Corners are `Location +- Right * Size.X +- Up * Size.Y`, with Size as the half extent. The reference negates Right and Up before building the corners (`sprite-emitter.ts:190-191`), which turns the texture 180 degrees. Pin the UV orientation against a native capture.
- Age-driven cell. With SubdivisionEnd set, `count = max(1, End - Start)` and `cell = floor(r * count) + Start`. Otherwise `count = U * V` and `cell = floor(r * count)`. Clamp to `U * V - 1`. Cells are column-major: `v = cell mod V`, `u = floor(cell / V)`. BlendBetweenSubdivisions blends toward the next cell with weight `trunc(255 * frac(r * count)) / 255`, and the last cell holds.
- Mesh particles draw `T(Location) * R(rotator) * S(Size)`. UseMeshBlendMode keeps the mesh's own materials and ignores particle color. A VertMeshEmitter ignores particle color only with UseMeshBlendMode and without UseParticleColor. Otherwise the MAT-01 particle material for the DrawStyle applies, with RenderTwoSided, ZTest and ZWrite from the record.
- AEmitter::Render draws Emitters(i) in ascending order.

### Ribbon weapon trail

RibbonEmitter samples two bone points per sample and decays old points. It applies the L2 fields AccDrop, PointsDropRate, ThresholdTime, ThresholdTime2, MinPoints, bUseInterpolation and ScaleRatio, with cubic Hermite interpolation between points (`ribbon-emitter.ts:44-285`).

The reference attaches LineageEffect.RibbonSet to RightHandBone or LeftHandBone with start offset `0.53 * length`, end offset `1.06 * length`, width equal to the end offset, `ThresholdTime = 0.5 * ShotTime`, `ThresholdTime2 = ShotTime`, `FadeInEndTime = ShotTime / 3`, `FadeOutStartTime = ShotTime` and actor `LifeSpan = ShotTime + 0.8`. It skips low-detail clients and NPC casters. Our caster test reads EntityKind npc from the adapter contract. Weapon length is the first entry of a skeletal-mesh array times the mesh scale (`skill-effect-host.ts:229-236`), and its Interlude source is unknown. Phase 2 ports these rules from the reference behaviour as unconfirmed defaults. POL-04 re-derives them from URibbonEmitter UpdateParticles, GetNewRibbonPoint, SpawnParticle and APawn::AttachTrailer.

### Culling

For map emitters with stored bounds, the reference skips drawing in three cases (`zone-object.ts:1809-1850`):
1. The zone mask hides the zone.
2. The 2D distance from a point of the actor bounds to the camera is `>= GL2ActorCR * 2048`. GL2ActorCR is 4.0, so the limit is 8192 uu. Both are C4 values.
3. Neither that point nor any emitter's live box, grown by the largest particle extent, is in the frustum.

Effects attached to actors skip this test. Simulation continues while an emitter is hidden.

Our split follows VIS-01. The walk in [02-bsp-visibility.md](02-bsp-visibility.md) owns zone and range gating of map emitters and reports memberVisible per placement id. Its range row defaults to infinity, the most-visible value, until an Interlude source exists. The particles scheduler adds only the frustum test.

## Data inputs

| Input | Produced today by | Gap |
|---|---|---|
| Interlude binaries for re-derivation: Engine.dll 4dd2f63c..., Core.dll 9462f87a..., D3DDrv.dll 05622dde... | None in Phase 2. POL-04 reads them statically in Phase 5. They are never loaded or run. | One research note per anchor. The client root is a required argument with no default outside the repo, and inputs are named by SHA-256. |
| Emitter census over system/lineageeffect.u, LineageEffect3.u and every maps/*.unr (153 Lineage2Ver111 files, XOR 0xAC after a 28-byte header; 10 plain packages, versions 118 and 123) | The scripts/native_catalog readers (ue2.py Package and the tagged-property reader, data-ui) can read these packages. | No census script. scripts/actors/emitter_census.py must count classes, property names and enum values (CoordinateSystem, DrawStyle, UseDirectionAs, StartLocationShape, GetVelocityDirectionFrom, UseRotationFrom) per class and package from property tags, not name tables. |
| Emitter component records (effectiveProperties: UELib defaultproperties merged over Interlude class defaults) | scripts/native_catalog/effects.py (data-ui), called by scripts/native_effects.py (integration), writes effect-source.json effects[].children[].effectiveProperties. scripts/stage-native-effect.mjs (integration) builds the staged manifest actors[] and components[] under public/l2/effects/<sha>/. | RibbonEmitter and VertMeshEmitter are missing from ENGINE_CLASSES (effects.py:20-21), so they inherit no class defaults. scripts/native_assets_lib/class_defaults.py closes this by walking the class chain and tagging each value authored, class-default or ue-zero. Staging accepts only Sprite and Mesh (stage-native-effect.mjs:87-91, src/effects/nativeEffectComponents.ts:84, src/effects/loadEffectComponent.ts:149). scripts/native_assets_lib/effect_readiness.py:18 keys 'RotationSource' instead of UseRotationFrom. The UELib default (effects.py:17) and client default (native_effects.py:12) point outside the repo. |
| Emitter actor records | effect-source.json effects[].effectiveProperties and the staged actors[] | A test must prove the staged actor keeps the Emitters order, AutoDestroy, AutoReset, AutoReplay, GlobalOffsetRange, TimeTillResetRange, SpeedRate, bRotEmitter, RotPerSecond, the SpawnSound array, SoundRadius, SoundVolume, SoundLooping, SoundPitchMin and Max, VisibleLimit, VisibilityInterpRange, bSetSizeScale, bNoDelete, DrawScale, DrawScale3D, LifeSpan and EL_*. |
| Textures and frame data | PNGs and the textureGraph (AnimNext, MinFrameRate, MaxFrameRate) for sprite and mesh components. MAT-01's `src/materials/ue2/model/textureFrames.ts` ticks the frames. | Beam, Ribbon and VertMesh textures are not staged. |
| Meshes | MeshEmitter StaticMesh GLBs from UModel build1590 (CONV-02). The bounding radius for bounds and culling comes from the GLB. | MeshSpawning needs a native-order vertex stream (positions, normals, colors), and the GLB vertex order is unproven. VertMesh animation frames and frame rate have no export path. |
| Weapon trail | The LineageEffect.RibbonSet record. Bones are in the actor bundles. EntityKind npc arrives with the integration contract commit. | The Interlude weapon-length source, and whether skill 3 attaches the trail. |
| Skill driving | skillgrp hit time and cast style, SkillAction_LocateEffect fields, CastingEffectScale and CollisionRadius from the 02-43 binding table and actor profiles. Event timing arrives through GameWorldAdapter events. The five adapter methods stay frozen. | A placement layer that turns adapter events into emitter commands. |
| Map-placed emitters | None | A world-lane tile step in scripts/world/, registered in convert_tile.py, exports each Emitter actor once with placement id, Location, Rotation, DrawScale, DrawScale3D, zone (from scripts/world/bsp_leaf_membership.py), bounds and subobject records. VIS-01 membership and the FX-01 scheduler both read this export. |
| Golden fixtures | None committed. effect-source.json from the Power Strike source-dispatch run exists only in the working tree. | tests/fixtures/particles/ needs synthetic records we author, their full traces, and power-strike.hashes.json with the effect-source.json SHA-256, seed, step, simulator version and one trace SHA-256 per actor. No client record values are committed. The artifacts manifest.json has no components[] or actors[]. |

## Constants

| ID | Value | Provenance | Status | Runtime default |
|---|---|---|---|---|
| fx.frange-draw | `R(r) = Max + (Min - Max) * u`, u in [0, 1). `lineage2js/src/objects/emitters/beam-emitter.ts:41` uses the opposite order; do not copy it. | `lineage2js/src/objects/emitters/base-emitter.ts:2088`; re-derive at Core.dll FRange::GetRand 0x1010212B -> 0x1010E690 | unconfirmed | Reference form in `src/shared/random.ts` |
| fx.range-vector-order | One FRange draw per axis. The reference comment says the native draws Y before X and Z. Our streams are our own, so we fix X, Y, Z. | `lineage2js/src/assets/decoders/object3d-decoder.ts:231-234`; Core.dll FRangeVector::GetRand 0x10103E86 -> 0x1010EDE0 | unconfirmed | X, then Y, then Z |
| fx.spin-units | StartSpin, SpinsPerSecond and revolution angles scale by 65535 per turn. Rotators have 65536 per turn. | `base-emitter.ts:946-947, 1245` | unconfirmed | 65535 |
| fx.sine-table | 16384 float32 entries over one turn. Index `floor(a / 4) mod 16384` for integer angle a. Cosine is the sine of `a + 16384`. The reference returns 1.2246e-16 at the half-turn index. | `lineage2js/src/assets/unreal/utils/rotator.ts:72-77`; Core.dll FGlobalMath::SinTab 0x10103F49 -> 0x1010F430, CosTab 0x101040C5 -> 0x1010F450 | unconfirmed | Reference table in `src/shared/math/rotator.ts`, built once and rounded to float32 |
| fx.revolution-angle | `a = trunc(rate * multiplier * dt * 65535)`, `k = floor(a / 4) mod 16384`, angle `k * 2 * pi / 16384` rad, about X, then Y, then Z, with exact sine and cosine of the quantized angle | `base-emitter.ts:1241-1251`; Core.dll FVector::RotateAngleAxis 0x10103CBA -> 0x1010F8B0 | unconfirmed | Reference rule, recorded in rotator.ts as a table use |
| fx.warmup | `ticks = floor(WarmupTicksPerSecond * LC * RelativeWarmupTime)` of `1 / WarmupTicksPerSecond`; skipped when either input is <= 0; reruns after each Reset | `base-emitter.ts:663-677, 331, 1608-1614` | unconfirmed | Reference rule |
| fx.auto-initial-rate | `MaxParticles / LC` while `Active < MaxParticles` | `base-emitter.ts:1127-1135` | unconfirmed | Reference rule |
| fx.birth-ages | `age_i = dt - (1 - Frac_old) / rate - i / rate`; count clamped to MaxParticles and to SpawnOnTrigger | `base-emitter.ts:1008-1027`; UParticleEmitter::SpawnParticles 0x10302775 -> 0x10605B40 | unconfirmed | Reference rule |
| fx.independent-spawn-path | Owner velocity `= displacement / clamp(lastStep, 0.001, 1)`. The path shift runs only when the owner moved more than 1 uu. | `base-emitter.ts:918, 1023` | unconfirmed | Reference rule |
| fx.respawn-age | `(Time - MaxLifetime + R(InitialTimeRange)) mod MaxLifetime`, then Spawn adds another `R(InitialTimeRange)`; no motion that step | `base-emitter.ts:1171-1190, 853` | unconfirmed | Reference rule, double draw included |
| fx.velocity-loss | `Velocity -= Velocity * RV(VelocityLossRange) * dt` componentwise, fresh draw per particle per step, after the MaxAbsVelocity clamp | `base-emitter.ts:1492-1499` | unconfirmed | Reference rule |
| fx.curve-phase | `p = frac(r * (Repeats + 1))`; implied identity key at time 0 | `base-emitter.ts:1281, 1312, 1357, 1387` | unconfirmed | Reference rule |
| fx.regular-size-factor | `1 / (1 + Time)` with UseSizeScale and UseRegularSizeScale | `base-emitter.ts:1277-1279`; no Interlude citation yet; re-derive at UParticleEmitter::UpdateParticles 0x1030B81B -> 0x10605DC0 | unconfirmed | Reference rule |
| fx.color-curve-quant | Channels truncated to bytes, then divided by 255; only AlphaBlend takes alpha from the curve | `base-emitter.ts:1408-1415` | unconfirmed | Reference rule |
| fx.fades | Out `f = (Time - FadeOutStartTime) / (MaxLifetime - FadeOutStartTime)`. In `f = (FadeInEndTime - Time) / FadeInEndTime`. Modulated `(0.5, 0.5, 0.5, 1 - f * F.W)`, AlphaBlend `a -= f * F.W`, other styles `rgba -= f * F`; clamp to [0, 1]. | `base-emitter.ts:1434-1465` | unconfirmed | Reference rule |
| fx.opacity-channel | With `Opacity < 1` and a style other than Regular: alpha for AlphaBlend, Modulated and AlphaModulate, RGB otherwise. The zero-rate quirk `rgb *= Opacity` comes before ColorMultiplier. | `base-emitter.ts:1422-1432, 1468-1480` | unconfirmed | Reference rule, quirk included |
| fx.defaults.particle-emitter | CoordinateSystem=1 (Relative), MaxParticles=10, RespawnDeadParticles=true, AutomaticInitialSpawning=true, DrawStyle=3 (Translucent), LifetimeRange=4..4, StartSizeRange=100, UseRegularSizeScale=true, SpinCCWorCW=0.5, MaxAbsVelocity=10000, TriggerDisabled=true, StartMassRange=1, AlphaTest=true, ZTest=true, ZWrite absent (false), SecondsBeforeInactive absent (0), WarmupTicksPerSecond absent (0), Opacity=1, FadeInFactor=FadeOutFactor=1, AddLocationFromOtherEmitter=AddVelocityFromOtherEmitter=SpawnFromOtherEmitter=-1, AddVelocityMultiplierRange=1, ColorMultiplierRange=1, MeshScaleRange=1, VelocityScaleRange=1, MeshNormal=(0,0,1), UniformMeshScale=UniformVelocityScale=true, RelativeBoneIndexRange=0..1, LevelOfWeather=2, Texture=Engine.S_Emitter | `artifacts/native-parity/migration/effects/power-strike-source-dispatch/source/classes/Engine.ParticleEmitter.uc` (UELib, Interlude Engine.u) | ue2-data | These values, supplied by `scripts/native_assets_lib/class_defaults.py` |
| fx.defaults.sprite-mesh | SpriteEmitter: ProjectionNormal=(0,0,1), RefrUScale=RefrVScale=0.06. MeshEmitter: UseMeshBlendMode=true, StartSizeRange=1. | `artifacts/native-parity/migration/effects/power-strike-source-dispatch/source/classes/Engine.SpriteEmitter.uc`, `Engine.MeshEmitter.uc` | ue2-data | These values |
| fx.defaults.emitter-actor | SpeedRate=1, SoundPitchMin=SoundPitchMax=1, VisibilityInterpRange=500, bSetSizeScale=true, DrawType=10 (DT_Particle), Style=8 (STY_Particle), bNoDelete=true, RemoteRole=0 | `artifacts/native-parity/migration/effects/power-strike-source-dispatch/source/classes/Engine.Emitter.uc` | ue2-data | These values |
| fx.enums | EParticleCoordinateSystem 0 Independent, 1 Relative, 2 Absolute, 3 RelativeRotation, 4 Spray. EParticleDrawStyle 0 Regular, 1 AlphaBlend, 2 Modulated, 3 Translucent, 4 AlphaModulate_MightNotFogCorrectly, 5 Darken, 6 Brighten. EParticleDirectionUsage 0 None, 1 Up, 2 Right, 3 Forward, 4 Normal, 5 UpAndNormal, 6 RightAndNormal, 7 Scale. EParticleStartLocationShape 0 Box, 1 Sphere, 2 Polar, 3 All. EParticleVelocityDirection 0 None, 1 StartPositionAndOwner, 2 OwnerAndStartPosition, 3 AddRadial. EParticleRotationSource 0 None, 1 Actor, 2 Offset, 3 Normal. EParticleEffectAxis 0 NegativeX, 1 PositiveZ. EParticleMeshSpawning 0 None, 1 Linear, 2 Random. ESkelLocationUpdate 0 None, 1 SpawnOffset, 2 Location. EParticleParticleChoice 0 MaxParticle, 1 ParticlePerSecond. The class also declares EBlendMode. | `artifacts/native-parity/migration/effects/power-strike-source-dispatch/source/classes/Engine.ParticleEmitter.uc`, `Engine.SpriteEmitter.uc` | ue2-data | These ordinals |
| fx.forced-max-particles | `trunc(trunc(InitialParticlesPerSecond) * (L - LC))` with LC after the ForcedLifeTime shift; a negative result is kept | `base-emitter.ts:356-368`; AEmitter::SetParticleMaxParticles 0x10310681 -> 0x10608F40 | unconfirmed | Reference rule |
| fx.set-size-scale-fields | Acceleration, StartLocationRange, SphereRadiusRange, StartLocationPolarRange (all three components), StartSizeRange, StartVelocityRange | `base-emitter.ts:394-408`; AEmitter::SetSizeScale 0x10304C23 -> 0x1060AD10, execSetSizeScale 0x103123D7 -> 0x1069E570. The bSetSizeScale gate is our assumption. | unconfirmed | Reference field list, gated on the actor's bSetSizeScale (listed unresolved) |
| fx.skill-size-scale | `CastingEffectScale * (bSizeScale ? CollisionRadius / 9 : 1)`, applied when `abs(s - 1) > 1e-4`; native-binding path `radius > 11` | `lineage2js/src/assets/unreal/skills/skill-effect-placement.ts:344-351, 536-540` | unconfirmed | Reference rule with the 1e-4 tolerance |
| fx.casting-speed-lifetime | `SpeedRate /= visualTimeScale` for `0 < visualTimeScale < 1`; AdjustparticleLife(FixedLifeTime, or `ShotTime + 0.2` when it is 0) when castStyle != 0 and ShotTime > 0 | `skill-effect-placement.ts:510-518`; `lineage2js/src/assets/unreal/skills/skill-visual-effect.ts:427` | unconfirmed | Reference rule |
| fx.map-emitter-clip-range (VIS-01 registers the row) | Reference: skip drawing when `sqrt(dx^2 + dy^2) >= GL2ActorCR * 2048`, GL2ActorCR = 4.0, so 8192 uu | `lineage2js/src/objects/zone-object.ts:1822-1827`; `lineage2js/src/rendering/render-manager.ts:98-99`; `lineage2js/src/assets/unreal/un-package.ts:234`. The single row lives in `recipes/world/bsp-visibility.json`. | unconfirmed | Infinity until an Interlude source exists |
| fx.atlas-cells | Column-major: `v = cell mod V`, `u = floor(cell / V)`. With End set, `count = max(1, End - Start)` and `cell = floor(r * count) + Start`; else `count = U * V`. Clamp to `U * V - 1`. Blend weight `trunc(255 * frac(r * count)) / 255`. | `base-emitter.ts:1832-1880`; USpriteEmitter::FillVertexBuffer 0x1030A880 -> 0x106EFD60 | unconfirmed | Reference rule |
| fx.particle-blend-pairs (MAT-01 registers the row) | Regular ONE/ZERO; AlphaBlend SRC_ALPHA/ONE_MINUS_SRC_ALPHA; Modulated DST_COLOR/SRC_COLOR; Translucent ONE/ONE; AlphaModulate ONE/ONE_MINUS_SRC_ALPHA; Darken ZERO/ONE_MINUS_SRC_COLOR; Brighten ONE/ONE_MINUS_SRC_COLOR; destination alpha preserved (ZERO/ONE) | `lineage2js/src/materials/particle-material/particle-material.ts:146-201`. The single row lives in `src/materials/ue2/model/blendTable.ts`. | unconfirmed | Reference pairs. Styles 3 and 6 keep the shipped mapping until the PTDS 3 and 6 swatch comparison with L2.exe is recorded in `docs/parts/skills-effects/EVIDENCE.md`. |
| fx.polar-start | `(t, q, r) = RV(StartLocationPolarRange)`, t and q in degrees; offset `r * (sin q cos t, sin q sin t, cos q)` about source +Z | `base-emitter.ts:721-732` | unconfirmed | Reference rule |
| fx.sprite-spin-component | Roll from `StartSpin.Z + Time * SpinRate.Z`, gated by SpinParticles | `base-emitter.ts:1687-1694, 1747, 1768`; FillVertexBuffer 0x106EFD60 | unconfirmed | Z, as the reference |
| fx.mesh-rotator-mapping | Spin X to Yaw, Y to Pitch, Z to Roll, each truncated to an integer | `base-emitter.ts:1695-1697, 1761` | unconfirmed | Reference rule |
| fx.non-parallel-helper | (1, 0, 0), or (0, 1, 0) when `abs(d.X) >= 0.5` | `lineage2js/src/objects/emitters/sprite-emitter.ts:121-122`; Core.dll FVector::GetNonParallel 0x101037D8 -> 0x10116060 | unconfirmed | Reference rule in `src/shared/math/rotator.ts` |
| fx.weapon-trail | Start `0.53 * length`, end `1.06 * length`, width = end offset, ThresholdTime `0.5 * ShotTime`, ThresholdTime2 `ShotTime`, FadeInEndTime `ShotTime / 3`, FadeOutStartTime `ShotTime`, LifeSpan `ShotTime + 0.8` | `lineage2js/src/objects/emitters/ribbon-emitter.ts:98-109`; `lineage2js/src/objects/components/skill-effect-host.ts:238-242`; APawn::AttachTrailer 0x103110FE -> 0x104F2B40 | unconfirmed | Reference values; RibbonSet attaches to skill 3 and the attach is listed unresolved |
| fx.simulation-step | The reference ticks at a fixed 30 Hz with up to 8 catch-up ticks. Native AEmitter::Tick takes the frame DeltaTime, and any clamp is unknown. | `lineage2js/src/physics/physics-manager.ts:50-54, 90-98`; AEmitter::Tick 0x10310F96 -> 0x1060BD00 | unknown | 1/60 s through `src/shared/fixedStep.ts`, at most 8 steps per frame, backlog dropped |

## Interlude differences

| Item | Detail | How to confirm |
|---|---|---|
| Class set and content use | Interlude Engine.u defines ParticleEmitter, SpriteEmitter, MeshEmitter, BeamEmitter, RibbonEmitter, VertMeshEmitter, SparkEmitter and TrailEmitter. The reference has no Spark or Trail code. lineageeffect.u names SpriteEmitter, MeshEmitter, BeamEmitter, RibbonEmitter (LineageEffect.RibbonSet) and VertMeshEmitter. Spark and Trail appear in no package except Engine.u. Name-table presence across the 153 encrypted maps: SpriteEmitter 68, MeshEmitter 53, BeamEmitter 11, VertMeshEmitter 1, Ribbon, Spark and Trail 0. The plain 24_16, 24_18 and Lobby add Sprite and Mesh, and Lobby adds Beam. 20_20.unr has no Emitter actor. | The census counts property tags per class and package, not names. |
| Feature names in content | lineageeffect.u names UseRevolution, RelativeWarmupTime, WarmupTicksPerSecond, MeshSpawning, BlendBetweenSubdivisions, UseRandomSubdivision, UseSubdivisionScale, UseVelocityScale, AddLocationFromOtherEmitter, ResetOnTrigger, AutoReset, AutoDestroy, AutoReplay, bRotEmitter, bUseQuake, IndependentSprayAccel, UseDirectionAs, UseRotationFrom, RotationNormal, UseActorForces, SecondsBeforeInactive, FixedBoundingBox, ZWrite and bSetSizeScale. It does not name UseCollision, UseCollisionPlanes, SpawnFromOtherEmitter, UseSkeletalLocationAs, WeatherEffect or bUseLight. In maps, RelativeWarmupTime appears in 67 and WeatherEffect in 3. No map names UseCollision, UseActorForces or SecondsBeforeInactive. Actor forces and SecondsBeforeInactive are therefore used in content, through lineageeffect.u. | Census counts of authored values, including UseRotationFrom=Normal and CoordinateSystem 2 and 3. |
| Interlude-only fields | ParticleEmitter adds OpacityRatio (transient), LevelOfWeather, CheckLevelOfWeather, ParticleChoice, WeatherEffect, WeatherRangeTime, WeatherSoundCheck and a Name string. The Emitter actor's SpawnSound is an array with SoundLooping, SoundPitchMin and SoundPitchMax, where C4 has a single sound. The actor adds VisibleLimit, VisibilityInterpRange and bSetSizeScale and keeps AutoReplay, which the reference ignores. UseSubdivisionScale and SubdivisionScale exist and are used. The reference maps them to an ignored field (`un-particle-emitter.ts:441-442`). | POL-04 re-derives AutoReplay at AEmitter::Tick 0x1060BD00, OpacityRatio at SetOpacityRatio 0x10609C30, SetOpacity at 0x10609B30 and subdivision scale at FillVertexBuffer 0x106EFD60. |
| Fields the reference declares but Interlude lacks | ScaleSizeXByVelocity (and Y, Z), AddVelocityFromOwner, DetermineVelocityByLocationDifference, UseAbsoluteTimeForSizeScale and RotateVelocityLossRange. Do not port them. | Absent from the UELib decompile of Engine.ParticleEmitter. |
| Defaults that differ from stock UE2 | CoordinateSystem defaults to Relative, DrawStyle to Translucent, AutomaticInitialSpawning and RespawnDeadParticles to true, SecondsBeforeInactive to 0 and UseRegularSizeScale to true. MeshEmitter defaults to UseMeshBlendMode=true and StartSizeRange=1. | Already read from Interlude Engine.u. |
| Engine.dll anchors (image base 0x10300000, thunk -> body) | UParticleEmitter: UpdateParticles 0x1030B81B -> 0x10605DC0, SpawnParticle 0x103122EC -> 0x10604190, SpawnParticles 0x10302775 -> 0x10605B40, Reset 0x10302A3B -> 0x10603B80, Initialize 0x10311DDD -> 0x10603F50, Scale 0x10303D19 -> 0x10603C80, execTrigger 0x1031252B -> 0x106037F0, execSpawnParticle 0x1030B050 -> 0x106036F0. AEmitter: Tick 0x10310F96 -> 0x1060BD00, Render 0x1030371F -> 0x1060A580, AdjustparticleLife 0x1031205D -> 0x1060AC50, SetParticleLifeTimeRange 0x10302810 -> 0x10608E00, SetParticleMaxParticles 0x10310681 -> 0x10608F40, SetSizeScale 0x10304C23 -> 0x1060AD10, execSetSizeScale 0x103123D7 -> 0x1069E570, SetSpeedScale 0x10313CA0 -> 0x10609060, SetSpeedRate 0x10303639 -> 0x10342AF0, SetDelayed 0x103070AE -> 0x10609600, EmitterRotation 0x10313B79 -> 0x106096F0, SetOpacity 0x10304890 -> 0x10609B30, SetOpacityRatio 0x10309FE3 -> 0x10609C30, CheckFirstSpawnParticle 0x1031067C -> 0x10609980, Kill 0x1030D445 -> 0x10608BC0, execKill 0x1030DA85 -> 0x10608B50. USpriteEmitter: Initialize 0x1030D6ED -> 0x106EF830, UpdateParticles 0x1030405C -> 0x106EFA50, FillVertexBuffer 0x1030A880 -> 0x106EFD60, RenderParticles 0x10306D2F -> 0x106F1C80. UMeshEmitter: Initialize 0x105E6AB0, UpdateParticles 0x105E6C70, RenderParticles 0x105E7300, Reset 0x105E7190, and no SpawnParticle override. URibbonEmitter: SpawnParticle 0x10692B40, GetNewRibbonPoint 0x10692D10, UpdateParticles 0x10693C50. UBeamEmitter: Initialize 0x10535430, SpawnParticle 0x10535B40, UpdateParticles 0x10536BC0, RenderParticles 0x10537560. UVertMeshEmitter: UpdateParticles 0x10754520, RenderParticles 0x10754730, SpawnParticle 0x107569A0. UParticleMaterial::StaticClass 0x1030F24F -> 0x10347FB0. APawn::AttachTrailer 0x103110FE -> 0x104F2B40. | Export table plus the jmp target of each thunk, read statically. These anchors resolved on the Interlude client (SHA-256 4dd2f63c...). |
| Core.dll anchors (SHA-256 9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf, base 0x10100000) | FRange::GetRand 0x1010212B -> 0x1010E690, FRangeVector::GetRand 0x10103E86 -> 0x1010EDE0, FVector::RotateAngleAxis 0x10103CBA -> 0x1010F8B0, FGlobalMath::SinTab 0x10103F49 -> 0x1010F430, CosTab 0x101040C5 -> 0x1010F450, FVector::GetNonParallel 0x101037D8 -> 0x10116060, FCoords::OrthoRotation 0x1010182A -> 0x1014DD90, appFrand 0x1010381E -> 0x1012D800. FX-01 cites Engine.dll, Core.dll or D3DDrv.dll. | Same static export read. |
| Signatures that differ from the reference | AEmitter::SetDelayed takes (float, int, int). APawn::AttachTrailer returns AActor* and takes (AActor*, int, float, int). SpawnParticle takes (int index, float spawnTime, int flags, int spawnFlags, const FVector& offset), which matches the reference shape. | Disassemble the bodies and their callers in the skill code. |
| Particle struct extras | The Interlude Particle struct also carries HitCount, BoneIndex, OldMeshLocation and an L2 Rotation whose native use is unknown. | Cross-reference the struct offsets that UpdateParticles and FillVertexBuffer use. |
| Power Strike authored values | All six emitters are Relative one-shot bursts: AutomaticInitialSpawning=False, RespawnDeadParticles=False, ParticlesPerSecond unset. Both actors set AutoDestroy=true, AutoReplay=true, bNoDelete=False, bSetSizeScale=true, SpeedRate 1 and DrawScale3D (1, 1, 1), with DrawScale 0.05 (s_u002_a) and 0.02 (p_u004_a). MeshEmitter2, SpriteEmitter2, SpriteEmitter9 and MeshEmitter15 have SizeScale curves with UseRegularSizeScale=False. MeshEmitter5 sets UseSizeScale without keys under the default UseRegularSizeScale=true. ColorScaleRepeats is 15 on MeshEmitter2 and 20 on SpriteEmitter2. MeshEmitter5's value of 1 is inert without UseColorScale. SpriteEmitter9 has a Polar shape, UseDirectionAs=Up, OwnerAndStartPosition, a 2x2 atlas with cells 2 to 3, no SpinParticles and no BlendBetweenSubdivisions. SpriteEmitter2 spins only on X. MeshEmitter2 and MeshEmitter5 use ForcedMaxParticles. SpriteEmitter2 uses ForcedLifeTime with ForcedFade. MeshEmitter5 has InitialDelayRange 0.5. All three mesh emitters set UseMeshBlendMode=false. DrawStyle is 3 except MeshEmitter5, which is 6 (Brighten). | The values are in effect-source.json. The committed fixtures pin its SHA-256 and copy no values. |
| Weapon trail for skill 3 | The C4 reference recipe spawns s_u002_a, p_u004_a and LineageEffect.RibbonSet. Our sourceDispatch bundle binds only s_u002_a (init) and p_u004_a (shot). Interlude has both RibbonSet and APawn::AttachTrailer. | The Phase 3 capture shows whether L2.exe draws a trail. POL-04 traces the callers of AttachTrailer in the Interlude skill path for skill 3 before POL-01. |
| Blend and fog setup | D3DDrv.dll (SHA-256 05622dde...) holds the fixed-function blend setup that UParticleMaterial feeds. No blend-table VA is known yet. | Locate the UParticleMaterial path from AEmitter::Render 0x1060A580 into D3DDrv in POL-04. The result feeds MAT-01's blendTable.ts and fog.ts ([01-materials-fog.md](01-materials-fog.md)). |

## Do not copy

- C4 addresses and constants as authority. Every `0x8...`, `0x9...` and `105D...` address in Lineage2JS belongs to the C4 Engine.dll (fa3f0f2a...). Re-derive against Interlude.
- Math.random draws everywhere (`base-emitter.ts:2088-2096`, `beam-emitter.ts:41`, `object3d-decoder.ts:232-236`).
- The beam draw order `min + u * (max - min)` (`lineage2js/src/objects/emitters/beam-emitter.ts:41`), which reverses the UE2 FRange order.
- Beam low-frequency scaling that uses the high-frequency noise range (`beam-emitter.ts:210`), a probable bug.
- VertMesh frames that advance at `framerate * SpeedRate` on a step that is already SpeedRate-scaled, so SpeedRate applies twice (`lineage2js/src/objects/emitters/vert-mesh-emitter.ts:40-49` with `base-emitter.ts:1592`).
- The removal fade (fadeOut and fadeFactor), which is not native (`base-emitter.ts:301-304, 1482-1485`; `lineage2js/src/objects/components/skill-effect-host.ts:68-83`).
- The warmupGate, a reference-only scheduling gate (`base-emitter.ts:1608`; `lineage2js/src/physics/physics-manager.ts:754-757`).
- Paths that start with a debug break or are commented out: MeshSpawning (`base-emitter.ts:736`), PTRS_Normal (825-834, 884-887), RotateVelocityLossRange (1089-1113), skeletal location (1116), collision (1255-1265) and AddVelocityFromOwner (903-904).
- UT2004 fields that Interlude lacks: ScaleSizeXByVelocity and its siblings, AddVelocityFromOwner, DetermineVelocityByLocationDifference and UseAbsoluteTimeForSizeScale (`un-particle-emitter.ts:347-353`; `base-emitter.ts:923-931, 1341-1352`).
- The blend hold test that compares an absolute cell with a relative count, which fails for SubdivisionStart > 0 (`base-emitter.ts:1876`).
- Its clock artefacts: returning disabled when currentTime is 0, and clamping its delta to 0.15 s (`base-emitter.ts:1567, 1591`).
- Culling that grows non-instanced boxes by an undefined extent (`zone-object.ts:1837` with `base-emitter.ts:1526`).
- Instanced rendering limited to some direction modes (`sprite-emitter.ts:49`). That is a renderer shortcut, not a rule.
- The l2js-core property-tag reader, which reads the array index as signed int8 (`l2js-core/src/unreal/un-property/un-property-tag.ts:101-112`).
- The UE2 engine source citation in a comment (`base-emitter.ts:666`). Do not seek or use UE2 engine source.

## Our code today

Code truth is native-world-slice at 22de53a, and plan/autonomous-roadmap (56bf9f7) has the same src/effects files. There is extraction but no simulation.

Converters:
- scripts/native_effects.py (integration) calls scripts/native_catalog/effects.py (data-ui), which decompiles effect classes with the pinned UELib. It inherits class defaults only for ENGINE_CLASSES (effects.py:20-21: ParticleEmitter, SpriteEmitter, MeshEmitter, BeamEmitter, Emitter). RibbonEmitter and VertMeshEmitter are missing.
- The UELib default (effects.py:17), the client default (native_effects.py:12) and source.clientRoot in recipes/native-parity.acceptance.json point outside the repo. The client root must be a required argument instead.
- scripts/native_effect_bundle.py adds reviewed dispatch evidence for Power Strike: s_u002_a for init, p_u004_a for shot, six emitters and 17 assets. Its DefaultReader is a second class-defaults reader. Emitter records live in effect-source.json effects[].children[].effectiveProperties, a working-tree output under artifacts/native-parity/migration/effects/power-strike-source-dispatch/. The manifest.json there has no components[] or actors[]. scripts/stage-native-effect.mjs builds those for the staged manifest.
- Staging and loading accept only Engine.SpriteEmitter and Engine.MeshEmitter (stage-native-effect.mjs:87-91, src/effects/nativeEffectComponents.ts:84, src/effects/loadEffectComponent.ts:149).
- scripts/native_assets_lib/effect_readiness.py:18 keys 'RotationSource'. The Interlude property is UseRotationFrom.

Browser:
- src/effects/nativeEffectInitTimeline.ts and nativeEffectShotTimeline.ts are closed-form evaluators hard-wired to the six Power Strike emitters. Their conventions differ from the UE2 loop: keyed FNV-1a sampling (InitTimeline.ts:122), exponential velocity loss (InitTimeline.ts:28, :253; ShotTimeline.ts:268), ColorScaleRepeats read as total cycles (InitTimeline.ts:26), sprite spin from X (InitTimeline.ts:29), row-major atlas cells (nativeEffectComponents.ts:160; ShotTimeline.ts:28), a polar convention around ProjectionNormal (ShotTimeline.ts:25), finite births with no respawn or AutoReplay, and the source-to-browser conversion inside the evaluator (InitTimeline.ts:258).
- src/effects/nativeEffectParticlePool.ts clones a node tree and a ShaderMaterial per slot. That gives one draw per particle, at most 512 slots and MaxParticles <= 256 (:113, :116, :120).
- src/effects/nativeEffectMaterial.ts accepts DrawStyle 3 and 6 only. It maps 3 (Translucent) to ALPHA_SCREENMODE and 6 (Brighten) to ALPHA_ONEONE (:152). That is the reverse of the reference pairs, Translucent ONE/ONE and Brighten ONE/ONE_MINUS_SRC_COLOR. MeshEmitter5 is Brighten.
- nativeEffectInitPreview.ts and nativeEffectShotPreview.ts import the timelines and the pool. loadEffectComponent.ts imports nativeEffectMaterial.ts. src/runtime/createNativeSliceRuntime.ts (integration), src/ui/nativeEffectInitControls.ts and src/ui/nativePowerStrikeControls.ts (data-ui) wire the previews.
- src/scene/world/nativeFlame*.ts (world) animates static-mesh flame placements. They are not Emitter actors.
- Tests are tests/unit/nativeEffect*.test.ts, nativePowerStrikeSource.test.ts and loadEffectComponent.test.ts. tests/unit/importBoundaries.test.ts exists only on plan/autonomous-roadmap and covers src/world only, yet docs/ARCHITECTURE.md:27 on native-world-slice cites it.

Missing: a general integrator, actor-level state, the L2 natives, Ribbon, Beam and VertMesh emitters, map-placed emitters, seeded per-emitter streams, thin-instance batching, golden traces and a boundary rule for particle code.

## Design

### Module layout

Everything lives under `src/effects/particles/`, inside the actors lane's `src/effects/**` claim.
- `sim/` is plain TypeScript: `keyTrack.ts` (curves with repeats), `emitterConfig.ts` (compiler), `particleStore.ts` (typed-array columns), `spawn.ts`, `update.ts`, `emitterState.ts` (delay, warmup, dead, reset, trigger, kill, deferred), `emitterActor.ts` (actor tick and natives), `frame.ts` (per-emitter output) and `trace.ts` (golden-trace rows). `kinds/ribbon.ts` lands in Phase 2. `kinds/beam.ts` and `kinds/vertMesh.ts` land in Phase 5.
- `effectScheduler.ts` is the fixed-step driver. It holds no Babylon types.
- `render/` is the only Babylon importer: `particleSpace.ts`, `spriteBatch.ts`, `meshBatch.ts`, `stripMesh.ts` and `particleMaterial.ts`, which holds the vertex stage.
- Integration's `src/shared/` supplies `random.ts`, `math/`, `math/rotator.ts`, `presentationClock.ts` and `fixedStep.ts`. `src/world/sourceFrame.ts` supplies the frame conversion. MAT-01 supplies the fragment chain, blend table, fog and texture frames.
- `frame.ts` carries, per emitter, the kind, the space (owner or world), the live count, typed arrays (location, oldLocation, size, rgba, rotation, cell UV and blend), bounds, strip arrays for ribbons, and sound events (actor SpawnSound, ParticleSound picks) for the audio layer.

### Determinism and parity

- Each emitter has one stream from `src/shared/random.ts`, seeded with `hash32(sessionSeed, emitter, effectSerial, emitterOrdinal)` under the emitter domain tag. The generator is sfc32 seeded through splitmix32. The effect serial follows adapter event order, so a replay reproduces it. Map emitters use their placement id in place of the serial.
- The unit vector takes two draws, z uniform in [-1, 1] and then the azimuth, so each spawn uses a fixed number of draws.
- Native draws come from Core.dll appFrand, one stream for the whole engine. We cannot match it, so parity is statistical. CHECK-01 and POL-01 compare occupancy, centroid and timing over at least five native repetitions against declared browser seeds.
- Particle columns are Float32Array, matching the native float fields. Steps compute in float64 and store through `Math.fround`. The sine table is built once and rounded to float32, which keeps traces stable across JavaScript engines.
- Spray and Independent particles are stored in world space after birth. That matches the reference's re-basing without a per-step matrix pass. Relative particles are stored in the owner frame.

### Constants registry

`docs/parts/skills-effects/PARTICLE_SEMANTICS.md` holds one row per rule in the shared shape `{id, value, provenance, status, interludeEvidence, runtimeDefault}` from [README.md](README.md). Status is ue2-data, unconfirmed, confirmed-interlude, corrected-interlude or unknown.
- Package-read values, the class defaults and enums, are ue2-data.
- Lineage2JS rules and our own assumptions, such as the SetSizeScale gate, are unconfirmed. The provenance says which.
- Values with no source, such as the native tick clamp, are unknown.
- `interludeEvidence` holds {binary SHA-256, export or VA, offset}. It stays empty until POL-04, and the anchor in the provenance cell is the target.
- The map-emitter clip range and the particle blend pairs are registered once by VIS-01 and MAT-01. PARTICLE_SEMANTICS.md points at those rows.

Phase 2 runs every unconfirmed row at its runtime default. Static reading of the Interlude binaries waits for Phase 5 (POL-04). No Phase 2 step in this note needs a binary read to show a visible result, so none records an exception. Binaries are read, never run.

### Config compiler, gaps and unresolved fields

`compileEmitterConfig(component, actor)` returns `{ config, unresolved }` or `{ gaps }`.
- The config is a discriminated union by kind in source units, seconds and rotator units, with enums resolved through the Interlude labels. It adds no default beyond the class defaults, which arrive tagged authored, class-default or ue-zero from `scripts/native_assets_lib/class_defaults.py`.
- A gap blocks the emitter. `emitter-class-unported:<class>` covers Beam and VertMesh until Phase 5, Spark, Trail and unknown classes. `emitter-feature-unported:<property>` covers UseCollision, UseCollisionPlanes, UseActorForces, MeshSpawning, UseSkeletalLocationAs, SpawnFromOtherEmitter, UseRotationFrom=Normal, CoordinateSystem=RelativeRotation and WeatherEffect.
- Actors registers both reasons in `recipes/actors/gap-reasons.json` with a listVersion bump. The actors effect-bundle step writes the gap rows.
- An unresolved field plays with a reference or assumed rule, and the coverage report lists it. The list is AutoReplay, VisibleLimit, VisibilityInterpRange, OpacityRatio, CoordinateSystem=Absolute, non-unit DrawScale3D, the SetSizeScale gate, the skill 3 RibbonSet attach and every unconfirmed row. Power Strike sets AutoReplay=true, so it plays with AutoReplay listed.

### Scheduler and callers

- `effectScheduler.ts` reads frame `dt` from `src/shared/presentationClock.ts`, which owns pause and seek. It steps through `src/shared/fixedStep.ts` at `PARTICLE_STEP_SECONDS`, 1/60 s, our choice under ARCH-04. It runs at most 8 steps per frame and drops the backlog, as the reference does. Movement consumes raw `dt` with its own substeps, so this step is particles-only. Replays drive the presentation clock at a fixed `dt`.
- It holds the live effect actors and their seeds. Each step it asks an injected `OwnerSampler` for every owner's location and rotation in source space, and for bone points for ribbons. The sim derives owner velocity from displacement.
- It passes back which emitters were drawn last frame, which SecondsBeforeInactive needs. That is presentation feedback under ARCH-04.
- The skill placement layer turns GameWorldAdapter skill events into commands: `spawnEffect(template, owner, { sizeScale, speedRate, delay, lifetime })`, `kill` and `trigger`. Neither the scheduler nor the placement layer decides hits or damage (ARCH-01, ARCH-02).

### Space conversion

`render/particleSpace.ts` wraps `src/world/sourceFrame.ts`. Positions map as `world = (x, z, y) * 0.01` and `source = (X, Z, Y) * 100`, and rotations are conjugated by the same reflection. Scenes are right-handed with Y up. The swap is a reflection, so a cross product computed after the mapping has the opposite sign of the mapped source cross product. Build sprite bases in source space, or flip the sign in the shader, and pin it with a test: a PTDU_Up sprite moving along source +X faces the camera with Up along its motion. OwnerSampler adapters that read Babylon bones use the sourceFrame inverse.

### Renderer

- A sprite emitter draws one quad Mesh with thin instances. `thinInstanceSetBuffer` carries the anchor matrix plus custom buffers for color (4), size and spin (3), cell UV (4), next-cell UV and weight (3) and direction (3). `thinInstanceCount` equals the live count, and buffers upload once per drawn frame. The vertex shader builds the basis per UseDirectionAs from camera axes, a per-emitter normal basis, or per-instance direction and view position.
- A mesh emitter draws the converted GLB primitive with thin instances, one `T * R * S` matrix and one color per particle.
- Ribbons, and later beams, use updatable VertexData strips.
- Particles own only the vertex stage. `src/materials/ue2/babylon/material.ts` supplies the fragment chain, the PTDS blend pair from `src/materials/ue2/model/blendTable.ts`, the particle fog family from `fog.ts`, `textureFrames.ts` and the uniform layout ([01-materials-fog.md](01-materials-fog.md)).
- By our reading of Babylon 9.27.1, presets match the RGB factor pair for AlphaBlend (ALPHA_COMBINE), Translucent (ALPHA_ONEONE), Brighten (ALPHA_SCREENMODE), AlphaModulate (ALPHA_PREMULTIPLIED) and Darken (ALPHA_SUBTRACT). Their alpha factors differ from the preserved destination alpha, and Modulated (DST_COLOR, SRC_COLOR) has no preset. The blend table decides presets or bind-time factors.
- Effect meshes set no absolute alphaIndex. Each mesh carries its actor key and emitter ordinal and reports the owning actor's position as its sort point. The integration comparator in `src/runtime` (`scene.setRenderingOrder`) sorts translucent meshes by distance, then by emitter ordinal. Array order holds inside an actor, and particles still sort against water and glass by depth.
- Batching across actors waits for PERF-02 and covers only order-independent ONE/ONE styles.
- Each emitter costs one draw per material slot. A missing texture shows the ARCH-03 diagnostic.
- A map emitter is hidden when VIS-01 reports its placement id as not memberVisible. Any effect is hidden when its sim box, passed through setBoundingInfo, is outside the frustum. Hidden effects keep simulating.

### Fixtures

Committed fixtures are synthetic, or indices and hashes only (`.planning/PROJECT.md:34`).
- `tests/fixtures/particles/synthetic-*.json` are records we author with our own values. Together they cover the features Power Strike uses: Polar shape, UseDirectionAs Up, OwnerAndStartPosition, a 2x2 atlas over cells 2 to 3, X-only spin, ForcedMaxParticles, ForcedLifeTime with ForcedFade, a 0.5 s initial delay, a Brighten mesh with UseMeshBlendMode=false, SizeScale curves with UseRegularSizeScale=False, UseSizeScale without keys, and ColorScaleRepeats. Their traces are committed in full.
- `tests/fixtures/particles/power-strike.hashes.json` holds the effect-source.json SHA-256, the seed, the step, the simulator version and one trace SHA-256 per actor. The Power Strike tests read the records from the converter output for `--client` at test time and skip with a reason when it is absent. On a hash mismatch the test writes the regenerated trace to an untracked folder so a reviewer can compare it.
- `tests/support/goldenTrace.ts` (integration) writes traces and compares float32 values by ulp.

### Migration from the current modules

Once the Power Strike preview runs on the simulator:
1. Delete nativeEffectInitTimeline.ts, nativeEffectShotTimeline.ts, nativeEffectParticlePool.ts, nativeEffectMaterial.ts, nativeEffectInitPreview.ts and nativeEffectShotPreview.ts, with their tests.
2. Point loadEffectComponent.ts at render/particleMaterial.ts.
3. Review nativeEffectShotPlacement.ts, nativePowerStrikeSource.ts, nativeEffectComponentPreview.ts, nativeEffectInspectionCamera.ts and nativePowerStrikePreview.ts. Keep what the placement layer or inspection uses and delete the rest.
4. Integration rewires src/runtime/createNativeSliceRuntime.ts. Data-ui updates src/ui/nativeEffectInitControls.ts and src/ui/nativePowerStrikeControls.ts.
5. Keep bundle loading and hash checks in nativeEffectComponents.ts. Do not carry over the closed-form conventions listed under current state.

The shipped Translucent and Brighten mapping is the reverse of the reference pairs. The flip lands only after the PTDS 3 and 6 swatch comparison with L2.exe, recorded in `docs/parts/skills-effects/EVIDENCE.md`. It changes how MeshEmitter5 looks, and the commit that updates its test states that reason.

### Import boundary

`src/effects/particles/sim/**` and `effectScheduler.ts` form one Babylon-free unit. They may import `src/shared/**` and nothing else outside themselves. That excludes `@babylonjs/*`, every package, DOM globals, `src/runtime/**` and `src/world/**`. The rule lives in `tests/unit/importBoundaries.particles.test.ts` on the integration helper `tests/support/staticImportGraph.ts`. The integration rule that bans `@recast-navigation/*`, `@babylonjs/materials` and `@babylonjs/node-particle-editor` in `src/**` outside the lazy inspector entry covers `render/` too. The boundary test exists only on plan/autonomous-roadmap, so the particles file lands there or after native-world-slice merges it. The placement layer translates adapter records, so the sim never needs `src/world`.

## No vendor dependencies

| Reference uses | For | We use |
|---|---|---|
| three math and scene graph (Object3D, Vector3, Vector4, Matrix3, Matrix4, Quaternion, Box3, MathUtils clamp and lerp), imported at `lineage2js/src/objects/emitters/base-emitter.ts:1-2` | Particle vectors, emitter transforms, bounds, interpolation and Spray re-basing | `src/shared/math/` and `src/shared/math/rotator.ts` on number tuples, plus typed-array columns. Babylon math appears only in render/. |
| three rendering (InstancedBufferGeometry, InstancedBufferAttribute, ShaderMaterial, PlaneGeometry, blend constants; `instanced-sprite-mesh.ts:1`, `particle-material.ts:1`) | Instanced billboards, mesh particles, strips and draw-style blending | Babylon thin instances, updatable VertexData, our vertex stage and the MAT-01 fragment chain through `src/materials/ue2/babylon/material.ts`. Babylon is our platform, so this adds no dependency. |
| three ShaderChunks (common, fog_pars_*, logdepthbuf_*, premultiplied_alpha_fragment, clipping_planes_*, alphatest_*, color_*, morphtarget_*, skinning_*, envmap_*, uv_pars_*, tonemapping_fragment, colorspace_fragment) and the custom l2_fog_fragment | Shader prelude, fog, depth and alpha test in the particle and mesh-emitter shaders | Our own vertex stage, plus the fragment chain and particle fog family from `src/materials/ue2/`. |
| three morph targets (`vert-mesh-emitter.ts:29-56`) | VertMesh frame playback | A frame index from kinds/vertMesh.ts, rendered with Babylon MorphTargetManager or a vertex-frame texture (Phase 5). |
| three-wasm (git dependency swapped in for three Matrix4 and Euler, `lineage2js/configs/create-config.js:69-75`) | Faster matrix math in the build | None needed. The sim builds no per-particle matrices. Only mesh particles get a rotator-to-3x3 at render. |
| Math.random (unseedable) | Every range draw, spin sign, random cell and random direction | `src/shared/random.ts`: sfc32 seeded through splitmix32, one emitter-domain stream per emitter. |
| l2js-core FArray, FPrimitiveArray and the property-tag reader (`l2js-core/src/unreal/un-array.ts:9`, `un-property-tag.ts:101-112`) | Decoding emitter properties from packages at load time | Our offline converters: the scripts/native_catalog readers, the pinned UELib run from .assets/native-tools/, and `scripts/native_assets_lib/class_defaults.py`. The client root is a required argument. Output is hash-pinned JSON, and no package reader ships to the browser. |
| The Lineage2JS UnrealScript VM (`lineage2js/src/ue-script/vm.ts`; native hooks at `base-emitter.ts:305-311`, `object3d-decoder.ts:195-204`) | Instantiating effect classes and dispatching Trigger and Kill | No VM. Effect classes are data, and the natives are methods on emitterActor.ts that the placement layer calls. |
| @dimforge/rapier3d, pako, gmp-wasm, egoroof-blowfish, node-forge, chokidar, uuid (`lineage2js/package.json:37-48`) | Nothing in this area. Emitter collision is a stub. | None. Particle collision is the gap emitter-feature-unported:UseCollision. |
| Not a reference dependency: Babylon ParticleSystem, GPUParticleSystem, SolidParticleSystem, @babylonjs/node-particle-editor and @babylonjs/materials | Never used for UE2 particle semantics | Never imported in sim or render. The integration boundary rule bans @babylonjs/node-particle-editor and @babylonjs/materials in src/** outside the lazy inspector entry. |

## Shared modules

- `src/shared/presentationClock.ts`
- `src/shared/fixedStep.ts`
- `src/shared/random.ts`
- `src/shared/math/`
- `src/shared/math/rotator.ts`
- `src/world/sourceFrame.ts`
- `scripts/native_assets_lib/class_defaults.py`
- scripts/world/ (map Emitter actor export, tile step registered in convert_tile.py)
- `scripts/world/bsp_leaf_membership.py`
- src/materials/ue2/model/blendTable.ts and src/materials/ue2/model/fog.ts
- `src/materials/ue2/model/textureFrames.ts`
- `src/materials/ue2/babylon/material.ts`
- src/runtime/ (scene.setRenderingOrder setup)
- `tests/support/goldenTrace.ts`
- tests/support/staticImportGraph.ts and tests/unit/importBoundaries*.test.ts
- `tools/reference-overlap/`
- scripts/native_store/gap_reasons.json plus recipes/world|actors|data/gap-reasons.json
- Native constants row shape documented in README.md, applied in docs/parts/skills-effects/PARTICLE_SEMANTICS.md

## Acceptance

- RNG known-answer test on `src/shared/random.ts` with the emitter domain: a fixed seed yields a committed list of the first 16 outputs. The FRange draw returns `Max + (Min - Max) * u`. The unit vector has length 1 within 1e-6 and uses exactly two draws.
- One formula test per PARTICLE_SEMANTICS.md row, each naming its anchor and status: spawn counts and birth ages for rates 9 and 10000 at step 1/60 s; respawn age; Euler velocity loss over N steps; curve phase with Repeats 0, 1 and 15; the regular size factor; color byte truncation with AlphaBlend-only alpha; fades and opacity per style; the polar offset for (90, 0..360, 10..15); velocity direction signs per coordinate system; the sibling cursor; the age cell and blend for U = V = 2, Start 2, End 3; spin units; AdjustparticleLife with ForcedLifeTime, ForcedFade and ForcedMaxParticles; SetSizeScale; warmup count including WarmupTicksPerSecond 0; AutoReset and AutoDestroy outcomes including the bNoDelete refusal; Kill; Trigger; a delay that crosses zero inside a step.
- Synthetic golden traces: each tests/fixtures/particles/synthetic-*.json fixture has a committed trace at a declared seed and step 1/60 s, one row per step per live slot, until the actor is destroyed. Each header records the simulator version, the fixture SHA-256, the seed, the step and the rules still unconfirmed. A re-run matches exactly, except that a value fed by Math.sin, Math.cos or Math.atan2 may differ by one float32 ulp. A fixture change needs a commit that states the semantic reason.
- Power Strike hash traces: with `--client`, the test first matches the effect-source.json SHA-256, then the s_u002_a and p_u004_a traces at the declared seed and step must hash to the values in power-strike.hashes.json. Without `--client` the test skips with a reason.
- Determinism: two runs with one seed are identical. Spawning an unrelated effect between steps leaves both Power Strike traces unchanged. A different seed changes them.
- Property tests over 200 seeds, on the synthetic fixtures always and on the six Power Strike emitters with `--client`: live count <= MaxParticles, no NaN or Infinity, rgba in [0, 1], Time <= MaxLifetime after aging for non-respawning slots, and Dead within max lifetime + delay + 1 s.
- Config compiler: a synthetic UseCollision=true fixture yields emitter-feature-unported:UseCollision, and an Engine.SparkEmitter fixture yields emitter-class-unported:Engine.SparkEmitter. With `--client`, the six Power Strike components and both actors compile with no gaps and list AutoReplay as unresolved. A run over every converted effect bundle writes compiled, unresolved and gap counts per class into the INT-01 coverage report.
- Boundary: tests/unit/importBoundaries.particles.test.ts fails if any file under src/effects/particles/sim/** or effectScheduler.ts imports anything outside itself other than src/shared/**.
- Renderer browser spec (tests/browser/particles.spec.ts, Playwright, WebGPU): the synthetic set always, and Power Strike when the staged bundle exists (skip with a reason otherwise), at a fixed seed with the presentation clock paused 0.25 s after the shot. The thin-instance count per batch equals the sim live count, each emitter costs one draw per material slot, and a screenshot is stored. A missing-texture fixture shows the ARCH-03 diagnostic, not a substitute sprite.
- Translucent order: a Power Strike in front of and behind a water sheet draws in depth order, and emitter array order holds inside each actor.
- Sandbox: `?skill=3:1` plays the init and shot effects and the RibbonSet trail as an unconfirmed default, destroys the actors when AutoDestroy fires, and inspection counts for meshes, materials and buffers return to the pre-cast baseline.
- Overlap check before merge: `tools/reference-overlap/` runs with the particles globs. The source glob is src/effects/particles/**. The reference globs are .assets/reference/lineage2js/src/objects/emitters/**, src/materials/particle-material/**, src/materials/mesh-emitter-material/**, src/assets/unreal/emitters/**, src/assets/unreal/skills/**, src/assets/decoders/object3d-decoder.ts, src/assets/unreal/un-emitter.ts and src/objects/components/skill-effect-host.ts. Identifiers map to placeholders, comments are stripped and numeric literals are kept. Every shared run of 12 or more tokens goes to the reviewer, and any run of 20 or more outside the constant-table allowlist blocks the merge. A reviewer who did not write the code signs off in docs/parts/skills-effects/EVIDENCE.md.
- Phase 3 side-by-side (CHECK-01): L2.exe on IMPORTA-PC and the sandbox at a matched viewport and camera, Power Strike on Greater Musveren, at least five independent native repetitions captured at 30 FPS or more against declared browser seeds. Pass: mean occupancy relative error <= 0.1, spatial centroid p95 error <= 8 px, and onset, peak and expiry error <= 0.05 s, per recipes/native-parity.acceptance.json, whose SHA-256 the result records. POL-01 uses the same metrics.
- PERF-01 workload (eight Power Strikes every 2 s plus 32 actors on the GTX 1060): record particle sim ms per frame (median and p95), particle draw calls and buffer upload bytes per frame next to the frame timings. The sim cost is measured, never estimated.

## Implementation steps

1. 1. Shared foundations (Phase 2) Requirement: FX-01. Output: Integration lands `src/shared/random.ts`, `src/shared/math/` with `math/rotator.ts` (float32 sine table, quantized axis rotation, GetNonParallel), `src/shared/presentationClock.ts`, `src/shared/fixedStep.ts` and `src/world/sourceFrame.ts` first. Actors adds `src/effects/particles/sim/keyTrack.ts`. Check: Known-answer and formula tests pass. The particles boundary test covers sim and scheduler.
2. 2. Emitter census (Phase 2) Requirement: FX-01, CONV-01. Output: scripts/actors/emitter_census.py and docs/parts/skills-effects/emitter-census.json: classes, property names and enum values per class and package over lineageeffect.u, LineageEffect3.u and all maps, read with the native_catalog readers. The header records each input file's SHA-256. Check: It reproduces the lineageeffect.u class set and takes the client root as a required argument. Its counts decide which features are simulated, unresolved or gaps.
3. 3. Converter coverage (Phase 2) Requirement: ACT-06, CONV-01, CONV-02. Output: Integration: `scripts/native_assets_lib/class_defaults.py`, so RibbonEmitter and VertMeshEmitter inherit class defaults; Beam, Ribbon and VertMesh staging with textures (scripts/stage-native-effect.mjs); the UseRotationFrom key (scripts/native_assets_lib/effect_readiness.py:18); no outside client default (scripts/native_effects.py:12, recipes/native-parity.acceptance.json source.clientRoot). Data-ui: read_class_defaults (scripts/native_catalog/effects.py:264) calls the shared reader, and the UELib default (effects.py:17) moves under .assets/native-tools/. Actors: DefaultReader in scripts/native_effect_bundle.py calls the shared reader, and the bundle keeps every Emitter actor field listed under data inputs. Check: scripts/test_effect_readiness.py and tests/pipeline cover each change. The staged Power Strike manifest keeps every listed actor field.
4. 4. Registry, compiler and fixtures (Phase 2) Requirement: FX-01, ARCH-03. Output: PARTICLE_SEMANTICS.md with every row ue2-data, unconfirmed or unknown. sim/emitterConfig.ts with kinds, Interlude enum labels, gaps and unresolved fields. Both emitter reasons in recipes/actors/gap-reasons.json. The synthetic fixtures and power-strike.hashes.json. Check: The compiler acceptance cases pass. Every row has a status and a runtime default.
5. 5. Sprite and Mesh simulation (Phase 2) Requirement: FX-01. Output: particleStore.ts, spawn.ts, update.ts, emitterState.ts, emitterActor.ts (natives included), frame.ts and trace.ts. Synthetic traces and the Power Strike trace hashes. Check: Golden-trace, hash-trace, determinism and property tests pass.
6. 6. Babylon renderer (Phase 2) Requirement: FX-01, ARCH-03. Output: A WebGPU spike on thin instances with custom buffers under ShaderMaterial and on blend factors per DrawStyle, then render/particleSpace.ts, spriteBatch.ts, meshBatch.ts and particleMaterial.ts on the MAT-01 fragment chain. Effect meshes expose actor key, emitter ordinal and sort point to the integration comparator. Check: The renderer browser spec, the handedness test and the water-sheet order test pass.
7. 7. Scheduler and Power Strike (Phase 2) Requirement: FX-01, ACT-06, ARCH-01, ARCH-02, ARCH-04. Output: effectScheduler.ts, the OwnerSampler adapter (hand bone, target pivot) and placement commands (AdjustparticleLife, SetSizeScale, SetDelayed, SpeedRate). The preview switches to the simulator, and the migration deletions follow. Check: The sandbox `?skill=3:1` case passes, and no deleted module is still imported.
8. 8. RibbonEmitter and weapon trail (Phase 2) Requirement: FX-01. Output: kinds/ribbon.ts and render/stripMesh.ts. RibbonSet attaches to skill 3 with the reference values as an unconfirmed default, and the coverage report lists the attach as unresolved. The caster test reads EntityKind npc from the contract commit. Check: Ribbon traces pass at a fixed seed on a synthetic owner track. Ribbon class gaps leave the coverage report.
9. 9. Any-skill playback (Phase 2) Requirement: ACT-06, INT-01. Output: The 02-43 skill bindings routed through the placement layer, so `?skill=<id>:<level>` plays every compiled effect and lists its gaps. Check: The coverage report shows compiled, unresolved and gap counts per class and per skill.
10. 10. Map emitters (Phase 2, world lane) Requirement: WORLD-01, VIS-01, FX-01. Output: A tile step in scripts/world/, registered in convert_tile.py, exports Emitter actors once, with placement ids and zones from scripts/world/bsp_leaf_membership.py. src/scene/world spawns them through the scheduler, with warmup at tile activation, VIS-01 memberVisible gating and the frustum test. Check: Tile coverage rows list emitter counts with gaps and unresolved fields. VIS-01 membership reads the same export.
11. 11. Side-by-side (Phase 3) Requirement: CHECK-01. Output: The Power Strike capture and metrics, the PTDS 3 and 6 swatch recorded in EVIDENCE.md, and semantic fixes with updated fixtures and hashes. The capture also shows whether L2.exe draws the skill 3 trail. Check: The Phase 3 acceptance item passes.
12. 12. Interlude re-derivation packet (Phase 5) Requirement: POL-04, FX-01, POL-01. Output: Static reads of the anchors in Interlude Engine.dll, Core.dll and D3DDrv.dll, one research note per anchor, filling interludeEvidence and moving rows to confirmed-interlude or corrected-interlude. Order: UseRegularSizeScale, the sprite spin axis, ColorScaleRepeats, the polar convention, atlas order, AutoReplay, the skill 3 AttachTrailer callers and weapon length, SetDelayed's int arguments, OpacityRatio, DrawScale and DrawScale3D, the double InitialTimeRange on respawn, single-key curves, the SinTab choice in rotator.ts and the D3DDrv blend path. POL-01 then reruns the Phase 3 metrics. Check: Every unconfirmed row has evidence or keeps its status with a reason. Inputs are named by SHA-256. Binaries are read, never run.
13. 13. Beam and VertMesh (Phase 5) Requirement: POL-04. Output: kinds/beam.ts (endpoint modes, noise, sheets) and kinds/vertMesh.ts once the converter provides vertex frames. MeshSpawning lands only when native vertex order is proven. Check: Traces per kind pass, and emitter-class-unported counts for Beam and VertMesh drop to zero.
14. 14. Performance (Phase 6) Requirement: PERF-01, PERF-02. Output: PERF-01 numbers, then only measured optimizations: cross-actor ONE/ONE batching and upload budgets. Check: The PERF-01 acceptance item passes with measured baselines before and after each change.

## Open questions

- Sprite spin axis: the reference rolls sprites from Z, our timelines use X, and SpriteEmitter2 authors spin only on X. Re-derive at USpriteEmitter::FillVertexBuffer 0x106EFD60.
- ColorScaleRepeats: Repeats + 1 cycles (reference) or the total cycle count (our InitTimeline.ts:26)? Power Strike uses 15 and 20.
- Is the regular size factor `1 / (1 + Time)`, and what does UseRegularSizeScale do without UseSizeScale?
- Polar start: is X the azimuth and Y the inclination about +Z, or does ProjectionNormal orient the shape? Does SetSizeScale really scale the polar angles?
- Native or reference artefact: the velocity-direction sign per coordinate system, the opacity quirk for zero-rate emitters, the double InitialTimeRange on respawn, the single-key curve rule and the past-last-key fallback?
- Do actor DrawScale and DrawScale3D affect particle positions or sizes?
- Atlas order, SubdivisionEnd exclusivity, and how UseSubdivisionScale with SubdivisionScale times the cells.
- Native timestep: does AEmitter::Tick clamp DeltaTime? Does a 1/60 s step look right at 120 Hz, or do we need render interpolation between OldLocation and Location?
- Interlude-only semantics: AutoReplay, OpacityRatio, SetOpacity, VisibleLimit, VisibilityInterpRange, SpawnSound array selection, SoundLooping and the pitch range; the two int arguments of SetDelayed; the AttachTrailer arguments.
- What do the Interlude Particle fields HitCount, BoneIndex, OldMeshLocation and Rotation do natively?
- Does LifeSpan count actor time or SpeedRate-scaled time?
- GL2ActorCR in Interlude: its source (option or ini), its value, and whether skill effects skip the clip range. The VIS-01 row runs at infinity until then.
- Does the UModel GLB keep native static-mesh vertex order for MeshSpawning, or does the converter need a raw vertex stream?
- Which export carries UVertMesh frames, and at what rate?
- Particle texture animation clock: particle age or emitter clock? The reference uses age for mesh particles and the emitter clock for instanced sprites. 01-materials-fog.md tracks the same question for textureFrames.ts.
- What do PTCS_Absolute and PTCS_RelativeRotation do natively, and does content use them?
- Weather emitters (WeatherEffect in 3 maps, LevelOfWeather, CheckLevelOfWeather, ParticleChoice, WeatherRangeTime): what are the density rules, and which option drives them?
- Emitter light (EL_*) and quake (bUseQuake, Shake*): which lane owns them, lighting or camera?
- Does Interlude skill 3 attach the RibbonSet weapon trail, and where does the weapon length come from?
- Where is the D3DDrv blend table? Reference particles fog Modulated and Darken toward the fog color, and only Translucent, AlphaModulate and Brighten toward black ([01-materials-fog.md](01-materials-fog.md)). Does native Modulated fog toward 127/255?
