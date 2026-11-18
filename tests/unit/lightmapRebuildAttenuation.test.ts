import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attenuateShadowIntensities, lightAttenuationBranch, type AttenuationLight } from "../../src/environment/model/lightmapRebuild/lightAttenuation";
import { buildLightingTables } from "../../src/environment/model/lightmapRebuild/lightingTables";
import type { NativeVector3 } from "../../src/environment/model/lightmapRebuild/lightmapRebuildTypes";
import { rotatorVector } from "../../src/environment/model/lightmapRebuild/rotatorVector";

interface AttenuationFixture {
  readonly label: string;
  readonly controlWord: string;
  readonly input: {
    readonly effect: number;
    readonly radius: number;
    readonly position: NativeVector3;
    readonly normal: NativeVector3;
    readonly polyFlags: string;
    readonly rotation: readonly [pitch: number, yaw: number, roll: number];
    readonly cone: number;
    readonly direction: NativeVector3;
    readonly origin: NativeVector3;
    readonly uStep: NativeVector3;
    readonly vStep: NativeVector3;
    readonly rect: readonly [minimumX: number, minimumY: number, maximumX: number, maximumY: number];
    readonly dimensions: readonly [width: number, height: number];
    readonly shadowBytes: readonly number[];
  };
  readonly output: readonly number[];
}

const document = JSON.parse(readFileSync(new URL("../fixtures/db16/attenuation-native.json", import.meta.url), "utf8")) as { readonly fixtures: readonly AttenuationFixture[] };
const tables = buildLightingTables();
const float32Vector = (vector: NativeVector3): NativeVector3 => [Math.fround(vector[0]), Math.fround(vector[1]), Math.fround(vector[2])];

function fixtureLight({ input }: AttenuationFixture): AttenuationLight {
  const branch = lightAttenuationBranch(input.effect);
  if (branch.status !== "resolved") throw new Error(`Fixture effect ${input.effect} is unported: ${branch.reason}.`);
  const position = float32Vector(input.position), radius = Math.fround(input.radius);
  switch (branch.value) {
    case "sun-direction": return { branch: "sun-direction", direction: float32Vector(input.direction) };
    case "point-falloff": return { branch: "point-falloff", position, radius };
    case "spot-cone": {
      const [pitch, yaw, roll] = input.rotation;
      return { branch: "spot-cone", position, radius, cone: input.cone, spotDirection: rotatorVector({ pitch, yaw, roll }) };
    }
  }
}

function attenuateFixture(fixture: AttenuationFixture): number[] {
  const { input } = fixture;
  const [minimumX, minimumY, maximumX, maximumY] = input.rect;
  const [width, height] = input.dimensions;
  return Array.from(attenuateShadowIntensities({
    filteredMask: { bytes: Uint8Array.from(input.shadowBytes), rowStride: maximumX - minimumX + 1 },
    record: { minimumX, minimumY, maximumX, maximumY },
    surface: { normal: float32Vector(input.normal), polyFlags: Number.parseInt(input.polyFlags, 16) },
    lightmap: { width, height, origin: float32Vector(input.origin), uStep: float32Vector(input.uStep), vStep: float32Vector(input.vStep) },
    tables,
  }, fixtureLight(fixture)));
}

describe("ordinary light attenuation 0x10671890 against native CW 0x027f runs", () => {
  it("covers effects 0, 8, 12 and 19 with two-sided sun, radius below 1 and large radii", () => {
    expect(document.fixtures.map(fixture => fixture.input.effect)).toEqual([0, 0, 0, 0, 8, 8, 12, 12, 19, 19, 19]);
    expect(document.fixtures.every(fixture => fixture.controlWord === "0x027f")).toBe(true);
  });

  it.each(document.fixtures.map(fixture => [fixture.label, fixture] as const))("matches the %s fixture byte for byte", (_label, fixture) => {
    expect(attenuateFixture(fixture)).toEqual(fixture.output);
  });
});

describe("light effect dispatch of 0x10671890", () => {
  it.each([[0x13, "sun-direction"], [8, "spot-cone"], [12, "spot-cone"], [0, "point-falloff"], [1, "point-falloff"], [7, "point-falloff"], [15, "point-falloff"], [21, "point-falloff"], [255, "point-falloff"]] as const)(
    "sends LightEffect %s to the %s branch", (lightEffect, branch) => {
      expect(lightAttenuationBranch(lightEffect)).toEqual({ status: "resolved", value: branch });
    });

  it.each([4, 5, 6, 9, 10, 13, 14, 16, 17, 18, 20])("leaves LightEffect %s with its own unported branch unresolved", lightEffect => {
    expect(lightAttenuationBranch(lightEffect)).toEqual({ status: "unresolved", reason: `bsp-rebuild-light-effect-unported:${lightEffect}` });
  });

  it("refuses a LightEffect that is not a byte", () => {
    expect(() => lightAttenuationBranch(256)).toThrow(RangeError);
    expect(() => lightAttenuationBranch(1.5)).toThrow(RangeError);
  });
});

describe("sun direction attenuation guard", () => {
  it("refuses a record that does not cover the lightmap the native loop walks", () => {
    expect(() => attenuateShadowIntensities({
      filteredMask: { bytes: Uint8Array.from([254, 100]), rowStride: 2 },
      record: { minimumX: 0, minimumY: 0, maximumX: 1, maximumY: 0 },
      surface: { normal: [0, 0, 1], polyFlags: 0 },
      lightmap: { width: 2, height: 2, origin: [0, 0, 0], uStep: [1, 0, 0], vStep: [0, 1, 0] },
      tables,
    }, { branch: "sun-direction", direction: [0, 0, -1] })).toThrow(RangeError);
  });
});
