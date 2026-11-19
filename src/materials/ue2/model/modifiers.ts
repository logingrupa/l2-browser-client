import { rotatorUnitsToRadians } from "../../../shared/math/rotator";
import { randomRange, type RandomStream } from "../../../shared/random";
import { TEXTURE_COORDINATE_CONSTANTS } from "./constants/textureCoordinateConstants";
import { readColourField, readEnumName, readNumberField, readRotatorField, type ColourUnits } from "./materialFieldValues";
import { MaterialProgramError, programNode, type MaterialProgram, type MaterialProgramNode } from "./materialProgram";
import { texRotatorRowMajorMatrix } from "./texRotatorMatrix";

export type TextureCoordinateMatrix = readonly [number, number, number, number, number, number];

export interface TextureCoordinateContext {
  readonly levelSeconds: number;
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly jitterStream: RandomStream;
}

export type TextureCoordinateEvaluation =
  | { readonly status: "evaluated"; readonly matrix: TextureCoordinateMatrix; readonly carriesThirdColumn?: true }
  | { readonly status: "unported"; readonly reason: string };

export const IDENTITY_TEXTURE_COORDINATE_MATRIX: TextureCoordinateMatrix = [1, 0, 0, 0, 1, 0];

const fullTurn = 2 * Math.PI;
const triggeredOscillatorStartTriggeredTime = TEXTURE_COORDINATE_CONSTANTS.triggeredOscillatorStartState.runtimeDefault;
const pannerWrapPeriod = TEXTURE_COORDINATE_CONSTANTS.pannerForm.runtimeDefault.wrapPeriod;

export function multiplyTextureCoordinateMatrices(outer: TextureCoordinateMatrix, inner: TextureCoordinateMatrix): TextureCoordinateMatrix {
  const [a, b, c, d, e, f] = outer;
  const [g, h, i, j, k, l] = inner;
  return [a * g + b * j, a * h + b * k, a * i + b * l + c, d * g + e * j, d * h + e * k, d * i + e * l + f];
}

function fraction(value: number): number {
  return value - Math.floor(value);
}

function centreOf(node: MaterialProgramNode, context: TextureCoordinateContext): readonly [number, number] {
  const centre = (offset: number, size: number) => (size > 0 ? offset / size : 0);
  return [centre(readNumberField(node, "UOffset"), context.textureWidth), centre(readNumberField(node, "VOffset"), context.textureHeight)];
}

function pannerWrappedShift(directionComponent: number, distance: number): number {
  return pannerWrapPeriod * fraction(directionComponent * distance / pannerWrapPeriod);
}

export function texPannerMatrix(node: MaterialProgramNode, levelSeconds: number): TextureCoordinateMatrix {
  const direction = readRotatorField(node, "PanDirection");
  const pitch = rotatorUnitsToRadians(direction.pitch), yaw = rotatorUnitsToRadians(direction.yaw);
  const distance = readNumberField(node, "PanRate") * levelSeconds;
  return [1, 0, pannerWrappedShift(Math.cos(pitch) * Math.cos(yaw), distance), 0, 1, pannerWrappedShift(Math.cos(pitch) * Math.sin(yaw), distance)];
}

export const texRotatorThirdColumnGap = "material-feature-unported:TexRotatorThirdColumn";

function texRotatorMatrix(node: MaterialProgramNode, context: TextureCoordinateContext): TextureCoordinateEvaluation {
  const rows = texRotatorRowMajorMatrix(node, context).rowMajorMatrix;
  const matrix: TextureCoordinateMatrix = [rows[0]!, rows[4]!, rows[8]!, rows[1]!, rows[5]!, rows[9]!];
  return rows[2] === 0 && rows[6] === 0 && rows[10] === 1 ? { status: "evaluated", matrix } : { status: "evaluated", matrix, carriesThirdColumn: true };
}

function oscillationOffset(node: MaterialProgramNode, axis: "U" | "V", oscillationType: string, context: TextureCoordinateContext): number | null {
  const amplitude = readNumberField(node, `${axis}OscillationAmplitude`);
  if (oscillationType === "OT_Jitter") return randomRange(-amplitude, amplitude, context.jitterStream.nextUnit());
  const angularScale = oscillationType === "OT_StretchRepeat" ? Math.PI / 2 : oscillationType === "OT_Pan" || oscillationType === "OT_Stretch" ? fullTurn : null;
  if (angularScale === null) return null;
  const rate = readNumberField(node, `${axis}OscillationRate`), phase = readNumberField(node, `${axis}OscillationPhase`);
  return amplitude * Math.sin(angularScale * fraction(context.levelSeconds * rate) + fullTurn * phase);
}

function oscillationAxis(node: MaterialProgramNode, axis: "U" | "V", centre: number, context: TextureCoordinateContext): readonly [number, number] | null {
  const oscillationType = readEnumName(node, `${axis}OscillationType`);
  if (oscillationType === null) return null;
  const offset = oscillationOffset(node, axis, oscillationType, context);
  if (offset === null) return null;
  if (oscillationType === "OT_Pan" || oscillationType === "OT_Jitter") return [1, offset];
  return [1 + offset, centre - centre * (1 + offset)];
}

export function texOscillatorMatrix(node: MaterialProgramNode, context: TextureCoordinateContext): TextureCoordinateEvaluation {
  const [centreU, centreV] = centreOf(node, context);
  const uAxis = oscillationAxis(node, "U", centreU, context);
  if (uAxis === null) return { status: "unported", reason: "material-feature-unported:UOscillationType" };
  const vAxis = oscillationAxis(node, "V", centreV, context);
  if (vAxis === null) return { status: "unported", reason: "material-feature-unported:VOscillationType" };
  return { status: "evaluated", matrix: [uAxis[0], 0, uAxis[1], 0, vAxis[0], vAxis[1]] };
}

function texOscillatorTriggeredSeconds(node: MaterialProgramNode, levelSeconds: number, triggeredTime: number): number | null {
  if (triggeredTime < 0) return 0;
  const fastestRate = Math.max(readNumberField(node, "UOscillationRate"), readNumberField(node, "VOscillationRate"));
  if (!(fastestRate > 0)) return null;
  return Math.min(levelSeconds - triggeredTime, readNumberField(node, "StopAfterPeriod") / fastestRate);
}

export function texOscillatorTriggeredMatrix(node: MaterialProgramNode, context: TextureCoordinateContext, triggeredTime: number): TextureCoordinateEvaluation {
  const triggeredSeconds = texOscillatorTriggeredSeconds(node, context.levelSeconds, triggeredTime);
  if (triggeredSeconds === null) return { status: "unported", reason: "material-feature-unported:StopAfterPeriod" };
  return texOscillatorMatrix(node, { ...context, levelSeconds: triggeredSeconds });
}

export function texScalerMatrix(node: MaterialProgramNode): TextureCoordinateMatrix {
  return [readNumberField(node, "UScale"), 0, readNumberField(node, "UOffset"), 0, readNumberField(node, "VScale"), readNumberField(node, "VOffset")];
}

function texCoordSourceMatrix(node: MaterialProgramNode): TextureCoordinateEvaluation {
  if (readNumberField(node, "SourceChannel") !== 0) return { status: "unported", reason: "material-feature-unported:SourceChannel" };
  return { status: "evaluated", matrix: IDENTITY_TEXTURE_COORDINATE_MATRIX };
}

export function textureCoordinateModifierMatrix(node: MaterialProgramNode, context: TextureCoordinateContext): TextureCoordinateEvaluation {
  if (node.status !== "reviewed") return { status: "unported", reason: node.gapReasons[0] ?? `material-class-unported:${node.class}` };
  switch (node.class) {
    case "Engine.TexPanner": return { status: "evaluated", matrix: texPannerMatrix(node, context.levelSeconds) };
    case "Engine.TexRotator": return texRotatorMatrix(node, context);
    case "Engine.TexOscillator": return texOscillatorMatrix(node, context);
    case "Engine.TexOscillatorTriggered": return texOscillatorTriggeredMatrix(node, context, triggeredOscillatorStartTriggeredTime);
    case "Engine.TexScaler": return { status: "evaluated", matrix: texScalerMatrix(node) };
    case "Engine.TexCoordSource": return texCoordSourceMatrix(node);
    case "Engine.TexEnvMap": return { status: "unported", reason: "material-feature-unported:EnvMapType" };
    default: return { status: "unported", reason: `material-class-unported:${node.class}` };
  }
}

export function textureCoordinateChainMatrix(program: MaterialProgram, outerFirstModifierIds: readonly string[], context: TextureCoordinateContext): TextureCoordinateEvaluation {
  let combined = IDENTITY_TEXTURE_COORDINATE_MATRIX;
  for (const [position, modifierId] of outerFirstModifierIds.entries()) {
    const evaluation = textureCoordinateModifierMatrix(programNode(program, modifierId), context);
    if (evaluation.status === "unported") return evaluation;
    if (evaluation.carriesThirdColumn && position < outerFirstModifierIds.length - 1) return { status: "unported", reason: texRotatorThirdColumnGap };
    combined = multiplyTextureCoordinateMatrices(evaluation.matrix, combined);
  }
  return { status: "evaluated", matrix: combined };
}

const fadeWeightByFadeType = new Map<string, (cycles: number) => number>([
  ["FC_Sinusoidal", cycles => Math.fround(0.5 + 0.5 * Math.cos(cycles * Math.PI * 0.5))],
  ["FC_Linear", cycles => Math.fround(Math.floor(cycles) % 2 !== 0 ? fraction(cycles) : 1 - fraction(cycles))],
]);

function fadePeriod(node: MaterialProgramNode): number {
  return Math.fround(readNumberField(node, "FadePeriod"));
}

function fadeWeightOf(node: MaterialProgramNode): ((cycles: number) => number) | undefined {
  return fadeWeightByFadeType.get(readEnumName(node, "ColorFadeType") ?? "");
}

export function fadeColourGapReason(node: MaterialProgramNode): string | null {
  if (!(fadePeriod(node) > 0)) return "material-feature-unported:FadePeriod";
  if (fadeWeightOf(node) === undefined) return "material-feature-unported:ColorFadeType";
  return null;
}

export function fadeColourBytes(node: MaterialProgramNode, levelSeconds: number): readonly [number, number, number, number] {
  const gapReason = fadeColourGapReason(node);
  if (gapReason !== null) throw new MaterialProgramError(`Material program: ${node.id} is ${gapReason}.`);
  const cycles = Math.fround((Math.fround(levelSeconds) + Math.fround(readNumberField(node, "FadePhase"))) / fadePeriod(node));
  const weight = fadeWeightOf(node)!(cycles);
  const oppositeWeight = Math.fround(1 - weight);
  const first = readColourField(node, "Color1"), second = readColourField(node, "Color2");
  const channel = (index: number) => {
    const firstUnit = Math.fround(Math.round(first[index]! * 255) / 255), secondUnit = Math.fround(Math.round(second[index]! * 255) / 255);
    const plane = Math.fround(Math.fround(firstUnit * weight) + Math.fround(secondUnit * oppositeWeight));
    return Math.min(255, Math.max(0, Math.floor(Math.fround(plane * 255))));
  };
  return [channel(0), channel(1), channel(2), channel(3)];
}

export function colourSourceValue(node: MaterialProgramNode, levelSeconds: number): ColourUnits {
  switch (node.class) {
    case "Engine.FadeColor": {
      const fadeBytes = fadeColourBytes(node, levelSeconds);
      return [fadeBytes[0] / 255, fadeBytes[1] / 255, fadeBytes[2] / 255, fadeBytes[3] / 255];
    }
    case "Engine.ConstantColor":
    case "Engine.ColorModifier": return readColourField(node, "Color");
    default: throw new MaterialProgramError(`Material program: ${node.id} of ${node.class} is not a colour source.`);
  }
}
