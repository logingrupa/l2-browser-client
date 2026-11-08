import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { vi } from "vitest";
import { buildNativeCatalogIndex } from "../../src/assets/native/nativeCatalogIndex";
import { readNativeCatalog, type NativeCatalog } from "../../src/assets/native/readNativeCatalog";
import { sha256 } from "../../src/assets/package/readAssetPackage";

export const goldenStoreRoot = "tests/fixtures/golden/l2";
export const nativeCoveragePath = "/l2/coverage.json";

export const musverenProfile = { id: "npc:21622", npcId: 21622, name: "Greater Musveren", mesh: "LineageMonsters.field_stalker_m00",
  actorClass: "LineageMonster.field_stalker_20_bi", drawScale: 1.2, drawScale3D: [1, 1, 1], collisionRadius: 18,
  collisionHeight: 36, sourceUnitsPerMetre: 100, unsupportedFields: [{ field: "prePivot", reason: "Unverified." }] };
export const unconvertedProfile = { ...musverenProfile, id: "npc:20001", npcId: 20001, mesh: "LineageMonsters.unconverted_m00" };

async function profileManifest(kind: string, directory: string, fields: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, kind, ...fields }));
  const manifestSha256 = await sha256(bytes);
  return { bytes, record: { id: kind, manifest: `/l2/${directory}/${manifestSha256}/manifest.json`, manifestSha256, manifestBytes: bytes.length } };
}

export function npcProfileManifest(profiles: unknown[]) {
  return profileManifest("native-npc-profiles", "npc-profiles", { support: "source-profile-fields-ready", profiles, unsupported: [] });
}

export function playerProfileManifest(profiles: unknown[]) {
  return profileManifest("native-player-profiles", "player-profiles", { profiles });
}

function coverageResponse(coverage: unknown): Response {
  return coverage === null ? new Response("missing", { status: 404 }) : Response.json(coverage);
}

export function serveFiles(files: ReadonlyMap<string, Uint8Array>, coverage: unknown = null) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === nativeCoveragePath) return coverageResponse(coverage);
    const bytes = files.get(url);
    if (!bytes) throw new Error(`Unexpected request ${url}`);
    return new Response(bytes.slice());
  }));
}

export function model(id: string, sourceObject: string) {
  return { id, archive: `/l2/${"a".repeat(64)}/asset.l2asset`, archiveSha256: "a".repeat(64), source: { object: sourceObject } };
}

export function catalogWith(slices: Partial<NativeCatalog>): NativeCatalog {
  return { schemaVersion: 1, models: [], textures: [], sections: [], movers: [], npcProfiles: [], playerProfiles: [],
    animationAudio: [], combatAudio: [], worldAudio: [], effectComponents: [], tables: [], windows: [], tiles: [],
    servedCatalogSha256: "c".repeat(64), ...slices };
}

export async function goldenCatalogSha256(): Promise<string> {
  return sha256(new Uint8Array(await readFile(`${goldenStoreRoot}/catalog.json`)));
}

export async function goldenCatalogIndex(coverage: unknown = null) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === nativeCoveragePath) return coverageResponse(coverage);
    const path = `${goldenStoreRoot}${url.replace(/^\/l2/, "")}`;
    if (!url.startsWith("/l2/") || !existsSync(path)) return new Response("missing", { status: 404 });
    return new Response(await readFile(path));
  }));
  const signal = new AbortController().signal;
  const catalog = await readNativeCatalog(signal);
  return { catalog, index: await buildNativeCatalogIndex(catalog, signal) };
}
