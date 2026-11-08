import { sha256 } from "../assets/package/readAssetPackage";
import { nativeResourceUrl } from "../assets/native/nativeResourceUrl";
import { readNativeCatalog } from "../assets/native/readNativeCatalog";

export interface EffectResource {
  assetId: string; object: string; file: string; sha256: string; bytes: number;
  source: Record<string, unknown>; kind?: string;
}
export interface EffectPrimitive {
  meshIndex: number; primitiveIndex: number; materialIndex: number;
  nativeSourceReference: string; textureResourceKey: string;
}
export interface EffectComponent {
  object: string; class: string; actor: string; emitterOrdinal: number; sourcePointer: string;
  properties: Record<string, unknown>; effectiveProperties: Record<string, unknown>;
  bindings: { mesh: EffectResource | null; texture: EffectResource | null; primitiveMaterials: EffectPrimitive[] };
}
export interface EffectManifest {
  schemaVersion: number; kind: string; id?: string; bundleId?: string;
  components: EffectComponent[]; resources: Record<string, EffectResource>;
  actors: { object: string; effectiveProperties: Record<string, unknown>; dispatchStages?: string[] }[];
  textureGraph: { object: string; animationProperties: Record<string, unknown> }[];
}
export interface EffectBundle {
  manifest: EffectManifest; manifestSha256: string;
  readResource(resource: EffectResource, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
}
export const effectObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const named = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length < 512;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Effect components: ${message}.`);
}

export function parseEffectManifest(input: unknown): EffectManifest {
  requireValue(effectObject(input) && input.schemaVersion === 1 && input.kind === "native-effect-components", "unsupported manifest");
  requireValue(effectObject(input.resources) && Object.keys(input.resources).length <= 256, "invalid resources");
  const resources = input.resources;
  for (const [key, resource] of Object.entries(resources)) {
    requireValue(effectObject(resource) && key === resource.assetId && named(resource.object) && digest(resource.sha256) &&
      integer(resource.bytes) && resource.bytes > 0 && resource.bytes <= 128 * 1024 * 1024 &&
      (resource.file === `resources/${resource.sha256}.glb` || resource.file === `resources/${resource.sha256}.png`) &&
      effectObject(resource.source), "invalid content-addressed resource");
  }
  const resourceBinding = (value: unknown, extension: string) => {
    if (value === null || value === undefined) return;
    requireValue(effectObject(value) && named(value.assetId), "missing bound resource identity");
    const canonical = resources[value.assetId];
    requireValue(effectObject(canonical) && canonical.object === value.object && canonical.sha256 === value.sha256 &&
      canonical.bytes === value.bytes && canonical.file === value.file && String(value.file).endsWith(extension), "mismatched bound resource");
  };
  requireValue(Array.isArray(input.actors) && input.actors.length > 0 && input.actors.length <= 64, "invalid actors");
  const actors = new Set<string>();
  for (const actor of input.actors) {
    requireValue(effectObject(actor) && named(actor.object) && !actors.has(actor.object) && effectObject(actor.effectiveProperties), "invalid actor identity");
    actors.add(actor.object);
  }
  requireValue(Array.isArray(input.components) && input.components.length > 0 && input.components.length <= 64, "invalid components");
  const ids = new Set<string>(), ordinals = new Set<string>();
  for (const component of input.components) {
    requireValue(effectObject(component) && named(component.object) && !ids.has(component.object) &&
      named(component.actor) && actors.has(component.actor) && integer(component.emitterOrdinal) &&
      typeof component.sourcePointer === "string" && /^\/effects\/\d+\/children\/\d+$/.test(component.sourcePointer) &&
      effectObject(component.properties) && effectObject(component.effectiveProperties) && effectObject(component.bindings), "invalid component identity");
    ids.add(component.object);
    const ordinal = `${component.actor}:${component.emitterOrdinal}`;
    requireValue(!ordinals.has(ordinal), "duplicate emitter ordinal"); ordinals.add(ordinal);
    resourceBinding(component.bindings.mesh, ".glb"); resourceBinding(component.bindings.texture, ".png");
    requireValue(Array.isArray(component.bindings.primitiveMaterials), "missing primitive bindings");
    const primitives = new Set<string>();
    for (const primitive of component.bindings.primitiveMaterials) {
      requireValue(effectObject(primitive) && integer(primitive.meshIndex) && integer(primitive.primitiveIndex) &&
        integer(primitive.materialIndex) && named(primitive.textureResourceKey) && named(primitive.nativeSourceReference), "invalid primitive binding");
      const texture = resources[primitive.textureResourceKey];
      requireValue(effectObject(texture) && texture.object === primitive.nativeSourceReference && String(texture.file).endsWith(".png"), "primitive texture identity differs");
      const key = `${primitive.meshIndex}:${primitive.primitiveIndex}`;
      requireValue(!primitives.has(key), "duplicate primitive binding"); primitives.add(key);
    }
    if (component.class === "Engine.MeshEmitter") requireValue(component.bindings.mesh && primitives.size > 0, "mesh component has no original primitive");
    else if (component.class === "Engine.SpriteEmitter") requireValue(component.bindings.texture && !component.bindings.mesh, "sprite component has no original texture");
    else throw new Error("Effect component type is not supported.");
  }
  requireValue(Array.isArray(input.textureGraph) && input.textureGraph.length <= 256, "invalid texture graph");
  const textures = new Set<string>();
  for (const texture of input.textureGraph) {
    requireValue(effectObject(texture) && named(texture.object) && !textures.has(texture.object) && effectObject(texture.animationProperties), "invalid texture graph entry");
    textures.add(texture.object);
  }
  return input as unknown as EffectManifest;
}

async function verified(path: string, expected: { sha256: string; bytes?: number }, signal: AbortSignal, maximum: number) {
  signal.throwIfAborted();
  const response = await fetch(nativeResourceUrl(path), { signal });
  if (!response.ok) throw new Error(`Effect resource returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maximum || (expected.bytes !== undefined && bytes.length !== expected.bytes) || await sha256(bytes) !== expected.sha256) {
    throw new Error("Effect resource content differs from its manifest.");
  }
  signal.throwIfAborted(); return bytes;
}

export async function loadNativeEffectComponents(signal: AbortSignal): Promise<EffectBundle | null> {
  signal.throwIfAborted();
  const { effectComponents } = await readNativeCatalog(signal);
  requireValue(effectComponents.length <= 64, "invalid effect catalog entries");
  const entries = effectComponents.filter(row => effectObject(row) && row.id === "interlude:skill:3:level:1:raw-source-dispatch");
  if (!entries.length) return null;
  requireValue(entries.length === 1 && effectObject(entries[0]) && digest(entries[0].manifestSha256), "ambiguous selected effect");
  const entry = entries[0], manifestSha256 = entry.manifestSha256 as string;
  const base = `/l2/effects/${manifestSha256}/`;
  requireValue(entry.manifest === base + "manifest.json", "invalid manifest path");
  const manifest = parseEffectManifest(JSON.parse(new TextDecoder().decode(await verified(entry.manifest as string,
    { sha256: manifestSha256 }, signal, 2 * 1024 * 1024))));
  requireValue((manifest.bundleId ?? manifest.id) === entry.id, "bundle identity differs");
  return { manifest, manifestSha256, readResource: (resource, resourceSignal) => {
    const canonical = manifest.resources[resource.assetId];
    requireValue(canonical && canonical.sha256 === resource.sha256 && canonical.file === resource.file &&
      canonical.object === resource.object && canonical.bytes === resource.bytes &&
      JSON.stringify(canonical.source) === JSON.stringify(resource.source), "resource is not owned by this bundle");
    return verified(base + canonical.file, canonical, resourceSignal, 128 * 1024 * 1024);
  } };
}

export interface EffectFrame { label: string; texture: EffectResource; uvScale: [number, number]; uvOffset: [number, number]; sourceTile: number | null }
export function effectFrames(manifest: EffectManifest, component: EffectComponent, texture: EffectResource): EffectFrame[] {
  const frames: EffectFrame[] = [], seen = new Set<string>();
  let current: EffectResource | undefined = texture;
  while (current) {
    requireValue(!seen.has(current.object) && frames.length < 64, "cyclic or excessive texture frame chain"); seen.add(current.object);
    frames.push({ label: current.object.split(".").at(-1)!, texture: current, uvScale: [1, 1], uvOffset: [0, 0], sourceTile: null });
    const next = manifest.textureGraph.find(row => row.object === current!.object)?.animationProperties.AnimNext;
    if (next === undefined) break;
    requireValue(effectObject(next) && named(next.object), "invalid AnimNext reference");
    const matches = Object.values(manifest.resources).filter(row => row.object === next.object && row.file.endsWith(".png"));
    requireValue(matches.length === 1, "missing or ambiguous AnimNext resource"); current = matches[0];
  }
  const properties = component.effectiveProperties;
  const columns = properties.TextureUSubdivisions ?? 1, rows = properties.TextureVSubdivisions ?? 1;
  requireValue(integer(columns) && columns > 0 && columns <= 64 && integer(rows) && rows > 0 && rows <= 64, "invalid atlas subdivisions");
  if (columns * rows === 1) return frames;
  requireValue(frames.length === 1, "combined atlas and texture animation is not supported");
  const start = properties.SubdivisionStart ?? 0, end = properties.SubdivisionEnd ?? columns * rows - 1;
  requireValue(integer(start) && integer(end) && end >= start && end < columns * rows && end - start < 64, "invalid atlas tile range");
  return Array.from({ length: end - start + 1 }, (_, offset) => {
    const tile = start + offset;
    return { label: `Tile ${tile}`, texture, uvScale: [1 / columns, 1 / rows],
      uvOffset: [(tile % columns) / columns, Math.floor(tile / columns) / rows], sourceTile: tile };
  });
}
