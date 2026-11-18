import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { FOG_DISABLED, type LoadedNativeMaterial } from "../../src/materials/ue2/babylon/material";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import type { TileVisibilityFrame } from "../../src/scene/world/bspVisibility/core/tileVisibilityFrame";
import { emptyZoneSet } from "../../src/scene/world/bspVisibility/core/zoneSet";
import { bindTileLighting } from "../../src/scene/world/lighting/bindTileLighting";
import { decodeTileLighting, type TileLightingModel } from "../../src/scene/world/lighting/decodeTileLighting";
import { visibilityNodeRangeMissingReason, type TileLightingVisibility } from "../../src/scene/world/lighting/tileLightingVisibility";
import {
  sectionSunAffectUnresolvedReason, sortedSectionMixedSunAffectReason, type LightmapSectionChunk,
} from "../../src/scene/world/lighting/tileLightmapSections";
import type { NativeBspNodeRange, NativeBspSection } from "../../src/scene/world/nativeBspResources";
import type { WorldEnvironmentSample } from "../../src/scene/world/worldTimeOfDay";
import { fixtureNumber, readHourlyLightingFixtures } from "../support/hourlyLightingFixtures";
import { inThreadLightmapRebuild, planSectionsWithoutComposition } from "../support/lightmapRebuildFixture";
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

interface VisibilityStub {
  readonly visibility: TileLightingVisibility;
  readonly visibleNodes: Set<number>;
  readonly listedNodes: Set<number>;
  frame: TileVisibilityFrame | null;
}

afterEach(() => {
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

function sharedSectionModel(sunAffect?: readonly number[], chunkOrdinal = 0): TileLightingModel {
  const payload = tileLightingPayload(sharedSectionArrays(sunAffect, chunkOrdinal));
  return decodeTileLighting(payload.assetRecord, payload.payloadBytes);
}

function sharedSectionChunk(chunkSections: readonly NativeBspSection[] = sections): LightmapSectionChunk {
  return { chunkId: "chunk-0-0", chunkOrdinal: 0, sections: chunkSections, nodeRanges, primitiveVertexCount: primitive => primitiveVertexCounts[primitive]!,
    primitiveIndices: primitive => primitiveIndices[primitive]! };
}

function environmentAtHour(hour: number): WorldEnvironmentSample {
  return { hour, hourSource: "server-time", oldType: 0, targetType: 0, weight: 0 };
}

function visibilityFrame(culling: boolean): TileVisibilityFrame {
  return { culling, cameraLeaf: 0, cameraZone: 0, outdoorView: false, visibleZones: emptyZoneSet, visibleZoneCount: 0, openedPortalCount: 0, skyZones: [],
    sectionVisible: new Uint8Array(0), rangeVisible: new Uint8Array(0), memberVisible: new Uint8Array(0), terrainVisible: true, translucentOrder: new Map() };
}

function visibilityStub(listedChunkOrdinal: number): VisibilityStub {
  const stub: VisibilityStub = { visibleNodes: new Set(), listedNodes: new Set([sharedSectionSunNode, sharedSectionShelteredNode, 11, 12]),
    frame: visibilityFrame(true), visibility: {
      frame: () => stub.frame,
      nodeRangeVisible: (chunkOrdinal, node) => stub.frame === null || (chunkOrdinal === listedChunkOrdinal && stub.visibleNodes.has(node)),
      nodeRangeListed: (chunkOrdinal, node) => chunkOrdinal === listedChunkOrdinal && stub.listedNodes.has(node),
    } };
  return stub;
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

async function bindSharedSection(chunkOrdinal: number, visibility: TileLightingVisibility | null) {
  const scene = new Scene(new NullEngine());
  scenes.push(scene);
  const loaded = swatchMaterial(), meshes = sharedSectionMeshes(scene, loaded.materialId);
  let hour = 0;
  const binding = bindTileLighting({ scene, model: sharedSectionModel(undefined, chunkOrdinal), sessionSeed: 1, environment: () => environmentAtHour(hour),
    levelSeconds: () => 0, fog: () => FOG_DISABLED, visibility, loadProgram: async () => loaded, ...inThreadLightmapRebuild() });
  await binding.addChunk({ chunkId: `chunk-${chunkOrdinal}`, chunkOrdinal, sections, nodeRanges, meshes });
  const renderAtHour = (nextHour: number) => {
    hour = nextHour;
    scene.onBeforeRenderObservable.notifyObservers(scene);
  };
  return { binding, meshes, renderAtHour };
}

describe("planLightmapSections with a section of several node ranges", () => {
  it("carries the nodes of the section whose node range is sun-affected", () => {
    const [shared, indoor] = planSectionsWithoutComposition(sharedSectionModel(), [sharedSectionChunk()]);
    expect(shared).toMatchObject({ kind: "lightmapped", lightmapTexture: 0, nativeRenderSection: 0, sunAffectedNodes: [sharedSectionSunNode] });
    expect(Array.from(shared?.kind === "lightmapped" ? shared.lightmapCoordinates : []))
      .toEqual([0.25, 0.5, 0.75, 0.5, 0.75, 0.75, 0.25, 0.75, 0.5, 0.75, 0.5, 0.875]);
    expect(indoor).toMatchObject({ kind: "lightmapped", sunAffectedNodes: [] });
  });

  it("names the section a gap when one of its node ranges has an unresolved sun affect", () => {
    expect(planSectionsWithoutComposition(sharedSectionModel([1, -1, 0, 0]), [sharedSectionChunk()])[0])
      .toMatchObject({ kind: "gap", reason: sectionSunAffectUnresolvedReason });
  });

  it("names a sorted section a gap when its node ranges mix sun-affected and sheltered nodes", () => {
    expect(planSectionsWithoutComposition(sharedSectionModel(), [sharedSectionChunk(sortedSections)])[0])
      .toEqual({ kind: "gap", chunkId: "chunk-0-0", primitive: 0, reason: sortedSectionMixedSunAffectReason });
    expect(sortedSectionMixedSunAffectReason).toBe("bsp-sorted-section-mixed-sun-affect");
  });

  it("keeps a sorted section lightmapped when all or none of its node ranges are sun-affected", () => {
    expect(planSectionsWithoutComposition(sharedSectionModel([1, 1, 0, 0]), [sharedSectionChunk(sortedSections)])[0])
      .toMatchObject({ kind: "lightmapped", sunAffectedNodes: [sharedSectionSunNode, sharedSectionShelteredNode] });
    expect(planSectionsWithoutComposition(sharedSectionModel([0, 0, 0, 0]), [sharedSectionChunk(sortedSections)])[0])
      .toMatchObject({ kind: "lightmapped", sunAffectedNodes: [] });
  });
});

describe("bindTileLighting sun affect per frame", () => {
  it.each([0, 3])("draws a shared section of chunk ordinal %i with the sun slot while its sun node is visible and slot 0 while only its sheltered node is",
    async chunkOrdinal => {
      const stub = visibilityStub(chunkOrdinal);
      const { binding, meshes, renderAtHour } = await bindSharedSection(chunkOrdinal, stub.visibility);
      const boundLightmapPages = () => meshes[0]!.material!.getActiveTextures().map(texture => texture.name).filter(name => name.startsWith("Tile lightmap page"));
      const bspRows = readHourlyLightingFixtures().fixtures.filter(row => row.surfaceType === "BSP");
      expect(bspRows.map(row => row.hour)).toEqual([0, 6, 12, 18]);
      for (const row of bspRows) expect(fixtureNumber(row.input, "atlasCount")).toBe(hourSetSlotCount);
      const readSlots = (visible: readonly number[]) => bspRows.map(row => {
        stub.visibleNodes.clear();
        for (const node of visible) stub.visibleNodes.add(node);
        renderAtHour(row.hour);
        const inspection = binding.inspection(), shared = inspection.sections[0]!;
        expect(boundLightmapPages()).toEqual([`Tile lightmap page ${shared.page}`]);
        return { page: shared.page, sunAffect: shared.sunAffect, sunAffectedSectionCount: inspection.sunAffectedSectionCount };
      });
      expect(readSlots([sharedSectionSunNode, sharedSectionShelteredNode]))
        .toEqual(bspRows.map(row => ({ page: fixtureNumber(row.output, "selectedAtlasChild"), sunAffect: true, sunAffectedSectionCount: 1 })));
      expect(readSlots([sharedSectionShelteredNode])).toEqual(bspRows.map(() => ({ page: 0, sunAffect: false, sunAffectedSectionCount: 0 })));
      expect(readSlots([sharedSectionSunNode]).map(reading => reading.page)).toEqual([0, 2, 4, 6]);
      expect(binding.inspection().sections.map(section => section.sunAffect)).toEqual([true, false, null]);
      binding.dispose();
    });

  it("names the node set the sun choice used: the visibility walk, every node with culling off, or every node without a frame", async () => {
    const stub = visibilityStub(0);
    stub.visibleNodes.add(sharedSectionShelteredNode);
    const { binding } = await bindSharedSection(0, stub.visibility);
    const reading = () => [binding.inspection().sunAffectNodeSet, binding.inspection().sections[0]!.sunAffect];
    expect(reading()).toEqual(["visibility-walk", false]);
    stub.frame = visibilityFrame(false);
    expect(reading()[0]).toBe("every-node-culling-off");
    stub.frame = null;
    expect(reading()).toEqual(["every-node-no-frame", true]);
    binding.dispose();
    const withoutVisibility = await bindSharedSection(0, null);
    expect([withoutVisibility.binding.inspection().sunAffectNodeSet, withoutVisibility.binding.inspection().sections[0]!.sunAffect])
      .toEqual(["every-node-no-frame", true]);
    withoutVisibility.binding.dispose();
  });

  it("names a section a gap when the visibility model lists no range of one of its sun-affected nodes in its chunk", async () => {
    const stub = visibilityStub(0);
    stub.listedNodes.delete(sharedSectionSunNode);
    const { binding } = await bindSharedSection(0, stub.visibility);
    expect(binding.inspection().sections[0]).toMatchObject({ lighting: "gap", status: "lighting-gap", sunAffect: null, page: null,
      reasons: [`${visibilityNodeRangeMissingReason}:${sharedSectionSunNode}`] });
    expect(visibilityNodeRangeMissingReason).toBe("bsp-visibility-node-range-missing");
    expect(binding.inspection().sections[1]).toMatchObject({ lighting: "lightmapped", status: "library-compiled" });
    binding.dispose();
  });
});
