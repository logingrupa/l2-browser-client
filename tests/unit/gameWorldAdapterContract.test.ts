import { describe, expect, expectTypeOf, it } from "vitest";
import type { GameWorldAdapter } from "../../src/world/GameWorldAdapter";
import { MockWorldAdapter } from "../../src/world/MockWorldAdapter";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldCommand, WorldEntity, WorldEvent } from "../../src/world/worldTypes";

const adapterFactories: ReadonlyArray<readonly [string, () => GameWorldAdapter]> = [
  ["MockWorldAdapter", () => new MockWorldAdapter()],
  ["NativeSliceAdapter", () => new NativeSliceAdapter({ x: 0, y: 0, z: 0 })],
];

describe("GameWorldAdapter contract", () => {
  it("keeps exactly the five frozen methods with their signatures", () => {
    expectTypeOf<keyof GameWorldAdapter>().toEqualTypeOf<"getInitialState" | "subscribe" | "dispatch" | "advance" | "dispose">();
    expectTypeOf<GameWorldAdapter["getInitialState"]>().toEqualTypeOf<() => readonly WorldEntity[]>();
    expectTypeOf<GameWorldAdapter["subscribe"]>().toEqualTypeOf<(listener: (event: WorldEvent) => void) => () => void>();
    expectTypeOf<GameWorldAdapter["dispatch"]>().toEqualTypeOf<(command: WorldCommand) => void>();
    expectTypeOf<GameWorldAdapter["advance"]>().toEqualTypeOf<(deltaTimeSeconds: number) => void>();
    expectTypeOf<GameWorldAdapter["dispose"]>().toEqualTypeOf<() => void>();
  });

  it.each(adapterFactories)("%s answers all five methods at runtime", (_name, createAdapter) => {
    const adapter = createAdapter();
    const initialState = adapter.getInitialState();
    expect(initialState.some(entity => entity.id === "local-player")).toBe(true);
    const receivedEvents: WorldEvent[] = [];
    const unsubscribe = adapter.subscribe(event => receivedEvents.push(event));
    expect(typeof unsubscribe).toBe("function");
    adapter.dispatch({ type: "spawn-npc", npcId: 1 });
    expect(receivedEvents).toHaveLength(1);
    unsubscribe();
    adapter.dispatch({ type: "spawn-npc", npcId: 2 });
    expect(receivedEvents).toHaveLength(1);
    expect(() => adapter.advance(0)).not.toThrow();
    const eventsAfterDispose: WorldEvent[] = [];
    adapter.subscribe(event => eventsAfterDispose.push(event));
    adapter.dispose();
    adapter.dispatch({ type: "spawn-npc", npcId: 3 });
    expect(eventsAfterDispose).toEqual([]);
  });
});
