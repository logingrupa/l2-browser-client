import { sha256, type AssetPackage } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";
import type { NativeFootstepDefinition } from "../../audio/nativeFootstepPreview";

const hash = /^[a-f0-9]{64}$/;
const properties = new Set(["Default", "DefaultActor", "Grass", "Water"].flatMap(surface =>
  ["Walk", "Run"].map(gait => `${surface}${gait}Sound`)));
function requireMatch(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function object(value: unknown): Record<string, unknown> {
  requireMatch(value && typeof value === "object" && !Array.isArray(value), "Invalid animation-audio record");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  requireMatch(typeof value === "string" && value.length > 0 && value.length <= 512, "Invalid animation-audio identity"); return value;
}
function list(value: unknown, limit: number): unknown[] {
  requireMatch(Array.isArray(value) && value.length <= limit, "Invalid animation-audio list"); return value;
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, i) => equal(value, b[i]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key =>
    Object.hasOwn(right, key) && equal(left[key], right[key]));
}
async function resource(path: string, expectedHash: string, size: number, signal: AbortSignal): Promise<Uint8Array> {
  requireMatch(hash.test(expectedHash) && Number.isSafeInteger(size) && size > 0 && size <= 8_000_000, "Invalid animation-audio resource pin");
  const response = await fetch(nativeResourceUrl(path), { signal });
  requireMatch(response.ok, `Animation audio request returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  requireMatch(bytes.length === size && await sha256(bytes) === expectedHash, "Animation-audio resource hash/length mismatch");
  signal.throwIfAborted(); return bytes;
}

export interface NativeAnimationAudioBundle {
  definitions: NativeFootstepDefinition[];
  sounds: { key: string; bytes: Uint8Array }[];
  manifests: string[];
  retainedConditionalEvents: number;
}

/** Supplement existing actors with verified dependencies. No model replacement,
 * leaf-name lookup, surface inference, random selection or audio unlock. The
 * complete raw event must still match the selected actor package at its ordinal. */
export async function loadNativeAnimationAudio(records: unknown, assets: ReadonlyMap<string, AssetPackage>,
  archiveHashes: ReadonlyMap<string, string>, signal: AbortSignal): Promise<NativeAnimationAudioBundle> {
  const result: NativeAnimationAudioBundle = { definitions: [], sounds: [], manifests: [], retainedConditionalEvents: 0 };
  const bundles = new Set<string>(), admitted = new Set<string>(), registered = new Map<string, Uint8Array>();
  for (const value of list(records ?? [], 16)) {
    // The package-keyed stepsound bundle and the deco-grass footstep grid share
    // this catalog list; each has its own loader (loadNativeStepSounds,
    // loadNativeStepDecoGrass) and is never an actor sidecar.
    const kind = object(value).kind;
    if (kind === "native-stepsound-package" || kind === "native-stepsound-deco-grass") continue;
    const entry = object(value), id = text(entry.id), manifestHash = text(entry.manifestSha256);
    const prefix = `/l2/animation-audio/${manifestHash}/`;
    requireMatch(hash.test(manifestHash) && entry.manifest === `${prefix}manifest.json` && !bundles.has(id), "Invalid animation-audio catalog entry");
    bundles.add(id);
    const bytes = await resource(`${prefix}manifest.json`, manifestHash, Number(entry.manifestBytes), signal);
    const manifest = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    requireMatch(manifest.schemaVersion === 1 && manifest.kind === "native-animation-audio-dependencies", "Unsupported animation-audio bundle");
    const sounds = new Map<string, { file: string; bytes: number; sha256: string; sourceObject: string; key: string }>();
    for (const raw of list(manifest.sounds, 4096)) {
      const sound = object(raw), dependencyId = text(sound.dependencyId), sha = text(sound.sha256), source = object(sound.source);
      const sourceObject = text(source.object), packageHash = text(source.packageSha256);
      requireMatch(!sounds.has(dependencyId) && hash.test(sha) && hash.test(packageHash) && sound.file === `audio/${sha}.wav` &&
        sound.mime === "audio/wav" && Number.isSafeInteger(sound.bytes) && Number(sound.bytes) > 0 && Number(sound.bytes) <= 8_000_000 &&
        Number.isSafeInteger(source.exportIndex) && Number(source.exportIndex) > 0 &&
        dependencyId.endsWith(`:${packageHash}:${source.exportIndex}`) && /^[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)+$/.test(sourceObject),
      "Invalid or duplicated animation sound dependency");
      sounds.set(dependencyId, { file: sound.file as string, bytes: Number(sound.bytes), sha256: sha, sourceObject, key: `native-footstep:${sha}` });
    }
    const needed = new Set<string>();
    for (const raw of list(manifest.actors, 128)) {
      const actor = object(raw), catalogId = text(actor.catalogId), asset = assets.get(catalogId);
      if (!asset) continue; // The other player variant is not loaded into this world.
      requireMatch(!admitted.has(catalogId), "Animation-audio actor is duplicated"); admitted.add(catalogId);
      requireMatch(typeof actor.archiveSha256 === "string" && hash.test(actor.archiveSha256) &&
        actor.assetId === asset.manifest.id && actor.archiveSha256 === archiveHashes.get(catalogId) &&
        equal(actor.source, asset.manifest.source), "Animation-audio actor source/archive mismatch");
      const clips = new Map<string, NativeFootstepDefinition>();
      const timing = new Map<string, { frames: number; rate: number }>();
      for (const rawClip of list(actor.clips, 512)) {
        const clip = object(rawClip), name = text(clip.name), duration = Number(clip.durationSeconds);
        requireMatch(!clips.has(name) && (clip.gait === "walk" || clip.gait === "run") &&
          Number.isSafeInteger(clip.frames) && Number(clip.frames) > 0 && typeof clip.rate === "number" &&
          Number.isFinite(clip.rate) && clip.rate > 0 && Number.isFinite(duration) && duration > 0 && duration === Number(clip.frames) / clip.rate,
        "Invalid animation-audio clip timing");
        clips.set(name, { asset, clip: name, durationSeconds: duration, gait: clip.gait, events: [] });
        timing.set(name, { frames: Number(clip.frames), rate: clip.rate });
      }
      let previousOrdinal = -1;
      for (const rawEvent of list(actor.events, 65536)) {
        const row = object(rawEvent), ordinal = Number(row.ordinal), event = object(row.event), name = text(event.clip);
        const definition = clips.get(name), clipTiming = timing.get(name);
        requireMatch(Number.isSafeInteger(row.ordinal) && ordinal > previousOrdinal && definition && clipTiming &&
          row.manifestPointer === `/animationEvents/${ordinal}` && equal(event, asset.manifest.animationEvents?.[ordinal]),
        "Animation-audio event ordinal/content mismatch"); previousOrdinal = ordinal;
        requireMatch(event.sourceFrames === clipTiming.frames && event.sourceRate === clipTiming.rate &&
          typeof event.normalizedTime === "number" && Number.isFinite(event.normalizedTime) &&
          typeof event.timeSeconds === "number" && Number.isFinite(event.timeSeconds) && event.timeSeconds >= 0 &&
          event.timeSeconds <= definition.durationSeconds && event.timeSeconds === event.normalizedTime * definition.durationSeconds,
        "Animation-audio source event timing mismatch");
        if (event.sound != null) { result.retainedConditionalEvents++; continue; }
        requireMatch(event.type === "AnimNotify_Sound" && event.function === "None", "Unsupported footstep notification");
        const arrays: Record<string, { reference: string; key: string }[]> = {}, rawProperties = object(event.properties);
        requireMatch(rawProperties.Random === undefined, "Conditional notification needs an explicit dispatch implementation");
        for (const rawArray of list(row.arrays, 8)) {
          const array = object(rawArray), property = text(array.property), slots = list(array.slots, 64);
          requireMatch(properties.has(property) && !Object.hasOwn(arrays, property) &&
            Array.isArray(rawProperties[property]) && slots.length === rawProperties[property].length, "Footstep array differs from the actor");
          arrays[property] = slots.map((rawSlot, index) => {
            const slot = object(rawSlot), dependencyId = text(slot.dependencyId), reference = text(slot.reference), sound = sounds.get(dependencyId);
            requireMatch(slot.index === index && reference === (rawProperties[property] as unknown[])[index] && sound &&
              reference.toLowerCase() === sound.sourceObject.toLowerCase(), "Footstep slot reference differs from its qualified dependency");
            needed.add(dependencyId); return { reference, key: sound.key };
          });
        }
        requireMatch(Object.keys(arrays).length === [...properties].filter(property => Array.isArray(rawProperties[property])).length &&
          Object.keys(arrays).length > 0, "Footstep surface arrays are missing");
        (definition.events as { ordinal: number; notify: string; timeSeconds: number; arrays: typeof arrays }[]).push({ ordinal,
          notify: text(event.object), timeSeconds: event.timeSeconds, arrays });
      }
      // A partial sidecar cannot silently drop an event from a selected clip.
      const originalOrdinals = (asset.manifest.animationEvents ?? []).flatMap((event, index) =>
        event && typeof event === "object" && clips.has(String((event as Record<string, unknown>).clip)) ? [index] : []);
      requireMatch(equal(originalOrdinals, list(actor.events, 65536).map(event => object(event).ordinal)), "Animation-audio selected clip coverage differs");
      result.definitions.push(...clips.values());
    }
    const payloads = await Promise.all([...needed].map(async id => {
      const sound = sounds.get(id)!;
      return { key: sound.key, bytes: await resource(prefix + sound.file, sound.sha256, sound.bytes, signal) };
    }));
    for (const sound of payloads) if (!registered.has(sound.key)) { registered.set(sound.key, sound.bytes); result.sounds.push(sound); }
    result.manifests.push(manifestHash);
  }
  signal.throwIfAborted(); return result;
}
