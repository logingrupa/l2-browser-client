import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NativeCatalogIndex, NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { DevSheet } from "../../src/ui/devSheet/DevSheet";
import type { DevGroup } from "../../src/ui/devSheet/devSheetParts";
import type { SandboxActionOutcome, SandboxPickerContext } from "../../src/ui/devSheet/sandboxPickerHost";
import { sandboxPickerMatchLimit } from "../../src/ui/devSheet/sandboxPickerMatches";
import { sandboxPickerSections, type SandboxPickerFactory } from "../../src/ui/devSheet/sandboxPickerRegistry";
import type { NativeTableNameEntry, NativeTableNameIndexRead } from "../../src/ui/nativeTables/readNativeTableNameIndex";
import type { WorldCommand } from "../../src/world/worldTypes";
import { fakeMedia, fire, installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";

let dom: MiniDom;
const sheets: DevSheet[] = [];

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => { for (const sheet of sheets.splice(0)) sheet.dispose(); dom.restore(); });

type CatalogEntries = Readonly<Record<string, NativeCatalogLookup>>;

function fakeCatalogIndex(entries: CatalogEntries): NativeCatalogIndex {
  return {
    lookup: key => entries[key] ?? { status: "not-in-catalog", key, reason: "not in catalog" },
    keys: prefix => Object.keys(entries).filter(key => key.startsWith(prefix)).sort(),
  };
}

function converted(key: string, record: Record<string, unknown> = {}): NativeCatalogLookup {
  return { status: "converted", key, record: record as never };
}

function nameEntries(rows: readonly (readonly [readonly number[], string])[]): NativeTableNameEntry[] {
  return rows.map(([identifiers, name], sourceOrder) => ({ identifiers, name, sourceOrder }));
}

interface FakeHost {
  readonly dispatched: WorldCommand[];
  readonly reloadedTiles: string[];
  readonly openedWindows: string[];
}

interface MountOptions {
  readonly catalog?: CatalogEntries;
  readonly nameIndexes?: Readonly<Record<string, NativeTableNameIndexRead>>;
  readonly readNameIndex?: (tableId: string) => Promise<NativeTableNameIndexRead>;
  readonly selectedEntityId?: string | null;
  readonly currentTileId?: string | null;
  readonly reloadOutcome?: SandboxActionOutcome;
  readonly windowOutcome?: Promise<SandboxActionOutcome>;
  readonly signal?: AbortSignal;
}

function mountPicker(pickerId: string, options: MountOptions = {}) {
  const host = dom.document.createElement("section");
  const canvas = dom.document.createElement("canvas");
  const toggle = dom.document.createElement("button");
  host.append(toggle); dom.document.body.append(canvas, host);
  host.rect = { left: 0, top: 0, width: 1280, height: 800 };
  const sheet = new DevSheet({ host: host as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement,
    toggle: toggle as unknown as HTMLButtonElement, worldTargets: [canvas] as unknown as EventTarget[], storage: null, matchMedia: fakeMedia().matchMedia });
  sheets.push(sheet);
  const factory = sandboxPickerSections.find(picker => picker.id === pickerId) as SandboxPickerFactory;
  const group: DevGroup = sheet.section("sandbox", { title: "Sandbox" }).group(factory.id, factory.title);
  const fakeHost: FakeHost = { dispatched: [], reloadedTiles: [], openedWindows: [] };
  const nameIndexReads: string[] = [];
  const context: SandboxPickerContext = {
    host: {
      dispatch: command => { fakeHost.dispatched.push(command); },
      reloadTile: tileId => { fakeHost.reloadedTiles.push(tileId); return options.reloadOutcome ?? { tone: "info", text: `tile:${tileId} reloaded` }; },
      openWindow: windowId => { fakeHost.openedWindows.push(windowId); return options.windowOutcome ?? Promise.resolve({ tone: "info", text: `${windowId} opened` }); },
    },
    catalogIndex: fakeCatalogIndex(options.catalog ?? {}),
    readNameIndex: async tableId => {
      nameIndexReads.push(tableId);
      if (options.readNameIndex) return options.readNameIndex(tableId);
      const read = options.nameIndexes?.[tableId];
      return read ?? { status: "not-in-catalog", key: `table:${tableId.replace(/-/g, "_")}_names`, reason: "no tables record in the served catalog" };
    },
    selectedEntityId: () => options.selectedEntityId ?? null,
    currentTileId: () => options.currentTileId ?? null,
    signal: options.signal ?? new AbortController().signal,
  };
  const groupElement = group.element as unknown as FakeElement;
  const childCountBefore = groupElement.children.length;
  const release = factory.attach(group, context);
  const byTestId = (testId: string) => groupElement.querySelector(`[data-testid="${testId}"]`);
  const submit = async (testId: string, values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) byTestId(`${testId}-${name}`)!.value = value;
    fire(byTestId(testId)!, "submit");
    await settle();
  };
  const pick = async (searchTestId: string, position: number) => {
    const select = byTestId(`${searchTestId}-matches`)!.querySelector("select")!;
    select.value = String(position);
    fire(select, "change");
    byTestId(`${searchTestId}-pick`)!.click();
    await settle();
  };
  const options_ = (searchTestId: string) => byTestId(`${searchTestId}-matches`)!.querySelectorAll("option").map(option => option.textContent);
  const message = (testId: string) => byTestId(`${testId}-message`)!;
  const note = (testId: string) => byTestId(testId)?.textContent ?? null;
  const variables = (testId: string) => sheet.cards.info(byTestId(testId) as unknown as Element)?.variables?.() ?? [];
  return { sheet, group, groupElement, childCountBefore, release, fakeHost, nameIndexReads, byTestId, submit, pick, options: options_, message, note, variables };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

const npcNameIndex: NativeTableNameIndexRead = { status: "converted", key: "table:npcname_e_names", manifest: "/l2/tables/x/npcname_e_names.json",
  identifierFields: ["id"], entries: nameEntries([[[20002], "Gremlin"], [[20001], "Gremlin"], [[21622], "Greater Musveren"], [[7], "Grocer"]]) };
const npcCatalog: CatalogEntries = {
  "npc:20001": converted("npc:20001"),
  "npc:20002": { status: "gap", key: "npc:20002", reason: "mesh conversion failed", coverageStatus: "failed" },
};

describe("spawn picker", () => {
  it("dispatches exactly spawn-npc with the picked id after a search by name and shows its catalog status", async () => {
    const picker = mountPicker("spawn", { catalog: npcCatalog, nameIndexes: { "npcname-e": npcNameIndex } });
    await picker.submit("sandbox-spawn-search", { query: "musveren" });
    expect(picker.nameIndexReads).toEqual(["npcname-e"]);
    expect(picker.options("sandbox-spawn-search")).toEqual(["Greater Musveren (npc:21622 not in catalog)"]);
    await picker.pick("sandbox-spawn-search", 0);
    expect(picker.fakeHost.dispatched).toEqual([{ type: "spawn-npc", npcId: 21622 }]);
    expect(picker.note("sandbox-spawn-note")).toBe("npc:21622 not in catalog");
  });

  it("lists equal names as separate entries with their own ids, ordered by id", async () => {
    const picker = mountPicker("spawn", { catalog: npcCatalog, nameIndexes: { "npcname-e": npcNameIndex } });
    await picker.submit("sandbox-spawn-search", { query: "GREMLIN" });
    expect(picker.options("sandbox-spawn-search")).toEqual(["Gremlin (npc:20001 converted)", "Gremlin (npc:20002 gap: mesh conversion failed)"]);
    await picker.pick("sandbox-spawn-search", 1);
    expect(picker.fakeHost.dispatched).toEqual([{ type: "spawn-npc", npcId: 20002 }]);
    expect(picker.message("sandbox-spawn-search").textContent).toBe("2 of 2 matches, ordered by ID.");
  });

  it("matches an all-digit query against the id only", async () => {
    const picker = mountPicker("spawn", { catalog: npcCatalog, nameIndexes: { "npcname-e": npcNameIndex } });
    await picker.submit("sandbox-spawn-search", { query: "7" });
    expect(picker.options("sandbox-spawn-search")).toEqual(["Grocer (npc:7 not in catalog)"]);
  });

  it("caps the match list at the match limit and shows the limit on the hover-card", async () => {
    const many: NativeTableNameIndexRead = { ...npcNameIndex, entries: nameEntries(Array.from({ length: 20 }, (_, position) => [[100 - position], "Imp"] as const)) };
    const picker = mountPicker("spawn", { nameIndexes: { "npcname-e": many } });
    await picker.submit("sandbox-spawn-search", { query: "imp" });
    const labels = picker.options("sandbox-spawn-search");
    expect(labels).toHaveLength(sandboxPickerMatchLimit);
    expect(labels[0]).toBe("Imp (npc:81 not in catalog)");
    expect(picker.message("sandbox-spawn-search").textContent).toBe(`${sandboxPickerMatchLimit} of 20 matches, ordered by ID.`);
    const matchLimit = picker.variables("sandbox-spawn-search").find(variable => variable.name === "sandbox.spawn.matchLimit");
    expect(matchLimit?.value()).toBe(String(sandboxPickerMatchLimit));
    expect(matchLimit?.status).toBe("presentation");
  });

  it("shows a prompt and no match list for an empty search", async () => {
    const picker = mountPicker("spawn", { nameIndexes: { "npcname-e": npcNameIndex } });
    await picker.submit("sandbox-spawn-search", { query: "   " });
    expect(picker.byTestId("sandbox-spawn-search-matches")!.hidden).toBe(true);
    expect(picker.byTestId("sandbox-spawn-search-pick")!.disabled).toBe(true);
    expect(picker.message("sandbox-spawn-search").textContent).toBe("Type a name or an ID to search npcname-e.");
    expect(picker.nameIndexReads).toEqual([]);
  });

  it("shows the table catalog status with its reason for a missing name index and keeps ID entry working", async () => {
    const picker = mountPicker("spawn", { catalog: { "table:npcname-e": converted("table:npcname-e") } });
    await picker.submit("sandbox-spawn-search", { query: "Gremlin" });
    expect(picker.message("sandbox-spawn-search").textContent)
      .toBe("table:npcname_e_names not in catalog: no tables record in the served catalog; table:npcname-e converted. ID entry still works.");
    expect(picker.byTestId("sandbox-spawn-search-matches")!.hidden).toBe(true);
    await picker.submit("sandbox-spawn-npc", { npcId: "20001" });
    expect(picker.fakeHost.dispatched).toEqual([{ type: "spawn-npc", npcId: 20001 }]);
    expect(picker.note("sandbox-spawn-note")).toBe("npc:20001 not in catalog");
  });

  it("exposes the query, selection, lookup and match limit as hover-card variables", async () => {
    const picker = mountPicker("spawn", { catalog: npcCatalog, nameIndexes: { "npcname-e": npcNameIndex } });
    await picker.submit("sandbox-spawn-search", { query: "Gremlin" });
    await picker.pick("sandbox-spawn-search", 0);
    const variables = Object.fromEntries(picker.variables("sandbox-spawn-npc").map(variable => [variable.name, variable]));
    expect(variables["sandbox.spawn.query"]?.value()).toBe("Gremlin");
    expect(variables["sandbox.spawn.selected"]?.value()).toBe("npc:20001");
    expect(variables["sandbox.spawn.lookup"]?.value()).toBe("npc:20001 converted");
    expect(variables["sandbox.spawn.lookup"]?.status).toBe("native");
    expect(variables["sandbox.spawn.nameIndex"]?.value()).toBe("converted: 4 entries");
    expect(variables["sandbox.spawn.matchLimit"]?.status).toBe("presentation");
  });

  it("puts decoded names into option text only, never markup", async () => {
    const markup: NativeTableNameIndexRead = { ...npcNameIndex, entries: nameEntries([[[1], "<img src=x onerror=alert(1)>"]]) };
    const picker = mountPicker("spawn", { nameIndexes: { "npcname-e": markup } });
    await picker.submit("sandbox-spawn-search", { query: "img" });
    const select = picker.byTestId("sandbox-spawn-search-matches")!.querySelector("select")!;
    expect(select.querySelectorAll("img")).toEqual([]);
    expect(picker.options("sandbox-spawn-search")).toEqual(["<img src=x onerror=alert(1)> (npc:1 not in catalog)"]);
  });

  it("releases once: a second release is a no-op and no picker node or action remains", async () => {
    const picker = mountPicker("spawn", { nameIndexes: { "npcname-e": npcNameIndex } });
    const form = picker.byTestId("sandbox-spawn-npc")!;
    form.querySelector('[data-testid="sandbox-spawn-npc-npcId"]')!.value = "1";
    const documentListenersBefore = dom.document.listenerCount("keydown");
    picker.release();
    picker.release();
    expect(picker.groupElement.children).toHaveLength(picker.childCountBefore);
    expect(form.isConnected).toBe(false);
    fire(form, "submit");
    await settle();
    expect(picker.fakeHost.dispatched).toEqual([]);
    expect(dom.document.listenerCount("keydown")).toBe(documentListenersBefore);
  });

  it("drops earlier matches when a later read fails because the signal aborted", async () => {
    const controller = new AbortController();
    let rejectPendingRead: (reason: unknown) => void = () => undefined;
    const reads = [Promise.resolve(npcNameIndex), new Promise<NativeTableNameIndexRead>((_, reject) => { rejectPendingRead = reject; })];
    const picker = mountPicker("spawn", { signal: controller.signal, readNameIndex: async () => reads.shift()! });
    await picker.submit("sandbox-spawn-search", { query: "Gremlin" });
    expect(picker.options("sandbox-spawn-search")).toHaveLength(2);
    const pendingSearch = picker.submit("sandbox-spawn-search", { query: "Grocer" });
    controller.abort();
    rejectPendingRead(new DOMException("aborted", "AbortError"));
    await pendingSearch;
    await settle();
    expect(picker.byTestId("sandbox-spawn-search-matches")!.hidden).toBe(true);
    expect(picker.options("sandbox-spawn-search")).toEqual([]);
    expect(picker.message("sandbox-spawn-search").textContent).toBe("npcname-e name index read stopped.");
    expect(picker.variables("sandbox-spawn-search").find(variable => variable.name === "sandbox.spawn.nameIndex")?.value()).toBe("read stopped");
  });
});
