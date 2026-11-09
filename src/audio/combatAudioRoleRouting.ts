import type { NativeCombatAudioBundle } from "./loadNativeCombatAudio";

export const generatedActorSoundBundlePrefix = "actor-sounds:";

export function combatAudioRoleRoutingDiagnostics(bundle: NativeCombatAudioBundle | null): string[] {
  if (!bundle || bundle.id.startsWith(generatedActorSoundBundlePrefix)) return [];
  return bundle.selections.flatMap(selection => Object.entries(selection.roles).map(([role, soundSet]) =>
    `Combat role routing unresolved: ${selection.id}/${role} uses hand-typed column ${soundSet.field} (combat-role-route-unresolved:${selection.table}/${role})`));
}
