import {
  fogInfoMemberAtHour, fogInfoScalarMemberAtHour, interpolateFogColourBytes, type FogColourBytes, type FogInfoColourKey, type WeightedFogInfo,
} from "../../shared/fogInfoHourlyColours";
import type { SkyEnvironmentSection } from "./nativeEnvironmentTypeTables";
import type { RgbBytes } from "./sampleNativeTimeTables";

type FogInfoSkyColourReader = (colours: readonly FogInfoColourKey[], hour: number) => FogColourBytes | null;

const fogInfoSkyColourReaderBySection: Readonly<Record<SkyEnvironmentSection, FogInfoSkyColourReader>> = {
  SkyBoxColor: (colours, hour) => fogInfoScalarMemberAtHour(colours, hour, key => key.skyColourBytes),
  HazeringColor: (colours, hour) => fogInfoMemberAtHour(colours, hour, key => key.hazeRingColourBytes[0]),
  CloudColor1: (colours, hour) => fogInfoMemberAtHour(colours, hour, key => key.cloudColourBytes[0]),
  CloudColor2: (colours, hour) => fogInfoMemberAtHour(colours, hour, key => key.cloudColourBytes[1]),
  CloudColor3: (colours, hour) => fogInfoMemberAtHour(colours, hour, key => key.cloudColourBytes[2]),
};

export function composeLocalSkyColour(tableColour: RgbBytes, section: SkyEnvironmentSection, fogInfos: readonly WeightedFogInfo[], hour: number): RgbBytes {
  const readFogInfoSkyColour = fogInfoSkyColourReaderBySection[section];
  let colour = tableColour;
  for (const { fogInfo, weight } of fogInfos) {
    const target = readFogInfoSkyColour(fogInfo.colours, hour);
    if (target !== null) colour = interpolateFogColourBytes(colour, target, Math.fround(weight));
  }
  return colour;
}
