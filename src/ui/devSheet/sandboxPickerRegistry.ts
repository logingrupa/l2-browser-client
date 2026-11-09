import type { DevGroup } from "./devSheetParts";
import type { SandboxPickerContext } from "./sandboxPickerHost";
import { spawnPicker } from "./spawnPicker";

export interface SandboxPickerFactory {
  readonly id: string;
  readonly title: string;
  attach(group: DevGroup, context: SandboxPickerContext): () => void;
}

export const sandboxPickerSections: readonly SandboxPickerFactory[] = [spawnPicker];
