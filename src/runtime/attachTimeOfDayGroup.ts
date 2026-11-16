import type { DevGroup, DevSection } from "../ui/devSheet/DevSheet";
import type { VariableInfo } from "../ui/devSheet/types";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { RgbBytes, TimeScaleSample } from "../environment/model/sampleNativeTimeTables";
import type { EnvironmentTransitionGap } from "../environment/model/nativeEnvironmentColours";
import type { SkyEnvironmentColourInspection } from "../scene/world/skyEnvironmentColours";
import type { SkyEnvironmentBinding } from "../environment/parseNativeTimeTables";
import type { RunningWorldTimeOfDay, WorldTimeOfDay } from "../scene/world/worldTimeOfDay";

export interface TimeOfDayGroupContext {
  readonly timeOfDay: WorldTimeOfDay;
  readonly adapter: Pick<GameWorldAdapter, "dispatch">;
  readonly skyEnvironmentColours: (() => readonly SkyEnvironmentColourInspection[]) | null;
  readonly skyAbsentReason: string;
}

const dayNightReport = "DB-4 day-night-cycle.json fe5de165";
const environmentTypeValues = "EnvType 0..3 (type names unresolved; never dusk or dawn)";
const minutesPerHour = 60;
const authoredSkyChannelOrderGap = "authored-sky-channel-order-unresolved";
const immediateOptions = [
  { value: "0", label: "0 (blend)", hint: "ChangeEnv starts a 0.02 h window from the current hour." },
  { value: "1", label: "1 (immediate)", hint: "ChangeEnv switches the old and target types at once." },
];

const environmentTypeLabel = (environmentType: number) => `EnvType ${environmentType}`;
const rgbText = (rgb: RgbBytes) => rgb.join(", ");

function clockText(hour: number): string {
  const wholeHour = Math.trunc(hour), minute = Math.trunc((hour - wholeHour) * minutesPerHour);
  return `${String(wholeHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function nativeVariable(name: string, value: () => string, values: string, source: string): VariableInfo {
  return { name, value, values, source: `${source}. ${dayNightReport}`, status: "native" };
}

function unresolvedVariable(name: string, value: () => string, reason: string, source: string): VariableInfo {
  return { name, value: () => `${value()} (${reason})`, values: "unverified with the named reason", source: `${source}. ${dayNightReport}`, status: "unverified" };
}

function scaleVariable(name: string, sample: () => TimeScaleSample | EnvironmentTransitionGap, source: string): VariableInfo {
  return {
    name, values: "f32 scale | unwritten (output unchanged) | unverified reason", source: `${source}. ${dayNightReport}`,
    value: () => { const current = sample(); return current.status === "sampled" ? String(current.value) : current.status === "unwritten" ? "unwritten" : current.reason; },
    get status() { return sample().status === "unresolved" ? "unverified" : "native"; },
  };
}

interface SkyColourReading { readonly text: string; readonly status: "native" | "unverified" }

function readSkyColour(binding: SkyEnvironmentBinding, context: TimeOfDayGroupContext, timeOfDay: RunningWorldTimeOfDay): SkyColourReading {
  const written = context.skyEnvironmentColours?.().find(entry => entry.setupKey === binding.setupKey) ?? null;
  if (written?.writtenRgb && written.materialColourSource === "environment-write") return { text: rgbText(written.writtenRgb), status: "native" };
  if (written?.writtenRgb) return { text: `${rgbText(written.writtenRgb)} held from an earlier frame (${written.reason})`, status: "unverified" };
  const model = timeOfDay.skyEnvironmentColours().find(entry => entry.setupKey === binding.setupKey)?.colour ?? null;
  const reason = written === null ? context.skyAbsentReason : written.reason ?? (model?.status === "unresolved" ? model.reason : "sky-environment-colour-unwritten");
  const authoredColour = written?.materialNode ? `; authored colour shown (${authoredSkyChannelOrderGap})` : "";
  return { text: `not written (${reason})${authoredColour}${model?.status === "resolved" ? `; model ${rgbText(model.value)}` : ""}`, status: "unverified" };
}

function skyColourVariable(binding: SkyEnvironmentBinding, context: TimeOfDayGroupContext, timeOfDay: RunningWorldTimeOfDay): VariableInfo {
  return {
    name: `env.sky.${binding.objectName}`, values: "R, G, B bytes written to the material | unverified reason",
    source: `Env.int ${binding.setupKey}=${binding.objectName}, ${binding.section} at the current hour written to the ColorModifier Color R, G, B (alpha kept). ${dayNightReport}`,
    value: () => readSkyColour(binding, context, timeOfDay).text,
    get status() { return readSkyColour(binding, context, timeOfDay).status; },
  };
}

export function timeOfDayVariables(timeOfDay: RunningWorldTimeOfDay, context: TimeOfDayGroupContext): VariableInfo[] {
  const snapshot = () => timeOfDay.manager.snapshot();
  return [
    nativeVariable("env.hour", () => String(snapshot().clock.hour), "f32 game hour", "UpdateNTime minute/60 + hour + second/3600 in float32"),
    nativeVariable("env.hourSource", () => snapshot().clock.hourSource, "start-time | server-time",
      "Env.int StartTime until a set-server-time sandbox command (OnReceiveServerTime; the packet opcode and layout are server-packet-unresolved)"),
    nativeVariable("env.timeRatio", () => String(snapshot().clock.timeRatio), "integer game seconds per real second", "Env.int [EnvSetup] TimeRatio"),
    nativeVariable("env.isClock", () => snapshot().clock.isClock ? "1" : "0", "1 runs the clock | 0 keeps the hour", "Env.int [EnvSetup] IsClock"),
    unresolvedVariable("env.frozen", () => "0", snapshot().frozen.reason, "Freeze flag stays 0; its producer 0x10c51050 is not identified"),
    nativeVariable("env.dayPart", () => String(snapshot().dayPart), "0 [6,8) | 1 [8,22) | 2 [22,24) | 3 otherwise", "UpdateNTime day part at +0x130"),
    nativeVariable("env.oldType", () => environmentTypeLabel(snapshot().oldType), environmentTypeValues, "ChangeEnv old type"),
    nativeVariable("env.targetType", () => environmentTypeLabel(snapshot().targetType), environmentTypeValues, "ChangeEnv target type"),
    nativeVariable("env.persistentType", () => environmentTypeLabel(snapshot().persistentTargetType), environmentTypeValues,
      "ChangeEnv persistent target, the red sky revert type"),
    nativeVariable("env.weight", () => String(snapshot().weight), "f32 blend weight", "CalcEnvDelta in native branch order"),
    nativeVariable("env.start", () => String(snapshot().transitionStart), "f32 hour", "ChangeEnv window start, no wrap"),
    nativeVariable("env.peak", () => String(snapshot().transitionPeak), "f32 hour", "ChangeEnv window peak, no wrap"),
    nativeVariable("env.end", () => String(snapshot().transitionEnd), "f32 hour (past 24 never settles)", "ChangeEnv window end, no wrap"),
    nativeVariable("env.timeout", () => String(snapshot().remainingRevertSeconds), "f32 real seconds",
      "OnRedSky timeout countdown; reverts to the persistent type once it drops below 0"),
    nativeVariable("env.lightingDirty", () => String(snapshot().lightingDirty), "true | false",
      "ShadowTick hour step or old type != target type; the relight routine is relight-routine-unresolved"),
    ...timeOfDay.skyBindings.map(binding => skyColourVariable(binding, context, timeOfDay)),
    nativeVariable("sun.theta", () => String(timeOfDay.celestial().sunTheta), "f32 radians",
      "GetSunModifierInfo; no Babylon sun applier (environment-lighting-composition-unresolved)"),
    nativeVariable("moon.theta", () => String(timeOfDay.celestial().moonTheta), "f32 radians",
      "GetMoonModifierInfo; no Babylon moon applier (environment-lighting-composition-unresolved)"),
    scaleVariable("moonScale", () => timeOfDay.celestial().moonScale, "MoonScale table of the target type at the current hour; a read past the table is not clamped"),
  ];
}

function attachTimeOfDayControls(group: DevGroup, timeOfDay: RunningWorldTimeOfDay, context: TimeOfDayGroupContext, variables: () => VariableInfo[]): void {
  const { adapter } = context;
  group.readout({ label: "Game time", testId: "time-of-day-clock", variables,
    hint: "Current DB-4 hour and environment type pair.",
    value: () => { const sample = timeOfDay.sample(); return `${clockText(sample.hour)} · ${environmentTypeLabel(sample.oldType)} > ${environmentTypeLabel(sample.targetType)}`; } });
  group.idEntry({ label: "Send server time", testId: "time-of-day-server-time", submitText: "Send server time", variables,
    hint: "Dispatches set-server-time with whole game minutes through the adapter. The server packet layout is server-packet-unresolved.",
    fields: [{ name: "gameClock", label: "Game time (HH:MM)", kind: "clock" }],
    onSubmit: values => adapter.dispatch({ type: "set-server-time", gameMinutes: Number(values.gameClock) }) });
  const environmentTypeOptions = timeOfDay.environmentTypes.map(environmentType => ({ value: String(environmentType), label: environmentTypeLabel(environmentType) }));
  const ssqType = group.choice({ label: "SSQ type", testId: "time-of-day-ssq-type", display: "select", options: environmentTypeOptions, variables,
    hint: "First OnSSQInfo byte: the environment type, from the loaded timeenv files." });
  const ssqImmediate = group.choice({ label: "SSQ immediate", testId: "time-of-day-ssq-immediate", display: "select", options: immediateOptions, variables,
    hint: "Second OnSSQInfo byte: ChangeEnv immediate flag." });
  group.button({ label: "SSQ info", testId: "time-of-day-ssq-info", variables,
    hint: "Dispatches set-environment-ssq-info through the adapter; OnSSQInfo calls ChangeEnv(type, immediate, 0.02, 0.02, 1, 0, persistent).",
    onClick: () => adapter.dispatch({ type: "set-environment-ssq-info", first: Number(ssqType.value), second: Number(ssqImmediate.value) }) });
  group.idEntry({ label: "Red sky", testId: "time-of-day-red-sky", submitText: "Red sky", variables,
    hint: "Dispatches set-environment-red-sky through the adapter; OnRedSky calls ChangeEnv(3, 0, 0.002, 0.002, 1, timeout, 0).",
    fields: [{ name: "timeoutSeconds", label: "Timeout (s)", kind: "integer", minimum: 0 }],
    onSubmit: values => adapter.dispatch({ type: "set-environment-red-sky", timeoutSeconds: Number(values.timeoutSeconds) }) });
}

export function attachTimeOfDayGroup(section: DevSection, context: TimeOfDayGroupContext): void {
  const group = section.group("time-of-day", "Time of day");
  const { timeOfDay } = context;
  if (timeOfDay.status === "gap") {
    group.note(`Time of day unavailable: ${timeOfDay.reason}. ${timeOfDay.detail}`, { testId: "time-of-day-status", tone: "warning",
      hint: "The world runs no day/night clock until the environment export with time tables is staged.",
      variables: () => [{ name: "env.status", value: () => timeOfDay.reason, values: "running | gap reason", source: `loadNativeTimeTables. ${dayNightReport}`, status: "unverified" }] });
    return;
  }
  const variables = () => timeOfDayVariables(timeOfDay, context);
  group.note("DB-4 time of day from the staged Env.int and timeenv tables. Only the sky, haze and cloud colours reach the screen.", {
    testId: "time-of-day-status", tone: "info", variables,
    hint: "Ambient, HSV lights, sun and moon, terrain and the dynamic-light gate stay inspection only (environment-lighting-composition-unresolved)." });
  attachTimeOfDayControls(group, timeOfDay, context, variables);
}
