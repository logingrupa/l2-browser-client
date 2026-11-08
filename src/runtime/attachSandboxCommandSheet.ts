import {
  describeNativeCatalogLookup, itemCatalogKey, skillCatalogKey, windowCatalogKey, type NativeCatalogIndex, type NativeCatalogLookup,
} from "../assets/native/nativeCatalogIndex";
import { powerStrikeEffectBundleId } from "../effects/nativeEffectComponents";
import type { NativePowerStrikePreview } from "../effects/nativePowerStrikePreview";
import type { DevGroup, DevSection } from "../ui/devSheet/DevSheet";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { EquipmentSlot, WorldEvent } from "../world/worldTypes";
import { resolveSandboxNpcPresentation, type SandboxAppearanceOfModel, type SandboxNpcPresentation } from "./sandboxNpcVisual";

export interface SandboxCommandSheetContext {
  readonly section: DevSection;
  readonly adapter: Pick<GameWorldAdapter, "dispatch" | "subscribe">;
  readonly index: NativeCatalogIndex;
  readonly indexFailure: string | null;
  readonly appearanceOfModel: SandboxAppearanceOfModel;
  readonly selectedEntityId: () => string | null;
  readonly powerStrike: Pick<NativePowerStrikePreview, "start"> | null;
}

type SubmittedValues = Readonly<Record<string, number | string>>;
type ResultTone = "info" | "warning";

const catalogIndexSource = "native catalog index over /l2/catalog.json";
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

function createResultNote(group: DevGroup, testId: string): (text: string, tone: ResultTone) => void {
  let current: HTMLParagraphElement | null = null;
  return (text, tone) => {
    current?.remove();
    current = group.note(text, { tone, testId });
  };
}

function lookupTone(lookup: NativeCatalogLookup): ResultTone {
  return lookup.status === "converted" ? "info" : "warning";
}

function describeSpawnPresentation(presentation: SandboxNpcPresentation): string {
  return "missingAssetDiagnostic" in presentation ? presentation.missingAssetDiagnostic
    : `${presentation.key} converted, model ${presentation.modelCatalogId}`;
}

function attachSpawnNpcGroup(context: SandboxCommandSheetContext): void {
  const group = context.section.group("spawn-npc", "Spawn NPC");
  const showResult = createResultNote(group, "sandbox-spawn-npc-note");
  let lastSpawn: SandboxNpcPresentation | null = null;
  group.idEntry({
    label: "Spawn NPC", testId: "sandbox-spawn-npc", submitText: "Spawn",
    fields: [{ name: "npcId", label: "NPC ID", kind: "integer", minimum: 0 }],
    hint: "Dispatches spawn-npc through the adapter. The body comes from the catalog; an ID without a converted model shows a label-only marker.",
    variables: () => [
      { name: "sandbox.lastKey", value: () => lastSpawn?.key ?? "none", values: "npc:<id>", source: "npcCatalogKey over the submitted integer ID", status: "native" },
      { name: "sandbox.lastLookup", value: () => lastSpawn ? describeSpawnPresentation(lastSpawn) : "none", values: "converted | not in catalog",
        source: catalogIndexSource, status: "native" },
    ],
    onSubmit: values => {
      const npcId = submittedInteger(values, "npcId");
      context.adapter.dispatch({ type: "spawn-npc", npcId });
      lastSpawn = resolveSandboxNpcPresentation(context.index, npcId, context.appearanceOfModel);
      showResult(describeSpawnPresentation(lastSpawn), "missingAssetDiagnostic" in lastSpawn ? "warning" : "info");
    },
  });
}

function attachEquipItemGroup(context: SandboxCommandSheetContext): void {
  const group = context.section.group("equip-item", "Equip item");
  const showResult = createResultNote(group, "sandbox-equip-item-note");
  let lastLookup: NativeCatalogLookup | null = null;
  group.idEntry({
    label: "Equip item", testId: "sandbox-equip-item", submitText: "Equip",
    fields: [{ name: "itemId", label: "Item ID", kind: "integer", minimum: 0 }],
    hint: "Dispatches equip-item for the local player through the adapter and reports whether the item is converted.",
    variables: () => [
      { name: "sandbox.equip.slot", value: () => sandboxEquipmentSlot, values: sandboxEquipmentSlot,
        source: `${catalogIndexSource}: staged items are upper body only; other slots need decoded item data (DATA-01)`, status: "presentation" },
      { name: "sandbox.equip.lastKey", value: () => lastLookup ? describeNativeCatalogLookup(lastLookup) : "none", values: "item:<id>",
        source: catalogIndexSource, status: "native" },
    ],
    onSubmit: values => {
      const itemId = submittedInteger(values, "itemId");
      context.adapter.dispatch({ type: "equip-item", slot: sandboxEquipmentSlot, itemId });
      lastLookup = context.index.lookup(itemCatalogKey(itemId));
      showResult(describeNativeCatalogLookup(lastLookup), lookupTone(lastLookup));
    },
  });
}

function attachCastSkillGroup(context: SandboxCommandSheetContext): void {
  const group = context.section.group("cast-skill", "Cast skill");
  const showResult = createResultNote(group, "sandbox-cast-skill-note");
  let lastLookup: NativeCatalogLookup | null = null;
  group.idEntry({
    label: "Cast skill", testId: "sandbox-cast-skill", submitText: "Cast",
    fields: [{ name: "skillId", label: "Skill ID", kind: "integer", minimum: 0 }, { name: "level", label: "Level", kind: "integer", minimum: 1 }],
    hint: "Dispatches cast-skill through the adapter on the selected entity. A cast of a converted skill plays its staged effect.",
    variables: () => [
      { name: "sandbox.cast.target", value: () => context.selectedEntityId() ?? "none", values: "selected entity id | none",
        source: "entity registry selection", status: "presentation" },
      { name: "sandbox.cast.lastKey", value: () => lastLookup ? describeNativeCatalogLookup(lastLookup) : "none", values: "skill:<id>:<level>",
        source: catalogIndexSource, status: "native" },
    ],
    onSubmit: values => {
      const skillId = submittedInteger(values, "skillId"), level = submittedInteger(values, "level");
      const targetId = context.selectedEntityId();
      context.adapter.dispatch({ type: "cast-skill", skillId, level, ...(targetId === null ? {} : { targetId }) });
      lastLookup = context.index.lookup(skillCatalogKey(skillId, level));
      showResult(describeNativeCatalogLookup(lastLookup), lookupTone(lastLookup));
    },
  });
}

function attachOpenWindowGroup(context: SandboxCommandSheetContext): void {
  const group = context.section.group("open-window", "Open window");
  const showResult = createResultNote(group, "sandbox-open-window-note");
  let lastLookup: NativeCatalogLookup | null = null;
  group.idEntry({
    label: "Open window", testId: "sandbox-open-window", submitText: "Open",
    fields: [{ name: "name", label: "Window", kind: "name" }],
    hint: "Looks up an interface window by name. Windows are a client sheet action and never go through the adapter.",
    variables: () => [
      { name: "sandbox.window.lastKey", value: () => lastLookup ? describeNativeCatalogLookup(lastLookup) : "none", values: "window:<name>",
        source: catalogIndexSource, status: "native" },
    ],
    onSubmit: values => {
      lastLookup = context.index.lookup(windowCatalogKey(submittedName(values, "name")));
      showResult(describeNativeCatalogLookup(lastLookup), lookupTone(lastLookup));
    },
  });
}

function startsStagedPowerStrike(index: NativeCatalogIndex, event: Extract<WorldEvent, { type: "skill-cast" }>): boolean {
  const lookup = index.lookup(skillCatalogKey(event.skillId, event.level));
  return lookup.status === "converted" && "effectComponentId" in lookup.record && lookup.record.effectComponentId === powerStrikeEffectBundleId;
}

export function attachSandboxCommandSheet(context: SandboxCommandSheetContext): () => void {
  if (context.indexFailure !== null) {
    context.section.group("catalog-index", "Catalog index").note(`Catalog index unavailable: ${context.indexFailure}`,
      { tone: "warning", testId: "sandbox-catalog-index-failure" });
  }
  attachSpawnNpcGroup(context);
  attachEquipItemGroup(context);
  attachCastSkillGroup(context);
  attachOpenWindowGroup(context);
  const { powerStrike } = context;
  return context.adapter.subscribe(event => {
    if (event.type === "skill-cast" && powerStrike && startsStagedPowerStrike(context.index, event)) void powerStrike.start();
  });
}
