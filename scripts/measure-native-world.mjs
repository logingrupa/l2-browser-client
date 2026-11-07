/** Bounded hardware WebGPU development measurement; never final acceptance.
 * Serves built dist through in-process HTTPS fulfillment, without a listener.
 * No recordings, per-frame snapshots, CPU profiler or screenshots in samples.
 */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname, extname, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([a-z-]+)=(.+)$/.exec(arg);
  if (!match) throw Error(`Expected --name=value, got ${arg}`);
  return [match[1], match[2]];
}));
const allowed = new Set(['label','sample-ms','warmup-ms','repetitions','route','view','profile-ms','output']);
for (const key of Object.keys(options)) if (!allowed.has(key)) throw Error(`Unknown option ${key}`);
const check = (value, message) => { if (!value) throw Error(message); };
check(process.env.WORLD_HARDWARE_TEST === '1', 'WORLD_HARDWARE_TEST=1 required');
check(/^[a-z0-9-]+$/.test(options.label ?? ''), '--label=short-identifier required');
const integer = (name, fallback, min, max) => {
  const n = Number(options[name] ?? fallback);
  check(Number.isSafeInteger(n) && n >= min && n <= max, `Invalid ${name}`); return n;
};
const sampleMs = integer('sample-ms',90000,1000,120000), warmupMs = integer('warmup-ms',15000,1000,60000);
const repetitions = integer('repetitions',3,1,10), profileMs = integer('profile-ms',0,0,30000);
const routeChoice=options.route??'both',view=options.view??'follow';
check(['both','source','authored'].includes(routeChoice),'Invalid route');
check(['follow','wide'].includes(view),'Invalid view');
const variants=routeChoice==='both'?['source','authored']:[routeChoice];
const root=process.cwd(),dist=await realpath(resolve(root,'dist')),origin='https://l2-world-measurement.invalid';
const script=fileURLToPath(import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=resolve(options.output??`artifacts/native-parity/research/webgpu-performance-20261107/browser/${options.label}-${stamp}`);
await mkdir(output,{recursive:true});
const json=(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
await writeFile(join(output,'runner.mjs'),await readFile(script),{flag:'wx'});
const host=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate | ConvertTo-Json'],{encoding:'utf8'}));
const limits=[
  'Two implemented actors and native flame preview, not acceptance32 actors/eight PowerStrike effects.',
  'Headless Chromium cadence is not physical presentation; display currently60Hz, no120FPS acceptance claim.',
  'Fulfilled local payload bytes/load durations are not network bandwidth/production HTTP performance.',
  'CPU brackets are main-thread submission work, not GPU duration. GPU values require supported timestamp evidence.',
  'JS heap/wrapper/internal counts do not establish GPU or total process residency.',
  'No recording, trace, profiler, screenshot or full scene snapshot during timed samples.'
];
await json('PLAN.json',{label:options.label,variants,view,sampleMs,warmupMs,repetitions,profileMs,
  browser:{channel:'chromium',headless:true,gpuOverrideFlags:[],viewport:{width:1920,height:1080},deviceScaleFactor:1},
  host,limits,runnerSha256:sha(await readFile(script)),indexSha256:sha(await readFile(join(dist,'index.html'))),
  catalogSha256:sha(await readFile(join(dist,'l2/catalog.json'))),finalAcceptance:false});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg',
  '.webp':'image/webp','.svg':'image/svg+xml','.glb':'model/gltf-binary','.wav':'audio/wav'};
const browser=await chromium.launch({channel:'chromium',headless:true});
const receipts=[];let failures=0;
try {
  const browserCdp=await browser.newBrowserCDPSession();
  await json('GPU_SYSTEM.json',await browserCdp.send('SystemInfo.getInfo')); await browserCdp.detach();
  for (const variant of variants) {
    const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,serviceWorkers:'block'});
    const page=await context.newPage(); page.setDefaultTimeout(30000);
    const receipt={variant,view,status:'running',errors:[],requests:[],samples:[],startedAt:new Date().toISOString()};
    receipts.push(receipt);
    page.on('pageerror',e=>receipt.errors.push({kind:'pageerror',message:String(e)}));
    page.on('console',m=>{if(m.type()==='error')receipt.errors.push({kind:'console',message:m.text()});});
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(['blob:','data:'].includes(url.protocol))return route.continue();
      const item={url:req.url(),method:req.method()};receipt.requests.push(item);
      try {
        check(url.origin===origin&&req.method()==='GET','External/non-GET request rejected');
        const pathname=decodeURIComponent(url.pathname); check(!pathname.includes('\\')&&!pathname.includes('\0'),'Invalid path');
        const path=await realpath(resolve(dist,pathname==='/'?'index.html':'.'+pathname)),rel=relative(dist,path);
        check(rel!==''&&rel!=='..'&&!rel.startsWith('..'+sep)&&!/^[a-z]:/i.test(rel),'Path escapes dist');
        const bytes=await readFile(path);
        Object.assign(item,{status:200,path:rel.replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)});
        await route.fulfill({status:200,contentType:mime[extname(path).toLowerCase()]??'application/octet-stream',body:bytes,
          headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
      }catch(error){item.status=404;item.error=String(error);await route.fulfill({status:404,body:'Measurement transport rejected request'});}
    });
    await page.addInitScript(()=>{
      performance.setResourceTimingBufferSize(5000);
      const p=window.__gpuProbe={adapters:[],errors:[],contexts:[],devices:0};
      const get=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){if(this.id==='canvas')p.contexts.push(kind);return Reflect.apply(get,this,[kind,...args]);};
      if(typeof GPUAdapter!=='undefined'){
        const request=GPUAdapter.prototype.requestDevice;
        GPUAdapter.prototype.requestDevice=async function(desc){
          const device=await request.call(this,desc),i=this.info;p.devices++;
          p.adapters.push({vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description,
            fallback:Boolean('isFallbackAdapter'in i&&i.isFallbackAdapter),features:[...this.features],deviceFeatures:[...device.features]});
          window.__gpuDevice=device;device.addEventListener('uncapturederror',e=>p.errors.push(e.error.message));return device;
        };
      }
    });
    try {
      const began=performance.now();
      await page.goto(`${origin}/?world=interlude${variant==='authored'?'&authored=1':''}`,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.body.dataset.worldState==='ready'&&!!window.__nativeSlice,null,{timeout:240000});
      await page.locator('#loading').waitFor({state:'detached',timeout:240000});
      receipt.loadReadyMs=performance.now()-began;
      receipt.ready=await page.evaluate(async()=>{
        await window.__gpuDevice.queue.onSubmittedWorkDone();
        return {native:window.__nativeSlice.snapshot(),gpu:window.__gpuProbe,canvasEngine:document.getElementById('canvas').dataset.engine,
          readyFrame:Number(document.getElementById('canvas').dataset.readyFrame),browser: navigator.userAgent};
      });
      check(receipt.ready.canvasEngine==='WebGPU'&&receipt.ready.readyFrame>0,'Ready WebGPU missing');
      check(receipt.ready.gpu.devices===1&&receipt.ready.gpu.adapters.every(a=>a.vendor==='nvidia'&&a.architecture==='pascal'&&!a.fallback),'NVIDIA/Pascal hardware missing');
      check(receipt.ready.gpu.contexts.includes('webgpu')&&!receipt.ready.gpu.contexts.some(c=>/webgl/i.test(c)),'Unexpected rendering backend');
      const native=receipt.ready.native;
      check(native.world?.modelCount===62&&native.world?.placementCount===157&&native.world.texturesReady&&!native.worldFailure,'World scope/readiness changed');
      check(native.nativeSky?.meshes===3&&native.nativeSky.texturesReady&&!native.skyFailure,'Sky missing');
      check(native.entities.length===2&&native.entities.every(e=>!e.isFallback),'Two native actors missing');
      // Registered sounds = action cues + footstep notifies + optional stepsound/combat bundles
      // (each optional bundle may fail without failing the world); audio must still be locked.
      check(native.nativeAudio.state==='locked'&&native.nativeAudio.locked!==false&&native.nativeAudio.registered>=9,'Audio preview changed');
      check(native.nativeAudio.stepSounds&&'failure'in native.nativeAudio.stepSounds&&'combatFailure'in native.nativeAudio&&native.nativeAudio.worldAudio,'Optional audio diagnostics missing');
      // The trusted clicks below would unlock audio (decodes, music and ambience
      // fetches) mid-capture; this scenario measures the silent world.
      await page.evaluate(()=>window.__nativeSlice.setWorldAudioEnabled?.(false));
      check(!receipt.requests.some(r=>r.url.includes('/worldPerformanceProbe-')),'Performance module loaded before explicit request');
      if(view==='wide'){
        await page.getByTestId('dev-sheet-toggle').click();
        await page.getByTestId('dev-tab-world').click();
        await page.getByRole('button',{name:'Frame world',exact:true}).click();
        await page.getByTestId('dev-sheet-toggle').click();
      }
      receipt.probeBefore=await page.evaluate(async()=>{window.__worldPerf=await window.__nativeSlice.performance();return window.__worldPerf.inspect();});
      check(receipt.probeBefore.engine.isWebGPU&&receipt.probeBefore.engine.name==='WebGPU','Actual engine is not WebGPU');
      await page.bringToFront();
      await page.waitForTimeout(warmupMs);
      receipt.scenario=await page.evaluate(({view})=>{
        const n=window.__nativeSlice.snapshot(),canvas=document.getElementById('canvas');
        return {id:'supported-20-20-two-actor-idle-v1',view,viewport:[innerWidth,innerHeight,devicePixelRatio],renderSize:[canvas.width,canvas.height],
          camera:n.camera,manifestSha256:n.world.manifestSha256,models:n.world.modelCount,placements:n.world.placementCount,
          entities:n.entities.map(e=>({id:e.id,position:e.position,modelId:e.modelId,animation:e.animation,animationSequence:e.animationSequence})),
          flames:n.flameReplay?{clockMode:'ordinary-unpaused-loop'}:null,audio:'locked',sky:'stored-materials',crowdActors:2,powerStrikeEffects:0};
      },{view});
      receipt.scenarioSha256=sha(Buffer.from(JSON.stringify(receipt.scenario)));
      await page.screenshot({path:join(output,`${variant}-before.png`)});
      // Screenshots and diagnostics are settled before recording any sample.
      await page.waitForTimeout(1000);
      const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
      for(let repetition=1;repetition<=repetitions;repetition++){
        const beforeMetrics=await cdp.send('Performance.getMetrics'),requestsBefore=receipt.requests.length;
        console.log(JSON.stringify({variant,phase:'sample-start',repetition,sampleMs,output}));
        const sample=await page.evaluate(ms=>window.__worldPerf.measure(ms),sampleMs);
        const afterMetrics=await cdp.send('Performance.getMetrics');
        check(receipt.requests.length===requestsBefore,'Unexpected requests during measurement');
        check(sample.frames>1,'No frames sampled');
        check(sample.visibility.every(event=>event.visibility==='visible'&&event.focused===true),'Page lost visible/focused state during sample');
        const file=`${variant}-sample-${repetition}.json`;
        await json(file,{...sample,cdpBefore:beforeMetrics,cdpAfter:afterMetrics,scenarioSha256:receipt.scenarioSha256,
          repetition,recording:false,profiling:false,requestsDuringSample:0});
        receipt.samples.push({file,repetition,frames:sample.frames,actualFps:sample.actualFps,metrics:sample.metrics,gpu:sample.gpu,visibility:sample.visibility});
        console.log(JSON.stringify({variant,phase:'sample-done',repetition,actualFps:sample.actualFps,metrics:sample.metrics}));
      }
      if(profileMs){
        console.log(JSON.stringify({variant,phase:'separate-diagnostic-cpu-profile',profileMs}));
        await page.evaluate(()=>{
          const root=document.querySelector('.world-interface'),counts={},previous=new WeakMap();
          for(const element of root.querySelectorAll('*'))previous.set(element,element.textContent);
          const observer=new MutationObserver(records=>{for(const record of records){
            const target=record.target.nodeType===Node.ELEMENT_NODE?record.target:record.target.parentElement;
            const key=target.dataset?.testid??target.id??target.className??target.tagName;
            const entry=counts[key]??={records:0,sameTextAsLastDelivery:0};entry.records++;
            if(previous.get(target)===target.textContent)entry.sameTextAsLastDelivery++;
            previous.set(target,target.textContent);
          }});
          observer.observe(root,{subtree:true,childList:true,characterData:true});
          window.__domDiagnostic={observer,counts};
        });
        await cdp.send('Profiler.enable');await cdp.send('Profiler.start');await page.waitForTimeout(profileMs);
        const {profile}=await cdp.send('Profiler.stop');await json(`${variant}-diagnostic.cpuprofile`,profile);await cdp.send('Profiler.disable');
        receipt.diagnosticDom=await page.evaluate(()=>{const d=window.__domDiagnostic;d.observer.disconnect();delete window.__domDiagnostic;return d.counts;});
        receipt.separateProfile={file:`${variant}-diagnostic.cpuprofile`,durationRequestedMs:profileMs,excludedFromTimingSamples:true};
      }
      await cdp.detach();
      receipt.after=await page.evaluate(async()=>{await window.__gpuDevice.queue.onSubmittedWorkDone();return {native:window.__nativeSlice.snapshot(),gpu:window.__gpuProbe,probe:window.__worldPerf.inspect()};});
      check(JSON.stringify(receipt.scenario.camera)===JSON.stringify(receipt.after.native.camera),'Camera drift during scenario');
      check(receipt.errors.length===0&&receipt.after.gpu.errors.length===0,'Browser/GPU errors');
      check(receipt.requests.every(r=>r.status===200),'Failed request');
      await page.screenshot({path:join(output,`${variant}-after.png`)});
      receipt.resources={requestCount:receipt.requests.length,fulfilledBodyBytes:receipt.requests.reduce((n,r)=>n+r.bytes,0),
        uniqueBodyBytes:[...new Map(receipt.requests.map(r=>[r.sha256,r.bytes])).values()].reduce((a,b)=>a+b,0),
        networkBytes:'unavailable: contained request fulfillment'};
      receipt.cleanup=await page.evaluate(()=>{const probe=window.__worldPerf;window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));return {runtimeRemoved:!window.__nativeSlice,probe:probe.inspect()};});
      check(receipt.cleanup.runtimeRemoved,'Runtime cleanup failed');receipt.status='passed';
    }catch(error){receipt.status='failed';receipt.failure=String(error.stack??error);failures++;console.error(receipt.failure);}
    finally{receipt.finishedAt=new Date().toISOString();await json(`${variant}-receipt.json`,receipt);await context.close();}
  }
}finally{await browser.close();await json('RESULT.json',{status:failures?'failed':'passed',receipts,limits,ownedBrowser:'closed',finalAcceptance:false});}
console.log(JSON.stringify({status:failures?'failed':'passed',output}));process.exitCode=failures?1:0;
