import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fGetHsv } from "../../src/environment/model/fGetHsv";
import { lightmapAmbientBgra } from "../../src/environment/model/lightmapRebuild/lightmapAmbientColour";

interface ZoneAmbientInput {
  readonly AmbientHue: number;
  readonly AmbientSaturation: number;
  readonly AmbientBrightness: number;
}

interface HsvFixture {
  readonly function: string;
  readonly input: { readonly hue: number; readonly saturation: number; readonly brightness: number; readonly controlWord: string };
  readonly hsvPlane: readonly number[];
  readonly resultBGRA: readonly number[];
}

interface BuilderFixture {
  readonly function: string;
  readonly input: {
    readonly controlWord: string;
    readonly zone: ZoneAmbientInput;
    readonly lightmaps: readonly { readonly offsetX: number; readonly width: number; readonly height: number }[];
  };
  readonly resultBytesHex: string;
}

interface AmbientNativeDocument {
  readonly fixtures: readonly (HsvFixture | BuilderFixture)[];
  readonly first16: { readonly map: string; readonly zone: ZoneAmbientInput; readonly resultFirst16BGRA: readonly (readonly number[])[] };
}

interface SmallAmbientFixture {
  readonly function: string;
  readonly hsvPlane: readonly number[];
  readonly resultBGRA: readonly number[];
}

const readFixture = <Document>(fileName: string) => JSON.parse(readFileSync(new URL(`../fixtures/db16/${fileName}`, import.meta.url), "utf8")) as Document;
const document = readFixture<AmbientNativeDocument>("ambient-native.json");
const smallAmbientFixtures = readFixture<{ readonly ambientFixtures: readonly SmallAmbientFixture[] }>("dynamic-light-small-native.json").ambientFixtures;
const hsvFixtures = document.fixtures.filter((fixture): fixture is HsvFixture => fixture.function.startsWith("FColor(FGetHSV"));
const builderFixtures = document.fixtures.filter((fixture): fixture is BuilderFixture => fixture.function.startsWith("0x10675390"));

const zoneAmbient = (zone: ZoneAmbientInput) => ({ hue: zone.AmbientHue, saturation: zone.AmbientSaturation, brightness: zone.AmbientBrightness });

function firstRowBytesOfAtlas(fixture: BuilderFixture): string {
  const ambient = lightmapAmbientBgra(zoneAmbient(fixture.input.zone));
  return fixture.input.lightmaps.flatMap(lightmap => new Array<readonly number[]>(lightmap.width).fill(ambient))
    .flat().map(byte => byte.toString(16).padStart(2, "0")).join("");
}

describe("lightmap ambient FColor(FGetHSV(H, S, V) * 0.5) against native Unicorn runs", () => {
  it("covers the five FGetHSV fixtures and the two builder fixtures", () => {
    expect(hsvFixtures).toHaveLength(5);
    expect(builderFixtures.map(fixture => fixture.input.controlWord)).toEqual(["0x37f", "0x7f"]);
  });

  it.each(hsvFixtures.map(fixture => [fixture.input.brightness, fixture] as const))("matches FGetHSV(0, 255, %s) bit for bit and its halved BGRA", (_brightness, fixture) => {
    const { hue, saturation, brightness } = fixture.input;
    Array.from(fGetHsv(hue, saturation, brightness)).forEach((component, index) => expect(Object.is(component, fixture.hsvPlane[index])).toBe(true));
    expect(lightmapAmbientBgra({ hue, saturation, brightness })).toEqual(fixture.resultBGRA);
  });

  it.each(builderFixtures.map(fixture => [fixture.input.controlWord, fixture] as const))(
    "fills the first atlas row of two 8-texel lightmaps like the native builder block at control word %s", (_controlWord, fixture) => {
      expect(firstRowBytesOfAtlas(fixture)).toBe(fixture.resultBytesHex);
    });

  it("reproduces the 20_20 first sixteen static texels of page 0 row 0 from ZoneInfo23", () => {
    expect(document.first16.map).toBe("20_20");
    const ambient = lightmapAmbientBgra(zoneAmbient(document.first16.zone));
    expect(document.first16.resultFirst16BGRA.every(texel => texel.every((byte, index) => byte === ambient[index]))).toBe(true);
    expect(ambient).toEqual([40, 40, 40, 127]);
  });

  it("reproduces the DB-17 20_10 ambient FColor(FGetHSV(140, 80, 70) * 0.5) at control word 0x027f", () => {
    expect(smallAmbientFixtures.map(fixture => fixture.function)).toEqual(["FColor(FGetHSV(140,80,70)*0.5)"]);
    const [fixture] = smallAmbientFixtures;
    Array.from(fGetHsv(140, 80, 70)).forEach((component, index) => expect(Object.is(component, fixture!.hsvPlane[index])).toBe(true));
    expect(lightmapAmbientBgra({ hue: 140, saturation: 80, brightness: 70 })).toEqual(fixture!.resultBGRA);
  });
});
