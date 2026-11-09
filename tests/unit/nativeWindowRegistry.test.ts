import { describe, expect, it } from "vitest";
import type { NativeCatalogIndex, NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { buildNativeWindowRegistry } from "../../src/ui/nativeWindows/nativeWindowRegistry";

function catalogIndexOf(lookups: readonly NativeCatalogLookup[]): NativeCatalogIndex {
  const lookupsByKey = new Map(lookups.map(lookup => [lookup.key, lookup]));
  return {
    lookup: key => lookupsByKey.get(key) ?? { status: "not-in-catalog", key, reason: "not in catalog" },
    keys: prefix => [...lookupsByKey.keys()].filter(key => key.startsWith(prefix)).sort(),
  };
}

function convertedWindow(windowId: string): NativeCatalogLookup {
  return { status: "converted", key: `window:${windowId}`, record: { window: windowId, manifest: "/l2/windows/x/window.json", manifestSha256: "x", manifestBytes: 1 } };
}

describe("buildNativeWindowRegistry", () => {
  it("lists every window key with its status and reason and ignores other kinds", () => {
    const registry = buildNativeWindowRegistry(catalogIndexOf([
      convertedWindow("StatusWnd"),
      { status: "gap", key: "window:ChatWnd", reason: "decode-failed:FormatError", coverageStatus: "gap" },
      { status: "gap", key: "window:BoardWnd", reason: "decode-failed:IndexError", coverageStatus: "failed" },
      { status: "gap", key: "window:MinimapWnd", reason: "layout step not run", coverageStatus: "pending" },
      { status: "converted", key: "table:chargrp", record: {} as never },
    ]));
    expect(registry.map(entry => [entry.windowId, entry.status, entry.reason])).toEqual([
      ["BoardWnd", "gap", "decode-failed:IndexError"],
      ["ChatWnd", "gap", "decode-failed:FormatError"],
      ["MinimapWnd", "not-in-catalog", "layout step not run"],
      ["StatusWnd", "converted", null],
    ]);
    expect(registry.map(entry => entry.description)).toEqual([
      "window:BoardWnd gap: decode-failed:IndexError",
      "window:ChatWnd gap: decode-failed:FormatError",
      "window:MinimapWnd gap: layout step not run",
      "window:StatusWnd converted",
    ]);
  });

  it("lists two roots sharing a decoded name as separate windows with their ordinals", () => {
    const registry = buildNativeWindowRegistry(catalogIndexOf([convertedWindow("Back2"), convertedWindow("Back2#1")]));
    expect(registry.map(entry => [entry.windowId, entry.key])).toEqual([["Back2", "window:Back2"], ["Back2#1", "window:Back2#1"]]);
  });

  it("orders by base name in code point order, then by ordinal as a number", () => {
    const registry = buildNativeWindowRegistry(catalogIndexOf(["Name#10", "Name#2", "Name", "name", "Name_Two", "NameB", "Zeta"].map(convertedWindow)));
    expect(registry.map(entry => entry.windowId)).toEqual(["Name", "Name#2", "Name#10", "NameB", "Name_Two", "Zeta", "name"]);
  });

  it("keeps window ids exact: case and the ordinal are part of the id", () => {
    const registry = buildNativeWindowRegistry(catalogIndexOf([convertedWindow("StatusWnd"), convertedWindow("statuswnd")]));
    expect(registry.map(entry => entry.windowId)).toEqual(["StatusWnd", "statuswnd"]);
  });

  it("gives an empty registry for a catalog with no windows slice", () => {
    expect(buildNativeWindowRegistry(catalogIndexOf([{ status: "converted", key: "table:chargrp", record: {} as never }]))).toEqual([]);
  });

  it("refuses a catalog window key that is not a window id", () => {
    expect(() => buildNativeWindowRegistry(catalogIndexOf([{ status: "gap", key: "window:Bad Name", reason: "x", coverageStatus: "gap" }])))
      .toThrow("Window name must be a bounded interface window identifier.");
  });
});
