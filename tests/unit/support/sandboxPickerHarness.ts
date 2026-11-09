import { afterEach, beforeEach } from "vitest";
import { createNativeClipPreviewHub, type NativeClipPreviewHub } from "../../../src/assets/native/nativeClipPreview";
import type { NativeCatalogIndex, NativeCatalogLookup } from "../../../src/assets/native/nativeCatalogIndex";
import { DevSheet } from "../../../src/ui/devSheet/DevSheet";
import type { DevGroup } from "../../../src/ui/devSheet/devSheetParts";
import type { SandboxActionOutcome, SandboxPickerContext } from "../../../src/ui/devSheet/sandboxPickerHost";
import { sandboxPickerSections, type SandboxPickerFactory } from "../../../src/ui/devSheet/sandboxPickerRegistry";
import type { NativeTableNameEntry, NativeTableNameIndexRead } from "../../../src/ui/nativeTables/readNativeTableNameIndex";
import type { WorldCommand } from "../../../src/world/worldTypes";
import { fakeMedia, fire, installMiniDom, type FakeElement, type MiniDom } from "./miniDom";

export type CatalogEntries = Readonly<Record<string, NativeCatalogLookup>>;

export function converted(key: string, record: Record<string, unknown> = {}): NativeCatalogLookup {
  return { status: "converted", key, record: record as never };
}

export function nameEntries(rows: readonly (readonly [readonly number[], string])[]): NativeTableNameEntry[] {
  return rows.map(([identifiers, name], sourceOrder) => ({ identifiers, name, sourceOrder }));
}

export async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

function fakeCatalogIndex(entries: CatalogEntries): NativeCatalogIndex {
  return {
    lookup: key => entries[key] ?? { status: "not-in-catalog", key, reason: "not in catalog" },
    keys: prefix => Object.keys(entries).filter(key => key.startsWith(prefix)).sort(),
  };
}

interface FakeHost {
  readonly dispatched: WorldCommand[];
  readonly reloadedTiles: string[];
  readonly openedWindows: string[];
}

export interface MountOptions {
  readonly catalog?: CatalogEntries;
  readonly nameIndexes?: Readonly<Record<string, NativeTableNameIndexRead>>;
  readonly readNameIndex?: (tableId: string) => Promise<NativeTableNameIndexRead>;
  readonly selectedEntityId?: string | null;
  readonly currentTileId?: string | null;
  readonly reloadOutcome?: SandboxActionOutcome;
  readonly windowOutcome?: Promise<SandboxActionOutcome>;
  readonly signal?: AbortSignal;
  readonly clipHub?: NativeClipPreviewHub;
}

function fakePickerContext(options: MountOptions, fakeHost: FakeHost, nameIndexReads: string[]): SandboxPickerContext {
  const clipHub = options.clipHub ?? createNativeClipPreviewHub();
  return {
    host: {
      dispatch: command => {
        fakeHost.dispatched.push(command);
        if (command.type === "play-clip") clipHub.play(command.entityId, command.clipName);
      },
      reloadTile: tileId => { fakeHost.reloadedTiles.push(tileId); return options.reloadOutcome ?? { tone: "info", text: `tile:${tileId} reloaded` }; },
      openWindow: windowId => { fakeHost.openedWindows.push(windowId); return options.windowOutcome ?? Promise.resolve({ tone: "info", text: `${windowId} opened` }); },
      actorClipEntityIds: () => clipHub.actorClipEntityIds(),
      actorClipListing: entityId => clipHub.actorClipListing(entityId),
      previewing: entityId => clipHub.previewing(entityId),
    },
    catalogIndex: fakeCatalogIndex(options.catalog ?? {}),
    readNameIndex: async tableId => {
      nameIndexReads.push(tableId);
      if (options.readNameIndex) return options.readNameIndex(tableId);
      return options.nameIndexes?.[tableId]
        ?? { status: "not-in-catalog", key: `table:${tableId.replace(/-/g, "_")}_names`, reason: "no tables record in the served catalog" };
    },
    selectedEntityId: () => options.selectedEntityId ?? null,
    currentTileId: () => options.currentTileId ?? null,
    signal: options.signal ?? new AbortController().signal,
  };
}

export function createPickerHarness() {
  let dom: MiniDom;
  const sheets: DevSheet[] = [];
  beforeEach(() => { dom = installMiniDom(); });
  afterEach(() => { for (const sheet of sheets.splice(0)) sheet.dispose(); dom.restore(); });

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
    const groupElement = group.element as unknown as FakeElement;
    const childCountBefore = groupElement.children.length;
    const release = factory.attach(group, fakePickerContext(options, fakeHost, nameIndexReads));
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
    const optionTexts = (testId: string) => byTestId(testId)!.querySelectorAll("option").map(option => option.textContent);
    const matchTexts = (searchTestId: string) => optionTexts(`${searchTestId}-matches`);
    const message = (testId: string) => byTestId(`${testId}-message`)!;
    const note = (testId: string) => byTestId(testId)?.textContent ?? null;
    const variables = (testId: string) => sheet.cards.info(byTestId(testId) as unknown as Element)?.variables?.() ?? [];
    return { groupElement, childCountBefore, release, fakeHost, nameIndexReads, byTestId, submit, pick, optionTexts, matchTexts, message, note, variables };
  }

  return { mountPicker, document: () => dom.document };
}

export type MountedPicker = ReturnType<ReturnType<typeof createPickerHarness>["mountPicker"]>;
