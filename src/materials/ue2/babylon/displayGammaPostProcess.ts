import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { DISPLAY_GAMMA_CONSTANTS } from "../model/constants/displayGammaConstants";
import { buildDisplayGammaTable, defaultDisplayGammaSettings, DISPLAY_GAMMA_ENTRY_COUNT, type DisplayGammaSettings } from "../model/displayGamma";

export const displayGammaFragmentShaderName = "ue2DisplayGamma";
const displayGammaLookupSamplerName = "displayGammaLookup";
const sceneColourSamplerName = "textureSampler";

export interface DisplayGammaRampRow {
  readonly id: string;
  readonly runtimeDefault: unknown;
  readonly status: string;
  readonly provenance: string;
}

export interface DisplayGammaInspection {
  readonly settings: DisplayGammaSettings;
  readonly rows: readonly DisplayGammaRampRow[];
}

export interface DisplayGammaPostProcess {
  readonly postProcess: PostProcess;
  readonly lookupTexture: RawTexture;
  readonly lookupTexels: Float32Array;
  inspect(): DisplayGammaInspection;
  dispose(): void;
}

function displayGammaFragmentSource(): string {
  const lastEntry = `${DISPLAY_GAMMA_ENTRY_COUNT - 1}.0`, entryCount = `${DISPLAY_GAMMA_ENTRY_COUNT}.0`;
  return [
    "precision highp float;",
    "varying vec2 vUV;",
    `uniform sampler2D ${sceneColourSamplerName};`,
    `uniform sampler2D ${displayGammaLookupSamplerName};`,
    "float displayGammaChannel(float channel) {",
    `  float entry = floor(clamp(channel, 0.0, 1.0) * ${lastEntry} + 0.5);`,
    `  return texture2D(${displayGammaLookupSamplerName}, vec2((entry + 0.5) / ${entryCount}, 0.5)).r;`,
    "}",
    "void main() {",
    `  vec4 sceneColour = texture2D(${sceneColourSamplerName}, vUV);`,
    "  gl_FragColor = vec4(displayGammaChannel(sceneColour.r), displayGammaChannel(sceneColour.g), displayGammaChannel(sceneColour.b), sceneColour.a);",
    "}",
  ].join("\n");
}

function displayGammaRampRows(): DisplayGammaRampRow[] {
  return [DISPLAY_GAMMA_CONSTANTS.ramp, DISPLAY_GAMMA_CONSTANTS.gamma, DISPLAY_GAMMA_CONSTANTS.brightnessAndContrast]
    .map(row => ({ id: row.id, runtimeDefault: row.runtimeDefault, status: row.status, provenance: row.provenance }));
}

export function attachDisplayGammaPostProcess(camera: Camera): DisplayGammaPostProcess {
  const scene = camera.getScene();
  const settings = defaultDisplayGammaSettings();
  const lookupTexels = buildDisplayGammaTable(settings);
  const lookupTexture = new RawTexture(lookupTexels, DISPLAY_GAMMA_ENTRY_COUNT, 1, Constants.TEXTUREFORMAT_R, scene, false, false,
    Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
  lookupTexture.name = "UE2 display gamma lookup";
  lookupTexture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
  lookupTexture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
  Effect.ShadersStore[`${displayGammaFragmentShaderName}FragmentShader`] = displayGammaFragmentSource();
  const postProcess = new PostProcess("UE2 display gamma", displayGammaFragmentShaderName, {
    samplers: [displayGammaLookupSamplerName], camera, samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
  });
  const bindLookup = postProcess.onApplyObservable.add(effect => effect.setTexture(displayGammaLookupSamplerName, lookupTexture));
  let disposed = false;
  return {
    postProcess, lookupTexture, lookupTexels,
    inspect: () => ({ settings, rows: displayGammaRampRows() }),
    dispose() {
      if (disposed) return;
      disposed = true;
      postProcess.onApplyObservable.remove(bindLookup);
      postProcess.dispose(camera);
      lookupTexture.dispose();
    },
  };
}
