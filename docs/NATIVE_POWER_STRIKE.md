# Native Power Strike

Source migration of the skill 3 level 1 effect classes that reviewed Engine.dll handlers select, plus modern browser previews. Native particle and skill behavior is unverified. Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- [Migration](NATIVE_MIGRATION.md) job `power-strike-source-dispatch` (integration thread only) runs [native-power-strike.json](../recipes/native-power-strike.json), which pins `system/Engine.dll` (30,704,468 bytes, SHA-256 `4dd2f63c606d...`) and reads it without loading it.
- Init selects `LineageEffect.s_u002_a`, the conditional shot `LineageEffect.p_u004_a`. `at_power_strike_cs` has different actor defaults; never substitute it.
- Output `artifacts/native-parity/migration/effects/power-strike-source-dispatch/`: `effect-source.json`, six emitters, 17 converted assets (four models, 11 textures, two sounds).
- Sounds ([native-power-strike-audio.json](../recipes/native-power-strike-audio.json)): `power_strike_cast` and `power_strike_shot` fill `spelleffect_sound_1/2`; their package matches are candidates, not a proved lookup.
- Dev > Effects: Power Strike components (one at a time on the right hand) and Init effects. Dev > Combat > Actions > Special attack preview plays `SpAtk01_1HS` with four direct Sound cues per gender.
- Dev > Combat > Power Strike at target: special attack at Greater Musveren, both candidate sounds, impact components at AttackShot half the source collision radius short of the target pivot. Presentation choice, no damage. Evidence: research `native-power-strike-shot-20261107`.
- The hand anchor finds the source `Weapon_R_Bone` per skin, not by global bone name. It is not native `AttachToBone`.

## Open

- Emission, lifetimes, fades and cleanup run in the FX-01 simulator (rules in `docs/parts/skills-effects/PARTICLE_SEMANTICS.md`, written with FX-01). Actor DrawScale is not applied to particles unless the Interlude re-derivation shows otherwise. Mesh emitters with `UseMeshBlendMode=false` take the DrawStyle particle material and `RenderTwoSided` from the record, not from the GLB (ACT-06, POL-01).
- The weapon trail `LineageEffect.RibbonSet` through `APawn::AttachTrailer` (Interlude thunk `0x103110FE`) is unconfirmed for skill 3. It plays as a default until POL-04 confirms it, before POL-01.
- Live attachment, native shot location, target reaction, effective `SkillHitTime` (POL-01). Source timing: `artifacts/native-parity/research/fighter-action-reference/`.
- Table-sound lookup and onset (ACT-05, POL-02); visual and audio parity (POL-01, POL-02); eight-effect workload (PERF-01).

## Pointers

- Code: `src/effects/`, `src/assets/native/nativeSpecialAttackPreview.ts`, `src/assets/native/nativeHumanHandAnchor.ts`.
- Related: [NATIVE_AUDIO.md](NATIVE_AUDIO.md), [skills evidence](parts/skills-effects/EVIDENCE.md), [research index](research/INDEX.md).
