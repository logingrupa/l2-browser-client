/** Original stepsound.uax surface vocabulary and clip selection.
 *
 * Labels come from the original package's group/sound names. No SurfaceType or
 * material footstep field exists in this client (REPORT.md Q1): the automatic
 * native order lives in footstepSurfaceAuto.ts; these 16 groups are the Manual
 * choices plus the clips that support StepSound declarations name. */

export const FOOTSTEP_SURFACES = [
  "Default", "Grass", "Stone", "Stone_Hard", "Stone_Gritty", "Carpet", "Dirt", "Gravel",
  "Ice", "Marsh", "Metal", "Sand", "Snow", "Wood", "Water_Shalow", "Water_Deep",
] as const;
export type FootstepSurfaceId = (typeof FOOTSTEP_SURFACES)[number];
export type FootstepGait = "walk" | "run";
export type FootstepVariation = "random" | number;
export type FootstepEvidenceStatus = "native" | "presentation" | "unverified";

/** Keeps the original one-l spelling of `Water_Shalow` in the identity. */
export const FOOTSTEP_SURFACE_LABELS: Readonly<Record<FootstepSurfaceId, string>> = {
  Default: "Default", Grass: "Grass", Stone: "Stone", Stone_Hard: "Stone hard", Stone_Gritty: "Stone gritty",
  Carpet: "Carpet", Dirt: "Dirt", Gravel: "Gravel", Ice: "Ice", Marsh: "Marsh", Metal: "Metal", Sand: "Sand",
  Snow: "Snow", Wood: "Wood", Water_Shalow: "Water shallow", Water_Deep: "Water deep",
};
export const FOOTSTEP_WATER_SURFACES: ReadonlySet<FootstepSurfaceId> = new Set<FootstepSurfaceId>(["Water_Shalow", "Water_Deep"]);

export interface StepSoundClip {
  /** Mixer registration key. */
  readonly key: string;
  /** Exact original object path, including original casing. */
  readonly object: string;
  readonly dependencyId: string;
  readonly sha256: string;
  readonly durationSeconds: number;
}
export interface StepSoundSurface {
  readonly id: FootstepSurfaceId;
  readonly label: string;
  readonly group: string;
  readonly gaitSplit: boolean;
  readonly walk: readonly StepSoundClip[];
  /** Equal to `walk` when the original group has no walk/run split. */
  readonly run: readonly StepSoundClip[];
}
export type StepSoundSlotProperty = "StepSound_1" | "StepSound_2" | "StepSound_3";
export interface StepSoundPlacementSlot {
  readonly property: StepSoundSlotProperty;
  readonly reference: string;
  readonly clip: StepSoundClip;
}
export interface StepSoundPlacement {
  readonly placementId: string;
  readonly sourceMesh: string;
  /** Source-declared StepSound_1..3 slots in order; omitted or explicit-null slots excluded. */
  readonly slots: readonly StepSoundPlacementSlot[];
  readonly clips: readonly StepSoundClip[];
  readonly references: readonly string[];
  readonly surface: FootstepSurfaceId | null;
}
export interface StepSoundLibrary {
  readonly manifestSha256: string;
  readonly packageSha256: string;
  readonly soundCount: number;
  readonly surfaces: ReadonlyMap<FootstepSurfaceId, StepSoundSurface>;
  readonly events: { readonly Water_In: StepSoundClip; readonly Water_Out: StepSoundClip };
  readonly boots: readonly StepSoundClip[];
  readonly placements: ReadonlyMap<string, StepSoundPlacement>;
  readonly sectionManifestSha256: string | null;
}

export function isFootstepSurface(value: unknown): value is FootstepSurfaceId {
  return typeof value === "string" && (FOOTSTEP_SURFACES as readonly string[]).includes(value);
}

export function surfaceClips(library: StepSoundLibrary | null, surface: FootstepSurfaceId, gait: FootstepGait): readonly StepSoundClip[] {
  const entry = library?.surfaces.get(surface);
  return entry ? gait === "run" ? entry.run : entry.walk : [];
}

/** Choice count shown to the user. Every original group has equal walk/run
 * counts (ordinary Stone has two, the others three); use the larger if not. */
export function surfaceVariationCount(library: StepSoundLibrary | null, surface: FootstepSurfaceId): number {
  const entry = library?.surfaces.get(surface);
  return entry ? Math.max(entry.walk.length, entry.run.length) : 0;
}

export function isFootstepVariation(value: unknown): value is FootstepVariation {
  return value === "random" || Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < 16;
}

/** Uniform integer in [0, count) from one generator draw (native `appRand() % count`
 * shape; the native CRT sequence itself is not reproduced). */
export function drawSlot(random: () => number, count: number): number {
  const value = random();
  return Math.min(count - 1, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * count)));
}

/** Explicit index is clamped to the actual clip count; Random is a uniform slot
 * draw that may repeat, like the native `GetSound` `appRand() % 3`. */
export function pickVariation<T>(clips: readonly T[], variation: FootstepVariation, random: () => number): { clip: T; index: number } | null {
  if (!clips.length) return null;
  const index = variation === "random" ? drawSlot(random, clips.length) : Math.min(Math.max(0, Math.trunc(variation)), clips.length - 1);
  return { clip: clips[index]!, index };
}

/** Seeded mulberry32 generator: reproducible footstep slot draws for receipts
 * and browser verification (presentation choice; not the native CRT rand). */
export const FOOTSTEP_RANDOM_SEED = 0x4c32_3230;
export function createFootstepRandom(seed: number = FOOTSTEP_RANDOM_SEED): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
