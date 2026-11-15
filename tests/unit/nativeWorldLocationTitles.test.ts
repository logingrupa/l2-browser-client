import { describe, expect, it } from "vitest";
import type { NativeSection } from "../../src/scene/world/loadNativeSection";
import { nativeWorldLocationTitles } from "../../src/runtime/nativeWorldLocationTitles";

function loadedSection(manifest: Partial<NativeSection["manifest"]>): Pick<NativeSection, "manifest"> {
  return { manifest: manifest as NativeSection["manifest"] };
}

describe("native world location titles", () => {
  it("titles a tile by the tile id of its loaded tile manifest", () => {
    for (const tileId of ["20_21", "00_00"]) {
      const titles = nativeWorldLocationTitles(loadedSection({ kind: "native-tile-runtime", tileId }));
      expect([titles.heading, titles.sheetTitle]).toEqual([`${tileId} · native world tile`, `${tileId} native world tile`]);
    }
  });

  it("titles a section manifest that names no tile without a tile id", () => {
    const titles = nativeWorldLocationTitles(loadedSection({ kind: "native-map-section-runtime" }));
    expect([titles.heading, titles.sheetTitle]).toEqual(["Native world section", "Native world section"]);
    expect(titles.heading).not.toMatch(/\d{2}_\d{2}/);
  });

  it("titles the asset slice when no world section loaded", () => {
    expect(nativeWorldLocationTitles(null)).toMatchObject({ heading: "Native asset slice", sheetTitle: "Native asset slice" });
  });
});
