import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeAnimationAudio } from "../../src/assets/native/loadNativeAnimationAudio";
import { loadNativeNpcProfiles } from "../../src/assets/native/loadNativeNpcProfiles";
import { loadNativePlayerProfiles } from "../../src/assets/native/loadNativePlayerProfiles";
import { loadNativeStepDecoGrass, NATIVE_STEPSOUND_DECO_GRASS_KIND } from "../../src/assets/native/loadNativeStepDecoGrass";
import { loadNativeStepSounds, NATIVE_STEPSOUND_PACKAGE_KIND } from "../../src/assets/native/loadNativeStepSounds";
import { loadNativeWorldAudio } from "../../src/assets/native/loadNativeWorldAudio";
import { loadNativeCombatAudio } from "../../src/audio/loadNativeCombatAudio";

const manifestSha256 = "a".repeat(64);
const manifestBytes = 64;
const unavailableStatus = 503;

function pinnedRecord(folder: string, fields: Record<string, unknown> = {}) {
  return { id: "pinned-bundle", manifest: `/l2/${folder}/${manifestSha256}/manifest.json`, manifestSha256, manifestBytes, ...fields };
}

function serveCatalogAndRefuseEveryResource(catalog: Record<string, unknown>) {
  const fetcher = vi.fn(async (url: string) => url === "/l2/catalog.json"
    ? new Response(JSON.stringify({ schemaVersion: 1, models: [], ...catalog }))
    : new Response("unavailable", { status: unavailableStatus }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("pinned native resource loaders", () => {
  it.each([
    ["NPC profiles", () => loadNativeNpcProfiles([pinnedRecord("npc-profiles")], new AbortController().signal)],
    ["player profiles", () => loadNativePlayerProfiles([pinnedRecord("player-profiles")], new AbortController().signal)],
    ["step sounds", () => loadNativeStepSounds([pinnedRecord("step-sounds", { kind: NATIVE_STEPSOUND_PACKAGE_KIND })], new AbortController().signal)],
    ["step deco grass", () => loadNativeStepDecoGrass([pinnedRecord("step-sounds", { kind: NATIVE_STEPSOUND_DECO_GRASS_KIND })],
      new AbortController().signal)],
    ["world audio", () => loadNativeWorldAudio({ tileId: null, records: [pinnedRecord("world-audio")] }, new AbortController().signal)],
    ["animation audio", () => loadNativeAnimationAudio([pinnedRecord("animation-audio")], new Map(), new Map(), new AbortController().signal)],
    ["combat audio", () => loadNativeCombatAudio(new AbortController().signal)],
  ])("fetch %s through the one pinned-fetch owner", async (_loader, load) => {
    const fetcher = serveCatalogAndRefuseEveryResource({ combatAudio: [pinnedRecord("combat-audio", { id: "native-combat-audio" })] });
    await expect(load()).rejects.toThrow(`Native resource returned HTTP ${unavailableStatus}: /l2/`);
    expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`/${manifestSha256}/manifest\\.json$`)), expect.anything());
  });
});
