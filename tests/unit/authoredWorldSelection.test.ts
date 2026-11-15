import { describe, expect, it } from "vitest";
import { authoredWorldParameter, isAuthoredWorldSelected, selectAuthoredWorld } from "../../src/scene/authoredWorldSelection";

describe("authored world selection", () => {
  it.each([
    ["?authored=1", true],
    ["?map=20_20&authored=1", true],
    ["?authored=0", false],
    ["?authored=true", false],
    ["?map=20_20", false],
    ["", false],
  ])("reads %j as authored %s", (search, authored) => {
    expect(isAuthoredWorldSelected(search)).toBe(authored);
  });

  it("sets and clears only the authored parameter", () => {
    const parameters = new URLSearchParams("map=20_20&character=human-male-fighter");
    selectAuthoredWorld(parameters, true);
    expect(parameters.toString()).toBe("map=20_20&character=human-male-fighter&authored=1");
    selectAuthoredWorld(parameters, false);
    expect(parameters.toString()).toBe("map=20_20&character=human-male-fighter");
    expect(parameters.has(authoredWorldParameter)).toBe(false);
  });
});
