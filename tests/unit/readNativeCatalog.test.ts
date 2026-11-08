import { describe, expect, it, vi } from "vitest";
import { NativeStoreNotStagedError, readNativeCatalog } from "../../src/assets/native/readNativeCatalog";

function catalogFetch(response: () => Response) {
  return vi.fn(async (_url: string | URL | Request) => response()) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("native catalog reader", () => {
  it("issues one fetch for two reads on the same signal and fills absent slices with empty arrays", async () => {
    const fetchResource = catalogFetch(() => Response.json({ schemaVersion: 1, models: [{ id: "musveren:0" }], sections: [{ id: "map-20-20-section" }] }));
    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([readNativeCatalog(signal, fetchResource), readNativeCatalog(signal, fetchResource)]);
    expect(first).toBe(second);
    expect(fetchResource).toHaveBeenCalledTimes(1);
    expect(fetchResource.mock.calls[0]![0]).toBe("/l2/catalog.json");
    expect(first.sections).toEqual([{ id: "map-20-20-section" }]);
    expect(first.effectComponents).toEqual([]);
    await readNativeCatalog(new AbortController().signal, fetchResource);
    expect(fetchResource).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["HTTP 404", () => new Response("missing", { status: 404 })],
    ["an HTML fallback page", () => new Response("<!DOCTYPE html><html><body>app</body></html>")],
    ["an html tag page", () => new Response("  <html></html>")],
  ])("reports %s as a store that is not staged", async (_label, response) => {
    const read = readNativeCatalog(new AbortController().signal, catalogFetch(response));
    await expect(read).rejects.toBeInstanceOf(NativeStoreNotStagedError);
    await expect(read).rejects.toThrow("Native asset store not staged: /l2/catalog.json is missing. Stage it from the main checkout.");
  });

  it("reports other HTTP failures with their status", async () => {
    await expect(readNativeCatalog(new AbortController().signal, catalogFetch(() => new Response("", { status: 503 }))))
      .rejects.toThrow("Native asset catalog returned HTTP 503.");
  });

  it.each([
    ["schemaVersion 2", { schemaVersion: 2, models: [] }],
    ["missing models", { schemaVersion: 1 }],
    ["a non-array sections slice", { schemaVersion: 1, models: [], sections: {} }],
    ["an array body", [{ schemaVersion: 1, models: [] }]],
  ])("rejects a catalog with %s", async (_label, body) => {
    await expect(readNativeCatalog(new AbortController().signal, catalogFetch(() => Response.json(body))))
      .rejects.toThrow("Native asset catalog is invalid.");
  });

  it("rejects a body that is not JSON as an invalid catalog", async () => {
    await expect(readNativeCatalog(new AbortController().signal, catalogFetch(() => new Response("{schemaVersion"))))
      .rejects.toThrow("Native asset catalog is invalid.");
  });

  it("evicts a rejected read so a later read with the same signal fetches again", async () => {
    let attempt = 0;
    const fetchResource = catalogFetch(() => ++attempt === 1 ? new Response("", { status: 500 }) : Response.json({ schemaVersion: 1, models: [] }));
    const signal = new AbortController().signal;
    await expect(readNativeCatalog(signal, fetchResource)).rejects.toThrow("HTTP 500");
    await expect(readNativeCatalog(signal, fetchResource)).resolves.toMatchObject({ schemaVersion: 1, models: [] });
    expect(fetchResource).toHaveBeenCalledTimes(2);
  });

  it("does not fetch for an aborted signal", async () => {
    const controller = new AbortController(), fetchResource = catalogFetch(() => Response.json({ schemaVersion: 1, models: [] }));
    controller.abort();
    await expect(readNativeCatalog(controller.signal, fetchResource)).rejects.toHaveProperty("name", "AbortError");
    expect(fetchResource).not.toHaveBeenCalled();
  });
});
