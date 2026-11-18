import { dynamicLightColour } from "../../../environment/model/lightmapRebuild/dynamicLightColour";
import type { NativePlane } from "../../../environment/model/nativePlane";
import { allFieldsResolved, readBooleanField, readByteField, readNumberField, type RebuildFieldOwner, type RebuildFieldResult } from "./rebuildFieldReaders";
import type { RebuildLightEnvironment } from "./rebuildShadowLights";

export function resolveLightActorColour(owner: RebuildFieldOwner, lightType: number, levelBrightness: number, environment: RebuildLightEnvironment):
  RebuildFieldResult<NativePlane> {
  const source = allFieldsResolved({ lightPeriod: readByteField(owner, "LightPeriod"), lightPhase: readByteField(owner, "LightPhase"),
    lightHue: readByteField(owner, "LightHue"), lightSaturation: readByteField(owner, "LightSaturation"), lightBrightness: readNumberField(owner, "LightBrightness"),
    sunlightColour: readBooleanField(owner, "bSunlightColor") });
  if (source.status !== "resolved") return source;
  return dynamicLightColour({ lightType, ...source.value },
    { tables: environment.tables, blend: environment.blend, hour: environment.hour, levelBrightness, levelTimeSeconds: environment.levelTimeSeconds });
}
