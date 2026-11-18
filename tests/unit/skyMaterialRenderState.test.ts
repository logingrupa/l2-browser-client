import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Constants } from "@babylonjs/core/Engines/constants";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Scene } from "@babylonjs/core/scene";
import rulesText from "../../recipes/world/shared-sky-visibility.json?raw";
import { createNativeMaterial } from "../../src/materials/ue2/babylon/material";
import type { BlendFactor } from "../../src/materials/ue2/model/constants/blendFactorTypes";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";

interface Direct3dRenderState { readonly ZENABLE: number; readonly ZWRITEENABLE: number; readonly ZFUNC: number; readonly SRCBLEND: number; readonly DESTBLEND: number;
  readonly ALPHABLENDENABLE: number }

const rules = JSON.parse(rulesText) as { materialSorting: readonly { material: string; renderState: Direct3dRenderState }[] };
const stagedFolder = new URL("../fixtures/environment/skylevel-visibility/", import.meta.url);
const listedPrograms = (JSON.parse(readFileSync(new URL("material-programs.json", stagedFolder), "utf8")) as { materials: { root: string; program: string }[] }).materials;
const direct3dBlendOfFactor: Readonly<Partial<Record<BlendFactor, number>>> = { zero: 1, one: 2, "source-alpha": 5, "inverse-source-alpha": 6 };
const direct3dLessEqual = 4;
const onePixelImage = { width: 1, height: 1, rgba: new Uint8Array(4) };
const babylonAlphaModeOfDirect3dPair: Readonly<Record<string, number>> = { "2,1": Constants.ALPHA_DISABLE, "5,6": Constants.ALPHA_COMBINE, "2,2": Constants.ALPHA_ONEONE };

function stagedProgram(root: string) {
  const listed = listedPrograms.find(entry => entry.root.toLowerCase() === root.toLowerCase());
  if (listed === undefined) throw new Error(`the staged skylevel fixture holds no program for ${root}`);
  const program = parseMaterialProgram(JSON.parse(readFileSync(new URL(`material-programs/${listed.program}`, stagedFolder), "utf8")));
  return { materialId: listed.program, program, plan: compileMaterialStagePlan(program) };
}

describe("shared sky material render state", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  it.each(rules.materialSorting.map(row => [row.material, row.renderState] as const))(
    "binds %s with the RM-24 blend factors, depth write and LESS_EQUAL depth test of its captured state tuple", (material, tuple) => {
      const loaded = stagedProgram(material);
      if (loaded.plan.status === "diagnostic") throw new Error(`${material} compiles to a diagnostic plan: ${loaded.plan.reasons.join(", ")}`);
      const { pair, depthWrite, depthTest } = loaded.plan.blend;
      expect([direct3dBlendOfFactor[pair.source], direct3dBlendOfFactor[pair.destination]]).toEqual([tuple.SRCBLEND, tuple.DESTBLEND]);
      expect([depthWrite ? 1 : 0, depthTest ? direct3dLessEqual : null, tuple.ZENABLE]).toEqual([tuple.ZWRITEENABLE, tuple.ZFUNC, 1]);
      const onePixelImages = new Map(loaded.plan.samplers.flatMap(sampler => sampler.frameImages.map(image => [image.sha256, onePixelImage] as const)));
      const native = createNativeMaterial(scene, { ...loaded, texturePixels: onePixelImages, textureMipChains: new Map() }, { sessionSeed: 1, lighting: "unlit" });
      const bound = native.material as ShaderMaterial;
      expect(bound.alphaMode).toBe(babylonAlphaModeOfDirect3dPair[`${tuple.SRCBLEND},${tuple.DESTBLEND}`]);
      expect(bound.alphaMode !== Constants.ALPHA_DISABLE).toBe(tuple.ALPHABLENDENABLE === 1);
      expect([bound.disableDepthWrite, bound.depthFunction]).toEqual([tuple.ZWRITEENABLE === 0, Constants.LEQUAL]);
      native.dispose();
    });
});
