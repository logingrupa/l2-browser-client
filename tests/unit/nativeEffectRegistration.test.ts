import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const { planNativeEffectRegistration, applyNativeEffectRegistration, registerNativeEffectCatalog } = await import(pathToFileURL(resolve(
  "scripts/native_effect_registration.mjs")).href);
const real = resolve("artifacts/native-parity/research/native-power-strike-components-20261107/staging/output/82e36ae7305abade2520dba335839c7422d878e6c07caa95323b47f7626f0afd");
const realManifest = JSON.parse(await fs.readFile(join(real, "manifest.json"), "utf8"));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex"), roots: string[] = [];
const targetId = "interlude:skill:3:level:1:raw-source-dispatch";
type Json = Record<string, any>;
async function fixture(entries?: Json[]) {
  const root = await fs.mkdtemp(join(tmpdir(), "effect-registration-test-")); roots.push(root);
  const l2 = join(root, "l2"), catalogPath = join(l2, "catalog.json"), manifest = structuredClone(realManifest);
  const catalog: Json = { schemaVersion: 1, movers: [{ id: "door-owner", position: [1, 2, 3] }], actors: [{ id: "female" }],
    sections: [{ id: "20_20", primaryUV: "d549" }], audio: { cues: ["retained-walking", "retained-skill"] },
    retainedUnknown: { unicode: "Latvija – Rīga", flags: [false, null, 0] } };
  if (entries !== undefined) catalog.effectComponents = entries;
  const raw = Buffer.from(JSON.stringify(catalog, null, "\t").replace('"schemaVersion": 1', '"schemaVersion" : 1').replace(/\n/g, "\r\n") + "\r\n");
  await fs.mkdir(l2); await fs.writeFile(catalogPath, raw);
  async function install(value = manifest) {
    const bytes = Buffer.from(JSON.stringify(value) + "\n"), sha256 = hash(bytes), directory = join(l2, "effects", sha256);
    await fs.mkdir(join(directory, "resources"), { recursive: true });
    for (const resource of Object.values<Json>(realManifest.resources)) await fs.copyFile(join(real, resource.file), join(directory, resource.file));
    const manifestPath = join(directory, "manifest.json"); await fs.writeFile(manifestPath, bytes);
    return { manifestPath, directory, sha256 };
  }
  const installed = await install();
  return { root, l2, raw, catalog, catalogPath, manifest, install, ...installed, options: { catalogPath, manifestPath: installed.manifestPath } };
}
async function leftovers(directory: string) { return (await fs.readdir(directory)).filter(file => file.includes(".effect-") || file.endsWith(".effect-registration.lock")); }
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const absolute = await fs.realpath(root);
    if (dirname(absolute) !== await fs.realpath(tmpdir()) || !basename(absolute).startsWith("effect-registration-test-")) throw Error("Unsafe fixture cleanup root");
    await fs.rm(absolute, { recursive: true, force: true });
  }
});

describe("optional exact effect catalog registration", () => {
  it("does nothing unless the caller explicitly requests a catalog path", async () => {
    expect(await registerNativeEffectCatalog()).toEqual({ status: "not-requested", filesWritten: 0 });
  });
  it("plans without writes and appends only effectComponents while preserving every preceding raw catalog byte", async () => {
    const f = await fixture(), before = await fs.stat(f.catalogPath), plan = await planNativeEffectRegistration(f.options);
    expect(await fs.readFile(f.catalogPath)).toEqual(f.raw); expect((await fs.stat(f.catalogPath)).mtimeMs).toBe(before.mtimeMs);
    expect(await leftovers(f.l2)).toEqual([]); expect(plan.entry.id).toBe(targetId); expect(plan.stagedResourcesVerified).toBe(13);
    const result = await applyNativeEffectRegistration(plan), after = await fs.readFile(f.catalogPath);
    const unchangedPrefix = Buffer.from(f.raw.toString().slice(0, plan.editedCharacterSpan.start));
    expect(result.status).toBe("registered"); expect(after.subarray(0, unchangedPrefix.length)).toEqual(unchangedPrefix);
    expect(JSON.parse(after.toString())).toEqual({ ...f.catalog, effectComponents: [{ id: targetId, manifest: `/l2/effects/${f.sha256}/manifest.json`, manifestSha256: f.sha256 }] });
    expect(await leftovers(f.l2)).toEqual([]);
  });
  it("updates only the matching entry, preserving its annotations and other effect entries", async () => {
    const other = { id: "interlude:other-effect", manifest: "/l2/unchanged/manifest.json", owner: "other" };
    const f = await fixture([other, { id: targetId, manifest: "/l2/effects/old/manifest.json", manifestSha256: "0".repeat(64), annotation: { keep: true } }]);
    await registerNativeEffectCatalog(f.options); const after = JSON.parse(await fs.readFile(f.catalogPath, "utf8"));
    expect(after.effectComponents).toEqual([other, { id: targetId, manifest: `/l2/effects/${f.sha256}/manifest.json`, manifestSha256: f.sha256, annotation: { keep: true } }]);
    delete after.effectComponents; const before = { ...f.catalog }; delete before.effectComponents; expect(after).toEqual(before);
  });
  it("repeat and verify preserve exact catalog bytes and mtime and create no lock/temp files", async () => {
    const f = await fixture(); await registerNativeEffectCatalog(f.options);
    const bytes = await fs.readFile(f.catalogPath), stat = await fs.stat(f.catalogPath);
    expect((await registerNativeEffectCatalog(f.options)).status).toBe("preserved");
    expect((await registerNativeEffectCatalog({ ...f.options, verifyOnly: true })).status).toBe("verified");
    expect(await fs.readFile(f.catalogPath)).toEqual(bytes); expect((await fs.stat(f.catalogPath)).mtimeMs).toBe(stat.mtimeMs);
    expect(await leftovers(f.l2)).toEqual([]);
  });
  it("verify refuses an unregistered bundle without catalog/temp/lock writes", async () => {
    const f = await fixture(); await expect(registerNativeEffectCatalog({ ...f.options, verifyOnly: true })).rejects.toThrow(/verify writes nothing/);
    expect(await fs.readFile(f.catalogPath)).toEqual(f.raw); expect(await leftovers(f.l2)).toEqual([]);
  });
  it("refuses a stale plan and preserves a newer door-owner catalog edit", async () => {
    const f = await fixture(), plan = await planNativeEffectRegistration(f.options);
    const newer = Buffer.from(JSON.stringify({ ...f.catalog, movers: [{ id: "new-gate", revision: 2 }] })); await fs.writeFile(f.catalogPath, newer);
    await expect(applyNativeEffectRegistration(plan)).rejects.toThrow(/stale plan/);
    expect(await fs.readFile(f.catalogPath)).toEqual(newer); expect(await leftovers(f.l2)).toEqual([]);
    await registerNativeEffectCatalog(f.options);
    expect(JSON.parse(await fs.readFile(f.catalogPath, "utf8")).movers).toEqual([{ id: "new-gate", revision: 2 }]);
  });
  it("rechecks immediately before rename and retains a concurrent edit made while its temporary is written", async () => {
    const f = await fixture(), plan = await planNativeEffectRegistration(f.options), open = fs.open.bind(fs);
    const newer = Buffer.from(JSON.stringify({ ...f.catalog, audio: { owner: "newer audio edit" } }));
    vi.spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
      const file = await open(path, flags, mode);
      if (String(path).endsWith(".tmp")) await fs.writeFile(f.catalogPath, newer);
      return file;
    });
    await expect(applyNativeEffectRegistration(plan)).rejects.toThrow(/stale plan/);
    expect(await fs.readFile(f.catalogPath)).toEqual(newer); expect(await leftovers(f.l2)).toEqual([]);
  });
  it("uses a temporary in the catalog directory and one atomic rename", async () => {
    const f = await fixture(), rename = fs.rename.bind(fs), seen: [string, string][] = [];
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      seen.push([String(from), String(to)]); expect(dirname(String(from))).toBe(f.l2); expect(String(to)).toBe(f.catalogPath);
      expect(await fs.readFile(f.catalogPath)).toEqual(f.raw); await rename(from, to);
    });
    await registerNativeEffectCatalog(f.options); expect(seen).toHaveLength(1); expect(await leftovers(f.l2)).toEqual([]);
  });
  it("does not remove another registration owner's lock", async () => {
    const f = await fixture(), lock = f.catalogPath + ".effect-registration.lock"; await fs.writeFile(lock, "another owner");
    await expect(registerNativeEffectCatalog(f.options)).rejects.toThrow(/holds the lock/);
    expect(await fs.readFile(lock, "utf8")).toBe("another owner"); expect(await fs.readFile(f.catalogPath)).toEqual(f.raw);
  });
  it("rejects duplicate selected IDs rather than replacing or merging them", async () => {
    const f = await fixture([{ id: targetId }, { id: targetId }]);
    await expect(planNativeEffectRegistration(f.options)).rejects.toThrow(/duplicate selected/);
    expect(await fs.readFile(f.catalogPath)).toEqual(f.raw);
  });
  it.each(["../outside.png", "https://example.invalid/asset.png", "resources\\wrong.png"])("rejects malformed resource path %s before catalog selection", async file => {
    const f = await fixture(), modified = structuredClone(f.manifest); Object.values<Json>(modified.resources)[0]!.file = file;
    const invalid = await f.install(modified);
    await expect(planNativeEffectRegistration({ ...f.options, manifestPath: invalid.manifestPath })).rejects.toThrow(/resource identity\/path/);
    expect(await fs.readFile(f.catalogPath)).toEqual(f.raw);
  });
  it("rejects a manifest outside this catalog's exact effects/hash location", async () => {
    const f = await fixture();
    await expect(planNativeEffectRegistration({ ...f.options, manifestPath: join(real, "manifest.json") })).rejects.toThrow(/catalog's \/l2\/effects path/);
    expect(await fs.readFile(f.catalogPath)).toEqual(f.raw);
  });
  it("verifies every staged resource, including a resource not selected for the initial component", async () => {
    const f = await fixture(), resource = Object.values<Json>(f.manifest.resources).at(-1)!;
    await fs.writeFile(join(f.directory, resource.file), Buffer.alloc(resource.bytes));
    await expect(planNativeEffectRegistration(f.options)).rejects.toThrow(/resource hash\/size/);
    expect(await fs.readFile(f.catalogPath)).toEqual(f.raw);
  });
  it("rejects changed staged bytes after planning and preserves the catalog", async () => {
    const f = await fixture(), plan = await planNativeEffectRegistration(f.options), resource = Object.values<Json>(f.manifest.resources)[0]!;
    await fs.writeFile(join(f.directory, resource.file), Buffer.alloc(resource.bytes));
    await expect(applyNativeEffectRegistration(plan)).rejects.toThrow(/stale plan/); expect(await fs.readFile(f.catalogPath)).toEqual(f.raw);
  });
  it("rejects unexpected raw files, duplicate catalog keys and stale expected identities", async () => {
    const f = await fixture();
    await expect(planNativeEffectRegistration({ ...f.options, expectedCatalogSha256: "0".repeat(64) })).rejects.toThrow(/unexpected current catalog/);
    await expect(planNativeEffectRegistration({ ...f.options, expectedManifestSha256: "0".repeat(64) })).rejects.toThrow(/unexpected staged manifest/);
    await fs.writeFile(join(f.directory, "raw-package.bin"), "foreign");
    await expect(planNativeEffectRegistration(f.options)).rejects.toThrow(/unexpected staged file set/);
    await fs.unlink(join(f.directory, "raw-package.bin"));
    await fs.writeFile(f.catalogPath, '{"schemaVersion":1,"movers":[],"movers":[]}');
    await expect(planNativeEffectRegistration(f.options)).rejects.toThrow(/duplicate JSON key/);
  });
});
