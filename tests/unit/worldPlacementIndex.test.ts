import { describe, expect, it } from "vitest";
import { WorldPlacementIndex } from "../../src/scene/world/worldPlacementIndex";

describe("source placement collision readiness index", () => {
  it("matches an exhaustive sphere search across negative coordinates, cell edges and vertical layers", () => {
    const index = new WorldPlacementIndex<number>();
    const spheres = Array.from({ length: 600 }, (_, item) => ({
      value: item % 123,
      x: Math.sin(item * 17) * 180,
      y: item % 5 * 7 - 70,
      z: Math.cos(item * 19) * 180,
      radius: item % 19 * 2,
    }));
    for (const sphere of spheres) index.add(sphere.value, sphere, sphere.radius);
    for (let query = 0; query < 60; query++) {
      const point = { x: query % 12 * 32 - 180, y: -70 + query % 4 * 8, z: Math.sin(query) * 180 };
      const radius = query % 4 === 0 ? 1 : 24;
      const expected = [...new Set(spheres.filter(sphere => Math.hypot(sphere.x - point.x, sphere.y - point.y, sphere.z - point.z) - sphere.radius < radius).map(sphere => sphere.value))].sort((a, b) => a - b);
      expect(index.nearby(point, radius).sort((a, b) => a - b)).toEqual(expected);
    }
  });
  it("does not multiply grid storage for broad objects or loop across huge query grids", () => {
    const index = new WorldPlacementIndex<string>();
    index.add("broad", { x: 0, y: 0, z: 0 }, 1_000_000);
    index.add("small", { x: -32, y: -70, z: 32 }, 0.5);
    index.add("high", { x: -32, y: 2000, z: 32 }, 0.5);
    expect(index.nearby({ x: -32, y: -70, z: 32 }, 1)).toEqual(["small", "broad"]);
    expect(index.nearby({ x: 0, y: 0, z: 0 }, 1_000_000).sort()).toEqual(["broad", "high", "small"]);
  });
  it("preserves strict sphere boundaries and rejects nonfinite bounds", () => {
    const index = new WorldPlacementIndex<string>();
    index.add("sphere", { x: 32, y: 0, z: 0 }, 1);
    expect(index.nearby({ x: 30, y: 0, z: 0 }, 1)).toEqual([]);
    expect(index.nearby({ x: 30.001, y: 0, z: 0 }, 1)).toEqual(["sphere"]);
    expect(() => index.nearby({ x: Infinity, y: 0, z: 0 }, 1)).toThrow("Invalid");
    expect(() => index.add("bad", { x: 0, y: 0, z: 0 }, -1)).toThrow("Invalid");
  });
});
