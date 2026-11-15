import type { SyntheticZoneKeyRow } from "../../fixtures/minimapRouteManifestFixture";
import type { ZoneKeyMip } from "../../../src/ui/nativeWindows/radarZoneName";

export const syntheticGiranColor = 255;
export const syntheticOverlapColor = 200;

export const syntheticZoneKeyRows: readonly SyntheticZoneKeyRow[] = [
  { name: "Synthetic waterways", key: 0, color: 0, mapX: 0, mapY: 0, bottom: -30000, top: 30000, tileId: null },
  { name: "Synthetic plains", key: 7 << 8, color: 7, mapX: 0, mapY: 0, bottom: -30000, top: 30000, tileId: null },
  { name: "Giran Castle Town", key: 353697536, color: syntheticGiranColor, mapX: 20, mapY: 21, bottom: -10000, top: 10000, tileId: "20_21" },
  { name: "Synthetic lower zone", key: 353683456, color: syntheticOverlapColor, mapX: 20, mapY: 21, bottom: -5000, top: 2000, tileId: "20_21" },
  { name: "Synthetic upper zone", key: 353683456, color: syntheticOverlapColor, mapX: 20, mapY: 21, bottom: 0, top: 8000, tileId: "20_21" },
];

export const syntheticZoneKeyMip: ZoneKeyMip = {
  width: 4, height: 4,
  bytes: new Uint8Array([7, 7, 7, 7, 7, 7, 7, 7, 7, syntheticGiranColor, syntheticOverlapColor, 7, 7, 7, 7, 9]),
};
