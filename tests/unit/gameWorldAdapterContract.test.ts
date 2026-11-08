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

  it("enumerates the full sandbox command set and the spawn-character and play-clip shapes", () => {
    expectTypeOf<WorldCommand["type"]>().toEqualTypeOf<
      | "set-animation" | "preview-action" | "set-locomotion" | "move-local" | "teleport-local" | "spawn" | "spawn-npc"
      | "despawn" | "set-paused" | "equip-item" | "cast-skill" | "set-health" | "spawn-character" | "play-clip"
    >();
    expectTypeOf<Extract<WorldCommand, { readonly type: "spawn-character" }>>()
      .toEqualTypeOf<{ readonly type: "spawn-character"; readonly characterTemplateIndex: number }>();
    expectTypeOf<Extract<WorldCommand, { readonly type: "play-clip" }>>()
      .toEqualTypeOf<{ readonly type: "play-clip"; readonly entityId: string; readonly clipName: string }>();
  });

  it.each(adapterFactories)("%s refuses a command type it does not know with a RangeError naming the type", (_name, createAdapter) => {
    const adapter = createAdapter();
    const unknownCommand = { type: "no-such-command" } as unknown as WorldCommand;
    expect(() => adapter.dispatch(unknownCommand)).toThrow(RangeError);
    expect(() => adapter.dispatch(unknownCommand)).toThrow(/no-such-command/);
    adapter.dispose();
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
