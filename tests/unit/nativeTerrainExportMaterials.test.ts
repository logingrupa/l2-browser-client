import { describe, expect, it } from 'vitest';
// @ts-expect-error Node-only export stage has no runtime TypeScript dependency.
import { shareNativeTerrainExportMaterials } from '../../scripts/share-native-terrain-export-materials.mjs';

const material=()=>({id:'terrain',uniqueId:7,customType:'BABYLON.ShaderMaterial',alpha:1,textures:{mask:{name:'source.png'}}});
const fixture=()=>({meshes:[
  {id:'base',materialId:'terrain',materialUniqueId:7,metadata:{worldTerrain:true}},
  {id:'patch',materialId:'terrain',materialUniqueId:7,metadata:{worldTerrain:true,nativeTerrainPatch:{id:'interlude:20_20.TerrainInfo0.TerrainSector247'}}},
],materials:[material(),material(),{id:'unrelated',uniqueId:8}],geometries:{binary:'unchanged'},metadata:{authored:true}});
describe('shared terrain export definitions',()=>{
  it('removes the redundant parse input without mutating saved input or other exported data',()=>{
    const input=fixture(),before=structuredClone(input),result=shareNativeTerrainExportMaterials(input);
    expect(result.removedDefinitions).toBe(1);expect(result.scene.materials).toEqual([input.materials[0],input.materials[2]]);
    expect(result.scene.meshes).toBe(input.meshes);expect(result.scene.geometries).toBe(input.geometries);
    expect(result.scene.metadata).toBe(input.metadata);expect(input).toEqual(before);
    expect(shareNativeTerrainExportMaterials(result.scene).removedDefinitions).toBe(0);
  });
  it('preserves distinct authored material identities',()=>{
    const input=fixture();input.meshes[1]!.materialId='different';
    expect(shareNativeTerrainExportMaterials(input).scene).toBe(input);
  });
  it('does not deduplicate unrelated repeated material definitions',()=>{
    const input=fixture();input.meshes=[];
    expect(shareNativeTerrainExportMaterials(input).scene).toBe(input);
  });
  it('refuses conflicting shader or texture edits before changing output',()=>{
    const input=fixture(),copy=structuredClone(input);(input.materials[1] as ReturnType<typeof material>).textures.mask.name='authored.png';
    const before=structuredClone(input);
    expect(()=>shareNativeTerrainExportMaterials(input)).toThrow(/Conflicting authored terrain/);
    expect(input).toEqual(before);expect(copy.materials[0]).toEqual(input.materials[0]);
  });
  it('refuses a material ID/uniqueId collision',()=>{
    const input=fixture();input.materials[1]!.uniqueId=99;
    expect(()=>shareNativeTerrainExportMaterials(input)).toThrow(/Conflicting authored terrain/);
  });
  it('preserves unsupported material types and absent patch scenes',()=>{
    const input=fixture();for(const m of input.materials.slice(0,2))(m as ReturnType<typeof material>).customType='Other';
    expect(shareNativeTerrainExportMaterials(input).scene).toBe(input);
    const blank={};expect(shareNativeTerrainExportMaterials(blank).scene).toBe(blank);
  });
});
