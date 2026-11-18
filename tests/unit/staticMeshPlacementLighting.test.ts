import { afterEach, describe, expect, it, vi } from "vitest";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { staticMeshDrawnComposition } from "../../src/environment/model/nativeDrawLightingStates";
import type { NativePlane } from "../../src/environment/model/nativePlane";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { FOG_DISABLED, instanceColourAttributeName } from "../../src/materials/ue2/babylon/material";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import {
  bindStaticMeshLibraryMaterials, type StaticMeshHourlyLightingFrame, type StaticMeshLibraryBinding,
} from "../../src/scene/world/lighting/bindStaticMeshLibraryMaterials";
import type { StaticMeshLightList } from "../../src/scene/world/lighting/decodeHourlyLightingInputs";
import type { StaticMeshActorAmbientResult } from "../../src/scene/world/lighting/decodeStaticMeshActorAmbients";
import type { StagedLightingInput } from "../../src/scene/world/lighting/stagedLightingInput";
import { parseStaticMeshVertexStreams, type StaticMeshVertexStreams } from "../../src/scene/world/lighting/loadStaticMeshVertexStreams";
import type { NativeTileChunkPlacement } from "../../src/scene/world/nativeTileChunkManifest";
import { parseStaticMeshMaterialsListing } from "../../src/scene/world/staticMeshLibraryMaterials";
import { swatchTexturePng, syntheticSwatchProgram, textureImageFor } from "../support/materialProgramFixture";
import { maskBytes, readStaticMeshLightingFixtures, type StaticMeshLightingFixture } from "../support/staticMeshLightingFixtures";
import { rebuildEnvironmentAtHourSix } from "../support/lightmapRebuildFixture";
import { integratedFixtureOf, ordinaryFixtureLightRecord, readOrdinaryStaticLightingFixtures, stagedOrdinarySubsetOf } from "../support/ordinaryStaticLightingFixtures";
import { staticMeshOrdinaryLightRecords, type StaticMeshOrdinaryLightRecords } from "../../src/scene/world/lighting/staticMeshOrdinaryLights";
import { staticMeshPlacementSurfacesFixture } from "../support/staticMeshPlacementFixture";
import { readStaticMeshAmbientFixtures, staticMeshAmbientFixtureOf, type StaticMeshAmbientFixture } from "../support/staticMeshAmbientFixtures";

const { pillar, fixtures } = readStaticMeshLightingFixtures();
const ordinaryPillarCase = integratedFixtureOf(readOrdinaryStaticLightingFixtures(), pillar.actorExportIndex);
const spotlightCase = integratedFixtureOf(readOrdinaryStaticLightingFixtures(), 1219);
const pillarPositionsUnreadByDarkLights = new Array<number>(pillar.vertexCount * 3).fill(0);
const levelInfo = { exportIndex: 1, fields: new Map([["Brightness", { provenance: "class-default", value: 1 }]]) };
const programSha256 = "a".repeat(64);
const sidecarSha256 = "d".repeat(64);
const slotObject = "cruma_s.f_04_material";
const swatchImage = textureImageFor(swatchTexturePng());
const parsedListing = parseStaticMeshMaterialsListing({ kind: "native-tile-static-mesh-materials", schemaVersion: 1, tileId: "20_21",
  materials: [{ sourceObject: slotObject, program: { directory: `native-materials/${programSha256}`, programSha256 }, rootPorted: true, gapReasons: [] }],
  files: { [`${programSha256}/program.json`]: { sha256: programSha256, bytes: 10 } } }, "20_21");
const releases: (() => void)[] = [];
const rm20 = readStaticMeshAmbientFixtures();
type ActorAmbients = StagedLightingInput<ReadonlyMap<number, StaticMeshActorAmbientResult>>;
const actorAmbientsOf = (entries: readonly (readonly [number, StaticMeshActorAmbientResult])[]): ActorAmbients => ({ status: "staged", value: new Map(entries) });
const sunAffectedPillar = actorAmbientsOf([[pillar.actorExportIndex, { status: "resolved", value: { runtimeSunAffect: true, renderDataAmbient: [0, 0, 0, 0] } }]]);
const rm20ActorAmbient = (fixture: StaticMeshAmbientFixture): StaticMeshActorAmbientResult =>
  ({ status: "resolved", value: { runtimeSunAffect: fixture.runtimeSunAffect, renderDataAmbient: fixture.cachedAmbientBGRA } });
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); });

function pillarStreams(): StaticMeshVertexStreams {
  return parseStaticMeshVertexStreams({ kind: "native-static-mesh-vertex-streams", schemaVersion: 3, sourceObject: pillar.meshObject,
    nativeVertexCount: pillar.vertexCount, nativePositions: pillarPositionsUnreadByDarkLights, nativeNormals: pillar.nativeNormals, primary: { bgraHex: pillar.primaryColoursHex, revision: 0 },
    alternate: { bgraHex: pillar.alternateColoursHex, revision: 0 }, selector: null, selectorGapReason: "static-mesh-colour-selector-unresolved",
    primitives: [{ mesh: 0, primitive: 0, nativeVertices: Array.from({ length: pillar.vertexCount }, (_, vertex) => vertex) }] });
}

function pillarList(fields: Partial<StaticMeshLightList> = {}): StaticMeshLightList {
  return { actorExportIndex: pillar.actorExportIndex, instanceExportIndex: pillar.instanceExportIndex, vertexCount: pillar.vertexCount,
    ordinaryInputs: { status: "staged", value: { scaleGlow: ordinaryPillarCase.scaleGlow, localToWorld: Float32Array.from(ordinaryPillarCase.localToWorld) } },
    ordinaryMasks: pillar.ordinaryMasks.map(mask => ({ light: mask.light, visibility: maskBytes(mask.maskHex) })),
    hourlyMasks: pillar.hourlyMasks.map(mask => ({ light: mask.light, visibility: maskBytes(mask.maskHex) })), ...fields };
}

const sunOnlyPillarList = () => pillarList({ ordinaryMasks: [] });

function lightRecords(lights = ordinaryPillarCase.ordinaryLights): StaticMeshOrdinaryLightRecords {
  return staticMeshOrdinaryLightRecords({ levelInfos: [levelInfo], lights: lights.map(light => ordinaryFixtureLightRecord(light)) });
}

function frameOf(fixture: StaticMeshLightingFixture): StaticMeshHourlyLightingFrame {
  return { status: "resolved", ambient: [fixture.ambientRGB[0] >> 1, fixture.ambientRGB[1] >> 1, fixture.ambientRGB[2] >> 1, 255],
    sun: { hour: fixture.hour, lightDirection: { x: fixture.direction[0], y: fixture.direction[1], z: fixture.direction[2] },
      staticSunPlane: fixture.sunPlane as NativePlane }, lightEnvironment: { ...rebuildEnvironmentAtHourSix, hour: fixture.hour } };
}

function pillarMesh(scene: Scene, name: string, vertexCount = pillar.vertexCount): Mesh {
  const material = new PBRMaterial(`${name} slot`, scene);
  material.metadata = { gltf: { extras: { nativeSectionIndex: 0, nativeSourceReference: slotObject } } };
  const mesh = new Mesh(name, scene);
  Object.assign(new VertexData(), { positions: Array.from({ length: vertexCount * 3 }, (_, index) => index),
    uvs: Array.from({ length: vertexCount * 2 }, () => 0), indices: Uint32Array.from({ length: vertexCount }, (_, index) => index) }).applyToMesh(mesh);
  mesh.material = material;
  mesh._internalMetadata = { gltf: { pointers: ["/meshes/0/primitives/0"] } };
  return mesh;
}

function loadedProgram(materialId: string): LoadedNativeMaterial {
  const program = parseMaterialProgram(JSON.parse(JSON.stringify(syntheticSwatchProgram(swatchImage))));
  return { materialId, program, plan: compileMaterialStagePlan(program),
    texturePixels: new Map([[swatchImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]) };
}

type VertexStreamsLoader = ReturnType<typeof vi.fn<() => Promise<StaticMeshVertexStreams>>>;

interface PillarBinding {
  readonly scene: Scene;
  readonly binding: StaticMeshLibraryBinding;
  readonly frame: { current: StaticMeshHourlyLightingFrame };
  readonly loadVertexStreams: VertexStreamsLoader;
}

function pillarBinding(list: StaticMeshLightList | null, fixture: StaticMeshLightingFixture = fixtures[0]!,
  loadVertexStreams: VertexStreamsLoader = vi.fn(async () => pillarStreams()), ordinaryLightRecords = lightRecords(),
  actorAmbients: ActorAmbients = sunAffectedPillar): PillarBinding {
  const engine = new NullEngine(), scene = new Scene(engine);
  const frame = { current: frameOf(fixture) };
  const binding = bindStaticMeshLibraryMaterials({ scene, load: { listing: parsedListing, gap: null }, sessionSeed: 3,
    uniforms: () => ({ levelSeconds: 0, hour: fixture.hour, environmentType: 0, fog: FOG_DISABLED }), loadProgram: async materialId => loadedProgram(materialId),
    lightLists: { status: "staged", value: new Map(list === null ? [] : [[list.actorExportIndex, list]]) }, actorAmbients, ordinaryLightRecords,
    hourlyLighting: () => frame.current, loadVertexStreams });
  releases.push(() => { binding.dispose(); scene.dispose(); engine.dispose(); });
  return { scene, binding, frame, loadVertexStreams };
}

function pillarPlacement(fields: Partial<NativeTileChunkPlacement> = {}) {
  return { sourceActor: "20_21.StaticMeshActor2067", exportIndex: pillar.actorExportIndex,
    fields: { vertexStreams: { status: "pinned", resource: `/l2/static-mesh-vertex-streams/${sidecarSha256}/vertex-streams.json`,
      sha256: sidecarSha256, bytes: 4096 }, ...fields } as Partial<NativeTileChunkPlacement> };
}

function instanceColourBytes(mesh: Mesh, vertex: number): number[] {
  const data = mesh.geometry!.getVertexBuffer(instanceColourAttributeName)!.getWrapperBuffer().getData() as Uint8Array;
  return Array.from(data.subarray(vertex * 4, vertex * 4 + 4));
}

const fixtureRgb = (fixture: Pick<StaticMeshLightingFixture, "instanceBGRA">, position: number) => {
  const bgra = fixture.instanceBGRA[position]!;
  return [bgra[2], bgra[1], bgra[0]];
};

describe("static mesh hourly instance colour drawn per placement (RM-10)", () => {
  it("draws the real RM-10 pillar, whose ordinary mask bits all belong to the LightType 6 lights 40 and 30 that add no colour (RM-19)", async () => {
    const f = pillarBinding(pillarList());
    const mesh = pillarMesh(f.scene, "pillar");
    const { sourceActor, exportIndex, fields } = pillarPlacement();
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(sourceActor, exportIndex, [mesh], fields)]);
    expect(f.binding.inspection().lighting).toMatchObject({ litPlacements: 1, unlitPlacementReasons: {} });
    fixtures[0]!.vertexIndices.forEach((vertex, position) => expect(instanceColourBytes(mesh, vertex)).toEqual([...fixtureRgb(fixtures[0]!, position), 255]));
  });

  it("draws actor 1219 instance 3919 with its RM-19 spotlight bytes from staged data when its hourly entry sets no vertex", async () => {
    const { list, streams } = stagedOrdinarySubsetOf(spotlightCase, [{ light: pillar.hourlyMasks[0]!.light, maskHex: "00" }]);
    const f = pillarBinding(list, fixtures[0]!, vi.fn(async () => streams), lightRecords(spotlightCase.ordinaryLights),
      actorAmbientsOf([[spotlightCase.actorExportIndex, { status: "resolved", value: { runtimeSunAffect: true, renderDataAmbient: [0, 0, 0, 0] } }]]));
    const mesh = pillarMesh(f.scene, "spotlit plane", spotlightCase.vertexIndices.length);
    const { fields } = pillarPlacement();
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(spotlightCase.actorObject, spotlightCase.actorExportIndex, [mesh], fields)]);
    expect(f.binding.inspection().lighting).toMatchObject({ litPlacements: 1, unlitPlacementReasons: {} });
    spotlightCase.vertexIndices.forEach((_, position) => expect(instanceColourBytes(mesh, position)).toEqual(
      [...fixtureRgb({ instanceBGRA: spotlightCase.finalInstanceBGRA }, position), 255]));
  });

  it("keeps the pillar unlit with a named reason when light 40 has no record", async () => {
    const reason = "static-mesh-ordinary-light-record-absent:40";
    const f = pillarBinding(pillarList(), fixtures[0]!, vi.fn(async () => pillarStreams()),
      lightRecords(ordinaryPillarCase.ordinaryLights.filter(light => light.exportIndex !== 40)));
    const mesh = pillarMesh(f.scene, "pillar");
    const template = mesh.geometry;
    const { sourceActor, exportIndex, fields } = pillarPlacement();
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(sourceActor, exportIndex, [mesh], fields)]);
    expect(f.binding.inspection().lighting).toMatchObject({ litPlacements: 0, unlitPlacementReasons: { [reason]: 1 } });
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
      composition: staticMeshDrawnComposition, probes: [{ exportIndex: pillar.actorExportIndex, hasInstance: true, ambientSource: "hourly", ambient: [60, 60, 60, 255],
        vertexZeroRgb: fixtureRgb(fixture, 0) }] });
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
    f.frame.current = { status: "resolved", ambient: [60, 60, 60, 255], sun: { hour: 12.3, lightDirection: { x: 0, y: 0, z: 1 }, staticSunPlane: [1, 1, 1, 1] },
      lightEnvironment: rebuildEnvironmentAtHourSix };
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
    expect(lit.geometry!.getIndices()).toBeInstanceOf(Uint32Array);
    expect(lit.geometry!.getIndices()).not.toBe(template.geometry!.getIndices());
    lit.dispose();
    expect(template.geometry!.getVertexBuffer(VertexBuffer.PositionKind)!.getWrapperBuffer().getBuffer()).not.toBeNull();
    expect(sibling.geometry!.getTotalVertices()).toBe(pillar.vertexCount);
    expect(sibling.geometry!.getIndices()).toHaveLength(pillar.vertexCount);
  });

  it("drops a chunk removed while its vertex streams load, so the chunk id binds its new meshes when it returns", async () => {
    const pendingStreams: ((streams: StaticMeshVertexStreams) => void)[] = [];
    const loadVertexStreams: VertexStreamsLoader = vi.fn(() => new Promise<StaticMeshVertexStreams>(resolve => { pendingStreams.push(resolve); }));
    const f = pillarBinding(sunOnlyPillarList(), fixtures[0]!, loadVertexStreams);
    const { sourceActor, exportIndex, fields } = pillarPlacement();
    const removedMesh = pillarMesh(f.scene, "pillar removed");
    const removedMaterial = removedMesh.material;
    const removedAdd = f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(sourceActor, exportIndex, [removedMesh], fields)]);
    await vi.waitFor(() => expect(loadVertexStreams).toHaveBeenCalledTimes(1));
    f.binding.removeChunk("chunk-1-2");
    pendingStreams[0]!(pillarStreams());
    await removedAdd;
    expect(f.binding.inspection().lighting.litPlacements).toBe(0);
    expect(removedMesh.material).toBe(removedMaterial);
    const returnedMesh = pillarMesh(f.scene, "pillar returned");
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(sourceActor, exportIndex, [returnedMesh], fields)]);
    expect(f.binding.inspection().lighting).toMatchObject({ litPlacements: 1, litMeshes: 1 });
    expect(returnedMesh.material?.name).toBe("UE2 material: SyntheticSwatch.SwatchFinalBlend");
    expect(instanceColourBytes(returnedMesh, 0)).toEqual([...fixtureRgb(fixtures[0]!, 0), 255]);
  });

  it.each<[string, StaticMeshLightList, Partial<NativeTileChunkPlacement>, string]>([
    ["a model without a vertex stream sidecar", pillarList({ ordinaryMasks: [] }),
      { vertexStreams: { status: "gap", reason: "static-mesh-vertex-streams-unstaged" } }, "static-mesh-vertex-streams-unstaged"],
    ["a non-uniform DrawScale3D", pillarList({ ordinaryMasks: [], ordinaryInputs: { status: "staged",
      value: { scaleGlow: 1, localToWorld: Float32Array.from([1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) } } }), {}, "static-mesh-normal-transform-unresolved"],
    ["a list whose ScaleGlow or LocalToWorld did not resolve", pillarList({ ordinaryInputs: { status: "unstaged", reason: "static-mesh-ordinary-inputs-unresolved" } }),
      {}, "static-mesh-ordinary-inputs-unresolved"],
    ["a payload without SMLL.localToWorld", pillarList({ ordinaryInputs: { status: "unstaged", reason: "hourly-lighting-input-unstaged:SMLL.localToWorld" } }),
      {}, "hourly-lighting-input-unstaged:SMLL.localToWorld"],
    ["a sidecar whose vertex count differs from the light list", pillarList({ ordinaryMasks: [], vertexCount: 35 }), {},
      "static-mesh-vertex-streams-count-mismatch"],
  ])("leaves %s unlit with a named reason", async (_, list, placementFields, reason) => {
    const f = pillarBinding(list);
    const mesh = pillarMesh(f.scene, "pillar");
    const { sourceActor, exportIndex, fields } = pillarPlacement(placementFields);
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(sourceActor, exportIndex, [mesh], fields)]);
    expect(f.binding.inspection().lighting).toMatchObject({ litPlacements: 0, unlitPlacementReasons: { [reason]: 1 } });
  });

  it.each<[string, ActorAmbients, string]>([
    ["a payload without SMAZ", { status: "unstaged", reason: "hourly-lighting-input-unstaged:SMAZ.actorExportIndex" }, "hourly-lighting-input-unstaged:SMAZ.actorExportIndex"],
    ["an actor without an SMAZ row", actorAmbientsOf([]), "static-mesh-actor-ambient-absent"],
    ["a bUnlit actor", actorAmbientsOf([[pillar.actorExportIndex, { status: "unresolved", reason: "static-mesh-unlit-actor-ambient-unresolved" }]]),
      "static-mesh-unlit-actor-ambient-unresolved"],
  ])("leaves %s unlit with a named reason", async (_, actorAmbients, reason) => {
    const f = pillarBinding(sunOnlyPillarList(), fixtures[0]!, vi.fn(async () => pillarStreams()), lightRecords(), actorAmbients);
    const mesh = pillarMesh(f.scene, "pillar");
    const { sourceActor, exportIndex, fields } = pillarPlacement();
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(sourceActor, exportIndex, [mesh], fields)]);
    expect(f.binding.inspection().lighting).toMatchObject({ litPlacements: 0, unlitPlacementReasons: { [reason]: 1 } });
  });
});

describe("static mesh ambient without hourly entries or without an instance (RM-20)", () => {
  const rm20Frame = (): StaticMeshHourlyLightingFrame => {
    const frame = frameOf(fixtures[0]!);
    if (frame.status !== "resolved") throw new Error("RM-10 frame unresolved");
    const [red, green, blue] = rm20.hourlyStaticMeshAmbientRGB;
    return { ...frame, ambient: [red >> 1, green >> 1, blue >> 1, 255] };
  };
  const modulate2xMultiplier = (colour: readonly number[], ambient: readonly number[]) =>
    [0, 1, 2].map(channel => Math.min(255, 2 * Math.min(255, colour[channel]! + ambient[channel]!)) / 255);

  async function drawnRm20Actor(fixture: StaticMeshAmbientFixture, list: StaticMeshLightList | null) {
    const f = pillarBinding(list, fixtures[0]!, vi.fn(async () => pillarStreams()), lightRecords(),
      actorAmbientsOf([[pillar.actorExportIndex, rm20ActorAmbient(fixture)]]));
    f.frame.current = rm20Frame();
    f.binding.update(true);
    const mesh = pillarMesh(f.scene, fixture.actor);
    const { fields } = pillarPlacement();
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture(fixture.actor, pillar.actorExportIndex, [mesh], fields)]);
    return { f, mesh };
  }

  it.each([950, 1123, 1143])("draws actor %i, whose instance has no hourly entries, with its RM-20 ambient and texture multiplier", async actorExportIndex => {
    const fixture = staticMeshAmbientFixtureOf(rm20, actorExportIndex);
    expect(fixture.hourlyEntryCount).toBe(0);
    const { f, mesh } = await drawnRm20Actor(fixture, pillarList({ ordinaryMasks: [], hourlyMasks: [] }));
    const probe = f.binding.inspection().lighting.probes[0]!;
    expect(probe).toMatchObject({ hasInstance: true, ambientSource: fixture.runtimeSunAffect ? "hourly" : "render-data", ambient: [...fixture.setAmbientRGB, 255],
      vertexZeroRgb: [0, 0, 0] });
    expect(f.binding.inspection().lighting.unlitPlacementReasons).toEqual({});
    expect(modulate2xMultiplier(instanceColourBytes(mesh, 0), probe.ambient!)).toEqual(fixture.lighting[0]!.textureMultiplierRGB);
  });

  it("draws actor 1155, which has no static mesh instance, with zero COLOR0, the hourly ambient 60 and the 120/255 multiplier", async () => {
    const fixture = staticMeshAmbientFixtureOf(rm20, 1155);
    expect(fixture.hasInstance).toBe(false);
    const { f, mesh } = await drawnRm20Actor(fixture, null);
    const probe = f.binding.inspection().lighting.probes[0]!;
    expect(probe).toMatchObject({ hasInstance: false, ambientSource: "hourly", ambient: [60, 60, 60, 255], vertexZeroRgb: [0, 0, 0] });
    expect(Array.from({ length: pillar.vertexCount }, (_, vertex) => instanceColourBytes(mesh, vertex)).every(bytes => bytes.join() === "0,0,0,255")).toBe(true);
    expect(modulate2xMultiplier(instanceColourBytes(mesh, 0), probe.ambient!)).toEqual([120 / 255, 120 / 255, 120 / 255]);
    expect(fixture.lighting[0]!.textureMultiplierRGB).toEqual([120 / 255, 120 / 255, 120 / 255]);
  });

  it("drops the hourly entries of an actor that touches no sun-affected zone and gives it a material of its own render data ambient", async () => {
    const fallback = staticMeshAmbientFixtureOf(rm20, 1123);
    const f = pillarBinding(sunOnlyPillarList(), fixtures[0]!, vi.fn(async () => pillarStreams()), lightRecords(),
      actorAmbientsOf([[pillar.actorExportIndex, rm20ActorAmbient(fallback)], [pillar.actorExportIndex + 1, rm20ActorAmbient(staticMeshAmbientFixtureOf(rm20, 950))]]));
    const fallbackMesh = pillarMesh(f.scene, "fallback"), hourlyMesh = pillarMesh(f.scene, "hourly");
    const { fields } = pillarPlacement();
    await f.binding.addChunk("chunk-1-2", [staticMeshPlacementSurfacesFixture("20_20.StaticMeshActor611", pillar.actorExportIndex, [fallbackMesh], fields),
      staticMeshPlacementSurfacesFixture("20_20.StaticMeshActor1914", pillar.actorExportIndex + 1, [hourlyMesh], fields)]);
    expect(instanceColourBytes(fallbackMesh, 0)).toEqual([0, 0, 0, 255]);
    expect(f.binding.inspection().lighting.probes[0]).toMatchObject({ ambientSource: "render-data", ambient: [40, 40, 40, 255] });
    expect(fallbackMesh.material).not.toBe(hourlyMesh.material);
  });
});
