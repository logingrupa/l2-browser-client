import { rotatorAxes, type RotatorUnits } from "../../../shared/math/rotator";
import { TEXTURE_COORDINATE_CONSTANTS } from "./constants/textureCoordinateConstants";
import { readBooleanField, readEnumOrdinal, readNumberField, readRotatorField } from "./materialFieldValues";
import type { MaterialProgramNode } from "./materialProgram";

export type RowMajorTextureMatrix = readonly number[];

export interface TexRotatorInputs {
  readonly levelSeconds: number;
  readonly textureWidth: number;
  readonly textureHeight: number;
}

export type TexRotatorEvaluation =
  | { readonly status: "evaluated"; readonly effectiveRotation: RotatorUnits; readonly rowMajorMatrix: RowMajorTextureMatrix }
  | { readonly status: "unported"; readonly reason: string };

export const texRotatorTruncationRangeGap = "material-feature-unported:TexRotatorTruncationRange";

const rotatorModeOrdinals = TEXTURE_COORDINATE_CONSTANTS.rotatorModeOrdinals.runtimeDefault;
const oscillationDivisor = TEXTURE_COORDINATE_CONSTANTS.rotatorOscillationDivisor.runtimeDefault;
const fullTurnRadians = 2 * Math.PI;
const int32Bound = 2 ** 31;
const rotatorUnitsMask = 0xffff;
const rotatorComponents = ["pitch", "yaw", "roll"] as const;
type RotatorComponent = (typeof rotatorComponents)[number];

function truncatedToInt32(value: number): number | null {
  const truncated = Math.trunc(value);
  return truncated >= -int32Bound && truncated < int32Bound ? truncated : null;
}

function rotatorFromComponents(componentValue: (component: RotatorComponent) => number | null): RotatorUnits | null {
  const [pitch, yaw, roll] = rotatorComponents.map(componentValue);
  if (pitch === null || pitch === undefined || yaw === null || yaw === undefined || roll === null || roll === undefined) return null;
  return { pitch, yaw, roll };
}

function oscillationDelta(rate: number, amplitude: number, phase: number, levelTime: number): number | null {
  const cycles = Math.fround(rate * levelTime / oscillationDivisor);
  const wholeCycles = truncatedToInt32(Math.floor(cycles));
  if (wholeCycles === null) return null;
  return truncatedToInt32(Math.fround(Math.sin((cycles - wholeCycles + phase) * fullTurnRadians) * amplitude));
}

function effectiveRotation(node: MaterialProgramNode, levelTime: number): RotatorUnits | null {
  const rotation = readRotatorField(node, "Rotation");
  const mode = readBooleanField(node, "ConstantRotation") ? rotatorModeOrdinals.constantlyRotating : readEnumOrdinal(node, "TexRotationType");
  if (mode === rotatorModeOrdinals.constantlyRotating) {
    return rotatorFromComponents(component => {
      const truncated = truncatedToInt32(rotation[component] * levelTime);
      return truncated === null ? null : truncated & rotatorUnitsMask;
    });
  }
  if (mode !== rotatorModeOrdinals.oscillating) return rotation;
  const rate = readRotatorField(node, "OscillationRate"), amplitude = readRotatorField(node, "OscillationAmplitude"), phase = readRotatorField(node, "OscillationPhase");
  return rotatorFromComponents(component => {
    const delta = oscillationDelta(rate[component], amplitude[component], phase[component], levelTime);
    return delta === null ? null : (rotation[component] + delta) | 0;
  });
}

function rotationRowMajorMatrix(rotation: RotatorUnits): RowMajorTextureMatrix {
  const { forward, right, up } = rotatorAxes(rotation);
  return [forward.x, forward.y, forward.z, 0, right.x, right.y, right.z, 0, up.x, up.y, up.z, 0, 0, 0, 0, 1].map(element => Math.fround(element));
}

function translationRowMajorMatrix(uTranslation: number, vTranslation: number): RowMajorTextureMatrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, uTranslation, vTranslation, 1, 0, 0, 0, 0, 1];
}

function multiplyRowMajorMatricesToFloat32(left: RowMajorTextureMatrix, right: RowMajorTextureMatrix): RowMajorTextureMatrix {
  return Array.from({ length: 16 }, (_, index) => {
    const row = Math.floor(index / 4) * 4, column = index % 4;
    return Math.fround(left[row]! * right[column]! + left[row + 1]! * right[4 + column]! + left[row + 2]! * right[8 + column]! + left[row + 3]! * right[12 + column]!);
  });
}

export function texRotatorRowMajorMatrix(node: MaterialProgramNode, inputs: TexRotatorInputs): TexRotatorEvaluation {
  const rotation = effectiveRotation(node, Math.fround(inputs.levelSeconds));
  if (rotation === null) return { status: "unported", reason: texRotatorTruncationRangeGap };
  const rotationMatrix = rotationRowMajorMatrix(rotation);
  const uOffset = Math.fround(readNumberField(node, "UOffset")), vOffset = Math.fround(readNumberField(node, "VOffset"));
  if (uOffset === 0 && vOffset === 0) return { status: "evaluated", effectiveRotation: rotation, rowMajorMatrix: rotationMatrix };
  const uPivot = Math.fround(uOffset / inputs.textureWidth), vPivot = Math.fround(vOffset / inputs.textureHeight);
  const pivoted = multiplyRowMajorMatricesToFloat32(multiplyRowMajorMatricesToFloat32(translationRowMajorMatrix(-uPivot, -vPivot), rotationMatrix),
    translationRowMajorMatrix(uPivot, vPivot));
  return { status: "evaluated", effectiveRotation: rotation, rowMajorMatrix: pivoted };
}
