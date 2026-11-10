import type { AssetPackage } from "../package/readAssetPackage";
import type { BodyPartEquipmentSlot } from "../../world/worldTypes";
import { describeNativeCatalogLookup, parseItemModelRecordId, type NativeCatalogLookup } from "./nativeCatalogIndex";
import { resolveNativeHumanHandAnchor } from "./nativeHumanHandAnchor";

export type EquippedItemPresentation =
  | { readonly kind: "attached"; readonly catalogId: string; readonly sourceObject: string; readonly boneName: string; readonly status: "presentation" }
  | { readonly kind: "gap"; readonly reason: string };

export interface EquippedItemCharacter {
  readonly asset: AssetPackage;
}

const equipmentSlotMeaningUndecodedReasonPrefix = "equipment-slot-meaning-undecoded:";

function gap(reason: string): EquippedItemPresentation {
  return { kind: "gap", reason };
}

export function presentEquippedItem(slot: BodyPartEquipmentSlot, lookup: NativeCatalogLookup, character: EquippedItemCharacter): EquippedItemPresentation {
  if (lookup.status !== "converted") return gap(describeNativeCatalogLookup(lookup));
  const record = lookup.record;
  if (!("itemId" in record) || !("catalogIds" in record)) return gap(`${lookup.key} does not hold an item catalog record`);
  if (record.slot !== slot) return gap(`${lookup.key} converted for ${record.slot}, not ${slot}`);
  const catalogId = record.catalogIds[0];
  const identity = catalogId === undefined ? null : parseItemModelRecordId(catalogId);
  if (catalogId === undefined || identity === null) return gap(`${lookup.key} names no item model record`);
  if (identity.unitKind === "armor") return gap(`${lookup.key} gap: ${equipmentSlotMeaningUndecodedReasonPrefix}${identity.bodyPart}`);
  const handAnchor = resolveNativeHumanHandAnchor(character.asset);
  if (!handAnchor.binding) return gap(`${lookup.key} gap: ${handAnchor.reason}`);
  return { kind: "attached", catalogId, sourceObject: handAnchor.binding.sourceObject, boneName: handAnchor.binding.boneName, status: "presentation" };
}
