import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { createCharacterVisual } from "../../src/assets/CharacterVisual";
import { createInitialWorld } from "../../src/world/createInitialWorld";

function createEmbeddedTriangleModelWithNamedClips(clipNames = ["idle", "run", "attack"], offset = 0, height = 2): ArrayBuffer {
  const geometry = new Float32Array([
    -0.5 + offset, offset, 0, 0.5 + offset, offset, 0, offset, height + offset, 0,
    0, 1,
    0, 0, 0, 0, 0.05, 0,
  ]);
  const description = {
    asset: { version: "2.0" }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "native-body", extras: { sourcePart: "upper", entityId: "original-extra" } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: geometry.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-0.5 + offset, offset, 0], max: [0.5 + offset, height + offset, 0] },
      { bufferView: 1, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, count: 2, type: "VEC3" },
    ],
    animations: clipNames.map(name => ({
      name,
      channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
      samplers: [{ input: 1, output: 2, interpolation: "LINEAR" }],
    })),
  };
  const encoded = new TextEncoder().encode(JSON.stringify(description));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const buffer = new ArrayBuffer(12 + 8 + paddedLength + 8 + geometry.byteLength);
  const header = new DataView(buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, buffer.byteLength, true);
  header.setUint32(12, paddedLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  const descriptionBytes = new Uint8Array(buffer, 20, paddedLength);
  descriptionBytes.fill(32);
  descriptionBytes.set(encoded);
  header.setUint32(20 + paddedLength, geometry.byteLength, true);
  header.setUint32(24 + paddedLength, 0x004e4942, true);
  new Uint8Array(buffer, 28 + paddedLength).set(new Uint8Array(geometry.buffer));
  return buffer;
}

describe("binary character model integration", () => {
  let engine: NullEngine;
  let scene: Scene;
  const entity = createInitialWorld()[0];
  if (!entity) throw new Error("Initial world needs a local player.");

  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); });

  it("loads a synthetic GLB without resizing, preserves metadata and requested animation at the current world position", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(createEmbeddedTriangleModelWithNamedClips())));
    const status = vi.fn<(message: string) => void>();
    const visual = createCharacterVisual(scene, { ...entity, modelUrl: "/fixture.glb" }, status);
    visual.root.position.set(13, 3, -8);
    visual.animation.setState("run");
    await vi.waitFor(() => expect(visual.isFallback).toBe(false));
    expect(status).toHaveBeenCalledWith(expect.stringContaining("animated model loaded"));
    expect(visual.animation.state).toBe("run");
    for (const mesh of visual.root.getChildMeshes()) mesh.computeWorldMatrix(true);
    const bounds = visual.root.getHierarchyBoundingVectors();
    expect(bounds.min.y).toBeCloseTo(3);
    expect(bounds.max.y).toBeCloseTo(5);
    expect((bounds.min.x + bounds.max.x) / 2).toBeCloseTo(13);
    expect(scene.getMeshByName("native-body")?.metadata).toMatchObject({
      clientEntityId: entity.id, gltf: { extras: { sourcePart: "upper", entityId: "original-extra" } },
    });
    expect(visual.bounds.maximum.y).toBeCloseTo(2);
    expect(scene.animationGroups.some(group => group.name === "run" && group.isPlaying)).toBe(true);
    expect(scene.meshes.some(mesh => mesh.name.endsWith(":torso"))).toBe(false);
    visual.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.animationGroups).toHaveLength(0);
    expect(scene.transformNodes).toHaveLength(0);
  });

  it("never resolves a semantic Human appearance to a GLB file (no Unity-derived lineagen models)", async () => {
    const fetchModel = vi.fn().mockResolvedValue(new Response(createEmbeddedTriangleModelWithNamedClips(["wait_Hand", "run_Hand", "Atk01_Hand"], 0.3, 2.4)));
    vi.stubGlobal("fetch", fetchModel);
    for (const appearanceId of ["MFighter", "FFighter", "MMagic", "FMagic"]) {
      const visual = createCharacterVisual(scene, { ...entity, appearanceId });
      await new Promise<void>(resolve => setTimeout(resolve, 5));
      expect(visual.isFallback).toBe(true); expect(visual.modelId).toBeNull();
      visual.dispose();
    }
    expect(fetchModel).not.toHaveBeenCalled();
    expect(scene.meshes).toHaveLength(0);
  });

  it("retains the placeholder and disposes models that lack a required animation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(createEmbeddedTriangleModelWithNamedClips(["idle", "run"]))));
    const status = vi.fn<(message: string) => void>();
    const visual = createCharacterVisual(scene, { ...entity, modelUrl: "/incomplete.glb" }, status);
    await vi.waitFor(() => expect(status).toHaveBeenCalledOnce());
    expect(status).toHaveBeenCalledWith(expect.stringContaining("needs idle, run and attack"));
    expect(visual.isFallback).toBe(true);
    expect(scene.animationGroups).toHaveLength(0);
    expect(scene.meshes.some(mesh => mesh.name.endsWith(":torso"))).toBe(true);
  });

  it("does not resurrect a despawned entity if a response arrives after cancellation", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", () => new Promise<Response>(resolve => { resolveRequest = resolve; }));
    const status = vi.fn<(message: string) => void>();
    const visual = createCharacterVisual(scene, { ...entity, modelUrl: "/late.glb" }, status);
    visual.dispose();
    resolveRequest?.(new Response(createEmbeddedTriangleModelWithNamedClips()));
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    expect(status).not.toHaveBeenCalled();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.transformNodes).toHaveLength(0);
    expect(scene.animationGroups).toHaveLength(0);
  });
});
