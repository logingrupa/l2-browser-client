import { fGetHsv } from "../fGetHsv";
import { fColorFromPlane, type BgraBytes } from "../nativeColourBytes";
import { ENVIRONMENT_ENGINE_CONSTANTS } from "../nativeEnvironmentEngineConstants";
import { scalePlane } from "../nativePlane";

export interface ZoneAmbientLight {
  readonly hue: number;
  readonly saturation: number;
  readonly brightness: number;
}

const { bspAmbientScale } = ENVIRONMENT_ENGINE_CONSTANTS;

export function lightmapAmbientBgra(zone: ZoneAmbientLight): BgraBytes {
  return fColorFromPlane(scalePlane(fGetHsv(zone.hue, zone.saturation, zone.brightness), bspAmbientScale.value));
}
