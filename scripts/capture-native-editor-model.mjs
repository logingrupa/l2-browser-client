/** Capture a single immutable model through pinned Babylon; never edit saved scenes. */
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,dirname,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {stageWebGPUCompilers} from './stage-webgpu-compilers.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'), args=process.argv.slice(2),options={};
const allowed=new Set(['--manifest','--sha256','--base','--placement','--output']);
for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||!args[i+1]||options[args[i]])throw Error('Expected unique --manifest --sha256 --base --placement --output');options[args[i]]=args[i+1];}
if([...allowed].some(k=>!options[k]))throw Error('Missing capture arguments');
const sha=b=>createHash('sha256').update(b).digest('hex'), manifestPath=await realpath(resolve(root,options['--manifest']));
const output=resolve(root,options['--output']), rel=relative(resolve(root,'artifacts'),output);
if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`))throw Error('Use destination artifacts output');
const manifestBytes=await readFile(manifestPath);
if(sha(manifestBytes)!==options['--sha256']||!/^[a-f0-9]{64}$/.test(options['--base']))throw Error('Manifest identity differs');
const manifest=JSON.parse(manifestBytes),placements=manifest.placements.filter(p=>p.id===options['--placement']);
if(placements.length!==1)throw Error('Missing/ambiguous placement');
const placement=placements[0],models=manifest.models.filter(m=>m.id===placement.modelId);
if(models.length!==1)throw Error('Missing/ambiguous model');
const model=models[0], modelPath=await realpath(resolve(dirname(manifestPath),manifest.resourceRoots.models,model.model.file));
if(!modelPath.startsWith(dirname(dirname(manifestPath))+sep))throw Error('Model escapes source bundle');
const glb=await readFile(modelPath);
if(sha(glb)!==model.model.sha256||glb.length!==model.model.bytes)throw Error('Model bytes differ');
const jsonLength=glb.readUInt32LE(12),doc=JSON.parse(glb.subarray(20,20+jsonLength).toString('utf8')),bin=glb.subarray(28+jsonLength);
const images=doc.images.map(image=>{if(image.mimeType!=='image/png'||image.uri!==undefined)throw Error('Only original embedded PNG supported');const v=doc.bufferViews[image.bufferView];return sha(bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength));});
const compilers=await stageWebGPUCompilers();
const built=await build({stdin:{contents:'import{captureNativeModel}from"./src/editor/captureNativeModel";window.captureNativeModel=captureNativeModel;',resolveDir:root},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'warning'});
const browser=await chromium.launch({channel:'chromium',headless:true}),messages=[];
try{
  const page=await browser.newPage({viewport:{width:800,height:600},deviceScaleFactor:1});
  page.on('pageerror',e=>messages.push(String(e)));
  await page.route('**/vendor/babylon/**',async route=>{
    const compiler=compilers.files.get(new URL(route.request().url()).pathname);
    if(!compiler||route.request().method()!=='GET'){await route.fulfill({status:404,body:'Unknown WebGPU compiler resource.'});return;}
    await route.fulfill({contentType:compiler.contentType,body:await readFile(compiler.path)});
  });
  await page.route('**/__native-model-capture__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><canvas id="capture" width="800" height="600"></canvas>'}));
  await page.goto('http://127.0.0.1:5184/__native-model-capture__');
  await page.addScriptTag({type:'module',content:built.outputFiles[0].text});
  await page.waitForFunction(()=>typeof window.captureNativeModel==='function');
  const snapshot=await page.evaluate(input=>window.captureNativeModel(document.getElementById('capture'),input),{
    baseManifestSha256:options['--base'],model,placement,modelBase64:glb.toString('base64'),imageSha256:images});
  if(messages.length)throw Error(`Capture errors: ${JSON.stringify(messages)}`);
  snapshot.capture={babylon:'9.27.1',glbSha256:sha(glb),originalImageSha256:images,implementationSha256:sha(await readFile(resolve(root,'src/editor/captureNativeModel.ts')))};
  const encoded=Buffer.from(JSON.stringify(snapshot,null,2)+'\n');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,encoded,{flag:'wx'});
  console.log(JSON.stringify({path:output,sha256:sha(encoded),nodes:snapshot.nodes.length,meshes:snapshot.meshes.length,textures:snapshot.textures.length,errors:messages}));
}finally{await browser.close();}
