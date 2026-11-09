import type { ActorClipListingSource } from "../animation/actorClipPlayback";
import { describeNativeCatalogLookup } from "../assets/native/nativeCatalogIndex";
import { tileIdPattern } from "../assets/native/nativeCatalogRecords";
import { selectedNativeTileIdentity } from "../scene/world/selectedNativeTile";
import type { SandboxActionOutcome, SandboxPickerHost } from "../ui/devSheet/sandboxPickerHost";
import type { NativeWindowLayer, NativeWindowOpenResult } from "../ui/nativeWindows/nativeWindowLayer";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";

export type SandboxTileLocation = Pick<Location, "href" | "search" | "assign">;

export interface SandboxRuntimeActionsOptions {
  readonly adapter: Pick<GameWorldAdapter, "dispatch">;
  readonly windowLayer: Pick<NativeWindowLayer, "open">;
  readonly location: SandboxTileLocation;
  readonly signal: AbortSignal;
  readonly clipListings: ActorClipListingSource;
}

function outcomeOfWindowOpen(result: NativeWindowOpenResult): SandboxActionOutcome {
  if (result.status === "not-in-catalog") {
    return { tone: "warning", text: describeNativeCatalogLookup({ status: "not-in-catalog", key: result.key, reason: result.reason }) };
  }
  const gapCount = result.window.gaps.length;
  if (gapCount === 0) return { tone: "info", text: `${result.key} opened` };
  return { tone: "warning", text: `${result.key} opened with ${gapCount} control ${gapCount === 1 ? "gap" : "gaps"}` };
}

function locationWithSelectedTile(location: SandboxTileLocation, tileId: string): string {
  const url = new URL(location.href);
  const parameters = new URLSearchParams(url.search);
  parameters.set("map", tileId);
  url.search = parameters.toString();
  return url.href;
}

export function createSandboxRuntimeActions(options: SandboxRuntimeActionsOptions): SandboxPickerHost & ActorClipListingSource {
  const { adapter, windowLayer, location, signal, clipListings } = options;
  return {
    dispatch: command => { adapter.dispatch(command); },
    reloadTile: tileId => {
      if (!tileIdPattern.test(tileId)) return { tone: "warning", text: `tile ${tileId} is not an XX_YY tile id; nothing was reloaded` };
      if (selectedNativeTileIdentity(location) === tileId) return { tone: "info", text: `tile ${tileId} already loaded` };
      location.assign(locationWithSelectedTile(location, tileId));
      return { tone: "info", text: `tile ${tileId} reloading` };
    },
    openWindow: async windowId => {
      signal.throwIfAborted();
      const result = await windowLayer.open(windowId);
      signal.throwIfAborted();
      return outcomeOfWindowOpen(result);
    },
    actorClipEntityIds: () => clipListings.actorClipEntityIds(),
    actorClipListing: entityId => clipListings.actorClipListing(entityId),
    previewing: entityId => clipListings.previewing(entityId),
  };
}
