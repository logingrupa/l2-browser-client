export type NativePlane = readonly [x: number, y: number, z: number, w: number];

export const zeroPlane: NativePlane = [0, 0, 0, 0];

function eachComponent(left: NativePlane, combine: (component: number, index: number) => number): NativePlane {
  return [Math.fround(combine(left[0], 0)), Math.fround(combine(left[1], 1)), Math.fround(combine(left[2], 2)), Math.fround(combine(left[3], 3))];
}

export function subtractPlanes(left: NativePlane, right: NativePlane): NativePlane {
  return eachComponent(left, (component, index) => component - right[index]!);
}

export function addPlanes(left: NativePlane, right: NativePlane): NativePlane {
  return eachComponent(left, (component, index) => component + right[index]!);
}

export function scalePlane(plane: NativePlane, scale: number): NativePlane {
  return eachComponent(plane, component => component * scale);
}

export function lerpPlanes(from: NativePlane, to: NativePlane, weight: number): NativePlane {
  return addPlanes(scalePlane(subtractPlanes(to, from), weight), from);
}
