import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import "@babylonjs/core/Materials/standardMaterial";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { NativeActor } from "../../src/assets/native/NativeActor";
import { readAssetPackage, sha256, type AssetPackageManifest } from "../../src/assets/package/readAssetPackage";
import { storedPackage } from "../fixtures/assetPackageFixture";

const attack = "Native_Attack", wait = "Native_Wait", upper = "Fixture.Upper";
const loadGate = vi.hoisted(() => ({ next: undefined as ((container: AssetContainer) => Promise<void>) | undefined }));
vi.mock("@babylonjs/core/Loading/sceneLoader", async importOriginal => {
  const actual = await importOriginal<typeof import("@babylonjs/core/Loading/sceneLoader")>();
  return { ...actual, LoadAssetContainerAsync: async (...args: Parameters<typeof actual.LoadAssetContainerAsync>) => {
    const gate = loadGate.next; loadGate.next = undefined;
    const container = await actual.LoadAssetContainerAsync(...args);
    await gate?.(container); return container;
  } };
});

/** Embedded original triangle rigs. The two parts deliberately share bone
 * names, but have independent skeletons, animation targets and materials. */
async function nativeFixture(options: {
  parts?: string[]; material?: string; omitAttack?: boolean; duration?: number; invalidJoint?: boolean; primitives?: number;
} = {}) {
  const parts = options.parts ?? ["Upper", "Lower"], material = options.material ?? "base";
  const bytes: number[] = [], bufferViews: Record<string, unknown>[] = [], accessors: Record<string, unknown>[] = [];
  function accessor(values: Float32Array | Uint16Array, type: string, width: number, extra: Record<string, unknown> = {}) {
    while (bytes.length % 4) bytes.push(0);
    const view = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: bytes.length, byteLength: values.byteLength });
    bytes.push(...new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
    accessors.push({ bufferView: view, componentType: values instanceof Float32Array ? 5126 : 5123, count: values.length / width, type, ...extra });
    return accessors.length - 1;
  }
  const position = accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]), "VEC3", 3, { min: [0, 0, 0], max: [1, 2, 0] });
  const joints = accessor(new Uint16Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]), "VEC4", 4);
  const weights = accessor(new Float32Array([.6, .4, 0, 0, .6, .4, 0, 0, .6, .4, 0, 0]), "VEC4", 4);
  const nativeWeights = accessor(new Float32Array([.600001, .39997, 0, 0, .2, .3, .5, 0, .6, .39997, 0, 0]), "VEC4", 4);
  const nativeJoints = accessor(new Uint16Array([0, 1, 0, 0, 0, 0, 1, 0, options.invalidJoint ? 9 : 0, 1, 0, 0]), "VEC4", 4);
  const times = accessor(new Float32Array([0, 1.5]), "SCALAR", 1, { min: [0], max: [1.5] });
  const attackValues = accessor(new Float32Array([0, 0, 0, 6, 0, 0]), "VEC3", 3);
  const waitValues = accessor(new Float32Array([0, 0, 0, 0, 0, 0]), "VEC3", 3);
  const nodes: Record<string, unknown>[] = [], meshes: Record<string, unknown>[] = [], skins: Record<string, unknown>[] = [];
  const roots: number[] = [], targets: number[] = [];
  for (const [index, part] of parts.entries()) {
    const meshNode = nodes.length, root = meshNode + 1, bone = meshNode + 2;
    nodes.push({ name: part, mesh: index, skin: index }, { name: "NativeRoot", children: [bone] }, { name: "NativeBone" });
    meshes.push({ name: part, primitives: Array.from({ length: options.primitives ?? 1 }, () => ({
      material: index, attributes: { POSITION: position, JOINTS_0: joints, WEIGHTS_0: weights,
        _L2_NATIVE_WEIGHTS: nativeWeights, _L2_NATIVE_JOINTS: nativeJoints },
    })) });
    skins.push({ joints: [root, bone], skeleton: root }); roots.push(meshNode, root); targets.push(bone);
  }
  const clips = [{ name: wait, output: waitValues }, ...options.omitAttack ? [] : [{ name: attack, output: attackValues }]];
  const doc = { asset: { version: "2.0", generator: "NativeActor integration fixture" }, buffers: [{ byteLength: bytes.length }], bufferViews, accessors,
    nodes, meshes, skins, scenes: [{ nodes: roots }], scene: 0,
    materials: parts.map(part => ({ name: `${material}:${part}`, pbrMetallicRoughness: { baseColorFactor: [.5, .6, .7, 1], metallicFactor: 0, roughnessFactor: 1 } })),
    animations: clips.map(clip => ({ name: clip.name, extras: { nativeDurationSeconds: options.duration ?? 2 },
      samplers: [{ input: times, output: clip.output, interpolation: "LINEAR" }],
      channels: targets.map(node => ({ sampler: 0, target: { node, path: "translation" } })) })),
  };
  const json = new TextEncoder().encode(JSON.stringify(doc)), padded = Math.ceil(json.length / 4) * 4;
  const glb = new Uint8Array(28 + padded + bytes.length), header = new DataView(glb.buffer);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, glb.length, true);
  header.setUint32(12, padded, true); header.setUint32(16, 0x4e4f534a, true);
  glb.fill(32, 20, 20 + padded); glb.set(json, 20);
  header.setUint32(20 + padded, bytes.length, true); header.setUint32(24 + padded, 0x004e4942, true); glb.set(bytes, 28 + padded);
  const sourceObject = parts.length === 1 ? `Fixture.${parts[0]}` : "Fixture.Assembly";
  const manifest: AssetPackageManifest = { schemaVersion: 1, id: `interlude:${material}:${sourceObject}`, name: material, kind: "model",
    source: { edition: "interlude", package: "Fixture", object: sourceObject, sha256: "a".repeat(64),
      ...parts.length > 1 ? { assembly: parts.map(part => `Fixture.${part}`) } : {} },
    model: { file: "model.glb", unit: "metre", sourceUnitsPerMetre: 100, sourceToGltf: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    files: [{ path: "model.glb", bytes: glb.length, sha256: await sha256(glb), mime: "model/gltf-binary" }],
    limitations: ["Synthetic integration fixture, not native artwork."],
  };
  return readAssetPackage(storedPackage([{ name: "asset.json", bytes: new TextEncoder().encode(JSON.stringify(manifest)) }, { name: "model.glb", bytes: glb }]));
}

describe("native actor part assembly", () => {
  let engine: NullEngine, scene: Scene;
  let actors: NativeActor[], releases: (() => void)[], operations: Promise<unknown>[];
  let sceneBaseline: ReturnType<typeof resources>;
  beforeEach(() => {
    engine = new NullEngine(); scene = new Scene(engine);
    // The loader's PBR materials share a scene-owned BRDF texture. Warm this
    // explicit baseline so disposal assertions still account for every owned texture.
    GetEnvironmentBRDFTexture(scene); sceneBaseline = resources();
    actors = []; releases = []; operations = []; loadGate.next = undefined;
  });
  afterEach(async () => {
    for (const release of releases) release();
    await Promise.allSettled(operations);
    for (const actor of actors) actor.dispose();
    scene.dispose(); engine.dispose(); vi.restoreAllMocks();
  });
  async function create(options: Parameters<typeof nativeFixture>[0] = {}) {
    const actor = await NativeActor.create(scene, await nativeFixture(options), new AbortController().signal);
    actors.push(actor); return actor;
  }
  function resources() {
    return { meshes: scene.meshes.length, transforms: scene.transformNodes.length, skeletons: scene.skeletons.length,
      animations: scene.animationGroups.length, geometries: scene.geometries.length, materials: scene.materials.length, textures: scene.textures.length };
  }
  function boneX(material: string) {
    const mesh = scene.meshes.find(mesh => mesh.material?.name === material);
    if (!mesh?.skeleton) throw new Error(`Missing fixture skin ${material}`);
    return mesh.skeleton.bones.find(bone => bone.name === "NativeBone")!.getTransformNode()!.position.x;
  }
  function gatedLoad() {
    let release!: () => void, loaded!: (container: AssetContainer) => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<AssetContainer>(resolve => { loaded = resolve; });
    releases.push(release);
    loadGate.next = async container => { loaded(container); await gate; };
    return { ready, release };
  }

  it("loads separate native rigs and synchronizes a replacement to the current clock after loading finishes", async () => {
    const actor = await create(); actor.play(attack, "loop"); actor.update(2.25);
    const baseSkins = scene.meshes.filter(mesh => mesh.getTotalVertices()).map(mesh => mesh.skeleton);
    expect(new Set(baseSkins).size).toBe(2);
    expect(baseSkins[0]!.bones[1]).not.toBe(baseSkins[1]!.bones[1]);
    const replacement = await nativeFixture({ parts: ["Upper"], material: "leather" });
    const gate = gatedLoad(), pending = actor.replacePart(upper, replacement); operations.push(pending);
    await gate.ready; actor.update(.5); gate.release(); await pending;
    expect(actor.snapshot()).toMatchObject({ clip: attack, timeSeconds: .75, playing: true, replacements: [upper], unitScale: [1, 1, 1] });
    expect(boneX("base:Lower")).toBeCloseTo(3); expect(boneX("leather:Upper")).toBeCloseTo(3);
    expect(actor.snapshot().parts.filter(part => part.enabled).map(part => part.material).sort()).toEqual(["base:Lower", "leather:Upper"]);
    expect(new Set(scene.meshes.filter(mesh => mesh.getTotalVertices()).map(mesh => mesh.skeleton)).size).toBe(3);
    actor.update(.5);
    expect(boneX("base:Lower")).toBeCloseTo(5); expect(boneX("leather:Upper")).toBeCloseTo(5);
    actor.update(.5);
    expect(boneX("base:Lower")).toBeCloseTo(3); expect(boneX("leather:Upper")).toBeCloseTo(3);
    expect(actor.snapshot().parts.every(part => part.bones === 2 && part.nativeSkin?.applied === true)).toBe(true);
  });

  it("replaces every primitive of a native part while preserving its original rig and other parts", async () => {
    const actor = await create({ primitives: 2 }); actor.play(attack, "loop"); actor.update(.75);
    await actor.replacePart(upper, await nativeFixture({ parts: ["Upper"], material: "leather", primitives: 2 }));
    const parts = actor.snapshot().parts;
    expect(parts.filter(part => part.material === "base:Upper")).toHaveLength(2);
    expect(parts.filter(part => part.material === "base:Upper").every(part => !part.enabled)).toBe(true);
    expect(parts.filter(part => part.enabled).map(part => part.material).sort()).toEqual(["base:Lower", "base:Lower", "leather:Upper", "leather:Upper"]);
    expect(boneX("base:Upper")).toBeCloseTo(3); expect(boneX("base:Lower")).toBeCloseTo(3); expect(boneX("leather:Upper")).toBeCloseTo(3);
    await actor.replacePart(upper, null);
    expect(actor.snapshot().parts).toHaveLength(4);
    expect(actor.snapshot().parts.every(part => part.enabled)).toBe(true);
  });

  it("preserves paused source time and restores the original slot without resetting either rig", async () => {
    const actor = await create(); actor.play(attack, "loop"); actor.seek(1); actor.pause();
    await actor.replacePart(upper, await nativeFixture({ parts: ["Upper"], material: "leather" }));
    expect(boneX("leather:Upper")).toBeCloseTo(4);
    actor.update(10); expect(actor.snapshot()).toMatchObject({ timeSeconds: 1, playing: false });
    expect(boneX("base:Lower")).toBeCloseTo(4); expect(boneX("leather:Upper")).toBeCloseTo(4);
    await actor.replacePart(upper, null);
    expect(actor.snapshot().replacements).toEqual([]);
    expect(actor.snapshot().parts.map(part => part.material).sort()).toEqual(["base:Lower", "base:Upper"]);
    expect(actor.snapshot().parts.every(part => part.enabled)).toBe(true);
    expect(boneX("base:Upper")).toBeCloseTo(4);
  });

  it("rolls back invalid clip relationships and durations, preserving the previous appearance and resource counts", async () => {
    const actor = await create(); actor.play(attack, "loop"); actor.update(.5);
    await actor.replacePart(upper, await nativeFixture({ parts: ["Upper"], material: "leather" }));
    const before = resources();
    for (const options of [{ omitAttack: true }, { duration: 3 }, { duration: 1 }]) {
      await expect(actor.replacePart(upper, await nativeFixture({ parts: ["Upper"], material: "invalid", ...options }))).rejects.toThrow();
      expect(resources()).toEqual(before);
      expect(actor.snapshot().parts.filter(part => part.enabled).map(part => part.material).sort()).toEqual(["base:Lower", "leather:Upper"]);
    }
    actor.update(.25); expect(boneX("base:Lower")).toBeCloseTo(3); expect(boneX("leather:Upper")).toBeCloseTo(3);
  });

  it("rejects incorrect part identities before loading and leaves the current slot intact", async () => {
    const actor = await create(), before = resources();
    await expect(actor.replacePart(upper, await nativeFixture({ parts: ["Lower"] }))).rejects.toThrow("exact replaced native mesh identity");
    await expect(actor.replacePart("Fixture.Unknown", null)).rejects.toThrow("declared native body part");
    expect(resources()).toEqual(before); expect(actor.snapshot().parts.every(part => part.enabled)).toBe(true);
  });

  it("cancels a pending replacement on unequip and disposes its late-loaded rig", async () => {
    const actor = await create(), before = resources();
    const replacement = await nativeFixture({ parts: ["Upper"], material: "late" });
    const gate = gatedLoad(), result = actor.replacePart(upper, replacement).catch(error => error as Error); operations.push(result);
    const container = await gate.ready;
    await actor.replacePart(upper, null); gate.release();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(container.meshes).toHaveLength(0);
    expect(resources()).toEqual(before);
    expect(actor.snapshot().replacements).toEqual([]); expect(actor.snapshot().parts.every(part => part.enabled)).toBe(true);
  });

  it("makes the latest rapid replacement win even when the older load resolves last", async () => {
    const actor = await create(); actor.play(attack, "loop"); actor.update(.75);
    const oldAsset = await nativeFixture({ parts: ["Upper"], material: "old" });
    const newAsset = await nativeFixture({ parts: ["Upper"], material: "new" });
    const gate = gatedLoad(), oldResult = actor.replacePart(upper, oldAsset).catch(error => error as Error); operations.push(oldResult);
    await gate.ready;
    await actor.replacePart(upper, newAsset);
    gate.release(); expect(await oldResult).toMatchObject({ name: "AbortError" });
    expect(actor.snapshot().parts.filter(part => part.enabled).map(part => part.material).sort()).toEqual(["base:Lower", "new:Upper"]);
    expect(scene.meshes.some(mesh => mesh.material?.name === "old:Upper")).toBe(false);
    expect(boneX("new:Upper")).toBeCloseTo(3);
  });

  it("disposes late pending loads without resurrecting the actor or disposing an unrelated actor", async () => {
    const survivor = await create({ material: "survivor" }), survivorResources = resources();
    const actor = await create();
    expect(actor.root.id).not.toBe(survivor.root.id);
    expect([actor.root.name, survivor.root.name]).toEqual(["Native actor", "Native actor"]);
    const replacement = await nativeFixture({ parts: ["Upper"], material: "late" });
    const gate = gatedLoad(), result = actor.replacePart(upper, replacement).catch(error => error as Error); operations.push(result);
    await gate.ready; actor.dispose(); actor.dispose(); gate.release();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(resources()).toEqual(survivorResources);
    survivor.play(attack, "loop"); survivor.update(.5);
    expect(boneX("survivor:Upper")).toBeCloseTo(2);
    survivor.dispose();
    expect(resources()).toEqual(sceneBaseline);
  });

  it("holds one-shot final keys across a stall and equipment swap, then retriggers every rig explicitly", async () => {
    const actor = await create(); actor.play(attack, "once"); actor.update(10);
    expect(actor.snapshot()).toMatchObject({ timeSeconds: 2, completed: true, playing: false });
    expect(boneX("base:Upper")).toBe(6); expect(boneX("base:Lower")).toBe(6);
    await actor.replacePart(upper, await nativeFixture({ parts: ["Upper"], material: "leather" }));
    expect(boneX("leather:Upper")).toBe(6);
    actor.play(attack, "once", false); actor.update(1);
    expect(actor.snapshot()).toMatchObject({ timeSeconds: 2, completed: true, playing: false });
    actor.play(attack, "once", true);
    expect(actor.snapshot()).toMatchObject({ timeSeconds: 0, completed: false, playing: true });
    expect(boneX("base:Lower")).toBe(0); expect(boneX("leather:Upper")).toBe(0);
    actor.update(.75); expect(boneX("base:Lower")).toBe(3); expect(boneX("leather:Upper")).toBe(3);
  });

  it("rejects an aborted create and malformed custom skin without leaving presentation resources", async () => {
    const aborted = new AbortController(); aborted.abort();
    await expect(NativeActor.create(scene, await nativeFixture(), aborted.signal)).rejects.toHaveProperty("name", "AbortError");
    expect(resources()).toEqual(sceneBaseline);
    await expect(NativeActor.create(scene, await nativeFixture({ invalidJoint: true }), new AbortController().signal)).rejects.toThrow("invalid weight or joint");
    expect(resources()).toEqual(sceneBaseline);
  });

  it("disposes a base model whose creation is aborted while the loader is pending", async () => {
    const asset = await nativeFixture(), aborted = new AbortController(), gate = gatedLoad();
    const result = NativeActor.create(scene, asset, aborted.signal).catch(error => error as Error); operations.push(result);
    const container = await gate.ready; aborted.abort(); gate.release();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(container.meshes).toHaveLength(0);
    expect(resources()).toEqual(sceneBaseline);
  });

  it("anchors by declared part and exact joint despite duplicate names across independent rigs", async () => {
    const actor = await create({ primitives: 2 });
    const anchor = actor.createBoneAnchor(upper, "NativeBone"), lowerAnchor = actor.createBoneAnchor("Fixture.Lower", "NativeBone");
    const upperMesh = scene.meshes.find(mesh => mesh.material?.name === "base:Upper")!;
    const lowerMesh = scene.meshes.find(mesh => mesh.material?.name === "base:Lower")!;
    expect(anchor.root.parent).toBe(upperMesh.skeleton!.bones[1]!.getTransformNode());
    expect(lowerAnchor.root.parent).toBe(lowerMesh.skeleton!.bones[1]!.getTransformNode());
    expect(anchor.root.doNotSerialize).toBe(true); expect(lowerAnchor.root.doNotSerialize).toBe(true);
    expect(upperMesh.skeleton!.bones[1]!.getTransformNode()!.doNotSerialize).toBe(false);
    const serialized = SceneSerializer.Serialize(scene) as { transformNodes: { id: string; uniqueId: number }[] };
    expect(serialized.transformNodes.some(node => node.id === anchor.root.id || node.id === lowerAnchor.root.id)).toBe(false);
    const linked = upperMesh.skeleton!.bones[1]!.getTransformNode()!;
    expect(serialized.transformNodes).toContainEqual(expect.objectContaining({ id: linked.id, uniqueId: linked.uniqueId }));
    expect(anchor.root.parent).not.toBe(lowerAnchor.root.parent);
    expect(anchor.root.id).not.toBe(lowerAnchor.root.id);
    expect(anchor.inspection()).toMatchObject({ sourceObject: upper, boneName: "NativeBone", status: "ready", ownershipIntact: true,
      gltfMeshPointer: "/meshes/0", gltfMeshNodePointer: "/nodes/0", gltfSkinPointer: "/skins/0", gltfNodePointer: "/nodes/2", jointIndex: 1,
      anchorLocalMatrix: Array.from(Matrix.Identity().asArray()) });
    expect(lowerAnchor.inspection()).toMatchObject({ gltfSkinPointer: "/skins/1", gltfNodePointer: "/nodes/5", jointIndex: 1 });
  });

  it("inherits animated source and transformed actor parents exactly once with synchronous clock diagnostics", async () => {
    const actor = await create();
    const parent = new TransformNode("placement", scene); parent.position.set(11, -3, 7);
    parent.rotationQuaternion = Quaternion.FromEulerAngles(.2, .4, -.1); parent.scaling.set(2, 3, 4);
    actor.root.parent = parent; actor.root.position.set(1, 2, -1); actor.root.rotationQuaternion = Quaternion.FromEulerAngles(.1, -.2, .3);
    actor.root.scaling.setAll(.75);
    const anchor = actor.createBoneAnchor(upper, "NativeBone");
    actor.play(attack, "loop"); actor.seek(.75); actor.pause();
    const result = anchor.inspection(), joint = anchor.root.parent as TransformNode;
    expect(result.clock).toMatchObject({ clip: attack, timeSeconds: .75, elapsedSeconds: .75, playing: false });
    expect(result.anchorWorldMatrix).toEqual(result.linkedJointWorldMatrix);
    expect(result.anchorWorldMatrix).toEqual(Array.from(joint.getWorldMatrix().asArray()));
    expect(result.anchorLocalMatrix).toEqual(Array.from(Matrix.Identity().asArray()));
    const modelRoot = scene.transformNodes.find(node => node.uniqueId === result.baseModelRootUniqueId)!;
    // The loaded glTF __root__ supplies the source handedness transform; derive
    // the expected point from its actual parent, with no second conversion.
    const expected = Vector3.TransformCoordinates(new Vector3(3, 0, 0), joint.parent!.getWorldMatrix());
    expect(anchor.root.getAbsolutePosition().subtract(expected).length()).toBeLessThan(1e-5);
    expect(result.baseModelRootWorldMatrix).toEqual(Array.from(modelRoot.computeWorldMatrix(true).asArray()));
    actor.seek(1.25);
    expect(anchor.inspection().anchorWorldMatrix).not.toEqual(result.anchorWorldMatrix);
    expect(joint.position.x).toBeCloseTo(5);
    actor.dispose(); parent.dispose();
  });

  it("retains the animated original anchor across equipment replacement and unequip", async () => {
    const actor = await create(); actor.play(attack, "loop"); actor.seek(.5);
    const anchor = actor.createBoneAnchor(upper, "NativeBone"), linked = anchor.root.parent;
    const before = anchor.inspection();
    await actor.replacePart(upper, await nativeFixture({ parts: ["Upper"], material: "leather" }));
    expect(anchor.root.parent).toBe(linked);
    expect(anchor.inspection().anchorWorldMatrix).toEqual(before.anchorWorldMatrix);
    const equipmentJoint = scene.meshes.find(mesh => mesh.material?.name === "leather:Upper")!.skeleton!.bones[1]!.getTransformNode();
    expect(anchor.root.parent).not.toBe(equipmentJoint);
    actor.update(.5);
    expect(anchor.inspection()).toMatchObject({ status: "ready", clock: { timeSeconds: 1 } });
    expect((linked as TransformNode).position.x).toBeCloseTo(4);
    await actor.replacePart(upper, null);
    expect(anchor.root.parent).toBe(linked); expect(anchor.inspection().status).toBe("ready");
  });

  it("fails closed for unknown part, case-mismatched/missing bone and ambiguous loaded names", async () => {
    const actor = await create(), before = resources();
    expect(() => actor.createBoneAnchor("Fixture.Unknown", "NativeBone")).toThrow("declared native body part");
    expect(() => actor.createBoneAnchor(upper, "nativebone")).toThrow("missing or ambiguous");
    expect(() => actor.createBoneAnchor(upper, "")).toThrow("exact bone name");
    const skin = scene.meshes.find(mesh => mesh.material?.name === "base:Upper")!.skeleton!;
    const originalName = skin.bones[0]!.name; skin.bones[0]!.name = "NativeBone";
    expect(() => actor.createBoneAnchor(upper, "NativeBone")).toThrow("missing or ambiguous");
    skin.bones[0]!.name = originalName;
    expect(resources()).toEqual(before);
  });

  it("refuses mixed primitive skeletons, missing skeletons and foreign or incorrectly identified linked nodes", async () => {
    const actor = await create({ primitives: 2 }), before = resources();
    const meshes = scene.meshes.filter(mesh => mesh.material?.name === "base:Upper"), own = meshes[0]!.skeleton!;
    const other = scene.meshes.find(mesh => mesh.material?.name === "base:Lower")!.skeleton!;
    meshes[1]!.skeleton = other;
    expect(() => actor.createBoneAnchor(upper, "NativeBone")).toThrow("unique owned skeleton");
    meshes[1]!.skeleton = null;
    expect(() => actor.createBoneAnchor(upper, "NativeBone")).toThrow("unique owned skeleton");
    meshes[1]!.skeleton = own;
    const bone = own.bones[1]!, linked = bone.getTransformNode()!;
    bone.linkTransformNode(other.bones[1]!.getTransformNode());
    expect(() => actor.createBoneAnchor(upper, "NativeBone")).toThrow("owned source hierarchy");
    bone.linkTransformNode(linked);
    const metadata = linked._internalMetadata; linked._internalMetadata = { gltf: { pointers: ["/nodes/999"] } };
    expect(() => actor.createBoneAnchor(upper, "NativeBone")).toThrow("owned source hierarchy");
    linked._internalMetadata = metadata;
    expect(resources()).toEqual(before);
  });

  it("rejects a linked node moved outside the base container hierarchy without modifying it", async () => {
    const actor = await create(), mesh = scene.meshes.find(mesh => mesh.material?.name === "base:Upper")!;
    const linked = mesh.skeleton!.bones[1]!.getTransformNode()!, originalParent = linked.parent;
    const foreign = new TransformNode("foreign", scene); linked.parent = foreign;
    expect(() => actor.createBoneAnchor(upper, "NativeBone")).toThrow("owned source hierarchy");
    expect(linked.parent).toBe(foreign);
    linked.parent = originalParent; foreign.dispose();
  });

  it("disposes only owned anchors, keeps the rig usable and cleans remaining handles with the actor", async () => {
    const actor = await create(), before = resources();
    const anchor = actor.createBoneAnchor(upper, "NativeBone"), linked = anchor.root.parent as TransformNode;
    anchor.dispose(); anchor.dispose();
    expect(anchor.root.isDisposed()).toBe(true); expect(linked.isDisposed()).toBe(false);
    expect(anchor.inspection()).toMatchObject({ status: "disposed", ownershipIntact: false, anchorWorldMatrix: null });
    expect(resources()).toEqual(before);
    actor.play(attack, "once"); actor.update(.5); expect(linked.position.x).toBeCloseTo(2);
    const remaining = actor.createBoneAnchor(upper, "NativeBone"); actor.dispose();
    expect(remaining.root.isDisposed()).toBe(true); expect(remaining.inspection().status).toBe("disposed");
    expect(() => actor.createBoneAnchor(upper, "NativeBone")).toThrow("disposed native actor");
    expect(resources()).toEqual(sceneBaseline);
  });

  it("relinquishes an externally reparented anchor without mutating its new hierarchy or foreign children", async () => {
    const actor = await create(), anchor = actor.createBoneAnchor(upper, "NativeBone");
    const foreign = new TransformNode("foreign", scene), child = new TransformNode("foreign child", scene);
    anchor.root.parent = foreign; child.parent = anchor.root; child.position.set(1, 2, 3);
    const matrix = Array.from(child.computeWorldMatrix(true).asArray());
    expect(anchor.inspection()).toMatchObject({ status: "ownership-lost", ownershipIntact: false, anchorWorldMatrix: null });
    anchor.dispose(); actor.dispose();
    expect(anchor.root.isDisposed()).toBe(false); expect(child.isDisposed()).toBe(false);
    expect(anchor.root.parent).toBe(foreign); expect(child.parent).toBe(anchor.root);
    expect(Array.from(child.computeWorldMatrix(true).asArray())).toEqual(matrix);
    foreign.dispose(); expect(resources()).toEqual(sceneBaseline);
  });
});
