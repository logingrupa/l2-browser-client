import type { Scene } from "@babylonjs/core/scene";
import { environmentColour, skyLayerColour, type EnvironmentResult } from "../../environment/model/nativeEnvironmentColours";
import { createNativeEnvironmentManager, type NativeEnvironmentManager, type NativeEnvironmentSnapshot } from "../../environment/model/nativeEnvironmentManager";
import type { NativeHourSource, ReadRealSeconds } from "../../environment/model/nativeTimeClock";
import type { RgbBytes } from "../../environment/model/sampleNativeTimeTables";
import type { NativeTimeTablesExport, SkyEnvironmentBinding } from "../../environment/parseNativeTimeTables";
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

export interface RunningWorldTimeOfDay {
  readonly status: "running";
  readonly manager: NativeEnvironmentManager;
  readonly skyBindings: readonly SkyEnvironmentBinding[];
  sample(): WorldEnvironmentSample;
  skyEnvironmentColours(): readonly SkyEnvironmentColour[];
  dispose(): void;
}

export interface WorldTimeOfDayGap {
  readonly status: "gap";
  readonly reason: string;
  readonly detail: string;
}

export type WorldTimeOfDay = RunningWorldTimeOfDay | WorldTimeOfDayGap;

export type WorldTimeOfDayInspection =
  | { readonly status: "running"; readonly snapshot: NativeEnvironmentSnapshot; readonly skyEnvironmentColours: readonly SkyEnvironmentColour[] }
  | WorldTimeOfDayGap;

const millisecondsPerSecond = 1000;
const worldTimeOfDayContexts = createSceneScopedContext<WorldTimeOfDay>("world time of day");
export const worldTimeOfDayUnprovidedGap: WorldTimeOfDayGap = { status: "gap", reason: "environment-time-of-day-unprovided",
  detail: "No world time of day was provided for this scene." };

export function startWorldTimeOfDay(scene: Scene, timeTables: NativeTimeTablesExport, readRealSeconds: ReadRealSeconds): RunningWorldTimeOfDay {
  const { setup, tables, skyBindings } = timeTables;
  const manager = createNativeEnvironmentManager({ setup, loadedEnvironmentTypes: new Set(tables.keys()), readRealSeconds });
  const tick = scene.onBeforeRenderObservable.add(() => manager.tick(scene.getEngine().getDeltaTime() / millisecondsPerSecond));
  let disposed = false;
  return {
    status: "running", manager, skyBindings,
    sample() {
      const snapshot = manager.snapshot();
      return { hour: snapshot.clock.hour, hourSource: snapshot.clock.hourSource, oldType: snapshot.oldType, targetType: snapshot.targetType, weight: snapshot.weight };
    },
    skyEnvironmentColours() {
      const hour = manager.hour(), blend = manager.blend();
      return skyBindings.map(binding => ({ ...binding, colour: binding.section === "SkyBoxColor"
        ? environmentColour(tables, blend, binding.section, hour) : skyLayerColour(tables, blend, binding.section, hour) }));
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
  return { status: "running", snapshot: timeOfDay.manager.snapshot(), skyEnvironmentColours: timeOfDay.skyEnvironmentColours() };
}

export function provideWorldTimeOfDay(scene: Scene, timeOfDay: WorldTimeOfDay): () => void {
  return worldTimeOfDayContexts.provide(scene, timeOfDay);
}

export function worldTimeOfDayFor(scene: Scene): WorldTimeOfDay {
  return worldTimeOfDayContexts.contextFor(scene) ?? worldTimeOfDayUnprovidedGap;
}
