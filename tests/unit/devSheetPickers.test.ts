import { describe, expect, it } from "vitest";
import { devSheetComboboxLoadingText, devSheetComboboxRowLimit } from "../../src/ui/devSheet/devSheetCombobox";
import { sandboxPickerSections } from "../../src/ui/devSheet/sandboxPickerRegistry";
import type { NativeTableNameIndexRead } from "../../src/ui/nativeTables/readNativeTableNameIndex";
import { settleMicrotasks } from "./support/comboboxDriver";
import { fire } from "./support/miniDom";
import { converted, createPickerHarness, nameEntries, type CatalogEntries } from "./support/sandboxPickerHarness";

const harness = createPickerHarness();
const mountPicker = harness.mountPicker;
const spawnSearch = "sandbox-spawn-search";

const npcNameIndex: NativeTableNameIndexRead = { status: "converted", key: "table:npcname_e_names", manifest: "/l2/tables/x/npcname_e_names.json",
  identifierFields: ["id"], entries: nameEntries([[[20002], "Gremlin"], [[20001], "Gremlin"], [[21622], "Greater Musveren"], [[7], "Grocer"]]) };
const npcCatalog: CatalogEntries = {
  "npc:20001": converted("npc:20001"),
  "npc:20002": { status: "gap", key: "npc:20002", reason: "mesh conversion failed", coverageStatus: "failed" },
};

describe("spawn picker", () => {
  it("dispatches exactly spawn-npc with the picked id after typing a name and shows its catalog status", async () => {
    const picker = mountPicker("spawn", { catalog: npcCatalog, nameIndexes: { "npcname-e": npcNameIndex } });
    await picker.type(spawnSearch, "musveren");
    expect(picker.nameIndexReads).toEqual(["npcname-e"]);
    expect(picker.rowTexts(spawnSearch)).toEqual(["Greater Musveren npc:21622 not in catalog"]);
    await picker.pick(spawnSearch, 0);
    expect(picker.fakeHost.dispatched).toEqual([{ type: "spawn-npc", npcId: 21622 }]);
    expect(picker.note("sandbox-spawn-note")).toBe("npc:21622 not in catalog");
  });

  it("lists equal names as separate rows with their own ids, ordered by id, and refuses a gap row", async () => {
    const picker = mountPicker("spawn", { catalog: npcCatalog, nameIndexes: { "npcname-e": npcNameIndex } });
    await picker.type(spawnSearch, "GREMLIN");
    expect(picker.rowTexts(spawnSearch)).toEqual(["Gremlin npc:20001 converted", "Gremlin npc:20002 gap: mesh conversion failed"]);
    expect(picker.byTestId(`${spawnSearch}-option-1`)!.getAttribute("aria-disabled")).toBe("true");
    expect(picker.message(spawnSearch).textContent).toBe("2 matches");
    await picker.pick(spawnSearch, 1);
    expect(picker.fakeHost.dispatched).toEqual([]);
    expect(picker.byTestId(`${spawnSearch}-pick`)!.disabled).toBe(true);
    await picker.pick(spawnSearch, 0);
    expect(picker.fakeHost.dispatched).toEqual([{ type: "spawn-npc", npcId: 20001 }]);
  });

  it("matches a typed ID against the catalog key of each row", async () => {
    const picker = mountPicker("spawn", { catalog: npcCatalog, nameIndexes: { "npcname-e": npcNameIndex } });
    await picker.type(spawnSearch, "npc:7");
    expect(picker.rowTexts(spawnSearch)).toEqual(["Grocer npc:7 not in catalog"]);
  });

  it("caps the list at the row limit with a keep-typing row and shows the limit on the hover-card", async () => {
    const many: NativeTableNameIndexRead = { ...npcNameIndex, entries: nameEntries(Array.from({ length: 60 }, (_, position) => [[100 - position], "Imp"] as const)) };
    const picker = mountPicker("spawn", { nameIndexes: { "npcname-e": many } });
    await picker.type(spawnSearch, "imp");
    const labels = picker.rowTexts(spawnSearch);
    expect(labels).toHaveLength(devSheetComboboxRowLimit);
    expect(labels[0]).toBe("Imp npc:41 not in catalog");
    expect(picker.byTestId(`${spawnSearch}-more`)!.textContent).toBe("10 more, keep typing");
    expect(picker.message(spawnSearch).textContent).toBe("60 matches");
    const matchLimit = picker.variables(spawnSearch).find(variable => variable.name === "sandbox.spawn.matchLimit");
    expect(matchLimit?.value()).toBe(String(devSheetComboboxRowLimit));
    expect(matchLimit?.status).toBe("presentation");
  });

  it("reads the name index once, on first focus, with a loading state", async () => {
    let resolveRead: (read: NativeTableNameIndexRead) => void = () => undefined;
    const picker = mountPicker("spawn", { readNameIndex: () => new Promise(resolve => { resolveRead = resolve; }) });
    expect(picker.nameIndexReads).toEqual([]);
    const input = picker.byTestId(`${spawnSearch}-input`)!;
    input.focus();
    expect(picker.message(spawnSearch).textContent).toBe(devSheetComboboxLoadingText);
    input.click();
    expect(picker.rowTexts(spawnSearch)).toEqual([]);
    resolveRead(npcNameIndex);
    await settleMicrotasks();
    expect(picker.rowTexts(spawnSearch)).toHaveLength(4);
    input.blur();
    input.focus();
    expect(picker.nameIndexReads).toEqual(["npcname-e"]);
  });

  it("shows the table catalog status with its reason for a missing name index and keeps ID entry working", async () => {
    const picker = mountPicker("spawn", { catalog: { "table:npcname-e": converted("table:npcname-e") } });
    await picker.type(spawnSearch, "Gremlin");
    expect(picker.message(spawnSearch).textContent)
      .toBe("table:npcname_e_names not in catalog: no tables record in the served catalog; table:npcname-e converted. ID entry still works.");
    expect(picker.byTestId(`${spawnSearch}-list`)!.hidden).toBe(true);
    await picker.submit("sandbox-spawn-npc", { npcId: "20001" });
    expect(picker.fakeHost.dispatched).toEqual([{ type: "spawn-npc", npcId: 20001 }]);
    expect(picker.note("sandbox-spawn-note")).toBe("npc:20001 not in catalog");
  });

  it("exposes the query, selection, lookup and match limit as hover-card variables", async () => {
    const picker = mountPicker("spawn", { catalog: npcCatalog, nameIndexes: { "npcname-e": npcNameIndex } });
    await picker.type(spawnSearch, "Gremlin");
    await picker.pick(spawnSearch, 0);
    const variables = Object.fromEntries(picker.variables("sandbox-spawn-npc").map(variable => [variable.name, variable]));
    expect(variables["sandbox.spawn.query"]?.value()).toBe("Gremlin");
    expect(variables["sandbox.spawn.selected"]?.value()).toBe("npc:20001");
    expect(variables["sandbox.spawn.lookup"]?.value()).toBe("npc:20001 converted");
    expect(variables["sandbox.spawn.lookup"]?.status).toBe("native");
    expect(variables["sandbox.spawn.nameIndex"]?.value()).toBe("converted: 4 entries");
    expect(variables["sandbox.spawn.matchLimit"]?.status).toBe("presentation");
  });

  it("puts decoded names into row text only, never markup", async () => {
    const markup: NativeTableNameIndexRead = { ...npcNameIndex, entries: nameEntries([[[1], "<img src=x onerror=alert(1)>"]]) };
    const picker = mountPicker("spawn", { nameIndexes: { "npcname-e": markup } });
    await picker.type(spawnSearch, "img");
    expect(picker.byTestId(`${spawnSearch}-list`)!.querySelectorAll("img")).toEqual([]);
    expect(picker.rowTexts(spawnSearch)).toEqual(["<img src=x onerror=alert(1)> npc:1 not in catalog"]);
  });

  it("releases once: a second release is a no-op and no picker node or action remains", async () => {
    const picker = mountPicker("spawn", { nameIndexes: { "npcname-e": npcNameIndex } });
    const form = picker.byTestId("sandbox-spawn-npc")!;
    form.querySelector('[data-testid="sandbox-spawn-npc-npcId"]')!.value = "1";
    const documentListenersBefore = harness.document().listenerCount("keydown");
    picker.release();
    picker.release();
    expect(picker.groupElement.children).toHaveLength(picker.childCountBefore);
    expect(form.isConnected).toBe(false);
    fire(form, "submit");
    await settleMicrotasks();
    expect(picker.fakeHost.dispatched).toEqual([]);
    expect(harness.document().listenerCount("keydown")).toBe(documentListenersBefore);
  });

  it("shows no rows and a stopped state when the read fails because the signal aborted", async () => {
    const controller = new AbortController();
    let rejectPendingRead: (reason: unknown) => void = () => undefined;
    const picker = mountPicker("spawn", { signal: controller.signal,
      readNameIndex: () => new Promise<NativeTableNameIndexRead>((_, reject) => { rejectPendingRead = reject; }) });
    const pendingType = picker.type(spawnSearch, "Grocer");
    controller.abort();
    rejectPendingRead(new DOMException("aborted", "AbortError"));
    await pendingType;
    await settleMicrotasks();
    expect(picker.byTestId(`${spawnSearch}-list`)!.hidden).toBe(true);
    expect(picker.rowTexts(spawnSearch)).toEqual([]);
    expect(picker.message(spawnSearch).textContent).toBe("npcname-e name index read stopped.");
    expect(picker.variables(spawnSearch).find(variable => variable.name === "sandbox.spawn.nameIndex")?.value()).toBe("read stopped");
  });
});

describe("sandbox picker registry", () => {
  it("lists the tile, spawn, equip, cast, window and clips pickers in that order", () => {
    expect(sandboxPickerSections.map(picker => picker.id)).toEqual(["tile", "spawn", "equip", "cast", "window", "clips"]);
  });

  it.each(sandboxPickerSections.map(picker => picker.id))("%s picker releases every node it added and ignores a second release", pickerId => {
    const picker = mountPicker(pickerId, { catalog: { "tile:20_20": converted("tile:20_20"), "window:StatusWnd": converted("window:StatusWnd") } });
    expect(picker.groupElement.children.length).toBeGreaterThan(picker.childCountBefore);
    picker.release();
    picker.release();
    expect(picker.groupElement.children).toHaveLength(picker.childCountBefore);
  });
});

function chargrpRecord(recordCount: number) {
  return converted("table:chargrp", { table: "chargrp", manifest: "/l2/tables/x/chargrp.json", manifestSha256: "x", manifestBytes: 1, recordCount, sourceSha256: "y" });
}

describe("character spawn", () => {
  it("dispatches spawn-character for index 0", async () => {
    const picker = mountPicker("spawn", { catalog: { "table:chargrp": chargrpRecord(4), "character:0": converted("character:0") } });
    await picker.submit("sandbox-spawn-character", { characterTemplateIndex: "0" });
    expect(picker.fakeHost.dispatched).toEqual([{ type: "spawn-character", characterTemplateIndex: 0 }]);
    expect(picker.note("sandbox-spawn-note")).toBe("character:0 converted");
  });

  it("bounds the index by the converted chargrp record count", async () => {
    const picker = mountPicker("spawn", { catalog: { "table:chargrp": chargrpRecord(4) } });
    await picker.submit("sandbox-spawn-character", { characterTemplateIndex: "4" });
    expect(picker.fakeHost.dispatched).toEqual([]);
    expect(picker.message("sandbox-spawn-character").textContent).toBe("Chargrp index must be below 4, the table:chargrp record count.");
    await picker.submit("sandbox-spawn-character", { characterTemplateIndex: "3" });
    expect(picker.fakeHost.dispatched).toEqual([{ type: "spawn-character", characterTemplateIndex: 3 }]);
    expect(picker.variables("sandbox-spawn-character").find(variable => variable.name === "sandbox.spawn.characterTemplateCount")?.value()).toBe("4");
  });

  it("accepts any non-negative index without a chargrp record and names the table status", async () => {
    const picker = mountPicker("spawn");
    await picker.submit("sandbox-spawn-character", { characterTemplateIndex: "123456" });
    expect(picker.fakeHost.dispatched).toEqual([{ type: "spawn-character", characterTemplateIndex: 123456 }]);
    expect(picker.note("sandbox-spawn-note")).toBe("character:123456 not in catalog; unbounded because table:chargrp not in catalog");
    await picker.submit("sandbox-spawn-character", { characterTemplateIndex: "-1" });
    expect(picker.fakeHost.dispatched).toHaveLength(1);
  });
});
