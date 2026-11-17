import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { FOG_DISABLED, type LoadedNativeMaterial } from "../../src/materials/ue2/babylon/material";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { bindTileLighting } from "../../src/scene/world/lighting/bindTileLighting";
import { decodeTileLighting, type TileLightingModel } from "../../src/scene/world/lighting/decodeTileLighting";
import {
  planLightmapSections, sectionSunAffectUnresolvedReason, sortedSectionMixedSunAffectReason, type LightmapSectionChunk,
} from "../../src/scene/world/lighting/tileLightmapSections";
import type { NativeBspNodeRange, NativeBspSection } from "../../src/scene/world/nativeBspResources";
import type { WorldEnvironmentSample } from "../../src/scene/world/worldTimeOfDay";
import { fixtureNumber, readHourlyLightingFixtures } from "../support/hourlyLightingFixtures";
import { swatchTexturePng, syntheticSwatchProgram, textureImageFor } from "../support/materialProgramFixture";
import { hourSetSlotCount, sharedSectionArrays, sharedSectionShelteredNode, sharedSectionSunNode, tileLightingPayload } from "../support/tileLightingFixture";

const sections: NativeBspSection[] = [
  { primitive: 0, material: "Synthetic.Shared", unlit: false, lightmap: 0, nativeRenderSection: 0, translucent: false },
  { primitive: 1, material: "Synthetic.Indoor", unlit: false, lightmap: 1, nativeRenderSection: 1, translucent: false },
  { primitive: 2, material: "Synthetic.Unlit", unlit: true, lightmap: null, nativeRenderSection: 2, translucent: false },
];
const nodeRanges: NativeBspNodeRange[] = [
  { node: sharedSectionSunNode, primitive: 0, firstIndex: 0, indexCount: 3 }, { node: sharedSectionShelteredNode, primitive: 0, firstIndex: 3, indexCount: 3 },
  { node: 11, primitive: 1, firstIndex: 0, indexCount: 3 }, { node: 12, primitive: 2, firstIndex: 0, indexCount: 3 },
];
const primitiveIndices = [[0, 1, 2, 3, 4, 5], [0, 1, 2], [0, 1, 2]];
const primitiveVertexCounts = [6, 3, 3];
const sortedSections = sections.map(section => section.primitive === 0 ? { ...section, translucent: true } : section);
const scenes: Scene[] = [];

afterEach(() => {
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

function sharedSectionModel(sunAffect?: readonly number[]): TileLightingModel {
  const payload = tileLightingPayload(sharedSectionArrays(sunAffect));
  return decodeTileLighting(payload.assetRecord, payload.payloadBytes);
}

function sharedSectionChunk(chunkSections: readonly NativeBspSection[] = sections): LightmapSectionChunk {
  return { chunkId: "chunk-0-0", chunkOrdinal: 0, sections: chunkSections, nodeRanges, primitiveVertexCount: primitive => primitiveVertexCounts[primitive]!,
    primitiveIndices: primitive => primitiveIndices[primitive]! };
}

function environmentAtHour(hour: number): WorldEnvironmentSample {
  return { hour, hourSource: "server-time", oldType: 0, targetType: 0, weight: 0 };
}

function swatchMaterial(): LoadedNativeMaterial {
  const swatchImage = textureImageFor(swatchTexturePng());
  const program = parseMaterialProgram(JSON.parse(JSON.stringify(syntheticSwatchProgram(swatchImage))));
  return { materialId: "ef".repeat(32), program, plan: compileMaterialStagePlan(program),
    texturePixels: new Map([[swatchImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]) };
}

function sharedSectionMeshes(scene: Scene, materialId: string): Mesh[] {
  return sections.map((section, primitive) => {
    const mesh = new Mesh(section.material, scene);
    Object.assign(new VertexData(), { positions: Array.from({ length: primitiveVertexCounts[primitive]! * 3 }, (_, index) => index),
      indices: primitiveIndices[primitive], uvs: new Array(primitiveVertexCounts[primitive]! * 2).fill(0) }).applyToMesh(mesh);
    mesh.material = new Material(`${section.material} converted`, scene);
    mesh.material.metadata = { gltf: { extras: { nativeMaterialProgram: { directory: `native-materials/${materialId}`, programSha256: materialId } } } };
    return mesh;
  });
}

describe("planLightmapSections with a section of several node ranges", () => {
  it("carries the nodes of the section whose node range is sun-affected", () => {
    const [shared, indoor] = planLightmapSections(sharedSectionModel(), [sharedSectionChunk()]);
    expect(shared).toMatchObject({ kind: "lightmapped", lightmapTexture: 0, nativeRenderSection: 0, sunAffectedNodes: [sharedSectionSunNode] });
    expect(Array.from(shared?.kind === "lightmapped" ? shared.lightmapCoordinates : []))
      .toEqual([0.25, 0.5, 0.75, 0.5, 0.75, 0.75, 0.25, 0.75, 0.5, 0.75, 0.5, 0.875]);
    expect(indoor).toMatchObject({ kind: "lightmapped", sunAffectedNodes: [] });
  });

  it("names the section a gap when one of its node ranges has an unresolved sun affect", () => {
    expect(planLightmapSections(sharedSectionModel([1, -1, 0, 0]), [sharedSectionChunk()])[0])
      .toMatchObject({ kind: "gap", reason: sectionSunAffectUnresolvedReason });
  });

  it("names a sorted section a gap when its node ranges mix sun-affected and sheltered nodes", () => {
    expect(planLightmapSections(sharedSectionModel(), [sharedSectionChunk(sortedSections)])[0])
      .toEqual({ kind: "gap", chunkId: "chunk-0-0", primitive: 0, reason: sortedSectionMixedSunAffectReason });
    expect(sortedSectionMixedSunAffectReason).toBe("bsp-sorted-section-mixed-sun-affect");
  });

  it("keeps a sorted section lightmapped when all or none of its node ranges are sun-affected", () => {
    expect(planLightmapSections(sharedSectionModel([1, 1, 0, 0]), [sharedSectionChunk(sortedSections)])[0])
      .toMatchObject({ kind: "lightmapped", sunAffectedNodes: [sharedSectionSunNode, sharedSectionShelteredNode] });
    expect(planLightmapSections(sharedSectionModel([0, 0, 0, 0]), [sharedSectionChunk(sortedSections)])[0])
      .toMatchObject({ kind: "lightmapped", sunAffectedNodes: [] });
  });
});

describe("bindTileLighting sun affect per frame", () => {
  it("draws a shared section with the sun slot while its sun node is visible and slot 0 while only its sheltered node is", async () => {
    const scene = new Scene(new NullEngine());
    scenes.push(scene);
    const loaded = swatchMaterial(), meshes = sharedSectionMeshes(scene, loaded.materialId);
    const visibleNodes = new Set([sharedSectionSunNode, sharedSectionShelteredNode]);
    let environment = environmentAtHour(0);
    const binding = bindTileLighting({ scene, model: sharedSectionModel(), sessionSeed: 1, environment: () => environment, levelSeconds: () => 0,
      fog: () => FOG_DISABLED, nodeRangeVisible: (chunkOrdinal, node) => chunkOrdinal === 0 && visibleNodes.has(node), loadProgram: async () => loaded });
    await binding.addChunk({ chunkId: "chunk-0-0", chunkOrdinal: 0, sections, nodeRanges, meshes });
    const boundLightmapPages = () => meshes[0]!.material!.getActiveTextures().map(texture => texture.name).filter(name => name.startsWith("Tile lightmap page"));
    const bspRows = readHourlyLightingFixtures().fixtures.filter(row => row.surfaceType === "BSP");
    expect(bspRows.map(row => row.hour)).toEqual([0, 6, 12, 18]);
    const readSlots = (visible: readonly number[]) => bspRows.map(row => {
      visibleNodes.clear();
      for (const node of visible) visibleNodes.add(node);
      environment = environmentAtHour(row.hour);
      scene.onBeforeRenderObservable.notifyObservers(scene);
      const inspection = binding.inspection(), shared = inspection.sections[0]!;
      expect(boundLightmapPages()).toEqual([`Tile lightmap page ${shared.page}`]);
      return { page: shared.page, sunAffect: shared.sunAffect, sunAffectedSectionCount: inspection.sunAffectedSectionCount };
    });
    for (const row of bspRows) expect(fixtureNumber(row.input, "atlasCount")).toBe(hourSetSlotCount);
    expect(readSlots([sharedSectionSunNode, sharedSectionShelteredNode]))
      .toEqual(bspRows.map(row => ({ page: fixtureNumber(row.output, "selectedAtlasChild"), sunAffect: true, sunAffectedSectionCount: 1 })));
    expect(readSlots([sharedSectionShelteredNode])).toEqual(bspRows.map(() => ({ page: 0, sunAffect: false, sunAffectedSectionCount: 0 })));
    expect(readSlots([sharedSectionSunNode]).map(reading => reading.page)).toEqual([0, 2, 4, 6]);
    expect(binding.inspection().sections.map(section => section.sunAffect)).toEqual([true, false, null]);
    binding.dispose();
  });
});
