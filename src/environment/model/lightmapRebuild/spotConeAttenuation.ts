import {
  createIntensityBuffer, falloffGeometry, stepTexelOffsetAlongRow, stepTexelOffsetToNextRow, type ShadowAttenuationInput,
} from "./lightAttenuationGeometry";
import { inverseSquareRootLookup, type LightingTables } from "./lightingTables";
import { LIGHTMAP_REBUILD_CONSTANTS } from "./lightmapRebuildEngineConstants";
import { rectangleWidth, type NativeVector3 } from "./lightmapRebuildTypes";
import { dotProductFloat32, floorToLowByte, roundToInt32 } from "./nativeFloatOperations";

const { coneByteScale, falloffIndexLimit } = LIGHTMAP_REBUILD_CONSTANTS;

interface ConeShape {
  readonly inverseOpening: number;
  readonly scaledCosine: number;
  readonly cosineSquared: number;
}

interface SpotTexel {
  readonly offset: NativeVector3;
  readonly maskByte: number;
}

interface SpotLighting {
  readonly tables: LightingTables;
  readonly indexScale: number;
  readonly planeFactor: number;
  readonly cone: ConeShape;
  readonly spotDirection: NativeVector3;
}

function coneShape(cone: number): ConeShape {
  const cosine = Math.fround(1 - cone * coneByteScale.value);
  const inverseOpening = Math.fround(1 / (1 - cosine));
  return { inverseOpening, scaledCosine: Math.fround(inverseOpening * cosine), cosineSquared: Math.fround(cosine * cosine) };
}

function unstoredSizeSquared(offset: NativeVector3): number {
  return (offset[0] * offset[0] + offset[1] * offset[1]) + offset[2] * offset[2];
}

function spotTexelByte(lighting: SpotLighting, { offset, maskByte }: SpotTexel): number {
  const falloffIndex = roundToInt32(Math.fround(unstoredSizeSquared(offset) * lighting.indexScale));
  if (maskByte === 0 || (falloffIndex >>> 0) >= falloffIndexLimit.value) return 0;
  const distanceSquared = dotProductFloat32(offset, offset);
  const alongSpot = dotProductFloat32(offset, lighting.spotDirection);
  if (!(alongSpot > 0)) return 0;
  const alongSpotSquared = Math.fround(alongSpot * alongSpot);
  if (!(distanceSquared * lighting.cone.cosineSquared < alongSpotSquared)) return 0;
  const inverseDistance = inverseSquareRootLookup(lighting.tables, distanceSquared);
  const coneFalloff = Math.fround((alongSpot * lighting.cone.inverseOpening) * inverseDistance - lighting.cone.scaledCosine);
  const coneFalloffSquared = Math.fround(coneFalloff * coneFalloff);
  return floorToLowByte(((maskByte * coneFalloffSquared) * lighting.planeFactor) * lighting.tables.attenuation[falloffIndex]!);
}

export function attenuateSpotCone(input: ShadowAttenuationInput, position: NativeVector3, radius: number, cone: number, spotDirection: NativeVector3): Uint8Array {
  const { filteredMask, record, lightmap, tables } = input;
  const { indexScale, planeFactor, firstTexelOffset } = falloffGeometry(input, position, radius);
  const lighting: SpotLighting = { tables, indexScale, planeFactor, cone: coneShape(cone), spotDirection };
  const intensities = createIntensityBuffer(record);
  const width = rectangleWidth(record);
  let offset = firstTexelOffset;
  for (let row = 0; row <= record.maximumY - record.minimumY; row++) {
    for (let column = 0; column < width; column++) {
      intensities[row * width + column] = spotTexelByte(lighting, { offset, maskByte: filteredMask.bytes[row * filteredMask.rowStride + column]! });
      offset = stepTexelOffsetAlongRow(offset, lightmap);
    }
    offset = stepTexelOffsetToNextRow(offset, width, lightmap);
  }
  return intensities;
}
