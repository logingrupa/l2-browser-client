import { afterEach, describe, expect, it, vi } from "vitest";
import { unavailableNativeCatalogIndex, type NativeCatalogIndex, type NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { catalogEquippedItemSource } from "../../src/assets/native/nativeEquippedItemSource";
import { catalogWith, model } from "../support/nativeCatalogIndexFixtures";

const weaponLookup: NativeCatalogLookup = { status: "converted", key: "item:1", namedGaps: [],
  record: { itemId: 1, slot: "body-part:7", catalogIds: ["interlude:item:1:body-part:7:weapon"], playerProfileIds: [] } };

function recordingIndex(): NativeCatalogIndex & { readonly requestedKeys: string[] } {
  const requestedKeys: string[] = [];
  return { requestedKeys, keys: () => [weaponLookup.key],
    lookup: key => { requestedKeys.push(key); return key === weaponLookup.key ? weaponLookup : { status: "not-in-catalog", key, reason: "not in catalog" }; } };
}

describe("catalog equipped item source", () => {
  const fetchCalls = vi.fn(async () => { throw new Error("the item source must not fetch the catalog again"); });
  afterEach(() => { vi.unstubAllGlobals(); fetchCalls.mockClear(); });

  it("resolves item lookups through the catalog index it was given without reading the catalog again", async () => {
    vi.stubGlobal("fetch", fetchCalls);
    const index = recordingIndex();
    const source = catalogEquippedItemSource(catalogWith({}), index);
    await expect(source.lookup(1, new AbortController().signal)).resolves.toEqual(weaponLookup);
    expect(index.requestedKeys).toEqual(["item:1"]);
    expect(fetchCalls).not.toHaveBeenCalled();
  });

  it("reports the index failure of an unavailable runtime index instead of retrying on its own", async () => {
    vi.stubGlobal("fetch", fetchCalls);
    const source = catalogEquippedItemSource(catalogWith({}), unavailableNativeCatalogIndex("coverage.json returned 404"));
    await expect(source.lookup(1, new AbortController().signal)).resolves.toEqual({ status: "not-in-catalog", key: "item:1",
      reason: "catalog index unavailable: coverage.json returned 404" });
    expect(fetchCalls).not.toHaveBeenCalled();
  });

  it("rejects a lookup whose request is already aborted", async () => {
    const request = new AbortController(); request.abort();
    await expect(catalogEquippedItemSource(catalogWith({}), recordingIndex()).lookup(1, request.signal)).rejects.toThrow();
  });

  it("refuses a model that is not in the catalog it was given", async () => {
    vi.stubGlobal("fetch", fetchCalls);
    const source = catalogEquippedItemSource(catalogWith({ models: [model("interlude:item:2:body-part:7:weapon", "Weapons.other")] }), recordingIndex());
    await expect(source.loadModel("interlude:item:1:body-part:7:weapon", new AbortController().signal))
      .rejects.toThrow("model interlude:item:1:body-part:7:weapon is not in the served catalog");
    expect(fetchCalls).not.toHaveBeenCalled();
  });
});
