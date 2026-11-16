import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { createNativeMaterial, FOG_DISABLED, type NativeMaterial } from "../../src/materials/ue2/babylon/material";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { createNativeSkyLiteralComparison, type NativeSkyLiteralSurface } from "../../src/scene/world/nativeSkyLiteralComparison";
import { parseNativeEnvironmentTables, selectNativeSkyLiteral, skyEnvironmentBindings } from "../../src/scene/world/nativeEnvironmentTables";
import { swatchTexturePng, syntheticSkyColourModifierProgram, syntheticUnportedProgram, textureImageFor, type FixtureProgram } from "../support/materialProgramFixture";

const source = parseNativeEnvironmentTables(JSON.parse(readFileSync("artifacts/native-parity/research/sky-environment-conversion-20261107/converted/sky-tables.json", "utf8")));
const literal = (key = "COLOR13", file = "timeenv0.int") => selectNativeSkyLiteral(source, file, key);
const storedColourBgraHex = ["ce9600ff", "95e4ff80", "97c0ffc0"];
const storedColours = [[0, 150 / 255, 206 / 255, 1], [1, 228 / 255, 149 / 255, 128 / 255], [1, 192 / 255, 151 / 255, 192 / 255]];
const whiteChipImage = textureImageFor(swatchTexturePng());
const levelUniforms = { levelSeconds: 5, hour: 12, environmentType: 0, fog: FOG_DISABLED };

function libraryMaterial(scene: Scene, program: FixtureProgram): NativeMaterial {
  const parsed = parseMaterialProgram(JSON.parse(JSON.stringify(program)));
  return createNativeMaterial(scene, { materialId: "e".repeat(64), program: parsed, plan: compileMaterialStagePlan(parsed),
    texturePixels: new Map([[whiteChipImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]) }, { sessionSeed: 1, lighting: "unlit" });
}

const rootColour = (library: NativeMaterial) => library.inspect().frame!.colourSourceValues[0];

describe("literal sky comparison through the UE2 library colour source", () => {
  let engine: NullEngine, scene: Scene, comparisons: ReturnType<typeof createNativeSkyLiteralComparison>[];
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); comparisons = []; });
  afterEach(() => { for (const comparison of comparisons) comparison.dispose(); scene.dispose(); engine.dispose(); });
  function fixture() {
    const surfaces = skyEnvironmentBindings.map((binding, index) => ({ sourceReference: binding.material,
      library: libraryMaterial(scene, syntheticSkyColourModifierProgram(binding.material, whiteChipImage, storedColourBgraHex[index]!)) }));
    const comparison = createNativeSkyLiteralComparison(surfaces); comparisons.push(comparison);
    return { surfaces, comparison };
  }

  it("sets each root ColorModifier colour source to its row RGB / 255, keeps the stored alpha and textures, and restores the stored colour", () => {
    const { surfaces, comparison } = fixture(), materials = surfaces.map(surface => surface.library.material), textures = [...scene.textures];
    expect(surfaces.map(surface => rootColour(surface.library))).toEqual(storedColours);
    comparison.apply(literal());
    surfaces.forEach((surface, index) => {
      const rgb = literal().layers[index]!.row.rgb;
      expect(rootColour(surface.library)).toEqual([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, storedColours[index]![3]]);
      expect(surface.library.material).toBe(materials[index]);
    });
    expect(scene.textures).toEqual(textures);
    expect(comparison.inspection()).toMatchObject({ mode: "literal-source-row-comparison", selected: { file: "timeenv0.int", key: "COLOR13" } });
    comparison.restore();
    expect(surfaces.map(surface => rootColour(surface.library))).toEqual(storedColours);
    expect(comparison.inspection()).toMatchObject({ mode: "stored-materials", selected: null });
  });

  it("keeps the compared colour across library frame updates and exposes immutable selection evidence", () => {
    const { surfaces, comparison } = fixture();
    comparison.apply(literal("COLOR25", "timeenv3.int"));
    const compared = surfaces.map(surface => rootColour(surface.library));
    for (const surface of surfaces) surface.library.update(levelUniforms);
    expect(surfaces.map(surface => rootColour(surface.library))).toEqual(compared);
    const inspected = comparison.inspection();
    expect(inspected).toMatchObject({ nativeSelection: "unverified", nativeInterpolation: "unverified", selected: { file: "timeenv3.int", key: "COLOR25", tLiteral: 24 } });
    expect(inspected.selected!.layers[0]).toMatchObject({ declaredNum: 1, physicalColorRows: 25, declaredNumMatchesPhysicalRows: false });
    inspected.selected!.layers[0]!.row.rgb[0] = 0;
    expect(comparison.inspection().selected!.layers[0]!.row.rgb).toEqual([255, 35, 35]);
    comparison.restore(); comparison.restore(); comparison.apply(literal());
    comparison.dispose(); comparison.dispose();
    expect(surfaces.map(surface => rootColour(surface.library))).toEqual(storedColours);
    expect(comparison.inspection()).toMatchObject({ mode: "disposed", selected: null });
    expect(() => comparison.apply(literal())).toThrow("disposed");
  });

  it.each(["missing", "duplicate", "invalid-rgb"])("rejects a %s layer without a partial colour override", fault => {
    const { surfaces, comparison } = fixture(), candidate = literal();
    if (fault === "missing") candidate.layers.pop();
    if (fault === "duplicate") candidate.layers.push(structuredClone(candidate.layers[0]!));
    if (fault === "invalid-rgb") candidate.layers[2]!.row.rgb[0] = 256;
    expect(() => comparison.apply(candidate)).toThrow("Invalid literal color");
    expect(surfaces.map(surface => rootColour(surface.library))).toEqual(storedColours);
    expect(comparison.inspection().selected).toBeNull();
  });

  it.each(["missing", "duplicate", "unconverted"])("refuses a %s library sky surface before overriding any colour", fault => {
    const { surfaces } = fixture();
    const changed: NativeSkyLiteralSurface[] = [...surfaces];
    if (fault === "missing") changed.pop();
    if (fault === "duplicate") changed.push(surfaces[1]!);
    if (fault === "unconverted") changed[2] = { sourceReference: surfaces[2]!.sourceReference, library: null };
    expect(() => createNativeSkyLiteralComparison(changed)).toThrow("requires one UE2 library sky surface");
    expect(surfaces.map(surface => rootColour(surface.library))).toEqual(storedColours);
  });
});

describe("UE2 library colour source RGB override", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  it("names the colour source a compiled material lacks and refuses an override on a diagnostic material", () => {
    const compiled = libraryMaterial(scene, syntheticSkyColourModifierProgram("Sky.Background", whiteChipImage, storedColourBgraHex[0]!));
    expect(() => compiled.overrideColourSourceRgb("Sky.Other", [1, 1, 1])).toThrow("UE2 material Sky.Background has no colour source Sky.Other.");
    const diagnostic = libraryMaterial(scene, syntheticUnportedProgram());
    expect(() => diagnostic.overrideColourSourceRgb("Sky.Background", [1, 1, 1])).toThrow("has no colour source Sky.Background");
  });
});
