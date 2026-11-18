import { describe, expect, it } from "vitest";
import { localPawnLocationProvider } from "../../src/runtime/localPawnLocation";
import type { WorldPosition } from "../../src/world/sourceFrame";

const collisionHeightMetres = 0.23;
const authoritativeFeet: WorldPosition = { x: 91.8, y: -36.96, z: 1193.8 };

describe("localPawnLocationProvider", () => {
  it("follows the moving movement pose feet, not the authoritative destination, and raises them by the collision height to the Pawn Location", () => {
    let movementFeet: WorldPosition | null = { x: 90, y: -36.96, z: 1190 };
    const pawn = localPawnLocationProvider({ movementFeet: () => movementFeet, entityFeet: () => authoritativeFeet, collisionHeightMetres });
    expect(pawn.feet()).toEqual({ x: 90, y: -36.96, z: 1190 });
    expect(pawn.location()).toEqual({ x: 90, y: -36.96 + collisionHeightMetres, z: 1190 });
    movementFeet = { x: 91, y: -36.96, z: 1192 };
    expect(pawn.location()).toEqual({ x: 91, y: -36.96 + collisionHeightMetres, z: 1192 });
  });

  it("falls back to the entity feet without a movement pose and is null without a local pawn", () => {
    expect(localPawnLocationProvider({ movementFeet: () => null, entityFeet: () => authoritativeFeet, collisionHeightMetres }).location())
      .toEqual({ ...authoritativeFeet, y: authoritativeFeet.y + collisionHeightMetres });
    const absent = localPawnLocationProvider({ movementFeet: () => null, entityFeet: () => null, collisionHeightMetres });
    expect(absent.feet()).toBeNull();
    expect(absent.location()).toBeNull();
  });
});
