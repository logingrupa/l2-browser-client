import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeWorldAudio, nativeAmbientEmitterFields, noTileAudioResourcesReason, readNativeWorldAudioRecords } from "../../src/assets/native/loadNativeWorldAudio";
import { readSelectedTileWorldAudioRecords } from "../../src/assets/native/readSelectedTileWorldAudio";
import { decodeJsonDocument, fixtureTileId, jsonBytes, readFixtureTileFiles, sha256Hex } from "../support/nativeTileFixtureStore";

const signal = () => new AbortController().signal;
const tileMapPath = `maps/${fixtureTileId}.unr`;
const wave = new Uint8Array([82, 73, 70, 70, 4, 5, 6]), waveSha256 = sha256Hex(wave);
const waveRow = (key: string) => ({ key, object: key, file: `audio/${waveSha256}.wav`, bytes: wave.length, sha256: waveSha256, mime: "audio/wav", durationSeconds: .5 });
const ogg = new Uint8Array([79, 103, 103, 83, 1]), oggSha256 = sha256Hex(ogg);
const aac = new Uint8Array([0, 0, 0, 1, 102, 116, 121, 112]), aacSha256 = sha256Hex(aac);

const ambienceManifest = (tileId = fixtureTileId) => ({ schemaVersion: 1, kind: "native-map-ambience", tileId, source: { map: { path: tileMapPath } },
  emitterFields: nativeAmbientEmitterFields, sounds: [waveRow("ambsound.wind.wind_03")],
  emitters: [["00_00.AmbientSoundObject1", 7, 100, 200, 300, 90, 250, 64, 1, 100, 0, "ambsound.wind.wind_03", null, null, null]],
  radius: { maxRadiusMultiplier: { value: 50, symbol: "?GAudioMaxRadiusMultiplier@@3MA", status: "static", image: { sha256: "a".repeat(64) } } } });

const musicManifest = () => ({ schemaVersion: 1, kind: "native-map-music", tileId: fixtureTileId, map: { relativePath: tileMapPath },
  tracks: [{ key: "music:D03_F", storedString: "D03_F", durationSeconds: 185, file: `audio/${oggSha256}.ogg`, bytes: ogg.length, sha256: oggSha256,
    mime: "audio/ogg; codecs=vorbis", original: { sha256: "b".repeat(64), sourcePath: "music/d03_f.ogg" },
    derivative: { file: `derived/${aacSha256}.m4a`, bytes: aac.length, sha256: aacSha256, mime: "audio/mp4", label: "derived AAC" } }],
  volumes: [{ id: "interlude:00_00.MusicVolume0", object: "00_00.MusicVolume0", exportIndex: 3, musicId: 202001, forcePlayMusic: null, group: null,
    worldPlanes: [[-1, 0, 0, 0], [1, 0, 0, 10], [0, -1, 0, 0], [0, 1, 0, 10], [0, 0, -1, 0], [0, 0, 1, 10]],
    worldBounds: { min: [0, 0, 0], max: [10, 10, 10] }, tracks: ["music:D03_F"] }] });

const placementManifest = (placementSounds: (string | null)[] = ["stepsound.wood.wood_walk_01", null, null]) => ({ schemaVersion: 1,
  kind: "native-tile-placement-audio", tileId: fixtureTileId, source: { map: { path: tileMapPath } },
  properties: ["StepSound_1", "StepSound_2", "StepSound_3"], sounds: [waveRow("stepsound.wood.wood_walk_01")],
  placements: [{ placementId: "interlude:00_00.StaticMeshActor930", sounds: placementSounds }],
  limits: ["StepSound references are bound per placement as authored; automatic surface footstep playback is not established."], gaps: [] });

function tileAudioStore(manifests: readonly Record<string, unknown>[]) {
  const responses = new Map<string, Uint8Array>();
  const tile = decodeJsonDocument(readFixtureTileFiles().tile.bytes);
  tile.resources = manifests.map(manifest => {
    const bytes = jsonBytes(manifest), manifestSha256 = sha256Hex(bytes), folder = `/l2/world-audio/${manifestSha256}`;
    responses.set(`${folder}/manifest.json`, bytes).set(`${folder}/audio/${waveSha256}.wav`, wave).set(`${folder}/audio/${oggSha256}.ogg`, ogg)
      .set(`${folder}/derived/${aacSha256}.m4a`, aac);
    return { kind: "world-audio", manifest: `${folder}/manifest.json`, manifestSha256, manifestBytes: bytes.byteLength };
  });
  const tileBytes = jsonBytes(tile), tileSha256 = sha256Hex(tileBytes), tilePath = `/l2/tiles/${tileSha256}/tile.json`;
  responses.set(tilePath, tileBytes).set("/l2/catalog.json", jsonBytes({ schemaVersion: 1, models: [], worldAudio: [{ id: "catalog-ambience" }],
    tiles: [{ id: fixtureTileId, manifest: tilePath, manifestSha256: tileSha256, manifestBytes: tileBytes.byteLength }] }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const value = responses.get(url);
    return new Response(value?.slice().buffer ?? "missing", { status: value ? 200 : 404 });
  }));
  vi.stubGlobal("location", { search: `?map=${fixtureTileId}`, protocol: "http:" });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("selected tile world-audio records", () => {
  it("returns null without a selected tile so the catalog slice stays the source", async () => {
    tileAudioStore([ambienceManifest()]);
    expect(await readSelectedTileWorldAudioRecords({ search: "" }, signal())).toBeNull();
    vi.stubGlobal("location", { search: "", protocol: "http:" });
    expect(await readNativeWorldAudioRecords(signal())).toEqual({ tileId: null, records: [{ id: "catalog-ambience" }] });
  });

  it("lists the tile manifest's world-audio resources as loader records", async () => {
    tileAudioStore([ambienceManifest(), musicManifest()]);
    const selected = await readNativeWorldAudioRecords(signal());
    expect(selected.tileId).toBe(fixtureTileId);
    expect(selected.records).toHaveLength(2);
    expect(selected.records[0]).toMatchObject({ kind: "world-audio", manifest: expect.stringMatching(/^\/l2\/world-audio\/[a-f0-9]{64}\/manifest\.json$/) });
  });
});

describe("tile world-audio loading", () => {
  it("dispatches each world-audio record by its fetched manifest kind", async () => {
    tileAudioStore([ambienceManifest(), musicManifest(), placementManifest()]);
    const loaded = await loadNativeWorldAudio(await readNativeWorldAudioRecords(signal()), signal());
    expect(loaded.silentReason).toBeNull();
    expect(loaded.manifests).toHaveLength(3);
    expect(loaded.ambience).toMatchObject({ sourceMap: tileMapPath, emitters: [{ id: "00_00.AmbientSoundObject1" }] });
    expect(loaded.music).toMatchObject({ sourceMap: tileMapPath, volumes: [{ object: "00_00.MusicVolume0", tracks: ["music:D03_F"] }] });
    expect([...await loaded.music!.fetchTrack("music:D03_F", "original", signal())]).toEqual([...ogg]);
  });

  it("parses placement audio into placements with bound sound keys and pinned WAV files", async () => {
    tileAudioStore([placementManifest()]);
    const loaded = await loadNativeWorldAudio(await readNativeWorldAudioRecords(signal()), signal());
    const placementAudio = loaded.placementAudio!;
    expect(placementAudio).toMatchObject({ sourceMap: tileMapPath, properties: ["StepSound_1", "StepSound_2", "StepSound_3"],
      placements: [{ placementId: "interlude:00_00.StaticMeshActor930", sounds: ["stepsound.wood.wood_walk_01", null, null] }] });
    expect(placementAudio.sounds.get("stepsound.wood.wood_walk_01")).toMatchObject({ file: `audio/${waveSha256}.wav`, sha256: waveSha256 });
    expect([...await placementAudio.fetchSound("stepsound.wood.wood_walk_01", signal())]).toEqual([...wave]);
    expect([loaded.music, loaded.ambience]).toEqual([null, null]);
  });

  it("loads a selected tile without world-audio resources as silent with its reason", async () => {
    tileAudioStore([]);
    expect(await loadNativeWorldAudio(await readNativeWorldAudioRecords(signal()), signal()))
      .toEqual({ music: null, ambience: null, placementAudio: null, manifests: [], silentReason: noTileAudioResourcesReason });
  });

  it("refuses an unknown manifest kind, an unbound placement sound and a manifest of another tile", async () => {
    tileAudioStore([{ ...placementManifest(), kind: "native-tile-unknown-audio" }]);
    await expect(loadNativeWorldAudio(await readNativeWorldAudioRecords(signal()), signal())).rejects.toThrow("unsupported bundle kind");
    tileAudioStore([placementManifest(["stepsound.wood.missing", null, null])]);
    await expect(loadNativeWorldAudio(await readNativeWorldAudioRecords(signal()), signal())).rejects.toThrow("unknown placement sound");
    tileAudioStore([placementManifest(["stepsound.wood.wood_walk_01"])]);
    await expect(loadNativeWorldAudio(await readNativeWorldAudioRecords(signal()), signal())).rejects.toThrow("unknown placement sound");
    tileAudioStore([ambienceManifest("20_21")]);
    await expect(loadNativeWorldAudio(await readNativeWorldAudioRecords(signal()), signal())).rejects.toThrow("manifest tile differs");
  });
});
