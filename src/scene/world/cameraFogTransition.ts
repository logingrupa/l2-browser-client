import type { BgraBytes } from "../../environment/model/nativeColourBytes";
import type { FogColourBytes, FogRangeRecord, FogState } from "../../materials/ue2/model/fog";
import {
  setFogTransitionColourTarget, setFogTransitionDuration, setFogTransitionRangeTarget, snapshotFogTransition, updateFogTransition, type FogTransitionState,
} from "../../materials/ue2/model/fogTransition";
import type { CameraEnvironment, CameraFogRoute } from "./cameraEnvironment";

export type FogTransitionRestartDuration = "FogSpeed" | "DistanceFogBlendTime" | "fog-zone-blend-time-unstaged";

export interface CameraFogTransitionInspection {
  readonly state: FogTransitionState | null;
  readonly route: CameraFogRoute["kind"] | null;
  readonly fogSpeedSeconds: number;
  readonly previousLocal: boolean;
  readonly previousTerrainZone: boolean;
  readonly lastRestart: FogTransitionRestartDuration | null;
  readonly initialState: { readonly status: "unresolved"; readonly reason: typeof fogTransitionInitialStateUnresolvedReason };
}

export interface CameraFogTransition {
  advance(environment: CameraEnvironment, deltaSeconds: number): CameraEnvironment;
  inspection(): CameraFogTransitionInspection;
}

export const fogTransitionInitialStateUnresolvedReason = "fog-transition-initial-state-unresolved";

const byteMaximum = 255;
const undrawnFogAlpha = 0;

const bgraOf = (colour: FogColourBytes): BgraBytes => [colour[2], colour[1], colour[0], undrawnFogAlpha];

function seededState(target: FogRangeRecord): FogTransitionState {
  const colour = bgraOf(target.colourBytes);
  return { targetColourBgra: colour, targetStart: Math.fround(target.startSourceUnits), targetEnd: Math.fround(target.endSourceUnits), oldColourBgra: colour,
    oldStart: Math.fround(target.startSourceUnits), oldEnd: Math.fround(target.endSourceUnits), colourBgra: colour, start: Math.fround(target.startSourceUnits),
    end: Math.fround(target.endSourceUnits), duration: 0, remaining: 0 };
}

function routeSeed(route: Exclude<CameraFogRoute, { kind: "bypass" }>): FogRangeRecord {
  if (route.kind === "local-list") return route.target;
  if (route.zone.kind === "distance-fog-zone") return route.zone.target;
  const colourBytes = route.zone.kind === "terrain-zone" ? route.zone.hazeColour : [0, 0, 0] as const;
  return { colourBytes, startSourceUnits: route.presetPair[0], endSourceUnits: route.presetPair[1] };
}

function transitionedFog(fog: FogState, state: FogTransitionState): FogState {
  const [blue, green, red] = state.colourBgra;
  return { ...fog, colour: [red / byteMaximum, green / byteMaximum, blue / byteMaximum], startSourceUnits: state.start, endSourceUnits: state.end, fogEnd: state.end };
}

export function createCameraFogTransition(fogSpeedSeconds: number): CameraFogTransition {
  let state: FogTransitionState | null = null, route: CameraFogRoute["kind"] | null = null;
  let previousLocal = false, previousTerrainZone = false, cachedPresetPair: readonly [number, number] | null = null;
  let lastRestart: FogTransitionRestartDuration | null = null;
  const restart = (current: FogTransitionState, seconds: number, duration: FogTransitionRestartDuration) => {
    lastRestart = duration;
    return snapshotFogTransition(setFogTransitionDuration(current, seconds));
  };
  const step = (current: FogTransitionState, active: Exclude<CameraFogRoute, { kind: "bypass" }>): { readonly next: FogTransitionState; readonly gap: string | null } => {
    if (active.kind === "local-list") {
      const targeted = setFogTransitionRangeTarget(setFogTransitionColourTarget(current, bgraOf(active.target.colourBytes)),
        active.target.startSourceUnits, active.target.endSourceUnits);
      const next = previousLocal ? targeted : restart(targeted, fogSpeedSeconds, "FogSpeed");
      previousLocal = true;
      return { next, gap: null };
    }
    const { zone, presetPair } = active;
    const terrainZone = zone.kind === "terrain-zone";
    let next = terrainZone ? setFogTransitionColourTarget(current, bgraOf(zone.hazeColour)) : current;
    let gap: string | null = null;
    const presetPairChanged = cachedPresetPair === null || cachedPresetPair[0] !== presetPair[0] || cachedPresetPair[1] !== presetPair[1];
    if (previousLocal || (terrainZone && !previousTerrainZone) || presetPairChanged) {
      cachedPresetPair = presetPair;
      next = restart(setFogTransitionRangeTarget(next, presetPair[0], presetPair[1]), fogSpeedSeconds, "FogSpeed");
    } else if (zone.kind === "distance-fog-zone") {
      next = setFogTransitionRangeTarget(setFogTransitionColourTarget(next, bgraOf(zone.target.colourBytes)), zone.target.startSourceUnits, zone.target.endSourceUnits);
      if (zone.blendTime.status === "unstaged") gap = zone.blendTime.reason;
      if (previousTerrainZone) {
        next = zone.blendTime.status === "staged" ? restart(next, zone.blendTime.seconds, "DistanceFogBlendTime") : restart(next, 0, "fog-zone-blend-time-unstaged");
      }
    }
    previousLocal = false;
    previousTerrainZone = terrainZone;
    return { next, gap };
  };
  return {
    advance(environment, deltaSeconds) {
      const active = environment.fogRoute;
      route = active.kind;
      if (active.kind === "bypass") return environment;
      const { next, gap } = step(state ?? seededState(routeSeed(active)), active);
      state = updateFogTransition(next, deltaSeconds);
      const fog = environment.fog.enabled ? transitionedFog(environment.fog, state) : environment.fog;
      const skyFog = environment.skyFog.route === "inherit-level" ? { ...environment.skyFog, fog } : environment.skyFog;
      return { ...environment, fog, skyFog, gaps: gap === null ? environment.gaps : [...environment.gaps, gap] };
    },
    inspection: () => ({ state, route, fogSpeedSeconds, previousLocal, previousTerrainZone, lastRestart,
      initialState: { status: "unresolved", reason: fogTransitionInitialStateUnresolvedReason } }),
  };
}
