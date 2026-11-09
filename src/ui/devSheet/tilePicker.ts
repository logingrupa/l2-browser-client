import { describeNativeCatalogLookup, tileCatalogKey } from "../../assets/native/nativeCatalogIndex";
import {
  attachSandboxCatalogKeyChoice, catalogKeyChoiceEntries, createSandboxResultNote, sandboxCatalogIndexSource, startPickerLifetime, submittedText,
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
      { name: "sandbox.tile.selected", value: () => keyChoice.selectedKey(), values: "tile:XX_YY | none", source: sandboxCatalogIndexSource, status: "native" },
      { name: "sandbox.tile.lookup", value: () => requestedTileKey === "none" ? "none" : describeNativeCatalogLookup(context.catalogIndex.lookup(requestedTileKey)),
        values: "tile:XX_YY converted | gap: <reason> | not in catalog[: <reason>] | none", source: sandboxCatalogIndexSource, status: "native" },
      { name: "sandbox.tile.outcome", value: () => result.current(), values: "the reload outcome text | none", source: "SandboxPickerHost.reloadTile", status: "native" },
      { name: "sandbox.tile.walk", value: () => "tap-to-move", values: "tap-to-move",
        source: "walking is the existing tap-to-move on the loaded tile; this picker adds no walk control", status: "presentation" },
    ];
    const keyChoice = attachSandboxCatalogKeyChoice({
      group, lifetime, keyPrefix: tileKeyPrefix, entries: catalogKeyChoiceEntries(context.catalogIndex, tileKeyPrefix),
      emptyText: `The catalog index lists no ${tileKeyPrefix} keys.`, label: "Catalog tiles", testId: "sandbox-tile-keys", pickText: "Reload selected tile",
      onPick: reloadTile,
    });
    group.idEntry({
      label: "Reload tile", testId: "sandbox-tile", submitText: "Reload", variables,
      hint: "Reloads a tile through the sandbox host. Each catalog tile shows its status. Walk on the loaded tile with the existing tap-to-move.",
      fields: [{ name: "tile", label: "Tile", kind: "tile" }],
      onSubmit: values => { if (lifetime.active()) reloadTile(submittedText(values, "tile")); },
    });
    return lifetime.release;
  },
};
