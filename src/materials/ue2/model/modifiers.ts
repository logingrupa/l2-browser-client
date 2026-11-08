import { rotatorUnitsToRadians } from "../../../shared/math/rotator";
import { randomRange, type RandomStream } from "../../../shared/random";
import { TEXTURE_COORDINATE_CONSTANTS } from "./constants/textureCoordinateConstants";
import { readColourField, readEnumName, readNumberField, readRotatorField, type ColourUnits, type RotatorUnits } from "./materialFieldValues";
import { MaterialProgramError, programNode, type MaterialProgram, type MaterialProgramNode } from "./materialProgram";

export type TextureCoordinateMatrix = readonly [number, number, number, number, number, number];

export interface TextureCoordinateContext {
  readonly levelSeconds: number;
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly jitterStream: RandomStream;
}

export type TextureCoordinateEvaluation =
  | { readonly status: "evaluated"; readonly matrix: TextureCoordinateMatrix }
  | { readonly status: "unported"; readonly reason: string };

export const IDENTITY_TEXTURE_COORDINATE_MATRIX: TextureCoordinateMatrix = [1, 0, 0, 0, 1, 0];

const fullTurn = 2 * Math.PI;
const rotatorComponent = TEXTURE_COORDINATE_CONSTANTS.rotatorComponent.runtimeDefault;
const rotatorOscillationUnitsPerTurn = TEXTURE_COORDINATE_CONSTANTS.rotatorOscillationUnitsPerTurn.runtimeDefault;

export function multiplyTextureCoordinateMatrices(outer: TextureCoordinateMatrix, inner: TextureCoordinateMatrix): TextureCoordinateMatrix {
  const [a, b, c, d, e, f] = outer;
  const [g, h, i, j, k, l] = inner;
  return [a * g + b * j, a * h + b * k, a * i + b * l + c, d * g + e * j, d * h + e * k, d * i + e * l + f];
}

export function applyTextureCoordinateMatrix(matrix: TextureCoordinateMatrix, u: number, v: number): readonly [number, number] {
  return [matrix[0] * u + matrix[1] * v + matrix[2], matrix[3] * u + matrix[4] * v + matrix[5]];
}

function fraction(value: number): number {
  return value - Math.floor(value);
}

const rotatorComponentKeys = { Pitch: "pitch", Yaw: "yaw", Roll: "roll" } as const satisfies Record<string, keyof RotatorUnits>;

function rotatorPlaneAngleUnits(rotator: RotatorUnits): number {
  return rotator[rotatorComponentKeys[rotatorComponent]];
}

function centreOf(node: MaterialProgramNode, context: TextureCoordinateContext): readonly [number, number] {
  const centre = (offset: number, size: number) => (size > 0 ? offset / size : 0);
  return [centre(readNumberField(node, "UOffset"), context.textureWidth), centre(readNumberField(node, "VOffset"), context.textureHeight)];
}

export function texPannerMatrix(node: MaterialProgramNode, levelSeconds: number): TextureCoordinateMatrix {
  const direction = readRotatorField(node, "PanDirection");
  const pitch = rotatorUnitsToRadians(direction.pitch), yaw = rotatorUnitsToRadians(direction.yaw);
  const distance = levelSeconds * readNumberField(node, "PanRate");
  return [1, 0, distance * Math.cos(pitch) * Math.cos(yaw), 0, 1, distance * Math.cos(pitch) * Math.sin(yaw)];
}

function rotationAbout(angle: number, centreU: number, centreV: number): TextureCoordinateMatrix {
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return [cosine, -sine, centreU - cosine * centreU + sine * centreV, sine, cosine, centreV - sine * centreU - cosine * centreV];
}

export function texRotatorAngle(node: MaterialProgramNode, levelSeconds: number): number | null {
  const rotation = rotatorUnitsToRadians(rotatorPlaneAngleUnits(readRotatorField(node, "Rotation")));
  switch (readEnumName(node, "TexRotationType")) {
    case "TR_FixedRotation": return rotation;
    case "TR_ConstantlyRotating": return rotation * levelSeconds;
    case "TR_OscillatingRotation": {
      const amplitude = rotatorUnitsToRadians(rotatorPlaneAngleUnits(readRotatorField(node, "OscillationAmplitude")));
      const rate = rotatorPlaneAngleUnits(readRotatorField(node, "OscillationRate")) / rotatorOscillationUnitsPerTurn;
      const phase = rotatorPlaneAngleUnits(readRotatorField(node, "OscillationPhase")) / rotatorOscillationUnitsPerTurn;
      return rotation + amplitude * Math.sin(fullTurn * (fraction(levelSeconds * rate) + phase));
    }
    default: return null;
  }
}

export function texRotatorMatrix(node: MaterialProgramNode, context: TextureCoordinateContext): TextureCoordinateEvaluation {
  const angle = texRotatorAngle(node, context.levelSeconds);
  if (angle === null) return { status: "unported", reason: "material-feature-unported:TexRotationType" };
  const [centreU, centreV] = centreOf(node, context);
  return { status: "evaluated", matrix: rotationAbout(angle, centreU, centreV) };
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

export function texScalerMatrix(node: MaterialProgramNode): TextureCoordinateMatrix {
  return [readNumberField(node, "UScale"), 0, readNumberField(node, "UOffset"), 0, readNumberField(node, "VScale"), readNumberField(node, "VOffset")];
}

export function textureCoordinateModifierMatrix(node: MaterialProgramNode, context: TextureCoordinateContext): TextureCoordinateEvaluation {
  if (node.status !== "reviewed") return { status: "unported", reason: node.gapReasons[0] ?? `material-class-unported:${node.class}` };
  switch (node.class) {
    case "Engine.TexPanner": return { status: "evaluated", matrix: texPannerMatrix(node, context.levelSeconds) };
    case "Engine.TexRotator": return texRotatorMatrix(node, context);
    case "Engine.TexOscillator": return texOscillatorMatrix(node, context);
    case "Engine.TexScaler": return { status: "evaluated", matrix: texScalerMatrix(node) };
    case "Engine.TexCoordSource":
    case "Engine.TexEnvMap": return { status: "evaluated", matrix: IDENTITY_TEXTURE_COORDINATE_MATRIX };
    default: return { status: "unported", reason: `material-class-unported:${node.class}` };
  }
}

export function textureCoordinateChainMatrix(program: MaterialProgram, outerFirstModifierIds: readonly string[], context: TextureCoordinateContext): TextureCoordinateEvaluation {
  let combined = IDENTITY_TEXTURE_COORDINATE_MATRIX;
  for (const modifierId of outerFirstModifierIds) {
    const evaluation = textureCoordinateModifierMatrix(programNode(program, modifierId), context);
    if (evaluation.status === "unported") return evaluation;
    combined = multiplyTextureCoordinateMatrices(evaluation.matrix, combined);
  }
  return { status: "evaluated", matrix: combined };
}

export function textureCoordinateSourceChannel(node: MaterialProgramNode): number {
  return readNumberField(node, "SourceChannel");
}

export function environmentMapCoordinates(reflection: readonly [number, number, number], viewRotation: readonly number[] | null): readonly [number, number] {
  const direction = viewRotation === null ? reflection : [0, 1, 2].map(row =>
    viewRotation[row * 3]! * reflection[0] + viewRotation[row * 3 + 1]! * reflection[1] + viewRotation[row * 3 + 2]! * reflection[2]);
  return [direction[0]! * 0.5 + 0.5, direction[1]! * 0.5 + 0.5];
}

function fadeWeight(fadeType: string, cycles: number): number | null {
  if (fadeType === "FC_Sinusoidal") return Math.fround(0.5 + 0.5 * Math.cos(cycles * Math.PI * 0.5));
  if (fadeType === "FC_Linear") return Math.fround(Math.floor(cycles) % 2 !== 0 ? fraction(cycles) : 1 - fraction(cycles));
  return null;
}

export function fadeColourBytes(node: MaterialProgramNode, levelSeconds: number): readonly [number, number, number, number] {
  const period = Math.fround(readNumberField(node, "FadePeriod"));
  if (!(period > 0)) throw new MaterialProgramError(`Material program: ${node.id}.FadePeriod must be positive, not ${period}.`);
  const cycles = Math.fround((Math.fround(levelSeconds) + Math.fround(readNumberField(node, "FadePhase"))) / period);
  const weight = fadeWeight(readEnumName(node, "ColorFadeType") ?? "", cycles);
  if (weight === null) throw new MaterialProgramError(`Material program: ${node.id}.ColorFadeType is not a reviewed fade type.`);
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
