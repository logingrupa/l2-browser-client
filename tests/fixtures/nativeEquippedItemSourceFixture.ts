import { catalogEquippedItemSource } from "../../src/assets/native/nativeEquippedItemSource";
import { unavailableNativeCatalogIndex } from "../../src/assets/native/nativeCatalogIndex";
import { catalogWith } from "../support/nativeCatalogIndexFixtures";

export const itemlessEquippedItemSource = catalogEquippedItemSource(catalogWith({}), unavailableNativeCatalogIndex("the fixture serves no item catalog"));
