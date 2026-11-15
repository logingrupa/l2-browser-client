import { vi } from "vitest";
import { defaultNativePlayerProfile, type NativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { assetFixture } from "../fixtures/assetPackageFixture";

export const fixturePlayerProfile: NativePlayerProfile = {
  ...defaultNativePlayerProfile, id: "human-female-fighter", name: "Human female fighter", catalogId: "human-female-fighter:0",
  assetId: "fixture-model", sourceObject: "Fixture.Female", sourceSha256: "a".repeat(64),
  clips: { idle: "Wait_Native", run: "Wait_Native", attack: "Wait_Native", death: "Wait_Native" },
  collisionRadius: 8, collisionHeight: 23.5,
  upperItems: [{ itemId: 22, catalogId: "female-equipment:0", sourceObject: "Fixture.Female", sourceSha256: "a".repeat(64) }],
  sourceEvidence: { fixture: true }, limitations: ["Synthetic fixture, not native acceptance."],
};

export async function modelArchiveFixture(sourceObject: string, sourceSha256: string) {
  const fixture = await assetFixture("model", { source: { edition: "interlude", package: "Fixture", object: sourceObject, sha256: sourceSha256,
    assembly: [sourceObject] } });
  const archiveSha256 = await sha256(fixture.bytes);
  return { bytes: fixture.bytes, archive: `/l2/${archiveSha256}/asset.l2asset`, archiveSha256 };
}

export function serveStoreFiles(files: ReadonlyMap<string, Uint8Array>, protocol: "https:" | "file:" = "https:") {
  vi.stubGlobal("location", { protocol });
  const servedPrefix = protocol === "file:" ? "l2/" : "/l2/";
  const fetcher = vi.fn(async (url: string) => {
    if (!url.startsWith(servedPrefix)) throw new Error(`Unexpected request ${url}`);
    const bytes = files.get(`/l2/${url.slice(servedPrefix.length)}`);
    if (!bytes) throw new Error(`Unexpected request ${url}`);
    return new Response(bytes.slice());
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
