export type RigaWeekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export interface MachineWindow {
  readonly host: string;
  readonly days: readonly RigaWeekday[];
  readonly start: string;
  readonly end: string;
  readonly reason: string;
}

export interface RigaWallClock {
  weekday: RigaWeekday;
  minuteOfDay: number;
  isoDate: string;
  isoTime: string;
  offset: string;
}

export const MACHINE_WINDOWS: readonly MachineWindow[];
export function rigaWallClock(instant: Date): RigaWallClock;
export function findActiveMachineWindow(hostName: string, instant: Date): MachineWindow | null;
export function formatRigaTimestamp(instant: Date): string;
export function describeActiveMachineWindow(machineWindow: MachineWindow, rigaTime: string): string;
