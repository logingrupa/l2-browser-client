import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNativeCatalogIndex, npcCatalogKey, skillCatalogKey, tileCatalogKey } from "../../src/assets/native/nativeCatalogIndex";
import { readNativeCatalog } from "../../src/assets/native/readNativeCatalog";
import { readAssetPackage, sha256 } from "../../src/assets/package/readAssetPackage";
import { storedPackage } from "../fixtures/assetPackageFixture";

const goldenFixtureRoot = "tests/fixtures/golden";
interface GoldenFixturePin { path: string; sha256: string; bytes: number }

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pinnedBytes(path: string, bytes: Uint8Array): Uint8Array {
  return path.endsWith(".json") ? new TextEncoder().encode(canonicalJson(JSON.parse(new TextDecoder().decode(bytes)))) : bytes;
}

async function goldenFixturePins(): Promise<GoldenFixturePin[]> {
  const lock = JSON.parse(new TextDecoder().decode(pinnedBytes("fixtures.lock.json", new Uint8Array(await readFile(`${goldenFixtureRoot}/fixtures.lock.json`))))) as { files: GoldenFixturePin[] };
  return lock.files;
}

async function readPinnedGoldenFixture(path: string): Promise<Uint8Array> {
  const pin = (await goldenFixturePins()).find(row => row.path === path);
  if (!pin) throw new Error(`Golden fixture ${path} is not pinned in fixtures.lock.json.`);
  const bytes = new Uint8Array(await readFile(`${goldenFixtureRoot}/${path}`));
  const canonical = pinnedBytes(path, bytes);
  expect(createHash("sha256").update(canonical).digest("hex")).toBe(pin.sha256);
  expect(canonical.length).toBe(pin.bytes);
  return bytes;
}

async function repackedWithManifest(path: string, editManifest: (manifest: Record<string, unknown>) => void): Promise<Uint8Array> {
  const original = await readAssetPackage(await readPinnedGoldenFixture(path));
  const manifest = structuredClone(original.manifest) as unknown as Record<string, unknown>;
  if (manifest.schemaVersion === 1) delete manifest.coordinates;
  editManifest(manifest);
  return storedPackage([{ name: "asset.json", bytes: new TextEncoder().encode(JSON.stringify(manifest)) },
    ...[...original.files].sort(([left], [right]) => left < right ? -1 : 1).map(([name, bytes]) => ({ name, bytes }))]);
}

afterEach(() => vi.unstubAllGlobals());

describe("golden fixtures for the asset output contract", () => {
  it("lists every fixture once in sorted path order", async () => {
    const paths = (await goldenFixturePins()).map(row => row.path);
    expect(paths).toEqual([...paths].sort());
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(["audio-v2.l2asset", "l2/catalog.json", "model-v1.l2asset", "model-v2.l2asset", "reference-client-tree.lock.json"]);
  });

  it("reads a v2 model with right-handed Y-up metre coordinates and derived build fields", async () => {
    const { manifest } = await readAssetPackage(await readPinnedGoldenFixture("model-v2.l2asset"));
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.coordinates).toEqual({ unit: "metre", sourceUnitsPerMetre: 100, handedness: "right", upAxis: "Y",
      sourceToGltf: [.01, 0, 0, 0, 0, 0, .01, 0, 0, .01, 0, 0, 0, 0, 0, 1] });
    if (manifest.schemaVersion !== 2) throw new Error("Expected a v2 manifest.");
    const referenceLock = await readPinnedGoldenFixture("reference-client-tree.lock.json");
    expect(manifest.clientBuild.referenceTreeLockSha256).toBe(await sha256(pinnedBytes("reference-client-tree.lock.json", referenceLock)));
    expect(manifest.source.path).toEqual({ host: "SYNTHETIC-HOST", absolutePath: "C:/SyntheticClient/SyntheticFixture.ukx" });
    expect(manifest.model).toEqual({ file: "model.glb" });
  });

  it("reads a v2 audio package without coordinates and a v1 model with normalised coordinates", async () => {
    const audio = await readAssetPackage(await readPinnedGoldenFixture("audio-v2.l2asset"));
    expect(audio.manifest.kind).toBe("audio");
    expect(audio.manifest.coordinates).toBeUndefined();
    const versionOne = await readAssetPackage(await readPinnedGoldenFixture("model-v1.l2asset"));
    expect(versionOne.manifest.schemaVersion).toBe(1);
    expect(versionOne.manifest.coordinates).toEqual({ unit: "metre", sourceUnitsPerMetre: 100, sourceToGltf: [.01, 0, 0, 0, 0, 0, .01, 0, 0, .01, 0, 0, 0, 0, 0, 1] });
    expect(versionOne.manifest.model?.file).toBe("model.glb");
  });

  it.each([
    ["schemaVersion 3", "model-v2.l2asset", (manifest: Record<string, unknown>) => { manifest.schemaVersion = 3; }],
    ["schemaVersion 0", "model-v1.l2asset", (manifest: Record<string, unknown>) => { manifest.schemaVersion = 0; }],
    ["left-handed coordinates", "model-v2.l2asset", (manifest: Record<string, unknown>) => { (manifest.coordinates as Record<string, unknown>).handedness = "left"; }],
    ["a v2 model without coordinates", "model-v2.l2asset", (manifest: Record<string, unknown>) => { delete manifest.coordinates; }],
    ["a v2 package without clientBuild", "audio-v2.l2asset", (manifest: Record<string, unknown>) => { delete manifest.clientBuild; }],
    ["a v2 package without source.path", "audio-v2.l2asset", (manifest: Record<string, unknown>) => { delete (manifest.source as Record<string, unknown>).path; }],
  ] as const)("rejects %s", async (_label, path, editManifest) => {
    await expect(readAssetPackage(await repackedWithManifest(path, editManifest))).rejects.toThrow(/asset\.json/);
  });

  it("serves the fixture catalog through readNativeCatalog and indexes its synthetic skill and tile keys", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response((await readPinnedGoldenFixture(url.replace(/^\/l2\//, "l2/"))).slice())));
    const signal = new AbortController().signal;
    const catalog = await readNativeCatalog(signal);
    expect(catalog.models).toHaveLength(2);
    const index = await buildNativeCatalogIndex(catalog, signal);
    expect(index.lookup(skillCatalogKey(0, 1)).status).toBe("converted");
    expect(index.lookup(tileCatalogKey("00_00")).status).toBe("converted");
    expect(index.lookup(npcCatalogKey(1)).status).toBe("not-in-catalog");
  });
});
