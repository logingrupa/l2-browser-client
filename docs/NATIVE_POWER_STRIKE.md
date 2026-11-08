# Native Power Strike source migration

The main migration preserves the exact native skill 3 / level 1 effect classes
selected by reviewed Engine.dll handlers. This establishes bounded source
associations and reusable authored data. Complete native particle/skill behavior
remains unverified; the bounded modern browser previews below are implemented
separately from that acceptance claim.

## Current browser presentation — 2026-11-07

The [manual component viewer](../artifacts/native-parity/research/native-power-strike-components-20261107/REPORT.md)
loads all six original init/shot components with exact texture joins and a
qualified human right-hand anchor. The later
[timed init preview](../artifacts/native-parity/research/native-power-strike-init-20261107/REPORT.md)
combines the three init components on the supported human male/female special
animation clock. Enable **Power Strike init preview**, then use **Special attack
preview**. Pause holds it; interruption/death clears it; a new explicit special
generation reuses the prepared pool. Manual inspection remains separate.

The finite 11/1/7 schedule, deterministic sampling, interpolation, fades, spin,
drag and final texture-frame hold are explicit modern policies. The source
lifetimes are not certified effective native lifetimes. No actor DrawScale,
AutoReplay, conditional shot placement or guessed table-sound onset is added.
The four original direct animation cues remain independently connected.
The [implementation contract](../artifacts/native-parity/research/native-power-strike-init-20261107/IMPLEMENTATION.md)
and final checkpoint receipts distinguish reusable rendering from full skill,
native visible-pixel/audio, Editor and performance acceptance.

| Source handler | Effect class | Direct superclass | Authored DrawScale | Emitters |
| --- | --- | --- | ---: | ---: |
| Init | `LineageEffect.s_u002_a` | `Engine.Emitter` | 0.05 | 3 |
| Conditional shot | `LineageEffect.p_u004_a` | `Engine.Emitter` | 0.02 | 3 |

Both actors author `AutoReplay=true`. Complete actor and emitter defaults are
retained, including inherited properties and undecoded byte ranges. The older
`at_power_strike_cs` candidate has the same init emitter payloads but different
actor defaults; it is not substituted for `s_u002_a`.

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

The active job is `power-strike-source-dispatch`; its output is
`artifacts/native-parity/migration/effects/power-strike-source-dispatch/`.
`effect-source.json` retains the skill/sound rows, associations, source checks,
defaults and dependency graph. The bundle contains **six emitters, 12 class
definitions with inherited defaults, 20 raw native objects and 17 converted assets**: four models,
11 textures and two sounds. All nine source files belong to the current input
lock; there are zero unresolved dependencies. Palette objects remain raw data
where no standalone browser adapter exists.

Fresh authoritative Engine hash and protected INI checks, followed by copying
the matching E: candidate, are recorded in
`artifacts/native-parity/source-audit/power-strike-engine-staging-20261105T151212Z.json`.
The staging adapter accepts only the exact `system/Engine.dll` binary path;
it never executes it or copies the INI. The current lock contains **143 files /
2,511,063,181 bytes**.

The combined migration passed **381 identical products**, **26/26 cache hits**,
zero clean hits in `migration-clean-1to9688v/`, and **100 archives** (69 models,
29 textures, two sounds). All **70 GLBs** have zero validator errors/warnings;
**302 pipeline tests** passed with zero skips. Frozen receipts and preservation
evidence are under `artifacts/native-parity/editor/material-authoring-20261105/`.
The subsequent `--verify-only` passed; its log is
`artifacts/native-parity/migration-power-strike-dispatch-verify.log`.
All 67 previous model GLBs and terrain remain unchanged; the two additional
models are `Impact.shockwave00` and `Impact.sparkredcone00`. The old candidate
output remains in `migration/effects/power-strike/` as historical evidence.

## Dedicated sound dependencies — 2026-11-07

The separate [selected-skill audio command](ASSET_PIPELINE.md) now packages
Power Strike 3/1 without rerunning the effect migration. Its recipe is
[`native-power-strike-audio.json`](../recipes/native-power-strike-audio.json);
the [source report](../artifacts/native-parity/research/native-human-skill-audio-20261107/skill-source/REPORT.md)
pins complete Interlude tables, row ordinals and exact existing products.

`SkillSound.power_strike_cast` and `SkillSound.power_strike_shot` both occupy
`spelleffect_sound_1/2`; the shot/exp slot groups and all thirty voice strings
are empty. Both declare source volume 250 and radius 40, whose runtime units
and application remain unproved. The exported objects include a `power_strike`
group omitted in those raw strings. The new manifest preserves that difference
and labels the two unique package/leaf matches as candidates, without asserting
native lookup. The two original stereo WAVs match the existing exports exactly.
Plan, clean/repeat/verify and 35 focused tests pass; no skill sound is newly
connected in the browser.

Separately, both existing male/female `SpAtk01_1HS` clips contain four direct
Sound notifications each, verified against seven original WAVs. The later
[world integration](../artifacts/native-parity/research/native-human-special-attack-20261107/REPORT.md)
plays those clips/cues through **Dev → Combat › Actions → Special attack preview**,
reusing the existing actor packages and source clocks. It preserves the normal
Hand attack and adds no weapon or equipment selection. These cues do not
establish live family/rate selection or synchronized skill/table/particle
dispatch, and each clip retains two unresolved specialized events. Exact cue
tuples and retained limits are in the [attack-source report](../artifacts/native-parity/research/native-human-skill-audio-20261107/attack-source/REPORT.md).

## Timing, attachment and runtime limits

The [retained-bundle comparison](../artifacts/native-parity/research/native-power-strike-effect-preview-20261107/REPORT.md)
checks a specific renderer gap: the four converted meshes currently contain
ordinary PBR materials, while the four mesh emitters declare
`UseMeshBlendMode=false` and `RenderTwoSided=true`. The GLBs do not implement
those emitter policies. This is a missing presentation adapter, not evidence
that the original geometry needs reconversion. The six components retain their
exact source order, raw/effective properties and resource identities through
the dedicated `inspect-native-effect-bundle.py` command.

Both human rigs contain the source `Weapon_R_Bone`. The later
[hand-anchor implementation](../artifacts/native-parity/research/native-human-hand-anchor-20261107/REPORT.md)
resolves the exact upper base part, source skin and original glTF-linked joint.
Its owned identity child follows the existing rig through animation and shirt
changes; source keys, pivots, actor placement and equipment mappings stay intact.
The assembled skins repeat bone names and their joint indices differ, so global
name lookup and a shared joint index are rejected. Runtime helper nodes are
excluded from Babylon serialization; the original linked node remains present.
This establishes a converted-rig attachment dependency. It does not establish
native `AttachToBone` composition or apply the glove's unrelated `e_Hand` socket
transform. No particle rendering, skill timing or selected table sound is added.

The skill row still has animation `S`, an empty description and hit time
`1.0800000429153442`. Its binary association does not populate that empty field
or turn the static hit time into an effect timeline. Source research maps the
fighter's family-1 special attack to `SpAtk01_1HS_MFighter`, 47 frames at 30 fps.
Raw AttackShot and AttackItem notifications occur at approximately
0.923333373 s and 0.876666600 s. Effective playback rate, tweening and runtime
`SkillHitTime` remain conditional and unverified.

Reviewed init observations include right-hand attachment through
`GetRHandBoneName`/`AttachToBone` and writing `MagicInfo.ShotTime` to the effect.
Shot requires `PendingNotify == 2` and a target or applicable associated-actor
branch. Its reviewed placement is
`target.Location - unitDirection(caster→target) * target.CollisionRadius / 2`.
That divide formula also relies on separately reviewed Core.dll evidence;
this adapter does not validate Core.dll or execute placement. The spawn helper
can call `AdjustparticleLife(ShotTime + 1)` when `MagicAniStatus == 0`.
Authored lifetimes remain separate from these conditional runtime adjustments.

Live attachment transforms, conditional placement, lifetime/fade/particle-count
adjustments, cleanup, target reaction and synchronized full fighter motion are
still unverified. No browser particle simulation is implemented, and runtime
staging does not expose an executable effect timeline. Source evidence is in
`artifacts/native-parity/research/fighter-action-reference/`; the earlier
standalone extraction is retained in `research/powerstrike-dispatch-migration/`
under the same evidence root. Its original summary predates Engine's addition
to the main lock; current main receipts establish the complete pinned closure.

Run and verify the reusable pipeline as documented in
[NATIVE_MIGRATION.md](NATIVE_MIGRATION.md). Source preservation and successful
rebuilds do not certify native-to-browser visual parity.

## Browser component viewer — 2026-11-07

The later [component checkpoint](../artifacts/native-parity/research/native-power-strike-components-20261107/REPORT.md)
implements the missing bounded presentation adapter. **Dev → Effects ›
Power Strike components** offers Off and all six retained components, with manual
texture frames and enabled color keys. **Inspect component** frames the selected
resource at its actual preview scale; reselecting a frame can end inspection,
so use Inspect again for a close view. Special attack preview independently
plays the existing source clip/direct cues. Selection does not start either.

The independent stager copies four original GLBs and nine original PNGs plus
an ordered manifest. The optional catalog-registration tool changes only the
selected effectComponents entry. No source conversion or audio corpus run is
repeated. The loader preserves source primitives, nodes, UVs and texture identity;
the modern shader/sizing/billboard choices are explicit inspection policy.

The viewer follows the qualified source hand through movement and equipment,
hides during death and releases resources on Off/cancellation/disposal. An
equipment-boundary repair restricts character picking tags to owned body and
equipment meshes, preserving foreign attached components. The checkpoint links
focused tests, frozen hardware cases, inspected captures and complete preservation.

This viewer adds no emission simulation or executable native skill timeline.
Shot objects are inspected on the hand without native target placement. Source
DrawScale, effective lifetime/dispatch, particle distribution and table-sound
lookup/onset remain unresolved. The two candidate DAT sounds remain disconnected;
the original special-animation cues continue unchanged. Native visual/audio
parity, an interactive Editor save and performance acceptance remain separate.
