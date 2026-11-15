import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formerlyEditorAuthoredStatusLabel, nativeSandboxPresentation,
  type PresentationConfiguration, type PresentationSourceFiles,
} from "../../src/scene/presentationConfiguration";
import { nativeSandboxConfiguration } from "../../src/runtime/nativeSandboxConfiguration";

type SavedJson = Record<string, unknown>;

function readSavedEditorJson(path: string): SavedJson {
  return JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as SavedJson;
}

const savedCameraFields = ["alpha", "beta", "radius", "target", "minZ", "maxZ", "fov", "fovMode", "lowerRadiusLimit", "upperRadiusLimit",
  "lowerBetaLimit", "upperBetaLimit", "inertia", "panningInertia", "speed", "pinchToPanMaxDistance", "allowUpsideDown", "name"] as const;

function expectPresentationEqualsSavedScene(configuration: PresentationConfiguration, files: PresentationSourceFiles): void {
  const camera = readSavedEditorJson(files.camera);
  expect(camera.type).toBe("ArcRotateCamera");
  for (const field of savedCameraFields) expect(configuration.camera[field], `camera.${field}`).toEqual(camera[field]);
  const skyLight = readSavedEditorJson(files.skyLight);
  expect(skyLight.type).toBe(3);
  for (const field of ["name", "intensity", "direction", "diffuse", "specular", "groundColor"] as const) {
    expect(configuration.lights.sky[field], `sky light ${field}`).toEqual(skyLight[field]);
  }
  const sunlight = readSavedEditorJson(files.sunlight);
  expect(sunlight.type).toBe(1);
  for (const field of ["name", "intensity", "direction", "position", "diffuse", "specular"] as const) {
    expect(configuration.lights.sun[field], `sunlight ${field}`).toEqual(sunlight[field]);
  }
  const config = readSavedEditorJson(files.config);
  expect(configuration.clearColor).toEqual(config.clearColor);
  expect(configuration.ambientColor).toEqual(config.ambientColor);
  const fog = config.fog as SavedJson;
  expect(configuration.fog).toEqual({ enabled: fog.fogEnabled, mode: fog.fogMode, start: fog.fogStart, end: fog.fogEnd,
    density: fog.fogDensity, color: fog.fogColor });
  expect(configuration.source).toEqual(files);
  expect(configuration.statusLabel).toBe(formerlyEditorAuthoredStatusLabel);
}

describe("presentation values formerly authored in Editor scenes", () => {
  it("native sandbox presentation equals the saved native-parity scene field by field", () => {
    expectPresentationEqualsSavedScene(nativeSandboxPresentation, {
      camera: "assets/native-parity.scene/cameras/World camera.json",
      skyLight: "assets/native-parity.scene/lights/Sky light.json",
      sunlight: "assets/native-parity.scene/lights/Sunlight.json",
      config: "assets/native-parity.scene/config.json",
    });
    expect(nativeSandboxPresentation.fog.mode).toBe(0);
  });

  it("native sandbox settings equal every saved Editor script value", () => {
    const config = readSavedEditorJson("assets/native-parity.scene/config.json");
    const script = (config.metadata as { scripts: { key: string; values: Record<string, { value: unknown }> }[] }).scripts[0]!;
    expect(script.key).toBe("scripts/nativeParity.ts");
    const savedKeys = Object.keys(script.values);
    expect(savedKeys.length).toBeGreaterThan(0);
    for (const key of savedKeys) {
      expect(nativeSandboxConfiguration[key as keyof typeof nativeSandboxConfiguration], key).toEqual(script.values[key]!.value);
    }
    expect(nativeSandboxConfiguration.source.savedScriptValues).toContain("assets/native-parity.scene/config.json");
  });

  it("labels every carried value as presentation, not Lineage II", () => {
    expect(formerlyEditorAuthoredStatusLabel).toBe("presentation, formerly Editor-authored, not L2");
    expect(nativeSandboxPresentation.statusLabel).toBe(formerlyEditorAuthoredStatusLabel);
    expect(nativeSandboxConfiguration.statusLabel).toBe(formerlyEditorAuthoredStatusLabel);
  });
});
