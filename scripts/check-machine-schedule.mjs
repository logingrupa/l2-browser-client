import { hostname } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rigaTimeZone = "Europe/Riga";
const rigaWeekdays = Object.freeze(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
const hourMinutePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesPerHour = 60;
const exitCodeOutsideWindow = 0;
const exitCodeOnError = 1;
const exitCodeInsideWindow = 2;

export const MACHINE_WINDOWS = Object.freeze([
  Object.freeze({ host: "PROMINENCE-PC", days: rigaWeekdays, start: "23:15", end: "03:45", reason: "nightly backup" }),
]);

const rigaWallClockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: rigaTimeZone,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "longOffset",
});

function requireValidInstant(instant) {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) throw new Error(`instant must be a valid Date: ${String(instant)}`);
  return instant;
}

function minuteOfDayFromHourMinute(hourMinute) {
  const match = hourMinutePattern.exec(hourMinute);
  if (match === null) throw new Error(`machine window time must be HH:MM: ${hourMinute}`);
  return Number(match[1]) * minutesPerHour + Number(match[2]);
}

function utcOffsetFromTimeZoneName(timeZoneName) {
  return timeZoneName === "GMT" ? "+00:00" : timeZoneName.replace(/^GMT/, "");
}

export function rigaWallClock(instant) {
  const parts = Object.fromEntries(rigaWallClockFormat.formatToParts(requireValidInstant(instant)).map((part) => [part.type, part.value]));
  if (!rigaWeekdays.includes(parts.weekday)) throw new Error(`unexpected Riga weekday: ${parts.weekday}`);
  return {
    weekday: parts.weekday,
    minuteOfDay: Number(parts.hour) * minutesPerHour + Number(parts.minute),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    isoTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    offset: utcOffsetFromTimeZoneName(parts.timeZoneName),
  };
}

function previousRigaWeekday(weekday) {
  return rigaWeekdays[(rigaWeekdays.indexOf(weekday) + rigaWeekdays.length - 1) % rigaWeekdays.length];
}

function isMachineWindowActive(machineWindow, wallClock) {
  const startMinute = minuteOfDayFromHourMinute(machineWindow.start);
  const endMinute = minuteOfDayFromHourMinute(machineWindow.end);
  const minute = wallClock.minuteOfDay;
  if (startMinute <= endMinute) return machineWindow.days.includes(wallClock.weekday) && minute >= startMinute && minute < endMinute;
  return (machineWindow.days.includes(wallClock.weekday) && minute >= startMinute)
    || (machineWindow.days.includes(previousRigaWeekday(wallClock.weekday)) && minute < endMinute);
}

export function findActiveMachineWindow(hostName, instant) {
  const host = hostName.toUpperCase();
  const wallClock = rigaWallClock(instant);
  return MACHINE_WINDOWS.find((machineWindow) => machineWindow.host === host && isMachineWindowActive(machineWindow, wallClock)) ?? null;
}

export function formatRigaTimestamp(instant) {
  const wallClock = rigaWallClock(instant);
  return `${wallClock.isoDate}T${wallClock.isoTime}${wallClock.offset}`;
}

export function describeActiveMachineWindow(machineWindow, rigaTime) {
  return `inside ${machineWindow.reason} window ${machineWindow.days.join(",")} ${machineWindow.start}-${machineWindow.end} Riga (now ${rigaTime})`;
}

function readCommandLineOptions(argumentList) {
  const options = { hostName: hostname(), instant: new Date() };
  for (let index = 0; index < argumentList.length; index += 2) {
    const optionName = argumentList[index];
    const optionValue = argumentList[index + 1];
    if (optionName !== "--host" && optionName !== "--at") throw new Error(`unknown option ${optionName}; use --host <name> and --at <ISO instant>`);
    if (optionValue === undefined || optionValue === "") throw new Error(`${optionName} needs a value`);
    if (optionName === "--host") options.hostName = optionValue;
    else options.instant = requireValidInstant(new Date(optionValue));
  }
  return options;
}

function runMachineScheduleCheck() {
  const { hostName, instant } = readCommandLineOptions(process.argv.slice(2));
  const host = hostName.toUpperCase();
  const rigaTime = formatRigaTimestamp(instant);
  const activeWindow = findActiveMachineWindow(host, instant);
  console.log(JSON.stringify({ host, rigaTime, activeWindow }));
  if (activeWindow === null) return exitCodeOutsideWindow;
  console.error(`${describeActiveMachineWindow(activeWindow, rigaTime)}; stop and resume later`);
  return exitCodeInsideWindow;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runMachineScheduleCheck();
  } catch (error) {
    console.error(error.message);
    process.exitCode = exitCodeOnError;
  }
}
