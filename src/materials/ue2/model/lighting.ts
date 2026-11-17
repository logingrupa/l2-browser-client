export type LightmapLighting = "lightmap-modulate" | "lightmap-modulate2x";
export type MaterialLighting = "unlit" | LightmapLighting;

export function isLightmapLighting(lighting: MaterialLighting): lighting is LightmapLighting {
  return lighting !== "unlit";
}
