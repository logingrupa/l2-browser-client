import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Material } from "@babylonjs/core/Materials/material";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value);
function fail(message: string): never { throw new Error(`Editor authored terrain material: ${message}`); }
const roots = (scene: Scene) => scene.getNodes().filter(node => object(node.metadata) && "nativeWorldRoot" in node.metadata);

function authoredTextureRoot(material: ShaderMaterial): string {
  const resolvedRoots = new Set<string>();
  for (const texture of material.getActiveTextures()) {
    if (!(texture instanceof Texture) || texture.isCube || texture.isRenderTarget || !texture.name || /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(texture.name)) continue;
    // Use the actual authoring resource, not Editor Play's relative fetch
    // override (which strips scene/ and rebases against project/public).
    const resource = texture.getInternalTexture()?.url?.replaceAll("\\", "/"), name = texture.name.replaceAll("\\", "/");
    if (texture.loadingError || !resource || !resource.endsWith(name)) fail(`cannot resolve the live texture ${texture.name}.`);
    const base = resource.slice(0, -name.length);
    // Retain the loaded OS path verbatim. Editor's WebRequest override checks
    // path.isAbsolute; converting C:/ to file:/// makes it rebase the URL again.
    if (!/^(?:[a-z]:\/|\/)/i.test(base) || !base.endsWith("/")) fail(`the live texture ${texture.name} has no absolute resource root.`);
    resolvedRoots.add(base);
  }
  if (resolvedRoots.size > 1) fail("relative live textures have conflicting resource roots.");
  return resolvedRoots.values().next().value ?? "";
}

function sceneIdentity(scene: Scene, root: TransformNode) {
  const imported: unknown = scene.metadata?.nativeEditorImport, marker: unknown = root.metadata?.nativeWorldRoot;
  if (!object(imported) || imported.schemaVersion !== 1 || typeof imported.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(imported.manifestSha256) ||
      typeof imported.targetScene !== "string" || !/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.scene$/.test(imported.targetScene) ||
      !object(marker) || marker.schemaVersion !== 1 || marker.manifestSha256 !== imported.manifestSha256 || !identity(root.id)) return null;
  return { manifestSha256: imported.manifestSha256, targetScene: imported.targetScene, rootId: root.id };
}

/** Editor 5.5.3's Play exporter drops every ShaderMaterial. Its authoring and
 * Play scenes share an engine, so recover only omitted terrain materials from
 * the live authoring scene, including unsaved shader/texture edits. The caller
 * releases the returned owner after its authored-section adapter is disposed. */
export function restoreEditorAuthoredMaterials(scene: Scene, signal: AbortSignal): () => void {
  const noop = () => {};
  if (typeof location === "undefined" || location.protocol !== "file:") return noop;
  signal.throwIfAborted();
  if (scene.isDisposed) fail("the Play scene is disposed.");
  const markedRoots = roots(scene);
  if (!markedRoots.length) return noop;
  if (markedRoots.length !== 1 || !(markedRoots[0] instanceof TransformNode) || markedRoots[0].getClassName() !== "TransformNode") fail("expected one dedicated native world root.");
  const root = markedRoots[0] as TransformNode;
  // Babylon's unresolved numeric materialUniqueId lookup assigns undefined,
  // although AbstractMesh's declared material type only includes null.
  const targets = root.getChildMeshes().filter(mesh => mesh.metadata?.worldTerrain === true && mesh.getTotalVertices() > 0 && mesh.material == null);
  if (!targets.length) return noop;
  const expected = sceneIdentity(scene, root);
  if (!expected) fail("the Play scene and world root have mismatched import identities.");
  if (targets.some(mesh => !identity(mesh.id)) || new Set(targets.map(mesh => mesh.id)).size !== targets.length) fail("missing or duplicate terrain mesh identity.");
  const candidates = scene.getEngine().scenes.flatMap(candidate => {
    if (candidate === scene || candidate.isDisposed) return [];
    const candidateRoots = roots(candidate);
    if (candidateRoots.length !== 1 || !(candidateRoots[0] instanceof TransformNode) || candidateRoots[0].getClassName() !== "TransformNode") return [];
    const sourceRoot = candidateRoots[0], actual = sceneIdentity(candidate, sourceRoot);
    if (!actual || actual.manifestSha256 !== expected!.manifestSha256 || actual.targetScene !== expected!.targetScene || actual.rootId !== expected!.rootId) return [];
    const meshes = sourceRoot.getChildMeshes();
    if (!targets.every(target => meshes.filter(mesh => mesh.id === target.id && mesh.metadata?.worldTerrain === true).length === 1)) return [];
    return [{ scene: candidate, meshes }];
  });
  if (candidates.length !== 1) fail(`expected one live authoring scene matching the manifest and terrain mesh IDs; found ${candidates.length}.`);
  const source = candidates[0]!;
  const plans = targets.map(target => {
    const mesh = source.meshes.find(mesh => mesh.id === target.id && mesh.metadata?.worldTerrain === true)!;
    const originalId: unknown = target.metadata?.nativeEditorSource?.originalId;
    if (!identity(originalId) || mesh.metadata?.nativeEditorSource?.originalId !== originalId || mesh.getTotalVertices() <= 0) fail(`source identity differs for terrain ${target.id}.`);
    const material = mesh.material;
    if (!(material instanceof ShaderMaterial) || material.getClassName() !== "ShaderMaterial" || material.getScene() !== source.scene || !identity(material.id)) fail(`the live source for ${target.id} is not an omitted ShaderMaterial.`);
    if (scene.materials.some(existing => existing.id === material.id)) fail(`material ${material.id} already exists in the Play scene; refusing to replace an authored assignment.`);
    return { target, source: material as ShaderMaterial, original: target.material };
  });
  if (new Set(plans.map(plan => plan.source)).size !== new Set(plans.map(plan => plan.source.id)).size) fail("live source materials have duplicate identities.");
  const createdMaterials = new Set<Material>(), createdTextures = new Set<BaseTexture>();
  const copies = new Map<ShaderMaterial, ShaderMaterial>(), bindings: { target: AbstractMesh; copy: ShaderMaterial; original: AbstractMesh["material"] }[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const { target, copy, original } of bindings) if (!target.isDisposed() && target.material === copy) target.material = original;
    for (const material of createdMaterials) material.dispose(false, false);
    for (const texture of createdTextures) texture.dispose();
  };
  try {
    for (const plan of plans) {
      signal.throwIfAborted();
      if (copies.has(plan.source)) continue;
      // ShaderMaterial.serialize exposes its options/shaderPath objects directly.
      // Clone the representation so parsing cannot share mutable authoring state.
      const data: unknown = structuredClone(plan.source.serialize());
      if (!object(data) || data.customType !== "BABYLON.ShaderMaterial" || data.id !== plan.source.id) fail(`serialized source identity differs for ${plan.target.id}.`);
      const textureRoot = authoredTextureRoot(plan.source);
      const prepareTexture = (value: unknown) => {
        if (!object(value) || value.customType || value.isCube || value.isRenderTarget || value.isVideo) return;
        // Texture.Parse normally resolves name against rootUrl. Its subsequent
        // property restoration can overwrite that resolved URL before delayed
        // loading starts. Omit the unused URL field in this private copy only;
        // keep explicit data/serialized-URL sources selected by Babylon intact.
        if (typeof value.url === "string" && !value.url.startsWith("data:") && !Texture.UseSerializedUrlIfAny) delete value.url;
      };
      if (object(data.textures)) Object.values(data.textures).forEach(prepareTexture);
      if (object(data.textureArrays)) for (const values of Object.values(data.textureArrays)) if (Array.isArray(values)) values.forEach(prepareTexture);
      signal.throwIfAborted();
      const beforeMaterials = new Set(scene.materials), beforeTextures = new Set(scene.textures);
      let copy: ShaderMaterial;
      // WebGPUEngine does not inherit Editor's WebGL createTexture path hook.
      // The proven absolute authoring root also survives delayed image loads.
      try { copy = ShaderMaterial.Parse(data, scene, textureRoot); }
      finally {
        for (const material of scene.materials) if (!beforeMaterials.has(material)) createdMaterials.add(material);
        for (const texture of scene.textures) if (!beforeTextures.has(texture)) createdTextures.add(texture);
      }
      signal.throwIfAborted();
      if (scene.isDisposed || copy.getScene() !== scene || copy.id !== plan.source.id) fail(`failed to parse the current authored material for ${plan.target.id}.`);
      copies.set(plan.source, copy);
    }
    for (const plan of plans) {
      if (plan.target.isDisposed() || plan.target.material !== plan.original) fail(`terrain ${plan.target.id} changed during recovery.`);
      const copy = copies.get(plan.source)!;
      plan.target.material = copy; bindings.push({ target: plan.target, copy, original: plan.original });
    }
    return dispose;
  } catch (error) { dispose(); throw error; }
}
