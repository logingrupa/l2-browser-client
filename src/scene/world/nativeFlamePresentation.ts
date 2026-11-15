import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";
import { nativeResourceUrl } from "../../assets/native/nativeResourceUrl";
import { readAssetPackage, sha256 } from "../../assets/package/readAssetPackage";
import type { NativeSection } from "./loadNativeSection";
import { prepareNativeFlameGraph } from "./nativeMaterialGraph";
import { createNativeFlameMaterials, selectNativeFlameFrame, evaluateNativeFlameFade, type NativeFlameMaterials, type NativeFlameMaterialInspection, type NativeFlameMaterialBinding, type NativeFlameReplayTime } from "./nativeFlameMaterials";
import { createNativeFlameBillboards, type NativeFlameBillboards, type NativeFlameBillboardInspection, type NativeFlamePosition } from "./nativeFlameBillboards";

type SourcePlacement = NativeSection["manifest"]["placements"][number];
type PlacementStatus = "pending" | "active" | "skipped" | "released";
export interface NativeFlamePresentationInspection {
  status: "not-present" | "ready" | "failed" | "aborted";
  disposed: boolean; modelId: string; manifestSha256: string; archiveSha256: string | null; graphSha256: string | null; failure: string | null;
  placementCounts: { declared: number; eligible: number; active: number; skipped: number; released: number };
  placements: { placementId: string; status: PlacementStatus; reason: string | null; meshIds: string[] }[];
  materials: NativeFlameMaterialInspection | null;
  billboards: NativeFlameBillboardInspection[];
  nativeBillboard: "unverified"; nativeLighting: "unverified"; nativeClocks: "unverified"; nativeParity: "unverified";
}
export interface NativeFlamePresentation {
  /** Reject unsupported replay inputs without changing uniforms or ownership. */
  validateReplayTime(time: NativeFlameReplayTime): void;
  update(time: NativeFlameReplayTime, nativeViewportActorLocation: NativeFlamePosition): void;
  inspect(): NativeFlamePresentationInspection;
  dispose(): void;
}
interface PlacementRecord {
  source: SourcePlacement; root: TransformNode; parent: TransformNode["parent"];
  bindings: NativeFlameMaterialBinding[]; owned: (Material | null)[];
  status: PlacementStatus; reason: string | null; billboard: NativeFlameBillboards | null;
}
const SOURCE = "FX_E_S.Flameset.Default_Flame01", MODEL = `interlude:${SOURCE}`;
const PLACEMENTS = [1922, 1923, 1924, 1925, 1926, 1927, 1928, 1930, 1932, 1934, 1936, 1938].map(index => `interlude:20_20.StaticMeshActor${index}`);
const ROOTS = ["FX_E_T.Flameset.Default_Flame_Final", "FX_E_T.Flameset.de_fire_glow_shader"] as const;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new Error(`Native flame presentation: ${message}`); }
function exactPlacement(value: unknown, expected: SourcePlacement): boolean {
  return object(value) && value.id === expected.id && value.modelId === expected.modelId && value.sourceMesh === expected.sourceMesh &&
    Array.isArray(value.matrix) && value.matrix.length === 16 && value.matrix.every((item, index) => item === expected.matrix[index]) &&
    Array.isArray(value.materialOverrides) && value.materialOverrides.length === 0;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
/** Compare every serialized material setting, not just magenta. These fields
 * describe identity/editor organization, not the material's rendered surface. */
function surface(material: PBRMaterial): string {
  const value: unknown = material.serialize(); requireValue(object(value), "material cannot be serialized.");
  const data = { ...value };
  for (const key of ["id", "uniqueId", "name", "metadata", "tags", "state"]) delete data[key];
  // Audited Editor 5.5.3 save changes this default from 4 to 8 on all PBRs.
  if (data.maxSimultaneousLights === 8) data.maxSimultaneousLights = 4;
  return canonical(data);
}
function diagnosticSurface(scene: Scene): string {
  const baseline = new PBRMaterial("Native flame diagnostic validation", scene);
  try {
    baseline.albedoColor = new Color3(1, 0, 1); baseline.metallic = 0; baseline.roughness = 1;
    baseline.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE; baseline.enableSpecularAntiAliasing = true;
    return surface(baseline);
  } finally { baseline.dispose(false, false); }
}
function slotOf(mesh: AbstractMesh): 0 | 1 | null {
  const extras: unknown = mesh.material?.metadata?.gltf?.extras;
  if (!object(extras) || extras.nativeMaterialGraph !== "native-materials/graph.json" || extras.nativeRuntimeStatus !== "unsupported-diagnostic") return null;
  const slot = extras.nativeSectionIndex;
  if (slot !== 0 && slot !== 1 || extras.nativeMaterialRoot !== ROOTS[slot] || extras.nativeSourceReference !== ROOTS[slot]) return null;
  const properties = extras.nativeSlotProperties;
  if (!object(properties) || !object(properties.Material) || properties.Material.object !== ROOTS[slot]) return null;
  return slot;
}

/** Adds only disposable presentation resources to an already selected section.
 * Preparation/update failures stay local to the effect; the world remains valid.
 * Register this owner after the section, and dispose it before section teardown. */
export async function createNativeFlamePresentation(scene: Scene, section: NativeSection, signal: AbortSignal): Promise<NativeFlamePresentation> {
  const lifetime = new AbortController(), records: PlacementRecord[] = [], removers: (() => void)[] = [];
  let materials: NativeFlameMaterials | null = null, disposed = false, status: NativeFlamePresentationInspection["status"] = "not-present";
  let archiveSha256: string | null = null, graphSha256: string | null = null, failure: string | null = null, declared = 0, eligible = 0;
  let validateTime: ((time: NativeFlameReplayTime) => void) | undefined;
  const releasePlacement = (entry: PlacementRecord, reason: string) => {
    if (entry.status === "released" || entry.status === "skipped") return;
    entry.status = "released"; entry.reason = reason; entry.billboard?.dispose();
    // Preserve a later authored assignment, while releasing its paired slot.
    for (const [index, binding] of entry.bindings.entries()) if (!binding.mesh.isDisposed() && entry.owned[index] && binding.mesh.material === entry.owned[index]) binding.mesh.material = binding.expectedMaterial;
  };
  const releaseOwners = () => {
    for (const entry of [...records].reverse()) entry.billboard?.dispose();
    materials?.dispose();
    for (const entry of records) if (entry.status === "active" || entry.status === "pending") { entry.status = "released"; entry.reason ??= "presentation-disposed"; }
  };
  const dispose = () => {
    if (disposed) return; disposed = true;
    for (const remove of removers.splice(0)) remove();
    releaseOwners(); lifetime.abort();
  };
  const abort = () => { status = "aborted"; dispose(); };
  signal.addEventListener("abort", abort, { once: true }); removers.push(() => signal.removeEventListener("abort", abort));
  const sceneObserver = scene.onDisposeObservable.addOnce(dispose); removers.push(() => scene.onDisposeObservable.remove(sceneObserver));
  const alive = () => { signal.throwIfAborted(); lifetime.signal.throwIfAborted(); requireValue(!disposed && !scene.isDisposed, "scene lifetime ended."); };
  const wait = async <T>(operation: () => Promise<T>): Promise<T> => {
    alive(); let cancel!: () => void;
    const aborted = new Promise<never>((_, reject) => { cancel = () => reject(new DOMException("Native flame preparation aborted.", "AbortError")); lifetime.signal.addEventListener("abort", cancel, { once: true }); });
    try { const value = await Promise.race([operation(), aborted]); alive(); return value; }
    finally { lifetime.signal.removeEventListener("abort", cancel); }
  };
  const inspect = (): NativeFlamePresentationInspection => ({
    status, disposed, modelId: MODEL, manifestSha256: section.manifestSha256, archiveSha256, graphSha256, failure,
    placementCounts: { declared, eligible, active: records.filter(entry => entry.status === "active").length, skipped: records.filter(entry => entry.status === "skipped").length, released: records.filter(entry => entry.status === "released").length },
    placements: records.map(entry => ({ placementId: entry.source.id, status: entry.status, reason: entry.reason, meshIds: entry.bindings.map(binding => binding.mesh.id) })),
    materials: materials?.inspect() ?? null, billboards: records.flatMap(entry => entry.billboard ? [entry.billboard.inspect()] : []),
    nativeBillboard: "unverified", nativeLighting: "unverified", nativeClocks: "unverified", nativeParity: "unverified",
  });
  const fail = (error: unknown) => { failure = error instanceof Error ? error.message : String(error); status = signal.aborted ? "aborted" : "failed"; dispose(); };
  const update = (time: NativeFlameReplayTime, target: NativeFlamePosition) => {
    if (disposed || status !== "ready") return;
    try {
      requireValue(target.length === 3 && target.every(Number.isFinite), "billboard target must be finite native XYZ.");
      for (const entry of records) if (entry.status === "active") {
        if (entry.root.isDisposed() || entry.root.parent !== entry.parent || !exactPlacement(entry.root.metadata?.nativePlacement, entry.source) ||
            entry.bindings.some((binding, index) => binding.mesh.isDisposed() || binding.mesh.material !== entry.owned[index] || !binding.mesh.isDescendantOf(entry.root))) {
          releasePlacement(entry, "placement-or-material-ownership-changed"); continue;
        }
        entry.billboard?.update(target);
        if (entry.billboard?.inspect().bindingCounts.active !== 1) releasePlacement(entry, "billboard-ownership-released");
      }
      materials?.update(time);
    } catch (error) { fail(error); }
  };
  const validateReplayTime = (time: NativeFlameReplayTime) => {
    requireValue(!disposed && status === "ready" && validateTime, "replay is unavailable.");
    validateTime(time);
  };
  const result: NativeFlamePresentation = { validateReplayTime, update, inspect, dispose };
  try {
    alive();
    const models = section.manifest.models.filter(model => model.id === MODEL || model.sourceObject === SOURCE);
    if (!models.length) return result;
    requireValue(models.length === 1 && models[0]!.id === MODEL && models[0]!.sourceObject === SOURCE, "model identity is missing or duplicated.");
    requireValue(scene.useRightHandedSystem, "requires an attached right-handed native section.");
    const model = models[0]!, archive = model.archive;
    requireValue(/^[a-f0-9]{64}$/.test(section.manifestSha256) && /^[a-f0-9]{64}$/.test(archive.sha256) && archive.file === `${archive.sha256}/asset.l2asset` &&
      Number.isSafeInteger(archive.bytes) && archive.bytes > 0 && archive.bytes <= 128 * 1024 * 1024 && model.model.file === `${archive.sha256}/model.glb`, "archive identity/path is invalid.");
    archiveSha256 = archive.sha256;
    const sources = section.manifest.placements.filter(source => source.modelId === MODEL); declared = sources.length;
    requireValue(sources.length === 12 && new Set(sources.map(source => source.id)).size === 12 && sources.every(source => PLACEMENTS.includes(source.id) && source.sourceMesh === SOURCE && source.materialOverrides.length === 0), "expected the twelve declared flame placements.");
    const response = await wait(() => fetch(nativeResourceUrl(`/l2/maps/${section.manifestSha256}/map-section-models/${archive.file}`), { signal: lifetime.signal }));
    requireValue(response.ok, `archive returned HTTP ${response.status}.`);
    const bytes = new Uint8Array(await wait(() => response.arrayBuffer()));
    requireValue(bytes.length === archive.bytes && await wait(() => sha256(bytes)) === archive.sha256, "archive hash/length differs.");
    const asset = await wait(() => readAssetPackage(bytes));
    const geometry = asset.manifest.files.find(file => file.path === "model.glb");
    requireValue(asset.manifest.id === MODEL && asset.manifest.source.object === SOURCE && geometry?.sha256 === model.model.sha256 && geometry.bytes === model.model.bytes, "archive model differs from the loaded section.");
    const plan = await wait(() => prepareNativeFlameGraph(asset));
    requireValue(plan.modelId === MODEL && plan.sourceMesh === SOURCE && plan.billboard, "prepared source identity or billboard contract differs."); graphSha256 = plan.graph.sha256;
    validateTime = time => {
      selectNativeFlameFrame(time.textureSeconds, plan.animation);
      evaluateNativeFlameFade(time.fadeSeconds, plan.fade);
    };
    const expected = diagnosticSurface(scene), candidates = scene.getNodes().filter(node => {
      const value: unknown = node.metadata?.nativePlacement; return object(value) && (value.modelId === MODEL || sources.some(source => source.id === value.id));
    });
    requireValue(candidates.length === sources.length, "placement roots are missing or duplicated.");
    for (const source of sources) {
      const matches = candidates.filter(node => node.metadata?.nativePlacement?.id === source.id), root = matches[0];
      requireValue(matches.length === 1 && root instanceof TransformNode && root.getClassName() === "TransformNode" && exactPlacement(root.metadata?.nativePlacement, source), `placement source differs: ${source.id}.`);
      const entry: PlacementRecord = { source, root, parent: root.parent, bindings: [], owned: [], status: "pending", reason: null, billboard: null }; records.push(entry);
      const meshes = root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0);
      let reason: string | null = meshes.length === 2 ? null : "placement-render-mesh-count-changed";
      for (const mesh of meshes) {
        const slot = slotOf(mesh), material = mesh.material;
        if (slot === null) { reason ??= "native-material-slot-provenance-missing"; continue; }
        if (entry.bindings.some(binding => binding.slot === slot)) { reason ??= "native-material-slot-duplicated"; continue; }
        if (!(material instanceof PBRMaterial) || material.getClassName() !== "PBRMaterial" || material.getActiveTextures().length || surface(material) !== expected) { reason ??= "authored-material-edits-retained"; continue; }
        entry.bindings.push({ mesh, slot, expectedMaterial: material });
      }
      if (reason || entry.bindings.length !== 2) { entry.status = "skipped"; entry.reason = reason ?? "native-material-slot-missing"; }
    }
    const accepted = records.filter(entry => entry.status === "pending"); eligible = accepted.length;
    if (!accepted.length) { status = "ready"; return result; }
    // The material owner rechecks assignment identity at commit. Original
    // material values are checked again after its async preparation as well.
    materials = await createNativeFlameMaterials(scene, plan, accepted.flatMap(entry => entry.bindings), lifetime.signal);
    alive();
    // Imported clones can share mesh IDs. An owner error cannot safely identify
    // just one clone, so roll back the preparation transaction as a whole.
    requireValue(materials.inspect().errors.length === 0, "material ownership changed during preparation; original assignments retained.");
    for (const entry of accepted) {
      entry.owned = entry.bindings.map(binding => binding.mesh.material);
      if (entry.bindings.some(binding => !(binding.expectedMaterial instanceof PBRMaterial) || surface(binding.expectedMaterial) !== expected || binding.mesh.material === binding.expectedMaterial)) {
        releasePlacement(entry, "authored-material-changed-during-preparation"); continue;
      }
      entry.billboard = createNativeFlameBillboards(scene, [{ placementId: entry.source.id, root: entry.root, sourceMesh: entry.source.sourceMesh, sourceMatrix: entry.source.matrix }], lifetime.signal);
      entry.status = "active";
      for (const binding of entry.bindings) {
        const changed = binding.mesh.onMaterialChangedObservable.add(() => { if (entry.status === "active") releasePlacement(entry, "authored-material-assignment-changed"); });
        const removed = binding.mesh.onDisposeObservable.add(() => { if (entry.status === "active") releasePlacement(entry, "render-mesh-disposed"); });
        removers.push(() => binding.mesh.onMaterialChangedObservable.remove(changed), () => binding.mesh.onDisposeObservable.remove(removed));
      }
    }
    alive(); status = "ready";
  } catch (error) { fail(error); }
  return result;
}
