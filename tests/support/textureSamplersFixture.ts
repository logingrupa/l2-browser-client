import { readFileSync } from "node:fs";

export interface TextureSamplersBoundStage {
  readonly stage: number;
  readonly texture: string;
  readonly levelCount: number;
  readonly size: readonly [number, number];
  readonly minFilter: number;
  readonly magFilter: number;
  readonly mipFilter: number;
  readonly lodBias: number;
  readonly maxAnisotropy: number;
  readonly address: readonly [number, number, number];
}

export interface TextureSamplersFixture {
  readonly configuration: {
    readonly l2Ini: Readonly<Record<string, string>>;
    readonly optionIni: Readonly<Record<string, string>>;
    readonly runtimeGlobals: Readonly<Record<string, number>>;
  };
  readonly liveSummary: readonly { readonly role: string; readonly boundStages: readonly TextureSamplersBoundStage[] }[];
}

export const d3dTextureFilterLinear = 2;
export const d3dTextureAddressWrap = 1;
export const d3dTextureAddressClamp = 3;
export const liveLightmapTexture = "FStaticLightMapTexture";

export const textureSamplersFixture = JSON.parse(readFileSync(new URL("../fixtures/rm25/texture-samplers-native.json", import.meta.url), "utf8")) as TextureSamplersFixture;

export function liveBoundStages(): readonly TextureSamplersBoundStage[] {
  return textureSamplersFixture.liveSummary.flatMap(sample => sample.boundStages);
}

export function liveBoundStage(texture: string): TextureSamplersBoundStage {
  const stage = liveBoundStages().find(candidate => candidate.texture.toLowerCase() === texture.toLowerCase());
  if (!stage) throw new Error(`no RM-25 live bound stage samples ${texture}`);
  return stage;
}
