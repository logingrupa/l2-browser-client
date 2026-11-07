import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { Scene } from "@babylonjs/core/scene";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF";
import "../package/nativeSkinWeights";
import { validatePackageModel, type AssetPackage } from "../package/readAssetPackage";
import { createNativeClipPlayback, validateNativeClipDuration, type NativeClipPlayback } from "../package/nativeClipPlayback";

interface NativeModel {
  readonly container: AssetContainer;
  readonly root: TransformNode;
  readonly clips: ReadonlyMap<string, { index: number; duration: number }>;
  readonly parts: ReadonlyMap<string, readonly AbstractMesh[]>;
  playback?: NativeClipPlayback;
  dispose(): void;
}

export interface NativeActorClock {
  readonly clip: string | null;
  readonly mode: "loop" | "once";
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly playing: boolean;
  readonly completed: boolean;
}

export interface NativeBoneAnchorInspection {
  readonly sourceObject: string;
  readonly boneName: string;
  readonly status: "ready" | "ownership-lost" | "disposed";
  readonly ownershipIntact: boolean;
  readonly gltfMeshPointer: string;
  readonly gltfMeshNodePointer: string;
  readonly gltfSkinPointer: string;
  readonly gltfNodePointer: string;
  readonly jointIndex: number;
  readonly anchorId: string;
  readonly anchorUniqueId: number;
  readonly linkedNodeId: string;
  readonly linkedNodeUniqueId: number;
  readonly baseModelRootId: string;
  readonly baseModelRootUniqueId: number;
  readonly anchorLocalMatrix: readonly number[] | null;
  readonly anchorWorldMatrix: readonly number[] | null;
  readonly linkedJointWorldMatrix: readonly number[] | null;
  readonly baseModelRootWorldMatrix: readonly number[] | null;
  readonly clock: NativeActorClock & { readonly timeSeconds: number };
}

export interface NativeBoneAnchorView {
  readonly root: TransformNode;
  /** Lightweight ownership guard; does not allocate diagnostic matrices. */
  isValid(): boolean;
}

export interface NativeBoneAnchor extends NativeBoneAnchorView {
  inspection(): NativeBoneAnchorInspection;
  dispose(): void;
}

/** This is a retained GLB identity join, not a native socket composition rule. */
function sourceBoneBinding(asset: AssetPackage, sourceObject: string, boneName: string) {
  const bytes = asset.files.get(asset.manifest.model!.file)!;
  const jsonSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
  const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonSize))) as {
    meshes?: { name?: string }[]; nodes?: { name?: string; mesh?: number; skin?: number }[]; skins?: { joints?: number[] }[];
  };
  const name = sourceObject.split(".").at(-1);
  const meshes = document.meshes?.flatMap((mesh, index) => mesh.name === name ? [index] : []) ?? [];
  if (meshes.length !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.skins)) throw new Error("Native bone source mesh or skin identity is missing or ambiguous.");
  const meshIndex = meshes[0]!;
  const nodes = document.nodes.flatMap((node, index) => node.mesh === meshIndex ? [index] : []);
  if (nodes.length !== 1) throw new Error("Native bone source mesh node identity is missing or ambiguous.");
  const meshNodeIndex = nodes[0]!, skinIndex = document.nodes[meshNodeIndex]!.skin;
  const joints = typeof skinIndex === "number" && Number.isInteger(skinIndex) && skinIndex >= 0 ? document.skins[skinIndex]?.joints : undefined;
  if (!Array.isArray(joints) || joints.some(index => !Number.isInteger(index) || index < 0 || !document.nodes![index]) || new Set(joints).size !== joints.length) {
    throw new Error("Native bone source skin joints are missing or ambiguous.");
  }
  const matches = joints.flatMap((nodeIndex, index) => document.nodes![nodeIndex]!.name === boneName ? [{ nodeIndex, index }] : []);
  if (matches.length !== 1) throw new Error("Native bone name is missing or ambiguous in the source skin.");
  return { gltfMeshPointer: `/meshes/${meshIndex}`, gltfMeshNodePointer: `/nodes/${meshNodeIndex}`,
    gltfSkinPointer: `/skins/${skinIndex}`, gltfNodePointer: `/nodes/${matches[0]!.nodeIndex}`, jointIndex: matches[0]!.index };
}

function gltfPointers(node: TransformNode): readonly string[] {
  const pointers: unknown = node._internalMetadata?.gltf?.pointers;
  return Array.isArray(pointers) ? pointers.filter((pointer): pointer is string => typeof pointer === "string") : [];
}

async function loadModel(scene: Scene, asset: AssetPackage, parent: TransformNode, signal: AbortSignal): Promise<NativeModel> {
  if (asset.manifest.kind !== "model" || !asset.manifest.model) throw new Error("A native actor requires a model package.");
  signal.throwIfAborted();
  const bytes = asset.files.get(asset.manifest.model.file);
  if (!bytes) throw new Error("Native model bytes are missing.");
  const info = validatePackageModel(bytes);
  const container = await LoadAssetContainerAsync(bytes.slice(), scene, { pluginExtension: ".glb",
    pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } } });
  let root: TransformNode | undefined;
  try {
    signal.throwIfAborted();
    if (scene.isDisposed) throw new Error("Native actor scene was disposed during loading.");
    const clips = new Map<string, { index: number; duration: number }>();
    container.animationGroups.forEach((group, index) => {
      const source = info.animations[index];
      if (source?.name !== group.name || source.nativeDurationSeconds === null || clips.has(group.name)) throw new Error("Native animation names or durations are missing or ambiguous.");
      validateNativeClipDuration(group, source.nativeDurationSeconds);
      clips.set(group.name, { index, duration: source.nativeDurationSeconds });
      group.stop();
    });
    root = new TransformNode(asset.manifest.id, scene);
    root.parent = parent;
    root.setEnabled(false);
    container.addAllToScene();
    for (const node of [...container.meshes, ...container.transformNodes]) if (!node.parent) node.parent = root;
    const parts = new Map<string, readonly AbstractMesh[]>();
    for (const [meshIndex, mesh] of info.meshes.entries()) {
      if (!mesh.name || parts.has(mesh.name)) throw new Error("Native mesh identity is missing or duplicated.");
      const primitives = container.meshes.filter(candidate => {
        const pointers: unknown = candidate._internalMetadata?.gltf?.pointers;
        return candidate.getTotalVertices() > 0 && Array.isArray(pointers) && pointers.some(pointer =>
          typeof pointer === "string" && pointer.startsWith(`/meshes/${meshIndex}/primitives/`));
      });
      if (primitives.length !== mesh.primitives) throw new Error("Native mesh primitive identity differs from the glTF loader.");
      parts.set(mesh.name, primitives);
    }
    const ownedRoot = root;
    return { container, root, clips, parts, dispose() { container.dispose(); ownedRoot.dispose(); } };
  } catch (error) { container.dispose(); root?.dispose(); throw error; }
}

/** Presentation-owned native parts with a shared source clock. Equipment is
 * attached by verified native mesh identity, retaining every part's own skin.
 * No class/NPC scale, action alias or weapon attachment transform is inferred. */
export class NativeActor {
  readonly root: TransformNode;
  private readonly lifetime = new AbortController();
  private readonly replacements = new Map<string, NativeModel>();
  private readonly pending = new Map<string, AbortController>();
  private readonly boneAnchors = new Set<NativeBoneAnchor>();
  private currentClip: string | undefined;
  private currentMode: "loop" | "once" = "loop";
  private disposed = false;

  private constructor(private readonly scene: Scene, private readonly asset: AssetPackage, private readonly base: NativeModel, root: TransformNode) {
    this.root = root;
    base.root.setEnabled(true);
  }

  static async create(scene: Scene, asset: AssetPackage, signal: AbortSignal): Promise<NativeActor> {
    const root = new TransformNode("Native actor", scene);
    // Editor's runtime hierarchy keys rows by string id while actors load.
    root.id = `native-actor:${root.uniqueId}`;
    try {
      const base = await loadModel(scene, asset, root, signal);
      return new NativeActor(scene, asset, base, root);
    } catch (error) { root.dispose(); throw error; }
  }

  get clips(): readonly { name: string; durationSeconds: number }[] {
    return [...this.base.clips].map(([name, clip]) => ({ name, durationSeconds: clip.duration }));
  }

  private models(): NativeModel[] { return [this.base, ...this.replacements.values()]; }

  /** Exact loaded body/equipment ownership. A child of a borrowed bone anchor
   * can belong to another presenter and must not inherit actor picking tags. */
  ownedMeshes(): readonly AbstractMesh[] {
    return this.disposed ? [] : this.models().flatMap(model => model.container.meshes);
  }

  private start(model: NativeModel, name: string, mode: "loop" | "once", time = 0, playing = true): void {
    const clip = model.clips.get(name);
    if (!clip) throw new Error(`Native part has no exact clip ${name}.`);
    model.playback?.pause();
    model.playback = createNativeClipPlayback(model.container.animationGroups[clip.index]!, clip.duration, mode);
    model.playback.seek(time);
    if (playing) model.playback.play();
  }

  play(name: string, mode: "loop" | "once", restart = true): void {
    if (this.disposed) return;
    for (const model of this.models()) if (!model.clips.has(name)) throw new Error(`Native part has no exact clip ${name}.`);
    if (restart || this.currentClip !== name || this.currentMode !== mode) {
      this.currentClip = name; this.currentMode = mode;
      for (const model of this.models()) this.start(model, name, mode);
    } else for (const model of this.models()) model.playback?.play();
  }

  pause(): void { for (const model of this.models()) model.playback?.pause(); }
  seek(timeSeconds: number): void { for (const model of this.models()) model.playback?.seek(timeSeconds); }
  update(deltaSeconds: number): void { if (!this.disposed) for (const model of this.models()) model.playback?.advance(deltaSeconds); }

  /** Base clock only: equipment shares it and must not duplicate source cues. */
  clock(): NativeActorClock {
    const playback = this.base.playback;
    return { clip: this.currentClip ?? null, mode: this.currentMode, elapsedSeconds: playback?.elapsedSeconds ?? 0,
      durationSeconds: playback?.durationSeconds ?? 0, playing: playback?.playing ?? false, completed: playback?.completed ?? false };
  }

  measureBounds() {
    for (const model of this.models()) {
      for (const skeleton of model.container.skeletons) { skeleton.computeAbsoluteMatrices(true); skeleton.prepare(); }
      for (const mesh of model.container.meshes) if (mesh.getTotalVertices()) { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo({ applySkeleton: true }); }
    }
    return this.root.getHierarchyBoundingVectors(true);
  }

  private originalPart(sourceObject: string): readonly AbstractMesh[] {
    const assembly: unknown = this.asset.manifest.source.assembly;
    const members = Array.isArray(assembly) ? assembly : [this.asset.manifest.source.object];
    if (!members.includes(sourceObject)) throw new Error("Equipment does not replace a declared native body part.");
    const name = sourceObject.split(".").at(-1);
    if (members.filter(member => typeof member === "string" && member.split(".").at(-1) === name).length !== 1) throw new Error("Native body part source identity is ambiguous.");
    const meshes = name ? this.base.parts.get(name) : undefined;
    if (!meshes?.length) throw new Error("Native body part identity is missing or ambiguous in the loaded model.");
    return meshes;
  }

  /** Identity child of one exact base-rig joint. No guessed socket offset,
   * global bone lookup, equipment rig substitution or source reparenting. */
  createBoneAnchor(sourceObject: string, boneName: string): NativeBoneAnchor {
    if (this.disposed || this.root.isDisposed() || this.scene.isDisposed) throw new Error("Cannot attach to a disposed native actor.");
    if (!boneName) throw new Error("A native bone anchor requires an exact bone name.");
    const primitives = this.originalPart(sourceObject);
    const skeleton = primitives[0]!.skeleton;
    if (!skeleton || !this.base.container.skeletons.includes(skeleton) || primitives.some(mesh => mesh.isDisposed() || mesh.skeleton !== skeleton)) {
      throw new Error("Native body part does not have one unique owned skeleton.");
    }
    const matches = skeleton.bones.filter(bone => bone.name === boneName);
    if (matches.length !== 1) throw new Error("Native bone name is missing or ambiguous in the loaded skeleton.");
    const bone = matches[0]!, linked = bone.getTransformNode(), binding = sourceBoneBinding(this.asset, sourceObject, boneName);
    const ownedNodes = [...this.base.container.transformNodes, ...this.base.container.meshes];
    const linkedOwned = () => !!linked && !linked.isDisposed() && linked.getScene() === this.scene && ownedNodes.includes(linked)
      && linked.isDescendantOf(this.base.root) && this.base.root.parent === this.root && bone.getTransformNode() === linked;
    if (!linked || !linkedOwned() || bone.getIndex() !== binding.jointIndex ||
      gltfPointers(linked).filter(pointer => /^\/nodes\/\d+$/.test(pointer)).join() !== binding.gltfNodePointer ||
      ownedNodes.filter(node => gltfPointers(node).includes(binding.gltfNodePointer)).length !== 1 ||
      primitives.some(mesh => !gltfPointers(mesh).some(pointer => pointer.startsWith(`${binding.gltfMeshPointer}/primitives/`)))) {
      throw new Error("Native bone linked node does not match the owned source hierarchy.");
    }
    const root = new TransformNode(`Native bone anchor: ${sourceObject}:${boneName}`, this.scene);
    root.id = `${this.root.id}:bone-anchor:${root.uniqueId}`;
    root.doNotSerialize = true;
    root.parent = linked;
    let disposed = false;
    const ownsRoot = () => !root.isDisposed() && root.parent === linked;
    const handle: NativeBoneAnchor = {
      root,
      isValid: () => !disposed && !this.disposed && ownsRoot() && linkedOwned(),
      inspection: () => {
        const dead = disposed || this.disposed || root.isDisposed();
        const ownershipIntact = handle.isValid();
        if (ownershipIntact) { this.base.root.computeWorldMatrix(true); linked.computeWorldMatrix(true); root.computeWorldMatrix(true); }
        return { sourceObject, boneName, ...binding, status: dead ? "disposed" : ownershipIntact ? "ready" : "ownership-lost", ownershipIntact,
          anchorId: root.id, anchorUniqueId: root.uniqueId, linkedNodeId: linked.id, linkedNodeUniqueId: linked.uniqueId,
          baseModelRootId: this.base.root.id, baseModelRootUniqueId: this.base.root.uniqueId,
          anchorLocalMatrix: ownershipIntact ? Array.from(root._localMatrix.asArray()) : null,
          anchorWorldMatrix: ownershipIntact ? Array.from(root.getWorldMatrix().asArray()) : null,
          linkedJointWorldMatrix: ownershipIntact ? Array.from(linked.getWorldMatrix().asArray()) : null,
          baseModelRootWorldMatrix: ownershipIntact ? Array.from(this.base.root.getWorldMatrix().asArray()) : null,
          clock: { ...this.clock(), timeSeconds: this.base.playback?.timeSeconds ?? 0 } };
      },
      dispose: () => {
        if (disposed) return;
        disposed = true; this.boneAnchors.delete(handle);
        // An externally reparented anchor is no longer ours to mutate. Normal
        // disposal removes only our node, never the rig or consumer children.
        if (ownsRoot()) root.dispose(true);
      },
    };
    this.boneAnchors.add(handle);
    return handle;
  }

  async replacePart(sourceObject: string, replacement: AssetPackage | null): Promise<void> {
    if (this.disposed) return;
    const original = this.originalPart(sourceObject);
    this.pending.get(sourceObject)?.abort();
    if (!replacement) {
      this.pending.delete(sourceObject); this.replacements.get(sourceObject)?.dispose(); this.replacements.delete(sourceObject);
      for (const mesh of original) mesh.setEnabled(true); return;
    }
    if (replacement.manifest.source.object !== sourceObject || replacement.manifest.source.assembly !== undefined) throw new Error("Equipment must preserve the exact replaced native mesh identity.");
    const request = new AbortController(); this.pending.set(sourceObject, request);
    const signal = AbortSignal.any([request.signal, this.lifetime.signal]);
    let candidate: NativeModel | undefined;
    try {
      candidate = await loadModel(this.scene, replacement, this.root, signal);
      // Check every clip before committing, so a later action cannot expose an
      // incompatible piece. Preserve the previous appearance on any failure.
      if (candidate.clips.size !== this.base.clips.size || [...this.base.clips].some(([name, clip]) => candidate!.clips.get(name)?.duration !== clip.duration)) {
        throw new Error("Equipment does not share the original native animation relationships.");
      }
      signal.throwIfAborted();
      const clock = this.base.playback;
      if (this.currentClip) this.start(candidate, this.currentClip, this.currentMode, clock?.elapsedSeconds ?? 0, clock?.playing ?? false);
      this.replacements.get(sourceObject)?.dispose();
      this.replacements.set(sourceObject, candidate); candidate.root.setEnabled(true); for (const mesh of original) mesh.setEnabled(false);
      candidate = undefined;
    } finally {
      candidate?.dispose();
      if (this.pending.get(sourceObject) === request) this.pending.delete(sourceObject);
    }
  }

  snapshot() {
    const clock = this.base.playback;
    return { id: this.asset.manifest.id, clip: this.currentClip ?? null, mode: this.currentMode,
      timeSeconds: clock?.timeSeconds ?? 0, durationSeconds: clock?.durationSeconds ?? 0,
      playing: clock?.playing ?? false, completed: clock?.completed ?? false, unitScale: this.root.scaling.asArray(),
      replacements: [...this.replacements.keys()],
      parts: this.models().flatMap(model => model.container.meshes.filter(mesh => mesh.getTotalVertices()).map(mesh => ({
        name: mesh.name, enabled: mesh.isEnabled(), material: mesh.material?.name ?? null,
        bones: mesh.skeleton?.bones.length ?? 0, nativeSkin: mesh.metadata?.l2NativeSkinWeights ?? null,
      }))),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.lifetime.abort();
    for (const anchor of [...this.boneAnchors]) anchor.dispose();
    this.pause(); for (const model of this.models()) model.dispose();
    this.replacements.clear(); this.pending.clear(); this.root.dispose();
  }
}
