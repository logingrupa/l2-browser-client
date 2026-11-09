import type { ActorClipListingSource } from "../../animation/actorClipPlayback";
import type { NativeCatalogIndex } from "../../assets/native/nativeCatalogIndex";
import type { WorldCommand } from "../../world/worldTypes";
import type { NativeTableNameIndexRead } from "../nativeTables/readNativeTableNameIndex";

export interface SandboxActionOutcome {
  readonly tone: "info" | "warning";
  readonly text: string;
}

export interface SandboxPickerHost extends ActorClipListingSource {
  dispatch(command: WorldCommand): void;
  reloadTile(tileId: string): SandboxActionOutcome;
  openWindow(windowId: string): Promise<SandboxActionOutcome>;
}

export interface SandboxPickerContext {
  readonly host: SandboxPickerHost;
  readonly catalogIndex: NativeCatalogIndex;
  readNameIndex(tableId: string, signal: AbortSignal): Promise<NativeTableNameIndexRead>;
  selectedEntityId(): string | null;
  currentTileId(): string | null;
  readonly signal: AbortSignal;
}
