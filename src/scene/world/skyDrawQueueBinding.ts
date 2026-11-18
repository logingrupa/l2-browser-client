import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { setSubMeshQueueRank } from "../../runtime/transparentRenderingOrder";
import type { SkyLevelVisibilityFrame, SkyLevelVisibilityModel } from "./bspVisibility/core/skyLevelVisibilityFrame";

export interface SkyDrawQueueBinding {
  apply(frame: SkyLevelVisibilityFrame): boolean;
  readonly appliedRunCount: number;
  readonly orderWrites: number;
}

const firstMaterialIndex = 0;
const firstVertex = 0;

function runOrderKey(frame: SkyLevelVisibilityFrame): string {
  return frame.runs.map(run => `${run.part}:${run.nodes.join(",")}`).join("|");
}

export function bindSkyDrawQueue(meshes: readonly Mesh[], model: SkyLevelVisibilityModel): SkyDrawQueueBinding {
  if (meshes.length !== model.partCount) throw new Error(`Shared sky visibility lists ${model.partCount} material parts for ${meshes.length} meshes.`);
  const fileIndices = meshes.map(mesh => {
    const indices = mesh.getIndices();
    if (indices === null) throw new Error(`${mesh.name} has no indices, so its sky draw queue cannot be rewritten.`);
    return Uint32Array.from(indices);
  });
  let lastKey: string | null = null, appliedRunCount = 0, orderWrites = 0;
  return {
    apply(frame) {
      const key = runOrderKey(frame);
      if (key === lastKey) return false;
      lastKey = key;
      const runsOfPart = meshes.map(() => [] as { rank: number; nodes: readonly number[] }[]);
      frame.runs.forEach((run, rank) => runsOfPart[run.part]!.push({ rank, nodes: run.nodes }));
      meshes.forEach((mesh, part) => {
        const runs = runsOfPart[part]!, source = fileIndices[part]!;
        const total = runs.reduce((sum, run) => sum + run.nodes.reduce((count, node) => count + model.rangeIndexCount[model.nodeRange[node]!]!, 0), 0);
        const ordered = new Uint32Array(total), starts: number[] = [];
        let offset = 0;
        for (const run of runs) {
          starts.push(offset);
          for (const node of run.nodes) {
            const range = model.nodeRange[node]!, first = model.rangeFirstIndex[range]!, count = model.rangeIndexCount[range]!;
            ordered.set(source.subarray(first, first + count), offset);
            offset += count;
          }
        }
        mesh.isVisible = runs.length > 0;
        if (runs.length === 0) return;
        mesh.updateIndices(ordered);
        mesh.subMeshes = [];
        const vertexCount = mesh.getTotalVertices();
        runs.forEach((run, index) => {
          const end = index + 1 < starts.length ? starts[index + 1]! : total;
          setSubMeshQueueRank(new SubMesh(firstMaterialIndex, firstVertex, vertexCount, starts[index]!, end - starts[index]!, mesh), run.rank);
        });
      });
      appliedRunCount = frame.runs.length;
      orderWrites++;
      return true;
    },
    get appliedRunCount() { return appliedRunCount; },
    get orderWrites() { return orderWrites; },
  };
}
