import { vi } from "vitest";
import { DevSheet, type DevSection } from "../../../src/ui/devSheet/DevSheet";
import type { NativeCatalogIndex, NativeCatalogLookup } from "../../../src/assets/native/nativeCatalogIndex";
import { attachSandboxCommandSheet } from "../../../src/runtime/attachSandboxCommandSheet";
import type { WorldCommand, WorldEntity, WorldEvent } from "../../../src/world/worldTypes";
import { fakeMedia, fire, type FakeElement, type MiniDom } from "./miniDom";

export function fakeCatalogIndexOver(lookups: ReadonlyMap<string, NativeCatalogLookup>): NativeCatalogIndex {
  return {
    lookup: key => lookups.get(key) ?? { status: "not-in-catalog", key,
      reason: key.startsWith("window:") ? "interface windows are not converted yet (UI-01)" : "not in catalog" },
    keys: prefix => [...lookups.keys()].filter(key => key.startsWith(prefix)),
  };
}

export function createSandboxSection(dom: MiniDom): { readonly sheet: DevSheet; readonly section: DevSection } {
  const host = dom.document.createElement("section"); host.className = "world-interface";
  const canvas = dom.document.createElement("canvas");
  const toggle = dom.document.createElement("button");
  host.append(toggle); dom.document.body.append(canvas, host);
  host.rect = { left: 0, top: 0, width: 1280, height: 800 };
  const sheet = new DevSheet({ host: host as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement,
    toggle: toggle as unknown as HTMLButtonElement, worldTargets: [canvas] as unknown as EventTarget[], storage: null, matchMedia: fakeMedia().matchMedia });
  return { sheet, section: sheet.section("sandbox", { title: "Sandbox" }) };
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

export interface SandboxSheetFakeOptions {
  readonly index: NativeCatalogIndex;
  readonly selectedEntityId?: string | null;
  readonly indexFailure?: string | null;
  readonly adapterAcceptsCommands?: boolean;
  readonly activePlayerProfileId?: string;
}

export function attachSandboxSheetWithFakes(dom: MiniDom, options: SandboxSheetFakeOptions) {
  const { index, selectedEntityId = "native-musveren", indexFailure = null, adapterAcceptsCommands = true,
    activePlayerProfileId = "human-male-fighter" } = options;
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
  const { sheet, section } = createSandboxSection(dom);
  const release = attachSandboxCommandSheet({ section, adapter, index, indexFailure, appearanceOfNpc: () => ({ appearanceId: "native-musveren" }),
    selectedEntityId: () => selectedEntityId, activePlayerProfileId, powerStrike });
  const panel = section.element as unknown as FakeElement;
  const submit = (testId: string, values: Record<string, string>) => {
    const form = panel.querySelector(`[data-testid="${testId}"]`)!;
    for (const [name, value] of Object.entries(values)) form.querySelector(`[data-testid="${testId}-${name}"]`)!.value = value;
    fire(form, "submit");
  };
  const note = (testId: string) => panel.querySelectorAll(`[data-testid="${testId}-note"]`);
  return { sheet, dispatched, listeners, powerStrike, release, submit, note, panel };
}
