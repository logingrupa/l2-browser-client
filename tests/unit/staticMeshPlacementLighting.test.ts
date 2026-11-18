import { afterEach, describe, expect, it, vi } from "vitest";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import type { NativePlane } from "../../src/environment/model/nativePlane";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { FOG_DISABLED, instanceColourAttributeName } from "../../src/materials/ue2/babylon/material";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import {
  bindStaticMeshLibraryMaterials, type StaticMeshHourlyLightingFrame, type StaticMeshLibraryBinding,
} from "../../src/scene/world/lighting/bindStaticMeshLibraryMaterials";
import type { StaticMeshLightList } from "../../src/scene/world/lighting/decodeHourlyLightingInputs";
import { parseStaticMeshVertexStreams, type StaticMeshVertexStreams } from "../../src/scene/world/lighting/loadStaticMeshVertexStreams";
import type { NativeTileChunkPlacement } from "../../src/scene/world/nativeTileChunkManifest";
import { parseStaticMeshMaterialsListing } from "../../src/scene/world/staticMeshLibraryMaterials";
import { swatchTexturePng, syntheticSwatchProgram, textureImageFor } from "../support/materialProgramFixture";
import { maskBytes, readStaticMeshLightingFixtures, type StaticMeshLightingFixture } from "../support/staticMeshLightingFixtures";
import { staticMeshPlacementSurfacesFixture } from "../support/staticMeshPlacementFixture";

const { pillar, fixtures } = readStaticMeshLightingFixtures();
const programSha256 = "a".repeat(64);
const sidecarSha256 = "d".repeat(64);
const slotObject = "cruma_s.f_04_material";
const swatchImage = textureImageFor(swatchTexturePng());
const parsedListing = parseStaticMeshMaterialsListing({ kind: "native-tile-static-mesh-materials", schemaVersion: 1, tileId: "20_21",
  materials: [{ sourceObject: slotObject, program: { directory: `native-materials/${programSha256}`, programSha256 }, rootPorted: true, gapReasons: [] }],
  files: { [`${programSha256}/program.json`]: { sha256: programSha256, bytes: 10 } } }, "20_21");
const sceneAxisOfSourceAxis = [0, 2, 1] as const;
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); });

function sceneMatrixOf(nativeMatrix: readonly number[]): number[] {
  const scene = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) scene[row * 4 + column] = nativeMatrix[sceneAxisOfSourceAxis[row]! * 4 + sceneAxisOfSourceAxis[column]!]!;
  }
  return scene;
}

function pillarStreams(): StaticMeshVertexStreams {
  return parseStaticMeshVertexStreams({ kind: "native-static-mesh-vertex-streams", schemaVersion: 2, sourceObject: pillar.meshObject,
    nativeVertexCount: pillar.vertexCount, nativeNormals: pillar.nativeNormals, primary: { bgraHex: pillar.primaryColoursHex, revision: 0 },
    alternate: { bgraHex: pillar.alternateColoursHex, revision: 0 }, selector: null, selectorGapReason: "static-mesh-colour-selector-unresolved",
    primitives: [{ mesh: 0, primitive: 0, nativeVertices: Array.from({ length: pillar.vertexCount }, (_, vertex) => vertex) }] });
}

function pillarList(fields: Partial<StaticMeshLightList> = {}): StaticMeshLightList {
  return { actorExportIndex: pillar.actorExportIndex, instanceExportIndex: pillar.instanceExportIndex, vertexCount: pillar.vertexCount,
    sunAffect: { status: "staged", value: 1 }, ordinaryLightVertexMask: maskBytes(pillar.ordinaryMasks[0]!.maskHex),
    hourlyMasks: pillar.hourlyMasks.map(mask => ({ light: mask.light, visibility: maskBytes(mask.maskHex) })), ...fields };
}

const sunOnlyPillarList = () => pillarList({ ordinaryLightVertexMask: new Uint8Array(Math.ceil(pillar.vertexCount / 8)) });

function frameOf(fixture: StaticMeshLightingFixture): StaticMeshHourlyLightingFrame {
  return { status: "resolved", ambient: [fixture.ambientRGB[0] >> 1, fixture.ambientRGB[1] >> 1, fixture.ambientRGB[2] >> 1, 255],
    sun: { hour: fixture.hour, lightDirection: { x: fixture.direction[0], y: fixture.direction[1], z: fixture.direction[2] },
      staticSunPlane: fixture.sunPlane as NativePlane } };
}

function pillarMesh(scene: Scene, name: string): Mesh {
  const material = new PBRMaterial(`${name} slot`, scene);
  material.metadata = { gltf: { extras: { nativeSectionIndex: 0, nativeSourceReference: slotObject } } };
  const mesh = new Mesh(name, scene);
  Object.assign(new VertexData(), { positions: Array.from({ length: pillar.vertexCount * 3 }, (_, index) => index),
    uvs: Array.from({ length: pillar.vertexCount * 2 }, () => 0), indices: Array.from({ length: pillar.vertexCount }, (_, index) => index) }).applyToMesh(mesh);
  mesh.material = material;
  mesh._internalMetadata = { gltf: { pointers: ["/meshes/0/primitives/0"] } };
  return mesh;
}

function loadedProgram(materialId: string): LoadedNativeMaterial {
  const program = parseMaterialProgram(JSON.parse(JSON.stringify(syntheticSwatchProgram(swatchImage))));
  return { materialId, program, plan: compileMaterialStagePlan(program),
    texturePixels: new Map([[swatchImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]) };
}

interface PillarBinding {
  readonly scene: Scene;
  readonly binding: StaticMeshLibraryBinding;
  readonly frame: { current: StaticMeshHourlyLightingFrame };
  readonly loadVertexStreams: ReturnType<typeof vi.fn>;
}

function pillarBinding(list: StaticMeshLightList, fixture: StaticMeshLightingFixture = fixtures[0]!): PillarBinding {
  const engine = new NullEngine(), scene = new Scene(engine);
  const frame = { current: frameOf(fixture) };
  const loadVertexStreams = vi.fn(async () => pillarStreams());
  const binding = bindStaticMeshLibraryMaterials({ scene, load: { listing: parsedListing, gap: null }, sessionSeed: 3,
    uniforms: () => ({ levelSeconds: 0, hour: fixture.hour, environmentType: 0, fog: FOG_DISABLED }), loadProgram: async materialId => loadedProgram(materialId),
    lightLists: { status: "staged", value: new Map([[list.actorExportIndex, list]]) }, hourlyLighting: () => frame.current, loadVertexStreams });
  releases.push(() => { binding.dispose(); scene.dispose(); engine.dispose(); });
  return { scene, binding, frame, loadVertexStreams };
}

function pillarPlacement(fields: Partial<NativeTileChunkPlacement> = {}) {
  return { sourceActor: "20_21.StaticMeshActor2067", exportIndex: pillar.actorExportIndex,
    fields: { matrix: sceneMatrixOf(fixtures[0]!.matrix), vertexStreams: { status: "pinned", file: `/l2/static-mesh-vertex-streams/${sidecarSha256}/vertex-streams.json`,
      sha256: sidecarSha256, bytes: 4096 }, ...fields } as Partial<NativeTileChunkPlacement> };
}

function instanceColourBytes(mesh: Mesh, vertex: number): number[] {
  const data = mesh.geometry!.getVertexBuffer(instanceColourAttributeName)!.getWrapperBuffer().getData() as Uint8Array;
  return Array.from(data.subarray(vertex * 4, vertex * 4 + 4));
}

const fixtureRgb = (fixture: StaticMeshLightingFixture, position: number) => {
  const bgra = fixture.instanceBGRA[position]!;
  return [bgra[2], bgra[1], bgra[0]];
};

describe("static mesh hourly instance colour drawn per placement (RM-10)", () => {
  it("keeps the real RM-10 pillar unlit because ordinary light 40 sets mask bits, and names the reason", async () => {
    const f = pillarBinding(pillarList());
    const mesh = pillarMesh(f.scene, "pillar");
    const template = mesh.geometry;
    const { sourceActor, exportIndex, fields } = pillarPlacement();
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(sourceActor, exportIndex, [mesh], fields)]);
    expect(f.binding.inspection().lighting).toMatchObject({ litPlacements: 0, unlitPlacementReasons: { "rm10-all-light-effects": 1 } });
    expect(mesh.geometry).toBe(template);
    expect(f.loadVertexStreams).not.toHaveBeenCalled();
  });

  it("writes the RM-10 instance colours of v0 and v4 into a sun-only placement's own COLOR0 and draws it vertex-lit with the halved ambient", async () => {
    const f = pillarBinding(sunOnlyPillarList());
    const mesh = pillarMesh(f.scene, "pillar");
    const { sourceActor, exportIndex, fields } = pillarPlacement();
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(sourceActor, exportIndex, [mesh], fields)]);
    const fixture = fixtures[0]!;
    fixture.vertexIndices.forEach((vertex, position) => expect(instanceColourBytes(mesh, vertex)).toEqual([...fixtureRgb(fixture, position), 255]));
    expect(f.binding.inspection().lighting).toMatchObject({ litPlacements: 1, litMeshes: 1, unlitPlacementReasons: {}, ambient: [60, 60, 60, 255],
      probes: [{ exportIndex: pillar.actorExportIndex, vertexZeroRgb: fixtureRgb(fixture, 0) }] });
    expect(mesh.material?.name).toBe("UE2 material: SyntheticSwatch.SwatchFinalBlend");
    const ambient = f.binding.inspection().lighting.ambient!;
    const modulate2x = fixture.vertexIndices.map(vertex => Math.min(255, 2 * Math.min(255, instanceColourBytes(mesh, vertex)[0]! + ambient[0])));
    expect(modulate2x).toEqual([130, 208]);
  });

  it("rewrites COLOR0 only when the environment reports lightingDirty", async () => {
    const f = pillarBinding(sunOnlyPillarList());
    const mesh = pillarMesh(f.scene, "pillar");
    const { sourceActor, exportIndex, fields } = pillarPlacement();
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(sourceActor, exportIndex, [mesh], fields)]);
    f.frame.current = { status: "resolved", ambient: [60, 60, 60, 255], sun: { hour: 12.3, lightDirection: { x: 0, y: 0, z: 1 }, staticSunPlane: [1, 1, 1, 1] } };
    f.binding.update(false);
    expect(instanceColourBytes(mesh, 0)).toEqual([...fixtureRgb(fixtures[0]!, 0), 255]);
    f.frame.current = frameOf(fixtures[1]!);
    f.binding.update(true);
    expect(instanceColourBytes(mesh, 4)).toEqual([...fixtureRgb(fixtures[1]!, 1), 255]);
    expect(f.binding.inspection().lighting).toMatchObject({ rebuildCount: 2, lastRebuildHour: fixtures[1]!.hour });
  });

  it("gives the lit clone its own geometry over the template buffers, so disposing it leaves the template and a sibling drawing", async () => {
    const f = pillarBinding(sunOnlyPillarList());
    const template = pillarMesh(f.scene, "pillar template");
    const lit = template.clone("pillar lit"), sibling = template.clone("pillar sibling");
    lit._internalMetadata = template._internalMetadata;
    const { sourceActor, exportIndex, fields } = pillarPlacement();
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(sourceActor, exportIndex, [lit], fields)]);
    expect(lit.geometry).not.toBe(template.geometry);
    expect(sibling.geometry).toBe(template.geometry);
    expect(lit.geometry!.getVertexBuffer(VertexBuffer.PositionKind)!.getWrapperBuffer()).toBe(template.geometry!.getVertexBuffer(VertexBuffer.PositionKind)!.getWrapperBuffer());
    expect(template.geometry!.isVerticesDataPresent(instanceColourAttributeName)).toBe(false);
    lit.dispose();
    expect(template.geometry!.getVertexBuffer(VertexBuffer.PositionKind)!.getWrapperBuffer().getBuffer()).not.toBeNull();
    expect(sibling.geometry!.getTotalVertices()).toBe(pillar.vertexCount);
    expect(sibling.geometry!.getIndices()).toHaveLength(pillar.vertexCount);
  });

  it.each<[string, StaticMeshLightList, Partial<NativeTileChunkPlacement>, string]>([
    ["an actor without bSunAffect", pillarList({ ordinaryLightVertexMask: new Uint8Array(5), sunAffect: { status: "staged", value: 0 } }), {},
      "rm10-static-ambient-fallback-producer"],
    ["a list without hourly entries", pillarList({ ordinaryLightVertexMask: new Uint8Array(5), hourlyMasks: [] }), {}, "rm10-static-ambient-fallback-producer"],
    ["a payload without SMLL.sunAffect", pillarList({ ordinaryLightVertexMask: new Uint8Array(5),
      sunAffect: { status: "unstaged", reason: "hourly-lighting-input-unstaged:SMLL.sunAffect" } }), {}, "hourly-lighting-input-unstaged:SMLL.sunAffect"],
    ["a model without a vertex stream sidecar", pillarList({ ordinaryLightVertexMask: new Uint8Array(5) }),
      { vertexStreams: { status: "gap", reason: "static-mesh-vertex-streams-unstaged" } }, "static-mesh-vertex-streams-unstaged"],
    ["a non-uniform DrawScale3D", pillarList({ ordinaryLightVertexMask: new Uint8Array(5) }),
      { matrix: [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, "static-mesh-normal-transform-unresolved"],
    ["a sidecar whose vertex count differs from the light list", pillarList({ ordinaryLightVertexMask: new Uint8Array(5), vertexCount: 35 }), {},
      "static-mesh-vertex-streams-count-mismatch"],
  ])("leaves %s unlit with a named reason", async (_, list, placementFields, reason) => {
    const f = pillarBinding(list);
    const mesh = pillarMesh(f.scene, "pillar");
    const { sourceActor, exportIndex, fields } = pillarPlacement(placementFields);
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(sourceActor, exportIndex, [mesh], fields)]);
    expect(f.binding.inspection().lighting).toMatchObject({ litPlacements: 0, unlitPlacementReasons: { [reason]: 1 } });
  });
});
