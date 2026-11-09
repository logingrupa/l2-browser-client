import { npcModelCatalogIdPattern, type NativeNpcProfile } from "./loadNativeNpcProfiles";

export type NativeNpcModelJoinKind = "model-catalog-id" | "legacy-single-mesh-match";
export type NativeNpcModelJoin =
  | { readonly status: "joined"; readonly modelCatalogId: string; readonly join: NativeNpcModelJoinKind }
  | { readonly status: "missing"; readonly reason: string };

function joinByModelCatalogId(profile: NativeNpcProfile, modelCatalogId: string,
  sourceObjectsByModelId: ReadonlyMap<string, string | null>): NativeNpcModelJoin {
  if (!sourceObjectsByModelId.has(modelCatalogId)) {
    return { status: "missing", reason: `NPC profile names model ${modelCatalogId}, which is not in the catalog` };
  }
  if (sourceObjectsByModelId.get(modelCatalogId) !== profile.mesh) {
    throw new Error(`Native catalog NPC profile ${profile.id} names a model of a different mesh.`);
  }
  return { status: "joined", modelCatalogId, join: "model-catalog-id" };
}

function joinByLegacySingleMeshMatch(profile: NativeNpcProfile, sourceObjectsByModelId: ReadonlyMap<string, string | null>): NativeNpcModelJoin {
  const candidateModelIds = [...sourceObjectsByModelId]
    .filter(([modelId, sourceObject]) => !npcModelCatalogIdPattern.test(modelId) && sourceObject === profile.mesh)
    .map(([modelId]) => modelId);
  if (candidateModelIds.length > 1) {
    return { status: "missing",
      reason: `mesh ${profile.mesh} matches ${candidateModelIds.length} converted packages (${candidateModelIds.sort().join(", ")})` };
  }
  const [modelCatalogId] = candidateModelIds;
  if (modelCatalogId === undefined) return { status: "missing", reason: `NPC profile staged but mesh ${profile.mesh} has no converted model` };
  return { status: "joined", modelCatalogId, join: "legacy-single-mesh-match" };
}

export function joinNpcProfileToModel(profile: NativeNpcProfile, sourceObjectsByModelId: ReadonlyMap<string, string | null>): NativeNpcModelJoin {
  if (profile.modelCatalogId !== undefined) return joinByModelCatalogId(profile, profile.modelCatalogId, sourceObjectsByModelId);
  return joinByLegacySingleMeshMatch(profile, sourceObjectsByModelId);
}
