import { Constants } from "@babylonjs/core/Engines/constants";
import type { BlendFactorPair } from "../model/constants/blendFactorTypes";

export interface BabylonBlendState {
  readonly alphaMode: number;
  readonly alphaModeName: string;
  readonly colourWrite: boolean;
}

const babylonAlphaModeByPair: Readonly<Record<string, BabylonBlendState>> = {
  "one,zero": { alphaMode: Constants.ALPHA_DISABLE, alphaModeName: "ALPHA_DISABLE", colourWrite: true },
  "source-alpha,inverse-source-alpha": { alphaMode: Constants.ALPHA_COMBINE, alphaModeName: "ALPHA_COMBINE", colourWrite: true },
  "one,inverse-source-alpha": { alphaMode: Constants.ALPHA_PREMULTIPLIED, alphaModeName: "ALPHA_PREMULTIPLIED", colourWrite: true },
  "one,inverse-source-colour": { alphaMode: Constants.ALPHA_SCREENMODE, alphaModeName: "ALPHA_SCREENMODE", colourWrite: true },
  "source-alpha,one": { alphaMode: Constants.ALPHA_ADD, alphaModeName: "ALPHA_ADD", colourWrite: true },
  "one,one": { alphaMode: Constants.ALPHA_ONEONE, alphaModeName: "ALPHA_ONEONE", colourWrite: true },
  "zero,inverse-source-colour": { alphaMode: Constants.ALPHA_SUBTRACT, alphaModeName: "ALPHA_SUBTRACT", colourWrite: true },
  "zero,one": { alphaMode: Constants.ALPHA_DISABLE, alphaModeName: "ALPHA_DISABLE with colour writes off", colourWrite: false },
};

export function blendFactorPairKey(pair: BlendFactorPair): string {
  return `${pair.source},${pair.destination}`;
}

export function babylonBlendStateForPair(pair: BlendFactorPair): BabylonBlendState | null {
  return babylonAlphaModeByPair[blendFactorPairKey(pair)] ?? null;
}
