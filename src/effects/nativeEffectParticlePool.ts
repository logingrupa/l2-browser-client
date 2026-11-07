import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Geometry } from "@babylonjs/core/Meshes/geometry";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";
import { loadEffectComponent, type LoadedEffectComponent } from "./loadEffectComponent";
import { createNativeEffectMaterial, type NativeEffectMaterial } from "./nativeEffectMaterial";
import type { EffectBundle, EffectComponent, EffectFrame, EffectResource } from "./nativeEffectComponents";

type Triple = readonly [number, number, number];
type Quad = readonly [number, number, number, number];
/** Caller-evaluated, unit-local state. Scale multiplies the template's retained
 * midpoint size, never native actor DrawScale. Exactly one rotation is required. */
export type NativeEffectParticleState = {
  readonly component: string; readonly index: number;
  readonly position: Triple; readonly scale: Triple; readonly rgba: Quad;
  readonly fade: number; readonly frame: number;
  /** Modern sprite presentation: mesh-local Z roll survives Babylon billboarding.
   * Caller supplies radians; this does not establish native spin units. */
  readonly billboardAngle?: number;
  /** Sprite +Y alignment: slot-local browser XYZ direction, transformed by the
   * slot world linear matrix and projected into the current camera plane.
   * billboardAngle remains an additional in-plane roll. */
  readonly billboardDirection?: Triple;
} & ({ readonly quaternion: Quad; readonly rotation?: never } | { readonly rotation: Triple; readonly quaternion?: never });

export interface NativeEffectParticlePool {
  readonly root: TransformNode;
  readonly capacity: number;
  readonly capacities: Readonly<Record<string, number>>;
  hasSlot(component: string, index: number): boolean;
  /** Validates the complete batch before changing any slot. Does not enable root. */
  apply(states: readonly NativeEffectParticleState[]): void;
  bounds(): { minimum: Vector3; maximum: Vector3 } | null;
  inspect(): NativeEffectParticlePoolInspection;
  dispose(): void;
}

interface Slot {
  component: Prepared; index: number; root: TransformNode; meshes: Mesh[];
  material: ShaderMaterial; color: Color4; uv: Vector4;
  state: NativeEffectParticleState | null; active: boolean; renderCallbacks: number; lastDrawFrame: number | null;
  billboard: NativeEffectBillboardInspection | null;
}
export interface NativeEffectBillboardInspection {
  policy: "slot-world-direction-camera-projection-v1";
  cameraId: string | null; cameraUniqueId: number | null;
  updatedAt: "apply" | "before-camera-render"; renderId: number;
  localDirection: Triple; worldDirection: Triple | null; projectedDirection: Triple | null;
  alignmentRollRadians: number; additionalRollRadians: number; appliedRollRadians: number;
  fallback: "none" | "no-camera" | "zero-direction" | "nonfinite-transform" | "singular-plane" | "parallel-camera";
  /** Actual axes read back from the same rotated mesh world matrix. */
  actualWorldYAxis: Triple | null; actualWorldNormal: Triple | null;
}
interface Prepared {
  component: EffectComponent; template: LoadedEffectComponent; frames: { frame: EffectFrame; texture: BaseTexture }[];
  originalOpacity: number; slots: Slot[];
}
export interface NativeEffectParticlePoolInspection {
  policy: "caller-evaluated-source-component-pool-v1";
  status: "ready" | "disposed"; manifestSha256: string;
  rootId: string; rootEnabled: boolean; rootParentId: string | null;
  capacity: number; capacities: Readonly<Record<string, number>>; activeSlots: number;
  renderCallbacks: number; lastDrawFrame: number | null;
  applications: number;
  resources: { templateCount: number; geometryCount: number; slotMaterialCount: number; ownerMaterialCount: number;
    textureCount: number; resourceReads: number; liveGeometryCount: number; liveMaterialCount: number; liveTextureCount: number;
    geometryIds: string[]; materialIds: string[]; textureUniqueIds: number[];
    disposedGeometryCount: number; disposedMaterialCount: number; disposedTextureCount: number };
  components: { object: string; actor: string; sourcePointer: string; maxParticles: number; template: Record<string, unknown>;
    frames: { index: number; source: EffectFrame; textureUniqueId: number }[] }[];
  slots: { component: string; sourcePointer: string; emitterOrdinal: number; index: number; active: boolean; enabled: boolean; rootId: string;
    state: NativeEffectParticleState | null; rootLocalMatrix: number[] | null; rootWorldMatrix: number[] | null;
    billboard: NativeEffectBillboardInspection | null;
    renderCallbacks: number; lastDrawFrame: number | null;
    meshes: { id: string; parentId: string | null; isPickable: boolean; geometryId: string | null; materialId: string | null; enabled: boolean; localMatrix: number[] | null; worldMatrix: number[] | null }[];
    material: { id: string; originalSourceOpacity: number; uniforms: Record<string, unknown> | null;
      alphaMode: number; depthFunction: number; disableDepthWrite: boolean; forceDepthWrite: boolean; backFaceCulling: boolean;
      textures: { name: string; uniqueId: number }[] } }[];
  nativeTimingVerified: false; nativeCompositionVerified: false; limitations: string[];
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Native effect particle pool: ${message}`);
}
function vector(value: unknown, count: number): value is number[] {
  return Array.isArray(value) && value.length === count && value.every(item => typeof item === "number" && Number.isFinite(Math.fround(item)));
}
function resourceKey(resource: EffectResource) { return `${resource.assetId}:${resource.sha256}`; }
function onlyTexture(owner: NativeEffectMaterial): BaseTexture {
  const textures = owner.material.getActiveTextures();
  requireValue(textures.length === 1, "template must bind one verified texture."); return textures[0]!;
}

/** Fixed-capacity presentation only. Templates/frames are prepared once; apply
 * performs no asynchronous work, resource reads, PNG decode or GLB allocation.
 * No timer, simulation, color interpolation, frame rate or DrawScale is inferred. */
export async function createNativeEffectParticlePool(scene: Scene, inputBundle: EffectBundle,
  inputComponents: readonly EffectComponent[], signal: AbortSignal): Promise<NativeEffectParticlePool> {
  signal.throwIfAborted(); requireValue(!scene.isDisposed, "scene is disposed.");
  const manifest = structuredClone(inputBundle.manifest), manifestSha256 = inputBundle.manifestSha256;
  const components = structuredClone(inputComponents), capacityValues: Record<string, number> = Object.create(null);
  requireValue(Array.isArray(components) && components.length > 0 && components.length <= 64, "invalid component selection.");
  let capacity = 0;
  for (const component of components) {
    const canonical = manifest.components.filter(row => row.object === component.object);
    requireValue(canonical.length === 1 && JSON.stringify(canonical[0]) === JSON.stringify(component), "component differs from its bundle record.");
    requireValue(!Object.hasOwn(capacityValues, component.object), "duplicate component.");
    const count = component.effectiveProperties.MaxParticles;
    requireValue(typeof count === "number" && Number.isSafeInteger(count) && count > 0 && count <= 256, "MaxParticles must be an explicit bounded positive integer.");
    capacityValues[component.object] = count; capacity += count;
  }
  requireValue(capacity <= 512, "selected pool exceeds 512 slots.");
  const capacities = Object.freeze(capacityValues);
  const root = new TransformNode("Native effect particle pool", scene);
  root.id = `native-effect-pool:${root.uniqueId}`; root.doNotSerialize = true; root.setEnabled(false);
  const ownedNodes = new Set<TransformNode>([root]), slotMaterials = new Set<ShaderMaterial>();
  const prepared: Prepared[] = [], templates: LoadedEffectComponent[] = [], extraOwners: NativeEffectMaterial[] = [];
  const textureCache = new Map<string, BaseTexture>(), resourceCache = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  const geometries = new Set<Geometry>(), ownerMaterials = new Set<ShaderMaterial>(), textures = new Set<BaseTexture>();
  const disposedMaterials = new Set<ShaderMaterial>(), disposedTextures = new Set<BaseTexture>();
  const slots: Slot[] = [], componentMap = new Map<string, Prepared>();
  const lifetime = new AbortController(); let disposed = false, resourceReads = 0, applications = 0;
  const sourceRead = inputBundle.readResource.bind(inputBundle);
  const bundle: EffectBundle = { manifest, manifestSha256, async readResource(resource, readSignal) {
    readSignal.throwIfAborted(); lifetime.signal.throwIfAborted();
    const key = resourceKey(resource); let pending = resourceCache.get(key);
    if (!pending) { resourceReads++; pending = sourceRead(resource, lifetime.signal).then(bytes => bytes.slice()); resourceCache.set(key, pending); }
    const bytes = await pending; readSignal.throwIfAborted(); lifetime.signal.throwIfAborted(); return bytes.slice();
  } };
  const dispose = () => {
    if (disposed) return; disposed = true;
    signal.removeEventListener("abort", dispose); scene.onDisposeObservable.remove(sceneObserver);
    scene.onBeforeCameraRenderObservable.remove(cameraObserver);
    // The tracked clone set is fixed at construction. Detach later foreign
    // children before disposing any parent; never walk/dispose a foreign tree.
    for (const node of ownedNodes) if (!node.isDisposed()) for (const child of node.getChildren(undefined, true)) {
      if (!(child instanceof TransformNode) || !ownedNodes.has(child)) {
        if (child instanceof TransformNode) child.setParent(null); else child.parent = null;
      }
    }
    for (const node of [...ownedNodes].reverse()) if (!node.isDisposed()) node.dispose(true, false);
    for (const material of slotMaterials) material.dispose(false, false);
    for (const template of templates) template.dispose();
    for (const owner of extraOwners) owner.dispose();
    // Abort pending work only after all live clones release shared geometry and
    // textures. A late loader result is disposed before it can enter the pool.
    lifetime.abort(); resourceCache.clear();
  };
  const sceneObserver = scene.onDisposeObservable.addOnce(dispose);
  // Babylon calls this after all scene onBeforeRender observers (including
  // camera follow), immediately before active-mesh evaluation/culling. Unlike
  // onBeforeActiveMeshesEvaluation, it also runs for a frozen active mesh list.
  const cameraObserver = scene.onBeforeCameraRenderObservable.add(camera => {
    if (disposed) return;
    for (const slot of slots) if (slot.active && slot.state?.billboardDirection) alignBillboard(slot, camera, "before-camera-render");
  });
  signal.addEventListener("abort", dispose, { once: true });
  const requireActive = () => requireValue(!disposed && !scene.isDisposed && !root.isDisposed(), "pool is disposed.");
  const checkPending = () => { lifetime.signal.throwIfAborted(); signal.throwIfAborted(); requireActive(); };

  const directionLocal = new Vector3(), directionWorld = new Vector3(), basisX = new Vector3(), basisY = new Vector3();
  const projected = new Vector3(), normal = new Vector3(), actualX = new Vector3(), actualY = new Vector3();
  const tuple = (value: Vector3): [number, number, number] => [value.x, value.y, value.z];
  const finiteVector = (value: Vector3) => Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
  function alignBillboard(slot: Slot, camera: Camera | null, phase: NativeEffectBillboardInspection["updatedAt"]) {
    const state = slot.state, mesh = slot.meshes[0];
    if (!state?.billboardDirection || !mesh || mesh.isDisposed() || slot.root.isDisposed()) return;
    const extra = state.billboardAngle ?? 0;
    const result: NativeEffectBillboardInspection = { policy: "slot-world-direction-camera-projection-v1", cameraId: camera?.id ?? null,
      cameraUniqueId: camera?.uniqueId ?? null, updatedAt: phase, renderId: scene.getRenderId(), localDirection: [...state.billboardDirection],
      worldDirection: null, projectedDirection: null, alignmentRollRadians: 0, additionalRollRadians: extra, appliedRollRadians: extra,
      fallback: "none", actualWorldYAxis: null, actualWorldNormal: null };
    // Observe Babylon's exact unrolled billboard basis, including parent-scale
    // decomposition/reflection and RH camera handling, rather than copying its
    // private view-matrix/sign conventions. Geometry and UVs stay unchanged.
    mesh.rotationQuaternion = null; mesh.rotation.set(0, 0, 0);
    if (!camera) result.fallback = "no-camera";
    else {
      const parentWorld = slot.root.computeWorldMatrix(true);
      directionLocal.set(...state.billboardDirection); Vector3.TransformNormalToRef(directionLocal, parentWorld, directionWorld);
      const base = mesh.computeWorldMatrix(true, camera), data = base.m;
      basisX.set(data[0]!, data[1]!, data[2]!); basisY.set(data[4]!, data[5]!, data[6]!);
      const directionLength = directionWorld.lengthSquared(), xx = basisX.lengthSquared(), yy = basisY.lengthSquared(), xy = Vector3.Dot(basisX, basisY);
      const determinant = xx * yy - xy * xy;
      if (!finiteVector(directionWorld) || !finiteVector(basisX) || !finiteVector(basisY) || !Number.isFinite(directionLength) || !Number.isFinite(determinant)) {
        result.fallback = "nonfinite-transform";
      } else {
        result.worldDirection = tuple(directionWorld);
        if (directionLength === 0) result.fallback = "zero-direction";
        else if (xx === 0 || yy === 0 || determinant <= xx * yy * 1e-12 || mesh.scaling.x === 0 || mesh.scaling.y === 0) result.fallback = "singular-plane";
        else {
          // Solve in the observed (possibly signed/unequally scaled) plane
          // basis. atan2 of camera-space components alone fails under unequal
          // scale or reflection. Local +Y after roll is -sin*X + cos*Y, with
          // the local scale ratio accounted for before the rotation.
          const dx = Vector3.Dot(directionWorld, basisX), dy = Vector3.Dot(directionWorld, basisY);
          const x = (dx * yy - dy * xy) / determinant, y = (dy * xx - dx * xy) / determinant;
          projected.copyFrom(basisX).scaleInPlace(x).addInPlaceFromFloats(basisY.x * y, basisY.y * y, basisY.z * y);
          if (projected.lengthSquared() <= directionLength * 1e-12) result.fallback = "parallel-camera";
          else {
            projected.normalize(); result.projectedDirection = tuple(projected);
            result.alignmentRollRadians = Math.atan2(-x * mesh.scaling.x / mesh.scaling.y, y);
            result.appliedRollRadians = result.alignmentRollRadians + extra;
          }
        }
      }
    }
    // Degenerate directions deterministically use zero alignment plus the
    // caller's explicit roll, never an arbitrary or prior-frame direction.
    mesh.rotation.z = result.appliedRollRadians;
    const final = mesh.computeWorldMatrix(true, camera), values = final.m;
    actualX.set(values[0]!, values[1]!, values[2]!); actualY.set(values[4]!, values[5]!, values[6]!);
    Vector3.CrossToRef(actualX, actualY, normal);
    if (finiteVector(actualY) && actualY.lengthSquared() > 0) result.actualWorldYAxis = tuple(actualY.normalize());
    if (finiteVector(normal) && normal.lengthSquared() > 0) result.actualWorldNormal = tuple(normal.normalize());
    slot.billboard = result;
  }

  function cloneSlot(group: Prepared, index: number): Slot {
    const template = group.template, name = `${root.id}:${group.component.object}:${index}`;
    // Clone each exact source node without recursive implicit children, retaining
    // its original Geometry and pivot/basis. This never clones external nodes.
    const nodeMap = new Map<TransformNode, TransformNode>();
    const sourceNodes = [template.root, ...template.root.getDescendants(false).filter((node): node is TransformNode => node instanceof TransformNode)];
    const cloneNode = (source: TransformNode): TransformNode => {
      const existing = nodeMap.get(source); if (existing) return existing;
      const parent = source === template.root ? root : source.parent instanceof TransformNode && sourceNodes.includes(source.parent) ? cloneNode(source.parent) : null;
      requireValue(parent, "template contains a detached source node.");
      const clone = source instanceof Mesh ? source.clone(`${name}:${source.uniqueId}`, parent, true, false) : source.clone(`${name}:${source.uniqueId}`, parent, true);
      requireValue(clone, "template node could not be cloned."); ownedNodes.add(clone); nodeMap.set(source, clone);
      clone.id = clone.name; clone.doNotSerialize = true; clone.setEnabled(source === template.root ? false : source.isEnabled(false));
      clone.setPivotMatrix(source.getPivotMatrix().clone(), source.isUsingPostMultiplyPivotMatrix());
      if (clone instanceof Mesh) { clone.isPickable = false; clone.onBeforeRenderObservable.clear(); clone.onAfterRenderObservable.clear(); }
      return clone;
    };
    for (const source of sourceNodes) cloneNode(source);
    const slotRoot = nodeMap.get(template.root)!; slotRoot.position.setAll(0); slotRoot.rotation.setAll(0);
    slotRoot.rotationQuaternion = Quaternion.Identity(); slotRoot.scaling.setAll(1);
    requireValue(template.materials.length === 1, "template has multiple shader policies.");
    const material = template.materials[0]!.material.clone(`${name}:material`); slotMaterials.add(material);
    material.doNotSerialize = true;
    const color = new Color4(1, 1, 1, 1), uv = new Vector4(1, 1, 0, 0);
    // ShaderMaterial.clone shares vector/color references; replace mutable slot
    // uniforms immediately so changing one particle never changes another.
    material.setColor4("selectedColor", color); material.setVector4("sourceUV", uv);
    const meshes = template.meshes.map(source => {
      const clone = nodeMap.get(source); requireValue(clone instanceof Mesh && clone.geometry === source.geometry, "geometry sharing failed.");
      clone.material = material; return clone;
    });
    const slot: Slot = { component: group, index, root: slotRoot, meshes, material, color, uv, state: null, active: false, renderCallbacks: 0, lastDrawFrame: null, billboard: null };
    for (const mesh of meshes) mesh.onAfterRenderObservable.add(() => { slot.renderCallbacks++; slot.lastDrawFrame = scene.getEngine().frameId; });
    return slot;
  }
  try {
    for (const component of components) {
      checkPending();
      const template = await loadEffectComponent(scene, bundle, component, { frameIndex: 0 }, lifetime.signal);
      if (disposed || signal.aborted || scene.isDisposed) { template.dispose(); checkPending(); }
      templates.push(template); checkPending();
      requireValue(template.materials.length === 1, "template has multiple shader policies.");
      const materialOwner = template.materials[0]!;
      if (!textureCache.has(resourceKey(template.selectedFrame.texture))) textureCache.set(resourceKey(template.selectedFrame.texture), onlyTexture(materialOwner));
      const frames: Prepared["frames"] = [];
      for (const frame of template.frames) {
        const key = resourceKey(frame.texture); let texture = textureCache.get(key);
        if (!texture) {
          const png = await bundle.readResource(frame.texture, lifetime.signal); checkPending();
          const owner = await createNativeEffectMaterial(scene, { component, texture: frame.texture, png,
            uvScale: frame.uvScale, uvOffset: frame.uvOffset }, lifetime.signal);
          if (disposed || signal.aborted || scene.isDisposed) { owner.dispose(); checkPending(); }
          extraOwners.push(owner); checkPending(); texture = onlyTexture(owner); textureCache.set(key, texture);
        }
        frames.push({ frame: structuredClone(frame), texture });
      }
      const group: Prepared = { component, template, frames, originalOpacity: materialOwner.inspect().sourceOpacity, slots: [] };
      prepared.push(group); componentMap.set(component.object, group);
      for (let index = 0; index < capacities[component.object]!; index++) { const slot = cloneSlot(group, index); group.slots.push(slot); slots.push(slot); }
    }
    checkPending();
    for (const template of templates) for (const mesh of template.meshes) if (mesh.geometry) geometries.add(mesh.geometry);
    for (const owner of [...templates.flatMap(template => template.materials), ...extraOwners]) {
      ownerMaterials.add(owner.material); for (const texture of owner.material.getActiveTextures()) textures.add(texture);
    }
    for (const material of [...ownerMaterials, ...slotMaterials]) material.onDisposeObservable.addOnce(() => disposedMaterials.add(material));
    for (const texture of textures) texture.onDisposeObservable.addOnce(() => disposedTextures.add(texture));
    const handle: NativeEffectParticlePool = {
      root, capacity, capacities,
      hasSlot(component, index) { return Number.isInteger(index) && index >= 0 && index < (capacities[component] ?? 0); },
      apply(states) {
        requireActive(); requireValue(Array.isArray(states) && states.length <= capacity, "invalid state batch.");
        const selected = new Set<Slot>();
        for (const state of states as readonly NativeEffectParticleState[]) {
          requireValue(state && typeof state === "object", "invalid state.");
          const group = componentMap.get(state.component), slot = group?.slots[state.index];
          requireValue(Number.isInteger(state.index) && slot && !selected.has(slot), "unknown or duplicate slot."); selected.add(slot);
          requireValue(vector(state.position, 3) && vector(state.scale, 3) && state.scale.every(value => value >= 0), "invalid particle transform.");
          requireValue(vector(state.rgba, 4) && state.rgba.every(value => value >= 0 && value <= 1) &&
            typeof state.fade === "number" && Number.isFinite(state.fade) && state.fade >= 0 && state.fade <= 1, "invalid normalized color/fade.");
          requireValue(Number.isInteger(state.frame) && state.frame >= 0 && state.frame < group!.frames.length, "unknown source frame.");
          requireValue((state.quaternion !== undefined) !== (state.rotation !== undefined), "exactly one rotation is required.");
          if (state.quaternion !== undefined) requireValue(vector(state.quaternion, 4) &&
            Math.abs(state.quaternion.reduce((sum, value) => sum + value * value, 0) - 1) <= 1e-5, "quaternion must be normalized.");
          else requireValue(vector(state.rotation, 3), "invalid Euler rotation.");
          requireValue(state.billboardAngle === undefined || group!.component.class === "Engine.SpriteEmitter" &&
            typeof state.billboardAngle === "number" && Number.isFinite(Math.fround(state.billboardAngle)), "invalid sprite billboard angle.");
          requireValue(state.billboardDirection === undefined || group!.component.class === "Engine.SpriteEmitter" &&
            vector(state.billboardDirection, 3), "invalid sprite billboard direction.");
          requireValue(!slot.root.isDisposed() && slot.meshes.every(mesh => !mesh.isDisposed()), "a particle slot was externally disposed.");
        }
        for (const slot of slots) { slot.active = selected.has(slot); slot.root.setEnabled(slot.active); if (!slot.active) { slot.state = null; slot.billboard = null; } }
        for (const state of states as readonly NativeEffectParticleState[]) {
          const group = componentMap.get(state.component)!, slot = group.slots[state.index]!, frame = group.frames[state.frame]!;
          slot.root.position.set(...state.position); slot.root.scaling.set(...state.scale);
          if (state.quaternion !== undefined) slot.root.rotationQuaternion!.set(...state.quaternion);
          else Quaternion.FromEulerAnglesToRef(...state.rotation, slot.root.rotationQuaternion!);
          if (group.component.class === "Engine.SpriteEmitter") for (const mesh of slot.meshes) {
            mesh.rotationQuaternion = null; mesh.rotation.set(0, 0, state.billboardAngle ?? 0);
          }
          slot.color.set(...state.rgba); slot.material.setColor4("selectedColor", slot.color);
          slot.material.setFloat("sourceOpacity", group.originalOpacity * state.fade);
          slot.uv.set(...frame.frame.uvScale, ...frame.frame.uvOffset); slot.material.setVector4("sourceUV", slot.uv);
          slot.material.setTexture("sourceTexture", frame.texture);
          slot.state = structuredClone(state);
          slot.billboard = null;
          if (state.billboardDirection) alignBillboard(slot, scene.activeCamera, "apply");
        }
        applications++;
      },
      bounds() {
        if (disposed || !root.isEnabled()) return null;
        let minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity), found = false;
        root.computeWorldMatrix(true);
        for (const slot of slots) if (slot.active) for (const mesh of slot.meshes) {
          mesh.computeWorldMatrix(true); const box = mesh.getBoundingInfo().boundingBox;
          minimum = Vector3.Minimize(minimum, box.minimumWorld); maximum = Vector3.Maximize(maximum, box.maximumWorld); found = true;
        }
        return found ? { minimum, maximum } : null;
      },
      inspect() {
        const allMaterials = [...ownerMaterials, ...slotMaterials];
        const matrix = (node: TransformNode) => disposed || node.isDisposed() ? null : Array.from(node.computeWorldMatrix(true).asArray());
        const localMatrix = (node: TransformNode) => { if (disposed || node.isDisposed()) return null; node.computeWorldMatrix(true); return Array.from(node._localMatrix.asArray()); };
        return { policy: "caller-evaluated-source-component-pool-v1", status: disposed ? "disposed" : "ready", manifestSha256,
          rootId: root.id, rootEnabled: !disposed && root.isEnabled(), rootParentId: root.parent?.id ?? null,
          capacity, capacities: { ...capacities }, activeSlots: disposed ? 0 : slots.filter(slot => slot.active).length, applications,
          renderCallbacks: slots.reduce((sum, slot) => sum + slot.renderCallbacks, 0),
          lastDrawFrame: slots.reduce<number | null>((last, slot) => slot.lastDrawFrame === null ? last : Math.max(last ?? 0, slot.lastDrawFrame), null),
          resources: { templateCount: templates.length, geometryCount: geometries.size, slotMaterialCount: slotMaterials.size, ownerMaterialCount: ownerMaterials.size,
            textureCount: textures.size, resourceReads, liveGeometryCount: [...geometries].filter(geometry => scene.geometries.includes(geometry)).length,
            liveMaterialCount: allMaterials.filter(material => scene.materials.includes(material)).length, liveTextureCount: [...textures].filter(texture => scene.textures.includes(texture)).length,
            geometryIds: [...geometries].map(geometry => geometry.id), materialIds: allMaterials.map(material => material.id), textureUniqueIds: [...textures].map(texture => texture.uniqueId),
            disposedGeometryCount: [...geometries].filter(geometry => geometry.isDisposed()).length, disposedMaterialCount: disposedMaterials.size, disposedTextureCount: disposedTextures.size },
          components: prepared.map(group => ({ object: group.component.object, actor: group.component.actor, sourcePointer: group.component.sourcePointer,
            maxParticles: capacities[group.component.object]!, template: group.template.inspection(),
            frames: group.frames.map(({ frame, texture }, index) => ({ index, source: structuredClone(frame), textureUniqueId: texture.uniqueId })) })),
          slots: slots.map(slot => ({ component: slot.component.component.object, sourcePointer: slot.component.component.sourcePointer, emitterOrdinal: slot.component.component.emitterOrdinal,
            index: slot.index, active: !disposed && slot.active, enabled: !disposed && !slot.root.isDisposed() && slot.root.isEnabled(), rootId: slot.root.id,
            state: slot.state && structuredClone(slot.state), rootLocalMatrix: localMatrix(slot.root), rootWorldMatrix: matrix(slot.root),
            billboard: slot.billboard && structuredClone(slot.billboard),
            renderCallbacks: slot.renderCallbacks, lastDrawFrame: slot.lastDrawFrame,
            meshes: slot.meshes.map(mesh => ({ id: mesh.id, parentId: mesh.parent?.id ?? null, isPickable: mesh.isPickable,
              geometryId: mesh.geometry?.id ?? null, materialId: mesh.material?.id ?? null,
              enabled: !disposed && !mesh.isDisposed() && mesh.isEnabled(), localMatrix: localMatrix(mesh), worldMatrix: matrix(mesh) })),
            material: { id: slot.material.id, originalSourceOpacity: slot.component.originalOpacity, uniforms: disposed ? null : (() => {
              const live = slot.material.serialize(); return { colors4: live.colors4, vectors4: live.vectors4, floats: live.floats, colors3: live.colors3 }; })(),
              alphaMode: slot.material.alphaMode, depthFunction: slot.material.depthFunction, disableDepthWrite: slot.material.disableDepthWrite,
              forceDepthWrite: slot.material.forceDepthWrite, backFaceCulling: slot.material.backFaceCulling,
              textures: slot.material.getActiveTextures().map(texture => ({ name: texture.name, uniqueId: texture.uniqueId })) } })),
          nativeTimingVerified: false, nativeCompositionVerified: false,
          limitations: ["Fixed-capacity presentation of caller-evaluated states; no spawn/timing/randomness/DrawScale policy.",
            "Per-slot color/fade/frame replace only uniforms and texture binding in the existing modern source-component material.",
            "Root attachment/enabling belongs to the manager; render callbacks do not establish native visible pixels."] };
      }, dispose,
    };
    return handle;
  } catch (error) { dispose(); throw error; }
}
