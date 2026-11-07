import { afterEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import { crc32, sha256 } from "../../src/assets/package/readAssetPackage";
import { createNativeEffectParticlePool, type NativeEffectParticleState, type NativeEffectParticlePool } from "../../src/effects/nativeEffectParticlePool";
import type { LoadedEffectComponent } from "../../src/effects/loadEffectComponent";
import { parseEffectManifest, type EffectBundle, type EffectComponent, type EffectResource } from "../../src/effects/nativeEffectComponents";

const gate = vi.hoisted(() => ({ next: undefined as ((owner: LoadedEffectComponent) => Promise<void>) | undefined }));
vi.mock("../../src/effects/loadEffectComponent", async original => {
  const actual = await original<typeof import("../../src/effects/loadEffectComponent")>();
  return { ...actual, loadEffectComponent: async (...args: Parameters<typeof actual.loadEffectComponent>) => {
    const next = gate.next; gate.next = undefined;
    const owner = await actual.loadEffectComponent(...args); await next?.(owner); return owner;
  } };
});
const cleanups: (() => void)[] = [], releases: (() => void)[] = [], operations: Promise<unknown>[] = [];
afterEach(async () => { for (const release of releases.splice(0)) release(); await Promise.allSettled(operations.splice(0));
  for (const cleanup of cleanups.splice(0).reverse()) cleanup(); gate.next = undefined; vi.restoreAllMocks(); });

function png(value: number) {
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6;
  const chunks = [["IHDR", header], ["IDAT", new Uint8Array(deflateSync(Uint8Array.from([0, value, 23, 45, 128])))], ["IEND", new Uint8Array()]] as const;
  const bytes = new Uint8Array(8 + chunks.reduce((sum, [, data]) => sum + data.length + 12, 0)); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const data = new DataView(bytes.buffer); let offset = 8;
  for (const [type, payload] of chunks) { data.setUint32(offset, payload.length); bytes.set(new TextEncoder().encode(type), offset + 4); bytes.set(payload, offset + 8);
    data.setUint32(offset + 8 + payload.length, crc32(bytes.subarray(offset + 4, offset + 8 + payload.length))); offset += payload.length + 12; }
  return bytes;
}
const sourceRotation = Quaternion.FromEulerAngles(.2, .3, .1);
function glb(image: Uint8Array, textureObject: string) {
  const binary: number[] = [], bufferViews: Record<string, unknown>[] = [];
  const append = (bytes: Uint8Array) => { while (binary.length % 4) binary.push(0);
    const index = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: binary.length, byteLength: bytes.length }); binary.push(...bytes); return index; };
  const positions = append(new Uint8Array(new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0]).buffer));
  const uv = append(new Uint8Array(new Float32Array([0, 0, 1, 0, .5, 1]).buffer));
  const indices = append(new Uint8Array(new Uint16Array([0, 1, 2]).buffer)), imageView = append(image);
  const doc = { asset: { version: "2.0" }, buffers: [{ byteLength: binary.length }], bufferViews,
    accessors: [{ bufferView: positions, componentType: 5126, count: 3, type: "VEC3", min: [-1, 0, 0], max: [1, 1, 0] },
      { bufferView: uv, componentType: 5126, count: 3, type: "VEC2" }, { bufferView: indices, componentType: 5123, count: 3, type: "SCALAR" }],
    meshes: [{ name: "Original", primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
    materials: [{ extras: { nativeSourceReference: textureObject }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }], images: [{ bufferView: imageView, mimeType: "image/png" }],
    nodes: [{ name: "SourceTransform", translation: [2, 3, 4], rotation: sourceRotation.asArray(), scale: [1, 2, .5], children: [1] },
      { name: "Original", mesh: 0, translation: [.25, -.5, 1] }], scenes: [{ nodes: [0] }], scene: 0 };
  const json = new TextEncoder().encode(JSON.stringify(doc)), padded = Math.ceil(json.length / 4) * 4;
  while (binary.length % 4) binary.push(0);
  const bytes = new Uint8Array(28 + padded + binary.length), header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, bytes.length, true);
  header.setUint32(12, padded, true); header.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + padded); bytes.set(json, 20);
  header.setUint32(20 + padded, binary.length, true); header.setUint32(24 + padded, 0x004e4942, true); bytes.set(binary, 28 + padded); return bytes;
}
async function fixture(mode: "mesh" | "sprite" | "init" = "mesh") {
  const engine = new NullEngine(), scene = new Scene(engine); cleanups.push(() => { scene.dispose(); engine.dispose(); });
  const camera = new FreeCamera("camera", new Vector3(0, 0, -10), scene); camera.setTarget(Vector3.Zero()); scene.activeCamera = camera;
  const data = new Map<string, Uint8Array<ArrayBuffer>>(), resources: Record<string, EffectResource> = {}, reads: string[] = [], components: EffectComponent[] = [];
  const textureGraph: EffectBundle["manifest"]["textureGraph"] = [];
  async function resource(object: string, bytes: Uint8Array<ArrayBuffer>, extension: string) {
    const hash = await sha256(bytes), assetId = `interlude:${object}`, file = `resources/${hash}.${extension}`;
    const value = { assetId, object, file, sha256: hash, bytes: bytes.length, source: { object } }; resources[assetId] = value; data.set(file, bytes); return value;
  }
  const specs = mode === "init" ? [{ sprite: false, count: 11, frames: 1 }, { sprite: true, count: 1, frames: 1 }, { sprite: false, count: 7, frames: 4 }]
    : [{ sprite: mode === "sprite", count: 2, frames: mode === "sprite" ? 1 : 2 }];
  for (const [ordinal, spec] of specs.entries()) {
    const texture = await resource(`Textures.Component${ordinal}.Frame0`, png(30 + ordinal * 10), "png");
    let previous = texture;
    for (let frame = 1; frame < spec.frames; frame++) {
      const next = await resource(`Textures.Component${ordinal}.Frame${frame}`, png(30 + ordinal * 10 + frame), "png");
      textureGraph.push({ object: previous.object, animationProperties: { AnimNext: { object: next.object }, MinFrameRate: 18, MaxFrameRate: 18 } }); previous = next;
    }
    const model = spec.sprite ? null : await resource(`Meshes.Component${ordinal}`, glb(data.get(texture.file)!, texture.object), "glb");
    components.push({ object: `Effects.Actor.Component${ordinal}`, class: spec.sprite ? "Engine.SpriteEmitter" : "Engine.MeshEmitter", actor: "Effects.Actor",
      emitterOrdinal: ordinal, sourcePointer: `/effects/0/children/${ordinal}`, properties: {}, effectiveProperties: {
        MaxParticles: spec.count, DrawStyle: 3, UseMeshBlendMode: false, RenderTwoSided: true, AlphaTest: true, ZTest: true, Opacity: .72,
        ColorMultiplierRange: { X: { Min: .9, Max: .9 }, Y: { Min: 1, Max: 1 }, Z: { Min: 1, Max: 1 } },
        StartSizeRange: { X: { Min: 2, Max: 4 }, Y: { Min: 4, Max: 8 }, Z: { Min: 8, Max: 12 } },
        ...mode === "sprite" ? { TextureUSubdivisions: 2, TextureVSubdivisions: 2, SubdivisionStart: 2, SubdivisionEnd: 3 } : {},
      }, bindings: { mesh: model, texture: spec.sprite ? texture : null,
        primitiveMaterials: spec.sprite ? [] : [{ meshIndex: 0, primitiveIndex: 0, materialIndex: 0, nativeSourceReference: texture.object, textureResourceKey: texture.assetId }] } });
  }
  const bundle: EffectBundle = { manifestSha256: "a".repeat(64), manifest: { schemaVersion: 1, kind: "native-effect-components", components, resources,
    actors: [{ object: "Effects.Actor", effectiveProperties: { DrawScale: .05 } }], textureGraph },
    async readResource(record, signal) { signal.throwIfAborted(); reads.push(record.object); return data.get(record.file)!.slice(); } };
  return { engine, scene, camera, bundle, components, data, reads, signal: new AbortController() };
}
const state = (component: EffectComponent, index = 0, changes: Partial<NativeEffectParticleState> = {}): NativeEffectParticleState =>
  ({ component: component.object, index, position: [0, 0, 0], scale: [1, 1, 1], rgba: [1, 1, 1, 1], fade: 1, frame: 0, quaternion: [0, 0, 0, 1], ...changes } as NativeEffectParticleState);
function counts(scene: Scene) { return { meshes: scene.meshes.length, transforms: scene.transformNodes.length, geometry: scene.geometries.length,
  materials: scene.materials.length, textures: scene.textures.length, cameras: scene.cameras.length }; }
function close(actual: readonly number[], expected: readonly number[]) { expect(actual.length).toBe(expected.length);
  expect(Math.max(...actual.map((value, index) => Math.abs(value - expected[index]!)))).toBeLessThan(1e-5); }
/** Independent geometric oracle: project the requested world vector using the
 * camera view normal, not the implementation's billboard-basis coefficient solve. */
function expectDirection(owner: NativeEffectParticlePool, camera: FreeCamera, index = 0) {
  const slot = owner.inspect().slots[index]!, direction = Vector3.FromArray(slot.state!.billboardDirection!);
  const world = Vector3.TransformNormal(direction, Matrix.FromArray(slot.rootWorldMatrix!));
  const normal = Vector3.TransformNormal(Vector3.Forward(), Matrix.Invert(camera.getViewMatrix(true))).normalize();
  const expected = world.subtract(normal.scale(Vector3.Dot(world, normal))).normalize();
  const mesh = Matrix.FromArray(slot.meshes[0]!.worldMatrix!);
  const actualX = Vector3.TransformNormal(Vector3.Right(), mesh), actualY = Vector3.TransformNormal(Vector3.Up(), mesh).normalize();
  close(actualY.asArray(), expected.asArray());
  expect(Math.abs(Vector3.Dot(Vector3.Cross(actualX, actualY).normalize(), normal))).toBeCloseTo(1, 6);
  expect(slot.billboard).toMatchObject({ fallback: "none", cameraId: camera.id, cameraUniqueId: camera.uniqueId });
  close(slot.billboard!.worldDirection!, world.asArray()); close(slot.billboard!.projectedDirection!, expected.asArray());
  close(slot.billboard!.actualWorldYAxis!, actualY.asArray());
  expect(Math.abs(Vector3.Dot(Vector3.FromArray(slot.billboard!.actualWorldNormal!), normal))).toBeCloseTo(1, 6);
}

describe("fixed-capacity original-component particle pool", () => {
  it("loads the exact retained three init components and reuses their fixed resources through two warm cycles", async () => {
    const manifestSha256 = "82e36ae7305abade2520dba335839c7422d878e6c07caa95323b47f7626f0afd";
    const directory = resolve("public/l2/effects", manifestSha256), manifestBytes = new Uint8Array(await readFile(resolve(directory, "manifest.json")));
    expect(await sha256(manifestBytes)).toBe(manifestSha256);
    const manifest = parseEffectManifest(JSON.parse(new TextDecoder().decode(manifestBytes))), beforeManifest = JSON.stringify(manifest);
    const components = manifest.components.filter(component => manifest.actors.find(actor => actor.object === component.actor)?.dispatchStages?.includes("init"));
    expect(components.map(component => component.effectiveProperties.MaxParticles)).toEqual([11, 1, 7]);
    const engine = new NullEngine(), scene = new Scene(engine); cleanups.push(() => { scene.dispose(); engine.dispose(); });
    new FreeCamera("retained camera", new Vector3(0, 0, -10), scene);
    const reads: string[] = [];
    const bundle: EffectBundle = { manifest, manifestSha256, async readResource(resource, signal) {
      signal.throwIfAborted(); reads.push(resource.object); const bytes = new Uint8Array(await readFile(resolve(directory, resource.file))); signal.throwIfAborted(); return bytes;
    } };
    const baseline = counts(scene), owner = await createNativeEffectParticlePool(scene, bundle, components, new AbortController().signal), prepared = owner.inspect();
    expect(prepared.resources).toMatchObject({ geometryCount: 3, slotMaterialCount: 19, ownerMaterialCount: 6, textureCount: 6, resourceReads: 8 });
    expect(prepared.components.map(row => row.frames.length)).toEqual([1, 1, 4]); owner.root.setEnabled(true);
    for (let cycle = 0; cycle < 2; cycle++) for (let frame = 0; frame < 120; frame++) {
      owner.apply(components.flatMap((component, ordinal) => Array.from({ length: owner.capacities[component.object]! }, (_, index) =>
        state(component, index, { frame: ordinal === 2 ? frame % 4 : 0, fade: 1 - frame / 120 }))));
    }
    const warm = owner.inspect(); expect(warm.resources).toEqual(prepared.resources); expect(warm.applications).toBe(240); expect(reads).toHaveLength(8);
    expect(warm.slots.map(row => row.rootId)).toEqual(prepared.slots.map(row => row.rootId)); expect(warm.activeSlots).toBe(19);
    expect(JSON.stringify(manifest)).toBe(beforeManifest); owner.apply([]); owner.dispose(); const disposed = owner.inspect();
    expect(counts(scene)).toEqual(baseline); expect(disposed.resources).toMatchObject({ disposedGeometryCount: 3, disposedMaterialCount: 25, disposedTextureCount: 6 });
    // Explicit opt-in receipt for this task; ordinary test runs never write one.
    const receipt = process.env.EFFECT_POOL_RECEIPT_FILE;
    if (receipt) await writeFile(receipt, JSON.stringify({ schemaVersion: 1, status: "passed", createdAtUtc: new Date().toISOString(),
      renderer: "NullEngine", nativePixelOrHardwareProof: false, manifestSha256, prepared, warm, disposed,
      resourceReads: reads, countsRestored: counts(scene), baseline, sourceManifestUnchanged: true,
      limitation: "Synthetic apply states exercise retained resource sharing; the timeline and hardware draw owner verify timed gameplay separately." }, null, 2) + "\n", { flag: "wx" });
  });
  it("prepares the 11+1+7 init slots with shared geometry and all four source frames once", async () => {
    const value = await fixture("init"), baseline = counts(value.scene), original = structuredClone(value.bundle.manifest);
    const owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    expect(owner.capacity).toBe(19); expect(Object.values(owner.capacities)).toEqual([11, 1, 7]); expect(Object.isFrozen(owner.capacities)).toBe(true);
    expect(owner.root.parent).toBeNull(); expect(owner.root.isEnabled()).toBe(false); expect(owner.bounds()).toBeNull();
    const before = owner.inspect(); expect(before.resources).toMatchObject({ templateCount: 3, geometryCount: 3, slotMaterialCount: 19, ownerMaterialCount: 6, textureCount: 6, resourceReads: 8 });
    expect(before.activeSlots).toBe(0); expect(before.components[2]!.frames).toHaveLength(4); expect(new Set(value.reads).size).toBe(8);
    expect(before.components.every(row => row.template.rootEnabled === false)).toBe(true);
    expect(owner.hasSlot(value.components[2]!.object, 6)).toBe(true); expect(owner.hasSlot(value.components[2]!.object, 7)).toBe(false); expect(owner.hasSlot("__proto__", 0)).toBe(false);
    for (const component of value.components) {
      const slots = before.slots.filter(row => row.component === component.object);
      expect(new Set(slots.flatMap(row => row.meshes.map(mesh => mesh.geometryId))).size).toBe(1);
      expect(new Set(slots.map(row => row.material.id)).size).toBe(slots.length);
    }
    const resourceCounts = counts(value.scene), sourceReads = [...value.reads]; owner.root.setEnabled(true);
    for (let frame = 0; frame < 120; frame++) owner.apply([state(value.components[2]!, frame % 7, { frame: frame % 4, fade: .5 })]);
    expect(counts(value.scene)).toEqual(resourceCounts); expect(value.reads).toEqual(sourceReads); expect(value.bundle.manifest).toEqual(original);
    expect(owner.inspect().activeSlots).toBe(1); owner.apply([]); expect(owner.inspect().activeSlots).toBe(0); expect(owner.bounds()).toBeNull();
    owner.dispose(); expect(counts(value.scene)).toEqual(baseline);
  });

  it("keeps per-slot uniforms, opacity and selected frames independent without changing the template", async () => {
    const value = await fixture(), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    owner.root.setEnabled(true);
    const input = [state(value.components[0]!, 0, { rgba: [.1, .2, .3, .4], fade: .25, frame: 1 }), state(value.components[0]!, 1, { rgba: [.9, .8, .7, .6], fade: .75 })];
    owner.apply(input); const report = owner.inspect(), first = report.slots[0]!, second = report.slots[1]!;
    expect(first.material.uniforms).toMatchObject({ colors4: { selectedColor: [.1, .2, .3, .4] }, floats: { sourceOpacity: .18 } });
    expect(second.material.uniforms).toMatchObject({ colors4: { selectedColor: [.9, .8, .7, .6] }, floats: { sourceOpacity: .54 } });
    expect(first.material.textures[0]!.uniqueId).not.toBe(second.material.textures[0]!.uniqueId);
    expect(first.material.textures[0]!.uniqueId).toBe(report.components[0]!.frames[1]!.textureUniqueId);
    const template = report.components[0]!.template as any;
    expect(template.materials[0]).toMatchObject({ sourceOpacity: .72, selectedColorRgbaBytes: [255, 255, 255, 255] });
    expect(template.materials[0].sourceProperties).not.toHaveProperty("UseColorScale");
    (input[0]!.rgba as unknown as number[])[0] = 1; expect(owner.inspect().slots[0]!.state!.rgba[0]).toBe(.1);
    owner.apply([input[1]!]); expect(owner.inspect().slots.map(row => row.enabled)).toEqual([false, true]);
    expect(owner.inspect().slots[0]!.state).toBeNull(); owner.dispose();
  });

  it("retains authored nested matrices and basis cancellation, then applies relative scale/rotation under the caller anchor", async () => {
    const value = await fixture(), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    const anchor = new TransformNode("caller anchor", value.scene); anchor.position.set(12, -2, 5); anchor.rotationQuaternion = Quaternion.FromEulerAngles(.4, -.2, .3); anchor.scaling.set(-2, 2, 2);
    owner.root.parent = anchor; owner.root.setEnabled(true); const rotation = Quaternion.FromEulerAngles(.1, .2, .3);
    owner.apply([state(value.components[0]!, 0, { position: [1, 2, 3], scale: [.5, 2, 3], quaternion: rotation.asArray() as [number, number, number, number] })]);
    const authored = Matrix.Translation(.25, -.5, 1).multiply(Matrix.Compose(new Vector3(1, 2, .5), sourceRotation, new Vector3(2, 3, 4)));
    const expected = authored.multiply(Matrix.Scaling(3, 10, 6)).multiply(Matrix.Compose(new Vector3(.5, 2, 3), rotation, new Vector3(1, 2, 3))).multiply(anchor.computeWorldMatrix(true));
    close(owner.inspect().slots[0]!.meshes[0]!.worldMatrix!, Array.from(expected.asArray()));
    const box = owner.bounds()!; expect(box.minimum.x).toBeLessThan(box.maximum.x); expect(Number.isFinite(box.minimum.length())).toBe(true);
    owner.dispose(); expect(anchor.isDisposed()).toBe(false); anchor.dispose();
  });

  it("changes atlas crop through private uniforms while sharing the exact source texture", async () => {
    const value = await fixture("sprite"), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    owner.apply([state(value.components[0]!, 0), state(value.components[0]!, 1, { frame: 1 })]);
    const slots = owner.inspect().slots;
    expect(slots[0]!.material.uniforms).toMatchObject({ vectors4: { sourceUV: [.5, .5, 0, .5] } });
    expect(slots[1]!.material.uniforms).toMatchObject({ vectors4: { sourceUV: [.5, .5, .5, .5] } });
    expect(slots[0]!.material.textures).toEqual(slots[1]!.material.textures); expect(value.reads).toHaveLength(1); owner.dispose();
  });

  it("rolls a sprite in its camera-facing plane despite a rotated parent and camera", async () => {
    const value = await fixture("sprite"), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    const anchor = new TransformNode("rotated source anchor", value.scene); anchor.rotationQuaternion = Quaternion.FromEulerAngles(.5, .8, .4);
    owner.root.parent = anchor; owner.root.setEnabled(true);
    const positionsBefore = value.scene.meshes.filter(mesh => mesh.geometry).map(mesh => Array.from(mesh.getVerticesData("position")!));
    for (const cameraPosition of [new Vector3(0, 0, -10), new Vector3(5, 4, -10)]) {
      value.camera.position.copyFrom(cameraPosition); value.camera.setTarget(Vector3.Zero()); value.camera.getViewMatrix(true);
      owner.apply([state(value.components[0]!, 0, { billboardAngle: 0 })]);
      const base = Matrix.FromArray(owner.inspect().slots[0]!.meshes[0]!.worldMatrix!);
      owner.apply([state(value.components[0]!, 0, { billboardAngle: Math.PI / 2 })]);
      const rolled = Matrix.FromArray(owner.inspect().slots[0]!.meshes[0]!.worldMatrix!);
      const normal = Vector3.TransformNormal(Vector3.Forward(), base).normalize(), afterNormal = Vector3.TransformNormal(Vector3.Forward(), rolled).normalize();
      close(afterNormal.asArray(), normal.asArray());
      expect(Math.abs(Vector3.Dot(normal, cameraPosition.negate().normalize()))).toBeCloseTo(1, 6);
      const oldX = Vector3.TransformNormal(Vector3.Right(), base).normalize(), newX = Vector3.TransformNormal(Vector3.Right(), rolled).normalize();
      expect(Vector3.Dot(oldX, newX)).toBeCloseTo(0, 6);
    }
    expect(value.scene.meshes.filter(mesh => mesh.geometry).map(mesh => Array.from(mesh.getVerticesData("position")!))).toEqual(positionsBefore);
    owner.dispose(); anchor.dispose();
  });

  it.each([false, true])("projects slot-local direction with nested rotation, unequal scale, reflection and camera roll (RH=%s)", async rightHanded => {
    const value = await fixture("sprite"); value.scene.useRightHandedSystem = rightHanded;
    const owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    const anchor = new TransformNode("direction world anchor", value.scene); anchor.position.set(10, -2, 7);
    anchor.rotationQuaternion = Quaternion.FromEulerAngles(.35, -.7, .2); owner.root.parent = anchor;
    owner.root.rotationQuaternion = Quaternion.FromEulerAngles(-.2, .3, .6); owner.root.scaling.set(.7, 2.3, 1.4); owner.root.setEnabled(true);
    const quaternion = Quaternion.FromEulerAngles(.4, .2, -.3).asArray() as [number, number, number, number];
    const prepared = owner.inspect(), resourceCounts = counts(value.scene), reads = [...value.reads];
    const geometry = value.scene.meshes.filter(mesh => mesh.geometry).map(mesh => ({ id: mesh.geometry!.id,
      positions: Array.from(mesh.getVerticesData("position")!), uv: Array.from(mesh.getVerticesData("uv")!) }));
    for (const reflection of [1, -1]) {
      anchor.scaling.set(reflection * 1.3, 3.7, .6);
      for (const cameraPosition of [new Vector3(0, 0, -10), new Vector3(5, 4, -10), new Vector3(-7, 3, 4)]) {
        value.camera.position.copyFrom(cameraPosition); value.camera.upVector.set(.2, 1, .3); value.camera.setTarget(Vector3.Zero()); value.camera.getViewMatrix(true);
        owner.apply([state(value.components[0]!, 0, { position: [1, 2, 3], scale: [.8, 1.7, .6], quaternion, billboardDirection: [1, 2, -.7] })]);
        expectDirection(owner, value.camera);
      }
    }
    expect(owner.inspect().resources).toEqual(prepared.resources); expect(counts(value.scene)).toEqual(resourceCounts); expect(value.reads).toEqual(reads);
    expect(value.scene.meshes.filter(mesh => mesh.geometry).map(mesh => ({ id: mesh.geometry!.id,
      positions: Array.from(mesh.getVerticesData("position")!), uv: Array.from(mesh.getVerticesData("uv")!) }))).toEqual(geometry);
    owner.dispose(); anchor.dispose();
  });

  it("adds explicit roll to directional alignment and restores the untouched init path when direction is omitted", async () => {
    const value = await fixture("sprite"), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    owner.root.setEnabled(true); value.camera.position.set(4, 3, -8); value.camera.setTarget(Vector3.Zero());
    owner.apply([state(value.components[0]!, 0, { billboardAngle: .37 })]);
    const original = owner.inspect().slots[0]!; expect(original.billboard).toBeNull();
    owner.apply([state(value.components[0]!, 0, { billboardDirection: [1, 2, 3] })]);
    expectDirection(owner, value.camera); const aligned = owner.inspect().slots[0]!.billboard!;
    owner.apply([state(value.components[0]!, 0, { billboardDirection: [1, 2, 3], billboardAngle: .37 })]);
    const rolled = owner.inspect().slots[0]!, mesh = value.scene.getMeshById(rolled.meshes[0]!.id)!;
    expect(mesh.rotation.z).toBeCloseTo(aligned.alignmentRollRadians + .37, 12);
    expect(rolled.billboard!.additionalRollRadians).toBe(.37); expect(rolled.billboard!.appliedRollRadians).toBeCloseTo(mesh.rotation.z, 12);
    close(rolled.billboard!.actualWorldNormal!, aligned.actualWorldNormal!);
    owner.apply([state(value.components[0]!, 0, { billboardAngle: .37 })]);
    close(owner.inspect().slots[0]!.meshes[0]!.worldMatrix!, original.meshes[0]!.worldMatrix!); expect(owner.inspect().slots[0]!.billboard).toBeNull();
    owner.apply([]); expect(owner.inspect().slots[0]!.billboard).toBeNull(); owner.dispose();
  });

  it("reprojects after camera follow and before active-mesh culling, including frozen active lists", async () => {
    const value = await fixture("sprite"), observerCount = value.scene.onBeforeCameraRenderObservable.observers.length;
    const owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal); owner.root.setEnabled(true);
    const input = state(value.components[0]!, 0, { billboardDirection: [1, 2, -.7] }); owner.apply([input]);
    const prepared = owner.inspect(), reads = [...value.reads];
    let followed = 0, culled = 0;
    value.scene.onBeforeRenderObservable.add(() => {
      followed++; value.camera.position.set(4 + followed, 2 - followed, -8); value.camera.setTarget(Vector3.Zero()); value.camera.getViewMatrix(true);
    });
    value.scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
      culled++; expectDirection(owner, value.camera); expect(owner.inspect().slots[0]!.billboard!.updatedAt).toBe("before-camera-render");
    });
    value.scene.render(); expect(followed).toBe(1); expect(culled).toBe(1);
    // Freeze without freezing individual world matrices: the pool still must
    // update even though Babylon skips its active-mesh-evaluation observable.
    // NullEngine has no real GPU shader completion; bypass only readiness for
    // the public freeze call, retaining Babylon's actual render/observer path.
    const ready = vi.spyOn(value.scene, "isReady").mockReturnValue(true);
    await new Promise<void>((resolve, reject) => value.scene.freezeActiveMeshes(true, resolve, reject, false));
    ready.mockRestore();
    const frozenCulled = culled; value.scene.render(); expect(followed).toBe(2); expect(culled).toBe(frozenCulled); expectDirection(owner, value.camera);
    expect(owner.inspect().resources).toEqual(prepared.resources); expect(value.reads).toEqual(reads);
    owner.dispose(); expect(value.scene.onBeforeCameraRenderObservable.observers.filter(observer => !observer._willBeUnregistered).length).toBe(observerCount);
    value.scene.unfreezeActiveMeshes();
  });

  it("uses deterministic fallback for zero, camera-parallel, singular and missing-camera directions", async () => {
    const value = await fixture("sprite"), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    owner.root.setEnabled(true);
    for (const [direction, fallback] of [[[0, 0, 0], "zero-direction"], [[0, 0, 1], "parallel-camera"]] as const) {
      owner.apply([state(value.components[0]!, 0, { billboardDirection: [1, 1, 0] })]);
      expect(owner.inspect().slots[0]!.billboard!.alignmentRollRadians).not.toBe(0);
      owner.apply([state(value.components[0]!, 0, { billboardDirection: direction, billboardAngle: .25 })]);
      const row = owner.inspect().slots[0]!, mesh = value.scene.getMeshById(row.meshes[0]!.id)!;
      expect(row.billboard).toMatchObject({ fallback, alignmentRollRadians: 0, appliedRollRadians: .25, projectedDirection: null });
      expect(mesh.rotation.z).toBe(.25);
    }
    owner.root.scaling.x = 0;
    owner.apply([state(value.components[0]!, 0, { billboardDirection: [0, 1, 0] })]);
    expect(owner.inspect().slots[0]!.billboard).toMatchObject({ fallback: "singular-plane", alignmentRollRadians: 0, appliedRollRadians: 0 });
    owner.root.scaling.x = 1; value.scene.activeCamera = null;
    owner.apply([state(value.components[0]!, 0, { billboardDirection: [1, 1, 0], billboardAngle: .25 })]);
    expect(owner.inspect().slots[0]!.billboard).toMatchObject({ fallback: "no-camera", alignmentRollRadians: 0, appliedRollRadians: .25, cameraId: null });
    owner.apply([state(value.components[0]!, 0, { billboardDirection: [1, 1, 0] })]);
    value.scene.activeCamera = value.camera; value.scene.onBeforeCameraRenderObservable.notifyObservers(value.camera); expectDirection(owner, value.camera);
    owner.dispose();
  });

  it("uses each rendering camera and leaves nondirectional sprite spin untouched", async () => {
    const value = await fixture("sprite"), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    const other = new FreeCamera("second render camera", new Vector3(8, -3, 5), value.scene); other.setTarget(Vector3.Zero());
    owner.root.setEnabled(true);
    const direction: [number, number, number] = [1, 2, -.7];
    owner.apply([state(value.components[0]!, 0, { billboardDirection: direction }), state(value.components[0]!, 1, { billboardAngle: .42 })]);
    direction[0] = -100; // The caller cannot mutate a later camera update.
    const before = owner.inspect(), readCount = value.reads.length, observed: string[] = [];
    value.scene.activeCameras = [value.camera, other];
    value.scene.onBeforeCameraRenderObservable.add(camera => {
      observed.push(camera.id); expectDirection(owner, camera as FreeCamera);
      const nondirectional = owner.inspect().slots[1]!, mesh = value.scene.getMeshById(nondirectional.meshes[0]!.id)!;
      expect(nondirectional.billboard).toBeNull(); expect(mesh.rotation.z).toBe(.42);
    });
    value.scene.render(); expect(observed).toEqual([value.camera.id, other.id]);
    expect(owner.inspect().resources).toEqual(before.resources); expect(value.reads).toHaveLength(readCount);
    expect(owner.inspect().slots[0]!.state!.billboardDirection).toEqual([1, 2, -.7]); owner.dispose();
  });

  it.each([[1, 2], [1, 2, 3, 4], [1, NaN, 0], [0, Infinity, 0], [0, 1e40, 0]])("rejects malformed sprite direction %j atomically", async (...direction) => {
    const value = await fixture("sprite"), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    owner.apply([state(value.components[0]!, 0, { billboardDirection: [1, 1, 0] })]); const before = owner.inspect();
    const invalid = state(value.components[0]!, 1, { billboardDirection: direction as [number, number, number] });
    expect(() => owner.apply([state(value.components[0]!), invalid])).toThrow("invalid sprite billboard direction");
    expect(owner.inspect()).toEqual(before); owner.dispose();
  });

  it.each(["unknown", "index", "duplicate", "position", "scale", "rgba", "fade", "frame", "quaternion", "rotation", "billboard", "direction"])("rejects invalid %s atomically", async kind => {
    const value = await fixture(), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    owner.root.setEnabled(true); owner.apply([state(value.components[0]!, 0, { fade: .5 })]); const before = owner.inspect();
    const invalid: any = state(value.components[0]!, 1);
    if (kind === "unknown") invalid.component = "Foreign.Component";
    if (kind === "index") invalid.index = 2;
    if (kind === "position") invalid.position = [NaN, 0, 0];
    if (kind === "scale") invalid.scale = [-1, 1, 1];
    if (kind === "rgba") invalid.rgba = [1, 1, 1, 1.01];
    if (kind === "fade") invalid.fade = Infinity;
    if (kind === "frame") invalid.frame = 2;
    if (kind === "quaternion") invalid.quaternion = [0, 0, 0, 2];
    if (kind === "rotation") invalid.rotation = [0, 0, 0];
    if (kind === "billboard") invalid.billboardAngle = .5;
    if (kind === "direction") invalid.billboardDirection = [1, 0, 0];
    expect(() => owner.apply(kind === "duplicate" ? [invalid, invalid] : [state(value.components[0]!), invalid])).toThrow();
    expect(owner.inspect()).toEqual(before); owner.dispose();
  });

  it.each(["count", "duplicate", "forged"])("rejects invalid %s preparation before allocation", async kind => {
    const value = await fixture(), baseline = counts(value.scene), selected = [...value.components];
    if (kind === "count") value.components[0]!.effectiveProperties.MaxParticles = 0;
    if (kind === "duplicate") selected.push(selected[0]!);
    if (kind === "forged") { selected[0] = structuredClone(selected[0]!); selected[0].effectiveProperties.Opacity = 0; }
    await expect(createNativeEffectParticlePool(value.scene, value.bundle, selected, value.signal.signal)).rejects.toThrow();
    expect(counts(value.scene)).toEqual(baseline); expect(value.reads).toHaveLength(0);
  });

  it("cleans partial preparation when a later exact frame hash fails", async () => {
    const value = await fixture(), baseline = counts(value.scene);
    const next = Object.values(value.bundle.manifest.resources).find(row => row.object.endsWith("Frame1"))!; value.data.set(next.file, png(222));
    await expect(createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal)).rejects.toThrow("hash differs");
    expect(counts(value.scene)).toEqual(baseline);
  });

  it("releases slots before shared owners while preserving foreign children/materials/textures", async () => {
    const value = await fixture(), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    const report = owner.inspect(), mesh = value.scene.getMeshById(report.slots[0]!.meshes[0]!.id)! as Mesh;
    const ownedGeometry = mesh.geometry!, order: string[] = [];
    mesh.onDisposeObservable.add(() => order.push("slot"));
    const disposeGeometry = vi.spyOn(ownedGeometry, "dispose").mockImplementationOnce(function (this: typeof ownedGeometry) { order.push("geometry"); disposeGeometry.mockRestore(); return this.dispose(); });
    const foreign = new TransformNode("foreign", value.scene), nested = new TransformNode("foreign child", value.scene); foreign.parent = mesh; nested.parent = foreign;
    const foreignMaterial = new StandardMaterial("foreign material", value.scene), texture = RawTexture.CreateRGBATexture(new Uint8Array([1, 2, 3, 4]), 1, 1, value.scene);
    mesh.material = foreignMaterial; const slotMaterial = value.scene.getMaterialById(report.slots[1]!.material.id)! as any; slotMaterial.setTexture("sourceTexture", texture);
    const disposeMaterial = vi.spyOn(foreignMaterial, "dispose"), disposeTexture = vi.spyOn(texture, "dispose");
    owner.dispose(); owner.dispose();
    expect(order.indexOf("slot")).toBeLessThan(order.indexOf("geometry"));
    expect(foreign.isDisposed()).toBe(false); expect(nested.isDisposed()).toBe(false); expect(foreign.parent).toBeNull(); expect(nested.parent).toBe(foreign);
    expect(disposeMaterial).not.toHaveBeenCalled(); expect(disposeTexture).not.toHaveBeenCalled();
    expect(value.scene.materials).toEqual([foreignMaterial]); expect(value.scene.textures).toEqual([texture]);
    expect(owner.inspect().resources).toMatchObject({ liveGeometryCount: 0, liveMaterialCount: 0, liveTextureCount: 0 });
    expect(() => owner.apply([])).toThrow("disposed"); expect(owner.bounds()).toBeNull();
    foreign.dispose(); foreignMaterial.dispose(); texture.dispose();
  });

  it("keeps its templates, clones and materials out of authored scene serialization", async () => {
    const value = await fixture(), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    const serialized = SceneSerializer.Serialize(value.scene) as any;
    expect(serialized.meshes).toEqual([]); expect(serialized.transformNodes ?? []).toEqual([]); expect(serialized.materials ?? []).toEqual([]); owner.dispose();
  });

  it("records callbacks only for clone meshes without crediting template draws", async () => {
    const value = await fixture(), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    const before = owner.inspect(), mesh = value.scene.getMeshById(before.slots[0]!.meshes[0]!.id)! as Mesh;
    mesh.onAfterRenderObservable.notifyObservers(mesh);
    expect(owner.inspect().slots[0]!.renderCallbacks).toBe(1); expect(owner.inspect().renderCallbacks).toBe(1);
    expect((owner.inspect().components[0]!.template as any).meshes[0].renderCallbacks).toBe(0); owner.dispose();
  });

  it("disposes on active abort and rejects a pre-aborted creation without allocation", async () => {
    const value = await fixture(), baseline = counts(value.scene), owner = await createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal);
    value.signal.abort(); expect(owner.inspect().status).toBe("disposed"); expect(counts(value.scene)).toEqual(baseline);
    await expect(createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(counts(value.scene)).toEqual(baseline);
  });

  it("disposes a late template after abort without leaking or replacing foreign scene resources", async () => {
    const value = await fixture(), foreign = new StandardMaterial("foreign survivor", value.scene), baseline = counts(value.scene);
    let release!: () => void, loaded!: () => void; const hold = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { loaded = resolve; });
    releases.push(release); gate.next = async () => { loaded(); await hold; };
    const pending = createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal).catch(error => error as Error); operations.push(pending);
    await ready; value.signal.abort(); release(); expect(await pending).toMatchObject({ name: "AbortError" });
    expect(counts(value.scene)).toEqual(baseline); expect(value.scene.materials).toContain(foreign);
  });

  it("handles scene disposal during preparation and active scene disposal", async () => {
    const value = await fixture(); const original = value.bundle.readResource.bind(value.bundle);
    value.bundle.readResource = async (resource, signal) => { const bytes = await original(resource, signal); value.scene.dispose(); return bytes; };
    await expect(createNativeEffectParticlePool(value.scene, value.bundle, value.components, value.signal.signal)).rejects.toMatchObject({ name: "AbortError" });
    const other = await fixture(), owner = await createNativeEffectParticlePool(other.scene, other.bundle, other.components, other.signal.signal);
    other.scene.dispose(); expect(owner.inspect().status).toBe("disposed");
  });
});
