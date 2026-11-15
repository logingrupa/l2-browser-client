import { describeNativeCatalogLookup, windowCatalogKey } from "../../assets/native/nativeCatalogIndex";
import { windowIdPattern } from "../../assets/native/nativeCatalogRecords";
import { buildNativeWindowRegistry } from "../nativeWindows/nativeWindowRegistry";
import {
  attachSandboxCatalogKeyCombobox, catalogKeyOption, createSandboxResultNote, failureText, sandboxCatalogIndexSource, startPickerLifetime,
} from "./sandboxPickerControls";
import type { SandboxPickerFactory } from "./sandboxPickerRegistry";
import type { VariableInfo } from "./types";

const noWindowsConvertedText = "no windows converted";

export const windowPicker: SandboxPickerFactory = {
  id: "window",
  title: "Window",
  attach(group, context) {
    const lifetime = startPickerLifetime(group);
    const result = createSandboxResultNote(group, lifetime, "sandbox-window-note");
    let requestedWindowKey = "none";
    const openWindow = async (windowId: string) => {
      requestedWindowKey = windowCatalogKey(windowId);
      try { result.show(await context.host.openWindow(windowId)); }
      catch (error) { result.show({ tone: "warning", text: `${requestedWindowKey} did not open: ${failureText(error)}` }); }
    };
    const variables = (): VariableInfo[] => [
      { name: "sandbox.window.selected", value: () => windowCombobox.selectedKey(), values: "window:<name>[#<ordinal>] | none",
        source: sandboxCatalogIndexSource, status: "native" },
      { name: "sandbox.window.lookup", value: () => requestedWindowKey === "none" ? "none" : describeNativeCatalogLookup(context.catalogIndex.lookup(requestedWindowKey)),
        values: "window:<name> converted | gap: <reason> | not in catalog[: <reason>] | none", source: sandboxCatalogIndexSource, status: "native" },
      { name: "sandbox.window.outcome", value: () => result.current(), values: "the open outcome text | none", source: "SandboxPickerHost.openWindow", status: "native" },
    ];
    const windowCombobox = attachSandboxCatalogKeyCombobox({
      group, lifetime, catalogIndex: context.catalogIndex,
      options: buildNativeWindowRegistry(context.catalogIndex).map(entry => catalogKeyOption(entry.windowId, context.catalogIndex.lookup(entry.key))),
      identifierPattern: windowIdPattern, catalogKeyOf: windowCatalogKey, emptyText: noWindowsConvertedText,
      label: "Window", placeholder: "Window name, or a status word", testId: "sandbox-window-keys", pickText: "Open selected window", variables,
      hint: "Opens an interface window through the sandbox host, never through the game adapter. Pick a catalog window or type a window name. "
        + "Gap windows show their reason and are not pickable.",
      onPick: windowId => { void openWindow(windowId); },
    });
    return lifetime.release;
  },
};
