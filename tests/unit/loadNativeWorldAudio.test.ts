import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeWorldAudio, nativeAmbientEmitterFields } from "../../src/assets/native/loadNativeWorldAudio";
import { ambientRangeUnits } from "../../src/audio/worldAmbience";
import { selectMusicVolume } from "../../src/audio/worldMusic";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function serve(files: Map<string, Uint8Array>) {
  const fetcher = vi.fn(async (url: string) => {
    const bytes = files.get(url);
    return bytes ? new Response(bytes.slice()) : new Response("missing", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function ambienceFixture(wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3])) {
  const wavSha = sha(wav);
  const row = ["20_20.AmbientSoundObject1", 4052, 20528, 70576, -3424, 90, 250, 60, 1, 40, 17017694, "ambsound.insect_day.id_cicada_04",
    "20_20.LevelInfo0", 0, "None,S_Insect_Day"];
  const manifest = encode({ schemaVersion: 1, kind: "native-map-ambience", emitterFields: nativeAmbientEmitterFields, emitters: [row],
    sounds: [{ key: "ambsound.insect_day.id_cicada_04", object: "ambsound.Insect_Day.id_cicada_04", file: `audio/${wavSha}.wav`,
      bytes: wav.length, sha256: wavSha, mime: "audio/wav", durationSeconds: 1.5 }],
    radius: { maxRadiusMultiplier: { value: 50, symbol: "?GAudioMaxRadiusMultiplier@@3MA", status: "static", image: { sha256: "a".repeat(64) } } } });
  const manifestSha = sha(manifest), prefix = `/l2/world-audio/${manifestSha}/`;
  const files = new Map([[`${prefix}manifest.json`, manifest], [`${prefix}audio/${wavSha}.wav`, wav]]);
  const entry = { id: "map-20-20-ambience", kind: "native-map-ambience", manifest: `${prefix}manifest.json`, manifestBytes: manifest.length, manifestSha256: manifestSha };
  return { files, entry, wavPath: `${prefix}audio/${wavSha}.wav` };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("staged world-audio loader", () => {
  it("verifies manifests, converts emitters like section placements and fetches sounds lazily", async () => {
    const { files, entry, wavPath } = ambienceFixture();
    const fetcher = serve(files);
    const loaded = await loadNativeWorldAudio([entry], new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const emitter = loaded.ambience!.emitters[0]!;
    expect(emitter.native).toEqual([20528, 70576, -3424]);
    expect(emitter.position[0]).toBeCloseTo(205.28); expect(emitter.position[1]).toBeCloseTo(-34.24); expect(emitter.position[2]).toBeCloseTo(705.76);
    expect(emitter).toMatchObject({ soundRadius: 90, soundVolume: 250, soundPitch: 60, ambientSoundType: 1, ambientRandom: 40, group: "None,S_Insect_Day", defaults: [] });
    expect(loaded.ambience!.radiusMultiplier.value).toBe(50);
    expect([...await loaded.ambience!.fetchSound("ambsound.insect_day.id_cicada_04", new AbortController().signal)]).toEqual([82, 73, 70, 70, 1, 2, 3]);
    files.set(wavPath, new Uint8Array([9, 9, 9, 9, 9, 9, 9]));
    await expect(loaded.ambience!.fetchSound("ambsound.insect_day.id_cicada_04", new AbortController().signal)).rejects.toThrow("hash/length mismatch");
  });

  it("applies AmbientSoundObject class defaults to omitted radius/volume and lists every omitted field", async () => {
    const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3]), wavSha = sha(wav);
    const row = ["20_20.AmbientSoundObject2", 4053, 1, 2, 3, null, null, null, null, null, null, "ambsound.wind.wind_03", null, null, null];
    const manifest = encode({ schemaVersion: 1, kind: "native-map-ambience", emitterFields: nativeAmbientEmitterFields, emitters: [row],
      sounds: [{ key: "ambsound.wind.wind_03", object: "ambsound.Wind.wind_03", file: `audio/${wavSha}.wav`, bytes: wav.length, sha256: wavSha, mime: "audio/wav", durationSeconds: 4 }],
      radius: { maxRadiusMultiplier: { value: 50, symbol: "?GAudioMaxRadiusMultiplier@@3MA", status: "static", image: { sha256: "a".repeat(64) } } } });
    const manifestSha = sha(manifest), prefix = `/l2/world-audio/${manifestSha}/`;
    serve(new Map([[`${prefix}manifest.json`, manifest]]));
    const loaded = await loadNativeWorldAudio([{ id: "map-20-20-ambience", kind: "native-map-ambience", manifest: `${prefix}manifest.json`,
      manifestBytes: manifest.length, manifestSha256: manifestSha }], new AbortController().signal);
    expect(loaded.ambience!.emitters[0]).toMatchObject({ soundRadius: 64, soundVolume: 190, soundPitch: null, ambientRandom: null,
      defaults: ["soundRadius", "soundVolume", "soundPitch", "ambientSoundType", "ambientRandom", "ambientSoundStartTime"] });
  });

  it("rejects hash, kind and duplicate-identity mismatches", async () => {
    const { files, entry } = ambienceFixture();
    serve(files);
    const signal = new AbortController().signal;
    await expect(loadNativeWorldAudio([{ ...entry, manifestSha256: "f".repeat(64) }], signal)).rejects.toThrow("invalid catalog entry");
    await expect(loadNativeWorldAudio([{ ...entry, kind: "native-map-music" }], signal)).rejects.toThrow("kind differs");
    await expect(loadNativeWorldAudio([entry, entry], signal)).rejects.toThrow("invalid catalog entry");
    await expect(loadNativeWorldAudio([{ ...entry, manifestBytes: 3 }], signal)).rejects.toThrow("hash/length");
    expect(await loadNativeWorldAudio(undefined, signal)).toEqual({ music: null, ambience: null, manifests: [] });
  });
});

const root = resolve(__dirname, "../..");
const catalogPath = resolve(root, "public/l2/catalog.json");
const staged = existsSync(catalogPath) && Array.isArray(JSON.parse(readFileSync(catalogPath, "utf8")).worldAudio);

describe.runIf(staged)("staged 20_20 world audio", () => {
  it("lands emitters around the loaded section and the spawn inside MusicVolume1", async () => {
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(readFileSync(resolve(root, "public", url.slice(1))))));
    const loaded = await loadNativeWorldAudio(catalog.worldAudio, new AbortController().signal);
    expect(loaded.ambience!.emitters).toHaveLength(2622);
    expect(loaded.ambience!.sounds.size).toBe(106);
    expect(loaded.ambience!.radiusMultiplier.value).toBe(50);
    expect(loaded.music!.volumes.map(volume => [volume.object, volume.musicId, volume.tracks.length])).toEqual([
      ["20_20.MusicVolume0", 202001, 3], ["20_20.MusicVolume1", 202002, 6]]);
    const section = JSON.parse(readFileSync(resolve(root, "public", catalog.sections[0].manifest.slice(1)), "utf8"));
    const spawn = section.surfaceSpawnCandidate.gltfGroundPosition as [number, number, number];
    expect(selectMusicVolume(loaded.music!.volumes, section.surfaceSpawnCandidate.sourcePosition))
      .toMatchObject({ volume: { object: "20_20.MusicVolume1", forcePlayMusic: true } });
    const placements = section.placements as { matrix: number[] }[];
    const lo = [0, 2].map(axis => Math.min(...placements.map(p => p.matrix[12 + axis]!)));
    const hi = [0, 2].map(axis => Math.max(...placements.map(p => p.matrix[12 + axis]!)));
    const inSection = loaded.ambience!.emitters.filter(e => e.position[0] >= lo[0]! && e.position[0] <= hi[0]! && e.position[2] >= lo[1]! && e.position[2] <= hi[1]!);
    expect(inSection.length).toBeGreaterThan(20);
    // Same conversion as placements: emitters sit on this section's terrain heights
    // (about -37 m to -13 m); one authored wind emitter is 3.6 km up (never audible).
    const outliers = inSection.filter(e => e.position[1] > 1000);
    expect(outliers.map(e => e.group)).toEqual(["None,s_mountain_wind_loop"]);
    expect(inSection.filter(e => e.position[1] <= 1000).every(e => e.position[1] > -40 && e.position[1] < -10)).toBe(true);
    expect(inSection.find(e => e.group === "None,s_flag")!.position[1]).toBeCloseTo(spawn[1], 1);
    const source = section.surfaceSpawnCandidate.sourcePosition as [number, number, number];
    const audible = loaded.ambience!.emitters.filter(e => e.sound &&
      Math.hypot(e.native[0] - source[0], e.native[1] - source[1], e.native[2] - source[2]) <= ambientRangeUnits(e, 50));
    expect(audible.length).toBeGreaterThan(50);
    const sound = loaded.ambience!.sounds.values().next().value!;
    expect((await loaded.ambience!.fetchSound(sound.key, new AbortController().signal)).length).toBe(sound.bytes);
    const track = loaded.music!.tracks.get("music:F09_F")!;
    const ogg = await loaded.music!.fetchTrack(track.key, "original", new AbortController().signal);
    expect(new TextDecoder().decode(ogg.slice(0, 4))).toBe("OggS");
    const aac = await loaded.music!.fetchTrack(track.key, "derivative", new AbortController().signal);
    expect(new TextDecoder().decode(aac.slice(4, 8))).toBe("ftyp");
  });
});
