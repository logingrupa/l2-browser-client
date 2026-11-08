import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevSheet, type DevSection } from "../../src/ui/devSheet/DevSheet";
import type { NativeCatalogIndex, NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { powerStrikeEffectBundleId } from "../../src/effects/nativeEffectComponents";
import { attachSandboxCommandSheet } from "../../src/runtime/attachSandboxCommandSheet";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldCommand, WorldEntity, WorldEvent } from "../../src/world/worldTypes";
import { fakeMedia, fire, installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";

const convertedLookups: ReadonlyMap<string, NativeCatalogLookup> = new Map<string, NativeCatalogLookup>([
  ["item:22", { status: "converted", key: "item:22", record: { itemId: 22, slot: "upper", catalogIds: ["fighter-equipment:0"], playerProfileIds: ["human-male-fighter"] } }],
  ["skill:3:1", { status: "converted", key: "skill:3:1", record: { skillId: 3, level: 1, effectComponentId: powerStrikeEffectBundleId } }],
  ["npc:21622", { status: "converted", key: "npc:21622", record: { npcId: 21622, profileId: "native-npc-profiles", modelCatalogId: "musveren:0" } }],
]);

const fakeCatalogIndex: NativeCatalogIndex = {
  lookup: key => convertedLookups.get(key) ?? { status: "not-in-catalog", key,
    reason: key.startsWith("window:") ? "interface windows are not converted yet (UI-01)" : "not in catalog" },
  keys: prefix => [...convertedLookups.keys()].filter(key => key.startsWith(prefix)),
};

let dom: MiniDom;
let sheet: DevSheet;

function sandboxSection(): DevSection {
  const host = dom.document.createElement("section"); host.className = "world-interface";
  const canvas = dom.document.createElement("canvas");
  const toggle = dom.document.createElement("button");
  host.append(toggle); dom.document.body.append(canvas, host);
  host.rect = { left: 0, top: 0, width: 1280, height: 800 };
  sheet = new DevSheet({ host: host as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement,
    toggle: toggle as unknown as HTMLButtonElement, worldTargets: [canvas] as unknown as EventTarget[], storage: null, matchMedia: fakeMedia().matchMedia });
  return sheet.section("sandbox", { title: "Sandbox" });
}

const localPlayer: WorldEntity = { id: "local-player", kind: "local-player", displayName: "Human male fighter", position: { x: 0, y: 0, z: 0 },
  orientationRadians: 0, health: 100, maximumHealth: 100, animation: "idle" };

function acceptedEvent(command: WorldCommand): WorldEvent | null {
  if (command.type === "cast-skill") return { type: "skill-cast", casterId: "local-player", skillId: command.skillId, level: command.level,
    ...(command.targetId === undefined ? {} : { targetId: command.targetId }) };
  if (command.type === "spawn-npc") return { type: "spawn", entity: { ...localPlayer, id: `npc-${command.npcId}-1`, kind: "monster", npcId: command.npcId } };
  if (command.type === "equip-item" && command.itemId !== null) return { type: "update", entity: { ...localPlayer, equipment: { [command.slot]: command.itemId } } };
  return null;
}

function attachWithFakes(selectedEntityId: string | null = "native-musveren", indexFailure: string | null = null, adapterAcceptsCommands = true,
  activePlayerProfileId = "human-male-fighter") {
  const dispatched: WorldCommand[] = [];
  const listeners = new Set<(event: WorldEvent) => void>();
  const adapter = {
    dispatch: vi.fn((command: WorldCommand) => {
      dispatched.push(command);
      const event = adapterAcceptsCommands ? acceptedEvent(command) : null;
      if (event) for (const listener of [...listeners]) listener(event);
    }),
    subscribe: vi.fn((listener: (event: WorldEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
  };
  const powerStrike = { start: vi.fn(async () => {}) };
  const section = sandboxSection();
  const release = attachSandboxCommandSheet({ section, adapter, index: fakeCatalogIndex, indexFailure, appearanceOfModel: () => "native-musveren",
    selectedEntityId: () => selectedEntityId, activePlayerProfileId, powerStrike });
  const panel = section.element as unknown as FakeElement;
  const submit = (testId: string, values: Record<string, string>) => {
    const form = panel.querySelector(`[data-testid="${testId}"]`)!;
    for (const [name, value] of Object.entries(values)) form.querySelector(`[data-testid="${testId}-${name}"]`)!.value = value;
    fire(form, "submit");
  };
  const note = (testId: string) => panel.querySelectorAll(`[data-testid="${testId}-note"]`);
  return { dispatched, listeners, powerStrike, release, submit, note, panel };
}

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => { sheet.dispose(); dom.restore(); });

describe("sandbox catalog index failure", () => {
  it("shows a warning note on the Sandbox tab when the catalog index could not be built", () => {
    const { panel } = attachWithFakes("native-musveren", "Native catalog has duplicate entries for musveren:0.");
    const failureNote = panel.querySelector('[data-testid="sandbox-catalog-index-failure"]')!;
    expect(failureNote.textContent).toBe("Catalog index unavailable: Native catalog has duplicate entries for musveren:0.");
    expect(failureNote.dataset.tone).toBe("warning");
  });

  it("shows no index note when the index was built", () => {
    const { panel } = attachWithFakes();
    expect(panel.querySelector('[data-testid="sandbox-catalog-index-failure"]')).toBeNull();
  });
});

describe("sandbox equip item by ID", () => {
  it("equips converted item 22 in the upper slot and notes it as converted", () => {
    const { dispatched, submit, note } = attachWithFakes();
    submit("sandbox-equip-item", { itemId: "22" });
    expect(dispatched).toEqual([{ type: "equip-item", slot: "upper", itemId: 22 }]);
    expect(note("sandbox-equip-item")).toHaveLength(1);
    expect(note("sandbox-equip-item")[0]!.textContent).toBe("item:22 converted");
    expect(note("sandbox-equip-item")[0]!.dataset.tone).toBe("info");
  });

  it("reports the item the local player already wears as converted, not as rejected", () => {
    const adapter = new NativeSliceAdapter({ x: 0, y: 0, z: 0 }, undefined, 22);
    const section = sandboxSection();
    const release = attachSandboxCommandSheet({ section, adapter, index: fakeCatalogIndex, indexFailure: null, appearanceOfModel: () => "native-musveren",
      selectedEntityId: () => null, activePlayerProfileId: "human-male-fighter", powerStrike: null });
    const panel = section.element as unknown as FakeElement;
    const form = panel.querySelector('[data-testid="sandbox-equip-item"]')!;
    form.querySelector('[data-testid="sandbox-equip-item-itemId"]')!.value = "22";
    fire(form, "submit");
    const equipNotes = panel.querySelectorAll('[data-testid="sandbox-equip-item-note"]');
    expect(equipNotes).toHaveLength(1);
    expect(equipNotes[0]!.textContent).toBe("item:22 converted");
    expect(equipNotes[0]!.dataset.tone).toBe("info");
    release();
    adapter.dispose();
  });

  it("warns that item 22 is converted only for the staged profiles when another character is loaded", () => {
    const { dispatched, submit, note } = attachWithFakes("native-musveren", null, true, "human-male-mystic");
    submit("sandbox-equip-item", { itemId: "22" });
    expect(dispatched).toEqual([{ type: "equip-item", slot: "upper", itemId: 22 }]);
    expect(note("sandbox-equip-item")).toHaveLength(1);
    expect(note("sandbox-equip-item")[0]!.textContent).toBe("item:22 converted for human-male-fighter, not for human-male-mystic");
    expect(note("sandbox-equip-item")[0]!.dataset.tone).toBe("warning");
  });

  it("still dispatches item 999999 and warns that it is not in the catalog", () => {
    const { dispatched, submit, note } = attachWithFakes();
    submit("sandbox-equip-item", { itemId: "22" });
    submit("sandbox-equip-item", { itemId: "999999" });
    expect(dispatched.at(-1)).toEqual({ type: "equip-item", slot: "upper", itemId: 999999 });
    expect(note("sandbox-equip-item")).toHaveLength(1);
    expect(note("sandbox-equip-item")[0]!.textContent).toBe("item:999999 not in catalog");
    expect(note("sandbox-equip-item")[0]!.dataset.tone).toBe("warning");
  });
});

describe("sandbox cast skill by ID", () => {
  it("casts skill 3 level 1 on the selected entity and starts the Power Strike preview once", () => {
    const { dispatched, powerStrike, submit, note } = attachWithFakes("native-musveren");
    submit("sandbox-cast-skill", { skillId: "3", level: "1" });
    expect(dispatched).toEqual([{ type: "cast-skill", skillId: 3, level: 1, targetId: "native-musveren" }]);
    expect(powerStrike.start).toHaveBeenCalledOnce();
    expect(note("sandbox-cast-skill")[0]!.textContent).toBe("skill:3:1 converted");
  });

  it("casts without a target when nothing is selected", () => {
    const { dispatched, submit } = attachWithFakes(null);
    submit("sandbox-cast-skill", { skillId: "3", level: "1" });
    expect(dispatched).toEqual([{ type: "cast-skill", skillId: 3, level: 1 }]);
  });

  it("notes skill 7 level 1 as not in catalog and starts nothing", () => {
    const { dispatched, powerStrike, submit, note } = attachWithFakes();
    submit("sandbox-cast-skill", { skillId: "7", level: "1" });
    expect(dispatched).toEqual([{ type: "cast-skill", skillId: 7, level: 1, targetId: "native-musveren" }]);
    expect(powerStrike.start).not.toHaveBeenCalled();
    expect(note("sandbox-cast-skill")[0]!.textContent).toBe("skill:7:1 not in catalog");
    expect(note("sandbox-cast-skill")[0]!.dataset.tone).toBe("warning");
  });

  it("rejects level 0 at the sheet and dispatches nothing", () => {
    const { dispatched, submit } = attachWithFakes();
    submit("sandbox-cast-skill", { skillId: "3", level: "0" });
    expect(dispatched).toEqual([]);
  });

  it("stops reacting to skill-cast events after release", () => {
    const { listeners, powerStrike, release, submit } = attachWithFakes();
    release();
    expect(listeners.size).toBe(0);
    submit("sandbox-cast-skill", { skillId: "3", level: "1" });
    expect(powerStrike.start).not.toHaveBeenCalled();
  });
});

describe("sandbox open window by ID", () => {
  it("dispatches nothing and notes that interface windows are not converted yet", () => {
    const { dispatched, submit, note } = attachWithFakes();
    submit("sandbox-open-window", { name: "StatusWnd" });
    expect(dispatched).toEqual([]);
    expect(note("sandbox-open-window")[0]!.textContent).toBe("window:StatusWnd not in catalog: interface windows are not converted yet (UI-01)");
    expect(note("sandbox-open-window")[0]!.dataset.tone).toBe("warning");
  });
});

describe("sandbox notes follow the adapter's response", () => {
  it.each([
    ["sandbox-spawn-npc", { npcId: "21622" }, "npc:21622: spawn rejected by the adapter"],
    ["sandbox-equip-item", { itemId: "22" }, "item:22: equip rejected by the adapter"],
    ["sandbox-cast-skill", { skillId: "3", level: "1" }, "skill:3:1: cast rejected by the adapter"],
  ])("reports %s as rejected when the adapter emits no matching event", (testId, values, expectedNote) => {
    const { dispatched, powerStrike, submit, note } = attachWithFakes("native-musveren", null, false);
    submit(testId, values);
    expect(dispatched).toHaveLength(1);
    expect(note(testId)[0]!.textContent).toBe(expectedNote);
    expect(note(testId)[0]!.dataset.tone).toBe("warning");
    expect(powerStrike.start).not.toHaveBeenCalled();
  });

  it("leaves no acceptance listener subscribed after a dispatch", () => {
    const { listeners, submit } = attachWithFakes();
    const subscribedBeforeDispatch = listeners.size;
    submit("sandbox-spawn-npc", { npcId: "21622" });
    expect(listeners.size).toBe(subscribedBeforeDispatch);
  });
});

describe("sandbox spawn NPC by ID", () => {
  it("dispatches spawn-npc and notes converted and missing IDs", () => {
    const { dispatched, submit, note } = attachWithFakes();
    submit("sandbox-spawn-npc", { npcId: "21622" });
    expect(note("sandbox-spawn-npc")[0]!.textContent).toBe("npc:21622 converted, model musveren:0");
    submit("sandbox-spawn-npc", { npcId: "12345" });
    expect(dispatched).toEqual([{ type: "spawn-npc", npcId: 21622 }, { type: "spawn-npc", npcId: 12345 }]);
    expect(note("sandbox-spawn-npc")).toHaveLength(1);
    expect(note("sandbox-spawn-npc")[0]!.textContent).toBe("npc:12345 not in catalog");
    expect(note("sandbox-spawn-npc")[0]!.dataset.tone).toBe("warning");
  });
});
