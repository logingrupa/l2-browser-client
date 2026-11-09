import {
  itemCatalogKey, npcCatalogKey, skillCatalogKey, windowCatalogKey, type NativeCatalogIndex, type NativeCatalogLookup,
} from "../assets/native/nativeCatalogIndex";
import { reviewedPowerStrikeSkill } from "../effects/castSkillIndex";
import type { NativePowerStrikePreview } from "../effects/nativePowerStrikePreview";
import type { DevGroup, DevSection } from "../ui/devSheet/DevSheet";
import type { VariableInfo } from "../ui/devSheet/types";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { EquipmentSlot, WorldCommand, WorldEvent } from "../world/worldTypes";
import { describeSandboxCatalogLookup } from "./sandboxCatalogLookupNote";
import { resolveSandboxNpcPresentation, type SandboxAppearanceOfNpc } from "./sandboxNpcVisual";

type SandboxCommandAdapter = Pick<GameWorldAdapter, "dispatch" | "subscribe">;

export interface SandboxCommandSheetContext {
  readonly section: DevSection;
  readonly adapter: SandboxCommandAdapter;
  readonly index: NativeCatalogIndex;
  readonly indexFailure: string | null;
  readonly appearanceOfNpc: SandboxAppearanceOfNpc;
  readonly selectedEntityId: () => string | null;
  readonly activePlayerProfileId: string;
  readonly powerStrike: Pick<NativePowerStrikePreview, "start"> | null;
}

type SubmittedValues = Readonly<Record<string, number | string>>;
type ResultTone = "info" | "warning";
type ShowResult = (text: string, tone: ResultTone) => void;

interface SandboxLastLookup { current: NativeCatalogLookup | null }

const catalogIndexSource = "nativeCatalogIndex over /l2/catalog.json and the gap rows of /l2/coverage.json";
const sandboxEquipmentSlot: EquipmentSlot = "upper";

function submittedInteger(values: SubmittedValues, name: string): number {
  const value = values[name];
  if (typeof value !== "number") throw new Error(`Sandbox field ${name} was not submitted as an integer.`);
  return value;
}

function submittedName(values: SubmittedValues, name: string): string {
  const value = values[name];
  if (typeof value !== "string") throw new Error(`Sandbox field ${name} was not submitted as a name.`);
  return value;
}

function dispatchAndObserveAcceptance(adapter: SandboxCommandAdapter, command: WorldCommand, isAcceptance: (event: WorldEvent) => boolean): boolean {
  let accepted = false;
  const unsubscribe = adapter.subscribe(event => { if (isAcceptance(event)) accepted = true; });
  try { adapter.dispatch(command); } finally { unsubscribe(); }
  return accepted;
}

function createResultNote(group: DevGroup, testId: string): ShowResult {
  let current: HTMLParagraphElement | null = null;
  return (text, tone) => {
    current?.remove();
    current = group.note(text, { tone, testId });
  };
}

function describeLookupStatusAndReason(lookup: NativeCatalogLookup): string {
  return lookup.status === "converted" ? "converted" : `${lookup.status}: ${lookup.reason}`;
}

function lastLookupVariables(lastLookup: SandboxLastLookup): VariableInfo[] {
  return [
    { name: "sandbox.lastKey", value: () => lastLookup.current?.key ?? "none", values: "npc:<id> | item:<id> | skill:<id>:<level> | window:<name>",
      source: "npcCatalogKey, itemCatalogKey, skillCatalogKey or windowCatalogKey over the last submitted ID", status: "native" },
    { name: "sandbox.lastLookup", value: () => lastLookup.current ? describeLookupStatusAndReason(lastLookup.current) : "none",
      values: "converted | gap: <coverage reason> | not-in-catalog: <reason>", source: catalogIndexSource, status: "native" },
  ];
}

function showEquipLookupForActiveProfile(showResult: ShowResult, lookup: NativeCatalogLookup, activePlayerProfileId: string): void {
  if (lookup.status === "converted" && "playerProfileIds" in lookup.record && !lookup.record.playerProfileIds.includes(activePlayerProfileId)) {
    showResult(`${lookup.key} converted for ${lookup.record.playerProfileIds.join(", ")}, not for ${activePlayerProfileId}`, "warning");
    return;
  }
  const note = describeSandboxCatalogLookup(lookup);
  showResult(note.text, note.tone);
}

function attachSpawnNpcGroup(context: SandboxCommandSheetContext, lastLookup: SandboxLastLookup): void {
  const group = context.section.group("spawn-npc", "Spawn NPC");
  const showResult = createResultNote(group, "sandbox-spawn-npc-note");
  group.idEntry({
    label: "Spawn NPC", testId: "sandbox-spawn-npc", submitText: "Spawn",
    fields: [{ name: "npcId", label: "NPC ID", kind: "integer", minimum: 0 }],
    hint: "Dispatches spawn-npc through the adapter. The body comes from the catalog; an ID without a converted model shows a label-only marker.",
    variables: () => lastLookupVariables(lastLookup),
    onSubmit: values => {
      const npcId = submittedInteger(values, "npcId");
      const accepted = dispatchAndObserveAcceptance(context.adapter, { type: "spawn-npc", npcId },
        event => event.type === "spawn" && event.entity.npcId === npcId);
      const lookup = context.index.lookup(npcCatalogKey(npcId));
      lastLookup.current = lookup;
      const presentation = resolveSandboxNpcPresentation(context.index, npcId, context.appearanceOfNpc);
      const note = describeSandboxCatalogLookup(lookup);
      if (!accepted) showResult(`${lookup.key}: spawn rejected by the adapter`, "warning");
      else if (lookup.status === "converted" && "missingAssetDiagnostic" in presentation) showResult(presentation.missingAssetDiagnostic, "warning");
      else showResult(note.text, note.tone);
    },
  });
}

function attachEquipItemGroup(context: SandboxCommandSheetContext, lastLookup: SandboxLastLookup): void {
  const group = context.section.group("equip-item", "Equip item");
  const showResult = createResultNote(group, "sandbox-equip-item-note");
  group.idEntry({
    label: "Equip item", testId: "sandbox-equip-item", submitText: "Equip",
    fields: [{ name: "itemId", label: "Item ID", kind: "integer", minimum: 0 }],
    hint: "Dispatches equip-item for the local player through the adapter and reports whether the item is converted for the loaded character.",
    variables: () => [
      { name: "sandbox.equip.slot", value: () => sandboxEquipmentSlot, values: sandboxEquipmentSlot,
        source: `${catalogIndexSource}: staged items are upper body only; other slots need decoded item data (DATA-01)`, status: "presentation" },
      ...lastLookupVariables(lastLookup),
    ],
    onSubmit: values => {
      const itemId = submittedInteger(values, "itemId");
      const accepted = dispatchAndObserveAcceptance(context.adapter, { type: "equip-item", slot: sandboxEquipmentSlot, itemId },
        event => event.type === "update" && event.entity.id === "local-player" && event.entity.equipment?.[sandboxEquipmentSlot] === itemId);
      const lookup = context.index.lookup(itemCatalogKey(itemId));
      lastLookup.current = lookup;
      if (!accepted) showResult(`${lookup.key}: equip rejected by the adapter`, "warning");
      else showEquipLookupForActiveProfile(showResult, lookup, context.activePlayerProfileId);
    },
  });
}

function attachCastSkillGroup(context: SandboxCommandSheetContext, lastLookup: SandboxLastLookup): void {
  const group = context.section.group("cast-skill", "Cast skill");
  const showResult = createResultNote(group, "sandbox-cast-skill-note");
  group.idEntry({
    label: "Cast skill", testId: "sandbox-cast-skill", submitText: "Cast",
    fields: [{ name: "skillId", label: "Skill ID", kind: "integer", minimum: 0 }, { name: "level", label: "Level", kind: "integer", minimum: 1 }],
    hint: "Dispatches cast-skill through the adapter on the selected entity. A cast of a converted skill plays its staged effect.",
    variables: () => [
      { name: "sandbox.cast.target", value: () => context.selectedEntityId() ?? "none", values: "selected entity id | none",
        source: "entity registry selection", status: "presentation" },
      ...lastLookupVariables(lastLookup),
    ],
    onSubmit: values => {
      const skillId = submittedInteger(values, "skillId"), level = submittedInteger(values, "level");
      const targetId = context.selectedEntityId();
      const accepted = dispatchAndObserveAcceptance(context.adapter, { type: "cast-skill", skillId, level, ...(targetId === null ? {} : { targetId }) },
        event => event.type === "skill-cast" && event.skillId === skillId && event.level === level);
      const lookup = context.index.lookup(skillCatalogKey(skillId, level));
      lastLookup.current = lookup;
      const note = describeSandboxCatalogLookup(lookup);
      if (!accepted) showResult(`${lookup.key}: cast rejected by the adapter`, "warning");
      else showResult(note.text, note.tone);
    },
  });
}

function attachOpenWindowGroup(context: SandboxCommandSheetContext, lastLookup: SandboxLastLookup): void {
  const group = context.section.group("open-window", "Open window");
  const showResult = createResultNote(group, "sandbox-open-window-note");
  group.idEntry({
    label: "Open window", testId: "sandbox-open-window", submitText: "Open",
    fields: [{ name: "name", label: "Window", kind: "name" }],
    hint: "Looks up an interface window by name. Windows are a client sheet action and never go through the adapter.",
    variables: () => lastLookupVariables(lastLookup),
    onSubmit: values => {
      const lookup = context.index.lookup(windowCatalogKey(submittedName(values, "name")));
      lastLookup.current = lookup;
      const note = describeSandboxCatalogLookup(lookup);
      showResult(note.text, note.tone);
    },
  });
}

function startsStagedPowerStrike(index: NativeCatalogIndex, event: Extract<WorldEvent, { type: "skill-cast" }>): boolean {
  if (event.skillId !== reviewedPowerStrikeSkill.skillId || event.level !== reviewedPowerStrikeSkill.level) return false;
  return index.lookup(skillCatalogKey(event.skillId, event.level)).status === "converted";
}

export function attachSandboxCommandSheet(context: SandboxCommandSheetContext): () => void {
  if (context.indexFailure !== null) {
    context.section.group("catalog-index", "Catalog index").note(`Catalog index unavailable: ${context.indexFailure}`,
      { tone: "warning", testId: "sandbox-catalog-index-failure" });
  }
  const lastLookup: SandboxLastLookup = { current: null };
  attachSpawnNpcGroup(context, lastLookup);
  attachEquipItemGroup(context, lastLookup);
  attachCastSkillGroup(context, lastLookup);
  attachOpenWindowGroup(context, lastLookup);
  const { powerStrike } = context;
  return context.adapter.subscribe(event => {
    if (event.type === "skill-cast" && powerStrike && startsStagedPowerStrike(context.index, event)) void powerStrike.start();
  });
}
