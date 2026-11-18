import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { setSubMeshQueueRank } from "../../runtime/transparentRenderingOrder";
import { indexBlockReorderTarget } from "./bspVisibility/babylonTileVisibilityTargets";
import { sameOrder, type IndexBlock, type TranslucentSectionTarget } from "./bspVisibility/bindTileVisibility";
import type { SkyLevelVisibilityFrame, SkyLevelVisibilityModel } from "./bspVisibility/core/skyLevelVisibilityFrame";

export interface SkyPartMesh {
  readonly mesh: Mesh;
  readonly sourceReference: string | null;
}

export interface SkyDrawQueueBinding {
  apply(frame: SkyLevelVisibilityFrame): boolean;
  hide(): void;
  readonly appliedRunCount: number;
  readonly orderWrites: number;
}

interface BoundSkyPart {
  readonly mesh: Mesh;
  readonly target: TranslucentSectionTarget;
}

const firstMaterialIndex = 0;
const firstVertex = 0;

function runOrderKey(frame: SkyLevelVisibilityFrame): string {
  return frame.runs.map(run => `${run.part}:${run.nodes.join(",")}`).join("|");
}

function partIndexEnd(model: SkyLevelVisibilityModel, part: number): number {
  let end = 0;
  model.rangePart.forEach((rangePart, range) => {
    if (rangePart === part) end = Math.max(end, model.rangeFirstIndex[range]! + model.rangeIndexCount[range]!);
  });
  return end;
}

function bindSkyPart(meshes: readonly SkyPartMesh[], sourceMaterial: string, part: number, model: SkyLevelVisibilityModel): BoundSkyPart {
  const matches = meshes.filter(entry => entry.sourceReference?.toLowerCase() === sourceMaterial.toLowerCase());
  if (matches.length !== 1) throw new Error(`Shared sky part ${part} ${sourceMaterial} matches ${matches.length} meshes, not 1.`);
  const { mesh } = matches[0]!, indexEnd = partIndexEnd(model, part);
  if (mesh.getTotalIndices() < indexEnd) throw new Error(`${mesh.name} holds ${mesh.getTotalIndices()} indices, fewer than the ${indexEnd} its part ${part} ranges reach.`);
  const target = indexBlockReorderTarget(mesh);
  if (typeof target === "string") throw new Error(`Shared sky part ${part}: ${target}, so its draw queue cannot be rewritten.`);
  return { mesh, target };
}

export function bindSkyDrawQueue(meshes: readonly SkyPartMesh[], partSourceMaterials: readonly string[], model: SkyLevelVisibilityModel): SkyDrawQueueBinding {
  if (partSourceMaterials.length !== model.partCount) {
    throw new Error(`Shared sky visibility lists ${model.partCount} material parts for ${partSourceMaterials.length} snapshot parts.`);
  }
  const parts = partSourceMaterials.map((sourceMaterial, part) => bindSkyPart(meshes, sourceMaterial, part, model));
  const appliedNodeOrder = new Map<number, Int32Array>();
  let lastKey: string | null = null, appliedRunCount = 0, orderWrites = 0;
  const blockOfNode = (node: number): IndexBlock => {
    const range = model.nodeRange[node]!;
    return { firstIndex: model.rangeFirstIndex[range]!, indexCount: model.rangeIndexCount[range]! };
  };
  return {
    apply(frame) {
      const key = runOrderKey(frame);
      if (key === lastKey) return false;
      lastKey = key;
      const runsOfPart = parts.map(() => [] as { rank: number; nodes: readonly number[] }[]);
      frame.runs.forEach((run, rank) => runsOfPart[run.part]!.push({ rank, nodes: run.nodes }));
      parts.forEach(({ mesh, target }, part) => {
        const runs = runsOfPart[part]!;
        mesh.isVisible = runs.length > 0;
        if (runs.length === 0) return;
        const nodeOrder = Int32Array.from(runs.flatMap(run => run.nodes));
        if (!sameOrder(appliedNodeOrder.get(part), nodeOrder)) {
          target.reorderIndexBlocks(Array.from(nodeOrder, blockOfNode));
          appliedNodeOrder.set(part, nodeOrder);
          orderWrites++;
        }
        mesh.subMeshes = [];
        const vertexCount = mesh.getTotalVertices();
        let indexStart = 0;
        for (const run of runs) {
          const indexCount = run.nodes.reduce((sum, node) => sum + blockOfNode(node).indexCount, 0);
          setSubMeshQueueRank(new SubMesh(firstMaterialIndex, firstVertex, vertexCount, indexStart, indexCount, mesh), run.rank);
          indexStart += indexCount;
        }
      });
      appliedRunCount = frame.runs.length;
      return true;
    },
    hide() {
      for (const { mesh } of parts) mesh.isVisible = false;
      lastKey = null;
      appliedRunCount = 0;
    },
    get appliedRunCount() { return appliedRunCount; },
    get orderWrites() { return orderWrites; },
  };
}
