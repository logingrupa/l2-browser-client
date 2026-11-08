import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { createCharacterVisual, type CharacterVisual } from "../../src/assets/CharacterVisual";
import { nativeAppearanceProfileId, nativeAppearanceProfiles } from "../../src/assets/characterProfiles";
import { nativeOrProceduralCharacterFactory, nativePlayerCharacterProfile, type NativeAppearanceSet } from "../../src/assets/native/nativeOrProceduralCharacter";
import { defaultNativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";
import { createInitialWorld } from "../../src/world/createInitialWorld";
import type { WorldEntity } from "../../src/world/worldTypes";
import { nativeVisualClips, nativeVisualFixture } from "../fixtures/nativeVisualFixture";

describe("default route Human characters use native packages, never lineagen GLBs", () => {
  let engine: NullEngine, scene: Scene, visuals: CharacterVisual[];
  const [elyra, orin, seren, golem] = createInitialWorld() as [WorldEntity, WorldEntity, WorldEntity, WorldEntity];
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); GetEnvironmentBRDFTexture(scene); visuals = []; });
  afterEach(() => { for (const visual of visuals) visual.dispose(); scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  async function set(): Promise<NativeAppearanceSet> {
    return { profiles: new Map([["FFighter", { asset: await nativeVisualFixture(), clips: nativeVisualClips }]]),
      failures: new Map([["MMagic", "Native player profile human-male-mystic is not staged."]]) };
  }
  function create(appearances: Promise<NativeAppearanceSet>, entity: WorldEntity, status = vi.fn<(message: string) => void>()) {
    const procedural = vi.fn(createCharacterVisual);
    const visual = nativeOrProceduralCharacterFactory(appearances, procedural)(scene, entity, status);
    visuals.push(visual); return { visual, procedural, status };
  }

  it("maps the four Human appearances to the staged native player profiles only", () => {
    expect(nativeAppearanceProfiles).toEqual({ MFighter: "human-male-fighter", FFighter: "human-female-fighter",
      MMagic: "human-male-mystic", FMagic: "human-female-mystic" });
    expect(nativeAppearanceProfileId(elyra)).toBe("human-female-fighter");
    expect(nativeAppearanceProfileId(golem)).toBeUndefined();
  });

  it("shows the native package at its own scale with the latest requested state and no procedural stand-in", async () => {
    const fetchModel = vi.fn(); vi.stubGlobal("fetch", fetchModel);
    const { visual, procedural } = create(set(), elyra);
    visual.root.position.set(4, 0, 2);
    expect(visual.isFallback).toBe(true); expect(visual.root.getChildMeshes()).toHaveLength(0);
    visual.animation.setState("run");
    await visual.ready;
    expect(procedural).not.toHaveBeenCalled(); expect(fetchModel).not.toHaveBeenCalled();
    expect(visual.isFallback).toBe(false); expect(visual.modelId).toBe("fixture:base");
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.run);
    expect(visual.root.scaling.asArray()).toEqual([1, 1, 1]);
    expect(visual.bounds.maximum.y - visual.bounds.minimum.y).toBeCloseTo(2);
    expect(visual.root.getChildMeshes().some(mesh => mesh.metadata?.clientEntityId === elyra.id)).toBe(true);
    visual.animation.setState("attack");
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.attack);
    visual.dispose();
    expect(scene.meshes).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
  });

  it("keeps an animated procedural character when a profile is not staged or the catalog fails", async () => {
    const missing = create(set(), seren);
    await missing.visual.ready;
    expect(missing.procedural).toHaveBeenCalledOnce(); expect(missing.visual.isFallback).toBe(true);
    expect(missing.visual.root.getChildMeshes().length).toBeGreaterThan(15);
    expect(missing.status).toHaveBeenCalledWith("Seren: Native player profile human-male-mystic is not staged. Animated placeholder retained.");
    missing.visual.animation.setState("attack"); missing.visual.animation.update(.3);
    expect(missing.visual.animation.state).toBe("attack");
    const failed = create(Promise.reject(new Error("The native asset catalog is unavailable.")), orin);
    await failed.visual.ready;
    expect(failed.visual.isFallback).toBe(true);
    expect(failed.status).toHaveBeenCalledWith(expect.stringContaining("catalog is unavailable"));
  });

  it("falls back when the native model itself fails and creates other entities procedurally at once", async () => {
    const broken: NativeAppearanceSet = { profiles: new Map([["FFighter", { asset: await nativeVisualFixture({ omitDeath: true }), clips: nativeVisualClips }]]), failures: new Map() };
    const { visual, status } = create(Promise.resolve(broken), elyra);
    await visual.ready;
    expect(visual.isFallback).toBe(true);
    expect(status).toHaveBeenCalledWith(expect.stringContaining("Native_Death is missing"));
    const monster = create(set(), golem);
    expect(monster.procedural).toHaveBeenCalledOnce(); expect(monster.visual.root.getChildMeshes().length).toBeGreaterThan(15);
  });

  it("cancels cleanly when the entity despawns before its package resolves", async () => {
    let resolve!: (value: NativeAppearanceSet) => void;
    const { visual, procedural } = create(new Promise(done => { resolve = done; }), elyra);
    visual.dispose();
    await expect(visual.ready).rejects.toThrow("cancelled");
    resolve(await set()); await new Promise(done => setTimeout(done, 10));
    expect(procedural).not.toHaveBeenCalled(); expect(scene.meshes).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
  });

  it("builds the slice's native presentation from a staged profile without fitting its scale", async () => {
    const asset = await nativeVisualFixture();
    const presented = nativePlayerCharacterProfile(defaultNativePlayerProfile, new Map([["human-male-fighter:0", asset], ["fighter-equipment:0", asset]]));
    expect(presented.clips).toBe(defaultNativePlayerProfile.clips);
    expect(presented.actorScale?.asArray()).toEqual([1, 1, 1]); expect(presented.forwardAxis?.asArray()).toEqual([1, 0, 0]);
    expect(presented.upperItems?.get(22)).toBe(asset);
    expect(() => nativePlayerCharacterProfile(defaultNativePlayerProfile, new Map())).toThrow("not loaded");
  });
});
