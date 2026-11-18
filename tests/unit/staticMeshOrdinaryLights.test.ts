import { describe, expect, it } from "vitest";
import type { BgrBytes } from "../../src/environment/model/nativeColourBytes";
import type { NativePlane } from "../../src/environment/model/nativePlane";
import {
  staticMeshHourlyEntryBlend, staticMeshHourlyEntryContributions, staticMeshHourlyInstanceColour, staticMeshSampleIntensity, staticMeshVertexVisible,
  staticMeshWorldNormal, type NativeLocalToWorldRows,
} from "../../src/environment/model/staticMeshHourlyLighting";
import { staticMeshOrdinaryLightGain, staticMeshOrdinaryVertexColour, type StaticMeshOrdinaryLight } from "../../src/environment/model/staticMeshOrdinaryLighting";
import type { StaticMeshLightList } from "../../src/scene/world/lighting/decodeHourlyLightingInputs";
import { resolveLightActorColour } from "../../src/scene/world/lighting/lightActorColour";
import type { TileLightActorRecord } from "../../src/scene/world/lighting/lightmapRebuildActors";
import type { RebuildLightEnvironment } from "../../src/scene/world/lighting/rebuildShadowLights";
import {
  resolveStaticMeshOrdinaryLight, staticMeshOrdinaryLightRecords, staticMeshOrdinaryTermReason,
} from "../../src/scene/world/lighting/staticMeshOrdinaryLights";
import type { Vector3 } from "../../src/shared/math/vector3";
import { rebuildEnvironmentAtHourSix } from "../support/lightmapRebuildFixture";
import {
  integratedFixtureOf, readOrdinaryStaticLightingFixtures, type OrdinaryFixtureLight, type OrdinaryIntegratedFixture, type OrdinaryUpdateFixture,
} from "../support/ordinaryStaticLightingFixtures";
import { maskBytes } from "../support/staticMeshLightingFixtures";

const document = readOrdinaryStaticLightingFixtures();
const pillarCase = integratedFixtureOf(document, 7732);
const referenceThirtyCase = integratedFixtureOf(document, 1238);
const spotlightCase = integratedFixtureOf(document, 1219);
const levelInfo = { exportIndex: 1, fields: new Map([["Brightness", { provenance: "class-default", value: 1 }]]) };

function environmentAt(fixture: { readonly hour: number; readonly levelTimeSeconds: number }): RebuildLightEnvironment {
  return { ...rebuildEnvironmentAtHourSix, hour: fixture.hour, levelTimeSeconds: fixture.levelTimeSeconds };
}

function lightRecord(light: OrdinaryFixtureLight, overrides: Readonly<Record<string, unknown>> = {}): TileLightActorRecord {
  const fields = new Map(light.fields.map(field => [field.field, { provenance: field.provenance, value: field.value }]));
  for (const [field, value] of Object.entries(overrides)) fields.set(field, { provenance: "authored", value });
  return { exportIndex: light.exportIndex, object: light.object, actorClass: light.actorClass, fields };
}

function updateRecord(row: OrdinaryUpdateFixture): TileLightActorRecord {
  const values: Record<string, unknown> = { LightType: row.lightType, LightEffect: 0, LightBrightness: row.lightBrightness, LightRadius: row.lightRadius,
    LightHue: row.lightHue, LightSaturation: row.lightSaturation, LightPeriod: 32, LightPhase: 0, LightCone: 128, bTimeLight: false, bSunlightColor: false,
    bDynamicLight: false, bDeleteMe: false, Location: { X: row.location[0], Y: row.location[1], Z: row.location[2] },
    Rotation: { Pitch: row.rotation[0], Yaw: row.rotation[1], Roll: row.rotation[2] } };
  return { exportIndex: 40, object: "20_21.Light134", actorClass: "Engine.Light",
    fields: new Map(Object.entries(values).map(([field, value]) => [field, { provenance: "authored", value }])) };
}

function lightListOf(fixture: OrdinaryIntegratedFixture): StaticMeshLightList {
  const masks = (entries: OrdinaryIntegratedFixture["ordinaryEntries"]) => entries.map(entry => ({ light: entry.light, visibility: maskBytes(entry.maskHex) }));
  return { actorExportIndex: fixture.actorExportIndex, instanceExportIndex: fixture.instanceExportIndex, vertexCount: fixture.vertexCount,
    sunAffect: { status: "staged", value: 1 }, ordinaryMasks: masks(fixture.ordinaryEntries), hourlyMasks: masks(fixture.hourlyEntries) };
}

function recordsOf(fixture: OrdinaryIntegratedFixture) {
  return staticMeshOrdinaryLightRecords({ lights: fixture.ordinaryLights.map(light => lightRecord(light)), levelInfos: [levelInfo] });
}

function contributingLights(fixture: OrdinaryIntegratedFixture, vertex: number): StaticMeshOrdinaryLight[] {
  return fixture.ordinaryEntries.filter(entry => staticMeshVertexVisible(maskBytes(entry.maskHex), vertex)).flatMap(entry => {
    const state = resolveStaticMeshOrdinaryLight(lightRecord(fixture.ordinaryLights.find(light => light.exportIndex === entry.light)!), fixture.levelBrightness,
      environmentAt(fixture));
    if (state.status !== "resolved") throw new Error(state.reason);
    return state.value.contributes ? [state.value.light] : [];
  });
}

function ordinaryColourOf(fixture: OrdinaryIntegratedFixture, vertex: number): BgrBytes {
  const lights = contributingLights(fixture, vertex);
  if (lights.length === 0) return [0, 0, 0];
  const sample = fixture.perLightSamples.find(entry => entry.vertex === vertex)!;
  return staticMeshOrdinaryVertexColour(lights, staticMeshOrdinaryLightGain(fixture.scaleGlow), sample);
}

function localToWorldRows(matrix: readonly number[]): NativeLocalToWorldRows {
  const row = (start: number): Vector3 => ({ x: matrix[start]!, y: matrix[start + 1]!, z: matrix[start + 2]! });
  return [row(0), row(4), row(8)];
}

function finalColourOf(fixture: OrdinaryIntegratedFixture, vertex: number): readonly number[] {
  const ordinary = ordinaryColourOf(fixture, vertex);
  if (fixture.hourlyEntries.length === 0) return [ordinary[2], ordinary[1], ordinary[0]];
  const blend = staticMeshHourlyEntryBlend(fixture.hourlyEntries.length, fixture.hour);
  const visible = (index: number) => staticMeshVertexVisible(maskBytes(fixture.hourlyEntries[index]!.maskHex), vertex);
  const [x, y, z] = fixture.localNormals[String(vertex)]!;
  const [directionX, directionY, directionZ] = fixture.sunDirection;
  const sampleIntensity = staticMeshSampleIntensity(staticMeshWorldNormal(localToWorldRows(fixture.localToWorld), { x, y, z }),
    { x: directionX, y: directionY, z: directionZ });
  return staticMeshHourlyInstanceColour(sampleIntensity, staticMeshHourlyEntryContributions(blend, visible(blend.index), visible(blend.nextIndex)),
    fixture.sunPlane as NativePlane, ordinary);
}

const rgbOf = (bgra: readonly number[]) => [bgra[2], bgra[1], bgra[0]];

describe("ordinary light cache from the light record, FDynamicLight::Update 0x10674660 (RM-19)", () => {
  it.each(document.update.map(row => [row.lightType, row.levelTimeSeconds, row] as const))("LightType %i at %f level seconds gives the native colour plane",
    (_, levelTimeSeconds, row) => {
      const owner = { fields: updateRecord(row).fields, reasonPrefix: "static-mesh-ordinary-light", label: "light 40" };
      expect(resolveLightActorColour(owner, row.lightType, 1, environmentAt({ hour: 12.3, levelTimeSeconds }))).toEqual({ status: "resolved", value: row.colour });
    });

  it.each(document.update.map(row => [row.lightType, row.levelTimeSeconds, row] as const))(
    "LightType %i at %f level seconds is dark for 6, names the unverified TimeSeconds for 7 and caches colour and radius for 1", (lightType, levelTimeSeconds, row) => {
      const state = resolveStaticMeshOrdinaryLight(updateRecord(row), 1, environmentAt({ hour: 12.3, levelTimeSeconds }));
      if (lightType === 6) {
        expect(row.colour.slice(0, 3)).toEqual([0, 0, 0]);
        expect(state).toEqual({ status: "resolved", value: { contributes: false } });
        return;
      }
      if (lightType === 7) {
        expect(state).toEqual({ status: "unresolved", reason: "static-mesh-ordinary-light-type7-time-seconds-unverified" });
        return;
      }
      expect(state).toEqual({ status: "resolved", value: { contributes: true,
        light: { colour: row.colour, sampler: { effect: "point", position: row.location, radius: row.radius } } } });
    });

  it("keeps a LightType 7 light with a zero colour, bDynamicLight or bDeleteMe dark, since its 0.9 +- 0.09 modulation never reaches zero", () => {
    const modulated = document.update.find(row => row.lightType === 7)!;
    const withFlagSet = (flag: string) => {
      const record = updateRecord(modulated);
      (record.fields as Map<string, unknown>).set(flag, { provenance: "authored", value: true });
      return record;
    };
    for (const record of [updateRecord({ ...modulated, lightBrightness: 0 }), withFlagSet("bDynamicLight"), withFlagSet("bDeleteMe")]) {
      expect(resolveStaticMeshOrdinaryLight(record, 1, environmentAt({ hour: 12.3, levelTimeSeconds: modulated.levelTimeSeconds }))).toEqual(
        { status: "resolved", value: { contributes: false } });
    }
  });

  it.each([...pillarCase.ordinaryLights, ...spotlightCase.ordinaryLights].map(light => [light.exportIndex, light] as const))(
    "light %i resolves to its native cache", (_, light) => {
      const state = resolveStaticMeshOrdinaryLight(lightRecord(light), 1, environmentAt(spotlightCase));
      if (state.status !== "resolved") throw new Error(state.reason);
      if (light.cache.color38.slice(0, 3).every(channel => channel === 0)) {
        expect(state.value).toEqual({ contributes: false });
        return;
      }
      if (!state.value.contributes) throw new Error(`light ${light.exportIndex} should contribute`);
      const { colour, sampler } = state.value.light;
      expect(colour).toEqual(light.cache.color38);
      expect(sampler.position).toEqual(light.cache.position);
      expect(sampler.radius).toBe(light.cache.radius);
      if (sampler.effect === "spot") expect(sampler.direction).toEqual(light.cache.direction);
    });

  it("reads lights 40 and 30 as LightType 6, effect 0 and Radius 600, so their colour plane is zero", () => {
    for (const light of pillarCase.ordinaryLights) {
      const value = (field: string) => light.fields.find(entry => entry.field === field)!.value;
      expect([light.exportIndex, value("LightType"), value("LightEffect"), value("LightRadius"), light.cache.color38.slice(0, 3)]).toEqual(
        [light.exportIndex, 6, 0, 600, [0, 0, 0]]);
    }
  });

  it("excludes a lit light with bDynamicLight or bDeleteMe, as the rebuild skips dyn +0x24 and +0x28", () => {
    const lit = spotlightCase.ordinaryLights.find(light => light.exportIndex === 297)!;
    for (const flag of ["bDynamicLight", "bDeleteMe"]) {
      expect(resolveStaticMeshOrdinaryLight(lightRecord(lit, { [flag]: true }), 1, environmentAt(spotlightCase))).toEqual(
        { status: "resolved", value: { contributes: false } });
    }
  });

  it("names a lit light with an unported effect, a time-varying colour or an unresolved field, and keeps a dark one dark", () => {
    const lit = spotlightCase.ordinaryLights.find(light => light.exportIndex === 297)!, dark = pillarCase.ordinaryLights[0]!;
    const resolve = (light: OrdinaryFixtureLight, overrides: Readonly<Record<string, unknown>>) =>
      resolveStaticMeshOrdinaryLight(lightRecord(light, overrides), 1, environmentAt(spotlightCase));
    expect(resolve(lit, { LightEffect: 19 })).toEqual({ status: "unresolved", reason: "static-mesh-light-effect-unported:19" });
    expect(resolve(dark, { LightEffect: 19 })).toEqual({ status: "resolved", value: { contributes: false } });
    expect(resolve(lit, { bTimeLight: true })).toEqual({ status: "unresolved", reason: "static-mesh-ordinary-light-time-varying-colour-unported" });
    expect(resolve(dark, { bSunlightColor: true })).toEqual({ status: "unresolved", reason: "static-mesh-ordinary-light-time-varying-colour-unported" });
    const unresolvedType = lightRecord(lit);
    (unresolvedType.fields as Map<string, unknown>).set("LightType", { provenance: "unresolved", value: null });
    expect(resolveStaticMeshOrdinaryLight(unresolvedType, 1, environmentAt(spotlightCase))).toEqual(
      { status: "unresolved", reason: "static-mesh-ordinary-light-field-unresolved:LightType" });
  });
});

describe("ordinary term of a whole light list (RM-19)", () => {
  it("draws the pillar (actor 7732) and actor 1238, whose set mask bits all belong to the zero-colour lights 40 and 30", () => {
    expect(staticMeshOrdinaryTermReason(lightListOf(pillarCase), recordsOf(pillarCase), environmentAt(pillarCase))).toBeNull();
    expect(staticMeshOrdinaryTermReason(lightListOf(referenceThirtyCase), recordsOf(referenceThirtyCase), environmentAt(referenceThirtyCase))).toBeNull();
  });

  it("names the unstaged vertex positions for actor 1219, whose spotlights add colour", () => {
    expect(staticMeshOrdinaryTermReason(lightListOf(spotlightCase), recordsOf(spotlightCase), environmentAt(spotlightCase))).toBe(
      "static-mesh-ordinary-light-vertex-positions-unstaged");
  });

  it("names an absent light record only when its mask sets a bit, and skips null references", () => {
    const list = lightListOf(pillarCase);
    const withoutLight40 = staticMeshOrdinaryLightRecords({ lights: pillarCase.ordinaryLights.filter(light => light.exportIndex !== 40).map(light => lightRecord(light)),
      levelInfos: [levelInfo] });
    expect(staticMeshOrdinaryTermReason(list, withoutLight40, environmentAt(pillarCase))).toBe("static-mesh-ordinary-light-record-absent:40");
    const withoutLight30 = staticMeshOrdinaryLightRecords({ lights: pillarCase.ordinaryLights.filter(light => light.exportIndex !== 30).map(light => lightRecord(light)),
      levelInfos: [levelInfo] });
    expect(staticMeshOrdinaryTermReason(list, withoutLight30, environmentAt(pillarCase))).toBeNull();
    const nullReference = { ...list, ordinaryMasks: list.ordinaryMasks.map(mask => ({ ...mask, light: 0 })) };
    expect(staticMeshOrdinaryTermReason(nullReference, recordsOf(pillarCase), environmentAt(pillarCase))).toBeNull();
  });

  it("names a level brightness the records cannot resolve when a set bit needs a light colour", () => {
    const records = staticMeshOrdinaryLightRecords({ lights: pillarCase.ordinaryLights.map(light => lightRecord(light)), levelInfos: [] });
    expect(staticMeshOrdinaryTermReason(lightListOf(pillarCase), records, environmentAt(pillarCase))).toBe("bsp-rebuild-level-info-count:0");
  });
});

describe("final instance colour: ordinary rebuild, then the hourly CPU term saturating-added (RM-19 integrated fixtures)", () => {
  it("gives pillar vertices 0, 2 and 3 RGB 5 and vertex 4 RGB 44, all from the hourly term", () => {
    expect(pillarCase.vertexIndices.map(vertex => ordinaryColourOf(pillarCase, vertex))).toEqual(pillarCase.vertexIndices.map(() => [0, 0, 0]));
    expect(pillarCase.vertexIndices.map(vertex => finalColourOf(pillarCase, vertex))).toEqual([[5, 5, 5], [5, 5, 5], [5, 5, 5], [44, 44, 44]]);
    expect(pillarCase.finalInstanceBGRA.map(rgbOf)).toEqual([[5, 5, 5], [5, 5, 5], [5, 5, 5], [44, 44, 44]]);
  });

  it("gives actor 1238 instance 7097 vertex 4 RGB 120, where lights 30 and 40 both set the bit", () => {
    expect(referenceThirtyCase.vertexIndices).toEqual([4]);
    expect(contributingLights(referenceThirtyCase, 4)).toEqual([]);
    expect(finalColourOf(referenceThirtyCase, 4)).toEqual(rgbOf(referenceThirtyCase.finalInstanceBGRA[0]!));
    expect(finalColourOf(referenceThirtyCase, 4)).toEqual([120, 120, 120]);
  });

  it("gives actor 1219 instance 3919 the ordinary term alone: vertices 0 and 1 BGR 2,3,4 and vertices 2 and 3 BGR 1,1,2", () => {
    expect(spotlightCase.hourlyEntries).toEqual([]);
    expect(spotlightCase.vertexIndices.map(vertex => finalColourOf(spotlightCase, vertex))).toEqual(spotlightCase.finalInstanceBGRA.map(rgbOf));
    expect(spotlightCase.vertexIndices.map(vertex => finalColourOf(spotlightCase, vertex))).toEqual([[4, 3, 2], [4, 3, 2], [2, 1, 1], [2, 1, 1]]);
  });

  it("adds the hourly temporary stream onto the ordinary bytes and saturates at 255", () => {
    const blend = staticMeshHourlyEntryBlend(pillarCase.hourlyEntries.length, pillarCase.hour);
    const entries = staticMeshHourlyEntryContributions(blend, true, true);
    const hourlyOnly = staticMeshHourlyInstanceColour(1, entries, pillarCase.sunPlane as NativePlane, [0, 0, 0]);
    expect(staticMeshHourlyInstanceColour(1, entries, pillarCase.sunPlane as NativePlane, [10, 20, 30])).toEqual(
      [hourlyOnly[0] + 30, hourlyOnly[1] + 20, hourlyOnly[2] + 10]);
    expect(staticMeshHourlyInstanceColour(1, entries, pillarCase.sunPlane as NativePlane, [250, 250, 250])).toEqual([255, 255, 255]);
  });
});
