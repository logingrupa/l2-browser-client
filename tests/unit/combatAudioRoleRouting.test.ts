import { describe, expect, it } from "vitest";
import { combatAudioRoleRoutingDiagnostics, generatedActorSoundBundlePrefix } from "../../src/audio/combatAudioRoleRouting";
import type { NativeCombatAudioBundle, NativeCombatSelection, NativeCombatSoundSet } from "../../src/audio/loadNativeCombatAudio";

const soundSet = (selection: string, table: string, field: string): NativeCombatSoundSet => ({ selection, table, field, slots: [], unadmitted: [] });
const actorSelection: NativeCombatSelection = { id: "greater-musveren", kind: "actor", label: "Greater Musveren", table: "npcgrp", rowOrdinal: 1431,
  numeric: {}, roles: { attackItem: soundSet("greater-musveren", "npcgrp", "attack_sound1"), defense: soundSet("greater-musveren", "npcgrp", "defense_sound1"),
    damage: soundSet("greater-musveren", "npcgrp", "damage_sound") } };
const configSelection: NativeCombatSelection = { id: "alaudio-combat-config", kind: "config", label: "ALAudio.int", table: "alaudio", rowOrdinal: 0,
  numeric: {}, roles: { critical: soundSet("alaudio-combat-config", "alaudio", "EtcSound.CriticalSound") } };
const bundleWithId = (id: string): NativeCombatAudioBundle => ({ id, manifestSha256: "a".repeat(64), selections: [actorSelection, configSelection], sounds: [] });

describe("combat audio role routing diagnostics", () => {
  it("uses the record id prefix the actor sound generator writes", () => {
    expect(generatedActorSoundBundlePrefix).toBe("actor-sounds:");
  });

  it("reports every role of a hand-typed bundle in selection then role order with its column and reason", () => {
    expect(combatAudioRoleRoutingDiagnostics(bundleWithId("native-combat-audio"))).toEqual([
      "Combat role routing unresolved: greater-musveren/attackItem uses hand-typed column attack_sound1 (combat-role-route-unresolved:npcgrp/attackItem)",
      "Combat role routing unresolved: greater-musveren/defense uses hand-typed column defense_sound1 (combat-role-route-unresolved:npcgrp/defense)",
      "Combat role routing unresolved: greater-musveren/damage uses hand-typed column damage_sound (combat-role-route-unresolved:npcgrp/damage)",
      "Combat role routing unresolved: alaudio-combat-config/critical uses hand-typed column EtcSound.CriticalSound (combat-role-route-unresolved:alaudio/critical)",
    ]);
  });

  it("reports nothing for a generated actor sound bundle or a missing bundle", () => {
    expect(combatAudioRoleRoutingDiagnostics(bundleWithId("actor-sounds:npc:20001"))).toEqual([]);
    expect(combatAudioRoleRoutingDiagnostics(null)).toEqual([]);
  });

  it("does not treat an id that only contains the prefix later as generated", () => {
    expect(combatAudioRoleRoutingDiagnostics(bundleWithId("hand:actor-sounds:npc:20001"))).toHaveLength(4);
  });
});
