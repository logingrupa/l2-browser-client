import type { LightingTables } from "./lightingTables";
import { LIGHTMAP_REBUILD_CONSTANTS } from "./lightmapRebuildEngineConstants";
import {
  rectangleHeight, rectangleWidth, type FilteredShadowMask, type LightmapProjection, type LightmapSurface, type LightmapTexelRectangle, type NativeVector3,
} from "./lightmapRebuildTypes";
import { absoluteFloat32, dotProductFloat32, maximumFloat32 } from "./nativeFloatOperations";

export interface ShadowAttenuationInput {
  readonly filteredMask: FilteredShadowMask;
  readonly record: LightmapTexelRectangle;
  readonly surface: LightmapSurface;
  readonly lightmap: LightmapProjection;
  readonly tables: LightingTables;
}

export interface FalloffGeometry {
  readonly indexScale: number;
  readonly planeFactor: number;
  readonly firstTexelOffset: NativeVector3;
}

const { falloffIndexScale, texelCentreOffset } = LIGHTMAP_REBUILD_CONSTANTS;

function eachAxis(combine: (axis: 0 | 1 | 2) => number): NativeVector3 {
  return [Math.fround(combine(0)), Math.fround(combine(1)), Math.fround(combine(2))];
}

export function createIntensityBuffer(record: LightmapTexelRectangle): Uint8Array {
  return new Uint8Array(rectangleWidth(record) * rectangleHeight(record));
}

export function falloffGeometry(input: ShadowAttenuationInput, position: NativeVector3, radius: number): FalloffGeometry {
  const { record, surface, lightmap } = input;
  const inverseRadius = Math.fround(1 / maximumFloat32(1, radius));
  const indexScale = Math.fround((falloffIndexScale.value * inverseRadius) * inverseRadius);
  const lightFromOrigin = eachAxis(axis => position[axis] - lightmap.origin[axis]);
  const planeFactor = absoluteFloat32(Math.fround(dotProductFloat32(surface.normal, lightFromOrigin) / radius));
  const centreY = Math.fround(record.minimumY + texelCentreOffset.value);
  const centreX = Math.fround(record.minimumX + texelCentreOffset.value);
  const originFromLight = eachAxis(axis => lightmap.origin[axis] - position[axis]);
  const alongU = eachAxis(axis => originFromLight[axis] + Math.fround(centreX * lightmap.uStep[axis]));
  const firstTexelOffset = eachAxis(axis => alongU[axis] + Math.fround(centreY * lightmap.vStep[axis]));
  return { indexScale, planeFactor, firstTexelOffset };
}

export function stepTexelOffsetAlongRow(offset: NativeVector3, lightmap: LightmapProjection): NativeVector3 {
  return eachAxis(axis => lightmap.uStep[axis] + offset[axis]);
}

export function stepTexelOffsetToNextRow(offset: NativeVector3, rowWidth: number, lightmap: LightmapProjection): NativeVector3 {
  const rowSpan = eachAxis(axis => rowWidth * lightmap.uStep[axis]);
  const rowStart = eachAxis(axis => offset[axis] - rowSpan[axis]);
  return eachAxis(axis => rowStart[axis] + lightmap.vStep[axis]);
}
