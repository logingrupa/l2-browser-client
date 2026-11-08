import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { createWorldNavigation } from "../../src/scene/navigation/meshNavigation";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldGroundContact, WorldNavigation, WorldSupportSample } from "../../src/world/WorldNavigation";
import type { WorldPosition } from "../../src/world/worldTypes";

const scenes: Scene[] = [], adapters: NativeSliceAdapter[] = [];
const zero = { x: 0, y: 0, z: 0 };
function fixture() {
  const scene = new Scene(new NullEngine()); scene.useRightHandedSystem = true; scenes.push(scene);
  function mesh(name: string, vertices: number[], indices = [0, 1, 2, 0, 2, 3]) {
    const result = new Mesh(name, scene), data = new VertexData(); data.positions = vertices; data.indices = indices; data.applyToMesh(result); return result;
  }
  const floor = (name: string, minX: number, maxX: number, minZ: number, maxZ: number, y: number) =>
    mesh(name, [minX, y, minZ, minX, y, maxZ, maxX, y, maxZ, maxX, y, minZ]);
  return { scene, mesh, floor };
}
function contact(navigation: WorldNavigation, point: WorldPosition): WorldGroundContact {
  const result = navigation.groundContact?.(point); expect(result).not.toBeNull(); expect(result).toBeDefined(); return result!;
}
function source(sample: WorldSupportSample, mesh: Mesh, indexOffset?: number) {
  expect(sample).toMatchObject({ meshId: mesh.id, meshUniqueId: mesh.uniqueId, meshName: mesh.name });
  expect(sample.indexOffset % 3).toBe(0); expect(sample.triangleIndex).toBe(sample.indexOffset / 3);
  if (indexOffset !== undefined) expect(sample).toMatchObject({ indexOffset, triangleIndex: indexOffset / 3 });
}
function position(actual: WorldPosition, expected: WorldPosition) {
  for (const axis of ["x", "y", "z"] as const) expect(actual[axis]).toBeCloseTo(expected[axis], 9);
}
function nativeAdapter(origin: WorldPosition, navigation?: WorldNavigation) {
  const adapter = new NativeSliceAdapter(origin, navigation, null, undefined, { walkSupported: true }); adapters.push(adapter); return adapter;
}
function player(adapter: NativeSliceAdapter) { return adapter.getInitialState().find(entity => entity.id === "local-player")!; }
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.dispose();
  for (const scene of scenes.splice(0)) { const engine = scene.getEngine(); scene.dispose(); engine.dispose(); }
  vi.restoreAllMocks();
});

describe("original footprint support evidence", () => {
  it("retains nine ordered samples across distinct mesh/material supports and uses the first peripheral maximum", () => {
    const { scene, floor } = fixture(), terrain = floor("two-material terrain", -2, 2, -2, 2, 0);
    const materials = new MultiMaterial("original slots", scene);
    materials.subMaterials = [new StandardMaterial("grass slot", scene), new StandardMaterial("stone slot", scene)]; terrain.material = materials;
    terrain.releaseSubMeshes(); new SubMesh(0, 0, 4, 0, 3, terrain); new SubMesh(1, 0, 4, 3, 3, terrain);
    const east = floor("east raised support", .09, .12, -.02, .01, .25), north = floor("north raised support", -.02, .01, .09, .12, .25);
    east.material = new StandardMaterial("wood slot", scene); north.material = new StandardMaterial("other wood slot", scene);
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [east, north], origin: zero });
    const result = contact(navigation, zero), diagonal = .102 / Math.sqrt(2);
    const offsets = [[0, 0], [.102, 0], [diagonal, diagonal], [0, .102], [-diagonal, diagonal], [-.102, 0], [-diagonal, -diagonal], [0, -.102], [diagonal, -diagonal]];
    expect(result.samples).toHaveLength(9); expect(result.controllingSample).toBe(1);
    expect(result.queryPosition).toEqual(zero); expect(result.position).toEqual({ x: 0, y: .25, z: 0 });
    for (const [index, [x, z]] of offsets.entries()) {
      const sample = result.samples[index]!; position(sample.position, { x: x!, y: index === 1 || index === 3 ? .25 : 0, z: z! });
      source(sample, index === 1 ? east : index === 3 ? north : terrain);
    }
    source(result.samples[0]!, terrain, 0); source(result.samples[7]!, terrain, 3);
    expect(terrain.subMeshes.map(sub => [sub.materialIndex, sub.indexStart, sub.indexCount])).toEqual([[0, 0, 3], [1, 3, 3]]);
    expect(navigation.ground(zero)).toEqual({ x: 0, y: .25, z: 0 });
  });

  it("keeps terrain-first, mesh-order and original triangle-order ties without an artificial height epsilon", () => {
    const { floor } = fixture(), first = floor("first terrain", -2, 2, -2, 2, 0), second = floor("second terrain", -2, 2, -2, 2, 0);
    const obstacle = floor("equal obstacle", -2, 2, -2, 2, 0);
    const navigation = createWorldNavigation({ terrainMeshes: [first, second], obstacleMeshes: () => [obstacle], origin: zero });
    const result = contact(navigation, zero); expect(result.controllingSample).toBe(0);
    for (const sample of result.samples) source(sample, first);
    source(result.samples[0]!, first, 0);
    const reordered = createWorldNavigation({ terrainMeshes: [second, first], obstacleMeshes: () => [obstacle], origin: zero });
    for (const sample of contact(reordered, zero).samples) source(sample, second);
    const slightlyHigher = floor("strictly higher", -2, 2, -2, 2, 1e-6);
    const higher = createWorldNavigation({ terrainMeshes: [first], obstacleMeshes: () => [obstacle, slightlyHigher], origin: zero });
    for (const sample of contact(higher, zero).samples) source(sample, slightlyHigher);
  });

  it("retains the first equally high obstacle when there is no terrain support", () => {
    const { floor } = fixture(), first = floor("first interior", -2, 2, -2, 2, .125), second = floor("second interior", -2, 2, -2, 2, .125);
    const navigation = createWorldNavigation({ terrainMeshes: [], obstacleMeshes: () => [first, second], origin: zero });
    const result = contact(navigation, zero); expect(result.position.y).toBe(.125); expect(result.controllingSample).toBe(0);
    for (const sample of result.samples) source(sample, first);
  });

  it("preserves source triangle ordinal under a mirrored placement instead of reporting reversed vertex order", () => {
    const { floor } = fixture(), interior = floor("mirrored authored floor", -2, 2, -2, 2, .25);
    interior.id = "source-floor-id"; interior.scaling.x = -1; interior.position.set(5, 1, 7);
    const origin = { x: 4, y: 1.25, z: 6 }, navigation = createWorldNavigation({ terrainMeshes: [], obstacleMeshes: () => [interior], origin });
    const result = contact(navigation, origin);
    expect(result.position).toEqual(origin); expect(result.controllingSample).toBe(0);
    for (const sample of result.samples) source(sample, interior, 3);
    expect(Array.from(interior.getIndices()!)).toEqual([0, 1, 2, 0, 2, 3]); expect(interior.scaling.x).toBe(-1);
  });

  it("retains accepted support when a raised requery newly reaches an upper slab and invalidates the footprint", () => {
    const { floor } = fixture(), terrain = floor("terrain", -2, 2, -2, 2, 0);
    const peripheral = floor("peripheral step", .09, .12, -.02, .01, .25), elevated = floor("newly reachable on requery", -.01, .01, -.01, .01, .5);
    const from = { x: -.025, y: 0, z: 0 };
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [peripheral, elevated], origin: from, capsule: { radius: .1, height: .2 } });
    const moved = navigation.move(from, zero);
    expect(moved.blocked).toBe(false); expect(moved.position).toEqual({ x: 0, y: .25, z: 0 });
    expect(moved.contact?.queryPosition).toEqual(zero); expect(moved.contact?.controllingSample).toBe(1);
    source(moved.contact!.samples[0]!, terrain); source(moved.contact!.samples[1]!, peripheral);
    expect(navigation.groundContact!({ x: 0, y: .25, z: 0 })).toBeNull();
    const withoutUpperSlab = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [peripheral], origin: from, capsule: { radius: .1, height: .2 } });
    expect(contact(withoutUpperSlab, { x: 0, y: .25, z: 0 }).position).toEqual({ x: 0, y: .25, z: 0 });
  });

  it("does not turn an excessive footprint height spread into valid support", () => {
    const { floor } = fixture(), terrain = floor("lower", -2, 2, -2, 2, 0), high = floor("high rim", .09, .12, -.02, .01, .5);
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [high], origin: zero });
    expect(navigation.groundContact!({ x: 0, y: .25, z: 0 })).toBeNull();
    expect(navigation.ground({ x: 0, y: .25, z: 0 })).toBeNull();
  });
});

describe("accepted navigation substeps", () => {
  it("reports the actual final accepted substep on a partially blocked thin-wall sweep", () => {
    const { floor, mesh } = fixture(), terrain = floor("terrain", -3, 3, -3, 3, 0);
    const wall = mesh("thin wall", [0, 0, -2, 0, 2, -2, 0, 2, 2, 0, 0, 2]); wall.setEnabled(false);
    const from = { x: -1, y: 0, z: 0 }, navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [wall], origin: from });
    const moved = navigation.move(from, { x: 1, y: 0, z: 0 });
    expect(moved.blocked).toBe(true); position(moved.position, { x: -.125, y: 0, z: 0 });
    expect(moved.contact).toBeDefined(); position(moved.contact!.queryPosition, { x: -.125, y: 0, z: 0 });
    position(moved.contact!.position, { x: -.125, y: 0, z: 0 });
    for (const sample of moved.contact!.samples) source(sample, terrain);
    const blocked = navigation.move({ x: -.125, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(blocked).toEqual({ position: { x: -.125, y: 0, z: 0 }, blocked: true });
    expect(Object.hasOwn(blocked, "contact")).toBe(false);
  });

  it("does not bridge a substep-width hole and keeps only the last support before the gap", () => {
    const { floor } = fixture(), left = floor("left", -3, .011, -3, 3, 0), right = floor("right", .012, 3, -3, 3, 0);
    const from = { x: -.5, y: 0, z: 0 }, navigation = createWorldNavigation({ terrainMeshes: [left, right], obstacleMeshes: () => [], origin: from });
    const moved = navigation.move(from, { x: .5, y: 0, z: 0 });
    expect(moved.blocked).toBe(true); position(moved.position, { x: -.1, y: 0, z: 0 });
    position(moved.contact!.queryPosition, { x: -.1, y: 0, z: 0 });
    for (const sample of moved.contact!.samples) source(sample, left);
  });

  it("omits contact for invalid, unsupported, unready or overlong moves", () => {
    const { floor, mesh } = fixture(), terrain = floor("terrain", -3, 3, -3, 3, 0);
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [], origin: zero });
    for (const point of [{ x: NaN, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 }, { x: 1e7, y: 0, z: 0 }]) {
      expect(navigation.groundContact!(point)).toBeNull(); expect(navigation.move(zero, point)).toEqual({ position: zero, blocked: true });
    }
    expect(navigation.move(zero, { x: 100, y: 0, z: 0 })).toEqual({ position: zero, blocked: true });
    const empty = createWorldNavigation({ terrainMeshes: [], obstacleMeshes: () => [], origin: zero });
    expect(empty.groundContact!(zero)).toBeNull(); expect(empty.move(zero, { x: .2, y: 0, z: 0 })).toEqual({ position: zero, blocked: true });
    const unready = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [], origin: zero, isReady: () => false });
    expect(unready.groundContact!(zero)).toBeNull(); expect(unready.move(zero, { x: .2, y: 0, z: 0 })).toEqual({ position: zero, blocked: true });
    const steep = mesh("steep", [-2, -4, -2, -2, -4, 2, 2, 4, 2, 2, 4, -2]);
    expect(createWorldNavigation({ terrainMeshes: [steep], obstacleMeshes: () => [], origin: zero }).groundContact!(zero)).toBeNull();
  });

  it("retains different ground/destination drop bands and terrain-first elevated spawn behavior", () => {
    const { floor } = fixture(), terrain = floor("terrain", -10, 10, -10, 10, 0);
    const bare = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [], origin: zero });
    expect(bare.groundContact!({ x: 0, y: .5, z: 0 })).toBeNull(); expect(bare.ground({ x: 0, y: .5, z: 0 })).toBeNull();
    expect(bare.destination({ x: 0, y: .5, z: 0 })).toEqual(zero); expect(bare.destination({ x: 0, y: .81, z: 0 })).toBeNull();
    const interior = floor("interior", -4, 4, -4, 4, .25), roof = floor("roof", -4, 4, -4, 4, 2);
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [interior, roof], origin: { x: 0, y: 4, z: 0 } });
    expect(navigation.spawn(zero)).toEqual({ x: 0, y: .25, z: 0 });
    const second = navigation.spawn({ x: .1, y: 0, z: .1 }, [{ x: 0, y: .25, z: 0 }])!;
    expect(second.y).toBe(.25); expect(Math.hypot(second.x, second.z)).toBeGreaterThanOrEqual(1.4);
  });
});

describe("adapter accepted-contact lifetime", () => {
  it("seeds support at spawn, accepts real move support, and preserves it through query, destination, pause, death and gait changes", () => {
    const { floor } = fixture(), terrain = floor("terrain", -10, 10, -10, 10, 0);
    const base = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [], origin: zero });
    const queried = vi.fn(base.groundContact!), navigation: WorldNavigation = { ...base, groundContact: queried };
    const adapter = nativeAdapter(zero, navigation); expect(queried).toHaveBeenCalledExactlyOnceWith(zero);
    const spawned = adapter.groundContact!; position(spawned.position, zero);
    for (const sample of spawned.samples) source(sample, terrain);
    base.ground({ x: 1, y: 0, z: 1 }); base.destination({ x: 2, y: 0, z: 2 }); base.spawn(zero);
    adapter.dispatch({ type: "move-local", position: { x: 2, y: 0, z: 0 } }); expect(adapter.groundContact).toEqual(spawned);
    adapter.advance(.5); position(player(adapter).position, { x: .35, y: 0, z: 0 });
    const accepted = adapter.groundContact!; position(accepted.position, { x: .35, y: 0, z: 0 });
    for (const sample of accepted.samples) source(sample, terrain);
    adapter.dispatch({ type: "move-local", position: { x: 3, y: 0, z: 0 } });
    adapter.dispatch({ type: "set-locomotion", mode: "walk" }); adapter.dispatch({ type: "equip-item", slot: "upper", itemId: 22 });
    adapter.dispatch({ type: "set-paused", isPaused: true }); adapter.advance(4);
    expect(adapter.groundContact).toEqual(accepted); expect(player(adapter).position.x).toBeCloseTo(.35);
    adapter.dispatch({ type: "set-paused", isPaused: false }); adapter.dispatch({ type: "set-health", entityId: "local-player", health: 0 }); adapter.advance(4);
    expect(adapter.groundContact).toEqual(accepted);
    adapter.dispatch({ type: "set-health", entityId: "local-player", health: 100 }); adapter.advance(.5);
    position(player(adapter).position, { x: .7, y: 0, z: 0 }); position(adapter.groundContact!.position, { x: .7, y: 0, z: 0 });
    expect(queried).toHaveBeenCalledTimes(1); expect(player(adapter).locomotion).toBe("walk");
  });

  it("keeps prior contact on a fully blocked move but clears it if a legacy navigation result changes position without support evidence", () => {
    const { floor } = fixture(), terrain = floor("terrain", -10, 10, -10, 10, 0);
    const base = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [], origin: zero });
    let mode: "normal" | "blocked" | "omit" = "normal";
    const navigation: WorldNavigation = { ...base, move(from, to) {
      if (mode === "blocked") return { position: from, blocked: true };
      const moved = base.move(from, to); return mode === "omit" ? { position: moved.position, blocked: moved.blocked } : moved;
    } };
    const adapter = nativeAdapter(zero, navigation); adapter.dispatch({ type: "move-local", position: { x: 2, y: 0, z: 0 } }); adapter.advance(.5);
    const accepted = adapter.groundContact; mode = "blocked"; adapter.advance(.5);
    expect(adapter.groundContact).toEqual(accepted); position(player(adapter).position, { x: .35, y: 0, z: 0 });
    mode = "omit"; adapter.dispatch({ type: "move-local", position: { x: 2, y: 0, z: 0 } }); adapter.advance(.5);
    position(player(adapter).position, { x: .7, y: 0, z: 0 }); expect(adapter.groundContact).toBeNull();
  });

  it("stores partial-blocked support, returns isolated copies and clears the receipt on disposal", () => {
    const { floor, mesh } = fixture(), terrain = floor("terrain", -3, 3, -3, 3, 0);
    const wall = mesh("wall", [0, 0, -2, 0, 2, -2, 0, 2, 2, 0, 0, 2]), origin = { x: -1, y: 0, z: 0 };
    const navigation = createWorldNavigation({ terrainMeshes: [terrain], obstacleMeshes: () => [wall], origin });
    const adapter = nativeAdapter(origin, navigation); adapter.dispatch({ type: "move-local", position: { x: 1, y: 0, z: 0 } }); adapter.advance(4);
    expect(player(adapter).animation).toBe("idle"); position(adapter.groundContact!.position, { x: -.125, y: 0, z: 0 });
    const exposed = adapter.groundContact!; Reflect.set(exposed.position, "x", 999); Reflect.set(exposed.samples[0]!, "meshId", "changed");
    position(adapter.groundContact!.position, { x: -.125, y: 0, z: 0 }); source(adapter.groundContact!.samples[0]!, terrain);
    adapter.advance(10); position(player(adapter).position, { x: -.125, y: 0, z: 0 });
    adapter.dispose(); expect(adapter.groundContact).toBeNull();
  });

  it("never invents support for the existing movement path without navigation", () => {
    const adapter = nativeAdapter(zero); adapter.dispatch({ type: "move-local", position: { x: 1, y: 0, z: 0 } }); adapter.advance(.5);
    position(player(adapter).position, { x: .35, y: 0, z: 0 }); expect(adapter.groundContact).toBeNull();
  });
});
