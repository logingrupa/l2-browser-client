import { baseRuntimeSettings, runtimeBoundaryMocks, useNativeSliceRuntimeHarness } from "../support/nativeSliceRuntimeHarness";
import { describe, expect, it, vi } from "vitest";
import { defaultNativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";

describe("native slice runtime player profiles", () => {
  const harness = useNativeSliceRuntimeHarness();
  const { stops, startRuntime } = harness;

  it("keeps the default player identity and plays its sourced profile clips, never an Editor-saved override", async () => {
    stops.push(await startRuntime(baseRuntimeSettings, new AbortController().signal));
    expect(runtimeBoundaryMocks.load.mock.calls[0]![1]).toBe("human-male-fighter");
    const profiles = runtimeBoundaryMocks.factory.mock.calls[0]![0];
    expect(profiles.get("native-human-fighter").clips).toEqual(defaultNativePlayerProfile.clips);
    expect(profiles.get("native-human-fighter").clips.idle).toBe("Wait_Hand_MFighter");
    expect(runtimeBoundaryMocks.uis[0]!.adapter.getInitialState().find(entity => entity.id === "local-player"))
      .toMatchObject({ appearanceId: "native-human-fighter", displayName: "Human male fighter" });
  });

  it.each(["query", "authored"])("uses the selected female profile through %s without male clip/equipment substitution", async selection => {
    const female = { ...defaultNativePlayerProfile, id: "human-female-fighter", name: "Human female fighter", catalogId: "human-female-fighter:0",
      collisionRadius: 8, collisionHeight: 23.5, clips: { idle: "Wait_Hand_FFighter", run: "Run_Hand_FFighter", attack: "Atk01_Hand_FFighter", death: "Death_FFighter" },
      upperItems: [{ ...defaultNativePlayerProfile.upperItems[0]!, catalogId: "female-fighter-equipment:0" }] };
    const catalog = await runtimeBoundaryMocks.load(); runtimeBoundaryMocks.load.mockClear();
    const body = {}, equipment = {};
    runtimeBoundaryMocks.load.mockResolvedValueOnce({ ...catalog, playerProfile: female,
      playerProfiles: new Map([[defaultNativePlayerProfile.id, defaultNativePlayerProfile], [female.id, female]]),
      models: new Map([[female.catalogId, body], [female.upperItems[0]!.catalogId, equipment], ["musveren:0", catalog.models.get("musveren:0")]]) });
    Object.assign(window, { location: { search: selection === "query" ? "?world=interlude&authored=1&character=human-female-fighter" : "?world=interlude" } });
    stops.push(await startRuntime({ ...baseRuntimeSettings, playerProfileId: selection === "authored" ? female.id : defaultNativePlayerProfile.id }, new AbortController().signal));
    expect(runtimeBoundaryMocks.load.mock.calls[0]![1]).toBe(female.id);
    const profiles = runtimeBoundaryMocks.factory.mock.calls[0]![0], actor = profiles.get(`native-player:${female.id}`);
    expect(actor.clips).toEqual(female.clips); expect(actor.asset).toBe(body); expect(actor.upperItems.get(22)).toBe(equipment);
    expect(profiles.has("native-human-fighter")).toBe(false);
    expect(window.__nativeSlice!.snapshot().playerProfile).toEqual(female);
    expect(runtimeBoundaryMocks.uis[0]!.adapter.getInitialState().find(entity => entity.id === "local-player"))
      .toMatchObject({ appearanceId: `native-player:${female.id}`, displayName: female.name });
  });

  it("starts a mystic without the saved leather shirt it has no part for, walking on its native walk alias", async () => {
    const mystic = { ...defaultNativePlayerProfile, id: "human-male-mystic", name: "Human male mystic", catalogId: "human-male-mystic:0",
      collisionRadius: 7.5, collisionHeight: 22.8, upperItems: [],
      clips: { idle: "Wait_Hand_MMagic", walk: "Walk_Hand_MMagic", run: "Run_Hand_MMagic", attack: "Atk01_Hand_MMagic", death: "Death_MMagic" } };
    const catalog = await runtimeBoundaryMocks.load(); runtimeBoundaryMocks.load.mockClear();
    const body = {};
    runtimeBoundaryMocks.load.mockResolvedValueOnce({ ...catalog, playerProfile: mystic,
      playerProfiles: new Map([[defaultNativePlayerProfile.id, defaultNativePlayerProfile], [mystic.id, mystic]]),
      models: new Map([[mystic.catalogId, body], ["musveren:0", catalog.models.get("musveren:0")]]) });
    Object.assign(window, { location: { search: "?world=interlude&character=human-male-mystic" } });
    const documentCreatingRemovableHudWalkButton = Object.assign(new EventTarget(), { createElement: () => Object.assign(new EventTarget(), { dataset: {}, remove() {} }) });
    vi.stubGlobal("document", documentCreatingRemovableHudWalkButton);
    stops.push(await startRuntime({ ...baseRuntimeSettings, leatherShirt: true }, new AbortController().signal));
    const actor = runtimeBoundaryMocks.factory.mock.calls[0]![0].get(`native-player:${mystic.id}`);
    expect(actor.clips).toMatchObject(mystic.clips); expect(actor.upperItems.size).toBe(0);
    const player = runtimeBoundaryMocks.uis[0]!.adapter.getInitialState().find(entity => entity.id === "local-player")!;
    expect(player.equipment?.upper).toBeUndefined();
    runtimeBoundaryMocks.uis[0]!.adapter.dispatch({ type: "set-locomotion", mode: "walk" });
    expect(runtimeBoundaryMocks.uis[0]!.adapter.getInitialState().find(entity => entity.id === "local-player")!.locomotion).toBe("walk");
  });
});
