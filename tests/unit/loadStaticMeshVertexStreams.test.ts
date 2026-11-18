import { describe, expect, it } from "vitest";
import { authoredColourStreamsWhite, parseStaticMeshVertexStreams } from "../../src/scene/world/lighting/loadStaticMeshVertexStreams";

const document = (fields: Record<string, unknown> = {}) => ({ kind: "native-static-mesh-vertex-streams", schemaVersion: 3, sourceObject: "cruma_s.f_04",
  nativeVertexCount: 2, nativePositions: [160.5, -0.0001, -322.875, -160.5, 0.0001, 322.875], nativeNormals: [0, 0, 1, 1, 0, 0],
  primary: { bgraHex: "ffffffffffffffff", revision: 1 }, alternate: { bgraHex: "ffffffffffffffff", revision: 2 }, selector: null,
  selectorGapReason: "static-mesh-colour-selector-unresolved", primitives: [{ mesh: 0, primitive: 0, nativeVertices: [1, 0] }], ...fields });

describe("static mesh vertex stream sidecar (schema 3)", () => {
  it("reads the source positions and normals, both authored streams and the glTF vertex map", () => {
    const streams = parseStaticMeshVertexStreams(document());
    expect(Array.from(streams.nativePositions)).toEqual([160.5, -0.0001, -322.875, -160.5, 0.0001, 322.875].map(Math.fround));
    expect(Array.from(streams.nativeNormals)).toEqual([0, 0, 1, 1, 0, 0]);
    expect(Array.from(streams.primitives[0]!.nativeVertices)).toEqual([1, 0]);
    expect(authoredColourStreamsWhite(streams)).toBe(true);
    expect(authoredColourStreamsWhite(parseStaticMeshVertexStreams(document({ primary: { bgraHex: "ffffffff10203040", revision: 1 } })))).toBe(false);
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["the schema 1 colour stream sidecar", { kind: "native-static-mesh-colour-streams", schemaVersion: 1 }, /is not native-static-mesh-vertex-streams schema 3/],
    ["the schema 2 sidecar without source positions", { schemaVersion: 2, nativePositions: undefined }, /is not native-static-mesh-vertex-streams schema 3/],
    ["positions that miss a vertex", { nativePositions: [0, 0, 1] }, /nativePositions must hold 6 finite numbers/],
    ["normals that miss a vertex", { nativeNormals: [0, 0, 1] }, /nativeNormals must hold 6 finite numbers/],
    ["an authored stream of another length", { alternate: { bgraHex: "ffffffff", revision: 2 } }, /alternate holds 1 colours for 2 vertices/],
    ["a vertex map naming a vertex past the mesh", { primitives: [{ mesh: 0, primitive: 0, nativeVertices: [2] }] }, /primitive 0 vertex 0 names no native vertex of 2/],
  ])("refuses %s", (_, fields, message) => {
    expect(() => parseStaticMeshVertexStreams(document(fields))).toThrow(message);
  });
});
