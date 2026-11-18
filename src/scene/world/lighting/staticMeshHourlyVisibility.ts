import { staticMeshHourlyEntryBlend, staticMeshShaderVisibility, staticMeshVertexVisible } from "../../../environment/model/staticMeshHourlyLighting";
import type { HourlyKeyBlend } from "../../../environment/model/sampleNativeTimeTables";
import type { StaticMeshLightList } from "./decodeHourlyLightingInputs";
import type { StagedLightingInput } from "./stagedLightingInput";

export interface StaticMeshHourlyPlacement {
  readonly sourceActor: string;
  readonly exportIndex: number;
}

export interface StaticMeshPlacementVisibility {
  readonly sourceActor: string;
  readonly exportIndex: number;
  readonly entryCount: number;
  readonly entryBlend: HourlyKeyBlend;
  readonly vertexCount: number;
  readonly vertexZeroVisibility: number;
  readonly visibilityCounts: ShaderVisibilityCounts;
}

export interface ShaderVisibilityCounts {
  readonly hidden: number;
  readonly partial: number;
  readonly full: number;
}

export interface StaticMeshHourlyVisibilityInspection {
  readonly gap: string | null;
  readonly placementCount: number;
  readonly placementsWithoutLightList: number;
  readonly placementsWithoutHourlyEntries: number;
  readonly placements: readonly StaticMeshPlacementVisibility[];
}

export interface StaticMeshHourlyVisibility {
  addChunk(chunkId: string, placements: readonly StaticMeshHourlyPlacement[]): void;
  removeChunk(chunkId: string): void;
  inspection(hour: number): StaticMeshHourlyVisibilityInspection;
}

const fullVisibility = 1;

function placementShaderVisibility(list: StaticMeshLightList, hour: number):
  Pick<StaticMeshPlacementVisibility, "entryBlend" | "vertexZeroVisibility" | "visibilityCounts"> {
  const entryBlend = staticMeshHourlyEntryBlend(list.hourlyMasks.length, hour);
  const previous = list.hourlyMasks[entryBlend.index]!.visibility, next = list.hourlyMasks[entryBlend.nextIndex]!.visibility;
  const visibilityOf = (vertex: number) => staticMeshShaderVisibility(staticMeshVertexVisible(previous, vertex), staticMeshVertexVisible(next, vertex), entryBlend.weight);
  let hidden = 0, partial = 0, full = 0;
  for (let vertex = 0; vertex < list.vertexCount; vertex += 1) {
    const visibility = visibilityOf(vertex);
    if (visibility === 0) hidden += 1;
    else if (visibility === fullVisibility) full += 1;
    else partial += 1;
  }
  return { entryBlend, vertexZeroVisibility: list.vertexCount === 0 ? 0 : visibilityOf(0), visibilityCounts: { hidden, partial, full } };
}

export function bindStaticMeshHourlyVisibility(lightLists: StagedLightingInput<ReadonlyMap<number, StaticMeshLightList>>): StaticMeshHourlyVisibility {
  const chunks = new Map<string, readonly StaticMeshHourlyPlacement[]>();
  return {
    addChunk(chunkId, placements) { chunks.set(chunkId, placements); },
    removeChunk(chunkId) { chunks.delete(chunkId); },
    inspection(hour) {
      const placements = [...chunks.values()].flat().sort((left, right) => left.exportIndex - right.exportIndex);
      if (lightLists.status === "unstaged") {
        return { gap: lightLists.reason, placementCount: placements.length, placementsWithoutLightList: placements.length, placementsWithoutHourlyEntries: 0, placements: [] };
      }
      let placementsWithoutLightList = 0, placementsWithoutHourlyEntries = 0;
      const visible: StaticMeshPlacementVisibility[] = [];
      for (const placement of placements) {
        const list = lightLists.value.get(placement.exportIndex);
        if (list === undefined) { placementsWithoutLightList += 1; continue; }
        if (list.hourlyMasks.length === 0) { placementsWithoutHourlyEntries += 1; continue; }
        visible.push({ sourceActor: placement.sourceActor, exportIndex: placement.exportIndex, entryCount: list.hourlyMasks.length, vertexCount: list.vertexCount,
          ...placementShaderVisibility(list, hour) });
      }
      return { gap: null, placementCount: placements.length, placementsWithoutLightList, placementsWithoutHourlyEntries, placements: visible };
    },
  };
}
