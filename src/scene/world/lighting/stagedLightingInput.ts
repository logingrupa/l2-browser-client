import type { TypedPayload } from "../../../shared/typedPayload";
import { TileLightingDecodeError } from "./tileLightingDecodeError";

export type StagedLightingInput<Value> =
  | { readonly status: "staged"; readonly value: Value }
  | { readonly status: "unstaged"; readonly reason: string };

const hourlyLightingInputUnstagedPrefix = "hourly-lighting-input-unstaged:";

export function requireLightingInput(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TileLightingDecodeError(message);
}

export function stagedWhenListed<Value>(payload: TypedPayload, names: readonly string[], decode: () => Value): StagedLightingInput<Value> {
  const listed = new Set(payload.names());
  const missing = names.find(name => !listed.has(name));
  return missing === undefined ? { status: "staged", value: decode() } : { status: "unstaged", reason: `${hourlyLightingInputUnstagedPrefix}${missing}` };
}

export function requireLightingPrefixStarts(name: string, starts: Uint32Array, count: number, total: number): void {
  requireLightingInput(starts.length === count + 1 && starts[0] === 0 && starts[count] === total, `${name} must hold ${count + 1} starts from 0 to ${total}.`);
  const descending = starts.findIndex((start, index) => index > 0 && start < starts[index - 1]!);
  requireLightingInput(descending === -1, `${name}[${descending}] runs backwards.`);
}
