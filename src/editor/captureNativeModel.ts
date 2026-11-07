import { createWebGPUEngine } from "../engine/createWebGPUEngine";
import { Scene } from "@babylonjs/core/scene";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import "@babylonjs/core/Materials/standardMaterial";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF";
import type { NativeSectionManifest } from "../scene/world/loadNativeSection";
import { sha256 } from "../assets/package/readAssetPackage";

type Json = Record<string, unknown>;
interface Input {
  baseManifestSha256: string;
  model: NativeSectionManifest["models"][number];
  placement: NativeSectionManifest["placements"][number];
  modelBase64: string;
  imageSha256: string[];
}
const object = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
function record(v: unknown): Json { if (!object(v)) throw Error("Invalid serialized resource"); return v; }
function plain(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) {
    if (v instanceof DataView) throw Error("Unsupported serialized view");
    return Array.from(v as Float32Array);
  }
  if (Array.isArray(v)) return v.map(plain);
  return object(v) ? Object.fromEntries(Object.entries(v).map(([k,c])=>[k,plain(c)])) : v;
}
function base64(bytes: Uint8Array): string {
  const parts: string[]=[];
  for(let i=0;i<bytes.length;i+=16384) parts.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
  return btoa(parts.join(""));
}

/** Capture only one source model/placement. Applying it is a separate guarded operation. */
export async function captureNativeModel(canvas: HTMLCanvasElement, input: Input) {
  const bytes = Uint8Array.from(atob(input.modelBase64), c=>c.charCodeAt(0));
  if(await sha256(bytes)!==input.model.model.sha256 || bytes.length!==input.model.model.bytes || input.placement.modelId!==input.model.id) throw Error("Model input identity differs");
  const engine=await createWebGPUEngine(canvas), scene=new Scene(engine);
  scene.useRightHandedSystem=true;
  try {
    const container=await LoadAssetContainerAsync(new File([bytes],"model.glb"),scene,{pluginOptions:{gltf:{animationStartMode:GLTFLoaderAnimationStartMode.NONE}}});
    if(container.skeletons.length || container.animationGroups.length) throw Error("Static source capture cannot contain skeletons/animations");
    container.addAllToScene();
    const placement=new TransformNode(input.placement.id,scene);
    placement.metadata={nativePlacement:input.placement};
    placement.setPreTransformMatrix(Matrix.FromArray(input.placement.matrix));
    for(const node of container.rootNodes) node.parent=placement;
    await scene.whenReadyAsync();
    const nodes=[...scene.transformNodes,...scene.meshes], paths=new Map<TransformNode,string>();
    const nodePath=(node:TransformNode):string=>{
      const old=paths.get(node);if(old)return old;
      const siblings=nodes.filter(n=>n.parent===node.parent&&n.name===node.name);
      const path=`${node.parent instanceof TransformNode?nodePath(node.parent):""}/${node.name}[${siblings.indexOf(node)}]`;
      paths.set(node,path);return path;
    };
    const used=new Set<number>();
    const identity=async(key:string)=>{
      const digest=await sha256(new TextEncoder().encode(`native-editor-model-v1:${input.model.model.sha256}:${input.placement.id}:${key}`));
      const uniqueId=2**48+Number.parseInt(digest.slice(0,12),16);
      if(used.has(uniqueId))throw Error("Source identity collision");used.add(uniqueId);
      return{id:`native-${digest.slice(0,24)}`,uniqueId};
    };
    for(const node of nodes){
      const originalId=node.id;Object.assign(node,await identity(`node:${nodePath(node)}`));
      node.metadata={...node.metadata,nativeEditorSource:{originalId,originalName:node.name}};
    }
    for(const node of nodes)if(node.parent)node.metadata={...node.metadata,parentId:node.parent.uniqueId};
    const materials=[...new Set(scene.meshes.map(m=>m.material).filter(m=>m!==null))];
    const textures=[...new Set(materials.flatMap(m=>m.getActiveTextures()))], exported=[];
    const texturePaths=new Set<string>();
    for(const texture of textures){
      if(!(texture instanceof Texture)||texture.isCube||texture.isRenderTarget)throw Error("Unsupported static texture");
      const originalName=texture.name, serialized=record(texture.serialize() as unknown), value=serialized.base64String;
      if(typeof value!=="string"||!value.startsWith("data:image/png;base64,"))throw Error("Original embedded PNG unavailable");
      const encoded=value.slice("data:image/png;base64,".length), png=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)), hash=await sha256(png);
      if(!input.imageSha256.includes(hash))throw Error("Texture bytes differ from original embedded PNG");
      const path=`assets/native-generated/model-${input.model.model.sha256}/${hash}.png`;
      texturePaths.add(path);exported.push({path,base64:encoded,sha256:hash,bytes:png.length});
      texture.name=path;texture.metadata={...texture.metadata,nativeEditorSourceName:originalName};
    }
    for(const [i,material]of materials.entries()){
      material.metadata={...material.metadata,nativeEditorSource:{originalId:material.id,originalName:material.name}};
      Object.assign(material,await identity(`material:${material.name}:${i}`));
    }
    const geometries=new Set<object>();
    for(const mesh of scene.meshes)if(mesh instanceof Mesh&&mesh.geometry&&!geometries.has(mesh.geometry)){
      geometries.add(mesh.geometry);Object.assign(mesh.geometry,await identity(`geometry:${nodePath(mesh)}`));
    }
    const rewrite=(v:unknown):void=>{
      if(Array.isArray(v)){v.forEach(rewrite);return;}if(!object(v))return;
      if(typeof v.name==="string"&&texturePaths.has(v.name)&&"samplingMode"in v){v.url=v.name;delete v.base64String;delete v.internalTextureUniqueId;}
      Object.values(v).forEach(rewrite);
    };
    for(const mesh of scene.meshes)if(mesh instanceof Mesh){
      mesh.metadata={...mesh.metadata,nativeEditorSource:{...mesh.metadata?.nativeEditorSource,sideOrientation:mesh.sideOrientation}};
      mesh.sideOrientation=mesh.sideOrientation===0?1:0;
    }
    const prior=Texture.SerializeBuffers;Texture.SerializeBuffers=false;
    try{
      const meshes=scene.meshes.map(mesh=>{
        if(!(mesh instanceof Mesh))throw Error("Unexpected static mesh type");
        SceneSerializer.ClearCache();const data=record(plain(SceneSerializer.SerializeMesh(mesh,false,false)as unknown));
        data.basePoseMatrix=Array.from(mesh.getPoseMatrix().asArray());rewrite(data);
        const geometries=record(data.geometries??{}).vertexData;
        if(Array.isArray(geometries))for(const geometry of geometries){
          const v=record(geometry), channels:Record<string,string>={};
          for(const key of["positions","normals","uvs","uvs2","colors","indices"]){
            const values=v[key];if(!Array.isArray(values))continue;
            const buffer=(key==="indices"?new Int32Array(values as number[]):new Float32Array(values as number[])).buffer;
            channels[key]=base64(new Uint8Array(buffer));
          }
          v.channelBytes=channels;
        }
        return data;
      });
      return{schemaVersion:1,kind:"native-editor-model-snapshot",baseManifestSha256:input.baseManifestSha256,
        model:input.model,placement:input.placement,placementRootId:placement.id,
        nodes:scene.transformNodes.map(n=>record(plain(n.serialize()as unknown))),meshes,textures:exported};
    }finally{Texture.SerializeBuffers=prior;}
  }finally{scene.dispose();engine.dispose();}
}
