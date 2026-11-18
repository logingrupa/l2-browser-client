import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Geometry } from "@babylonjs/core/Meshes/geometry";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { instanceColourAttributeName } from "../../../materials/ue2/babylon/material";

export interface StaticMeshInstanceColourGeometry {
  readonly mesh: Mesh;
  writeColours(nativeRgb: Uint8Array): void;
}

const rgbaBytes = 4;
const rgbChannels = 3;
const opaqueAlpha = 255;

function wrappedVertexBuffer(source: VertexBuffer, engine: ReturnType<Mesh["getEngine"]>): VertexBuffer {
  return new VertexBuffer(engine, source.getWrapperBuffer(), source.getKind(), { updatable: false, useBytes: true, stride: source.byteStride,
    offset: source.byteOffset, size: source.getSize(), type: source.type, normalized: source.normalized, instanced: source.getIsInstanced(),
    divisor: source.getInstanceDivisor() });
}

export function createStaticMeshInstanceColourGeometry(mesh: Mesh, nativeVertices: Uint32Array): StaticMeshInstanceColourGeometry {
  const template = mesh.geometry, indices = template?.getIndices();
  if (!template || !indices) throw new Error(`Static mesh ${mesh.name} has no indexed geometry to light.`);
  const vertexCount = template.getTotalVertices();
  if (vertexCount !== nativeVertices.length) throw new Error(`Static mesh ${mesh.name} draws ${vertexCount} vertices for ${nativeVertices.length} native vertices.`);
  const engine = mesh.getEngine();
  const geometry = new Geometry(`${mesh.name} instance colour`, mesh.getScene());
  for (const kind of template.getVerticesDataKinds()) geometry.setVerticesBuffer(wrappedVertexBuffer(template.getVertexBuffer(kind)!, engine), vertexCount);
  const colours = new Uint8Array(vertexCount * rgbaBytes).fill(opaqueAlpha);
  const colourBuffer = new VertexBuffer(engine, colours, instanceColourAttributeName, { updatable: true, useBytes: true, stride: rgbaBytes,
    size: rgbaBytes, type: VertexBuffer.UNSIGNED_BYTE, normalized: true });
  geometry.setVerticesBuffer(colourBuffer, vertexCount);
  geometry.setIndices(indices.slice(), vertexCount);
  geometry.applyToMesh(mesh);
  return {
    mesh,
    writeColours(nativeRgb) {
      nativeVertices.forEach((nativeVertex, vertex) => colours.set(nativeRgb.subarray(nativeVertex * rgbChannels, nativeVertex * rgbChannels + rgbChannels), vertex * rgbaBytes));
      colourBuffer.update(colours);
    },
  };
}
