import { describe, expect, it } from "vitest";
import { NativeTimeTablesFormatError, parseNativeTimeTables } from "../../src/environment/parseNativeTimeTables";
import { readDayNightLoadedTables } from "../support/dayNightFixtures";
import {
  shippedEnvironmentFogRanges, shippedEnvironmentSetup, shippedFogSpeedSeconds, shippedSkyBindings, timeTablesDocument,
} from "../support/worldTimeOfDayFixture";

type TimeTablesDocument = ReturnType<typeof timeTablesDocument>;

function changedDocument(change: (document: TimeTablesDocument) => void): TimeTablesDocument {
  const document = structuredClone(timeTablesDocument());
  change(document);
  return document;
}

function skyBoxTableOf(document: TimeTablesDocument, environmentTypePosition = 0) {
  return document.environmentTypes[environmentTypePosition]!.tables.find(table => table.section === "SkyBoxColor")!;
}

describe("parseNativeTimeTables", () => {
  it("reads every EnvType table of the DB-4 loaded tables back exactly, with the Env.int setup and sky bindings", () => {
    const parsed = parseNativeTimeTables(timeTablesDocument());
    expect(parsed.status).toBe("complete");
    if (parsed.status !== "complete") return;
    expect(parsed.timeTables.tables).toEqual(readDayNightLoadedTables());
    expect([...parsed.timeTables.tables.keys()]).toEqual([0, 1, 2, 3]);
    expect(parsed.timeTables.setup).toEqual(shippedEnvironmentSetup);
    expect(parsed.timeTables.skyBindings).toEqual(shippedSkyBindings);
    expect(parsed.timeTables.fogRanges).toEqual(shippedEnvironmentFogRanges);
    expect(parsed.timeTables.fogSpeedSeconds).toBe(shippedFogSpeedSeconds);
  });

  it("takes the GL2FogSpeed image value 15 when Env.int [FOG] has no FogSpeed key", () => {
    const document = changedDocument(changed => { delete (changed.setup.fog as { FogSpeed?: unknown }).FogSpeed; });
    const parsed = parseNativeTimeTables(document);
    expect(parsed.status === "complete" && parsed.timeTables.fogSpeedSeconds).toBe(15);
  });

  it("returns a missing Env.int [FOG] key as an incomplete export, never a default range", () => {
    const document = changedDocument(changed => {
      changed.setup.fog.endRanges[4]!.value = null as unknown as number;
      changed.unresolved = ["environment-setup-value-missing:EndRange5"];
      changed.typedComplete = false;
    });
    expect(parseNativeTimeTables(document)).toEqual({ status: "incomplete", unresolved: ["environment-setup-value-missing:EndRange5"] });
  });

  it("returns the export's own unresolved reasons instead of tables when it is not typed complete", () => {
    const document = changedDocument(changed => { changed.unresolved = ["environment-setup-value-missing:HAZERING"]; changed.typedComplete = false; });
    expect(parseNativeTimeTables(document)).toEqual({ status: "incomplete", unresolved: ["environment-setup-value-missing:HAZERING"] });
  });

  it.each([
    ["the older source-tables export", (document: TimeTablesDocument) => { (document as { kind: string }).kind = "native-environment-source-tables"; },
      /is not native-environment-time-tables schema 2/],
    ["a schema 1 export without the Env.int [FOG] ranges", (document: TimeTablesDocument) => { (document as { schemaVersion: number }).schemaVersion = 1; },
      /is not native-environment-time-tables schema 2/],
    ["a fog range list that is not five slots", (document: TimeTablesDocument) => { document.setup.fog.startRanges.pop(); },
      /setup fog StartRange lists 4 ranges instead of 5/],
    ["a typedComplete flag that disagrees with the reasons", (document: TimeTablesDocument) => { document.typedComplete = false; }, /typedComplete disagrees/],
    ["a channel outside a byte", (document: TimeTablesDocument) => { skyBoxTableOf(document).rows[0]!.values.R = 256; }, /SkyBoxColor row 0 R is not a byte/],
    ["a time that is not a number", (document: TimeTablesDocument) => { (skyBoxTableOf(document).rows[1]!.values as Record<string, unknown>).T = null; },
      /SkyBoxColor row 1 T is not a finite number/],
    ["a missing section", (document: TimeTablesDocument) => { document.environmentTypes[1]!.tables = document.environmentTypes[1]!.tables.filter(table => table.section !== "MoonScale"); },
      /timeenv1.int misses section MoonScale/],
    ["a section of the wrong kind", (document: TimeTablesDocument) => { skyBoxTableOf(document).kind = "hsv"; }, /SkyBoxColor is not a rgb table/],
    ["an EnvType declared twice", (document: TimeTablesDocument) => { document.environmentTypes[1]!.environmentType = 0; }, /EnvType 0 is declared twice/],
    ["a cloud binding without a CloudColor table", (document: TimeTablesDocument) => { document.setup.bindings.CLOUD[2]!.index = 4; },
      /CLOUD binding 4 has no CloudColor table/],
    ["a cloud count that differs from the bindings", (document: TimeTablesDocument) => { document.setup.bindings.NumCloudColor.value = 2; },
      /lists 3 CLOUD bindings for NumCloudColor 2/],
    ["an IsClock that is not a boolean", (document: TimeTablesDocument) => { document.setup.values.IsClock.value = 1; }, /IsClock is not a boolean/],
  ])("refuses %s", (_label, change, message) => {
    expect(() => parseNativeTimeTables(changedDocument(change))).toThrow(NativeTimeTablesFormatError);
    expect(() => parseNativeTimeTables(changedDocument(change))).toThrow(message);
  });
});
