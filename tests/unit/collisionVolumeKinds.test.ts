import { describe, expect, it } from "vitest";
import { CollisionWorldError } from "../../src/scene/world/movement/core/collisionWorld";
import { decodeNativeTileCollisionCell } from "../../src/scene/world/movement/core/decodeNativeTileCollision";
import { blockingBoxVolume, emptyChunkArrays, fixtureCellId, fixtureTileId, volumeArrays, waterPhysicsVolume } from "../fixtures/movement/movementCollisionFixtures";
import { readCollisionFixturePayload, replaceFixtureArray } from "../support/nativeTileCollisionFixture";
import type { TypedPayloadFixtureArray } from "../support/typedPayloadFixture";

const kindedVolumeArrays = (): TypedPayloadFixtureArray[] => [
  ...volumeArrays([blockingBoxVolume, waterPhysicsVolume]),
  ...emptyChunkArrays().filter(array => !array.name.startsWith("VOLS.")),
];
const decodeVolumes = (arrays: readonly TypedPayloadFixtureArray[]) =>
  decodeNativeTileCollisionCell(readCollisionFixturePayload(arrays), { cellId: fixtureCellId, tileId: fixtureTileId }).volumes;

describe("VOLS volume kinds and physics fields", () => {
  it("decodes the kind, water flag and priority of each volume with their provenance", () => {
    const [blocking, water] = decodeVolumes(kindedVolumeArrays());
    expect(blocking).toMatchObject({
      kind: "blocking", water: null, priority: null, gravity: null, terminalVelocity: null,
      physicsFieldProvenance: { water: "unresolved", priority: "unresolved", gravity: "unresolved", terminalVelocity: "unresolved" },
    });
    expect(water).toMatchObject({
      kind: "physics", water: true, priority: 0, gravity: null, terminalVelocity: null,
      physicsFieldProvenance: { water: "authored", priority: "authored", gravity: "unresolved", terminalVelocity: "unresolved" },
    });
  });

  it("decodes a resolved gravity vector and terminal velocity in source units", () => {
    let arrays = replaceFixtureArray(kindedVolumeArrays(), "VOLS.gravity", [0, 0, 0, 0, 0, -950]);
    arrays = replaceFixtureArray(arrays, "VOLS.terminalVelocity", [0, 1200]);
    arrays = replaceFixtureArray(arrays, "VOLS.physicsFieldProvenance", [3, 3, 3, 3, 0, 0, 1, 1]);
    const [, water] = decodeVolumes(arrays);
    expect(water).toMatchObject({ gravity: [0, 0, -950], terminalVelocity: 1200 });
    expect(water!.physicsFieldProvenance).toEqual({ water: "authored", priority: "authored", gravity: "class-default", terminalVelocity: "class-default" });
  });

  it("refuses a kind array whose length differs from the volume count", () => {
    const arrays = replaceFixtureArray(kindedVolumeArrays(), "VOLS.kind", [0]);
    expect(() => decodeVolumes(arrays)).toThrow(CollisionWorldError);
    expect(() => decodeVolumes(arrays)).toThrow("VOLS.kind holds 1 values; 2 are declared.");
  });

  it("refuses an unknown kind code, a water flag that is not 0 or 1, and a provenance array of the wrong length", () => {
    expect(() => decodeVolumes(replaceFixtureArray(kindedVolumeArrays(), "VOLS.kind", [0, 2]))).toThrow("VOLS.kind[1] holds the unknown code 2.");
    expect(() => decodeVolumes(replaceFixtureArray(kindedVolumeArrays(), "VOLS.water", [0, 2]))).toThrow("VOLS.water[1] must be 0 or 1, not 2.");
    expect(() => decodeVolumes(replaceFixtureArray(kindedVolumeArrays(), "VOLS.physicsFieldProvenance", [3, 3, 3, 3])))
      .toThrow("VOLS.physicsFieldProvenance holds 4 values; 8 are declared.");
    expect(() => decodeVolumes(replaceFixtureArray(kindedVolumeArrays(), "VOLS.physicsFieldProvenance", [3, 3, 3, 3, 4, 0, 3, 3])))
      .toThrow("VOLS.physicsFieldProvenance[4] holds the unknown code 4.");
  });

  it("refuses a gravity or terminal velocity that is not finite", () => {
    expect(() => decodeVolumes(replaceFixtureArray(kindedVolumeArrays(), "VOLS.terminalVelocity", [0, Number.NaN])))
      .toThrow("VOLS.terminalVelocity[1] = NaN is not finite.");
  });
});
