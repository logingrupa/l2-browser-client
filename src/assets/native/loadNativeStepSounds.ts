import { sha256 } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";
import {
  FOOTSTEP_SURFACES, isFootstepSurface, type FootstepSurfaceId, type StepSoundClip, type StepSoundLibrary,
  type StepSoundPlacement, type StepSoundPlacementSlot, type StepSoundSurface,
} from "../../audio/footstepSurfaces";

export const NATIVE_STEPSOUND_PACKAGE_KIND = "native-stepsound-package";
const hash = /^[a-f0-9]{64}$/;
const objectPath = /^[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)+$/;
function requireMatch(value: unknown, message: string): asserts value { if (!value) throw Error(`Stepsound package: ${message}`); }
function record(value: unknown, label = "record"): Record<string, unknown> {
  requireMatch(value && typeof value === "object" && !Array.isArray(value), `invalid ${label}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label = "identity"): string {
  requireMatch(typeof value === "string" && value.length > 0 && value.length <= 512, `invalid ${label}`); return value;
}
function list(value: unknown, limit: number, label = "list"): unknown[] {
  requireMatch(Array.isArray(value) && value.length <= limit, `invalid ${label}`); return value;
}

export interface NativeStepSoundBundle {
  library: StepSoundLibrary | null;
  sounds: { key: string; bytes: Uint8Array }[];
  manifest: string | null;
}
export interface NativeStepSoundLoadOptions {
  /** Injected for tests; defaults to a verified same-origin fetch. */
  fetchBytes?: (path: string, signal: AbortSignal) => Promise<Uint8Array>;
}

async function defaultFetch(path: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(nativeResourceUrl(path), { signal });
  requireMatch(response.ok, `request returned ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function pinned(fetchBytes: NonNullable<NativeStepSoundLoadOptions["fetchBytes"]>, path: string, expectedHash: string,
  size: number, signal: AbortSignal): Promise<Uint8Array> {
  requireMatch(hash.test(expectedHash) && Number.isSafeInteger(size) && size > 0 && size <= 8_000_000, "invalid resource pin");
  const bytes = await fetchBytes(path, signal);
  requireMatch(bytes.length === size && await sha256(bytes) === expectedHash, `resource hash/length mismatch: ${path}`);
  signal.throwIfAborted(); return bytes;
}

/** Loads the package-keyed stepsound bundle from `catalog.animationAudio`
 * entries of kind `native-stepsound-package`. Every original Sound is verified
 * and classified exactly once; a missing entry yields `library: null`. */
export async function loadNativeStepSounds(records: unknown, signal: AbortSignal,
  options: NativeStepSoundLoadOptions = {}): Promise<NativeStepSoundBundle> {
  const fetchBytes = options.fetchBytes ?? defaultFetch;
  const entries = list(records ?? [], 16, "catalog list").map(value => record(value, "catalog entry"))
    .filter(entry => entry.kind === NATIVE_STEPSOUND_PACKAGE_KIND);
  requireMatch(entries.length <= 1, "multiple package entries");
  const entry = entries[0];
  if (!entry) return { library: null, sounds: [], manifest: null };
  const manifestHash = text(entry.manifestSha256), prefix = `/l2/step-sounds/${manifestHash}/`;
  requireMatch(hash.test(manifestHash) && entry.manifest === `${prefix}manifest.json`, "invalid catalog entry");
  const bytes = await pinned(fetchBytes, `${prefix}manifest.json`, manifestHash, Number(entry.manifestBytes), signal);
  const manifest = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), "manifest");
  requireMatch(manifest.schemaVersion === 1 && manifest.kind === NATIVE_STEPSOUND_PACKAGE_KIND, "unsupported manifest");
  const packageInfo = record(manifest.package, "package");
  const packageSha = text(packageInfo.sha256);
  requireMatch(hash.test(packageSha), "invalid package hash");

  interface Row { clip: StepSoundClip; file: string; bytes: number; classification: Record<string, unknown> }
  const rows = new Map<string, Row>();
  for (const raw of list(manifest.sounds, 4096, "sounds")) {
    const sound = record(raw, "sound"), dependencyId = text(sound.dependencyId), sha = text(sound.sha256), object = text(sound.object);
    const duration = Number(sound.durationSeconds), source = record(sound.source, "sound source");
    requireMatch(!rows.has(dependencyId) && hash.test(sha) && sound.file === `audio/${sha}.wav` && sound.mime === "audio/wav" &&
      Number.isSafeInteger(sound.bytes) && Number(sound.bytes) > 0 && Number(sound.bytes) <= 8_000_000 &&
      objectPath.test(object) && Number.isFinite(duration) && duration > 0 && duration < 60 &&
      source.packageSha256 === packageSha && dependencyId.endsWith(`:${packageSha}:${String(source.exportIndex)}`),
    `invalid or duplicated sound ${dependencyId}`);
    rows.set(dependencyId, { clip: { key: `native-stepsound:${sha}`, object, dependencyId, sha256: sha, durationSeconds: duration },
      file: sound.file as string, bytes: Number(sound.bytes), classification: record(sound.classification, "classification") });
  }
  requireMatch(rows.size === packageInfo.soundCount, "sound count differs from the package");
  const consumed = new Set<string>();
  const take = (value: unknown, kind: string, id: string, gait: string | null): StepSoundClip => {
    const key = text(value, "dependency"), row = rows.get(key);
    requireMatch(row && !consumed.has(key) && row.classification.class === kind && row.classification.id === id &&
      (row.classification.gait ?? null) === gait, `classification differs for ${key}`);
    consumed.add(key); return row.clip;
  };
  const surfaces = new Map<FootstepSurfaceId, StepSoundSurface>();
  for (const raw of list(manifest.surfaces, 64, "surfaces")) {
    const surface = record(raw, "surface"), id = surface.id;
    requireMatch(isFootstepSurface(id) && !surfaces.has(id), `unknown or duplicate surface ${String(id)}`);
    const gaitSplit = surface.gaitSplit === true;
    const walk = gaitSplit ? list(surface.walk, 16).map(value => take(value, "surface", id, "walk")) :
      list(surface.clips, 16).map(value => take(value, "surface", id, null));
    const run = gaitSplit ? list(surface.run, 16).map(value => take(value, "surface", id, "run")) : walk;
    requireMatch(walk.length > 0 && run.length > 0, `surface ${id} has no clips`);
    surfaces.set(id, { id, label: text(surface.label), group: text(surface.group), gaitSplit, walk, run });
  }
  requireMatch(surfaces.size === FOOTSTEP_SURFACES.length, "surface set differs from the 16 original groups");
  const events = new Map<string, StepSoundClip>();
  for (const raw of list(manifest.events, 16, "events")) {
    const event = record(raw, "event"), id = text(event.id);
    requireMatch(!events.has(id), "duplicate event"); events.set(id, take(event.dependencyId, "event", id, null));
  }
  const waterIn = events.get("Water_In"), waterOut = events.get("Water_Out");
  requireMatch(waterIn && waterOut && events.size === 2, "water entry/exit events are missing");
  const layers = list(manifest.layers, 16, "layers").map(value => record(value, "layer"));
  const bootsLayer = layers.find(layer => layer.id === "noise_boots");
  requireMatch(bootsLayer && layers.length === 1, "boot noise layer is missing");
  const boots = list(bootsLayer.clips, 16).map(value => take(value, "layer", "noise_boots", null));
  requireMatch(consumed.size === rows.size, "unclassified package sounds remain");

  const placements = new Map<string, StepSoundPlacement>();
  let sectionManifestSha256: string | null = null;
  if (manifest.placements != null) {
    const declared = record(manifest.placements, "placements");
    const section = record(record(declared.section, "placement section").manifest, "placement section manifest");
    sectionManifestSha256 = text(section.sha256);
    requireMatch(hash.test(sectionManifestSha256), "invalid placement section hash");
    for (const raw of list(declared.declared, 4096, "placement declarations")) {
      const placement = record(raw, "placement"), placementId = text(placement.placementId);
      requireMatch(!placements.has(placementId), "duplicate placement declaration");
      const slots: StepSoundPlacementSlot[] = [], properties = new Set<string>();
      for (const rawSlot of list(placement.slots, 3, "placement slots")) {
        const slot = record(rawSlot, "placement slot"), property = slot.property;
        requireMatch((property === "StepSound_1" || property === "StepSound_2" || property === "StepSound_3") && !properties.has(property),
          "invalid or duplicated placement slot property");
        properties.add(property);
        if (slot.status !== "source-declared") continue;
        const row = rows.get(text(slot.dependencyId)), reference = text(slot.reference);
        requireMatch(row && reference.toLowerCase() === row.clip.object.toLowerCase(), "placement slot differs from its package Sound");
        slots.push({ property, reference, clip: row.clip });
      }
      requireMatch(slots.length > 0, "placement declaration has no Sound");
      const clips = slots.map(slot => slot.clip), references = slots.map(slot => slot.reference);
      const groups = new Set(clips.map(clip => clip.object.split(".")[1]?.toLowerCase()));
      const group = groups.size === 1 ? [...groups][0] : undefined;
      const surface = FOOTSTEP_SURFACES.find(id => id.toLowerCase() === group) ?? null;
      placements.set(placementId, { placementId, sourceMesh: text(placement.sourceMesh), slots, clips, references, surface });
    }
  }
  const unique = new Map<string, Row>();
  for (const row of rows.values()) if (!unique.has(row.clip.key)) unique.set(row.clip.key, row);
  const sounds = await Promise.all([...unique.values()].map(async row =>
    ({ key: row.clip.key, bytes: await pinned(fetchBytes, prefix + row.file, row.clip.sha256, row.bytes, signal) })));
  signal.throwIfAborted();
  return { manifest: manifestHash, sounds, library: { manifestSha256: manifestHash, packageSha256: packageSha, soundCount: rows.size,
    surfaces, events: { Water_In: waterIn, Water_Out: waterOut }, boots, placements, sectionManifestSha256 } };
}
