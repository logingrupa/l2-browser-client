import { describe, expectTypeOf, it } from "vitest";
import type { AccountSession, AccountSessionState } from "../../src/world/AccountSession";
import type { GameWorldAdapter } from "../../src/world/GameWorldAdapter";
import type { SourcePosition } from "../../src/world/sourceFrame";
import type { WorldCommand, WorldEntity, WorldEvent, WorldPosition } from "../../src/world/worldTypes";

type EventOfType<EventType extends WorldEvent["type"]> = Extract<WorldEvent, { readonly type: EventType }>;
type CommandOfType<CommandType extends WorldCommand["type"]> = Extract<WorldCommand, { readonly type: CommandType }>;
type AccountSessionStateOfStage<Stage extends AccountSessionState["stage"]> = Extract<AccountSessionState, { readonly stage: Stage }>;

describe("world record types", () => {
  it("shapes the command-rejected and environment events", () => {
    expectTypeOf<EventOfType<"command-rejected">>()
      .toEqualTypeOf<{ readonly type: "command-rejected"; readonly commandType: WorldCommand["type"]; readonly reason: string }>();
    expectTypeOf<EventOfType<"environment">>()
      .toEqualTypeOf<{ readonly type: "environment"; readonly gameMinutes: number; readonly environmentType: number }>();
  });

  it("shapes the movement events in source units", () => {
    expectTypeOf<EventOfType<"move">>().toEqualTypeOf<{
      readonly type: "move";
      readonly entityId: string;
      readonly origin: SourcePosition;
      readonly destination: SourcePosition;
      readonly targetId?: string;
      readonly offset?: number;
      readonly moveType: number;
      readonly speeds: Readonly<Record<string, number>>;
      readonly collision: { readonly radius: number; readonly height: number };
    }>();
    expectTypeOf<EventOfType<"stop">>()
      .toEqualTypeOf<{ readonly type: "stop"; readonly entityId: string; readonly position: SourcePosition; readonly heading: number }>();
    expectTypeOf<EventOfType<"correct">>()
      .toEqualTypeOf<{ readonly type: "correct"; readonly entityId: string; readonly position: SourcePosition; readonly heading: number }>();
    expectTypeOf<EventOfType<"teleport">>()
      .toEqualTypeOf<{ readonly type: "teleport"; readonly entityId: string; readonly position: SourcePosition }>();
  });

  it("shapes the report-position and cannot-move intents in source units and gives move-local a metre origin", () => {
    expectTypeOf<CommandOfType<"report-position">>()
      .toEqualTypeOf<{ readonly type: "report-position"; readonly position: SourcePosition; readonly heading: number }>();
    expectTypeOf<CommandOfType<"cannot-move">>()
      .toEqualTypeOf<{ readonly type: "cannot-move"; readonly position: SourcePosition; readonly heading: number }>();
    expectTypeOf<CommandOfType<"move-local">>()
      .toEqualTypeOf<{ readonly type: "move-local"; readonly position: WorldPosition; readonly origin?: WorldPosition }>();
  });

  it("names npc as an entity kind", () => {
    expectTypeOf<WorldEntity["kind"]>().toEqualTypeOf<"local-player" | "remote-player" | "monster" | "npc">();
  });

  it("closes the pre-world account session states and yields the adapter only in the world", () => {
    expectTypeOf<AccountSessionState["stage"]>().toEqualTypeOf<"login" | "server-list" | "character-selection" | "in-world">();
    expectTypeOf<keyof AccountSessionStateOfStage<"login">>().toEqualTypeOf<"stage">();
    expectTypeOf<keyof AccountSessionStateOfStage<"server-list">>().toEqualTypeOf<"stage">();
    expectTypeOf<keyof AccountSessionStateOfStage<"character-selection">>().toEqualTypeOf<"stage">();
    expectTypeOf<AccountSessionStateOfStage<"in-world">>()
      .toEqualTypeOf<{ readonly stage: "in-world"; readonly world: GameWorldAdapter }>();
    expectTypeOf<AccountSessionState>().not.toMatchTypeOf<{ readonly entity: WorldEntity }>();
    expectTypeOf<AccountSessionState>().not.toMatchTypeOf<{ readonly event: WorldEvent }>();
    expectTypeOf<AccountSessionState>().not.toMatchTypeOf<{ readonly health: number }>();
    expectTypeOf<AccountSession["state"]>().toEqualTypeOf<() => AccountSessionState>();
    expectTypeOf<AccountSession["subscribe"]>().toEqualTypeOf<(listener: (state: AccountSessionState) => void) => () => void>();
  });
});
