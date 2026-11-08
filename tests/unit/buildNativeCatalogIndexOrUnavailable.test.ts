import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeCatalog } from "../../src/assets/native/readNativeCatalog";
import { buildNativeCatalogIndexOrUnavailable } from "../../src/runtime/buildNativeCatalogIndexOrUnavailable";

const pendingProfileManifestSha256 = "b".repeat(64);
const pendingNpcProfileRecord = { id: "native-npc-profiles", manifest: `/l2/npc-profiles/${pendingProfileManifestSha256}/manifest.json`,
  manifestSha256: pendingProfileManifestSha256, manifestBytes: 1 };

function catalogWith(slices: Partial<NativeCatalog>): NativeCatalog {
  return { schemaVersion: 1, models: [], textures: [], sections: [], movers: [], npcProfiles: [], playerProfiles: [],
    animationAudio: [], combatAudio: [], worldAudio: [], effectComponents: [], ...slices };
}

function holdEveryFetchUntilAbort() {
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>(resolve => { markFetchStarted = resolve; });
  vi.stubGlobal("fetch", vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    markFetchStarted();
  })));
  return fetchStarted;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("native catalog index with an unavailable fallback", () => {
  it("rejects with the abort instead of an unavailable index when the signal aborts while NPC profiles load", async () => {
    const fetchStarted = holdEveryFetchUntilAbort();
    const controller = new AbortController();
    const pending = buildNativeCatalogIndexOrUnavailable(catalogWith({ npcProfiles: [pendingNpcProfileRecord] }), controller.signal);
    await fetchStarted;
    controller.abort();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
  });

  it("returns an unavailable index that names the failure when the catalog cannot be indexed", async () => {
    const duplicatedModel = { id: "musveren:0", source: { object: "LineageMonsters.field_stalker_m00" } };
    const outcome = await buildNativeCatalogIndexOrUnavailable(catalogWith({ models: [duplicatedModel, duplicatedModel] }), new AbortController().signal);
    expect(outcome.catalogIndexFailure).toBe("Native catalog has duplicate entries for musveren:0.");
    expect(outcome.catalogIndex.lookup("npc:21622")).toEqual({ status: "not-in-catalog", key: "npc:21622",
      reason: "catalog index unavailable: Native catalog has duplicate entries for musveren:0." });
  });

  it("returns the built index with no failure when the catalog indexes", async () => {
    const outcome = await buildNativeCatalogIndexOrUnavailable(catalogWith({}), new AbortController().signal);
    expect(outcome.catalogIndexFailure).toBeNull();
    expect(outcome.catalogIndex.keys("npc:")).toEqual([]);
  });
});
