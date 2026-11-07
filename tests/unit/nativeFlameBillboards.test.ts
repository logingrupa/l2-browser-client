import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PerformanceConfigurator } from "@babylonjs/core/Engines/performanceConfigurator";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createNativeFlameBillboards, evaluateNativeFlameBillboard, nativeFlameBrowserToNative, nativeFlameNativeToBrowser,
  type NativeFlameBillboardBinding, type NativeFlameBillboards, type NativeFlamePosition } from "../../src/scene/world/nativeFlameBillboards";

// Independent offline Python probe outputs retained in flame-runtime/billboard-probes.json.
// These certify the declared numeric model, never a measured native rendering.
const probes: [NativeFlamePosition, number, number, number, number, number][] = [
  [[1, 0, 0], 0, 16384, 4096, 1, 1.2246468525851679e-16],
  [[0, 1, 0], 16383, 32767, 8191, .0003834951785393059, -.9999999403953552],
  [[-1, 0, 0], 32767, 49151, 12287, -.9999999403953552, -.0003834951785393059],
  [[0, -1, 0], -16383, 1, 0, 0, 1],
  [[1, 1, 0], 8191, 24575, 6143, .7073779106140137, -.7068355679512024],
  [[-1, 1, 0], 24575, 40959, 10239, -.7068355679512024, -.7073779106140137],
  [[-1, -1, 0], -24575, -8191, 14336, -.7071067690849304, .7071067690849304],
  [[1, -1, 0], -8191, 8193, 2048, .7071067690849304, .7071067690849304],
  [[1, .0001, 0], 1, 16385, 4096, 1, 1.2246468525851679e-16],
  [[1, -.0001, 0], -1, 16383, 4095, .9999999403953552, .0003834951785393059],
];

describe("recovered billboard arithmetic", () => {
  it.each(probes)("matches independent direction %j", (direction, yaw, billboardYaw, index, sine, cosine) => {
    const value = evaluateNativeFlameBillboard([0, 0, 0], direction)!;
    expect([value.yawInteger, value.billboardYaw, value.sineIndex, value.sinFloat32, value.cosFloat32]).toEqual([yaw, billboardYaw, index, sine, cosine]);
    const matrix = Matrix.FromArray(value.browserMatrix);
    expect(Vector3.TransformCoordinates(new Vector3(1, 0, 0), matrix).asArray()).toEqual([cosine, 0, sine]);
    expect(Vector3.TransformCoordinates(new Vector3(0, 0, 1), matrix).asArray()).toEqual([-sine || 0, 0, cosine]);
    expect(Vector3.TransformCoordinates(new Vector3(0, 1, 0), matrix).asArray()).toEqual([0, 1, 0]);
  });
  it("holds zero horizontal direction and rejects nonfinite/overflowing coordinates", () => {
    expect(evaluateNativeFlameBillboard([5, 6, 7], [5, 6, 20])).toBeNull();
    expect(evaluateNativeFlameBillboard([0, 0, 0], [0, -0, 0])).toBeNull();
    expect(() => evaluateNativeFlameBillboard([NaN, 0, 0], [1, 0, 0])).toThrow("finite");
    expect(() => evaluateNativeFlameBillboard([0, 0, 0], [Infinity, 0, 0])).toThrow("finite");
    expect(() => evaluateNativeFlameBillboard([0, 0, 0], [1e100, 0, 0])).toThrow("binary32");
    expect(nativeFlameNativeToBrowser([100, 200, 300])).toEqual([1, 3, 2]);
    expect(nativeFlameBrowserToNative([1, 3, 2])).toEqual([100, 200, 300]);
  });
});

describe.each([false, true])("scene-owned native flame billboard wrappers (high precision=%s)", useHighPrecisionMatrix => {
  let engine: NullEngine, scene: Scene, owners: NativeFlameBillboards[];
  let previousPrecision: boolean;
  beforeEach(() => {
    previousPrecision = PerformanceConfigurator.MatrixUse64Bits;
    // EngineHost's useLargeWorldRendering enables this same matrix precision.
    engine = new NullEngine({ renderWidth: 512, renderHeight: 256, textureSize: 512,
      deterministicLockstep: false, lockstepMaxSteps: 4, useHighPrecisionMatrix });
    scene = new Scene(engine); scene.useRightHandedSystem = true; owners = [];
  });
  afterEach(() => {
    owners.forEach(owner => owner.dispose()); scene.dispose(); engine.dispose();
    PerformanceConfigurator.SetMatrixPrecision(previousPrecision); vi.restoreAllMocks();
  });
  function fixture(id = 1922) {
    const native: NativeFlamePosition = id === 1922 ? [12118, 94874, -3343] : [12119, 94650, -3343];
    const sourceMatrix = [...Matrix.Scaling(Math.fround(.4), Math.fround(.4), Math.fround(.4)).asArray()];
    sourceMatrix.splice(12, 3, ...nativeFlameNativeToBrowser(native));
    const root = new TransformNode(`source:${id}`, scene); root.setPreTransformMatrix(Matrix.FromArray(sourceMatrix));
    root.metadata = { nativePlacement: { id, matrix: [...sourceMatrix] }, custom: "preserve" };
    const child = new TransformNode(`model:${id}`, scene); child.parent = root;
    const mesh = MeshBuilder.CreateBox(`source-geometry:${id}`, { size: 1 }, scene); mesh.parent = child;
    const binding: NativeFlameBillboardBinding = { placementId: `interlude:20_20.StaticMeshActor${id}`, root, sourceMesh: "FX_E_S.Flameset.Default_Flame01", sourceMatrix };
    return { root, child, mesh, binding };
  }
  function own(bindings: NativeFlameBillboardBinding[], signal = new AbortController().signal) {
    const owner = createNativeFlameBillboards(scene, bindings, signal); owners.push(owner); return owner;
  }
  const world = (node: TransformNode) => [...node.computeWorldMatrix(true).asArray()];
  const origin = (node: TransformNode): [number, number, number] => {
    const m = world(node); return nativeFlameBrowserToNative([m[12]!, m[13]!, m[14]!]);
  };
  const targetX = (node: TransformNode): [number, number, number] => { const p = origin(node); return [p[0] + 100, p[1], p[2]]; };
  const local = (node: TransformNode) => ({ position: node.position.asArray(), rotation: node.rotation.asArray(), quaternion: node.rotationQuaternion?.asArray(),
    scale: node.scaling.asArray(), pivot: [...node.getPivotMatrix().asArray()], frozen: node.isWorldMatrixFrozen, metadata: JSON.stringify(node.metadata) });

  it("preserves saved matrices, geometry and authored extra TRS while composing the source yaw", () => {
    const f = fixture(); f.root.position.set(.75, .3, 0); f.root.rotation.y = .15; f.root.scaling.set(1.2, .9, 1.1);
    f.child.position.set(.2, .4, .6); f.child.rotationQuaternion = Quaternion.RotationYawPitchRoll(.2, .1, -.1);
    f.mesh.scaling.set(1, 2, 1); f.mesh.position.x = .3;
    const snapshot = [f.root, f.child, f.mesh].map(local), beforeWorld = world(f.mesh), geometry = f.mesh.geometry;
    const positions = [...f.mesh.getVerticesData("position")!], indices = [...f.mesh.getIndices()!], baselineNodes = scene.transformNodes.length;
    const sourceMetadata = JSON.stringify(f.root.metadata), sourceMatrix = [...f.binding.sourceMatrix];
    const owner = own([f.binding]), wrapper = f.child.parent as TransformNode;
    expect(wrapper.parent).toBe(f.root); expect(wrapper.getPivotMatrix().isIdentity()).toBe(true);
    expect(world(f.mesh)).toEqual(beforeWorld);
    const target = targetX(f.root), evaluation = evaluateNativeFlameBillboard(origin(f.root), target)!;
    owner.update(target);
    expect([...wrapper.getPivotMatrix().asArray()]).toEqual([...evaluation.browserMatrix].map(Math.fround));
    expect(world(f.mesh)).not.toEqual(beforeWorld);
    expect([f.root, f.child, f.mesh].map(local)).toEqual(snapshot);
    expect(f.mesh.geometry).toBe(geometry); expect(f.mesh.getVerticesData("position")).toEqual(positions); expect(f.mesh.getIndices()).toEqual(indices);
    expect(f.binding.sourceMatrix).toEqual(sourceMatrix); expect(JSON.stringify(f.root.metadata)).toBe(sourceMetadata);
    expect(owner.inspect()).toMatchObject({ nativeCamera: "unverified", nativeLighting: "unverified", nativeParity: "unverified", bindingCounts: { active: 1, held: 0 } });
    owner.dispose(); owner.dispose();
    expect(wrapper.isDisposed()).toBe(true); expect(f.child.parent).toBe(f.root); expect(f.mesh.parent).toBe(f.child);
    expect(world(f.mesh)).toEqual(beforeWorld); expect([f.root, f.child, f.mesh].map(local)).toEqual(snapshot);
    expect(scene.transformNodes.length).toBe(baselineNodes); expect(f.mesh.isDisposed()).toBe(false);
  });

  it("preserves the exact saved authored root with a float32 local matrix and full precision source metadata", () => {
    // Transform fields copied from public/scene/native-world.babylon's 1922 root.
    // The editor saved a float32 localMatrix while retaining source JSON doubles.
    const saved = {
      name: "interlude:20_20.StaticMeshActor1922", id: "native-cdf1cac210bf5d855d2f63aa",
      position: [0, 0, 0], rotation: [0, 0, 0], scaling: [1, 1, 1],
      billboardMode: 0, scalingDeterminant: 1, infiniteDistance: false,
      ignoreNonUniformScaling: false, reIntegrateRotationIntoRotationQuaternion: false,
      isEnabled: true, animations: [], ranges: [],
      localMatrix: [0.4000000059604645, 0, 0, 0, 0, 0.4000000059604645, 0, 0, 0, 0, 0.4000000059604645, 0,
        121.18000030517578, -33.43000030517578, 948.739990234375, 1],
      metadata: { nativePlacement: {
        id: "interlude:20_20.StaticMeshActor1922", materialOverrides: [],
        matrix: [0.4000000059604645, 0, 0, 0, 0, 0.4000000059604645, 0, 0, 0, 0, 0.4000000059604645, 0, 121.18, -33.43, 948.74, 1],
        modelId: "interlude:FX_E_S.Flameset.Default_Flame01", sourceLocation: { X: 12118, Y: 94874, Z: -3343 },
        sourceMesh: "FX_E_S.Flameset.Default_Flame01",
      } },
    };
    const root = TransformNode.Parse(saved, scene, ""), child = new TransformNode("saved model", scene); child.parent = root;
    root.position.set(.75, .3, 0); root.rotation.y = .15; root.scaling.set(1.2, .9, 1.1);
    const before = local(root), childBefore = world(child), savedBefore = JSON.stringify(saved);
    const source = saved.metadata.nativePlacement;
    const owner = own([{ placementId: source.id, root, sourceMesh: source.sourceMesh, sourceMatrix: source.matrix }]);
    owner.update(targetX(root));
    expect(owner.inspect().bindingCounts).toMatchObject({ active: 1, released: 0 });
    expect(local(root)).toEqual(before); expect([...root.getPivotMatrix().asArray()]).toEqual(saved.localMatrix);
    expect(JSON.stringify(saved)).toBe(savedBefore);
    owner.dispose();
    expect(child.parent).toBe(root); expect(world(child)).toEqual(childBefore); expect(local(root)).toEqual(before);
  });

  if (useHighPrecisionMatrix) {
  it("rejects mixed source precisions before attachment without changing the hierarchy", () => {
    const f = fixture(), mixed = [...f.binding.sourceMatrix]; mixed[12] = Math.fround(mixed[12]!);
    f.root.setPreTransformMatrix(Matrix.FromArray(mixed));
    const before = local(f.root), count = scene.transformNodes.length;
    expect(() => own([f.binding])).toThrow("placement pretransform differs");
    expect(f.child.parent).toBe(f.root); expect(local(f.root)).toEqual(before); expect(scene.transformNodes.length).toBe(count);
  });

  it.each(["source", "saved-float32"])("releases a later sub-float32 %s pivot edit without altering authored TRS", representation => {
    const f = fixture();
    if (representation === "saved-float32") f.root.setPreTransformMatrix(Matrix.FromArray(f.binding.sourceMatrix.map(Math.fround)));
    f.root.position.set(.75, .3, 0); f.root.rotation.y = .15; f.root.scaling.set(1.2, .9, 1.1);
    const owner = own([f.binding]), wrapper = f.child.parent as TransformNode;
    owner.update(targetX(f.root));
    const edited = f.root.getPivotMatrix().clone(), translation = edited.getTranslation();
    const previousX = translation.x; translation.x += 1e-10;
    expect(translation.x).not.toBe(previousX); expect(Math.fround(translation.x)).toBe(Math.fround(previousX));
    edited.setTranslation(translation); f.root.setPreTransformMatrix(edited);
    const authored = local(f.root);
    owner.update(targetX(f.root));
    expect(owner.inspect().bindingCounts).toMatchObject({ active: 0, released: 1 });
    expect(f.child.parent).toBe(f.root); expect(wrapper.isDisposed()).toBe(true); expect(local(f.root)).toEqual(authored);
    owner.dispose(); expect(local(f.root)).toEqual(authored);
  });
  }

  it("rotates in browser XZY coordinates and supports a frozen source root without unfreezing it", () => {
    const f = fixture(); f.child.position.x = 1; f.root.computeWorldMatrix(true); f.root.freezeWorldMatrix();
    const rootBefore = world(f.root), rootLocal = local(f.root), start = Vector3.FromArray(rootBefore, 12);
    const owner = own([f.binding]); owner.update(targetX(f.root));
    const point = f.child.computeWorldMatrix(true).getTranslation();
    expect(point.x).toBeCloseTo(start.x, 5); expect(point.y).toBeCloseTo(start.y, 5);
    expect(point.z).toBeCloseTo(start.z + Math.fround(.4), 4);
    expect(world(f.root)).toEqual(rootBefore); expect(local(f.root)).toEqual(rootLocal);
    owner.dispose(); expect(f.root.isWorldMatrixFrozen).toBe(true); expect(f.child.parent).toBe(f.root);
  });

  it("holds only an ambiguous zero-horizontal placement and rejects nonfinite updates atomically", () => {
    const a = fixture(), b = fixture(1923), owner = own([a.binding, b.binding]);
    const wa = a.child.parent as TransformNode, wb = b.child.parent as TransformNode;
    const zero = origin(a.root); owner.update([zero[0], zero[1], zero[2] + 100]);
    expect(wa.getPivotMatrix().isIdentity()).toBe(true); expect(wb.getPivotMatrix().isIdentity()).toBe(false);
    expect(owner.inspect().placements[0]).toMatchObject({ held: true, reason: "zero-horizontal-direction-native-atan2-unverified" });
    owner.update(targetX(a.root)); const previous = [...wa.getPivotMatrix().asArray()];
    owner.update(zero); expect([...wa.getPivotMatrix().asArray()]).toEqual(previous);
    const other = [...wb.getPivotMatrix().asArray()];
    expect(() => owner.update([Infinity, 1, 2])).toThrow("finite");
    expect([...wa.getPivotMatrix().asArray()]).toEqual(previous); expect([...wb.getPivotMatrix().asArray()]).toEqual(other);
  });

  it("retains later child edits and reparenting, and disposes only its own wrapper", () => {
    const f = fixture(), sibling = new TransformNode("saved sibling", scene); sibling.parent = f.root;
    const newParent = new TransformNode("later authored parent", scene), owner = own([f.binding]), wrapper = f.child.parent as TransformNode;
    owner.update(targetX(f.root)); f.child.parent = newParent; f.child.position.y = 2.5; sibling.position.x = 3;
    const added = new TransformNode("later authored addition", scene); added.parent = wrapper; added.position.z = 4;
    owner.update(targetX(f.root)); owner.dispose();
    expect(f.child.parent).toBe(newParent); expect(f.child.position.y).toBe(2.5);
    expect(sibling.parent).toBe(f.root); expect(sibling.position.x).toBe(3);
    expect(added.parent).toBe(f.root); expect(added.position.z).toBe(4);
    expect([f.root, f.child, f.mesh, sibling, added].every(node => !node.isDisposed())).toBe(true);
    expect(wrapper.isDisposed()).toBe(true);
  });

  it("releases a moved wrapper without undoing the author's new parent", () => {
    const f = fixture(), owner = own([f.binding]), wrapper = f.child.parent as TransformNode, authored = new TransformNode("authored parent", scene);
    wrapper.parent = authored; owner.update(targetX(f.root));
    expect(f.child.parent).toBe(authored); expect(wrapper.isDisposed()).toBe(true);
    expect(owner.inspect().bindingCounts).toMatchObject({ active: 0, released: 1 });
    owner.dispose(); expect(f.child.parent).toBe(authored);
  });

  it("preserves an authored source pretransform change and releases its wrapper", () => {
    const f = fixture(), owner = own([f.binding]);
    const edited = f.root.getPivotMatrix().clone(); edited.setTranslation(new Vector3(10, 20, 30)); f.root.setPreTransformMatrix(edited);
    owner.update([0, 0, 0]);
    expect(f.child.parent).toBe(f.root); expect([...f.root.getPivotMatrix().asArray()]).toEqual([...edited.asArray()]);
    expect(owner.inspect().bindingCounts.active).toBe(0);
  });

  it("cleans abort and scene listeners, keeps saved children, and releases duplicate-owner protection", () => {
    const f = fixture(), controller = new AbortController(), removeAbort = vi.spyOn(controller.signal, "removeEventListener"), removeScene = vi.spyOn(scene.onDisposeObservable, "remove");
    const owner = own([f.binding], controller.signal), wrapper = f.child.parent as TransformNode;
    expect(() => createNativeFlameBillboards(scene, [f.binding], new AbortController().signal)).toThrow("already owned");
    controller.abort();
    expect(owner.inspect().disposed).toBe(true); expect(wrapper.isDisposed()).toBe(true); expect(f.child.parent).toBe(f.root); expect(f.child.isDisposed()).toBe(false);
    expect(removeAbort).toHaveBeenCalledWith("abort", expect.any(Function)); expect(removeScene).toHaveBeenCalled();
    owner.update([NaN, 0, 0]); own([f.binding]).dispose();
    scene.dispose(); expect(owners.every(value => value.inspect().disposed)).toBe(true);
  });

  it.each(["id", "mesh", "scale", "rotation", "pivot", "frozen-child", "post-pivot"])("rejects unsupported %s without hierarchy mutations", kind => {
    const first = fixture(), second = fixture(1923), source = [...second.binding.sourceMatrix];
    let binding = second.binding;
    if (kind === "id") binding = { ...binding, placementId: "interlude:20_20.StaticMeshActor432" };
    if (kind === "mesh") binding = { ...binding, sourceMesh: "Other.Mesh" };
    if (kind === "scale") { source[0] = -.4; binding = { ...binding, sourceMatrix: source }; }
    if (kind === "rotation") { source[1] = .1; binding = { ...binding, sourceMatrix: source }; }
    if (kind === "pivot") second.root.setPreTransformMatrix(Matrix.Identity());
    if (kind === "frozen-child") second.mesh.freezeWorldMatrix();
    if (kind === "post-pivot") second.root.setPivotMatrix(Matrix.FromArray(source), true);
    const count = scene.transformNodes.length;
    expect(() => createNativeFlameBillboards(scene, [first.binding, binding], new AbortController().signal)).toThrow("Native flame billboards");
    expect(scene.transformNodes.length).toBe(count); expect(first.child.parent).toBe(first.root); expect(second.child.parent).toBe(second.root);
    expect(first.mesh.isDisposed()).toBe(false); expect(second.mesh.isDisposed()).toBe(false);
  });

  it("rejects an already aborted lifetime before creating nodes", () => {
    const f = fixture(), controller = new AbortController(); controller.abort(); const count = scene.transformNodes.length;
    expect(() => createNativeFlameBillboards(scene, [f.binding], controller.signal)).toThrow();
    expect(f.child.parent).toBe(f.root); expect(scene.transformNodes.length).toBe(count);
  });

  it("releases an active owner when its scene is disposed", () => {
    const f = fixture(), controller = new AbortController(), removeAbort = vi.spyOn(controller.signal, "removeEventListener");
    const owner = own([f.binding], controller.signal); scene.dispose();
    expect(owner.inspect().disposed).toBe(true); expect(removeAbort).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(owner.inspect().bindingCounts.active).toBe(0); owner.dispose();
  });

  it("does not reacquire children after their authored reparenting", () => {
    const f = fixture(), other = new TransformNode("new parent", scene), owner = own([f.binding]), wrapper = f.child.parent as TransformNode;
    f.child.parent = other; owner.update(targetX(f.root));
    expect(wrapper.isDisposed()).toBe(true); expect(owner.inspect().bindingCounts.active).toBe(0);
    f.child.parent = f.root; owner.update(targetX(f.root));
    expect(f.child.parent).toBe(f.root); expect(owner.inspect().bindingCounts.active).toBe(0);
  });
});
