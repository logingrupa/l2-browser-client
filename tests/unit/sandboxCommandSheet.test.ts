import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DevSheet } from "../../src/ui/devSheet/DevSheet";
import type { NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { attachSandboxCommandSheet } from "../../src/runtime/attachSandboxCommandSheet";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import { fire, installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";
import { attachSandboxSheetWithFakes, createSandboxSection, fakeCatalogIndexOver } from "./support/sandboxCommandSheetFakes";

const fakeCatalogIndex = fakeCatalogIndexOver(new Map<string, NativeCatalogLookup>([
  ["item:22", { status: "converted", key: "item:22", record: { itemId: 22, slot: "upper", catalogIds: ["fighter-equipment:0"], playerProfileIds: ["human-male-fighter"] } }],
  ["skill:3:1", { status: "converted", key: "skill:3:1", record: { skillId: 3, level: 1, effectComponentId: "interlude:skill:3:level:1:raw-source-dispatch" } }],
  ["npc:21622", { status: "converted", key: "npc:21622", record: { npcId: 21622, profileId: "native-npc-profiles", modelCatalogId: "musveren:0", join: "legacy-single-mesh-match" } }],
]));

let dom: MiniDom;
const openSheets: DevSheet[] = [];

function attachWithFakes(selectedEntityId: string | null = "native-musveren", indexFailure: string | null = null, adapterAcceptsCommands = true,
  activePlayerProfileId = "human-male-fighter") {
  const attached = attachSandboxSheetWithFakes(dom, { index: fakeCatalogIndex, selectedEntityId, indexFailure, adapterAcceptsCommands, activePlayerProfileId });
  openSheets.push(attached.sheet);
  return attached;
}

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => { for (const sheet of openSheets.splice(0)) sheet.dispose(); dom.restore(); });

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
    const { sheet, section } = createSandboxSection(dom);
    openSheets.push(sheet);
    const release = attachSandboxCommandSheet({ section, adapter, index: fakeCatalogIndex, indexFailure: null, appearanceOfNpc: () => ({ appearanceId: "native-musveren" }),
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
    expect(note("sandbox-spawn-npc")[0]!.textContent).toBe("npc:21622 converted");
    submit("sandbox-spawn-npc", { npcId: "12345" });
    expect(dispatched).toEqual([{ type: "spawn-npc", npcId: 21622 }, { type: "spawn-npc", npcId: 12345 }]);
    expect(note("sandbox-spawn-npc")).toHaveLength(1);
    expect(note("sandbox-spawn-npc")[0]!.textContent).toBe("npc:12345 not in catalog");
    expect(note("sandbox-spawn-npc")[0]!.dataset.tone).toBe("warning");
  });
});
