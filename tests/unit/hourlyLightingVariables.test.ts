import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hourlyLightingVariables, staticMeshVisibilityProbeActor } from "../../src/runtime/hourlyLightingVariables";
import { attachTileLighting, type TileLightingRuntimeInspection } from "../../src/scene/world/lighting/attachTileLighting";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";
import { readConverterExpectations } from "../support/hourlyLightingInputsFixture";
import { fixtureNumber, fixtureNumbers, readHourlyLightingFixtures } from "../support/hourlyLightingFixtures";
import { provideDayNightTimeOfDay } from "../support/worldTimeOfDayFixture";
import { staticMeshPlacementSurfacesFixture } from "../support/staticMeshPlacementFixture";

vi.mock("../../src/scene/world/lighting/loadTileLighting", async () => {
  const { decodeTileLighting } = await import("../../src/scene/world/lighting/decodeTileLighting");
  const { tileLightingArrays, tileLightingPayload } = await import("../support/tileLightingFixture");
  const { staticMeshLightListArrays, terrainIntensityArrays, terrainLightMaskArrays } = await import("../support/hourlyLightingInputsFixture");
  const payload = tileLightingPayload([...tileLightingArrays(), ...terrainIntensityArrays(), ...terrainLightMaskArrays([0, 0, 0]), ...staticMeshLightListArrays()]);
  const model = decodeTileLighting(payload.assetRecord, payload.payloadBytes);
  return { loadTileLighting: async () => model };
});

const scenes: Scene[] = [];
afterEach(() => {
  for (const scene of scenes.splice(0)) { const engine = scene.getEngine(); scene.dispose(); engine.dispose(); }
});

function lightingTileManifest() {
  const lightingSha256 = "d".repeat(64);
  return parseNativeTileManifest({
    kind: "native-tile-runtime", schemaVersion: 1, tileId: "20_21", sourceMap: "maps/20_21.unr", sourceSha256: "e".repeat(64),
    frame: { terrainInfo: "20_21.TerrainInfo0", location: [0, 0, 0], terrainScale: [1, 1, 1] },
    anchor: { playerStart: "20_21.PlayerStart0", location: [0, 0, 0] },
    chunks: [{ chunkId: "chunk-0-0", manifest: `/l2/maps/${"1".repeat(64)}/native-tile-chunk-runtime/manifest.json`, manifestSha256: "1".repeat(64), manifestBytes: 100 }],
    resources: [{ kind: "lighting", manifest: `/l2/maps/${lightingSha256}/native-tile-lighting/asset.json`, manifestSha256: lightingSha256, manifestBytes: 100 }],
    gaps: [],
  });
}

function keyedTerrainMesh(scene: Scene): Mesh {
  const mesh = new Mesh("TerrainSector136 rectangle", scene);
  Object.assign(new VertexData(), { positions: Array.from({ length: 4 * 3 }, (_, index) => index), indices: [0, 1, 3] }).applyToMesh(mesh);
  mesh.metadata = { gltf: { extras: { nativeSampleGrid: { offset: [133, 128], quads: [1, 1] }, seamSampleKeys: [] } } };
  return mesh;
}

describe("hourly lighting developer variables", () => {
  it("reads the per-surface hourly lighting values of a restaged tile with their sources and statuses", async () => {
    const scene = new Scene(new NullEngine());
    scenes.push(scene);
    const timeOfDay = provideDayNightTimeOfDay(scene);
    const attached = await attachTileLighting(scene, lightingTileManifest(), null, new AbortController().signal);
    const { instance } = readConverterExpectations().staticMesh;
    await attached.addChunk({ chunkId: "chunk-0-0", bspChunk: null, terrainMeshes: [keyedTerrainMesh(scene)],
      staticMeshPlacements: [staticMeshPlacementSurfacesFixture(staticMeshVisibilityProbeActor, instance.actorExportIndex)] });
    const variables = hourlyLightingVariables(() => attached.inspection());
    const byName = (name: string) => {
      const found = variables.find(entry => entry.name === name);
      if (found === undefined) throw new Error(`No variable ${name}.`);
      return { value: found.value(), status: found.status, source: found.source ?? "" };
    };
    for (const entry of variables) expect(entry.source).toMatch(/DB-7 hourly-lighting-composition\.json f0a6eb0f/);
    expect(byName("lighting.terrain.rebuild")).toMatchObject({ value: "1 rebuilds, last at hour 12", status: "native" });
    const noonTerrainRow = readHourlyLightingFixtures().fixtures.find(row => row.surfaceType === "terrain" && row.hour === 12 && row.controlWord === "0x7f")!;
    expect(byName("lighting.terrain.probe")).toMatchObject({ status: "native", value: `(134, 129) intensity ${fixtureNumber(noonTerrainRow.input, "truncatedIntensity")}, `
      + `BGRA ${fixtureNumbers(noonTerrainRow.output, "vertexBGRA").join(", ")}` });
    expect(byName("lighting.terrain.drawn")).toMatchObject({ value: "not drawn (library-terrain-lighting-unported)", status: "unverified" });
    expect(byName("lighting.terrain.refreshThreshold")).toMatchObject({ value: "terrain-refresh-threshold-unresolved", status: "unverified" });
    expect(byName("lighting.bsp.slots")).toMatchObject({ value: "0: 4 of 8 | 1: 0 of 1 (every node counts as submitted: no visibility frame)", status: "unverified" });
    expect(byName("lighting.bsp.sunAffect")).toMatchObject({ status: "unverified",
      value: "0 of 0 lightmapped sections sun-affected this frame; others use slot 0 (every node counts as submitted: no visibility frame)" });
    const nodeSetReadings = (["every-node-culling-off", "visibility-walk"] as const).map(sunAffectNodeSet => {
      const readings = hourlyLightingVariables(() => ({ ...(attached.inspection() as TileLightingRuntimeInspection), sunAffectNodeSet }));
      return ["lighting.bsp.sunAffect", "lighting.bsp.slots"].map(name => readings.find(entry => entry.name === name)!.value().replace(/^.*\(/, "("));
    });
    expect(nodeSetReadings).toEqual([["(every node counts as submitted: culling off)", "(every node counts as submitted: culling off)"],
      ["(submitted nodes from the visibility walk)", "(submitted nodes from the visibility walk)"]]);
    expect(byName("lighting.bsp.textureSources")).toMatchObject({ value: "0: compressed child | 1: compressed child", status: "native" });
    const sourceReadings = hourlyLightingVariables(() => ({ ...(attached.inspection() as TileLightingRuntimeInspection), textureSources: [
      { texture: 0, source: "rebuild-not-requested" }, { texture: 1, source: "rebuild-pending" },
      { texture: 2, source: "gap", reason: "bsp-rebuild-composition-failed:worker stopped" }] }));
    expect(sourceReadings.find(entry => entry.name === "lighting.bsp.textureSources")!.value())
      .toBe("0: rebuild not requested | 1: rebuild pending | 2: gap bsp-rebuild-composition-failed:worker stopped");
    expect(byName("lighting.bsp.upload")).toMatchObject({ status: "unverified",
      value: "compressed child rgba8-mip0-cpu-decoded (lightmap-bc1-cpu-decode); rebuilt composite rgba8-single-mip-rebuilt" });
    expect(byName("lighting.staticMesh.ambient")).toMatchObject({ status: "native" });
    expect(byName("lighting.staticMesh.visibility")).toMatchObject({ status: "native",
      value: `1 of 1 placements hourly; ${staticMeshVisibilityProbeActor} vertex 0 0.5 (entries 3 > 4 at 0.5)` });
    expect(byName("lighting.actor.ambient")).toMatchObject({ status: "native" });
    expect(byName("lighting.device.finalShaderColour")).toMatchObject({ value: "d3d-programmable-composition", status: "unverified" });
    expect(byName("lighting.unresolved").value.split(", ")).toHaveLength(18);
    expect(byName("lighting.staticMesh.colour0").value).toMatch(
      /; composition inferred-d3d9 \(rm10-selected-shader, rm10-static-live-branch, rm10-live-device-state, rm10-final-gpu-colour\)$/);
    timeOfDay.dispose();
    attached.dispose();
  });

  it("reads the tile lighting once per task for every value and status, and again in the next task", async () => {
    const readLighting = vi.fn(() => ({ gap: "world-section-absent" }));
    const variables = hourlyLightingVariables(readLighting);
    for (const entry of variables) expect([entry.value(), entry.status]).toEqual(["world-section-absent", "unverified"]);
    expect(readLighting).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    variables[0]!.value();
    expect(readLighting).toHaveBeenCalledTimes(2);
  });
});
