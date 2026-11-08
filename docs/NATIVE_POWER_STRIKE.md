# Native Power Strike source migration

The migration preserves the exact native skill 3 / level 1 effect classes
selected by reviewed Engine.dll handlers. It establishes bounded source
associations and reusable authored data. Complete native particle and skill
behavior is unverified. The bounded browser previews below are modern
presentation, separate from that acceptance claim.

Status and work order: [.planning/STATE.md](../.planning/STATE.md) and
[.planning/ROADMAP.md](../.planning/ROADMAP.md). Evidence index:
[VERIFICATION.md](VERIFICATION.md).

| Source handler | Effect class | Direct superclass | Authored DrawScale | Emitters |
| --- | --- | --- | ---: | ---: |
| Init | `LineageEffect.s_u002_a` | `Engine.Emitter` | 0.05 | 3 |
| Conditional shot | `LineageEffect.p_u004_a` | `Engine.Emitter` | 0.02 | 3 |

Both actors author `AutoReplay=true`. Complete actor and emitter defaults are
retained, including inherited properties and undecoded byte ranges. The
`at_power_strike_cs` candidate has the same init emitter payloads but different
actor defaults. It is not substituted for `s_u002_a`.

## Checked source and retained products

[`native-power-strike.json`](../recipes/native-power-strike.json) pins
`system/Engine.dll` at **30,704,468 bytes**, SHA-256
`4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`, and the
effect package at SHA-256
`ea090154c4b8eb2f4fafab331c85fd8f7e42869ec71eb4f11323b546b550114a`.
The adapter reads PE32 file-backed sections without loading the DLL. For each
of the two handlers it checks the switch instruction, skill selector, selected
case target, class-literal push and UTF-16 class literal: **ten byte anchors**.
It separately verifies each direct superclass and hashes of complete authored
actor properties and emitter payloads. Reviewed observation text is retained
metadata, not executed or independently proven behavior.

The job is `power-strike-source-dispatch`. Its output is
`artifacts/native-parity/migration/effects/power-strike-source-dispatch/`.
`effect-source.json` retains the skill and sound rows, associations, source
checks, defaults and dependency graph. The bundle contains **six emitters, 12
class definitions with inherited defaults, 20 raw native objects and 17
converted assets**: four models, 11 textures and two sounds. It adds two models,
`Impact.shockwave00` and `Impact.sparkredcone00`, and leaves the other model
GLBs and terrain unchanged. All nine source files belong to the input lock, with
zero unresolved dependencies. Palette objects stay raw data where no standalone
browser adapter exists. The `at_power_strike_cs` candidate output in
`artifacts/native-parity/migration/effects/power-strike/` is evidence only.

The Engine.dll hash and protected INI checks against the IMPORTA-PC reference,
and the copy of the matching E: candidate, are recorded in
`artifacts/native-parity/source-audit/power-strike-engine-staging-20261105T151212Z.json`.
Any further E: sourcing waits for the full-tree hash lock (DEC-OWN-2). The
staging adapter accepts only the exact `system/Engine.dll` binary path. It never
executes it or copies the INI. The input lock
(`recipes/native-inputs.lock.json`, input-only, DEC-OWN-5) contains **143 files
/ 2,511,063,181 bytes**. Outputs are `.l2asset` packages plus the runtime
catalog.

The `--verify-only` log is
`artifacts/native-parity/migration-power-strike-dispatch-verify.log`. Run and verify the reusable
pipeline as documented in [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md). Source
preservation and successful rebuilds do not certify native-to-browser visual
parity.

## Browser presentation

Controls live on the dev sheet:

- **Dev → Effects › Power Strike components** offers Off and all six retained
  init and shot components, with manual texture frames and enabled color keys.
  **Inspect component** frames the selected resource at its preview scale.
  Reselecting a frame can end inspection, so use Inspect again for a close view.
- **Dev → Effects › Init effects** has **Power Strike init preview**. It
  combines the three init components on the supported human male and female
  special animation clock.
- **Dev → Combat › Actions → Special attack preview** plays the existing source
  clip and its direct cues. Component selection starts neither the clip nor
  the init preview.

With the init preview enabled, the next Special attack preview carries it.
Pause holds it. Interruption or death clears it. A new explicit special
generation reuses the prepared pool. Manual component inspection stays separate.

The finite 11/1/7 schedule, deterministic sampling, interpolation, fades, spin,
drag and final texture-frame hold are explicit modern policies. The source
lifetimes are not certified effective native lifetimes. No actor DrawScale,
AutoReplay, conditional shot placement or guessed table-sound onset is added.

The viewer loads all six components with exact texture joins and the qualified
human right-hand anchor. It follows that hand through movement and equipment
changes, hides during death and releases resources on Off, cancellation and
disposal. Character picking tags are restricted to owned body and equipment
meshes, so foreign attached components are preserved.

An independent stager copies four original GLBs and nine original PNGs plus an
ordered manifest. The optional catalog-registration tool changes only the
selected `effectComponents` entry. No source conversion or audio corpus run is
repeated. The loader preserves source primitives, nodes, UVs and texture
identity. The modern shader, sizing and billboard choices are explicit
inspection policy.

Evidence:

- `artifacts/native-parity/research/native-power-strike-components-20261107/REPORT.md`
- `artifacts/native-parity/research/native-power-strike-init-20261107/REPORT.md`
- `artifacts/native-parity/research/native-power-strike-init-20261107/IMPLEMENTATION.md`

The implementation contract separates reusable rendering from full skill,
native visible-pixel and audio, and performance acceptance.

## Sound dependencies

The [selected-skill audio command](ASSET_PIPELINE.md) packages Power Strike 3/1
without rerunning the effect migration. Its recipe is
[`native-power-strike-audio.json`](../recipes/native-power-strike-audio.json).
The source report
`artifacts/native-parity/research/native-human-skill-audio-20261107/skill-source/REPORT.md`
pins complete Interlude tables, row ordinals and exact existing products.

`SkillSound.power_strike_cast` and `SkillSound.power_strike_shot` both occupy
`spelleffect_sound_1/2`. The shot and exp slot groups and all thirty voice
strings are empty. Both declare source volume 250 and radius 40, whose runtime
units and application are unproved. The exported objects include a
`power_strike` group omitted in those raw strings. The manifest preserves that
difference and labels the two unique package/leaf matches as candidates,
without asserting native lookup. The two original stereo WAVs match the
existing exports exactly. Plan, clean, repeat and verify pass. No skill sound is
connected in the browser; the two candidate DAT sounds stay disconnected.

Both male and female `SpAtk01_1HS` clips contain four direct Sound
notifications each, verified against seven original WAVs. Special attack
preview plays those clips and cues, reusing the existing actor packages and
source clocks. It preserves the normal Hand attack and adds no weapon or
equipment selection. These cues do not establish live family or rate selection,
or synchronized skill, table and particle dispatch. Each clip keeps two
unresolved specialized events. Exact cue tuples and limits are in
`artifacts/native-parity/research/native-human-skill-audio-20261107/attack-source/REPORT.md`;
the world integration is in
`artifacts/native-parity/research/native-human-special-attack-20261107/REPORT.md`.

## Mesh emitters and hand anchor

The retained-bundle comparison
(`artifacts/native-parity/research/native-power-strike-effect-preview-20261107/REPORT.md`)
checks one renderer gap. The four converted meshes contain ordinary PBR
materials, while the four mesh emitters declare `UseMeshBlendMode=false` and
`RenderTwoSided=true`. The GLBs do not implement those emitter policies. This
is a presentation-adapter matter, not evidence that the original geometry needs
reconversion. The six components keep exact source order, raw and effective
properties and resource identities through `inspect-native-effect-bundle.py`.

Both human rigs contain the source `Weapon_R_Bone`. The hand-anchor
implementation
(`artifacts/native-parity/research/native-human-hand-anchor-20261107/REPORT.md`)
resolves the exact upper base part, source skin and original glTF-linked joint.
Its owned identity child follows the rig through animation and shirt changes.
Source keys, pivots, actor placement and equipment mappings stay intact. The
assembled skins repeat bone names and their joint indices differ, so global
name lookup and a shared joint index are rejected. Runtime helper nodes are
excluded from Babylon serialization; the original linked node stays present.
This is a converted-rig attachment dependency. It does not establish native
`AttachToBone` composition or apply the glove's unrelated `e_Hand` socket
transform.

## Timing and runtime limits

The skill row has animation `S`, an empty description and hit time
`1.0800000429153442`. Its binary association does not populate that empty field
or turn the static hit time into an effect timeline. Source research maps the
fighter's family-1 special attack to `SpAtk01_1HS_MFighter`, 47 frames at 30 fps.
Raw AttackShot and AttackItem notifications occur at approximately
0.923333373 s and 0.876666600 s. Effective playback rate, tweening and runtime
`SkillHitTime` are conditional and unverified.

Reviewed init observations include right-hand attachment through
`GetRHandBoneName`/`AttachToBone` and writing `MagicInfo.ShotTime` to the effect.
Shot requires `PendingNotify == 2` and a target or applicable associated-actor
branch. Its reviewed placement is
`target.Location - unitDirection(caster→target) * target.CollisionRadius / 2`.
That divide formula also relies on separately reviewed Core.dll evidence; this
adapter does not validate Core.dll or execute placement. The spawn helper can
call `AdjustparticleLife(ShotTime + 1)` when `MagicAniStatus == 0`. Authored
lifetimes stay separate from these conditional runtime adjustments.

Source evidence is in `artifacts/native-parity/research/fighter-action-reference/`.
The standalone extraction is in
`artifacts/native-parity/research/powerstrike-dispatch-migration/`. Its summary
does not cover Engine.dll in the main lock; the main receipts establish the
complete pinned closure.

## Open

The browser has no emission simulation and no executable native skill
timeline. Runtime staging exposes no effect timeline. Shot objects are
inspected on the hand without native target placement. These stay unverified:

- Live attachment transforms and conditional shot placement.
- Source DrawScale, effective lifetime and dispatch, lifetime, fade and
  particle-count adjustments, particle distribution and cleanup.
- Target reaction and synchronized full fighter motion.
- Table-sound lookup and onset.
- Native visual and audio parity, and performance acceptance.

Requirements: ACT-05 (skill sounds), ACT-06 (skill visuals cast by ID), POL-01
(Power Strike visual case), POL-02 (audio parity), PERF-01 (eight Power Strike
effects workload).
