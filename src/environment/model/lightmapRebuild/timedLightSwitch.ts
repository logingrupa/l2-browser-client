import { ENVIRONMENT_ENGINE_CONSTANTS } from "../nativeEnvironmentEngineConstants";
import { DYNAMIC_LIGHT_CONSTANTS } from "./dynamicLightEngineConstants";

export interface TimedLightSchedule {
  readonly timeLight: boolean;
  readonly lightOnTime: number;
  readonly lightOffTime: number;
}

export interface TimedLightState {
  readonly lightType: number;
  readonly switchFlags: number;
  readonly lightLifeTime: number;
  readonly lightPreviousTime: number;
}

const { hoursPerDay } = ENVIRONMENT_ENGINE_CONSTANTS;
const { switchedOnType, switchedOffType, switchFlags } = DYNAMIC_LIGHT_CONSTANTS.timedLight.value;

function advancePastByDays(value: number, threshold: number): number {
  let advanced = value;
  while (advanced < threshold) advanced = Math.fround(advanced + hoursPerDay.value);
  return advanced;
}

function switchTimedLight(schedule: TimedLightSchedule, state: TimedLightState, hour: number): TimedLightState {
  const onTime = Math.fround(schedule.lightOnTime);
  const offTime = advancePastByDays(Math.fround(schedule.lightOffTime), onTime);
  const scheduleHour = advancePastByDays(Math.fround(hour), onTime);
  if (scheduleHour < offTime) {
    if (state.lightType === switchedOnType) return state;
    return { lightType: switchedOnType, switchFlags: state.switchFlags | switchFlags, lightLifeTime: Math.fround(offTime - scheduleHour), lightPreviousTime: scheduleHour };
  }
  const switchedOff = state.lightType === switchedOffType ? state
    : { ...state, lightType: switchedOffType, switchFlags: state.switchFlags & ~switchFlags, lightLifeTime: 0 };
  return { ...switchedOff, lightLifeTime: Math.fround(switchedOff.lightLifeTime - (scheduleHour - switchedOff.lightPreviousTime)), lightPreviousTime: scheduleHour };
}

export function applyTimeLightRule(schedule: TimedLightSchedule, state: TimedLightState, hour: number): TimedLightState {
  return schedule.timeLight ? switchTimedLight(schedule, state, hour) : state;
}
