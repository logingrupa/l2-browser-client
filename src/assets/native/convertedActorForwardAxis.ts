export const convertedActorForwardAxis: readonly [number, number, number] = Object.freeze([1, 0, 0] as const);

export function isConvertedActorForwardAxis(axis: unknown): boolean {
  return Array.isArray(axis) && axis.length === 3 && axis.every((component, index) => component === convertedActorForwardAxis[index]);
}
