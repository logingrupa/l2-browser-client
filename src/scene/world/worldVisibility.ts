// Adapted from the audited local Lineagen terrain preview; see docs/WORLD_ASSETS.md.
/** Keep a loaded object stable while a camera pans near its streaming boundary.
 * Babylon still performs ordinary per-mesh frustum culling each rendered frame.
 */
export function worldVisibilityInRange(separation: number, reach: number, visible: boolean): boolean {
  return separation < reach + (visible ? Math.max(24, reach * 0.12) : 0);
}

/** A local bounding box can have its furthest corner on mixed min/max axes. */
export function worldModelRadius(minimum: number[], maximum: number[]): number {
  return Math.hypot(...minimum.map((value, axis) => Math.max(Math.abs(value), Math.abs(maximum[axis]!))));
}
