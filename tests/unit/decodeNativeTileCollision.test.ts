import { describe, expect, it } from "vitest";
import { CollisionWorldError } from "../../src/scene/world/movement/core/collisionWorld";
import { decodeNativeTileBspTree, decodeNativeTileCollisionCell } from "../../src/scene/world/movement/core/decodeNativeTileCollision";
import {
  collisionBspTreeFixtureArrays, collisionChunkFixtureArrays, readCollisionFixturePayload, replaceFixtureArray,
} from "../support/nativeTileCollisionFixture";
import type { TypedPayloadFixtureArray } from "../support/typedPayloadFixture";

const cellIdentity = { cellId: "20_21/chunk-0-0", tileId: "20_21" };
const decodeCell = (arrays: readonly TypedPayloadFixtureArray[]) => decodeNativeTileCollisionCell(readCollisionFixturePayload(arrays), cellIdentity);
const decodeTree = (arrays: readonly TypedPayloadFixtureArray[]) => decodeNativeTileBspTree(readCollisionFixturePayload(arrays), "20_21");
const fixtureValues = (arrays: readonly TypedPayloadFixtureArray[], name: string) => arrays.find(array => array.name === name)!.values;

describe("decodeNativeTileCollisionCell", () => {
  it("returns the volume, static mesh, placement, mover and terrain primitives in source units with their declared sources", () => {
    const arrays = collisionChunkFixtureArrays();
    const cell = decodeCell(arrays);
    expect(cell.cellId).toBe("20_21/chunk-0-0");
    expect(cell.tileId).toBe("20_21");
    expect(cell.volumes).toHaveLength(1);
    const [volume] = cell.volumes;
    expect(volume).toMatchObject({
      exportIndex: 417, kind: "Engine.BlockingVolume", decision: "blocking", location: [1024, -2048, 96], rotation: [0, 16384, 0], drawScale: 1,
      drawScale3D: [1, 2, 1], prePivot: [0, 0, 0], rootOutside: true,
      transformProvenance: { location: "authored", rotation: "authored", drawScale: "class-default", drawScale3D: "class-default", prePivot: "ue-zero" },
    });
    expect(volume!.nodes).toHaveLength(6);
    expect(volume!.nodes.map(node => node.plane)).toEqual([[1, 0, 0, 64], [-1, 0, 0, 64], [0, 1, 0, 64], [0, -1, 0, 64], [0, 0, 1, 64], [0, 0, -1, 64]]);
    expect(volume!.nodes.map(node => node.back)).toEqual([1, 2, 3, 4, 5, -1]);
    expect(volume!.nodes.flatMap(node => [...node.polygon])).toEqual(fixtureValues(arrays, "VOLS.vertices"));
    expect(cell.staticMeshes).toHaveLength(1);
    expect([...cell.staticMeshes[0]!.positions]).toEqual(fixtureValues(arrays, "SMSH.positions"));
    expect([...cell.staticMeshes[0]!.indices]).toEqual([0, 2, 1, 0, 3, 2]);
    expect(cell.placements).toHaveLength(1);
    expect(cell.placements[0]).toMatchObject({ exportIndex: 512, decision: "slots", staticMeshIndex: 0 });
    expect([...cell.placements[0]!.matrix]).toEqual(fixtureValues(arrays, "PLAC.matrix"));
    expect(cell.movers).toHaveLength(1);
    expect(cell.movers[0]).toMatchObject({ exportIndex: 733, slot: 0, collisionSource: "static-slot-enable-collision", staticMeshIndex: 0 });
    expect([...cell.movers[0]!.openMatrix]).toEqual(fixtureValues(arrays, "MOVR.openMatrix"));
    expect(cell.terrain).toMatchObject({
      location: [-4096, -8192, 512], terrainScale: [128, 128, 64], heightmapWidth: 4, heightmapHeight: 4, firstColumn: 1, firstRow: 1, columns: 2, rows: 2,
    });
    expect([...cell.terrain!.heights]).toEqual([32768, 32800, 32832, 32864]);
    expect([...cell.terrain!.quadVisibility]).toEqual([1]);
    expect([...cell.terrain!.edgeTurn]).toEqual([0]);
  });

  it("keeps float32 source values unchanged", () => {
    const arrays = replaceFixtureArray(collisionChunkFixtureArrays(), "VOLS.location", [0.1, -123456.789, 3.4028234663852886e38]);
    expect(decodeCell(arrays).volumes[0]!.location).toEqual([Math.fround(0.1), Math.fround(-123456.789), Math.fround(3.4028234663852886e38)]);
  });

  it("decodes a chunk with no terrain patch to a null terrain", () => {
    let arrays = collisionChunkFixtureArrays();
    for (const name of ["TERR.location", "TERR.terrainScale", "TERR.heightmapSize", "TERR.vertexRectangle", "TERR.heights", "TERR.quadVisibility", "TERR.edgeTurn"]) {
      arrays = replaceFixtureArray(arrays, name, []);
    }
    expect(decodeCell(arrays).terrain).toBeNull();
  });

  it("maps an unplaced static mesh index to null", () => {
    const arrays = replaceFixtureArray(replaceFixtureArray(collisionChunkFixtureArrays(), "PLAC.mesh", [-1]), "PLAC.decision", [0]);
    expect(decodeCell(arrays).placements[0]).toMatchObject({ decision: "declared-none", staticMeshIndex: null });
  });

  it.each([
    ["a volume child outside its own nodes", "VOLS.back", [1, 2, 3, 4, 5, 6], /cell 20_21\/chunk-0-0 volume 0 VOLS\.back\[5\] = 6/],
    ["a volume node range that skips nodes", "VOLS.nodeCount", [5], /VOLS\.nodeStart ranges cover 5 entries of 6/],
    ["an unknown volume kind", "VOLS.kind", [2], /VOLS\.kind\[0\] holds the unknown code 2/],
    ["an unknown volume decision", "VOLS.decision", [3], /VOLS\.decision\[0\] holds the unknown code 3/],
    ["an unknown transform provenance", "VOLS.transformProvenance", [0, 0, 1, 1, 3], /VOLS\.transformProvenance\[4\] holds the unknown code 3/],
    ["a root outside value that is not a bit", "VOLS.rootOutside", [2], /VOLS\.rootOutside\[0\] must be 0 or 1/],
    ["a missing volume location", "VOLS.location", [1, 2], /VOLS\.location holds 2 values; 3 are declared/],
    ["a static mesh index past its vertices", "SMSH.indices", [0, 2, 1, 0, 3, 4], /SMSH\.indices\[5\] = 4 is outside the 4 vertices of mesh 0/],
    ["a static mesh index count that is not whole triangles", "SMSH.indexCount", [5], /SMSH\.indexStart ranges cover 5 entries of 6/],
    ["a placement naming a missing static mesh", "PLAC.mesh", [1], /PLAC\.mesh\[0\] = 1 is outside -1 to 0/],
    ["a mover with no static mesh", "MOVR.mesh", [-1], /MOVR\.mesh\[0\] = -1 is outside 0 to 0/],
    ["a short placement matrix", "PLAC.matrix", [1, 0, 0, 0], /PLAC\.matrix holds 4 values; 16 are declared/],
    ["an unknown mover collision source", "MOVR.collisionSource", [1], /MOVR\.collisionSource\[0\] holds the unknown code 1/],
    ["a terrain rectangle outside its heightmap", "TERR.vertexRectangle", [3, 1, 2, 2], /TERR\.vertexRectangle 3,1 2x2 leaves the 4x4 heightmap/],
    ["a terrain height count off its rectangle", "TERR.heights", [1, 2, 3], /TERR\.heights holds 3 values; 4 are declared/],
    ["a quad visibility value that is not a bit", "TERR.quadVisibility", [7], /TERR\.quadVisibility\[0\] must be 0 or 1/],
  ])("throws CollisionWorldError naming the cell, group and field for %s", (_case, name, values, message) => {
    const decode = () => decodeCell(replaceFixtureArray(collisionChunkFixtureArrays(), name, values));
    expect(decode).toThrow(CollisionWorldError);
    expect(decode).toThrow(message);
  });

  it("refuses a static mesh index count that is not whole triangles when the ranges still cover the indices", () => {
    let arrays = replaceFixtureArray(collisionChunkFixtureArrays(), "SMSH.indexCount", [5]);
    arrays = replaceFixtureArray(arrays, "SMSH.indices", [0, 2, 1, 0, 3]);
    expect(() => decodeCell(arrays)).toThrow(/SMSH\.indexCount\[0\] = 5 is not whole triangles/);
  });
});

describe("decodeNativeTileBspTree", () => {
  it("returns the node planes, children, flags, vertex counts, collision bounds, leaf hulls and root outside bit exactly as written", () => {
    const arrays = collisionBspTreeFixtureArrays();
    const tree = decodeTree(arrays);
    expect(tree.nodeCount).toBe(3);
    expect([...tree.planes]).toEqual(fixtureValues(arrays, "BSPT.planes"));
    expect([...tree.front]).toEqual([1, -1, -1]);
    expect([...tree.back]).toEqual([2, -1, -1]);
    expect([...tree.coplanar]).toEqual([-1, -1, -1]);
    expect([...tree.nodeFlags]).toEqual([0, 1, 32]);
    expect([...tree.numVertices]).toEqual([3, 0, 4]);
    expect([...tree.collisionBound]).toEqual([0, -1, 2]);
    expect([...tree.vertexPool]).toEqual([0, -1, 3]);
    expect([...tree.vertexPoints]).toEqual([0, 1, 2, 0, 1, 2, 3]);
    expect([...tree.points]).toEqual(fixtureValues(arrays, "BSPT.points"));
    expect([...tree.leafHulls]).toEqual([0, -1, 2, -1]);
    expect(tree.rootOutside).toBe(true);
    expect([...tree.surfaceFlags]).toEqual([0, 32, 2147483648]);
  });

  it.each([
    ["a front child outside the node array", "BSPT.front", [3, -1, -1], /tile 20_21 BSPT\.front\[0\] = 3 is outside -1 to 2/],
    ["a back child outside the node array", "BSPT.back", [2, -2, -1], /BSPT\.back\[1\] = -2 is outside -1 to 2/],
    ["a coplanar child outside the node array", "BSPT.coplanar", [-1, 5, -1], /BSPT\.coplanar\[1\] = 5/],
    ["a collision bound past the leaf hulls", "BSPT.collisionBound", [0, -1, 4], /BSPT\.collisionBound\[2\] = 4 is outside -1 to 3/],
    ["a vertex point past the points", "BSPT.vertexPoints", [0, 1, 2, 0, 1, 2, 4], /BSPT\.vertexPoints\[6\] = 4 is outside 0 to 3/],
    ["a vertex pool past the vertex points", "BSPT.vertexPool", [0, -1, 4], /BSPT\.vertexPool\[2\] = 4 with 4 vertices leaves the 7 vertex points/],
    ["a node count mismatch", "BSPT.nodeFlags", [0, 1], /BSPT\.nodeFlags holds 2 values; 3 are declared/],
    ["a root outside value that is not a bit", "BSPT.rootOutside", [9], /BSPT\.rootOutside\[0\] must be 0 or 1/],
  ])("throws CollisionWorldError for %s", (_case, name, values, message) => {
    const decode = () => decodeTree(replaceFixtureArray(collisionBspTreeFixtureArrays(), name, values));
    expect(decode).toThrow(CollisionWorldError);
    expect(decode).toThrow(message);
  });
});
