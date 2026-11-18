import { describe, expect, it } from "vitest";
import { buildLightingTables } from "../../src/environment/model/lightmapRebuild/lightingTables";
import type { LightmapRebuildRecord, LightmapRebuildShadow } from "../../src/scene/world/lighting/decodeLightmapRebuildInputs";
import { composeRebuiltLightmapRequest } from "../../src/scene/world/lighting/rebuiltLightmapRequest";
import { authoredFields, pointLightFields, rebuildEnvironmentAtHourSix, rebuildLightActor, rebuildZone } from "../support/lightmapRebuildFixture";

const pageEdge = 512;
const lightmapEdge = 16;
const lightmapsPerRow = pageEdge / lightmapEdge;
const shadowRecordCount = 5903;
const lightCount = 339;
const maskRowBytes = lightmapEdge / 8;

function worstCaseShadow(shadow: number): LightmapRebuildShadow {
  const bits = Uint8Array.from({ length: maskRowBytes * lightmapEdge }, (_, index) => (index * 37 + shadow) & 0xff);
  return { light: shadow % lightCount, height: lightmapEdge, rowBytes: maskRowBytes, minimumX: 0, minimumY: 0, maximumX: lightmapEdge - 1, maximumY: lightmapEdge - 1, bits };
}

function worstCaseRecords(): LightmapRebuildRecord[] {
  const shadows = Array.from({ length: shadowRecordCount }, (_, shadow) => worstCaseShadow(shadow));
  const lightmapCount = lightmapsPerRow * lightmapsPerRow;
  return Array.from({ length: lightmapCount }, (_, lightmap) => ({
    zone: 2, atlasX: (lightmap % lightmapsPerRow) * lightmapEdge, atlasY: Math.floor(lightmap / lightmapsPerRow) * lightmapEdge,
    surface: { normal: [0, 0, -1], polyFlags: 0 },
    projection: { width: lightmapEdge, height: lightmapEdge, origin: [0, 0, 0], uStep: [1, 0, 0], vStep: [0, 1, 0] },
    shadows: shadows.filter((_, shadow) => shadow % lightmapCount === lightmap),
  }));
}

describe("rebuilt lightmap composition of a dense page", () => {
  it("composes and resolves a 512 x 512 page with 5903 full-rectangle shadow records, twice the shadow texels of 20_10", () => {
    const records = worstCaseRecords();
    const shadowTexels = records.reduce((sum, record) => sum + record.shadows.length * lightmapEdge * lightmapEdge, 0);
    const lights = Array.from({ length: lightCount }, (_, light) => rebuildLightActor("Engine.Light", { ...pointLightFields, LightHue: light % 256 }, light + 1));
    const tables = buildLightingTables();
    const result = composeRebuiltLightmapRequest({ edge: pageEdge, records, lights, zones: [rebuildZone(2, { AmbientHue: 0, AmbientSaturation: 255, AmbientBrightness: 40 })],
      levelInfos: [{ exportIndex: 2, fields: authoredFields({ Brightness: 1 }) }],
      environment: rebuildEnvironmentAtHourSix }, tables);
    expect(result.status).toBe("resolved");
    expect(shadowTexels).toBe(shadowRecordCount * lightmapEdge * lightmapEdge);
  });
});
