import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { attachDisplayGammaPostProcess, displayGammaFragmentShaderName } from "../../src/materials/ue2/babylon/displayGammaPostProcess";
import { DISPLAY_GAMMA_CONSTANTS } from "../../src/materials/ue2/model/constants/displayGammaConstants";
import { buildDisplayGammaTable, defaultDisplayGammaSettings, DISPLAY_GAMMA_ENTRY_COUNT } from "../../src/materials/ue2/model/displayGamma";

const scenes: Scene[] = [];

function nullSceneCamera(): FreeCamera {
  const scene = new Scene(new NullEngine());
  scenes.push(scene);
  return new FreeCamera("display-gamma-test-camera", Vector3.Zero(), scene);
}

afterEach(() => {
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

describe("attachDisplayGammaPostProcess", () => {
  it("builds a 256 x 1 float lookup texture whose texels equal the UpdateGamma ramp of the default settings", () => {
    const displayGamma = attachDisplayGammaPostProcess(nullSceneCamera());
    expect(DISPLAY_GAMMA_ENTRY_COUNT).toBe(256);
    expect(displayGamma.lookupTexture.getSize()).toEqual({ width: DISPLAY_GAMMA_ENTRY_COUNT, height: 1 });
    expect(displayGamma.lookupTexture.textureType).toBe(Constants.TEXTURETYPE_FLOAT);
    expect(displayGamma.lookupTexture.format).toBe(Constants.TEXTUREFORMAT_R);
    expect(displayGamma.lookupTexels).toEqual(buildDisplayGammaTable(defaultDisplayGammaSettings()));
  });

  it("attaches as the last post-process of the camera and maps each colour channel through the lookup texture", () => {
    const camera = nullSceneCamera();
    const displayGamma = attachDisplayGammaPostProcess(camera);
    expect(camera._postProcesses.at(-1)).toBe(displayGamma.postProcess);
    const fragment = Effect.ShadersStore[`${displayGammaFragmentShaderName}FragmentShader`];
    for (const channel of ["r", "g", "b"]) expect(fragment).toContain(`displayGammaChannel(sceneColour.${channel})`);
    expect(fragment).toContain(`* ${DISPLAY_GAMMA_ENTRY_COUNT - 1}.0`);
    expect(fragment).toContain(`/ ${DISPLAY_GAMMA_ENTRY_COUNT}.0`);
    expect(fragment).toContain("sceneColour.a");
  });

  it("reports the ramp, gamma and brightness and contrast rows with their status and provenance", () => {
    const inspection = attachDisplayGammaPostProcess(nullSceneCamera()).inspect();
    expect(inspection.settings).toEqual(defaultDisplayGammaSettings());
    expect(inspection.rows).toEqual([DISPLAY_GAMMA_CONSTANTS.ramp, DISPLAY_GAMMA_CONSTANTS.gamma, DISPLAY_GAMMA_CONSTANTS.brightnessAndContrast]
      .map(row => ({ id: row.id, runtimeDefault: row.runtimeDefault, status: row.status, provenance: row.provenance })));
  });

  it("releases the post-process and the lookup texture on dispose", () => {
    const camera = nullSceneCamera();
    const displayGamma = attachDisplayGammaPostProcess(camera);
    displayGamma.dispose();
    expect(camera._postProcesses).not.toContain(displayGamma.postProcess);
    expect(displayGamma.lookupTexture.getInternalTexture()).toBeNull();
    expect(() => displayGamma.dispose()).not.toThrow();
  });
});
