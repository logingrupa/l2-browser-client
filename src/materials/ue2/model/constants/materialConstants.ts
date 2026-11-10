import { BLEND_CONSTANTS } from "./blendConstants";
import { COLOUR_CONSTANTS, COMBINER_CONSTANTS } from "./combinerConstants";
import { DIAGNOSTIC_CONSTANTS } from "./diagnosticConstants";
import { DISPLAY_GAMMA_CONSTANTS } from "./displayGammaConstants";
import { FOG_CONSTANTS } from "./fogConstants";
import { LIGHTING_CONSTANTS } from "./lightingConstants";
import { SHADER_CONSTANTS } from "./shaderConstants";
import { TEXTURE_COORDINATE_CONSTANTS } from "./textureCoordinateConstants";
import { TEXTURE_FRAME_CONSTANTS } from "./textureFrameConstants";

export const MATERIAL_CONSTANT_TABLES = {
  blend: BLEND_CONSTANTS,
  fog: FOG_CONSTANTS,
  lighting: LIGHTING_CONSTANTS,
  combiner: COMBINER_CONSTANTS,
  colour: COLOUR_CONSTANTS,
  shader: SHADER_CONSTANTS,
  textureCoordinates: TEXTURE_COORDINATE_CONSTANTS,
  textureFrames: TEXTURE_FRAME_CONSTANTS,
  displayGamma: DISPLAY_GAMMA_CONSTANTS,
  diagnostic: DIAGNOSTIC_CONSTANTS,
} as const;
