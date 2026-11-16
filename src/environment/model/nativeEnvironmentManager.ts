import { calculateEnvironmentDelta } from "./calculateEnvironmentDelta";
import { ENVIRONMENT_ENGINE_CONSTANTS } from "./nativeEnvironmentEngineConstants";
import { createNativeTimeClock, type NativeTimeClockSetup, type NativeTimeClockSnapshot, type ReadRealSeconds } from "./nativeTimeClock";

export interface NativeEnvironmentBlend {
  readonly oldType: number;
  readonly targetType: number;
  readonly weight: number;
}

export interface NativeEnvironmentSetup extends NativeTimeClockSetup {
  readonly shadowTickHours: number;
}

export interface NativeEnvironmentManagerSettings {
  readonly setup: NativeEnvironmentSetup;
  readonly loadedEnvironmentTypes: ReadonlySet<number>;
  readonly readRealSeconds: ReadRealSeconds;
}

export interface ChangeEnvironmentRequest {
  readonly environmentType: number;
  readonly immediate: number;
  readonly endDelayHours: number;
  readonly peakDelayHours: number;
  readonly targetWeight: number;
  readonly timeoutSeconds: number;
  readonly persistent: boolean;
}

export type DayPart = 0 | 1 | 2 | 3;

export interface NativeEnvironmentSnapshot extends NativeEnvironmentBlend {
  readonly clock: NativeTimeClockSnapshot;
  readonly frozen: { readonly value: false; readonly status: "unresolved"; readonly reason: "freeze-producer-unresolved" };
  readonly dayPart: DayPart;
  readonly shadowTickHours: number;
  readonly lastLightingHour: number;
  readonly lightingDirty: boolean;
  readonly persistentOldType: number;
  readonly persistentTargetType: number;
  readonly transitionStart: number;
  readonly transitionEnd: number;
  readonly transitionPeak: number;
  readonly targetWeight: number;
  readonly oldWeight: number;
  readonly remainingRevertSeconds: number;
  readonly celestialPhiDegrees: number;
}

export interface NativeEnvironmentManager {
  tick(deltaSeconds: number): void;
  receiveServerTime(gameMinutes: number): void;
  changeEnvironment(request: ChangeEnvironmentRequest): void;
  receiveSsqInfo(first: number, second: number): void;
  receiveRedSky(timeoutSeconds: number): void;
  hour(): number;
  blend(): NativeEnvironmentBlend;
  snapshot(): NativeEnvironmentSnapshot;
}

const { dayPartBounds, ssqDelayHours, redSkyDelayHours, redSkyEnvironmentType, celestialPhiDegrees } = ENVIRONMENT_ENGINE_CONSTANTS;
const byteMask = 0xff;
const frozenGate = { value: false, status: "unresolved", reason: "freeze-producer-unresolved" } as const;

function signedCharacter(value: number): number {
  return (value << 24) >> 24;
}

function dayPartAtHour(hour: number): DayPart {
  const { morningStart, dayStart, eveningStart, dayEnd } = dayPartBounds.value;
  if (morningStart <= hour && hour < dayStart) return 0;
  if (dayStart <= hour && hour < eveningStart) return 1;
  if (eveningStart <= hour && hour < dayEnd) return 2;
  return 3;
}

function requireByte(value: number, label: string): number {
  if (!Number.isInteger(value) || value < -0x80 || value > byteMask) throw new RangeError(`${label} ${value} must fit in one byte.`);
  return value & byteMask;
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} ${value} must be a finite number.`);
  return Math.fround(value);
}

export function createNativeEnvironmentManager(settings: NativeEnvironmentManagerSettings): NativeEnvironmentManager {
  const { setup, loadedEnvironmentTypes, readRealSeconds } = settings;
  const clock = createNativeTimeClock(setup, readRealSeconds);
  const shadowTickHours = Math.fround(setup.shadowTickHours);
  let dayPart: DayPart = 0;
  let lastLightingHour = 0;
  let lightingDirty = false;
  let oldType = 0, targetType = 0, persistentOldType = 0, persistentTargetType = 0;
  let transitionStart = 0, transitionEnd = 0, transitionPeak = 0;
  let targetWeight = 0, oldWeight = 0, weight = 0;
  let remainingRevertSeconds = 0;

  function changeEnvironment(request: ChangeEnvironmentRequest): void {
    const environmentType = requireByte(request.environmentType, "Environment type");
    const immediate = requireByte(request.immediate, "Immediate flag");
    const endDelayHours = requireFinite(request.endDelayHours, "End delay");
    const peakDelayHours = requireFinite(request.peakDelayHours, "Peak delay");
    const requestedWeight = requireFinite(request.targetWeight, "Target weight");
    const timeoutSeconds = requireFinite(request.timeoutSeconds, "Timeout");
    const hour = clock.hour();
    if (immediate === 1) {
      oldType = targetType = environmentType;
      transitionStart = transitionEnd = transitionPeak = hour;
      targetWeight = oldWeight = 1;
      if (request.persistent) persistentTargetType = persistentOldType = environmentType;
      return;
    }
    if (peakDelayHours < 0) return;
    const end = endDelayHours + hour;
    if (end < peakDelayHours) return;
    if (requestedWeight < 0 || requestedWeight > 1) return;
    if (!loadedEnvironmentTypes.has(signedCharacter(environmentType))) return;
    transitionStart = hour;
    transitionEnd = Math.fround(end);
    transitionPeak = Math.fround(peakDelayHours + hour);
    if (request.persistent) {
      persistentOldType = targetType;
      persistentTargetType = environmentType;
    }
    remainingRevertSeconds = timeoutSeconds;
    oldType = targetType;
    oldWeight = targetWeight;
    targetType = environmentType;
    targetWeight = requestedWeight;
    if (environmentType === 0) {
      transitionPeak = transitionEnd;
      targetWeight = 1;
    }
  }

  function revertRequest(): ChangeEnvironmentRequest {
    return { environmentType: persistentTargetType, immediate: 0, endDelayHours: redSkyDelayHours.value, peakDelayHours: redSkyDelayHours.value,
      targetWeight: 1, timeoutSeconds: 0, persistent: false };
  }

  return {
    tick(deltaSeconds) {
      if (!clock.isClock) return;
      clock.advance();
      const hour = clock.hour();
      dayPart = dayPartAtHour(hour);
      lightingDirty = shadowTickHours > 0 && Math.abs(hour - lastLightingHour) > shadowTickHours;
      if (lightingDirty) lastLightingHour = hour;
      if (targetType !== persistentTargetType) {
        remainingRevertSeconds = Math.fround(remainingRevertSeconds - Math.fround(deltaSeconds));
        if (remainingRevertSeconds < 0) changeEnvironment(revertRequest());
      }
      if (oldType !== targetType) {
        lightingDirty = true;
        if (transitionEnd <= hour) {
          oldType = targetType;
          oldWeight = targetWeight;
          persistentOldType = persistentTargetType;
        }
      }
      weight = calculateEnvironmentDelta({ start: transitionStart, end: transitionEnd, peak: transitionPeak, targetWeight }, hour);
    },
    receiveServerTime: gameMinutes => clock.receiveServerTime(gameMinutes),
    changeEnvironment,
    receiveSsqInfo(first, second) {
      changeEnvironment({ environmentType: first, immediate: second, endDelayHours: ssqDelayHours.value, peakDelayHours: ssqDelayHours.value,
        targetWeight: 1, timeoutSeconds: 0, persistent: true });
    },
    receiveRedSky(timeoutSeconds) {
      if (!Number.isInteger(timeoutSeconds)) throw new RangeError(`Red sky timeout ${timeoutSeconds} must be an integer number of seconds.`);
      changeEnvironment({ environmentType: redSkyEnvironmentType.value, immediate: 0, endDelayHours: redSkyDelayHours.value,
        peakDelayHours: redSkyDelayHours.value, targetWeight: 1, timeoutSeconds, persistent: false });
    },
    hour: () => clock.hour(),
    blend: () => ({ oldType, targetType, weight }),
    snapshot: () => ({
      clock: clock.snapshot(), frozen: frozenGate, dayPart, shadowTickHours, lastLightingHour, lightingDirty, oldType, targetType, weight,
      persistentOldType, persistentTargetType, transitionStart, transitionEnd, transitionPeak, targetWeight, oldWeight, remainingRevertSeconds,
      celestialPhiDegrees: celestialPhiDegrees.value,
    }),
  };
}
