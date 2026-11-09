import { describe, expect, it } from "vitest";
import { ActorClipEventsError, parseActorClipEvents } from "../../src/assets/native/actorClipEvents";

function sourceEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { animationSet: "Fixture.FixtureAnimations", clip: "Fixture_Clip", timeSeconds: .5, normalizedTime: .25, type: "FixtureNotifyClass",
    object: "Fixture.FixtureNotify", properties: { Sound: "Fixture.Sound", Volume: [1, null] }, sound: "Fixture.Sound", function: "None",
    sourceFrames: 60, sourceRate: 30, timingBasis: "synthetic fixture timing basis", ...overrides };
}

function parsingFailure(events: unknown): ActorClipEventsError {
  try { parseActorClipEvents(events as readonly unknown[]); } catch (error) {
    if (error instanceof ActorClipEventsError) return error;
    throw error;
  }
  throw new Error("parseActorClipEvents accepted invalid events.");
}

describe("actor clip events parsed from asset.json", () => {
  it("copies every source field verbatim with the manifest ordinal", () => {
    const source = sourceEvent();
    const [event] = parseActorClipEvents([source]);
    expect(event).toEqual({ ordinal: 0, animationSet: "Fixture.FixtureAnimations", clip: "Fixture_Clip", normalizedTime: .25, timeSeconds: .5,
      type: "FixtureNotifyClass", notifyObject: "Fixture.FixtureNotify", notifyFunction: "None", sound: "Fixture.Sound",
      properties: { Sound: "Fixture.Sound", Volume: [1, null] }, sourceFrames: 60, sourceRate: 30, timingBasis: "synthetic fixture timing basis" });
  });

  it("keeps the source timeSeconds instead of recomputing it from the normalized time", () => {
    const [event] = parseActorClipEvents([sourceEvent({ normalizedTime: .5, timeSeconds: 1.7 })]);
    expect(event?.timeSeconds).toBe(1.7);
  });

  it("copies properties so later changes to the source object do not reach the parsed event", () => {
    const properties = { Volume: [1] }, [event] = parseActorClipEvents([sourceEvent({ properties })]);
    properties.Volume.push(2);
    expect(event?.properties).toEqual({ Volume: [1] });
  });

  it("returns an empty list when the asset has no animationEvents", () => {
    expect(parseActorClipEvents(undefined)).toEqual([]);
    expect(parseActorClipEvents([])).toEqual([]);
  });

  it("keeps an unresolved notify type visibly unresolved", () => {
    const [event] = parseActorClipEvents([sourceEvent({ type: "unresolved-native-notify", sound: null, properties: {} })]);
    expect(event?.type).toBe("unresolved-native-notify");
    expect(event?.sound).toBeNull();
  });

  it("keeps events at normalized time 0 and exactly 1", () => {
    const events = parseActorClipEvents([sourceEvent({ normalizedTime: 0, timeSeconds: 0 }), sourceEvent({ normalizedTime: 1, timeSeconds: 2 })]);
    expect(events.map(event => [event.ordinal, event.normalizedTime, event.timeSeconds])).toEqual([[0, 0, 0], [1, 1, 2]]);
  });

  it("refuses a list that is not an array", () => {
    const failure = parsingFailure({ length: 1 });
    expect(failure.ordinal).toBeNull();
    expect(failure.field).toBe("animationEvents");
  });

  it("refuses an event that is not an object", () => {
    for (const event of [null, "event", 3, [sourceEvent()]]) {
      const failure = parsingFailure([sourceEvent(), event]);
      expect([failure.ordinal, failure.field]).toEqual([1, "event"]);
    }
  });

  it.each([
    ["clip", undefined], ["clip", 4], ["animationSet", undefined], ["animationSet", null], ["type", undefined], ["type", 1],
    ["timingBasis", undefined], ["timingBasis", false], ["object", undefined], ["function", 0],
    ["normalizedTime", -0.01], ["normalizedTime", 1.01], ["normalizedTime", Number.NaN], ["normalizedTime", "0.5"],
    ["timeSeconds", -1], ["timeSeconds", Number.POSITIVE_INFINITY], ["timeSeconds", undefined],
    ["sourceFrames", 0], ["sourceFrames", -3], ["sourceFrames", Number.POSITIVE_INFINITY], ["sourceFrames", "60"],
    ["sourceRate", 0], ["sourceRate", Number.NaN], ["sourceRate", undefined],
    ["sound", 3], ["sound", undefined], ["properties", null], ["properties", []], ["properties", "Sound"],
  ])("names the ordinal and the field when %s is %s", (field, value) => {
    const failure = parsingFailure([sourceEvent(), sourceEvent(), sourceEvent({ [field]: value })]);
    expect([failure.ordinal, failure.field]).toEqual([2, field]);
    expect(failure.message).toContain(`animationEvents[2].${field}`);
  });

  it("keeps the notify function as data and never runs it", () => {
    const marker = "actorClipEventFunctionWasExecuted";
    const [event] = parseActorClipEvents([sourceEvent({ function: `globalThis.${marker} = true` })]);
    expect(event?.notifyFunction).toBe(`globalThis.${marker} = true`);
    expect(marker in globalThis).toBe(false);
  });
});
