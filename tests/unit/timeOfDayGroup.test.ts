import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DevSheet } from "../../src/ui/devSheet/DevSheet";
import { attachTimeOfDayGroup, timeOfDayVariables, type TimeOfDayGroupContext } from "../../src/runtime/attachTimeOfDayGroup";
import type { SkyEnvironmentColourInspection } from "../../src/scene/world/skyEnvironmentColours";
import type { RunningWorldTimeOfDay, WorldTimeOfDay } from "../../src/scene/world/worldTimeOfDay";
import type { WorldCommand } from "../../src/world/worldTypes";
import { readDayNightFixtureRows } from "../support/dayNightFixtures";
import { provideDayNightTimeOfDay, shippedEnvironmentSetup, shippedSkyBindings } from "../support/worldTimeOfDayFixture";
import { fire, installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";
import { createSandboxSection } from "./support/sandboxCommandSheetFakes";

const requiredVariableNames = [
  "env.hour", "env.hourSource", "env.timeRatio", "env.isClock", "env.frozen", "env.dayPart", "env.oldType", "env.targetType", "env.persistentType",
  "env.weight", "env.start", "env.peak", "env.end", "env.timeout", "env.lightingDirty",
  "env.sky.SkybackgroundColor", "env.sky.HazeRing_Final", "env.sky.Cloud_Final", "env.sky.StarField_Final01", "env.sky.StarField_Final02",
  "sun.theta", "moon.theta", "moonScale",
];

let dom: MiniDom;
const sheets: DevSheet[] = [];
const scenes: Scene[] = [];

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => {
  for (const sheet of sheets.splice(0)) sheet.dispose();
  for (const scene of scenes.splice(0)) { const engine = scene.getEngine(); scene.dispose(); engine.dispose(); }
  dom.restore();
});

function newScene(): Scene {
  const scene = new Scene(new NullEngine());
  scenes.push(scene);
  return scene;
}

function stoppedTimeOfDay(): RunningWorldTimeOfDay {
  return provideDayNightTimeOfDay(newScene(), () => 0, { ...shippedEnvironmentSetup, isClock: false });
}

function fixtureColour(consumer: string, hour: number): readonly number[] {
  const row = readDayNightFixtureRows().find(candidate => candidate.consumer === consumer && candidate.hour === hour && candidate.environmentType === 0);
  if (row === undefined || !Array.isArray(row.value)) throw new Error(`No type 0 ${consumer} fixture at hour ${hour}.`);
  return row.value;
}

function attachGroup(timeOfDay: WorldTimeOfDay, overrides: Partial<TimeOfDayGroupContext> = {}) {
  const { sheet, section } = createSandboxSection(dom);
  sheets.push(sheet);
  const dispatched: WorldCommand[] = [];
  const context: TimeOfDayGroupContext = { timeOfDay, adapter: { dispatch: vi.fn((command: WorldCommand) => { dispatched.push(command); }) },
    skyEnvironmentColours: null, skyAbsentReason: "sky-not-staged", ...overrides };
  attachTimeOfDayGroup(section, context);
  const panel = section.element as unknown as FakeElement;
  const byTestId = (testId: string) => panel.querySelector(`[data-testid="${testId}"]`);
  const submit = (testId: string, values: Record<string, string>) => {
    const form = byTestId(testId)!;
    for (const [name, value] of Object.entries(values)) byTestId(`${testId}-${name}`)!.value = value;
    fire(form, "submit");
  };
  return { context, dispatched, panel, byTestId, submit };
}

function variable(timeOfDay: RunningWorldTimeOfDay, context: TimeOfDayGroupContext, name: string) {
  const found = timeOfDayVariables(timeOfDay, context).find(entry => entry.name === name);
  if (found === undefined) throw new Error(`No variable ${name}.`);
  return { value: found.value(), status: found.status, source: found.source ?? "" };
}

describe("time of day developer sheet group", () => {
  it("shows a visible gap and no controls when the time tables are not staged", () => {
    const { byTestId, panel } = attachGroup({ status: "gap", reason: "environment-time-tables-unstaged", detail: "/l2/environments/e10827c4 is an older export." });
    expect(byTestId("time-of-day-status")!.textContent).toBe("Time of day unavailable: environment-time-tables-unstaged. /l2/environments/e10827c4 is an older export.");
    expect(byTestId("time-of-day-status")!.dataset.tone).toBe("warning");
    for (const control of ["time-of-day-clock", "time-of-day-server-time", "time-of-day-ssq-type", "time-of-day-ssq-info", "time-of-day-red-sky"]) {
      expect(byTestId(control)).toBeNull();
    }
    expect(panel.querySelector('[data-group="time-of-day"]')).not.toBeNull();
  });

  it("lists every env, sun and moon variable with a source and a status", () => {
    const timeOfDay = stoppedTimeOfDay();
    const { context } = attachGroup(timeOfDay);
    const variables = timeOfDayVariables(timeOfDay, context);
    expect(variables.map(entry => entry.name)).toEqual(requiredVariableNames);
    for (const entry of variables) expect(entry.source).toMatch(/DB-4 day-night-cycle\.json fe5de165/);
    expect(variable(timeOfDay, context, "env.hour")).toMatchObject({ value: "12", status: "native" });
    expect(variable(timeOfDay, context, "env.hourSource")).toMatchObject({ value: "start-time", status: "native" });
    expect(variable(timeOfDay, context, "env.timeRatio")).toMatchObject({ value: "6", status: "native" });
    expect(variable(timeOfDay, context, "env.isClock")).toMatchObject({ value: "0", status: "native" });
    expect(variable(timeOfDay, context, "env.lightingDirty").value).toBe("false");
    expect(variable(timeOfDay, context, "env.frozen")).toMatchObject({ value: "0 (freeze-producer-unresolved)", status: "unverified" });
    expect(variable(timeOfDay, context, "env.dayPart").value).toBe("0");
    expect(variable(timeOfDay, context, "env.targetType").value).toBe("EnvType 0");
    expect(variable(timeOfDay, context, "moonScale")).toMatchObject({ value: "time-scale-read-past-table", status: "unverified" });
  });

  it("follows the manager after a server time and shows the sun and moon angles of that hour", () => {
    const scene = newScene();
    const timeOfDay = provideDayNightTimeOfDay(scene, () => 0);
    const { context } = attachGroup(timeOfDay);
    timeOfDay.manager.receiveServerTime(0);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(variable(timeOfDay, context, "env.hour").value).toBe("0");
    expect(variable(timeOfDay, context, "env.hourSource").value).toBe("server-time");
    expect(variable(timeOfDay, context, "env.dayPart").value).toBe("3");
    expect(variable(timeOfDay, context, "sun.theta").value).toBe(String(Math.fround((0 + 24 - 6) * Math.PI / 18 - Math.PI / 2)));
    expect(variable(timeOfDay, context, "moon.theta").value).toBe(String(Math.fround(-Math.PI / 2)));
  });

  it("reports an unwritten sky colour with the reason and the model colour, and a written one as native", () => {
    const timeOfDay = stoppedTimeOfDay();
    const unstaged = attachGroup(timeOfDay);
    expect(variable(timeOfDay, unstaged.context, "env.sky.SkybackgroundColor"))
      .toMatchObject({ value: `not written (sky-not-staged); model ${fixtureColour("SkyBoxColor", 12).join(", ")}`, status: "unverified" });
    const writtenSky: SkyEnvironmentColourInspection[] = shippedSkyBindings.map((binding, index) => ({ ...binding,
      materialNode: index === 0 ? `SkyBox.${binding.objectName}` : null, writtenRgb: index === 0 ? [66, 124, 176] : null,
      materialColourSource: index === 0 ? "environment-write" : "authored-colour", reason: index === 0 ? null : "sky-environment-material-absent" }));
    const staged = attachGroup(timeOfDay, { skyEnvironmentColours: () => writtenSky });
    expect(variable(timeOfDay, staged.context, "env.sky.SkybackgroundColor")).toMatchObject({ value: "66, 124, 176", status: "native" });
    expect(variable(timeOfDay, staged.context, "env.sky.HazeRing_Final"))
      .toMatchObject({ value: `not written (sky-environment-material-absent); model ${fixtureColour("HazeringColor", 12).join(", ")}`, status: "unverified" });
  });

  it("names a pending transition before the first write as the unresolved GetEnvColor branch", () => {
    const timeOfDay = stoppedTimeOfDay();
    const boundBeforeFirstWrite: SkyEnvironmentColourInspection[] = shippedSkyBindings.map(binding => ({ ...binding,
      materialNode: `SkyBox.${binding.objectName}`, writtenRgb: null, materialColourSource: "authored-colour", reason: null }));
    const { context } = attachGroup(timeOfDay, { skyEnvironmentColours: () => boundBeforeFirstWrite });
    timeOfDay.manager.receiveRedSky(30);
    expect(variable(timeOfDay, context, "env.sky.Cloud_Final")).toMatchObject({
      value: "not written (env-color-transition-unresolved); authored colour shown (authored-sky-channel-order-unresolved)", status: "unverified" });
    expect(variable(timeOfDay, context, "env.targetType").value).toBe("EnvType 3");
    expect(variable(timeOfDay, context, "env.timeout").value).toBe("30");
  });

  it("shows a colour held through an unresolved frame as unverified with the reason", () => {
    const timeOfDay = stoppedTimeOfDay();
    const heldSky: SkyEnvironmentColourInspection[] = shippedSkyBindings.map(binding => ({ ...binding, materialNode: `SkyBox.${binding.objectName}`,
      writtenRgb: [66, 124, 176], materialColourSource: "held-environment-write", reason: "env-color-transition-unresolved" }));
    const { context } = attachGroup(timeOfDay, { skyEnvironmentColours: () => heldSky });
    expect(variable(timeOfDay, context, "env.sky.SkybackgroundColor"))
      .toMatchObject({ value: "66, 124, 176 held from an earlier frame (env-color-transition-unresolved)", status: "unverified" });
  });

  it("sends server time as whole game minutes through the adapter and refuses a clock outside the day", () => {
    const timeOfDay = stoppedTimeOfDay();
    const { dispatched, submit, byTestId } = attachGroup(timeOfDay);
    submit("time-of-day-server-time", { gameClock: "18:30" });
    expect(dispatched).toEqual([{ type: "set-server-time", gameMinutes: 1110 }]);
    submit("time-of-day-server-time", { gameClock: "24:00" });
    expect(dispatched).toHaveLength(1);
    expect(byTestId("time-of-day-server-time-message")!.textContent).toBe("Game time (HH:MM) must be HH:MM from 00:00 to 23:59.");
  });

  it("lists the loaded EnvTypes by number and sends SSQ info with the type and the immediate flag", () => {
    const timeOfDay = stoppedTimeOfDay();
    const { dispatched, byTestId } = attachGroup(timeOfDay);
    const typeSelect = byTestId("time-of-day-ssq-type")!.querySelector("select")!;
    expect(typeSelect.options.map(option => option.textContent)).toEqual(["EnvType 0", "EnvType 1", "EnvType 2", "EnvType 3"]);
    expect(byTestId("time-of-day-ssq-type")!.textContent).not.toMatch(/dusk|dawn/i);
    typeSelect.value = "2"; fire(typeSelect, "change");
    const immediateSelect = byTestId("time-of-day-ssq-immediate")!.querySelector("select")!;
    immediateSelect.value = "1"; fire(immediateSelect, "change");
    byTestId("time-of-day-ssq-info")!.click();
    expect(dispatched).toEqual([{ type: "set-environment-ssq-info", first: 2, second: 1 }]);
  });

  it("sends a red sky with its timeout through the adapter", () => {
    const timeOfDay = stoppedTimeOfDay();
    const { dispatched, submit } = attachGroup(timeOfDay);
    submit("time-of-day-red-sky", { timeoutSeconds: "45" });
    expect(dispatched).toEqual([{ type: "set-environment-red-sky", timeoutSeconds: 45 }]);
  });

  it("reads the game time and the environment type pair in the readout", () => {
    const timeOfDay = stoppedTimeOfDay();
    const { byTestId } = attachGroup(timeOfDay);
    expect(byTestId("time-of-day-clock")!.querySelector("output")!.textContent).toBe("12:00 · EnvType 0 > EnvType 0");
  });
});
