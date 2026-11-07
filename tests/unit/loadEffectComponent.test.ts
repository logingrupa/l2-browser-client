import { afterEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { crc32, sha256 } from "../../src/assets/package/readAssetPackage";
import { loadEffectComponent } from "../../src/effects/loadEffectComponent";
import type { EffectBundle, EffectComponent, EffectResource } from "../../src/effects/nativeEffectComponents";

const gate = vi.hoisted(() => ({ next: undefined as ((container: AssetContainer) => Promise<void>) | undefined }));
vi.mock("@babylonjs/core/Loading/sceneLoader", async original => {
  const actual = await original<typeof import("@babylonjs/core/Loading/sceneLoader")>();
  return { ...actual, LoadAssetContainerAsync: async (...args: Parameters<typeof actual.LoadAssetContainerAsync>) => {
    const next = gate.next; gate.next = undefined;
    const container = await actual.LoadAssetContainerAsync(...args); await next?.(container); return container;
  } };
});
const positions = [-1, 0, 0, 1, 0, 0, 0, 1, 0], uv = [0, 0, 1, 0, .5, 1];
const authoredRotation = Quaternion.FromEulerAngles(.2, .3, .1);
function png(value = 127) {
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6;
  const chunks = [["IHDR", header], ["IDAT", new Uint8Array(deflateSync(Uint8Array.from([0, value, 23, 45, 128])))], ["IEND", new Uint8Array()]] as const;
  const bytes = new Uint8Array(8 + chunks.reduce((sum, [, data]) => sum + data.length + 12, 0)); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const data = new DataView(bytes.buffer); let offset = 8;
  for (const [type, payload] of chunks) {
    data.setUint32(offset, payload.length); bytes.set(new TextEncoder().encode(type), offset + 4); bytes.set(payload, offset + 8);
    data.setUint32(offset + 8 + payload.length, crc32(bytes.subarray(offset + 4, offset + 8 + payload.length))); offset += payload.length + 12;
  }
  return bytes;
}
function glb(image: Uint8Array, options: { primitives?: number; skin?: boolean; animation?: boolean; external?: boolean; wrongSource?: boolean; invalidTextureIndex?: boolean } = {}) {
  const binary: number[] = [], bufferViews: Record<string, unknown>[] = [];
  const append = (value: Uint8Array) => {
    while (binary.length % 4) binary.push(0);
    const index = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: binary.length, byteLength: value.length }); binary.push(...value); return index;
  };
  const positionView = append(new Uint8Array(new Float32Array(positions).buffer)), uvView = append(new Uint8Array(new Float32Array(uv).buffer));
  const indexView = append(new Uint8Array(new Uint16Array([0, 1, 2]).buffer)), imageView = append(image);
  const primitiveCount = options.primitives ?? 1;
  const doc = { asset: { version: "2.0" }, buffers: [{ byteLength: binary.length, ...options.external ? { uri: "https://forbidden.invalid/asset.bin" } : {} }], bufferViews,
    accessors: [{ bufferView: positionView, componentType: 5126, count: 3, type: "VEC3", min: [-1, 0, 0], max: [1, 1, 0] },
      { bufferView: uvView, componentType: 5126, count: 3, type: "VEC2" }, { bufferView: indexView, componentType: 5123, count: 3, type: "SCALAR" }],
    meshes: [{ name: "OriginalMesh", primitives: Array.from({ length: primitiveCount }, (_, material) => ({ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material })) }],
    materials: Array.from({ length: primitiveCount }, () => ({ extras: { nativeSourceReference: options.wrongSource ? "Textures.Wrong" : "Textures.Original" },
      pbrMetallicRoughness: { baseColorTexture: { index: options.invalidTextureIndex ? null : 0 } } })), textures: [{ source: 0 }], images: [{ name: "Textures.Original", bufferView: imageView, mimeType: "image/png" }],
    nodes: [{ name: "AuthoredSourceTransform", translation: [2, 3, 4], rotation: authoredRotation.asArray(), scale: [1, 2, .5], children: [1] },
      { name: "OriginalMesh", mesh: 0, translation: [.25, -.5, 1] }], scenes: [{ nodes: [0] }], scene: 0,
    ...options.skin ? { skins: [{ joints: [0] }] } : {},
    ...options.animation ? { animations: [{ name: "NotStatic", extras: { nativeDurationSeconds: 1 }, samplers: [], channels: [] }] } : {},
  };
  const json = new TextEncoder().encode(JSON.stringify(doc)), padded = Math.ceil(json.length / 4) * 4;
  while (binary.length % 4) binary.push(0);
  const bytes = new Uint8Array(28 + padded + binary.length), header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, bytes.length, true);
  header.setUint32(12, padded, true); header.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + padded); bytes.set(json, 20);
  header.setUint32(20 + padded, binary.length, true); header.setUint32(24 + padded, 0x004e4942, true); bytes.set(binary, 28 + padded); return bytes;
}
const releases: (() => void)[] = [], operations: Promise<unknown>[] = [], cleanups: (() => void)[] = [];
afterEach(async () => { for (const release of releases.splice(0)) release(); await Promise.allSettled(operations.splice(0));
  for (const cleanup of cleanups.splice(0).reverse()) cleanup(); gate.next = undefined; vi.restoreAllMocks(); });
async function fixture(options: Parameters<typeof glb>[1] & { sprite?: boolean; atlas?: boolean; animatedTexture?: boolean } = {}) {
  const engine = new NullEngine(), scene = new Scene(engine); cleanups.push(() => { scene.dispose(); engine.dispose(); });
  new FreeCamera("camera", new Vector3(0, 0, -10), scene);
  const data = new Map<string, Uint8Array<ArrayBuffer>>(), resources: Record<string, EffectResource> = {}, readObjects: string[] = [];
  async function resource(object: string, bytes: Uint8Array<ArrayBuffer>, extension: string) {
    const hash = await sha256(bytes), assetId = `interlude:${object}`, file = `resources/${hash}.${extension}`;
    const value = { assetId, object, file, sha256: hash, bytes: bytes.length, source: { object } };
    resources[assetId] = value; data.set(file, bytes); return value;
  }
  const image = png(), texture = await resource("Textures.Original", image, "png");
  const inheritedTexture = await resource("Engine.S_Emitter", png(250), "png");
  const model = await resource("Meshes.Original", glb(image, options), "glb");
  const next = options.animatedTexture ? await resource("Textures.Next", png(64), "png") : null;
  const component: EffectComponent = { object: "Effects.Actor.Component", class: options.sprite ? "Engine.SpriteEmitter" : "Engine.MeshEmitter",
    actor: "Effects.Actor", emitterOrdinal: 0, sourcePointer: "/effects/0/children/0", properties: {}, effectiveProperties: {
      DrawStyle: 3, UseMeshBlendMode: false, RenderTwoSided: true, AlphaTest: true, ZTest: true, Opacity: .72,
      ColorMultiplierRange: { X: { Min: 1, Max: 1 }, Y: { Min: 1, Max: 1 }, Z: { Min: 1, Max: 1 } },
      StartSizeRange: { X: { Min: 2, Max: 4 }, Y: { Min: 4, Max: 8 }, Z: { Min: 8, Max: 12 } },
      Texture: { object: options.sprite ? texture.object : inheritedTexture.object },
      ...options.atlas ? { TextureUSubdivisions: 2, TextureVSubdivisions: 2, SubdivisionStart: 2, SubdivisionEnd: 3 } : {},
    }, bindings: { mesh: options.sprite ? null : model, texture: options.sprite ? texture : inheritedTexture,
      primitiveMaterials: options.sprite ? [] : Array.from({ length: options.primitives ?? 1 }, (_, primitiveIndex) => ({ meshIndex: 0, primitiveIndex,
        materialIndex: primitiveIndex, nativeSourceReference: texture.object, textureResourceKey: texture.assetId })) } };
  const bundle: EffectBundle = { manifestSha256: "a".repeat(64), manifest: { schemaVersion: 1, kind: "native-effect-components", components: [component], resources,
    actors: [{ object: component.actor, effectiveProperties: { DrawScale: .05 } }], textureGraph: next ? [{ object: texture.object, animationProperties: { AnimNext: { object: next.object } } }] : [] },
    async readResource(record, signal) { signal.throwIfAborted(); readObjects.push(record.object); return data.get(record.file)!.slice(); } };
  return { engine, scene, bundle, component, data, model, texture, readObjects, signal: new AbortController() };
}
function counts(scene: Scene) { return { meshes: scene.meshes.length, transforms: scene.transformNodes.length, geometry: scene.geometries.length,
  materials: scene.materials.length, textures: scene.textures.length, cameras: scene.cameras.length }; }
function close(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length); expect(Math.max(...actual.map((value, index) => Math.abs(value - expected[index]!)))).toBeLessThan(1e-5);
}

describe("source component geometry and nested basis", () => {
  it("loads disabled unit root, keeps original buffers/transforms and cancels only the synthetic AUTO basis once", async () => {
    const value = await fixture(), bytes = value.data.get(value.model.file)!.slice(), baseline = counts(value.scene);
    const owner = await loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 0 }, value.signal.signal);
    expect(owner.root.parent).toBeNull(); expect(owner.root.isEnabled()).toBe(false); expect(owner.root.scaling.asArray()).toEqual([1, 1, 1]);
    expect(owner.meshes).toHaveLength(1); expect(Array.from(owner.meshes[0]!.getVerticesData("position")!)).toEqual(positions);
    expect(Array.from(owner.meshes[0]!.getVerticesData("uv")!)).toEqual(uv); expect(Array.from(owner.meshes[0]!.getIndices()!)).toEqual([0, 1, 2]);
    expect(owner.meshes[0]!.isPickable).toBe(false); expect(value.data.get(value.model.file)).toEqual(bytes);
    const inspection = owner.inspection() as any;
    expect(inspection.rootLocalMatrix).toEqual(Array.from(Matrix.Identity().asArray()));
    expect(inspection.cancelledBasisMatrix).toEqual(Array.from(Matrix.Identity().asArray()));
    expect(inspection.sourceBasisMatrix).not.toEqual(Array.from(Matrix.Identity().asArray()));
    expect(inspection.sizePolicy).toMatchObject({ sourceMidpointXYZ: [3, 6, 10], appliedScaleXZY: [3, 10, 6], actorDrawScaleApplied: false });
    expect(inspection.meshes[0].sourceAccessorCounts).toEqual({ POSITION: 3, TEXCOORD_0: 3 });
    expect(value.readObjects).toEqual(["Meshes.Original", "Textures.Original"]);
    const source = value.scene.transformNodes.find(node => node.name === "AuthoredSourceTransform")!;
    expect(source.position.asArray()).toEqual([2, 3, 4]); close(source.rotationQuaternion!.asArray(), authoredRotation.asArray());
    expect(source.scaling.asArray()).toEqual([1, 2, .5]);
    owner.dispose(); expect(counts(value.scene)).toEqual(baseline);
  });

  it("matches independent authored-node/size/anchor matrix composition under a transformed hand parent", async () => {
    const value = await fixture(), owner = await loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 0 }, value.signal.signal);
    const anchor = new TransformNode("already converted hand", value.scene); anchor.position.set(12, -2, 5);
    anchor.rotationQuaternion = Quaternion.FromEulerAngles(.4, -.2, .3); anchor.scaling.set(-2, 2, 2);
    owner.root.parent = anchor; owner.root.setEnabled(true);
    const inspection = owner.inspection() as any;
    const authored = Matrix.Translation(.25, -.5, 1).multiply(Matrix.Compose(new Vector3(1, 2, .5), authoredRotation, new Vector3(2, 3, 4)));
    const expected = authored.multiply(Matrix.Scaling(3, 10, 6)).multiply(anchor.computeWorldMatrix(true));
    close(inspection.meshes[0].worldMatrix, Array.from(expected.asArray()));
    close(inspection.rootWorldMatrix, Array.from(anchor.getWorldMatrix().asArray()));
    owner.dispose(); expect(anchor.isDisposed()).toBe(false); anchor.dispose();
  });

  it("handles right-handed scenes without inventing an extra source basis", async () => {
    const value = await fixture(); value.scene.useRightHandedSystem = true;
    const owner = await loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 0 }, value.signal.signal);
    expect(owner.inspection().sourceBasisMatrix).toEqual(Array.from(Matrix.Identity().asArray())); owner.dispose();
  });

  it("matches every primitive exactly and uses the primitive PNG instead of inherited Engine.S_Emitter", async () => {
    const value = await fixture({ primitives: 2 });
    const owner = await loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 0 }, value.signal.signal);
    expect(owner.meshes).toHaveLength(2); expect(owner.materials).toHaveLength(1);
    expect(owner.meshes.every(mesh => mesh.material === owner.materials[0]!.material)).toBe(true);
    expect(value.readObjects).not.toContain("Engine.S_Emitter"); owner.dispose();
  });

  it("selects a manual texture graph frame while validating original embedded base texture bytes", async () => {
    const value = await fixture({ animatedTexture: true });
    const owner = await loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 1 }, value.signal.signal);
    expect(owner.frames).toHaveLength(2); expect(owner.selectedFrame.texture.object).toBe("Textures.Next");
    expect(owner.materials[0]!.inspect().texture.object).toBe("Textures.Next"); owner.dispose();
  });

  it("creates explicit camera-facing sprite half-extents and selected atlas crop without applying actor DrawScale", async () => {
    const value = await fixture({ sprite: true, atlas: true });
    const owner = await loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 1 }, value.signal.signal);
    expect(owner.sizePolicy).toMatchObject({ spriteDimensionsMetres: { width: .06, height: .12 }, appliedScaleXZY: [1, 1, 1], actorDrawScaleApplied: false });
    expect(owner.meshes[0]!.billboardMode).toBe(Mesh.BILLBOARDMODE_ALL);
    expect(owner.selectedFrame).toMatchObject({ sourceTile: 3, uvScale: [.5, .5], uvOffset: [.5, .5] });
    const positions = owner.meshes[0]!.getVerticesData("position")!;
    expect(Math.max(...positions.filter((_, index) => index % 3 === 0))).toBeCloseTo(.03);
    expect(Math.max(...positions.filter((_, index) => index % 3 === 1))).toBeCloseTo(.06);
    expect(value.readObjects).toEqual(["Textures.Original"]); owner.dispose();
  });

  it.each(["skin", "animation", "external", "wrongSource", "invalidTextureIndex"] as const)("rejects unsupported %s without leaving resources", async field => {
    const value = await fixture({ [field]: true }), baseline = counts(value.scene);
    await expect(loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 0 }, value.signal.signal)).rejects.toThrow();
    expect(counts(value.scene)).toEqual(baseline);
  });

  it("refuses corrupted GLB bytes, stale primitive joins and invalid frame/range selections", async () => {
    const value = await fixture(), baseline = counts(value.scene), original = value.data.get(value.model.file)!;
    value.data.set(value.model.file, new Uint8Array([1, 2, 3]));
    await expect(loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 0 }, value.signal.signal)).rejects.toThrow("hash/length");
    value.data.set(value.model.file, original); value.component.bindings.primitiveMaterials[0]!.materialIndex = 4;
    await expect(loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 0 }, value.signal.signal)).rejects.toThrow("binding differs");
    value.component.bindings.primitiveMaterials[0]!.materialIndex = 0;
    await expect(loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 9 }, value.signal.signal)).rejects.toThrow("out of range");
    value.component.effectiveProperties.StartSizeRange = { X: { Min: 4, Max: 2 } };
    await expect(loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 0 }, value.signal.signal)).rejects.toThrow("StartSizeRange");
    expect(counts(value.scene)).toEqual(baseline);
  });

  it("cleans a late GLB after abort and preserves an unrelated material", async () => {
    const value = await fixture(), original = new StandardMaterial("survivor", value.scene), baseline = counts(value.scene);
    let release!: () => void, loaded!: (container: AssetContainer) => void;
    const hold = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<AssetContainer>(resolve => { loaded = resolve; });
    releases.push(release); gate.next = async container => { loaded(container); await hold; };
    const pending = loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 0 }, value.signal.signal).catch(error => error as Error); operations.push(pending);
    await ready; value.signal.abort(); release(); expect(await pending).toMatchObject({ name: "AbortError" });
    expect(counts(value.scene)).toEqual(baseline); expect(value.scene.materials).toContain(original);
  });

  it("excludes runtime geometry/materials from serialization and never disposes later foreign attachments or materials", async () => {
    const value = await fixture(), owner = await loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 0 }, value.signal.signal);
    const foreignMaterial = new StandardMaterial("foreign", value.scene), foreign = new TransformNode("foreign node", value.scene);
    foreign.parent = owner.meshes[0]!; owner.meshes[0]!.material = foreignMaterial;
    const disposeMaterial = vi.spyOn(foreignMaterial, "dispose");
    const serialized = SceneSerializer.Serialize(value.scene) as { meshes: { id: string }[]; transformNodes: { id: string }[]; materials: { id: string }[] };
    expect(serialized.meshes.some(row => owner.meshes.some(mesh => row.id === mesh.id))).toBe(false);
    expect(serialized.transformNodes.some(row => row.id === owner.root.id)).toBe(false);
    expect(serialized.materials.some(row => row.id === owner.materials[0]!.material.id)).toBe(false);
    owner.dispose(); owner.dispose(); expect(foreign.isDisposed()).toBe(false); expect(foreign.parent).toBeNull();
    expect(disposeMaterial).not.toHaveBeenCalled(); expect(owner.inspection().status).toBe("disposed");
    foreign.dispose(); foreignMaterial.dispose();
  });

  it("disposes active handles on abort and handles scene disposal during pending source load", async () => {
    const value = await fixture(), baseline = counts(value.scene);
    const owner = await loadEffectComponent(value.scene, value.bundle, value.component, { frameIndex: 0 }, value.signal.signal); value.signal.abort();
    expect(owner.inspection().status).toBe("disposed"); expect(counts(value.scene)).toEqual(baseline);
    const late = await fixture();
    const read = late.bundle.readResource.bind(late.bundle);
    late.bundle.readResource = async (resource, signal) => { const bytes = await read(resource, signal); late.scene.dispose(); return bytes; };
    await expect(loadEffectComponent(late.scene, late.bundle, late.component, { frameIndex: 0 }, late.signal.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
