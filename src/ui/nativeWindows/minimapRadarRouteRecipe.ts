import minimapRadarRouteRecipeText from "../../../recipes/world/minimap-radar-route.json?raw";
import { isPlainRecord } from "../../scene/world/nativeManifestRecordGuards";

export interface RadarTextureMapBinding { readonly windowId: string; readonly controlName: string }

export interface ZoneKeyHelper { readonly globalBelowColor: number }

const recipeLabel = "recipes/world/minimap-radar-route.json";
const onLoadFunctionPattern = /^interface\.([A-Za-z0-9_]+)\.OnLoad$/;
const textureMapHandlePattern = /^TexMap = GetHandle\(m_WindowName \$ "\.([A-Za-z0-9_]+)"\)$/;

function recipeRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error(`${recipeLabel} has no ${path} object.`);
  return value;
}

function readRadarTextureMapBinding(recipe: Record<string, unknown>): RadarTextureMapBinding {
  const onLoad = recipeRecord(recipeRecord(recipe.radar, "radar").onLoad, "radar.onLoad");
  const windowId = typeof onLoad.function === "string" ? onLoadFunctionPattern.exec(onLoad.function)?.[1] : undefined;
  const controlName = typeof onLoad.binding === "string" ? textureMapHandlePattern.exec(onLoad.binding)?.[1] : undefined;
  if (windowId === undefined || controlName === undefined) throw new Error(`${recipeLabel} radar.onLoad must name the OnLoad function and the TexMap handle.`);
  return { windowId, controlName };
}

function readZoneKeyHelper(recipe: Record<string, unknown>): ZoneKeyHelper {
  const helper = recipeRecord(recipeRecord(recipe.zoneKey, "zoneKey").helper, "zoneKey.helper");
  const { globalBelowColor, compare } = helper;
  if (typeof globalBelowColor !== "number" || !Number.isSafeInteger(globalBelowColor) || compare !== "signed") {
    throw new Error(`${recipeLabel} zoneKey.helper must hold an integer globalBelowColor and the signed compare.`);
  }
  return { globalBelowColor };
}

const minimapRadarRouteRecipe = recipeRecord(JSON.parse(minimapRadarRouteRecipeText), "root");

export const radarTextureMapBinding: RadarTextureMapBinding = readRadarTextureMapBinding(minimapRadarRouteRecipe);
export const zoneKeyHelper: ZoneKeyHelper = readZoneKeyHelper(minimapRadarRouteRecipe);
