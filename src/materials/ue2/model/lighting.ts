export type LightmapLighting = "lightmap-modulate" | "lightmap-modulate2x";
export type VertexLighting = "vertex-modulate2x";
export type MaterialLighting = "unlit" | LightmapLighting | VertexLighting;

export function isLightmapLighting(lighting: MaterialLighting): lighting is LightmapLighting {
  return lighting === "lightmap-modulate" || lighting === "lightmap-modulate2x";
}

export function isVertexLighting(lighting: MaterialLighting): lighting is VertexLighting {
  return lighting === "vertex-modulate2x";
}
