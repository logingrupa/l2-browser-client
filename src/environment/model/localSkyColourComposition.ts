import { fogInfoMemberAtHour, interpolateFogColourBytes, type FogInfoColourMember, type WeightedFogInfo } from "../../materials/ue2/model/fog";
import type { SkyEnvironmentSection } from "../parseNativeTimeTables";
import type { RgbBytes } from "./sampleNativeTimeTables";

const fogInfoMemberBySkySection: Readonly<Record<SkyEnvironmentSection, FogInfoColourMember>> = {
  SkyBoxColor: key => key.skyColourBytes,
  HazeringColor: key => key.hazeRingColourBytes[0],
  CloudColor1: key => key.cloudColourBytes[0],
  CloudColor2: key => key.cloudColourBytes[1],
  CloudColor3: key => key.cloudColourBytes[2],
};

export function composeLocalSkyColour(tableColour: RgbBytes, section: SkyEnvironmentSection, fogInfos: readonly WeightedFogInfo[], hour: number): RgbBytes {
  const member = fogInfoMemberBySkySection[section];
  let colour = tableColour;
  for (const { fogInfo, weight } of fogInfos) {
    const target = fogInfoMemberAtHour(fogInfo.colours, hour, member);
    if (target !== null) colour = interpolateFogColourBytes(colour, target, Math.fround(weight));
  }
  return colour;
}
