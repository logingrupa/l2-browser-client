import { describe, expect, it } from "vitest";
import { decodeTileLighting } from "../../src/scene/world/lighting/decodeTileLighting";
import { bindStaticMeshHourlyVisibility } from "../../src/scene/world/lighting/staticMeshHourlyVisibility";
import { readConverterExpectations, staticMeshLightListArrays } from "../support/hourlyLightingInputsFixture";
import { fixtureNumber, readHourlyLightingFixtures } from "../support/hourlyLightingFixtures";
import { tileLightingArrays, tileLightingPayload } from "../support/tileLightingFixture";

const { instance, mesh } = readConverterExpectations().staticMesh;
const placedActor = { sourceActor: "20_21.StaticMeshActor1905", exportIndex: instance.actorExportIndex };
const unlistedActor = { sourceActor: "20_21.StaticMeshActor3190", exportIndex: 968 };
const visibilityRows = readHourlyLightingFixtures().fixtures.filter(row => row.surfaceType === "staticMesh" && row.status === "conditional-authored-input-fixture");

function lightLists(withLists: boolean) {
  const payload = tileLightingPayload([...tileLightingArrays(), ...(withLists ? staticMeshLightListArrays() : [])]);
  return decodeTileLighting(payload.assetRecord, payload.payloadBytes).hourly.staticMeshLightLists;
}

describe("bindStaticMeshHourlyVisibility", () => {
  it.each(visibilityRows.map(row => [row.hour, row] as const))("blends the G_12 vertex 0 hourly masks of StaticMeshActor1905 at hour %s as DB-7 does", (hour, row) => {
    const visibility = bindStaticMeshHourlyVisibility(lightLists(true));
    visibility.addChunk("chunk-0-0", [unlistedActor, placedActor]);
    const inspection = visibility.inspection(hour);
    expect(inspection).toMatchObject({ gap: null, placementCount: 2, placementsWithoutLightList: 1, placementsWithoutHourlyEntries: 0 });
    expect(inspection.placements).toHaveLength(1);
    const [placement] = inspection.placements;
    expect(placement).toMatchObject({ ...placedActor, entryCount: 8, vertexCount: mesh.vertexCount,
      entryBlend: { index: fixtureNumber(row.input, "previousTimeIndex"), nextIndex: fixtureNumber(row.input, "nextTimeIndex") }, vertexZeroVisibility: fixtureNumber(row.output, "shaderVisibilityFloat") });
    const counts = placement!.visibilityCounts;
    expect(counts.hidden + counts.partial + counts.full).toBe(mesh.vertexCount);
  });

  it("forgets the placements of a removed chunk", () => {
    const visibility = bindStaticMeshHourlyVisibility(lightLists(true));
    visibility.addChunk("chunk-0-0", [placedActor]);
    visibility.removeChunk("chunk-0-0");
    expect(visibility.inspection(12)).toMatchObject({ placementCount: 0, placements: [] });
  });

  it("names the gap for a payload converted without static mesh light lists", () => {
    const visibility = bindStaticMeshHourlyVisibility(lightLists(false));
    visibility.addChunk("chunk-0-0", [placedActor]);
    expect(visibility.inspection(12)).toEqual({ gap: "hourly-lighting-input-unstaged:SMLL.actorExportIndex", placementCount: 1, placementsWithoutLightList: 1,
      placementsWithoutHourlyEntries: 0, placements: [] });
  });
});
