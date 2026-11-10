import { describe, expect, it } from "vitest";
import { parseTileMapEmitterPlacements } from "../../src/scene/world/tileMapEmitterPlacements";

const emitter = (object: string, properties: Record<string, unknown>) => ({ class: "Engine.SpriteEmitter", converted: true, exportIndex: 1, object, properties });

describe("parseTileMapEmitterPlacements", () => {
  it("names every reason a placed emitter cannot play yet: unmerged class defaults, unparsed structs and unconverted resources", () => {
    const placements = parseTileMapEmitterPlacements({ tileId: "20_21", placements: [{ id: "interlude:20_21.Emitter0", exportIndex: 8951, actorRules: [],
      bundle: { emitters: [emitter("20_21.SpriteEmitter0", { MaxParticles: 2, LifetimeRange: { struct: "Range", type: 10, unparsedHex: "2d24" },
        Texture: { class: "Object", object: "LineageEffect.flare" } })] } }] }, "20_21");
    expect(placements).toEqual([{ placementId: "interlude:20_21.Emitter0", exportIndex: 8951, emitterCount: 1, reasons: ["map-emitter-class-defaults-unmerged",
      "map-emitter-struct-unparsed:20_21.SpriteEmitter0.LifetimeRange", "map-emitter-resource-unconverted:LineageEffect.flare"] }]);
  });

  it("refuses a resource of another tile or a placement without its export index", () => {
    expect(() => parseTileMapEmitterPlacements({ tileId: "20_20", placements: [] }, "20_21")).toThrow(/placements of tile 20_21/);
    expect(() => parseTileMapEmitterPlacements({ tileId: "20_21", placements: [{ id: "x", bundle: { emitters: [] } }] }, "20_21")).toThrow(/needs id, exportIndex/);
  });
});
