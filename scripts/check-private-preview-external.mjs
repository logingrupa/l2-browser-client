import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium, webkit } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputIndex = process.argv.indexOf('--output');
const evidence = resolve(root, outputIndex < 0 ? 'artifacts/private-preview/external' : process.argv[outputIndex + 1]);
await mkdir(evidence, { recursive: true });
const key = (await readFile(resolve(root, '.assets/private-preview/access-key'), 'utf8')).trim();
const invite = (await readFile(resolve(root, '.assets/private-preview/private-invite.txt'), 'utf8')).trim();
const base = 'https://l2.kingdom.lv';
const route = '/?authored=1';
const browserIndex = process.argv.indexOf('--browser');
const browserName = browserIndex < 0 ? 'chromium' : process.argv[browserIndex + 1];
if (!['chromium', 'webkit'].includes(browserName)) throw Error('--browser must be chromium or webkit.');
if (!/^[a-f0-9]{64}$/.test(key) || invite !== `${base}/enter?key=${key}`) throw Error('Private invitation identity is invalid.');
const checks = [], errors = [];
const assert = (ok, name) => { if (!ok) throw Error(`External preview check failed: ${name}`); checks.push({ name, passed: true }); };
const safe = value => String(value).replaceAll(invite, '[private invitation]').replaceAll(key, '[private key]');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function observeDelivery(page) {
  const active = new Set();
  const delivery = { requests: 0, finished: 0, failed: 0, peakInFlight: 0, httpFailures: [] };
  page.on('request', request => {
    active.add(request); delivery.requests++;
    delivery.peakInFlight = Math.max(delivery.peakInFlight, active.size);
  });
  page.on('requestfinished', request => { active.delete(request); delivery.finished++; });
  page.on('requestfailed', request => {
    active.delete(request); delivery.failed++;
    errors.push(`Request failed: ${safe(new URL(request.url()).pathname)} (${safe(request.failure()?.errorText)})`);
  });
  page.on('response', response => {
    if (response.status() >= 400) {
      const failure = { path: safe(new URL(response.url()).pathname), status: response.status() };
      delivery.httpFailures.push(failure);
      errors.push(`HTTP ${failure.status}: ${failure.path}`);
    }
  });
  return delivery;
}
async function observeStartup(page) {
  await page.addInitScript(() => {
    let sawLoader = false, frame;
    const result = { samples: 0, earlyExposure: 0, firstReveal: null };
    window.__privateReveal = result;
    const visible = element => element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const inspect = () => {
      const loader = document.getElementById('loading');
      if (loader) sawLoader = true;
      if (!sawLoader || result.firstReveal) return;
      result.samples++;
      const canvas = document.getElementById('canvas'), hud = document.querySelector('.world-interface');
      if (loader) { if (visible(canvas) || visible(hud)) result.earlyExposure++; return; }
      const state = window.__nativeSlice?.snapshot();
      const actors = state?.entities ?? [];
      result.firstReveal = {
        readyFrame: Number(canvas?.dataset.readyFrame ?? 0), worldState: document.body.dataset.worldState,
        terrainReady: state?.nativeTerrain === 'source-section-loaded' && state.world?.texturesReady && state.world.terrainTriangles > 0,
        nativeActors: actors.filter(actor => actor.hasNativeModel && actor.meshCount > 0).length,
        actorsWithoutNativeModel: actors.filter(actor => !actor.hasNativeModel).length,
        hudEntities: document.querySelector('[data-testid=entity-count]')?.textContent,
        visible: Boolean(visible(canvas) && visible(hud)),
      };
      cancelAnimationFrame(frame); observer.disconnect();
    };
    const observer = new MutationObserver(records => {
      if (records.some(record => [...record.removedNodes].some(node => node instanceof Element && node.id === 'loading'))) inspect();
    });
    observer.observe(document, { childList: true, subtree: true });
    const tick = () => { inspect(); if (!result.firstReveal) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
  });
}
async function verifyStartup(page, label) {
  await page.waitForFunction(() => Boolean(window.__privateReveal?.firstReveal), undefined, { timeout: 180_000 });
  const startup = await page.evaluate(() => window.__privateReveal);
  const first = startup.firstReveal;
  assert(startup.earlyExposure === 0 && first.readyFrame > 0 && first.worldState === 'ready' && first.terrainReady &&
    first.nativeActors === 2 && first.actorsWithoutNativeModel === 0 && first.hudEntities === '2' && first.visible,
  `${label} first reveal contains terrain, two native actors and initialized HUD with no early exposure`);
  return startup;
}
async function request(path, authenticated = false) {
  try { return await fetch(`${base}${path}`, { redirect: 'manual', headers: authenticated ? { Cookie: `__Host-l2_preview=${key}` } : {}, signal: AbortSignal.timeout(30_000) }); }
  catch { throw Error('External HTTPS request failed; private details suppressed.'); }
}
let browser;
try {
  const index = await readFile(resolve(root, 'dist/index.html'));
  const js = index.toString().match(/src="(\/assets\/[^"?]+\.js)"/)?.[1];
  assert(Boolean(js), 'Built JavaScript entry exists');
  for (const path of [route, '/l2/catalog.json', '/scene/native-world.babylon', js]) {
    const response = await request(path);
    assert(response.status === 403, `Anonymous HTTPS resource denied: ${path}`);
    assert(response.headers.get('server')?.toLowerCase() === 'cloudflare', 'Response traverses Cloudflare');
    assert(response.headers.get('cache-control')?.includes('no-store'), 'Anonymous response cannot be cached');
    await response.arrayBuffer();
  }
  const wrong = await request('/enter?key=wrong');
  assert(wrong.status === 403 && !wrong.headers.has('set-cookie'), 'Wrong external invitation denied');
  await wrong.arrayBuffer();
  const login = await request(`/enter?key=${key}`);
  assert(login.status === 303 && login.headers.get('location')?.endsWith(route), 'Private invitation redirects to clean world URL');
  const cookie = login.headers.get('set-cookie') ?? '';
  assert(cookie.startsWith(`__Host-l2_preview=${key};`) && /\bSecure\b/i.test(cookie) && /\bHttpOnly\b/i.test(cookie) && /SameSite=Lax/i.test(cookie), 'Secure host-only HttpOnly session established');
  await login.arrayBuffer();
  for (const [path, source] of [[route, index], [js, await readFile(resolve(root, `dist${js}`))]]) {
    const response = await request(path, true);
    assert(response.status === 200, `Authenticated HTTPS resource: ${path}`);
    assert(hash(Buffer.from(await response.arrayBuffer())) === hash(source), 'External bytes match current build');
    assert(response.headers.get('cache-control')?.includes('no-store'), 'Authenticated response cannot be cached');
  }
  for (const path of ['/src/main.ts', '/.assets/private-preview/access-key', '/scripts/private-preview.mjs']) {
    const response = await request(path, true);
    assert([403, 404].includes(response.status), 'Source and private paths are unavailable');
    await response.arrayBuffer();
  }
  await writeFile(resolve(evidence, 'http.json'), JSON.stringify({ utc: new Date().toISOString(), url: base + route, passed: checks.length, checks }, null, 2));
  if (process.argv.includes('--http-only')) { console.log(JSON.stringify({ passed: checks.length, url: base + route })); }
  else {
    browser = await ({ chromium, webkit }[browserName]).launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await observeStartup(page);
    const desktopDelivery = observeDelivery(page);
    page.on('pageerror', error => errors.push(safe(error.message)));
    page.on('console', message => { if (message.type() === 'error') errors.push(safe(message.text())); });
    await page.goto(invite, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForURL(base + route, { timeout: 120_000 });
    await page.waitForFunction(() => {
      const snapshot = window.__nativeSlice?.snapshot();
      return snapshot?.entities?.filter(actor => actor.hasNativeModel).length === 2 && snapshot.nativeFlames?.placementCounts?.active === 12;
    }, undefined, { timeout: 180_000 });
    await page.waitForLoadState('networkidle', { timeout: 180_000 });
    const desktopStartup = await verifyStartup(page, 'External desktop');
    const desktop = await page.evaluate(() => {
      const s = window.__nativeSlice.snapshot();
      const canvas = document.querySelector('canvas'), gl = canvas?.getContext('webgl2'), extension = gl?.getExtension('WEBGL_debug_renderer_info');
      return { entities: s.entities.map(actor => ({ id: actor.id, hasNativeModel: actor.hasNativeModel, animation: actor.animation })),
        world: s.world, worldFailure: s.worldFailure, flameFailure: s.flameFailure,
        flames: s.nativeFlames.placementCounts, fps: document.querySelector('[data-testid=fps]')?.textContent,
        renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null };
    });
    assert(desktop.worldFailure === null && desktop.flameFailure === null, 'External world and effects load successfully');
    assert(desktop.world.modelCount === 61 && desktop.world.placementCount === 151, 'Expected native world section is active');
    assert(errors.length === 0, 'External browser has no page/console errors');
    await page.screenshot({ path: resolve(evidence, 'desktop.png') });
    const mobile = await browser.newContext({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const hostSessionCookiesInMemory = await context.cookies(base);
    await mobile.addCookies(hostSessionCookiesInMemory);
    const mobilePage = await mobile.newPage();
    await observeStartup(mobilePage);
    const mobileDelivery = observeDelivery(mobilePage);
    mobilePage.on('pageerror', error => errors.push(safe(error.message)));
    mobilePage.on('console', message => { if (message.type() === 'error') errors.push(safe(message.text())); });
    await mobilePage.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await mobilePage.waitForFunction(() => {
      const s = window.__nativeSlice?.snapshot();
      return s?.entities.filter(actor => actor.hasNativeModel).length === 2 && s.world?.modelCount === 61 && s.world?.placementCount === 151 && s.nativeFlames?.placementCounts?.active === 12 && s.worldFailure === null && s.flameFailure === null;
    }, undefined, { timeout: 180_000 });
    await mobilePage.waitForLoadState('networkidle', { timeout: 180_000 });
    const mobileStartup = await verifyStartup(mobilePage, 'External mobile');
    await mobilePage.getByRole('button', { name: 'Run', exact: true }).tap();
    await mobilePage.waitForFunction(() => window.__nativeSlice?.snapshot().entities.find(actor => actor.id === 'local-player')?.animation === 'run');
    assert(errors.length === 0, 'External mobile controls and assets load without errors');
    await mobilePage.screenshot({ path: resolve(evidence, 'mobile.png') });
    await writeFile(resolve(evidence, 'browser.json'), JSON.stringify({ utc: new Date().toISOString(), url: base + route, browser: browserName,
      desktop: { ...desktop, startup: desktopStartup, delivery: desktopDelivery }, mobile: { viewport: [932, 430], runControl: true, startup: mobileStartup, delivery: mobileDelivery }, errors, checks,
      scope: 'Authenticated external delivery and functional rendering with desktop/mobile viewports. This is not a physical-phone, performance or native-parity result.' }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, browser: `${browserName} desktop and mobile passed`, url: base + route }));
  }
} catch (error) {
  const failure = { utc: new Date().toISOString(), passedChecks: checks, error: safe(error.message), browserErrors: errors };
  await writeFile(resolve(evidence, 'failure.json'), JSON.stringify(failure, null, 2));
  console.error(failure.error); process.exitCode = 1;
} finally { await browser?.close(); }
