import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { createWorldNavigation } from "../../src/scene/navigation/meshNavigation";

const scenes: Scene[] = [];
function fixture() {
  const scene = new Scene(new NullEngine());
  scene.useRightHandedSystem = true;
  scenes.push(scene);
  const quad = (name: string, positions: number[]) => {
    const mesh = new Mesh(name, scene), vertices = new VertexData();
    vertices.positions = positions; vertices.indices = [0, 1, 2, 0, 2, 3]; vertices.applyToMesh(mesh);
    return mesh;
  };
  const floor = (name: string, minX = -40, maxX = 40, y = 0) =>
    quad(name, [minX, y, -4, minX, y, 4, maxX, y, 4, maxX, y, -4]);
  const terrain = floor("terrain");
  const door = () => {
    const hinge = new TransformNode("hinge", scene);
    hinge.position.x = -1;
    const leaf = quad("door leaf", [0, 0, 0, 0, 2, 0, 2, 2, 0, 2, 0, 0]);
    leaf.parent = hinge;
    return { hinge, leaf };
  };
  return { scene, quad, floor, terrain, door };
}
afterEach(() => { for (const scene of scenes.splice(0)) { const engine = scene.getEngine(); scene.dispose(); engine.dispose(); } });

describe("moving navigation obstacles", () => {
  const from = { x: 0, y: 0, z: -1 }, to = { x: 0, y: 0, z: 1 };

  it("blocks the closed leaf and permits the passage after its hinge rotates, then blocks again", () => {
    const { terrain, door } = fixture(), { hinge, leaf } = door();
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [],
      dynamicObstacleMeshes: () => [leaf], origin: from });
    const closed = navigation.move(from, to);
    expect(closed.blocked).toBe(true);
    expect(closed.position.z).toBeLessThan(-.1);
    expect(closed.contact?.samples).toHaveLength(9);
    hinge.rotation.y = Math.PI / 2;
    const open = navigation.move(from, to);
    expect(open.blocked).toBe(false); expect(open.position).toEqual(to);
    expect(open.contact?.samples.every(sample => sample.meshUniqueId === terrain.uniqueId)).toBe(true);
    hinge.rotation.y = 0;
    expect(navigation.move(from, to).blocked).toBe(true);
  });

  it("moves collision across spatial cells without leaving the old location blocked", () => {
    const { terrain, door } = fixture(), { leaf } = door();
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [],
      dynamicObstacleMeshes: () => [leaf], origin: from });
    expect(navigation.move(from, to).blocked).toBe(true);
    leaf.position.x = 24;
    expect(navigation.move(from, to)).toMatchObject({ blocked: false, position: to });
    expect(navigation.move({ ...from, x: 24 }, { ...to, x: 24 }).blocked).toBe(true);
    leaf.position.x = -24;
    expect(navigation.move({ ...from, x: 24 }, { ...to, x: 24 }).blocked).toBe(false);
    expect(navigation.move({ ...from, x: -24 }, { ...to, x: -24 }).blocked).toBe(true);
  });

  it("never uses moving geometry as walking support, including across a terrain gap", () => {
    const { terrain, floor } = fixture();
    const platform = floor("moving platform", -2, 2, .2);
    platform.metadata = { worldSupportsWalking: true };
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [],
      dynamicObstacleMeshes: () => [platform], origin: from });
    expect(navigation.ground({ x: 0, y: .2, z: 0 })?.y).toBe(0);
    const contact = navigation.groundContact!({ x: 0, y: .2, z: 0 });
    expect(contact?.samples.every(sample => sample.meshUniqueId === terrain.uniqueId)).toBe(true);
    const bridge = floor("moving bridge", -2, 2);
    bridge.metadata = { worldSupportsWalking: true };
    const gap = createWorldNavigation({ terrainMeshes: [floor("left", -4, -.2), floor("right", .2, 4)],
      obstacleMeshes: () => [], dynamicObstacleMeshes: () => [bridge], origin: { x: -1, y: 0, z: 0 } });
    expect(gap.ground({ x: 0, y: 0, z: 0 })).toBeNull();
    expect(gap.move({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }).blocked).toBe(true);
  });

  it("drops removed and disposed dynamic blockers without retaining cached collision", () => {
    const { terrain, door } = fixture(), { leaf } = door();
    let obstacles = [leaf];
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [],
      dynamicObstacleMeshes: () => obstacles, origin: from });
    expect(navigation.move(from, to).blocked).toBe(true);
    obstacles = [];
    expect(navigation.move(from, to).blocked).toBe(false);
    obstacles = [leaf];
    expect(navigation.move(from, to).blocked).toBe(true);
    leaf.dispose();
    expect(navigation.move(from, to).blocked).toBe(false);
  });

  it("accepts same-count replacements and explicit collision flags independently of visibility", () => {
    const { terrain, door } = fixture(), first = door().leaf, second = door().leaf;
    second.position.x = 24;
    let obstacles = [first];
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [],
      dynamicObstacleMeshes: () => obstacles, origin: from });
    first.setEnabled(false);
    expect(navigation.move(from, to).blocked).toBe(true);
    first.metadata = { worldCollision: false };
    expect(navigation.move(from, to).blocked).toBe(false);
    first.metadata = { worldCollision: true };
    expect(navigation.move(from, to).blocked).toBe(true);
    obstacles = [second];
    expect(navigation.move(from, to).blocked).toBe(false);
    expect(navigation.move({ ...from, x: 24 }, { ...to, x: 24 }).blocked).toBe(true);
  });
});
