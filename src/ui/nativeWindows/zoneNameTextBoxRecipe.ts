import zoneNameTextBoxRecipeText from "../../../recipes/data/zone-name-text-boxes.json?raw";

export interface ZoneNameTextBoxBinding { readonly windowId: string; readonly controlNames: readonly string[] }

function readZoneNameTextBoxBinding(recipeText: string): ZoneNameTextBoxBinding {
  const recipe = JSON.parse(recipeText) as { schemaVersion?: unknown; windowId?: unknown; controlNames?: unknown };
  const { windowId, controlNames } = recipe;
  if (recipe.schemaVersion !== 1 || typeof windowId !== "string" || windowId === "" || !Array.isArray(controlNames) || controlNames.length === 0
    || !controlNames.every(name => typeof name === "string" && name !== "")) {
    throw new Error("recipes/data/zone-name-text-boxes.json must hold schema 1, a windowId and a list of control names.");
  }
  return { windowId, controlNames: controlNames as string[] };
}

export const zoneNameTextBoxBinding: ZoneNameTextBoxBinding = readZoneNameTextBoxBinding(zoneNameTextBoxRecipeText);
