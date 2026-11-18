import type { Scene } from "@babylonjs/core/scene";
import {
  environmentColour, environmentLightPlane, environmentScale, skyLayerColour, type EnvironmentResult, type EnvironmentTransitionGap,
} from "../../environment/model/nativeEnvironmentColours";
import type { NativePlane } from "../../environment/model/nativePlane";
import { createNativeEnvironmentManager, type NativeEnvironmentManager, type NativeEnvironmentSnapshot } from "../../environment/model/nativeEnvironmentManager";
import type { NativeHourSource, ReadRealSeconds } from "../../environment/model/nativeTimeClock";
import type { RgbBytes, TimeScaleSample } from "../../environment/model/sampleNativeTimeTables";
import { moonAngles, sunAngles } from "../../environment/model/nativeSunMoonDirection";
import type { NativeTimeTablesExport, SkyEnvironmentBinding } from "../../environment/parseNativeTimeTables";
import type { EnvironmentFogRanges } from "../../materials/ue2/model/fog";
import { createSceneScopedContext } from "../sceneScopedContext";
import { loadNativeTimeTables } from "./nativeEnvironmentTables";

export interface WorldEnvironmentSample {
  readonly hour: number;
  readonly hourSource: NativeHourSource;
  readonly oldType: number;
  readonly targetType: number;
  readonly weight: number;
}

export type SkyEnvironmentColourResult = EnvironmentResult<RgbBytes, "sky-layer-start-colour-unresolved">;

export interface SkyEnvironmentColour extends SkyEnvironmentBinding {
  readonly colour: SkyEnvironmentColourResult;
}

export interface WorldCelestialSample {
  readonly sunTheta: number;
  readonly moonTheta: number;
  readonly moonScale: TimeScaleSample | EnvironmentTransitionGap;
}

export interface HourlyEnvironmentLighting {
  readonly hour: number;
  readonly terrainAmbient: EnvironmentResult<RgbBytes>;
  readonly terrainLight: EnvironmentResult<NativePlane>;
  readonly staticMeshAmbient: EnvironmentResult<RgbBytes>;
  readonly staticMeshLight: EnvironmentResult<NativePlane>;
  readonly actorAmbient: EnvironmentResult<RgbBytes>;
  readonly bspAmbient: EnvironmentResult<RgbBytes>;
}

export interface RunningWorldTimeOfDay {
  readonly status: "running";
  readonly manager: NativeEnvironmentManager;
  readonly skyBindings: readonly SkyEnvironmentBinding[];
  readonly environmentTypes: readonly number[];
  readonly fogRanges: EnvironmentFogRanges;
  readonly fogSpeedSeconds: number;
  sample(): WorldEnvironmentSample;
  skyEnvironmentColours(): readonly SkyEnvironmentColour[];
  hazeColour(): SkyEnvironmentColourResult;
  celestial(): WorldCelestialSample;
  hourlyEnvironmentLighting(): HourlyEnvironmentLighting;
  dispose(): void;
}

export interface WorldTimeOfDayGap {
  readonly status: "gap";
  readonly reason: string;
  readonly detail: string;
}

export type WorldTimeOfDay = RunningWorldTimeOfDay | WorldTimeOfDayGap;

export type WorldTimeOfDayInspection =
  | { readonly status: "running"; readonly snapshot: NativeEnvironmentSnapshot; readonly environmentTypes: readonly number[];
      readonly skyEnvironmentColours: readonly SkyEnvironmentColour[]; readonly celestial: WorldCelestialSample }
  | WorldTimeOfDayGap;

const millisecondsPerSecond = 1000;
const worldTimeOfDayContexts = createSceneScopedContext<WorldTimeOfDay>("world time of day");
const worldTimeOfDayUnprovidedGap: WorldTimeOfDayGap = { status: "gap", reason: "environment-time-of-day-unprovided",
  detail: "No world time of day was provided for this scene." };

export function startWorldTimeOfDay(scene: Scene, timeTables: NativeTimeTablesExport, readRealSeconds: ReadRealSeconds): RunningWorldTimeOfDay {
  const { setup, tables, skyBindings, fogRanges, fogSpeedSeconds } = timeTables;
  const manager = createNativeEnvironmentManager({ setup, loadedEnvironmentTypes: new Set(tables.keys()), readRealSeconds });
  const tick = scene.onBeforeRenderObservable.add(() => manager.tick(scene.getEngine().getDeltaTime() / millisecondsPerSecond));
  let disposed = false;
  return {
    status: "running", manager, skyBindings, fogRanges, fogSpeedSeconds, environmentTypes: [...tables.keys()].sort((first, second) => first - second),
    sample() {
      const snapshot = manager.snapshot();
      return { hour: snapshot.clock.hour, hourSource: snapshot.clock.hourSource, oldType: snapshot.oldType, targetType: snapshot.targetType, weight: snapshot.weight };
    },
    skyEnvironmentColours() {
      const hour = manager.hour(), blend = manager.blend();
      return skyBindings.map(binding => ({ ...binding, colour: binding.section === "SkyBoxColor"
        ? environmentColour(tables, blend, binding.section, hour) : skyLayerColour(tables, blend, binding.section, hour) }));
    },
    hazeColour: () => skyLayerColour(tables, manager.blend(), "HazeringColor", manager.hour()),
    celestial() {
      const hour = manager.hour(), { celestialPhiDegrees } = manager.snapshot();
      return { sunTheta: sunAngles(hour, celestialPhiDegrees).theta, moonTheta: moonAngles(hour, celestialPhiDegrees).theta,
        moonScale: environmentScale(tables, manager.blend(), "MoonScale", hour) };
    },
    hourlyEnvironmentLighting() {
      const hour = manager.hour(), blend = manager.blend();
      return { hour,
        terrainAmbient: environmentColour(tables, blend, "TerrainAmbient", hour), terrainLight: environmentLightPlane(tables, blend, "HSVTerrainLight", hour),
        staticMeshAmbient: environmentColour(tables, blend, "StaticMeshAmbient", hour),
        staticMeshLight: environmentLightPlane(tables, blend, "HSVStaticMeshLight", hour),
        actorAmbient: environmentColour(tables, blend, "ActorAmbient", hour), bspAmbient: environmentColour(tables, blend, "BSPAmbient", hour) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.onBeforeRenderObservable.remove(tick);
    },
  };
}

export async function loadWorldTimeOfDay(scene: Scene, signal: AbortSignal, readRealSeconds: ReadRealSeconds): Promise<WorldTimeOfDay> {
  const loaded = await loadNativeTimeTables(signal);
  if (loaded.status === "gap") return loaded;
  return startWorldTimeOfDay(scene, loaded.timeTables, readRealSeconds);
}

export function inspectWorldTimeOfDay(timeOfDay: WorldTimeOfDay): WorldTimeOfDayInspection {
  if (timeOfDay.status === "gap") return timeOfDay;
  return { status: "running", snapshot: timeOfDay.manager.snapshot(), environmentTypes: timeOfDay.environmentTypes,
    skyEnvironmentColours: timeOfDay.skyEnvironmentColours(), celestial: timeOfDay.celestial() };
}

export function provideWorldTimeOfDay(scene: Scene, timeOfDay: WorldTimeOfDay): () => void {
  return worldTimeOfDayContexts.provide(scene, timeOfDay);
}

export function worldTimeOfDayFor(scene: Scene): WorldTimeOfDay {
  return worldTimeOfDayContexts.contextFor(scene) ?? worldTimeOfDayUnprovidedGap;
}
