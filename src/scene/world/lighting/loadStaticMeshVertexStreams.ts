import { fetchVerifiedNativeResource } from "../../../assets/native/fetchVerifiedNativeResource";
import { isPlainRecord } from "../nativeManifestRecordGuards";

export interface StaticMeshVertexStreamPrimitive {
  readonly mesh: number;
  readonly primitive: number;
  readonly nativeVertices: Uint32Array;
}

export interface StaticMeshVertexStreams {
  readonly sourceObject: string;
  readonly nativeVertexCount: number;
  readonly nativePositions: Float32Array;
  readonly nativeNormals: Float32Array;
  readonly primaryColours: Uint8Array;
  readonly alternateColours: Uint8Array;
  readonly primitives: readonly StaticMeshVertexStreamPrimitive[];
}

export class StaticMeshVertexStreamsFormatError extends Error {
  override readonly name = "StaticMeshVertexStreamsFormatError";
}

const vertexStreamsKind = "native-static-mesh-vertex-streams";
const vertexStreamsSchemaVersion = 3;
const vectorComponents = 3;
const colourBytes = 4;
const hexPairPattern = /^(?:[0-9a-f]{2})*$/;
const opaqueWhiteByte = 0xff;

function requireStreams(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StaticMeshVertexStreamsFormatError(`Static mesh vertex streams: ${message}`);
}

function colourStreamBytes(value: unknown, label: string, vertexCount: number): Uint8Array {
  requireStreams(isPlainRecord(value) && typeof value.bgraHex === "string" && hexPairPattern.test(value.bgraHex), `${label} holds no BGRA hex.`);
  const bytes = Uint8Array.from(value.bgraHex.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
  requireStreams(bytes.length === vertexCount * colourBytes, `${label} holds ${bytes.length / colourBytes} colours for ${vertexCount} vertices.`);
  return bytes;
}

function vertexVectors(value: unknown, label: string, vertexCount: number): Float32Array {
  requireStreams(Array.isArray(value) && value.length === vertexCount * vectorComponents &&
    value.every(component => typeof component === "number" && Number.isFinite(component)), `${label} must hold ${vertexCount * vectorComponents} finite numbers.`);
  return Float32Array.from(value as number[]);
}

function parsePrimitive(value: unknown, position: number, vertexCount: number): StaticMeshVertexStreamPrimitive {
  requireStreams(isPlainRecord(value) && Number.isSafeInteger(value.mesh) && (value.mesh as number) >= 0 && Number.isSafeInteger(value.primitive) &&
    (value.primitive as number) >= 0 && Array.isArray(value.nativeVertices) && value.nativeVertices.length > 0, `primitive ${position} is not a glTF vertex map.`);
  const outside = value.nativeVertices.findIndex(vertex => !Number.isSafeInteger(vertex) || vertex < 0 || vertex >= vertexCount);
  requireStreams(outside === -1, `primitive ${position} vertex ${outside} names no native vertex of ${vertexCount}.`);
  return { mesh: value.mesh as number, primitive: value.primitive as number, nativeVertices: Uint32Array.from(value.nativeVertices as number[]) };
}

export function parseStaticMeshVertexStreams(input: unknown): StaticMeshVertexStreams {
  requireStreams(isPlainRecord(input) && input.kind === vertexStreamsKind && input.schemaVersion === vertexStreamsSchemaVersion,
    `the document is not ${vertexStreamsKind} schema ${vertexStreamsSchemaVersion}.`);
  const vertexCount = input.nativeVertexCount;
  requireStreams(typeof input.sourceObject === "string" && input.sourceObject.length > 0, "sourceObject is missing.");
  requireStreams(Number.isSafeInteger(vertexCount) && (vertexCount as number) > 0, "nativeVertexCount is not a positive integer.");
  const count = vertexCount as number;
  const nativePositions = vertexVectors(input.nativePositions, "nativePositions", count), nativeNormals = vertexVectors(input.nativeNormals, "nativeNormals", count);
  requireStreams(Array.isArray(input.primitives) && input.primitives.length > 0, "primitives must be a non-empty list.");
  return { sourceObject: input.sourceObject, nativeVertexCount: count, nativePositions, nativeNormals,
    primaryColours: colourStreamBytes(input.primary, "primary", count), alternateColours: colourStreamBytes(input.alternate, "alternate", count),
    primitives: input.primitives.map((primitive, position) => parsePrimitive(primitive, position, count)) };
}

export function authoredColourStreamsWhite(streams: StaticMeshVertexStreams): boolean {
  return streams.primaryColours.every(byte => byte === opaqueWhiteByte) && streams.alternateColours.every(byte => byte === opaqueWhiteByte);
}

export async function loadStaticMeshVertexStreams(resource: string, sha256: string, bytes: number, signal: AbortSignal): Promise<StaticMeshVertexStreams> {
  const payload = await fetchVerifiedNativeResource(resource, sha256, signal, bytes);
  return parseStaticMeshVertexStreams(JSON.parse(new TextDecoder().decode(payload)));
}
