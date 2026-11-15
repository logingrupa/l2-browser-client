import committedRulesText from "../../../../recipes/world/bsp-visibility.json?raw";
import type { ReferenceConstantStatus } from "../../../shared/referenceConstant";
import type { TileVisibilityLimits } from "./core/tileVisibilityFrame";

export interface BspVisibilityLimitRule {
  readonly id: string;
  readonly status: ReferenceConstantStatus;
  readonly runtimeDefault: number;
}

export interface BspVisibilityRules {
  readonly limits: TileVisibilityLimits;
  readonly limitRules: readonly BspVisibilityLimitRule[];
}

const limitRuleIdByField: Readonly<Record<keyof TileVisibilityLimits, string>> = {
  portalRange: "portal-range",
  portalDepthCap: "portal-depth-cap",
  staticMeshRange: "static-mesh-range",
  emitterRange: "emitter-clipping-range",
};
const referenceConstantStatuses: ReadonlySet<string> = new Set(["ue2-data", "unconfirmed", "confirmed-interlude", "corrected-interlude", "unknown"]);
const infinityRuntimeDefault = "infinity";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readLimitRule(rows: readonly unknown[], id: string): BspVisibilityLimitRule {
  const row = rows.find(candidate => isRecord(candidate) && candidate.id === id);
  if (!isRecord(row)) throw new Error(`recipes/world/bsp-visibility.json has no ${id} row.`);
  const { status, runtimeDefault } = row;
  if (typeof status !== "string" || !referenceConstantStatuses.has(status)) throw new Error(`recipes/world/bsp-visibility.json row ${id} has an unknown status.`);
  if (runtimeDefault === infinityRuntimeDefault) return { id, status: status as ReferenceConstantStatus, runtimeDefault: Infinity };
  if (typeof runtimeDefault !== "number" || !(runtimeDefault > 0)) {
    throw new Error(`recipes/world/bsp-visibility.json row ${id} runtimeDefault must be "infinity" or a positive number.`);
  }
  return { id, status: status as ReferenceConstantStatus, runtimeDefault };
}

export function parseBspVisibilityRules(document: unknown): BspVisibilityRules {
  if (!isRecord(document) || document.schemaVersion !== 1 || !Array.isArray(document.rows)) {
    throw new Error("recipes/world/bsp-visibility.json must hold schemaVersion 1 and rows.");
  }
  const rows: readonly unknown[] = document.rows;
  const portalRange = readLimitRule(rows, limitRuleIdByField.portalRange), portalDepthCap = readLimitRule(rows, limitRuleIdByField.portalDepthCap);
  const staticMeshRange = readLimitRule(rows, limitRuleIdByField.staticMeshRange), emitterRange = readLimitRule(rows, limitRuleIdByField.emitterRange);
  const limits: TileVisibilityLimits = { portalRange: portalRange.runtimeDefault, portalDepthCap: portalDepthCap.runtimeDefault,
    staticMeshRange: staticMeshRange.runtimeDefault, emitterRange: emitterRange.runtimeDefault };
  const limitRules = [portalRange, portalDepthCap, staticMeshRange, emitterRange];
  return { limits, limitRules };
}

export const committedBspVisibilityRules = parseBspVisibilityRules(JSON.parse(committedRulesText));
