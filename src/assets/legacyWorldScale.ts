import type { WorldEntity } from "../world/worldTypes";

/** Undo each retained Unity-derived rig's own height fit. These are NOT native
 * Interlude conversion values; new .l2asset models retain their source transforms.
 * Source factors/hashes are recorded in docs/CONVERSION_TOOLING_AUDIT.md.
 * .019 is the matching Unity importer scale; .01 is its FBX file-unit scale.
 */
const normalization: Readonly<Record<string, number>> = {
  MFighter: 3.98760320843914,
  FFighter: 4.091118798583783,
  MMagic: 4.262465417026271,
  FMagic: 4.4287981137014585,
};
export function legacyWorldCharacterScale(entity: WorldEntity): number {
  return .019 / .01 / (normalization[entity.appearanceId ?? ""] ?? normalization.MFighter!);
}
