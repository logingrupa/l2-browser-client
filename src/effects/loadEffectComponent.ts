import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlaneVertexData } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF";
import { sha256, validatePackageModel } from "../assets/package/readAssetPackage";
import { selectTextureFrame } from "../materials/ue2/babylon/material";
import type { EmitterSimulation } from "./particles/sim/emitterActor";
import { parseEmitterRecord, type ParticleEmitterRecord, type Rotator } from "./particles/sim/emitterRecords";
import { attachParticleInstanceBuffers, createParticleInstanceBuffers, uploadParticleInstances, writeParticleInstances, type ParticleInstanceBuffers } from "./particles/render/particleInstances";
import { bindParticleMaterial, type ParticleMaterialBinding } from "./particles/render/particleMaterialBinding";
import { effectFrames, effectObject, type EffectBundle, type EffectComponent, type EffectFrame, type EffectPrimitive, type EffectResource } from "./nativeEffectComponents";
import { createNativeEffectTexture } from "./nativeEffectTexture";

export interface EffectComponentPresentation {
  readonly levelSeconds: number;
  readonly emitterRotation: Rotator;
  readonly pinnedFrame: EffectFrame | null;
  readonly colourOverride: readonly [number, number, number, number] | null;
}

export interface LoadedEffectComponent {
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly frames: readonly EffectFrame[];
  readonly component: EffectComponent;
  readonly record: ParticleEmitterRecord;
  readonly materials: readonly ParticleMaterialBinding[];
  render(emitter: EmitterSimulation, presentation: EffectComponentPresentation): number;
  inspection(): Record<string, unknown>;
  dispose(): void;
}

type SourcePrimitive = EffectPrimitive & { sourceAccessorCounts: Record<string, number>; sourceIndices: number | null };

interface PrimitiveDraw {
  readonly mesh: Mesh;
  readonly primitive: SourcePrimitive | null;
  readonly textureChain: readonly EffectResource[];
  readonly maximumFrameRate: number;
  readonly material: ParticleMaterialBinding;
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Effect component geometry: ${message}`);
}

function pointers(node: TransformNode): string[] {
  const value: unknown = node._internalMetadata?.gltf?.pointers;
  return Array.isArray(value) ? value.filter((pointer): pointer is string => typeof pointer === "string") : [];
}

function canonicalResource(bundle: EffectBundle, resource: EffectResource, extension: ".glb" | ".png"): EffectResource {
  const value = bundle.manifest.resources[resource.assetId];
  requireValue(value && value.object === resource.object && value.sha256 === resource.sha256 && value.bytes === resource.bytes &&
    value.file === resource.file && value.file.endsWith(extension), "selected resource is not an exact bundle binding.");
  return structuredClone(value);
}

function textureChainOf(bundle: EffectBundle, component: EffectComponent, texture: EffectResource): EffectResource[] {
  const chain = new Map<string, EffectResource>();
  for (const frame of effectFrames(bundle.manifest, component, canonicalResource(bundle, texture, ".png"))) chain.set(frame.texture.assetId, frame.texture);
  return [...chain.values()];
}

function maximumFrameRateOf(bundle: EffectBundle, texture: EffectResource): number {
  const frameRate = bundle.manifest.textureGraph.find(row => row.object === texture.object)?.animationProperties.MaxFrameRate ?? 0;
  requireValue(typeof frameRate === "number" && Number.isFinite(frameRate), `${texture.object} MaxFrameRate is not a finite number.`);
  return frameRate;
}

async function requireEmbeddedTexture(bytes: Uint8Array<ArrayBuffer>, doc: Record<string, unknown>, jsonSize: number, material: Record<string, unknown>, texture: EffectResource): Promise<void> {
  requireValue(effectObject(material.pbrMetallicRoughness) && effectObject(material.pbrMetallicRoughness.baseColorTexture) &&
    Array.isArray(doc.textures) && Array.isArray(doc.images) && Array.isArray(doc.bufferViews) && Array.isArray(doc.buffers), "unsupported GLB base texture route.");
  const textureInfo = material.pbrMetallicRoughness.baseColorTexture;
  requireValue(Number.isInteger(textureInfo.index) && Number(textureInfo.index) >= 0 &&
    (textureInfo.texCoord === undefined || textureInfo.texCoord === 0), "invalid texture index or unsupported texture coordinates.");
  const textureNode: unknown = doc.textures[Number(textureInfo.index)];
  requireValue(effectObject(textureNode) && Number.isInteger(textureNode.source), "invalid GLB texture source.");
  const image: unknown = doc.images[Number(textureNode.source)];
  requireValue(effectObject(image) && Number.isInteger(image.bufferView) && image.mimeType === "image/png" && image.uri === undefined, "only embedded PNG textures are supported.");
  const imageView: unknown = doc.bufferViews[Number(image.bufferView)], buffer: unknown = doc.buffers[0];
  requireValue(effectObject(imageView) && imageView.buffer === 0 && effectObject(buffer) && buffer.uri === undefined, "external texture buffer is unsupported.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), binaryOffset = 28 + jsonSize;
  requireValue(20 + jsonSize + 8 <= bytes.length && view.getUint32(24 + jsonSize, true) === 0x004e4942 &&
    binaryOffset + view.getUint32(20 + jsonSize, true) === bytes.length, "invalid GLB binary chunk.");
  const offset = imageView.byteOffset ?? 0, length = imageView.byteLength, bufferLength = buffer.byteLength;
  requireValue(typeof offset === "number" && typeof length === "number" && typeof bufferLength === "number" &&
    Number.isSafeInteger(offset) && Number.isSafeInteger(length) && Number.isSafeInteger(bufferLength) && offset >= 0 && length > 0 &&
    offset + length <= bufferLength && binaryOffset + offset + length <= bytes.length, "invalid embedded texture span.");
  requireValue(await sha256(bytes.subarray(binaryOffset + offset, binaryOffset + offset + length)) === texture.sha256 && length === texture.bytes,
    "embedded base texture bytes differ from the bound source PNG.");
}

async function modelSource(bytes: Uint8Array<ArrayBuffer>, component: EffectComponent, bundle: EffectBundle): Promise<SourcePrimitive[]> {
  const info = validatePackageModel(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), jsonSize = view.getUint32(12, true);
  const doc: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonSize)));
  requireValue(effectObject(doc) && Array.isArray(doc.meshes) && Array.isArray(doc.nodes), "invalid source GLB structure.");
  requireValue(info.animations.length === 0 && (doc.skins === undefined || Array.isArray(doc.skins) && doc.skins.length === 0) &&
    !doc.nodes.some(node => effectObject(node) && node.skin !== undefined), "animated or skinned effects are unsupported.");
  requireValue(doc.extensionsRequired === undefined || Array.isArray(doc.extensionsRequired) && doc.extensionsRequired.length === 0,
    "required GLB extensions are unsupported.");
  requireValue(Array.isArray(doc.materials) && Array.isArray(doc.accessors), "source GLB material/accessor records are missing.");
  const materials = doc.materials, accessors = doc.accessors;
  const primitives: SourcePrimitive[] = [], matched = new Set<string>();
  for (const [meshIndex, mesh] of doc.meshes.entries()) {
    requireValue(effectObject(mesh) && Array.isArray(mesh.primitives), "invalid source mesh primitives.");
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      requireValue(effectObject(primitive) && effectObject(primitive.attributes) && !primitive.targets &&
        !Object.keys(primitive.attributes).some(key => /^(JOINTS|WEIGHTS)_/.test(key)) && (primitive.mode === undefined || primitive.mode === 4),
      "only static triangle primitives are supported.");
      const binding = component.bindings.primitiveMaterials.filter(row => row.meshIndex === meshIndex && row.primitiveIndex === primitiveIndex);
      requireValue(binding.length === 1 && binding[0]!.materialIndex === primitive.material, "source primitive material binding differs.");
      const selected = binding[0]!, material: unknown = materials[selected.materialIndex];
      requireValue(effectObject(material) && effectObject(material.extras) && material.extras.nativeSourceReference === selected.nativeSourceReference,
        "source primitive texture identity differs.");
      const texture = bundle.manifest.resources[selected.textureResourceKey];
      requireValue(texture && texture.object === selected.nativeSourceReference && texture.file.endsWith(".png"), "base texture resource is missing.");
      await requireEmbeddedTexture(bytes, doc, jsonSize, material, texture);
      const counts: Record<string, number> = {};
      for (const [attribute, index] of Object.entries(primitive.attributes)) {
        const accessor: unknown = accessors[Number(index)];
        requireValue(Number.isInteger(index) && effectObject(accessor) && Number.isSafeInteger(accessor.count) && Number(accessor.count) > 0, "invalid source attribute accessor.");
        counts[attribute] = Number(accessor.count);
      }
      requireValue(counts.POSITION && counts.TEXCOORD_0 === counts.POSITION, "source position/UV counts differ.");
      let indexCount: number | null = null;
      if (primitive.indices !== undefined) {
        const accessor: unknown = accessors[Number(primitive.indices)];
        requireValue(Number.isInteger(primitive.indices) && effectObject(accessor) && Number.isSafeInteger(accessor.count), "invalid source index accessor.");
        indexCount = Number(accessor.count);
      }
      primitives.push({ ...selected, sourceAccessorCounts: counts, sourceIndices: indexCount }); matched.add(`${meshIndex}:${primitiveIndex}`);
    }
  }
  requireValue(primitives.length > 0 && matched.size === component.bindings.primitiveMaterials.length, "unmatched or duplicate primitive bindings.");
  return primitives;
}

function adoptPrimitiveMeshes(container: AssetContainer, primitives: readonly SourcePrimitive[]): Mesh[] {
  const tops = [...container.meshes, ...container.transformNodes].filter(node => !node.parent);
  requireValue(tops.length === 1 && tops[0] instanceof Mesh && tops[0].name === "__root__" && tops[0].getTotalVertices() === 0,
    "synthetic glTF root is missing or ambiguous.");
  const syntheticRoot = tops[0];
  const inverseRootWorld = Matrix.Invert(syntheticRoot.computeWorldMatrix(true));
  const candidates = container.meshes.filter(mesh => mesh.getTotalVertices() > 0);
  requireValue(candidates.length === primitives.length && candidates.every(mesh => mesh instanceof Mesh), "loaded primitive set differs from source.");
  const adopted = primitives.map(primitive => {
    const pointer = `/meshes/${primitive.meshIndex}/primitives/${primitive.primitiveIndex}`;
    const found = candidates.filter(mesh => pointers(mesh).includes(pointer));
    requireValue(found.length === 1 && found[0] instanceof Mesh && found[0].getTotalVertices() === primitive.sourceAccessorCounts.POSITION &&
      (primitive.sourceIndices === null || found[0].getTotalIndices() === primitive.sourceIndices), "loaded primitive identity/count differs.");
    return found[0];
  });
  requireValue(new Set(adopted).size === adopted.length, "two source primitives matched one loaded mesh.");
  for (const mesh of adopted) {
    const authoredNodeMatrix = mesh.computeWorldMatrix(true).multiply(inverseRootWorld);
    mesh.parent = null;
    mesh.position.setAll(0); mesh.rotationQuaternion = null; mesh.rotation.setAll(0); mesh.scaling.setAll(1);
    mesh.bakeTransformIntoVertices(authoredNodeMatrix);
  }
  container.meshes = container.meshes.filter(mesh => !adopted.includes(mesh as Mesh));
  container.geometries = container.geometries.filter(geometry => !adopted.some(mesh => mesh.geometry === geometry));
  return adopted;
}

export async function loadEffectComponent(scene: Scene, bundle: EffectBundle, input: EffectComponent, signal: AbortSignal): Promise<LoadedEffectComponent> {
  signal.throwIfAborted(); requireValue(!scene.isDisposed, "scene is disposed.");
  const component = structuredClone(input);
  const matches = bundle.manifest.components.filter(row => row.object === component.object);
  requireValue(matches.length === 1 && JSON.stringify(matches[0]) === JSON.stringify(component), "component differs from its bundle record.");
  const record = parseEmitterRecord(component);
  if (record.emitterClass === "Engine.RibbonEmitter") throw new Error(`Effect component ${component.object}: ribbon-texture-unstaged, the bundle binds no RibbonEmitter texture to draw its point strip with.`);
  const sprite = record.emitterClass === "Engine.SpriteEmitter";
  const root = new TransformNode(`Effect component: ${component.object}`, scene);
  root.id = `native-effect-component:${root.uniqueId}`; root.doNotSerialize = true; root.setEnabled(false);
  const draws: PrimitiveDraw[] = [], textures = new Map<string, RawTexture>(), ownedMeshes: Mesh[] = [];
  let buffers: ParticleInstanceBuffers | null = null, liveInstances = 0, disposed = false;
  const detachForeignChildren = () => {
    const owned = new Set<TransformNode>([root, ...ownedMeshes]);
    for (const node of owned) if (!node.isDisposed()) for (const child of node.getChildren(undefined, true)) if (!(child instanceof TransformNode && owned.has(child))) child.parent = null;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose); scene.onDisposeObservable.remove(sceneObserver);
    detachForeignChildren();
    for (const draw of draws) draw.material.dispose();
    for (const mesh of ownedMeshes) if (!mesh.isDisposed()) mesh.dispose(false, false);
    for (const texture of textures.values()) texture.dispose();
    if (!root.isDisposed()) root.dispose(false, false);
  };
  const sceneObserver = scene.onDisposeObservable.addOnce(dispose);
  const textureFor = async (resource: EffectResource) => {
    const known = textures.get(resource.assetId);
    if (known) return known;
    const png = await bundle.readResource(resource, signal);
    const texture = await createNativeEffectTexture(scene, canonicalResource(bundle, resource, ".png"), png, signal);
    textures.set(resource.assetId, texture);
    return texture;
  };
  try {
    const sources: { mesh: Mesh; primitive: SourcePrimitive | null; texture: EffectResource }[] = [];
    if (sprite) {
      requireValue(component.bindings.texture, "sprite texture binding is missing.");
      const quad = new Mesh(`${root.id}:sprite`, scene);
      ownedMeshes.push(quad);
      sources.push({ mesh: quad, primitive: null, texture: component.bindings.texture });
    } else {
      requireValue(component.bindings.mesh, "source mesh binding is missing.");
      const model = canonicalResource(bundle, component.bindings.mesh, ".glb");
      const bytes = (await bundle.readResource(model, signal)).slice();
      requireValue(bytes.length === model.bytes && await sha256(bytes) === model.sha256, "source GLB hash/length differs.");
      const primitives = await modelSource(bytes, component, bundle); signal.throwIfAborted();
      const container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: ".glb",
        pluginOptions: { gltf: { skipMaterials: true, animationStartMode: GLTFLoaderAnimationStartMode.NONE } } });
      try {
        requireValue(container.skeletons.length === 0 && container.animationGroups.length === 0 && container.materials.length === 0 &&
          container.textures.length === 0 && container.cameras.length === 0, "loader created unsupported runtime resources.");
        const adopted = adoptPrimitiveMeshes(container, primitives);
        ownedMeshes.push(...adopted);
        adopted.forEach((mesh, index) => {
          const primitive = primitives[index]!;
          sources.push({ mesh, primitive, texture: bundle.manifest.resources[primitive.textureResourceKey]! });
        });
      } finally { container.dispose(); }
      signal.throwIfAborted();
    }
    for (const source of sources) {
      const textureChain = textureChainOf(bundle, component, source.texture);
      const texture = await textureFor(textureChain[0]!);
      for (const frameTexture of textureChain.slice(1)) await textureFor(frameTexture);
      source.mesh.id = `${root.id}:${source.primitive ? `${source.primitive.meshIndex}:${source.primitive.primitiveIndex}` : "sprite"}`;
      source.mesh.doNotSerialize = true; source.mesh.isPickable = false; source.mesh.parent = root;
      const material = bindParticleMaterial(scene, source.mesh, { record, emitterOrdinal: component.emitterOrdinal, texture });
      if (source.primitive === null) CreatePlaneVertexData({ size: 2 }).applyToMesh(source.mesh);
      draws.push({ mesh: source.mesh, primitive: source.primitive, textureChain, maximumFrameRate: maximumFrameRateOf(bundle, textureChain[0]!), material });
    }
    signal.throwIfAborted(); requireValue(!scene.isDisposed, "scene was disposed before the component was ready.");
    for (const draw of draws) if (!scene.meshes.includes(draw.mesh)) scene.addMesh(draw.mesh);
    const frames = effectFrames(bundle.manifest, component, canonicalResource(bundle, sources[0]!.texture, ".png"));
    const ensureBuffers = (capacity: number): ParticleInstanceBuffers => {
      if (buffers && buffers.capacity >= capacity) return buffers;
      const next = createParticleInstanceBuffers(Math.max(1, capacity));
      for (const draw of draws) attachParticleInstanceBuffers(draw.mesh, next);
      buffers = next;
      return next;
    };
    ensureBuffers(record.MaxParticles);
    signal.addEventListener("abort", dispose, { once: true });
    return {
      root, meshes: draws.map(draw => draw.mesh), frames, component, record, materials: draws.map(draw => draw.material),
      render(emitter, presentation) {
        requireValue(!disposed, "the component is disposed.");
        requireValue(emitter.record.object === record.object, `emitter ${emitter.record.object} does not belong to ${record.object}.`);
        const target = ensureBuffers(emitter.columns.capacity);
        const pinned = presentation.pinnedFrame;
        liveInstances = writeParticleInstances(emitter, target, {
          emitterRotation: presentation.emitterRotation, colourOverride: presentation.colourOverride,
          atlasOverride: pinned ? [...pinned.uvScale, ...pinned.uvOffset] : null,
        });
        for (const draw of draws) {
          const frameIndex = pinned ? draw.textureChain.findIndex(texture => texture.assetId === pinned.texture.assetId)
            : selectTextureFrame({ kind: "anim-next", frameCount: draw.textureChain.length, maximumFrameRate: draw.maximumFrameRate }, presentation.levelSeconds).index;
          draw.material.setTexture(textures.get(draw.textureChain[Math.max(0, frameIndex)]!.assetId)!);
          uploadParticleInstances(draw.mesh, liveInstances);
        }
        if (liveInstances > 0) emitter.markDrawn();
        return liveInstances;
      },
      inspection() {
        return {
          status: disposed ? "disposed" : "ready", componentObject: component.object, componentClass: component.class, emitterOrdinal: component.emitterOrdinal,
          sourceBundleSha256: bundle.manifestSha256, rootId: root.id, rootEnabled: !disposed && root.isEnabled(), liveInstances,
          instanceCapacity: buffers?.capacity ?? 0,
          meshes: draws.map(draw => ({ id: draw.mesh.id, sourcePrimitive: draw.primitive, vertices: draw.mesh.getTotalVertices(), indices: draw.mesh.getTotalIndices(),
            thinInstances: disposed ? 0 : draw.mesh.thinInstanceCount, visible: !disposed && draw.mesh.isVisible, materialId: draw.mesh.material?.id ?? null,
            metadata: draw.mesh.metadata as unknown, textureChain: draw.textureChain.map(texture => texture.object), maximumFrameRate: draw.maximumFrameRate })),
          materials: draws.map(draw => draw.material.inspect()),
        };
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
