import type { NativeMaterial } from "../../materials/ue2/babylon/material";
import type { ColourRgbUnits } from "../../materials/ue2/model/materialFieldValues";
import { nativeEnvironmentSource, skyEnvironmentBindings, type NativeSkyLiteral } from "./nativeEnvironmentTables";

export interface NativeSkyLiteralSurface {
  readonly sourceReference: string | null;
  readonly library: NativeMaterial | null;
}

const colourByteMaximum = 255;

export function createNativeSkyLiteralComparison(surfaces: readonly NativeSkyLiteralSurface[]) {
  const entries = skyEnvironmentBindings.map(binding => {
    const matches = surfaces.filter(surface => surface.sourceReference === binding.material);
    const library = matches[0]?.library ?? null;
    if (matches.length !== 1 || library === null) throw new Error(`Literal sky comparison requires one UE2 library sky surface for ${binding.material}.`);
    return { source: binding.material, library, comparedRgb: null as ColourRgbUnits | null };
  });
  let selected: NativeSkyLiteral | null = null, disposed = false;
  const release = () => {
    for (const entry of entries) { entry.library.overrideColourSourceRgb(entry.source, null); entry.comparedRgb = null; }
    selected = null;
  };
  return {
    apply(literal: NativeSkyLiteral) {
      if (disposed) throw new Error("Sky comparison was disposed.");
      const colours = entries.map(entry => {
        const layers = literal.layers.filter(layer => layer.material === entry.source), rgb = layers[0]?.row.rgb;
        if (layers.length !== 1 || !rgb || rgb.length !== 3 || rgb.some(channel => !Number.isInteger(channel) || channel < 0 || channel > colourByteMaximum)) {
          throw new Error(`Invalid literal color for ${entry.source}.`);
        }
        return [rgb[0] / colourByteMaximum, rgb[1] / colourByteMaximum, rgb[2] / colourByteMaximum] as const;
      });
      entries.forEach((entry, index) => { entry.library.overrideColourSourceRgb(entry.source, colours[index]!); entry.comparedRgb = colours[index]!; });
      selected = structuredClone(literal);
    },
    restore() { release(); },
    inspection: () => ({ mode: disposed ? "disposed" : selected ? "literal-source-row-comparison" : "stored-materials",
      source: { ...nativeEnvironmentSource }, selected: selected ? structuredClone(selected) : null,
      convention: "RGB bytes / 255 into the root ColorModifier colour source of the UE2 library sky material; alpha, texture, blending and display gamma unchanged",
      nativeSelection: "unverified", nativeInterpolation: "unverified", nativeColorConsumer: "unverified",
      materials: entries.map(entry => ({ source: entry.source, comparedRgb: entry.comparedRgb, libraryMaterialId: entry.library.inspect().materialId })) }),
    dispose() { if (disposed) return; release(); disposed = true; },
  };
}
