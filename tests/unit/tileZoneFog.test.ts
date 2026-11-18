import { describe, expect, it } from "vitest";
import { ENVIRONMENT_ENGINE_CONSTANTS } from "../../src/environment/model/nativeEnvironmentEngineConstants";
import { FOG_CONSTANTS } from "../../src/materials/ue2/model/constants/fogConstants";
import { evaluateLocalFogList, fogInfoColourAtHour, fogInfoWeight, fogRangeSlot, type L2FogInfoRecord } from "../../src/materials/ue2/model/fog";
import { environmentFogBaseline } from "../../src/scene/world/cameraEnvironment";
import { decodeFogInfos } from "../../src/scene/world/lighting/tileFogInfoRecords";
import { fogInfo9236Record } from "../support/tileLightingFixture";
import { shippedEnvironmentFogRanges } from "../support/worldTimeOfDayFixture";

const [decoded] = decodeFogInfos([fogInfo9236Record()]);
const fogInfo = decoded!.record!;
const sourceLocation = fogInfo.sourceLocation;
const atDistance = (distance: number) => ({ x: sourceLocation.x + distance, y: sourceLocation.y, z: sourceLocation.z });

describe("decoded L2FogInfo of 20_21 export 9236", () => {
  it("reads AffectRange, TextureDistance, FogRange1 to 5, the Colors fog colours by hour and the Location", () => {
    expect(decoded!.unresolvedReason).toBeNull();
    expect(fogInfo.affectRange).toEqual({ min: 3000, max: 4000 });
    expect(fogInfo.textureDistance).toBe(0);
    expect(fogInfo.fogRanges).toEqual([2000, 4000, 6000, 8000, 10000].map(max => ({ min: 0, max })));
    expect(fogInfo.colours.map(colour => colour.time)).toEqual([0, 5, 6, 7, 19, 20, 23]);
    expect(fogInfo.colours[2]!.fogColourBytes).toEqual([107, 114, 97]);
    expect(sourceLocation).toEqual({ x: 28491.390625, y: 110465.5, z: -1361.5125732421875 });
  });

  it("names an unresolved field or colour times that do not increase instead of decoding them", () => {
    const record = fogInfo9236Record();
    record.fields = record.fields.map(field => field.field === "FogRange3" ? { ...field, provenance: "unresolved", value: null } : field);
    expect(decodeFogInfos([record])[0]).toEqual({ exportIndex: 9236, record: null, unresolvedReason: "lighting-fog-info-unresolved:9236:FogRange3" });
    const repeated = fogInfo9236Record();
    repeated.fields = repeated.fields.map(field => field.field === "Colors" ? { ...field, value: [{ Time: 5, FogColor: { R: 1, G: 2, B: 3, A: 0 } },
      { Time: 5, FogColor: { R: 1, G: 2, B: 3, A: 0 } }] } : field);
    expect(decodeFogInfos([repeated])[0]!.unresolvedReason).toBe("lighting-fog-info-colour-times-not-increasing:9236");
  });
});

describe("L2FogInfo selection by the Q12 answer", () => {
  it("matches the replay checker example: d 3500, hour 5.5, CR 4 gives start 1024, end 5096 and colour (107, 112, 108)", () => {
    expect(environmentFogBaseline(shippedEnvironmentFogRanges, 4)).toEqual({ colourBytes: [127, 127, 127], startSourceUnits: 2048, endSourceUnits: 8192 });
    expect(ENVIRONMENT_ENGINE_CONSTANTS.fogBaselineColour.value.slice(0, 3)).toEqual([127, 127, 127]);
    expect(evaluateLocalFogList([fogInfo], environmentFogBaseline(shippedEnvironmentFogRanges, 4), { hour: 5.5, terrainClipRange: 4, referencePosition: atDistance(3500) }))
      .toEqual({ list: { status: "blended", record: { colourBytes: [107, 112, 108], startSourceUnits: 1024, endSourceUnits: 5096 } },
        retentionDistanceDecides: false, orderCanChangeResult: false });
  });

  it("selects FogRange1 below CR 5, FogRange2 from 5, and FogRange5 from 8, on each side of a boundary", () => {
    expect([4.999, 5, 5.999, 6, 6.999, 7, 7.999, 8, 12].map(fogRangeSlot)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(environmentFogBaseline(shippedEnvironmentFogRanges, 8)).toMatchObject({ startSourceUnits: 4 * 2048, endSourceUnits: 10 * 2048 });
  });

  it("takes the fog colour of the first hour pair that holds the hour, both ends inclusive, wraps the last pair past 24 and is black without a match", () => {
    expect(fogInfoColourAtHour(fogInfo.colours, 5)).toEqual([70, 83, 83]);
    expect(fogInfoColourAtHour(fogInfo.colours, 6)).toEqual([107, 114, 97]);
    expect(fogInfoColourAtHour(fogInfo.colours, 23.5)).toEqual([93, 97, 89]);
    expect(fogInfoColourAtHour(fogInfo.colours.slice(1), 2)).toEqual([0, 0, 0]);
  });

  it("weights an actor 1 inside AffectRange.Min, 0 from AffectRange.Max or with fewer than two colours, and linearly between", () => {
    expect(fogInfoWeight(fogInfo.affectRange, 2999.9, 7)).toBe(1);
    expect(fogInfoWeight(fogInfo.affectRange, 3000, 7)).toBe(1);
    expect(fogInfoWeight(fogInfo.affectRange, 3750, 7)).toBe(0.25);
    expect(fogInfoWeight(fogInfo.affectRange, 4000, 7)).toBe(0);
    expect(fogInfoWeight(fogInfo.affectRange, 100, 1)).toBe(0);
  });

  it("blends each actor in list order over the earlier result without normalising", () => {
    const near: L2FogInfoRecord = { ...fogInfo, affectRange: { min: 10000, max: 20000 } };
    const both = evaluateLocalFogList([near, near], environmentFogBaseline(shippedEnvironmentFogRanges, 4), { hour: 6, terrainClipRange: 4, referencePosition: atDistance(0) });
    expect(both.list).toEqual({ status: "blended", record: { colourBytes: [107, 114, 97], startSourceUnits: 0, endSourceUnits: 2000 } });
    expect(both.orderCanChangeResult).toBe(false);
  });

  it("names the export-order assumption only when two contributing actors could blend differently in another order", () => {
    const inputs = { hour: 6, terrainClipRange: 4, referencePosition: atDistance(3500) };
    const baseline = environmentFogBaseline(shippedEnvironmentFogRanges, 4);
    const partial: L2FogInfoRecord = { ...fogInfo, affectRange: { min: 3000, max: 4000 } };
    expect(evaluateLocalFogList([partial, partial], baseline, inputs).orderCanChangeResult).toBe(true);
    const fullOtherRange: L2FogInfoRecord = { ...fogInfo, affectRange: { min: 5000, max: 6000 }, fogRanges: fogInfo.fogRanges.map(range => ({ ...range, max: range.max + 1 })) };
    expect(evaluateLocalFogList([partial, fullOtherRange], baseline, inputs).orderCanChangeResult).toBe(true);
    const fullSameTarget: L2FogInfoRecord = { ...fogInfo, affectRange: { min: 5000, max: 6000 } };
    expect(evaluateLocalFogList([partial, fullSameTarget], baseline, inputs).orderCanChangeResult).toBe(false);
  });

  it("keeps an actor beyond AffectRange.Max inside TextureDistance at weight 0, so the list blends the grey preset instead of emptying", () => {
    const inputs = { hour: 6, terrainClipRange: 8, referencePosition: atDistance(5000) };
    const baseline = environmentFogBaseline(shippedEnvironmentFogRanges, 8);
    expect(evaluateLocalFogList([fogInfo], baseline, inputs))
      .toEqual({ list: { status: "empty" }, retentionDistanceDecides: true, orderCanChangeResult: false });
    const textured: L2FogInfoRecord = { ...fogInfo, textureDistance: 6000 };
    expect(evaluateLocalFogList([textured], baseline, inputs))
      .toEqual({ list: { status: "blended", record: { colourBytes: [127, 127, 127], startSourceUnits: 8192, endSourceUnits: 20480 } },
        retentionDistanceDecides: true, orderCanChangeResult: false });
  });

  it("holds the RM-4 rows and keeps the list order, sky scene route and fog curve as named open rows", () => {
    expect(FOG_CONSTANTS.terrainClipRange).toMatchObject({ status: "confirmed-interlude", runtimeDefault: 8 });
    expect(FOG_CONSTANTS.fadeReferencePosition).toMatchObject({ status: "confirmed-interlude", runtimeDefault: "possessed-pawn-location" });
    expect(FOG_CONSTANTS.localListProducer).toMatchObject({ status: "confirmed-interlude", runtimeDefault: "al2foginfo-tick-add-unique" });
    expect(FOG_CONSTANTS.localListRetention).toMatchObject({ status: "confirmed-interlude", interludeEvidence: "Engine.dll 0x106560f0" });
    expect(FOG_CONSTANTS.localListOrder).toMatchObject({ status: "unconfirmed", runtimeDefault: "export-order" });
    expect(FOG_CONSTANTS.localListOrder.provenance).toMatch(/^assumption:/);
    expect(FOG_CONSTANTS.skySceneRoute).toMatchObject({ status: "unknown", runtimeDefault: null });
    expect(FOG_CONSTANTS.viewportActorEnableFlag).toMatchObject({ id: "fog.viewport-actor-enable-flag", status: "unconfirmed", runtimeDefault: true });
    expect(FOG_CONSTANTS.viewportActorEnableFlag.provenance).toMatch(/^assumption:.*\+0x5ac & 0x80000/);
    expect(FOG_CONSTANTS.sourcePrecedence.provenance).toMatch(/enabled only when the camera ZoneInfo has bDistanceFog \(\+0x3d8 & 8\) and the viewport actor \+0x5ac & 0x80000/);    expect(FOG_CONSTANTS.sourcePrecedence.runtimeDefault).toEqual(["volume", "local-fog-list", "terrain-zone-environment", "camera-zone"]);
    expect(FOG_CONSTANTS.rangeUnit).toMatchObject({ status: "confirmed-interlude", runtimeDefault: 2048 });
    expect(FOG_CONSTANTS.factor.provenance).toMatch(/^assumption:/);
  });
});
