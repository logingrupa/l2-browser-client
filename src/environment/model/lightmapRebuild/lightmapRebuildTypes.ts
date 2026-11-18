const byteMaximum = 0xff;

export type NativeVector3 = readonly [x: number, y: number, z: number];

export type LightmapRebuildResult<Value, Reason extends string> =
  | { readonly status: "resolved"; readonly value: Value }
  | { readonly status: "unresolved"; readonly reason: Reason };

export interface LightmapTexelRectangle {
  readonly minimumX: number;
  readonly minimumY: number;
  readonly maximumX: number;
  readonly maximumY: number;
}

export interface PackedShadowRecord extends LightmapTexelRectangle {
  readonly height: number;
  readonly rowBytes: number;
  readonly bits: Uint8Array;
}

export interface FilteredShadowMask {
  readonly bytes: Uint8Array;
  readonly rowStride: number;
}

export interface LightmapSurface {
  readonly normal: NativeVector3;
  readonly polyFlags: number;
}

export interface LightmapProjection {
  readonly width: number;
  readonly height: number;
  readonly origin: NativeVector3;
  readonly uStep: NativeVector3;
  readonly vStep: NativeVector3;
}

export function rectangleWidth(rectangle: LightmapTexelRectangle): number {
  return rectangle.maximumX - rectangle.minimumX + 1;
}

export function rectangleHeight(rectangle: LightmapTexelRectangle): number {
  return rectangle.maximumY - rectangle.minimumY + 1;
}

export function resolvedResult<Value>(value: Value): { readonly status: "resolved"; readonly value: Value } {
  return { status: "resolved", value };
}

export function requireByte(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > byteMaximum) throw new RangeError(`${label} ${value} is not a byte.`);
  return value;
}
