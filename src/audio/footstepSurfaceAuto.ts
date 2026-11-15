import {
  FOOTSTEP_SURFACE_LABELS, drawSlot,
  type FootstepEvidenceStatus, type FootstepGait, type FootstepSurfaceId, type StepSoundClip, type StepSoundLibrary,
  type StepSoundPlacement, type StepSoundPlacementSlot,
} from "./footstepSurfaces";
import { DECO_GRASS_APPROXIMATION_LABEL, type FootstepDecoGrassReading } from "../assets/native/loadNativeStepDecoGrass";

/** Automatic footsteps in the native decision order of UAnimNotify_Sound::Notify
 * (body 0x106be8c0; artifacts/native-parity/research/native-sound-answers-20261107/REPORT.md Q1):
 *
 *  1. boots (additive layer, handled by the preview; the chain continues)
 *  2. the support actor's own StepSound: only AStaticMeshActor overrides
 *     GetStepSoundData (StepSound_1 2/3, StepSound_3 1/3, never StepSound_2, gait ignored)
 *  3. FootVolume water → WATER (silent while the PhysicsVolume is also water)
 *  4. FootVolume step volume → its StepSoundID sound
 *  5. support that is not terrain (other meshes, movers, BSP) → ACTOR =
 *     DefaultActorWalkSound for both gaits (DefActorRun is never read)
 *  6. terrain → GRASS for the local pawn when GetDecoLayerAlpha counts > 1
 *     generated deco instances within 64 units XY, else LAND
 *
 * No SurfaceType/material footstep field exists in this client. 20_20 has no
 * water or step volumes; those hooks stay for other maps. */
export type FootstepContactKind = "terrain" | "terrain-patch" | "placement" | "bsp" | "mesh" | "none";
/** Water/step-volume hooks. The 20_20 browser slice has none (always null). */
export interface FootstepFootVolume {
  readonly water: boolean;
  /** Native stays silent when the pawn's PhysicsVolume is water too. */
  readonly pawnInWater: boolean;
  /** Resolved FL2GameData::GetStepSoundName(StepSoundID) clip, if any. */
  readonly stepSound: StepSoundClip | null;
}
export interface FootstepGroundContext {
  readonly kind: FootstepContactKind;
  readonly meshName: string | null;
  /** Placement, BSP or terrain/sector identity from source metadata markers. */
  readonly sourceId: string | null;
  readonly material: string | null;
  /** Native XY (source units) of the accepted support point. */
  readonly nativeXY: readonly [number, number] | null;
  /** Terrain only: expected deco instances (approximation); null when not staged. */
  readonly decoGrass: FootstepDecoGrassReading | null;
  readonly footVolume: FootstepFootVolume | null;
  readonly detail: string | null;
}
export type FootstepNativeGroup = "GRASS" | "LAND" | "WATER" | "ACTOR";
/** Authored AnimNotify_Sound arrays; ALAudio.int [L2FootStepSound] PostLoad holds the same names (REPORT.md Q1). */
export const FOOTSTEP_GROUP_ARRAYS: Readonly<Record<FootstepNativeGroup, Readonly<Record<FootstepGait, string>>>> = {
  GRASS: { walk: "GrassWalkSound", run: "GrassRunSound" },
  LAND: { walk: "DefaultWalkSound", run: "DefaultRunSound" },
  WATER: { walk: "WaterWalkSound", run: "WaterRunSound" },
  // DefActorRun (+0x9c) is never read: ACTOR plays the walk array for both gaits.
  ACTOR: { walk: "DefaultActorWalkSound", run: "DefaultActorWalkSound" },
};
export const FOOTSTEP_GROUP_SURFACES: Readonly<Record<FootstepNativeGroup, FootstepSurfaceId>> = {
  GRASS: "Grass", LAND: "Default", WATER: "Water_Shalow", ACTOR: "Stone_Hard",
};
export type FootstepAutoRule = "support-step-sound" | "water-volume" | "step-volume" | "actor" | "grass" | "land" | "no-support";
export interface FootstepSurfaceResolution {
  readonly rule: FootstepAutoRule;
  /** Native array group; null when a support/step-volume Sound or silence wins. */
  readonly group: FootstepNativeGroup | null;
  /** Readout label; null when silent. */
  readonly surface: FootstepSurfaceId | null;
  readonly declared: StepSoundPlacement | null;
  readonly stepSound: StepSoundClip | null;
  readonly silent: boolean;
  readonly status: FootstepEvidenceStatus;
  /** Short live fact, e.g. "Grass · deco ≈ 3.1 ≥ 2". */
  readonly summary: string;
  /** Evidence for hover-cards. */
  readonly reason: string;
}
export interface FootstepAutoResolveOptions { readonly localPlayer: boolean }
export interface FootstepAutoSurface {
  resolve(context: FootstepGroundContext | null, options?: FootstepAutoResolveOptions): FootstepSurfaceResolution;
  /** "RenderDeco grass footsteps" (default on): the deco-count GRASS gate. */
  renderDecoGrass(): boolean;
  setRenderDecoGrass(enabled: boolean): void;
}

const round = (value: number) => Math.round(value * 10) / 10;
const group = (rule: FootstepAutoRule, value: FootstepNativeGroup, status: FootstepEvidenceStatus, summary: string, reason: string): FootstepSurfaceResolution =>
  ({ rule, group: value, surface: FOOTSTEP_GROUP_SURFACES[value], declared: null, stepSound: null, silent: false, status, summary, reason });

export function resolveFootstepSurface(context: FootstepGroundContext | null, library: StepSoundLibrary | null,
  options: { localPlayer?: boolean; renderDecoGrass?: boolean } = {}): FootstepSurfaceResolution {
  const localPlayer = options.localPlayer !== false, renderDeco = options.renderDecoGrass !== false;
  if (!context || context.kind === "none") return group("no-support", "LAND", "presentation", "Default · no support contact",
    "No accepted browser support contact at this step. Native Base = null is silent; playing LAND (Default walk/run) is a presentation choice.");
  // 2. Only AStaticMeshActor (and subclasses) override GetStepSoundData.
  const declared = context.kind === "placement" && context.sourceId ? library?.placements.get(context.sourceId) ?? null : null;
  if (declared) {
    const label = declared.surface ? FOOTSTEP_SURFACE_LABELS[declared.surface] : "declared";
    return { rule: "support-step-sound", group: null, surface: declared.surface ?? "Wood", declared, stepSound: null, silent: false, status: "native",
      summary: `${label} · ${declared.placementId.split(".").at(-1)} StepSound`,
      reason: `StaticMeshActor ${declared.placementId} declares ${declared.slots.map(slot => `${slot.property}=${slot.reference}`).join(", ")}. ` +
        "AStaticMeshActor::GetStepSoundData 0x106f42e0 returns StepSound_1 (2/3) or StepSound_3 (1/3), never StepSound_2, for both gaits. " +
        "Slot draws use the seeded browser generator (presentation choice)." };
  }
  const volume = context.footVolume;
  if (volume?.water) {
    if (volume.pawnInWater) return { rule: "water-volume", group: null, surface: null, declared: null, stepSound: null, silent: true, status: "native",
      summary: "silent · water volume", reason: "FootVolume is water and so is the pawn's PhysicsVolume: the native notify plays nothing." };
    return group("water-volume", "WATER", "native", "Water shallow · water volume", "FootVolume.bL2WaterVolume → WATER arrays (Water{Walk,Run}Sound).");
  }
  if (volume?.stepSound) return { rule: "step-volume", group: null, surface: null, declared: null, stepSound: volume.stepSound, silent: false,
    status: "native", summary: `${volume.stepSound.object.split(".").at(-1)} · step volume`,
    reason: "FootVolume.bL2StepVolume → FL2GameData::GetStepSoundName(StepSoundID)." };
  if (context.kind === "placement" || context.kind === "mesh" || context.kind === "bsp") {
    const what = context.kind === "bsp" ? "BSP floor" : context.kind === "placement" ? "static mesh without StepSound" : "mesh (no source marker)";
    return group("actor", "ACTOR", context.kind === "placement" ? "native" : "unverified", `Stone hard · ${what}`,
      `Support ${context.sourceId ?? context.meshName ?? "(unnamed)"} is not terrain and returns no StepSound → ACTOR = ` +
      "StepSound.Stone_Hard.Stone_Hard_Walk_01..03 for walk and run (DefActorRun is never read)." +
      (context.kind === "bsp" ? " Conditional: BSP support resolves to LevelInfo (Base not terrain)." :
        context.kind === "mesh" ? " Conditional: the support actor class of an unmarked mesh is unknown." : ""));
  }
  // 6. Terrain.
  const deco = context.decoGrass;
  if (!localPlayer) return group("land", "LAND", "native", "Default · terrain (not local player)", "Non-local pawns on terrain always use LAND natively.");
  if (!renderDeco) return group("land", "LAND", "native", "Default · terrain (RenderDeco off)",
    "With RenderDeco off and every 20_20 DecoLayer bForceRender=0 no decorations are generated, so terrain is always LAND.");
  if (!deco) return group("land", "LAND", "presentation", "Default · terrain (deco data not staged)",
    `The deco-count gate needs the staged deco-grass bundle; without it terrain plays LAND (presentation choice). ${DECO_GRASS_APPROXIMATION_LABEL}.`);
  const estimate = `deco ≈ ${round(deco.expected)} ${deco.grass ? "≥" : "<"} ${deco.threshold}`;
  const reason = `${DECO_GRASS_APPROXIMATION_LABEL}: expected generated instances of the 4 DecoLayers within 64 units XY in sector ` +
    `${deco.sector ?? "—"} = ${deco.expected.toFixed(2)}. Native GRASS needs a count > 1 (GetDecoLayerAlpha 0x10728cd0); RenderDeco assumed on (retained Option.ini).`;
  return deco.grass ? group("grass", "GRASS", "presentation", `Grass · ${estimate}`, reason)
    : group("land", "LAND", "presentation", `Default · ${estimate}`, reason);
}

/** AStaticMeshActor::GetStepSoundData 0x106f42e0: StepSound_1 when rand%3 == 2;
 * otherwise StepSound_1 on an odd rand when StepSound_2 is set, else StepSound_3.
 * StepSound_2 itself is never returned and walk/run is ignored. Both draws use
 * the seeded browser generator (the native CRT sequence is not reproduced). */
export function pickStepSoundSlot(placement: StepSoundPlacement, random: () => number): StepSoundPlacementSlot | null {
  const slot = (property: StepSoundPlacementSlot["property"]) => placement.slots.find(row => row.property === property) ?? null;
  if (drawSlot(random, 3) === 2) return slot("StepSound_1");
  if (drawSlot(random, 2) === 1 && slot("StepSound_2")) return slot("StepSound_1");
  return slot("StepSound_3");
}

export function createFootstepAutoSurface(library: StepSoundLibrary | null, options: { renderDecoGrass?: boolean } = {}): FootstepAutoSurface {
  let renderDeco = options.renderDecoGrass !== false;
  return {
    resolve: (context, resolveOptions) => resolveFootstepSurface(context, library, { localPlayer: resolveOptions?.localPlayer ?? true, renderDecoGrass: renderDeco }),
    renderDecoGrass: () => renderDeco,
    setRenderDecoGrass(enabled) {
      if (typeof enabled !== "boolean") throw new TypeError("RenderDeco grass footsteps must be on or off.");
      renderDeco = enabled;
    },
  };
}

export const isWaterGroup = (value: FootstepNativeGroup | null | undefined): boolean => value === "WATER";
