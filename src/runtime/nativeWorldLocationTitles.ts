import type { NativeSection } from "../scene/world/loadNativeSection";

export interface NativeWorldLocationTitles {
  readonly heading: string;
  readonly sheetTitle: string;
  readonly description: string;
}

const assetSliceTitles: NativeWorldLocationTitles = {
  heading: "Native asset slice",
  sheetTitle: "Native asset slice",
  description: "Native rigs with synthetic behavior; no native world section is staged.",
};

const sectionDescription = "Source-derived location; native debug location and terrain materials remain unverified.";

export function nativeWorldLocationTitles(section: Pick<NativeSection, "manifest"> | null): NativeWorldLocationTitles {
  if (section === null) return assetSliceTitles;
  if (section.manifest.kind === "native-tile-runtime") {
    const { tileId } = section.manifest;
    return { heading: `${tileId} · native world tile`, sheetTitle: `${tileId} native world tile`, description: sectionDescription };
  }
  return { heading: "Native world section", sheetTitle: "Native world section", description: sectionDescription };
}
