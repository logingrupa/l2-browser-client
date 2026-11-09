import { skillCatalogKey, type NativeCatalogIndex } from "../assets/native/nativeCatalogIndex";
import { reviewedPowerStrikeSkill } from "../effects/castSkillIndex";
import type { NativePowerStrikePreview } from "../effects/nativePowerStrikePreview";
import type { DevSection } from "../ui/devSheet/DevSheet";
import type { SandboxPickerContext } from "../ui/devSheet/sandboxPickerHost";
import { sandboxPickerSections } from "../ui/devSheet/sandboxPickerRegistry";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { WorldEvent } from "../world/worldTypes";

export interface SandboxCommandSheetContext {
  readonly section: DevSection;
  readonly adapter: Pick<GameWorldAdapter, "subscribe">;
  readonly pickerContext: SandboxPickerContext;
  readonly indexFailure: string | null;
  readonly powerStrike: Pick<NativePowerStrikePreview, "start"> | null;
}

const sectionsWithAttachedPickers = new WeakSet<DevSection>();

function startsStagedPowerStrike(index: NativeCatalogIndex, event: Extract<WorldEvent, { type: "skill-cast" }>): boolean {
  if (event.skillId !== reviewedPowerStrikeSkill.skillId || event.level !== reviewedPowerStrikeSkill.level) return false;
  return index.lookup(skillCatalogKey(event.skillId, event.level)).status === "converted";
}

export function attachSandboxCommandSheet(context: SandboxCommandSheetContext): () => void {
  const { section, pickerContext, powerStrike } = context;
  if (sectionsWithAttachedPickers.has(section)) throw new Error("The sandbox pickers are already attached to this section.");
  sectionsWithAttachedPickers.add(section);
  if (context.indexFailure !== null) {
    section.group("catalog-index", "Catalog index").note(`Catalog index unavailable: ${context.indexFailure}`,
      { tone: "warning", testId: "sandbox-catalog-index-failure" });
  }
  const releases = sandboxPickerSections.map(picker => picker.attach(section.group(picker.id, picker.title), pickerContext));
  releases.push(context.adapter.subscribe(event => {
    if (event.type === "skill-cast" && powerStrike && startsStagedPowerStrike(pickerContext.catalogIndex, event)) void powerStrike.start();
  }));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const release of releases.reverse()) release();
    sectionsWithAttachedPickers.delete(section);
  };
}
