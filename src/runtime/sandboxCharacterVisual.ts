import type { CharacterVisualFactory } from "../assets/CharacterVisual";
import {
  characterCatalogKey, describeNativeCatalogLookup, type NativeCatalogIndex, type NativeCharacterCatalogRecord,
} from "../assets/native/nativeCatalogIndex";
import { createMissingAssetMarkerVisual, type SandboxNpcAppearance, type SandboxNpcPresentation } from "./sandboxNpcVisual";

export type SandboxAppearanceOfCharacterRecord = (record: NativeCharacterCatalogRecord) => SandboxNpcAppearance;

export type SandboxCharacterPresentation = SandboxNpcPresentation;

const playerProfileNotLoadedReason = "its player profile is not loaded in this sandbox";

function isCharacterCatalogRecord(record: object): record is NativeCharacterCatalogRecord {
  return "chargrpIndex" in record && "playerProfileId" in record;
}

export function sandboxLoadedPlayerProfileAppearance(loadedPlayerProfileId: string, loadedAppearanceId: string): SandboxAppearanceOfCharacterRecord {
  return record => record.playerProfileId === loadedPlayerProfileId ? { appearanceId: loadedAppearanceId } : { unavailableReason: playerProfileNotLoadedReason };
}

export function resolveSandboxCharacterPresentation(index: NativeCatalogIndex, templateIndex: number,
  appearanceOfCharacterRecord: SandboxAppearanceOfCharacterRecord): SandboxCharacterPresentation {
  const lookup = index.lookup(characterCatalogKey(templateIndex));
  if (lookup.status !== "converted") return { missingAssetDiagnostic: describeNativeCatalogLookup(lookup) };
  if (!isCharacterCatalogRecord(lookup.record)) throw new Error(`${lookup.key} does not hold a character catalog record.`);
  const appearance = appearanceOfCharacterRecord(lookup.record);
  if ("unavailableReason" in appearance) return { missingAssetDiagnostic: `${lookup.key} converted but ${appearance.unavailableReason}` };
  return { appearanceId: appearance.appearanceId };
}

export function sandboxCharacterVisualFactory(index: NativeCatalogIndex, nextFactory: CharacterVisualFactory,
  appearanceOfCharacterRecord: SandboxAppearanceOfCharacterRecord): CharacterVisualFactory {
  return (scene, entity, onAssetStatus) => {
    if (entity.characterTemplateIndex === undefined) return nextFactory(scene, entity, onAssetStatus);
    const presentation = resolveSandboxCharacterPresentation(index, entity.characterTemplateIndex, appearanceOfCharacterRecord);
    if ("missingAssetDiagnostic" in presentation) return createMissingAssetMarkerVisual(scene, entity, presentation.missingAssetDiagnostic);
    return nextFactory(scene, { ...entity, appearanceId: presentation.appearanceId }, onAssetStatus);
  };
}
