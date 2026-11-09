import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF";
import { sha256, validatePackageModel } from "../assets/package/readAssetPackage";
import { effectFrames, effectObject, simulatedEffectEmitterClasses, type EffectBundle, type EffectComponent, type EffectFrame, type EffectPrimitive, type EffectResource } from "./nativeEffectComponents";
import { createNativeEffectMaterial, type NativeEffectMaterial } from "./nativeEffectMaterial";

export interface EffectComponentSizePolicy {
  kind: "mesh-midpoint-axis-permutation" | "sprite-half-extent-metres";
  sourceMidpointXYZ: [number, number, number];
  appliedScaleXZY: [number, number, number];
  spriteDimensionsMetres: { width: number; height: number } | null;
  actorDrawScaleApplied: false;
  nativeSizeSemanticsVerified: false;
}
export interface LoadedEffectComponent {
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  readonly frames: EffectFrame[];
  readonly component: EffectComponent;
  readonly selectedFrame: EffectFrame;
  readonly materials: NativeEffectMaterial[];
  readonly sizePolicy: EffectComponentSizePolicy;
  inspection(): Record<string, unknown>;
  setColorKey(index: number | null): void;
  dispose(): void;
}
type SourcePrimitive = EffectPrimitive & { sourceAccessorCounts: Record<string, number>; sourceIndices: number | null };
interface ModelSource {
  primitives: SourcePrimitive[];
  nodes: unknown[];
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
function sizePolicy(component: EffectComponent): EffectComponentSizePolicy {
  const range = component.effectiveProperties.StartSizeRange;
  requireValue(effectObject(range), "source StartSizeRange is missing.");
  const midpoint = ["X", "Y", "Z"].map(axis => {
    const item = range[axis];
    requireValue(effectObject(item) && typeof item.Min === "number" && typeof item.Max === "number" &&
      Number.isFinite(item.Min) && Number.isFinite(item.Max) && item.Min >= 0 && item.Max >= item.Min,
    "unsupported source StartSizeRange.");
    const result = item.Min / 2 + item.Max / 2;
    requireValue(Number.isFinite(Math.fround(result)) && result > 0, "preview midpoint must have positive finite extent.");
    return result;
  }) as [number, number, number];
  const sprite = component.class === "Engine.SpriteEmitter";
  return { kind: sprite ? "sprite-half-extent-metres" : "mesh-midpoint-axis-permutation", sourceMidpointXYZ: midpoint,
    appliedScaleXZY: sprite ? [1, 1, 1] : [midpoint[0], midpoint[2], midpoint[1]],
    spriteDimensionsMetres: sprite ? { width: 2 * midpoint[0] / 100, height: 2 * midpoint[1] / 100 } : null,
    actorDrawScaleApplied: false, nativeSizeSemanticsVerified: false };
}

async function modelSource(bytes: Uint8Array<ArrayBuffer>, component: EffectComponent, bundle: EffectBundle): Promise<ModelSource> {
  const info = validatePackageModel(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), jsonSize = view.getUint32(12, true);
  const doc: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonSize)));
  requireValue(effectObject(doc) && Array.isArray(doc.meshes) && Array.isArray(doc.nodes), "invalid source GLB structure.");
  requireValue(info.animations.length === 0 && (doc.skins === undefined || Array.isArray(doc.skins) && doc.skins.length === 0) &&
    !doc.nodes.some(node => effectObject(node) && node.skin !== undefined), "animated or skinned effects are unsupported.");
  requireValue(doc.extensionsRequired === undefined || Array.isArray(doc.extensionsRequired) && doc.extensionsRequired.length === 0,
    "required GLB extensions are unsupported by this static preview.");
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
      requireValue(effectObject(material.pbrMetallicRoughness) && effectObject(material.pbrMetallicRoughness.baseColorTexture) &&
        Array.isArray(doc.textures) && Array.isArray(doc.images) && Array.isArray(doc.bufferViews) && Array.isArray(doc.buffers), "unsupported GLB base texture route.");
      const textureInfo = material.pbrMetallicRoughness.baseColorTexture;
      requireValue(Number.isInteger(textureInfo.index) && Number(textureInfo.index) >= 0 &&
        (textureInfo.texCoord === undefined || textureInfo.texCoord === 0), "invalid texture index or unsupported texture coordinates.");
      const textureNode: unknown = doc.textures[Number(textureInfo.index)];
      requireValue(effectObject(textureNode) && Number.isInteger(textureNode.source), "invalid GLB texture source.");
      const image: unknown = doc.images[Number(textureNode.source)];
      requireValue(effectObject(image) && Number.isInteger(image.bufferView) && image.mimeType === "image/png" && image.uri === undefined, "only embedded PNG textures are supported.");
      const imageView: unknown = doc.bufferViews[Number(image.bufferView)];
      const buffer: unknown = doc.buffers[0];
      requireValue(effectObject(imageView) && imageView.buffer === 0 && effectObject(buffer) && buffer.uri === undefined, "external texture buffer is unsupported.");
      const binaryOffset = 28 + jsonSize;
      requireValue(20 + jsonSize + 8 <= bytes.length && view.getUint32(24 + jsonSize, true) === 0x004e4942 &&
        binaryOffset + view.getUint32(20 + jsonSize, true) === bytes.length, "invalid GLB binary chunk.");
      const offset = imageView.byteOffset ?? 0, length = imageView.byteLength, bufferLength = buffer.byteLength;
      requireValue(typeof offset === "number" && typeof length === "number" && typeof bufferLength === "number" &&
        Number.isSafeInteger(offset) && Number.isSafeInteger(length) && Number.isSafeInteger(bufferLength) && offset >= 0 && length > 0 &&
        offset + length <= bufferLength && binaryOffset + offset + length <= bytes.length,
      "invalid embedded texture span.");
      requireValue(await sha256(bytes.subarray(binaryOffset + offset, binaryOffset + offset + length)) === texture.sha256 && length === texture.bytes,
        "embedded base texture bytes differ from the bound source PNG.");
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
  return { primitives, nodes: doc.nodes };
}

export async function loadEffectComponent(scene: Scene, bundle: EffectBundle, input: EffectComponent,
  options: { frameIndex: number; colorKey?: number | null }, signal: AbortSignal): Promise<LoadedEffectComponent> {
  signal.throwIfAborted(); requireValue(!scene.isDisposed, "scene is disposed.");
  const component = structuredClone(input);
  const matches = bundle.manifest.components.filter(row => row.object === component.object);
  requireValue(matches.length === 1 && JSON.stringify(matches[0]) === JSON.stringify(component), "component differs from its bundle record.");
  const sprite = component.class === "Engine.SpriteEmitter";
  requireValue(simulatedEffectEmitterClasses.has(component.class), "unsupported component class.");
  const policy = sizePolicy(component);
  const primitiveTextures = new Set(component.bindings.primitiveMaterials.map(row => row.textureResourceKey));
  requireValue(sprite || primitiveTextures.size === 1, "multiple independent primitive texture/frame routes are not supported in one preview.");
  const baseTexture = sprite ? component.bindings.texture : bundle.manifest.resources[component.bindings.primitiveMaterials[0]!.textureResourceKey];
  requireValue(baseTexture, "source texture binding is missing.");
  const texture = canonicalResource(bundle, baseTexture, ".png");
  const frames = effectFrames(structuredClone(bundle.manifest), component, texture);
  requireValue(Number.isInteger(options.frameIndex) && options.frameIndex >= 0 && options.frameIndex < frames.length, "selected frame is out of range.");
  const selectedFrame = structuredClone(frames[options.frameIndex]!);
  const root = new TransformNode(`Effect component: ${component.object}`, scene);
  root.id = `native-effect-component:${root.uniqueId}`; root.doNotSerialize = true; root.setEnabled(false);
  const size = new TransformNode(`${root.id}:size`, scene); size.id = size.name; size.parent = root; size.doNotSerialize = true;
  size.scaling.set(...policy.appliedScaleXZY);
  const basis = new TransformNode(`${root.id}:basis`, scene); basis.id = basis.name; basis.parent = size; basis.doNotSerialize = true;
  const owned = new Set<TransformNode>([root, size, basis]);
  const lifetime = new AbortController(), combined = AbortSignal.any([signal, lifetime.signal]);
  let container: AssetContainer | undefined, synthetic: Mesh | undefined, disposed = false;
  let sourceBasis = Matrix.Identity(), inverseBasis = Matrix.Identity(), cancelledBasis = Matrix.Identity();
  const meshes: Mesh[] = [], materials: NativeEffectMaterial[] = [];
  const records: { mesh: Mesh; primitive: SourcePrimitive | null; renderCallbacks: number }[] = [];
  const sceneObserver = scene.onDisposeObservable.add(() => lifetime.abort());
  const dispose = () => {
    if (disposed) return;
    disposed = true; combined.removeEventListener("abort", dispose); scene.onDisposeObservable.remove(sceneObserver); lifetime.abort();
    for (const node of owned) if (!node.isDisposed()) for (const child of node.getChildren(undefined, true)) {
      if (child instanceof TransformNode && !owned.has(child)) child.setParent(null);
    }
    for (const node of [...owned].reverse()) if (!node.isDisposed()) node.dispose(true);
    for (const material of materials) material.dispose();
    container?.dispose();
  };
  try {
    if (sprite) {
      const dimensions = policy.spriteDimensionsMetres!;
      const plane = MeshBuilder.CreatePlane(`${root.id}:sprite`, dimensions, scene);
      scene.removeMesh(plane);
      plane.parent = basis; plane.billboardMode = Mesh.BILLBOARDMODE_ALL; owned.add(plane); meshes.push(plane);
      records.push({ mesh: plane, primitive: null, renderCallbacks: 0 });
    } else {
      requireValue(component.bindings.mesh, "source mesh binding is missing.");
      const model = canonicalResource(bundle, component.bindings.mesh, ".glb");
      const bytes = (await bundle.readResource(model, combined)).slice();
      requireValue(bytes.length === model.bytes && await sha256(bytes) === model.sha256, "source GLB hash/length differs.");
      const source = await modelSource(bytes, component, bundle); combined.throwIfAborted();
      container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: ".glb",
        pluginOptions: { gltf: { skipMaterials: true, animationStartMode: GLTFLoaderAnimationStartMode.NONE } } });
      for (const node of [...container.meshes, ...container.transformNodes]) {
        owned.add(node); node.doNotSerialize = true; if (node instanceof Mesh) node.isPickable = false;
      }
      combined.throwIfAborted(); requireValue(!scene.isDisposed, "scene was disposed during GLB load.");
      requireValue(container.skeletons.length === 0 && container.animationGroups.length === 0 && container.materials.length === 0 &&
        container.textures.length === 0 && container.cameras.length === 0, "loader created unsupported runtime resources.");
      const tops = [...container.meshes, ...container.transformNodes].filter(node => !node.parent);
      requireValue(tops.length === 1 && tops[0] instanceof Mesh && tops[0].name === "__root__" &&
        tops[0].getTotalVertices() === 0 && pointers(tops[0]).length === 0, "synthetic glTF root is missing or ambiguous.");
      synthetic = tops[0]; synthetic.computeWorldMatrix(true); sourceBasis = synthetic._localMatrix.clone();
      const expected = scene.useRightHandedSystem ? Matrix.Identity() : Matrix.Compose(new Vector3(1, 1, -1), new Quaternion(0, 1, 0, 0), Vector3.Zero());
      requireValue(sourceBasis.equalsWithEpsilon(expected, 1e-7), "unexpected synthetic glTF AUTO basis; authored nodes will not be inverted.");
      inverseBasis = Matrix.Invert(sourceBasis); basis.setPreTransformMatrix(inverseBasis);
      cancelledBasis = sourceBasis.multiply(inverseBasis);
      const candidates = container.meshes.filter(mesh => mesh.getTotalVertices() > 0);
      requireValue(candidates.length === source.primitives.length && candidates.every(mesh => mesh instanceof Mesh), "loaded primitive set differs from source.");
      const matched = new Set<Mesh>();
      for (const primitive of source.primitives) {
        const pointer = `/meshes/${primitive.meshIndex}/primitives/${primitive.primitiveIndex}`;
        const found = candidates.filter(mesh => pointers(mesh).includes(pointer));
        requireValue(found.length === 1 && found[0] instanceof Mesh && !matched.has(found[0]) &&
          found[0].getTotalVertices() === primitive.sourceAccessorCounts.POSITION &&
          (primitive.sourceIndices === null || found[0].getTotalIndices() === primitive.sourceIndices), "loaded primitive identity/count differs.");
        const mesh = found[0]; matched.add(mesh); meshes.push(mesh); records.push({ mesh, primitive, renderCallbacks: 0 });
      }
    }
    combined.throwIfAborted(); requireValue(!scene.isDisposed, "scene was disposed before material preparation.");
    const png = await bundle.readResource(selectedFrame.texture, combined);
    const material = await createNativeEffectMaterial(scene, { component, texture: selectedFrame.texture, png,
      ...(options.colorKey === undefined ? {} : { colorKey: options.colorKey }), uvScale: selectedFrame.uvScale, uvOffset: selectedFrame.uvOffset }, combined);
    materials.push(material); combined.throwIfAborted();
    for (const record of records) {
      const mesh = record.mesh; mesh.isPickable = false; mesh.doNotSerialize = true; mesh.material = material.material;
      mesh.onAfterRenderObservable.add(() => { record.renderCallbacks++; });
    }
    if (container && synthetic) {
      const enabled = synthetic.isEnabled(); synthetic.setEnabled(false);
      container.addAllToScene(); synthetic.parent = basis; synthetic.setEnabled(enabled);
    } else for (const mesh of meshes) scene.addMesh(mesh);
    const handle: LoadedEffectComponent = {
      root, meshes: [...meshes], frames: structuredClone(frames), component: structuredClone(component), selectedFrame: structuredClone(selectedFrame),
      materials: [...materials], sizePolicy: structuredClone(policy),
      setColorKey(index) { requireValue(!disposed, "preview is disposed."); for (const owner of materials) owner.setColorKey(index); },
      inspection() {
        if (!disposed) { root.computeWorldMatrix(true); size.computeWorldMatrix(true); basis.computeWorldMatrix(true); }
        return { status: disposed ? "disposed" : "ready", componentObject: component.object, componentClass: component.class,
          sourceBundleSha256: bundle.manifestSha256, sourceMesh: component.bindings.mesh, selectedFrame: structuredClone(selectedFrame), sizePolicy: structuredClone(policy),
          sourceBasisMatrix: Array.from(sourceBasis.asArray()), inverseBasisMatrix: Array.from(inverseBasis.asArray()), cancelledBasisMatrix: Array.from(cancelledBasis.asArray()),
          rootId: root.id, rootEnabled: !disposed && root.isEnabled(), rootLocalMatrix: disposed ? null : Array.from(root._localMatrix.asArray()),
          rootWorldMatrix: disposed ? null : Array.from(root.getWorldMatrix().asArray()), sizeLocalMatrix: disposed ? null : Array.from(size._localMatrix.asArray()),
          sizeWorldMatrix: disposed ? null : Array.from(size.getWorldMatrix().asArray()),
          basisWorldMatrix: disposed ? null : Array.from(basis.getWorldMatrix().asArray()),
          meshes: records.map(({ mesh, primitive, renderCallbacks }) => {
            if (!disposed) { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); }
            return { id: mesh.id, uniqueId: mesh.uniqueId, gltfPointers: pointers(mesh), sourcePrimitive: primitive,
              sourceAccessorCounts: primitive?.sourceAccessorCounts ?? null, vertices: mesh.getTotalVertices(), indices: mesh.getTotalIndices(),
              worldMatrix: disposed ? null : Array.from(mesh.getWorldMatrix().asArray()),
              bounds: disposed ? null : { minimum: mesh.getBoundingInfo().boundingBox.minimumWorld.asArray(), maximum: mesh.getBoundingInfo().boundingBox.maximumWorld.asArray() },
              enabled: !disposed && mesh.isEnabled(), visible: !disposed && mesh.isVisible, isPickable: mesh.isPickable, materialId: mesh.material?.id ?? null,
              renderCallbacks, drawEvidence: "mesh-render-callbacks; not a native/visible-pixel proof" };
          }), materials: materials.map(owner => ({ ...owner.inspect(), materialId: owner.material.id,
            live: { alphaMode: owner.material.alphaMode, backFaceCulling: owner.material.backFaceCulling,
              depthFunction: owner.material.depthFunction, disableDepthWrite: owner.material.disableDepthWrite, forceDepthWrite: owner.material.forceDepthWrite,
              alphaBlending: owner.material.needAlphaBlending(), alphaTesting: owner.material.needAlphaTesting(),
              textures: owner.material.getActiveTextures().map(texture => ({ name: texture.name, uniqueId: texture.uniqueId,
                gammaSpace: texture.gammaSpace, wrapU: texture.wrapU, wrapV: texture.wrapV })) } })),
          limitations: ["Disabled unit-local root; manager owns attachment and enabling.", "Only synthetic glTF AUTO basis is cancelled once; authored source-node matrices remain unchanged.",
            "Midpoint size and sprite half-extents/billboard orientation are explicit preview conventions; actor DrawScale is not applied.",
            "No spawn, velocity, spin, fade, time, native attachment/composition or complete skill playback is inferred."] };
      }, dispose,
    };
    combined.addEventListener("abort", dispose, { once: true });
    combined.throwIfAborted(); requireValue(!scene.isDisposed, "scene was disposed before preview return.");
    return handle;
  } catch (error) { dispose(); throw error; }
}
