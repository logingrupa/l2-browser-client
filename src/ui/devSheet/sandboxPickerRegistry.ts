import { castPicker } from "./castPicker";
import { createClipPicker } from "./clipPicker";
import type { DevGroup } from "./devSheetParts";
import { equipPicker } from "./equipPicker";
import type { SandboxPickerContext } from "./sandboxPickerHost";
import { spawnPicker } from "./spawnPicker";
import { tilePicker } from "./tilePicker";
import { windowPicker } from "./windowPicker";

export interface SandboxPickerFactory {
  readonly id: string;
  readonly title: string;
  attach(group: DevGroup, context: SandboxPickerContext): () => void;
}

export const sandboxPickerSections: readonly SandboxPickerFactory[] = [tilePicker, spawnPicker, equipPicker, castPicker, windowPicker, createClipPicker()];
