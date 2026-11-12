import { skillCatalogKey } from "../assets/native/nativeCatalogIndex";
import type { SkillCastEvent, SkillCastPresentation } from "../effects/skillCastPresentation";
import type { DevGroup, DevSection } from "../ui/devSheet/DevSheet";
import type { SandboxPickerContext } from "../ui/devSheet/sandboxPickerHost";
import { sandboxPickerSections } from "../ui/devSheet/sandboxPickerRegistry";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import {
  sandboxSkillCastFailureNote, sandboxSkillCastInspectionNote, sandboxSkillCastUnavailableNote, type SandboxSkillCastNote,
} from "./sandboxSkillCastNote";

export interface SandboxCommandSheetContext {
  readonly section: DevSection;
  readonly adapter: Pick<GameWorldAdapter, "subscribe">;
  readonly pickerContext: SandboxPickerContext;
  readonly indexFailure: string | null;
  readonly skillCast: Pick<SkillCastPresentation, "present"> | null;
  readonly skillCastFailure: string | null;
}

const sectionsWithAttachedPickers = new WeakSet<DevSection>();
const skillCastNoteTestId = "sandbox-skill-cast-note";

function presentSkillCastsIntoNote(group: DevGroup, context: SandboxCommandSheetContext, isAttached: () => boolean) {
  let note: HTMLParagraphElement | null = null, latestCast = 0;
  const show = (cast: number, shown: SandboxSkillCastNote) => {
    if (!isAttached() || cast !== latestCast) return;
    note?.remove();
    note = group.note(shown.text, { tone: shown.tone, testId: skillCastNoteTestId });
  };
  return {
    present(event: SkillCastEvent) {
      const cast = ++latestCast, key = skillCatalogKey(event.skillId, event.level);
      if (!context.skillCast) { show(cast, sandboxSkillCastUnavailableNote(key, context.skillCastFailure ?? "no skill cast presentation")); return; }
      void context.skillCast.present(event).then(
        inspection => show(cast, sandboxSkillCastInspectionNote(inspection, context.pickerContext.catalogIndex)),
        failure => show(cast, sandboxSkillCastFailureNote(key, failure)));
    },
    release() { note?.remove(); note = null; },
  };
}

export function attachSandboxCommandSheet(context: SandboxCommandSheetContext): () => void {
  const { section, pickerContext } = context;
  if (sectionsWithAttachedPickers.has(section)) throw new Error("The sandbox pickers are already attached to this section.");
  sectionsWithAttachedPickers.add(section);
  if (context.indexFailure !== null) {
    section.group("catalog-index", "Catalog index").note(`Catalog index unavailable: ${context.indexFailure}`,
      { tone: "warning", testId: "sandbox-catalog-index-failure" });
  }
  let released = false;
  const releases = sandboxPickerSections.map(picker => picker.attach(section.group(picker.id, picker.title), pickerContext));
  const skillCasts = presentSkillCastsIntoNote(section.group("skill-cast", "Skill cast presentation"), context, () => !released);
  releases.push(() => skillCasts.release());
  releases.push(context.adapter.subscribe(event => {
    if (event.type === "skill-cast") skillCasts.present(event);
  }));
  return () => {
    if (released) return;
    released = true;
    for (const release of releases.reverse()) release();
    sectionsWithAttachedPickers.delete(section);
  };
}
