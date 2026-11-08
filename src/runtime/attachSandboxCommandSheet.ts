import type { NativeCatalogIndex } from "../assets/native/nativeCatalogIndex";
import type { DevGroup, DevSection } from "../ui/devSheet/DevSheet";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import { resolveSandboxNpcPresentation, type SandboxAppearanceOfModel, type SandboxNpcPresentation } from "./sandboxNpcVisual";

export interface SandboxCommandSheetContext {
  readonly section: DevSection;
  readonly adapter: Pick<GameWorldAdapter, "dispatch" | "subscribe">;
  readonly index: NativeCatalogIndex;
  readonly appearanceOfModel: SandboxAppearanceOfModel;
}

type SubmittedValues = Readonly<Record<string, number | string>>;
type ResultTone = "info" | "warning";

const catalogIndexSource = "native catalog index over /l2/catalog.json";

function submittedInteger(values: SubmittedValues, name: string): number {
  const value = values[name];
  if (typeof value !== "number") throw new Error(`Sandbox field ${name} was not submitted as an integer.`);
  return value;
}

function createResultNote(group: DevGroup, testId: string): (text: string, tone: ResultTone) => void {
  let current: HTMLParagraphElement | null = null;
  return (text, tone) => {
    current?.remove();
    current = group.note(text, { tone, testId });
  };
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

export function attachSandboxCommandSheet(context: SandboxCommandSheetContext): void {
  attachSpawnNpcGroup(context);
}
