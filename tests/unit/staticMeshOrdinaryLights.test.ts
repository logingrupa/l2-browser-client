import { describe, expect, it } from "vitest";
import type { NativePlane } from "../../src/environment/model/nativePlane";
import { staticMeshHourlyEntryBlend, staticMeshHourlyEntryContributions, staticMeshHourlyInstanceColour } from "../../src/environment/model/staticMeshHourlyLighting";
import { staticMeshWorldNormal, staticMeshWorldPosition, type NativeLocalToWorld } from "../../src/environment/model/staticMeshLocalToWorld";
import { staticMeshOrdinaryLightGain } from "../../src/environment/model/staticMeshOrdinaryLighting";
import { resolveLightActorColour } from "../../src/scene/world/lighting/lightActorColour";
import type { TileLightActorRecord } from "../../src/scene/world/lighting/lightmapRebuildActors";
import type { RebuildLightEnvironment } from "../../src/scene/world/lighting/rebuildShadowLights";
import {
  resolveStaticMeshOrdinaryLight, resolveStaticMeshOrdinaryTerm, staticMeshOrdinaryLightRecords,
} from "../../src/scene/world/lighting/staticMeshOrdinaryLights";
import { staticMeshPlacementInstanceColours } from "../../src/scene/world/lighting/staticMeshPlacementLighting";
import { staticMeshPlacementLocalToWorld } from "../../src/scene/world/lighting/staticMeshPlacementLocalToWorld";
import { rebuildEnvironmentAtHourSix } from "../support/lightmapRebuildFixture";
import {
  integratedFixtureOf, ordinaryFixtureLightRecord, readOrdinaryStaticLightingFixtures, stagedOrdinarySubsetOf, type OrdinaryFixtureLight,
  type OrdinaryIntegratedFixture, type OrdinaryUpdateFixture,
} from "../support/ordinaryStaticLightingFixtures";

const document = readOrdinaryStaticLightingFixtures();
const pillarCase = integratedFixtureOf(document, 7732);
const referenceThirtyCase = integratedFixtureOf(document, 1238);
const spotlightCase = integratedFixtureOf(document, 1219);
const levelInfo = { exportIndex: 1, fields: new Map([["Brightness", { provenance: "class-default", value: 1 }]]) };

function environmentAt(fixture: { readonly hour: number; readonly levelTimeSeconds: number }): RebuildLightEnvironment {
  return { ...rebuildEnvironmentAtHourSix, hour: fixture.hour, levelTimeSeconds: fixture.levelTimeSeconds };
}

const lightRecord = (light: OrdinaryFixtureLight, overrides: Readonly<Record<string, unknown>> = {}) => ordinaryFixtureLightRecord(light, overrides);

function updateRecord(row: OrdinaryUpdateFixture): TileLightActorRecord {
  const values: Record<string, unknown> = { LightType: row.lightType, LightEffect: 0, LightBrightness: row.lightBrightness, LightRadius: row.lightRadius,
    LightHue: row.lightHue, LightSaturation: row.lightSaturation, LightPeriod: 32, LightPhase: 0, LightCone: 128, bTimeLight: false, bSunlightColor: false,
    bDynamicLight: false, bDeleteMe: false, Location: { X: row.location[0], Y: row.location[1], Z: row.location[2] },
    Rotation: { Pitch: row.rotation[0], Yaw: row.rotation[1], Roll: row.rotation[2] } };
  return { exportIndex: 40, object: "20_21.Light134", actorClass: "Engine.Light",
    fields: new Map(Object.entries(values).map(([field, value]) => [field, { provenance: "authored", value }])) };
}

function recordsOf(fixture: OrdinaryIntegratedFixture) {
  return staticMeshOrdinaryLightRecords({ lights: fixture.ordinaryLights.map(light => lightRecord(light)), levelInfos: [levelInfo] });
}

function stagedLocalToWorld(fixture: OrdinaryIntegratedFixture): NativeLocalToWorld {
  const transform = staticMeshPlacementLocalToWorld(Float32Array.from(fixture.localToWorld));
  if (transform.status !== "uniform-scale") throw new Error(transform.reason);
  return transform.localToWorld;
}

function stagedInstanceRgb(fixture: OrdinaryIntegratedFixture): number[][] {
  const hourlyEntries = fixture.hourlyEntries.length === 0 ? [{ light: pillarCase.hourlyEntries[0]!.light, maskHex: "00" }] : fixture.hourlyEntries;
  const { list, streams } = stagedOrdinarySubsetOf(fixture, hourlyEntries);
  const ordinary = resolveStaticMeshOrdinaryTerm(list, recordsOf(fixture), environmentAt(fixture));
  if (ordinary.status !== "resolved") throw new Error(ordinary.reason);
  const [x, y, z] = fixture.sunDirection;
  const colours = staticMeshPlacementInstanceColours(list, streams, stagedLocalToWorld(fixture), { gain: staticMeshOrdinaryLightGain(fixture.scaleGlow),
    lights: ordinary.value }, { hour: fixture.hour, lightDirection: { x, y, z }, staticSunPlane: fixture.sunPlane as NativePlane });
  return fixture.vertexIndices.map((_, position) => Array.from(colours.subarray(position * 3, position * 3 + 3)));
}

const rgbOf = (bgra: readonly number[]) => [bgra[2], bgra[1], bgra[0]];
const tripleOf = ([x, y, z]: readonly number[]) => ({ x: x!, y: y!, z: z! });

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
  it("keeps no light for the pillar (actor 7732) and actor 1238, whose set mask bits all belong to the zero-colour lights 40 and 30", () => {
    for (const fixture of [pillarCase, referenceThirtyCase]) {
      expect(resolveStaticMeshOrdinaryTerm(stagedOrdinarySubsetOf(fixture).list, recordsOf(fixture), environmentAt(fixture))).toEqual(
        { status: "resolved", value: [] });
    }
  });

  it("keeps the spotlights 297 and 321 of actor 1219, whose masks set vertex bits and whose colour planes are lit", () => {
    const term = resolveStaticMeshOrdinaryTerm(stagedOrdinarySubsetOf(spotlightCase).list, recordsOf(spotlightCase), environmentAt(spotlightCase));
    if (term.status !== "resolved") throw new Error(term.reason);
    expect(term.value.map(entry => [entry.light.colour, entry.light.sampler.position])).toEqual([297, 321].map(reference => {
      const cache = spotlightCase.ordinaryLights.find(light => light.exportIndex === reference)!.cache;
      return [cache.color38, cache.position];
    }));
  });

  it("names an absent light record only when its mask sets a bit, and skips null references", () => {
    const { list } = stagedOrdinarySubsetOf(pillarCase);
    const without = (reference: number) => staticMeshOrdinaryLightRecords({ levelInfos: [levelInfo],
      lights: pillarCase.ordinaryLights.filter(light => light.exportIndex !== reference).map(light => lightRecord(light)) });
    expect(resolveStaticMeshOrdinaryTerm(list, without(40), environmentAt(pillarCase))).toEqual(
      { status: "unresolved", reason: "static-mesh-ordinary-light-record-absent:40" });
    expect(resolveStaticMeshOrdinaryTerm(list, without(30), environmentAt(pillarCase))).toEqual({ status: "resolved", value: [] });
    const nullReference = { ...list, ordinaryMasks: list.ordinaryMasks.map(mask => ({ ...mask, light: 0 })) };
    expect(resolveStaticMeshOrdinaryTerm(nullReference, recordsOf(pillarCase), environmentAt(pillarCase))).toEqual({ status: "resolved", value: [] });
  });

  it("names a level brightness the records cannot resolve when a set bit needs a light colour", () => {
    const records = staticMeshOrdinaryLightRecords({ lights: pillarCase.ordinaryLights.map(light => lightRecord(light)), levelInfos: [] });
    expect(resolveStaticMeshOrdinaryTerm(stagedOrdinarySubsetOf(pillarCase).list, records, environmentAt(pillarCase))).toEqual(
      { status: "unresolved", reason: "bsp-rebuild-level-info-count:0" });
  });
});

describe("world samples of the ordinary rebuild from the staged LocalToWorld and source vertices (RM-19)", () => {
  it.each(document.integrated.map(fixture => [fixture.actorExportIndex, fixture] as const))(
    "actor %i reproduces every SampleIntensity position and SafeNormal argument bit for bit", (_, fixture) => {
      const localToWorld = stagedLocalToWorld(fixture);
      for (const sample of fixture.perLightSamples) {
        const position = staticMeshWorldPosition(localToWorld, tripleOf(fixture.localPositions[String(sample.vertex)]!));
        const normal = staticMeshWorldNormal(localToWorld.rows, tripleOf(fixture.localNormals[String(sample.vertex)]!));
        expect([position.x, position.y, position.z]).toEqual(sample.worldPosition);
        expect([normal.x, normal.y, normal.z]).toEqual(sample.worldNormal);
      }
    });
});

describe("final instance colour from staged data: ordinary rebuild, then the hourly CPU term saturating-added (RM-19 integrated fixtures)", () => {
  it("gives pillar vertices 0, 2 and 3 RGB 5 and vertex 4 RGB 44, all from the hourly term", () => {
    expect(stagedInstanceRgb(pillarCase)).toEqual(pillarCase.finalInstanceBGRA.map(rgbOf));
    expect(stagedInstanceRgb(pillarCase)).toEqual([[5, 5, 5], [5, 5, 5], [5, 5, 5], [44, 44, 44]]);
  });

  it("gives actor 1238 instance 7097 vertex 4 RGB 120, where lights 30 and 40 both set the bit", () => {
    expect(stagedInstanceRgb(referenceThirtyCase)).toEqual(referenceThirtyCase.finalInstanceBGRA.map(rgbOf));
    expect(stagedInstanceRgb(referenceThirtyCase)).toEqual([[120, 120, 120]]);
  });

  it("gives actor 1219 instance 3919 the ordinary term alone: vertices 0 and 1 BGR 2,3,4 and vertices 2 and 3 BGR 1,1,2", () => {
    expect(spotlightCase.hourlyEntries).toEqual([]);
    expect(stagedInstanceRgb(spotlightCase)).toEqual(spotlightCase.finalInstanceBGRA.map(rgbOf));
    expect(stagedInstanceRgb(spotlightCase)).toEqual([[4, 3, 2], [4, 3, 2], [2, 1, 1], [2, 1, 1]]);
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
