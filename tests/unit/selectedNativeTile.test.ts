import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { selectedNativeTileIdentity } from "../../src/scene/world/selectedNativeTile";
import { createNativeSkyPresentation } from "../../src/scene/world/nativeSkyPresentation";

describe("selected native tile identity", () => {
  it.each<[Pick<Location, "search"> | undefined, string | null]>([
    [undefined, null], [{ search: "" }, null], [{ search: "?character=native-human-fighter" }, null], [{ search: "?map=20_21" }, "20_21"],
  ])("reads %j as %j", (location, tileId) => {
    expect(selectedNativeTileIdentity(location)).toBe(tileId);
  });

  it.each(["?map=", "?map=2021", "?map=20_21&map=20_22", "?map=../x", "?map=20_21x"])("refuses %s", search => {
    expect(() => selectedNativeTileIdentity({ search })).toThrow("The map parameter must name one tile as XX_YY.");
  });
});

describe("native sky presentation on a selected tile", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); });

  function missingSkyStore() {
    const fetcher = vi.fn(async (_url: string) => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  it.each(["?map=20_20", "?map=20_21"])("reads the selected tile catalog, never the pinned 20_20 sky, with search %j", async search => {
    const fetcher = missingSkyStore();
    vi.stubGlobal("location", { search, protocol: "http:" });
    await expect(createNativeSkyPresentation(scene, new AbortController().signal)).resolves.toBeNull();
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/l2/catalog.json"]);
  });

  it("keeps reading the pinned 20_20 sky without a selected tile", async () => {
    const fetcher = missingSkyStore();
    vi.stubGlobal("location", { search: "", protocol: "http:" });
    await expect(createNativeSkyPresentation(scene, new AbortController().signal)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toMatch(/^\/l2\/skies\/[a-f0-9]{64}\/sky\.glb$/);
  });
});
