import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Node } from "@babylonjs/core/node";
import type { FootstepDecoGrassField } from "../assets/native/loadNativeStepDecoGrass";
import type { WorldGroundContact } from "../world/WorldNavigation";
import type { FootstepContactKind, FootstepGroundContext } from "./footstepSurfaceAuto";

interface Source { kind: FootstepContactKind; sourceId: string | null; detail: string | null }

export interface FootstepGroundSamplerOptions {
  readonly decoGrass?: FootstepDecoGrassField | null;
  readonly sourceUnitsPerMetre?: number;
}
export interface FootstepGroundSampler {
  describe(contact: WorldGroundContact | null): FootstepGroundContext;
  preload(meshes: readonly AbstractMesh[]): void;
  inspection(): { decoGrass: { manifest: string; ruleId: string; label: string } | null; sourceUnitsPerMetre: number; disposed: boolean };
  dispose(): void;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const markers = ["nativePlacement", "nativeBsp", "nativeTerrainPatch"] as const;
const extrasOf = (mesh: AbstractMesh): Record<string, unknown> | null => {
  const metadata: unknown = mesh.metadata;
  return object(metadata) && object(metadata.gltf) && object(metadata.gltf.extras) ? metadata.gltf.extras : null;
};

function materialName(mesh: AbstractMesh, indexOffset: number): string | null {
  try {
    const covering = (mesh.subMeshes ?? []).filter(submesh => submesh.indexStart <= indexOffset && submesh.indexStart + submesh.indexCount >= indexOffset + 3);
    const material = covering.length === 1 ? covering[0]!.getMaterial() : mesh.material;
    return material?.name ?? null;
  } catch { return mesh.material?.name ?? null; }
}

export function createFootstepGroundSampler(scene: Scene, options: FootstepGroundSamplerOptions = {}): FootstepGroundSampler {
  const units = options.sourceUnitsPerMetre ?? 100, decoGrass = options.decoGrass ?? null;
  if (!Number.isFinite(units) || units <= 0) throw new TypeError("Footstep ground sampler needs a positive source unit scale.");
  const sources = new WeakMap<AbstractMesh, Source>();
  let disposed = false;
  const classify = (mesh: AbstractMesh): Source => {
    const cached = sources.get(mesh);
    if (cached) return cached;
    const found: { key: (typeof markers)[number]; id: string | null }[] = [];
    const seen = new Set<Node>();
    for (let node: Node | null = mesh; node && !seen.has(node); node = node.parent) {
      seen.add(node);
      const metadata: unknown = node.metadata;
      for (const key of markers) if (object(metadata) && Object.hasOwn(metadata, key)) {
        const marker = metadata[key];
        found.push({ key, id: object(marker) && typeof marker.id === "string" ? marker.id : null });
      }
    }
    let source: Source;
    if (found.length > 1) source = { kind: "mesh", sourceId: null, detail: "multiple source markers" };
    else if (found[0]?.key === "nativePlacement") source = { kind: "placement", sourceId: found[0].id, detail: null };
    else if (found[0]?.key === "nativeBsp") source = { kind: "bsp", sourceId: found[0].id, detail: null };
    else if (found[0]?.key === "nativeTerrainPatch") source = { kind: "terrain-patch", sourceId: found[0].id, detail: null };
    else if (object(mesh.metadata) && mesh.metadata.worldTerrain === true) {
      const nativeObject = extrasOf(mesh)?.nativeObject;
      source = { kind: "terrain", sourceId: typeof nativeObject === "string" ? nativeObject : null, detail: null };
    } else source = { kind: "mesh", sourceId: null, detail: null };
    sources.set(mesh, source);
    return source;
  };
  const empty = (kind: FootstepContactKind, detail: string | null, meshName: string | null = null): FootstepGroundContext =>
    ({ kind, meshName, sourceId: null, material: null, nativeXY: null, decoGrass: null, footVolume: null, detail });
  const decoGrassFieldCoversMapTerrainSource = (sourceId: string | null) => !!decoGrass && (sourceId === null || sourceId.toLowerCase().includes(decoGrass.terrain.toLowerCase()));
  return {
    describe(contact) {
      if (disposed || !contact?.samples.length) return empty("none", contact ? "contact has no samples" : null);
      const sample = contact.samples[contact.controllingSample] ?? contact.samples[0]!;
      const mesh = scene.isDisposed ? null : scene.getMeshByUniqueId(sample.meshUniqueId);
      if (!mesh || mesh.isDisposed() || mesh.id !== sample.meshId) return empty("mesh", "support mesh unresolved at dispatch", sample.meshName);
      const source = classify(mesh), nativeXY: [number, number] = [contact.position.x * units, contact.position.z * units];
      const terrain = source.kind === "terrain" || source.kind === "terrain-patch";
      return { kind: source.kind, meshName: mesh.name, sourceId: source.sourceId, material: materialName(mesh, sample.indexOffset), nativeXY,
        decoGrass: terrain && decoGrassFieldCoversMapTerrainSource(source.sourceId) ? decoGrass!.read(nativeXY[0], nativeXY[1]) : null, footVolume: null, detail: source.detail };
    },
    preload(meshes) { if (!disposed) for (const mesh of meshes) if (!mesh.isDisposed()) classify(mesh); },
    inspection: () => ({ decoGrass: decoGrass ? { manifest: decoGrass.manifestSha256, ruleId: decoGrass.ruleId, label: decoGrass.label } : null,
      sourceUnitsPerMetre: units, disposed }),
    dispose() { disposed = true; },
  };
}
