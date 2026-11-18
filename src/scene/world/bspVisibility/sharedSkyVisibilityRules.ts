import committedRulesText from "../../../../recipes/world/shared-sky-visibility.json?raw";
import type { BspNodeSelectorRules, BspWalkRules } from "./core/bspNodeSelector";
import type { NativeFrustumConstants } from "./core/nativeViewFrustum";

export interface SharedSkyDepthClear {
  readonly flags: number;
  readonly depth: number;
  readonly colorCleared: boolean;
  readonly stencilCleared: boolean;
}

export interface SharedSkyVisibilityRules {
  readonly viewFrustum: NativeFrustumConstants;
  readonly nodeSelector: BspNodeSelectorRules;
  readonly depthClear: SharedSkyDepthClear;
}

const rulesPath = "recipes/world/shared-sky-visibility.json";
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function positiveNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !(value > 0)) throw new Error(`${rulesPath} ${field} must be a positive number.`);
  return value;
}

function booleanField(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  if (typeof value !== "boolean") throw new Error(`${rulesPath} ${field} must be true or false.`);
  return value;
}

function flagList(record: Record<string, unknown>, field: string): number[] {
  const value = record[field];
  if (!Array.isArray(value) || value.length === 0 || !value.every(flag => Number.isSafeInteger(flag) && flag > 0)) {
    throw new Error(`${rulesPath} ${field} must list positive flags.`);
  }
  return value as number[];
}

function parseNodeSelector(selector: Record<string, unknown>): BspNodeSelectorRules {
  if (!isRecord(selector.ordinaryGeometry)) throw new Error(`${rulesPath} nodeSelector needs its ordinaryGeometry rule.`);
  return { backfaceKeepFlags: flagList(selector, "backfaceKeepFlags"), fakeBackdropFlag: positiveNumber(selector, "fakeBackdropFlag"),
    ordinaryExcludedFlag: positiveNumber(selector.ordinaryGeometry, "excludedFlag"),
    ordinaryUnlessNeitherFlags: flagList(selector.ordinaryGeometry, "unlessNeitherFlags") };
}

export function parseSharedSkyVisibilityRules(document: unknown): SharedSkyVisibilityRules {
  if (!isRecord(document) || document.kind !== "shared-sky-visibility-rules" || document.schemaVersion !== 1
    || !isRecord(document.viewFrustum) || !isRecord(document.depthClear) || !isRecord(document.nodeSelector)) {
    throw new Error(`${rulesPath} must be a shared-sky-visibility-rules schema 1 document with viewFrustum, nodeSelector and depthClear.`);
  }
  const frustum = document.viewFrustum, clear = document.depthClear;
  const nearClip = positiveNumber(frustum, "nearClip"), farClip = positiveNumber(frustum, "farClip");
  if (!(nearClip < farClip)) throw new Error(`${rulesPath} nearClip must lie before farClip.`);
  return {
    viewFrustum: { nearClip, farClip, safeNormalThreshold: positiveNumber(frustum, "safeNormalThreshold") },
    nodeSelector: parseNodeSelector(document.nodeSelector),
    depthClear: { flags: positiveNumber(clear, "flags"), depth: positiveNumber(clear, "depth"), colorCleared: booleanField(clear, "colorCleared"),
      stencilCleared: booleanField(clear, "stencilCleared") },
  };
}

export const sharedSkyVisibilityRules = parseSharedSkyVisibilityRules(JSON.parse(committedRulesText));
export const committedBspWalkRules: BspWalkRules = { selector: sharedSkyVisibilityRules.nodeSelector, frustum: sharedSkyVisibilityRules.viewFrustum };
