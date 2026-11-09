import { describe, expect, it } from "vitest";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldEvent } from "../../src/world/worldTypes";

function recordEvents(adapter: NativeSliceAdapter): WorldEvent[] {
  const receivedEvents: WorldEvent[] = [];
  adapter.subscribe(event => receivedEvents.push(event));
  return receivedEvents;
}

describe("body-part equipment slots through NativeSliceAdapter dispatch", () => {
  it("equips and unequips an item in a body-part slot with one update each", () => {
    const adapter = new NativeSliceAdapter({ x: 0, y: 0, z: 0 });
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "equip-item", slot: "body-part:7", itemId: 1 });
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({ type: "update", entity: { id: "local-player" } });
    expect(receivedEvents[0]?.type === "update" && receivedEvents[0].entity.equipment).toEqual({ "body-part:7": 1 });
    adapter.dispatch({ type: "equip-item", slot: "body-part:7", itemId: null });
    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[1]?.type === "update" && receivedEvents[1].entity.equipment).toEqual({});
    adapter.dispose();
  });
});
