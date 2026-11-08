import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { createWorldNavigation } from "../../src/world/meshNavigation";

const scenes: Scene[] = [];
function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scenes.push(scene);
  function mesh(name: string, vertices: number[], indices = [0, 1, 2, 0, 2, 3]) {
    const result = new Mesh(name, scene), data = new VertexData();
    data.positions = vertices; data.indices = indices; data.applyToMesh(result);
    return result;
  }
  function floor(name: string, minX: number, maxX: number, minZ: number, maxZ: number, y: number) {
    return mesh(name, [minX, y, minZ, minX, y, maxZ, maxX, y, maxZ, maxX, y, minZ]);
  }
  return { scene, mesh, floor };
}
afterEach(() => { for (const scene of scenes.splice(0)) { const engine = scene.getEngine(); scene.dispose(); engine.dispose(); } });

describe("mesh navigation", () => {
  it("uses explicit native actor dimensions instead of the default capsule", () => {
    const { floor } = fixture();
    const terrain = floor("terrain", -2, 2, -2, 2, 0), ceiling = floor("ceiling", -2, 2, -2, 2, .6);
    const options = { terrainMeshes: [terrain], obstacleMeshes: () => [ceiling], origin: { x: 0, y: 0, z: 0 } };
    expect(createWorldNavigation(options).move(options.origin, { x: .2, y: 0, z: 0 }).blocked).toBe(true);
    expect(createWorldNavigation({ ...options, capsule: { radius: .09, height: .46 } }).move(options.origin, { x: .2, y: 0, z: 0 }).blocked).toBe(false);
    expect(() => createWorldNavigation({ ...options, capsule: { radius: NaN, height: .46 } })).toThrow(/dimensions/);
  });
  it("grounds source coordinates and detects terrain edges without a ground-plane clamp", () => {
    const { floor } = fixture();
    const terrain = floor("terrain", 4500, 4520, 1500, 1520, -60);
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [], origin: { x: 4510, y: -60, z: 1510 } });
    expect(navigation.spawn()).toEqual({ x: 4510, y: -60, z: 1510 });
    expect(navigation.destination({ x: 4512, y: -60, z: 1512 })).toEqual({ x: 4512, y: -60, z: 1512 });
    const moved = navigation.move({ x: 4510, y: -60, z: 1510 }, { x: 4521, y: -60, z: 1510 });
    expect(moved.blocked).toBe(true);
    expect(moved.position.x).toBeLessThan(4520);
    expect(moved.position.y).toBe(-60);
  });

  it("uses reachable interior floors and steps while excluding roofs above the character", () => {
    const { floor } = fixture();
    const terrain = floor("terrain", -10, 10, -10, 10, 0);
    const step = floor("step", 0, 4, -2, 2, .25), roof = floor("roof", -4, 4, -4, 4, 2);
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [step, roof], origin: { x: -1, y: 0, z: 0 } });
    const moved = navigation.move({ x: -.5, y: 0, z: 0 }, { x: 1, y: .25, z: 0 });
    expect(moved.blocked).toBe(false);
    expect(moved.position.y).toBeCloseTo(.25);
    expect(navigation.ground({ x: 1, y: .25, z: 0 })?.y).toBeCloseTo(.25);
  });

  it("resolves elevated location anchors from terrain before selecting an interior floor", () => {
    const { floor } = fixture();
    const terrain = floor("terrain", -10, 10, -10, 10, 0);
    const interior = floor("interior", -4, 4, -4, 4, .25), roof = floor("roof", -4, 4, -4, 4, 2);
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [interior, roof], origin: { x: 0, y: 4, z: 0 } });
    expect(navigation.spawn()).toEqual({ x: 0, y: .25, z: 0 });
  });

  it("does not step across a terrain hole narrower than the movement sample spacing", () => {
    const { floor } = fixture();
    const left = floor("left", -4, .011, -4, 4, 0), right = floor("right", .012, 4, -4, 4, 0);
    const navigation = createWorldNavigation({ terrainMeshes: [left, right], obstacleMeshes: () => [], origin: { x: -1, y: 0, z: 0 } });
    const moved = navigation.move({ x: -.5, y: 0, z: 0 }, { x: .5, y: 0, z: 0 });
    expect(moved.blocked).toBe(true);
    expect(moved.position.x).toBeLessThan(.011);
  });

  it("sweeps a finite capsule against thin walls even when their visual roots are hidden", () => {
    const { floor, mesh } = fixture();
    const terrain = floor("terrain", -10, 10, -10, 10, 0);
    const wall = mesh("wall", [0, 0, -3, 0, 2, -3, 0, 2, 3, 0, 0, 3]);
    wall.setEnabled(false);
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [wall], origin: { x: -1, y: 0, z: 0 } });
    const moved = navigation.move({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(moved.blocked).toBe(true);
    expect(moved.position.x).toBeLessThanOrEqual(-.1);
    expect(moved.position.x).toBeGreaterThan(-.2);
  });

  it("rejects low ceilings and steep terrain", () => {
    const { floor, mesh } = fixture();
    const terrain = floor("terrain", -10, 10, -10, 10, 0), ceiling = floor("ceiling", -2, 2, -2, 2, .7);
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [ceiling], origin: { x: 0, y: 0, z: 0 } });
    expect(navigation.move({ x: 0, y: 0, z: 0 }, { x: .2, y: 0, z: 0 }).blocked).toBe(true);
    const steep = mesh("steep", [-4, -8, -4, -4, -8, 4, 4, 8, 4, 4, 8, -4]);
    const slope = createWorldNavigation({ terrainMeshes: [steep], obstacleMeshes: () => [], origin: { x: 0, y: 0, z: 0 } });
    expect(slope.ground({ x: 0, y: 0, z: 0 })).toBeNull();
  });

  it("retains mirrored floor orientation and discovers streamed colliders", () => {
    const { floor, mesh } = fixture();
    const terrain = floor("terrain", -10, 10, -10, 10, 0), mirrored = floor("mirrored", -2, 2, -2, 2, .2);
    mirrored.scaling.x = -1;
    const obstacles = [mirrored];
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => obstacles, origin: { x: 0, y: .2, z: 0 } });
    expect(navigation.ground({ x: 0, y: .2, z: 0 })?.y).toBeCloseTo(.2);
    obstacles.push(mesh("streamed wall", [0, 0, -3, 0, 2, -3, 0, 2, 3, 0, 0, 3]));
    expect(navigation.move({ x: -1, y: .2, z: 0 }, { x: 1, y: .2, z: 0 }).blocked).toBe(true);
  });

  it("excludes only explicitly disabled collider meshes and foliage floor support", () => {
    const { floor, mesh } = fixture();
    const terrain = floor("terrain", -10, 10, -10, 10, 0), leaf = floor("leaf", -2, 2, -2, 2, .2);
    leaf.metadata = { worldSupportsWalking: false };
    const disabled = mesh("disabled flag", [0, 0, -3, 0, 2, -3, 0, 2, 3, 0, 0, 3]);
    disabled.metadata = { worldCollision: false };
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [leaf, disabled], origin: { x: 0, y: 0, z: 0 } });
    expect(navigation.ground({ x: 0, y: 0, z: 0 })?.y).toBe(0);
    const onlyDisabled = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [disabled], origin: { x: -1, y: 0, z: 0 } });
    expect(onlyDisabled.move({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }).blocked).toBe(false);
  });
});
