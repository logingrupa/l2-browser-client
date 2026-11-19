import { describe, expect, it } from "vitest";
import { staticMeshLocalToWorldFromRowMajorMatrix, staticMeshWorldNormal, staticMeshWorldPosition } from "../../src/environment/model/staticMeshLocalToWorld";
import { staticMeshOrdinaryLightGain } from "../../src/environment/model/staticMeshOrdinaryLighting";
import type { StaticMeshLightList } from "../../src/scene/world/lighting/decodeHourlyLightingInputs";
import type { TileLightActorRecord } from "../../src/scene/world/lighting/lightmapRebuildActors";
import { parseStaticMeshVertexStreams } from "../../src/scene/world/lighting/loadStaticMeshVertexStreams";
import { resolveStaticMeshHourlyEntries, staticMeshLightCacheExcluded } from "../../src/scene/world/lighting/staticMeshLightCacheGate";
import { resolveStaticMeshOrdinaryTerm, staticMeshOrdinaryLightRecords } from "../../src/scene/world/lighting/staticMeshOrdinaryLights";
import { staticMeshPlacementInstanceColours, staticMeshPlacementLightingJoin } from "../../src/scene/world/lighting/staticMeshPlacementLighting";
import type { NativeTileChunkPlacement } from "../../src/scene/world/nativeTileChunkManifest";
import type { Vector3 } from "../../src/shared/math/vector3";
import type { NativePlane } from "../../src/environment/model/nativePlane";
import { rebuildEnvironmentAtHourSix } from "../support/lightmapRebuildFixture";
import { subsetVisibility } from "../support/ordinaryStaticLightingFixtures";
import { lightGateRecord, readStaticMeshLightGateFixtures, type LightGateFixtureReceiver } from "../support/staticMeshLightGateFixtures";
import { maskBytes, readStaticMeshLightingFixtures } from "../support/staticMeshLightingFixtures";
import { staticMeshPlacementSurfacesFixture } from "../support/staticMeshPlacementFixture";

const document = readStaticMeshLightGateFixtures();
const levelInfo = { exportIndex: 1, fields: new Map([["Brightness", { provenance: "class-default", value: 1 }]]) };
const cacheFlagNames = ["bDynamicLight", "bLightChanged", "bDeleteMe"] as const;
const tripleOf = ([x, y, z]: readonly number[]): Vector3 => ({ x: x!, y: y!, z: z! });
const rm26AuthoredWhiteVertexColourHex = "ffffffff";
const rm10Frame = readStaticMeshLightingFixtures().fixtures[0]!;

function flagOwner(values: readonly boolean[]) {
  return { fields: new Map(cacheFlagNames.map((field, index) => [field, { provenance: "authored", value: values[index] }])), reasonPrefix: "static-mesh-ordinary-light",
    label: "light" };
}

function receiverRecords(receiver: LightGateFixtureReceiver, recordOf: (record: TileLightActorRecord) => TileLightActorRecord = record => record) {
  return staticMeshOrdinaryLightRecords({ levelInfos: [levelInfo], lights: receiver.lights.map(light => recordOf(lightGateRecord(light))) });
}

function receiverSubsetList(receiver: LightGateFixtureReceiver): StaticMeshLightList {
  const vertexIndices = receiver.vertices.map(vertex => vertex.vertexIndex);
  const masks = (entries: LightGateFixtureReceiver["ordinaryEntries"]) => entries.map(entry => ({ light: entry.light, visibility: subsetVisibility(entry.maskHex, vertexIndices) }));
  return { actorExportIndex: receiver.exportIndex, instanceExportIndex: receiver.instanceExportIndex, vertexCount: vertexIndices.length,
    ordinaryInputs: { status: "staged", value: { scaleGlow: receiver.scaleGlow, localToWorld: Float32Array.from(receiver.localToWorld) } },
    ordinaryMasks: masks(receiver.ordinaryEntries), hourlyMasks: masks(receiver.hourlyEntries) };
}

function receiverFullList(receiver: LightGateFixtureReceiver): StaticMeshLightList {
  const masks = (entries: LightGateFixtureReceiver["ordinaryEntries"]) => entries.map(entry => ({ light: entry.light, visibility: maskBytes(entry.maskHex) }));
  return { ...receiverSubsetList(receiver), vertexCount: receiver.vertexCount, ordinaryMasks: masks(receiver.ordinaryEntries), hourlyMasks: masks(receiver.hourlyEntries) };
}

function receiverColour0(receiver: LightGateFixtureReceiver): number[][] {
  const list = receiverSubsetList(receiver), records = receiverRecords(receiver);
  const ordinary = resolveStaticMeshOrdinaryTerm(list, records, rebuildEnvironmentAtHourSix);
  if (ordinary.status !== "resolved") throw new Error(ordinary.reason);
  const hourly = receiver.bSunAffect ? resolveStaticMeshHourlyEntries(list, records.lightsByExportIndex) : { status: "resolved" as const, value: [] };
  if (hourly.status !== "resolved") throw new Error(hourly.reason);
  const streams = parseStaticMeshVertexStreams({ kind: "native-static-mesh-vertex-streams", schemaVersion: 3, sourceObject: receiver.mesh,
    nativeVertexCount: receiver.vertices.length, nativePositions: receiver.vertices.flatMap(vertex => vertex.meshPosition),
    nativeNormals: receiver.vertices.flatMap(vertex => vertex.meshNormal), primary: { bgraHex: rm26AuthoredWhiteVertexColourHex.repeat(receiver.vertices.length), revision: 0 },
    alternate: { bgraHex: rm26AuthoredWhiteVertexColourHex.repeat(receiver.vertices.length), revision: 0 }, selector: null, selectorGapReason: "static-mesh-colour-selector-unresolved",
    primitives: [{ mesh: 0, primitive: 0, nativeVertices: receiver.vertices.map((_, position) => position) }] });
  const gain = staticMeshOrdinaryLightGain(receiver.scaleGlow);
  const colours = staticMeshPlacementInstanceColours({ list, localToWorld: staticMeshLocalToWorldFromRowMajorMatrix(receiver.localToWorld), gain }, hourly.value, streams,
    { gain, lights: ordinary.value }, { hour: rm10Frame.hour, lightDirection: tripleOf(rm10Frame.direction), staticSunPlane: rm10Frame.sunPlane as NativePlane });
  return receiver.vertices.map((_, position) => Array.from(colours.subarray(position * 3, position * 3 + 3)));
}

describe("static mesh light cache gate, dyn +0x24 = bDynamicLight and dyn +0x28 = !bDynamicLight && (bLightChanged || bDeleteMe) (RM-19 0x10677fa0, 0x10679960)", () => {
  it.each([[false, false, false, false], [true, false, false, true], [false, true, false, true], [false, false, true, true], [true, true, true, true]])(
    "bDynamicLight %s, bLightChanged %s, bDeleteMe %s excludes the cache: %s", (dynamicLight, lightChanged, deleteMe, excluded) => {
      expect(staticMeshLightCacheExcluded(flagOwner([dynamicLight, lightChanged, deleteMe]))).toEqual({ status: "resolved", value: excluded });
    });
});

describe("RM-26 arches and the wall5383 addendum on 20_20, whose lights all author bLightChanged", () => {
  it("covers the seven RM-26 live samples and wall 5383, each without a sun-affected zone and with set ordinary mask bits", () => {
    expect(document.rm26Receivers.map(receiver => receiver.exportIndex)).toEqual([9216, 6055, 1548, 5327, 5336, 5335, 5374, 5383]);
    for (const receiver of document.rm26Receivers) {
      expect(receiver.bSunAffect).toBe(false);
      expect(receiver.lights.every(light => light.fields.some(field => field.field === "bLightChanged" && field.value === true))).toBe(true);
      expect(receiver.ordinaryEntries.some(entry => /[^0]/.test(entry.maskHex))).toBe(true);
    }
  });

  it.each(document.rm26Receivers.map(receiver => [receiver.exportIndex, receiver] as const))(
    "export %i gives COLOR0 of vertices 0..2 the native BGR from staged-shape data", (_, receiver) => {
      expect(receiverColour0(receiver)).toEqual(receiver.vertices.map(vertex => [vertex.color0BGRA[2], vertex.color0BGRA[1], vertex.color0BGRA[0]]));
    });

  it.each(document.rm26Receivers.map(receiver => [receiver.exportIndex, receiver] as const))(
    "export %i keeps no ordinary light over all its vertices, and its lights pass the cache gate once bLightChanged is clear", (_, receiver) => {
      expect(resolveStaticMeshOrdinaryTerm(receiverFullList(receiver), receiverRecords(receiver), rebuildEnvironmentAtHourSix)).toEqual({ status: "resolved", value: [] });
      const cleared = resolveStaticMeshOrdinaryTerm(receiverFullList(receiver),
        receiverRecords(receiver, record => ({ ...record, fields: new Map([...record.fields, ["bLightChanged", { provenance: "authored", value: false }]]) })),
        rebuildEnvironmentAtHourSix);
      expect(cleared).toEqual({ status: "unresolved", reason: "static-mesh-ordinary-light-field-missing:LightType" });
    });
});

describe("RM-27 export 4900, DrawScale 1.7 x DrawScale3D (0.92, 1, 1): SafeNormal of the LocalToWorld 3x3 with W 0", () => {
  const { localToWorld, vertices } = document.rm27Normals;
  const transform = staticMeshLocalToWorldFromRowMajorMatrix(Float32Array.from(localToWorld));

  it.each(vertices.map(vertex => [vertex.vertex, vertex] as const))("vertex %i world position and normal match the native f32 bytes", (_, vertex) => {
    const position = staticMeshWorldPosition(transform, tripleOf(vertex.localPosition));
    const normal = staticMeshWorldNormal(transform.rows, tripleOf(vertex.localNormal));
    expect([position.x, position.y, position.z]).toEqual(vertex.worldPosition);
    expect([normal.x, normal.y, normal.z]).toEqual(vertex.worldNormal);
  });

  it("joins RM-26 arch 6055, whose staged LocalToWorld rows differ in length, as eligible with that transform instead of unlit", () => {
    const arch = document.rm26Receivers.find(receiver => receiver.exportIndex === 6055)!;
    const rowLengths = [0, 4, 8].map(start => Math.hypot(...arch.localToWorld.slice(start, start + 3)));
    expect(new Set(rowLengths).size).toBeGreaterThan(1);
    const pinnedStreams: Partial<NativeTileChunkPlacement> = { vertexStreams: { status: "pinned", resource: "/l2/vertex-streams.json", sha256: "d".repeat(64), bytes: 1 } };
    const { placement } = staticMeshPlacementSurfacesFixture("20_20.StaticMeshActor", arch.exportIndex, [], pinnedStreams);
    const join = staticMeshPlacementLightingJoin({ status: "staged", value: new Map([[arch.exportIndex, receiverFullList(arch)]]) },
      { status: "staged", value: new Map([[arch.exportIndex, { status: "resolved", value: { runtimeSunAffect: false, renderDataAmbient: [0, 0, 0, 0] } }]]) }, placement);
    expect(join).toMatchObject({ status: "eligible", instance: { localToWorld: staticMeshLocalToWorldFromRowMajorMatrix(Float32Array.from(arch.localToWorld)) } });
  });
});
