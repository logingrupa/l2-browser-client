import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve("scripts/validate-editor-materials.mjs");
const { validateEditorMaterials } = await import(pathToFileURL(script).href) as {
  validateEditorMaterials(root: string): Promise<{ scenes: number; meshFiles: number }>;
};
const proxy = { id: "ProxyMaterial", uniqueId: 8, customType: "BABYLON.ShaderMaterial", shaderPath: { vertex: "lightProxy", fragment: "lightProxy" } };

describe("Editor material build preflight", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "l2-editor-materials-")); await mkdir(join(root, "assets")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  async function fixture(name: string, data: unknown) {
    const path = join(root, "assets", name); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2)); return path;
  }
  async function snapshot(directory = root): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) Object.assign(result, await snapshot(path));
      else result[path] = (await readFile(path)).toString("base64");
    }
    return result;
  }

  it("rejects the observed referenced lightProxy shader before generation, names the file and leaves bytes unchanged", async () => {
    await fixture("native.scene/meshes/Pine trunk.json", { meshes: [{ id: "Pine trunk", materialId: proxy.id, materialUniqueId: 8 }], materials: [proxy] });
    const before = await snapshot();
    const result = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
    expect(result.status).toBe(1); expect(result.stderr).toContain("Pine trunk.json");
    expect(result.stderr).toContain("internal lightProxy"); expect(result.stderr).toContain("known Editor material uniqueId collision");
    expect(result.stderr).toContain("Restore the affected authored mesh/material records");
    expect(await snapshot()).toEqual(before);
  });

  it("accepts a user material named ProxyMaterial, other shaders and unreferenced helper records", async () => {
    await fixture("safe.scene/meshes/custom.json", { meshes: [{ id: "custom", materialId: "ProxyMaterial" }], materials: [
      { ...proxy, shaderPath: { vertex: "userShader", fragment: "userShader" } }, { ...proxy, id: "unused helper", uniqueId: 9 },
    ] });
    await fixture("safe.scene/meshes/standard.json", { meshes: [{ id: "standard", materialId: "standard" }], materials: [
      { ...proxy, id: "standard", customType: "BABYLON.StandardMaterial" },
    ] });
    await fixture("safe.scene/meshes/one-stage.json", { meshes: [{ id: "single stage", materialId: "one-stage" }], materials: [
      { ...proxy, id: "one-stage", shaderPath: { vertex: "lightProxy", fragment: "customFragment" } },
    ] });
    const before = await snapshot();
    expect(await validateEditorMaterials(root)).toEqual({ scenes: 1, meshFiles: 3 });
    expect(spawnSync(process.execPath, [script, root], { encoding: "utf8" }).status).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it("detects the shader fingerprint after a rename and follows material references across mesh records", async () => {
    await fixture("group/section.scene/meshes/source.json", { meshes: [], materials: [{ ...proxy, id: "renamed helper" }] });
    await fixture("group/section.scene/meshes/target.json", { meshes: [{ id: "affected", materialId: "renamed helper" }] });
    await expect(validateEditorMaterials(root)).rejects.toThrow("renamed helper");
  });

  it("checks referenced MultiMaterial slots and numeric-only material references including LOD records", async () => {
    await fixture("native.scene/meshes/parent.json", { meshes: [{ id: "parent", materialId: "slots" }], materials: [proxy],
      multiMaterials: [{ id: "slots", materials: [null, "ProxyMaterial"] }] });
    await fixture("native.scene/lods/tree.json", { meshes: [{ id: "tree LOD", materialUniqueId: 8 }] });
    await expect(validateEditorMaterials(root)).rejects.toThrow("parent.json");
    await expect(validateEditorMaterials(root)).rejects.toThrow("tree.json");
  });

  it("does not use an unrelated numeric collision when the mesh has an explicit safe material ID", async () => {
    await fixture("native.scene/meshes/tree.json", { meshes: [{ id: "tree", materialId: "Tree bark", materialUniqueId: 8 }],
      materials: [proxy, { id: "Tree bark", uniqueId: 8, customType: "BABYLON.StandardMaterial" }] });
    expect(await validateEditorMaterials(root)).toEqual({ scenes: 1, meshFiles: 1 });
  });

  it("limits scanning to authored scene mesh/LOD records and reports unreadable JSON with its file", async () => {
    await fixture("textures/irrelevant.json", { meshes: [{ materialId: proxy.id }], materials: [proxy] });
    await fixture("native.scene/config.json", { materials: [proxy] });
    expect(await validateEditorMaterials(root)).toEqual({ scenes: 1, meshFiles: 0 });
    const path = await fixture("native.scene/meshes/invalid.json", {}); await writeFile(path, "{invalid");
    await expect(validateEditorMaterials(root)).rejects.toThrow("invalid.json");
  });
});
