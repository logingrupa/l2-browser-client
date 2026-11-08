import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { formerlyEditorAuthoredStatusLabel, nativeSandboxPresentation } from "../../src/scene/presentationConfiguration";
import { nativeSandboxConfiguration } from "../../src/runtime/nativeSandboxConfiguration";
import { nativeSandboxSettingVariables, presentationConfigurationVariables } from "../../src/runtime/presentationConfigurationVariables";

const cameraFields = ["alpha", "beta", "radius", "target", "minZ", "maxZ", "fov", "fovMode", "lowerRadiusLimit", "upperRadiusLimit",
  "lowerBetaLimit", "upperBetaLimit", "inertia", "panningInertia", "speed", "pinchToPanMaxDistance", "allowUpsideDown"];

describe("presentation configuration sheet variables", () => {
  it("lists every camera, light, clear colour and fog value with the formerly Editor-authored label", () => {
    const variables = presentationConfigurationVariables(nativeSandboxPresentation);
    const names = variables.map(variable => variable.name);
    expect(names).toEqual([
      ...cameraFields.map(field => `presentation.camera.${field}`),
      ...["intensity", "direction", "diffuse", "specular", "groundColor"].map(field => `presentation.lights.sky.${field}`),
      ...["intensity", "direction", "position", "diffuse", "specular"].map(field => `presentation.lights.sun.${field}`),
      "presentation.clearColor", "presentation.ambientColor",
      ...["enabled", "mode", "start", "end", "density", "color"].map(field => `presentation.fog.${field}`),
    ]);
    for (const variable of variables) {
      expect(variable.status).toBe("presentation");
      expect(variable.source?.endsWith(formerlyEditorAuthoredStatusLabel)).toBe(true);
    }
    const byName = new Map(variables.map(variable => [variable.name, variable]));
    expect(byName.get("presentation.camera.alpha")!.value()).toBe(String(nativeSandboxPresentation.camera.alpha));
    expect(byName.get("presentation.camera.alpha")!.source).toBe(`assets/native-parity.scene/cameras/World camera.json - ${formerlyEditorAuthoredStatusLabel}`);
    expect(byName.get("presentation.lights.sun.direction")!.value()).toBe("-0.5, -1, 0.6");
    expect(byName.get("presentation.lights.sky.intensity")!.source).toBe(`assets/native-parity.scene/lights/Sky light.json - ${formerlyEditorAuthoredStatusLabel}`);
    expect(byName.get("presentation.lights.sun.intensity")!.source).toBe(`assets/native-parity.scene/lights/Sunlight.json - ${formerlyEditorAuthoredStatusLabel}`);
    expect(byName.get("presentation.fog.mode")!.value()).toBe("0");
    expect(byName.get("presentation.fog.mode")!.source).toBe(`assets/native-parity.scene/config.json - ${formerlyEditorAuthoredStatusLabel}`);
  });

  it("lists the sandbox player, clip, shirt and material settings with the same label", () => {
    const variables = nativeSandboxSettingVariables(nativeSandboxConfiguration);
    const byName = new Map(variables.map(variable => [variable.name, variable]));
    for (const field of ["playerProfileId", "fighterIdle", "fighterRun", "fighterAttack", "fighterDeath", "leatherShirt",
      "materialOverrideEnabled", "materialEntityId", "materialSource", "materialTint", "materialRoughness"]) {
      const variable = byName.get(`sandbox.${field}`);
      expect(variable, field).toBeDefined();
      expect(variable!.status).toBe("presentation");
      expect(variable!.source?.endsWith(formerlyEditorAuthoredStatusLabel)).toBe(true);
    }
    expect(byName.get("sandbox.fighterIdle")!.value()).toBe("Wait_1HS_MFighter");
    expect(byName.get("sandbox.materialTint")!.value()).toBe("0.45, 1, 0.6");
    expect(byName.get("sandbox.fighterIdle")!.source).toBe(`${nativeSandboxConfiguration.source.savedScriptValues} - ${formerlyEditorAuthoredStatusLabel}`);
    expect(byName.get("sandbox.playerProfileId")!.source).toBe(`${nativeSandboxConfiguration.source.unsavedCodeDefaults} - ${formerlyEditorAuthoredStatusLabel}`);
  });

  it("reads the settings the runtime received, including vector values", () => {
    const variables = nativeSandboxSettingVariables({ ...nativeSandboxConfiguration, fighterIdle: "Edited idle",
      origin: new Vector3(1, 2, 3), materialTint: new Vector3(0.1, 0.2, 0.3) });
    const byName = new Map(variables.map(variable => [variable.name, variable]));
    expect(byName.get("sandbox.fighterIdle")!.value()).toBe("Edited idle");
    expect(byName.get("sandbox.origin")!.value()).toBe("1, 2, 3");
    expect(byName.get("sandbox.materialTint")!.value()).toBe("0.1, 0.2, 0.3");
  });
});
