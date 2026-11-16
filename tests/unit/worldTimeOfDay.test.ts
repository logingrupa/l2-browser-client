import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { inspectWorldTimeOfDay, provideWorldTimeOfDay, worldTimeOfDayFor } from "../../src/scene/world/worldTimeOfDay";
import { readDayNightFixtureRows } from "../support/dayNightFixtures";
import { provideDayNightTimeOfDay, shippedEnvironmentSetup } from "../support/worldTimeOfDayFixture";

const scenes: Scene[] = [];
afterEach(() => { for (const scene of scenes.splice(0)) { const engine = scene.getEngine(); scene.dispose(); engine.dispose(); } });

function newScene(): Scene {
  const scene = new Scene(new NullEngine());
  scenes.push(scene);
  return scene;
}

function fixtureColour(consumer: string, hour: number): readonly number[] {
  const row = readDayNightFixtureRows().find(candidate => candidate.consumer === consumer && candidate.hour === hour && candidate.environmentType === 0);
  if (row === undefined || !Array.isArray(row.value)) throw new Error(`No type 0 ${consumer} fixture at hour ${hour}.`);
  return row.value;
}

describe("world time of day", () => {
  it("starts the one manager at the Env.int StartTime and advances it from real seconds on each frame", () => {
    const scene = newScene();
    let realSeconds = 100;
    const timeOfDay = provideDayNightTimeOfDay(scene, () => realSeconds);
    expect(timeOfDay.sample()).toEqual({ hour: 12, hourSource: "start-time", oldType: 0, targetType: 0, weight: 0 });
    realSeconds += 600;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(timeOfDay.sample().hour).toBe(13);
    expect(timeOfDay.sample().weight).toBe(0);
    expect(worldTimeOfDayFor(scene)).toBe(timeOfDay);
    timeOfDay.dispose();
    realSeconds += 600;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(timeOfDay.sample().hour).toBe(13);
  });

  it.each([0, 6, 12, 18])("gives the sky, haze and cloud bindings the DB-4 type 0 colours at server hour %s", hour => {
    const scene = newScene();
    const timeOfDay = provideDayNightTimeOfDay(scene, () => 0, { ...shippedEnvironmentSetup, isClock: false });
    timeOfDay.manager.receiveServerTime(hour * 60);
    expect(timeOfDay.skyEnvironmentColours().map(entry => [entry.objectName, entry.colour])).toEqual([
      ["SkybackgroundColor", { status: "resolved", value: fixtureColour("SkyBoxColor", hour) }],
      ["HazeRing_Final", { status: "resolved", value: fixtureColour("HazeringColor", hour) }],
      ["Cloud_Final", { status: "resolved", value: fixtureColour("CloudColor1", hour) }],
      ["StarField_Final01", { status: "resolved", value: fixtureColour("CloudColor2", hour) }],
      ["StarField_Final02", { status: "resolved", value: fixtureColour("CloudColor3", hour) }],
    ]);
  });

  it("shows a pending environment change as the unresolved transition branch, not a guessed colour", () => {
    const scene = newScene();
    const timeOfDay = provideDayNightTimeOfDay(scene, () => 0);
    timeOfDay.manager.receiveRedSky(30);
    expect(timeOfDay.skyEnvironmentColours().every(entry => entry.colour.status === "unresolved" && entry.colour.reason === "env-color-transition-unresolved"))
      .toBe(true);
    const inspection = inspectWorldTimeOfDay(timeOfDay);
    expect(inspection).toMatchObject({ status: "running", snapshot: { oldType: 0, targetType: 3, frozen: { reason: "freeze-producer-unresolved" } } });
  });

  it.each([0, 6, 12, 18])("inspects the loaded EnvTypes and the DB-4 sun and moon theta and moon scale at server hour %s", hour => {
    const scene = newScene();
    const timeOfDay = provideDayNightTimeOfDay(scene, () => 0, { ...shippedEnvironmentSetup, isClock: false });
    timeOfDay.manager.receiveServerTime(hour * 60);
    const fixtureValue = (consumer: string) => readDayNightFixtureRows().find(row => row.consumer === consumer && row.hour === hour && row.environmentType === 0)!.value;
    const inspection = inspectWorldTimeOfDay(timeOfDay);
    if (inspection.status !== "running") throw new Error("The time of day is not running.");
    expect(inspection.environmentTypes).toEqual([0, 1, 2, 3]);
    expect(inspection.celestial.sunTheta).toBe((fixtureValue("SunAngles") as readonly number[])[0]);
    expect(inspection.celestial.moonTheta).toBe((fixtureValue("MoonAngles") as readonly number[])[0]);
    expect(inspection.celestial.moonScale).toEqual(hour === 0 ? { status: "sampled", value: fixtureValue("MoonScale") }
      : { status: "unresolved", reason: "time-scale-read-past-table" });
  });

  it("reports a scene without a provided time of day as a visible gap and refuses a second provider", () => {
    const scene = newScene();
    expect(worldTimeOfDayFor(scene)).toEqual({ status: "gap", reason: "environment-time-of-day-unprovided", detail: expect.any(String) });
    const gap = { status: "gap", reason: "environment-time-tables-unstaged", detail: "not staged" } as const;
    const withdraw = provideWorldTimeOfDay(scene, gap);
    expect(worldTimeOfDayFor(scene)).toBe(gap);
    expect(inspectWorldTimeOfDay(gap)).toBe(gap);
    expect(() => provideWorldTimeOfDay(scene, gap)).toThrow(/already has a world time of day provider/);
    withdraw();
    expect(worldTimeOfDayFor(scene).status).toBe("gap");
    expect(worldTimeOfDayFor(scene)).not.toBe(gap);
  });
});
