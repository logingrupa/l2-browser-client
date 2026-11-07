import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { migrateNativeTerrainUv } = await import(pathToFileURL(resolve("scripts/migrate-native-terrain-uv.mjs")).href);
const { preserveNativeEditorUv2 } = await import(pathToFileURL(resolve("scripts/preserve-native-editor-uv2.mjs")).href);
const baseline = resolve("artifacts/native-parity/research/terrain-uv-migration-20261106/implementation/baseline-authored");
const SCENE = "assets/native-world.scene", MESH = "native-34fc990641dc04014d49e47c";
const BEFORE = "bc541071acd0ed8dd7306e8a476b7c0bc1ca92c8134dff4dc08da44626843a4e";
const AFTER = "549a7fef8316ed66b718f907ad2837a78e818d1e6740d9690200d1d5cd15ab05";
const BEFORE_UV = "957f2061e9b83e8e4fdb6e1504ee66fb2100a0c0b6cf4e70f686e97e98814695";
const AFTER_UV = "d549356ff531e4271099c2097807eec899cc45eb96d512be04b03855d558963d";
const meshFile = `${SCENE}/meshes/${MESH}.json`, proofFile = `${SCENE}.native-editor-channels.json`;
const binaryFile = (hash: string) => `${SCENE}/geometries/${hash}.babylonbinarymeshdata`;
const fixtures = [meshFile, proofFile, binaryFile(BEFORE), `${SCENE}/config.json`, `${SCENE}/nodes/native-e5a08bcebe4f528ff1b05bfa.json`];
const nativeBaselineInstalled = fixtures.every(path => existsSync(join(baseline, path)));
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

// Native binaries stay local. A clean source-only checkout explicitly skips
// this integration fixture rather than inventing equivalent synthetic assets.
describe.skipIf(!nativeBaselineInstalled)("qualified native terrain UV migration (requires local baseline-authored native assets)", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "l2-terrain-uv-migration-"));
    for (const path of fixtures) {
      await fs.mkdir(dirname(join(root, path)), { recursive: true });
      await fs.copyFile(join(baseline, path), join(root, path));
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    const target = await fs.realpath(root), parent = await fs.realpath(tmpdir());
    if (!target.startsWith(join(parent, "l2-terrain-uv-migration-"))) throw new Error("Unexpected temporary migration project.");
    await fs.rm(target, { recursive: true, force: true });
  });
  async function tree(directory = root): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) Object.assign(result, await tree(path));
      else result[relative(root, path).replaceAll("\\", "/")] = hash(await fs.readFile(path));
    }
    return result;
  }
  const read = (path: string) => fs.readFile(join(root, path));
  const migrate = (apply = false) => migrateNativeTerrainUv({ projectRoot: root, apply });

  it("defaults to inspection, reporting the independent native oracle without writing files", async () => {
    const before = await tree(), receipt = await migrate();
    expect(receipt.status).toBe("dry-run");
    expect(receipt.binary).toMatchObject({ before: BEFORE, after: AFTER, bytes: 148244 });
    expect(receipt.primaryUv).toMatchObject({ before: BEFORE_UV, after: AFTER_UV });
    expect(receipt.correction).toMatchObject({ changedScalarCount: 735, changedByteCount: 1078 });
    expect(receipt.correction.changedByteOffsets).toHaveLength(1078);
    expect(await tree()).toEqual(before);
  });

  it("changes only selected V bytes and two JSON strings, retains authored edits, then is byte-idempotent", async () => {
    const authored = JSON.parse((await read(meshFile)).toString());
    authored.meshes[0].metadata.userNote = "preserve this authored edit";
    await fs.writeFile(join(root, meshFile), `${JSON.stringify(authored, null, "\t")}\r\n`);
    const before = await tree(), oldMesh = await read(meshFile), oldProof = await read(proofFile), original = await read(binaryFile(BEFORE));
    const receipt = await migrate(true), corrected = await read(binaryFile(AFTER));
    expect(receipt.status).toBe("applied");
    expect(hash(corrected)).toBe(AFTER);
    expect(hash(corrected.subarray(56448, 75264))).toBe(AFTER_UV);
    expect(await read(meshFile)).toEqual(Buffer.from(oldMesh.toString().replace(JSON.stringify(binaryFile(BEFORE)), JSON.stringify(binaryFile(AFTER)))));
    expect(await read(proofFile)).toEqual(Buffer.from(oldProof.toString().replace(JSON.stringify(BEFORE_UV), JSON.stringify(AFTER_UV))));
    expect(await read(binaryFile(BEFORE))).toEqual(original);
    expect(corrected.subarray(0, 56448)).toEqual(original.subarray(0, 56448));
    expect(corrected.subarray(75264)).toEqual(original.subarray(75264));
    let changedValues = 0;
    for (let vertex = 0; vertex < 2352; vertex++) {
      const y = 208 + Math.floor(vertex / 49), u = 56448 + vertex * 8, v = u + 4;
      expect(corrected.subarray(u, u + 4)).toEqual(original.subarray(u, u + 4));
      if (y <= 240) expect(corrected.subarray(v, v + 4)).toEqual(original.subarray(v, v + 4));
      else { expect(corrected.readFloatLE(v)).toBe((y + .5) / 256 - (y - 240) / 4096); changedValues++; }
    }
    expect(changedValues).toBe(735);
    expect(corrected.subarray(75004, 75008).toString("hex")).toBe("00907e3f");
    const after = await tree();
    expect(Object.keys(after)).toHaveLength(Object.keys(before).length + 1);
    for (const [path, value] of Object.entries(before)) if (![meshFile, proofFile].includes(path)) expect(after[path]).toBe(value);
    expect(await migrate(true)).toMatchObject({ status: "already-corrected", appliedChanges: { files: 0, scalars: 0, bytes: 0 } });
    expect(await tree()).toEqual(after);
  });

  it.each(["geometry", "reference", "proof", "root", "collision"])("refuses %s tampering without partial writes", async fault => {
    if (fault === "geometry") {
      const bytes = await read(binaryFile(BEFORE)); bytes.writeFloatLE(123, 0); await fs.writeFile(join(root, binaryFile(BEFORE)), bytes);
    } else if (fault === "reference") {
      const data = JSON.parse((await read(meshFile)).toString()); data.meshes[0].delayLoadingFile = binaryFile("a".repeat(64));
      await fs.writeFile(join(root, meshFile), JSON.stringify(data));
    } else if (fault === "proof") {
      const data = JSON.parse((await read(proofFile)).toString()); data.meshes[0].channels.uvs.sha256 = AFTER_UV;
      await fs.writeFile(join(root, proofFile), JSON.stringify(data));
    } else if (fault === "root") {
      const path = fixtures[4]!, data = JSON.parse((await read(path)).toString()); data.metadata.nativeWorldRoot.manifestSha256 = "f".repeat(64);
      await fs.writeFile(join(root, path), JSON.stringify(data));
    } else await fs.writeFile(join(root, binaryFile(AFTER)), "different existing resource");
    const before = await tree();
    await expect(migrate(true)).rejects.toThrow(/hash differs|unknown\/newer|channel proof|manifest identity|different bytes/);
    expect(await tree()).toEqual(before);
  });

  it("requires the corrected proof on rerun even while saved UV2 exists", async () => {
    await migrate(true);
    const proof = JSON.parse((await read(proofFile)).toString()); proof.meshes[0].channels.uvs.sha256 = BEFORE_UV;
    await fs.writeFile(join(root, proofFile), JSON.stringify(proof));
    const before = await tree();
    await expect(migrate(true)).rejects.toThrow("current uvs channel proof differs");
    expect(await tree()).toEqual(before);
  });

  it("restores the exact corrected binary after simulated Editor UV2 omission", async () => {
    await migrate(true);
    const corrected = await read(binaryFile(AFTER)), data = JSON.parse((await read(meshFile)).toString());
    const withoutUv2 = corrected.subarray(0, 129428), path = binaryFile(hash(withoutUv2));
    await fs.writeFile(join(root, path), withoutUv2);
    data.meshes[0].delayLoadingFile = path; delete data.meshes[0]._binaryInfo.uvs2AttrDesc; data.meshes[0].hasUVs2 = false;
    await fs.writeFile(join(root, meshFile), JSON.stringify(data));
    const result = await preserveNativeEditorUv2({ projectRoot: root, scenePath: SCENE });
    expect(result.restored).toHaveLength(1);
    expect(result.restored[0].binarySha256).toBe(AFTER);
    expect(await read(binaryFile(AFTER))).toEqual(corrected);
    expect(JSON.parse((await read(meshFile)).toString()).meshes[0]._binaryInfo.uvs2AttrDesc).toEqual({ count: 4704, stride: 2, offset: 129428, dataType: 1 });
    expect(await migrate(true)).toMatchObject({ status: "already-corrected" });
  });

  it("rolls back its first JSON update and new binary when the paired update fails", async () => {
    const before = await tree(), rename = fs.rename.bind(fs);
    let failed = false;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to) === join(root, proofFile) && !failed) { failed = true; throw Object.assign(new Error("simulated paired update failure"), { code: "EACCES" }); }
      return rename(from, to);
    });
    await expect(migrate(true)).rejects.toThrow("simulated paired update failure");
    expect(await tree()).toEqual(before);
  });

  it("keeps concurrent user edits and their referenced derivative on rollback", async () => {
    const rename = fs.rename.bind(fs);
    let userBytes: Buffer | undefined, failed = false;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to) === join(root, proofFile) && !failed) {
        failed = true;
        const data = JSON.parse((await read(meshFile)).toString()); data.meshes[0].metadata.userNote = "saved concurrently";
        userBytes = Buffer.from(JSON.stringify(data)); await fs.writeFile(join(root, meshFile), userBytes);
        throw new Error("concurrent authoring during paired update");
      }
      return rename(from, to);
    });
    const oldProof = await read(proofFile);
    await expect(migrate(true)).rejects.toMatchObject({ rollback: { preservedConcurrentEdits: [meshFile], binaryRemoved: false } });
    expect(await read(meshFile)).toEqual(userBytes);
    expect(await read(proofFile)).toEqual(oldProof);
    expect(hash(await read(binaryFile(AFTER)))).toBe(AFTER);
    expect(Object.keys(await tree()).filter(path => path.endsWith(".tmp"))).toEqual([]);
  });
});
