import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { NativeSectionManifest } from "./loadNativeSection";

/** Browser triangle support, not native collision/geodata. BSP associations
 * retain their own strict checks. Independent static placements participate
 * through their explicit source material-slot collision declarations; they
 * do not need an unrelated BSP record to make their stairs walkable. */
export function attachNativeBspSupport(manifest: NativeSectionManifest,
  placements: ReadonlyMap<string, TransformNode>, bspMeshes: readonly AbstractMesh[]) {
  const selected = new Set<AbstractMesh>(bspMeshes);
  const required = new Set((manifest.bsp ?? []).flatMap(record => record.supportPlacementIds));
  const effectModels = new Set((manifest.unsupportedRuntimeMaterials ?? []).map(record => record.modelId));
  const effectPlacements = new Set((manifest.unsupportedRuntimeMaterials ?? []).flatMap(record => record.placementIds));
  const animatedTargets = new Map<Scene, Set<unknown>>();
  const isStatic = (mesh: AbstractMesh, root: TransformNode): boolean => {
    // Triangle navigation caches world geometry. A source collision flag is
    // insufficient for a billboard, skeletal mesh or animated placement.
    const extras = mesh.material?.metadata?.gltf?.extras;
    if (typeof extras?.nativeMaterialGraph === "string" || extras?.nativeRuntimeStatus === "unsupported-diagnostic" ||
      mesh.skeleton || mesh.morphTargetManager) return false;
    const scene = root.getScene();
    let targets = animatedTargets.get(scene);
    if (!targets) {
      targets = new Set(scene.animationGroups.flatMap(group => group.targetedAnimations.map(animation => animation.target)));
      animatedTargets.set(scene, targets);
    }
    for (let node: typeof mesh.parent = mesh; node; node = node.parent) {
      if (node.animations?.length || targets.has(node)) return false;
      if (node === root) break;
    }
    return true;
  };
  const addPlacement = (root: TransformNode, strict: boolean) => {
    for (const mesh of root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0)) {
      const enabled: unknown = mesh.material?.metadata?.gltf?.extras?.nativeSlotProperties?.EnableCollision;
      if (strict && typeof enabled !== "boolean") throw new Error(`BSP support building lacks a source collision declaration: ${mesh.name}`);
      // Missing declarations on newly considered scenery stay unsupported;
      // do not infer collision from appearance, a name, or an omitted default.
      if (enabled === true && isStatic(mesh, root)) selected.add(mesh);
    }
  };
  for (const id of required) {
    const root = placements.get(id);
    if (!root) throw new Error(`BSP support building is missing: ${id}`);
    const source = manifest.placements?.find(placement => placement.id === id);
    if (effectPlacements.has(id) || source && effectModels.has(source.modelId)) throw new Error(`BSP support building is a runtime effect: ${id}`);
    addPlacement(root, true);
  }
  for (const placement of manifest.placements ?? []) {
    if (required.has(placement.id) || effectPlacements.has(placement.id) || effectModels.has(placement.modelId)) continue;
    const root = placements.get(placement.id);
    if (!root) throw new Error(`Native static support placement is missing: ${placement.id}`);
    addPlacement(root, false);
  }
  // Keep explicitly authored exclusions. All changes are runtime-only and are
  // restored before the Editor world reflection/resources are released.
  const meshes = [...selected].filter(mesh => mesh.metadata?.worldCollision !== false);
  const previous = meshes.map(mesh => ({ mesh, metadata: mesh.metadata, pickable: mesh.isPickable }));
  for (const mesh of meshes) {
    mesh.metadata = { ...mesh.metadata, worldCollision: true,
      worldSupportsWalking: mesh.metadata?.worldSupportsWalking !== false };
    mesh.isPickable = true;
  }
  let disposed = false;
  return { meshes, dispose() {
    if (disposed) return; disposed = true;
    for (const saved of previous) if (!saved.mesh.isDisposed()) {
      saved.mesh.metadata = saved.metadata; saved.mesh.isPickable = saved.pickable;
    }
  } };
}
