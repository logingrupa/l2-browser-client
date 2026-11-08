import { sha256 } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";
import { nativeFlameNativeToBrowser } from "../../scene/world/nativeFlameBillboards";
import { readNativeCatalog } from "./readNativeCatalog";

const hash = /^[a-f0-9]{64}$/;
const MAX_PAYLOAD = 8_000_000;
const ambientSoundObjectDefaultRadius = 64;
const ambientSoundObjectDefaultVolume = 190;
export const nativeAmbientEmitterFields = ["id", "exportIndex", "x", "y", "z", "soundRadius", "soundVolume", "soundPitch",
  "ambientSoundType", "ambientRandom", "ambientSoundStartTime", "sound", "zone", "zoneNumber", "group"] as const;

export type NativeVector = [number, number, number];
type NativeUnrealWorldUnitsVector = NativeVector;
type BrowserMetresFromSectionPlacementAxes = NativeVector;
type FieldNamesUsingEngineClassDefaults = string[];
type NativeWorldPlaneInsideWhenNonPositive = [number, number, number, number];

export interface NativeWorldAudioFile { file: string; bytes: number; sha256: string; mime: string }

export interface NativeAmbientEmitter {
  id: string; exportIndex: number;
  native: NativeUnrealWorldUnitsVector;
  position: BrowserMetresFromSectionPlacementAxes;
  soundRadius: number; soundVolume: number; soundPitch: number | null;
  ambientSoundType: number | null; ambientRandom: number | null; ambientSoundStartTime: number | null;
  sound: string | null; zone: string | null; zoneNumber: number | null; group: string | null;
  defaults: FieldNamesUsingEngineClassDefaults;
}

export interface NativeAmbientSound extends NativeWorldAudioFile { key: string; object: string; durationSeconds: number }

export interface NativeAmbience {
  manifestSha256: string;
  emitters: NativeAmbientEmitter[];
  sounds: ReadonlyMap<string, NativeAmbientSound>;
  radiusMultiplier: { value: number; symbol: string; status: string; imageSha256: string };
  fetchSound(key: string, signal: AbortSignal): Promise<Uint8Array>;
}

export interface NativeMusicTrack {
  key: string; storedString: string; durationSeconds: number;
  original: NativeWorldAudioFile & { sourceSha256: string; sourcePath: string };
  derivative: NativeWorldAudioFile & { label: string };
}

export interface NativeMusicVolume {
  id: string; object: string; exportIndex: number; musicId: number; forcePlayMusic: boolean | null; group: string | null;
  planes: NativeWorldPlaneInsideWhenNonPositive[];
  boundsNative: { min: NativeVector; max: NativeVector };
  tracks: string[];
}

export interface NativeMusic {
  manifestSha256: string;
  volumes: NativeMusicVolume[];
  tracks: ReadonlyMap<string, NativeMusicTrack>;
  fetchTrack(key: string, variant: "original" | "derivative", signal: AbortSignal): Promise<Uint8Array>;
}

export interface NativeWorldAudio { music: NativeMusic | null; ambience: NativeAmbience | null; manifests: string[] }

function requireMatch(value: unknown, text: string): asserts value { if (!value) throw new Error(`World audio: ${text}`); }
function object(value: unknown, label = "record"): Record<string, unknown> {
  requireMatch(value && typeof value === "object" && !Array.isArray(value), `invalid ${label}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 512): string {
  requireMatch(typeof value === "string" && value.length > 0 && value.length <= max, `invalid ${label}`); return value;
}
function optionalText(value: unknown, label: string): string | null { return value === null || value === undefined ? null : text(value, label); }
function finite(value: unknown, label: string): number { requireMatch(typeof value === "number" && Number.isFinite(value), `invalid ${label}`); return value; }
function optionalNumber(value: unknown, label: string): number | null { return value === null || value === undefined ? null : finite(value, label); }
function list(value: unknown, limit: number, label: string): unknown[] {
  requireMatch(Array.isArray(value) && value.length <= limit, `invalid ${label} list`); return value;
}
function vector(value: unknown, label: string): NativeVector {
  const values = list(value, 3, label).map(item => finite(item, label));
  requireMatch(values.length === 3, `invalid ${label}`); return values as NativeVector;
}

async function resource(path: string, expectedHash: string, size: number, signal: AbortSignal): Promise<Uint8Array> {
  requireMatch(hash.test(expectedHash) && Number.isSafeInteger(size) && size > 0 && size <= MAX_PAYLOAD, "invalid resource pin");
  const response = await fetch(nativeResourceUrl(path), { signal });
  requireMatch(response.ok, `request returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  requireMatch(bytes.length === size && await sha256(bytes) === expectedHash, "resource hash/length mismatch");
  signal.throwIfAborted(); return bytes;
}

function audioFile(value: unknown, prefix: string, extension: string, mimes: readonly string[]): NativeWorldAudioFile {
  const row = object(value, "audio file"), sha = text(row.sha256, "audio hash"), file = text(row.file, "audio path");
  requireMatch(hash.test(sha) && file === `${prefix}/${sha}.${extension}` && Number.isSafeInteger(row.bytes) &&
    Number(row.bytes) > 0 && Number(row.bytes) <= MAX_PAYLOAD && mimes.includes(String(row.mime)), "invalid audio descriptor");
  return { file, bytes: Number(row.bytes), sha256: sha, mime: String(row.mime) };
}

export async function readNativeWorldAudioRecords(signal: AbortSignal): Promise<readonly unknown[]> {
  return (await readNativeCatalog(signal)).worldAudio;
}

function parseAmbience(manifest: Record<string, unknown>, manifestSha256: string, prefix: string): NativeAmbience {
  const fields = list(manifest.emitterFields, 32, "emitter field");
  requireMatch(fields.length === nativeAmbientEmitterFields.length && fields.every((field, i) => field === nativeAmbientEmitterFields[i]),
    "unsupported emitter table layout");
  const sounds = new Map<string, NativeAmbientSound>();
  for (const raw of list(manifest.sounds, 4096, "ambient sound")) {
    const row = object(raw, "ambient sound"), key = text(row.key, "sound key");
    requireMatch(!sounds.has(key), "duplicate ambient sound");
    const duration = finite(row.durationSeconds, "sound duration");
    requireMatch(duration > 0 && duration < 600, "invalid sound duration");
    sounds.set(key, { ...audioFile(row, "audio", "wav", ["audio/wav"]), key, object: text(row.object, "sound object"), durationSeconds: duration });
  }
  const ids = new Set<string>();
  const emitters = list(manifest.emitters, 20000, "emitter").map(raw => {
    const row = list(raw, 32, "emitter row");
    requireMatch(row.length === nativeAmbientEmitterFields.length, "invalid emitter row");
    const value = (name: typeof nativeAmbientEmitterFields[number]) => row[nativeAmbientEmitterFields.indexOf(name)];
    const id = text(value("id"), "emitter id"), sound = optionalText(value("sound"), "emitter sound");
    requireMatch(!ids.has(id) && (sound === null || sounds.has(sound)), "duplicate emitter or unknown sound"); ids.add(id);
    const native: NativeVector = [finite(value("x"), "x"), finite(value("y"), "y"), finite(value("z"), "z")];
    const defaults = (["soundRadius", "soundVolume", "soundPitch", "ambientSoundType", "ambientRandom", "ambientSoundStartTime"] as const)
      .filter(name => value(name) === null || value(name) === undefined);
    const radius = defaults.includes("soundRadius") ? ambientSoundObjectDefaultRadius : finite(value("soundRadius"), "radius");
    const volume = defaults.includes("soundVolume") ? ambientSoundObjectDefaultVolume : finite(value("soundVolume"), "volume");
    requireMatch(radius > 0 && radius <= 100000 && Number.isInteger(volume) && volume >= 0 && volume <= 255, "invalid radius/volume");
    return { id, exportIndex: finite(value("exportIndex"), "export index"), native, position: nativeFlameNativeToBrowser(native),
      soundRadius: radius, soundVolume: volume, soundPitch: optionalNumber(value("soundPitch"), "pitch"),
      ambientSoundType: optionalNumber(value("ambientSoundType"), "type"), ambientRandom: optionalNumber(value("ambientRandom"), "random"),
      ambientSoundStartTime: optionalNumber(value("ambientSoundStartTime"), "start time"), sound,
      zone: optionalText(value("zone"), "zone"), zoneNumber: optionalNumber(value("zoneNumber"), "zone number"),
      group: optionalText(value("group"), "group"), defaults: [...defaults] } satisfies NativeAmbientEmitter;
  });
  const radius = object(object(manifest.radius, "radius").maxRadiusMultiplier, "radius multiplier");
  const multiplier = finite(radius.value, "radius multiplier");
  requireMatch(multiplier > 0 && multiplier <= 1000, "invalid radius multiplier");
  return { manifestSha256, emitters, sounds,
    radiusMultiplier: { value: multiplier, symbol: text(radius.symbol, "radius symbol"), status: text(radius.status, "radius status"),
      imageSha256: text(object(radius.image, "radius image").sha256, "radius image hash") },
    fetchSound(key, signal) {
      const sound = sounds.get(key);
      requireMatch(sound, `unknown ambient sound ${key}`);
      return resource(prefix + sound.file, sound.sha256, sound.bytes, signal);
    } };
}

function parseMusic(manifest: Record<string, unknown>, manifestSha256: string, prefix: string): NativeMusic {
  const tracks = new Map<string, NativeMusicTrack>();
  for (const raw of list(manifest.tracks, 256, "music track")) {
    const row = object(raw, "music track"), key = text(row.key, "track key"), original = object(row.original, "track original");
    requireMatch(!tracks.has(key), "duplicate music track");
    const derivative = object(row.derivative, "track derivative");
    tracks.set(key, { key, storedString: text(row.storedString, "stored string"), durationSeconds: finite(row.durationSeconds, "track duration"),
      original: { ...audioFile(row, "audio", "ogg", ["audio/ogg; codecs=vorbis"]), sourceSha256: text(original.sha256, "source hash"),
        sourcePath: text(original.sourcePath, "source path") },
      derivative: { ...audioFile(derivative, "derived", "m4a", ["audio/mp4"]), label: text(derivative.label, "derivative label") } });
  }
  const volumes = list(manifest.volumes, 64, "music volume").map(raw => {
    const row = object(raw, "music volume");
    const planes = list(row.worldPlanes, 64, "plane").map(plane => {
      const values = list(plane, 4, "plane").map(item => finite(item, "plane"));
      requireMatch(values.length === 4, "invalid plane"); return values as [number, number, number, number];
    });
    const order = list(row.tracks, 64, "volume tracks").map(item => text(item, "volume track"));
    requireMatch(planes.length >= 4 && order.length > 0 && order.every(key => tracks.has(key)), "invalid volume geometry/tracks");
    const bounds = object(row.worldBounds, "volume bounds");
    const force = row.forcePlayMusic;
    requireMatch(force === null || typeof force === "boolean", "invalid bForcePlayMusic");
    const musicId = finite(row.musicId, "music id");
    return { id: text(row.id, "volume id"), object: text(row.object, "volume object"), exportIndex: finite(row.exportIndex, "export index"),
      musicId, forcePlayMusic: force, group: optionalText(row.group, "volume group"), planes,
      boundsNative: { min: vector(bounds.min, "bounds"), max: vector(bounds.max, "bounds") }, tracks: order } satisfies NativeMusicVolume;
  });
  return { manifestSha256, volumes, tracks,
    fetchTrack(key, variant, signal) {
      const track = tracks.get(key);
      requireMatch(track, `unknown music track ${key}`);
      const file = variant === "original" ? track.original : track.derivative;
      return resource(prefix + file.file, file.sha256, file.bytes, signal);
    } };
}

export async function loadNativeWorldAudio(records: unknown, signal: AbortSignal): Promise<NativeWorldAudio> {
  const result: NativeWorldAudio = { music: null, ambience: null, manifests: [] };
  const ids = new Set<string>();
  for (const value of list(records ?? [], 8, "world-audio catalog")) {
    const entry = object(value, "catalog entry"), id = text(entry.id, "bundle id"), manifestSha256 = text(entry.manifestSha256, "manifest hash");
    const prefix = `/l2/world-audio/${manifestSha256}/`;
    requireMatch(hash.test(manifestSha256) && entry.manifest === `${prefix}manifest.json` && !ids.has(id), "invalid catalog entry");
    ids.add(id);
    const bytes = await resource(`${prefix}manifest.json`, manifestSha256, Number(entry.manifestBytes), signal);
    const manifest = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), "manifest");
    requireMatch(manifest.schemaVersion === 1 && manifest.kind === entry.kind, "manifest kind differs from its catalog entry");
    if (manifest.kind === "native-map-ambience") {
      requireMatch(!result.ambience, "duplicate ambience bundle");
      result.ambience = parseAmbience(manifest, manifestSha256, prefix);
    } else if (manifest.kind === "native-map-music") {
      requireMatch(!result.music, "duplicate music bundle");
      result.music = parseMusic(manifest, manifestSha256, prefix);
    } else throw new Error("World audio: unsupported bundle kind");
    result.manifests.push(manifestSha256);
  }
  signal.throwIfAborted();
  return result;
}
