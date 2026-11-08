import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,stat,readdir,lstat} from 'node:fs/promises';
import {resolve,relative,dirname,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), opts={}; let headed=false;
const allowed=new Set(['--ordinary','--ordinary-sha256','--candidate','--candidate-sha256','--output','--url','--channel']);
for(let i=0;i<args.length;i++){
  if(args[i]==='--headed'){headed=true;continue;}
  if(!allowed.has(args[i])||opts[args[i]]!==undefined||!args[i+1])throw Error('Unknown/duplicate/missing argument');
  opts[args[i]]=args[++i];
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const checkedPath=async input=>{
  if(!input)throw Error('Required path missing');
  const path=resolve(root,input), rel=relative(root,path);
  if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`))throw Error('Use destination project paths only');
  for(let p=path;p!==root;p=dirname(p)){
    try{if((await lstat(p)).isSymbolicLink())throw Error('Linked comparison path');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return path;
};
const output=await checkedPath(opts['--output']);
if(!relative(root,output).split(sep).includes('artifacts')||!output.startsWith(resolve(root,'artifacts')+sep))throw Error('Evidence output must be under project artifacts');
try{await stat(output);throw Error('Comparison output already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
const files=[];
for(const [key,label] of [['ordinary','ordinary-unqualified'],['candidate','corrected-reference-unqualified']]){
  const path=await checkedPath(opts[`--${key}`]), data=await readFile(path), expected=opts[`--${key}-sha256`];
  if(!/^[a-f0-9]{64}$/.test(expected??'')||sha(data)!==expected)throw Error('Explicit candidate hash mismatch');
  files.push({label,path:relative(root,path).split(sep).join('/'),bytes:data.length,sha256:expected,base64:data.toString('base64')});
}
const url=new URL(opts['--url']??'http://127.0.0.1:5184/');
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.protocol!=='http:')throw Error('Existing local development server only');
const channel=opts['--channel'];if(channel&&!['msedge','chrome'].includes(channel))throw Error('Unsupported browser channel');
const snapshot=async()=>{
  const paths=['project.bjseditor','public/l2/catalog.json','assets/native-world.scene.native-editor-channels.json'];
  const walk=async path=>{for(const row of await readdir(resolve(root,path),{withFileTypes:true})){
    if(row.isSymbolicLink())throw Error('Linked authored path');
    const name=`${path}/${row.name}`;if(row.isDirectory())await walk(name);else if(row.isFile())paths.push(name);
  }};
  await walk('assets/native-world.scene');
  const rows={};for(const path of paths.sort())rows[path]=sha(await readFile(resolve(root,path)));return rows;
};
await mkdir(output,{recursive:true});
const beforeFiles=await snapshot();
await writeFile(resolve(output,'baseline-files.json'),JSON.stringify(beforeFiles,null,2)+'\n',{flag:'wx'});
const browser=await chromium.launch({headless:!headed,...(channel?{channel}:{}),args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const receipt={schemaVersion:1,kind:'isolated-terrain-patch-comparison',productionIntegrated:false,nativeUVQualified:false,
  url:url.origin,headed,channel:channel??'bundled-chromium',browserVersion:browser.version(),
  inputFiles:files.map(({base64,...row})=>row),routes:[],failures:[],beforeFiles};
let failure;
try{
  for(const route of ['source','authored']){
    for(const [size,width,height,isPhone] of [['desktop',1440,900,false],['mobile',932,430,true]]){
      const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,isMobile:isPhone,hasTouch:isPhone});
      const errors=[];page.on('pageerror',e=>errors.push(String(e)));
      const entry={route,size,errors,phases:[]};receipt.routes.push(entry);
      try{
        await page.goto(`${url.origin}/${route==='authored'?'?authored=1':''}`);
        await page.waitForFunction(()=>!!window.__nativeSlice,null,{timeout:180000});
        await page.locator('#loading').waitFor({state:'detached',timeout:180000});
        await page.evaluate(async()=>{
          const frameWorld=[...document.querySelectorAll('button')].find(button=>button.textContent==='Frame world');
          if(!frameWorld)throw Error('World framing control missing');frameWorld.click();
          window.__nativeSlice.dispatch({type:'set-paused',isPaused:true});
          window.__terrainProbe=await import('/artifacts/native-parity/research/terrain-extension-20261106/browser-probe.ts');
          await window.__terrainProbe.frame();
        });
        const baseline=await page.evaluate(()=>window.__terrainProbe.observation());
        const before=`${route}-${size}-before.png`;await page.screenshot({path:resolve(output,before)});
        entry.baseline={...baseline,screenshot:before};
        for(const variant of files){
          const result=await page.evaluate(input=>window.__terrainProbe.install(input.base64,input.sha256,input.label),variant);
          const image=`${route}-${size}-${variant.label}.png`;await page.screenshot({path:resolve(output,image)});
          const restored=await page.evaluate(()=>window.__terrainProbe.disposePatch());
          entry.phases.push({...result,screenshot:image,restored});
        }
        if(errors.length)throw Error('Browser error during isolated comparison');
      }catch(error){entry.failure=String(error);throw error;}
      finally{await page.close();}
    }
  }
}catch(error){failure=error;receipt.failures.push(String(error));}
finally{
  await browser.close();
  receipt.afterFiles=await snapshot();
  receipt.authoredFilesUnchanged=JSON.stringify(receipt.afterFiles)===JSON.stringify(beforeFiles);
  if(!receipt.authoredFilesUnchanged){failure??=Error('Authored inputs changed during comparison');receipt.failures.push('Authored inputs changed during comparison');}
  receipt.status=failure?'failed':'pass';
  await writeFile(resolve(output,'comparison.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({status:receipt.status,receipt:resolve(output,'comparison.json'),routes:receipt.routes.length,filesUnchanged:receipt.authoredFilesUnchanged}));
if(failure)throw failure;
