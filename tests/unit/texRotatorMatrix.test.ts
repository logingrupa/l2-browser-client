import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fixturesText from "../fixtures/environment/sky-texrotator-fixtures.json?raw";
import { rotatorSineFromTable, ROTATOR_CONSTANTS, ROTATOR_RULE_BY_USE } from "../../src/shared/math/rotator";
import { createRandomStream } from "../../src/shared/random";
import { TEXTURE_COORDINATE_CONSTANTS } from "../../src/materials/ue2/model/constants/textureCoordinateConstants";
import { evaluateMaterialFrame } from "../../src/materials/ue2/model/materialFrame";
import { readEnumOrdinal, readNumberField, readRotatorField } from "../../src/materials/ue2/model/materialFieldValues";
import { parseMaterialProgram, programNode, type MaterialProgram, type MaterialProgramNode } from "../../src/materials/ue2/model/materialProgram";
import { IDENTITY_TEXTURE_COORDINATE_MATRIX, textureCoordinateChainMatrix, textureCoordinateModifierMatrix, texRotatorThirdColumnGap } from "../../src/materials/ue2/model/modifiers";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { texRotatorRowMajorMatrix, type RowMajorTextureMatrix } from "../../src/materials/ue2/model/texRotatorMatrix";
import { truncateToInt32 } from "../../src/shared/math/x87IntegerConversion";
import {
  field, nodeReference, programOf, rawStruct, reviewedNode, swatchTextureNode, swatchTexturePng, textureImageFor, type FixtureProgramField,
} from "../support/materialProgramFixture";

interface PitchYawRoll { readonly Pitch: number; readonly Yaw: number; readonly Roll: number }
type PitchYawRollTriple = readonly [pitch: number, yaw: number, roll: number];

interface NativeGetMatrixFixture {
  readonly mode: number;
  readonly Rotation: PitchYawRollTriple;
  readonly timeBytesHex: string;
  readonly offsets: readonly [number, number];
  readonly resolvedSize: readonly [number, number];
  readonly rate: PitchYawRollTriple;
  readonly amplitude: PitchYawRollTriple;
  readonly phase: PitchYawRollTriple;
  readonly effectiveRotation: PitchYawRollTriple;
  readonly matrixBytesHex: string;
}

interface CapturedRotator {
  readonly object: string;
  readonly eventCount: number;
  readonly timeBytesHex: string;
  readonly timeIsLevelInfoTimeSeconds: boolean;
  readonly inputs: {
    readonly TexRotationType: number; readonly Rotation: PitchYawRoll; readonly ConstantRotation: number; readonly UOffset: number; readonly VOffset: number;
    readonly OscillationRate: PitchYawRoll; readonly OscillationAmplitude: PitchYawRoll; readonly OscillationPhase: PitchYawRoll;
  };
  readonly resolvedSize: readonly [number, number] | null;
  readonly matrixBytesHex: string;
}

interface SkyTexRotatorFixtures {
  readonly source: { readonly reportSha256: string; readonly manifestSha256: string };
  readonly sineTable: { readonly sha256: string; readonly entries: number };
  readonly constants: readonly { readonly name: string; readonly bytesHex: string }[];
  readonly capturedRotators: readonly CapturedRotator[];
  readonly fixtures: readonly NativeGetMatrixFixture[];
}

const fixtures = JSON.parse(fixturesText) as SkyTexRotatorFixtures;
const rotatorId = "Synthetic.TexRotator";
const textureId = "Synthetic.Texture";
const starFieldRoot = "l2_skies.Shaders.StarField_Final01";
const starFieldRotatorId = "l2_skies.Shaders.TexRotator1";
const starFieldCaptureObject = "L2_Skies.Shaders.TexRotator1";
const oceanRotatorCaptureObject = "FX_E_T.WaterSurfaceShaderSet.ocn_rot";
const stagedSkyFolder = new URL("../fixtures/environment/skylevel-visibility/", import.meta.url);
const integerIndefinite = truncateToInt32(2 ** 31);

function bytesOfHex(hex: string): Uint8Array {
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function float32OfHex(hex: string): number {
  return new DataView(bytesOfHex(hex).buffer).getFloat32(0, true);
}

function float64OfHex(hex: string): number {
  return new DataView(bytesOfHex(hex).buffer).getFloat64(0, true);
}

function float32BytesHex(matrix: RowMajorTextureMatrix): string {
  return Buffer.from(Float32Array.from(matrix).buffer).toString("hex");
}

function float32ElementsOfHex(hex: string): number[] {
  return Array.from(new Float32Array(bytesOfHex(hex).buffer));
}

function rotatorStruct([pitch, yaw, roll]: PitchYawRollTriple) {
  const view = new DataView(new ArrayBuffer(12));
  [pitch, yaw, roll].forEach((value, index) => view.setInt32(index * 4, value, true));
  return rawStruct("Rotator", Buffer.from(view.buffer).toString("hex"));
}

function tripleOf(rotator: PitchYawRoll): PitchYawRollTriple {
  return [rotator.Pitch, rotator.Yaw, rotator.Roll];
}

function rotatorProgram(fields: FixtureProgramField[], inner: readonly ReturnType<typeof reviewedNode>[] = []): MaterialProgram {
  const material = inner[0]?.id ?? textureId;
  return parseMaterialProgram(JSON.parse(JSON.stringify(programOf(rotatorId, [
    reviewedNode(rotatorId, "Engine.TexRotator", [field("Material", nodeReference(material)), ...fields]), ...inner,
    swatchTextureNode(textureId, textureImageFor(swatchTexturePng()))]))));
}

function rotatorNodeOf(fields: FixtureProgramField[]): MaterialProgramNode {
  return programNode(rotatorProgram(fields), rotatorId);
}

function fixtureRotatorFields(fixture: NativeGetMatrixFixture): FixtureProgramField[] {
  return [field("TexRotationType", fixture.mode), field("Rotation", rotatorStruct(fixture.Rotation), "authored", "raw"),
    field("UOffset", fixture.offsets[0]), field("VOffset", fixture.offsets[1]),
    field("OscillationRate", rotatorStruct(fixture.rate), "authored", "raw"), field("OscillationAmplitude", rotatorStruct(fixture.amplitude), "authored", "raw"),
    field("OscillationPhase", rotatorStruct(fixture.phase), "authored", "raw")];
}

function capturedRotatorFields(captured: CapturedRotator): FixtureProgramField[] {
  const inputs = captured.inputs;
  return [field("TexRotationType", inputs.TexRotationType), field("ConstantRotation", (inputs.ConstantRotation & 1) === 1),
    field("Rotation", rotatorStruct(tripleOf(inputs.Rotation)), "authored", "raw"), field("UOffset", inputs.UOffset), field("VOffset", inputs.VOffset),
    field("OscillationRate", rotatorStruct(tripleOf(inputs.OscillationRate)), "authored", "raw"),
    field("OscillationAmplitude", rotatorStruct(tripleOf(inputs.OscillationAmplitude)), "authored", "raw"),
    field("OscillationPhase", rotatorStruct(tripleOf(inputs.OscillationPhase)), "authored", "raw")];
}

function capturedRotator(object: string): CapturedRotator {
  const captured = fixtures.capturedRotators.find(row => row.object === object);
  if (captured === undefined) throw new Error(`the RM-29 fixtures hold no capture of ${object}`);
  return captured;
}

function evaluatedRowMajor(node: MaterialProgramNode, levelSeconds: number, textureWidth: number, textureHeight: number) {
  return texRotatorRowMajorMatrix(node, { levelSeconds, textureWidth, textureHeight });
}

function nativeConstant(name: string): number {
  const constant = fixtures.constants.find(row => row.name === name);
  if (constant === undefined) throw new Error(`the RM-29 fixtures hold no constant ${name}`);
  return float64OfHex(constant.bytesHex);
}

function stagedStarFieldProgram(): MaterialProgram {
  const listed = (JSON.parse(readFileSync(new URL("material-programs.json", stagedSkyFolder), "utf8")) as { materials: { root: string; program: string }[] }).materials
    .find(entry => entry.root === starFieldRoot);
  if (listed === undefined) throw new Error(`the staged skylevel fixture holds no program for ${starFieldRoot}`);
  return parseMaterialProgram(JSON.parse(readFileSync(new URL(`material-programs/${listed.program}`, stagedSkyFolder), "utf8")));
}

describe("UTexRotator::GetMatrix 0x105e0c00 against the RM-29 native fixtures", () => {
  it("reads the FGlobalMath sine table RM-29 dumped and the oscillation constants of its pinned report", () => {
    expect(fixtures.source).toMatchObject({ reportSha256: "945cce254c60281ecc885bc838d867c8d1546340319bc11efaf6eaf9a9d5c601",
      manifestSha256: "d6a2bdcb2c0adfb886a54225be131f03523d8a9d54e4fdf5b29e154c1e0867c3" });
    const table = Float32Array.from({ length: fixtures.sineTable.entries }, (_, entry) => rotatorSineFromTable(entry * 4));
    expect(createHash("sha256").update(new Uint8Array(table.buffer)).digest("hex")).toBe(fixtures.sineTable.sha256);
    expect(TEXTURE_COORDINATE_CONSTANTS.rotatorOscillationDivisor.runtimeDefault).toBe(nativeConstant("oscillation divisor"));
    expect(2 * Math.PI).toBe(nativeConstant("oscillation two pi"));
  });

  it.each(fixtures.fixtures.map((fixture, index) => [index, fixture.mode, fixture] as const))(
    "reproduces native fixture %i (mode %i) bit-exact, effective rotator included", (_index, _mode, fixture) => {
      const evaluation = evaluatedRowMajor(rotatorNodeOf(fixtureRotatorFields(fixture)), float32OfHex(fixture.timeBytesHex), ...fixture.resolvedSize);
      expect([evaluation.effectiveRotation.pitch, evaluation.effectiveRotation.yaw, evaluation.effectiveRotation.roll]).toEqual(fixture.effectiveRotation);
      expect(float32BytesHex(evaluation.rowMajorMatrix)).toBe(fixture.matrixBytesHex);
    });

  it.each(fixtures.capturedRotators.map(captured => [captured.object, captured.eventCount, captured] as const))(
    "reproduces the live %s output of %i captured calls bit-exact at the captured LevelInfo.TimeSeconds", (_object, _count, captured) => {
      expect(captured.timeIsLevelInfoTimeSeconds).toBe(true);
      const [width, height] = captured.resolvedSize ?? [0, 0];
      const evaluation = evaluatedRowMajor(rotatorNodeOf(capturedRotatorFields(captured)), float32OfHex(captured.timeBytesHex), width, height);
      expect(float32BytesHex(evaluation.rowMajorMatrix)).toBe(captured.matrixBytesHex);
    });

  it("leaves the staged StarField_Final01 star sampler at identity at TimeSeconds 45.73889923095703 from the converter's own TexRotator1 fields", () => {
    const captured = capturedRotator(starFieldCaptureObject);
    const levelSeconds = float32OfHex(captured.timeBytesHex);
    expect(levelSeconds).toBe(45.73889923095703);
    const program = stagedStarFieldProgram();
    const node = programNode(program, starFieldRotatorId);
    expect([readEnumOrdinal(node, "TexRotationType"), readNumberField(node, "UOffset"), readNumberField(node, "VOffset"), readRotatorField(node, "Rotation")])
      .toEqual([captured.inputs.TexRotationType, captured.inputs.UOffset, captured.inputs.VOffset, { pitch: 0, yaw: 0, roll: 0 }]);
    const plan = compileMaterialStagePlan(program);
    if (plan.status !== "compiled") throw new Error(plan.reasons.join(", "));
    expect(plan.samplers.map(sampler => [sampler.width, sampler.height])).toEqual([captured.resolvedSize]);
    expect(float32BytesHex(evaluatedRowMajor(node, levelSeconds, plan.samplers[0]!.width, plan.samplers[0]!.height).rowMajorMatrix)).toBe(captured.matrixBytesHex);
    const frame = evaluateMaterialFrame(program, plan, levelSeconds, createRandomStream(1));
    if (frame.status !== "evaluated") throw new Error(frame.reason);
    expect(frame.samplerMatrices).toEqual([IDENTITY_TEXTURE_COORDINATE_MATRIX]);
  });

  it("projects the live ocn_rot matrix onto u' = a u + b v + c, v' = d u + e v + f from elements 0, 4, 8 and 1, 5, 9", () => {
    const captured = capturedRotator(oceanRotatorCaptureObject);
    const native = float32ElementsOfHex(captured.matrixBytesHex);
    const evaluation = textureCoordinateModifierMatrix(rotatorNodeOf(capturedRotatorFields(captured)),
      { levelSeconds: float32OfHex(captured.timeBytesHex), textureWidth: 0, textureHeight: 0, jitterStream: createRandomStream(1) });
    expect(evaluation).toEqual({ status: "evaluated", matrix: [native[0], native[4], native[8], native[1], native[5], native[9]] });
  });
});

describe("TexRotator rules beyond the RM-29 fixtures", () => {
  const pitchedRotatorFields = [field("TexRotationType", 0), field("Rotation", rotatorStruct([4096, 0, 0]), "authored", "raw")];
  const pannerId = "Synthetic.InnerPanner";
  const innerPanner = reviewedNode(pannerId, "Engine.TexPanner", [field("Material", nodeReference(textureId)), field("PanRate", 1)]);
  const context = (levelSeconds: number) => ({ levelSeconds, textureWidth: 256, textureHeight: 128, jitterStream: createRandomStream(1) });

  it("turns a set ConstantRotation bit into constant rotation as UTexRotator::PostLoad 0x1034b6d0 does", () => {
    const legacy = rotatorNodeOf([field("TexRotationType", 0), field("ConstantRotation", true), field("Rotation", rotatorStruct([0, 1000, 0]), "authored", "raw")]);
    const constant = rotatorNodeOf([field("TexRotationType", 1), field("Rotation", rotatorStruct([0, 1000, 0]), "authored", "raw")]);
    expect(evaluatedRowMajor(legacy, 1.25, 256, 128)).toEqual(evaluatedRowMajor(constant, 1.25, 256, 128));
    expect(evaluatedRowMajor(legacy, 1.25, 256, 128).effectiveRotation.yaw).toBe(1250);
  });

  it("truncates a constant rotation outside int32 to the integer indefinite of the SSE2 _ftol2 path the CRT selects from cpuid, so a long session keeps evaluating", () => {
    const node = rotatorNodeOf([field("TexRotationType", 1), field("Rotation", rotatorStruct([0, 65535, 0]), "authored", "raw")]);
    expect(evaluatedRowMajor(node, 40000, 256, 128).effectiveRotation.yaw).toBe(integerIndefinite & 0xffff);
    expect(evaluatedRowMajor(node, 30000, 256, 128).effectiveRotation.yaw).toBe((65535 * 30000) & 0xffff);
    const longSession = rotatorProgram([field("TexRotationType", 1), field("Rotation", rotatorStruct([0, 65535, 0]), "authored", "raw")]);
    expect(textureCoordinateChainMatrix(longSession, [rotatorId], context(40000)).status).toBe("evaluated");
  });

  it("adds the integer indefinite when an oscillation delta truncates outside int32", () => {
    const node = rotatorNodeOf([field("TexRotationType", 2), field("Rotation", rotatorStruct([0, 5, 0]), "authored", "raw"),
      field("OscillationRate", rotatorStruct([0, 65535, 0]), "authored", "raw"), field("OscillationAmplitude", rotatorStruct([0, 2147483647, 0]), "authored", "raw"),
      field("OscillationPhase", rotatorStruct([0, 0, 0]), "authored", "raw")]);
    expect(evaluatedRowMajor(node, 0.25, 256, 128).effectiveRotation).toEqual({ pitch: 0, yaw: (5 + integerIndefinite) | 0, roll: 0 });
  });

  it("evaluates a Pitch rotator as the innermost modifier and names its third column when an inner modifier would multiply it", () => {
    const innermost = rotatorProgram(pitchedRotatorFields);
    const rows = evaluatedRowMajor(programNode(innermost, rotatorId), 0, 4, 4).rowMajorMatrix;
    expect(textureCoordinateChainMatrix(innermost, [rotatorId], context(0)))
      .toEqual({ status: "evaluated", matrix: [rows[0], rows[4], rows[8], rows[1], rows[5], rows[9]] });
    const outer = rotatorProgram(pitchedRotatorFields, [innerPanner]);
    expect(textureCoordinateChainMatrix(outer, [rotatorId, pannerId], context(0))).toEqual({ status: "unported", reason: texRotatorThirdColumnGap });
    const yawOnly = rotatorProgram([field("TexRotationType", 0), field("Rotation", rotatorStruct([0, 4096, 0]), "authored", "raw")], [innerPanner]);
    expect(textureCoordinateChainMatrix(yawOnly, [rotatorId, pannerId], context(0)).status).toBe("evaluated");
  });

  it("keeps the matrix, mode and divisor rows confirmed from RM-29 and the texture rotator on the sine table", () => {
    for (const row of [TEXTURE_COORDINATE_CONSTANTS.rotatorMatrixForm, TEXTURE_COORDINATE_CONSTANTS.rotatorModeOrdinals, TEXTURE_COORDINATE_CONSTANTS.rotatorOscillationDivisor]) {
      expect(row).toMatchObject({ status: "confirmed-interlude", interludeEvidence: expect.stringMatching(/^Engine\.dll 4dd2f63c UTexRotator::GetMatrix 0x105e0c00, .*RM-29 sky-texrotator\.json 945cce25/) });
      expect(row.runtimeDefault).toEqual(row.value);
    }
    expect(TEXTURE_COORDINATE_CONSTANTS.rotatorModeOrdinals.provenance).toMatch(/Core\.dll 9462f87a .*0x1033fe34.*Engine\.dll 4dd2f63c .*0x11d8b2ec/);
    expect(JSON.stringify(TEXTURE_COORDINATE_CONSTANTS)).not.toContain("TexRotatorTruncationRange");
    expect(TEXTURE_COORDINATE_CONSTANTS.rotatorMatrixForm.provenance).toMatch(/53-bit .*D3DDrv\.dll 05622dde .*D3DCREATE_FPU_PRESERVE .*0x1001DC26.*0x027f/);
    expect(ROTATOR_RULE_BY_USE["texture-rotator"]).toMatchObject({ status: "confirmed-interlude", runtimeDefault: "sine-table", value: "sine-table" });
    expect(ROTATOR_CONSTANTS.sineTableLength.runtimeDefault).toBe(fixtures.sineTable.entries);
  });
});
