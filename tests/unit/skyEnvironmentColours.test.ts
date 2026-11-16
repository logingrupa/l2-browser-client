import { describe, expect, it, vi } from "vitest";
import type { NativeMaterial } from "../../src/materials/ue2/babylon/material";
import { bindSkyEnvironmentColours, type SkyEnvironmentColourSurface } from "../../src/scene/world/skyEnvironmentColours";
import type { SkyEnvironmentColour, SkyEnvironmentColourResult } from "../../src/scene/world/worldTimeOfDay";
import { shippedSkyBindings } from "../support/worldTimeOfDayFixture";

function fakeSurface(colorModifierNodes: readonly string[]) {
  const overrideColourSourceRgb = vi.fn<NativeMaterial["overrideColourSourceRgb"]>();
  const surface: SkyEnvironmentColourSurface = { nativeMaterial: { overrideColourSourceRgb } as unknown as NativeMaterial, colorModifierNodes };
  return { surface, overrideColourSourceRgb };
}

function coloursOf(colourBySetupKey: Readonly<Record<string, SkyEnvironmentColourResult>>): () => readonly SkyEnvironmentColour[] {
  return () => shippedSkyBindings.map(binding => ({ ...binding, colour: colourBySetupKey[binding.setupKey] ?? { status: "resolved", value: [1, 2, 3] } }));
}

describe("bindSkyEnvironmentColours", () => {
  it("writes each resolved colour as RGB units into the ColorModifier named by its Env.int object, ignoring name case", () => {
    const sky = fakeSurface(["L2_Skies.Shaders.SkybackgroundColor"]);
    const haze = fakeSurface(["L2_Skies.Shaders.hazering_final"]);
    const writer = bindSkyEnvironmentColours([sky.surface, haze.surface],
      coloursOf({ SKYBOX: { status: "resolved", value: [66, 124, 176] }, HAZERING: { status: "resolved", value: [51, 102, 255] } }));
    expect(sky.overrideColourSourceRgb).not.toHaveBeenCalled();
    writer.write();
    expect(sky.overrideColourSourceRgb).toHaveBeenCalledExactlyOnceWith("L2_Skies.Shaders.SkybackgroundColor", [66 / 255, 124 / 255, 176 / 255]);
    expect(haze.overrideColourSourceRgb).toHaveBeenCalledExactlyOnceWith("L2_Skies.Shaders.hazering_final", [51 / 255, 102 / 255, 1]);
    expect(writer.inspection().map(entry => [entry.setupKey, entry.materialNode, entry.writtenRgb, entry.reason])).toEqual([
      ["SKYBOX", "L2_Skies.Shaders.SkybackgroundColor", [66, 124, 176], null],
      ["HAZERING", "L2_Skies.Shaders.hazering_final", [51, 102, 255], null],
      ["CLOUD1", null, null, "sky-environment-material-absent"],
      ["CLOUD2", null, null, "sky-environment-material-absent"],
      ["CLOUD3", null, null, "sky-environment-material-absent"],
    ]);
  });

  it("clears the override and names the gap when the colour is unresolved, and writes every surface that shares the object", () => {
    const first = fakeSurface(["L2_Skies.Shaders.Cloud_Final"]);
    const second = fakeSurface(["L2_Skies.Shaders.Cloud_Final"]);
    let cloud: SkyEnvironmentColourResult = { status: "resolved", value: [10, 20, 30] };
    const writer = bindSkyEnvironmentColours([first.surface, second.surface], () => coloursOf({ CLOUD1: cloud })());
    writer.write();
    cloud = { status: "unresolved", reason: "env-color-transition-unresolved" };
    writer.write();
    for (const surface of [first, second]) {
      expect(surface.overrideColourSourceRgb.mock.calls).toEqual([["L2_Skies.Shaders.Cloud_Final", [10 / 255, 20 / 255, 30 / 255]], ["L2_Skies.Shaders.Cloud_Final", null]]);
    }
    expect(writer.inspection().find(entry => entry.setupKey === "CLOUD1")).toMatchObject({ writtenRgb: null, reason: "env-color-transition-unresolved" });
  });

  it("refuses an Env.int object name that matches two different ColorModifier objects", () => {
    const sky = fakeSurface(["L2_Skies.Shaders.SkybackgroundColor"]);
    const other = fakeSurface(["L2_SkiesNight.Shaders.SkybackgroundColor"]);
    expect(() => bindSkyEnvironmentColours([sky.surface, other.surface], coloursOf({})))
      .toThrow("Sky environment binding SKYBOX=SkybackgroundColor matches 2 ColorModifier objects: l2_skies.shaders.skybackgroundcolor, l2_skiesnight.shaders.skybackgroundcolor.");
  });

  it("refuses bindings that change after the sky materials were bound", () => {
    const sky = fakeSurface(["L2_Skies.Shaders.SkybackgroundColor"]);
    let bindings = shippedSkyBindings;
    const writer = bindSkyEnvironmentColours([sky.surface], () => bindings.map(binding => ({ ...binding, colour: { status: "resolved", value: [0, 0, 0] } })));
    bindings = shippedSkyBindings.slice(1);
    expect(() => writer.write()).toThrow("The sky environment bindings changed after the sky materials were bound.");
  });
});
