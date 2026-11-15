import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const records = value => Array.isArray(value) ? value.filter(object) : [];
const internalProxy = material => material.customType === "BABYLON.ShaderMaterial" &&
  material.shaderPath?.vertex === "lightProxy" && material.shaderPath?.fragment === "lightProxy";

async function sceneDirectories(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (entry.name.endsWith(".scene")) result.push(path);
    else result.push(...await sceneDirectories(path));
  }
  return result.sort();
}

/** Read-only preflight for the identified Editor internal-material collision.
 * Names alone are intentionally not rejected: only a referenced ShaderMaterial
 * using both internal lightProxy shader stages identifies this failure. */
export async function validateEditorMaterials(projectRoot = process.cwd()) {
  const root = resolve(projectRoot), scenes = await sceneDirectories(join(root, "assets"));
  const failures = [];
  let meshFiles = 0;
  for (const scene of scenes) {
    const files = [];
    for (const directory of ["meshes", "lods"]) {
      let entries;
      try { entries = await readdir(join(scene, directory), { withFileTypes: true }); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      for (const entry of entries) if (entry.isFile() && entry.name.endsWith(".json")) {
        const path = join(scene, directory, entry.name);
        let data;
        try { data = JSON.parse(await readFile(path, "utf8")); }
        catch (error) { throw new Error(`Cannot inspect Editor mesh file ${relative(root, path)}: ${error.message}`); }
        files.push({ path, data }); meshFiles++;
      }
    }
    const materials = files.flatMap(file => records(file.data?.materials));
    const multiMaterials = files.flatMap(file => records(file.data?.multiMaterials));
    function referenced(id, uniqueId, visited = new Set()) {
      const byId = typeof id === "string";
      if (!byId && typeof uniqueId !== "number") return [];
      const key = byId ? `id:${id}` : `unique:${uniqueId}`;
      if (visited.has(key)) return [];
      visited.add(key);
      const matches = material => byId ? material.id === id : material.uniqueId === uniqueId;
      const result = materials.filter(material => matches(material) && internalProxy(material));
      for (const multi of multiMaterials.filter(matches)) {
        const ids = Array.isArray(multi.materials) ? multi.materials : [];
        const uniqueIds = Array.isArray(multi.materialsUniqueIds) ? multi.materialsUniqueIds : [];
        for (let index = 0; index < Math.max(ids.length, uniqueIds.length); index++) {
          result.push(...referenced(ids[index], uniqueIds[index], visited));
        }
      }
      return result;
    }
    for (const { path, data } of files) for (const mesh of records(data?.meshes)) {
      const proxies = referenced(mesh.materialId, mesh.materialUniqueId);
      if (proxies.length) failures.push(`${relative(root, path)}: mesh ${JSON.stringify(mesh.id ?? mesh.name)} references ` +
        `internal lightProxy material ${[...new Set(proxies.map(material => JSON.stringify(material.id)))].join(", ")}.`);
    }
  }
  if (failures.length) throw new Error(`Editor material validation failed.\n${failures.join("\n")}\n` +
    "This matches the known Editor material uniqueId collision. Restore the affected authored mesh/material records from a verified copy, " +
    "then reopen the scene and check its materials before saving. No files were changed; generation stopped before packing.");
  return { scenes: scenes.length, meshFiles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await validateEditorMaterials(process.argv[2]);
    console.log(`Editor materials verified: ${result.scenes} scenes, ${result.meshFiles} mesh files.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
