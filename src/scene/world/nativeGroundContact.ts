import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { WorldGroundContact, WorldSupportSample } from "../../world/WorldNavigation";
import type { NativeSection } from "./loadNativeSection";

type Plain = null | boolean | number | string | Plain[] | { [key: string]: Plain };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const owns = (value: unknown, key: string) => object(value) && Object.hasOwn(value, key);

/** Metadata can contain live Babylon objects. Never leak them into telemetry. */
function plain(value: unknown, ancestors = new Set<object>(), depth = 0): Plain {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object" || depth > 24 || ancestors.has(value)) return null;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null;
  ancestors.add(value);
  const result: Plain = Array.isArray(value) ? value.map(item => plain(item, ancestors, depth + 1)) :
    Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item, ancestors, depth + 1)]));
  ancestors.delete(value); return result;
}

/** Compare declared record values without choosing JSON key-order precedence. */
function same(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (depth > 24 || typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i], depth + 1));
  if (!object(a) || !object(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(key => Object.hasOwn(b, key) && same(a[key], b[key], depth + 1));
}

function identity(node: Node) {
  return { uniqueId: node.uniqueId, id: node.id, name: node.name, className: node.getClassName() };
}
function ancestryOf(mesh: AbstractMesh) {
  const nodes: Node[] = [], seen = new Set<Node>();
  let node: Node | null = mesh;
  while (node && !seen.has(node)) { seen.add(node); nodes.push(node); node = node.parent; }
  return { nodes, cyclic: node !== null };
}
function transformSnapshot(node: Node) {
  return { ...identity(node), disposed: node.isDisposed(), transform: node instanceof TransformNode ? {
    position: node.position.asArray(), rotation: node.rotation.asArray(), rotationQuaternion: node.rotationQuaternion?.asArray() ?? null,
    scaling: node.scaling.asArray(), worldMatrix: [...node.getWorldMatrix().asArray()],
    pivotMatrix: [...node.getPivotMatrix().asArray()], worldMatrixFrozen: node.isWorldMatrixFrozen,
  } : null };
}
function sourceFields(metadata: unknown) {
  if (!object(metadata)) return {};
  return Object.fromEntries(["nativeSourceReference", "nativeSectionIndex"].filter(key => owns(metadata, key)).map(key => [key, plain(metadata[key])]));
}
function extrasOf(metadata: unknown): Record<string, unknown> | null {
  return object(metadata) && object(metadata.gltf) && object(metadata.gltf.extras) ? metadata.gltf.extras : null;
}

interface SourceInspection {
  status: "metadata-linked" | "unresolved" | "ambiguous";
  kind: "placement" | "bsp" | "terrain-patch" | "primary-terrain" | null;
  reason: string | null;
  sectionManifestSha256: string | null;
  rootUniqueId: number | null;
  marker: Plain;
  manifestRecord: Plain;
  model: Plain;
}
function sourceInspection(scene: Scene, mesh: AbstractMesh, nodes: readonly Node[], cyclic: boolean, section: NativeSection | null): SourceInspection {
  const result: SourceInspection = { status: "unresolved", kind: null, reason: "source-marker-missing", sectionManifestSha256: section?.manifestSha256 ?? null,
    rootUniqueId: null, marker: null, manifestRecord: null, model: null };
  const markers = nodes.flatMap(node => ["nativePlacement", "nativeBsp", "nativeTerrainPatch"].filter(key => owns(node.metadata, key))
    .map(key => ({ node, key, value: node.metadata[key] as unknown })));
  if (cyclic || markers.length > 1) return { ...result, status: "ambiguous", reason: cyclic ? "cyclic-ancestry" : "multiple-source-markers" };
  const selected = markers[0];
  if (selected) {
    result.kind = selected.key === "nativePlacement" ? "placement" : selected.key === "nativeBsp" ? "bsp" : "terrain-patch";
    result.rootUniqueId = selected.node.uniqueId; result.marker = plain(selected.value);
    if (!object(selected.value) || typeof selected.value.id !== "string") return { ...result, reason: "invalid-source-marker" };
    if (!section) return { ...result, reason: "section-missing" };
    const marker = selected.value, manifest = section.manifest;
    if (result.kind === "placement") {
      const roots = scene.getNodes().filter(node => !node.isDisposed() && object(node.metadata?.nativePlacement) && node.metadata.nativePlacement.id === marker.id);
      if (roots.length !== 1) return { ...result, status: "ambiguous", reason: "duplicate-placement-root" };
      const placements = manifest.placements.filter(row => row.id === marker.id);
      if (placements.length !== 1) return { ...result, status: placements.length > 1 ? "ambiguous" : "unresolved", reason: "placement-manifest-match-not-unique" };
      const placement = placements[0]!; result.manifestRecord = plain(placement);
      if (marker.modelId !== placement.modelId || marker.sourceMesh !== placement.sourceMesh || !same(marker.matrix, placement.matrix)) {
        return { ...result, reason: "placement-source-identity-or-matrix-differs" };
      }
      const models = manifest.models.filter(row => row.id === placement.modelId);
      if (models.length !== 1) return { ...result, status: models.length > 1 ? "ambiguous" : "unresolved", reason: "placement-model-match-not-unique" };
      result.model = plain(models[0]);
    } else {
      const records = result.kind === "bsp" ? manifest.bsp ?? [] : manifest.terrainPatches ?? [];
      const matches = records.filter(record => record.id === marker.id);
      if (matches.length !== 1) return { ...result, status: matches.length > 1 ? "ambiguous" : "unresolved", reason: "resource-manifest-match-not-unique" };
      result.manifestRecord = plain(matches[0]);
      if (!same(marker, matches[0])) return { ...result, reason: "source-resource-record-differs" };
      if (result.kind === "terrain-patch" && !section.terrainMeshes.includes(mesh)) return { ...result, reason: "patch-outside-current-section-terrain" };
    }
    return { ...result, status: "metadata-linked", reason: null };
  }
  if (mesh.metadata?.worldTerrain === true) {
    result.kind = "primary-terrain"; result.rootUniqueId = mesh.uniqueId;
    const extras = extrasOf(mesh.metadata);
    result.marker = { worldTerrain: true, nativeObject: plain(extras?.nativeObject), nativeSectorObjects: plain(extras?.nativeSectorObjects) };
    if (!section) return { ...result, reason: "section-missing" };
    if (!section.terrainMeshes.includes(mesh)) return { ...result, reason: "terrain-outside-current-section" };
    if (!extras || typeof extras.nativeObject !== "string" || !extras.nativeObject) return { ...result, reason: "terrain-source-object-missing" };
    result.manifestRecord = plain(section.manifest.terrain);
    return { ...result, status: "metadata-linked", reason: null };
  }
  return result;
}

function meshInspection(scene: Scene, sample: WorldSupportSample, section: NativeSection | null) {
  const matches = scene.meshes.filter(mesh => mesh.uniqueId === sample.meshUniqueId);
  let resolution: "resolved" | "scene-disposed" | "missing-or-disposed" | "ambiguous-unique-id" | "captured-id-differs" = "resolved";
  const mesh = matches.length === 1 ? matches[0]! : null;
  if (scene.isDisposed) resolution = "scene-disposed";
  else if (!matches.length || mesh?.isDisposed()) resolution = "missing-or-disposed";
  else if (matches.length !== 1) resolution = "ambiguous-unique-id";
  else if (mesh?.id !== sample.meshId) resolution = "captured-id-differs";
  const live = resolution === "resolved" ? mesh : null;
  const chain = live ? ancestryOf(live) : null;
  return { live, inspection: { captured: { uniqueId: sample.meshUniqueId, id: sample.meshId, name: sample.meshName }, resolution,
    mesh: live ? identity(live) : null, ancestry: chain?.nodes.map(transformSnapshot) ?? [],
    source: live && chain ? sourceInspection(scene, live, chain.nodes, chain.cyclic, section) : null } };
}

function materialInspection(mesh: AbstractMesh | null, sample: WorldSupportSample) {
  const indices = mesh?.getIndices();
  const valid = !!indices && Number.isSafeInteger(sample.indexOffset) && sample.indexOffset >= 0 && sample.indexOffset % 3 === 0 &&
    sample.triangleIndex === sample.indexOffset / 3 && sample.indexOffset + 3 <= indices.length;
  const covering = valid ? (mesh!.subMeshes ?? []).map((submesh, index) => ({ submesh, index })).filter(({ submesh }) =>
    submesh.indexStart <= sample.indexOffset && submesh.indexStart + submesh.indexCount >= sample.indexOffset + 3) : [];
  const candidates = covering.map(({ submesh, index }) => {
    try {
      // Use Babylon's effective render-pass/sub-material choice. Reading the
      // parent material alone would misattribute a multi-material triangle.
      const material = submesh.getMaterial();
      return { subMeshIndex: index, indexStart: submesh.indexStart, indexCount: submesh.indexCount, materialIndex: submesh.materialIndex,
        material: material ? { uniqueId: material.uniqueId, id: material.id, name: material.name, className: material.getClassName(),
          sourceMetadata: sourceFields(material.metadata), sourceGltfExtras: sourceFields(extrasOf(material.metadata)) } : null,
        error: null as string | null };
    } catch (error) {
      return { subMeshIndex: index, indexStart: submesh.indexStart, indexCount: submesh.indexCount, materialIndex: submesh.materialIndex,
        material: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const status = !mesh ? "mesh-unavailable" : !valid ? "local-triangle-unavailable" : !candidates.length ? "uncovered" :
    candidates.length > 1 ? "ambiguous" : candidates[0]!.error ? "material-read-failed" : !candidates[0]!.material ? "no-material" : "resolved";
  return { status, localIndicesAtInspection: valid ? [indices![sample.indexOffset]!, indices![sample.indexOffset + 1]!, indices![sample.indexOffset + 2]!] : null,
    renderPassId: mesh?.getScene().getEngine().currentRenderPassId ?? null, candidates };
}

/** Inspects an already accepted capsule-support decision. Never performs a
 * navigation/ground query or changes source geometry, materials or transforms.
 * A metadata/resource link is not a source topology or native sound-policy join. */
export function inspectNativeGroundContact(scene: Scene, contact: WorldGroundContact | null, section: NativeSection | null) {
  const meshReferences: ReturnType<typeof meshInspection>["inspection"][] = [];
  const triangleReferences: { meshReference: number; indexOffset: number; triangleIndex: number; material: ReturnType<typeof materialInspection> }[] = [];
  const samples: { sampleIndex: number; meshReference: number; triangleReference: number }[] = [];
  const meshes = new Map<string, { index: number; live: AbstractMesh | null }>(), triangles = new Map<string, number>();
  for (const [sampleIndex, sample] of (contact?.samples ?? []).entries()) {
    const key = JSON.stringify([sample.meshUniqueId, sample.meshId]);
    let mesh = meshes.get(key);
    if (!mesh) {
      const inspected = meshInspection(scene, sample, section);
      mesh = { index: meshReferences.length, live: inspected.live }; meshes.set(key, mesh); meshReferences.push(inspected.inspection);
    }
    const triangleKey = JSON.stringify([key, sample.indexOffset, sample.triangleIndex]);
    let triangle = triangles.get(triangleKey);
    if (triangle === undefined) {
      triangle = triangleReferences.length; triangles.set(triangleKey, triangle);
      triangleReferences.push({ meshReference: mesh.index, indexOffset: sample.indexOffset, triangleIndex: sample.triangleIndex,
        material: materialInspection(mesh.live, sample) });
    }
    samples.push({ sampleIndex, meshReference: mesh.index, triangleReference: triangle });
  }
  return { policy: "local-accepted-capsule-support" as const, nativeSurfaceVerified: false as const, nativeTopologyVerified: false as const,
    materialObservation: "inspection-time-live-state" as const,
    limits: "Captured local triangle indices and metadata links do not qualify native polygons, source topology, foot contacts or footstep selection. Live material and transform values are observed at inspection time; no geometry-byte equality is asserted.",
    contact: contact ? { queryPosition: { ...contact.queryPosition }, position: { ...contact.position }, controllingSample: contact.controllingSample,
      samples: contact.samples.map(sample => ({ ...sample, position: { ...sample.position } })) } : null,
    meshReferences, triangleReferences, samples };
}
