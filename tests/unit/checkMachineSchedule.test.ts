import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MACHINE_WINDOWS, findActiveMachineWindow, formatRigaTimestamp, rigaWallClock } from "../../scripts/check-machine-schedule.mjs";
import { refuseTestRunInsideMachineWindow } from "../browser/support/machineScheduleConfigGuard";

const machineScheduleScriptPath = "scripts/check-machine-schedule.mjs";

function runMachineScheduleCommand(argumentList: readonly string[]) {
  const completed = spawnSync(process.execPath, [machineScheduleScriptPath, ...argumentList], { encoding: "utf8" });
  return { status: completed.status, stdout: completed.stdout, stderr: completed.stderr };
}

function activeWindowAt(hostName: string, isoInstant: string) {
  return findActiveMachineWindow(hostName, new Date(isoInstant));
}

describe("machine windows", () => {
  it("holds only the PROMINENCE-PC nightly backup window", () => {
    expect(MACHINE_WINDOWS).toEqual([
      { host: "PROMINENCE-PC", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], start: "23:15", end: "03:45", reason: "nightly backup" },
    ]);
  });

  it("starts inclusive and ends exclusive across midnight", () => {
    expect(activeWindowAt("PROMINENCE-PC", "2026-11-10T21:15:00Z")?.reason).toBe("nightly backup");
    expect(activeWindowAt("PROMINENCE-PC", "2026-11-10T21:14:00Z")).toBeNull();
    expect(activeWindowAt("PROMINENCE-PC", "2026-11-11T01:44:00Z")?.reason).toBe("nightly backup");
    expect(activeWindowAt("PROMINENCE-PC", "2026-11-11T01:45:00Z")).toBeNull();
  });

  it("follows the Riga offset through the daylight saving change and in summer", () => {
    expect(activeWindowAt("PROMINENCE-PC", "2026-03-29T00:59:00Z")?.reason).toBe("nightly backup");
    expect(activeWindowAt("PROMINENCE-PC", "2026-03-29T01:00:00Z")).toBeNull();
    expect(activeWindowAt("PROMINENCE-PC", "2026-07-01T20:15:00Z")?.reason).toBe("nightly backup");
    expect(activeWindowAt("PROMINENCE-PC", "2026-07-01T20:14:00Z")).toBeNull();
  });

  it("gives DATABASE-PC and unknown hosts no window and matches host names without case", () => {
    expect(activeWindowAt("DATABASE-PC", "2026-11-08T08:00:00Z")).toBeNull();
    expect(activeWindowAt("DATABASE-PC", "2026-11-12T17:00:00Z")).toBeNull();
    expect(activeWindowAt("IMPORTA-PC", "2026-11-10T21:15:00Z")).toBeNull();
    expect(activeWindowAt("prominence-pc", "2026-11-10T21:15:00Z")?.host).toBe("PROMINENCE-PC");
  });
});

describe("Riga wall clock", () => {
  it("formats Riga timestamps with the winter and summer offsets", () => {
    expect(formatRigaTimestamp(new Date("2026-11-08T08:05:00Z"))).toBe("2026-11-08T10:05:00+02:00");
    expect(formatRigaTimestamp(new Date("2026-07-05T08:05:00Z"))).toBe("2026-07-05T11:05:00+03:00");
  });

  it("reads the Riga weekday and minute of day", () => {
    expect(rigaWallClock(new Date("2026-11-08T22:30:00Z"))).toEqual({
      weekday: "Mon", minuteOfDay: 30, isoDate: "2026-11-09", isoTime: "00:30:00", offset: "+02:00",
    });
  });

  it("refuses an invalid instant", () => {
    expect(() => formatRigaTimestamp(new Date("not-a-date"))).toThrow("instant must be a valid Date");
  });
});

describe("machine schedule command line", () => {
  it("exits 2 inside a window with the window on stdout and stderr", () => {
    const result = runMachineScheduleCommand(["--host", "PROMINENCE-PC", "--at", "2026-11-10T21:15:00Z"]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({
      host: "PROMINENCE-PC",
      rigaTime: "2026-11-10T23:15:00+02:00",
      activeWindow: { host: "PROMINENCE-PC", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], start: "23:15", end: "03:45", reason: "nightly backup" },
    });
    expect(result.stderr).toContain("inside nightly backup window");
    expect(result.stderr).toContain("2026-11-10T23:15:00+02:00");
  });

  it("exits 0 outside a window", () => {
    const prominenceNoon = runMachineScheduleCommand(["--host", "PROMINENCE-PC", "--at", "2026-11-10T12:00:00Z"]);
    expect(prominenceNoon.status).toBe(0);
    expect(JSON.parse(prominenceNoon.stdout).activeWindow).toBeNull();
    const databaseSunday = runMachineScheduleCommand(["--host", "DATABASE-PC", "--at", "2026-11-08T08:00:00Z"]);
    expect(databaseSunday.status).toBe(0);
    expect(JSON.parse(databaseSunday.stdout)).toEqual({ host: "DATABASE-PC", rigaTime: "2026-11-08T10:00:00+02:00", activeWindow: null });
  });

  it("exits 1 on an unparsable instant or an unknown option", () => {
    const unparsable = runMachineScheduleCommand(["--at", "not-a-date"]);
    expect(unparsable.status).toBe(1);
    expect(unparsable.stderr).toContain("instant must be a valid Date");
    const unknownOption = runMachineScheduleCommand(["--window", "x"]);
    expect(unknownOption.status).toBe(1);
    expect(unknownOption.stderr).toContain("unknown option --window");
  });
});

describe("Playwright config guard", () => {
  it("refuses a run inside a machine window with the window and Riga time", () => {
    expect(() => refuseTestRunInsideMachineWindow("PROMINENCE-PC", new Date("2026-11-10T21:30:00Z"))).toThrow(
      "Playwright run refused: inside nightly backup window Mon,Tue,Wed,Thu,Fri,Sat,Sun 23:15-03:45 Riga (now 2026-11-10T23:30:00+02:00)",
    );
  });

  it("returns outside a machine window", () => {
    expect(refuseTestRunInsideMachineWindow("PROMINENCE-PC", new Date("2026-11-10T12:00:00Z"))).toBeUndefined();
    expect(refuseTestRunInsideMachineWindow("DATABASE-PC", new Date("2026-11-08T08:00:00Z"))).toBeUndefined();
  });
});
