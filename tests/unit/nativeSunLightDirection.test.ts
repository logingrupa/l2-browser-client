import { describe, expect, it } from "vitest";
import { ENVIRONMENT_ENGINE_CONSTANTS } from "../../src/environment/model/nativeEnvironmentEngineConstants";
import { nativeSunLightDirection } from "../../src/environment/model/nativeSunLightDirection";
import { readStaticMeshLightingFixtures } from "../support/staticMeshLightingFixtures";
import { timeTablesDocument } from "../support/worldTimeOfDayFixture";

const { fixtures } = readStaticMeshLightingFixtures();
const slopeSunAngleDegrees = Number(timeTablesDocument().setup.values.SlopeSunAngle.value);
const phiDegrees = ENVIRONMENT_ENGINE_CONSTANTS.celestialPhiDegrees.value;
const dayPartOfMidday = 1;

describe("NMovableSunLight.Tick sun direction (0x105d8150, RM-10 fixtures)", () => {
  it.each(fixtures.map(fixture => [fixture.hour, fixture] as const))("matches the native rotation and Rotation.Vector direction bit for bit at hour %f", (_, fixture) => {
    const sun = nativeSunLightDirection({ hour: fixture.hour, dayPart: dayPartOfMidday, phiDegrees, slopeSunAngleDegrees });
    expect(sun.body).toBe("sun");
    expect([sun.rotation.pitch, sun.rotation.yaw, sun.rotation.roll]).toEqual(fixture.rotation);
    expect([sun.direction.x, sun.direction.y, sun.direction.z]).toEqual(fixture.direction);
  });

  it("takes the moon only in day part 3, and with no slope the noon light points 60 degrees down toward -X, both angles truncated toward zero", () => {
    expect(nativeSunLightDirection({ hour: 3, dayPart: 3, phiDegrees, slopeSunAngleDegrees }).body).toBe("moon");
    expect(nativeSunLightDirection({ hour: 5.99, dayPart: 0, phiDegrees, slopeSunAngleDegrees }).body).toBe("sun");
    const flat = nativeSunLightDirection({ hour: 12, dayPart: dayPartOfMidday, phiDegrees, slopeSunAngleDegrees: 0 });
    expect([flat.rotation.pitch, flat.rotation.yaw]).toEqual([-10922, -32767]);
  });
});
