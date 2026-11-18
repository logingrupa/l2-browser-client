import { bspLiveCacheStateReason } from "../../../environment/model/bspLightmapSelection";
import type { RebuiltLightmapNote, RebuiltLightmapResult } from "./composeRebuiltLightmap";
import type { TileLightingModel } from "./decodeTileLighting";
import { lightmapTextureHasRebuiltPage } from "./lightmapPages";
import type { RebuiltLightmapRequest } from "./rebuiltLightmapRequest";
import type { RebuildLightEnvironment } from "./rebuildShadowLights";

export type LightmapTextureSource =
  | { readonly texture: number; readonly source: "compressed" }
  | { readonly texture: number; readonly source: "rebuild-not-requested" }
  | { readonly texture: number; readonly source: "rebuild-pending" }
  | { readonly texture: number; readonly source: "rebuilt"; readonly builtAtHour: number; readonly uncoveredTexels: number; readonly notes: readonly RebuiltLightmapNote[] }
  | { readonly texture: number; readonly source: "gap"; readonly reason: string };

export type LightmapTextureSourceLookup = (texture: number) => LightmapTextureSource;

interface RebuiltLightmapStoreSettings {
  readonly model: TileLightingModel;
  readonly environment: () => RebuildLightEnvironment;
  readonly compose: (request: RebuiltLightmapRequest) => Promise<RebuiltLightmapResult>;
}

export interface RebuiltLightmapStore {
  prepare(textures: readonly number[]): Promise<void>;
  result(texture: number): RebuiltLightmapResult;
  textureSource: LightmapTextureSourceLookup;
  textureSources(): LightmapTextureSource[];
}

type CompositionState =
  | { readonly state: "running" }
  | { readonly state: "settled"; readonly result: RebuiltLightmapResult; readonly builtAtHour: number }
  | { readonly state: "failed"; readonly reason: string };

export const rebuildCompositionFailedReasonPrefix = "bsp-rebuild-composition-failed:";

export function createRebuiltLightmapStore(settings: RebuiltLightmapStoreSettings): RebuiltLightmapStore {
  const { model } = settings;
  const compositions = new Map<number, Promise<void>>(), states = new Map<number, CompositionState>();
  const requestFor = (texture: number, environment: RebuildLightEnvironment): RebuiltLightmapRequest => {
    const inputs = model.hourly.lightmapRebuild;
    if (inputs.status === "unstaged") throw new RangeError(`Lightmap texture ${texture} has no rebuild inputs: ${inputs.reason}.`);
    const { lights, levelInfos, zoneAmbients } = inputs.value.actors;
    return { edge: model.pages[model.texturePageStart[texture]!]!.levels[0]!.edge, records: inputs.value.textureRecords[texture]!, lights, levelInfos, zones: zoneAmbients,
      environment };
  };
  const compositionOf = (texture: number): Promise<void> => {
    const known = compositions.get(texture);
    if (known !== undefined) return known;
    const environment = settings.environment(), request = requestFor(texture, environment);
    states.set(texture, { state: "running" });
    const composition = settings.compose(request).then(
      result => { states.set(texture, { state: "settled", result, builtAtHour: environment.hour }); },
      (error: unknown) => {
        states.set(texture, { state: "failed", reason: `${rebuildCompositionFailedReasonPrefix}${error instanceof Error ? error.message : String(error)}` });
        throw error;
      });
    compositions.set(texture, composition);
    return composition;
  };
  const composesTexture = (texture: number): boolean =>
    model.hourly.lightmapRebuild.status === "staged" && lightmapTextureHasRebuiltPage(model, texture);
  const textureSource = (texture: number): LightmapTextureSource => {
    const revisions = model.hourly.pageRevisions;
    if (revisions.status === "unstaged") return { texture, source: "gap", reason: revisions.reason };
    if (!lightmapTextureHasRebuiltPage(model, texture)) return { texture, source: "compressed" };
    if (!composesTexture(texture)) return { texture, source: "gap", reason: bspLiveCacheStateReason };
    const composition = states.get(texture);
    if (composition === undefined) return { texture, source: "rebuild-not-requested" };
    switch (composition.state) {
      case "running": return { texture, source: "rebuild-pending" };
      case "failed": return { texture, source: "gap", reason: composition.reason };
      case "settled": {
        const { result, builtAtHour } = composition;
        return result.status === "resolved"
          ? { texture, source: "rebuilt", builtAtHour, uncoveredTexels: result.value.uncoveredTexels, notes: result.value.notes }
          : { texture, source: "gap", reason: result.reason };
      }
    }
  };
  return {
    async prepare(textures) {
      await Promise.all(textures.filter(composesTexture).map(compositionOf));
    },
    result(texture) {
      const composition = states.get(texture);
      if (composition?.state !== "settled") throw new RangeError(`Lightmap texture ${texture} was not rebuilt before it was planned.`);
      return composition.result;
    },
    textureSource,
    textureSources: () => Array.from({ length: model.textureCount }, (_, texture) => textureSource(texture)),
  };
}
