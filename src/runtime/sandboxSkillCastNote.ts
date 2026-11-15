import { describeNativeCatalogLookup, type NativeCatalogIndex } from "../assets/native/nativeCatalogIndex";
import type { SkillCastInspection } from "../effects/skillCastPresentation";

export interface SandboxSkillCastNote {
  readonly text: string;
  readonly tone: "info" | "warning";
}

function listedOrNone(entries: readonly string[]): string {
  return entries.length === 0 ? "none" : entries.join(", ");
}

function placementGaps(inspection: SkillCastInspection): string {
  const gaps = inspection.placements.filter(placement => placement.unappliedFields.length > 0)
    .map(placement => `${placement.actorObject} ${placement.side} ${placement.unappliedFields.join(", ")}`);
  return gaps.length === 0 ? "none" : gaps.join("; ");
}

function hasGaps(inspection: SkillCastInspection): boolean {
  return inspection.emitterActors === 0 || inspection.notDrawn.length > 0 || inspection.featureGaps.length > 0 ||
    inspection.namedGaps.length > 0 || inspection.placements.some(placement => placement.unappliedFields.length > 0);
}

export function sandboxSkillCastInspectionNote(inspection: SkillCastInspection, catalogIndex: Pick<NativeCatalogIndex, "lookup">): SandboxSkillCastNote {
  if (inspection.catalogStatus !== "converted") return { text: describeNativeCatalogLookup(catalogIndex.lookup(inspection.key)), tone: "warning" };
  const castAt = inspection.targetId === null ? inspection.casterId : `${inspection.casterId} at ${inspection.targetId}`;
  const parts = [
    `${inspection.key} converted, ${castAt}${inspection.reason === null ? "" : `: ${inspection.reason}`}`,
    `emitter actors ${inspection.emitterActors}`,
    `feature gaps: ${listedOrNone(inspection.featureGaps)}`,
    `named gaps: ${listedOrNone(inspection.namedGaps)}`,
    `not drawn: ${listedOrNone(inspection.notDrawn.map(component => `${component.object} (${component.reason})`))}`,
    `placement gaps: ${placementGaps(inspection)}`,
  ];
  return { text: parts.join(" | "), tone: hasGaps(inspection) ? "warning" : "info" };
}

export function sandboxSkillCastFailureNote(key: string, failure: unknown): SandboxSkillCastNote {
  return { text: `${key} presentation failed: ${failure instanceof Error ? failure.message : String(failure)}`, tone: "warning" };
}

export function sandboxSkillCastUnavailableNote(key: string, reason: string): SandboxSkillCastNote {
  return { text: `${key} not presented: ${reason}`, tone: "warning" };
}
