import { describe, expect, it } from "vitest";
import { FOG_CONSTANTS } from "../../src/materials/ue2/model/constants/fogConstants";
import {
  environmentFogBaseline, fogInfoColourAtHour, fogInfoWeight, fogRangeSlot, localFogListRecord, type L2FogInfoRecord,
} from "../../src/materials/ue2/model/fog";
import { decodeEnvironmentFogRanges, decodeFogInfos } from "../../src/scene/world/lighting/tileFogInfoRecords";
import { environmentFogSection, fogInfo9236Record } from "../support/tileLightingFixture";

const [decoded] = decodeFogInfos([fogInfo9236Record()]);
const fogInfo = decoded!.record!;
const environmentRanges = decodeEnvironmentFogRanges({ sections: [environmentFogSection] })!;
const sourceLocation = fogInfo.sourceLocation;
const atDistance = (distance: number) => ({ x: sourceLocation.x + distance, y: sourceLocation.y, z: sourceLocation.z });

describe("decoded L2FogInfo of 20_21 export 9236", () => {
  it("reads AffectRange, FogRange1 to 5, the Colors fog colours by hour and the Location", () => {
    expect(decoded!.unresolvedReason).toBeNull();
    expect(fogInfo.affectRange).toEqual({ min: 3000, max: 4000 });
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

  it("reads the Env.int [FOG] StartRange and EndRange multipliers", () => {
    expect(environmentRanges).toEqual({ startRanges: [1, 1.5, 2, 2.5, 4], endRanges: [4, 5, 6, 7, 10] });
    expect(decodeEnvironmentFogRanges({ sections: [] })).toBeNull();
  });
});

describe("L2FogInfo selection by the Q12 answer", () => {
  it("matches the replay checker example: d 3500, hour 5.5, CR 4 gives start 1024, end 5096 and colour (107, 112, 108)", () => {
    const baseline = environmentFogBaseline(environmentRanges, 4);
    expect(baseline).toEqual({ colourBytes: [127, 127, 127], startSourceUnits: 2048, endSourceUnits: 8192 });
    expect(localFogListRecord([fogInfo], baseline, { hour: 5.5, terrainClipRange: 4, referencePosition: atDistance(3500) }))
      .toEqual({ colourBytes: [107, 112, 108], startSourceUnits: 1024, endSourceUnits: 5096 });
  });

  it("selects FogRange1 below CR 5, FogRange2 from 5, and FogRange5 from 8, on each side of a boundary", () => {
    expect([4.999, 5, 5.999, 6, 6.999, 7, 7.999, 8, 12].map(fogRangeSlot)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(environmentFogBaseline(environmentRanges, 8)).toMatchObject({ startSourceUnits: 4 * 2048, endSourceUnits: 10 * 2048 });
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
    const baseline = environmentFogBaseline(environmentRanges, 4);
    const both = localFogListRecord([near, near], baseline, { hour: 6, terrainClipRange: 4, referencePosition: atDistance(0) });
    expect(both).toEqual({ colourBytes: [107, 114, 97], startSourceUnits: 0, endSourceUnits: 2000 });
  });

  it("keeps the inputs the answer leaves open as named unresolved rows", () => {
    expect(FOG_CONSTANTS.terrainClipRange).toMatchObject({ status: "unknown", runtimeDefault: null });
    expect(FOG_CONSTANTS.fadeReferencePosition).toMatchObject({ status: "unknown", runtimeDefault: null });
    expect(FOG_CONSTANTS.localListProducer).toMatchObject({ status: "unknown", runtimeDefault: null });
    expect(FOG_CONSTANTS.rangeUnit).toMatchObject({ status: "confirmed-interlude", runtimeDefault: 2048 });
    expect(FOG_CONSTANTS.factor.provenance).toMatch(/^assumption:/);
  });
});
