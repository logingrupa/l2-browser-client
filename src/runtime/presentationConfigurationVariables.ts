import { formerlyEditorAuthoredStatusLabel, type PresentationConfiguration } from "../scene/presentationConfiguration";
import type { VariableInfo } from "../ui/devSheet/types";
import { nativeSandboxConfiguration, type NativeSandboxConfiguration } from "./nativeSandboxConfiguration";
import type { NativeSliceSettings } from "./createNativeSliceRuntime";

type SettingValue = string | number | boolean | readonly number[] | { asArray(): number[] } | undefined;

function formatSettingValue(value: SettingValue): string {
  if (value === undefined) return "not set";
  if (typeof value === "object") return ("asArray" in value ? value.asArray() : value).join(", ");
  return String(value);
}

function presentationVariable(name: string, value: SettingValue, trackedPath: string): VariableInfo {
  return { name, value: () => formatSettingValue(value), source: `${trackedPath} - ${formerlyEditorAuthoredStatusLabel}`, status: "presentation" };
}

export function presentationConfigurationVariables(configuration: PresentationConfiguration): VariableInfo[] {
  const { camera, lights, fog, source } = configuration;
  return [
    ...(["alpha", "beta", "radius", "target", "minZ", "maxZ", "fov", "fovMode", "lowerRadiusLimit", "upperRadiusLimit",
      "lowerBetaLimit", "upperBetaLimit", "inertia", "panningInertia", "speed", "pinchToPanMaxDistance", "allowUpsideDown"] as const)
      .map(field => presentationVariable(`presentation.camera.${field}`, camera[field], source.camera)),
    ...(["intensity", "direction", "diffuse", "specular", "groundColor"] as const)
      .map(field => presentationVariable(`presentation.lights.sky.${field}`, lights.sky[field], source.skyLight)),
    ...(["intensity", "direction", "position", "diffuse", "specular"] as const)
      .map(field => presentationVariable(`presentation.lights.sun.${field}`, lights.sun[field], source.sunlight)),
    presentationVariable("presentation.clearColor", configuration.clearColor, source.config),
    presentationVariable("presentation.ambientColor", configuration.ambientColor, source.config),
    ...(["enabled", "mode", "start", "end", "density", "color"] as const)
      .map(field => presentationVariable(`presentation.fog.${field}`, fog[field], source.config)),
  ];
}

const savedScriptSettingFields = ["leatherShirt", "origin", "materialOverrideEnabled", "materialEntityId", "materialSource", "materialTint", "materialRoughness"] as const;
const unsavedCodeDefaultSettingFields = ["playerProfileId", "flamePreviewEnabled", "flameTextureSeconds", "flameFadeSeconds",
  "flameTextureRate", "flameFadeRate"] as const;

export function nativeSandboxSettingVariables(settings: NativeSliceSettings | NativeSandboxConfiguration): VariableInfo[] {
  const { savedScriptValues, unsavedCodeDefaults } = nativeSandboxConfiguration.source;
  return [
    ...unsavedCodeDefaultSettingFields.map(field => presentationVariable(`sandbox.${field}`, settings[field], unsavedCodeDefaults)),
    ...savedScriptSettingFields.map(field => presentationVariable(`sandbox.${field}`, settings[field], savedScriptValues)),
  ];
}
