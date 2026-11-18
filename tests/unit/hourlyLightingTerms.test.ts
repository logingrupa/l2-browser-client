import { describe, expect, it } from "vitest";
import { hourlyLightingUnresolvedItems } from "../../src/environment/model/nativeDrawLightingStates";
import { hourlyLightingTerms } from "../../src/scene/world/lighting/hourlyLightingTerms";
import { hourlyEnvironmentAt } from "../support/hourlyLightingInputsFixture";
import { fixtureNumber, fixtureNumbers, readHourlyLightingFixtures, type HourlyLightingFixtureRow } from "../support/hourlyLightingFixtures";

const { fixtures } = readHourlyLightingFixtures();
const fixtureHours = [0, 6, 12, 18];

function rowAt(hour: number, predicate: (row: HourlyLightingFixtureRow) => boolean): HourlyLightingFixtureRow {
  const row = fixtures.find(candidate => candidate.hour === hour && predicate(candidate));
  if (row === undefined) throw new Error(`No DB-7 fixture row at hour ${hour}.`);
  return row;
}

const ambientOf = (row: HourlyLightingFixtureRow) => [...fixtureNumbers(row.output, "ambientRGB"), fixtureNumber(row.output, "alpha")];

describe("hourlyLightingTerms", () => {
  it.each(fixtureHours)("reproduces the DB-7 static mesh, actor and BSP rebuild ambient rows at hour %s", hour => {
    const terms = hourlyLightingTerms(hourlyEnvironmentAt(hour));
    expect(terms.staticMesh.ambient).toMatchObject({ status: "resolved",
      value: ambientOf(rowAt(hour, row => row.surfaceType === "staticMesh" && row.status === "conditional-input-fixture")) });
    expect(terms.staticMesh.levelOfDetailSunTermAmbient).toMatchObject({ status: "resolved",
      value: ambientOf(rowAt(hour, row => row.surfaceType === "staticMesh" && row.status === "synthetic-arithmetic-fixture")) });
    expect(terms.actor.ambient).toMatchObject({ status: "resolved", value: ambientOf(rowAt(hour, row => row.surfaceType === "actor")) });
    expect(terms.bsp.rebuildAmbient).toEqual({ status: "resolved", value: fixtureNumbers(rowAt(hour, row => row.surfaceType === "BSP").output, "rebuildAmbientRGB") });
  });

  it("keeps BSP ambient out of the draw and names every device fact and DB-7 item it cannot claim", () => {
    const terms = hourlyLightingTerms(hourlyEnvironmentAt(12));
    expect(terms.bsp).toMatchObject({ rebuildAmbientBound: false, drawState: { deviceLighting: false, ambientSource: "baked-into-compressed-lightmap" } });
    expect(terms.terrainDrawState).toMatchObject({ deviceLighting: false, colourVertex: true, ambientSource: "baked-into-vertex-colour" });
    expect(terms.staticMesh.colour0).toMatchObject({ drawn: "per-placement-instance-colour", ineligibleReason: "ma-final-static-vertex" });
    expect(terms.staticMesh.colour1).toMatchObject({ drawn: "white", reasons: ["static-mesh-colour-selector-unresolved", "d3d-device-live-state"] });
    expect(terms.dynamicLights).toEqual({ applied: false, reasons: ["d3d-device-live-state", "ma-temporal-light-types"] });
    expect(terms.device.modulationOperation).toMatchObject({ imageDefaultOpcode: 5, status: "unresolved", reason: "d3d-device-live-state" });
    for (const fact of [terms.device.gl2Shader, terms.device.materialSourceBit, terms.device.lightList, terms.device.seamlessTerrainAmbient]) {
      expect(fact).toMatchObject({ status: "unresolved", reason: "d3d-device-live-state" });
    }
    expect(terms.device.finalShaderColour).toMatchObject({ status: "unresolved", reason: "d3d-programmable-composition" });
    expect(terms.unresolvedItems).toEqual(hourlyLightingUnresolvedItems.map(item => item.id));
    expect(terms.unresolvedItems).toHaveLength(13);
  });

  it("passes an environment type transition through as the named gap", () => {
    const terms = hourlyLightingTerms(hourlyEnvironmentAt(12, { oldType: 0, targetType: 3, weight: 0.5 }));
    expect(terms.actor.ambient).toMatchObject({ status: "unresolved", reason: "env-color-transition-unresolved" });
    expect(terms.staticMesh.levelOfDetailSunTermAmbient).toMatchObject({ status: "unresolved", reason: "env-color-transition-unresolved" });
    expect(terms.bsp.rebuildAmbient).toEqual({ status: "unresolved", reason: "env-color-transition-unresolved" });
  });
});
