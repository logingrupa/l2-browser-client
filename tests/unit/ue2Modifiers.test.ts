import { describe, expect, it } from "vitest";
import { evaluateNativeFlameFade, selectNativeFlameFrame } from "../../src/scene/world/nativeFlameMaterials";
import type { NativeFlamePlan } from "../../src/scene/world/nativeMaterialGraph";
import { createRandomStream, deriveStreamSeed, randomRange } from "../../src/shared/random";
import { evaluateMaterialFrame } from "../../src/materials/ue2/model/materialFrame";
import { parseMaterialProgram, programNode, type MaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import {
  colourSourceValue, fadeColourBytes, IDENTITY_TEXTURE_COORDINATE_MATRIX, multiplyTextureCoordinateMatrices, texOscillatorTriggeredMatrix,
  textureCoordinateChainMatrix, textureCoordinateModifierMatrix, type TextureCoordinateMatrix,
} from "../../src/materials/ue2/model/modifiers";
import { TEXTURE_COORDINATE_CONSTANTS } from "../../src/materials/ue2/model/constants/textureCoordinateConstants";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { selectTextureFrame } from "../../src/materials/ue2/model/textureFrames";
import {
  enumValue, field, nodeReference, oceanSTriggeredOscillatorNode, programOf, rawStruct, reviewedNode, swatchTextureNode, swatchTexturePng, textureImageFor,
  unportedNode, type FixtureProgramField, type FixtureProgramNode,
} from "../support/materialProgramFixture";

const image = textureImageFor(swatchTexturePng());
const textureId = "Synthetic.Texture";
const jitterSeed = deriveStreamSeed(7, "tex-jitter", ["Synthetic.Oscillator"]);
const flameColour = (rgbaBytes: readonly [number, number, number, number]) => ({ bgraHex: "", rgbaBytes });

function flameFadeOf(fadePhase: number): NativeFlamePlan["fade"] {
  return { object: "Synthetic.Fade", colorFadeType: 1, fadePeriod: 0.4, fadePhase, color1: flameColour([255, 128, 10, 0]), color2: flameColour([20, 40, 250, 0]) };
}

function rotator(pitch: number, yaw: number, roll: number) {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  [pitch, yaw, roll].forEach((value, index) => view.setInt32(index * 4, value, true));
  return rawStruct("Rotator", Buffer.from(bytes).toString("hex"));
}

function colour(red: number, green: number, blue: number, alpha: number) {
  return rawStruct("Color", Buffer.from([blue, green, red, alpha]).toString("hex"));
}

function programWith(modifiers: FixtureProgramNode[]): MaterialProgram {
  return parseMaterialProgram(JSON.parse(JSON.stringify(programOf(modifiers[0]!.id, [...modifiers, swatchTextureNode(textureId, image)]))));
}

function modifier(id: string, nodeClass: string, fields: FixtureProgramField[], inner = textureId): FixtureProgramNode {
  return reviewedNode(id, nodeClass, [field("Material", nodeReference(inner)), ...fields]);
}

function context(levelSeconds: number, seed = jitterSeed) {
  return { levelSeconds, textureWidth: 4, textureHeight: 4, jitterStream: createRandomStream(seed) };
}

function evaluated(program: MaterialProgram, nodeId: string, levelSeconds: number): TextureCoordinateMatrix {
  const evaluation = textureCoordinateModifierMatrix(programNode(program, nodeId), context(levelSeconds));
  if (evaluation.status !== "evaluated") throw new Error(evaluation.reason);
  return evaluation.matrix;
}

function transformedCoordinates(matrix: TextureCoordinateMatrix, u: number, v: number): readonly [number, number] {
  return [matrix[0] * u + matrix[1] * v + matrix[2], matrix[3] * u + matrix[4] * v + matrix[5]];
}

function expectMatrix(actual: TextureCoordinateMatrix, expected: readonly number[]): void {
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));
}

describe("texture coordinate modifiers", () => {
  it.each([0, 0.25, 1, 10])("TexPanner translates by t * PanRate along PanDirection at t = %f", levelSeconds => {
    const program = programWith([modifier("Synthetic.Panner", "Engine.TexPanner", [field("PanRate", 0.5), field("PanDirection", rotator(0, 16384, 0), "authored", "raw")])]);
    expectMatrix(evaluated(program, "Synthetic.Panner", levelSeconds), [1, 0, levelSeconds * 0.5 * Math.cos(Math.PI / 2), 0, 1, levelSeconds * 0.5]);
  });

  it("TexRotator turns about UOffset / USize for fixed, constant and oscillating rotation", () => {
    const rotatorNode = (rotationType: string, extra: FixtureProgramField[]) => programWith([modifier("Synthetic.Rotator", "Engine.TexRotator", [
      field("TexRotationType", enumValue(0, rotationType)), field("Rotation", rotator(0, 8192, 0), "authored", "raw"),
      field("UOffset", 2), field("VOffset", 2), ...extra])]);
    const quarterTurn = Math.PI / 4;
    const fixed = evaluated(rotatorNode("TR_FixedRotation", []), "Synthetic.Rotator", 3);
    expect(transformedCoordinates(fixed, 0.5, 0.5).map(value => Number(value.toFixed(12)))).toEqual([0.5, 0.5]);
    expectMatrix(fixed, [Math.cos(quarterTurn), -Math.sin(quarterTurn), 0.5 - 0.5 * Math.cos(quarterTurn) + 0.5 * Math.sin(quarterTurn),
      Math.sin(quarterTurn), Math.cos(quarterTurn), 0.5 - 0.5 * Math.sin(quarterTurn) - 0.5 * Math.cos(quarterTurn)]);
    const constant = evaluated(rotatorNode("TR_ConstantlyRotating", []), "Synthetic.Rotator", 2);
    expect(constant[3]).toBeCloseTo(Math.sin(quarterTurn * 2), 9);
    const oscillating = evaluated(rotatorNode("TR_OscillatingRotation", [
      field("OscillationAmplitude", rotator(0, 4096, 0), "authored", "raw"), field("OscillationRate", rotator(0, 16384, 0), "authored", "raw"),
      field("OscillationPhase", rotator(0, 0, 0), "authored", "raw")]), "Synthetic.Rotator", 1);
    const angle = quarterTurn + (Math.PI / 8) * Math.sin(2 * Math.PI * 0.25);
    expect(oscillating[3]).toBeCloseTo(Math.sin(angle), 9);
  });

  it("TexOscillator pans, stretches about UOffset / USize and stretch-repeats by its closed forms", () => {
    const program = programWith([modifier("Synthetic.Oscillator", "Engine.TexOscillator", [
      field("UOscillationType", enumValue(0, "OT_Pan")), field("UOscillationRate", 0.5), field("UOscillationPhase", 0.125), field("UOscillationAmplitude", 0.2),
      field("VOscillationType", enumValue(1, "OT_Stretch")), field("VOscillationRate", 0.25), field("VOscillationPhase", 0), field("VOscillationAmplitude", 0.5),
      field("UOffset", 0), field("VOffset", 2)])]);
    const levelSeconds = 0.75;
    const panOffset = 0.2 * Math.sin(2 * Math.PI * ((levelSeconds * 0.5) % 1) + 2 * Math.PI * 0.125);
    const stretch = 0.5 * Math.sin(2 * Math.PI * ((levelSeconds * 0.25) % 1));
    expectMatrix(evaluated(program, "Synthetic.Oscillator", levelSeconds), [1, 0, panOffset, 0, 1 + stretch, 0.5 - 0.5 * (1 + stretch)]);
    const repeat = programWith([modifier("Synthetic.Oscillator", "Engine.TexOscillator", [
      field("UOscillationType", enumValue(2, "OT_StretchRepeat")), field("UOscillationRate", 1), field("UOscillationPhase", 0), field("UOscillationAmplitude", 1),
      field("VOscillationType", enumValue(0, "OT_Pan")), field("VOscillationRate", 0), field("VOscillationPhase", 0), field("VOscillationAmplitude", 0),
      field("UOffset", 0), field("VOffset", 0)])]);
    expect(evaluated(repeat, "Synthetic.Oscillator", 0.5)[0]).toBeCloseTo(1 + Math.sin((Math.PI / 2) * 0.5), 9);
  });

  it("TexOscillator jitter draws only from the tex-jitter stream", () => {
    const program = programWith([modifier("Synthetic.Oscillator", "Engine.TexOscillator", [
      field("UOscillationType", enumValue(3, "OT_Jitter")), field("UOscillationAmplitude", 0.3), field("UOscillationRate", 0), field("UOscillationPhase", 0),
      field("VOscillationType", enumValue(3, "OT_Jitter")), field("VOscillationAmplitude", 0.1), field("VOscillationRate", 0), field("VOscillationPhase", 0)])]);
    const reference = createRandomStream(jitterSeed);
    const expectedU = randomRange(-0.3, 0.3, reference.nextUnit()), expectedV = randomRange(-0.1, 0.1, reference.nextUnit());
    expectMatrix(evaluated(program, "Synthetic.Oscillator", 5), [1, 0, expectedU, 0, 1, expectedV]);
  });

  it("TexScaler scales then offsets, and a chain applies the outermost modifier first", () => {
    const program = programWith([
      modifier("Synthetic.Scaler", "Engine.TexScaler", [field("UScale", 2), field("VScale", 3), field("UOffset", 0.1), field("VOffset", 0.2)], "Synthetic.Panner"),
      modifier("Synthetic.Panner", "Engine.TexPanner", [field("PanRate", 1), field("PanDirection", rotator(0, 0, 0), "authored", "raw")]),
    ]);
    expectMatrix(evaluated(program, "Synthetic.Scaler", 0), [2, 0, 0.1, 0, 3, 0.2]);
    const chain = textureCoordinateChainMatrix(program, ["Synthetic.Scaler", "Synthetic.Panner"], context(0.5));
    if (chain.status !== "evaluated") throw new Error(chain.reason);
    expect(transformedCoordinates(chain.matrix, 1, 1).map(value => Number(value.toFixed(12)))).toEqual([2 * 1 + 0.1 + 0.5, 3 * 1 + 0.2]);
  });

  it("passes TexCoordSource channel 0 through and reports another channel and every TexEnvMap unported", () => {
    const firstChannel = programWith([modifier("Synthetic.Source", "Engine.TexCoordSource", [field("SourceChannel", 0)])]);
    expect(textureCoordinateModifierMatrix(programNode(firstChannel, "Synthetic.Source"), context(1)))
      .toEqual({ status: "evaluated", matrix: IDENTITY_TEXTURE_COORDINATE_MATRIX });
    const thirdChannel = programWith([modifier("Synthetic.Source", "Engine.TexCoordSource", [field("SourceChannel", 2)])]);
    expect(textureCoordinateModifierMatrix(programNode(thirdChannel, "Synthetic.Source"), context(1)))
      .toEqual({ status: "unported", reason: "material-feature-unported:SourceChannel" });
    const environmentMap = programWith([modifier("Synthetic.EnvironmentMap", "Engine.TexEnvMap", [])]);
    expect(textureCoordinateModifierMatrix(programNode(environmentMap, "Synthetic.EnvironmentMap"), context(1)))
      .toEqual({ status: "unported", reason: "material-feature-unported:EnvMapType" });
  });

  it("TexOscillator evaluates an unset oscillation type as its zero member OT_Pan", () => {
    const program = programWith([modifier("Synthetic.Oscillator", "Engine.TexOscillator", [
      field("UOscillationType", null, "ue-zero"), field("UOscillationRate", 0.5), field("UOscillationPhase", 0.125), field("UOscillationAmplitude", 0.2),
      field("VOscillationType", null, "ue-zero"), field("VOscillationRate", 0), field("VOscillationPhase", 0), field("VOscillationAmplitude", 0)])]);
    const levelSeconds = 0.75;
    expectMatrix(evaluated(program, "Synthetic.Oscillator", levelSeconds), [1, 0, 0.2 * Math.sin(2 * Math.PI * (levelSeconds * 0.5 + 0.125)), 0, 1, 0]);
  });

  it("reports an unported class unported instead of evaluating it, and a triggered MaterialSequence stays unported", () => {
    const program = parseMaterialProgram(JSON.parse(JSON.stringify(programOf("Synthetic.Glow", [unportedNode("Synthetic.Glow", "Engine.GlowModifier")]))));
    expect(textureCoordinateModifierMatrix(programNode(program, "Synthetic.Glow"), context(1)))
      .toEqual({ status: "unported", reason: "material-class-unported:Engine.GlowModifier" });
    const sequence = parseMaterialProgram(JSON.parse(JSON.stringify(programOf("Synthetic.Sequence", [reviewedNode("Synthetic.Sequence", "Engine.MaterialSequence", [
      field("TriggerAction", enumValue(2, "MSTA_Pause"), "authored", "unported"), field("Loop", true, "class-default")])]))));
    expect(compileMaterialStagePlan(sequence)).toMatchObject({ status: "diagnostic", reasons: expect.arrayContaining(["material-feature-unported:TriggerAction"]) });
  });
});

const oceanSId = "Synthetic.ocean-s";
const oceanRotatorId = "Synthetic.ocn_rot";
const db2Tolerance = 2e-7;
const coldOceanVOffsetAtStart = 0.047552824;
const coldOceanVOffsetAfterWindow = 0.040450849;
const coldOceanVOffsetAtQuarterSecond = 0.046193976;
const coldOceanVOffsetAtHalfSecond = 0.044550326;
const resetTriggeredTime = -1;
const db2OrderChildFixtureColumnMatrix: TextureCoordinateMatrix = [0.75, 0.5, 0, -0.5, 0.75, 0];
const db2OrderNativeResultColumnMatrix: TextureCoordinateMatrix = [0.75, 0.5, 0.02377641201019287, -0.5, 0.75, 0.03566461801528931];
const oceanRotatorAuthoredCachedRows = [[0.9238795042037964, 0.3826834261417389, 0], [-0.3826834261417389, 0.9238795042037964, 0], [0, 0, 1]] as const;

function oceanProgram(overrides: FixtureProgramField[] = []): MaterialProgram {
  return programWith([
    oceanSTriggeredOscillatorNode(oceanSId, oceanRotatorId, overrides),
    modifier(oceanRotatorId, "Engine.TexRotator", [field("TexRotationType", enumValue(0, "TR_FixedRotation")), field("Rotation", rotator(0, 4096, 0), "authored", "raw")]),
  ]);
}

function oceanContext(levelSeconds: number) {
  return { levelSeconds, textureWidth: 256, textureHeight: 256, jitterStream: createRandomStream(jitterSeed) };
}

function oceanMatrix(program: MaterialProgram, levelSeconds: number) {
  return textureCoordinateModifierMatrix(programNode(program, oceanSId), oceanContext(levelSeconds));
}

function rowVectorTransform(rows: readonly (readonly number[])[], u: number, v: number): readonly [number, number] {
  return [u * rows[0]![0]! + v * rows[1]![0]! + rows[2]![0]!, u * rows[0]![1]! + v * rows[1]![1]! + rows[2]![1]!];
}

function rowVectorProduct(first: readonly (readonly number[])[], second: readonly (readonly number[])[]): number[][] {
  return first.map(row => second[0]!.map((_, column) => row.reduce((sum, value, index) => sum + value * second[index]![column]!, 0)));
}

describe("TexOscillatorTriggered in its untriggered state", () => {
  it("cold ocean-s holds the initial phase at level time 0 within 2e-7", () => {
    const evaluation = oceanMatrix(oceanProgram(), 0);
    if (evaluation.status !== "evaluated") throw new Error(evaluation.reason);
    expect(evaluation.matrix.slice(0, 5)).toEqual([1, 0, 0, 0, 1]);
    expect(Math.abs(evaluation.matrix[5] - coldOceanVOffsetAtStart)).toBeLessThanOrEqual(db2Tolerance);
  });

  it.each([1, 2.5, 100])("cold ocean-s holds V +0.040450849 from the end of its one-second window at t = %f", levelSeconds => {
    const evaluation = oceanMatrix(oceanProgram(), levelSeconds);
    if (evaluation.status !== "evaluated") throw new Error(evaluation.reason);
    expect(evaluation.matrix.slice(0, 5)).toEqual([1, 0, 0, 0, 1]);
    expect(Math.abs(evaluation.matrix[5] - coldOceanVOffsetAfterWindow)).toBeLessThanOrEqual(db2Tolerance);
  });

  it.each([[0.25, coldOceanVOffsetAtQuarterSecond], [0.5, coldOceanVOffsetAtHalfSecond]])(
    "cold ocean-s inside its window at t = %f gives the DB-2 fixture V offset %f within 2e-7", (levelSeconds, expectedVOffset) => {
      const evaluation = oceanMatrix(oceanProgram(), levelSeconds);
      if (evaluation.status !== "evaluated") throw new Error(evaluation.reason);
      expect(evaluation.matrix.slice(0, 5)).toEqual([1, 0, 0, 0, 1]);
      expect(Math.abs(evaluation.matrix[5] - expectedVOffset)).toBeLessThanOrEqual(db2Tolerance);
    });

  it.each([0, 1, 60])("ocean-s after Reset, TriggeredTime -1, holds the initial phase V +0.047552824 at t = %f", levelSeconds => {
    const evaluation = texOscillatorTriggeredMatrix(programNode(oceanProgram(), oceanSId), oceanContext(levelSeconds), resetTriggeredTime);
    if (evaluation.status !== "evaluated") throw new Error(evaluation.reason);
    expect(evaluation.matrix.slice(0, 5)).toEqual([1, 0, 0, 0, 1]);
    expect(Math.abs(evaluation.matrix[5] - coldOceanVOffsetAtStart)).toBeLessThanOrEqual(db2Tolerance);
  });

  it("reports a window with no positive oscillation rate unported", () => {
    expect(oceanMatrix(oceanProgram([field("VOscillationRate", 0)]), 3)).toEqual({ status: "unported", reason: "material-feature-unported:StopAfterPeriod" });
  });

  it("applies ocean-s before its child as DB-2's order fixture from D3DDrv 0x10011f42 to 0x100121b7 does", () => {
    const oceanS = oceanMatrix(oceanProgram(), 0);
    if (oceanS.status !== "evaluated") throw new Error(oceanS.reason);
    const combined = multiplyTextureCoordinateMatrices(db2OrderChildFixtureColumnMatrix, oceanS.matrix);
    combined.forEach((value, index) => expect(Math.abs(value - db2OrderNativeResultColumnMatrix[index]!)).toBeLessThanOrEqual(db2Tolerance));
    const reversed = multiplyTextureCoordinateMatrices(oceanS.matrix, db2OrderChildFixtureColumnMatrix);
    expect(Math.abs(reversed[2] - db2OrderNativeResultColumnMatrix[2])).toBeGreaterThan(1e-3);
  });

  it("composes ocean-s with ocn_rot's authored cached M in row vectors, which is not traced TexRotator output", () => {
    const program = oceanProgram();
    const chain = textureCoordinateChainMatrix(program, [oceanSId, oceanRotatorId], oceanContext(0));
    if (chain.status !== "evaluated") throw new Error(chain.reason);
    const oceanRows = [[1, 0, 0], [0, 1, 0], [0, coldOceanVOffsetAtStart, 1]];
    const nativeOrder = rowVectorProduct(oceanRows, oceanRotatorAuthoredCachedRows);
    const reversedOrder = rowVectorProduct(oceanRotatorAuthoredCachedRows, oceanRows);
    for (const [u, v] of [[0, 0], [1, 0], [0.25, 0.75]] as const) {
      const actual = transformedCoordinates(chain.matrix, u, v);
      const expected = rowVectorTransform(nativeOrder, u, v);
      actual.forEach((value, index) => expect(Math.abs(value - expected[index]!)).toBeLessThanOrEqual(1e-6));
    }
    const reversed = rowVectorTransform(reversedOrder, 0, 0);
    expect(Math.abs(transformedCoordinates(chain.matrix, 0, 0)[0] - reversed[0])).toBeGreaterThan(1e-3);
  });

  it("compiles ocean-s as a texture coordinate modifier and evaluates its sampler matrix per frame", () => {
    const program = oceanProgram();
    const plan = compileMaterialStagePlan(program);
    if (plan.status !== "compiled") throw new Error(plan.reasons.join(", "));
    expect(plan.samplers.map(sampler => sampler.textureCoordinateModifiers)).toEqual([[oceanSId, oceanRotatorId]]);
    const frame = evaluateMaterialFrame(program, plan, 2, createRandomStream(jitterSeed));
    if (frame.status !== "evaluated") throw new Error(frame.reason);
    const expectedChain = textureCoordinateChainMatrix(program, [oceanSId, oceanRotatorId], { ...context(2), textureWidth: 4, textureHeight: 4 });
    if (expectedChain.status !== "evaluated") throw new Error(expectedChain.reason);
    expect(frame.samplerMatrices).toEqual([expectedChain.matrix]);
  });

  it("keeps the rows: the window and the pan form confirmed from DB-2, the start state unconfirmed until map resets are known", () => {
    expect(TEXTURE_COORDINATE_CONSTANTS.triggeredOscillatorWindow).toMatchObject({
      id: "uv.triggered-oscillator-window", status: "confirmed-interlude",
      interludeEvidence: expect.stringMatching(/^Engine\.dll 4dd2f63c .*0x1030b94c.*0x105e1270.*0x105df780.*DB-2 tex-oscillator-triggered 053c115e/),
    });
    expect(TEXTURE_COORDINATE_CONSTANTS.oscillatorPanForm).toMatchObject({ id: "uv.oscillator-pan", status: "confirmed-interlude" });
    expect(TEXTURE_COORDINATE_CONSTANTS.oscillationTypeUnset).toMatchObject({ id: "uv.oscillation-type-unset", status: "confirmed-interlude", runtimeDefault: "OT_Pan" });
    expect(TEXTURE_COORDINATE_CONSTANTS.chainOrder).toMatchObject({
      id: "uv.chain-order", status: "confirmed-interlude", interludeEvidence: expect.stringMatching(/^D3DDrv\.dll 05622dde .*0x10011ca0/),
    });
    expect(TEXTURE_COORDINATE_CONSTANTS.oscillatorForm.status).toBe("unconfirmed");
    const startState = TEXTURE_COORDINATE_CONSTANTS.triggeredOscillatorStartState;
    expect(startState).toMatchObject({ id: "uv.triggered-oscillator-start-state", status: "unconfirmed", value: 0, runtimeDefault: 0, interludeEvidence: null });
    expect(startState.provenance).toContain("Reset sets TriggeredTime -1");
    expect(startState.provenance).toContain("map-reset-reachability, unresolved");
  });
});

describe("colour sources", () => {
  const fade = (fadeType: string, phase: number) => reviewedNode("Synthetic.Fade", "Engine.FadeColor", [
    field("Color1", colour(255, 128, 10, 0), "authored", "raw"), field("Color2", colour(20, 40, 250, 0), "authored", "raw"),
    field("FadePeriod", 0.4), field("FadePhase", phase), field("ColorFadeType", enumValue(fadeType === "FC_Linear" ? 0 : 1, fadeType))]);

  it("FadeColor sinusoidal stays byte-equal to the flame owner's fade at 12 samples", () => {
    const program = parseMaterialProgram(JSON.parse(JSON.stringify(programOf("Synthetic.Fade", [fade("FC_Sinusoidal", 0.1)]))));
    const flameFade = flameFadeOf(0.1);
    for (let sample = 0; sample < 12; sample += 1) {
      const levelSeconds = sample * 0.137;
      expect(fadeColourBytes(programNode(program, "Synthetic.Fade"), levelSeconds))
        .toEqual(evaluateNativeFlameFade(levelSeconds, flameFade).rgbaBytes);
    }
  });

  it("FadeColor linear is a triangle wave and ConstantColor and ColorModifier read their Color", () => {
    const program = parseMaterialProgram(JSON.parse(JSON.stringify(programOf("Synthetic.Fade", [fade("FC_Linear", 0),
      reviewedNode("Synthetic.Constant", "Engine.ConstantColor", [field("Color", colour(1, 2, 3, 4), "authored", "raw")])]))));
    const node = programNode(program, "Synthetic.Fade");
    const flameBytes = (levelSeconds: number) => evaluateNativeFlameFade(levelSeconds, flameFadeOf(0)).rgbaBytes;
    expect(fadeColourBytes(node, 0)).toEqual(flameBytes(0));
    expect(fadeColourBytes(node, 0.4)).toEqual(flameBytes(0.8));
    expect(fadeColourBytes(node, 0.6)[0]).toBe(Math.floor(Math.fround(Math.fround(Math.fround(1) * Math.fround(0.5)) + Math.fround(Math.fround(20 / 255) * Math.fround(0.5))) * 255));
    expect(colourSourceValue(programNode(program, "Synthetic.Constant"), 0)).toEqual([1 / 255, 2 / 255, 3 / 255, 4 / 255]);
  });
});

describe("selectTextureFrame", () => {
  it("follows AnimNext and MaxFrameRate like the flame owner's tick at frame seams", () => {
    for (const levelSeconds of [0, 0.0999999, 0.1, 0.21, 0.3, 1.19999, 1.2, 7.35]) {
      expect(selectTextureFrame({ frameCount: 12, maximumFrameRate: 10 }, levelSeconds).index)
        .toBe(selectNativeFlameFrame(levelSeconds, { maxFrameRate: 10, totalFrameNum: 12 }).index);
    }
  });

  it("evaluates a compiled plan's matrices, frames and colour sources at a level time", () => {
    const program = programWith([modifier("Synthetic.Panner", "Engine.TexPanner", [field("PanRate", 2), field("PanDirection", rotator(0, 0, 0), "authored", "raw")])]);
    const plan = compileMaterialStagePlan(program);
    if (plan.status !== "compiled") throw new Error(plan.reasons.join(", "));
    expect(evaluateMaterialFrame(program, plan, 0.25, createRandomStream(jitterSeed))).toEqual({
      status: "evaluated", samplerMatrices: [[1, 0, 0.5, 0, 1, 0]], samplerFrameIndices: [0], colourSourceValues: [] });
  });
});
