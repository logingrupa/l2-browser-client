import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLightColourTable } from "../../src/environment/model/lightmapRebuild/lightColourTable";
import { buildLightingTables } from "../../src/environment/model/lightmapRebuild/lightingTables";
import { resolvedResult } from "../../src/environment/model/lightmapRebuild/lightmapRebuildTypes";
import type { BgraBytes } from "../../src/environment/model/nativeColourBytes";
import { composeRebuiltLightmap, rebuiltLightmapNotes, sunRecordPartialReason } from "../../src/scene/world/lighting/composeRebuiltLightmap";
import type { LightmapRebuildRecord, LightmapRebuildShadow } from "../../src/scene/world/lighting/decodeLightmapRebuildInputs";
import { composeRebuiltLightmapRequest, type RebuiltLightmapRequest } from "../../src/scene/world/lighting/rebuiltLightmapRequest";
import type { ShadowLight } from "../../src/scene/world/lighting/rebuildShadowLights";
import type { TileLightActorRecord } from "../../src/scene/world/lighting/lightmapRebuildActors";
import { authoredFields, pointLightFields, rebuildEnvironmentAtHourSix, rebuildLightActor, rebuildZone } from "../support/lightmapRebuildFixture";

interface AmbientDocument {
  readonly first16: {
    readonly lightmapIndices: readonly number[];
    readonly zone: { readonly AmbientHue: number; readonly AmbientSaturation: number; readonly AmbientBrightness: number };
    readonly resultFirst16BGRA: readonly BgraBytes[];
  };
  readonly fixtures: readonly { readonly input: { readonly lightmaps?: readonly { readonly offsetX: number; readonly width: number; readonly height: number }[] } }[];
}

interface AttenuationFixture {
  readonly label: string;
  readonly input: { readonly radius: number; readonly position: readonly number[]; readonly shadowBytes: readonly number[] };
  readonly output: readonly number[];
}

interface ColourTableFixture {
  readonly label: string;
  readonly colourRGB: readonly [number, number, number];
  readonly outputBgraBytesHex: string;
}

const fixtureDirectory = new URL("../fixtures/db16/", import.meta.url);
const readFixture = <Document>(fileName: string) => JSON.parse(readFileSync(new URL(fileName, fixtureDirectory), "utf8")) as Document;
const ambientDocument = readFixture<AmbientDocument>("ambient-native.json");
const pointFixture = readFixture<{ readonly fixtures: readonly AttenuationFixture[] }>("attenuation-native.json").fixtures.find(fixture => fixture.label === "point")!;
const normalColourFixture = readFixture<{ readonly fixtures: readonly ColourTableFixture[] }>("colour-lut-native.json").fixtures.find(fixture => fixture.label === "normal")!;
const tables = buildLightingTables();
const pageEdge = 512;
const grey40Zone = { AmbientHue: 0, AmbientSaturation: 255, AmbientBrightness: 40 };
const levelInfos = [{ exportIndex: 2, fields: authoredFields({ Brightness: 1 }) }];

function lightmapRecord(atlasX: number, atlasY: number, width: number, height: number, shadows: readonly LightmapRebuildShadow[] = []): LightmapRebuildRecord {
  return { zone: 2, atlasX, atlasY, surface: { normal: [0, 0, -1], polyFlags: 0 },
    projection: { width, height, origin: [0, 0, 0], uStep: [1, 0, 0], vStep: [0, 1, 0] }, shadows };
}

function atlasBgra(rgba: Uint8Array, x: number, y: number): BgraBytes {
  const offset = (y * pageEdge + x) * 4;
  return [rgba[offset + 2]!, rgba[offset + 1]!, rgba[offset]!, rgba[offset + 3]!];
}

function request(records: readonly LightmapRebuildRecord[], lights: RebuiltLightmapRequest["lights"] = []): RebuiltLightmapRequest {
  return { edge: pageEdge, records, lights, zones: [rebuildZone(2, grey40Zone)], levelInfos, environment: rebuildEnvironmentAtHourSix };
}

const singleTexelShadow: LightmapRebuildShadow = { light: 0, height: 1, rowBytes: 1, minimumX: 0, minimumY: 0, maximumX: 0, maximumY: 0, bits: Uint8Array.of(1) };

function pointLightWithProvenance(provenanceByField: Readonly<Record<string, string>>): TileLightActorRecord {
  const light = rebuildLightActor("Engine.Light", pointLightFields);
  const fields = new Map(light.fields);
  for (const [field, provenance] of Object.entries(provenanceByField)) fields.set(field, { provenance, value: null });
  return { ...light, fields };
}

function resolvedImage(result: ReturnType<typeof composeRebuiltLightmap>) {
  if (result.status !== "resolved") throw new Error(`Expected a rebuilt image, got ${result.reason}.`);
  return result.value;
}

describe("composeRebuiltLightmap, the ordinary builder 0x10675390 over one atlas page", () => {
  it("fills an ambient-only record with FColor(FGetHSV(zone) * 0.5) and leaves uncovered texels 0", () => {
    const image = resolvedImage(composeRebuiltLightmapRequest(request([lightmapRecord(16, 4, 8, 8)]), tables));
    expect(atlasBgra(image.rgba, 16, 4)).toEqual([40, 40, 40, 127]);
    expect(atlasBgra(image.rgba, 23, 11)).toEqual([40, 40, 40, 127]);
    expect(atlasBgra(image.rgba, 15, 4)).toEqual([0, 0, 0, 0]);
    expect(atlasBgra(image.rgba, 24, 11)).toEqual([0, 0, 0, 0]);
    expect(image.uncoveredTexels).toBe(pageEdge * pageEdge - 64);
    expect(image.notes).toEqual([rebuiltLightmapNotes.tableControlWord, rebuiltLightmapNotes.uncoveredTexels]);
  });

  it("composes 20_20 lightmaps 0 and 1 to the native first 16 texels of row 0", () => {
    const { first16 } = ambientDocument;
    const lightmaps = ambientDocument.fixtures.find(fixture => fixture.input.lightmaps !== undefined)!.input.lightmaps!;
    expect(lightmaps).toHaveLength(first16.lightmapIndices.length);
    const records = lightmaps.map(lightmap => lightmapRecord(lightmap.offsetX, 0, lightmap.width, lightmap.height));
    const image = resolvedImage(composeRebuiltLightmapRequest({ ...request(records), zones: [rebuildZone(2, first16.zone)] }, tables));
    expect(Array.from({ length: 16 }, (_, x) => atlasBgra(image.rgba, x, 0))).toEqual(first16.resultFirst16BGRA);
  });

  it("adds one effect 0 light as the native attenuation byte looked up in the native colour table, alpha saturating to 255", () => {
    const [red, green, blue] = normalColourFixture.colourRGB.map(channel => Math.fround(channel));
    const pointLight: ShadowLight = { applied: true, notes: [], colourTable: buildLightColourTable([red!, green!, blue!, 1]),
      attenuation: { branch: "point-falloff", position: [0, 0, 32], radius: pointFixture.input.radius } };
    const image = resolvedImage(composeRebuiltLightmap(pageEdge, [lightmapRecord(0, 0, 4, 2, [singleTexelShadow])],
      { zoneAmbient: () => resolvedResult<BgraBytes>([40, 40, 40, 127]), shadowLight: () => resolvedResult(pointLight), tables }));
    expect(pointFixture.input.shadowBytes[0]).toBe(255);
    const intensity = pointFixture.output[0]!, lookUp = Buffer.from(normalColourFixture.outputBgraBytesHex, "hex").subarray(intensity * 4, intensity * 4 + 4);
    expect(atlasBgra(image.rgba, 0, 0)).toEqual([40 + lookUp[0]!, 40 + lookUp[1]!, 40 + lookUp[2]!, 255].map(byte => Math.min(byte, 255)));
    expect(atlasBgra(image.rgba, 1, 0)).toEqual([40, 40, 40, 127]);
  });

  it("names the first unported light effect instead of drawing the page", () => {
    const record = lightmapRecord(0, 0, 4, 2, [singleTexelShadow]);
    const unported = rebuildLightActor("Engine.Light", { bDeleteMe: false, LightEffect: 4 });
    expect(composeRebuiltLightmapRequest(request([record], [unported]), tables)).toEqual({ status: "unresolved", reason: "bsp-rebuild-light-effect-unported:4" });
  });

  it("skips a light with bDeleteMe set, as the builder does for actor +0x64 bit 0x80", () => {
    const record = lightmapRecord(0, 0, 4, 2, [singleTexelShadow]);
    const deleted = rebuildLightActor("Engine.Light", { bDeleteMe: true, LightEffect: 4 });
    expect(atlasBgra(resolvedImage(composeRebuiltLightmapRequest(request([record], [deleted]), tables)).rgba, 0, 0)).toEqual([40, 40, 40, 127]);
  });

  it("names a field the converter left unresolved and a zone without a ZoneInfo", () => {
    const record = lightmapRecord(0, 0, 4, 2, [singleTexelShadow]);
    const unresolvedRadius = rebuildLightActor("Engine.Light", { bDeleteMe: false, LightEffect: 0, Location: { X: 0, Y: 0, Z: 32 } });
    expect(composeRebuiltLightmapRequest(request([record], [unresolvedRadius]), tables)).toEqual({ status: "unresolved", reason: "bsp-rebuild-light-field-missing:LightRadius" });
    expect(composeRebuiltLightmapRequest({ ...request([record]), zones: [{ ...rebuildZone(2, grey40Zone), levelInfoFallback: true }] }, tables))
      .toEqual({ status: "unresolved", reason: "bsp-rebuild-zone-actor-fallback:2" });
  });

  it("refuses a sun record that does not cover its whole lightmap, which the native loop walks", () => {
    const sun: ShadowLight = { applied: true, notes: [], colourTable: buildLightColourTable([1, 1, 1, 1]), attenuation: { branch: "sun-direction", direction: [0, 0, 1] } };
    expect(composeRebuiltLightmap(pageEdge, [lightmapRecord(0, 0, 4, 2, [singleTexelShadow])],
      { zoneAmbient: () => resolvedResult<BgraBytes>([40, 40, 40, 127]), shadowLight: () => resolvedResult(sun), tables }))
      .toEqual({ status: "unresolved", reason: sunRecordPartialReason });
  });

  it("composes a NMovableSunLight at the build hour and flags the sun inspection notes", () => {
    const record = lightmapRecord(0, 0, 4, 1, [{ ...singleTexelShadow, maximumX: 3, bits: Uint8Array.of(0x0f) }]);
    const sun = rebuildLightActor("Engine.NMovableSunLight", { bDeleteMe: false, LightEffect: 19, LightType: 1, bTimeLight: false, LightPeriod: 32, LightPhase: 0,
      LightHue: 0, LightSaturation: 255, LightBrightness: 70, bSunlightColor: true });
    const image = resolvedImage(composeRebuiltLightmapRequest(request([record], [sun]), tables));
    expect(image.notes).toEqual(expect.arrayContaining([rebuiltLightmapNotes.sunFirstTick, rebuiltLightmapNotes.sunLocalSublights]));
    expect(image.notes).not.toContain(rebuiltLightmapNotes.sunFreezeFlag);
    expect(atlasBgra(image.rgba, 0, 0)[3]).toBe(255);
    const unverifiedFreeze = { ...request([record], [sun]), environment: { ...rebuildEnvironmentAtHourSix, frozen: { value: false, verified: false } } };
    expect(resolvedImage(composeRebuiltLightmapRequest(unverifiedFreeze, tables)).notes).toContain(rebuiltLightmapNotes.sunFreezeFlag);
  });

  it("flags a LightType 7 light, whose modulation reads the unpinned LevelInfo TimeSeconds, and leaves steady lights unflagged", () => {
    const record = lightmapRecord(0, 0, 4, 2, [singleTexelShadow]);
    const steady = rebuildLightActor("Engine.Light", pointLightFields), modulated = rebuildLightActor("Engine.Light", { ...pointLightFields, LightType: 7 });
    expect(resolvedImage(composeRebuiltLightmapRequest(request([record], [steady]), tables)).notes).not.toContain(rebuiltLightmapNotes.lightType7TimeSeconds);
    expect(resolvedImage(composeRebuiltLightmapRequest(request([record], [modulated]), tables)).notes).toContain(rebuiltLightmapNotes.lightType7TimeSeconds);
  });

  it("reads ue-zero LightEffect and bDeleteMe as 0 and false, so the light composes as the authored point light", () => {
    const record = lightmapRecord(0, 0, 4, 2, [singleTexelShadow]);
    const authored = resolvedImage(composeRebuiltLightmapRequest(request([record], [rebuildLightActor("Engine.Light", pointLightFields)]), tables));
    const ueZero = resolvedImage(composeRebuiltLightmapRequest(request([record], [pointLightWithProvenance({ LightEffect: "ue-zero", bDeleteMe: "ue-zero" })]), tables));
    expect(atlasBgra(authored.rgba, 0, 0)).not.toEqual([40, 40, 40, 127]);
    expect(ueZero.rgba).toEqual(authored.rgba);
  });

  it("names a light field whose provenance is unresolved", () => {
    const record = lightmapRecord(0, 0, 4, 2, [singleTexelShadow]);
    expect(composeRebuiltLightmapRequest(request([record], [pointLightWithProvenance({ LightRadius: "unresolved" })]), tables))
      .toEqual({ status: "unresolved", reason: "bsp-rebuild-light-field-unresolved:LightRadius" });
  });

  it.each([[0], [2]])("names %s level infos instead of picking a Brightness", count => {
    const record = lightmapRecord(0, 0, 4, 2, [singleTexelShadow]), light = rebuildLightActor("Engine.Light", pointLightFields);
    const levelInfoList = Array.from({ length: count }, (_, index) => ({ exportIndex: index + 2, fields: authoredFields({ Brightness: 1 }) }));
    expect(composeRebuiltLightmapRequest({ ...request([record], [light]), levelInfos: levelInfoList }, tables))
      .toEqual({ status: "unresolved", reason: `bsp-rebuild-level-info-count:${count}` });
  });

  it("switches a bTimeLight light off outside its on window, adding no colour over the ambient, and keeps it on inside, at the build hour 6", () => {
    const record = lightmapRecord(0, 0, 4, 2, [singleTexelShadow]);
    const steady = resolvedImage(composeRebuiltLightmapRequest(request([record], [rebuildLightActor("Engine.Light", pointLightFields)]), tables));
    const timed = (lightOnTime: number, lightOffTime: number) => resolvedImage(composeRebuiltLightmapRequest(request([record],
      [rebuildLightActor("Engine.Light", { ...pointLightFields, bTimeLight: true, LightOnTime: lightOnTime, LightOffTime: lightOffTime })]), tables));
    expect(atlasBgra(timed(19, 5).rgba, 0, 0).slice(0, 3)).toEqual([40, 40, 40]);
    expect(timed(0, 12).rgba).toEqual(steady.rgba);
  });
});
