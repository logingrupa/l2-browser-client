import { rotatorAxes, type RotatorUnits } from "../../../shared/math/rotator";
import { floorToInt32, truncateToInt32 } from "../../../shared/math/x87IntegerConversion";
import { TEXTURE_COORDINATE_CONSTANTS } from "./constants/textureCoordinateConstants";
import { readBooleanField, readEnumOrdinal, readNumberField, readRotatorField } from "./materialFieldValues";
import type { MaterialProgramNode } from "./materialProgram";

export type RowMajorTextureMatrix = readonly number[];

export interface TexRotatorInputs {
  readonly levelSeconds: number;
  readonly textureWidth: number;
  readonly textureHeight: number;
}

export interface TexRotatorEvaluation {
  readonly effectiveRotation: RotatorUnits;
  readonly rowMajorMatrix: RowMajorTextureMatrix;
}

const rotatorModeOrdinals = TEXTURE_COORDINATE_CONSTANTS.rotatorModeOrdinals.runtimeDefault;
const oscillationDivisor = TEXTURE_COORDINATE_CONSTANTS.rotatorOscillationDivisor.runtimeDefault;
const fullTurnRadians = 2 * Math.PI;
const rotatorUnitsMask = 0xffff;

function rotatorFromComponents(componentValue: (component: keyof RotatorUnits) => number): RotatorUnits {
  return { pitch: componentValue("pitch"), yaw: componentValue("yaw"), roll: componentValue("roll") };
}

function oscillationDelta(rate: number, amplitude: number, phase: number, levelTime: number): number {
  const cycles = Math.fround(rate * levelTime / oscillationDivisor);
  return truncateToInt32(Math.fround(Math.sin((cycles - floorToInt32(cycles) + phase) * fullTurnRadians) * amplitude));
}

function effectiveRotation(node: MaterialProgramNode, levelTime: number): RotatorUnits {
  const rotation = readRotatorField(node, "Rotation");
  const mode = readBooleanField(node, "ConstantRotation") ? rotatorModeOrdinals.constantlyRotating : readEnumOrdinal(node, "TexRotationType");
  if (mode === rotatorModeOrdinals.constantlyRotating) return rotatorFromComponents(component => truncateToInt32(rotation[component] * levelTime) & rotatorUnitsMask);
  if (mode !== rotatorModeOrdinals.oscillating) return rotation;
  const rate = readRotatorField(node, "OscillationRate"), amplitude = readRotatorField(node, "OscillationAmplitude"), phase = readRotatorField(node, "OscillationPhase");
  return rotatorFromComponents(component => (rotation[component] + oscillationDelta(rate[component], amplitude[component], phase[component], levelTime)) | 0);
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
  const rotationMatrix = rotationRowMajorMatrix(rotation);
  const uOffset = Math.fround(readNumberField(node, "UOffset")), vOffset = Math.fround(readNumberField(node, "VOffset"));
  if (uOffset === 0 && vOffset === 0) return { effectiveRotation: rotation, rowMajorMatrix: rotationMatrix };
  const uPivot = Math.fround(uOffset / inputs.textureWidth), vPivot = Math.fround(vOffset / inputs.textureHeight);
  const pivoted = multiplyRowMajorMatricesToFloat32(multiplyRowMajorMatricesToFloat32(translationRowMajorMatrix(-uPivot, -vPivot), rotationMatrix),
    translationRowMajorMatrix(uPivot, vPivot));
  return { effectiveRotation: rotation, rowMajorMatrix: pivoted };
}
