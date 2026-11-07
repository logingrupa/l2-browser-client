type Point = { readonly x: number; readonly y: number; readonly z: number };
interface Sphere<T> { readonly value: T; readonly x: number; readonly y: number; readonly z: number; readonly radius: number }
const CELL_SIZE = 32;
const MAX_CELLS_PER_RANGE = 4096;

/** Static source-placement broad phase. Exact sphere checks retain the loader's
 * conservative collision readiness, including objects hidden by render culling.
 * Very broad objects/queries use a bounded-memory scan instead of huge grids. */
export class WorldPlacementIndex<T> {
  private readonly cells = new Map<string, Sphere<T>[]>();
  private readonly all: Sphere<T>[] = [];
  private readonly broad: Sphere<T>[] = [];

  add(value: T, position: Point, radius: number): void {
    this.validate(position, radius);
    const sphere: Sphere<T> = { value, x: position.x, y: position.y, z: position.z, radius };
    this.all.push(sphere);
    const range = this.range(position, radius);
    if (!range) { this.broad.push(sphere); return; }
    const [minX, minZ, maxX, maxZ] = range;
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const key = `${x}:${z}`, entries = this.cells.get(key);
      if (entries) entries.push(sphere); else this.cells.set(key, [sphere]);
    }
  }

  nearby(position: Point, radius: number): T[] {
    this.validate(position, radius);
    const range = this.range(position, radius), matches = new Set<T>();
    const checked = new Set<Sphere<T>>();
    const inspect = (sphere: Sphere<T>): void => {
      if (checked.has(sphere) || matches.has(sphere.value)) return;
      checked.add(sphere);
      if (Math.hypot(sphere.x - position.x, sphere.y - position.y, sphere.z - position.z) - sphere.radius < radius) matches.add(sphere.value);
    };
    if (!range) this.all.forEach(inspect);
    else {
      const [minX, minZ, maxX, maxZ] = range;
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        this.cells.get(`${x}:${z}`)?.forEach(inspect);
      }
      this.broad.forEach(inspect);
    }
    return [...matches];
  }

  private validate(position: Point, radius: number): void {
    if (![position.x, position.y, position.z, radius].every(Number.isFinite) || radius < 0 ||
        Math.max(Math.abs(position.x), Math.abs(position.y), Math.abs(position.z), radius) > 1e7) {
      throw new Error("Invalid world placement bounds query.");
    }
  }

  private range(position: Point, radius: number): [number, number, number, number] | null {
    const minX = Math.floor((position.x - radius) / CELL_SIZE), maxX = Math.floor((position.x + radius) / CELL_SIZE);
    const minZ = Math.floor((position.z - radius) / CELL_SIZE), maxZ = Math.floor((position.z + radius) / CELL_SIZE);
    return (maxX - minX + 1) * (maxZ - minZ + 1) > MAX_CELLS_PER_RANGE ? null : [minX, minZ, maxX, maxZ];
  }
}
