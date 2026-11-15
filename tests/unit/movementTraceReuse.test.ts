import { beforeEach, describe, expect, it, vi } from "vitest";
import { crossProduct } from "../../src/shared/math/vector3";
import { convexHullClipPlanes, type ConvexHull } from "../../src/scene/world/movement/core/convexHullClip";
import { residentPrimitives } from "../../src/scene/world/movement/core/residentPrimitives";
import { staticMeshOverlapsBox, traceStaticMesh } from "../../src/scene/world/movement/core/staticMeshTrace";
import {
  collisionWorldFromFixtures, committedMovementRules, mixedChunkArrays, placementTranslation,
} from "../fixtures/movement/movementCollisionFixtures";

vi.mock("../../src/shared/math/vector3", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/shared/math/vector3")>();
  return { ...actual, crossProduct: vi.fn(actual.crossProduct) };
});

const rules = committedMovementRules();
const pawnExtent = { x: 9, y: 9, z: 23 };
const [placementX, placementY, placementZ] = placementTranslation;

function fixturePlacement() {
  const cell = collisionWorldFromFixtures(mixedChunkArrays(), null).residentCells()[0]!;
  const placement = cell.placements[0]!;
  return { mesh: cell.staticMeshes[placement.staticMeshIndex!]!, matrix: placement.matrix };
}

beforeEach(() => {
  vi.mocked(crossProduct).mockClear();
});

describe("static mesh traces against a placement's world bounds", () => {
  it("builds and clips none of a placement's triangles for a box sweep or overlap that misses its world bounds", () => {
    const { mesh, matrix } = fixturePlacement();
    const farSweep = { start: { x: placementX - 400, y: placementY, z: placementZ + 100 }, end: { x: placementX - 300, y: placementY, z: placementZ - 100 }, extent: pawnExtent };
    expect(traceStaticMesh(mesh, matrix, farSweep, rules)).toBeNull();
    expect(staticMeshOverlapsBox(mesh, matrix, farSweep.start, pawnExtent)).toBe(false);
    expect(crossProduct).not.toHaveBeenCalled();
  });

  it("still clips the triangles of a placement whose world bounds the sweep reaches", () => {
    const { mesh, matrix } = fixturePlacement();
    const landingSweep = { start: { x: placementX + 128, y: placementY + 128, z: placementZ + 100 }, end: { x: placementX + 128, y: placementY + 128, z: placementZ - 100 }, extent: pawnExtent };
    expect(traceStaticMesh(mesh, matrix, landingSweep, rules)).toMatchObject({ normal: { x: 0, y: 0, z: 1 } });
    expect(crossProduct).toHaveBeenCalled();
  });
});

describe("trace setup reuse", () => {
  it("returns the same clip planes for the same convex hull and rules", () => {
    const hull: ConvexHull = {
      planes: [{ normal: { x: 1, y: 0, z: 0 }, w: 64 }, { normal: { x: 0, y: 1, z: 0 }, w: 64 }],
      boxMinimum: { x: -64, y: -64, z: -64 }, boxMaximum: { x: 64, y: 64, z: 64 },
    };
    expect(convexHullClipPlanes(hull, rules)).toBe(convexHullClipPlanes(hull, rules));
  });

  it("keeps the volume, placement and terrain primitives of a resident cell across traces", () => {
    const world = collisionWorldFromFixtures(mixedChunkArrays(), null);
    const first = residentPrimitives(world, {}, rules), second = residentPrimitives(world, {}, rules);
    const fixedSources = new Set(["blocking-volume", "static-mesh-slots", "terrain-heightmap"]);
    const fixedOf = (primitives: typeof first) => primitives.filter(primitive => fixedSources.has(primitive.source));
    expect(fixedOf(first)).toHaveLength(3);
    fixedOf(first).forEach((primitive, index) => expect(fixedOf(second)[index]).toBe(primitive));
  });
});
