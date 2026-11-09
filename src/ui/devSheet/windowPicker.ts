import { describeNativeCatalogLookup, windowCatalogKey } from "../../assets/native/nativeCatalogIndex";
import { buildNativeWindowRegistry } from "../nativeWindows/nativeWindowRegistry";
import {
  attachSandboxCatalogKeyChoice, createSandboxResultNote, failureText, sandboxCatalogIndexSource, startPickerLifetime, submittedText,
} from "./sandboxPickerControls";
import type { SandboxPickerFactory } from "./sandboxPickerRegistry";
import type { VariableInfo } from "./types";

const windowKeyPrefix = "window:";
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
      { name: "sandbox.window.selected", value: () => keyChoice.selectedKey(), values: "window:<name>[#<ordinal>] | none",
        source: sandboxCatalogIndexSource, status: "native" },
      { name: "sandbox.window.lookup", value: () => requestedWindowKey === "none" ? "none" : describeNativeCatalogLookup(context.catalogIndex.lookup(requestedWindowKey)),
        values: "window:<name> converted | gap: <reason> | not in catalog[: <reason>] | none", source: sandboxCatalogIndexSource, status: "native" },
      { name: "sandbox.window.outcome", value: () => result.current(), values: "the open outcome text | none", source: "SandboxPickerHost.openWindow", status: "native" },
    ];
    const keyChoice = attachSandboxCatalogKeyChoice({
      group, lifetime, keyPrefix: windowKeyPrefix, entries: buildNativeWindowRegistry(context.catalogIndex), emptyText: noWindowsConvertedText,
      label: "Catalog windows", testId: "sandbox-window-keys", pickText: "Open selected window",
      onPick: windowId => { void openWindow(windowId); },
    });
    group.idEntry({
      label: "Open window", testId: "sandbox-window", submitText: "Open", variables,
      hint: "Opens an interface window through the sandbox host, never through the game adapter. Each catalog window shows its status.",
      fields: [{ name: "window", label: "Window", kind: "window" }],
      onSubmit: values => { if (lifetime.active()) void openWindow(submittedText(values, "window")); },
    });
    return lifetime.release;
  },
};
