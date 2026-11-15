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
| `reviewed-native-dispatch-candidates` (02-99) | 11,210 |
| `reviewed-animation-notify-candidates` (02-99) | 4 |
| gap `native-skill-dispatch-required` | 6,361 |
| anomalies (level below 1) | 0 |
| Total, equal to the decoded row count | 29,812 |

- 2,694 skill ids. Sounds bind only from the one skillsoundgrp row of the same id and level: 1,371 keys have it, 28,441 keys have `no-exact-skillsound-row`. There is no level 1 or nearest-level fallback.
- Binding rows and the census hold identity only (key, skill id, level, root, dispatch candidates, sound row ordinal, reasons); no skillgrp gameplay field reaches them (test `GameplayFieldProhibitionTests`).

### Dispatch candidates (plan 02-99, 2026-11-14)

- Recipe `recipes/actors/skill-dispatch-candidates.json` (2,167,760 bytes, SHA-256 `316bba1f...92fa`), written only by `python -B scripts/actors/skill_dispatch_candidate_recipe.py --replay <rea-in>/20261113-roadmap/skill-dispatch-r2-replay.json --client E:/Lineage2-client` (`--check` compares bytes). It pins the IMPORTA-PC Q8 replay `bd9fd151...c8fe`, the R2 archive `85c4436d...5fd2`, Engine.dll `4dd2f63c...` at image base 0x10300000, soulshot.int and skillgrp.dat, all equal to the lock. Verification wf_f4663a6a-7bd: 14,505 of 14,505 instruction occurrences, 823 of 823 data slices, 1,483 of 1,483 bindings. It copies 7 stages, 34 tables (guard bytes, slice hashes), 416 dispatches, 39 helper routes, the 3 gates and 234 classes with their package pins; no disassembly text.
- 1,483 bindings over 11,211 rows: gates none 1,328, transient (cast style 0) 139, union-target (cast style 12) 16. Each row lists per stage and case the dispatch kind, case index and VA, the sorted candidate classes and the entry gate. Skill 3 level 1 keeps `reviewed-source-dispatch`. The recipe names no caller of the union-target gate, so the corrected R2 label (AddAssociatedActorNotify) needs no pin.
- Animation notify route (`animationNotify`, source `bd1bbaad...70ba`, wf_943f023e-86b, 845/845 and 427/427): 4108/1 and 5092/1 to `LineageEffect.e_u042_a`, 4681/1 and 4682/1 to `LineageEffect.mb_valakas_trample_ca`, with NPC, sequence, notify and conditions. Unresolved rows: 6,361.
- Candidate rows stay gaps: their skills gap rows read `skill-dispatch-candidate-runtime-unresolved` (11,214) with the recipe as evidence, the census rows 11,215. No skill key gains a component, so `?skill=3:2` loads nothing.
- Byte replay: `tests/pipeline/test_skill_dispatch_byte_replay.py` reads engine.dll and soulshot.int of E: through the lock and recomputes all 30 bindings of skills 1, 3, 56, 1419, 2023, 2025, 2039, 4049, 5007 and 5115 (lowest level) with a capstone-free decoder; the index shifted by one fails 28 of 30. The same decoder reproduced all 1,483 bindings once ad hoc.
- Class units: one sealed `skill-dispatch-class:<effectObject>` unit (step `skill-dispatch-class`) per class, 236 including the 2 notify classes, converted from the lowest candidate row with one skillgrp and one skillsoundgrp row. Record `interlude:skill-dispatch-class:<effectObject>` matches no skill lookup. Tracer skill 10 level 1 (`e_u011_a`), then one batch process `--batch skills --limit 235` (2026-11-14 02:08 to 03:38 Riga, exit 0).
- Outcomes: 216 converted, 17 `converter-refused` (14 default-property syntax, 3 missing retained Emitters order), 3 `no-exact-skillsound-row` (`e_u001_a`, `e_u049_a`, `mb_frintessa_organ_heal`). Published: 77 pass, 119 with a class or feature gap, 20 unbound simulated components; 196 records in 196 manifest folders (124,612,037 bytes).
- Disk: tracer drop 30,224,384 bytes; projection 235 x 40,103,936 = 9,424,424,960 bytes against 142,041,722,880 free and the 4 GiB floor; free after 134,412,476,416. Fingerprint inputs equal before and after; all 12,001 receipts kept their fingerprint, 236 new receipts all of step `skill-dispatch-class`. Lane catalog `8458dff2...1894` (10,845 effect components); `--plan` exits 0.

### Conversion

- One sealed ledger unit per visual root (`skill-root:<description>`, step `skill-effect-root`), converted through `native_effect_bundle` from the first key with an exact sound row, staged with `scripts/stage-native-effect.mjs` and written to the actors lane store under `l2/effects/<sha>/`.
- The staged folder holds every file its manifest pins: the resources and, since 2026-11-09, the source bundle manifest and graph as `source-bundle/<sha256>.json`, so `write_lane_catalog.py --lane actors` pins the effect records (`tests/pipeline/test_skill_effect_store_pins.py`).
- Every key that names a converted root gets the record `interlude:skill:<id>:level:<level>:native-description-action` with `bundleId` `interlude:skill-root:<description>`.
- Sprite, Mesh, Beam, Ribbon and VertMesh emitter records and their texture and static mesh references convert. Spark, Trail and other classes keep their records as `emitter-class-unconverted` gaps and convert no reference (6f613dd). VertMesh objects stay raw native data: the Converter has no VertMesh adapter. Bundle gap reasons write `<converter>` for the converter work folder (d4b5eb6).
- `recipes/actors/emitter-class-coverage.json` lists the classes the simulator runs (`Engine.MeshEmitter`, `Engine.RibbonEmitter`, `Engine.SpriteEmitter`). A key passes only when every emitter class of its root is listed; otherwise it is `emitter-class-unported:<class>` (FX-01). Since 9d1189d a sealed root with an unbound simulated component is an unpublished `converter-refused` gap (02-REVIEW-FIX).
- Gap reasons scrub host paths (`actors/path_free_messages.py`, 382c9b1); the catalog is written with the compact `json_bytes` (f48c353).

Resume command: `python -B scripts/actors/convert_actors.py --client E:/Lineage2-client --batch skills --limit 20`. A rerun skips roots sealed under the current fingerprint (`alreadySealedRoots`).

Batch to completion (plan 02-79, 2026-11-12 03:04 to 07:21 Riga): the converter change of 02-73, 02-74 and 02-92 unsealed the 22 roots of 02-43, which were resealed first. 13 slices of 20 roots, all exit 0, lane catalog rewritten every 5 slices; `skill.mo.99`, refused under 02-43, now converts. Disk projection (G5) before slices 1, 2, 7 and 12: at most 45,215,051 bytes per root times 245 roots, 11,077,687,495 bytes against at least 71,556,415,488 free and the 4 GiB floor.

| Root outcome (245 roots) | Roots |
| --- | --- |
| converted, every emitter class simulated | 176 |
| converted, `emitter-class-unported:Engine.BeamEmitter` | 22 |
| converted, `emitter-class-unported:Engine.VertMeshEmitter` | 8 |
| `converter-refused`: 20 unsupported default-property syntax, 2 no explicit effect-class reference (`skill.mb.832`, `skill.qu.4548`), 3 native object missing or ambiguous (`skill.bl.1147`, `skill.it.2178`, `skill.mo.87`) | 25 |
| `no-exact-skillsound-row` | 14 |

The 02-94 feature rule marks converted roots per property: `UseDirectionAs` 147, `BlendBetweenSubdivisions` 88, `UseMeshBlendMode` 4, `MeshSpawning` 1, `UseActorForces` 1 (a root can have several; the first names its keys). Gap rows `artifacts/lane-store/actors/gap-rows/skills.json` (29,812): 591 pass, 11,214 `skill-dispatch-candidate-runtime-unresolved`, 6,361 `native-skill-dispatch-required`, 6,468 `emitter-feature-unported:UseDirectionAs`, 1,945 `emitter-feature-unported:BlendBetweenSubdivisions` (8,413 feature rows), 1,562 `converter-refused`, 1,235 `emitter-class-unported:Engine.BeamEmitter`, 410 `emitter-class-unported:Engine.VertMeshEmitter`, 25 `no-exact-skillsound-row`, and `skill:3:1` (reviewed dispatch in the shared store).

### Browser

- `src/effects/castSkillIndex.ts` owns skill effect identity: `parseSkillEffectComponentId` (used by the catalog index), `buildCastSkillIndex` (refuses two records for one key), `lookupCastSkill` and `selectedCastSkill` (`?skill=<id>:<level>`).
- `loadNativeEffectComponents` loads the selected key, or Power Strike when nothing is selected; the catalog byte limit of `readNativeCatalog` bounds it.
- Unsimulated emitter components parse without resources; the loader refuses them.

### Browser checks (headless SwiftShader, no FPS claims)

- `NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-skill-cast.spec.ts` (02-99, 2026-11-14): 8 passed, 4 skipped (shared store), and the 932 x 430 picker case timed out waiting for the world once and passed on its single rerun. `?skill=1011:1` lists the 5 components of `interlude:skill-root:skill.wh.1011` and draws. `?skill=3:2` shows `skill:3:2 gap: skill-dispatch-candidate-runtime-unresolved` and `?skill=42:1` `skill:42:1 gap: native-skill-dispatch-required`, both with no component. Portrait 430 x 932 has no horizontal scroll.
- Screenshots: `artifacts/skill-evidence/skill-1011-1-1440x900.png`, `skill-1011-1-932x430.png`, `skill-3-2-gap-1440x900.png`.
- 02-79 skills sweep slice (`NATIVE_STORE_ROOT=actors LOAD_CHECK_KIND=skills LOAD_CHECK_LIMIT=25`, port 5173 free, 2026-11-12 12:39 Riga) on lane catalog `469805d3...`: 25 pass, 0 failed (skill 1011 levels 1 to 18, 1012 levels 1 to 3, 1013 levels 1, 10, 101, 102), `load-checks/469805d3....json`.

## FX-01 emitter simulation core (plan 02-68, 2026-11-09)

Our own deterministic port of the UE2 emitter classes in plain TypeScript under `src/effects/particles/sim`, with Lineage2JS read only as a behaviour reference (DEC-OWN-12). No Babylon type, package, DOM or `src/runtime` import (`tests/unit/importBoundaries.particles.test.ts`); 02-68 read no Interlude binary (D4), the rewrites below did.

- Records: `parseEmitterRecord` and `parseEmitterActorRecord` read the bundle `effectiveProperties` (Interlude class defaults merged by the converter) and keep per-field provenance (`authored`, `class-default`, `ue-zero`). They refuse a wrong field type, a missing class default, an unsimulated class and MaxParticles outside 0 to 16384 with named `EmitterRecordError`s.
- Simulation: `SpriteEmitter` and `MeshEmitter` spawn, age, respawn, move, revolve, scale, colour, fade and lose velocity on float32 columns, one `src/shared/random.ts` emitter stream per emitter. Sprites report roll and column-major atlas cells; meshes report spin rotators and the material route (`UseMeshBlendMode=false` takes the DrawStyle particle material and `RenderTwoSided` from the record).
- Emitter actor: GlobalOffset, initial delay, warmup, AutoReset, AutoDestroy (with the bNoDelete and bStatic refusal), SpeedRate, bRotEmitter and LifeSpan over the emitters in array order. AutoReplay, VisibleLimit, non-unit DrawScale3D and CoordinateSystem=Absolute are listed as unresolved. Actor DrawScale is not applied to particles.
- Scheduler: `createEffectScheduler` steps every live effect through `createFixedStepAccumulator` at 1/60 s, at most 8 steps per frame with the backlog dropped, on the presentation clock frame delta.
- Gaps: collision, collision planes, actor forces, MeshSpawning, UseSkeletalLocationAs, SpawnFromOtherEmitter, UseRotationFrom=Normal, CoordinateSystem=RelativeRotation and WeatherEffect report `emitter-feature-unported:<property>` (actors gap reasons listVersion 6) and the rest of the emitter simulates. Sprites also report `UseDirectionAs` for any basis but None and Scale (52ed33e) and an age-driven `BlendBetweenSubdivisions` on a multi-cell atlas without random subdivision (c1f67be).
- Rules: every rule is a row in [PARTICLE_SEMANTICS.md](PARTICLE_SEMANTICS.md), mirrored by `PARTICLE_CONSTANTS`; reference rules run as unconfirmed defaults until POL-04 re-derives them. Ten rows carry Interlude evidence now (`confirmed-interlude` or `corrected-interlude`), and `PARTICLE_SIMULATOR_VERSION` is 2.

| Check | Result |
| --- | --- |
| `tests/unit/spriteEmitter.test.ts` | synthetic sprite golden trace at seed 1, step 1/60, 0 ulp (175 rows, regenerated for simulator version 2); seed 2 differs; refusals |
| `tests/unit/meshEmitter.test.ts` | synthetic mesh golden trace with rotators (274 rows, regenerated for simulator version 2); material route; unported features |
| `tests/unit/emitterActor.test.ts` | each actor rule; scheduler step count, cap and pause; another effect spawned between steps leaves a trace unchanged |
| Power Strike hash traces | `POWER_STRIKE_EFFECT_SOURCE=<effect-source.json>` matches `tests/fixtures/particles/power-strike.hashes.json` (source SHA-256 `ce79c8ac...`, seed 1, simulator version 2, two actor trace hashes; feature gap p_u004_a SpriteEmitter9 `UseDirectionAs` since 52ed33e); skips with a reason without it. p_u004_a is destroyed after 19 steps, s_u002_a after 101, as before version 2. |
| `tests/unit/particleInterludeRules.test.ts` | the POL-04 corrections below; each case fails on simulator version 1 |
| `tests/unit/importBoundaries.particles.test.ts` | 16 passed |
| `node tools/reference-overlap/referenceOverlap.mjs --area particles` | at 02-68: 110 blocking and 2,508 unreviewed runs, all structural (`artifacts/reference-overlap/02-68-particles.json`); the area exits 0 since cf2c891 |


### Clean-room rewrite of the overlap spans (2026-11-09)

The spans the overlap review could not clear were rewritten from UE2 sources only: the lock-equal Engine.dll `4dd2f63c...` and Core.dll `9462f87a...` and UELib decompiles from Engine.u `9b04ff5c...`. Emitter tick order and outcomes (`AEmitter::Tick` 0x1060BD00), Reset, warm-up, the spawn loop (`SpawnParticles` 0x10605B40), the polar start, rotator axes (Core.dll 0x10110240) and the atlas blend byte (`FillVertexBuffer` 0x106EFD60) follow the client; an uncommitted old-against-new harness matched bit for bit over 600 random two-emitter actors of 220 steps.

POL-04 corrections (simulator version 2): first-step draws, polar start through the Core.dll sine table, the != 0 gates, the atlas end of blend, float32 grouping, the spawn refusal guards and the sine table derivation now follow the client. Each is a `corrected-interlude` row of [PARTICLE_SEMANTICS.md](PARTICLE_SEMANTICS.md) with its addresses; the golden traces and Power Strike hashes were regenerated with `PARTICLE_GOLDEN_WRITE=1` (details in git history).

## FX-01 playback, natives and ribbons (plan 02-69, 2026-11-10)

Effect playback runs on the simulator and the UE2 material library; the closed-form timelines, per-slot pool and preview material are deleted (02-69 SUMMARY).

- Vertex stage: `src/effects/particles/render/particleInstances.ts` writes each live slot as one thin instance (matrix, colour, atlas cell, sprite half extent and roll) in browser axes through `sourcePositionToWorld`. Mesh particles draw T * R * S with the GLB primitive node transforms baked into the vertices; sprites face the camera in the vertex shader. World-stored (Spray, Independent) particles skip the live bRotEmitter rotation, owner-frame ones take it, and mesh orientation follows it as in the reference (b9092b3). Instance buffers grow with the emitter columns (threat T-02-69-01).
- Fragment stage: `particleMaterialBinding.ts` builds the material from `particleFragmentChain(DrawStyle)` with the record's ZTest, ZWrite, AlphaTest and RenderTwoSided, colour texel * particle colour, and sets `metadata.nativeEmitterOrdinal` on every effect mesh. No effect mesh sets `alphaIndex`. DrawStyle 3 and 6 keep the shipped pairs (`ALPHA_SCREENMODE`, `ALPHA_ONEONE`) until the swatch comparison is recorded; `particleMaterialBinding.test.ts` fails if they flip.
- `loadEffectComponent.ts` loads one emitter's geometry and its texture chain (AnimNext frames follow the library `selectTextureFrame`), and every mesh primitive gets its own material and texture. `emitterActorPlayback.ts` runs an emitter actor on `createEffectScheduler`; the init, shot and component previews play through it, and an AutoDestroy actor ends the preview. It removes the effect it replaces, stops or disposes from the scheduler, so replays leave no undrawn simulation stepping (02-REVIEW-FIX).
- Natives: `emitterNatives.ts` applies AdjustparticleLife, SetSizeScale, SetDelayed, Kill and Trigger to a live emitter actor from a closed name list; an unknown name is refused (threat T-02-69-02). Since 02-84 only the playback hook `applyNative` imports it (`emitterNatives.test.ts`). After AdjustparticleLife lowers ForcedMaxParticles, the update, the live listing and the dead rule use the allocated slots (d238922; traces unchanged).
- RibbonEmitter: `ribbonEmitter.ts` samples, interpolates, drops and decays ribbon points from a point source; rewritten from the client in wave 12 (next section). Ribbons simulate but do not draw yet: the staged manifest binds no RibbonEmitter texture (`ribbon-texture-unstaged`).
- Map emitters: `mapEmitterPlayback.ts` `playTileMapEmitters` spawns each placement on the scheduler and shows it only while `isPlacementVisible` (the 02-63 memberVisible) and the frustum test pass; hidden placements keep simulating.
- Coverage: `recipes/actors/emitter-class-coverage.json` listVersion 2 adds `Engine.RibbonEmitter`; BeamEmitter, VertMeshEmitter, SparkEmitter and TrailEmitter stay `emitter-class-unported:<class>`.
- Skeletal slots (MAT-01): `src/assets/native/nativeSkeletalMaterials.ts` binds a slot whose GLB material extras carry `nativeMaterialProgram` through `createNativeMaterial`; an unported program shows the library magenta diagnostic. No converted actor GLB carries a program id yet, so every slot reports `program-unconverted` and keeps its converted texture material; skinned slots report `library-vertex-stage-unskinned` because the library vertex stage has no skinning. One reader, `nativeMaterialProgramPin.ts`, takes the extras pin `{directory: native-materials/<sha>, programSha256}` for surfaces, sky and slots (b51e75b); actor GLB writers must use that shape.

| Check | Result |
| --- | --- |
| `tests/unit/particleMaterialBinding.test.ts` | shipped DrawStyle 3 and 6 pairs, record depth, culling and alpha test, emitter ordinal metadata, instance matrices, atlas cells and overrides |
| `tests/unit/loadEffectComponent.test.ts`, `nativeEffectRetained.test.ts` | baked primitive geometry, per-primitive library materials, AnimNext frames, refusals and cleanup; all six retained Power Strike components render live particles |
| `tests/unit/ribbonEmitter.test.ts` | synthetic ribbon golden trace at seed 1, step 1/60, 0 ulp (334 rows, regenerated in wave 12); NPC caster gets no trail |
| `tests/unit/emitterNatives.test.ts`, `mapEmitterPlayback.test.ts`, `nativeSkeletalMaterials.test.ts` | each native as its row states; visibility gate; library and magenta slots |
| `DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-skill-cast.spec.ts` (shared store) | 4 passed: `?skill=3:1` plays `lineageeffect.s_u002_a` (init) and `lineageeffect.p_u004_a` (shot) to destruction with live particles drawn; screenshots `artifacts/skill-evidence/skill-3-1-cast-1440x900.png` and `skill-3-1-cast-932x430.png`; no horizontal scroll at 430 x 932 |
| `node tools/reference-overlap/referenceOverlap.mjs --area particles` | at 02-69: 547 blocking (479 the GLSL line array of `particleMaterialBinding.ts`), 2,552 unreviewed, 4 stale sign-offs (`artifacts/reference-overlap/02-69-particles.json`); the area exits 0 since cf2c891 |

PTDS 3 and 6 stay as shipped until the swatch comparison with L2.exe is recorded here.

### Clean-room ribbon rewrite (wave 12, 2026-11-10)

`ribbonEmitter.ts` was rewritten whole (rows 704, 705) from the same Engine.dll and Core.dll and the UELib decompile of `Engine.RibbonEmitter` from Engine.u `9b04ff5c...`. Interlude has a native `URibbonEmitter` (fields SampleRate +0x4D0 to RibbonPoints +0x548, 0x34-byte points; constructor 0x103E7E80, `Initialize` 0x10692890).

- Sampling, drop and decay follow `URibbonEmitter::UpdateParticles` 0x10693C50 (rows `fx.ribbon-sampling`, `fx.ribbon-point-drop`, `fx.ribbon-decay`), redone in the binary's branch order after a review traced the sampling `stopped` flag to the reference: timer, the Num() == 0 test kept in cl, then the FDist sum. The frame byte +0x6F is set only on the reject path (0x106941C6), so the bDecayPoints block runs inside that branch with no flag. The point source stands in for `GetNewRibbonPoint` 0x10692D10, which writes Location only past its skeletal bone tests, so an unattached source returns the caller's FVector(0,0,0) preset. No production source exists yet.
- Interpolation follows 0x10693F65-0x106941B5 (`fx.ribbon-interpolation`): point 2 directions through `FVector::operator/=` 0x1010C8D0, then CntrPoints - 1 points at index 3 from the cubic at 0x10633970. That routine takes (P0, P1, T0, T1, double A), not UE2 `CubicInterp`'s (P0, T0, P1, T1, A); the row holds its float weights and sum order.
- The ribbon runs through `EmitterClassOverrides` on the emitter runtime: `Initialize` 0x10692890 sets the timer and rate once, `SpawnParticle` 0x10692B40 empties the points and restores the rate on every successful spawn, and the update runs inside `UpdateParticles` (warm-up included, skipped past SecondsBeforeInactive). There is no `URibbonEmitter::Reset` export, so a reset keeps points, timer and the lowered NumPoints (`fx.ribbon-restart`).
- `attachWeaponTrail` follows `APawn::AttachTrailer` 0x104F2B40 in its store order (wave 13 re-derivation; the `fx.weapon-trail` row holds each store, offset, address and value). An E8/E9 scan of Engine.dll finds three calls of the thunk 0x103110FE, all passing NumPoints 0. Two pawn effect sites (0x104F32E2, 0x104F3756) pass ExtraLife 0.8f (0x108A5744) and side flag 1, which the rule models; `USkillAction_SwordTrail::Notify` 0x103015B4 -> 0x104ECFE4 passes the skill action float +0x3C and bit 0 of +0x40, which `attachWeaponTrail` does not take yet. No other lock-equal system DLL or EXE names the export; `nwindow.dll` is lock-differing and unread. LifeSpan destroys the actor at <= 0.0001 (`AActor::TickAuthoritative` 0x105D2E90). The side flag picks the weapon and one bone name for `GetNewRibbonPoint`, which the point source replaces; the field roles and reader addresses are in the row. Open: `weaponLength` stands for L = f32(weapon +0x84 * first weapon +0x150 entry) (0x104F2CAC), but the client gates on the unscaled entry > 0 (0x104F2BD5), which one input cannot separate; no production caller exists yet. The NPC skip is split into `fx.weapon-trail-caster-gate` and stays unconfirmed: all three call sites test a pawn flag bit (+0x694 & 4 at 0x104F32C5, 0x104F3737, 0x104ECFC7) whose meaning is not derived.
- The point drop lowers NumPoints +0x4D8 in place (0x10694251); `Initialize` and `SpawnParticle` never write it. The state fields `numPoints`, `ribbonPoints`, `sampleTimer`, `realSampleRate`, `bKilled`, `bDecaying`, `lastSampledPoint` and `getNewRibbonPoint` carry their offsets in the rows.
- The update hook follows the entry of `UpdateParticles` (row `fx.ribbon-sampling`), skips the BoundingBox growth as the simulator does for every class, and takes the decay path on a clear bSamplePoints, then a nonzero KillPending (`AEmitter::Kill` stores 1 at 0x10608C59).

POL-04 behaviour changes, each pinned in `tests/unit/ribbonEmitter.test.ts`: float32 sample timer, FDist and curve arithmetic (golden trace regenerated in wave 12: same 334 rows, 192 values moved 1 ulp); a respawn empties the points; a reset keeps them and the lowered NumPoints; an active head particle moves to the owner location every update (wave 13); a start offset from a P past the float range stays finite while the end offset becomes infinity (wave 13; trace unchanged); a synced kill with one point never decays ((MaxLifetime - Time) / 0); CntrPoints 0 removes point 2; NumPoints below 0 throws `RibbonEmitterError` where the client asserts; no ScaleRatio guard. Point 0 gets the sample Width as a stand-in (the client never writes it). The second sampling rewrite adds `bDecaying` (addresses in the rows). Nothing else moved: the golden trace passes unchanged and an uncommitted old-against-new harness matched 122,523 steps of 800 random records.

## Skill cast presentation (plan 02-84, 2026-11-11)

- `src/effects/skillCastPresentation.ts` `createSkillCastPresentation({ scene, catalogIndex, castSkillIndex, anchors, signal })`: `present(skill-cast event)` answers a key that is not converted with its catalog reason; for a converted key it loads the bundle (`loadCastSkillEffectBundle`), starts one emitter actor playback per recorded placement and returns emitter actor count, placements, not-drawn components with reasons, feature gaps and the index named gaps. One presentation per caster; a new cast disposes the previous one; `advance` runs on the caller's frame clock.
- Placements come only from `SkillAction_LocateEffect` stage rows (`skillEffectPlacements.ts`): `bSpawnOnTarget` true is the target anchor, otherwise the caster anchor; AttachOn, offset and the other stage fields are listed as `unappliedFields`. The served manifests hold 78 such rows for 78 of 80 actors (43 caster, 35 target); 3:1 records none, so its components read `skill-effect-placement-unresolved` here and its reviewed init and shot previews stay its route. Other not-drawn reasons: `emitter-class-unported:<class>`, `skill-effect-anchor-unavailable:<side>`.
- `nativeCatalogIndex.ts` converted lookups carry `namedGaps` from coverage rows with converted true and a non-pass status (the 522 `emitter-class-unported:Engine.BeamEmitter` keys); `describeNativeCatalogLookup` names them.
- Natives: the playback hook `applyNative` delegates to `applyEmitterNative`. No served manifest records an emitter native call (stage rows keep flags such as `bSizeScale` without an argument), so the presentation applies none.
- Checks: `tests/unit/skillCastPresentation.test.ts`, `emitterActorPlayback.test.ts`, `nativeCatalogIndex.test.ts`.

## Open

- Loads: 25 actors lane keys pass on the simulator loader (02-79); the others wait for the union sweeps (03-03).
- Ribbons draw once staging binds a RibbonEmitter texture; Beam and VertMesh wait for Phase 5, and VertMesh meshes need a Converter adapter.
- Emitter natives need a converted source of native calls with their arguments; the weapon trail needs its caller; the Power Strike previews do not call AdjustparticleLife yet.
- The presentation places at the anchor pivot: AttachOn bones, offsets and stage timing (casting against shot) stay unapplied, and the skill sound (skillsoundgrp route) stays open.
- Tile map emitters need the 02-64 world binding to merge class defaults into the tile-emitters.json records and call `playTileMapEmitters`.
- Skeletal slot programs need the actor converter to write `nativeMaterialProgram` and the library vertex stage to skin.
- 25 roots are refused by the converter; their reasons are in the gap rows.
- Which candidate branch plays per stage and gate: 1,075 branches recorded with both sides, 3,208 case calls not traversed, all 292 cases intraprocedural only. One runtime question on IMPORTA-PC (a Debug session under DEC-OWN-13 or the REA thread) unblocks it; the 02-89 record holds it.
- The playback join from a candidate row to its class bundle waits for that answer; until then no candidate plays.
- 6,361 rows keep `native-skill-dispatch-required` (skill 7035 level 1 among them); a further native trace unblocks them.
- 40 class units are not published: 17 converter refusals (14 default-property syntax, 3 missing retained Emitters order), 20 unbound simulated components, 3 `no-exact-skillsound-row`; the reasons are in `class-outcome.json` of each unit.
- The next-cell cross-fade, the `UseDirectionAs` bases, ProjectionNormal and per-instance direction stay open under FX-01 (POL-04).
- The sandbox wiring of the presentation to the `skill-cast` event and its sheet note is integration work (plan 02-87).
- The cast check still runs on the harness page; the dev store switch serves the actors lane as its restage union.
- Restage: the lane catalog is restaged from the main checkout (docs/parts/npcs/EVIDENCE.md).

## Evidence

Recipes: `recipes/native-power-strike.json`, `recipes/actors/skill-dispatch-candidates.json` (generator `scripts/actors/skill_dispatch_candidate_recipe.py`, reader `scripts/actors/skill_dispatch_candidates.py`, class units `scripts/actors/skill_dispatch_class_conversion.py`; tests `tests/pipeline/test_skill_dispatch_candidates.py`, `test_skill_dispatch_byte_replay.py`; measurements `artifacts/lane-store/actors/measurements/skill-dispatch-candidates-*.json`). Notes: `docs/NATIVE_POWER_STRIKE.md`. Particle rules: `docs/parts/skills-effects/PARTICLE_SEMANTICS.md`. Plan summaries: `.planning/phases/02-stage-a-breadth/02-43-SUMMARY.md`, `02-68-SUMMARY.md`, `02-69-SUMMARY.md`, `02-84-SUMMARY.md`. Decisions: OVERNIGHT-DECISIONS rows 397 to 408, 486 to 497 and 642 to 655.
