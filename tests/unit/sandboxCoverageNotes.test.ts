import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DevSheet } from "../../src/ui/devSheet/DevSheet";
import type { NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { describeSandboxCatalogLookup } from "../../src/runtime/sandboxCatalogLookupNote";
import { installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";
import { attachSandboxSheetWithFakes, fakeCatalogIndexOver } from "./support/sandboxCommandSheetFakes";

const rabbitGapReason = "converter-refused:Mesh bone has no unique native parent/name mapping: bip01 r finger0nub";
const gremlinLookup: NativeCatalogLookup = { status: "converted", key: "npc:20001",
  record: { npcId: 20001, profileId: "interlude:npc-profiles:pack-b01bce43a24fdadd", modelCatalogId: "npc-model:gremlin", join: "model-catalog-id" } };
const rabbitLookup: NativeCatalogLookup = { status: "gap", key: "npc:20002", reason: rabbitGapReason, coverageStatus: "gap" };

describe("describeSandboxCatalogLookup", () => {
  it("notes a converted key with the info tone", () => {
    expect(describeSandboxCatalogLookup(gremlinLookup)).toEqual({ tone: "info", text: "npc:20001 converted" });
  });

  it("notes a gap with the warning tone and the coverage reason verbatim", () => {
    expect(describeSandboxCatalogLookup(rabbitLookup)).toEqual({ tone: "warning", text: `npc:20002 gap: ${rabbitGapReason}` });
  });

  it("notes a key the catalog does not hold with the warning tone", () => {
    expect(describeSandboxCatalogLookup({ status: "not-in-catalog", key: "npc:999999", reason: "not in catalog" }))
      .toEqual({ tone: "warning", text: "npc:999999 not in catalog" });
  });

  it("names a not-in-catalog reason other than the plain one after the status", () => {
    expect(describeSandboxCatalogLookup({ status: "not-in-catalog", key: "npc:999999", reason: "npc profile names no converted model" }))
      .toEqual({ tone: "warning", text: "npc:999999 not in catalog: npc profile names no converted model" });
  });

  it("keeps a reason holding markup as literal text", () => {
    expect(describeSandboxCatalogLookup({ status: "gap", key: "npc:20002", reason: "<b>refused</b>", coverageStatus: "failed" }).text)
      .toBe("npc:20002 gap: <b>refused</b>");
  });
});

const laneLookups: readonly NativeCatalogLookup[] = [
  gremlinLookup, rabbitLookup,
  { status: "converted", key: "item:22", record: { itemId: 22, slot: "upper", catalogIds: ["fighter-equipment:0"], playerProfileIds: ["human-male-fighter"] } },
  { status: "gap", key: "item:23", reason: "item-mesh-unresolved", coverageStatus: "pending" },
  { status: "converted", key: "skill:3:1", record: { skillId: 3, level: 1, effectComponentId: "interlude:skill:3:level:1:raw-source-dispatch" } },
  { status: "gap", key: "skill:7:1", reason: "native-skill-dispatch-required", coverageStatus: "gap" },
  { status: "converted", key: "window:StatusWnd", record: { window: "StatusWnd", manifest: "/l2/windows/statuswnd/manifest.json", manifestSha256: "0".repeat(64), manifestBytes: 1 } },
  { status: "gap", key: "window:InventoryWnd", reason: "window-texture-missing", coverageStatus: "failed" },
];

let dom: MiniDom;
const openSheets: DevSheet[] = [];

function attachWithLaneLookups() {
  const attached = attachSandboxSheetWithFakes(dom, { index: fakeCatalogIndexOver(new Map(laneLookups.map(lookup => [lookup.key, lookup]))) });
  openSheets.push(attached.sheet);
  return attached;
}

function openEntryCard(sheet: DevSheet, panel: FakeElement, testId: string): FakeElement {
  panel.querySelector(`[data-testid="${testId}"] .dev-info`)!.click();
  return sheet.cards.element as unknown as FakeElement;
}

function variableValue(card: FakeElement, name: string): string {
  return card.querySelector(`[data-variable="${name}"] .dev-variable-value`)!.textContent;
}

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => { for (const sheet of openSheets.splice(0)) sheet.dispose(); dom.restore(); });

describe("sandbox spawn NPC coverage notes", () => {
  it.each([
    ["20001", "npc:20001 converted", "info"],
    ["20002", `npc:20002 gap: ${rabbitGapReason}`, "warning"],
    ["999999", "npc:999999 not in catalog", "warning"],
  ])("still dispatches npc %s and notes its lookup", (npcId, expectedText, expectedTone) => {
    const { dispatched, submit, note } = attachWithLaneLookups();
    submit("sandbox-spawn-npc", { npcId });
    expect(dispatched).toEqual([{ type: "spawn-npc", npcId: Number(npcId) }]);
    expect(note("sandbox-spawn-npc")).toHaveLength(1);
    expect(note("sandbox-spawn-npc")[0]!.textContent).toBe(expectedText);
    expect(note("sandbox-spawn-npc")[0]!.dataset.tone).toBe(expectedTone);
  });

  it("shows the last key and its lookup in the sandbox.lastKey and sandbox.lastLookup variables", () => {
    const { submit, sheet, panel } = attachWithLaneLookups();
    submit("sandbox-spawn-npc", { npcId: "20002" });
    const card = openEntryCard(sheet, panel, "sandbox-spawn-npc");
    expect(variableValue(card, "sandbox.lastKey")).toBe("npc:20002");
    expect(variableValue(card, "sandbox.lastLookup")).toBe(`gap: ${rabbitGapReason}`);
    expect(card.querySelector('[data-variable="sandbox.lastLookup"] .dev-badge')!.dataset.status).toBe("native");
    expect(card.querySelector('[data-variable="sandbox.lastLookup"] .dev-variable-source')!.textContent).toContain("nativeCatalogIndex");
    expect(card.querySelector('[data-variable="sandbox.lastLookup"] .dev-variable-source')!.textContent).toContain("/l2/coverage.json");
  });

  it("writes a gap reason holding markup as note text, not as elements", () => {
    const markupLookup: NativeCatalogLookup = { status: "gap", key: "npc:20002", reason: "<b>refused</b>", coverageStatus: "gap" };
    const attached = attachSandboxSheetWithFakes(dom, { index: fakeCatalogIndexOver(new Map([[markupLookup.key, markupLookup]])) });
    openSheets.push(attached.sheet);
    attached.submit("sandbox-spawn-npc", { npcId: "20002" });
    const spawnNote = attached.note("sandbox-spawn-npc")[0]!;
    expect(spawnNote.textContent).toBe("npc:20002 gap: <b>refused</b>");
    expect(spawnNote.querySelector("b")).toBeNull();
  });
});

describe("sandbox equip, cast and open window coverage notes", () => {
  it.each([
    ["sandbox-equip-item", { itemId: "22" }, "item:22 converted", "info"],
    ["sandbox-equip-item", { itemId: "23" }, "item:23 gap: item-mesh-unresolved", "warning"],
    ["sandbox-equip-item", { itemId: "999999" }, "item:999999 not in catalog", "warning"],
    ["sandbox-cast-skill", { skillId: "3", level: "1" }, "skill:3:1 converted", "info"],
    ["sandbox-cast-skill", { skillId: "7", level: "1" }, "skill:7:1 gap: native-skill-dispatch-required", "warning"],
    ["sandbox-cast-skill", { skillId: "999999", level: "1" }, "skill:999999:1 not in catalog", "warning"],
    ["sandbox-open-window", { name: "StatusWnd" }, "window:StatusWnd converted", "info"],
    ["sandbox-open-window", { name: "InventoryWnd" }, "window:InventoryWnd gap: window-texture-missing", "warning"],
    ["sandbox-open-window", { name: "MissingWnd" }, "window:MissingWnd not in catalog: interface windows are not converted yet (UI-01)", "warning"],
  ])("%s with %o notes %s", (testId, values, expectedText, expectedTone) => {
    const { submit, note } = attachWithLaneLookups();
    submit(testId, values);
    expect(note(testId)).toHaveLength(1);
    expect(note(testId)[0]!.textContent).toBe(expectedText);
    expect(note(testId)[0]!.dataset.tone).toBe(expectedTone);
  });

  it("still dispatches a gap item and a gap skill", () => {
    const { dispatched, submit } = attachWithLaneLookups();
    submit("sandbox-equip-item", { itemId: "23" });
    submit("sandbox-cast-skill", { skillId: "7", level: "1" });
    expect(dispatched).toEqual([{ type: "equip-item", slot: "upper", itemId: 23 }, { type: "cast-skill", skillId: 7, level: 1, targetId: "native-musveren" }]);
  });

  it("never dispatches an open window, whatever its lookup", () => {
    const { dispatched, submit } = attachWithLaneLookups();
    for (const name of ["StatusWnd", "InventoryWnd", "MissingWnd"]) submit("sandbox-open-window", { name });
    expect(dispatched).toEqual([]);
  });

  it.each([
    ["sandbox-equip-item", { itemId: "23" }, "item:23", "gap: item-mesh-unresolved"],
    ["sandbox-cast-skill", { skillId: "3", level: "1" }, "skill:3:1", "converted"],
    ["sandbox-open-window", { name: "MissingWnd" }, "window:MissingWnd", "not-in-catalog: interface windows are not converted yet (UI-01)"],
  ])("%s sets sandbox.lastKey and sandbox.lastLookup on every by-ID entry", (testId, values, expectedKey, expectedLookup) => {
    const { submit, sheet, panel } = attachWithLaneLookups();
    submit("sandbox-spawn-npc", { npcId: "20001" });
    submit(testId, values);
    for (const entryTestId of ["sandbox-spawn-npc", "sandbox-equip-item", "sandbox-cast-skill", "sandbox-open-window"]) {
      const card = openEntryCard(sheet, panel, entryTestId);
      expect(variableValue(card, "sandbox.lastKey")).toBe(expectedKey);
      expect(variableValue(card, "sandbox.lastLookup")).toBe(expectedLookup);
    }
  });
});
