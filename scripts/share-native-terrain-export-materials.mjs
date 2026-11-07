import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

/** Editor mesh records deliberately embed their material for independent editing.
 * Its packer repeats that definition in the exported scene. Babylon parses each
 * copy (including textures), although both meshes resolve the same material.
 * Deduplicate only exact shared definitions referenced by a declared terrain
 * patch. Saved records and distinct/conflicting authored materials stay intact.
 */
export function shareNativeTerrainExportMaterials(scene) {
  const patches=(scene.meshes??[]).filter(mesh=>mesh.metadata?.worldTerrain===true&&
    mesh.metadata?.nativeTerrainPatch?.id==='interlude:20_20.TerrainInfo0.TerrainSector247');
  const bases=(scene.meshes??[]).filter(mesh=>mesh.metadata?.worldTerrain===true&&!mesh.metadata?.nativeTerrainPatch);
  const remove=new Set(), shared=[];
  const definitions=scene.materials??[];
  for(const patch of patches) {
    if(!bases.some(base=>base.materialId===patch.materialId&&base.materialUniqueId===patch.materialUniqueId))continue;
    if(typeof patch.materialId!=='string'||!Number.isSafeInteger(patch.materialUniqueId))continue;
    const entries=definitions.map((material,index)=>({material,index})).filter(({material})=>
      material.id===patch.materialId||material.uniqueId===patch.materialUniqueId);
    if(entries.length<2)continue;
    const first=entries[0].material;
    if(entries.some(({material})=>material.id!==patch.materialId||material.uniqueId!==patch.materialUniqueId||
      !isDeepStrictEqual(material,first)))throw Error(`Conflicting authored terrain material ${patch.materialId}; export unchanged.`);
    if(first.customType!=='BABYLON.ShaderMaterial')continue;
    for(const {index} of entries.slice(1))remove.add(index);
    shared.push({id:patch.materialId,removedDefinitions:entries.length-1});
  }
  return {scene:remove.size?{...scene,materials:definitions.filter((_,index)=>!remove.has(index))}:scene,
    removedDefinitions:remove.size,shared};
}

export async function processNativeTerrainExport(path) {
  let text;
  try{text=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return {missing:true,removedDefinitions:0};throw error;}
  const result=shareNativeTerrainExportMaterials(JSON.parse(text));
  if(result.removedDefinitions) {
    if(await readFile(path,'utf8')!==text)throw Error('Terrain export changed during material sharing; no write.');
    await writeFile(path,JSON.stringify(result.scene));
  }
  return {path,removedDefinitions:result.removedDefinitions,shared:result.shared};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{console.log(JSON.stringify(await processNativeTerrainExport(resolve(process.argv[2]??'public/scene/native-world.babylon'))));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
