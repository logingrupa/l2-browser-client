import { describe, expect, it, vi } from "vitest";
import type { NativeMaterial } from "../../src/materials/ue2/babylon/material";
import type { RetainedFogInfoList } from "../../src/scene/world/cameraEnvironment";
import { bindSkyEnvironmentColours, type SkyEnvironmentColourSources, type SkyEnvironmentColourSurface } from "../../src/scene/world/skyEnvironmentColours";
import type { SkyEnvironmentColour, SkyEnvironmentColourResult } from "../../src/scene/world/worldTimeOfDay";
import { decodeFogInfos } from "../../src/scene/world/lighting/tileFogInfoRecords";
import { fogInfo9236Record } from "../support/tileLightingFixture";
import { shippedSkyBindings } from "../support/worldTimeOfDayFixture";

function fakeSurface(colorModifierNodes: readonly string[]) {
  const overrideColourSourceRgb = vi.fn<NativeMaterial["overrideColourSourceRgb"]>();
  const surface: SkyEnvironmentColourSurface = { nativeMaterial: { overrideColourSourceRgb } as unknown as NativeMaterial, colorModifierNodes };
  return { surface, overrideColourSourceRgb };
}

const noLocalFogInfos: RetainedFogInfoList = { status: "listed", hour: 12, fogInfos: [] };

function tableColoursOf(colourBySetupKey: Readonly<Record<string, SkyEnvironmentColourResult>>): () => readonly SkyEnvironmentColour[] {
  return () => shippedSkyBindings.map(binding => ({ ...binding, colour: colourBySetupKey[binding.setupKey] ?? { status: "resolved", value: [1, 2, 3] } }));
}

function coloursOf(colourBySetupKey: Readonly<Record<string, SkyEnvironmentColourResult>>,
  retainedFogInfos: () => RetainedFogInfoList = () => noLocalFogInfos): SkyEnvironmentColourSources {
  return { tableColours: tableColoursOf(colourBySetupKey), retainedFogInfos };
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
    expect(writer.inspection().map(entry => [entry.setupKey, entry.materialNode, entry.writtenRgb, entry.materialColourSource, entry.reason])).toEqual([
      ["SKYBOX", "L2_Skies.Shaders.SkybackgroundColor", [66, 124, 176], "environment-write", null],
      ["HAZERING", "L2_Skies.Shaders.hazering_final", [51, 102, 255], "environment-write", null],
      ["CLOUD1", null, null, "authored-colour", "sky-environment-material-absent"],
      ["CLOUD2", null, null, "authored-colour", "sky-environment-material-absent"],
      ["CLOUD3", null, null, "authored-colour", "sky-environment-material-absent"],
    ]);
  });

  it("holds the last written colour and names the gap while the colour is unresolved, on every surface that shares the object", () => {
    const first = fakeSurface(["L2_Skies.Shaders.Cloud_Final"]);
    const second = fakeSurface(["L2_Skies.Shaders.Cloud_Final"]);
    let cloud: SkyEnvironmentColourResult = { status: "resolved", value: [10, 20, 30] };
    const writer = bindSkyEnvironmentColours([first.surface, second.surface], { tableColours: () => tableColoursOf({ CLOUD1: cloud })(),
      retainedFogInfos: () => noLocalFogInfos });
    writer.write();
    cloud = { status: "unresolved", reason: "env-color-transition-unresolved" };
    writer.write();
    writer.write();
    for (const surface of [first, second]) {
      expect(surface.overrideColourSourceRgb.mock.calls).toEqual([["L2_Skies.Shaders.Cloud_Final", [10 / 255, 20 / 255, 30 / 255]]]);
    }
    expect(writer.inspection().find(entry => entry.setupKey === "CLOUD1"))
      .toMatchObject({ writtenRgb: [10, 20, 30], materialColourSource: "held-environment-write", reason: "env-color-transition-unresolved" });
    cloud = { status: "resolved", value: [40, 50, 60] };
    writer.write();
    expect(first.overrideColourSourceRgb).toHaveBeenLastCalledWith("L2_Skies.Shaders.Cloud_Final", [40 / 255, 50 / 255, 60 / 255]);
    expect(writer.inspection().find(entry => entry.setupKey === "CLOUD1"))
      .toMatchObject({ writtenRgb: [40, 50, 60], materialColourSource: "environment-write", reason: null });
  });

  it("leaves the authored colour and names the gap when the first colour is already unresolved", () => {
    const sky = fakeSurface(["L2_Skies.Shaders.SkybackgroundColor"]);
    const writer = bindSkyEnvironmentColours([sky.surface], coloursOf({ SKYBOX: { status: "unresolved", reason: "sky-layer-start-colour-unresolved" } }));
    writer.write();
    expect(sky.overrideColourSourceRgb).not.toHaveBeenCalled();
    expect(writer.inspection()[0]).toMatchObject({ writtenRgb: null, materialColourSource: "authored-colour", reason: "sky-layer-start-colour-unresolved" });
  });

  it("writes the local L2FogInfo sky colour over the table colour and holds the last write while the fog reference pawn is absent", () => {
    const sky = fakeSurface(["L2_Skies.Shaders.SkybackgroundColor"]);
    const fogInfo = decodeFogInfos([fogInfo9236Record()])[0]!.record!;
    let retained: RetainedFogInfoList = { status: "listed", hour: 12.3, fogInfos: [{ fogInfo, weight: 1 }] };
    const writer = bindSkyEnvironmentColours([sky.surface], coloursOf({ SKYBOX: { status: "resolved", value: [66, 124, 176] } }, () => retained));
    writer.write();
    expect(sky.overrideColourSourceRgb).toHaveBeenLastCalledWith("L2_Skies.Shaders.SkybackgroundColor", [132 / 255, 146 / 255, 131 / 255]);
    expect(writer.inspection()[0]).toMatchObject({ tableRgb: [66, 124, 176], localFogInfoCount: 1, writtenRgb: [132, 146, 131], materialColourSource: "environment-write" });
    retained = { status: "unresolved", reason: "fog-info-reference-pawn-absent" };
    writer.write();
    expect(sky.overrideColourSourceRgb).toHaveBeenCalledTimes(1);
    expect(writer.inspection()[0]).toMatchObject({ writtenRgb: [132, 146, 131], materialColourSource: "held-environment-write", reason: "fog-info-reference-pawn-absent" });
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
    const writer = bindSkyEnvironmentColours([sky.surface], { tableColours: () => bindings.map(binding => ({ ...binding, colour: { status: "resolved", value: [0, 0, 0] } })),
      retainedFogInfos: () => noLocalFogInfos });
    bindings = shippedSkyBindings.slice(1);
    expect(() => writer.write()).toThrow("The sky environment bindings changed after the sky materials were bound.");
  });
});
