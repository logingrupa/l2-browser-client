import { describe, expect, expectTypeOf, it } from "vitest";
import type { GameWorldAdapter } from "../../src/world/GameWorldAdapter";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldCommand, WorldEntity, WorldEvent } from "../../src/world/worldTypes";

const createNativeSliceAdapter = (): GameWorldAdapter => new NativeSliceAdapter({ x: 0, y: 0, z: 0 });

describe("GameWorldAdapter contract", () => {
  it("keeps exactly the four frozen methods with their signatures", () => {
    expectTypeOf<keyof GameWorldAdapter>().toEqualTypeOf<"getInitialState" | "subscribe" | "dispatch" | "dispose">();
    expectTypeOf<GameWorldAdapter["getInitialState"]>().toEqualTypeOf<() => readonly WorldEntity[]>();
    expectTypeOf<GameWorldAdapter["subscribe"]>().toEqualTypeOf<(listener: (event: WorldEvent) => void) => () => void>();
    expectTypeOf<GameWorldAdapter["dispatch"]>().toEqualTypeOf<(command: WorldCommand) => void>();
    expectTypeOf<GameWorldAdapter["dispose"]>().toEqualTypeOf<() => void>();
  });

  it("enumerates the full sandbox command set and the spawn-character and play-clip shapes", () => {
    expectTypeOf<WorldCommand["type"]>().toEqualTypeOf<
      | "set-animation" | "preview-action" | "set-locomotion" | "move-local" | "spawn-npc"
      | "despawn" | "set-paused" | "equip-item" | "cast-skill" | "set-health" | "spawn-character" | "play-clip"
      | "report-position" | "cannot-move"
    >();
    expectTypeOf<Extract<WorldCommand, { readonly type: "spawn-character" }>>()
      .toEqualTypeOf<{ readonly type: "spawn-character"; readonly characterTemplateIndex: number }>();
    expectTypeOf<Extract<WorldCommand, { readonly type: "play-clip" }>>()
      .toEqualTypeOf<{ readonly type: "play-clip"; readonly entityId: string; readonly clipName: string }>();
  });

  it("enumerates the full event set", () => {
    expectTypeOf<WorldEvent["type"]>().toEqualTypeOf<
      | "spawn" | "update" | "despawn" | "skill-cast"
      | "command-rejected" | "environment" | "move" | "stop" | "correct" | "teleport"
    >();
  });

  it("NativeSliceAdapter refuses a command type it does not know with a RangeError naming the type", () => {
    const adapter = createNativeSliceAdapter();
    const unknownCommand = { type: "no-such-command" } as unknown as WorldCommand;
    expect(() => adapter.dispatch(unknownCommand)).toThrow(RangeError);
    expect(() => adapter.dispatch(unknownCommand)).toThrow(/no-such-command/);
    adapter.dispose();
  });

  it("NativeSliceAdapter answers all four methods at runtime", () => {
    const adapter = createNativeSliceAdapter();
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
    const eventsAfterDispose: WorldEvent[] = [];
    adapter.subscribe(event => eventsAfterDispose.push(event));
    adapter.dispose();
    adapter.dispatch({ type: "spawn-npc", npcId: 3 });
    expect(eventsAfterDispose).toEqual([]);
  });
});
