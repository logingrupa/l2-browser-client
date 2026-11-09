import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { instantiateNativeModelPlacements, disposeNativeModelInstances } from "../../src/scene/world/nativeModelPlacements";

const translatedMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1];
const scaledMatrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -1, 0, 5, 1];

describe("native model placement instancing", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.restoreAllMocks(); });

  function template(name: string): AssetContainer {
    const container = new AssetContainer(scene), mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
    container.meshes.push(mesh); container.removeAllFromScene(); return container;
  }

  function sceneNodeCount(): number {
    return scene.meshes.length + scene.transformNodes.length + scene.skeletons.length + scene.animationGroups.length;
  }

  it("gives each placement a frozen root whose pre-transform is the source matrix", () => {
    const templates = new Map([["model-a", template("a")], ["model-b", template("b")]]);
    const placements = [{ id: "placement-1", modelId: "model-a", sourceMesh: "Fixture.A", matrix: translatedMatrix },
      { id: "placement-2", modelId: "model-b", sourceMesh: "Fixture.B", matrix: scaledMatrix }];
    const instances = instantiateNativeModelPlacements(scene, templates, placements);
    expect(instances.map(instance => instance.source)).toEqual(placements);
    for (const [index, instance] of instances.entries()) {
      expect(instance.root.name).toBe(placements[index]!.id);
      expect(instance.root.metadata).toEqual({ nativePlacement: placements[index] });
      expect(instance.root.isWorldMatrixFrozen).toBe(true);
      expect([...instance.root.getWorldMatrix().asArray()]).toEqual(placements[index]!.matrix);
      expect(instance.copy.rootNodes.every(node => node.parent === instance.root)).toBe(true);
    }
    disposeNativeModelInstances(instances);
    expect(sceneNodeCount()).toBe(0);
  });

  it("disposes every node it created when a placement names a model that is not loaded", () => {
    const templates = new Map([["model-a", template("a")]]);
    const before = sceneNodeCount();
    expect(() => instantiateNativeModelPlacements(scene, templates, [
      { id: "placement-1", modelId: "model-a", sourceMesh: "Fixture.A", matrix: translatedMatrix },
      { id: "placement-2", modelId: "model-missing", sourceMesh: "Fixture.Missing", matrix: translatedMatrix }])).toThrow(/model-missing, which is not loaded/);
    expect(sceneNodeCount()).toBe(before);
  });

  it("disposes every node it created when instancing a template throws", () => {
    const failing = template("failing");
    vi.spyOn(failing, "instantiateModelsToScene").mockImplementation(() => {
      MeshBuilder.CreateBox("half-made copy", { size: 1 }, scene);
      throw new Error("instancing failed");
    });
    const templates = new Map([["model-a", template("a")], ["model-failing", failing]]);
    const before = sceneNodeCount();
    expect(() => instantiateNativeModelPlacements(scene, templates, [
      { id: "placement-1", modelId: "model-a", sourceMesh: "Fixture.A", matrix: translatedMatrix },
      { id: "placement-2", modelId: "model-failing", sourceMesh: "Fixture.Failing", matrix: translatedMatrix }])).toThrow("instancing failed");
    expect(sceneNodeCount()).toBe(before);
  });
});
