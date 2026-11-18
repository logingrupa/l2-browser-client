import { createIntensityBuffer, type ShadowAttenuationInput } from "./lightAttenuationGeometry";
import { LIGHTMAP_REBUILD_CONSTANTS } from "./lightmapRebuildEngineConstants";
import { rectangleWidth, type NativeVector3 } from "./lightmapRebuildTypes";
import { absoluteFloat32, dotProductFloat32, floorToLowByte, maximumFloat32 } from "./nativeFloatOperations";

const { twoSidedPolyFlag } = LIGHTMAP_REBUILD_CONSTANTS;

function requireFullLightmapRectangle({ record, lightmap }: ShadowAttenuationInput): void {
  if (record.minimumX !== 0 || record.minimumY !== 0 || record.maximumX !== lightmap.width - 1 || record.maximumY !== lightmap.height - 1) {
    throw new RangeError(`Sun direction record [${record.minimumX}, ${record.minimumY}]..[${record.maximumX}, ${record.maximumY}] does not cover the ${lightmap.width} x ${lightmap.height} lightmap the native loop walks.`);
  }
}

export function attenuateSunDirection(input: ShadowAttenuationInput, direction: NativeVector3): Uint8Array {
  requireFullLightmapRectangle(input);
  const { filteredMask, record, surface, lightmap } = input;
  const towardsSun: NativeVector3 = [Math.fround(-direction[0]), Math.fround(-direction[1]), Math.fround(-direction[2])];
  const facing = dotProductFloat32(surface.normal, towardsSun);
  const planeFactor = (surface.polyFlags & twoSidedPolyFlag.value) !== 0 ? absoluteFloat32(facing) : maximumFloat32(0, facing);
  const intensities = createIntensityBuffer(record);
  const outputStride = rectangleWidth(record);
  for (let row = 0; row < lightmap.height; row++) {
    for (let column = 0; column < lightmap.width; column++) {
      intensities[row * outputStride + column] = floorToLowByte(filteredMask.bytes[row * filteredMask.rowStride + column]! * planeFactor);
    }
  }
  return intensities;
}
