import { describe, expect, it } from "vitest";
import { readBooleanField, readColourField, readNumberField, readRotatorField } from "../../src/materials/ue2/model/materialFieldValues";
import { MaterialProgramError, parseMaterialProgram, programNode, type MaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { texRotatorAngle, textureCoordinateModifierMatrix } from "../../src/materials/ue2/model/modifiers";
import { createRandomStream } from "../../src/shared/random";
import {
  enumValue, field, nodeReference, programOf, rawStruct, reviewedNode, swatchTextureNode, swatchTexturePng, textureImageFor, type FixtureProgramField,
} from "../support/materialProgramFixture";

const oceanRotatorId = "FX_E_T.WaterSurfaceShaderSet.ocn_rot";
const constantColourId = "Synthetic.UnsetConstantColor";
const textureId = "FX_E_T.WaterSurfaceSet.ocean011";
const oscillationRotatorFields = ["OscillationRate", "OscillationAmplitude", "OscillationPhase"] as const;
const reaZeroRotator = { Pitch: 0, Yaw: 0, Roll: 0 };
const zeroRotatorRawHex = "00".repeat(12);
const authoredRotationRawHex = "000000000010000000000000";
const levelSecondsSamples = [0, 0.25, 1.5, 7];

function convertedOceanRotatorFields(rotationType: ReturnType<typeof enumValue>, unsetStructValue: (structName: string) => FixtureProgramField["value"]) {
  return [
    field("Material", nodeReference(textureId)),
    field("Rotation", rawStruct("Rotator", authoredRotationRawHex), "authored", "raw"),
    field("TexRotationType", rotationType, rotationType.ordinal === 0 ? "ue-zero" : "authored"),
    ...oscillationRotatorFields.map(name => field(name, unsetStructValue("Rotator"), "ue-zero")),
    field("UOffset", null, "ue-zero"), field("VOffset", null, "ue-zero"), field("ConstantRotation", null, "ue-zero"),
  ];
}

function oceanRotatorProgram(rotationType: ReturnType<typeof enumValue>, unsetStructValue: (structName: string) => FixtureProgramField["value"]): MaterialProgram {
  const nodes = [reviewedNode(oceanRotatorId, "Engine.TexRotator", convertedOceanRotatorFields(rotationType, unsetStructValue)),
    swatchTextureNode(textureId, textureImageFor(swatchTexturePng()))];
  return parseMaterialProgram(JSON.parse(JSON.stringify(programOf(oceanRotatorId, nodes))));
}

const servedNullStruct = () => null;
const explicitZeroStruct = (structName: string) => rawStruct(structName, zeroRotatorRawHex);

function oceanContext(levelSeconds: number) {
  return { levelSeconds, textureWidth: 256, textureHeight: 256, jitterStream: createRandomStream(1) };
}

describe("struct fields the store serves as null at UE zero", () => {
  it("read ocn_rot's unset Rotator, float and bool fields as REA's zero values", () => {
    const node = programNode(oceanRotatorProgram(enumValue(0, "TR_FixedRotation"), servedNullStruct), oceanRotatorId);
    const zeroRotatorUnits = { pitch: reaZeroRotator.Pitch, yaw: reaZeroRotator.Yaw, roll: reaZeroRotator.Roll };
    for (const name of oscillationRotatorFields) expect(readRotatorField(node, name)).toEqual(zeroRotatorUnits);
    expect([readNumberField(node, "UOffset"), readNumberField(node, "VOffset"), readBooleanField(node, "ConstantRotation")]).toEqual([0, 0, false]);
  });

  it("read a ConstantColor Color served as null at UE zero as the zero colour", () => {
    const program = parseMaterialProgram(JSON.parse(JSON.stringify(programOf(constantColourId, [
      reviewedNode(constantColourId, "Engine.ConstantColor", [field("Color", null, "ue-zero")])]))));
    expect(readColourField(programNode(program, constantColourId), "Color")).toEqual([0, 0, 0, 0]);
  });

  it("refuse a field the node does not serve instead of reading it as zero", () => {
    const node = programNode(oceanRotatorProgram(enumValue(0, "TR_FixedRotation"), servedNullStruct), oceanRotatorId);
    expect(() => readColourField(node, "Color")).toThrow(MaterialProgramError);
    expect(() => readRotatorField(node, "OscilationRate")).toThrow(/OscilationRate is not a field of Engine.TexRotator/);
  });

  it("evaluate ocn_rot exactly as the same node with explicit zero oscillation Rotators", () => {
    for (const rotationType of [enumValue(0, "TR_FixedRotation"), enumValue(2, "TR_OscillatingRotation")]) {
      const served = programNode(oceanRotatorProgram(rotationType, servedNullStruct), oceanRotatorId);
      const explicit = programNode(oceanRotatorProgram(rotationType, explicitZeroStruct), oceanRotatorId);
      for (const levelSeconds of levelSecondsSamples) {
        expect(texRotatorAngle(served, levelSeconds)).toBe(texRotatorAngle(explicit, levelSeconds));
        expect(textureCoordinateModifierMatrix(served, oceanContext(levelSeconds))).toEqual(textureCoordinateModifierMatrix(explicit, oceanContext(levelSeconds)));
      }
      expect(texRotatorAngle(served, 3)).toBe(texRotatorAngle(served, 0));
    }
  });
});
