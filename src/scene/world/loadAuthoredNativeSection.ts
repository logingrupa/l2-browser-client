import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { parseNativeSection, type NativeSection, type NativeSectionManifest } from "./loadNativeSection";
import { attachNativeBspSupport } from "./nativeBspSupport";
import { validateAuthoredTerrainPatches } from "./nativeTerrainPatch";

type Placement = NativeSectionManifest["placements"][number];
const attached = new WeakSet<TransformNode>();
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const marked = (metadata: unknown, key: string) => object(metadata) && Object.prototype.hasOwnProperty.call(metadata, key);

function bounds(meshes: readonly AbstractMesh[]) {
  const minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of meshes) {
    if (mesh.isDisposed()) continue;
    if (![...mesh.computeWorldMatrix(true).asArray()].every(Number.isFinite)) throw new Error("Authored native section has no finite geometry bounds.");
    const box = mesh.getBoundingInfo().boundingBox;
    minimum.minimizeInPlace(box.minimumWorld); maximum.maximizeInPlace(box.maximumWorld);
  }
  if (![...minimum.asArray(), ...maximum.asArray()].every(Number.isFinite)) throw new Error("Authored native section has no finite geometry bounds.");
  return { minimum, maximum };
}

function identityRoot(root: TransformNode): boolean {
  const rotation = root.rotationQuaternion;
  return !root.parent && !root.isWorldMatrixFrozen && root.position.equalsToFloats(0, 0, 0) &&
    root.rotation.equalsToFloats(0, 0, 0) && (!rotation || rotation.x === 0 && rotation.y === 0 && rotation.z === 0 && Math.abs(rotation.w) === 1) &&
    root.scaling.x === 1 && root.scaling.y === 1 && (root.scaling.z === 1 || root.scaling.z === -1) &&
    root.scalingDeterminant === 1 && root.billboardMode === 0 && !root.infiniteDistance && root.getPivotMatrix().isIdentity();
}

function exactPlacement(input: unknown, source: Placement): boolean {
  return object(input) && input.id === source.id && input.modelId === source.modelId && input.sourceMesh === source.sourceMesh &&
    Array.isArray(input.matrix) && input.matrix.length === 16 && input.matrix.every((value, index) => value === source.matrix[index]) &&
    Array.isArray(input.materialOverrides) && input.materialOverrides.length === 0;
}

export interface AuthoredNativeSection extends NativeSection {
  /** Whether attachment removed the saved world root's LH authoring reflection. */
  readonly removedZReflection: boolean;
  inspection(): ReturnType<NativeSection["inspection"]> & { authored: true; placementTransformEdits: string[] };
}

/** Attaches the already parsed Editor world without importing a second copy.
 * The dedicated root's Z reflection and mesh face orientation are coordinate
 * adapters only; source placement metadata and authored child edits stay intact.
 * The scene continues to own every saved node, texture and material. */
export function attachAuthoredNativeSection(scene: Scene, signal: AbortSignal): AuthoredNativeSection | null {
  signal.throwIfAborted();
  const roots = scene.getNodes().filter(node => marked(node.metadata, "nativeWorldRoot"));
  if (!roots.length) return null;
  if (scene.isDisposed || !scene.useRightHandedSystem) throw new Error("Authored native section requires a live right-handed scene.");
  if (roots.length !== 1 || !(roots[0] instanceof TransformNode) || roots[0].getClassName() !== "TransformNode") {
    throw new Error("Authored native section requires exactly one dedicated TransformNode root.");
  }
  const root = roots[0], marker: unknown = root.metadata.nativeWorldRoot;
  if (!object(marker) || marker.schemaVersion !== 1 || typeof marker.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(marker.manifestSha256)) {
    throw new Error("Authored native section marker has an invalid schema or manifest identity.");
  }
  const manifest = parseNativeSection(structuredClone(marker.manifest)), manifestSha256 = marker.manifestSha256;
  if (!identityRoot(root)) throw new Error("Authored native world root must be identity except for Z reflection; place edits beneath that root.");
  if (attached.has(root)) throw new Error("Authored native section is already attached to a runtime.");
  const descendants = root.getDescendants(), expected = new Map(manifest.placements.map(placement => [placement.id, placement]));
  const placements = new Map<string, { source: Placement; root: TransformNode }>(), nodeIds = new Set<string>();
  for (const node of descendants.filter(node => marked(node.metadata, "nativePlacement"))) {
    const data: unknown = node.metadata.nativePlacement;
    const source = object(data) && typeof data.id === "string" ? expected.get(data.id) : undefined;
    if (!(node instanceof TransformNode) || node.getClassName() !== "TransformNode" || !source || !exactPlacement(data, source) ||
      placements.has(source.id) || !node.id || nodeIds.has(node.id)) throw new Error("Authored native placement identity is missing, duplicated or differs from its source manifest.");
    placements.set(source.id, { source, root: node }); nodeIds.add(node.id);
  }
  if (placements.size !== expected.size) throw new Error("Authored native section is missing a declared source placement.");
  for (const placement of placements.values()) {
    for (let parent = placement.root.parent; parent && parent !== root; parent = parent.parent) {
      if (marked(parent.metadata, "nativePlacement")) throw new Error("Authored native placement roots cannot be nested inside another source placement.");
    }
    if (!placement.root.getChildMeshes().some(mesh => mesh.getTotalVertices() > 0)) throw new Error("Authored native placement has no source geometry.");
  }
  const meshes = root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0), terrainMeshes = meshes.filter(mesh => mesh.metadata?.worldTerrain === true);
  validateAuthoredTerrainPatches(meshes, manifest.terrainPatches);
  const bspMeshes = meshes.filter(mesh => marked(mesh.metadata, "nativeBsp"));
  for (const record of manifest.bsp ?? []) {
    const found = bspMeshes.filter(mesh => mesh.metadata.nativeBsp?.id === record.id);
    if (found.length !== 1 || JSON.stringify(found[0]!.metadata.nativeBsp) !== JSON.stringify(record)) {
      throw new Error("Authored native BSP is missing, duplicated or differs from its source manifest.");
    }
  }
  if (bspMeshes.length !== (manifest.bsp?.length ?? 0)) throw new Error("Authored native BSP contains an undeclared source.");
  if (!terrainMeshes.length) throw new Error("Authored native section has no marked terrain geometry.");
  if ([root, ...descendants].some(node => node instanceof TransformNode && node.isWorldMatrixFrozen)) {
    throw new Error("Authored native section transforms must not be frozen before the authoring reflection is adapted.");
  }
  const originalZ = root.scaling.z, savedTerrain = terrainMeshes.map(mesh => ({ mesh, material: mesh.material }));
  const orientations = originalZ === -1 ? meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh)
    .map(mesh => ({ mesh, orientation: mesh.sideOrientation })) : [];
  if (orientations.some(entry => entry.orientation !== 0 && entry.orientation !== 1)) {
    throw new Error("Authored native section has an unsupported mesh face orientation.");
  }
  const restoreOrientations = () => { for (const entry of orientations) if (!entry.mesh.isDisposed()) entry.mesh.sideOrientation = entry.orientation; };
  let neutral: StandardMaterial | undefined, disposed = false, previewEnabled = true;
  const updateMatrices = () => { root.computeWorldMatrix(true); for (const mesh of meshes) if (!mesh.isDisposed()) mesh.computeWorldMatrix(true); };
  root.scaling.z = 1;
  // The Editor LH import inverted the mesh's native RH face orientation. Invert
  // the current authored choice, including any deliberate user culling edit;
  // retained source metadata is provenance, never an instruction to reset it.
  for (const entry of orientations) entry.mesh.sideOrientation = 1 - entry.orientation;
  let extent: ReturnType<typeof bounds>;
  let support: ReturnType<typeof attachNativeBspSupport>;
  try {
    updateMatrices(); extent = bounds(meshes); bounds(terrainMeshes);
    support = attachNativeBspSupport(manifest, new Map([...placements].map(([id, placement]) => [id, placement.root])), bspMeshes);
  }
  catch (error) { restoreOrientations(); root.scaling.z = originalZ; updateMatrices(); throw error; }
  attached.add(root);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose); scene.onDisposeObservable.remove(observer); attached.delete(root);
    support.dispose();
    for (const entry of savedTerrain) if (!entry.mesh.isDisposed() && neutral && entry.mesh.material === neutral) entry.mesh.material = entry.material;
    neutral?.dispose(false, false);
    restoreOrientations();
    if (!root.isDisposed()) { root.scaling.z = originalZ; updateMatrices(); }
  };
  const observer = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  const setTerrainPreview = (enabled: boolean) => {
    if (disposed) return;
    previewEnabled = enabled;
    if (!enabled && !neutral) {
      neutral = new StandardMaterial("Authored native terrain · neutral inspection", scene);
      neutral.diffuseColor = new Color3(.55, .58, .52); neutral.specularColor = Color3.Black();
    }
    for (const entry of savedTerrain) if (!entry.mesh.isDisposed()) {
      if (!enabled && entry.mesh.material === entry.material) entry.mesh.material = neutral!;
      else if (enabled && neutral && entry.mesh.material === neutral) entry.mesh.material = entry.material;
    }
  };
  return { manifest, manifestSha256, terrainMeshes, supportMeshes: support.meshes, ...extent, removedZReflection: originalZ === -1,
    spawnCandidate: manifest.surfaceSpawnCandidate ? Vector3.FromArray(manifest.surfaceSpawnCandidate.gltfGroundPosition) : null,
    setTerrainPreview, dispose,
    inspection() {
      if (!disposed) updateMatrices();
      const activeMeshes = meshes.filter(mesh => !mesh.isDisposed()), textures = new Set(activeMeshes.flatMap(mesh => mesh.material?.getActiveTextures() ?? []));
      const placementDetails = [...placements.values()].map(placement => ({ id: placement.source.id, sourceMesh: placement.source.sourceMesh,
        modelId: placement.source.modelId, sourceMatrix: [...placement.source.matrix], worldMatrix: [...placement.root.getWorldMatrix().asArray()],
        meshes: placement.root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0).map(mesh => ({ name: mesh.name, material: mesh.material?.name ?? null })) }));
      const terrainBounds = disposed ? null : bounds(terrainMeshes);
      return { authored: true, disposed, modelCount: manifest.models.length, placementCount: placements.size,
        placements: placementDetails, placementTransformEdits: placementDetails.filter(placement =>
          placement.sourceMatrix.some((value, index) => Math.abs(Math.fround(value) - placement.worldMatrix[index]!) > .00001)).map(placement => placement.id),
        terrainTriangles: terrainMeshes.reduce((total, mesh) => total + mesh.getTotalIndices() / 3, 0),
        terrainBounds: terrainBounds ? { minimum: terrainBounds.minimum.asArray(), maximum: terrainBounds.maximum.asArray() } : null,
        finiteBounds: !disposed && activeMeshes.every(mesh => { bounds([mesh]); return true; }),
        textureCount: textures.size, texturesReady: [...textures].every(texture => texture.isReady()),
        collisionVerified: false, terrainMaterial: previewEnabled ? "editor-authored-source-materials" : "neutral-inspection", visualParity: "unverified",
        materialFailure: null, materialPreviewDetails: ["Saved Editor terrain materials retained; source-native shader parity remains unverified."],
        unsupportedRuntimeMaterials: manifest.unsupportedRuntimeMaterials ?? [],
        bspMeshes: bspMeshes.length, bspTriangles: bspMeshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0),
      };
    },
  };
}
