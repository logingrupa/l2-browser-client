import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { servedLaneCatalogSha256 } from "./support/loadCheckRecordFile";

interface ServedRecord { readonly id: string; readonly manifest: string; readonly manifestSha256: string }
interface ServedTileResource { readonly kind: string; readonly manifest: string; readonly manifestSha256: string }
interface TileAudioManifests { readonly music: string | null; readonly ambience: string | null }
interface AudibleSourceEntry {
  readonly key: string;
  readonly sourceIdentity: { readonly manifestSha256: string; readonly object: string; readonly track?: string; readonly sound?: string };
  readonly played: boolean;
  readonly peak: number;
}
type NativeWorldAudioSnapshot = NonNullable<NonNullable<ReturnType<NonNullable<Window["__nativeSlice"]>["snapshot"]>["nativeAudio"]>>;

const servedStoreRoot = "world";
const reportLaneName = "actors";
const tileId = "20_20";
const tileKey = `tile:${tileId}`;
const reportDirectory = resolve("artifacts/lane-store", reportLaneName, "reports");
const reportListeningStatus = "audible labelled, owner listening pending";
const tileLoadTimeout = 300_000;
const playbackTimeout = 20_000;

test.skip(process.env.NATIVE_STORE_ROOT !== servedStoreRoot, "run with NATIVE_STORE_ROOT=world");

async function fetchServedJson<Value>(baseUrl: string, path: string): Promise<Value> {
  const answer = await fetch(new URL(path, baseUrl), { cache: "no-store" });
  if (!answer.ok) throw new Error(`served ${path} answered ${answer.status}`);
  return await answer.json() as Value;
}

async function readTileAudioManifests(baseUrl: string): Promise<TileAudioManifests | null> {
  const catalog = await fetchServedJson<{ tiles?: ServedRecord[] }>(baseUrl, "/l2/catalog.json");
  const tileRecord = catalog.tiles?.find(record => record.id === tileId);
  if (!tileRecord) return null;
  const tile = await fetchServedJson<{ resources: ServedTileResource[] }>(baseUrl, tileRecord.manifest);
  const kinds = await Promise.all(tile.resources.filter(resource => resource.kind === "world-audio")
    .map(async resource => ({ kind: (await fetchServedJson<{ kind: string }>(baseUrl, resource.manifest)).kind, manifestSha256: resource.manifestSha256 })));
  const manifestOfKind = (kind: string) => kinds.find(entry => entry.kind === kind)?.manifestSha256 ?? null;
  return { music: manifestOfKind("native-map-music"), ambience: manifestOfKind("native-map-ambience") };
}

const worldAudioSnapshot = (page: Page) => page.evaluate(() => window.__nativeSlice!.snapshot().nativeAudio ?? null);

async function openTile(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/?map=${tileId}`);
  const startup = () => page.evaluate(() => {
    const loading = document.querySelector<HTMLElement>("#loading");
    if (!loading) return window.__nativeSlice ? "ready" : "loading";
    return loading.dataset.state === "error" ? `error: ${(loading.textContent ?? "").replace(/\s+/g, " ").trim()}` : "loading";
  });
  await expect.poll(startup, { timeout: tileLoadTimeout, intervals: [1_000] }).toMatch(/^(ready|error)/);
  const state = await startup();
  if (state !== "ready") throw new Error(`${tileKey} did not start on the native route: ${state}`);
  await expect.poll(async () => {
    const audio = await worldAudioSnapshot(page);
    return audio?.worldAudio?.failure ?? (audio?.worldAudio?.music ? "music" : audio?.worldAudio?.loading === false ? "no music" : "loading");
  }, { timeout: tileLoadTimeout, intervals: [1_000] }).toBe("music");
  return pageErrors;
}

async function stopInsideFirstMusicVolume(page: Page, audio: NativeWorldAudioSnapshot): Promise<string> {
  const volume = audio.worldAudio!.music!.volumes[0];
  if (!volume) throw new Error(`${tileKey} music lists no MusicVolume`);
  const [x, y, z] = [0, 1, 2].map(axis => (volume.boundsNative.min[axis]! + volume.boundsNative.max[axis]!) / 2);
  await page.evaluate(position => {
    window.__nativeSlice!.dispatch({ type: "cannot-move", position, heading: 0 });
    window.__nativeSlice!.dispatch({ type: "set-animation", animation: "idle" });
  }, { x: x!, y: y!, z: z! });
  return volume.object;
}

async function pollMusicPlayback(page: Page) {
  await expect.poll(async () => {
    const audio = await worldAudioSnapshot(page);
    const track = audio?.worldAudio?.music?.track;
    return track?.variant === "original" && (audio?.buses.music.peak ?? 0) > 0 ? "playing" : JSON.stringify({ state: audio?.state,
      music: audio?.worldAudio?.music?.state, volume: audio?.worldAudio?.music?.volume?.id ?? null, peak: audio?.buses.music.peak ?? null,
      listener: audio?.listener?.position ?? null });
  }, { timeout: playbackTimeout, intervals: [250] }).toBe("playing");
  const audio = (await worldAudioSnapshot(page))!;
  return { track: audio.worldAudio!.music!.track!, peak: audio.buses.music.peak! };
}

async function pollAmbiencePlayback(page: Page) {
  await expect.poll(async () => {
    const audio = await worldAudioSnapshot(page);
    return (audio?.worldAudio?.ambience?.loops.length ?? 0) > 0 && (audio?.buses.ambience.peak ?? 0) > 0;
  }, { timeout: playbackTimeout, intervals: [250] }).toBe(true);
  const audio = (await worldAudioSnapshot(page))!;
  return { loop: audio.worldAudio!.ambience!.loops[0]!, peak: audio.buses.ambience.peak! };
}

async function playTileAudio(page: Page, baseUrl: string, makeTrustedGesture: () => Promise<void>): Promise<AudibleSourceEntry[]> {
  const manifests = await readTileAudioManifests(baseUrl);
  test.skip(manifests?.music == null, `the served catalog has no ${tileKey} with a music world-audio resource; run convert_tile.py --map ${tileId} --step audio, then --step manifest`);
  const pageErrors = await openTile(page);
  await makeTrustedGesture();
  const volumeObject = await stopInsideFirstMusicVolume(page, (await worldAudioSnapshot(page))!);
  const music = await pollMusicPlayback(page);
  const entries: AudibleSourceEntry[] = [{ key: tileKey, sourceIdentity: { manifestSha256: manifests!.music!, object: volumeObject, track: music.track.key },
    played: true, peak: music.peak }];
  const ambienceInRange = ((await worldAudioSnapshot(page))?.worldAudio?.ambience?.candidates ?? 0) > 0;
  if (manifests!.ambience !== null && ambienceInRange) {
    const ambience = await pollAmbiencePlayback(page);
    entries.push({ key: tileKey, sourceIdentity: { manifestSha256: manifests!.ambience, object: ambience.loop.id, sound: ambience.loop.sound },
      played: true, peak: ambience.peak });
  }
  expect(pageErrors).toEqual([]);
  return entries;
}

test.describe("phone", () => {
  test.use(landscapePhone);
  test("plays the original music of tile 20_20 after a tap at 932 x 430 landscape and writes the labelled report", async ({ page, baseURL, hasTouch, isMobile }) => {
    if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
    test.setTimeout(2 * tileLoadTimeout + 4 * playbackTimeout);
    expect({ hasTouch, isMobile }).toEqual({ hasTouch: true, isMobile: true });
    const catalogSha256 = await servedLaneCatalogSha256(baseURL);
    const entries = await playTileAudio(page, baseURL, async () => {
      const canvas = (await page.locator("#canvas").boundingBox())!;
      await page.touchscreen.tap(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    });
    mkdirSync(reportDirectory, { recursive: true });
    writeFileSync(resolve(reportDirectory, `world-tile-audio-${catalogSha256}.json`), `${JSON.stringify({ schemaVersion: 1, lane: reportLaneName,
      catalogSha256, atRiga: formatRigaTimestamp(new Date()), listening: reportListeningStatus, entries }, null, 2)}\n`);
    await expectNoHorizontalScrollOnPortraitPhone(page);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("plays the original music of tile 20_20 after a click at 1440 x 900", async ({ page, baseURL }) => {
    if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
    test.setTimeout(2 * tileLoadTimeout + 4 * playbackTimeout);
    const entries = await playTileAudio(page, baseURL, async () => {
      const canvas = (await page.locator("#canvas").boundingBox())!;
      await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    });
    expect(entries.every(entry => entry.played && entry.peak > 0)).toBe(true);
  });
});
