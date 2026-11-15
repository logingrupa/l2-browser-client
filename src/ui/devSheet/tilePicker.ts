import { describeNativeCatalogLookup, tileCatalogKey } from "../../assets/native/nativeCatalogIndex";
import { tileIdPattern } from "../../assets/native/nativeCatalogRecords";
import {
  attachSandboxCatalogKeyCombobox, catalogKeyOptions, createSandboxResultNote, sandboxCatalogIndexSource, startPickerLifetime,
} from "./sandboxPickerControls";
import type { SandboxPickerFactory } from "./sandboxPickerRegistry";
import type { VariableInfo } from "./types";

const tileKeyPrefix = "tile:";

export const tilePicker: SandboxPickerFactory = {
  id: "tile",
  title: "Tile",
  attach(group, context) {
    const lifetime = startPickerLifetime(group);
    const result = createSandboxResultNote(group, lifetime, "sandbox-tile-note");
    let requestedTileKey = "none";
    const reloadTile = (tileId: string) => {
      requestedTileKey = tileCatalogKey(tileId);
      result.show(context.host.reloadTile(tileId));
    };
    const variables = (): VariableInfo[] => [
      { name: "sandbox.tile.current", value: () => context.currentTileId() ?? "none", values: "XX_YY | none",
        source: "the tile the runtime loaded from the ?map= selection", status: "native" },
      { name: "sandbox.tile.selected", value: () => tileCombobox.selectedKey(), values: "tile:XX_YY | none", source: sandboxCatalogIndexSource, status: "native" },
      { name: "sandbox.tile.lookup", value: () => requestedTileKey === "none" ? "none" : describeNativeCatalogLookup(context.catalogIndex.lookup(requestedTileKey)),
        values: "tile:XX_YY converted | gap: <reason> | not in catalog[: <reason>] | none", source: sandboxCatalogIndexSource, status: "native" },
      { name: "sandbox.tile.outcome", value: () => result.current(), values: "the reload outcome text | none", source: "SandboxPickerHost.reloadTile", status: "native" },
      { name: "sandbox.tile.walk", value: () => "tap-to-move", values: "tap-to-move",
        source: "walking is the existing tap-to-move on the loaded tile; this picker adds no walk control", status: "presentation" },
    ];
    const currentTileId = context.currentTileId();
    const tileCombobox = attachSandboxCatalogKeyCombobox({
      group, lifetime, catalogIndex: context.catalogIndex, options: catalogKeyOptions(context.catalogIndex, tileKeyPrefix),
      identifierPattern: tileIdPattern, catalogKeyOf: tileCatalogKey, emptyText: `The catalog index lists no ${tileKeyPrefix} keys.`,
      initialIdentifier: currentTileId === null ? null : tileCatalogKey(currentTileId), label: "Tile", placeholder: "XX_YY, or a status word", testId: "sandbox-tile-keys", pickText: "Reload", variables,
      hint: "Pick a catalog tile or type an XX_YY tile, then press Reload; the reload is a full page navigation through the sandbox host. "
        + "Gap tiles show their reason and are not pickable. Walk on the loaded tile with the existing tap-to-move.",
      onPick: reloadTile,
    });
    return lifetime.release;
  },
};
