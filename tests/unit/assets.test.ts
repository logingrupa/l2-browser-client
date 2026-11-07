import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { createCharacterVisual } from "../../src/assets/CharacterVisual";
import { createInitialWorld } from "../../src/world/createInitialWorld";

describe("character fallback and cleanup", () => {
  let engine: NullEngine;
  let scene: Scene;
  const entity = createInitialWorld()[3];
  if (!entity) throw new Error("Initial world needs a local player.");

  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); });

  it("creates a grounded, pickable placeholder immediately without a model request", () => {
    const fetchModel = vi.fn();
    vi.stubGlobal("fetch", fetchModel);
    const visual = createCharacterVisual(scene, entity);
    expect(visual.isFallback).toBe(true);
    expect(fetchModel).not.toHaveBeenCalled();
    const meshes = visual.root.getChildMeshes();
    expect(meshes.length).toBeGreaterThan(15);
    expect(meshes.every(mesh => mesh.isPickable && mesh.metadata.entityId === entity.id)).toBe(true);
    for (const mesh of meshes) mesh.computeWorldMatrix(true);
    const bounds = visual.root.getHierarchyBoundingVectors();
    expect(bounds.min.y).toBeCloseTo(0.02);
    expect(bounds.max.y).toBeCloseTo(1.8);
    visual.dispose();
    visual.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.transformNodes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
  });

  it("keeps a fully animated fallback after a missing model response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Missing", { status: 404 })));
    const status = vi.fn<(message: string) => void>();
    const visual = createCharacterVisual(scene, { ...entity, modelUrl: "/missing.glb" }, status);
    await vi.waitFor(() => expect(status).toHaveBeenCalledOnce());
    expect(status).toHaveBeenCalledWith(expect.stringContaining("HTTP 404"));
    expect(visual.isFallback).toBe(true);
    visual.animation.setState("attack");
    visual.animation.update(0.3);
    expect(visual.animation.state).toBe("attack");
    expect(visual.root.getChildMeshes().length).toBeGreaterThan(15);
    visual.dispose();
    expect(scene.meshes).toHaveLength(0);
  });

  it("retains a procedural character for unknown or inherited appearance identifiers", () => {
    const fetchModel = vi.fn();
    vi.stubGlobal("fetch", fetchModel);
    for (const appearanceId of ["unavailable", "constructor", "toString"]) {
      const visual = createCharacterVisual(scene, { ...entity, appearanceId });
      expect(visual.isFallback).toBe(true);
      visual.dispose();
    }
    expect(fetchModel).not.toHaveBeenCalled();
    expect(scene.meshes).toHaveLength(0);
  });

  it("handles a dev server HTML response as a recoverable model failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><title>App</title>", { status: 200 })));
    const status = vi.fn<(message: string) => void>();
    const visual = createCharacterVisual(scene, { ...entity, modelUrl: "/missing.glb" }, status);
    await vi.waitFor(() => expect(status).toHaveBeenCalledOnce());
    expect(status).toHaveBeenCalledWith(expect.stringContaining("not a valid glTF"));
    expect(visual.isFallback).toBe(true);
  });

  it("aborts an outstanding fetch when the entity despawns without reporting a load error", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
      requestSignal = options?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const status = vi.fn<(message: string) => void>();
    const visual = createCharacterVisual(scene, { ...entity, modelUrl: "/pending.glb" }, status);
    visual.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(requestSignal?.aborted).toBe(true);
    expect(status).not.toHaveBeenCalled();
    expect(scene.meshes).toHaveLength(0);
  });

  it("disposes character resources when the scene is shut down", () => {
    const visual = createCharacterVisual(scene, entity);
    scene.dispose();
    expect(visual.root.isDisposed()).toBe(true);
    expect(() => visual.dispose()).not.toThrow();
  });
});
