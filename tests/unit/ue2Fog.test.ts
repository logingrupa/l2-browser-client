import { describe, expect, it } from "vitest";
import { buildDisplayGammaTable, defaultDisplayGammaSettings, DISPLAY_GAMMA_ENTRY_COUNT } from "../../src/materials/ue2/model/displayGamma";
import { evaluateFogState, FOG_DISABLED, FOG_UNRESOLVED, fogTargetColour, type FogInputs } from "../../src/materials/ue2/model/fog";
import { blendFactorsForParticleDrawStyle } from "../../src/materials/ue2/model/blendTable";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { buildFragmentChain, fogFactorExpression, foggedColourExpression } from "../../src/materials/ue2/babylon/fragmentChain";
import { particleFragmentChain } from "../../src/materials/ue2/babylon/particleFragmentChain";
import { swatchTexturePng, syntheticSwatchProgram, textureImageFor } from "../support/materialProgramFixture";

const zoneFog = { colourBytes: [10, 20, 30] as const, startSourceUnits: 100, endSourceUnits: 1100 };
const localFog = { colourBytes: [200, 50, 25] as const, startSourceUnits: 500, endSourceUnits: 4500 };
const volumeFog = { colourBytes: [39, 87, 126] as const, startSourceUnits: 200, endSourceUnits: 3000 };
const hazeFog = { colourBytes: [188, 203, 224] as const, startSourceUnits: 8192, endSourceUnits: 20480 };
const blendedLocalFog = { status: "blended", record: localFog } as const;
const resolvedHaze = { status: "resolved", record: hazeFog } as const;
const noSources: FogInputs = { volume: null, localFogList: { status: "empty" }, cameraZone: null, terrainZoneEnvironment: { status: "unresolved" } };
const distanceFogZone = { distanceFog: true, terrainZone: false, fog: zoneFog };
const terrainZone = { ...distanceFogZone, terrainZone: true };

describe("evaluateFogState", () => {
  it("is off without a source and carries no separate fog end field", () => {
    expect(evaluateFogState(noSources)).toEqual(FOG_DISABLED);
    expect(Object.keys(FOG_DISABLED)).toEqual(["enabled", "source", "colour", "startSourceUnits", "endSourceUnits"]);
  });

  it("takes a fogged volume, then a non-empty local list, then the terrain zone haze, then ZoneInfo distance fog, and exports its range end for the frame", () => {
    expect(evaluateFogState({ ...noSources, cameraZone: distanceFogZone })).toMatchObject({ source: "camera-zone", endSourceUnits: 1100, colour: [10 / 255, 20 / 255, 30 / 255] });
    expect(evaluateFogState({ ...noSources, cameraZone: terrainZone, terrainZoneEnvironment: resolvedHaze }))
      .toMatchObject({ source: "terrain-zone-environment", endSourceUnits: 20480, colour: [188 / 255, 203 / 255, 224 / 255] });
    expect(evaluateFogState({ ...noSources, localFogList: blendedLocalFog, cameraZone: terrainZone, terrainZoneEnvironment: resolvedHaze }))
      .toMatchObject({ source: "local-fog-list", endSourceUnits: 4500 });
    expect(evaluateFogState({ volume: volumeFog, localFogList: blendedLocalFog, cameraZone: terrainZone, terrainZoneEnvironment: resolvedHaze }))
      .toMatchObject({ source: "volume", endSourceUnits: 3000 });
  });

  it("turns fog off in a zone without distance fog even when it is a terrain zone", () => {
    expect(evaluateFogState({ ...noSources, cameraZone: { distanceFog: false, terrainZone: true, fog: null }, terrainZoneEnvironment: resolvedHaze }))
      .toMatchObject({ enabled: false, source: "zone-without-fog" });
  });

  it("enables fog only through the zone bDistanceFog flag, so a blended local list or a fogged volume in a zone without distance fog stays off", () => {
    const zoneWithoutFog = { distanceFog: false, terrainZone: true, fog: null };
    expect(evaluateFogState({ ...noSources, localFogList: blendedLocalFog, cameraZone: zoneWithoutFog })).toEqual({ ...FOG_DISABLED, source: "zone-without-fog" });
    expect(evaluateFogState({ ...noSources, volume: volumeFog, localFogList: blendedLocalFog, cameraZone: zoneWithoutFog }))
      .toEqual({ ...FOG_DISABLED, source: "zone-without-fog" });
    expect(evaluateFogState({ ...noSources, localFogList: { status: "unresolved" }, cameraZone: zoneWithoutFog })).toEqual({ ...FOG_DISABLED, source: "zone-without-fog" });
  });

  it("shows a colour source without a known camera zone as unresolved, because the enable flag is unknown", () => {
    expect(evaluateFogState({ ...noSources, localFogList: blendedLocalFog })).toEqual(FOG_UNRESOLVED);
    expect(evaluateFogState({ ...noSources, volume: volumeFog })).toEqual(FOG_UNRESOLVED);
    expect(evaluateFogState({ ...noSources, localFogList: { status: "unresolved" } })).toEqual(FOG_UNRESOLVED);
  });

  it("shows a non-terrain distance fog zone without a decoded DistanceFog range as unresolved", () => {
    expect(evaluateFogState({ ...noSources, cameraZone: { ...distanceFogZone, fog: null } })).toEqual(FOG_UNRESOLVED);
    expect(evaluateFogState({ ...noSources, cameraZone: { ...terrainZone, fog: null }, terrainZoneEnvironment: resolvedHaze })).toMatchObject({ source: "terrain-zone-environment" });
  });

  it("shows an unresolved local list, terrain flag or haze colour as unresolved fog, never as grey or ZoneInfo fog", () => {
    expect(evaluateFogState({ ...noSources, localFogList: { status: "unresolved" }, cameraZone: distanceFogZone })).toEqual(FOG_UNRESOLVED);
    expect(evaluateFogState({ ...noSources, cameraZone: { ...distanceFogZone, terrainZone: null } })).toEqual(FOG_UNRESOLVED);
    expect(evaluateFogState({ ...noSources, cameraZone: terrainZone })).toEqual(FOG_UNRESOLVED);
  });

  it("refuses a range that does not increase and colours that are not bytes", () => {
    expect(() => evaluateFogState({ ...noSources, cameraZone: distanceFogZone, localFogList: { status: "blended", record: { ...localFog, endSourceUnits: 500 } } }))
      .toThrow(/must be finite and increasing/);
    expect(() => evaluateFogState({ ...noSources, cameraZone: distanceFogZone, localFogList: { status: "blended", record: { ...localFog, colourBytes: [256, 0, 0] } } }))
      .toThrow(/three bytes/);
  });
});

describe("fog families", () => {
  const state = evaluateFogState({ ...noSources, localFogList: blendedLocalFog, cameraZone: distanceFogZone });

  it("targets the fog colour, black or 127/255 grey, and nothing for the none family or with fog off", () => {
    expect(fogTargetColour("fog-colour", state)).toEqual([200 / 255, 50 / 255, 25 / 255]);
    expect(fogTargetColour("black", state)).toEqual([0, 0, 0]);
    expect(fogTargetColour("neutral-grey", state)).toEqual([127 / 255, 127 / 255, 127 / 255]);
    expect(fogTargetColour("none", state)).toBeNull();
    expect(fogTargetColour("fog-colour", FOG_DISABLED)).toBeNull();
  });

  it("takes the particle family from the draw style row", () => {
    expect(blendFactorsForParticleDrawStyle(3).fogFamily).toBe("black");
    expect(blendFactorsForParticleDrawStyle(2).fogFamily).toBe("fog-colour");
    expect(blendFactorsForParticleDrawStyle(1).fogFamily).toBe("none");
  });
});

describe("fog shader source", () => {
  it("ramps linearly from the start to the end distance, clamps, and mixes the target colour over the clamped colour with alpha untouched", () => {
    expect(fogFactorExpression("depth")).toBe("ue2FogRange.z > 0.5 ? clamp((depth - ue2FogRange.x) / max(ue2FogRange.y - ue2FogRange.x, 0.000001), 0.0, 1.0) : 0.0");
    expect(foggedColourExpression("colour.rgb", "colour.a", "factor")).toBe("vec4(mix(clamp(colour.rgb, 0.0, 1.0), ue2FogColour.rgb, factor), clamp(colour.a, 0.0, 1.0))");
  });

  it("is the one fog expression the material and particle fragment chains both draw with", () => {
    const program = parseMaterialProgram(JSON.parse(JSON.stringify(syntheticSwatchProgram(textureImageFor(swatchTexturePng())))));
    const plan = compileMaterialStagePlan(program);
    if (plan.status !== "compiled") throw new Error(plan.reasons.join(", "));
    const materialSource = buildFragmentChain(plan, "unlit").fragmentSource;
    expect(materialSource).toContain(`float ue2FogFactor = ${fogFactorExpression("ue2ViewDepth")};`);
    expect(materialSource).toMatch(/gl_FragColor = vec4\(mix\(clamp\(.+, 0\.0, 1\.0\), ue2FogColour\.rgb, ue2FogFactor\), clamp\(.+\.a, 0\.0, 1\.0\)\);/);
    const particleSource = particleFragmentChain(3).fragmentFunctionSource;
    expect(particleSource).toContain(`float fogFactor = ${fogFactorExpression("viewDepth")};`);
    expect(particleSource).toContain(`return ${foggedColourExpression("sourceColour.rgb", "sourceColour.a", "fogFactor")};`);
  });
});

describe("display gamma ramp", () => {
  const sixteenBitSteps = 65535;

  it("builds the 256-entry ramp at G = 1.2, C = 0.5, B = 0.5 in the 16-bit steps UpdateGamma writes", () => {
    const table = buildDisplayGammaTable({ gamma: 1.2, contrast: 0.5, brightness: 0.5 });
    expect(table).toHaveLength(DISPLAY_GAMMA_ENTRY_COUNT);
    for (const entry of [0, 1, 64, 128, 200, 255]) {
      const step = Math.round(table[entry]! * sixteenBitSteps);
      expect(table[entry]).toBe(Math.fround(step / sixteenBitSteps));
      expect(Math.abs(step - (entry / 255) ** (1 / Math.fround(1.2)) * sixteenBitSteps)).toBeLessThanOrEqual(0.5);
    }
    expect(table[128]).not.toBe(Math.fround((128 / 255) ** (1 / 1.2)));
  });

  it("follows UpdateGamma at G = 0: a flat ramp from the brightness and contrast terms, and pow(1, +inf) = 1 at the top", () => {
    const table = buildDisplayGammaTable({ gamma: 0, contrast: 0.7, brightness: 0.8 });
    expect(Array.from(table.subarray(0, 255))).toEqual(Array.from({ length: 255 }, () => Math.fround(3277 / sixteenBitSteps)));
    expect(table[255]).toBe(1);
  });

  it("clamps each entry to 0 to 65535 and keeps the Option.ini defaults", () => {
    const bright = buildDisplayGammaTable({ gamma: 1, contrast: 1, brightness: 2 });
    expect(bright[255]).toBe(1);
    expect(buildDisplayGammaTable({ gamma: 1, contrast: 0, brightness: -2 })[0]).toBe(0);
    expect(() => buildDisplayGammaTable({ gamma: -1, contrast: 0, brightness: 0 })).toThrow(RangeError);
    expect(defaultDisplayGammaSettings()).toEqual({ gamma: 1.2, brightness: 0.8, contrast: 0.7 });
  });
});
