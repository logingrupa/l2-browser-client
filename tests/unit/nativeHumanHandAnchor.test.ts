import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { AssetPackage } from "../../src/assets/package/readAssetPackage";
import { resolveNativeHumanHandAnchor } from "../../src/assets/native/nativeHumanHandAnchor";
import { nativeCharacterFactory } from "../../src/assets/native/NativeCharacterVisual";
import { nativeVisualClips, nativeVisualFixture } from "../fixtures/nativeVisualFixture";
import type { WorldEntity } from "../../src/world/worldTypes";

const releases: (() => void)[] = [];
afterEach(() => { for (const release of releases.splice(0).reverse()) release(); });

describe("qualified human hand anchor selection", () => {
  async function selection(female: boolean) {
    // Selector fixture only: package byte authentication belongs to readAssetPackage.
    const asset = await nativeVisualFixture(), name = female ? "FFighter" : "MFighter";
    asset.manifest.id = `interlude:assembly:${name}-native-body-face0-hair0`;
    asset.manifest.source = { edition: "interlude", package: "Fighter", object: `Fighter.${name}_m001_u`,
      assembly: [`Fighter.${name}_m001_u`], sha256: "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c" };
    asset.manifest.files[0]!.sha256 = female ? "dd197ccf29e0d47645c3a81814ce0a675d223595d7481de9e04ee4dff04e2b2c" :
      "448dd406d001a45057f41a564f022ef1068623921605b1206bd5483e630704ce";
    return asset;
  }

  it.each([false, true])("admits only the qualified body/rig identity, female=%s", async female => {
    const asset = await selection(female);
    expect(resolveNativeHumanHandAnchor(asset)).toEqual({ binding: { id: "right-hand", sourceObject: asset.manifest.source.object,
      boneName: "Weapon_R_Bone" }, reason: null, sourceClass: `LineageWarrior.${female ? "FFighter" : "MFighter"}`,
      modelSha256: asset.manifest.files[0]!.sha256 });
  });

  it("rejects changed source, mesh, membership and duplicate pins without name fallback", async () => {
    const base = await selection(false);
    const changes: ((asset: AssetPackage) => void)[] = [
      asset => { asset.manifest.source.sha256 = "0".repeat(64); },
      asset => { asset.manifest.source.object = "Fighter.Other"; },
      asset => { asset.manifest.source.assembly = []; },
      asset => { asset.manifest.source.assembly = [asset.manifest.source.object, asset.manifest.source.object]; },
      asset => { asset.manifest.files[0]!.sha256 = "0".repeat(64); },
      asset => { asset.manifest.files.push({ ...asset.manifest.files[0]! }); },
      asset => { asset.manifest.id = "another-character"; },
    ];
    for (const change of changes) {
      const asset = structuredClone(base); change(asset);
      expect(resolveNativeHumanHandAnchor(asset).binding).toBeNull();
    }
    expect(resolveNativeHumanHandAnchor({} as AssetPackage).binding).toBeNull();
  });
});

describe("rig anchors cross the character presentation boundary", () => {
  const binding = { id: "right-hand", sourceObject: "Fixture.Upper", boneName: "NativeBone" };
  const initial: WorldEntity = { id: "anchor-player", kind: "local-player", appearanceId: "fixture", displayName: "Fixture",
    health: 100, maximumHealth: 100, animation: "idle", position: { x: 0, y: 0, z: 0 }, orientationRadians: 0 };
  async function create(bindings = [binding]) {
    const engine = new NullEngine(), scene = new Scene(engine); GetEnvironmentBRDFTexture(scene);
    scene.useRightHandedSystem = true;
    releases.push(() => { scene.dispose(); engine.dispose(); });
    const asset = await nativeVisualFixture({ skinned: true, nativeParentTranslation: [3, 4, 5] });
    const replacement = await nativeVisualFixture({ skinned: true, parts: ["Upper"], material: "leather", nativeParentTranslation: [3, 4, 5] });
    const visual = nativeCharacterFactory(new Map([["fixture", { asset, clips: nativeVisualClips, boneAnchors: bindings,
      upperItems: new Map([[22, replacement]]), actorScale: new Vector3(1.2, 1.2, 1.2), forwardAxis: Vector3.Right() }]]))(scene, initial);
    releases.push(() => visual.dispose()); return { visual, scene };
  }

  it("exposes animated base-rig identity through shirt changes without changing source keys", async () => {
    const { visual, scene } = await create(); await visual.ready;
    visual.root.position.set(13, 3, -8); visual.root.rotation.y = .6;
    const inspect = () => visual.attachmentSnapshot!()[0]!;
    const first = inspect(), keys = scene.animationGroups.map(group => group.serialize());
    expect(visual.sourceClock!()).toMatchObject({ clip: nativeVisualClips.idle, mode: "loop", elapsedSeconds: 0 });
    const borrowed = visual.attachmentAnchor!("right-hand");
    expect(borrowed?.isValid()).toBe(true);
    expect(borrowed?.root.uniqueId).toBe(first.anchorUniqueId);
    expect(visual.attachmentAnchor!("unknown")).toBeNull();
    expect(first).toMatchObject({ id: "right-hand", sourceObject: "Fixture.Upper", boneName: "NativeBone", status: "ready",
      gltfNodePointer: "/nodes/2", gltfSkinPointer: "/skins/0", jointIndex: 1 });
    expect(first.anchorWorldMatrix).toEqual(first.linkedJointWorldMatrix);
    visual.animation.setState("attack"); visual.animation.update(.5);
    const moved = inspect();
    expect(visual.sourceClock!()).toMatchObject({ clip: nativeVisualClips.attack, mode: "once", elapsedSeconds: .5 });
    expect(moved.anchorWorldMatrix).toEqual(moved.linkedJointWorldMatrix);
    expect(moved.anchorWorldMatrix).not.toEqual(first.anchorWorldMatrix);
    visual.setEntity!({ ...initial, animation: "attack", equipment: { upper: 22 } });
    await vi.waitFor(() => expect(scene.materials.some(material => material.name === "leather:Upper")).toBe(true));
    await vi.waitFor(() => expect(visual.root.getChildMeshes().some(mesh => mesh.material?.name === "leather:Upper" && mesh.isEnabled())).toBe(true));
    expect(inspect()).toMatchObject({ anchorId: first.anchorId, linkedNodeUniqueId: first.linkedNodeUniqueId, status: "ready" });
    expect(inspect().anchorWorldMatrix).toEqual(moved.anchorWorldMatrix);
    expect(scene.animationGroups.slice(0, keys.length).map(group => group.serialize())).toEqual(keys);
    visual.setEntity!({ ...initial, animation: "attack", equipment: {} });
    await vi.waitFor(() => expect(scene.materials.some(material => material.name === "leather:Upper")).toBe(false));
    expect(inspect().linkedNodeUniqueId).toBe(first.linkedNodeUniqueId);
    expect(visual.attachmentAnchor!("right-hand")).toBe(borrowed);
    visual.dispose();
    expect(visual.sourceClock!()).toBeNull();
    expect(borrowed?.isValid()).toBe(false);
    expect(visual.attachmentAnchor!("right-hand")).toBeNull();
    expect(inspect()).toMatchObject({ status: "disposed", anchorWorldMatrix: null, linkedJointWorldMatrix: null });
    expect(scene.transformNodes).toHaveLength(0); expect(scene.meshes).toHaveLength(0);
  });

  it("does not retag or enable picking on borrowed hand attachments when equipment changes", async () => {
    const { visual, scene } = await create(); await visual.ready;
    const effect = MeshBuilder.CreatePlane("Foreign hand component", {}, scene);
    effect.parent = visual.attachmentAnchor!("right-hand")!.root;
    effect.isPickable = false; const metadata = { owner: "component-preview" }; effect.metadata = metadata;
    visual.setEntity!({ ...initial, equipment: { upper: 22 } });
    await vi.waitFor(() => expect(scene.meshes.some(mesh => mesh.material?.name === "leather:Upper" &&
      mesh.isEnabled() && mesh.isPickable && mesh.metadata?.clientEntityId === initial.id)).toBe(true));
    expect(effect.isPickable).toBe(false); expect(effect.metadata).toBe(metadata);
    visual.setEntity!({ ...initial, equipment: {} });
    await vi.waitFor(() => expect(scene.materials.some(material => material.name === "leather:Upper")).toBe(false));
    expect(effect.isPickable).toBe(false); expect(effect.metadata).toBe(metadata);
    effect.dispose();
  });

  it.each(["missing", "duplicate"])("rejects %s profile anchors and cleans up startup", async kind => {
    const { visual, scene } = await create(kind === "missing" ? [{ ...binding, boneName: "AbsentBone" }] : [binding, binding]);
    await expect(visual.ready).rejects.toThrow();
    expect(visual.isFallback).toBe(true); expect(scene.meshes).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
  });

  it("leaves unselected characters without an attachment", async () => {
    const { visual } = await create([]); await visual.ready;
    expect(visual.attachmentSnapshot!()).toEqual([]);
  });
});
