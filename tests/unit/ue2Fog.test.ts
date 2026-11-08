import { describe, expect, it } from "vitest";
import { buildDisplayGammaTable, defaultDisplayGammaSettings, DISPLAY_GAMMA_ENTRY_COUNT } from "../../src/materials/ue2/model/displayGamma";
import { applyFog, evaluateFogState, FOG_DISABLED, fogFactor, fogFamilyForBlend, fogTargetColour, type FogInputs } from "../../src/materials/ue2/model/fog";
import { blendFactorsForParticleDrawStyle } from "../../src/materials/ue2/model/blendTable";
import type { ColourUnits } from "../../src/materials/ue2/model/materialFieldValues";

const preset = { colourBytes: [100, 110, 120] as const, startSourceUnits: 2000, endSourceUnits: 8000 };
const zoneFog = { colourBytes: [10, 20, 30] as const, startSourceUnits: 100, endSourceUnits: 1100 };
const fogInfo = { colourBytes: [200, 50, 25] as const, startSourceUnits: 500, endSourceUnits: 4500 };
const water = { colourBytes: [39, 87, 126] as const, startSourceUnits: 200, endSourceUnits: 3000 };
const noSources: FogInputs = { environmentPreset: null, cameraZone: null, fogInfo: null, waterVolume: null };

describe("evaluateFogState", () => {
  it("is off without a source and exports no fogEnd", () => {
    expect(evaluateFogState(noSources)).toEqual(FOG_DISABLED);
  });

  it("lets each later source override the earlier one and exports fogEnd for the frame", () => {
    expect(evaluateFogState({ ...noSources, environmentPreset: preset })).toMatchObject({ source: "environment-preset", fogEnd: 8000 });
    const zone = { distanceFog: true, sunAffected: false, fog: zoneFog };
    expect(evaluateFogState({ ...noSources, environmentPreset: preset, cameraZone: zone })).toMatchObject({ source: "camera-zone", fogEnd: 1100, colour: [10 / 255, 20 / 255, 30 / 255] });
    expect(evaluateFogState({ environmentPreset: preset, cameraZone: zone, fogInfo, waterVolume: null })).toMatchObject({ source: "fog-info", fogEnd: 4500 });
    expect(evaluateFogState({ environmentPreset: preset, cameraZone: zone, fogInfo, waterVolume: water })).toMatchObject({ source: "water-volume", fogEnd: 3000 });
  });

  it("turns fog off in a zone that is neither sun-affected nor distance-fogged and keeps the preset in a sun-affected one", () => {
    expect(evaluateFogState({ ...noSources, environmentPreset: preset, cameraZone: { distanceFog: false, sunAffected: false, fog: null } }))
      .toMatchObject({ enabled: false, source: "zone-without-fog", fogEnd: null });
    expect(evaluateFogState({ ...noSources, environmentPreset: preset, cameraZone: { distanceFog: false, sunAffected: true, fog: null } }))
      .toMatchObject({ enabled: true, source: "environment-preset" });
  });

  it("refuses a range that does not increase and colours that are not bytes", () => {
    expect(() => evaluateFogState({ ...noSources, fogInfo: { ...fogInfo, endSourceUnits: 500 } })).toThrow(/must be finite and increasing/);
    expect(() => evaluateFogState({ ...noSources, fogInfo: { ...fogInfo, colourBytes: [256, 0, 0] } })).toThrow(/three bytes/);
  });
});

describe("fog families", () => {
  const state = evaluateFogState({ ...noSources, fogInfo });
  const colour: ColourUnits = [0.8, 0.6, 0.4, 0.5];

  it.each([[500, 0], [2500, 0.5], [4500, 1], [9000, 1]])("fog factor at view depth %f is %f", (depth, factor) => {
    expect(fogFactor(depth, state)).toBeCloseTo(factor, 12);
  });

  it("fogs toward the fog colour, black or 127/255 grey and leaves alpha alone", () => {
    const halfway = applyFog(colour, 2500, "fog-colour", state);
    [0.4 + 100 / 255, 0.3 + 25 / 255, 0.2 + 12.5 / 255, 0.5].forEach((expected, index) => expect(halfway[index]).toBeCloseTo(expected, 12));
    expect(applyFog(colour, 4500, "black", state)).toEqual([0, 0, 0, 0.5]);
    expect(applyFog(colour, 4500, "neutral-grey", state)).toEqual([127 / 255, 127 / 255, 127 / 255, 0.5]);
    expect(applyFog(colour, 4500, "none", state)).toEqual(colour);
    expect(fogTargetColour("fog-colour", FOG_DISABLED)).toBeNull();
  });

  it("takes the particle family from the draw style row", () => {
    expect(fogFamilyForBlend(blendFactorsForParticleDrawStyle(3))).toBe("black");
    expect(fogFamilyForBlend(blendFactorsForParticleDrawStyle(2))).toBe("fog-colour");
    expect(fogFamilyForBlend(blendFactorsForParticleDrawStyle(1))).toBe("none");
  });
});

describe("display gamma ramp", () => {
  it("builds the 256-entry ramp at G = 1.2, C = 0.5, B = 0.5", () => {
    const table = buildDisplayGammaTable({ gamma: 1.2, contrast: 0.5, brightness: 0.5 });
    expect(table).toHaveLength(DISPLAY_GAMMA_ENTRY_COUNT);
    for (const entry of [0, 1, 64, 128, 200, 255]) expect(table[entry]).toBeCloseTo(Math.fround((entry / 255) ** (1 / 1.2)), 6);
  });

  it("is the identity at G = 0 and clamps to [0, 1]", () => {
    expect(Array.from(buildDisplayGammaTable({ gamma: 0, contrast: 0.7, brightness: 0.8 }))).toEqual(Array.from({ length: 256 }, (_, entry) => Math.fround(entry / 255)));
    const bright = buildDisplayGammaTable({ gamma: 1, contrast: 1, brightness: 2 });
    expect(bright[255]).toBe(1);
    expect(defaultDisplayGammaSettings()).toEqual({ gamma: 1.2, brightness: 0.8, contrast: 0.7 });
  });
});
