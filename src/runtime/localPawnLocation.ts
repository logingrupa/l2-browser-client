import type { WorldPosition } from "../world/sourceFrame";

export interface LocalPawnLocationSources {
  readonly movementFeet: () => WorldPosition | null;
  readonly entityFeet: () => WorldPosition | null;
  readonly collisionHeightMetres: number;
}

export interface LocalPawnLocation {
  feet(): WorldPosition | null;
  location(): WorldPosition | null;
}

export function localPawnLocationProvider(sources: LocalPawnLocationSources): LocalPawnLocation {
  const feet = () => sources.movementFeet() ?? sources.entityFeet();
  return {
    feet,
    location() {
      const pawnFeet = feet();
      return pawnFeet === null ? null : { x: pawnFeet.x, y: pawnFeet.y + sources.collisionHeightMetres, z: pawnFeet.z };
    },
  };
}
