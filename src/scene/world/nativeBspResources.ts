import { hasExactKeys, isPlainRecord, nativeTileSha256Pattern } from "./nativeManifestRecordGuards";

export const nativeBspResources: Readonly<Record<string, { brush: string; stem: string; placement: string }>> = {
  "interlude:20_20.Model798.Brush397": { brush: "20_20.Brush397", stem: "bsp-floor", placement: "interlude:20_20.StaticMeshActor940" },
  ...Object.fromEntries(["walls", "floor", "ceiling"].map(part => [
    `interlude:20_20.Model798.Brush610.${part}`,
    { brush: "20_20.Brush610", stem: `bsp-command-${part}`, placement: "interlude:20_20.StaticMeshActor1913" },
  ])),
};

export interface NativeTileBspResource {
  readonly resource: string;
  readonly sha256: string;
}

export interface NativeBspSection {
  readonly primitive: number;
  readonly material: string;
  readonly unlit: boolean;
  readonly lightmap: number | null;
  readonly outdoor: boolean;
  readonly translucent: boolean;
}

export interface NativeBspNodeRange {
  readonly node: number;
  readonly primitive: number;
  readonly firstIndex: number;
  readonly indexCount: number;
}

export interface NativeBspSectionExtras {
  readonly sections: readonly NativeBspSection[];
  readonly nodeRanges: readonly NativeBspNodeRange[];
}

const tileBspResourceFields = ["resource", "sha256"];
const sectionFields = ["primitive", "material", "unlit", "lightmap", "outdoor", "translucent"];
const nodeRangeFields = ["node", "primitive", "firstIndex", "indexCount"];
const tileBspResourcePattern = /^\/l2\/maps\/([a-f0-9]{64})\/native-tile-chunk-bsp\/bsp\.glb$/;
const maximumBspSections = 4096;
const maximumBspNodeRanges = 1_000_000;

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseNativeTileBspResource(input: unknown): NativeTileBspResource {
  if (!hasExactKeys(input, tileBspResourceFields) || typeof input.sha256 !== "string" || !nativeTileSha256Pattern.test(input.sha256) ||
    typeof input.resource !== "string") {
    throw new Error("Native tile BSP resource must hold exactly resource and a lowercase SHA-256.");
  }
  if (tileBspResourcePattern.exec(input.resource)?.[1] !== input.sha256) {
    throw new Error("Native tile BSP resource must be /l2/maps/<its sha256>/native-tile-chunk-bsp/bsp.glb.");
  }
  return { resource: input.resource, sha256: input.sha256 };
}

function parseSection(value: unknown, index: number): NativeBspSection {
  if (!hasExactKeys(value, sectionFields) || value.primitive !== index || typeof value.material !== "string" || !value.material ||
    typeof value.unlit !== "boolean" || !(value.lightmap === null || (Number.isSafeInteger(value.lightmap) && (value.lightmap as number) >= -1)) ||
    typeof value.outdoor !== "boolean" || typeof value.translucent !== "boolean") {
    throw new Error(`Native BSP section ${index} is invalid.`);
  }
  return { primitive: index, material: value.material, unlit: value.unlit, lightmap: value.lightmap as number | null, outdoor: value.outdoor,
    translucent: value.translucent };
}

function parseNodeRange(value: unknown, sectionCount: number): NativeBspNodeRange {
  if (!hasExactKeys(value, nodeRangeFields) || !isCount(value.node) || !isCount(value.primitive) || value.primitive >= sectionCount ||
    !isCount(value.firstIndex) || !isCount(value.indexCount) || value.indexCount === 0 || value.indexCount % 3 !== 0) {
    throw new Error("Native BSP node range is invalid.");
  }
  return { node: value.node, primitive: value.primitive, firstIndex: value.firstIndex, indexCount: value.indexCount };
}

function requireContiguousRanges(nodeRanges: readonly NativeBspNodeRange[], sectionCount: number): void {
  const nextIndexBySection = new Array<number>(sectionCount).fill(0), nodes = new Set<number>();
  for (const range of nodeRanges) {
    if (nodes.has(range.node)) throw new Error(`Native BSP node ${range.node} has two ranges.`);
    if (range.firstIndex !== nextIndexBySection[range.primitive]) throw new Error(`Native BSP node ${range.node} range is not contiguous in its section.`);
    nodes.add(range.node);
    nextIndexBySection[range.primitive] = range.firstIndex + range.indexCount;
  }
}

export function parseNativeBspSectionExtras(extras: unknown): NativeBspSectionExtras {
  if (!isPlainRecord(extras) || !Array.isArray(extras.nativeBspSections) || !Array.isArray(extras.nativeBspNodeRanges) ||
    !extras.nativeBspSections.length || extras.nativeBspSections.length > maximumBspSections ||
    extras.nativeBspNodeRanges.length > maximumBspNodeRanges) {
    throw new Error("Native BSP GLB extras must list sections and node ranges.");
  }
  const sections = extras.nativeBspSections.map(parseSection);
  const nodeRanges = extras.nativeBspNodeRanges.map(range => parseNodeRange(range, sections.length));
  requireContiguousRanges(nodeRanges, sections.length);
  return { sections, nodeRanges };
}
